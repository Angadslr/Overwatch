import { mkdir, writeFile, realpath, readFile, link, unlink, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type { PluginApi } from '../host/capabilities';

export const PERMISSION_HOOKS = ['preToolUse', 'beforeReadFile', 'beforeShellExecution', 'beforeMCPExecution', 'subagentStart'] as const;
export const PROBE_HOOKS = ['sessionStart', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'beforeReadFile', 'afterFileEdit', 'beforeShellExecution', 'afterShellExecution', 'beforeMCPExecution', 'afterMCPExecution', 'subagentStart', 'subagentStop', 'stop', 'sessionEnd'] as const;
export type ProbeHook = typeof PROBE_HOOKS[number];
export const FIXTURE_MARKER = 'overwatch-invented-fixture-v1';
export const COLLECTION_MARKER = 'overwatch-probe-enabled-v1';

export function quotePosix(value: string): string {
  if (value.includes('\0') || /[\r\n]/.test(value)) throw new Error('invalid-launcher-path');
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export async function isFixture(root: string): Promise<boolean> {
  try {
    return (await readFile(join(root, '.overwatch-probe-fixture'), 'utf8')).trim() === FIXTURE_MARKER;
  } catch { return false; }
}

export function buildHookConfig(nodePath: string, helperPath: string, storage: string, root: string) {
  for (const path of [nodePath, helperPath, storage, root]) {
    if (!isAbsolute(path)) throw new Error('absolute-launcher-path-required');
  }
  return {
    version: 1,
    hooks: Object.fromEntries(PROBE_HOOKS.map(event => [event, [{
      command: [nodePath, helperPath, storage, root, event].map(quotePosix).join(' '),
      timeout: 3,
    }]])),
  };
}

export class NativeProbe {
  private registeredPath: string | undefined;
  private storage: string | undefined;
  constructor(private readonly api: PluginApi) {}

  async enable(storage: string, root: string, nodePath: string, helperPath: string): Promise<string> {
    if (this.registeredPath) return this.registeredPath;
    if (!await isFixture(root)) throw new Error('invented-fixture-workspace-required');
    const canonicalRoot = await realpath(root);
    const pluginRoot = join(storage, 'plugin source with spaces', 'overwatch-native-probe');
    await mkdir(join(pluginRoot, '.cursor-plugin'), { recursive: true, mode: 0o700 });
    await mkdir(join(pluginRoot, 'hooks'), { recursive: true, mode: 0o700 });
    await mkdir(join(storage, 'inbox'), { recursive: true, mode: 0o700 });
    await writeFile(join(pluginRoot, '.cursor-plugin', 'plugin.json'), JSON.stringify({
      name: 'overwatch-native-probe', version: '0.0.1', description: 'Local native hook feasibility probe', hooks: './hooks/hooks.json',
    }, null, 2), { mode: 0o600 });
    await writeFile(join(pluginRoot, 'hooks', 'hooks.json'), JSON.stringify(buildHookConfig(nodePath, helperPath, storage, canonicalRoot), null, 2), { mode: 0o600 });
    // Register the containing source directory, as in Cursor's documented extension example.
    const source = join(storage, 'plugin source with spaces');
    await writeFile(join(storage, 'collection.enabled'), COLLECTION_MARKER, { mode: 0o600 });
    try { this.api.registerPath(source); }
    catch (error) { await unlink(join(storage, 'collection.enabled')).catch(() => {}); throw error; }
    this.registeredPath = source;
    this.storage = storage;
    return source;
  }

  disable(): boolean {
    if (!this.registeredPath) return false;
    if (this.storage) {
      try { unlinkSync(join(this.storage, 'collection.enabled')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    this.api.unregisterPath(this.registeredPath);
    this.registeredPath = undefined;
    this.storage = undefined;
    return true;
  }
}

export class ProjectHookProbe {
  private installed: { path: string; bytes: string; storage: string } | undefined;

  async enable(storage: string, root: string, nodePath: string, helperPath: string): Promise<void> {
    if (this.installed) return;
    if (!await isFixture(root)) throw new Error('invented-fixture-workspace-required');
    const canonicalRoot = await realpath(root);
    const directory = join(canonicalRoot, '.cursor');
    const target = join(directory, 'hooks.json');
    const bytes = JSON.stringify(buildHookConfig(nodePath, helperPath, storage, canonicalRoot), null, 2) + '\n';
    await mkdir(storage, { recursive: true, mode: 0o700 });
    await mkdir(join(storage, 'inbox'), { recursive: true, mode: 0o700 });
    // The exact proposed configuration is available for review before publication.
    await writeFile(join(storage, 'project-hooks.proposed.json'), bytes, { mode: 0o600 });
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('unsafe-project-hook-directory');
    const temporary = join(directory, `.overwatch-${randomUUID()}.tmp`);
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try {
      // Atomic exclusive publication: an existing config, including a racing creator, always wins.
      await link(temporary, target);
      this.installed = { path: target, bytes, storage };
      try { await writeFile(join(storage, 'collection.enabled'), COLLECTION_MARKER, { mode: 0o600 }); }
      catch (error) { await unlink(target); this.installed = undefined; throw error; }
    } finally { await unlink(temporary).catch(() => {}); }
  }

  async disable(): Promise<'removed' | 'not-installed' | 'modified-preserved'> {
    if (!this.installed) return 'not-installed';
    const owned = this.installed;
    try { await unlink(join(owned.storage, 'collection.enabled')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let current: string;
    try { current = await readFile(owned.path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.installed = undefined; return 'not-installed'; }
      throw error;
    }
    if (current !== owned.bytes) return 'modified-preserved';
    await unlink(owned.path);
    this.installed = undefined;
    return 'removed';
  }
}
