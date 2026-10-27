import { excludedPath, validateExclusions } from './paths';
import type { LocalObservation } from './reducers';

export const FIXTURE_FILES = ['read.txt', 'edit.txt', 'shared.txt', 'missing.txt', 'created.txt', 'renamed.txt'] as const;
export function privacyExclusions(input: unknown): readonly string[] {
  if (!Array.isArray(input) || input.some(p => typeof p !== 'string')) throw new Error('invalid-path-exclusions');
  validateExclusions(input);
  return [...input];
}
export const permittedPath = (path: string, exclusions: readonly string[]): boolean => !excludedPath(path, exclusions);

/** Reports deliberately omit all path locators, including opaque file keys. */
export function diagnosticObservation(observation: LocalObservation): object {
  const e = observation.event;
  return { kind: observation.kind, currentPresence: observation.currentPresence, eventId: e.eventId, source: e.source,
    sourceEvent: e.sourceEvent, receivedAt: e.receivedAt, actorScope: 'unknown', environmentId: e.environmentId,
    workspaceId: e.workspaceId, ...(e.worktreeId ? { worktreeId: e.worktreeId } : {}), evidence: e.evidence, metrics: e.metrics };
}
