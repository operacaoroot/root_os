'use client';

/*
 * As peças pequenas desta tela.
 *
 * POR QUE UMA CÓPIA LOCAL, E NÃO UM IMPORT DE `../referencias/ui`
 * A primeira escrita desta tela importava de `app/referencias/ui` — a pasta do
 * módulo de Pauta. A assinatura é ESPINHA do OS e responde para empresa
 * suspensa; Referências é módulo de negócio, que uma empresa pode não ter
 * contratado. Depender do arquivo de um módulo faria a tela de suspensão carregar
 * código do módulo que ela própria acabou de bloquear, e qualquer mudança de
 * visual do acervo de referências mexeria na tela em que o cliente lê que não
 * perdeu nada.
 *
 * A casa já resolve isso assim: `app/bio/ui.tsx` e `app/referencias/ui.tsx` são
 * duas cópias das MESMAS peças, cada uma no seu módulo, e o comentário do
 * segundo diz isso com todas as letras. Esta é a terceira, e o que amarra as
 * três é a mesma folha de tokens (`border`, `surface`, `muted`, `brand`), não um
 * import cruzado.
 */

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
          {titulo && (
            <h2 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              {titulo}
            </h2>
          )}
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
