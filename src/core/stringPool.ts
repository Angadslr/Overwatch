/** Per-journal bounded sharing of immutable JSON strings. No global cache:
 * releasing the owning journal releases its pool and old scoped identifiers. */
export function internDataStrings(value: object, pool: Map<string, string>): void {
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const child = record[key];
    if (typeof child === 'string') {
      const existing = pool.get(child);
      if (existing === child) record[key] = existing;
      else if (pool.size < 512) pool.set(child, child);
    } else if (child !== null && typeof child === 'object') internDataStrings(child, pool);
  }
}
