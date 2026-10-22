import type { EventV1, Evidence } from '../core/contracts';
import { parseEvent } from '../core/eventValidation';
import { parseSource } from '../transport/sourceValidation';
import type { SourceEnvelopeV1, SourceMetadata } from '../transport/sourceContracts';
import type { SourceJournalRecord } from '../transport/journal';
export interface CursorObservation {
  event: EventV1;
  pathHint?: string;
}
function operation(m: SourceMetadata): EventV1['operation'] {
  switch (m.sourceEvent) {
    case 'beforeReadFile': return 'read';
    case 'afterFileEdit': return 'edit';
    case 'beforeShellExecution':
    case 'afterShellExecution': return 'shell';
    case 'beforeMCPExecution':
    case 'afterMCPExecution': return 'mcp';
    case 'sessionStart':
    case 'subagentStart':
    case 'subagentStop':
    case 'stop': return 'lifecycle';
    default: return m.tool === 'task' ? 'unknown' : m.tool;
  }
}
/** Stateless source facts only. Correlation/reuse decisions belong to the
 * reducer; every normalized observation retains its own immutable identity. */
export function normalizeCursorEnvelope(input: SourceEnvelopeV1): CursorObservation | undefined {
  const source = parseSource(Buffer.from(JSON.stringify(input)));
  if (!source)
    return undefined;
  const m = source.result.metadata;
  if (m && (m.sourceVersion !== '3.26.16' || m.sourceEvent === 'sessionEnd'))
    return undefined;
  const op = m ? operation(m) : 'unknown';
  const hook = m?.sourceEvent;
  const limitations: Evidence['limitations'] = m
    ? ['model-use-not-established', 'child-identity-not-established', 'persistence-not-established', 'acceptance-not-established', 'source-session-unlinked']
    : ['transport-gap'];
  if (m && (source.result.counters.invalidFields > 0 || source.result.counters.gap))
    limitations.push('source-coverage-partial');
  const call = hook === 'afterFileEdit' ? undefined : m?.callId;
  const scopedCall = call && m?.conversationId && m.generationId && op !== 'unknown' && op !== 'lifecycle';
  const event: EventV1 = {
    schemaVersion: 1, eventId: source.eventId, collectorId: source.collectorId,
    source: m ? 'cursor-hook' : 'self-check', sourceEvent: m ? m.sourceEvent : 'transportGap', receivedAt: source.receivedAt,
    environmentId: source.environmentId, workspaceId: source.workspaceId,
    actorScope: 'unknown', operationId: source.eventId, operation: op, phase: 'observed', outcome: 'unknown', targets: [],
    evidence: { activity: m ? 'source-reported' : 'self-check', attribution: 'unknown', completion: 'not-observed', diskPersistence: 'not-observed', correlation: call ? (scopedCall ? 'source-call-id' : 'ambiguous') : 'unpaired', limitations },
  };
  if (source.worktreeId !== undefined)
    event.worktreeId = source.worktreeId;
  if (m?.sourceVersion !== undefined)
    event.sourceVersion = m.sourceVersion;
  if (m?.conversationId !== undefined)
    event.conversationId = m.conversationId;
  if (m?.generationId !== undefined)
    event.generationId = m.generationId;
  if (call)
    event.sourceCallId = call;
  if (m && !m.generationId)
    limitations.push('generation-not-established');
  if (hook === 'sessionStart') {
    event.lifecycleScope = 'conversation';
    event.phase = 'started';
  }
  if (hook === 'stop')
    event.lifecycleScope = 'generation';
  if (hook === 'subagentStart' || hook === 'subagentStop') {
    event.lifecycleScope = 'child';
    if (hook === 'subagentStart')
      event.phase = 'started';
    if (m?.subagentId && m.parentConversationId && m.conversationId) {
      event.actorScope = 'child';
      event.actorId = m.subagentId;
      event.parentActorId = m.parentConversationId;
      event.evidence.attribution = 'child';
      event.evidence.limitations = limitations.filter(code => code !== 'child-identity-not-established' && code !== 'source-session-unlinked');
    }
  }
  if (hook === 'preToolUse' || hook === 'beforeReadFile' || hook === 'beforeShellExecution' || hook === 'beforeMCPExecution')
    event.phase = 'requested';
  if (hook === 'postToolUse') {
    event.phase = 'completed';
    event.outcome = 'success';
  }
  if (hook === 'postToolUseFailure') {
    if (m?.interrupted === true) {
      event.phase = 'cancelled';
      event.outcome = 'aborted';
    }
    else {
      event.phase = 'failed';
      event.outcome = m?.failureType === 'permission_denied' ? 'denied' : 'error';
    }
  }
  if (hook === 'stop' || hook === 'subagentStop') {
    if (m?.status === 'completed') {
      event.phase = 'completed';
      event.outcome = 'success';
    }
    if (m?.status === 'error') {
      event.phase = 'failed';
      event.outcome = 'error';
    }
    if (m?.status === 'aborted') {
      event.phase = 'cancelled';
      event.outcome = 'aborted';
    }
  }
  if (event.phase === 'completed' || event.phase === 'failed' || event.phase === 'cancelled')
    event.evidence.completion = 'source-reported';
  const fileOperation = op === 'read' || op === 'edit' || op === 'delete' || op === 'search';
  const pathHint = fileOperation ? m?.pathHash : undefined;
  if (pathHint) {
    event.targets = [{ pathScope: 'unresolved', pathKind: op === 'search' ? 'unknown' : 'file' }];
    event.evidence.limitations.push('path-unresolved');
  }
  if (m?.durationMs !== undefined)
    event.metrics = { durationMs: m.durationMs };
  if (!m)
    event.metrics = { count: 1 };
  const checked = parseEvent(JSON.stringify(event));
  if (!checked.ok)
    return undefined;
  return pathHint ? { event: checked.event, pathHint } : { event: checked.event };
}
export function normalizeJournalRecord(record: SourceJournalRecord): CursorObservation | undefined {
  if (record.journalVersion !== 1 || !Number.isSafeInteger(record.ingestSequence) || record.ingestSequence < 1)
    return undefined;
  const observation = normalizeCursorEnvelope(record.envelope);
  if (!observation)
    return undefined;
  observation.event.ingestSequence = record.ingestSequence;
  const checked = parseEvent(JSON.stringify(observation.event), 'journal');
  return checked.ok ? observation : undefined;
}
