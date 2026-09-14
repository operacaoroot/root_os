'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiPost } from '@/lib/api';

/* ==========================================================================
 * O ORÇAMENTO MENSAL DE IA DO AGENTE, na tela — fatia A3
 * ==========================================================================
 *
 * O QUE ESTE CARTÃO MOSTRA, E O QUE ELE NÃO MOSTRA. Ele mostra a DECISÃO: o
 * valor, se está valendo ou em observação, quem definiu e por quê. Ele NÃO
 * mostra quanto o agente já gastou no mês — e a ausência é escolha.
 *
 * O gasto do mês vem do log de passos (`SessionStep`), e quem o soma é a tela
 * de Custos, pela mesma leitura que o corte usa. Repetir aqui um número que
 * esta rota não carrega exigiria uma segunda consulta, num segundo instante,
 * escrita num segundo lugar — e duas leituras do mesmo dinheiro é como as duas
 * telas de horas passaram a se contradizer. Então este cartão manda para lá,
 * com o link.
 *
 * A TELA DIZ ANTES DO CLIQUE o que vai acontecer: orçamento em observação soma
 * e não corta; orçamento de zero valendo PARA o agente na hora, e o campo de
 * motivo fica obrigatório (a API recusa sem ele, e a tela não oferece um botão
 * que a rota vai negar).
 */

export interface OrcamentoDoAgente {
  mensalUsd: number;
  ativo: boolean;
  definidoEm: string | null;
  definidoPor: string | null;
  motivo: string | null;
}

/** `US$ 12,3400` — vírgula decimal, como se lê em português. */
function usd(v: number): string {
  return `US$ ${v.toFixed(2).replace('.', ',')}`;
}

export function Orcamento({
  slug,
  orcamento,
  token,
  podeDefinir,
  aoMudar,
}: {
  slug: string;
  orcamento: OrcamentoDoAgente | null;
  token: string | null;
  podeDefinir: boolean;
  aoMudar: () => void;
}) {
  const [abrir, setAbrir] = useState(false);
  const [valor, setValor] = useState(orcamento ? String(orcamento.mensalUsd) : '');
  const [ativo, setAtivo] = useState(orcamento?.ativo ?? true);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const mensalUsd = Number(valor.replace(',', '.'));
  const zeradoValendo = ativo && mensalUsd === 0;
  const podeSalvar =
    Number.isFinite(mensalUsd) && mensalUsd >= 0 && (!zeradoValendo || motivo.trim().length > 0);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      await apiPost(
        `/agents/${slug}/orcamento`,
        { mensalUsd, ativo, motivo: motivo.trim() || undefined },
        token,
      );
      setAbrir(false);
      setMotivo('');
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex flex-wrap items-baseline gap-2">
        {orcamento ? (
          <p className="font-os-mono text-[10px] text-muted">
            <span className="text-text">{usd(orcamento.mensalUsd)}</span> de orçamento por mês
            {orcamento.ativo ? (
              <span className="text-dim"> · valendo: passa disso e a chamada é recusada</span>
            ) : (
              <span className="text-warn"> · em observação: soma e NÃO corta</span>
            )}
            {orcamento.definidoPor && (
              <span className="text-dim"> · por {orcamento.definidoPor}</span>
            )}
          </p>
        ) : (
          <p className="font-os-mono text-[10px] text-dim">
            sem orçamento mensal — este agente gasta até onde o teto da empresa deixar
          </p>
        )}

        {podeDefinir && (
          <button
            type="button"
            onClick={() => setAbrir((v) => !v)}
            className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-brand hover:underline"
          >
            {orcamento ? 'mudar orçamento' : 'definir orçamento'}
          </button>
        )}
        <span className="flex-1" />
        <Link
          href="/painel/custo-ia"
          className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-muted hover:text-text"
        >
          gasto do mês
        </Link>
      </div>

      {orcamento?.motivo && (
        <p className="mt-1 font-os-mono text-[9px] leading-[1.6] text-dim">
          &ldquo;{orcamento.motivo}&rdquo;
        </p>
      )}

      {abrir && (
        <div className="mt-2 space-y-2 rounded-root border border-border bg-bg p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-os-mono text-[9px] uppercase tracking-[0.1em] text-dim">
              US$ por mês
            </span>
            <input
              autoFocus
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="20,00"
              className="w-[110px] rounded-root border border-border bg-bg px-2 py-1 font-os-mono text-[10px] text-text outline-none focus:border-brand"
            />
            <label className="flex items-center gap-1 font-os-mono text-[9.5px] text-muted">
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
              cortar quando estourar
            </label>
          </div>

          {/* A TELA DIZ ANTES DO CLIQUE — ver o cabeçalho deste arquivo. */}
          {!ativo && (
            <p className="font-os-mono text-[9px] leading-[1.6] text-warn">
              Sem &ldquo;cortar quando estourar&rdquo;, o orçamento fica em OBSERVAÇÃO: o gasto
              continua sendo somado e mostrado, e nenhuma chamada é recusada. Serve para calibrar o
              valor antes de impor.
            </p>
          )}
          {zeradoValendo && (
            <p className="font-os-mono text-[9px] leading-[1.6] text-bad">
              US$ 0,00 valendo PARA este agente: toda chamada de modelo dele passa a ser recusada, na
              hora. O motivo é obrigatório — é o que diz a quem abrir esta tela depois se pode
              religar.
            </p>
          )}

          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={zeradoValendo ? 'motivo (obrigatório)' : 'motivo (opcional)'}
            className="w-full rounded-root border border-border bg-bg px-2 py-1 font-os-mono text-[10px] text-text outline-none focus:border-brand"
          />

          {erro && <p className="font-os-mono text-[9.5px] text-bad">{erro}</p>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!podeSalvar || salvando}
              onClick={salvar}
              className="rounded-root bg-brand px-2 py-1 font-os-mono text-[9.5px] uppercase text-ink disabled:opacity-40"
            >
              {salvando ? 'salvando…' : 'salvar'}
            </button>
            <button
              type="button"
              onClick={() => setAbrir(false)}
              className="font-os-mono text-[9.5px] text-muted"
            >
              cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
