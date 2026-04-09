// Browser-safe — no .server.ts, no Node APIs

import type { RoutingWaypoint } from './routing';

export interface DirectionsParseResult {
  waypoints: RoutingWaypoint[];
  travelMode: 'cycling' | 'walking' | 'driving' | 'transit' | null;
}

const TRAVEL_MODES: Record<string, DirectionsParseResult['travelMode']> = {
  '0': 'driving',
  '1': 'cycling',
  '2': 'transit',
  '3': 'walking',
};

const COORD_PATTERN = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

/**
 * Check if a URL is a Google Maps Directions URL.
 */
export function isGoogleDirectionsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!parsed.hostname.endsWith('google.com')) return false;
  return parsed.pathname.startsWith('/maps/dir/');
}

/**
 * Normalize a full Google Maps place address to a short name.
 * Takes text before the first comma.
 */
export function normalizeStopName(fullAddress: string): string {
  const commaIndex = fullAddress.indexOf(',');
  const name = commaIndex === -1 ? fullAddress : fullAddress.slice(0, commaIndex);
  return name.trim();
}

/**
 * Decode a Google Maps URL path segment.
 * Handles both percent-encoding (%20) and plus-encoding (+).
 */
function decodePathSegment(segment: string): string {
  // Replace + with space before decodeURIComponent (which only handles %XX)
  return decodeURIComponent(segment.replace(/\+/g, ' '));
}

/**
 * Parse a Google Maps Directions URL into waypoints and travel mode.
 * Returns null for non-directions URLs.
 *
 * The `data=` parameter uses an undocumented `!`-delimited format.
 * All data param parsing is wrapped in try/catch — if it fails,
 * we fall back to path-only waypoints where named stops get NaN coords.
 */
export function parseGoogleDirectionsUrl(url: string): DirectionsParseResult | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!parsed.hostname.endsWith('google.com')) return null;
  if (!parsed.pathname.startsWith('/maps/dir/')) return null;

  // Extract path segments after /maps/dir/
  const pathAfterDir = parsed.pathname.slice('/maps/dir/'.length);
  const rawSegments = pathAfterDir.split('/').filter(Boolean);

  // Decode and filter out viewport (@-prefixed) and data= segments
  const segments = rawSegments
    .map((s) => decodePathSegment(s))
    .filter((s) => !s.startsWith('@') && !s.startsWith('data=') && !/^[a-z]+=/.test(s));

  if (segments.length === 0) return null;

  // Classify path segments
  const pathWaypoints: Array<{
    type: 'stop' | 'via';
    name?: string;
    lat: number;
    lng: number;
  }> = segments.map((segment) => {
    if (COORD_PATTERN.test(segment)) {
      const [lat, lng] = segment.split(',').map(Number);
      return { type: 'via', lat, lng };
    }
    return { type: 'stop', name: normalizeStopName(segment), lat: NaN, lng: NaN };
  });

  // Try to parse the data= parameter for coordinates, shaping points, and travel mode
  try {
    const dataParam = extractDataParam(parsed);
    if (dataParam) {
      return parseWithData(pathWaypoints, dataParam);
    }
  } catch {
    // Fall through to path-only
  }

  // Path-only fallback
  return { waypoints: buildPathOnlyWaypoints(pathWaypoints), travelMode: null };
}

/**
 * Extract the data= parameter value from the URL.
 * It can appear in the query string or in the path (after /data=).
 */
function extractDataParam(parsed: URL): string | null {
  // Check query string first
  const fromQuery = parsed.searchParams.get('data');
  if (fromQuery) return fromQuery;

  // Check if it's embedded in the path (e.g., .../data=!3m1!4b1!4m21...)
  // The pathname may contain the data= segment directly
  const pathSegments = parsed.pathname.split('/');
  for (const seg of pathSegments) {
    if (seg.startsWith('data=')) {
      return seg.slice('data='.length);
    }
  }

  return null;
}

/**
 * Google's data param uses a proto-like encoding: `!NtV` where N is the field number,
 * t is the type (m=message, d=double, s=string, b=bool, e=enum, i=int), V is the value.
 * For messages, `!NmC` means field N is a message with C sub-fields following it.
 *
 * We parse the flat token stream into a tree, then extract waypoint blocks from it.
 */
interface ProtoNode {
  field: number;
  type: string;
  value: string | number | boolean | ProtoNode[];
}

/**
 * Parse a range of tokens into ProtoNode array.
 * `NmC` means "field N is a message, the next C **tokens** belong to it."
 * Other tokens (Nd, Ns, Ne, Nb, Ni) are leaf nodes consuming 1 token each.
 */
function parseProtoTokens(tokens: string[], start: number, tokenBudget: number): { nodes: ProtoNode[]; consumed: number } {
  const nodes: ProtoNode[] = [];
  let i = start;
  const end = start + tokenBudget;

  while (i < tokens.length && i < end) {
    const token = tokens[i];
    const match = token.match(/^(\d+)([a-z])(.*)$/);
    if (!match) {
      i++;
      continue;
    }

    const field = parseInt(match[1], 10);
    const type = match[2];
    const rest = match[3];

    if (type === 'm') {
      // Message: rest is the number of TOKENS that follow as children
      const childTokenCount = parseInt(rest, 10);
      const { nodes: children } = parseProtoTokens(tokens, i + 1, childTokenCount);
      nodes.push({ field, type: 'm', value: children });
      // Skip the 1 token for this NmC header + childTokenCount tokens for children
      i = i + 1 + childTokenCount;
    } else if (type === 'd') {
      nodes.push({ field, type: 'd', value: parseFloat(rest) });
      i++;
    } else if (type === 'e') {
      nodes.push({ field, type: 'e', value: parseInt(rest, 10) });
      i++;
    } else if (type === 'b') {
      nodes.push({ field, type: 'b', value: rest === '1' });
      i++;
    } else {
      // s, i, or other string types
      nodes.push({ field, type, value: rest });
      i++;
    }
  }

  return { nodes, consumed: i - start };
}

function findChildren(nodes: ProtoNode[], field: number): ProtoNode[] {
  return nodes.filter((n) => n.field === field);
}

function findChild(nodes: ProtoNode[], field: number): ProtoNode | undefined {
  return nodes.find((n) => n.field === field);
}

interface DataBlock {
  lat?: number;
  lng?: number;
  shapingPoints: Array<{ lat: number; lng: number }>;
}

function parseWithData(
  pathWaypoints: Array<{ type: 'stop' | 'via'; name?: string; lat: number; lng: number }>,
  dataParam: string,
): DirectionsParseResult {
  const tokens = dataParam.split('!').filter(Boolean);
  const { nodes } = parseProtoTokens(tokens, 0, tokens.length);

  let travelMode: DirectionsParseResult['travelMode'] = null;

  // Travel mode is field 3, type e, at the waypoint container level
  // Find the 4m container (field 4, message)
  const outerContainer = findChild(nodes, 4);
  if (!outerContainer || outerContainer.type !== 'm') {
    return { waypoints: buildPathOnlyWaypoints(pathWaypoints), travelMode };
  }

  const outerChildren = outerContainer.value as ProtoNode[];
  const innerContainer = findChild(outerChildren, 4);
  if (!innerContainer || innerContainer.type !== 'm') {
    return { waypoints: buildPathOnlyWaypoints(pathWaypoints), travelMode };
  }

  const waypointNodes = innerContainer.value as ProtoNode[];

  // Extract travel mode from field 3, type e
  const modeNode = findChild(waypointNodes, 3);
  if (modeNode && modeNode.type === 'e') {
    travelMode = TRAVEL_MODES[String(modeNode.value)] ?? null;
  }

  // Extract waypoint blocks (field 1, message)
  const blocks: DataBlock[] = [];
  const blockNodes = findChildren(waypointNodes, 1);

  for (const blockNode of blockNodes) {
    if (blockNode.type !== 'm') continue;
    const children = blockNode.value as ProtoNode[];

    if (children.length === 0) {
      // Empty block — bare-coordinate via
      blocks.push({ shapingPoints: [] });
      continue;
    }

    const block: DataBlock = { shapingPoints: [] };

    // Coordinates are in field 2 (message with 2 children: 1d=lng, 2d=lat)
    const coordNode = findChild(children, 2);
    if (coordNode && coordNode.type === 'm') {
      const coordChildren = coordNode.value as ProtoNode[];
      const lngNode = findChild(coordChildren, 1);
      const latNode = findChild(coordChildren, 2);
      if (lngNode && lngNode.type === 'd') block.lng = lngNode.value as number;
      if (latNode && latNode.type === 'd') block.lat = latNode.value as number;
    }

    // Shaping points are in field 3 (message with 4 children)
    // Pattern: 3m4 containing 1m2 (with 1d=lng, 2d=lat) and 3s (place ref)
    const shapingNodes = findChildren(children, 3);
    for (const shapingNode of shapingNodes) {
      if (shapingNode.type !== 'm') continue;
      const shapingChildren = shapingNode.value as ProtoNode[];
      const innerCoord = findChild(shapingChildren, 1);
      if (innerCoord && innerCoord.type === 'm') {
        const innerChildren = innerCoord.value as ProtoNode[];
        const sLng = findChild(innerChildren, 1);
        const sLat = findChild(innerChildren, 2);
        if (sLng && sLng.type === 'd' && sLat && sLat.type === 'd') {
          block.shapingPoints.push({
            lng: sLng.value as number,
            lat: sLat.value as number,
          });
        }
      }
    }

    blocks.push(block);
  }

  // Merge data blocks with path waypoints
  const waypoints: RoutingWaypoint[] = [];

  for (let idx = 0; idx < pathWaypoints.length; idx++) {
    const pw = pathWaypoints[idx];
    const block = idx < blocks.length ? blocks[idx] : undefined;

    if (block) {
      if (pw.type === 'stop') {
        waypoints.push({
          lat: block.lat ?? pw.lat,
          lng: block.lng ?? pw.lng,
          type: 'stop',
          name: pw.name,
        });
      } else {
        waypoints.push({ lat: pw.lat, lng: pw.lng, type: 'via' });
      }

      // Add shaping points after this waypoint
      for (const sp of block.shapingPoints) {
        waypoints.push({ lat: sp.lat, lng: sp.lng, type: 'shaping' });
      }
    } else {
      if (pw.type === 'stop') {
        waypoints.push({ lat: pw.lat, lng: pw.lng, type: 'stop', name: pw.name });
      } else {
        waypoints.push({ lat: pw.lat, lng: pw.lng, type: 'via' });
      }
    }
  }

  return { waypoints, travelMode };
}

function buildPathOnlyWaypoints(
  pathWaypoints: Array<{ type: 'stop' | 'via'; name?: string; lat: number; lng: number }>,
): RoutingWaypoint[] {
  return pathWaypoints.map((pw) => {
    if (pw.type === 'via') {
      return { lat: pw.lat, lng: pw.lng, type: 'via' as const };
    }
    return { lat: pw.lat, lng: pw.lng, type: 'stop' as const, name: pw.name };
  });
}
