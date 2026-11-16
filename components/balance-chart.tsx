"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate, formatKr, formatMonth } from "@/lib/format";

const DAY_MS = 86_400_000;

function compactKr(ore: number): string {
  const kr = ore / 100;
  const abs = Math.abs(kr);
  if (abs >= 1_000_000) return `${(kr / 1_000_000).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} mill.`;
  if (abs >= 1_000) return `${(kr / 1_000).toLocaleString("nb-NO", { maximumFractionDigits: 1 })}k`;
  return kr.toLocaleString("nb-NO", { maximumFractionDigits: 0 });
}

/** Balance over time: vertical steps where money moved, slopes where interest accrued. */
export function BalanceChart({ series }: { series: { date: string; balanceOre: number }[] }) {
  const data = series.map((point) => ({
    time: Date.parse(`${point.date}T00:00:00Z`),
    balanceOre: point.balanceOre,
  }));
  const span = data[data.length - 1].time - data[0].time;
  const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

  return (
    <div className="h-52 w-full" role="img" aria-label="Saldo over tid">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--md-primary)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--md-primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--md-outline-variant)" strokeOpacity={0.6} />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(time: number) =>
              span < 60 * DAY_MS ? formatDate(iso(time)).replace(/\s\d{4}$/, "") : formatMonth(iso(time))
            }
            tick={{ fill: "var(--md-on-surface-variant)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--md-outline-variant)" }}
            minTickGap={48}
          />
          <YAxis
            tickFormatter={compactKr}
            tick={{ fill: "var(--md-on-surface-variant)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={[(min: number) => Math.min(0, min), "auto"]}
          />
          <Tooltip
            cursor={{ stroke: "var(--md-outline)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const point = active ? payload?.[0]?.payload : null;
              if (!point) return null;
              return (
                <div className="rounded-xl bg-surface-highest px-3 py-2 text-sm shadow-fab">
                  <div className="text-on-surface-variant">{formatDate(iso(point.time))}</div>
                  <div className="font-medium tabular-nums">{formatKr(point.balanceOre)}</div>
                </div>
              );
            }}
          />
          <Area
            type="linear"
            dataKey="balanceOre"
            stroke="var(--md-primary)"
            strokeWidth={2}
            fill="url(#balanceFill)"
            isAnimationActive={false}
            activeDot={{ r: 5, stroke: "var(--md-surface-low)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
