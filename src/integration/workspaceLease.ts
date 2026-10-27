import { SecureDirectory } from '../transport/secureFs';
import { UUID_PATTERN } from '../transport/sourceValidation';
export type WorkspaceOwnership = 'unowned' | 'owned' | 'other-window' | 'recoverable' | 'uncertain';
export interface LeaseInspection { state: 'unowned' | 'other-window' | 'recoverable' | 'uncertain'; token?: string }
/** A PID that exists, or cannot be inspected, is never safe to steal. */
export async function inspectWorkspaceLease(path: string): Promise<LeaseInspection> {
  let root: SecureDirectory | undefined;
  try {
    root = await SecureDirectory.open(path);
    const read = await root.read('collector.lock', 512), lease = JSON.parse(read.bytes.toString('utf8'));
    if (!lease || Object.keys(lease).sort().join(',') !== 'leaseVersion,pid,token' || lease.leaseVersion !== 1 ||
      typeof lease.token !== 'string' || !UUID_PATTERN.test(lease.token) || !Number.isSafeInteger(lease.pid) || lease.pid <= 0 || read.info.nlink !== 1) return { state: 'uncertain' };
    try { process.kill(lease.pid, 0); return { state: 'other-window' }; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? { state: 'recoverable', token: lease.token } : { state: 'uncertain' }; }
  } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'unowned' } : { state: 'uncertain' }; }
  finally { await root?.close(); }
}
