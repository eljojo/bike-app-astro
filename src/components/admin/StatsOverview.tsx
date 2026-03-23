import { useRef, useEffect, useState } from 'preact/hooks';
import { Chart, registerables } from 'chart.js';
import { useHydrated } from '../../lib/hooks';
import type {
  SummaryCard,
  TimeSeriesPoint,
  LeaderboardEntry,
  InsightCard,
  TimeRange,
} from '../../lib/stats/types';

Chart.register(...registerables);

interface EngagementEntry extends LeaderboardEntry {
  breakdown?: { wallTime: string; mapConversion: string; stars: number; videoPlayRate: string };
}

interface StatsOverviewProps {
  summaryCards: SummaryCard[];
  timeSeries: TimeSeriesPoint[];
  granularity: string;
  viewsLeaderboard: LeaderboardEntry[];
  engagementLeaderboard: EngagementEntry[];
  insights: InsightCard[];
  range: string;
  reactionBreakdown?: Record<string, number>;
}

const REACTION_LABELS: Record<string, string> = {
  star: 'Starred',
  ridden: 'Ridden it',
  'thumbs-up': 'Thumbs up',
  attended: 'Attended',
};

const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: '3mo', label: 'Last 3 months' },
  { value: '1yr', label: 'Last year' },
  { value: 'all', label: 'All time' },
];

function formatNumber(n: number | string): string {
  if (typeof n === 'string') return n;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function drillDownUrl(contentType: string, contentSlug: string): string {
  switch (contentType) {
    case 'route': return `/admin/stats/route/${contentSlug}`;
    case 'event': return `/admin/stats/event/${contentSlug}`;
    case 'organizer': return `/admin/stats/community/${contentSlug}`;
    default: return '#';
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

function severityColor(severity: string): string {
  switch (severity) {
    case 'positive': return '#16a34a';
    case 'warning': return '#d97706';
    default: return '#6b7280';
  }
}

function InsightCardView({ insight }: { insight: InsightCard }) {
  const [showMetrics, setShowMetrics] = useState(false);

  return (
    <div
      class="stats-insight-card"
      style={{ borderLeftColor: severityColor(insight.severity) }}
    >
      <div class="stats-insight-header">
        <strong class="stats-insight-title">{insight.title}</strong>
        {insight.metrics && (
          <button
            type="button"
            class="stats-insight-metrics-toggle"
            onClick={() => setShowMetrics(!showMetrics)}
            title="Show metrics"
          >
            {showMetrics ? 'Hide numbers' : 'Show numbers'}
          </button>
        )}
      </div>
      <div class="stats-insight-content">
        <a href={drillDownUrl(insight.contentType || '', insight.contentSlug || '')} class="stats-insight-name">
          {insight.name}
        </a>
        <p class="stats-insight-body">{insight.body}</p>
      </div>
      <div class="stats-insight-links">
        <a href={liveUrl(insight.contentType || '', insight.contentSlug || '')} class="stats-insight-link">View live</a>
        <a href={drillDownUrl(insight.contentType || '', insight.contentSlug || '')} class="stats-insight-link">View stats</a>
      </div>
      {showMetrics && insight.metrics && (
        <div class="stats-insight-metrics">
          {Object.entries(insight.metrics).map(([label, value]) => (
            <div class="stats-insight-metric" key={label}>
              <span class="stats-insight-metric-label">{label}</span>
              <span class="stats-insight-metric-value">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StatsOverview(props: StatsOverviewProps) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  const [data, setData] = useState<StatsOverviewProps>(props);
  const [loading, setLoading] = useState(false);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  async function loadRange(range: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/stats/overview?range=${range}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!chartRef.current) return;

    chartInstance.current?.destroy();

    chartInstance.current = new Chart(chartRef.current, {
      type: 'bar',
      data: {
        labels: data.timeSeries.map(p => p.date),
        datasets: [
          {
            label: 'Page views',
            data: data.timeSeries.map(p => p.value),
            backgroundColor: 'rgba(59, 130, 246, 0.5)',
            borderColor: 'rgb(59, 130, 246)',
            borderWidth: 1,
          },
          {
            label: 'Visitors',
            data: data.timeSeries.map(p => p.secondaryValue ?? 0),
            type: 'line',
            borderColor: 'rgb(234, 88, 12)',
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true } },
        plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false } },
      },
    });

    return () => { chartInstance.current?.destroy(); };
  }, [data.timeSeries]);

  return (
    <div ref={hydratedRef} class="stats-overview">
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

      {/* Summary cards */}
      <div class="stats-summary-cards">
        {data.summaryCards.map(card => (
          <div class="stats-summary-card" key={card.label} title={card.description}>
            <span class="stats-card-label">{card.label}</span>
            <span class="stats-card-value">{formatNumber(card.value)}</span>
            {card.change != null && (
              <span class={`stats-card-change ${card.change >= 0 ? 'positive' : 'negative'}`}>
                {card.change >= 0 ? '+' : ''}{card.change}%
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Traffic chart */}
      <div class="stats-chart-container">
        <h3 class="stats-section-title">Traffic</h3>
        <div class="stats-chart-wrapper">
          <canvas ref={chartRef} />
        </div>
      </div>

      {/* Leaderboards */}
      <div class="stats-leaderboards">
        <div class="stats-leaderboard">
          <h3 class="stats-section-title">Most viewed</h3>
          {data.viewsLeaderboard.length === 0 ? (
            <p class="stats-empty-text">No data yet</p>
          ) : (
            <table class="stats-table">
              <thead>
                <tr>
                  <th>Content</th>
                  <th class="stats-table-num">Views</th>
                  <th class="stats-table-num">Hours</th>
                </tr>
              </thead>
              <tbody>
                {data.viewsLeaderboard.map(entry => (
                  <tr key={`${entry.contentType}-${entry.contentSlug}`}>
                    <td>
                      <a href={drillDownUrl(entry.contentType, entry.contentSlug)} class="stats-content-link">
                        <span class="stats-content-type">{entry.contentType}</span>
                        {entry.name}
                      </a>
                    </td>
                    <td class="stats-table-num">{formatNumber(entry.primaryValue)}</td>
                    <td class="stats-table-num">{entry.secondaryValue ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div class="stats-leaderboard">
          <h3 class="stats-section-title">Most engaging</h3>
          {data.engagementLeaderboard.length === 0 ? (
            <p class="stats-empty-text">No data yet</p>
          ) : (
            <table class="stats-table">
              <thead>
                <tr>
                  <th>Content</th>
                  <th class="stats-table-num">Score</th>
                  <th class="stats-table-num">Wall time</th>
                  <th class="stats-table-num">Map</th>
                  <th class="stats-table-num">Stars</th>
                </tr>
              </thead>
              <tbody>
                {data.engagementLeaderboard.map(entry => (
                  <tr key={`${entry.contentType}-${entry.contentSlug}`}>
                    <td>
                      <a href={drillDownUrl(entry.contentType, entry.contentSlug)} class="stats-content-link">
                        <span class="stats-content-type">{entry.contentType}</span>
                        {entry.name}
                      </a>
                    </td>
                    <td class="stats-table-num">{entry.primaryValue}</td>
                    <td class="stats-table-num">{entry.breakdown?.wallTime ?? ''}</td>
                    <td class="stats-table-num">{entry.breakdown?.mapConversion ?? ''}</td>
                    <td class="stats-table-num">{entry.breakdown?.stars ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Reactions breakdown */}
      {data.reactionBreakdown && Object.keys(data.reactionBreakdown).length > 0 && (() => {
        const total = Object.values(data.reactionBreakdown!).reduce((s, n) => s + n, 0);
        return (
          <div class="stats-reactions">
            <h3 class="stats-section-title">Reactions ({total})</h3>
            <div class="stats-reaction-bars">
              {Object.entries(data.reactionBreakdown!).map(([type, count]) => (
                <div class="stats-reaction-row" key={type}>
                  <span class="stats-reaction-label">{REACTION_LABELS[type] || type}</span>
                  <div class="stats-reaction-bar-track">
                    <div class="stats-reaction-bar-fill" style={{ width: `${Math.max((count / total) * 100, 2)}%` }} />
                  </div>
                  <span class="stats-reaction-count">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Insights */}
      {data.insights.length > 0 && (
        <div class="stats-insights">
          <h3 class="stats-section-title">Insights</h3>
          <div class="stats-insight-cards">
            {data.insights.map((insight, i) => (
              <InsightCardView key={i} insight={insight} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
