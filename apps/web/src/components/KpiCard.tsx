import Link from 'next/link';
import * as Icons from 'lucide-react';

type Tone = 'default' | 'good' | 'warn' | 'bad' | 'brand';

export function KpiCard({
  label,
  value,
  hint,
  href,
  tone = 'default',
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: Tone;
  icon?: keyof typeof Icons;
}) {
  const toneCls: Record<Tone, string> = {
    default: 'text-text',
    good: 'text-good',
    warn: 'text-warn',
    bad: 'text-bad',
    brand: 'text-brand',
  };
  const Icon = (icon ? Icons[icon] : Icons.BarChart3) as React.ElementType;

  const inner = (
    <div className="group h-full rounded-xl border border-border bg-surface p-4 transition hover:border-brand-dim hover:bg-surface-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">
          {label}
        </span>
        <Icon size={16} className="text-muted group-hover:text-brand" />
      </div>
      <div className={`mt-2 text-2xl font-semibold ${toneCls[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
      {href && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-brand opacity-0 transition group-hover:opacity-100">
          ver detalhes <Icons.ArrowRight size={12} />
        </div>
      )}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}
