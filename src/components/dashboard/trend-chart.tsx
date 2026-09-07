'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const SERIES = [
  { key: 'enquiries', label: 'Enquiries', color: 'oklch(0.515 0.196 268)' },
  { key: 'followUps', label: 'Follow-ups sent', color: 'oklch(0.646 0.16 60)' },
  { key: 'conversions', label: 'Conversions', color: 'oklch(0.556 0.12 163)' },
] as const;

export function TrendChart({
  data,
}: {
  data: Array<{ date: string; enquiries: number; conversions: number; followUps: number }>;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4">
        {SERIES.map((series) => (
          <span key={series.key} className="flex items-center gap-1.5 text-[12px] text-ink-600">
            <span aria-hidden className="size-2 rounded-full" style={{ background: series.color }} />
            {series.label}
          </span>
        ))}
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="oklch(0.925 0.005 265)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => value.slice(5)}
              tick={{ fontSize: 11, fill: 'oklch(0.565 0.015 265)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: 'oklch(0.565 0.015 265)' }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: '1px solid oklch(0.925 0.005 265)',
                fontSize: 12,
              }}
            />
            {SERIES.map((series) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={series.color}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
