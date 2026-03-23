import { useRef, useEffect, useState } from 'preact/hooks';
import { Chart, registerables } from 'chart.js';
import { useHydrated } from '../../lib/hooks';
import type { TimeRange, TimeSeriesPoint, FunnelStep, SummaryCard } from '../../lib/stats/types';

Chart.register(...registerables);

interface StatsDetailProps {
  contentType: 'route' | 'event' | 'organizer';
  contentSlug: string;
  heroStats: SummaryCard[];
  timeSeries: TimeSeriesPoint[];
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

export default function StatsDetail(props: StatsDetailProps) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  const [data, setData] = useState<StatsDetailProps>(props);
  const [loading, setLoading] = useState(false);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  async function loadRange(range: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/stats/${apiPath(data.contentType)}/${data.contentSlug}?range=${range}`);
      if (res.ok) {
        const json = await res.json();
        setData({ ...data, ...json });
      }
    } finally {
      setLoading(false);
    }
  }

  const hasDuration = data.timeSeries.some(p => (p.secondaryValue ?? 0) > 0);

  useEffect(() => {
    if (!chartRef.current) return;

    chartInstance.current?.destroy();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const datasets: any[] = [
      {
        label: 'Page views',
        data: data.timeSeries.map(p => p.value),
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
        borderColor: 'rgb(59, 130, 246)',
        borderWidth: 1,
        yAxisID: 'y',
      },
    ];

    if (hasDuration) {
      datasets.push({
        label: 'Avg duration (s)',
        data: data.timeSeries.map(p => p.secondaryValue ?? 0),
        type: 'line',
        borderColor: 'rgb(234, 88, 12)',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        yAxisID: 'y1',
      });
    }

    chartInstance.current = new Chart(chartRef.current, {
      type: 'bar',
      data: {
        labels: data.timeSeries.map(p => p.date),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { beginAtZero: true, position: 'left' },
          ...(hasDuration ? {
            y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } },
          } : {}),
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { mode: 'index', intersect: false },
        },
      },
    });

    return () => { chartInstance.current?.destroy(); };
  }, [data.timeSeries]);

  const totalReactions = data.reactions
    ? Object.values(data.reactions).reduce((sum, n) => sum + n, 0)
    : 0;

  return (
    <div ref={hydratedRef} class="stats-detail">
      {/* Back link */}
      <a href="/admin/stats" class="stats-back-link">&larr; Back to overview</a>

      {/* Title */}
      <h2 class="stats-detail-title">
        {contentTypeLabel(data.contentType)}: {data.contentSlug}
        <a href={liveUrl(data.contentType, data.contentSlug)} class="stats-detail-live-link">View live &rarr;</a>
      </h2>

      {/* Time range selector */}
      <div class="stats-range-selector">
        {RANGE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            class={`stats-range-btn ${data.range === opt.value ? 'active' : ''}`}
            disabled={loading}
            onClick={() => loadRange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

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
          <h3 class="stats-section-title">Traffic over time</h3>
          <div class="stats-chart-wrapper">
            <canvas ref={chartRef} />
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
          <p>No analytics data found for this {data.contentType}.</p>
        </div>
      )}
    </div>
  );
}
