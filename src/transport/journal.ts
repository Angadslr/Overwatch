import { constants } from 'node:fs';
import { open, lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { SecureDirectory, sameFile } from './secureFs';
import { MAX_SOURCE_BYTES, parseSource } from './sourceValidation';
import type { SourceEnvelopeV1 } from './sourceContracts';
export interface SourceJournalRecord {
  journalVersion: 1;
  ingestSequence: number;
  envelope: SourceEnvelopeV1;
}
const MAX_SEGMENT = 5 * 1024 * 1024;
const MAX_HISTORY = 100 * 1024 * 1024;
const MAX_RECORDS = 100000;
/** Single writer, bounded history. Each append is synced before it is accepted.
 * Retention/compaction is deliberately deferred; a full journal stops ingestion. */
export class Journal {
  readonly records: SourceJournalRecord[] = [];
  readonly byId = new Map<string, SourceJournalRecord>();
  recoveredTail = false;
  private segment = 0;
  private segmentBytes = 0;
  private totalBytes = 0;
  private poisoned = false;
  constructor(private readonly directory: SecureDirectory, private readonly ownsLease: () => Promise<void>, private readonly acceptScope: (e: SourceEnvelopeV1) => boolean) { }
  private name(n: number): string { return `journal-${String(n).padStart(6, '0')}.ndjson`; }
  async load(): Promise<void> {
    await this.ownsLease();
    const listing = await opendir(this.directory.path);
    const names: string[] = [];
    try {
      while (true) {
        const entry = await listing.read();
        if (!entry)
          break;
        if (names.length >= 21 || !/^journal-\d{6}\.ndjson$/.test(entry.name))
          throw new Error('journal-layout-invalid');
        names.push(entry.name);
      }
    }
    finally {
      await listing.close();
    }
    names.sort();
    if (names.some((name, i) => name !== this.name(i)))
      throw new Error('journal-segment-missing');
    // Never enumerate unbounded history or follow unexpected segment names.
    for (let n = 0; n <= 21; n++) {
      let read;
      try {
        read = await this.directory.read(this.name(n), MAX_SEGMENT);
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          this.segment = Math.max(0, n - 1);
          break;
        }
        throw new Error('journal-unreadable');
      }
      if (n === 21)
        throw new Error('journal-history-limit');
      this.totalBytes += read.bytes.length;
      if (this.totalBytes > MAX_HISTORY)
        throw new Error('journal-history-limit');
      this.segment = n;
      this.segmentBytes = read.bytes.length;
      let start = 0;
      while (start < read.bytes.length) {
        const end = read.bytes.indexOf(10, start);
        if (end < 0) {
          // Only an unterminated suffix in the last segment can be repaired.
          try {
            await lstat(join(this.directory.path, this.name(n + 1)));
            throw new Error('journal-middle-corruption');
          }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
              throw error;
          }
          const { handle, info } = await this.directory.file(this.name(n), constants.O_WRONLY);
          try {
            if (info.nlink !== 1)
              throw new Error('journal-hardlink');
            await this.ownsLease();
            await handle.truncate(start);
            await handle.sync();
          }
          finally {
            await handle.close();
          }
          this.totalBytes -= read.bytes.length - start;
          this.segmentBytes = start;
          this.recoveredTail = true;
          break;
        }
        const line = read.bytes.subarray(start, end);
        if (line.length > MAX_SOURCE_BYTES + 256)
          throw new Error('journal-record-too-large');
        let value: SourceJournalRecord;
        try {
          value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)) as SourceJournalRecord;
        }
        catch {
          throw new Error('journal-corrupt');
        }
        const envelope = parseSource(Buffer.from(JSON.stringify(value.envelope)));
        if (!envelope || !this.acceptScope(envelope) || value.journalVersion !== 1 || value.ingestSequence !== this.records.length + 1 || Object.keys(value).sort().join(',') !== 'envelope,ingestSequence,journalVersion' || this.byId.has(envelope.eventId))
          throw new Error('journal-corrupt');
        if (this.records.length >= MAX_RECORDS)
          throw new Error('journal-history-limit');
        const record: SourceJournalRecord = { journalVersion: 1, ingestSequence: value.ingestSequence, envelope };
        this.records.push(record);
        this.byId.set(envelope.eventId, record);
        start = end + 1;
      }
      // A crash may leave a complete newline-terminated write that never reached
      // fsync. Recovered records must be synced before duplicate acknowledgment.
      const recovered = await this.directory.file(this.name(n), constants.O_RDWR);
      try {
        if (!sameFile(read.info, recovered.info) || recovered.info.nlink !== 1)
          throw new Error('journal-file-changed');
        await recovered.handle.sync();
      }
      finally {
        await recovered.handle.close();
      }
    }
    await this.directory.sync();
  }
  async append(envelope: SourceEnvelopeV1): Promise<{
    record: SourceJournalRecord;
    added: boolean;
  }> {
    if (this.poisoned)
      throw new Error('journal-reopen-required');
    await this.ownsLease();
    const existing = this.byId.get(envelope.eventId);
    if (existing) {
      if (JSON.stringify(existing.envelope) !== JSON.stringify(envelope))
        throw new Error('event-id-conflict');
      return { record: existing, added: false };
    }
    const checked = parseSource(Buffer.from(JSON.stringify(envelope)));
    if (!checked || !this.acceptScope(checked))
      throw new Error('invalid-source-envelope');
    const record: SourceJournalRecord = { journalVersion: 1, ingestSequence: this.records.length + 1, envelope: checked };
    const bytes = Buffer.from(JSON.stringify(record) + '\n');
    if (this.records.length >= MAX_RECORDS || this.totalBytes + bytes.length > MAX_HISTORY)
      throw new Error('journal-history-limit');
    if (this.segmentBytes + bytes.length > MAX_SEGMENT) {
      this.segment++;
      this.segmentBytes = 0;
    }
    const name = this.name(this.segment), path = join(this.directory.path, name);
    await this.directory.guard();
    let created = false;
    try {
      const fresh = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await fresh.close();
      created = true;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        throw error;
    }
    const { handle, info } = await this.directory.file(name, constants.O_WRONLY | constants.O_APPEND);
    try {
      if (info.nlink !== 1 || info.size !== this.segmentBytes)
        throw new Error('journal-file-changed');
      await this.ownsLease();
      // A failed/partial write poisons this writer. Recovery must inspect disk
      // before another append, never append after an uncertain torn record.
      this.poisoned = true;
      let offset = 0;
      while (offset < bytes.length) {
        const written = await handle.write(bytes, offset, bytes.length - offset, null);
        if (!written.bytesWritten)
          throw new Error('journal-short-write');
        offset += written.bytesWritten;
      }
      await handle.sync();
      if (created)
        await this.directory.sync();
      await this.ownsLease();
      this.segmentBytes += bytes.length;
      this.totalBytes += bytes.length;
      this.records.push(record);
      this.byId.set(envelope.eventId, record);
      this.poisoned = false;
      return { record, added: true };
    }
    finally {
      await handle.close();
    }
  }
}
