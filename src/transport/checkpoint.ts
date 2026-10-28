import { createHash } from 'node:crypto';
import { opendir } from 'node:fs/promises';
import type { FileObservation } from '../core/reducers';
import { parseEvent } from '../core/eventValidation';
import type { SourceJournalRecord } from './journal';
import { SecureDirectory } from './secureFs';
import { atomicPrivateJson, removePrivateFile } from './retention';
export const CHECKPOINT_ROWS = 5000;
export const CHECKPOINT_CACHE_ROWS = 500;
const MAX_CHECKPOINT_BYTES = 1024 * 1024;
interface ProjectionCheckpoint {
  checkpointVersion: 1; projectionVersion: 1; policyId: string; firstSequence: number; throughSequence: number; sourceDigest: string; projectionDigest: string; entries: FileObservation[];
}
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class ProjectionCheckpoints {
  constructor(private readonly directory: SecureDirectory, private readonly ownsLease: () => Promise<void>) {}
  async invalidate(): Promise<void> {
    await this.ownsLease();
    await removePrivateFile(this.directory, 'projection-checkpoint.json', this.ownsLease);
    await this.cleanStaging(); await this.directory.sync();
  }
  async cleanStaging(): Promise<void> {
    const listing = await opendir(this.directory.path); let count = 0;
    try { while (true) { const entry = await listing.read(); if (!entry) break; if (++count > 128) throw new Error('history-staging-limit');
      if (/^history-[0-9a-f-]{36}\.tmp$/.test(entry.name)) await removePrivateFile(this.directory, entry.name, this.ownsLease);
    } } finally { await listing.close(); }
  }
  async load(records: readonly SourceJournalRecord[], policyId: string): Promise<Map<number, FileObservation> | undefined> {
    if (records.length > CHECKPOINT_CACHE_ROWS) return undefined;
    try {
      const tail = records.slice(-CHECKPOINT_ROWS), read = await this.directory.read('projection-checkpoint.json', MAX_CHECKPOINT_BYTES);
      const c = JSON.parse(read.bytes.toString('utf8')) as ProjectionCheckpoint;
      if (!c || Object.keys(c).sort().join(',') !== 'checkpointVersion,entries,firstSequence,policyId,projectionDigest,projectionVersion,sourceDigest,throughSequence' ||
        c.checkpointVersion !== 1 || c.projectionVersion !== 1 || c.policyId !== policyId || c.firstSequence !== (tail[0]?.ingestSequence ?? 0) || c.throughSequence !== (tail.at(-1)?.ingestSequence ?? 0) ||
        c.sourceDigest !== digest(tail) || !Array.isArray(c.entries) || c.entries.length !== tail.length || c.projectionDigest !== digest(c.entries)) return undefined;
      const result = new Map<number, FileObservation>();
      for (let index = 0; index < c.entries.length; index++) {
        const entry = c.entries[index]!, record = tail[index]!;
        if (!entry || Object.keys(entry).some(k => k !== 'event' && k !== 'pathHint') || (entry.pathHint !== undefined && !/^[0-9a-f]{64}$/.test(entry.pathHint))) return undefined;
        const checked = parseEvent(JSON.stringify(entry.event), 'journal');
        if (!checked.ok || checked.event.eventId !== record.envelope.eventId || checked.event.ingestSequence !== record.ingestSequence) return undefined;
        result.set(record.ingestSequence, entry);
      }
      return result;
    } catch { return undefined; }
  }
  async save(records: readonly SourceJournalRecord[], policyId: string, project: (record: SourceJournalRecord) => FileObservation | undefined): Promise<boolean> {
    // This is an optional accelerator, not retained history. Large histories
    // use bounded authoritative replay instead of materializing a large cache.
    if (records.length > CHECKPOINT_CACHE_ROWS) {await this.invalidate();return false;}
    const tail = records.slice(-CHECKPOINT_ROWS), entries = tail.map(project);
    if (entries.some(e => !e)) { await this.invalidate(); return false; }
    const value: ProjectionCheckpoint = { checkpointVersion: 1, projectionVersion: 1, policyId, firstSequence: tail[0]?.ingestSequence ?? 0, throughSequence: tail.at(-1)?.ingestSequence ?? 0,
      sourceDigest: digest(tail), projectionDigest: digest(entries), entries: entries as FileObservation[] };
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_CHECKPOINT_BYTES) { await this.invalidate(); return false; }
    await atomicPrivateJson(this.directory, 'projection-checkpoint.json', value, this.ownsLease); return true;
  }
}
