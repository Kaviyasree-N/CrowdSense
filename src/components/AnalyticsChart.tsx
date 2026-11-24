import { ReactNode } from 'react';

interface AnalyticsChartProps {
  title: string;
  subtitle: string;
  dataSourceLabel?: string;
  children: ReactNode;
}

export function AnalyticsChart({
  title,
  subtitle,
  dataSourceLabel = 'DEMO DATA – NOT ACTUAL TRANSPORT DATA',
  children,
}: AnalyticsChartProps) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <span className="text-[10px] font-mono-tabular font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">
          {dataSourceLabel}
        </span>
      </div>
      <div className="w-full h-64">{children}</div>
    </section>
  );
}
