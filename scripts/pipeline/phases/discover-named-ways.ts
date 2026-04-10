// scripts/pipeline/phases/discover-named-ways.ts
//
// Phase 2: discover named cycling ways from OSM. Runs the adapter's
// named-way queries in parallel (bounded by the runner semaphore on
// queryOverpass), fetches junction ways connected via shared nodes,
// splits same-named ways by real-geometry connectivity, builds clusters,
// and absorbs small typo-variant fragments into larger entries.
//
// Deterministic ordering: sorts fetched ways by ID and post-build entries
// by name so parallel fetch order doesn't affect cluster output.
//
// Pure async function: (input, ctx) => NamedWayEntry[].

import type { NamedWayEntry } from '../lib/pipeline-types.ts';
import type { Phase } from './_phase-types.ts';
import { mergeWayTags } from '../lib/osm-tags.ts';
import { haversineM } from '../lib/geo.mjs';
import { isSkiOnlyWay } from '../lib/ski-filter.ts';
import { splitWaysByConnectivity } from '../lib/way-connectivity.ts';
import { namesAreSimilar } from '../lib/name-similarity.ts';
import { slugifyBikePathName as slugify } from '../../../src/lib/bike-paths/bikepaths-yml.server.ts';

export const discoverNamedWaysPhase: Phase<{}, NamedWayEntry[]> = async ({ ctx }) => {
  console.log('Discovering named cycling ways from OSM...');
  const namedWayQueries = ctx.adapter.namedWayQueries(ctx.bbox);

  // Fire all adapter queries in parallel (bounded by runner semaphore)
  const results = await Promise.all(
    namedWayQueries.map(async ({ label, q }) => {
      try {
        const data = await ctx.queryOverpass(q);
        console.log(`  ${label}: ${data.elements.length} ways`);
        return data.elements;
      } catch (err: any) {
        console.error(`  ${label}: failed (${err.message})`);
        return [];
      }
    }),
  );
  let allWayElements: any[] = results.flat();

  // Note: Promise.all preserves input array order in its output, so
  // results.flat() yields the same order as the old sequential push loop.
  // Do NOT sort by ID — the junction query below joins these IDs into its
  // string, and the cassette key depends on that exact string. Sorting would
  // produce a different query string and trigger a cassette miss in tests.

  // Trace every discovered way (before filtering)
  for (const w of allWayElements) {
    if (w.id) {
      ctx.trace(`way:${w.id}`, 'discovered', { name: w.tags?.name, via: 'named-query' });
    }
  }

  // Filter ski-only ways from named-way ingestion. Defensive — the Ottawa
  // adapter's queries already require bicycle=designated|yes for highway=path,
  // but this catches any future adapter that's looser, and any highway=cycleway
  // tagged bicycle=no.
  const preSkiFilter = allWayElements.length;
  allWayElements = allWayElements.filter((w: any) => {
    if (isSkiOnlyWay(w.tags)) {
      if (w.id) ctx.trace(`way:${w.id}`, 'filtered', { reason: 'ski-only' });
      return false;
    }
    return true;
  });
  if (allWayElements.length < preSkiFilter) {
    console.log(`  Dropped ${preSkiFilter - allWayElements.length} ski-only ways`);
  }

  const waysByName = new Map<string, any[]>();
  for (const el of allWayElements) {
    const name = el.tags?.name;
    if (!name) continue;
    if (!waysByName.has(name)) waysByName.set(name, []);
    waysByName.get(name)!.push(el);
  }

  // Fetch non-cycling junction ways that share nodes with cycling ways.
  // Trails in parks connect through hiking-only segments (bicycle:no).
  const cyclingWayIds = allWayElements.filter((e: any) => e.id).map((e: any) => e.id);
  const allWaysByName = new Map<string, any[]>();
  if (cyclingWayIds.length > 0) {
    const junctionQ = `[out:json][timeout:180];
way(id:${cyclingWayIds.join(',')});
node(w);
way(bn)["name"]["highway"~"path|footway|cycleway"](${ctx.bbox});
out geom tags;`;
    try {
      const junctionData = await ctx.queryOverpass(junctionQ);
      const cyclingIdSet = new Set(cyclingWayIds);
      for (const el of junctionData.elements) {
        if (el.type !== 'way') continue;
        if (cyclingIdSet.has(el.id)) continue;
        const name = el.tags?.name;
        if (!name) continue;
        if (!allWaysByName.has(name)) allWaysByName.set(name, []);
        allWaysByName.get(name)!.push(el);
      }

      let junctionCount = 0;
      let skippedSkiClusters = 0;
      for (const [name, ways] of allWaysByName) {
        if (waysByName.has(name)) continue;
        // Don't promote ski-only junction-way clusters to standalone entries.
        // Example: "Piste 12" in Parc de la Gatineau is a Nordic ski trail
        // (highway=path piste:type=nordic, no bicycle tag) that shares a node
        // with Trail #3 (a real MTB trail). Without this guard, the junction
        // query promotes it into bikepaths.yml as a destination page.
        // The ways stay in allWaysByName so same-named cycling clusters can
        // still pick up genuine junction connectivity below.
        if (ways.every((w: any) => isSkiOnlyWay(w.tags))) {
          skippedSkiClusters++;
          for (const w of ways) {
            if (w.id) {
              ctx.trace(`way:${w.id}`, 'filtered', {
                reason: 'all-cluster-ski-only',
                clusterName: name,
              });
            }
          }
          continue;
        }
        const anchors: any[] = [];
        for (const w of ways) {
          if (w.geometry?.length >= 2) {
            anchors.push([w.geometry[0].lon, w.geometry[0].lat]);
            anchors.push([w.geometry[w.geometry.length - 1].lon, w.geometry[w.geometry.length - 1].lat]);
          }
        }
        if (anchors.length > 0) {
          waysByName.set(name, ways);
          junctionCount++;
        }
      }
      if (junctionCount > 0) console.log(`  Found ${junctionCount} non-cycling junction trails`);
      if (skippedSkiClusters > 0) console.log(`  Skipped ${skippedSkiClusters} ski-only junction-way clusters`);
    } catch (err: any) {
      console.error(`  Junction ways fetch failed: ${err.message}`);
    }
  }

  // Build named way entries. Split same-named ways that are geographically
  // far apart — "Trail 20" in the Greenbelt (45.32°N) and "Trail 20" in
  // Gatineau Park (45.52°N) are different trails that happen to share a name.
  const osmNamedWays: NamedWayEntry[] = [];
  for (const [name, ways] of waysByName) {
    // Split same-named ways into connected components using real geometry.
    // Shared OSM nodes + 100m endpoint snap. OVRT (one continuous trail)
    // stays one entry. Trail 20 in different parks stays separate.
    const wayClusters = splitWaysByConnectivity(ways);

    for (const clusterWays of wayClusters) {
      const anchors: [number, number][] = [];
      for (const w of clusterWays) {
        if (w.geometry?.length >= 2) {
          anchors.push([w.geometry[0].lon, w.geometry[0].lat]);
          anchors.push([w.geometry[w.geometry.length - 1].lon, w.geometry[w.geometry.length - 1].lat]);
        } else if (w.center) {
          anchors.push([w.center.lon, w.center.lat]);
        }
      }
      if (anchors.length === 0) continue;

      // Include junction ways that share nodes or have endpoints near
      // THIS cluster's ways (not all junction ways with the same name).
      const clusterNodeIds = new Set(clusterWays.flatMap((w: any) => w.nodes || []));
      const junctionWays = (allWaysByName.get(name) || []).filter((jw: any) => {
        if (jw.nodes?.some((n: any) => clusterNodeIds.has(n))) return true;
        if (!jw.geometry?.length) return false;
        const jwEps = [jw.geometry[0], jw.geometry[jw.geometry.length - 1]];
        for (const cw of clusterWays) {
          if (!cw.geometry?.length) continue;
          const cwEps = [cw.geometry[0], cw.geometry[cw.geometry.length - 1]];
          for (const a of jwEps) {
            for (const b of cwEps) {
              const dlat = (a.lat - b.lat) * 111320;
              const dlng = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
              if (dlat * dlat + dlng * dlng < 10000) return true; // 100m
            }
          }
        }
        return false;
      });

      const seenIds = new Set<number>();
      const combinedWays: any[] = [];
      for (const w of [...clusterWays, ...junctionWays]) {
        if (!w.geometry?.length || w.geometry.length < 2) continue;
        if (w.id && seenIds.has(w.id)) continue;
        if (w.id) seenIds.add(w.id);
        combinedWays.push(w.geometry);
      }

      osmNamedWays.push({
        name,
        wayCount: clusterWays.length,
        tags: mergeWayTags(clusterWays),
        anchors,
        osmNames: [name],
        _ways: combinedWays.length > 0
          ? combinedWays
          : clusterWays.filter((w: any) => w.geometry?.length >= 2).map((w: any) => w.geometry),
        _wayIds: clusterWays.filter((w: any) => w.id).map((w: any) => w.id),
      });
    }
  }

  // Note: do NOT sort osmNamedWays here. The absorb-fragments loop's
  // "first similar larger entry wins" semantics depend on the iteration
  // order matching the legacy sequential adapter-query order. Promise.all
  // already preserves that order in `results.flat()` above, and we kept the
  // same waysByName insertion path, so osmNamedWays naturally matches the
  // legacy ordering. Adding a sort would change which fragments get absorbed
  // into which entries.

  // Merge small fragments into nearby larger entries with similar names.
  // "Voie Verte de Chelsea" (0.2km) is a typo variant of "Voie Verte Chelsea"
  // (22km). Relative to the trail length, the fragment is insignificant.
  // Absorb it: merge its _ways into the larger entry and drop it.
  const absorbed = new Set<number>();
  for (let i = 0; i < osmNamedWays.length; i++) {
    const small = osmNamedWays[i];
    if (absorbed.has(i)) continue;
    for (let j = 0; j < osmNamedWays.length; j++) {
      if (i === j || absorbed.has(j)) continue;
      const large = osmNamedWays[j];
      if (large.wayCount <= small.wayCount) continue;
      if (small.name === large.name) continue;
      if (slugify(small.name) === slugify(large.name)) continue;
      if (!namesAreSimilar(small.name, large.name)) continue;
      if (!small.anchors?.length || !large.anchors?.length) continue;
      if (haversineM(small.anchors[0], large.anchors[0]) > 10000) continue;
      if (small.wayCount > large.wayCount * 0.2) continue;
      large._ways = [...(large._ways || []), ...(small._ways || [])];
      large.anchors = [...large.anchors, ...small.anchors];
      ctx.trace(`entry:${slugify(small.name)}`, 'absorbed', { absorbedInto: large.name });
      absorbed.add(i);
      break;
    }
  }
  if (absorbed.size > 0) {
    const before = osmNamedWays.length;
    for (const idx of [...absorbed].sort((a, b) => b - a)) {
      osmNamedWays.splice(idx, 1);
    }
    console.log(`  Merged ${absorbed.size} small fragments into larger entries (${before} → ${osmNamedWays.length})`);
  }

  // Trace each surviving entry as discovered
  for (const entry of osmNamedWays) {
    ctx.trace(`entry:${slugify(entry.name)}`, 'discovered', {
      wayCount: entry.wayCount,
      source: 'named-way',
    });
  }

  console.log(`  Found ${osmNamedWays.length} named cycling ways`);
  return osmNamedWays;
};
