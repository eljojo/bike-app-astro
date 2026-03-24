import { useRef, useEffect, useState } from 'preact/hooks';
import { Chart, registerables } from 'chart.js';
import { useHydrated } from '../../lib/hooks';
import {
  formatDuration,
  type SummaryCard,
  type TimeSeriesPoint,
  type LeaderboardEntry,
  type InsightCard,
} from '../../lib/stats/types';
import { buildImageUrl, buildImageSrcSet2x } from '../../lib/media/image-service';
import { formatNumber, REACTION_LABELS, RANGE_OPTIONS, liveUrl } from '../../lib/stats/ui-helpers';

Chart.register(...registerables);

interface EngagementEntry extends LeaderboardEntry {
  breakdown?: { wallTime: string; mapConversion: string; stars: number; videoPlayRate: string };
}

interface StatsData {
  summaryCards: SummaryCard[];
  timeSeries: TimeSeriesPoint[];
  granularity: string;
  viewsLeaderboard: LeaderboardEntry[];
  engagementLeaderboard: EngagementEntry[];
  insights: InsightCard[];
  range: string;
  reactionBreakdown?: Record<string, number>;
  durationSeries?: TimeSeriesPoint[];
  pagesPerVisitSeries?: TimeSeriesPoint[];
  signups?: Array<{ date: string; guests: number; registered: number }>;
  visitorInsights?: {
    repeatVisits: Record<string, number>;
    returningVisitors: number;
    avgReturns: number;
    socialReferrals: Record<string, number>;
  };
  cdnUrl?: string;
  lastSynced?: string;
}

const THUMB_OPTS = { width: 32, height: 32, fit: 'cover' as const };
const THUMB_INSIGHT_OPTS = { width: 40, height: 40, fit: 'cover' as const };

function Thumb({ cdnUrl, thumbKey, size }: { cdnUrl?: string; thumbKey?: string; size?: 'insight' }) {
  if (!cdnUrl || !thumbKey) return null;
  const opts = size === 'insight' ? THUMB_INSIGHT_OPTS : THUMB_OPTS;
  return (
    <img
      src={buildImageUrl(cdnUrl, thumbKey, opts)}
      srcset={buildImageSrcSet2x(cdnUrl, thumbKey, opts)}
      alt="" loading="lazy"
      class={`stats-thumb${size === 'insight' ? ' stats-thumb--insight' : ''}`}
      width={opts.width} height={opts.height}
    />
  );
}

function drillDownUrl(contentType: string, contentSlug: string): string {
  switch (contentType) {
    case 'route': return `/admin/stats/route/${contentSlug}`;
    case 'event': return `/admin/stats/event/${contentSlug}`;
    case 'organizer': return `/admin/stats/community/${contentSlug}`;
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

function InsightCardView({ insight, cdnUrl }: { insight: InsightCard; cdnUrl?: string }) {
  const [showMetrics, setShowMetrics] = useState(false);

  return (
    <div
      class="stats-insight-card"
      style={{ borderLeftColor: severityColor(insight.severity) }}
    >
      <Thumb cdnUrl={cdnUrl} thumbKey={insight.thumbKey} size="insight" />
      <div class="stats-insight-body-col">
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
        <a href={drillDownUrl(insight.contentType || '', insight.contentSlug || '')} class="stats-insight-name">
          {insight.name}
        </a>
        <p class="stats-insight-body">{insight.body}</p>
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
    </div>
  );
}

function DualAxisChart({ labels, leftData, leftLabel, leftColor, rightData, rightLabel, rightColor, formatLeftTooltip }: {
  labels: string[]; leftData: number[]; leftLabel: string; leftColor: string;
  rightData: number[]; rightLabel: string; rightColor: string;
  formatLeftTooltip?: (value: number) => string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instance = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    instance.current?.destroy();

    const hasRight = rightData.length > 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const datasets: any[] = [
      {
        label: leftLabel,
        data: leftData,
        borderColor: leftColor,
        backgroundColor: leftColor.replace('rgb', 'rgba').replace(')', ', 0.1)'),
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        yAxisID: 'y',
      },
    ];
    if (hasRight) {
      datasets.push({
        label: rightLabel,
        data: rightData,
        borderColor: rightColor,
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        yAxisID: 'y1',
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scales: any = {
      x: {
        ticks: {
          maxTicksLimit: 8,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          callback: function(_: any, index: number) {
            const d = labels[index];
            if (!d) return '';
            const day = d.slice(8, 10);
            return index === 0 || day === '01' ? d.slice(5) : day;
          },
        },
      },
      y: { beginAtZero: true, position: 'left', title: { display: true, text: leftLabel } },
    };
    if (hasRight) {
      scales.y1 = { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: rightLabel } };
    }

    instance.current = new Chart(canvasRef.current, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales,
        plugins: {
          legend: { display: hasRight, position: 'bottom' },
          tooltip: {
            mode: 'index',
            intersect: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            callbacks: formatLeftTooltip ? { label: (ctx: any) => {
              if (ctx.datasetIndex === 0) return `${ctx.dataset.label}: ${formatLeftTooltip(ctx.parsed.y)}`;
              return `${ctx.dataset.label}: ${ctx.parsed.y}`;
            }} : undefined,
          },
        },
      },
    });
    return () => { instance.current?.destroy(); };
  }, [labels, leftData, rightData]);

  return <canvas ref={canvasRef} />;
}

function SignupsChart({ signups }: { signups: Array<{ date: string; guests: number; registered: number }> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instance = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    instance.current?.destroy();
    instance.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: signups.map(s => s.date),
        datasets: [
          {
            label: 'Registered',
            data: signups.map(s => s.registered),
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
          },
          {
            label: 'Guests',
            data: signups.map(s => s.guests),
            backgroundColor: 'rgba(156, 163, 175, 0.5)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
        plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false } },
      },
    });
    return () => { instance.current?.destroy(); };
  }, [signups]);

  return <canvas ref={canvasRef} />;
}

export default function StatsOverview() {
  const hydratedRef = useHydrated<HTMLDivElement>();
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [cumulative, setCumulative] = useState(false);
  const [error, setError] = useState('');
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);
  const currentRange = useRef<string>('30d');

  async function loadRange(range: string) {
    currentRange.current = range;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/stats/overview?range=${range}`);
      if (res.ok) {
        setData(await res.json());
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed to load (${res.status})`);
      }
    } catch (e) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  async function triggerSync() {
    setSyncing(true);
    try {
      await fetch(`/api/admin/stats/overview?range=${currentRange.current}`, { method: 'POST' });
      await loadRange(currentRange.current);
    } finally {
      setSyncing(false);
    }
  }

  // Load default range on mount
  useEffect(() => { loadRange('30d'); }, []);

  // Cumulative helper
  function cumulate(values: number[]): number[] {
    let sum = 0;
    return values.map(v => { sum += v; return sum; });
  }

  useEffect(() => {
    if (!chartRef.current || !data) return;

    chartInstance.current?.destroy();

    const pvData = cumulative
      ? cumulate(data.timeSeries.map(p => p.value))
      : data.timeSeries.map(p => p.value);
    const visData = cumulative
      ? cumulate(data.timeSeries.map(p => p.secondaryValue ?? 0))
      : data.timeSeries.map(p => p.secondaryValue ?? 0);

    chartInstance.current = new Chart(chartRef.current, {
      type: cumulative ? 'line' : 'bar',
      data: {
        labels: data.timeSeries.map(p => p.date),
        datasets: [
          {
            label: cumulative ? 'Total page views' : 'Page views',
            data: pvData,
            backgroundColor: cumulative ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.5)',
            borderColor: 'rgb(59, 130, 246)',
            borderWidth: cumulative ? 2 : 1,
            pointRadius: 0,
            fill: cumulative,
          },
          {
            label: cumulative ? 'Total visitors' : 'Visitors',
            data: visData,
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
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 10,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              callback: function(_: any, index: number) {
                const labels = data!.timeSeries.map(p => p.date);
                const d = labels[index];
                if (!d) return '';
                const day = d.slice(8, 10);
                return index === 0 || day === '01' ? d.slice(5) : day;
              },
            },
          },
          y: { beginAtZero: true },
        },
        plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false } },
      },
    });

    return () => { chartInstance.current?.destroy(); };
  }, [data?.timeSeries, cumulative]);

  if (!data && loading) {
    return (
      <div ref={hydratedRef} class="stats-overview">
        <div class="stats-loading">Loading stats...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div ref={hydratedRef} class="stats-overview">
        <div class="stats-error">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div ref={hydratedRef} class="stats-overview">
        <div class="stats-empty-state">
          <h2>No analytics data yet</h2>
          <p>Run a sync to pull data from Plausible.</p>
          <button type="button" class="stats-sync-btn" disabled={syncing} onClick={triggerSync}>{syncing ? 'Syncing\u2026' : 'Sync now'}</button>
        </div>
      </div>
    );
  }

  return (
    <div ref={hydratedRef} class="stats-overview">
      {/* Toolbar */}
      <div class="stats-toolbar">
        {data.lastSynced && <span class="stats-last-synced">Data through {data.lastSynced}</span>}
        <button type="button" class="stats-sync-btn" disabled={syncing} onClick={triggerSync}>{syncing ? 'Syncing\u2026' : 'Sync now'}</button>
      </div>

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
        <div class="stats-chart-header">
          <h3 class="stats-section-title">Traffic</h3>
          <button type="button" class="stats-toggle-btn" onClick={() => setCumulative(!cumulative)}>
            {cumulative ? 'Show daily' : 'Show cumulative'}
          </button>
        </div>
        <div class="stats-chart-wrapper">
          <canvas ref={chartRef} />
        </div>
      </div>

      {/* Engagement depth: duration + pages per visit on dual axes (daily) or cumulative wall time */}
      {data.durationSeries && data.durationSeries.length > 0 && (
        <div class="stats-chart-container">
          <h3 class="stats-section-title">{cumulative ? 'Wall time (cumulative)' : 'Engagement depth'}</h3>
          <div class="stats-chart-wrapper">
            {cumulative ? (() => {
              // Cumulative wall time: sum of (visitors × avg_duration_s / 3600) per day
              const wallTimePerDay = data.timeSeries.map((p, i) => {
                const durationS = data.durationSeries![i]?.value ?? 0;
                const visitors = p.secondaryValue ?? 0;
                return visitors * durationS / 3600;
              });
              let sum = 0;
              const cumHours = wallTimePerDay.map(wt => { sum += wt; return sum; });
              const maxHours = cumHours.length > 0 ? cumHours[cumHours.length - 1] : 0;
              const useMinutes = maxHours < 1;
              const chartValues = useMinutes
                ? cumHours.map(h => Math.round(h * 60 * 10) / 10)
                : cumHours.map(h => Math.round(h * 10) / 10);
              return (
                <DualAxisChart
                  labels={data.durationSeries!.map(p => p.date)}
                  leftData={chartValues}
                  leftLabel={useMinutes ? 'Wall time (minutes)' : 'Wall time (hours)'}
                  leftColor="rgb(234, 88, 12)"
                  formatLeftTooltip={(v) => formatDuration(useMinutes ? v * 60 : v * 3600)}
                  rightData={[]}
                  rightLabel=""
                  rightColor="transparent"
                />
              );
            })() : (
              <DualAxisChart
                labels={data.durationSeries.map(p => p.date)}
                leftData={data.durationSeries.map(p => Math.round(p.value / 6) / 10)}
                leftLabel="Visit duration (min)"
                leftColor="rgb(234, 88, 12)"
                formatLeftTooltip={(min) => formatDuration(min * 60)}
                rightData={data.pagesPerVisitSeries?.map(p => p.value) ?? []}
                rightLabel="Pages per visit"
                rightColor="rgb(16, 185, 129)"
              />
            )}
          </div>
        </div>
      )}

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
                  <th class="stats-table-num">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.viewsLeaderboard.map(entry => (
                  <tr key={`${entry.contentType}-${entry.contentSlug}`}>
                    <td>
                      <a href={drillDownUrl(entry.contentType, entry.contentSlug)} class="stats-content-link">
                        <Thumb cdnUrl={data.cdnUrl} thumbKey={entry.thumbKey} />
                        <span>
                          <span class="stats-content-type">{entry.contentType}</span>
                          {entry.name}
                        </span>
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
                        <Thumb cdnUrl={data.cdnUrl} thumbKey={entry.thumbKey} />
                        <span>
                          <span class="stats-content-type">{entry.contentType}</span>
                          {entry.name}
                        </span>
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

      {/* Signups over time */}
      {data.signups && data.signups.length > 0 && (
        <div class="stats-chart-container">
          <h3 class="stats-section-title">Signups</h3>
          <div class="stats-chart-wrapper">
            <SignupsChart signups={data.signups} />
          </div>
        </div>
      )}

      {/* Visitor behavior */}
      {data.visitorInsights && (data.visitorInsights.returningVisitors > 0 || Object.keys(data.visitorInsights.socialReferrals).length > 0) && (
        <div class="stats-visitor-insights">
          <h3 class="stats-section-title">Visitor behavior</h3>
          <div class="stats-leaderboards">
            {/* Returning visitors */}
            {data.visitorInsights.returningVisitors > 0 && (
              <div class="stats-leaderboard">
                <h4 class="stats-subsection-title">
                  Returning visitors
                  <span class="stats-subsection-detail">
                    {data.visitorInsights.returningVisitors} visitors came back, averaging {data.visitorInsights.avgReturns} visits each
                  </span>
                </h4>
                <div class="stats-reaction-bars">
                  {Object.entries(data.visitorInsights.repeatVisits)
                    .sort(([a], [b]) => (a === '5+' ? 99 : parseInt(a)) - (b === '5+' ? 99 : parseInt(b)))
                    .map(([count, visitors]) => {
                      const max = Math.max(...Object.values(data.visitorInsights!.repeatVisits));
                      return (
                        <div class="stats-reaction-row" key={count}>
                          <span class="stats-reaction-label">{count === '5+' ? '5+ visits' : `${count} visits`}</span>
                          <div class="stats-reaction-bar-track">
                            <div class="stats-reaction-bar-fill" style={{ width: `${Math.max((visitors / max) * 100, 2)}%` }} />
                          </div>
                          <span class="stats-reaction-count">{visitors}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Social referrals */}
            {Object.keys(data.visitorInsights.socialReferrals).length > 0 && (
              <div class="stats-leaderboard">
                <h4 class="stats-subsection-title">Social referrals</h4>
                <div class="stats-reaction-bars">
                  {Object.entries(data.visitorInsights.socialReferrals)
                    .sort(([, a], [, b]) => b - a)
                    .map(([network, count]) => {
                      const max = Math.max(...Object.values(data.visitorInsights!.socialReferrals));
                      return (
                        <div class="stats-reaction-row" key={network}>
                          <span class="stats-reaction-label">{network}</span>
                          <div class="stats-reaction-bar-track">
                            <div class="stats-reaction-bar-fill" style={{ width: `${Math.max((count / max) * 100, 2)}%` }} />
                          </div>
                          <span class="stats-reaction-count">{count}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* Insights */}
      {data.insights.length > 0 && (
        <div class="stats-insights">
          <h3 class="stats-section-title">Insights</h3>
          <div class="stats-insight-cards">
            {data.insights.map((insight, i) => (
              <InsightCardView key={i} insight={insight} cdnUrl={data.cdnUrl} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
