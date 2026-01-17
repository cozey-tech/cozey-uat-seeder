import pLimit from "p-limit";

/**
 * Process items with controlled concurrency
 *
 * @param items - Array of items to process
 * @param handler - Async function to process each item
 * @param limit - Maximum number of concurrent operations (default: 5)
 * @returns Promise resolving to array of results in same order as input
 *
 * @example
 * ```ts
 * const results = await processWithConcurrency(
 *   [1, 2, 3, 4, 5],
 *   async (n) => n * 2,
 *   2 // Process 2 at a time
 * );
 * // Results: [2, 4, 6, 8, 10]
 * ```
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  handler: (item: T) => Promise<R>,
  limit: number = 5,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limiter = pLimit(limit);
  const promises = items.map((item) => limiter(() => handler(item)));

  try {
    return await Promise.all(promises);
  } catch (error) {
    // Re-throw with context if needed
    throw error;
  }
}
