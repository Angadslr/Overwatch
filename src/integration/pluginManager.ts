import { access, lstat, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { assertFixtureRoot } from './probe';
import { SecureDirectory, sameFile } from '../transport/secureFs';
import { initializeSpool, SpoolIngester } from '../transport/spoolIngester';
import { normalizeJournalRecord } from '../adapters/cursorHooks';
import { FileActivityStore, LocalObservationStore, type FileObservation, type LocalObservation } from '../core/reducers';
import { observationCoverage, type LocalObserverHandle, type ObservationCoverage } from '../adapters/fileObservations';
import { ConversationIdentities } from '../core/identity';
import { LifecycleStore, type DeliveryOrigin } from '../core/lifecycle';
import { CollectorHealth } from '../core/health';
import { snapshotEvent } from '../core/eventValidation';
import { fixturePolicy, type PrivacyPolicy } from './privacyPolicy';
import { privacyExclusions, permittedPath } from '../core/privacy';
import { spawn } from 'node:child_process';
import type { QueueSample, ProducerFailure } from '../transport/spoolIngester';
import type { SelfCheckStatus, ReadinessInput } from '../core/readiness';
import { inspectWorkspaceLease, type WorkspaceOwnership } from './workspaceLease';
import { installOwnedHooks, restoreOwnedHooks, removeHookOwnership, type OwnedHooks } from './hookConfig';
export type CleanupResult = 'removed' | 'not-installed' | 'modified-preserved';
export interface ManagerOptions {
  root: string;
  storage: string;
  helper: string;
  collectorId: string;
  eligibility: () => string | undefined;
  changed: () => void;
  healthChanged?: () => void;
  identities?: ConversationIdentities;
  now?: () => number;
  exclusions?: () => unknown;
  observeLocal?: (deliver: (observation: LocalObservation) => void) => Promise<LocalObserverHandle>;
  allowExistingHooks?: () => boolean;
}
export class PluginManager {
  readonly store: FileActivityStore;
  lifecycle = new LifecycleStore();
  readonly health = new CollectorHealth();
  readonly observations = new LocalObservationStore();
  readonly evidence = new Map<string, FileObservation>();
  readonly identities: ConversationIdentities;
  enabled = false;
  status = 'Collection off';
  lastCleanup: CleanupResult = 'not-installed';
  private ingester: SpoolIngester | undefined;
  private owned: OwnedHooks | undefined;
  private ownership: WorkspaceOwnership = 'unowned';
  private timer: NodeJS.Timeout | undefined;
  private cursor = 0;
  private nextProjectionSequence = 0;
  private replayThroughSequence = 0;
  private lastProcessedSequence = 0;
  private appliedJournalRevision = 0;
  private cachedReplay = new Map<number, FileObservation>();
  historyRevision = 0;
  private checkpointState = 'cold-replay';
  private storageFailure: string | undefined;
  private replayStartedAt = 0;
  private replayDurationMs: number | undefined;
  private collectionStartedAt = 0;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  private localObserver: LocalObserverHandle | undefined;
  private localCoverage = observationCoverage();
  private localSignature = '';
  private localRevision = 0;
  private localGeneration = 0;
  exclusions: readonly string[] = [];
  private policy: PrivacyPolicy | undefined;
  private helperIdentity: import('node:fs').Stats | undefined;
  private check: SelfCheckStatus = { state: 'not-run' };
  private checkTask: Promise<SelfCheckStatus> | undefined;
  private queueSample: QueueSample | undefined;
  private samplingQueue = false;
  private lastQueueSample = 0;
  private producerFailure:ProducerFailure|undefined;
  private storageEpoch='';
  private projectionGeneration: string | undefined;
  get exportEpoch():string{return JSON.stringify([this.storageEpoch,this.historyRevision,this.exclusions]);}
  async withStorageLease<T>(operation:(guard:()=>Promise<void>)=>Promise<T>):Promise<T>{
   return this.transition(async()=>{
    if(this.options.eligibility())throw new Error('maintenance-unavailable');await assertFixtureRoot(this.options.root);
    let owner=this.ingester,temporary=false;
    if(!owner){const lease=await inspectWorkspaceLease(this.options.storage);if(['other-window','uncertain'].includes(lease.state))throw new Error('maintenance-owner-required');
     const directory=await SecureDirectory.open(this.options.storage);let collectorId:string;try{collectorId=JSON.parse((await directory.read('publisher.json',4096)).bytes.toString('utf8')).collectorId;}finally{await directory.close();}
     const config=await initializeSpool(this.options.storage,{collectorId,environmentId:'local-darwin-arm64',workspaceId:createHash('sha256').update('workspace\0'+this.options.root).digest('hex')},this.options.root,false,this.exclusions);
     owner=await SpoolIngester.openForScopedReset(this.options.storage,config,lease.token);temporary=true;
    }
    try{await owner.assertConfiguration();const storage=await SecureDirectory.open(this.options.storage);try{try{const intent=await storage.file('reset-intent.json');await intent.handle.close();throw new Error('pending-history-reset');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}finally{await storage.close();}
     const history=await SecureDirectory.open(join(this.options.storage,'journal'));let retained='none';try{try{const file=await history.file('retention.json');try{retained=JSON.stringify([file.info.dev,file.info.ino,file.info.size,file.info.mtimeMs]);}finally{await file.handle.close();}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}finally{await history.close();}
     const config=owner.publisherConfig(),epoch=JSON.stringify([config.collectorId,config.policyId,retained]);
     if (!this.enabled && ((this.projectionGeneration !== undefined && this.projectionGeneration !== config.collectorId) || (this.storageEpoch && this.storageEpoch !== epoch))) this.clearHistoryProjection();
     this.projectionGeneration = config.collectorId;
     this.storageEpoch=epoch;
     return await operation(()=>owner!.assertConfiguration());
    }finally{if(temporary)await owner.close();}
   });
  }
  clearHistoryProjection(aliases=true):void{
   if(this.enabled||this.ingester)throw new Error('disable-before-history-reset');
   this.projectionGeneration = undefined; this.queueSample = undefined; this.replayDurationMs = undefined;
   this.store.clear();this.evidence.clear();this.observations.clear();if(aliases)this.identities.clearHistory();else this.identities.resetObserved();this.lifecycle=new LifecycleStore();this.cachedReplay.clear();this.cursor=0;this.lastProcessedSequence=0;this.replayThroughSequence=0;this.localCoverage=observationCoverage('off');this.check={state:'not-run'};this.producerFailure=undefined;this.storageFailure=undefined;this.checkpointState='no-history';this.storageEpoch='';this.historyRevision++;this.health.beginCollection();this.health.disable();this.status='Collection off · owned history cleared';this.options.changed();
  }
  readiness(): ReadinessInput {
    return { registered: Boolean(this.owned), owner: Boolean(this.ingester), supported: !this.options.eligibility(), health: this.health.snapshot(), check: { ...this.check },
      counters: this.ingester ? { ...this.ingester.counters } : { accepted: 0, rejected: 0, failures: 0 },
      ...(this.queueSample ? { queue: { ...this.queueSample } } : {}), recoveredTail: this.ingester?.journal.recoveredTail ?? false,
      ...(this.producerFailure?{producerFailure:{...this.producerFailure}}:{}),
      ...(this.ingester ? { history: this.ingester.journal.status(), checkpoint: this.checkpointState } : {}),
      ownership: this.ownership, ...(this.storageFailure ? { storageFailure: this.storageFailure } : {}), ...(this.replayDurationMs === undefined ? {} : { replayDurationMs: this.replayDurationMs }) };
  }
  runSelfCheck(): Promise<SelfCheckStatus> {
    if (this.checkTask) return this.checkTask;
    this.checkTask = this.checkOwnedHelper().finally(() => { this.checkTask = undefined; });
    return this.checkTask;
  }
  private async checkOwnedHelper(): Promise<SelfCheckStatus> {
    const start = Date.now(), checkedAt = new Date().toISOString(), generation = this.localGeneration;
    const finish = (state: SelfCheckStatus['state']): SelfCheckStatus => {
      this.check = { state, checkedAt, durationMs: Math.max(0, Date.now() - start) }; this.options.changed(); return { ...this.check };
    };
    if (this.options.eligibility()) return finish('unsupported');
    if (!this.enabled || !this.ingester) return finish('collector-off');
    this.check = { state: 'running', checkedAt }; this.options.changed();
    const checkId = randomUUID();
    try {
      const info = await lstat(this.options.helper);
      if (!this.helperIdentity || !sameFile(info, this.helperIdentity) || info.size !== this.helperIdentity.size || info.mtimeMs !== this.helperIdentity.mtimeMs || info.isSymbolicLink()) return finish('launch-failed');
      const response = await new Promise<'passed' | 'launch-failed' | 'response-invalid'>(resolve => {
        let completed = false, stdout = '', stderr = false;
        const child = spawn(this.options.helper, ['--self-check', this.options.storage, checkId], { stdio: ['ignore', 'pipe', 'pipe'] });
        const done = (state: 'passed' | 'launch-failed' | 'response-invalid'): void => { if (completed) return; completed = true; clearTimeout(timeout); resolve(state); };
        const timeout = setTimeout(() => { child.kill(); done('response-invalid'); }, 3000);
        child.on('error', () => done('launch-failed'));
        child.stdout.on('data', chunk => { if (stdout.length + chunk.length > 16) { child.kill(); done('response-invalid'); } else stdout += chunk.toString('utf8'); });
        child.stderr.on('data', () => { stderr = true; });
        child.on('close', code => done(code === 0 && stdout === '{}\n' && !stderr ? 'passed' : 'response-invalid'));
      });
      if (response !== 'passed') return finish(response);
      const end = Date.now() + 2500;
      while (Date.now() < end && this.enabled && this.localGeneration === generation) {
        this.refresh();
        if (this.ingester?.journal.records.some(record => record.envelope.result.counters.checkId === checkId && record.envelope.result.counters.gap === 'self-check')) return finish('passed');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return finish(this.enabled && this.localGeneration === generation ? 'delivery-timeout' : 'collector-off');
    } catch { return finish('launch-failed'); }
  }
  async restrictPrivacy(input: unknown): Promise<void> {
    try { this.exclusions = privacyExclusions(input); } catch { this.exclusions = ['**']; }
    this.policy = fixturePolicy(this.options.root, createHash('sha256').update('workspace-root\0' + this.options.root).digest('hex'), this.exclusions);
    this.ingester?.restrictPrivacy(this.policy);
    this.store.clear(); this.evidence.clear(); this.observations.restrict(this.exclusions);
    this.options.changed();
    await this.disable();
    this.status = 'Collection off · privacy changed · enable to resume'; this.options.changed();
  }
  constructor(private readonly options: ManagerOptions) {
    this.identities = options.identities ?? new ConversationIdentities();
    this.now = options.now ?? Date.now;
    this.store = new FileActivityStore(this.now);
  }
  private transition<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.queue.then(fn, fn);
    this.queue = task.catch(() => { });
    return task;
  }
  enable(): Promise<void> { return this.transition(async () => {
    try { await this.enableOwned(); this.storageFailure = undefined; }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      if(this.status.startsWith('Loading retained history')){this.status='Collection off · enable did not complete · inspect Source Health';this.options.changed();}
      if (code === 'workspace-owned-by-other-window' || code === 'workspace-ownership-uncertain' || code === 'foreign-or-modified-hooks') {
        this.status = code === 'workspace-owned-by-other-window' ? 'Collection passive · another window owns this checkout' : code === 'workspace-ownership-uncertain' ? 'Collection off · ownership needs inspection' : 'Collection off · existing or modified hooks preserved';
        this.options.changed();
      }
      if (['journal-corrupt', 'journal-middle-corruption', 'journal-segment-missing', 'journal-unreadable', 'journal-history-limit', 'retention-manifest-invalid', 'journal-layout-invalid','pending-history-reset'].includes(code)) {
        this.storageFailure = code; this.health.disconnect(); this.status = code==='pending-history-reset'?'Collection off · interrupted history reset needs completion':'Collection unavailable · history integrity needs inspection'; this.options.changed();
      }
      throw error;
    }
  }); }
  observationStatus(): ObservationCoverage {
    const snapshot = this.localObserver?.snapshot() ?? this.localCoverage;
    return { ...snapshot, limitations: [...snapshot.limitations] };
  }
  disable(): Promise<CleanupResult> {
    return this.transition(async () => {
      try { return await this.disableOwned(); }
      catch (error) {
        this.health.disconnect();
        this.status = 'Collection cleanup could not complete · live state unknown';
        this.options.changed();
        throw error;
      }
    });
  }
  private async enableOwned(): Promise<void> {
    const reason = this.options.eligibility();
    if (reason) {
      this.health.unavailable();
      this.status = this.health.snapshot().status;
      this.options.changed();
      throw new Error(reason);
    }
    if (this.enabled) {
      if (this.health.snapshot().transport === 'disconnected') throw new Error('collector-disconnected');
      return;
    }
    const { root, storage, helper, collectorId } = this.options;
    await assertFixtureRoot(root);
    const helperInfo = await lstat(helper);
    if (!helperInfo.isFile() || helperInfo.isSymbolicLink())
      throw new Error('helper-unavailable');
    await access(helper, constants.X_OK);
    this.helperIdentity = helperInfo;
    if (storage !== join(root, '.local', 'supervision-storage'))
      throw new Error('invalid-fixture-storage');
    const parent = join(root, '.local');
    await mkdir(parent, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
      throw error; });
    const parentDirectory = await SecureDirectory.open(parent, false);
    try {
      await mkdir(storage, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        throw error; });
    }
    finally {
      await parentDirectory.close();
    }
    const rootHash = createHash('sha256').update('workspace\0' + root).digest('hex');
    this.exclusions = privacyExclusions(this.options.exclusions?.() ?? []);
    this.observations.restrict(this.exclusions);
    const lease = await inspectWorkspaceLease(storage); this.ownership = lease.state;
    if (lease.state === 'other-window') throw new Error('workspace-owned-by-other-window');
    if (lease.state === 'uncertain') throw new Error('workspace-ownership-uncertain');
    // Retain the root's established collector identity across editor profiles/upgrades.
    let rootCollectorId = collectorId;
    const storageDirectory = await SecureDirectory.open(storage);
    try {
      try { const previous = JSON.parse((await storageDirectory.read('publisher.json',4096)).bytes.toString('utf8'));
        if(previous.workspaceId===rootHash&&previous.environmentId==='local-darwin-arm64'&&typeof previous.collectorId==='string')rootCollectorId=previous.collectorId;
      } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
    }finally{await storageDirectory.close();}
    if (this.projectionGeneration !== undefined && this.projectionGeneration !== rootCollectorId) this.clearHistoryProjection();
    const config = await initializeSpool(storage, { collectorId: rootCollectorId, environmentId: 'local-darwin-arm64', workspaceId: rootHash }, root, false, this.exclusions);
    this.status='Loading retained history · checking journal';this.options.changed();
    try { this.ingester = await SpoolIngester.open(storage, config, lease.token, { now: this.now }); }
    catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST'){this.ownership='other-window';throw new Error('workspace-owned-by-other-window');}throw error;}
    this.ownership = 'owned';
    try {
      this.policy = await this.ingester.setPrivacyPolicy(root, this.exclusions);
      if(!config.requireCollectorEpoch){
        await new Promise(resolve=>setTimeout(resolve,1600));
        for(let batch=0;batch<40;batch++){await this.ingester.scan();const queued=await this.ingester.inspectQueue();if(!queued.readyFiles&&!queued.incomplete)break;}
      }
      await this.ingester.requireCollectorEpoch();
      this.cachedReplay = await this.ingester.checkpoints.load(this.ingester.journal.records, this.policy.policyId) ?? new Map();
      this.checkpointState = this.cachedReplay.size ? 'loaded' : 'cold-replay';
      const directoryPath = join(root, '.cursor');
      await mkdir(directoryPath, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        throw error; });
      this.owned = await installOwnedHooks(root, storage, helper, () => this.ingester!.assertOwner(), this.options.allowExistingHooks?.() ?? false,config.collectorId);
      await this.ingester.startBroker();
      await this.ingester.setPublisherEnabled(true);
      this.cursor = 0;
      this.nextProjectionSequence = 0;
      this.replayThroughSequence = this.ingester.journal.records.at(-1)?.ingestSequence ?? 0;
      this.replayStartedAt = Date.now(); this.replayDurationMs = undefined;
      this.lastProcessedSequence = 0; this.appliedJournalRevision = this.ingester.journal.revision;
      this.collectionStartedAt = this.now();
      this.store.clear();
      this.identities.resetObserved(); this.lifecycle = new LifecycleStore();
      this.evidence.clear();
      this.enabled = true;
      this.projectionGeneration = config.collectorId;
      this.check = { state: 'not-run' }; this.queueSample = undefined; this.producerFailure=undefined; this.lastQueueSample = 0;
      this.health.beginCollection();
      this.status = this.health.snapshot().status;
      this.ingester.start();
      if (this.options.observeLocal) {
        const localGeneration = ++this.localGeneration;
        try {
          this.localObserver = await this.options.observeLocal(observation => {
            if (this.enabled && this.localGeneration === localGeneration && !this.options.eligibility() && observation.event.targets.every(t => t.relativePath && permittedPath(t.relativePath, this.exclusions))) this.observations.apply(observation);
          });
        } catch { this.localCoverage = observationCoverage('unavailable'); this.localCoverage.failures = 1; }
      }
      this.refresh();
      this.timer = setInterval(() => this.refresh(), 200);
      this.timer.unref();
      this.options.changed();
    }
    catch (error) {
      await this.disableOwned();
      throw error;
    }
  }
  refresh(): void {
    if (this.enabled && this.options.eligibility()) {
      void this.disable().catch(() => { this.health.disconnect(); this.status = 'Collection cleanup could not complete · live state unknown'; this.options.changed(); });
      return;
    }
    const records = this.ingester?.journal.records;
    if (!records)
      return;
    let historyChanged = false;
    if (this.appliedJournalRevision !== this.ingester!.journal.revision) {
      historyChanged = true;
      this.appliedJournalRevision = this.ingester!.journal.revision; this.historyRevision++;
      this.cursor = 0; this.nextProjectionSequence = 0; this.store.clear(); this.evidence.clear(); this.identities.resetObserved(); this.lifecycle = new LifecycleStore(); this.cachedReplay.clear();
      this.checkpointState = 'invalidated-by-retention';
    }
    if (this.enabled && !this.samplingQueue && Date.now() - this.lastQueueSample >= 2000) {
      const owner = this.ingester!; this.samplingQueue = true; this.lastQueueSample = Date.now();
      void Promise.all([owner.inspectQueue(),owner.inspectProducerFailure()]).then(([sample,failure]) => { if (this.enabled && this.ingester === owner) { this.queueSample = sample;if(failure){this.producerFailure=failure;this.health.reportProducerLoss();} (this.options.healthChanged ?? this.options.changed)(); } })
        .catch(() => { if (this.enabled && this.ingester === owner) owner.counters.failures++; }).finally(() => { this.samplingQueue = false; });
    }
    let changed = historyChanged;
    const localSignature = JSON.stringify(this.observationStatus());
    if (this.localRevision !== this.observations.revision || this.localSignature !== localSignature) {
      this.localRevision = this.observations.revision; this.localSignature = localSignature; changed = true;
    }
    this.cursor = Math.max(0, this.nextProjectionSequence - (records[0]?.ingestSequence ?? 0));
    const end = Math.min(records.length, this.cursor + 200);
    while (this.cursor < end) {
      const index = this.cursor++;
      const record = records[index]!;
      this.nextProjectionSequence = record.ingestSequence + 1;
      const metadata = record.envelope.result.metadata;
      const excluded = metadata?.pathHash && !this.policy?.allowedPathHashes.includes(metadata.pathHash);
      const projected = excluded ? { ...record, envelope: { ...record.envelope, result: { ...record.envelope.result, counters: { ...record.envelope.result.counters, privacy: 'excluded-path' as const } } } } : record;
      const alreadyObserved = record.ingestSequence <= this.lastProcessedSequence;
      if (!alreadyObserved) this.health.observePrivacy(projected.envelope.result.counters.privacy);
      const normalized = this.cachedReplay.get(record.ingestSequence) ?? normalizeJournalRecord(projected);
      if (!normalized)
        continue;
      const checked = snapshotEvent(normalized.event, 'journal');
      if (!checked.ok) throw new Error('invalid-projection-event');
      const observation: FileObservation = { ...normalized, event: checked.event };
      // Journal replay and delayed pre-enable spool records do not prove fresh delivery.
      const origin: DeliveryOrigin = record.ingestSequence <= this.replayThroughSequence || Date.parse(observation.event.receivedAt) < this.collectionStartedAt ? 'replay' : 'live';
      this.identities.observe(observation.event);
      this.lifecycle.apply(observation.event, origin);
      if (!alreadyObserved) this.health.observe(observation.event, origin);
      this.lastProcessedSequence = Math.max(this.lastProcessedSequence, record.ingestSequence);
      if (this.store.apply(observation, origin) || !this.evidence.has(observation.event.eventId))
        changed = true;
      this.evidence.set(observation.event.eventId, observation);
      this.cachedReplay.delete(record.ingestSequence);
      while (this.evidence.size > 5000)
        this.evidence.delete(this.evidence.keys().next().value!);
    }
    this.health.syncTransport(this.ingester!.counters);
    if (this.replayDurationMs === undefined && this.lastProcessedSequence >= this.replayThroughSequence) this.replayDurationMs = Math.max(0, Date.now() - this.replayStartedAt);
    const status = this.enabled && this.lastProcessedSequence < this.replayThroughSequence
      ? `Loading retained history · ${this.cursor}/${records.length} projected · live state unknown`
      : this.health.snapshot().status;
    if (this.enabled && this.status !== status) { this.status = status; changed = true; }
    if (changed) {
      this.options.changed();
    }
  }
  private async disableOwned(): Promise<CleanupResult> {
    if (this.timer)
      clearInterval(this.timer);
    this.timer = undefined;
    this.localGeneration++;
    const observer = this.localObserver;
    this.localObserver = undefined;
    if (observer) {
      observer.dispose();
      await observer.whenIdle();
      this.localCoverage = observer.snapshot();
    }
    this.localCoverage = { ...this.localCoverage, state: 'off', queued: 0 };
    // Stop cached commands before removing the config or releasing the lease.
    if (this.ingester)
      await this.ingester.setPublisherEnabled(false);
    this.enabled = false;
    this.health.disable();
    let cleanup: CleanupResult = 'not-installed';
    const owned = this.owned;
    if (owned) {
      try {
        cleanup = await restoreOwnedHooks(owned,this.options.root,this.options.storage,()=>this.ingester!.assertOwner());
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          cleanup = 'modified-preserved';
      }
      await owned.directory.close();
      this.owned = undefined;
    }
    await this.ingester?.quiesce();
    if (this.ingester && cleanup === 'removed') await removeHookOwnership(this.options.storage, () => this.ingester!.assertOwner());
    this.refresh();
    if (this.ingester && this.policy) {
      const saved = await this.ingester.checkpoints.save(this.ingester.journal.records, this.policy.policyId, record => {
        const metadata = record.envelope.result.metadata;
        return normalizeJournalRecord(metadata?.pathHash && !this.policy!.allowedPathHashes.includes(metadata.pathHash)
          ? { ...record, envelope: { ...record.envelope, result: { ...record.envelope.result, counters: { ...record.envelope.result.counters, privacy: 'excluded-path' } } } } : record);
      });
      this.checkpointState = saved ? 'written' : 'not-written-capacity-or-coverage';
    }
    await this.ingester?.close();
    this.ingester = undefined;
    if(this.ownership==='owned')this.ownership='unowned';
    this.enabled = false;
    this.lastCleanup = cleanup;
    this.status = cleanup === 'modified-preserved' ? 'Collection off · modified hook configuration preserved' : 'Collection off · reload clears cached hook commands';
    this.options.changed();
    return cleanup;
  }
}
