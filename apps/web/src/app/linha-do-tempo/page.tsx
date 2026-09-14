'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { LinhaDoTempoFiltros, LinhaDoTempoItem, LinhaDoTempoResposta } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { agruparPorDia, atorLegivel } from './dias';

/*
 * ==========================================================================
 * A LINHA DO TEMPO — fatia A9
 * ==========================================================================
 *
 * A MESMA FONTE DE `/rastro`, OUTRA PERGUNTA. As duas leem o `EventLog`: lá é
 * prova (evento cru, cadeia de hash, verificação), aqui é história — em ordem,
 * agrupada por dia, com o ator e o objeto legíveis, filtrável por agente e por
 * tipo. Não há tabela nova e não há segundo caminho de escrita.
 *
 * ONDE ESTA TELA SE OBRIGA A NÃO MENTIR, e cada linha custou uma decisão:
 *
 *  1. EVENTO QUE ELA NÃO SABE NOMEAR APARECE COM O TIPO CRU, marcado. Sumir com
 *     ele deixaria a tela parecendo completa quando não está — e "não sei ler
 *     este evento" é informação sobre o sistema, não defeito a esconder;
 *  2. CONTEÚDO NÃO PASSA POR AQUI, e a tela DIZ isso na linha em que ele existe,
 *     com o caminho para onde se lê (`/atendimento`, que pede permissão
 *     própria). A rota devolve identificador, nunca o corpo do que foi feito;
 *  3. AS CONTAGENS DOS FILTROS SÃO PARCIAIS quando a janela corta, e o rodapé
 *     avisa. Contagem parcial dita é honesta; varredura completa escondida é a
 *     conta que só aparece no cliente grande;
 *  4. O HORIZONTE É O DA RETENÇÃO DESTA EMPRESA. A linha não começa na fundação
 *     do mundo: começa onde o expurgo parou de apagar, e isso está escrito;
 *  5. "CARREGAR MAIS" PAGINA POR CURSOR. Nada de `skip`: o rastro cresce pela
 *     frente e encurta por trás (expurgo), e com deslocamento a pessoa releria
 *     ou pularia linhas sem perceber.
 */

const CLS_ATOR: Record<string, string> = {
  user: 'bg-brand/15 text-brand',
  ai: 'bg-warn/15 text-warn',
  system: 'bg-surface-2 text-muted',
};

const CLS_NIVEL: Record<string, string> = {
  R0: 'text-muted',
  R1: 'text-muted',
  R2: 'text-warn',
  R3: 'text-warn',
  R4: 'text-bad',
  R5: 'text-bad',
};

interface Selecao {
  familia: string;
  agente: string;
  tipo: string;
}

const VAZIO: Selecao = { familia: '', agente: '', tipo: '' };

export default function LinhaDoTempoPage() {
  const { token, ready } = useAuth();
  const [itens, setItens] = useState<LinhaDoTempoItem[]>([]);
  const [filtros, setFiltros] = useState<LinhaDoTempoFiltros | null>(null);
  const [retencaoDias, setRetencaoDias] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sel, setSel] = useState<Selecao>(VAZIO);

  /*
   * `agora` FICA CONGELADO NA MONTAGEM, e é de propósito: se ele viesse de um
   * `new Date()` no corpo do render, os cabeçalhos "hoje"/"ontem" mudariam de
   * lugar no meio de uma rolagem, sem nada ter acontecido.
   */
  const agora = useMemo(() => new Date(), []);

  const buscar = useCallback(
    async (de: string | null, filtro: Selecao) => {
      if (!token) return;
      setCarregando(true);
      setErro(null);
      try {
        const params = new URLSearchParams({ limite: '50' });
        if (de) params.set('cursor', de);
        if (filtro.familia) params.set('familia', filtro.familia);
        if (filtro.agente) params.set('agente', filtro.agente);
        if (filtro.tipo) params.set('tipo', filtro.tipo);
        const r = await apiGet<LinhaDoTempoResposta>(`/linha-do-tempo?${params}`, token);
        // Página seguinte ACUMULA; primeira página substitui. Trocar o filtro
        // passa `null` como cursor, então o acúmulo não mistura dois recortes.
        setItens((antes) => (de ? [...antes, ...r.itens] : r.itens));
        setCursor(r.proximoCursor);
        setRetencaoDias(r.retencaoDias);
        // `filtros` só vem na primeira página — manter o que já havia é o que
        // impede o menu de filtros de esvaziar a cada "carregar mais".
        if (r.filtros) setFiltros(r.filtros);
      } catch (e) {
        setErro((e as Error).message);
      } finally {
        setCarregando(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!ready || !token) return;
    void buscar(null, sel);
  }, [ready, token, sel, buscar]);

  const dias = useMemo(() => agruparPorDia(itens, agora), [itens, agora]);
  const temFiltro = sel.familia !== '' || sel.agente !== '' || sel.tipo !== '';

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------------- cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted">
            A mesma fonte do{' '}
            <Link href="/rastro" className="text-brand hover:underline">
              Rastro
            </Link>
            , contada em ordem. {itens.length} evento(s) carregado(s)
            {cursor ? ' — há mais' : ''}.
          </p>
          {retencaoDias !== null && (
            <p className="text-xs text-muted">
              O horizonte é a retenção desta empresa: {retencaoDias} dia(s). O que venceu foi
              expurgado e não está aqui.
            </p>
          )}
        </div>

        {/* ------------------------------------------------------- os filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Família de evento"
            value={sel.familia}
            onChange={(e) => setSel((s) => ({ ...s, familia: e.target.value }))}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
          >
            <option value="">Todas as famílias</option>
            {filtros?.familias.map((f) => (
              <option key={f.chave} value={f.chave}>
                {f.rotulo} ({f.eventos})
              </option>
            ))}
          </select>

          <select
            aria-label="Agente"
            value={sel.agente}
            onChange={(e) => setSel((s) => ({ ...s, agente: e.target.value }))}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
          >
            <option value="">Todos os agentes</option>
            {filtros?.agentes.map((a) => (
              <option key={a.slug} value={a.slug}>
                {/* Slug sem nome = agente que não é mais desta casa. Diz isso. */}
                {a.nome ?? `${a.slug} (fora da casa)`} ({a.eventos})
              </option>
            ))}
          </select>

          <select
            aria-label="Tipo de evento"
            value={sel.tipo}
            onChange={(e) => setSel((s) => ({ ...s, tipo: e.target.value }))}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
          >
            <option value="">Todos os tipos</option>
            {filtros?.tipos.map((t) => (
              <option key={t.tipo} value={t.tipo}>
                {t.rotulo} ({t.eventos})
              </option>
            ))}
          </select>

          {temFiltro && (
            <button
              onClick={() => setSel(VAZIO)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-text"
            >
              limpar
            </button>
          )}
        </div>
      </div>

      {erro && <div className="text-sm text-bad">{erro}</div>}

      {/* ------------------------------------------------------------- a linha */}
      {dias.map((dia) => (
        <section key={dia.chave} className="space-y-2">
          <h2 className="sticky top-0 z-10 bg-bg/95 py-1 text-xs font-medium uppercase tracking-wide text-muted">
            {dia.rotulo} · {dia.itens.length} evento(s)
          </h2>
          <ol className="overflow-hidden rounded-xl border border-border">
            {dia.itens.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-2"
              >
                <span className="w-14 shrink-0 text-xs text-muted">
                  {new Date(item.ocorreuEm).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>

                <span className="text-sm font-medium">{item.rotulo}</span>

                {/*
                 * O SELO DO EVENTO QUE ELA NÃO SABE LER. Não esconde a linha:
                 * marca-a. O rótulo já é o tipo cru (a API devolve assim), então
                 * o que o selo acrescenta é a leitura honesta do que está à
                 * frente — "isto é o nome interno, não uma frase".
                 */}
                {!item.conhecido && (
                  <span
                    className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted"
                    title="Esta tela ainda não sabe nomear este tipo de evento. O tipo cru está à esquerda, e o fato está registrado no rastro do mesmo jeito."
                  >
                    não sei ler este evento
                  </span>
                )}

                <span className={`rounded px-1.5 py-0.5 text-[11px] ${CLS_ATOR[item.atorTipo] ?? ''}`}>
                  {atorLegivel(item)}
                </span>

                {item.nivel && (
                  <span className={`text-[11px] ${CLS_NIVEL[item.nivel] ?? 'text-muted'}`}>
                    {item.nivel}
                  </span>
                )}

                {item.objeto.map((campo) => (
                  <span key={campo.chave} className="text-xs text-muted">
                    {campo.chave}: <span className="text-text">{campo.valor}</span>
                  </span>
                ))}

                {/*
                 * O QUE ESTA TELA NÃO MOSTRA, DITO NA LINHA EM QUE FALTA.
                 * O corpo do que foi feito (a mensagem, o motivo escrito, o
                 * resultado) não sai por esta rota — sai na fila de aprovação,
                 * que pede permissão própria. Calar seria deixar quem lê achar
                 * que a linha está inteira.
                 */}
                {item.temConteudo && (
                  <Link
                    href="/atendimento"
                    className="text-xs text-muted underline decoration-dotted hover:text-text"
                    title="Este evento carrega conteúdo (mensagem, motivo escrito, resultado) que a linha do tempo não devolve. O conteúdo exato se lê na fila de aprovação."
                  >
                    tem conteúdo
                  </Link>
                )}

                {item.registroCompleto === false && (
                  <span
                    className="text-xs text-warn"
                    title="A conferência por nível gravou esta linha com campos faltando. O fato aconteceu; o registro dele está incompleto."
                  >
                    registro incompleto
                  </span>
                )}

                <span className="ml-auto font-mono text-[11px] text-muted">#{item.seq}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {!carregando && itens.length === 0 && !erro && (
        <div className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted">
          {temFiltro
            ? 'Nenhum evento com esse recorte. O filtro é exato — família, agente e tipo têm de casar ao mesmo tempo.'
            : 'Nenhum evento no rastro desta empresa ainda. A linha começa na primeira ação registrada.'}
        </div>
      )}

      {/* ------------------------------------------------------------- rodapé */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {cursor ? (
          <button
            onClick={() => void buscar(cursor, sel)}
            disabled={carregando}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-text disabled:opacity-50"
          >
            {carregando ? 'carregando…' : 'carregar mais'}
          </button>
        ) : (
          <span className="text-xs text-muted">
            {itens.length > 0 ? 'fim da linha — não há mais eventos guardados' : ''}
          </span>
        )}

        {filtros && (
          <span className="text-xs text-muted">
            {filtros.parcial
              ? `Contagens dos filtros medidas nos ${filtros.janela} eventos mais recentes — são PARCIAIS.`
              : `Contagens dos filtros medidas nos ${filtros.janela} eventos desta empresa.`}
            {filtros.desconhecidos > 0 &&
              ` ${filtros.desconhecidos} tipo(s) de evento sem nome nesta tela.`}
          </span>
        )}
      </div>
    </div>
  );
}
