/**
 * Run async work with at most `limit` tasks at once, preserving input order in
 * the result. Used for the CI sweep's rebase/repair agents: each takes ~20
 * minutes, and a burst of conflicting pull requests should not queue behind a
 * single agent while the owner watches the backlog grow.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("mapLimit: limit must be >= 1");
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
