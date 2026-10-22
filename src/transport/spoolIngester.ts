import { constants, watch, type FSWatcher, type Dir } from 'node:fs';
import { mkdir, open, unlink, lstat, opendir, realpath, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SecureDirectory, sameFile } from './secureFs';
import { Journal, type SourceJournalRecord } from './journal';
import { MAX_SOURCE_BYTES, OPAQUE_PATTERN, UUID_PATTERN, parseSource } from './sourceValidation';
import type { SourceEnvelopeV1 } from './sourceContracts';
export interface Scope {
  collectorId: string;
  environmentId: string;
  workspaceId: string;
  worktreeId?: string;
}
export interface PublisherConfig extends Scope {
  configVersion: 1;
  sourceRootHash: string;
  enabled: boolean;
}
interface Lease {
  leaseVersion: 1;
  token: string;
  pid: number;
}
/** Creates only private local storage. Source payloads cannot choose this path. */
export async function initializeSpool(path: string, scope: Scope, sourceWorkspaceRoot: string, initiallyEnabled = true): Promise<PublisherConfig> {
  for (const value of [scope.collectorId, scope.environmentId, scope.workspaceId, ...(scope.worktreeId === undefined ? [] : [scope.worktreeId])])
    if (typeof value !== 'string' || !OPAQUE_PATTERN.test(value))
      throw new Error('invalid-scope');
  if (await realpath(sourceWorkspaceRoot) !== sourceWorkspaceRoot)
    throw new Error('noncanonical-source-root');
  let config: PublisherConfig = { configVersion: 1, collectorId: scope.collectorId, environmentId: scope.environmentId, workspaceId: scope.workspaceId, ...(scope.worktreeId === undefined ? {} : { worktreeId: scope.worktreeId }), sourceRootHash: createHash('sha256').update('workspace-root\0' + sourceWorkspaceRoot).digest('hex'), enabled: initiallyEnabled };
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
      if (typeof previous.enabled !== 'boolean' || JSON.stringify(previous) !== JSON.stringify({ ...config, enabled: previous.enabled }))
        throw new Error('publisher-config-conflict');
      config = previous;
    }
    return config;
  }
  finally {
    await root.close();
  }
}
export class SpoolIngester {
  readonly counters = { accepted: 0, duplicates: 0, rejected: 0, failures: 0 };
  readonly journal: Journal;
  private cursor: Dir | undefined;
  private timer: NodeJS.Timeout | undefined;
  private watcher: FSWatcher | undefined;
  private pending: Promise<SourceJournalRecord[]> | undefined;
  private closed = false;
  private closing = false;
  private closeTask: Promise<void> | undefined;
  private constructor(private readonly root: SecureDirectory, private readonly inbox: SecureDirectory, private readonly history: SecureDirectory, private readonly config: PublisherConfig, private readonly lease: Lease, private readonly leaseBytes: Buffer) {
    this.journal = new Journal(history, () => this.assertOwner(), e => this.acceptScope(e));
  }
  static async open(path: string, config: PublisherConfig, recoverLeaseToken?: string): Promise<SpoolIngester> {
    const root = await SecureDirectory.open(path);
    let inbox: SecureDirectory | undefined, history: SecureDirectory | undefined, owner: SpoolIngester | undefined;
    try {
      const actual = (await root.read('publisher.json', 4096)).bytes;
      if (actual.toString('utf8') !== JSON.stringify(config))
        throw new Error('publisher-config-conflict');
      inbox = await SecureDirectory.open(join(path, 'inbox'));
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
      owner = new SpoolIngester(root, inbox, history, { ...config }, lease, leaseBytes);
      await owner.journal.load();
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
      (!m || (m.sourceVersion === '3.26.16' && m.sourceEvent !== 'sessionEnd' && m.workspaceRootHashes.includes(this.config.sourceRootHash)));
  }
  /** Only the lease owner can switch cached helper invocations on or off. */
  async setPublisherEnabled(enabled: boolean): Promise<void> {
    await this.assertOwner();
    const before = await this.root.read('publisher.json', 4096);
    if (before.bytes.toString('utf8') !== JSON.stringify(this.config)) throw new Error('publisher-config-conflict');
    const next = { ...this.config, enabled };
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
      this.config.enabled = enabled;
    } finally { await unlink(path).catch(() => {}); }
  }
  private async assertOwner(): Promise<void> {
    if (this.closed)
      throw new Error('collector-closed');
    const current = await this.root.read('collector.lock', 512);
    if (!current.bytes.equals(this.leaseBytes) || current.info.nlink !== 1)
      throw new Error('collector-ownership-lost');
    await this.inbox.guard();
    await this.history.guard();
  }
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
    if (this.pending)
      return this.pending;
    if (this.closed || this.closing)
      return Promise.reject(new Error('collector-closed'));
    this.pending = this.scanBatch(afterDurable).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async scanBatch(afterDurable?: () => Promise<void>): Promise<SourceJournalRecord[]> {
    await this.assertOwner();
    if (!this.cursor) {
      this.cursor = await opendir(this.inbox.path);
      await this.inbox.guard();
    }
    const records: SourceJournalRecord[] = [];
    let bytes = 0;
    for (let count = 0; count < 256 && bytes < 2 * 1024 * 1024; count++) {
      const entry = await this.cursor.read();
      if (!entry) {
        await this.cursor.close();
        this.cursor = undefined;
        break;
      }
      const name = entry.name;
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
      if (!envelope || envelope.eventId !== name.slice(0, -5) || !this.acceptScope(envelope)) {
        this.counters.rejected++;
        await this.remove(name).catch(() => { this.counters.failures++; });
        continue;
      }
      try {
        const accepted = await this.journal.append(envelope);
        if (accepted.added) {
          this.counters.accepted++;
          records.push(accepted.record);
        }
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
    return records;
  }
  start(intervalMs = 250, watchNotifications = true): void {
    if (this.closed || this.closing || this.timer || !Number.isInteger(intervalMs) || intervalMs < 50 || intervalMs > 5000)
      throw new Error('invalid-rescan-state');
    const wake = () => { if (!this.closing && !this.closed)
      void this.scan().catch(() => { this.counters.failures++; }); };
    this.timer = setInterval(wake, intervalMs);
    this.timer.unref();
    try {
      if (watchNotifications) {
        this.watcher = watch(this.inbox.path, wake);
        this.watcher.unref();
        this.watcher.on('error', () => { this.counters.failures++; });
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
  private async finishClose(): Promise<void> {
    if (this.timer)
      clearInterval(this.timer);
    this.watcher?.close();
    await this.pending?.catch(() => { });
    await this.cursor?.close().catch(() => { });
    this.cursor = undefined;
    try {
      await this.assertOwner();
      await unlink(join(this.root.path, 'collector.lock'));
      await this.root.sync();
    }
    catch { /* Never remove a lease whose ownership cannot be proven. */ }
    this.closed = true;
    await Promise.all([this.inbox.close(), this.history.close(), this.root.close()]);
  }
}
