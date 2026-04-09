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

    // Topo sort from goal (cycle detection inside visit())
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

    // Wrap context.queryOverpass with a global semaphore so in-step
    // Promise.all calls also respect the concurrency budget.
    const sem = new Semaphore(concurrency);
    const wrappedContext = { ...context };
    if (typeof context.queryOverpass === 'function') {
      const base = context.queryOverpass;
      wrappedContext.queryOverpass = (q) => sem.with(() => base(q));
    }

    // Per-step state
    const status = new Map();
    const values = new Map();
    for (const name of reachable) status.set(name, 'pending');

    let inFlight = 0;
    const failures = [];
    let resolveAll;
    let rejectAll;
    const finished = new Promise((res, rej) => { resolveAll = res; rejectAll = rej; });

    const checkDone = () => {
      const allTerminal = [...status.values()].every((s) => s === 'done' || s === 'failed');
      if (allTerminal && inFlight === 0) {
        if (status.get(goal) === 'failed') {
          rejectAll(failures[0] || new Error(`Task graph: goal "${goal}" failed`));
        } else {
          resolveAll(values.get(goal));
        }
      }
    };

    const launchReady = () => {
      let launched = false;
      for (const name of order) {
        if (status.get(name) !== 'pending') continue;
        const step = this.steps.get(name);

        // Skip if any dep failed
        const anyDepFailed = Object.values(step.deps).some((d) => status.get(d) === 'failed');
        if (anyDepFailed) {
          status.set(name, 'failed');
          onEvent?.({ type: 'skip', step: name, reason: 'dep failed' });
          launched = true;
          continue;
        }

        const allDepsDone = Object.values(step.deps).every((d) => status.get(d) === 'done');
        if (!allDepsDone) continue;

        if (inFlight >= concurrency) break;

        status.set(name, 'running');
        inFlight++;
        launched = true;
        runStep(step);
      }
      // After this round of launches, check whether everything is done
      if (launched || inFlight === 0) checkDone();
    };

    const runStep = async (step) => {
      const start = performance.now();
      onEvent?.({ type: 'start', step: step.name });
      try {
        const inputs = { ctx: wrappedContext };
        for (const [alias, depName] of Object.entries(step.deps)) {
          inputs[alias] = values.get(depName);
        }
        const value = await step.run(inputs);
        values.set(step.name, value);
        const end = performance.now();
        status.set(step.name, 'done');
        onEvent?.({ type: 'done', step: step.name, ms: end - start });
      } catch (err) {
        failures.push(err);
        status.set(step.name, 'failed');
        const end = performance.now();
        onEvent?.({ type: 'fail', step: step.name, error: err, ms: end - start });
      } finally {
        inFlight--;
        // Recurse to launch newly-ready steps
        launchReady();
      }
    };

    launchReady();
    return finished;
  }
}
