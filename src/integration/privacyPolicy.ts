import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FIXTURE_FILES, permittedPath, privacyExclusions } from '../core/privacy';

export interface PrivacyPolicy { privacyVersion: 1; policyId: string; allowedPathHashes: string[] }
export const pathHint = (path: string): string => createHash('sha256').update('path-hint\0' + path).digest('hex');
export function policyDigest(rootHash: string, hashes: readonly string[]): string {
  return createHash('sha256').update(['privacy-v1', rootHash, ...hashes].join('\0')).digest('hex');
}
export function fixturePolicy(root: string, sourceRootHash: string, input: unknown = []): PrivacyPolicy {
  const exclusions = privacyExclusions(input);
  const allowedPathHashes = FIXTURE_FILES.filter(name => permittedPath(name, exclusions)).flatMap(name => [pathHint(name), pathHint(join(root, name))]).sort();
  return { privacyVersion: 1, policyId: policyDigest(sourceRootHash, allowedPathHashes), allowedPathHashes };
}
export function validPolicy(input: { privacyVersion?: 1 | undefined; policyId?: string | undefined; allowedPathHashes?: string[] | undefined }, sourceRootHash: string): input is PrivacyPolicy {
  const hashes = input.allowedPathHashes;
  return input.privacyVersion === 1 && Array.isArray(hashes) && hashes.length <= 12 && hashes.every(h => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) &&
    new Set(hashes).size === hashes.length && [...hashes].sort().join() === hashes.join() && input.policyId === policyDigest(sourceRootHash, hashes);
}
