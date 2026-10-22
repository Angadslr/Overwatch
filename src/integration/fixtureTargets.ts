import { createHash } from 'node:crypto';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURE_MARKER } from './probe';
// T08 is deliberately limited to the already-qualified invented fixture names.
// T10 owns general path policy, exclusions, symlinks and canonical file identity.
export const FIXTURE_FILES = ['read.txt', 'edit.txt', 'shared.txt', 'missing.txt', 'created.txt', 'renamed.txt'] as const;
export type FixtureTarget = {
  ok: true;
  path: string;
  relativePath: string;
} | {
  ok: false;
  reason: 'missing' | 'unsafe' | 'unresolved';
};
export class FixtureTargets {
  private readonly names = new Map<string, string>();
  constructor(readonly root: string) {
    for (const name of FIXTURE_FILES) {
      for (const path of [name, join(root, name)]) {
        this.names.set(createHash('sha256').update('path-hint\0' + path).digest('hex'), name);
      }
    }
  }
  relativePath(hint: string): string | undefined { return this.names.get(hint); }
  async resolve(hint: string): Promise<FixtureTarget> {
    const name = this.names.get(hint);
    if (!name)
      return { ok: false, reason: 'unresolved' };
    const path = join(this.root, name);
    try {
      if (await realpath(this.root) !== this.root)
        return { ok: false, reason: 'unsafe' };
      const markerPath = join(this.root, '.overwatch-probe-fixture');
      const marker = await lstat(markerPath);
      if (!marker.isFile() || marker.isSymbolicLink() || marker.size > 128 || (await readFile(markerPath, 'utf8')).trim() !== FIXTURE_MARKER)
        return { ok: false, reason: 'unsafe' };
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path)
        return { ok: false, reason: 'unsafe' };
      return { ok: true, path, relativePath: name };
    }
    catch (error) {
      return { ok: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unsafe' };
    }
  }
}
