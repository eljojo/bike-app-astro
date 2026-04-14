// scripts/pipeline/phases/_phase-types.ts
//
// Shared types for the bikepaths pipeline phases. Each phase is a pure
// async function with the signature:
//
//   async function phase(input, ctx): Promise<Output>
//
// where `ctx` carries the shared run-level state (Overpass client, trace,
// adapter, bbox) and `input` is whatever the phase declared in its deps.

import type { CityAdapter, QueryOverpass } from '../lib/pipeline-types.ts';

/** Bound trace function: `trace(subjectId, kind, data?)` — phase name baked in. */
export type TraceFn = (subjectId: string, kind: string, data?: object) => void;

/** Run-level shared context, available to every phase. */
export interface PhaseContext {
  bbox: string;
  adapter: CityAdapter;
  queryOverpass: QueryOverpass;
  trace: TraceFn;
}

/** Standard phase signature: takes inputs (deps + ctx), returns output. */
export type Phase<TInputs, TOutput> = (inputs: TInputs & { ctx: PhaseContext }) => Promise<TOutput>;
