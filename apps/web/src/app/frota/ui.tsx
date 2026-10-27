'use client';

import { Chip } from '../referencias/ui';
import { ROTULO, TOM, type EstadoDaPolitica } from './tipos';

export function Estado({ estado, texto }: { estado: EstadoDaPolitica; texto?: string }) {
  return <Chip tone={TOM[estado]}>{texto ?? ROTULO[estado]}</Chip>;
}

export function Barra({ pct, tom }: { pct: number | null; tom?: 'good' | 'warn' | 'bad' }) {
  const v = Math.max(0, Math.min(100, pct ?? 0));
  const cor = tom === 'bad' ? 'bg-bad' : tom === 'warn' ? 'bg-warn' : 'bg-muted';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded border border-border bg-surface-2">
      <div className={`h-full ${cor}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Rotulo({ children }: { children: React.ReactNode }) {
  return <span className="block font-os-mono text-[10px] uppercase tracking-[0.14em] text-muted">{children}</span>;
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="rounded-root border border-dashed border-border px-3 py-4 text-[12px] text-muted">{children}</p>;
}

export function Mono({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`font-os-mono text-[11.5px] ${className}`}>{children}</span>;
}

export function Aba({ ativa, onClick, children, contagem, tom }: { ativa: boolean; onClick: () => void; children: React.ReactNode; contagem?: number; tom?: 'warn' | 'bad' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={ativa}
      role="tab"
      className={`whitespace-nowrap border-b-2 px-3 py-2 font-os-mono text-[11px] uppercase tracking-[0.12em] ${ativa ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-text'}`}
    >
      {children}
      {contagem !== undefined && contagem > 0 && (
        <span className={`ml-1.5 rounded bg-surface-2 px-1 text-[10px] ${tom === 'bad' ? 'text-bad' : tom === 'warn' ? 'text-warn' : 'text-muted'}`}>{contagem}</span>
      )}
    </button>
  );
}

export function Terminal({ linhas }: { linhas: { n: 'ok' | 'av' | 'fa'; t: string }[] }) {
  return (
    <pre className="overflow-x-auto rounded-root border border-border bg-surface-2 p-3 font-os-mono text-[11px] leading-[1.7]">
      {linhas.map((l, i) => (
        <div key={i}>
          <span className={l.n === 'ok' ? 'text-good' : l.n === 'av' ? 'text-warn' : 'text-bad'}>{l.n === 'ok' ? '  ok  ' : l.n === 'av' ? 'aviso ' : 'FALHA '}</span>
          {l.t}
        </div>
      ))}
    </pre>
  );
}
