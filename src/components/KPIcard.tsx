interface KPIcardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  accent?: 'default' | 'teal' | 'amber' | 'red';
}

export function KPIcard({ label, value, subtitle, accent = 'default' }: KPIcardProps) {
  const valueColor =
    accent === 'teal'
      ? 'text-teal-800'
      : accent === 'amber'
      ? 'text-amber-700'
      : accent === 'red'
      ? 'text-red-700'
      : 'text-slate-900';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-2">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`font-display text-2xl font-bold tabular-nums tracking-tight ${valueColor}`}>
        {value}
      </div>
      {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
    </div>
  );
}
