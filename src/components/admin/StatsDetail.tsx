import { useRef, useEffect, useState } from 'preact/hooks';
import { Chart, registerables } from 'chart.js';
import { useHydrated } from '../../lib/hooks';
import type { TimeRange, TimeSeriesPoint, FunnelStep, SummaryCard } from '../../lib/stats/types';

Chart.register(...registerables);

interface StatsDetailData {
  heroStats: SummaryCard[];
  narrative?: string[];
  timeSeries: TimeSeriesPoint[];
  durationSeries?: TimeSeriesPoint[];
  granularity: string;
  funnel?: FunnelStep[];
  range: string;
  reactions?: Record<string, number>;
}

const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: '3mo', label: 'Last 3 months' },
  { value: '1yr', label: 'Last year' },
  { value: 'all', label: 'All time' },
];

const REACTION_LABELS: Record<string, string> = {
  star: 'Starred',
  ridden: 'Ridden it',
  'thumbs-up': 'Thumbs up',
  attended: 'Attended',
};

function formatNumber(n: number | string): string {
  if (typeof n === 'string') return n;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function apiPath(contentType: string): string {
  switch (contentType) {
    case 'route': return 'route';
    case 'event': return 'event';
    case 'organizer': return 'community';
    default: return 'route';
  }
}

function contentTypeLabel(contentType: string): string {
  switch (contentType) {
    case 'route': return 'Route';
    case 'event': return 'Event';
    case 'organizer': return 'Community';
    default: return contentType;
  }
}

function liveUrl(contentType: string, contentSlug: string): string {
  switch (contentType) {
    case 'route': return `/routes/${contentSlug}`;
    case 'event': return `/events/${contentSlug}`;
    case 'organizer': return `/communities/${contentSlug}`;
    default: return '#';
  }
}

function DurationChart({ series, isHours }: { series: TimeSeriesPoint[]; isHours?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instance = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    instance.current?.destroy();
    instance.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: series.map(p => p.date),
        datasets: [{
          data: series.map(p => p.value),
          borderColor: 'rgb(234, 88, 12)',
          backgroundColor: 'rgba(234, 88, 12, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, title: { display: true, text: isHours ? 'hours' : 'minutes' } } },
        plugins: {
          legend: { display: false },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tooltip: { mode: 'index', intersect: false, callbacks: { label: (ctx: any) => {
            if (isHours) return `${ctx.parsed.y}h`;
            const totalSeconds = ctx.parsed.y * 60;
            const m = Math.floor(totalSeconds / 60);
            const sec = Math.round(totalSeconds % 60);
            return m > 0 ? (sec > 0 ? `${m}m ${sec}s` : `${m}m`) : `${sec}s`;
          }}},
        },
      },
    });
    return () => { instance.current?.destroy(); };
  }, [series]);

  return <canvas ref={canvasRef} />;
}

export default function StatsDetail({ contentType, contentSlug }: { contentType: string; contentSlug: string }) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  const [data, setData] = useState<StatsDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentRange, setCurrentRange] = useState<string>('30d');
  const [syncing, setSyncing] = useState(false);
  const [cumulative, setCumulative] = useState(true);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  async function loadRange(range: string) {
    setLoading(true);
    setError('');
    setCurrentRange(range);
    try {
      const res = await fetch(`/api/admin/stats/${apiPath(contentType)}/${contentSlug}?range=${range}`);
      if (res.ok) {
        setData(await res.json());
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed (${res.status})`);
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  async function triggerSync() {
    setSyncing(true);
    try {
      await fetch(`/api/admin/stats/${apiPath(contentType)}/${contentSlug}?range=${currentRange}&sync=force`, { method: 'POST' });
      await loadRange(currentRange);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => { loadRange('30d'); }, []);

  const hasVisitors = data?.timeSeries.some(p => (p.secondaryValue ?? 0) > 0) ?? false;
  const hasDuration = data?.durationSeries && data.durationSeries.some(p => p.value > 0);

  // Build cumulative series
  function cumulate(values: number[]): number[] {
    let sum = 0;
    return values.map(v => { sum += v; return sum; });
  }

  const cumPageviews = data ? cumulate(data.timeSeries.map(p => p.value)) : [];
  const cumVisitors = data ? cumulate(data.timeSeries.map(p => p.secondaryValue ?? 0)) : [];

  useEffect(() => {
    if (!chartRef.current || !data) return;

    chartInstance.current?.destroy();

    const pvData = cumulative ? cumPageviews : data.timeSeries.map(p => p.value);
    const visData = cumulative ? cumVisitors : data.timeSeries.map(p => p.secondaryValue ?? 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const datasets: any[] = [
      {
        label: cumulative ? 'Total page views' : 'Page views',
        data: pvData,
        backgroundColor: cumulative ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.5)',
        borderColor: 'rgb(59, 130, 246)',
        borderWidth: cumulative ? 2 : 1,
        pointRadius: 0,
        fill: cumulative,
      },
    ];

    if (hasVisitors) {
      datasets.push({
        label: cumulative ? 'Total visitors' : 'Visitors',
        data: visData,
        borderColor: 'rgb(234, 88, 12)',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      });
    }

    chartInstance.current = new Chart(chartRef.current, {
      type: cumulative ? 'line' : 'bar',
      data: {
        labels: data.timeSeries.map(p => p.date),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true } },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { mode: 'index', intersect: false },
        },
      },
    });

    return () => { chartInstance.current?.destroy(); };
  }, [data?.timeSeries, cumulative]);

  const totalReactions = data?.reactions
    ? Object.values(data.reactions).reduce((sum, n) => sum + n, 0)
    : 0;

  return (
    <div ref={hydratedRef} class="stats-detail">
      {/* Back link */}
      <a href="/admin/stats" class="stats-back-link">&larr; Back to overview</a>

      {/* Title */}
      <h2 class="stats-detail-title">
        {contentTypeLabel(contentType)}: {contentSlug}
        <a href={liveUrl(contentType, contentSlug)} class="stats-detail-live-link">View live &rarr;</a>
      </h2>

      {/* Time range selector + sync button */}
      <div class="stats-range-selector">
        {RANGE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            class={`stats-range-btn ${currentRange === opt.value ? 'active' : ''}`}
            disabled={loading}
            onClick={() => loadRange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          class="stats-range-btn stats-sync-btn"
          disabled={syncing || loading}
          onClick={triggerSync}
        >
          {syncing ? 'Syncing\u2026' : 'Sync now'}
        </button>
      </div>

      {/* Loading state */}
      {loading && !data && (
        <div class="stats-empty-text">
          <p>Loading stats...</p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div class="stats-empty-text">
          <p>{error}</p>
        </div>
      )}

      {/* Data loaded */}
      {data && !error && (
        <>
          {/* Narrative summary */}
          {data.narrative && data.narrative.length > 0 && (
            <div class="stats-narrative">
              {data.narrative.map((sentence, i) => (
                <p key={i}>{sentence}</p>
              ))}
            </div>
          )}

          {/* Hero stats */}
          {data.heroStats.length > 0 && (
            <div class="stats-summary-cards">
              {data.heroStats.map(card => (
                <div class="stats-summary-card" key={card.label} title={card.description}>
                  <span class="stats-card-label">{card.label}</span>
                  <span class="stats-card-value">{formatNumber(card.value)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Time series chart */}
          {data.timeSeries.length > 0 && (
            <div class="stats-chart-container">
              <div class="stats-chart-header">
                <h3 class="stats-section-title">Traffic over time</h3>
                <button
                  type="button"
                  class="stats-toggle-btn"
                  onClick={() => setCumulative(!cumulative)}
                >
                  {cumulative ? 'Show daily' : 'Show cumulative'}
                </button>
              </div>
              <div class="stats-chart-wrapper">
                <canvas ref={chartRef} />
              </div>
            </div>
          )}

          {/* Visit duration chart */}
          {hasDuration && (
            <div class="stats-chart-container">
              <h3 class="stats-section-title">{cumulative ? 'Wall time (cumulative)' : 'Visit duration'}</h3>
              <div class="stats-chart-wrapper">
                {cumulative ? (
                  <DurationChart series={(() => {
                    // Cumulative wall time in hours: sum of (pageviews × avg_duration_s / 3600)
                    const wallTimePerDay = data.timeSeries.map((p, i) => {
                      const durationS = data.durationSeries![i]?.value ?? 0;
                      return p.value * durationS / 3600;
                    });
                    let sum = 0;
                    return data.durationSeries!.map((p, i) => {
                      sum += wallTimePerDay[i];
                      return { ...p, value: Math.round(sum * 10) / 10 };
                    });
                  })()} isHours />
                ) : (
                  <DurationChart series={data.durationSeries!.map(p => ({ ...p, value: Math.round(p.value / 6) / 10 }))} />
                )}
              </div>
            </div>
          )}

          {/* Funnel (route only) */}
          {data.funnel && data.funnel.length > 0 && (
            <div class="stats-funnel">
              <h3 class="stats-section-title">Conversion funnel</h3>
              <div class="stats-funnel-steps">
                {data.funnel.map((step, i) => (
                  <div class="stats-funnel-step" key={step.label}>
                    <div class="stats-funnel-bar" style={{ width: `${i === 0 ? 100 : Math.max((step.count / (data.funnel![0].count || 1)) * 100, 5)}%` }}>
                      <span class="stats-funnel-label">{step.label}</span>
                      <span class="stats-funnel-count">{formatNumber(step.count)}</span>
                    </div>
                    {step.rate != null && (
                      <span class="stats-funnel-rate">{step.rate}% conversion</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reactions */}
          {totalReactions > 0 && (
            <div class="stats-reactions">
              <h3 class="stats-section-title">Reactions ({totalReactions})</h3>
              <div class="stats-reaction-bars">
                {Object.entries(data.reactions!).map(([type, count]) => (
                  <div class="stats-reaction-row" key={type}>
                    <span class="stats-reaction-label">{REACTION_LABELS[type] || type}</span>
                    <div class="stats-reaction-bar-track">
                      <div
                        class="stats-reaction-bar-fill"
                        style={{ width: `${Math.max((count / totalReactions) * 100, 2)}%` }}
                      />
                    </div>
                    <span class="stats-reaction-count">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.heroStats.length === 0 && (
            <div class="stats-empty-text">
              <p>No analytics data found for this {contentType}.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
