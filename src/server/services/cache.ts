export class WeightedLRUCache<K, V> {
  private readonly cache = new Map<K, { value: V; weight: number }>();
  private retainedWeight = 0;
  private evictionCount = 0;
  private oversizedSkipCount = 0;

  constructor(
    private readonly maxSize: number,
    private readonly maxWeight: number,
    private readonly weigh: (value: V) => number,
  ) {}

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): boolean {
    const existing = this.cache.get(key);
    if (existing) {
      this.cache.delete(key);
      this.retainedWeight -= existing.weight;
    }

    const weight = this.weigh(value);
    if (weight > this.maxWeight) {
      this.oversizedSkipCount++;
      return false;
    }

    this.cache.set(key, { value, weight });
    this.retainedWeight += weight;
    while (
      this.cache.size > this.maxSize ||
      this.retainedWeight > this.maxWeight
    ) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      const evicted = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      this.retainedWeight -= evicted?.weight ?? 0;
      this.evictionCount++;
    }
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    this.retainedWeight -= entry.weight;
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.retainedWeight = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  get weight(): number {
    return this.retainedWeight;
  }

  get evictions(): number {
    return this.evictionCount;
  }

  get oversizedSkips(): number {
    return this.oversizedSkipCount;
  }

  *values(): IterableIterator<V> {
    for (const entry of this.cache.values()) yield entry.value;
  }
}
