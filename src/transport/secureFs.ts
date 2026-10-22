import { constants, type Stats } from 'node:fs';
import { lstat, realpath, open, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
export const sameFile = (a: Stats, b: Stats): boolean => a.dev === b.dev && a.ino === b.ino;
export function privateNode(info: Stats): boolean {
  return typeof process.getuid === 'function' && info.uid === process.getuid() && (info.mode & 0o077) === 0;
}
export function safeName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name))
    throw new Error('invalid-storage-name');
}
/** Qualified local POSIX storage only. Descriptors pin checked inodes; path
 * identity is rechecked around operations. Same-user processes are not isolated. */
export class SecureDirectory {
  private constructor(readonly path: string, private readonly handle: FileHandle, private readonly info: Stats, private readonly requirePrivate: boolean) { }
  static async open(path: string, requirePrivate = true): Promise<SecureDirectory> {
    if (!isAbsolute(path) || await realpath(path) !== path)
      throw new Error('noncanonical-storage-root');
    const info = await lstat(path);
    if (!info.isDirectory() || !SecureDirectory.allowed(info, requirePrivate))
      throw new Error('unsafe-storage-directory');
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if (!sameFile(info, await handle.stat()))
        throw new Error('storage-directory-changed');
      return new SecureDirectory(path, handle, info, requirePrivate);
    }
    catch (error) {
      await handle.close();
      throw error;
    }
  }
  private static allowed(info: Stats, requirePrivate: boolean): boolean {
    return typeof process.getuid === 'function' && info.uid === process.getuid() &&
      (requirePrivate ? (info.mode & 0o077) === 0 : (info.mode & 0o022) === 0);
  }
  async guard(): Promise<void> {
    const now = await lstat(this.path);
    if (!now.isDirectory() || !SecureDirectory.allowed(now, this.requirePrivate) || !sameFile(this.info, now) || await realpath(this.path) !== this.path)
      throw new Error('storage-directory-changed');
  }
  async sync(): Promise<void> { await this.guard(); await this.handle.sync(); }
  async close(): Promise<void> { await this.handle.close(); }
  async file(name: string, flags = constants.O_RDONLY): Promise<{
    handle: FileHandle;
    info: Stats;
  }> {
    safeName(name);
    await this.guard();
    const path = join(this.path, name), before = await lstat(path);
    if (!before.isFile() || !privateNode(before))
      throw new Error('unsafe-storage-file');
    const handle = await open(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || !privateNode(info) || !sameFile(before, info))
        throw new Error('storage-file-changed');
      await this.guard();
      return { handle, info };
    }
    catch (error) {
      await handle.close();
      throw error;
    }
  }
  async read(name: string, max: number): Promise<{
    bytes: Buffer;
    info: Stats;
  }> {
    const { handle, info } = await this.file(name);
    try {
      if (info.size > max)
        throw new Error('storage-file-too-large');
      const buffer = Buffer.alloc(max + 1);
      let used = 0;
      while (used < buffer.length) {
        const read = await handle.read(buffer, used, buffer.length - used, null);
        if (!read.bytesRead)
          break;
        used += read.bytesRead;
      }
      const after = await handle.stat();
      if (used > max || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs)
        throw new Error('storage-file-changed');
      await this.guard();
      return { bytes: buffer.subarray(0, used), info };
    }
    finally {
      await handle.close();
    }
  }
}
