// src/lib/maps/layers/types.ts
import type maplibregl from 'maplibre-gl';
import type { MapStyleKey } from '../map-style-switch';

export interface LayerContext {
  map: maplibregl.Map;
  styleKey: MapStyleKey;
  /** Incremented on each style switch. Check isCurrent() after each await. */
  generation: number;
  /** Returns false if a style switch happened since this context was created. */
  isCurrent(): boolean;
}

export interface MapLayer {
  /** Unique identifier for this layer instance. */
  id: string;
  /** Whether this layer has data to show (false = omit from controls). */
  hasContent: boolean;
  /** Add sources, layers, markers, listeners. Called on load and after style switch. */
  setup(ctx: LayerContext): void | Promise<void>;
  /** Remove everything: sources, layers, DOM markers, event listeners. Safe to call before setup. */
  teardown(map: maplibregl.Map): void;
  /** Toggle visibility. Undefined means this layer is not toggleable. */
  setVisible?(map: maplibregl.Map, visible: boolean): void;
  /** Bounds of this layer's data, for auto-fitting after setup. */
  getBounds?(): maplibregl.LngLatBounds | null;
}

export interface MapSession {
  /** The underlying MapLibre map instance. */
  map: maplibregl.Map;
  /** Register a layer. Must be called before start(). Returns self for chaining. */
  use(layer: MapLayer): MapSession;
  /** Get a registered layer by ID. */
  getLayer(id: string): MapLayer | undefined;
  /**
   * Start the session: wait for map load, run all layer setups, fit bounds.
   * Call after all use() calls.
   */
  start(): void;
}
