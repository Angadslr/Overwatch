import type {SecureDirectory} from './secureFs';
import {atomicPrivateChunks, parseRetention, parseRetiredIdentity, HISTORY_POLICY, type RetentionManifest, type RetiredIdentity} from './retention';

type State = 'start' | 'key-first' | 'key-next' | 'colon' | 'value' | 'after-value' | 'retired-first' | 'retired-next' | 'retired-after' | 'done';
/** Fixed retention-v1 grammar. JSON.parse validates each bounded scalar/object;
 * the scanner only separates tokens and never retains the identity array. */
export class RetentionDecoder {
  private state: State = 'start';
  private key = '';
  private readonly keys = new Set<string>();
  private readonly header: Record<string, unknown> = {};
  private token = '';
  private tokenKind: 'key' | 'scalar' | 'identity' | undefined;
  private quoted = false;
  private escaped = false;
  private depth = 0;
  private count = 0;
  private maximumSequence = 0;
  constructor(private readonly limit: number, private readonly accept: (identity: RetiredIdentity) => void) {}
  private invalid(): never { throw new Error('retention-manifest-invalid'); }
  private emit(): void {
    let value: unknown;
    try {value = JSON.parse(this.token);} catch {this.invalid();}
    if (this.tokenKind === 'key') {
      if (typeof value !== 'string' || !['retentionVersion', 'firstSegment', 'firstSequence', 'expiredBefore', 'retired'].includes(value) || this.keys.has(value)) this.invalid();
      this.key = value;this.keys.add(value);this.state = 'colon';
    } else if (this.tokenKind === 'identity') {
      if (++this.count > this.limit) this.invalid();
      const identity = parseRetiredIdentity(value);
      this.maximumSequence = Math.max(this.maximumSequence, identity.sequence);this.accept(identity);this.state = 'retired-after';
    } else {this.header[this.key] = value;this.state = 'after-value';}
    this.token = '';this.tokenKind = undefined;this.quoted = false;this.escaped = false;this.depth = 0;
  }
  feed(text: string): void {
    for (let index = 0; index < text.length; index++) {
      const char = text[index]!;
      if (this.tokenKind) {
        if (!this.quoted && this.depth === 0 && /[ \t\r\n,}\]]/.test(char)) {this.emit();index--;continue;}
        this.token += char;if (this.token.length > 4096) this.invalid();
        if (this.quoted) {
          if (this.escaped) this.escaped = false;
          else if (char === '\\') this.escaped = true;
          else if (char === '"') {this.quoted = false;if (this.depth === 0) this.emit();}
        } else if (char === '"') this.quoted = true;
        else if (char === '{' || char === '[') {if (++this.depth > 8) this.invalid();}
        else if (char === '}' || char === ']') {if (--this.depth === 0) this.emit();}
        continue;
      }
      if (/[ \t\r\n]/.test(char)) continue;
      if (this.state === 'start') {if (char !== '{') this.invalid();this.state = 'key-first';}
      else if (this.state === 'key-first' || this.state === 'key-next') {
        if (char === '}' && this.state === 'key-first') this.state = 'done';
        else if (char === '"') {this.tokenKind = 'key';this.token = char;this.quoted = true;} else this.invalid();
      } else if (this.state === 'colon') {if (char !== ':') this.invalid();this.state = 'value';}
      else if (this.state === 'value') {
        if (this.key === 'retired') {if (char !== '[') this.invalid();this.state = 'retired-first';}
        else {if (char !== '"' && !/[0-9\-tfn]/.test(char)) this.invalid();this.tokenKind = 'scalar';this.token = char;this.quoted = char === '"';}
      } else if (this.state === 'after-value') {
        if (char === ',') this.state = 'key-next';else if (char === '}') this.state = 'done';else this.invalid();
      } else if (this.state === 'retired-first' || this.state === 'retired-next') {
        if (char === ']' && this.state === 'retired-first') this.state = 'after-value';
        else if (char === '{') {this.tokenKind = 'identity';this.token = char;this.depth = 1;} else this.invalid();
      } else if (this.state === 'retired-after') {
        if (char === ',') this.state = 'retired-next';else if (char === ']') this.state = 'after-value';else this.invalid();
      } else this.invalid();
    }
  }
  finish(): RetentionManifest {
    if (this.tokenKind || this.state !== 'done' || this.keys.size !== 5) this.invalid();
    const manifest = parseRetention({...this.header, retired: []}, this.limit);
    if (this.maximumSequence >= manifest.firstSequence) this.invalid();
    return manifest;
  }
}

export async function readRetentionStream(directory: SecureDirectory, limit: number, accept: (identity: RetiredIdentity) => void): Promise<RetentionManifest> {
  const file = await directory.file('retention.json');
  try {
    if (file.info.size > 24 * 1024 * 1024) throw new Error('retention-manifest-invalid');
    const decoder = new TextDecoder('utf-8', {fatal: true}), parser = new RetentionDecoder(limit, accept), buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < file.info.size) {
      const result = await file.handle.read(buffer, 0, Math.min(buffer.length, file.info.size - position), position);
      if (!result.bytesRead) throw new Error('history-file-changed');position += result.bytesRead;
      parser.feed(decoder.decode(buffer.subarray(0, result.bytesRead), {stream: true}));
    }
    parser.feed(decoder.decode());
    const after = await file.handle.stat();
    if (after.size !== file.info.size || after.mtimeMs !== file.info.mtimeMs || after.ctimeMs !== file.info.ctimeMs || after.nlink !== 1) throw new Error('history-file-changed');
    await directory.guard();return parser.finish();
  } finally {await file.handle.close();}
}

export async function writeRetentionStream(directory: SecureDirectory, manifest: RetentionManifest, identities: Iterable<RetiredIdentity>, ownsLease: () => Promise<void>): Promise<void> {
  const checked = parseRetention({...manifest, retired: []}, HISTORY_POLICY.tombstones);
  function* chunks(): IterableIterator<Uint8Array> {
    const {retired: ignored, ...header} = checked;
    let parts = [JSON.stringify(header).slice(0, -1) + ',"retired":['], bytes = Buffer.byteLength(parts[0]!), count = 0, total = 0;
    if (bytes > 4096) throw new Error('retention-manifest-invalid');
    for (const identity of identities) {
      parseRetiredIdentity(identity);if (identity.sequence >= checked.firstSequence || count >= HISTORY_POLICY.tombstones) throw new Error('retention-manifest-invalid');
      const part = (count++ ? ',' : '') + JSON.stringify(identity), length = Buffer.byteLength(part);
      if (length > 4096) throw new Error('retention-manifest-invalid');
      if (bytes + length > 64 * 1024) {const chunk = Buffer.from(parts.join(''));total += chunk.length;if (total > 24 * 1024 * 1024) throw new Error('retention-manifest-invalid');yield chunk;parts = [];bytes = 0;}
      parts.push(part);bytes += length;
    }
    parts.push(']}');const tail = Buffer.from(parts.join(''));if (total + tail.length > 24 * 1024 * 1024) throw new Error('retention-manifest-invalid');yield tail;
  }
  await atomicPrivateChunks(directory, 'retention.json', chunks(), ownsLease);
}
