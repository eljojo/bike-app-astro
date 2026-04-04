// Public Preact island. Styles in global.scss.
import { useState, useRef, useEffect } from 'preact/hooks';
import Icon from './Icon';

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

const SVG_W = 400;
const SVG_H = 160;
const PAD_L = 42;
const PAD_R = 5;
const PAD_T = 8;
const PAD_B = 28;
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

const ELEVATION_KEY = 'elevation-collapsed';

export default function InteractiveElevation({ points, label, color = '#0066cc', waypoints = [], collapsed: initialCollapsed = false }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [isCollapsed, setCollapsed] = useState(initialCollapsed);

  // Read persisted state after hydration + sync across instances
  useEffect(() => {
    try {
      const v = localStorage.getItem(ELEVATION_KEY);
      if (v !== null) setCollapsed(v === 'true');
    } catch {}

    const handler = (e: Event) => {
      setCollapsed((e as CustomEvent<boolean>).detail);
    };
    window.addEventListener('elevation:toggle', handler);
    return () => window.removeEventListener('elevation:toggle', handler);
  }, []);
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

  // Y-axis ticks — fewer ticks (2-3) for readability in small containers
  const yStep = niceStep(eleRange, 2);
  const yStart = Math.ceil(minEle / yStep) * yStep;
  const yTicks: { v: number; y: number }[] = [];
  for (let v = yStart; v <= maxEle; v += yStep) {
    yTicks.push({ v, y: PAD_T + PLOT_H - ((v - minEle) / eleRange) * PLOT_H });
  }

  // X-axis ticks — fewer ticks (3-4) for readability
  const xStep = niceStep(maxKm, 3);
  const xTicks: { v: number; x: number }[] = [];
  for (let v = 0; v <= maxKm; v += xStep) {
    xTicks.push({ v, x: PAD_L + (v / maxKm) * PLOT_W });
  }

  function updatePosition(clientX: number) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = (clientX - rect.left) / rect.width * SVG_W;
    const plotX = Math.max(0, Math.min(PLOT_W, svgX - PAD_L));
    const km = (plotX / PLOT_W) * maxKm;

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].km - km);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    setHoverIdx(bestIdx);

    const p = points[bestIdx];
    window.dispatchEvent(new CustomEvent('elevation:hover', {
      detail: { lat: p.lat, lng: p.lng, km: p.km },
    }));
  }

  function handleMove(e: MouseEvent) { updatePosition(e.clientX); }

  function handleTouchStart(e: TouchEvent) {
    e.preventDefault(); // prevent page scroll while scrubbing
    updatePosition(e.touches[0].clientX);
  }

  function handleTouchMove(e: TouchEvent) {
    e.preventDefault();
    updatePosition(e.touches[0].clientX);
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
      <button
        type="button"
        class="elevation-stats"
        onClick={() => {
          const next = !isCollapsed;
          setCollapsed(next);
          try { localStorage.setItem(ELEVATION_KEY, String(next)); } catch {}
          window.dispatchEvent(new CustomEvent('elevation:toggle', { detail: next }));
        }}
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? 'Show elevation chart' : 'Hide elevation chart'}
      >
        <span title="Total elevation gained">{'\u00A0'}<Icon name="trend-up" size={16} /> {Math.round(elevGain)}m gain</span>
        <span title="Elevation range (lowest – highest)">{'\u00A0'}<Icon name="arrows-down-up" size={16} /> {Math.round(rawMin)}m &ndash; {Math.round(rawMax)}m</span>
        <span title="Total distance">{'\u00A0'}<Icon name="ruler" size={16} /> {maxKm.toFixed(1)} km</span>
        {label && <span class="elevation-label" style={`color: ${color}`}>{label}</span>}
        <span class={`elevation-toggle ${isCollapsed ? 'elevation-toggle--collapsed' : ''}`}>
          <Icon name="caret-down" size={16} />
        </span>
      </button>
      {!isCollapsed && (
        <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            class="elevation-svg"
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleLeave}
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
                      stroke={wp.color} stroke-width="1" stroke-dasharray="3,2" opacity="0.7" />
                <title>{wp.label} ({wp.km.toFixed(1)} km)</title>
              </g>
            ))}

            {/* Y-axis labels */}
            {yTicks.map(t => (
              <text key={t.v} x={PAD_L - 4} y={t.y + 4} text-anchor="end"
                    font-size="16" fill="#888">{Math.round(t.v)}m</text>
            ))}

            {/* X-axis labels */}
            {xTicks.map(t => (
              <text key={t.v} x={t.x} y={plotBottom + 18} text-anchor="middle"
                    font-size="16" fill="#888">{t.v}</text>
            ))}
            <text x={PAD_L + PLOT_W} y={plotBottom + 18} text-anchor="end"
                  font-size="16" fill="#888">km</text>

            {/* Hover crosshair */}
            {hoverPoint && (
              <>
                <line x1={hoverX} x2={hoverX} y1={PAD_T} y2={plotBottom}
                      stroke="#666" stroke-width="0.75" stroke-dasharray="3,2" />
                <circle cx={hoverX} cy={hoverY} r="3.5" fill={color} stroke="#fff" stroke-width="1.5" />
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
