import Ajv from 'ajv';
import schema from '../../schemas/source-envelope-v1.schema.json';
import type { SourceEnvelopeV1 } from './sourceContracts';
import type {SourceJournalRecord} from './journal';
import {internDataStrings} from '../core/stringPool';
export const MAX_SOURCE_BYTES = 16 * 1024;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const OPAQUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ajv = new Ajv({ strict: true, strictRequired: false });
ajv.addFormat('overwatch-utc', { type: 'string', validate: (s: string) => {
    const t = Date.parse(s);
    return Number.isFinite(t) && new Date(t).toISOString() === s;
  } });
const validate = ajv.compile<SourceEnvelopeV1>(schema);
const snapshots = new WeakSet<object>();
const stringPools = new WeakMap<object, Map<string, string>>();
const decoder = new TextDecoder('utf-8', {fatal: true});
function ownSnapshot(source: SourceEnvelopeV1, strings?: Map<string, string>): SourceEnvelopeV1 {
  const freeze = (value: object): void => {
    for (const child of Object.values(value)) if (child !== null && typeof child === 'object') freeze(child);
    Object.freeze(value);
  };
  if (strings) {internDataStrings(source, strings);stringPools.set(source, strings);}
  freeze(source);snapshots.add(source);return source;
}
export const snapshotStringPool = (source: SourceEnvelopeV1): Map<string, string> | undefined => stringPools.get(source);
export function validateSource(value: unknown): SourceEnvelopeV1 | undefined {
  if (!validate(value)) return undefined;
  if (value.result.metadata && (value.eventId !== value.result.metadata.eventId || value.receivedAt !== value.result.metadata.receivedAt)) return undefined;
  return value;
}
export function parseSource(bytes: Uint8Array): SourceEnvelopeV1 | undefined {
  if (bytes.byteLength > MAX_SOURCE_BYTES)
    return undefined;
  try {
    const value = validateSource(JSON.parse(decoder.decode(bytes)));
    return value ? ownSnapshot(value) : undefined;
  }
  catch {
    return undefined;
  }
}
/** Only detached records parsed in this module can skip another wire copy. */
export function snapshotSource(input: SourceEnvelopeV1): SourceEnvelopeV1 | undefined {
  if (snapshots.has(input)) return input;
  try { return parseSource(Buffer.from(JSON.stringify(input))); } catch { return undefined; }
}
/** Journal hydration owns its parsed objects. Cold index validation deliberately
 * does not snapshot every old payload that will immediately be discarded. */
export function parseJournalSnapshot(bytes: Uint8Array, strings?: Map<string, string>): SourceJournalRecord | undefined {
  if (bytes.byteLength > MAX_SOURCE_BYTES + 256) return undefined;
  try {
    const record = JSON.parse(decoder.decode(bytes)) as SourceJournalRecord;
    if (!record || typeof record !== 'object' || Array.isArray(record) || record.journalVersion !== 1 ||
        !Number.isSafeInteger(record.ingestSequence) || record.ingestSequence < 1 ||
        Object.keys(record).sort().join(',') !== 'envelope,ingestSequence,journalVersion') return undefined;
    const source = validateSource(record.envelope);
    if (!source || (bytes.byteLength > MAX_SOURCE_BYTES && Buffer.byteLength(JSON.stringify(source)) > MAX_SOURCE_BYTES)) return undefined;
    ownSnapshot(source, strings);return record;
  } catch { return undefined; }
}
