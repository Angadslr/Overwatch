import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { containsPath, excludedPath, validLocalPath, validateExclusions } from '../core/paths';
import type { EventV1 } from '../core/contracts';
import type { LocalObservation, LocalObservationKind } from '../core/reducers';
import { LocalPaths, type LocalTarget } from './localPaths';
export interface ObservationCoverage {
  state: 'off' | 'watching' | 'unavailable';
  coverage: 'partial';
  scope: 'eligible files in the fixture workspace';
  limitations: string[];
  queued: number;
  dropped: number;
  failures: number;
  excluded: number;
  coalesced: number;
  cancelled: number;
}
export interface LocalObserverHandle {
  dispose(): void;
  whenIdle(): Promise<void>;
  snapshot(): ObservationCoverage;
}
export const observationCoverage = (state: ObservationCoverage['state'] = 'off'): ObservationCoverage => ({
  state, coverage: 'partial', scope: 'eligible files in the fixture workspace',
  limitations: ['watcher notifications may coalesce or be missed', 'watch registration has no activation acknowledgment', 'no initial scan or complete disk audit', 'file-scheme buffers in the owning window only', 'current host memory only'],
  queued: 0, dropped: 0, failures: 0, excluded: 0, coalesced: 0, cancelled: 0,
});
export interface FileObservationOptions {
  root: string;
  collectorId: string;
  paths: Pick<LocalPaths, 'resolve' | 'environmentId'>;
  eligible: () => boolean;
  deliver: (observation: LocalObservation) => void;
  exclusions?: readonly string[];
  now?: () => number;
  maxPending?: number;
}
export interface LocalSignal {
  path: string;
  kind: 'disk-create' | 'disk-change' | 'disk-delete' | 'buffer-change' | 'buffer-save';
  dirty?: boolean;
}
interface Pending extends LocalSignal {
  receivedAt: string;
  count: number;
}
/** Receives only path/dirty metadata, never text documents or changed contents. */
export class FileObservations implements LocalObserverHandle {
  private readonly pending: Pending[] = [];
  private task: Promise<void> | undefined;
  private active = true;
  private readonly counters = observationCoverage('watching');
  private readonly now: () => number;
  private readonly maxPending: number;
  private readonly exclusions: readonly string[];
  constructor(private readonly options: FileObservationOptions) {
    this.now = options.now ?? Date.now;
    this.maxPending = options.maxPending ?? 256;
    validateExclusions(options.exclusions ?? []);
    this.exclusions = Object.freeze([...(options.exclusions ?? [])]);
    if (!Number.isInteger(this.maxPending) || this.maxPending < 1 || this.maxPending > 1024 || !validLocalPath(options.root) || !isAbsolute(options.root))
      throw new Error('invalid-observation-options');
  }
  enqueue(signal: LocalSignal): boolean {
    if (!this.active || !this.options.eligible())
      return false;
    if (!['disk-create', 'disk-change', 'disk-delete', 'buffer-change', 'buffer-save'].includes(signal.kind) || !validLocalPath(signal.path) || !isAbsolute(signal.path) ||
      (signal.kind === 'buffer-change' && typeof signal.dirty !== 'boolean')) {
      this.counters.failures++;
      return false;
    }
    const path = resolve(signal.path);
    if (!containsPath(this.options.root, path) || path === this.options.root) {
      this.counters.excluded++;
      return false;
    }
    const local = relative(this.options.root, path);
    if (local === '.overwatch-probe-fixture' || excludedPath(local, this.exclusions)) {
      this.counters.excluded++;
      return false;
    }
    const last = this.pending[this.pending.length - 1];
    if (last && last.path === path && last.kind === signal.kind && last.dirty === signal.dirty) {
      last.count = Math.min(last.count + 1, 100000);
      last.receivedAt = new Date(this.now()).toISOString();
      this.counters.coalesced++;
      return true;
    }
    if (this.pending.length >= this.maxPending) {
      this.counters.dropped++;
      return false;
    }
    this.pending.push({ path, kind: signal.kind, ...(signal.dirty === undefined ? {} : { dirty: signal.dirty }), receivedAt: new Date(this.now()).toISOString(), count: 1 });
    this.kick();
    return true;
  }
  private kick(): void {
    if (this.task || !this.active || !this.pending.length)
      return;
    this.task = this.consume().finally(() => { this.task = undefined; if (this.active)
      this.kick(); });
  }
  private async consume(): Promise<void> {
    while (this.active && this.pending.length) {
      const signal = this.pending.shift()!;
      try {
        if (!this.options.eligible()) {
          this.counters.cancelled += this.pending.length + 1;
          this.pending.length = 0;
          return;
        }
        const result = await this.options.paths.resolve(signal.path);
        if (!this.active || !this.options.eligible()) {
          this.counters.cancelled++;
          continue;
        }
        if (!result.ok) {
          if (result.reason === 'excluded' || result.reason === 'external')
            this.counters.excluded++;
          else
            this.counters.failures++;
          continue;
        }
        if (result.existence === 'existing' && result.target.pathKind !== 'file')
          continue;
        if (result.root.path !== this.options.root || !containsPath(this.options.root, result.path)) {
          this.counters.failures++;
          continue;
        }
        if (result.relativePath === '.overwatch-probe-fixture' || excludedPath(result.relativePath, this.exclusions)) {
          this.counters.excluded++;
          continue;
        }
        const observation = this.project(signal, result);
        this.options.deliver(observation);
      }
      catch {
        this.counters.failures++;
      }
    }
  }
  private project(signal: Pending, result: Extract<LocalTarget, {
    ok: true;
  }>): LocalObservation {
    const disk = signal.kind.startsWith('disk-');
    const kind: LocalObservationKind = signal.kind === 'buffer-save' ? 'editor-save' : signal.kind === 'buffer-change' ? signal.dirty ? 'buffer-dirty' : 'buffer-change'
      : signal.kind === 'disk-create' ? 'disk-create-notification' : signal.kind === 'disk-delete' ? 'disk-delete-notification' : 'disk-change-notification';
    const eventId = randomUUID();
    const event: EventV1 = {
      schemaVersion: 1, eventId, collectorId: this.options.collectorId, environmentId: this.options.paths.environmentId,
      workspaceId: result.root.workspaceId, ...(result.root.worktreeId === undefined ? {} : { worktreeId: result.root.worktreeId }),
      source: disk ? 'filesystem' : 'editor-buffer', sourceEvent: disk ? 'fileChanged' : signal.kind === 'buffer-save' ? 'bufferSaved' : 'bufferChanged',
      receivedAt: signal.receivedAt, actorScope: 'unknown', operationId: eventId, operation: 'unknown', phase: 'observed', outcome: 'unknown',
      // A safe missing locator can be displayed, but never gains a physical key.
      targets: [{ ...result.target, relativePath: result.relativePath }],
      evidence: { activity: disk ? 'filesystem-observed' : 'buffer-observed', attribution: 'unknown', completion: 'not-observed',
        diskPersistence: disk || signal.kind === 'buffer-save' ? 'unknown' : 'not-observed', correlation: 'unpaired',
        limitations: ['persistence-not-established', 'acceptance-not-established', 'source-coverage-partial', ...(result.existence === 'missing' ? ['path-unresolved' as const] : [])] },
      metrics: { count: signal.count },
    };
    return { event, kind, currentPresence: result.existence === 'existing' ? 'file' : 'missing' };
  }
  dispose(): void {
    if (!this.active)
      return;
    this.active = false;
    this.counters.cancelled += this.pending.length;
    this.pending.length = 0;
    this.counters.state = 'off';
  }
  noteFailure(): void { this.counters.failures++; }
  noteDrop(): void { this.counters.dropped++; }
  async whenIdle(): Promise<void> { while (this.task)
    await this.task; }
  snapshot(): ObservationCoverage { return { ...this.counters, queued: this.pending.length + (this.task ? 1 : 0), limitations: [...this.counters.limitations] }; }
}
