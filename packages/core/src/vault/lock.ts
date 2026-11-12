/**
 * Async mutex keyed by string. With `global: true` every key shares one queue — the vault indexer
 * uses that, because indexing one file can adopt or delete task rows that another file owns
 * (anchors are vault-wide), so two files must never be indexed concurrently.
 */
export class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();
  constructor(private readonly opts: { global?: boolean } = {}) {}

  async run<T>(rawKey: string, fn: () => Promise<T>): Promise<T> {
    const key = this.opts.global ? "*" : rawKey;
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => gate);
    this.tails.set(key, tail);
    try {
      await prev.catch(() => undefined);
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
