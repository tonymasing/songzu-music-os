// Cache discovery only. Audio jobs still validate their actual inputs/runtime.
export function createEngineProbeCache<T>(ttlMs = 30_000, now = () => Date.now()) {
  let current: { key: string; expires: number; value?: T; pending?: Promise<T> } | undefined;
  return async (key: string, probe: () => Promise<T>): Promise<T> => {
    if (current?.key === key) {
      if (current.pending) return structuredClone(await current.pending);
      if (current.expires > now()) return structuredClone(current.value as T);
    }
    const entry: NonNullable<typeof current> = { key, expires: 0 };
    current = entry;
    entry.pending = Promise.resolve().then(probe);
    try {
      const value = await entry.pending;
      entry.value = structuredClone(value);
      entry.expires = now() + ttlMs;
      return structuredClone(value);
    } catch (error) {
      if (current === entry) current = undefined;
      throw error;
    } finally {
      entry.pending = undefined;
    }
  };
}
