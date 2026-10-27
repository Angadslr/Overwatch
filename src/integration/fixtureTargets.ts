import { createHash } from 'node:crypto';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURE_MARKER } from './probe';
import { LocalPaths } from '../adapters/localPaths';
import { FIXTURE_FILES, permittedPath } from '../core/privacy';
// T08 is deliberately limited to the already-qualified invented fixture names.
// General path policy lives in LocalPaths; native collection stays fixture-gated.
export { FIXTURE_FILES } from '../core/privacy';
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
  private paths: Promise<LocalPaths> | undefined;
  constructor(readonly root: string, private readonly exclusions: () => readonly string[] = () => []) {
    for (const name of FIXTURE_FILES) {
      for (const path of [name, join(root, name)]) {
        this.names.set(createHash('sha256').update('path-hint\0' + path).digest('hex'), name);
      }
    }
  }
  relativePath(hint: string): string | undefined {
    const name = this.names.get(hint);
    return name && permittedPath(name, this.exclusions()) ? name : undefined;
  }
  async resolve(hint: string): Promise<FixtureTarget> {
    const name = this.relativePath(hint);
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
      this.paths ??= LocalPaths.create('local-darwin-arm64', [{ path: this.root }]);
      const target = await (await this.paths).resolve(name);
      if (!target.ok || target.existence !== 'existing' || target.target.pathKind !== 'file')
        return { ok: false, reason: target.ok && target.existence === 'missing' ? 'missing' : 'unsafe' };
      return { ok: true, path, relativePath: name };
    }
    catch (error) {
      return { ok: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unsafe' };
    }
  }
}
