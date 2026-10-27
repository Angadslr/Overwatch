import {hash} from 'node:crypto';
import type {SourceEnvelopeV1} from './sourceContracts';
import type {RetiredIdentity} from './retention';

const CHUNK_SLOTS = 1024;
const SLOT_BYTES = 48;
/** UUID keys remain searchable; numeric metadata and SHA-256 bytes use bounded
 * chunks rather than one object and several strings for every disk record. */
export class JournalIndex {
 private readonly lookup = new Map<string, number>();
 private readonly ids: Array<string | undefined> = [];
 private readonly chunks: Buffer[] = [];
 private readonly available: number[] = [];
 constructor(private readonly capacity: number) {}
 get size(): number { return this.lookup.size; }
 find(id: string): number | undefined { return this.lookup.get(id); }
 private slot(index: number): {bytes: Buffer; offset: number} {
  const bytes = this.chunks[Math.floor(index / CHUNK_SLOTS)];
  if (!bytes || !this.ids[index]) throw new Error('journal-index-missing');
  return {bytes, offset:(index % CHUNK_SLOTS) * SLOT_BYTES};
 }
 add(envelope: SourceEnvelopeV1, sequence: number): number {
  if (this.lookup.has(envelope.eventId) || this.size >= this.capacity) throw new Error('journal-index-limit');
  const index = this.available.pop() ?? this.ids.length;
  const chunk = Math.floor(index / CHUNK_SLOTS);
  if (!this.chunks[chunk]) this.chunks[chunk] = Buffer.alloc(Math.min(CHUNK_SLOTS, this.capacity - chunk * CHUNK_SLOTS) * SLOT_BYTES);
  this.ids[index] = envelope.eventId;
  const {bytes, offset} = this.slot(index);
  hash('sha256', JSON.stringify(envelope), 'buffer').copy(bytes, offset);
  bytes.writeDoubleLE(sequence, offset + 32);
  bytes.writeDoubleLE(Date.parse(envelope.receivedAt), offset + 40);
  this.lookup.set(envelope.eventId, index);
  return index;
 }
 sequence(index: number): number { const {bytes, offset} = this.slot(index); return bytes.readDoubleLE(offset + 32); }
 receivedAt(index: number): number { const {bytes, offset} = this.slot(index); return bytes.readDoubleLE(offset + 40); }
 matches(index: number, envelope: SourceEnvelopeV1): boolean {
  const {bytes, offset} = this.slot(index);
  return bytes.subarray(offset, offset + 32).equals(hash('sha256', JSON.stringify(envelope), 'buffer'));
 }
 retired(index: number): RetiredIdentity {
  const {bytes, offset} = this.slot(index);
  return {id:this.ids[index]!, digest:bytes.toString('hex',offset,offset+32), sequence:bytes.readDoubleLE(offset+32), receivedAt:new Date(bytes.readDoubleLE(offset+40)).toISOString()};
 }
 remove(index: number): void {
  const id = this.ids[index];
  if (!id) throw new Error('journal-index-missing');
  const {bytes, offset} = this.slot(index);
  this.lookup.delete(id); this.ids[index] = undefined;
  bytes.fill(0, offset, offset + SLOT_BYTES);
  this.available.push(index);
 }
}
