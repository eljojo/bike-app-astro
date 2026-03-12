// Public Preact island. Styles in global.scss.
import { useState, useRef } from 'preact/hooks';

export interface ElevationPoint {
  km: number;
  ele: number;
  lat: number;
  lng: number;
}

interface WaypointTick {
  km: number;
  type: string;
  label: string;
}

interface Props {
  points: ElevationPoint[];
  label?: string;
  color?: string;
  waypoints?: WaypointTick[];
  collapsed?: boolean;
}

const SVG_W = 800;
const SVG_H = 200;
const PAD_L = 50;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 25;
const PLOT_W = SVG_W - PAD_L - PAD_R;
const PLOT_H = SVG_H - PAD_T - PAD_B;

function niceStep(range: number, target: number): number {
  const rough = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  if (norm <= 1.5) return mag;
  if (norm <= 3.5) return 2 * mag;
  if (norm <= 7.5) return 5 * mag;
  return 10 * mag;
}

const WP_COLORS: Record<string, string> = {
  checkpoint: '#6200ea',
  danger: '#d32f2f',
  poi: '#1976d2',
};

export default function InteractiveElevation({ points, label, color = '#0066cc', waypoints = [], collapsed: initialCollapsed = false }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [isCollapsed, setCollapsed] = useState(initialCollapsed);
  const svgRef = useRef<SVGSVGElement>(null);

  if (points.length === 0) return null;

  const elevations = points.map(p => p.ele);
  const rawMin = Math.min(...elevations);
  const rawMax = Math.max(...elevations);
  const rawRange = rawMax - rawMin;
  const MIN_RANGE = 50;
  const minEle = rawRange >= MIN_RANGE ? rawMin : (rawMin + rawMax) / 2 - MIN_RANGE / 2;
  const maxEle = rawRange >= MIN_RANGE ? rawMax : (rawMin + rawMax) / 2 + MIN_RANGE / 2;
  const eleRange = maxEle - minEle;

  const maxKm = points[points.length - 1].km;
  const elevGain = points.reduce((gain, p, i) => {
    if (i === 0) return 0;
    const diff = p.ele - points[i - 1].ele;
    return gain + (diff > 0 ? diff : 0);
  }, 0);

  // Build SVG path
  const pathData = points.map((p, i) => {
    const x = PAD_L + (p.km / maxKm) * PLOT_W;
    const y = PAD_T + PLOT_H - ((p.ele - minEle) / eleRange) * PLOT_H;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const areaPath = pathData
    + ` L${(PAD_L + PLOT_W).toFixed(1)},${PAD_T + PLOT_H}`
    + ` L${PAD_L},${PAD_T + PLOT_H} Z`;

  // Y-axis ticks
  const yStep = niceStep(eleRange, 4);
  const yStart = Math.ceil(minEle / yStep) * yStep;
  const yTicks: { v: number; y: number }[] = [];
  for (let v = yStart; v <= maxEle; v += yStep) {
    yTicks.push({ v, y: PAD_T + PLOT_H - ((v - minEle) / eleRange) * PLOT_H });
  }

  // X-axis ticks
  const xStep = niceStep(maxKm, 5);
  const xTicks: { v: number; x: number }[] = [];
  for (let v = 0; v <= maxKm; v += xStep) {
    xTicks.push({ v, x: PAD_L + (v / maxKm) * PLOT_W });
  }

  function handleMove(e: MouseEvent) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const km = relX * maxKm;

    // Find nearest point
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].km - km);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    setHoverIdx(bestIdx);

    // Dispatch for map cursor sync
    const p = points[bestIdx];
    window.dispatchEvent(new CustomEvent('elevation:hover', {
      detail: { lat: p.lat, lng: p.lng, km: p.km },
    }));
  }

  function handleLeave() {
    setHoverIdx(null);
    window.dispatchEvent(new CustomEvent('elevation:leave'));
  }

  const hoverPoint = hoverIdx !== null ? points[hoverIdx] : null;
  const hoverX = hoverPoint ? PAD_L + (hoverPoint.km / maxKm) * PLOT_W : 0;
  const hoverY = hoverPoint ? PAD_T + PLOT_H - ((hoverPoint.ele - minEle) / eleRange) * PLOT_H : 0;
  const plotBottom = PAD_T + PLOT_H;

  // Waypoint tick positions
  const wpTicks = waypoints
    .filter(wp => wp.km >= 0 && wp.km <= maxKm)
    .map(wp => ({
      ...wp,
      x: PAD_L + (wp.km / maxKm) * PLOT_W,
      color: WP_COLORS[wp.type] || WP_COLORS.poi,
    }));

  return (
    <div class="interactive-elevation">
      <div class="elevation-stats">
        <span>&#x2197; {Math.round(elevGain)}m gain</span>
        <span>&#x2195; {Math.round(rawMin)}m &ndash; {Math.round(rawMax)}m</span>
        <span>&#x1F4CF; {maxKm.toFixed(1)} km</span>
        {label && <span class="elevation-label" style={`color: ${color}`}>{label}</span>}
        <button
          type="button"
          class="elevation-toggle"
          onClick={() => setCollapsed(c => !c)}
          aria-label={isCollapsed ? 'Show elevation' : 'Hide elevation'}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
      </div>
      {!isCollapsed && (
        <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            class="elevation-svg"
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
          >
            {/* Grid lines */}
            {yTicks.map(t => (
              <line key={t.v} x1={PAD_L} x2={PAD_L + PLOT_W} y1={t.y} y2={t.y}
                    stroke="#ddd" stroke-width="0.5" />
            ))}

            {/* Elevation area + line */}
            <path d={areaPath} fill={`${color}26`} />
            <path d={pathData} fill="none" stroke={color} stroke-width="2" />

            {/* Waypoint tick marks */}
            {wpTicks.map((wp, i) => (
              <g key={i}>
                <line x1={wp.x} x2={wp.x} y1={PAD_T} y2={plotBottom}
                      stroke={wp.color} stroke-width="1.5" stroke-dasharray="3,2" opacity="0.7" />
                <title>{wp.label} ({wp.km.toFixed(1)} km)</title>
              </g>
            ))}

            {/* Y-axis labels */}
            {yTicks.map(t => (
              <text key={t.v} x={PAD_L - 5} y={t.y + 4} text-anchor="end"
                    font-size="11" fill="#666">{Math.round(t.v)}m</text>
            ))}

            {/* X-axis labels */}
            {xTicks.map(t => (
              <text key={t.v} x={t.x} y={plotBottom + 16} text-anchor="middle"
                    font-size="11" fill="#666">{t.v}</text>
            ))}
            <text x={PAD_L + PLOT_W} y={plotBottom + 16} text-anchor="middle"
                  font-size="11" fill="#666">km</text>

            {/* Hover crosshair */}
            {hoverPoint && (
              <>
                <line x1={hoverX} x2={hoverX} y1={PAD_T} y2={plotBottom}
                      stroke="#666" stroke-width="1" stroke-dasharray="4,3" />
                <circle cx={hoverX} cy={hoverY} r="4" fill={color} stroke="#fff" stroke-width="2" />
              </>
            )}
          </svg>

          {/* Hover tooltip */}
          {hoverPoint && (
            <div class="elevation-tooltip">
              {hoverPoint.km.toFixed(1)} km — {Math.round(hoverPoint.ele)}m
            </div>
          )}
        </>
      )}
    </div>
  );
}
