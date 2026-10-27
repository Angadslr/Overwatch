import { createHash } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { containsPath, excludedPath, validLocalPath, validRelativePath, validateExclusions, type PathRejection } from '../core/paths';
import type { EventTarget } from '../core/contracts';

type PathInfo = Pick<import('node:fs').Stats, 'dev' | 'ino' | 'isFile' | 'isDirectory' | 'isSymbolicLink'>;
export interface LocalPathFilesystem {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<PathInfo>;
  lstat(path: string): Promise<PathInfo>;
}
const localFilesystem: LocalPathFilesystem = { realpath, stat, lstat };

export interface LocalRootInput { path: string; worktreeId?: string }
export interface LocalRoot {
  path: string;
  workspaceId: string;
  worktreeId?: string;
  device: number;
  inode: number;
}
export type LocalTarget = {
  ok: true;
  root: LocalRoot;
  path: string;
  relativePath: string;
  existence: 'existing' | 'missing';
  displayPath: string;
  canonicalized: boolean;
  target: EventTarget;
} | { ok: false; reason: PathRejection; target: EventTarget };

const digest = (values: unknown[]): string => createHash('sha256').update(JSON.stringify(values)).digest('hex');
const rejected = (reason: PathRejection): LocalTarget => ({ ok: false, reason,
  target: { pathScope: reason === 'external' || reason === 'excluded' ? 'external-redacted' : 'unresolved', pathKind: 'unknown' } });

/** Resolves local paths without reading file bytes or persisting absolute paths.
 * Keys identify canonical locations, not inode lifetime or saved byte versions. */
export class LocalPaths {
  private constructor(readonly environmentId: string, readonly roots: readonly LocalRoot[], private readonly exclusions: readonly string[], private readonly filesystem: LocalPathFilesystem) {}

  static async create(environmentId: string, inputs: readonly LocalRootInput[], exclusions: readonly string[] = [], filesystem: LocalPathFilesystem = localFilesystem): Promise<LocalPaths> {
    if (!environmentId || environmentId.length > 256 || inputs.length < 1 || inputs.length > 32)
      throw new Error('invalid-local-path-scope');
    validateExclusions(exclusions);
    const roots: LocalRoot[] = [];
    for (const input of inputs) {
      if (!validLocalPath(input.path) || !isAbsolute(input.path) ||
        (input.worktreeId !== undefined && (!input.worktreeId || input.worktreeId.length > 256))) throw new Error('invalid-local-root');
      const path = await filesystem.realpath(input.path);
      if (!validLocalPath(path) || !isAbsolute(path)) throw new Error('invalid-local-root');
      const info = await filesystem.stat(path);
      if (!info.isDirectory()) throw new Error('invalid-local-root');
      const existing = roots.find(r => r.path === path);
      if (existing) {
        if (existing.worktreeId !== input.worktreeId) throw new Error('ambiguous-local-root');
        continue;
      }
      roots.push({ path, workspaceId: createHash('sha256').update('workspace\0' + path).digest('hex'), device: info.dev, inode: info.ino,
        ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }) });
    }
    roots.sort((a, b) => b.path.length - a.path.length);
    return new LocalPaths(environmentId, Object.freeze(roots.map(r => Object.freeze(r))), Object.freeze([...exclusions]), filesystem);
  }

  private async rootsUnchanged(): Promise<boolean> {
    for (const root of this.roots) {
      const info = await this.filesystem.lstat(root.path);
      if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== root.device || info.ino !== root.inode ||
        await this.filesystem.realpath(root.path) !== root.path) return false;
    }
    return true;
  }

  async resolve(input: string, baseRootId?: string): Promise<LocalTarget> {
    if (!validLocalPath(input)) return rejected('invalid');
    const base = baseRootId === undefined ? (this.roots.length === 1 ? this.roots[0] : undefined)
      : this.roots.find(r => r.workspaceId === baseRootId);
    if (!isAbsolute(input) && !base) return rejected('ambiguous-root');
    const lexical = resolve(base?.path ?? '/', input);
    const lexicalRoot = this.roots.find(r => containsPath(r.path, lexical));
    if (!lexicalRoot) return rejected('external');
    if (excludedPath(relative(lexicalRoot.path, lexical), this.exclusions)) return rejected('excluded');
    try {
      if (!await this.rootsUnchanged()) return rejected('root-changed');
      // Resolve the deepest existing ancestor; a missing child never inherits a physical key.
      let ancestor = lexical;
      const missing: string[] = [];
      let canonical: string;
      while (true) {
        try { canonical = await this.filesystem.realpath(ancestor); break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          // A dangling symlink is unresolved, not an ordinary missing child.
          try { if ((await this.filesystem.lstat(ancestor)).isSymbolicLink()) return rejected('unavailable'); }
          catch (entryError) { if ((entryError as NodeJS.ErrnoException).code !== 'ENOENT') throw entryError; }
          const parent = dirname(ancestor);
          if (parent === ancestor) return rejected('unavailable');
          missing.unshift(relative(parent, ancestor));
          ancestor = parent;
        }
      }
      const canonicalPath = join(canonical, ...missing);
      const root = this.roots.find(r => containsPath(r.path, canonicalPath));
      if (!root) return rejected('external');
      // A symlink crossing between collection roots is not evidence for the other root.
      if (root.path !== lexicalRoot.path) return rejected('external');
      const relativePath = relative(root.path, canonicalPath).split('\\').join('/');
      if (!validRelativePath(relativePath)) return rejected('unavailable');
      if (excludedPath(relativePath, this.exclusions)) return rejected('excluded');
      if (!await this.rootsUnchanged()) return rejected('root-changed');
      if (missing.length) {
        if (!(await this.filesystem.stat(canonical)).isDirectory() || await this.filesystem.realpath(canonical) !== canonical)
          return rejected('unavailable');
        return { ok: true, root: { ...root }, path: canonicalPath, relativePath, displayPath: relative(lexicalRoot.path, lexical), existence: 'missing', canonicalized: canonicalPath !== lexical,
          target: { pathScope: 'unresolved', pathKind: 'unknown' } };
      }
      const info = await this.filesystem.stat(canonicalPath);
      if (!info.isFile() && !info.isDirectory()) return rejected('unavailable');
      const finalInfo = await this.filesystem.lstat(canonicalPath);
      if (finalInfo.isSymbolicLink() || finalInfo.dev !== info.dev || finalInfo.ino !== info.ino ||
        await this.filesystem.realpath(canonicalPath) !== canonicalPath || !await this.rootsUnchanged()) return rejected('unavailable');
      return { ok: true, root: { ...root }, path: canonicalPath, relativePath, displayPath: relative(lexicalRoot.path, lexical), existence: 'existing', canonicalized: canonicalPath !== lexical,
        target: { pathScope: 'workspace', pathKind: info.isFile() ? 'file' : 'directory', relativePath,
          fileKey: digest(['local-file-v1', this.environmentId, root.path, root.worktreeId ?? null, canonicalPath]) } };
    } catch { return rejected('unavailable'); }
  }

  async rename(from: string, to: string, baseRootId?: string): Promise<{ source: LocalTarget; destination: LocalTarget; target: EventTarget }> {
    const source = await this.resolve(from, baseRootId);
    const destination = await this.resolve(to, baseRootId);
    const sameRoot = source.ok && destination.ok && source.root.path === destination.root.path;
    return { source, destination, target: { ...source.target, renameDestination: sameRoot || !destination.ok
      ? { ...destination.target } : { pathScope: 'unresolved', pathKind: 'unknown' } } };
  }
}
