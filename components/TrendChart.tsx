"use client";

import { useState } from "react";

export interface TrendPoint {
  label: string;
  shown: boolean;
  mean?: number;
  lo?: number;
  hi?: number;
  detail?: string;
}

export interface Marker {
  /** The marker sits between point `after` and the next one. */
  after: number;
  label: string;
}

const W = 340;
const H = 170;
const M = { left: 30, right: 12, top: 16, bottom: 26 };

export function TrendChart({
  title,
  subtitle,
  points,
  domain,
  ticks,
  format,
  markers = [],
  selected,
}: {
  title: string;
  subtitle?: string;
  points: TrendPoint[];
  domain: [number, number];
  ticks: number[];
  format: (v: number) => string;
  markers?: Marker[];
  selected?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const x = (i: number) => M.left + (n === 1 ? (W - M.left - M.right) / 2 : (i * (W - M.left - M.right)) / (n - 1));
  const y = (v: number) => M.top + ((domain[1] - v) * (H - M.top - M.bottom)) / (domain[1] - domain[0]);

  // Contiguous runs of shown points: hidden sprints break the line and the band.
  const runs: number[][] = [];
  points.forEach((p, i) => {
    if (!p.shown) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else runs.push([i]);
  });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };
  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
    else return;
    e.preventDefault();
  };

  const h = hover === null ? null : points[hover];
  return (
    <div className="chart">
      <h3>{title}</h3>
      {subtitle && <p className="chart-sub">{subtitle}</p>}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title} by sprint. Use the arrow keys to read each sprint; the table below has every value.`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={M.left - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--muted)">
              {format(t)}
            </text>
          </g>
        ))}
        {markers.map((m) => {
          const mx = (x(m.after) + x(Math.min(n - 1, m.after + 1))) / 2;
          return (
            <g key={m.label}>
              <line x1={mx} x2={mx} y1={M.top - 4} y2={H - M.bottom} stroke="var(--axis)" strokeWidth={1} />
              <text x={mx} y={M.top - 6} textAnchor="middle" fontSize={9} fill="var(--ink-2)">
                {m.label}
              </text>
            </g>
          );
        })}
        {runs.map((run) => {
          const top = run.map((i) => `${x(i)},${y(points[i].hi!)}`);
          const bottom = [...run].reverse().map((i) => `${x(i)},${y(points[i].lo!)}`);
          const line = run.map((i, j) => `${j ? "L" : "M"}${x(i)},${y(points[i].mean!)}`).join(" ");
          return (
            <g key={run[0]}>
              {run.length > 1 ? (
                <polygon points={[...top, ...bottom].join(" ")} fill="var(--series-wash)" />
              ) : (
                <line x1={x(run[0])} x2={x(run[0])} y1={y(points[run[0]].hi!)} y2={y(points[run[0]].lo!)} stroke="var(--series-wash)" strokeWidth={10} strokeLinecap="round" />
              )}
              <path d={line} fill="none" stroke="var(--series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {points.map((p, i) =>
          p.shown ? (
            <circle key={i} cx={x(i)} cy={y(p.mean!)} r={i === selected ? 5.5 : 4} fill="var(--series)" stroke="var(--surface)" strokeWidth={2} />
          ) : (
            <text key={i} x={x(i)} y={H - M.bottom - 6} textAnchor="middle" fontSize={9} fill="var(--muted)">
              hidden
            </text>
          ),
        )}
        {points.map((p, i) => (
          <text
            key={`l${i}`}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize={10}
            fill={i === selected ? "var(--ink)" : "var(--muted)"}
            fontWeight={i === selected ? 700 : 400}
          >
            {p.label.replace(/^Sprint /, "S")}
          </text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={H - M.bottom} stroke="var(--axis)" strokeWidth={1} />}
      </svg>
      {h && hover !== null && (
        <div
          className="tooltip"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            top: 28,
            transform: hover > n / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
          }}
        >
          <strong>{h.label}</strong>
          <br />
          {h.shown ? (
            <>
              {format(h.mean!)} (95% CI {format(h.lo!)} to {format(h.hi!)})
              {h.detail && (
                <>
                  <br />
                  {h.detail}
                </>
              )}
            </>
          ) : (
            "Not shown: fewer than k responses"
          )}
        </div>
      )}
    </div>
  );
}
