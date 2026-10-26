'use client';

/*
 * PEÇAS DO PAINEL (18/10/2026): o vocabulário visual do Painel geral do
 * comercial, para as outras telas (financeiro, propostas, clientes) usarem o
 * mesmo código em vez de copiar. Tudo vale dentro de `.com-tema` (globals.css):
 * texto 15px, mono só em rótulo (`.com-rotulo`) e número (`.com-num`), um acento
 * só (lima, `brand`).
 *
 *   · Quadro: o cartão de seção (título, nota, ação à direita).
 *   · Numero: o número grande, clicável, com rótulo e nota.
 *   · BarraDividida: o destaque do topo, partes de um total numa barra só.
 *   · Colunas: o gráfico de colunas com dica ao passar o mouse e clique.
 *   · Dica: a caixinha que aparece sobre o item com `group` (hover ou foco).
 */

export const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
/** 15.000 → "15 mil": para rótulo de coluna, onde não cabe o valor inteiro. */
export const curto = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : n.toLocaleString('pt-BR');

/** Tom de uma parte ou coluna: forte (lima cheio), médio (lima claro), fraco (cinza). */
export type Tom = 'forte' | 'medio' | 'fraco';
export const COR_DO_TOM: Record<Tom, string> = { forte: 'bg-brand', medio: 'bg-brand/45', fraco: 'bg-muted/40' };

export function Quadro(props: { titulo: string; nota?: string; acao?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-md border border-border bg-surface px-5 py-4 ${props.className ?? ''}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[1.05rem] font-semibold">{props.titulo}</h2>
        {props.acao}
      </div>
      {props.nota && <p className="text-sm text-muted">{props.nota}</p>}
      <div className="mt-4">{props.children}</div>
    </section>
  );
}

/** O número grande. Com `onClick` vira botão e mostra "ver →" ao passar o mouse. */
export function Numero(props: {
  rotulo: string;
  valor: string;
  nota?: string;
  /** Classe do quadradinho de cor ao lado do rótulo (ex.: COR_DO_TOM.forte). */
  cor?: string;
  tamanho?: 'grande' | 'medio' | 'texto';
  onClick?: () => void;
}) {
  const tam = props.tamanho === 'medio' ? 'com-num text-[1.5rem]' : props.tamanho === 'texto' ? 'text-[1.1rem]' : 'com-num text-[2.4rem]';
  const corpo = (
    <>
      <div className="com-rotulo flex items-center gap-2">
        {props.cor && <span className={`inline-block h-2.5 w-2.5 rounded-sm ${props.cor}`} />}
        {props.rotulo}
      </div>
      <div className={`mt-1.5 font-bold leading-none ${tam}`}>{props.valor}</div>
      {props.nota && (
        <div className="mt-1.5 text-sm text-muted">
          {props.nota}
          {props.onClick && <span className="opacity-0 transition group-hover:opacity-100"> · ver →</span>}
        </div>
      )}
    </>
  );
  if (!props.onClick) return <div className="p-1">{corpo}</div>;
  return (
    // Layout 26/10: conteúdo preso no topo (botão esticado na grade centralizava e desalinhava a linha).
    <button onClick={props.onClick} className="group flex flex-col justify-start self-start rounded-md p-1 text-left hover:bg-surface-2">
      {corpo}
    </button>
  );
}

/** A dica sobre o item que tem `group relative`: aparece no hover e no foco do teclado. */
export function Dica({ linhas, chamada = 'clique para ver os detalhes' }: { linhas: string[]; chamada?: string | null }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface-3 px-3 py-2 text-left text-xs shadow-lg group-hover:block group-focus-visible:block">
      <span className="block font-semibold text-text">{linhas[0]}</span>
      {linhas.slice(1).map((l) => (
        <span key={l} className="com-num block text-muted">{l}</span>
      ))}
      {chamada && <span className="mt-1 block text-brand">{chamada}</span>}
    </span>
  );
}

export interface ParteDaBarra {
  chave: string;
  valor: number;
  tom: Tom;
  dica: string[];
  onClick?: () => void;
}

/**
 * Partes de um total numa barra só, na proporção do valor (o destaque do
 * Painel geral: fechado x em negociação = potencial). Parte zerada some.
 */
export function BarraDividida(props: { partes: ParteDaBarra[]; rotuloDoTotal: string; total?: string; chamada?: string }) {
  const soma = props.partes.reduce((s, p) => s + p.valor, 0);
  const visiveis = props.partes.filter((p) => p.valor > 0);
  return (
    <div>
      <div className="flex h-5 w-full gap-0.5 overflow-visible rounded-sm bg-surface-2">
        {visiveis.map((p, i) => (
          <button
            key={p.chave}
            onClick={p.onClick}
            className={`group relative h-full ${COR_DO_TOM[p.tom]} hover:brightness-110 ${i === 0 ? 'rounded-l-sm' : ''} ${i === visiveis.length - 1 ? 'rounded-r-sm' : ''}`}
            style={{ width: `${Math.max(4, (p.valor / (soma || 1)) * 100)}%` }}
            aria-label={p.dica.join(', ')}
          >
            <Dica linhas={p.dica} chamada={p.onClick ? props.chamada : null} />
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        <span className="com-rotulo">{props.rotuloDoTotal}</span>
        <span className="com-num text-sm">{props.total ?? brl(soma)}</span>
      </div>
    </div>
  );
}

export interface Coluna {
  chave: string;
  /** O nome embaixo da coluna. */
  rotulo: string;
  v: number;
  /** O número em cima da coluna (ex.: curto(v)). */
  mostra: string;
  tom: Tom;
  dica: string[];
  onClick?: () => void;
}

/** Colunas com o número em cima, o nome embaixo, dica no hover e clique. */
export function Colunas({ itens, chamada }: { itens: Coluna[]; chamada?: string }) {
  const max = Math.max(1, ...itens.map((i) => i.v));
  return (
    <div>
      <div className="flex h-44 items-end gap-2">
        {itens.map((i) => (
          <button
            key={i.chave}
            onClick={i.onClick}
            aria-label={i.dica.join(', ')}
            className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-sm hover:bg-surface-2"
          >
            <Dica linhas={i.dica} chamada={i.onClick ? chamada : null} />
            {i.v > 0 && <span className="com-num text-[0.72rem]">{i.mostra}</span>}
            <span
              className={`block w-full rounded-t-sm ${COR_DO_TOM[i.tom]} transition group-hover:brightness-110 group-hover:ring-2 group-hover:ring-brand/50`}
              style={{ height: i.v ? `${Math.max(3, (i.v / max) * 100)}%` : '1px' }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2 border-t border-border pt-1.5">
        {itens.map((i) => (
          <span key={i.chave} className="min-w-0 flex-1 text-center text-[0.72rem] leading-tight text-muted [overflow-wrap:anywhere]">
            {i.rotulo}
          </span>
        ))}
      </div>
    </div>
  );
}
