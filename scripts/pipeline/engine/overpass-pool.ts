// scripts/pipeline/engine/overpass-pool.ts
//
// Wraps a base queryOverpass function with a global semaphore so callers
// can fan out queries without exceeding the concurrency budget.

import { Semaphore } from './task-graph.ts';

type QueryFn = (query: string) => Promise<{ elements: any[] }>;

/**
 * Create a semaphore-bounded queryOverpass.
 */
export function createOverpassPool(baseQuery: QueryFn, concurrency: number): QueryFn {
  const sem = new Semaphore(concurrency);
  return (query) => sem.with(() => baseQuery(query));
}
