export async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  let firstError: unknown = undefined;

  async function next(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      try {
        await fn(items[idx]);
      } catch (err) {
        if (firstError === undefined) firstError = err;
        // Stop picking up new items after first error
        i = items.length;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => next(),
  );
  // Always wait for all workers to drain (in-flight work completes)
  await Promise.all(workers);

  if (firstError !== undefined) throw firstError;
}
