import { constants, watch, type FSWatcher, type Dir } from 'node:fs';
import { mkdir, open, unlink, lstat, opendir, realpath, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SecureDirectory, sameFile, type PinnedPrivateFile } from './secureFs';
import { Journal, type SourceJournalRecord, type JournalOptions } from './journal';
import { ProjectionCheckpoints } from './checkpoint';
import { MAX_SOURCE_BYTES, OPAQUE_PATTERN, UUID_PATTERN, parseSource } from './sourceValidation';
import type { SourceEnvelopeV1 } from './sourceContracts';
import { fixturePolicy, validPolicy, type PrivacyPolicy } from '../integration/privacyPolicy';
import {LocalBroker,cleanupBrokerEndpoint,validBrokerEndpoint,type BrokerEndpoint,type BrokerRejection} from './localBroker';
export interface Scope {
  collectorId: string;
  environmentId: string;
  workspaceId: string;
  worktreeId?: string;
}
export interface PublisherConfig extends Scope, Partial<PrivacyPolicy> {
  configVersion: 1;
  sourceRootHash: string;
  enabled: boolean;
  requireCollectorEpoch?:true;
  broker?:BrokerEndpoint;
}
export interface QueueSample { sampledAt: string; readyFiles: number; oldestObservedAgeMs: number; incomplete: boolean; scannedEntries: number }
export interface ProducerFailure { category:'publication-failed'|'deadline-exceeded'|'uncertain'; recordedAt?:string }
interface Lease {
  leaseVersion: 1;
  token: string;
  pid: number;
}
/** Creates only private local storage. Source payloads cannot choose this path. */
export async function initializeSpool(path: string, scope: Scope, sourceWorkspaceRoot: string, initiallyEnabled = true, exclusions: readonly string[] = []): Promise<PublisherConfig> {
  for (const value of [scope.collectorId, scope.environmentId, scope.workspaceId, ...(scope.worktreeId === undefined ? [] : [scope.worktreeId])])
    if (typeof value !== 'string' || !OPAQUE_PATTERN.test(value))
      throw new Error('invalid-scope');
  if (await realpath(sourceWorkspaceRoot) !== sourceWorkspaceRoot)
    throw new Error('noncanonical-source-root');
  let config: PublisherConfig = { configVersion: 1, collectorId: scope.collectorId, environmentId: scope.environmentId, workspaceId: scope.workspaceId, ...(scope.worktreeId === undefined ? {} : { worktreeId: scope.worktreeId }), sourceRootHash: createHash('sha256').update('workspace-root\0' + sourceWorkspaceRoot).digest('hex'), enabled: initiallyEnabled };
  const base = { ...config };
  Object.assign(config, fixturePolicy(sourceWorkspaceRoot, config.sourceRootHash, exclusions));
  const root = await SecureDirectory.open(path);
  try {
    for (const name of ['inbox', 'journal']) {
      await root.guard();
      await mkdir(join(path, name), { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        throw error; });
      const directory = await SecureDirectory.open(join(path, name));
      await directory.close();
    }
    await root.guard();
    try {
      const file = await open(join(path, 'publisher.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await file.writeFile(JSON.stringify(config));
        await file.sync();
      }
      finally {
        await file.close();
      }
      await root.sync();
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        throw error;
      const previous = JSON.parse((await root.read('publisher.json', 4096)).bytes.toString('utf8')) as PublisherConfig;
      const { privacyVersion, policyId, allowedPathHashes, requireCollectorEpoch, broker, ...previousBase } = previous;
      if ((broker!==undefined&&(!validBrokerEndpoint(broker)||requireCollectorEpoch!==true)) || (requireCollectorEpoch!==undefined&&requireCollectorEpoch!==true) || typeof previous.enabled !== 'boolean' || JSON.stringify(previousBase) !== JSON.stringify({ ...base, enabled: previous.enabled }) ||
        (privacyVersion !== undefined && !validPolicy({ privacyVersion, policyId, allowedPathHashes }, config.sourceRootHash)))
        throw new Error('publisher-config-conflict');
      config = previous;
    }
    if(config.requireCollectorEpoch){await root.guard();await mkdir(join(path,'inbox',config.collectorId),{mode:0o700}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;});const epoch=await SecureDirectory.open(join(path,'inbox',config.collectorId));await epoch.close();}
    return config;
  }
  finally {
    await root.close();
  }
}
export class SpoolIngester {
  readonly counters = { accepted: 0, duplicates: 0, rejected: 0, failures: 0, schemaRejected: 0, scopeRejected: 0, policyRejected: 0, expired: 0 };
  readonly journal: Journal;
  readonly checkpoints: ProjectionCheckpoints;
  async inspectProducerFailure():Promise<ProducerFailure|undefined>{
    await this.assertOwner();
    if (this.config.requireCollectorEpoch && this.recentEmptyQueue()?.noProducerLoss) return undefined;
    try{const read=await (this.config.requireCollectorEpoch?this.inbox:this.root).read('producer-loss.json',512),value=JSON.parse(read.bytes.toString('utf8'));
      if(read.info.nlink!==1||!value||Object.keys(value).sort().join(',')!=='category,lossVersion,recordedAt'||value.lossVersion!==1||!['publication-failed','deadline-exceeded'].includes(value.category)||typeof value.recordedAt!=='string'||!Number.isFinite(Date.parse(value.recordedAt)))return{category:'uncertain'};
      return{category:value.category,recordedAt:value.recordedAt};
    }catch(error){return(error as NodeJS.ErrnoException).code==='ENOENT'?undefined:{category:'uncertain'};}
  }
  async inspectQueue(): Promise<QueueSample> {
    await this.assertOwner();
    const recent = this.recentEmptyQueue();
    if (recent) return {...recent.sample};
    const listing = await opendir(this.inbox.path);
    const now = Date.now(); let scannedEntries = 0, readyFiles = 0, oldestObservedAgeMs = 0, incomplete = true;
    try {
      while (scannedEntries < 256) {
        const entry = await listing.read(); if (!entry) { incomplete = false; break; } scannedEntries++;
        if (!/^[0-9a-f-]{36}\.json$/.test(entry.name) || !UUID_PATTERN.test(entry.name.slice(0, -5))) continue;
        const info = await lstat(join(this.inbox.path, entry.name)).catch(() => undefined);
        if (!info?.isFile() || info.isSymbolicLink()) continue;
        readyFiles++; oldestObservedAgeMs = Math.max(oldestObservedAgeMs, Math.max(0, now - info.mtimeMs));
      }
      await this.assertOwner();
      return { sampledAt: new Date(now).toISOString(), readyFiles, oldestObservedAgeMs, incomplete, scannedEntries };
    } finally { await listing.close(); }
  }
  private cursor: Dir | undefined;
  private timer: NodeJS.Timeout | undefined;
  private watcher: FSWatcher | undefined;
  private watchAvailable = false;
  private nextPollAt = 0;
  private rescanRequested = false;
  private pending: Promise<SourceJournalRecord[]> | undefined;
  private probingEmpty = false;
  private closed = false;
  private closing = false;
  private closeTask: Promise<void> | undefined;
  private admissionPolicy: Partial<PrivacyPolicy>;
  private broker:LocalBroker|undefined;
  private brokerState:'off'|'active'|'unavailable'='off';
  private pinnedLease: PinnedPrivateFile | undefined;
  private ownershipProof: Promise<void> | undefined;
  private emptyQueue: {sample: QueueSample; noProducerLoss: boolean} | undefined;
  private recentEmptyQueue(): typeof this.emptyQueue {
    const at = this.emptyQueue ? Date.parse(this.emptyQueue.sample.sampledAt) : NaN, now = Date.now();
    return this.watchAvailable && now >= at && now - at <= 1500 ? this.emptyQueue : undefined;
  }
  brokerStatus():{state:'off'|'active'|'unavailable';connections:number;queued:number;bufferedBytes:number}{return{state:this.brokerState,connections:0,queued:0,bufferedBytes:0,...(this.broker?.snapshot()??{})};}
  private brokerAdmission(event:SourceEnvelopeV1):BrokerRejection|undefined{
    if(this.closed||this.closing||!this.config.enabled)return 'closed';
    if(!this.acceptScope(event))return 'scope';
    const metadata=event.result.metadata,policy=this.admissionPolicy;
    if(metadata?.pathHash&&(!validPolicy(policy,this.config.sourceRootHash)||metadata.policyId!==policy.policyId||!policy.allowedPathHashes.includes(metadata.pathHash)))return 'policy';
    return undefined;
  }
  async startBroker():Promise<boolean>{
    if(this.scopedReset||this.closed||this.closing||!this.config.requireCollectorEpoch)throw new Error('broker-owner-required');
    if(this.broker)return true;
    await this.stopBroker();await this.assertConfiguration();
    let broker:LocalBroker;
    try{broker=await LocalBroker.open({guard:()=>this.assertConfiguration(),admit:event=>this.brokerAdmission(event),submit:async events=>{
      const results=await this.journal.appendBatch(events,event=>this.brokerAdmission(event)===undefined);
      for(const result of results){if(result.added)this.counters.accepted++;else if(result.expired)this.counters.expired++;else this.counters.duplicates++;}return results;
    },rejected:reason=>{if(reason==='capacity'||reason==='closed')return;this.counters.rejected++;if(reason==='schema')this.counters.schemaRejected++;else if(reason==='policy')this.counters.policyRejected++;else if(reason==='auth'||reason==='scope')this.counters.scopeRejected++;else this.counters.failures++;}});}
    catch{await this.assertConfiguration();this.brokerState='unavailable';return false;}
    this.broker=broker;
    try{await this.replaceConfig({...this.config,broker:{...broker.endpoint}});this.brokerState='active';return true;}
    catch(error){this.broker=undefined;await broker.close();throw error;}
  }
  private async stopBroker():Promise<void>{
    const broker=this.broker;this.broker=undefined;
    if(broker)await broker.close();
    else if(this.config.broker&&!await cleanupBrokerEndpoint(this.config.broker,()=>this.assertOwner()))throw new Error('broker-cleanup-unproven');
    if(this.config.broker){const {broker:removed,...next}=this.config;await this.replaceConfig(next);}
    this.brokerState='off';
  }
  private constructor(private readonly root: SecureDirectory, private inbox: SecureDirectory, private readonly history: SecureDirectory, private readonly config: PublisherConfig, private readonly lease: Lease, private readonly leaseBytes: Buffer, options: JournalOptions,private readonly scopedReset=false) {
    this.admissionPolicy = config;
    this.checkpoints = new ProjectionCheckpoints(root, () => this.assertOwner());
    this.journal = new Journal(history, () => this.assertOwner(), e => this.acceptScope(e), { ...options, beforePrune: () => this.checkpoints.invalidate() });
  }
  static async open(path: string, config: PublisherConfig, recoverLeaseToken?: string, options: JournalOptions = {}): Promise<SpoolIngester> {
    return this.acquire(path,config,recoverLeaseToken,options,false);
  }
  static async openForScopedReset(path:string,config:PublisherConfig,recoverLeaseToken?:string):Promise<SpoolIngester>{
    return this.acquire(path,config,recoverLeaseToken,{},true);
  }
  private static async acquire(path: string, config: PublisherConfig, recoverLeaseToken: string|undefined, options: JournalOptions,scopedReset:boolean): Promise<SpoolIngester> {
    const root = await SecureDirectory.open(path);
    let inbox: SecureDirectory | undefined, history: SecureDirectory | undefined, owner: SpoolIngester | undefined;
    try {
      const actual = (await root.read('publisher.json', 4096)).bytes;
      if (actual.toString('utf8') !== JSON.stringify(config))
        throw new Error('publisher-config-conflict');
      inbox = await SecureDirectory.open(config.requireCollectorEpoch?join(path,'inbox',config.collectorId):join(path,'inbox'));
      history = await SecureDirectory.open(join(path, 'journal'));
      if (recoverLeaseToken) {
        const read = await root.read('collector.lock', 512);
        const old = JSON.parse(read.bytes.toString('utf8')) as Lease;
        if (old.leaseVersion !== 1 || !UUID_PATTERN.test(old.token) || old.token !== recoverLeaseToken || !Number.isSafeInteger(old.pid) || old.pid <= 0)
          throw new Error('invalid-lease-recovery');
        try {
          process.kill(old.pid, 0);
          throw new Error('collector-still-active');
        }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
            throw error;
        }
        await root.guard();
        if (!sameFile(read.info, await lstat(join(path, 'collector.lock'))))
          throw new Error('lease-changed');
        await unlink(join(path, 'collector.lock'));
        await root.sync();
      }
      const lease: Lease = { leaseVersion: 1, token: randomUUID(), pid: process.pid };
      const leaseBytes = Buffer.from(JSON.stringify(lease));
      const file = await open(join(path, 'collector.lock'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await file.writeFile(leaseBytes);
        await file.sync();
      }
      finally {
        await file.close();
      }
      await root.sync();
      owner = new SpoolIngester(root, inbox, history, { ...config }, lease, leaseBytes, options,scopedReset);
      owner.pinnedLease = await root.pin('collector.lock', 512);
      if(!scopedReset){
        try{await root.file('reset-intent.json').then(file=>file.handle.close());throw new Error('pending-history-reset');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        await owner.checkpoints.cleanStaging();await owner.journal.load();
      }
      return owner;
    }
    catch (error) {
      if (owner)
        await owner.close();
      else {
        await inbox?.close();
        await history?.close();
        await root.close();
      }
      throw error;
    }
  }
  private acceptScope(e: SourceEnvelopeV1): boolean {
    const m = e.result.metadata;
    return e.collectorId === this.config.collectorId && e.environmentId === this.config.environmentId && e.workspaceId === this.config.workspaceId && e.worktreeId === this.config.worktreeId &&
      (!m || (m.sourceVersion === '3.26.16' && m.sourceEvent !== 'sessionEnd' && m.workspaceRootHashes.length === 1 && m.workspaceRootHashes[0] === this.config.sourceRootHash));
  }
  /** Only the lease owner can switch cached helper invocations on or off. */
  async setPublisherEnabled(enabled: boolean): Promise<void> {
    await this.replaceConfig({ ...this.config, enabled });
    if(!enabled)await this.stopBroker();
  }
  async requireCollectorEpoch():Promise<void>{
    if(this.config.requireCollectorEpoch)return;
    if(this.timer||this.pending||this.cursor)throw new Error('epoch-upgrade-requires-quiescent-owner');
    const parent=await SecureDirectory.open(join(this.root.path,'inbox'));try{await parent.guard();await mkdir(join(parent.path,this.config.collectorId),{mode:0o700}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;});await parent.sync();}finally{await parent.close();}
    const replacement=await SecureDirectory.open(join(this.root.path,'inbox',this.config.collectorId));
    try{await this.replaceConfig({...this.config,requireCollectorEpoch:true});}catch(error){await replacement.close();throw error;}
    const old=this.inbox;this.inbox=replacement;await old.close();
  }
  publisherConfig():PublisherConfig{return JSON.parse(JSON.stringify(this.config)) as PublisherConfig;}
  async rotateCollectorEpoch(collectorId:string):Promise<void>{
    if(!this.scopedReset||!UUID_PATTERN.test(collectorId)||this.config.enabled)throw new Error('scoped-reset-required');
    await this.replaceConfig({...this.config,collectorId,requireCollectorEpoch:true,enabled:false});
  }
  /** Upgrades legacy configuration only after this process owns the lease. */
  async setPrivacyPolicy(root: string, exclusions: readonly string[]): Promise<PrivacyPolicy> {
    await this.setPublisherEnabled(false);
    const policy = fixturePolicy(root, this.config.sourceRootHash, exclusions);
    this.restrictPrivacy(policy);
    await this.replaceConfig({ ...this.config, ...policy, enabled: false });
    return policy;
  }
  restrictPrivacy(policy: PrivacyPolicy): void { this.admissionPolicy = { ...policy, allowedPathHashes: [...policy.allowedPathHashes] }; }
  private async replaceConfig(next: PublisherConfig): Promise<void> {
    await this.assertOwner();
    const before = await this.root.read('publisher.json', 4096);
    if (before.bytes.toString('utf8') !== JSON.stringify(this.config)) throw new Error('publisher-config-conflict');
    const name = `publisher-${randomUUID()}.tmp`;
    const path = join(this.root.path, name);
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await file.writeFile(JSON.stringify(next)); await file.sync();
    } finally { await file.close(); }
    try {
      await this.assertOwner();
      if (!sameFile(before.info, await lstat(join(this.root.path, 'publisher.json')))) throw new Error('publisher-config-changed');
      await rename(path, join(this.root.path, 'publisher.json')); await this.root.sync();
      for(const key of Object.keys(this.config))if(!Object.hasOwn(next,key))delete (this.config as unknown as Record<string,unknown>)[key];
      Object.assign(this.config, next);
    } finally { await unlink(path).catch(() => {}); }
  }
  assertOwner(): Promise<void> {
    if (this.ownershipProof) return this.ownershipProof;
    const proof = this.proveOwner();
    const pending = proof.finally(() => {if (this.ownershipProof === pending) this.ownershipProof = undefined;});
    this.ownershipProof = pending;return pending;
  }
  private async proveOwner(): Promise<void> {
    if (this.closed)
      throw new Error('collector-closed');
    // These independent read-only proofs must all finish before any mutation
    // or acknowledgment, but need not serialize their filesystem round trips.
    const proofs = await Promise.allSettled([this.pinnedLease ? this.pinnedLease.read() : this.root.read('collector.lock', 512),
      this.scopedReset ? Promise.resolve() : this.inbox.guard(), this.history.guard()]);
    for (const proof of proofs) if (proof.status === 'rejected') throw proof.reason;
    const lease = proofs[0]!;
    if (lease.status !== 'fulfilled') throw new Error('collector-ownership-lost');
    const current = lease.value;
    if (!current.bytes.equals(this.leaseBytes) || current.info.nlink !== 1)
      throw new Error('collector-ownership-lost');
  }
  async assertConfiguration():Promise<void>{await this.assertOwner();const actual=await this.root.read('publisher.json',4096);if(actual.bytes.toString('utf8')!==JSON.stringify(this.config))throw new Error('publisher-config-conflict');}
  /** All acknowledgments are conditional on the same ready inode/contents. */
  private async remove(name: string, expected?: {
    bytes: Buffer;
    info: import('node:fs').Stats;
  }): Promise<void> {
    await this.assertOwner();
    const path = join(this.inbox.path, name), now = await lstat(path);
    if (expected) {
      if (!sameFile(expected.info, now))
        return;
      const read = await this.inbox.read(name, MAX_SOURCE_BYTES);
      if (!sameFile(expected.info, read.info) || !read.bytes.equals(expected.bytes))
        return;
    }
    if (now.isDirectory())
      return;
    await this.inbox.guard();
    await unlink(path);
  }
  scan(afterDurable?: () => Promise<void>): Promise<SourceJournalRecord[]> {
    if(this.scopedReset)return Promise.reject(new Error('scoped-reset-only'));
    if (this.pending)
      return this.probingEmpty ? this.pending.then(() => this.scan(afterDurable)) : this.pending;
    if (this.closed || this.closing)
      return Promise.reject(new Error('collector-closed'));
    this.pending = this.scanBatch(afterDurable).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  /** A healthy watched inbox was empty on the last complete sweep. Looking for
   * an entry needs directory metadata, not authority to read/acknowledge payloads.
   * Any entry, including an unexpected one, returns to the full owned scan. */
  private scanWatchedEmpty(): Promise<SourceJournalRecord[]> {
    this.probingEmpty = true;
    this.pending = (async () => {
      await this.journal.maintain(); // Pruning independently proves ownership.
      await this.inbox.guard();
      const listing = await opendir(this.inbox.path);
      let empty: boolean;
      try {empty = (await listing.read()) === null;await this.inbox.guard();}
      finally {await listing.close();}
      if (!empty) {this.emptyQueue = undefined;return this.scanBatch();}
      this.emptyQueue = this.watchAvailable && !this.rescanRequested
        ? {sample: {sampledAt: new Date().toISOString(), readyFiles: 0, oldestObservedAgeMs: 0, incomplete: false, scannedEntries: 0}, noProducerLoss: true}
        : undefined;
      return [];
    })().finally(() => {this.pending = undefined;this.probingEmpty = false;});
    return this.pending;
  }
  private async scanBatch(afterDurable?: () => Promise<void>): Promise<SourceJournalRecord[]> {
    await this.assertOwner();
    await this.journal.maintain();
    const wholeSweep = !this.cursor;
    if (!this.cursor) {
      this.cursor = await opendir(this.inbox.path);
      await this.inbox.guard();
    }
    const records: SourceJournalRecord[] = [];
    let bytes = 0, scannedEntries = 0, noProducerLoss = true, complete = false, sawReady = false;
    for (let count = 0; count < 256 && bytes < 2 * 1024 * 1024; count++) {
      const entry = await this.cursor.read();
      if (!entry) {
        await this.cursor.close();
        this.cursor = undefined;
        complete = true;
        break;
      }
      const name = entry.name;
      scannedEntries++;
      if(name==='producer-loss.json'){noProducerLoss = false;continue;}
      if (!/^[0-9a-f-]{36}\.json$/.test(name) || !UUID_PATTERN.test(name.slice(0, -5))) {
        // Orphan temp files are never ingested. Delete only old, regular ones;
        // recent publishers may still own their temp files.
        if (/^[0-9a-f-]{36}\.[0-9a-f-]{36}\.tmp$/.test(name)) {
          const info = await lstat(join(this.inbox.path, name)).catch(() => undefined);
          if (info?.isFile() && Date.now() - info.mtimeMs > 60000)
            await this.remove(name).catch(() => { this.counters.failures++; });
        }
        else if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name)) {
          this.counters.rejected++;
          await this.remove(name).catch(() => { this.counters.failures++; });
        }
        continue;
      }
      let read;
      sawReady = true;
      try {
        read = await this.inbox.read(name, MAX_SOURCE_BYTES);
      }
      catch {
        this.counters.rejected++;
        await this.remove(name).catch(() => { this.counters.failures++; });
        continue;
      }
      bytes += read.bytes.length;
      const envelope = parseSource(read.bytes);
      const metadata = envelope?.result.metadata;
      const policy = this.admissionPolicy;
      const permitted = !metadata?.pathHash || (validPolicy(policy, this.config.sourceRootHash) && metadata.policyId === policy.policyId && policy.allowedPathHashes.includes(metadata.pathHash));
      if (!envelope || envelope.eventId !== name.slice(0, -5) || !this.acceptScope(envelope) || !permitted) {
        this.counters.rejected++;
        if (!envelope || envelope.eventId !== name.slice(0, -5)) this.counters.schemaRejected++;
        else if (!this.acceptScope(envelope)) this.counters.scopeRejected++;
        else if (!permitted) this.counters.policyRejected++;
        await this.remove(name).catch(() => { this.counters.failures++; });
        continue;
      }
      try {
        const accepted = await this.journal.append(envelope);
        if (accepted.added) {
          this.counters.accepted++;
          records.push(accepted.record);
        }
        else if (accepted.expired) this.counters.expired++;
        else
          this.counters.duplicates++;
        if (afterDurable)
          await afterDurable();
        await this.remove(name, read);
      }
      catch {
        this.counters.failures++;
      }
    }
    // A completed empty sweep is already a bounded metadata observation. Health
    // may reuse its actual timestamp; it is never relabelled as a fresh scan.
    this.emptyQueue = wholeSweep && complete && !sawReady && !this.rescanRequested && this.watchAvailable
      ? {sample: {sampledAt: new Date().toISOString(), readyFiles: 0, oldestObservedAgeMs: 0, incomplete: false, scannedEntries}, noProducerLoss}
      : undefined;
    return records;
  }
  start(intervalMs = 250, watchNotifications = true): void {
    if(this.scopedReset)throw new Error('scoped-reset-only');
    if (this.closed || this.closing || this.timer || !Number.isInteger(intervalMs) || intervalMs < 50 || intervalMs > 5000)
      throw new Error('invalid-rescan-state');
    const wake = () => {
      if (this.closing || this.closed || this.pending) return;
      const scan = this.watchAvailable && this.emptyQueue?.sample.scannedEntries === 0 ? this.scanWatchedEmpty() : this.scan();
      void scan.then(records => {
        const emptyWatchedQueue = this.watchAvailable && records.length === 0 && !this.cursor;
        this.nextPollAt = Date.now() + (emptyWatchedQueue ? Math.max(intervalMs,1000) : intervalMs);
        if (this.rescanRequested) { this.rescanRequested = false; this.nextPollAt = 0; setImmediate(wake); }
      }).catch(() => { this.counters.failures++; this.nextPollAt = 0; });
    };
    this.timer = setInterval(() => { if (Date.now() >= this.nextPollAt) wake(); }, intervalMs);
    this.timer.unref();
    try {
      if (watchNotifications) {
        this.watcher = watch(this.inbox.path, (eventType, filename) => {
          if (typeof filename !== 'string') {this.emptyQueue = undefined;return;}
          // Opening/scanning a directory can itself generate metadata notices.
          // Immutable ready links need rename wakeups; polling covers unnamed
          // notifications and malformed/changed files without a self-wake loop.
          if (filename !== 'producer-loss.json' && (eventType !== 'rename' || !UUID_PATTERN.test(filename.replace(/\.json$/, '')) || !filename.endsWith('.json'))) return;
          this.emptyQueue = undefined;
          this.nextPollAt = 0; if(this.pending)this.rescanRequested = true;else wake();
        });
        this.watcher.unref();
        this.watchAvailable = true;
        this.watcher.on('error', () => { this.watchAvailable = false; this.nextPollAt = 0; this.counters.failures++; });
      }
    }
    catch {
      this.counters.failures++;
    }
    wake();
  }
  close(): Promise<void> {
    if (this.closeTask)
      return this.closeTask;
    this.closing = true;
    this.closeTask = this.finishClose();
    return this.closeTask;
  }
  async quiesce(): Promise<void> {
    this.closing = true;
    await this.stopBroker();
    this.watchAvailable = false;
    if (this.timer) clearInterval(this.timer);
    this.watcher?.close();
    await this.pending?.catch(() => {});
    await this.journal.whenIdle();
  }
  private async finishClose(): Promise<void> {
    try{await this.stopBroker();}catch{this.counters.failures++;}
    this.watchAvailable = false;
    if (this.timer)
      clearInterval(this.timer);
    this.watcher?.close();
    await this.pending?.catch(() => { });
    await this.journal.whenIdle();
    await this.cursor?.close().catch(() => { });
    this.cursor = undefined;
    try {
      await this.assertOwner();
      await unlink(join(this.root.path, 'collector.lock'));
      await this.root.sync();
    }
    catch { /* Never remove a lease whose ownership cannot be proven. */ }
    this.closed = true;
    await this.pinnedLease?.close();this.pinnedLease = undefined;
    await Promise.all([this.inbox.close(), this.history.close(), this.root.close()]);
  }
}
