import Link from 'next/link';
import * as Icons from 'lucide-react';

type Tone = 'default' | 'good' | 'warn' | 'bad' | 'brand';

// Cor do NÚMERO. O tom 'brand' existe para o KPI que é o assunto da tela;
// good/warn/bad são a escala de estado (ver globals.css).
const CORES: Record<Tone, string> = {
  default: 'text-text',
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  brand: 'text-brand',
};

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
  const Icon = (icon ? Icons[icon] : Icons.BarChart3) as React.ElementType;

  const inner = (
    <div className="group h-full rounded-root border border-border bg-surface px-[14px] py-[13px] font-os-mono shadow-none transition-colors duration-150 hover:border-brand/30 hover:bg-surface-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] uppercase tracking-[0.16em] text-muted">{label}</span>
        <Icon size={13} className="flex-none text-dim transition-colors group-hover:text-brand" />
      </div>

      <div
        className={`mt-[7px] text-[23px] font-bold leading-none tracking-[-0.04em] tabular-nums ${CORES[tone]}`}
      >
        {value}
      </div>

      {hint && <div className="mt-[6px] text-[10px] text-muted">{hint}</div>}

      {href && (
        <div className="mt-[8px] flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-brand opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          ver detalhes <Icons.ArrowRight size={11} />
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
