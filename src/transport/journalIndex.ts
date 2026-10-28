import {hash, randomBytes} from 'node:crypto';
import {UUID_PATTERN} from './sourceValidation';
import {HISTORY_POLICY, type RetiredIdentity} from './retention';
import type {SourceEnvelopeV1} from './sourceContracts';

const CHUNK_SLOTS = 1024;
const SLOT_BYTES = 68;
const UUID_OFFSETS = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34];
const DIGEST_OFFSET = 16;
const SEQUENCE_OFFSET = 48;
const RECEIPT_OFFSET = 56;
const LINK_OFFSET = 64;
const hex = (code: number): number => code <= 57 ? code - 48 : code - 87;
const uuidByte = (id: string, byte: number): number => {
  const offset = UUID_OFFSETS[byte]!;
  return (hex(id.charCodeAt(offset)) << 4) | hex(id.charCodeAt(offset + 1));
};

/** Fixed-capacity UUID lookup with binary payloads and collision chains. Zero
 * links mean absent; live slots store slot+1. Freed links form a reusable list.
 * A per-instance seed randomizes bucket placement without changing identity. */
export class JournalIndex {
  private readonly buckets: Uint32Array;
  private readonly live: Uint8Array;
  private readonly chunks: Buffer[] = [];
  private issued = 0;
  private count = 0;
  private freeHead = 0;

  constructor(private readonly capacity: number, private readonly seed = randomBytes(4).readUInt32LE()) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > HISTORY_POLICY.records ||
        !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('invalid-journal-index');
    let buckets = 1;
    while (buckets < capacity) buckets *= 2;
    this.buckets = new Uint32Array(buckets);
    this.live = new Uint8Array(capacity);
  }

  get size(): number { return this.count; }
  countReceivedAtOrAfter(cutoff: number): number {
    if (!Number.isFinite(cutoff)) throw new Error('invalid-journal-cutoff');
    let count = 0;
    for (let index = 0; index < this.issued; index++) if (this.live[index] === 1 && this.receivedAt(index) >= cutoff) count++;
    return count;
  }

  private storage(index: number): {bytes: Buffer; offset: number} {
    const bytes = this.chunks[Math.floor(index / CHUNK_SLOTS)];
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.issued || !bytes) throw new Error('journal-index-missing');
    return {bytes, offset: (index % CHUNK_SLOTS) * SLOT_BYTES};
  }

  private slot(index: number): {bytes: Buffer; offset: number} {
    if (this.live[index] !== 1) throw new Error('journal-index-missing');
    return this.storage(index);
  }

  private bucket(id: string): number {
    let value = this.seed;
    for (let byte = 0; byte < 16; byte++) value = Math.imul(value ^ uuidByte(id, byte), 0x01000193);
    value ^= value >>> 16;
    return (value >>> 0) & (this.buckets.length - 1);
  }

  private storedBucket(bytes: Buffer, offset: number): number {
    let value = this.seed;
    for (let byte = 0; byte < 16; byte++) value = Math.imul(value ^ bytes[offset + byte]!, 0x01000193);
    value ^= value >>> 16;
    return (value >>> 0) & (this.buckets.length - 1);
  }

  find(id: string): number | undefined {
    if (!UUID_PATTERN.test(id)) return undefined;
    let link = this.buckets[this.bucket(id)]!, visited = 0;
    while (link) {
      if (++visited > this.count) throw new Error('journal-index-corrupt');
      const index = link - 1, {bytes, offset} = this.slot(index);
      let equal = true;
      for (let byte = 0; byte < 16; byte++) if (bytes[offset + byte] !== uuidByte(id, byte)) { equal = false; break; }
      if (equal) return index;
      link = bytes.readUInt32LE(offset + LINK_OFFSET);
    }
    return undefined;
  }

  add(envelope: SourceEnvelopeV1, sequence: number): number {
    return this.insert(envelope.eventId, hash('sha256', JSON.stringify(envelope), 'buffer'), sequence, Date.parse(envelope.receivedAt));
  }

  addRetired(identity: RetiredIdentity): number {
    if (!/^[0-9a-f]{64}$/.test(identity.digest)) throw new Error('invalid-journal-identity');
    return this.insert(identity.id, Buffer.from(identity.digest, 'hex'), identity.sequence, Date.parse(identity.receivedAt));
  }

  *identities(): IterableIterator<RetiredIdentity> {
    for (let index = 0; index < this.issued; index++) if (this.live[index] === 1) yield this.retired(index);
  }

  private insert(id: string, digest: Buffer, sequence: number, receivedAt: number): number {
    if (!UUID_PATTERN.test(id)) throw new Error('invalid-journal-identity');
    if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isFinite(receivedAt)) throw new Error('invalid-journal-identity');
    if (this.count >= this.capacity || this.find(id) !== undefined) throw new Error('journal-index-limit');
    let index: number;
    if (this.freeHead) {
      index = this.freeHead - 1;
      const free = this.storage(index);
      this.freeHead = free.bytes.readUInt32LE(free.offset + LINK_OFFSET);
    } else {
      index = this.issued++;
      const chunk = Math.floor(index / CHUNK_SLOTS);
      if (!this.chunks[chunk]) this.chunks[chunk] = Buffer.alloc(Math.min(CHUNK_SLOTS, this.capacity - chunk * CHUNK_SLOTS) * SLOT_BYTES);
    }
    const {bytes, offset} = this.storage(index), bucket = this.bucket(id);
    for (let byte = 0; byte < 16; byte++) bytes[offset + byte] = uuidByte(id, byte);
    digest.copy(bytes, offset + DIGEST_OFFSET);
    bytes.writeDoubleLE(sequence, offset + SEQUENCE_OFFSET);
    bytes.writeDoubleLE(receivedAt, offset + RECEIPT_OFFSET);
    bytes.writeUInt32LE(this.buckets[bucket]!, offset + LINK_OFFSET);
    this.live[index] = 1;
    this.buckets[bucket] = index + 1;
    this.count++;
    return index;
  }

  sequence(index: number): number {
    const {bytes, offset} = this.slot(index);
    return bytes.readDoubleLE(offset + SEQUENCE_OFFSET);
  }

  receivedAt(index: number): number {
    const {bytes, offset} = this.slot(index);
    return bytes.readDoubleLE(offset + RECEIPT_OFFSET);
  }

  matches(index: number, envelope: SourceEnvelopeV1): boolean {
    const {bytes, offset} = this.slot(index);
    return bytes.subarray(offset + DIGEST_OFFSET, offset + DIGEST_OFFSET + 32).equals(hash('sha256', JSON.stringify(envelope), 'buffer'));
  }

  retired(index: number): RetiredIdentity {
    const {bytes, offset} = this.slot(index), id = bytes.toString('hex', offset, offset + 16);
    return {id: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
      digest: bytes.toString('hex', offset + DIGEST_OFFSET, offset + DIGEST_OFFSET + 32),
      sequence: bytes.readDoubleLE(offset + SEQUENCE_OFFSET), receivedAt: new Date(bytes.readDoubleLE(offset + RECEIPT_OFFSET)).toISOString()};
  }

  remove(index: number): void {
    const removed = this.slot(index), bucket = this.storedBucket(removed.bytes, removed.offset);
    let link = this.buckets[bucket]!, previous: number | undefined, visited = 0;
    while (link && link !== index + 1) {
      if (++visited > this.count) throw new Error('journal-index-corrupt');
      previous = link - 1;
      const slot = this.slot(previous);
      link = slot.bytes.readUInt32LE(slot.offset + LINK_OFFSET);
    }
    if (!link) throw new Error('journal-index-corrupt');
    const next = removed.bytes.readUInt32LE(removed.offset + LINK_OFFSET);
    if (previous === undefined) this.buckets[bucket] = next;
    else {
      const slot = this.slot(previous);
      slot.bytes.writeUInt32LE(next, slot.offset + LINK_OFFSET);
    }
    removed.bytes.fill(0, removed.offset, removed.offset + SLOT_BYTES);
    removed.bytes.writeUInt32LE(this.freeHead, removed.offset + LINK_OFFSET);
    this.freeHead = index + 1;
    this.live[index] = 0;
    this.count--;
  }
}
