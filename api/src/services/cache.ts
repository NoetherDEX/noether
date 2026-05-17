/**
 * Tiny TTL cache used by route handlers to coalesce expensive reads.
 * Not LRU-bounded — caller scopes are small (a handful of keys per
 * service). Replace if/when scope grows.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>();
  constructor(private readonly defaultTtlMs: number) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs?: number): void {
    this.entries.set(key, { value, expires: Date.now() + (ttlMs ?? this.defaultTtlMs) });
  }

  async getOrLoad(key: string, load: () => Promise<V>, ttlMs?: number): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await load();
    this.set(key, value, ttlMs);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
