import { useId, useMemo, useState } from "react";
import type { DailyTokenUsagePoint, DailyTokenUsageResponse, TokenUsage } from "../../core/types";

export interface DailyTokenUsagePanelProps {
  data?: DailyTokenUsageResponse | DailyTokenUsagePoint[] | null;
  loading?: boolean;
  initiallyExpanded?: boolean;
  title?: string;
  subtitle?: string;
  showHeaderToggle?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  maxVisiblePoints?: number;
  className?: string;
}

interface TokenParts {
  cachedInput: number;
  input: number;
  output: number;
  reasoning: number;
  other: number;
  total: number;
}

interface ChartSegment {
  key: string;
  label: string;
  value: number;
  y: number;
  height: number;
  className: string;
}

interface ChartBar {
  key: string;
  label: string;
  total: number;
  centerX: number;
  trendY: number;
  x: number;
  y: number;
  width: number;
  segments: ChartSegment[];
}

const SVG_HEIGHT = 280;
const MIN_SVG_WIDTH = 680;
const POINT_WIDTH = 48;
const CHART_MARGIN = {
  top: 20,
  right: 24,
  bottom: 44,
  left: 58
};

const TOKEN_FORMATTER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const COMPACT_TOKEN_FORMATTER = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1
});
const PERCENT_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  style: "percent"
});

export function DailyTokenUsagePanel({
  data,
  loading = false,
  initiallyExpanded = false,
  title = "Daily Token Usage",
  subtitle,
  showHeaderToggle = true,
  expanded: controlledExpanded,
  onExpandedChange,
  maxVisiblePoints,
  className
}: DailyTokenUsagePanelProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(initiallyExpanded);
  const expanded = controlledExpanded ?? uncontrolledExpanded;
  const headingId = useId();
  const bodyId = useId();
  const chartTitleId = useId();
  const visiblePoints = useMemo(() => normalizePoints(data, maxVisiblePoints), [data, maxVisiblePoints]);
  const summary = useMemo(() => summarizePoints(visiblePoints), [visiblePoints]);
  const chart = useMemo(() => buildChart(visiblePoints), [visiblePoints]);
  const hasPoints = visiblePoints.length > 0;
  const panelClassName = className ? `token-chart-panel ${className}` : "token-chart-panel";
  const subtitleText = subtitle ?? (loading ? "Loading daily usage" : hasPoints ? `${visiblePoints.length} visible day${visiblePoints.length === 1 ? "" : "s"}` : "No visible days");

  function setExpanded(next: boolean) {
    onExpandedChange?.(next);
    if (controlledExpanded === undefined) setUncontrolledExpanded(next);
  }

  return (
    <section className={panelClassName} aria-labelledby={headingId}>
      <div className="token-chart-header">
        <div className="token-chart-title-block">
          <p className="token-chart-eyebrow">Tokens</p>
          <h2 id={headingId} className="token-chart-title">
            {title}
          </h2>
          <p className="token-chart-subtitle">{subtitleText}</p>
        </div>

        {showHeaderToggle ? <dl className="token-chart-summary" aria-label="Daily token usage summary">
          <div className="token-chart-summary-item">
            <dt>Total tokens</dt>
            <dd>{formatTokens(summary.total)}</dd>
          </div>
          <div className="token-chart-summary-item">
            <dt>KV hit</dt>
            <dd>{formatKvHit(summary.kvHit)}</dd>
          </div>
        </dl> : null}

        {showHeaderToggle ? <button
          className="token-chart-toggle"
          type="button"
          aria-controls={bodyId}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <span>{expanded ? "Hide daily token usage chart" : "Show daily token usage chart"}</span>
          <span className="token-chart-toggle-icon" aria-hidden="true">
            {expanded ? "-" : "+"}
          </span>
        </button> : null}
      </div>

      {expanded ? (
        <div id={bodyId} className="token-chart-body">
          {hasPoints ? (
            <>
              <div className="token-chart-kpis" aria-label="Visible token usage breakdown">
                <Metric label="Input" value={summary.input} />
                <Metric label="Cached input" value={summary.cachedInput} />
                <Metric label="Output" value={summary.output} />
                <Metric label="Reasoning" value={summary.reasoning} />
              </div>

              <div className="token-chart-scroll" role="group" aria-label="Daily token usage chart">
                <svg
                  className="token-chart-svg"
                  role="img"
                  aria-labelledby={chartTitleId}
                  viewBox={`0 0 ${chart.width} ${SVG_HEIGHT}`}
                  width={chart.width}
                  height={SVG_HEIGHT}
                >
                  <title id={chartTitleId}>Daily token usage by date</title>
                  {chart.gridLines.map((gridLine) => (
                    <g className="token-chart-grid-line" key={gridLine.value}>
                      <line x1={CHART_MARGIN.left} x2={chart.width - CHART_MARGIN.right} y1={gridLine.y} y2={gridLine.y} />
                      <text x={CHART_MARGIN.left - 10} y={gridLine.y + 4}>
                        {formatCompactTokens(gridLine.value)}
                      </text>
                    </g>
                  ))}

                  <line
                    className="token-chart-axis"
                    x1={CHART_MARGIN.left}
                    x2={chart.width - CHART_MARGIN.right}
                    y1={chart.bottom}
                    y2={chart.bottom}
                  />

                  {chart.bars.map((bar) => (
                    <g className="token-chart-bar-group" key={bar.key}>
                      <title>{`${bar.label}: ${formatTokens(bar.total)} total tokens`}</title>
                      {bar.segments.map((segment) =>
                        segment.height > 0 ? (
                          <rect
                            className={`token-chart-segment ${segment.className}`}
                            key={segment.key}
                            x={bar.x}
                            y={segment.y}
                            width={bar.width}
                            height={segment.height}
                            rx={4}
                          >
                            <title>{`${bar.label} ${segment.label}: ${formatTokens(segment.value)} tokens`}</title>
                          </rect>
                        ) : null
                      )}
                      <text className="token-chart-date-label" x={bar.centerX} y={chart.bottom + 24}>
                        {bar.label}
                      </text>
                    </g>
                  ))}

                  {chart.trendPath ? <path className="token-chart-trend" d={chart.trendPath} /> : null}
                  {chart.bars.map((bar) => (
                    <circle className="token-chart-trend-point" key={`${bar.key}-trend`} cx={bar.centerX} cy={bar.trendY} r={3.5}>
                      <title>{`${bar.label} trend: ${formatTokens(bar.total)} tokens`}</title>
                    </circle>
                  ))}
                </svg>
              </div>

              <ul className="token-chart-legend" aria-label="Token usage legend">
                <LegendItem className="token-chart-swatch-cached" label="Cached input" />
                <LegendItem className="token-chart-swatch-input" label="Input" />
                <LegendItem className="token-chart-swatch-output" label="Output" />
                <LegendItem className="token-chart-swatch-reasoning" label="Reasoning" />
                <LegendItem className="token-chart-swatch-trend" label="Total trend" />
              </ul>
            </>
          ) : (
            <div className="token-chart-empty" aria-live="polite">
              {loading ? "Loading daily token usage..." : "No daily token usage yet."}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="token-chart-kpi">
      <span>{label}</span>
      <strong>{formatTokens(value)}</strong>
    </div>
  );
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <li className="token-chart-legend-item">
      <span className={`token-chart-swatch ${className}`} aria-hidden="true" />
      <span>{label}</span>
    </li>
  );
}

function normalizePoints(data: DailyTokenUsagePanelProps["data"], maxVisiblePoints?: number): DailyTokenUsagePoint[] {
  const points = Array.isArray(data) ? data : data?.points ?? [];
  const normalized = points
    .map((point) => ({
      date: point.date,
      input: positiveNumber(point.input),
      output: positiveNumber(point.output),
      reasoning: positiveNumber(point.reasoning),
      cachedInput: positiveNumber(point.cachedInput),
      total: positiveNumber(point.total)
    }))
    .filter((point) => point.date.trim().length > 0)
    .sort(comparePoints);

  if (maxVisiblePoints === undefined || maxVisiblePoints <= 0) return normalized;
  return normalized.slice(-maxVisiblePoints);
}

function summarizePoints(points: DailyTokenUsagePoint[]) {
  const summary = points.reduce(
    (current, point) => {
      const parts = getTokenParts(point);
      current.total += parts.total;
      current.input += point.input;
      current.output += point.output;
      current.reasoning += point.reasoning;
      current.cachedInput += point.cachedInput;
      return current;
    },
    { total: 0, input: 0, output: 0, reasoning: 0, cachedInput: 0, kvHit: null as number | null }
  );

  summary.kvHit = summary.input > 0 ? clamp(summary.cachedInput / summary.input, 0, 1) : null;
  return summary;
}

function buildChart(points: DailyTokenUsagePoint[]) {
  const width = Math.max(MIN_SVG_WIDTH, CHART_MARGIN.left + CHART_MARGIN.right + points.length * POINT_WIDTH);
  const bottom = SVG_HEIGHT - CHART_MARGIN.bottom;
  const innerHeight = bottom - CHART_MARGIN.top;
  const innerWidth = width - CHART_MARGIN.left - CHART_MARGIN.right;
  const pointParts = points.map(getTokenParts);
  const maxTotal = niceCeil(Math.max(1, ...pointParts.map((parts) => parts.total)));
  const step = points.length > 0 ? innerWidth / points.length : innerWidth;
  const barWidth = Math.min(30, Math.max(12, step * 0.54));
  const bars: ChartBar[] = points.map((point, index) => {
    const parts = pointParts[index];
    const centerX = CHART_MARGIN.left + step * index + step / 2;
    const x = centerX - barWidth / 2;
    const trendY = valueToY(parts.total, maxTotal, innerHeight, bottom);
    let segmentBase = bottom;
    const segments = segmentDefinitions(parts).map((segment) => {
      const height = valueToHeight(segment.value, maxTotal, innerHeight);
      segmentBase -= height;
      return {
        ...segment,
        y: segmentBase,
        height
      };
    });

    return {
      key: `${point.date}-${index}`,
      label: formatDateLabel(point.date),
      total: parts.total,
      centerX,
      trendY,
      x,
      y: trendY,
      width: barWidth,
      segments
    };
  });

  const trendPath = buildTrendPath(bars.map((bar) => ({ x: bar.centerX, y: bar.trendY })));
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const value = maxTotal * ratio;
    return {
      value,
      y: valueToY(value, maxTotal, innerHeight, bottom)
    };
  });

  return {
    width,
    bottom,
    bars,
    trendPath,
    gridLines
  };
}

function getTokenParts(point: DailyTokenUsagePoint): TokenParts {
  const input = positiveNumber(point.input);
  const cachedInput = Math.min(positiveNumber(point.cachedInput), input);
  const uncachedInput = Math.max(0, input - cachedInput);
  const output = positiveNumber(point.output);
  const reasoning = positiveNumber(point.reasoning);
  const calculatedTotal = input + output + reasoning;
  const total = Math.max(positiveNumber(point.total), calculatedTotal);
  const other = Math.max(0, total - calculatedTotal);

  return {
    cachedInput,
    input: uncachedInput,
    output,
    reasoning,
    other,
    total
  };
}

function segmentDefinitions(parts: TokenParts): Omit<ChartSegment, "y" | "height">[] {
  return [
    {
      key: "cached",
      label: "cached input",
      value: parts.cachedInput,
      className: "token-chart-segment-cached"
    },
    {
      key: "input",
      label: "input",
      value: parts.input,
      className: "token-chart-segment-input"
    },
    {
      key: "output",
      label: "output",
      value: parts.output,
      className: "token-chart-segment-output"
    },
    {
      key: "reasoning",
      label: "reasoning",
      value: parts.reasoning,
      className: "token-chart-segment-reasoning"
    },
    {
      key: "other",
      label: "other",
      value: parts.other,
      className: "token-chart-segment-other"
    }
  ];
}

function buildTrendPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    commands.push(`Q ${current.x} ${current.y} ${midX} ${midY}`);
  }

  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  commands.push(`Q ${penultimate.x} ${penultimate.y} ${last.x} ${last.y}`);
  return commands.join(" ");
}

function valueToHeight(value: number, maxTotal: number, innerHeight: number) {
  return (positiveNumber(value) / maxTotal) * innerHeight;
}

function valueToY(value: number, maxTotal: number, innerHeight: number, bottom: number) {
  return bottom - valueToHeight(value, maxTotal, innerHeight);
}

function positiveNumber(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function comparePoints(first: DailyTokenUsagePoint, second: DailyTokenUsagePoint) {
  const firstTime = parseDateTime(first.date);
  const secondTime = parseDateTime(second.date);
  if (firstTime !== null && secondTime !== null) return firstTime - secondTime;
  if (firstTime !== null) return -1;
  if (secondTime !== null) return 1;
  return first.date.localeCompare(second.date);
}

function parseDateTime(value: string) {
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(time) ? null : time;
}

function formatDateLabel(value: string) {
  const time = parseDateTime(value);
  if (time === null) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(time);
}

function formatTokens(value: number) {
  return TOKEN_FORMATTER.format(Math.round(positiveNumber(value)));
}

function formatCompactTokens(value: number) {
  return COMPACT_TOKEN_FORMATTER.format(Math.round(positiveNumber(value)));
}

function formatKvHit(value: number | null) {
  return value === null ? "n/a" : PERCENT_FORMATTER.format(value);
}

function niceCeil(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const nice = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}
