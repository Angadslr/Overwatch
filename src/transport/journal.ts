import { constants } from 'node:fs';
import { open, lstat, opendir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { SecureDirectory, sameFile } from './secureFs';
import { MAX_SOURCE_BYTES, parseSource, validateSource } from './sourceValidation';
import type { SourceEnvelopeV1 } from './sourceContracts';
import {JournalIndex} from './journalIndex';
import { atomicPrivateJson, envelopeDigest, historyPolicy, parseRetention, removePrivateFile, type HistoryPolicy, type RetentionManifest, type RetiredIdentity } from './retention';
export interface SourceJournalRecord { journalVersion: 1; ingestSequence: number; envelope: SourceEnvelopeV1 }
export interface JournalOptions { policy?: Partial<HistoryPolicy>; now?: () => number; beforePrune?: () => Promise<void>; afterRetentionCommit?: () => Promise<void> }
interface Segment { bytes: number; records: number[] }
export const RECENT_JOURNAL_RECORDS = 5000;
export type AppendResult = { added: true; record: SourceJournalRecord; expired?: never } | { added: false; record?: SourceJournalRecord; expired?: true };
/** Data sync precedes acknowledgment. Retention commits metadata before unlink,
 * so crashes leave ignorable old segments rather than resurrected observations. */
export class Journal {
  readonly records: SourceJournalRecord[] = [];
  private readonly index: JournalIndex;
  recoveredTail = false;
  revision = 0;
  private segment = 0;
  private totalBytes = 0;
  private poisoned = false;
  private nextSequence = 1;
  private readonly segments = new Map<number, Segment>();
  private readonly retired = new Map<string, RetiredIdentity>();
  private manifest: RetentionManifest = { retentionVersion: 1, firstSegment: 0, firstSequence: 1, expiredBefore: '1970-01-01T00:00:00.000Z', retired: [] };
  private readonly policy: HistoryPolicy;
  private readonly now: () => number;
  private writes: Promise<unknown> = Promise.resolve();
  private serialize<T>(operation:()=>Promise<T>):Promise<T> {
    const task=this.writes.then(operation,operation);this.writes=task.catch(()=>{});return task;
  }
  async whenIdle():Promise<void> { await this.writes; }
  constructor(private readonly directory: SecureDirectory, private readonly ownsLease: () => Promise<void>, private readonly acceptScope: (e: SourceEnvelopeV1) => boolean, private readonly options: JournalOptions = {}) {
    this.policy = historyPolicy(options.policy); this.now = options.now ?? Date.now; this.index = new JournalIndex(this.policy.records);
  }
  private name(n: number): string { if (n > 999999) throw new Error('journal-segment-limit'); return `journal-${String(n).padStart(6, '0')}.ndjson`; }
  status(): { firstSequence: number; nextSequence: number; retainedRecords: number; bufferedRecords: number; bufferedFirstSequence: number; bytes: number; retiredIdentities: number; expiredBefore: string } {
    return { firstSequence: this.manifest.firstSequence, nextSequence: this.nextSequence, retainedRecords: this.index.size, bufferedRecords: this.records.length, bufferedFirstSequence: this.records[0]?.ingestSequence ?? this.nextSequence, bytes: this.totalBytes, retiredIdentities: this.retired.size, expiredBefore: this.manifest.expiredBefore };
  }
  private async removeSegment(n: number): Promise<void> {
    const name = this.name(n); let file;
    try { file = await this.directory.file(name); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const info = file.info; await file.handle.close();
    if (info.nlink !== 1) throw new Error('journal-hardlink');
    await this.ownsLease(); await this.directory.guard();
    if (!sameFile(info, await lstat(join(this.directory.path, name)))) throw new Error('journal-file-changed');
    await unlink(join(this.directory.path, name));
  }
  async load(): Promise<void> {
    await this.ownsLease();
    try {
      const read = await this.directory.read('retention.json', 24 * 1024 * 1024);
      this.manifest = parseRetention(JSON.parse(read.bytes.toString('utf8')), this.policy.tombstones);
      for (const item of this.manifest.retired) this.retired.set(item.id, item);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('retention-manifest-invalid'); }
    this.nextSequence = this.manifest.firstSequence;
    const listing = await opendir(this.directory.path), numbers: number[] = [];
    let temporaryCount = 0;
    try {
      while (true) {
        const entry = await listing.read(); if (!entry) break;
        if (entry.name === 'retention.json') continue;
        if (/^history-[0-9a-f-]{36}\.tmp$/.test(entry.name)) { if (++temporaryCount > 32) throw new Error('journal-layout-invalid'); await removePrivateFile(this.directory, entry.name, this.ownsLease); continue; }
        const match = /^journal-(\d{6})\.ndjson$/.exec(entry.name);
        if (!match || numbers.length >= 64) throw new Error('journal-layout-invalid'); numbers.push(Number(match[1]));
      }
    } finally { await listing.close(); }
    const retained = numbers.filter(n => n >= this.manifest.firstSegment).sort((a, b) => a - b);
    if (retained.length > 22 || retained.some((n, i) => n !== this.manifest.firstSegment + i)) throw new Error('journal-segment-missing');
    this.segment = retained.at(-1) ?? this.manifest.firstSegment;
    for (const n of retained) {
      const read = await this.directory.file(this.name(n));
      const segment: Segment = { bytes: read.info.size, records: [] }; this.segments.set(n, segment); this.totalBytes += segment.bytes;
      if (segment.bytes > this.policy.segmentBytes) { await read.handle.close(); throw new Error('journal-record-too-large'); }
      if (this.totalBytes > this.policy.historyBytes) { await read.handle.close(); throw new Error('journal-history-limit'); }
      const decoder = new TextDecoder('utf-8', {fatal:true});
      const consume = (line:Buffer):void => {
        if (line.length > MAX_SOURCE_BYTES + 256) throw new Error('journal-record-too-large');
        let value: SourceJournalRecord;
        try { value = JSON.parse(decoder.decode(line)) as SourceJournalRecord; } catch { throw new Error('journal-corrupt'); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('journal-corrupt');
        const envelope = validateSource(value.envelope);
        if (!envelope || !this.acceptScope(envelope) || value.journalVersion !== 1 || value.ingestSequence !== this.nextSequence ||
          Object.keys(value).sort().join(',') !== 'envelope,ingestSequence,journalVersion' || this.index.find(envelope.eventId) !== undefined || this.retired.has(envelope.eventId)) throw new Error('journal-corrupt');
        if (this.index.size >= this.policy.records) throw new Error('journal-history-limit');
        // Cold validation retains compact identities only. Cycling every old
        // payload through the recent window promotes disposable objects into
        // the long-lived heap before they are evicted.
        segment.records.push(this.index.add(envelope, value.ingestSequence)); this.nextSequence++;
      };
      let position = 0, completeBytes = 0, pending:Buffer = Buffer.alloc(0);
      const buffer = Buffer.allocUnsafe(64 * 1024);
      try {
        while (position < read.info.size) {
          const result = await read.handle.read(buffer, 0, Math.min(buffer.length, read.info.size - position), position);
          if (!result.bytesRead) throw new Error('journal-file-changed');
          position += result.bytesRead;
          let start = 0;
          while (start < result.bytesRead) {
            const end = buffer.indexOf(10, start);
            if (end < 0 || end >= result.bytesRead) {
              pending = Buffer.concat([pending, buffer.subarray(start, result.bytesRead)]);
              if (pending.length > MAX_SOURCE_BYTES + 256) throw new Error('journal-record-too-large');
              break;
            }
            const line = pending.length ? Buffer.concat([pending, buffer.subarray(start, end)]) : buffer.subarray(start, end);
            consume(line); completeBytes += line.length + 1; pending = Buffer.alloc(0); start = end + 1;
          }
        }
        const after = await read.handle.stat();
        if (after.size !== read.info.size || after.mtimeMs !== read.info.mtimeMs || after.ctimeMs !== read.info.ctimeMs || after.nlink !== 1) throw new Error('journal-file-changed');
        await this.directory.guard();
        if (pending.length) {
          if (n !== retained.at(-1)) throw new Error('journal-middle-corruption');
          const { handle, info } = await this.directory.file(this.name(n), constants.O_WRONLY);
          try { if (!sameFile(read.info, info) || info.nlink !== 1) throw new Error('journal-file-changed'); await this.ownsLease(); await handle.truncate(completeBytes); await handle.sync(); }
          finally { await handle.close(); }
          this.totalBytes -= segment.bytes - completeBytes; segment.bytes = completeBytes; this.recoveredTail = true;
        }
      } finally { await read.handle.close(); }
      const file = await this.directory.file(this.name(n), constants.O_RDWR);
      try { if (!sameFile(read.info, file.info) || file.info.nlink !== 1) throw new Error('journal-file-changed'); await file.handle.sync(); }
      finally { await file.handle.close(); }
    }
    // A committed manifest can outlive a crash before old segment removal.
    for (const n of numbers.filter(n => n < this.manifest.firstSegment)) await this.removeSegment(n);
    await this.directory.sync();
    await this.maintain();
    if(this.index.size)this.records.push(...await this.readHistory(Math.max(0,this.nextSequence-RECENT_JOURNAL_RECORDS-1),RECENT_JOURNAL_RECORDS));
  }
  maintain(reserveBytes = 0, reserveRecords = 0): Promise<void> { return this.serialize(()=>this.maintainOwned(reserveBytes,reserveRecords)); }
  private async maintainOwned(reserveBytes = 0, reserveRecords = 0): Promise<void> {
    if (this.poisoned) throw new Error('journal-reopen-required');
    const cutoff = Math.max(Date.parse(this.manifest.expiredBefore), this.now() - this.policy.ageMs);
    const ordered = [...this.segments.keys()].sort((a, b) => a - b);
    const remove: number[] = []; let bytes = this.totalBytes, records = this.index.size;
    let nextActive = this.segment;
    for (const n of ordered) {
      const segment = this.segments.get(n)!;
      const expired = segment.records.length > 0 && segment.records.every(r => this.index.receivedAt(r) < cutoff);
      const over = bytes + reserveBytes > this.policy.historyBytes || records + reserveRecords > this.policy.records;
      if (!expired && !over) break;
      if (n === nextActive) {
        if (!segment.records.length || (!expired && records + reserveRecords <= this.policy.records)) break;
        this.name(nextActive + 1); nextActive++;
      }
      remove.push(n); bytes -= segment.bytes; records -= segment.records.length;
    }
    if (!remove.length) return;
    await this.ownsLease();
    const retired = new Map([...this.retired].filter(([, item]) => Date.parse(item.receivedAt) >= cutoff));
    for (const n of remove) for (const slot of this.segments.get(n)!.records)
      if (this.index.receivedAt(slot) >= cutoff) { const identity = this.index.retired(slot); retired.set(identity.id, identity); }
    if (retired.size > this.policy.tombstones) throw new Error('retention-dedup-limit');
    const firstSegment = remove.at(-1)! + 1;
    const removedRecords = remove.flatMap(n => this.segments.get(n)!.records);
    const firstSequence = removedRecords.length ? this.index.sequence(removedRecords.at(-1)!) + 1 : this.manifest.firstSequence;
    const manifest: RetentionManifest = { retentionVersion: 1, firstSegment, firstSequence, expiredBefore: new Date(cutoff).toISOString(), retired: [...retired.values()] };
    // Invalidate derived data first: a crash must not leave a cache of pruned facts.
    await this.options.beforePrune?.();
    this.poisoned = true;
    await atomicPrivateJson(this.directory, 'retention.json', manifest, this.ownsLease);
    await this.options.afterRetentionCommit?.();
    this.manifest = manifest; this.segment = nextActive;
    this.retired.clear(); for (const [key, value] of retired) this.retired.set(key, value);
    for (const n of remove) {
      const segment = this.segments.get(n)!;
      for (const slot of segment.records) this.index.remove(slot);
      this.segments.delete(n);
    }
    const firstBuffered = this.records.findIndex(record => record.ingestSequence >= firstSequence);
    this.records.splice(0, firstBuffered < 0 ? this.records.length : firstBuffered);
    this.totalBytes = bytes; this.revision++;
    for (const n of remove) await this.removeSegment(n);
    await this.directory.sync();
    this.poisoned = false;
  }
  async append(envelope:SourceEnvelopeV1):Promise<AppendResult> { return (await this.appendBatch([envelope]))[0]!; }
  /** Bounded durable groups share one data sync. Single-record spool admission
   * uses this same serialized writer; callers acknowledge only after resolution. */
  appendBatch(input:readonly SourceEnvelopeV1[],admit?:(envelope:SourceEnvelopeV1)=>boolean):Promise<AppendResult[]> {
    if(!input.length||input.length>32)return Promise.reject(new Error('invalid-journal-batch'));
    return this.serialize(async()=>{
      if(this.poisoned)throw new Error('journal-reopen-required');
      await this.ownsLease();
      const offered=new Map<string,string>();
      const checked=input.map(envelope=>{
        const value=parseSource(Buffer.from(JSON.stringify(envelope)));
        if(!value||!this.acceptScope(value)||(admit&&!admit(value)))throw new Error('invalid-source-envelope');
        const digest=envelopeDigest(value),previous=offered.get(value.eventId),existing=this.index.find(value.eventId),retired=this.retired.get(value.eventId);
        if((previous!==undefined&&previous!==digest)||(existing!==undefined&&!this.index.matches(existing,value))||(retired&&retired.digest!==digest))throw new Error('event-id-conflict');
        offered.set(value.eventId,digest);return value;
      });
      const results:AppendResult[]=[],staged=new Map<string,SourceJournalRecord>();
      let group:SourceJournalRecord[]=[],parts:Buffer[]=[],groupBytes=0;
      const flush=async()=>{if(!group.length)return;await this.writeGroup(group,Buffer.concat(parts,groupBytes));group=[];parts=[];groupBytes=0;};
      for(const envelope of checked){
        const existing=this.index.find(envelope.eventId),retired=this.retired.get(envelope.eventId),previous=staged.get(envelope.eventId);
        if(existing!==undefined){results.push({added:false,record:{journalVersion:1,ingestSequence:this.index.sequence(existing),envelope}});continue;}
        if(retired){results.push({added:false,record:{journalVersion:1,ingestSequence:retired.sequence,envelope}});continue;}
        if(previous){results.push({added:false,record:previous});continue;}
        if(Date.parse(envelope.receivedAt)<Math.max(Date.parse(this.manifest.expiredBefore),this.now()-this.policy.ageMs)){results.push({added:false,expired:true});continue;}
        let record:SourceJournalRecord={journalVersion:1,ingestSequence:this.nextSequence+group.length,envelope};
        let bytes=Buffer.from(JSON.stringify(record)+'\n');
        if(bytes.length>this.policy.segmentBytes)throw new Error('journal-record-too-large');
        if(group.length&&(groupBytes+bytes.length>this.policy.segmentBytes||group.length>=this.policy.records)){
          await flush();record={...record,ingestSequence:this.nextSequence};bytes=Buffer.from(JSON.stringify(record)+'\n');
        }
        if(admit&&!admit(envelope))throw new Error('invalid-source-envelope');
        group.push(record);parts.push(bytes);groupBytes+=bytes.length;staged.set(envelope.eventId,record);results.push({added:true,record});
      }
      await flush();return results;
    });
  }
  private async writeGroup(records:readonly SourceJournalRecord[],bytes:Buffer):Promise<void> {
    if(this.poisoned)throw new Error('journal-reopen-required');
    if ((this.segments.get(this.segment)?.bytes ?? 0) + bytes.length > this.policy.segmentBytes) { this.name(this.segment + 1); this.segment++; }
    await this.maintainOwned(bytes.length,records.length);
    if (this.index.size+records.length>this.policy.records || this.totalBytes + bytes.length > this.policy.historyBytes || !Number.isSafeInteger(this.nextSequence + records.length)) throw new Error('journal-history-limit');
    const name = this.name(this.segment), path = join(this.directory.path, name);
    await this.directory.guard(); let created = false;
    try { const fresh = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); await fresh.close(); created = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const segment = this.segments.get(this.segment) ?? { bytes: 0, records: [] };
    this.segments.set(this.segment, segment);
    const { handle, info } = await this.directory.file(name, constants.O_WRONLY | constants.O_APPEND);
    try {
      if (info.nlink !== 1 || info.size !== segment.bytes) throw new Error('journal-file-changed');
      await this.ownsLease(); this.poisoned = true;
      let offset = 0;
      while (offset < bytes.length) { const written = await handle.write(bytes, offset, bytes.length - offset, null); if (!written.bytesWritten) throw new Error('journal-short-write'); offset += written.bytesWritten; }
      await handle.sync(); if (created) await this.directory.sync(); await this.ownsLease();
      segment.bytes += bytes.length; this.totalBytes += bytes.length;
      for(const record of records){segment.records.push(this.index.add(record.envelope,record.ingestSequence));this.records.push(record);}
      this.nextSequence+=records.length;this.poisoned=false;
      if (this.records.length > RECENT_JOURNAL_RECORDS) this.records.splice(0, this.records.length - RECENT_JOURNAL_RECORDS);
    } finally { await handle.close(); }
  }
  /** Read an explicitly bounded page from retained disk history without holding
   * every payload in memory. The compact identity index detects later changes. */
  async readHistory(afterSequence = 0, limit = RECENT_JOURNAL_RECORDS): Promise<SourceJournalRecord[]> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > RECENT_JOURNAL_RECORDS) throw new Error('invalid-history-page');
    await this.ownsLease();
    const records: SourceJournalRecord[] = [];
    for (const [number, segment] of this.segments) {
      const lastSlot = segment.records.at(-1);
      if (lastSlot === undefined || this.index.sequence(lastSlot) <= afterSequence) continue;
      const read = await this.directory.read(this.name(number), this.policy.segmentBytes);
      let start = 0;
      let expectedSequence = this.index.sequence(segment.records[0]!);
      while (start < read.bytes.length) {
        const end = read.bytes.indexOf(10, start);
        if (end < 0 || end - start > MAX_SOURCE_BYTES + 256) throw new Error('journal-corrupt');
        let value: SourceJournalRecord;
        try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(read.bytes.subarray(start, end))) as SourceJournalRecord; }
        catch { throw new Error('journal-corrupt'); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('journal-corrupt');
        const envelope = validateSource(value.envelope);
        const slot = envelope && this.index.find(envelope.eventId);
        if (!envelope || !this.acceptScope(envelope) || value.journalVersion !== 1 || Object.keys(value).sort().join(',') !== 'envelope,ingestSequence,journalVersion' || slot === undefined || this.index.sequence(slot) !== value.ingestSequence || value.ingestSequence !== expectedSequence || !this.index.matches(slot, envelope)) throw new Error('journal-corrupt');
        expectedSequence++;
        if (value.ingestSequence > afterSequence) records.push(value);
        if (records.length === limit) { await this.ownsLease(); return records; }
        start = end + 1;
      }
    }
    await this.ownsLease();
    return records;
  }
}
