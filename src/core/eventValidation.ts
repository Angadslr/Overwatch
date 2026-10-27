import Ajv from 'ajv';
import schema from '../../schemas/event-v1.schema.json';
import { MAX_EVENT_BYTES, type EventV1 } from './contracts';

const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: false });
// The annotation is enforced on UTF-8 bytes before parsing, not on JS string length.
ajv.addKeyword({ keyword: 'x-maxUtf8Bytes', schemaType: 'number', valid: true });
ajv.addFormat('overwatch-utc', {
  type: 'string',
  validate: (value: string): boolean => {
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === value;
  },
});
const validate = ajv.compile<EventV1>(schema);
const encoder = new TextEncoder();

export type EventStage = 'spool' | 'journal';
export type EventResult =
  | { ok: true; event: EventV1 }
  | { ok: false; reason: 'too-large' | 'malformed-json' | 'invalid-event' | 'invalid-stage' };

/** Strict wire boundary: extras are rejected and diagnostics never include input values. */
export function parseEvent(json: string, stage: EventStage = 'spool'): EventResult {
  if (json.length > MAX_EVENT_BYTES || encoder.encode(json).byteLength > MAX_EVENT_BYTES) {
    return { ok: false, reason: 'too-large' };
  }
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { return { ok: false, reason: 'malformed-json' }; }
  if (!validate(value)) return { ok: false, reason: 'invalid-event' };
  if ((stage === 'spool' && value.ingestSequence !== undefined) ||
      (stage === 'journal' && value.ingestSequence === undefined)) {
    return { ok: false, reason: 'invalid-stage' };
  }
  return { ok: true, event: value };
}

const snapshots = new WeakSet<object>();
function freezeSnapshot(value: object): void {
  for (const child of Object.values(value)) if (child !== null && typeof child === 'object') freezeSnapshot(child);
  Object.freeze(value);
}

/** Validate and detach caller-owned data once. Only snapshots created here are
 * shared: a frozen caller object alone is never evidence of prior validation. */
export function snapshotEvent(input: EventV1, stage: EventStage = 'spool'): EventResult {
  if (snapshots.has(input)) {
    if ((stage === 'spool' && input.ingestSequence !== undefined) ||
        (stage === 'journal' && input.ingestSequence === undefined)) {
      return { ok: false, reason: 'invalid-stage' };
    }
    return { ok: true, event: input };
  }
  let checked: EventResult;
  try { checked = parseEvent(JSON.stringify(input), stage); }
  catch { return { ok: false, reason: 'invalid-event' }; }
  if (!checked.ok) return checked;
  freezeSnapshot(checked.event);
  snapshots.add(checked.event);
  return checked;
}

interface ProjectionShape {
  $ref?: string;
  type?: string;
  properties?: Record<string, ProjectionShape>;
  items?: ProjectionShape;
  maxItems?: number;
  maxLength?: number;
}
const definitions = schema.definitions as Record<string, ProjectionShape>;

function project(value: unknown, shape: ProjectionShape): unknown {
  if (shape.$ref) {
    const definition = definitions[shape.$ref.replace('#/definitions/', '')];
    if (!definition) throw new Error('invalid-shape');
    return project(value, definition);
  }
  if (shape.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid-object');
    const projected: Record<string, unknown> = {};
    // Iterate schema keys, never arbitrary source fields or their getters.
    for (const [key, child] of Object.entries(shape.properties ?? {})) {
      if (Object.hasOwn(value, key)) projected[key] = project((value as Record<string, unknown>)[key], child);
    }
    return projected;
  }
  if (shape.type === 'array') {
    if (!Array.isArray(value) || !shape.items || value.length > (shape.maxItems ?? 0)) throw new Error('invalid-array');
    const items = shape.items;
    return value.map(item => project(item, items));
  }
  if (shape.type === 'string') {
    if (typeof value !== 'string' || (shape.maxLength !== undefined && value.length > shape.maxLength * 2)) throw new Error('invalid-string');
  } else if (shape.type === 'integer' || shape.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('invalid-number');
  } else if (shape.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error('invalid-boolean');
  } else throw new Error('invalid-shape');
  return value;
}

/** Copy only normalized contract fields; Cursor-to-contract mapping belongs to T07. */
export function projectEventCandidate(candidate: unknown, stage: EventStage = 'spool'): EventResult {
  try {
    return parseEvent(JSON.stringify(project(candidate, schema as ProjectionShape)), stage);
  } catch {
    return { ok: false, reason: 'invalid-event' };
  }
}
