'use client';

// Peças pequenas compartilhadas pelas abas do painel da bio.

export function Card({
  titulo,
  acao,
  children,
}: {
  titulo?: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      {(titulo || acao) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {titulo && <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">{titulo}</h2>}
          {acao}
        </div>
      )}
      {children}
    </section>
  );
}

export function Campo({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim disabled:opacity-50';

export function Botao({
  children,
  onClick,
  tone = 'default',
  type = 'button',
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: 'default' | 'brand' | 'bad' | 'ghost';
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
}) {
  const cls =
    tone === 'brand'
      ? 'bg-brand text-bg hover:bg-brand/90'
      : tone === 'bad'
        ? 'border border-border text-bad hover:border-bad/50'
        : tone === 'ghost'
          ? 'text-muted hover:text-text'
          : 'border border-border bg-surface-2 hover:border-brand-dim';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

export function Chip({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'brand' | 'good' | 'warn' | 'bad' | 'muted';
}) {
  const cls = {
    brand: 'bg-brand/15 text-brand',
    good: 'bg-good/15 text-good',
    warn: 'bg-warn/15 text-warn',
    bad: 'bg-bad/15 text-bad',
    muted: 'bg-surface-2 text-muted',
  }[tone];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${cls}`}>{children}</span>;
}

export function Kpi({ label, valor, sufixo }: { label: string; valor: number | string; sufixo?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">
        {typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}
        {sufixo && <span className="ml-0.5 text-sm text-muted">{sufixo}</span>}
      </p>
    </div>
  );
}

/** Farol de status de conta/conexão, com o motivo em texto quando há erro. */
export function StatusConta({ status }: { status: string }) {
  const tone = status === 'ok' ? 'good' : status === 'token_expirado' ? 'warn' : 'bad';
  const rotulo = {
    ok: 'ok',
    token_expirado: 'reconectar',
    conta_pessoal: 'conta pessoal',
    privada: 'privada',
    erro: 'erro',
  }[status] ?? status;
  return <Chip tone={tone as 'good' | 'warn' | 'bad'}>{rotulo}</Chip>;
}
