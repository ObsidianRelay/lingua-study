interface VersionedAsyncCacheEntry<T> {
  version: string;
  value: Promise<T>;
}

/**
 * 保存少量可重复使用的异步计算结果。
 * 同一个键的版本变化后会重新计算，失败的 Promise 不会污染后续重试。
 */
export class VersionedAsyncCache<T> {
  private readonly entries = new Map<string, VersionedAsyncCacheEntry<T>>();

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("异步缓存容量必须是大于 0 的整数。");
    }
  }

  getOrCreate(key: string, version: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing?.version === version) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.value;
    }

    this.entries.delete(key);
    while (this.entries.size >= this.limit) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
    }

    const value = factory();
    const entry = { version, value };
    this.entries.set(key, entry);
    void value.catch(() => {
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
      }
    });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
