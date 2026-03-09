import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { gunzipSync } from 'zlib';

// This script is used in local dev to tweak the map style

// Cunningham Island area: lat ~45.395, lng ~-75.735
// z14: x=4744, y=5866
// Check multiple zoom levels for same area
const tiles = [
  { z: 12, x: 1186, y: 1466 },  // z12 covering Bate Island area
  { z: 14, x: 4744, y: 5866 },  // z14 original
];
const port = process.argv[2] || '4322';

async function main() {
  for (const { z, x, y } of tiles) {
    const url = `http://localhost:${port}/api/tiles/thunderforest.outdoors-v2/${z}/${x}/${y}.vector.pbf`;
    console.log(`\n\n========== TILE z${z}/${x}/${y} ==========`);

    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const data = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
    const tile = new VectorTile(new Pbf(data));

    // Only show layers relevant to the island mystery
    for (const name of ['landcover', 'landuse', 'place-label']) {
      const layer = tile.layers[name];
      if (!layer) continue;
      console.log(`\n--- ${name} (${layer.length} features) ---`);
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const props: Record<string, unknown> = {};
        for (const k of Object.keys(f.properties)) props[k] = f.properties[k];
        // Only show green-relevant types and islands
        const t = (props.type as string) || (props.place as string) || '';
        if (['grass', 'grassland', 'meadow', 'heath', 'wood', 'forest', 'park', 'recreation_ground', 'common', 'garden', 'village_green', 'islet', 'island'].includes(t)) {
          console.log(`  [${i}] geomType=${f.type} area=${props.way_area}`, JSON.stringify(props));
        }
      }
    }
  }
}

main();
