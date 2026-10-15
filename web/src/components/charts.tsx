import type { ReactNode } from "react";
import { formatShortDay } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Charts in plain SVG and HTML: rounded bars, soft grids, numbers in tabular figures. */

/** One KPI card: a coloured accent bar, the label, a big number and a short hint. */
export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "red" | "amber" | "green" }) {
  const color = tone ? { red: "text-red", amber: "text-amber", green: "text-green" }[tone] : "text-ink";
  const accent = tone ? { red: "bg-red", amber: "bg-amber", green: "bg-green" }[tone] : "bg-primary";
  return (
    <div className="card min-w-0 p-5">
      <span className={cn("block h-1.5 w-8 rounded-full", accent)} aria-hidden />
      <div className="mt-4 text-[13.5px] font-semibold text-muted">{label}</div>
      <div className={cn("mt-1 font-display text-[32px] leading-none font-semibold tracking-tight tabular", color)}>{value}</div>
      {hint && <div className="mt-1.5 text-[12.5px] text-muted">{hint}</div>}
    </div>
  );
}

/** The row of Stat cards. */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6", className)}>{children}</div>;
}

/** Horizontal bars, longest first as given. */
export function BarChart({ data, empty = "Nothing yet." }: { data: Array<{ label: string; value: number }>; empty?: string }) {
  if (data.length === 0) return <p className="px-5 py-6 text-muted">{empty}</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="flex flex-col gap-2.5 px-5 py-4">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-3">
          <span className="truncate text-[13.5px]" title={d.label}>
            {d.label}
          </span>
          <span className="h-2.5 overflow-hidden rounded-full bg-line-soft" aria-hidden>
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono text-[12.5px] font-medium tabular">{d.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** 30 days of opened vs resolved tickets as paired columns. */
export function DailyChart({ daily }: { daily: Array<{ day: number; opened: number; resolved: number }> }) {
  const width = 720;
  const height = 200;
  const pad = { top: 12, right: 8, bottom: 26, left: 28 };
  const max = Math.max(2, ...daily.flatMap((d) => [d.opened, d.resolved]));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / Math.max(daily.length, 1);
  const bar = Math.max(2, slot * 0.36);
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const totalOpened = daily.reduce((s, d) => s + d.opened, 0);
  const totalResolved = daily.reduce((s, d) => s + d.resolved, 0);

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex gap-5 text-[12.5px] text-muted">
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-primary" /> Opened
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-green" /> Resolved
        </span>
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[600px]" role="img">
        <title>{`Tickets per day over the last ${daily.length} days: ${totalOpened} opened, ${totalResolved} resolved`}</title>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={pad.left} x2={width - pad.right} y1={y(i * step)} y2={y(i * step)} stroke="var(--line-soft)" strokeWidth={1} />
            <text x={pad.left - 6} y={y(i * step) + 3.5} textAnchor="end" fontSize={10} fill="var(--faint)" fontFamily="var(--font-sans)">
              {i * step}
            </text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = pad.left + i * slot + (slot - bar * 2 - 1) / 2;
          return (
            <g key={d.day}>
              <title>{`${formatShortDay(d.day)}: ${d.opened} opened, ${d.resolved} resolved`}</title>
              <rect x={x} y={y(d.opened)} width={bar} height={Math.max(0, y(0) - y(d.opened))} rx={Math.min(3, bar / 2)} fill="var(--primary)" />
              <rect x={x + bar + 1} y={y(d.resolved)} width={bar} height={Math.max(0, y(0) - y(d.resolved))} rx={Math.min(3, bar / 2)} fill="var(--green)" />
              {i % 7 === 0 && (
                <text x={pad.left + i * slot + slot / 2} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--muted)" fontFamily="var(--font-sans)">
                  {formatShortDay(d.day)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth={1} />
      </svg>
      </div>
    </div>
  );
}
