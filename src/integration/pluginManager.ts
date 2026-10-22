import { access, lstat, mkdir, open, readFile, realpath, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { FIXTURE_MARKER, quotePosix, PROBE_HOOKS } from './probe';
import { SecureDirectory, sameFile } from '../transport/secureFs';
import { initializeSpool, SpoolIngester } from '../transport/spoolIngester';
import { normalizeJournalRecord } from '../adapters/cursorHooks';
import { FileActivityStore, type FileObservation } from '../core/reducers';
export type CleanupResult = 'removed' | 'not-installed' | 'modified-preserved';
export interface ManagerOptions {
  root: string;
  storage: string;
  helper: string;
  collectorId: string;
  eligibility: () => string | undefined;
  changed: () => void;
}
export class PluginManager {
  readonly store = new FileActivityStore();
  readonly evidence = new Map<string, FileObservation>();
  enabled = false;
  status = 'Collection off';
  lastCleanup: CleanupResult = 'not-installed';
  private ingester: SpoolIngester | undefined;
  private owned: {
    directory: SecureDirectory;
    bytes: string;
    inode: import('node:fs').Stats;
  } | undefined;
  private timer: NodeJS.Timeout | undefined;
  private cursor = 0;
  private replayEnd = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: ManagerOptions) { }
  private transition<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.queue.then(fn, fn);
    this.queue = task.catch(() => { });
    return task;
  }
  enable(): Promise<void> { return this.transition(() => this.enableOwned()); }
  disable(): Promise<CleanupResult> { return this.transition(() => this.disableOwned()); }
  private async enableOwned(): Promise<void> {
    const reason = this.options.eligibility();
    if (reason)
      throw new Error(reason);
    if (this.enabled)
      return;
    const { root, storage, helper, collectorId } = this.options;
    if (await realpath(root) !== root)
      throw new Error('noncanonical-fixture-root');
    const marker = await lstat(join(root, '.overwatch-probe-fixture'));
    if (!marker.isFile() || marker.isSymbolicLink() || marker.size > 128 || (await readFile(join(root, '.overwatch-probe-fixture'), 'utf8')).trim() !== FIXTURE_MARKER)
      throw new Error('invented-fixture-required');
    const helperInfo = await lstat(helper);
    if (!helperInfo.isFile() || helperInfo.isSymbolicLink())
      throw new Error('helper-unavailable');
    await access(helper, constants.X_OK);
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
    const config = await initializeSpool(storage, { collectorId, environmentId: 'local-darwin-arm64', workspaceId: rootHash }, root, false);
    this.ingester = await SpoolIngester.open(storage, config);
    try {
      const directoryPath = join(root, '.cursor');
      await mkdir(directoryPath, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        throw error; });
      const directory = await SecureDirectory.open(directoryPath, false);
      const command = (hook: string) => [helper, hook, storage].map(quotePosix).join(' ');
      const bytes = JSON.stringify({ version: 1, hooks: Object.fromEntries(PROBE_HOOKS.filter(h => h !== 'sessionEnd').map(h => [h, [{ command: command(h), timeout: 3 }]])) }, null, 2) + '\n';
      const temporary = join(directoryPath, `.overwatch-${randomUUID()}.tmp`);
      try {
        await directory.guard();
        const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        let inode: import('node:fs').Stats;
        try {
          await file.writeFile(bytes);
          await file.sync();
          inode = await file.stat();
        }
        finally {
          await file.close();
        }
        await directory.guard();
        await link(temporary, join(directoryPath, 'hooks.json'));
        this.owned = { directory, bytes, inode };
        await directory.sync();
      }
      finally {
        await unlink(temporary).catch(() => { });
        if (!this.owned)
          await directory.close();
      }
      await this.ingester.setPublisherEnabled(true);
      this.cursor = 0;
      this.replayEnd = this.ingester.journal.records.length;
      this.evidence.clear();
      this.enabled = true;
      this.status = 'Collector ready · waiting for native file activity';
      this.ingester.start();
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
      void this.disable().catch(() => { this.status = 'Collection cleanup could not complete'; this.options.changed(); });
      return;
    }
    const records = this.ingester?.journal.records;
    if (!records)
      return;
    let changed = false;
    const end = Math.min(records.length, this.cursor + 200);
    while (this.cursor < end) {
      const record = records[this.cursor++]!;
      const observation = normalizeJournalRecord(record);
      if (!observation)
        continue;
      if (this.store.apply(observation) || !this.evidence.has(observation.event.eventId))
        changed = true;
      this.evidence.set(observation.event.eventId, observation);
      while (this.evidence.size > 10000)
        this.evidence.delete(this.evidence.keys().next().value!);
    }
    if (changed) {
      this.status = records.length > this.replayEnd ? 'Native source activity · persistence and acceptance unverified' : 'History loaded · waiting for new native activity';
      this.options.changed();
    }
  }
  private async disableOwned(): Promise<CleanupResult> {
    if (this.timer)
      clearInterval(this.timer);
    this.timer = undefined;
    // Stop cached commands before removing the config or releasing the lease.
    if (this.ingester)
      await this.ingester.setPublisherEnabled(false);
    this.enabled = false;
    let cleanup: CleanupResult = 'not-installed';
    const owned = this.owned;
    if (owned) {
      try {
        const current = await owned.directory.read('hooks.json', 65536);
        if (sameFile(current.info, owned.inode) && current.bytes.toString('utf8') === owned.bytes) {
          await owned.directory.guard();
          await unlink(join(owned.directory.path, 'hooks.json'));
          await owned.directory.sync();
          cleanup = 'removed';
        }
        else
          cleanup = 'modified-preserved';
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          cleanup = 'modified-preserved';
      }
      await owned.directory.close();
      this.owned = undefined;
    }
    this.refresh();
    await this.ingester?.close();
    this.ingester = undefined;
    this.enabled = false;
    this.lastCleanup = cleanup;
    this.status = cleanup === 'modified-preserved' ? 'Collection off · modified hook configuration preserved' : 'Collection off · reload clears cached hook commands';
    this.options.changed();
    return cleanup;
  }
}
