// scripts/pipeline/lib/pipeline-types.ts
//
// Shared types for the bikepaths pipeline. These describe the shapes of data
// that flow between pipeline phases — discover, assemble, resolve.
// Not an abstraction layer. Just the shapes.

import type { WayRegistry } from './way-registry.mjs';

/** Overpass query function — injected, not imported. Tests provide a cassette player. */
export type QueryOverpass = (query: string) => Promise<{ elements: any[] }>;

/** City adapter from lib/city-adapter.mjs */
export interface CityAdapter {
  relationNamePattern: string;
  namedWayQueries: (bbox: string) => Array<{ label: string; q: string }>;
  parallelLaneFilter?: (tags: Record<string, string>) => boolean;
  discoverNetworks?: boolean;
}

/** Input to buildBikepathsPipeline */
export interface PipelineOptions {
  queryOverpass: QueryOverpass;
  bbox: string;
  adapter: CityAdapter;
  manualEntries?: any[];
  markdownSlugs?: Set<string>;
  markdownOverrides?: Map<string, Record<string, any>>;
}

/** Output of buildBikepathsPipeline */
export interface PipelineResult {
  entries: any[];
  superNetworks: any[];
  slugMap: Map<any, string>;
  wayRegistry: WayRegistry;
}

/** Context passed between pipeline phases */
export interface PipelineContext {
  queryOverpass: QueryOverpass;
  bbox: string;
  adapter: CityAdapter;
}

/** A discovered OSM cycling relation (step 1 output) */
export interface OsmRelation {
  id: number;
  name: string;
  tags: Record<string, any>;
  _memberWayIds?: number[];
  _aggregatedWayTags?: Record<string, any>;
}

/** A discovered named way group (step 2 output) */
export interface NamedWayEntry {
  name: string;
  wayCount: number;
  tags: Record<string, any>;
  anchors: [number, number][];
  osmNames: string[];
  _ways?: any[][];
  _wayIds?: number[];
  _isUnnamedChain?: boolean;
}

/** A parallel lane candidate (step 2b output) */
export interface ParallelLaneCandidate {
  name: string;
  parallel_to: string;
  anchors: [number, number][];
  tags: Record<string, any>;
}

/** A non-cycling relation candidate (step 2d output) */
export interface NonCyclingCandidate {
  id: number;
  name: string;
  route: string;
  operator?: string;
  ref?: string;
  network?: string;
  bikeableWayIds: number[];
  bikeablePct: number;
}

/** Bundle of all discovery phase outputs */
export interface DiscoveredData {
  osmRelations: OsmRelation[];
  osmNamedWays: NamedWayEntry[];
  parallelLanes: ParallelLaneCandidate[];
  nonCyclingCandidates: NonCyclingCandidate[];
  relationBaseNames: Set<string>;
}
