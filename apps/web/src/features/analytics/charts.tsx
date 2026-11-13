export type LineSeries = {
  id: string;
  label: string;
  color: string;
  points: Array<{ x: string; y: number }>;
};

export type BarDatum = {
  id: string;
  label: string;
  value: number;
  color: string;
};

const PAD = { top: 16, right: 16, bottom: 36, left: 48 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const scaled = value / base;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * base;
}

export function LineChart({
  series,
  width = 640,
  height = 240,
  ariaLabel,
}: {
  series: LineSeries[];
  width?: number;
  height?: number;
  ariaLabel: string;
}) {
  const allX = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const maxY = niceMax(Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.y))));
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const xAt = (i: number) => PAD.left + (allX.length <= 1 ? innerW / 2 : (i / (allX.length - 1)) * innerW);
  const yAt = (y: number) => PAD.top + innerH - (y / maxY) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(maxY * t));

  return (
    <svg className="analytics-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <defs>
        {series.map((s) => (
          <linearGradient key={`grad-${s.id}`} id={`grad-${s.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0.0" />
          </linearGradient>
        ))}
      </defs>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={yAt(tick)}
            y2={yAt(tick)}
            className="analytics-chart-grid"
          />
          <text x={PAD.left - 8} y={yAt(tick) + 3} textAnchor="end" className="analytics-chart-label">
            {new Intl.NumberFormat("vi-VN").format(tick)}
          </text>
        </g>
      ))}
      {allX.map((x, i) => (
        (i === 0 || i === allX.length - 1 || i % Math.ceil(allX.length / 6) === 0) ? (
          <text key={x} x={xAt(i)} y={height - 10} textAnchor="middle" className="analytics-chart-label">
            {x.slice(5)}
          </text>
        ) : null
      ))}
      {series.map((s) => {
        const byX = new Map(s.points.map((p) => [p.x, p.y]));
        const coords = allX
          .map((x, i) => {
            const y = byX.get(x);
            if (y === undefined) return null;
            return `${xAt(i)},${yAt(y)}`;
          })
          .filter(Boolean);
        if (coords.length === 0) return null;
        const firstX = coords[0]?.split(",")[0];
        const lastX = coords[coords.length - 1]?.split(",")[0];
        const areaPoints = firstX && lastX
          ? `${firstX},${PAD.top + innerH} ${coords.join(" ")} ${lastX},${PAD.top + innerH}`
          : "";
        return (
          <g key={s.id}>
            {areaPoints ? <polygon fill={`url(#grad-${s.id})`} points={areaPoints} /> : null}
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={coords.join(" ")}
            />
            {allX.map((x, i) => {
              const y = byX.get(x);
              if (y === undefined) return null;
              return (
                <circle
                  key={`${s.id}-${x}`}
                  cx={xAt(i)}
                  cy={yAt(y)}
                  r={3.5}
                  fill={s.color}
                  stroke="var(--color-neutral-0)"
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

export type StackedBarDatum = {
  id: string;
  label: string;
  segments: Array<{ id: string; value: number; color: string }>;
};

export function StackedBarChart({
  data,
  width = 640,
  height = 220,
  ariaLabel,
}: {
  data: StackedBarDatum[];
  width?: number;
  height?: number;
  ariaLabel: string;
}) {
  const maxY = niceMax(Math.max(0, ...data.map((d) => d.segments.reduce((s, seg) => s + seg.value, 0))));
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const gap = 12;
  const barW = data.length === 0 ? 0 : (innerW - gap * (data.length - 1)) / data.length;
  const ticks = [0, 0.5, 1].map((t) => Math.round(maxY * t));
  const yAt = (y: number) => PAD.top + innerH - (y / maxY) * innerH;

  return (
    <svg className="analytics-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={yAt(tick)}
            y2={yAt(tick)}
            className="analytics-chart-grid"
          />
          <text x={PAD.left - 8} y={yAt(tick) + 3} textAnchor="end" className="analytics-chart-label">
            {new Intl.NumberFormat("vi-VN").format(tick)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = PAD.left + i * (barW + gap);
        let stacked = 0;
        return (
          <g key={d.id}>
            {d.segments.map((seg) => {
              const barH = (seg.value / maxY) * innerH;
              const y = PAD.top + innerH - stacked - barH;
              stacked += barH;
              return (
                <rect
                  key={seg.id}
                  x={x}
                  y={y}
                  width={Math.max(barW, 1)}
                  height={Math.max(barH, 0)}
                  fill={seg.color}
                  rx={barH > 6 ? 2 : 0}
                />
              );
            })}
            <text x={x + barW / 2} y={height - 10} textAnchor="middle" className="analytics-chart-label">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function BarChart({
  data,
  width = 640,
  height = 220,
  ariaLabel,
}: {
  data: BarDatum[];
  width?: number;
  height?: number;
  ariaLabel: string;
}) {
  const maxY = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const gap = 12;
  const barW = data.length === 0 ? 0 : (innerW - gap * (data.length - 1)) / data.length;
  const ticks = [0, 0.5, 1].map((t) => Math.round(maxY * t));
  const yAt = (y: number) => PAD.top + innerH - (y / maxY) * innerH;

  return (
    <svg className="analytics-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={yAt(tick)}
            y2={yAt(tick)}
            className="analytics-chart-grid"
          />
          <text x={PAD.left - 8} y={yAt(tick) + 3} textAnchor="end" className="analytics-chart-label">
            {new Intl.NumberFormat("vi-VN").format(tick)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = PAD.left + i * (barW + gap);
        const barH = (d.value / maxY) * innerH;
        const y = PAD.top + innerH - barH;
        return (
          <g key={d.id}>
            <rect x={x} y={y} width={Math.max(barW, 1)} height={Math.max(barH, 0)} fill={d.color} rx={4} />
            <text x={x + barW / 2} y={height - 10} textAnchor="middle" className="analytics-chart-label">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
