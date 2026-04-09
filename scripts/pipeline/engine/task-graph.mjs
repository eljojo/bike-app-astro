// scripts/pipeline/engine/task-graph.mjs
//
// Task graph runner with bounded concurrency for the bikepaths pipeline.
// See _ctx/pipeline-graph.md for the live phase graph (auto-generated).
// See docs/plans/2026-04-09-pipeline-tracing-refactor-design.md for design.

import { performance } from 'node:perf_hooks';

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

/**
 * Directed acyclic task graph for the bikepaths pipeline.
 *
 * Define steps with explicit deps; run() topologically sorts and
 * executes them. With concurrency=1, steps run sequentially in topo
 * order. With concurrency>1, ready steps run in parallel up to the
 * limit (added in a later task).
 *
 * Each step's run function receives:
 *   - resolved deps as named keys (according to its `deps` map)
 *   - a `ctx` object with shared inputs (bbox, adapter, queryOverpass, trace, ...)
 */
export class TaskGraph {
  constructor() {
    /** @type {Map<string, {name: string, deps: Record<string,string>, run: Function, star: boolean}>} */
    this.steps = new Map();
  }

  /**
   * Register a step.
   * @param {object} opts
   * @param {string} opts.name unique step name
   * @param {Record<string, string>} [opts.deps] alias → step name
   * @param {(inputs: object) => Promise<any>} opts.run async fn called with resolved deps + ctx
   * @param {boolean} [opts.star] mark as a star bug-cluster boundary (for diagram annotation)
   */
  define({ name, deps = {}, run, star = false }) {
    if (this.steps.has(name)) {
      throw new Error(`Task graph: step "${name}" already defined`);
    }
    this.steps.set(name, { name, deps, run, star });
  }

  /**
   * Execute the graph until `goal` resolves. Returns the goal's value.
   * @param {object} opts
   * @param {string} opts.goal terminal step name
   * @param {object} opts.context shared inputs (bbox, adapter, queryOverpass, trace, ...)
   * @param {number} [opts.concurrency=4] global limit on parallel steps
   * @param {(event: object) => void} [opts.onEvent] step lifecycle hook
   */
  async run({ goal, context = {}, concurrency = 4, onEvent }) {
    if (!this.steps.has(goal)) {
      throw new Error(`Task graph: goal "${goal}" not defined`);
    }

    // Topo sort from goal — only run reachable steps
    const reachable = new Set();
    const order = [];
    const visiting = new Set();
    const visit = (name) => {
      if (reachable.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Task graph: cycle detected at "${name}"`);
      }
      visiting.add(name);
      const step = this.steps.get(name);
      if (!step) {
        throw new Error(`Task graph: step "${name}" referenced but not defined`);
      }
      for (const depName of Object.values(step.deps)) visit(depName);
      visiting.delete(name);
      reachable.add(name);
      order.push(name);
    };
    visit(goal);

    // Sequential execution: just walk topo order, await each step
    const values = new Map();
    for (const name of order) {
      const step = this.steps.get(name);
      const inputs = { ctx: context };
      for (const [alias, depName] of Object.entries(step.deps)) {
        inputs[alias] = values.get(depName);
      }
      const start = performance.now();
      onEvent?.({ type: 'start', step: name });
      const value = await step.run(inputs);
      const end = performance.now();
      onEvent?.({ type: 'done', step: name, ms: end - start });
      values.set(name, value);
    }

    return values.get(goal);
  }
}
