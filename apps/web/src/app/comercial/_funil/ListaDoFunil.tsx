'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { CartaoDoFunil } from '@mktos/shared';
import { COMERCIAL_ROTULO_DA_ETAPA } from '@mktos/shared';

import { ROTULO_DO_PRODUTO } from '@/lib/cockpit';

import { Chip, FOCO } from '../_ui';
import { LinkDoLead } from '../_painel/provedor';
import { CelulaDoResponsavel } from './CelulaDoResponsavel';
import { BotaoDoMenuDoLead, alvoDoMenuDoLead, useMenuDoLead, type LeadParaOMenu } from './MenuDoLead';
import {
  CHAVE_DAS_LARGURAS,
  LARGURA_MAXIMA,
  COLUNAS_DA_LISTA,
  COLUNAS_PADRAO,
  alternarColuna,
  ariaSort,
  colunaDa,
  dataCompleta,
  dataCurta,
  dinheiro,
  larguraDa,
  larguraDaTabela,
  lerLarguras,
  limitarLargura,
  ordenarCartoes,
  proximaOrdem,
  saoAsPadrao,
  tomDaEtapa,
  type ChaveDaColuna,
  type Larguras,
  type OrdemDaLista,
} from './lista-do-funil';
import { contagemDeTarefas, proximaAcaoDoCartao, type LinhaDaProximaAcao } from './proxima-acao-do-cartao';
import { partesDoLead } from '@/lib/nome-do-lead';

/*
 * O FORMATO LISTA DO FUNIL VIVO (U4; refeita na rodada de produção 3, I5, 22/10/2026).
 *
 * Uma tabela de verdade, feita à mão (sem biblioteca de grade): largura mínima
 * por coluna, colunas que se ajustam ARRASTANDO a borda do cabeçalho (ou pelas
 * setas do teclado na borda focada; dois cliques voltam ao padrão), larguras
 * guardadas no navegador, cabeçalho fixo, linhas com altura confortável, valor
 * em reais e datas de São Paulo, a etapa como chip, o responsável como avatar
 * com o nome no balão. A rolagem para o lado é SÓ da tabela. O clique no
 * cabeçalho ordena (crescente, decrescente, sem ordem) e o `aria-sort` diz qual.
 * Quais colunas aparecem e a ordem moram no endereço (a página cuida).
 *
 * Abaixo de 640 px a tabela vira cartões empilhados com as mesmas colunas.
 * A linha inteira abre o painel do lead, como o cartão do quadro.
 *
 * Leva 5 (L2, 27/10/2026): botão direito na linha (e no cartão do celular) e o
 * "⋯" ao lado da empresa abrem o menu do lead (`MenuDoLead`), quando a tela de
 * cima o provê (o funil provê).
 */

const PASSO_DO_TECLADO = 16;

function TextoDaAcao({ linha }: { linha: LinhaDaProximaAcao | null }) {
  if (!linha) return <span className="text-dim">próxima ação ausente</span>;
  return (
    <>
      {linha.texto}
      {linha.quando && <span className={linha.atrasada ? 'text-warn' : 'text-dim'}> · {linha.quando}</span>}
    </>
  );
}

/** O conteúdo de uma célula, igual na tabela e no cartão do celular. */
function Conteudo({ c, chave, testId }: { c: CartaoDoFunil; chave: ChaveDaColuna; testId?: string }) {
  switch (chave) {
    case 'empresa':
      return <>{partesDoLead(c.nome, c.empresa).titulo}</>;
    case 'contato':
      return <span className="text-muted">{c.nome}</span>;
    case 'etapa':
      return <Chip tom={tomDaEtapa(c.etapa)} title={COMERCIAL_ROTULO_DA_ETAPA[c.etapa]}>{COMERCIAL_ROTULO_DA_ETAPA[c.etapa]}</Chip>;
    case 'responsavel':
      return <CelulaDoResponsavel nome={c.dono} pessoaId={c.donoId} testId={testId ? `${testId}-responsavel` : undefined} />;
    case 'produto':
      return c.produto ? <span className="text-muted">{ROTULO_DO_PRODUTO[c.produto]}</span> : <span className="text-dim">sem produto</span>;
    case 'perfil':
      return c.perfil ? <span className="font-os-mono text-[11.5px]">{c.perfil}</span> : <span className="text-dim">sem perfil</span>;
    case 'valor':
      return c.valorCentavos != null ? <span className="tabular-nums">{dinheiro(c.valorCentavos)}</span> : <span className="text-dim">sem valor</span>;
    case 'dias':
      return (
        <span className="tabular-nums">
          {c.diasNaEtapa}
          {c.parado ? <span className="text-warn"> · parado</span> : null}
        </span>
      );
    case 'desde':
      return c.etapaDesde ? <time dateTime={c.etapaDesde} title={dataCompleta(c.etapaDesde)} className="tabular-nums">{dataCurta(c.etapaDesde)}</time> : <span className="text-dim">sem data</span>;
    case 'reuniao':
      return c.reuniaoEm ? <time dateTime={c.reuniaoEm} title={dataCompleta(c.reuniaoEm)} className="tabular-nums">{dataCompleta(c.reuniaoEm).replace(/\/\d{4}/, '')}</time> : <span className="text-dim">sem reunião</span>;
    case 'proxima': {
      const { principal, segunda } = proximaAcaoDoCartao(c);
      const contagem = contagemDeTarefas(c.tarefasAbertas);
      return (
        <span className="text-muted" data-testid={testId ? `funil-linha-proxima-${c.leadId}` : undefined}>
          <span className="line-clamp-2"><TextoDaAcao linha={principal} /></span>
          {segunda && <span className="block truncate text-[11.5px] text-dim"><TextoDaAcao linha={segunda} /></span>}
          {contagem && <span className="block text-[11px] text-dim">{contagem}</span>}
        </span>
      );
    }
    case 'pendencias': {
      const lista = [...(c.balao?.pendencias ?? []), ...(c.avisoDoMover ? [c.avisoDoMover.texto] : [])];
      if (!lista.length) return <span className="text-dim">nenhuma</span>;
      return <span className="line-clamp-2 text-warn" title={lista.join('; ')}>{lista.join('; ')}</span>;
    }
  }
}

/** O texto do balão de uma célula que pode ser cortada. */
function tituloDa(c: CartaoDoFunil, chave: ChaveDaColuna): string | undefined {
  if (chave === 'empresa') return partesDoLead(c.nome, c.empresa).titulo;
  if (chave === 'contato') return c.nome;
  if (chave === 'produto' && c.produto) return ROTULO_DO_PRODUTO[c.produto];
  return undefined;
}

export function ListaDoFunil({
  cartoes,
  colunas,
  ordem,
  aoOrdenar,
}: {
  cartoes: readonly CartaoDoFunil[];
  colunas: readonly ChaveDaColuna[];
  ordem: OrdemDaLista | null;
  aoOrdenar: (o: OrdemDaLista | null) => void;
}) {
  const [larguras, setLarguras] = useState<Larguras>({});
  const vivas = useRef<Larguras>({});
  useEffect(() => {
    let lidas: Larguras = {};
    try {
      lidas = lerLarguras(window.localStorage.getItem(CHAVE_DAS_LARGURAS));
    } catch {
      lidas = {};
    }
    vivas.current = lidas;
    setLarguras(lidas);
  }, []);
  const guardar = (l: Larguras) => {
    vivas.current = l;
    setLarguras(l);
    try {
      window.localStorage.setItem(CHAVE_DAS_LARGURAS, JSON.stringify(l));
    } catch {
      /* navegador sem armazenamento: a largura vale até recarregar */
    }
  };

  const ordenados = useMemo(() => ordenarCartoes(cartoes, ordem), [cartoes, ordem]);
  const menuDoLead = useMenuDoLead();
  const paraOMenu = (c: CartaoDoFunil): LeadParaOMenu => ({ id: c.leadId, nome: c.nome, empresa: c.empresa, etapa: c.etapa, voltaPara: c.voltaPara ?? null });

  function arrastar(e: React.PointerEvent<HTMLSpanElement>, chave: ChaveDaColuna) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = larguraDa(vivas.current, chave);
    const mover = (ev: PointerEvent) => {
      vivas.current = { ...vivas.current, [chave]: limitarLargura(chave, w0 + ev.clientX - x0) };
      setLarguras(vivas.current);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      guardar(vivas.current);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  }

  function teclar(e: React.KeyboardEvent<HTMLSpanElement>, chave: ChaveDaColuna) {
    const w = larguraDa(vivas.current, chave);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      guardar({ ...vivas.current, [chave]: limitarLargura(chave, w + (e.key === 'ArrowRight' ? PASSO_DO_TECLADO : -PASSO_DO_TECLADO)) });
    } else if (e.key === 'Home') {
      e.preventDefault();
      const { [chave]: _, ...resto } = vivas.current;
      guardar(resto);
    }
  }

  function voltarAoPadrao(chave: ChaveDaColuna) {
    const { [chave]: _, ...resto } = vivas.current;
    guardar(resto);
  }

  if (!cartoes.length) return <p className="text-[12.5px] text-dim">Nenhum lead com estes filtros.</p>;

  const abrirDaLinha = (e: React.MouseEvent<HTMLElement>, seletor: string) => {
    if ((e.target as HTMLElement).closest('a, button, [role="separator"]')) return;
    e.currentTarget.querySelector<HTMLAnchorElement>(seletor)?.click();
  };

  return (
    <>
      <div className="relative min-h-0 min-w-0 max-w-full flex-1 overflow-auto rounded border border-border max-[639px]:hidden" data-testid="funil-lista">
        <table className="table-fixed border-separate border-spacing-0 text-left text-[12.5px]" style={{ width: larguraDaTabela(larguras, colunas), minWidth: '100%' }}>
          <caption className="sr-only">Leads do funil em lista. As bordas do cabeçalho ajustam a largura; o nome da coluna ordena.</caption>
          <colgroup>
            {colunas.map((k) => (
              <col key={k} data-coluna={k} style={{ width: larguraDa(larguras, k) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {colunas.map((k) => {
                const def = colunaDa(k);
                const sort = ariaSort(ordem, k);
                return (
                  <th
                    key={k}
                    scope="col"
                    aria-sort={def.ordenavel ? sort : undefined}
                    data-testid={`funil-lista-cabecalho-${k}`}
                    className={`sticky top-0 z-10 h-10 border-b border-border bg-bg2 px-0 font-normal ${def.numerica ? 'text-right' : ''}`}
                  >
                    <div className="relative flex h-full items-center">
                      {def.ordenavel ? (
                        <button
                          type="button"
                          onClick={() => aoOrdenar(proximaOrdem(ordem, k))}
                          className={`flex h-full min-w-0 flex-1 items-center gap-1 px-3 font-os-mono text-[10px] uppercase tracking-[0.12em] ${sort === 'none' ? 'text-muted hover:text-text' : 'text-brand'} ${def.numerica ? 'justify-end' : ''} ${FOCO}`}
                        >
                          <span className="truncate">{def.rotulo}</span>
                          {sort === 'ascending' ? <ArrowUp size={12} aria-hidden /> : sort === 'descending' ? <ArrowDown size={12} aria-hidden /> : <ArrowUpDown size={12} aria-hidden className="opacity-40" />}
                        </button>
                      ) : (
                        <span className="truncate px-3 font-os-mono text-[10px] uppercase tracking-[0.12em] text-muted">{def.rotulo}</span>
                      )}
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Largura da coluna ${def.rotulo}`}
                        aria-valuenow={larguraDa(larguras, k)}
                        aria-valuemin={def.minimo}
                        aria-valuemax={LARGURA_MAXIMA}
                        tabIndex={0}
                        data-testid={`funil-lista-borda-${k}`}
                        title="Arraste para ajustar a largura · dois cliques voltam ao padrão"
                        onPointerDown={(e) => arrastar(e, k)}
                        onDoubleClick={() => voltarAoPadrao(k)}
                        onKeyDown={(e) => teclar(e, k)}
                        className={`absolute right-0 top-1 bottom-1 z-10 w-2 cursor-col-resize touch-none border-r border-border/70 hover:border-brand focus-visible:border-brand ${FOCO}`}
                      />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ordenados.map((c) => (
              <tr
                key={c.leadId}
                data-testid={`funil-linha-${c.leadId}`}
                onClick={(e) => abrirDaLinha(e, '[data-linha-do-funil]')}
                {...alvoDoMenuDoLead(menuDoLead, paraOMenu(c))}
                className="cursor-pointer hover:bg-surface"
              >
                {colunas.map((k) => (
                  <td
                    key={k}
                    title={tituloDa(c, k)}
                    className={`h-12 border-b border-border px-3 py-2 align-middle ${colunaDa(k).numerica ? 'text-right' : ''} ${k === 'proxima' || k === 'pendencias' ? '' : 'truncate'}`}
                  >
                    {k === 'empresa' ? (
                      <span className="flex min-w-0 items-center gap-1">
                        <LinkDoLead leadId={c.leadId} aba="geral" data-linha-do-funil className={`min-w-0 truncate rounded-sm font-semibold ${FOCO}`}>
                          {partesDoLead(c.nome, c.empresa).titulo}
                        </LinkDoLead>
                        <BotaoDoMenuDoLead lead={paraOMenu(c)} />
                      </span>
                    ) : (
                      <Conteudo c={c} chave={k} testId={`funil-linha-${c.leadId}`} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Abaixo de 640 px: cartões empilhados, com as mesmas colunas e a mesma ordem. */}
      <ul className="space-y-2 min-[640px]:hidden" data-testid="funil-lista-cartoes" aria-label="Leads do funil">
        {ordenados.map((c) => (
          <li key={c.leadId}>
            <div
              data-testid={`funil-lista-cartao-${c.leadId}`}
              onClick={(e) => abrirDaLinha(e, '[data-cartao-da-lista]')}
              {...alvoDoMenuDoLead(menuDoLead, paraOMenu(c))}
              className="cursor-pointer rounded border border-border bg-surface p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <LinkDoLead leadId={c.leadId} aba="geral" data-cartao-da-lista className={`min-w-0 flex-1 rounded-sm text-[13.5px] font-semibold ${FOCO}`}>
                  <span className="block truncate">{partesDoLead(c.nome, c.empresa).titulo}</span>
                </LinkDoLead>
                {colunas.includes('etapa') && <Conteudo c={c} chave="etapa" />}
                <BotaoDoMenuDoLead lead={paraOMenu(c)} />
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                {colunas
                  .filter((k) => k !== 'empresa' && k !== 'etapa')
                  .map((k) => (
                    <div key={k} className="contents">
                      <dt className="font-os-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">{colunaDa(k).rotulo}</dt>
                      <dd className="min-w-0 break-words">
                        {k === 'responsavel' ? (
                          <span className="inline-flex items-center gap-1.5">
                            <CelulaDoResponsavel nome={c.dono} pessoaId={c.donoId} />
                            <span className="text-muted">{c.dono ?? 'sem responsável'}</span>
                          </span>
                        ) : (
                          <Conteudo c={c} chave={k} />
                        )}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * As colunas visíveis, no painel de Filtros (só no formato Lista). A empresa é a
 * identidade da linha e não sai; "Colunas padrão" volta ao começo. Não conta
 * como filtro: o "(n)" do botão e o "Limpar tudo" não mexem aqui.
 */
export function SeletorDeColunas({ colunas, aoMudar }: { colunas: readonly ChaveDaColuna[]; aoMudar: (c: ChaveDaColuna[]) => void }) {
  return (
    <fieldset className="mt-2 border-t border-border pt-2" data-testid="funil-colunas">
      <legend className="sr-only">Colunas da lista</legend>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span aria-hidden className="text-[11px] uppercase tracking-[0.08em] text-muted">Colunas da lista</span>
        {!saoAsPadrao(colunas) && (
          <button
            type="button"
            data-testid="funil-colunas-padrao"
            onClick={() => aoMudar([...COLUNAS_PADRAO])}
            className={`text-[11px] text-muted underline-offset-2 hover:text-text hover:underline ${FOCO}`}
          >
            Colunas padrão
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        {COLUNAS_DA_LISTA.map((def) => (
          <label key={def.chave} className={`flex items-center gap-2 py-1 text-[13px] max-md:min-h-[44px] ${def.fixa ? 'text-muted' : 'text-text'}`}>
            <input
              type="checkbox"
              data-testid={`funil-colunas-${def.chave}`}
              checked={colunas.includes(def.chave)}
              disabled={def.fixa}
              onChange={() => aoMudar(alternarColuna(colunas, def.chave))}
              className={FOCO}
            />
            {def.rotulo}
          </label>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted">A empresa fica sempre. A largura se ajusta arrastando a borda do cabeçalho.</p>
    </fieldset>
  );
}
