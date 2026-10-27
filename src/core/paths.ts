/** Local POSIX policy only; filesystem observation belongs to the local adapter. */
export type PathRejection = 'invalid' | 'external' | 'excluded' | 'unavailable' | 'root-changed' | 'ambiguous-root';

export function validLocalPath(value: string): boolean {
  return value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f\\]/.test(value) &&
    !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.split('/').includes('..');
}

export function containsPath(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root === '/' ? '/' : root + '/');
}

export function validRelativePath(value: string): boolean {
  return value.length <= 1024 && validLocalPath(value) && !value.startsWith('/') &&
    !value.split('/').some(part => part === '' || part === '.');
}

function globMatches(pattern: string, value: string): boolean {
  pattern = pattern.toLowerCase();
  value = value.toLowerCase();
  let previous = new Uint8Array(value.length + 1);
  previous[0] = 1;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    let kind: 'literal' | 'one' | 'star' | 'all' | 'directories' = c === '*' ? 'star' : c === '?' ? 'one' : 'literal';
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { i++; kind = 'directories'; }
      else kind = 'all';
    }
    const current = new Uint8Array(value.length + 1);
    if (kind === 'star' || kind === 'all' || kind === 'directories') current[0] = previous[0]!;
    let directoryStart = false;
    for (let j = 1; j <= value.length; j++) {
      const character = value[j - 1]!;
      if (kind === 'directories') {
        directoryStart ||= previous[j - 1] === 1;
        current[j] = previous[j] || (directoryStart && character === '/' ? 1 : 0);
      } else if (kind === 'all' || kind === 'star')
        current[j] = previous[j] || ((kind === 'all' || character !== '/') ? current[j - 1]! : 0);
      else current[j] = previous[j - 1] && (kind === 'one' ? character !== '/' : character === c) ? 1 : 0;
    }
    previous = current;
  }
  return previous[value.length] === 1;
}

export function validateExclusions(patterns: readonly string[]): void {
  if (patterns.length > 100 || patterns.some(p => !validLocalPath(p) || p.startsWith('/') || p.length > 256))
    throw new Error('invalid-path-exclusions');
}

export function excludedPath(relative: string, patterns: readonly string[] = []): boolean {
  const parts = relative.split('/');
  if (parts.some(p => /^(?:\.git|\.local|\.cursor|\.secrets?|secrets?|\.ssh|\.aws|\.azure|\.kube|\.gnupg|\.npmrc|\.pypirc|\.netrc)$/i.test(p) ||
    /^\.env/i.test(p) || /\.(?:pem|key|p12|pfx)$/i.test(p) ||
    /^(?:id_rsa|id_ed25519|credentials(?:\..*)?|secrets?(?:\..*)?)$/i.test(p))) return true;
  return patterns.some(p => globMatches(p, relative) || (!p.includes('/') && parts.some(part => globMatches(p, part))));
}
