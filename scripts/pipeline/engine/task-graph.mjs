// scripts/pipeline/engine/task-graph.mjs
//
// Task graph runner with bounded concurrency for the bikepaths pipeline.
// See _ctx/pipeline-graph.md for the live phase graph (auto-generated).
// See docs/plans/2026-04-09-pipeline-tracing-refactor-design.md for design.

/**
 * Bounded counting semaphore. Used by the runner to cap concurrent
 * Overpass calls and to gate parallel step launches.
 */
export class Semaphore {
  constructor(permits) {
    this.permits = permits;
    this.queue = [];
  }

  async acquire() {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    this.permits++;
    if (this.queue.length > 0 && this.permits > 0) {
      this.permits--;
      const next = this.queue.shift();
      next();
    }
  }

  /** Acquire, run fn, release (even if fn throws). */
  async with(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
