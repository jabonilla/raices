/**
 * In-memory OutboxStore for tests. Behaves like AsyncStorage (async,
 * string-only) without the native module.
 */
export class InMemoryOutboxStore {
  private readonly data = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    await Promise.resolve();
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await Promise.resolve();
    this.data.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.data.delete(key);
    await Promise.resolve();
  }
}
