import type { EventV1 } from './contracts';
import { parseEvent } from './eventValidation';
import { identityNamespace, conversationKey } from './identity';
import type { FileObservation, OperationActivity } from './reducers';
import { excludedPath, validateExclusions } from './paths';

export const OVERLAP_WINDOW_MS = 30000;
export type AdvisoryCategory = 'concurrent-edits' | 'recent-edits' | 'possible-stale-context';
export interface OverlapAdvisory {
  id: string;
  conditionKey: string;
  category: AdvisoryCategory;
  severity: 'high' | 'medium' | 'information';
  fileIdentity: string;
  relativePath?: string;
  conversations: string[];
  eventIds: string[];
  operationKeys: string[];
  windowStart: string;
  windowEnd: string;
  explanation: string;
  limitations: string[];
}
interface Fact { event: EventV1; operation: OperationActivity; file: string; conversation: string; start?: number; end?: number; causeIds?: string[] }
export interface OverlapResult { advisories: OverlapAdvisory[]; unqualifiedFileEvents: number; omittedAdvisories: number; truncatedFileEvents: number }
const sourceTime = (e: EventV1): number | undefined => e.sourceOccurredAt === undefined ? undefined : Date.parse(e.sourceOccurredAt);
const successful = (e: EventV1): boolean => e.phase === 'completed' && e.outcome === 'success' && e.evidence.completion === 'source-reported';

/** No filename/time/ambient-actor joins. Physical identity and conversation
 * attribution must already be established by the adapter's measured evidence. */
export function overlapAdvisories(observations: readonly FileObservation[], operations: readonly OperationActivity[], now: number, windowMs = OVERLAP_WINDOW_MS, exclusions: readonly string[] = []): OverlapResult {
  validateExclusions(exclusions);
  if (!Number.isFinite(now) || !Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > 86400000 || observations.length > 10000) throw new Error('invalid-overlap-input');
  const byEvent = new Map<string, OperationActivity[]>();
  for (const operation of operations) for (const id of operation.eventIds) {
    const list = byEvent.get(id) ?? []; list.push(operation); byEvent.set(id, list);
  }
  const seen = new Map<string, EventV1>(), conflicts = new Set<string>();
  let unqualifiedFileEvents = 0, truncatedFileEvents = 0;
  for (const observation of observations) {
    const e = observation.event, key = JSON.stringify([...identityNamespace(e), e.eventId]);
    if (seen.has(key) && JSON.stringify(seen.get(key)) !== JSON.stringify(e)) conflicts.add(key);
    else seen.set(key, e);
  }
  const groups = new Map<string, Fact[]>();
  for (const [key, candidate] of seen) {
    const e = candidate;
    if (conflicts.has(key) || !['read', 'edit'].includes(e.operation)) continue;
    const target = e.targets.length === 1 ? e.targets[0] : undefined;
    if (e.source !== 'cursor-hook' || e.actorScope !== 'conversation' || e.evidence.attribution !== 'conversation' || !e.conversationId ||
      e.evidence.limitations.some(l => ['source-session-unlinked', 'call-id-reused'].includes(l)) || target?.pathScope !== 'workspace' || target.pathKind !== 'file' || !target.fileKey ||
      (target.relativePath ? excludedPath(target.relativePath, exclusions) : exclusions.length > 0)) {
      unqualifiedFileEvents++; continue;
    }
    if (!parseEvent(JSON.stringify(e), e.ingestSequence === undefined ? 'spool' : 'journal').ok) continue;
    const file = JSON.stringify([...identityNamespace(e), 'physical', target.fileKey]);
    const operation = byEvent.get(e.eventId)?.find(o => o.fileIdentities.includes(file));
    if (!operation || operation.state === 'ambiguous' || operation.outcome === 'error' || operation.outcome === 'denied' || operation.outcome === 'aborted' || e.evidence.correlation === 'ambiguous') continue;
    const fact: Fact = { event: e, operation, file, conversation: conversationKey(e, e.conversationId) };
    const group = groups.get(file) ?? [];
    if (group.length >= 256) { truncatedFileEvents++; continue; }
    group.push(fact); groups.set(file, group);
  }
  const advisories: OverlapAdvisory[] = [];
  const make = (category: AdvisoryCategory, facts: Fact[], explanation: string): void => {
    const conversations = [...new Set(facts.map(f => f.conversation))].sort();
    const receipts = facts.map(f => f.event.receivedAt).sort(), first = facts[0]!;
    const conditionKey = JSON.stringify([category, first.file, conversations]);
    const eventIds = [...new Set(facts.flatMap(f => f.causeIds ?? [f.event.eventId]))].sort();
    advisories.push({ id: JSON.stringify([conditionKey, receipts[0], eventIds[0]]), conditionKey, category,
      severity: category === 'concurrent-edits' ? 'high' : category === 'recent-edits' ? 'medium' : 'information', fileIdentity: first.file,
      ...(first.event.targets[0]?.relativePath ? { relativePath: first.event.targets[0].relativePath } : {}), conversations, eventIds,
      operationKeys: [...new Set(facts.map(f => f.operation.key))].sort(), windowStart: receipts[0]!, windowEnd: receipts.at(-1)!, explanation,
      limitations: ['Advisory, not a confirmed conflict or file lock.', 'Saved bytes, model context and human acceptance remain unverified.'] });
  };
  for (const facts of groups.values()) {
    const opGroups = new Map<string, Fact[]>();
    for (const fact of facts) { const group = opGroups.get(fact.operation.key) ?? []; group.push(fact); opGroups.set(fact.operation.key, group); }
    const edits: Fact[] = [], reads: Fact[] = [];
    for (const group of opGroups.values()) {
      const reports = group.filter(f => f.event.operation === 'edit' && (successful(f.event) || (f.event.sourceEvent === 'afterFileEdit' && f.event.phase === 'observed')));
      const latest = reports.sort((a, b) => a.event.receivedAt.localeCompare(b.event.receivedAt)).at(-1);
      if (latest && Date.parse(latest.event.receivedAt) <= now && now - Date.parse(latest.event.receivedAt) <= windowMs) {
        const starts = group.filter(f => f.event.phase === 'started' && sourceTime(f.event) !== undefined);
        const terminal = group.find(f => successful(f.event) && sourceTime(f.event) !== undefined);
        if (starts.length === 1 && terminal) {
          const start = sourceTime(starts[0]!.event)!, end = sourceTime(terminal.event)!;
          if (start < end && end <= now && now - end <= windowMs) { latest.start = start; latest.end = end; latest.causeIds = group.map(f => f.event.eventId); }
        }
        edits.push(latest);
      }
      for (const fact of group) if (fact.event.operation === 'read' && successful(fact.event) && sourceTime(fact.event) !== undefined) reads.push(fact);
    }
    const actors = new Set<string>();
    for (let index = edits.length - 1; index >= 0; index--) {
      const fact = edits[index]!;
      if (!actors.has(fact.conversation) && actors.size >= 8) { edits.splice(index, 1); truncatedFileEvents++; }
      else actors.add(fact.conversation);
    }
    if (actors.size < 2) continue;
    const intervals = edits.filter(f => f.start !== undefined && f.end !== undefined);
    let concurrent: Fact[] | undefined;
    for (let i = 0; i < intervals.length && !concurrent; i++) for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i]!, b = intervals[j]!;
      if (a.conversation !== b.conversation && Math.max(a.start!, b.start!) < Math.min(a.end!, b.end!)) { concurrent = [a, b]; break; }
    }
    if (concurrent) make('concurrent-edits', concurrent, 'Two proven conversation-scoped edit intervals overlap on the same physical file, using explicit source start/end timestamps.');
    else make('recent-edits', edits, `Distinct proven conversations reported edits to the same physical file within a ${windowMs / 1000}-second receipt window; concurrent execution is not established.`);
    let stale: Fact[] | undefined;
    for (const original of intervals) {
      const intervening = intervals.find(other => other.conversation !== original.conversation && other.end! < original.start! && successful(other.event));
      if (!intervening) continue;
      const read = reads.find(r => r.conversation === original.conversation && sourceTime(r.event)! < intervening.start!);
      if (read) { stale = [read, intervening, original]; break; }
    }
    if (stale) make('possible-stale-context', stale, 'A successful read predates another conversation’s completed edit, followed by the original conversation’s edit start. Explicit source timestamps establish this order; a stale byte baseline is not proven.');
  }
  advisories.sort((a, b) => a.conditionKey.localeCompare(b.conditionKey));
  return { advisories: advisories.slice(0, 200), unqualifiedFileEvents, omittedAdvisories: Math.max(0, advisories.length - 200), truncatedFileEvents };
}
