import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { COLLECTION_MARKER } from './probe';

export interface FixtureDocument {
  uri: { fsPath: string; scheme: string };
  isDirty: boolean;
  version: number;
  getText(): string;
}

// Hashes compare invented bytes without retaining document contents or absolute paths.
export function createTimingRecorder(storage: string, root: string) {
  let count = 0;
  return (kind: 'open' | 'change' | 'save' | 'close', document: FixtureDocument): void => {
    if (count >= 500 || document.uri.scheme !== 'file') return;
    try {
      if (readFileSync(join(storage, 'collection.enabled'), 'utf8') !== COLLECTION_MARKER) return;
      const path = realpathSync(document.uri.fsPath);
      const target = relative(root, path);
      if (!/^(read|edit|shared|created|renamed)\.txt$/.test(target)) return;
      const buffer = Buffer.from(document.getText());
      const disk = readFileSync(path);
      const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
      appendFileSync(join(storage, 'timing.jsonl'), JSON.stringify({
        receivedAt: new Date().toISOString(), kind, target,
        dirty: document.isDirty, documentVersion: document.version,
        bufferHash: hash(buffer), diskHash: hash(disk), bufferMatchesDisk: buffer.equals(disk),
      }) + '\n', { mode: 0o600 });
      count++;
    } catch { /* Missing files and disabled telemetry must not affect editor actions. */ }
  };
}
