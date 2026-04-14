// scripts/pipeline/engine/task-graph.ts
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
  private permits: number;
  private queue: Array<() => void>;

  constructor(permits: number) {
    this.permits = permits;
    this.queue = [];
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.permits++;
    if (this.queue.length > 0 && this.permits > 0) {
      this.permits--;
      const next = this.queue.shift()!;
      next();
    }
  }

  /** Acquire, run fn, release (even if fn throws). */
  async with<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export interface StepEvent {
  type: 'start' | 'done' | 'fail' | 'skip';
  step: string;
  ms?: number;
  error?: Error;
  reason?: string;
}

interface StepDef {
  name: string;
  deps: Record<string, string>;
  run: (inputs: Record<string, any>) => Promise<any>;
  star: boolean;
  produces?: string;
}

interface RunOptions {
  goal: string;
  context?: Record<string, any>;
  concurrency?: number;
  onEvent?: (event: StepEvent) => void;
}

/**
 * Directed acyclic task graph for the bikepaths pipeline.
 *
 * Define steps with explicit deps; run() topologically sorts and
 * executes them. With concurrency=1, steps run sequentially in topo
 * order. With concurrency>1, ready steps run in parallel up to the
 * concurrency limit.
 *
 * Each step's run function receives:
 *   - resolved deps as named keys (according to its `deps` map)
 *   - a `ctx` object with shared inputs (bbox, adapter, queryOverpass, trace, ...)
 */
export class TaskGraph {
  steps: Map<string, StepDef>;

  constructor() {
    this.steps = new Map();
  }

  /**
   * Register a step.
   */
  define({ name, deps = {}, run, star = false, produces }: {
    name: string;
    deps?: Record<string, string>;
    run: (inputs: Record<string, any>) => Promise<any>;
    star?: boolean;
    /** Human-readable output type shown as edge labels in the diagram. */
    produces?: string;
  }): void {
    if (this.steps.has(name)) {
      throw new Error(`Task graph: step "${name}" already defined`);
    }
    this.steps.set(name, { name, deps, run, star, produces });
  }

  /**
   * Execute the graph until `goal` resolves. Returns the goal's value.
   */
  async run({ goal, context = {}, concurrency = 4, onEvent }: RunOptions): Promise<any> {
    if (!this.steps.has(goal)) {
      throw new Error(`Task graph: goal "${goal}" not defined`);
    }

    // Topo sort from goal (cycle detection inside visit())
    const reachable = new Set<string>();
    const order: string[] = [];
    const visiting = new Set<string>();
    const visit = (name: string): void => {
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
    const wrappedContext: Record<string, any> = { ...context };
    if (typeof context.queryOverpass === 'function') {
      const base = context.queryOverpass;
      wrappedContext.queryOverpass = (q: string) => sem.with(() => base(q));
    }

    // Per-step state
    const status = new Map<string, 'pending' | 'running' | 'done' | 'failed'>();
    const values = new Map<string, any>();
    for (const name of reachable) status.set(name, 'pending');

    let inFlight = 0;
    const failures: Error[] = [];
    let resolveAll!: (value: any) => void;
    let rejectAll!: (reason: any) => void;
    const finished = new Promise<any>((res, rej) => { resolveAll = res; rejectAll = rej; });

    const checkDone = (): void => {
      const allTerminal = [...status.values()].every((s) => s === 'done' || s === 'failed');
      if (allTerminal && inFlight === 0) {
        if (status.get(goal) === 'failed') {
          rejectAll(failures[0] || new Error(`Task graph: goal "${goal}" failed`));
        } else {
          resolveAll(values.get(goal));
        }
      }
    };

    const launchReady = (): void => {
      let launched = false;
      for (const name of order) {
        if (status.get(name) !== 'pending') continue;
        const step = this.steps.get(name)!;

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

    const runStep = async (step: StepDef): Promise<void> => {
      const start = performance.now();
      onEvent?.({ type: 'start', step: step.name });
      try {
        const inputs: Record<string, any> = { ctx: wrappedContext };
        for (const [alias, depName] of Object.entries(step.deps)) {
          inputs[alias] = values.get(depName);
        }
        const value = await step.run(inputs);
        values.set(step.name, value);
        const end = performance.now();
        status.set(step.name, 'done');
        onEvent?.({ type: 'done', step: step.name, ms: end - start });
      } catch (err) {
        failures.push(err as Error);
        status.set(step.name, 'failed');
        const end = performance.now();
        onEvent?.({ type: 'fail', step: step.name, error: err as Error, ms: end - start });
      } finally {
        inFlight--;
        // Recurse to launch newly-ready steps
        launchReady();
      }
    };

    launchReady();
    return finished;
  }

  /**
   * Emit a representation of the graph for documentation.
   * Currently supports: 'mermaid' (graph TD syntax).
   * When steps declare `produces`, edges are labelled with the output type.
   */
  diagram({ format = 'mermaid' }: { format?: 'mermaid' } = {}): string {
    if (format !== 'mermaid') {
      throw new Error(`Task graph: unsupported diagram format "${format}"`);
    }
    const lines = ['graph TD'];
    // Node declarations with star annotation
    for (const [name, step] of this.steps) {
      const id = mermaidId(name);
      const label = step.star ? `${name} ★` : name;
      lines.push(`  ${id}["${label}"]`);
    }
    // Edges (with optional data-flow labels from the dependency's `produces`)
    for (const [name, step] of this.steps) {
      for (const depName of Object.values(step.deps)) {
        const depStep = this.steps.get(depName);
        const edgeLabel = depStep?.produces;
        if (edgeLabel) {
          lines.push(`  ${mermaidId(depName)} -->|"${edgeLabel}"| ${mermaidId(name)}`);
        } else {
          lines.push(`  ${mermaidId(depName)} --> ${mermaidId(name)}`);
        }
      }
    }
    return lines.join('\n');
  }
}

function mermaidId(name: string): string {
  // Mermaid node IDs can't contain dots; use underscores
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}
