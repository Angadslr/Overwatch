import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SecureDirectory } from './secureFs';
import { sameFile } from './secureFs';
import type { SourceEnvelopeV1 } from './sourceContracts';

export interface HistoryPolicy { segmentBytes: number; historyBytes: number; records: number; ageMs: number; tombstones: number }
export const HISTORY_POLICY: HistoryPolicy = { segmentBytes: 5 * 1024 * 1024, historyBytes: 100 * 1024 * 1024, records: 100000, ageMs: 7 * 86400000, tombstones: 100000 };
export interface RetiredIdentity { id: string; digest: string; sequence: number; receivedAt: string }
export interface RetentionManifest { retentionVersion: 1; firstSegment: number; firstSequence: number; expiredBefore: string; retired: RetiredIdentity[] }
export function historyPolicy(input: Partial<HistoryPolicy> = {}): HistoryPolicy {
  const p = { ...HISTORY_POLICY, ...input };
  if (!Object.values(p).every(Number.isSafeInteger) || p.segmentBytes < 1024 || p.segmentBytes > HISTORY_POLICY.segmentBytes || p.historyBytes < p.segmentBytes || p.historyBytes > HISTORY_POLICY.historyBytes || Math.ceil(p.historyBytes / p.segmentBytes) > 20 ||
    p.records < 1 || p.records > HISTORY_POLICY.records || p.ageMs < 1 || p.ageMs > HISTORY_POLICY.ageMs || p.tombstones < 1 || p.tombstones > HISTORY_POLICY.tombstones) throw new Error('invalid-history-policy');
  return p;
}
export const envelopeDigest = (e: SourceEnvelopeV1): string => createHash('sha256').update(JSON.stringify(e)).digest('hex');
export async function removePrivateFile(directory: SecureDirectory, name: string, ownsLease: () => Promise<void>): Promise<void> {
  let file;
  try { file = await directory.file(name); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const info = file.info; await file.handle.close();
  if (info.nlink !== 1) throw new Error('unsafe-history-file');
  await ownsLease(); await directory.guard(); if (!sameFile(info, await lstat(join(directory.path, name)))) throw new Error('history-file-changed');
  await unlink(join(directory.path, name));
}
export async function atomicPrivateJson(directory: SecureDirectory, name: string, value: unknown, ownsLease: () => Promise<void>): Promise<void> {
  await atomicPrivateBytes(directory,name,Buffer.from(JSON.stringify(value)),ownsLease);
}
export async function atomicPrivateBytes(directory: SecureDirectory, name: string, bytes:Uint8Array, ownsLease: () => Promise<void>): Promise<void> {
  const temporary = `history-${randomUUID()}.tmp`, path = join(directory.path, temporary);
  await ownsLease(); await directory.guard();
  let created:import('node:fs').Stats|undefined;
  try{const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {created=await file.stat();await file.writeFile(bytes); await file.sync();}finally{await file.close();}
    await ownsLease(); await directory.guard(); await rename(path, join(directory.path, name)); await directory.sync();
  }finally{if(created){const current=await lstat(path).catch(()=>undefined);if(current&&sameFile(created,current))await unlink(path).catch(()=>{});}}
}
export function parseRetention(value: unknown, limit: number): RetentionManifest {
  const m = value as RetentionManifest;
  if (!m || Object.keys(m).sort().join(',') !== 'expiredBefore,firstSegment,firstSequence,retentionVersion,retired' || m.retentionVersion !== 1 ||
    !Number.isSafeInteger(m.firstSegment) || m.firstSegment < 0 || m.firstSegment > 999999 || !Number.isSafeInteger(m.firstSequence) || m.firstSequence < 1 ||
    typeof m.expiredBefore !== 'string' || !Number.isFinite(Date.parse(m.expiredBefore)) || !Array.isArray(m.retired) || m.retired.length > limit) throw new Error('retention-manifest-invalid');
  const ids = new Set<string>();
  for (const item of m.retired) {
    if (!item || Object.keys(item).sort().join(',') !== 'digest,id,receivedAt,sequence' || typeof item.id !== 'string' || !/^[0-9a-f-]{36}$/.test(item.id) || ids.has(item.id) ||
      typeof item.digest !== 'string' || !/^[0-9a-f]{64}$/.test(item.digest) || !Number.isSafeInteger(item.sequence) || item.sequence < 1 || item.sequence >= m.firstSequence ||
      typeof item.receivedAt !== 'string' || !Number.isFinite(Date.parse(item.receivedAt))) throw new Error('retention-manifest-invalid');
    ids.add(item.id);
  }
  return m;
}
