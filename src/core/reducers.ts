import type { EventV1 } from './contracts';
import { parseEvent, snapshotEvent } from './eventValidation';
import { identityNamespace as namespace } from './identity';
import type { DeliveryOrigin } from './lifecycle';
import { excludedPath, validRelativePath } from './paths';
import {ScopedEventSet} from './scopedEvents';
export interface FileObservation {
  event: EventV1;
  pathHint?: string;
}
export type LocalObservationKind = 'disk-create-notification' | 'disk-change-notification' | 'disk-delete-notification' | 'buffer-dirty' | 'buffer-change' | 'editor-save';
export interface LocalObservation {
  event: EventV1;
  kind: LocalObservationKind;
  currentPresence: 'file' | 'missing';
}
export const localObservationKey = (event: EventV1): string => JSON.stringify([...namespace(event), event.eventId]);

/** Independent ambient facts, never joined to an agent operation or recent actor. */
export class LocalObservationStore {
  private readonly seen = new ScopedEventSet();
  private readonly records = new Map<string, LocalObservation>();
  revision = 0;
  coverageDropped = 0;
  clear():void{this.seen.clear();this.records.clear();this.coverageDropped=0;this.revision++;}
  restrict(exclusions: readonly string[]): void {
    for (const [key, record] of this.records) if (excludedPath(record.event.targets[0]!.relativePath!, exclusions)) this.records.delete(key);
    this.revision++;
  }
  apply(input: LocalObservation): boolean {
    const checked = parseEvent(JSON.stringify(input.event));
    const disk = typeof input.kind === 'string' && input.kind.startsWith('disk-');
    const expected = disk ? 'fileChanged' : input.kind === 'editor-save' ? 'bufferSaved' : 'bufferChanged';
    if (!checked.ok || !['disk-create-notification', 'disk-change-notification', 'disk-delete-notification', 'buffer-dirty', 'buffer-change', 'editor-save'].includes(input.kind) ||
      !['file', 'missing'].includes(input.currentPresence)) throw new Error('invalid-local-observation');
    const event = checked.event;
    if (event.source !== (disk ? 'filesystem' : 'editor-buffer') || event.sourceEvent !== expected || event.actorScope !== 'unknown' ||
      event.conversationId !== undefined || event.generationId !== undefined || event.sourceCallId !== undefined || event.actorId !== undefined || event.parentActorId !== undefined ||
      event.phase !== 'observed' || event.outcome !== 'unknown' || event.operation !== 'unknown' || event.evidence.attribution !== 'unknown' ||
      event.evidence.correlation !== 'unpaired' || event.evidence.completion !== 'not-observed' || event.evidence.diskPersistence === 'observed' ||
      event.targets.length !== 1 || !event.targets[0]?.relativePath || !validRelativePath(event.targets[0].relativePath) || excludedPath(event.targets[0].relativePath) || event.targets[0].renameDestination !== undefined ||
      (input.currentPresence === 'file' && (event.targets[0].pathScope !== 'workspace' || event.targets[0].pathKind !== 'file')) ||
      (input.currentPresence === 'missing' && (event.targets[0].pathScope !== 'unresolved' || event.targets[0].fileKey !== undefined)))
      throw new Error('invalid-local-observation');
    const identity = localObservationKey(event);
    if (this.seen.has(event)) return false;
    if (this.seen.size >= 100000) { this.coverageDropped++; this.revision++; return false; }
    this.seen.add(event);
    const record = { event, kind: input.kind, currentPresence: input.currentPresence };
    this.records.set(identity, record);
    while (this.records.size > 2000) { this.records.delete(this.records.keys().next().value!); this.coverageDropped++; }
    this.revision++;
    return true;
  }
  get(key: string): LocalObservation | undefined {
    const record = this.records.get(key);
    return record ? JSON.parse(JSON.stringify(record)) as LocalObservation : undefined;
  }
  snapshot(): { records: LocalObservation[]; coverageDropped: number } {
    return { records: [...this.records.values()].map(r => JSON.parse(JSON.stringify(r)) as LocalObservation), coverageDropped: this.coverageDropped };
  }
}
export interface OperationActivity {
  key: string;
  operation: EventV1['operation'];
  eventIds: string[];
  state: EventV1['phase'] | 'ambiguous';
  outcome: EventV1['outcome'];
  hasStart: boolean;
  hasTerminal: boolean;
  missingStart: boolean;
  missingCompletion: boolean;
  fileIdentities: string[];
  liveState: 'recent-request' | 'completion-not-observed' | 'unknown-after-reload' | 'terminal' | 'observed' | 'ambiguous';
  lastReceivedAt: string;
}
export interface FileActivity {
  identity: string;
  identityKind: 'physical' | 'source-hint';
  relativePath?: string;
  attempts: number;
  completedReads: number;
  completedEditTools: number;
  editReports: number;
  failed: number;
  cancelled: number;
  ambiguousObservations: number;
  diskPersistence: 'unknown';
  acceptance: 'unknown';
}
interface Bucket {
  facts: FileObservation[];
  liveStateUnknown: boolean;
}
const MAX_DETAILS = 10000;
const MAX_IDENTITIES = 100000;
function keyOf(o: FileObservation): string {
  const e = o.event;
  return e.evidence.correlation === 'source-call-id' && e.sourceCallId && e.conversationId && e.generationId
    ? JSON.stringify([...namespace(e), e.conversationId, e.generationId, e.operation, e.sourceCallId])
    : JSON.stringify([...namespace(e), 'observation', e.eventId]);
}
function filesOf(o: FileObservation): Array<{
  identity: string;
  identityKind: 'physical' | 'source-hint';
  relativePath?: string;
}> {
  const physical = o.event.targets.filter(t => t.pathScope === 'workspace' && t.fileKey).map(t => ({ identity: JSON.stringify([...namespace(o.event), 'physical', t.fileKey]), identityKind: 'physical' as const, ...(t.relativePath === undefined ? {} : { relativePath: t.relativePath }) }));
  if (physical.length)
    return physical;
  return o.pathHint ? [{ identity: JSON.stringify([...namespace(o.event), 'source-hint', o.pathHint]), identityKind: 'source-hint' }] : [];
}
/** Bounded replayable file evidence. No time/model/PID heuristics, editor imports,
 * or filesystem claims. Evicting old detail drops its pairing bucket as a whole. */
export class FileActivityStore {
  private readonly seen = new ScopedEventSet();
  private readonly buckets = new Map<string, Bucket>();
  private readonly retired = new Set<string>();
  private detailCount = 0;
  coverageDropped = 0;
  transportGaps = 0;
  constructor(private readonly now: () => number = Date.now, private readonly completionAgeMs = 30000) {
    if (!Number.isFinite(completionAgeMs) || completionAgeMs < 1) throw new Error('invalid-completion-age');
  }
  markLiveStateUnknown(): void {
    for (const bucket of this.buckets.values()) bucket.liveStateUnknown = true;
  }
  clear(): void {
    this.seen.clear(); this.buckets.clear(); this.retired.clear(); this.detailCount = 0;
    this.coverageDropped = 0; this.transportGaps = 0;
  }
  apply(observation: FileObservation, origin: DeliveryOrigin = 'live'): boolean {
    const checked = snapshotEvent(observation.event, observation.event.ingestSequence === undefined ? 'spool' : 'journal');
    if (!checked.ok || (observation.pathHint !== undefined && !/^[0-9a-f]{64}$/.test(observation.pathHint)))
      throw new Error('invalid-file-observation');
    const e = checked.event;
    // Event identity is installation/workspace scoped even for synthetic input.
    if (this.seen.has(e))
      return false;
    if (this.seen.size >= MAX_IDENTITIES) {
      this.coverageDropped++;
      return false;
    }
    this.seen.add(e);
    if (e.sourceEvent === 'transportGap') {
      this.transportGaps++;
      return true;
    }
    if (!['read', 'edit', 'delete', 'search', 'shell', 'mcp'].includes(e.operation))
      return true;
    let fact: FileObservation = observation.pathHint === undefined ? { event: e } : { event: e, pathHint: observation.pathHint };
    const key = keyOf(fact);
    let bucket = this.buckets.get(key);
    // At the detail bound, remove the whole oldest group. Its IDs remain seen
    // so replayed duplicate delivery cannot resurrect an apparent new action.
    while (this.detailCount >= MAX_DETAILS) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (oldest === undefined)
        break;
      const removed = this.buckets.get(oldest)!;
      this.detailCount -= removed.facts.length;
      this.coverageDropped += removed.facts.length;
      this.buckets.delete(oldest);
      this.retired.add(oldest);
      if (oldest === key)
        bucket = undefined;
    }
    if (this.retired.has(key) && e.sourceCallId) {
      const limitations = [...e.evidence.limitations];
      if (!limitations.includes('call-id-reused')) limitations.push('call-id-reused');
      fact = { ...fact, event: { ...e, evidence: { ...e.evidence, correlation: 'ambiguous', limitations } } };
    }
    if (!bucket) {
      bucket = { facts: [], liveStateUnknown: origin === 'replay' };
      this.buckets.set(key, bucket);
    }
    bucket.facts.push(fact);
    if (origin === 'replay') bucket.liveStateUnknown = true;
    this.detailCount++;
    return true;
  }
  snapshot(): {
    operations: OperationActivity[];
    files: FileActivity[];
    coverageDropped: number;
    transportGaps: number;
  } {
    const now = this.now();
    const operations: OperationActivity[] = [];
    const files = new Map<string, FileActivity>();
    for (const [key, bucket] of this.buckets) {
      const facts = bucket.facts, first = facts[0]!;
      const byHook = new Map<string, number>();
      const terminals = facts.filter(o => ['completed', 'failed', 'cancelled'].includes(o.event.phase));
      const starts = facts.filter(o => o.event.phase === 'requested' || o.event.phase === 'started');
      for (const o of facts)
        byHook.set(o.event.sourceEvent, (byHook.get(o.event.sourceEvent) ?? 0) + 1);
      const identities = new Map(facts.flatMap(filesOf).map(f => [f.identity, f]));
      // Source-call reuse, contradictory terminal reports or conflicting target
      // hints invalidate pairing. Retain all observations and expose ambiguity.
      const ambiguous = facts.some(o => o.event.evidence.correlation === 'ambiguous') ||
        [...byHook.values()].some(count => count > 1) || terminals.length > 1 || identities.size > 1;
      const terminal = terminals[0];
      const hasStart = starts.length > 0, hasTerminal = terminals.length > 0;
      const pending = starts.some(o => o.event.phase === 'started') ? 'started' : 'requested';
      const state: OperationActivity['state'] = ambiguous ? 'ambiguous' : terminal?.event.phase ?? (hasStart ? pending : 'observed');
      const firstStart = starts.length ? Math.min(...starts.map(o => Date.parse(o.event.receivedAt))) : undefined;
      const liveState: OperationActivity['liveState'] = ambiguous ? 'ambiguous' : hasTerminal ? 'terminal' : !hasStart ? 'observed'
        : bucket.liveStateUnknown ? 'unknown-after-reload' : firstStart !== undefined && now - firstStart >= this.completionAgeMs
          ? 'completion-not-observed' : 'recent-request';
      const lastReceivedAt = facts.reduce((latest, o) => o.event.receivedAt > latest ? o.event.receivedAt : latest, first.event.receivedAt);
      operations.push({ key, operation: first.event.operation, eventIds: facts.map(o => o.event.eventId), state, outcome: ambiguous ? 'unknown' : terminal?.event.outcome ?? 'unknown', hasStart, hasTerminal, missingStart: hasTerminal && !hasStart, missingCompletion: hasStart && !hasTerminal, fileIdentities: [...identities.keys()], liveState, lastReceivedAt });
      for (const [identity, description] of identities) {
        let file = files.get(identity);
        if (!file) {
          file = { ...description, attempts: 0, completedReads: 0, completedEditTools: 0, editReports: 0, failed: 0, cancelled: 0, ambiguousObservations: 0, diskPersistence: 'unknown', acceptance: 'unknown' };
          files.set(identity, file);
        }
        if (ambiguous) {
          file.ambiguousObservations += facts.length;
          continue;
        }
        if (hasStart)
          file.attempts++;
        if (state === 'completed' && first.event.operation === 'read')
          file.completedReads++;
        if (state === 'completed' && first.event.operation === 'edit')
          file.completedEditTools++;
        if (state === 'failed')
          file.failed++;
        if (state === 'cancelled')
          file.cancelled++;
        file.editReports += facts.filter(o => o.event.sourceEvent === 'afterFileEdit').length;
      }
    }
    return { operations, files: [...files.values()], coverageDropped: this.coverageDropped, transportGaps: this.transportGaps };
  }
}
