import type { EventV1 } from './contracts';
import { parseEvent } from './eventValidation';
export interface FileObservation {
  event: EventV1;
  pathHint?: string;
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
}
const MAX_DETAILS = 10000;
const MAX_IDENTITIES = 100000;
const namespace = (e: EventV1): unknown[] => [e.collectorId, e.environmentId, e.workspaceId, e.worktreeId ?? null];
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
  private readonly seen = new Set<string>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly retired = new Set<string>();
  private detailCount = 0;
  coverageDropped = 0;
  transportGaps = 0;
  apply(observation: FileObservation): boolean {
    const json = JSON.stringify(observation.event);
    const checked = parseEvent(json, observation.event.ingestSequence === undefined ? 'spool' : 'journal');
    if (!checked.ok || (observation.pathHint !== undefined && !/^[0-9a-f]{64}$/.test(observation.pathHint)))
      throw new Error('invalid-file-observation');
    const e = checked.event;
    // Event identity is installation/workspace scoped even for synthetic input.
    const identity = JSON.stringify([...namespace(e), e.eventId]);
    if (this.seen.has(identity))
      return false;
    if (this.seen.size >= MAX_IDENTITIES) {
      this.coverageDropped++;
      return false;
    }
    this.seen.add(identity);
    if (e.sourceEvent === 'transportGap') {
      this.transportGaps++;
      return true;
    }
    if (!['read', 'edit', 'delete', 'search'].includes(e.operation))
      return true;
    const fact: FileObservation = observation.pathHint === undefined ? { event: e } : { event: e, pathHint: observation.pathHint };
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
      e.evidence.correlation = 'ambiguous';
      if (!e.evidence.limitations.includes('call-id-reused'))
        e.evidence.limitations.push('call-id-reused');
    }
    if (!bucket) {
      bucket = { facts: [] };
      this.buckets.set(key, bucket);
    }
    bucket.facts.push(fact);
    this.detailCount++;
    return true;
  }
  snapshot(): {
    operations: OperationActivity[];
    files: FileActivity[];
    coverageDropped: number;
    transportGaps: number;
  } {
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
      const state: OperationActivity['state'] = ambiguous ? 'ambiguous' : terminal?.event.phase ?? (hasStart ? 'requested' : 'observed');
      operations.push({ key, operation: first.event.operation, eventIds: facts.map(o => o.event.eventId), state, outcome: ambiguous ? 'unknown' : terminal?.event.outcome ?? 'unknown', hasStart, hasTerminal, missingStart: hasTerminal && !hasStart, missingCompletion: hasStart && !hasTerminal, fileIdentities: [...identities.keys()] });
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
