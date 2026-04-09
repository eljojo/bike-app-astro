// scripts/pipeline/engine/overpass-pool.mjs
//
// Wraps a base queryOverpass function with a global semaphore so callers
// can fan out queries without exceeding the concurrency budget. Used by
// TaskGraph.run() to gate every Overpass call made by phase code.

import { Semaphore } from './task-graph.mjs';

/**
 * Create a semaphore-bounded queryOverpass.
 *
 * @param {(query: string) => Promise<{elements: any[]}>} baseQuery
 * @param {number} concurrency
 * @returns {(query: string) => Promise<{elements: any[]}>}
 */
export function createOverpassPool(baseQuery, concurrency) {
  const sem = new Semaphore(concurrency);
  return (query) => sem.with(() => baseQuery(query));
}
