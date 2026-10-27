import Ajv from 'ajv';
import schema from '../../schemas/source-envelope-v1.schema.json';
import type { SourceEnvelopeV1 } from './sourceContracts';
export const MAX_SOURCE_BYTES = 16 * 1024;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const OPAQUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ajv = new Ajv({ strict: true, strictRequired: false });
ajv.addFormat('overwatch-utc', { type: 'string', validate: (s: string) => {
    const t = Date.parse(s);
    return Number.isFinite(t) && new Date(t).toISOString() === s;
  } });
const validate = ajv.compile<SourceEnvelopeV1>(schema);
export function validateSource(value: unknown): SourceEnvelopeV1 | undefined {
  if (!validate(value)) return undefined;
  if (value.result.metadata && (value.eventId !== value.result.metadata.eventId || value.receivedAt !== value.result.metadata.receivedAt)) return undefined;
  return value;
}
export function parseSource(bytes: Uint8Array): SourceEnvelopeV1 | undefined {
  if (bytes.byteLength > MAX_SOURCE_BYTES)
    return undefined;
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return validateSource(value);
  }
  catch {
    return undefined;
  }
}
