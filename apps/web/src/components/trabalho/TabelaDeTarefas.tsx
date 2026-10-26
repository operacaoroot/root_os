'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { Bot, Check, DoorOpen, Repeat, Unlock, X } from 'lucide-react';
import { formatarValorMonetario, agruparTarefas, descreverRecorrencia, tituloNormalizado } from '@mktos/shared';
import type { Agrupamento, CampoDeOrdem, RecorrenciaDaTarefa, TrabAgenteDto, TrabEstrutura, TrabListaDto, TrabTarefaResumo } from '@mktos/shared';
import { apiPatch, apiPost } from '@/lib/api';
import type { AbaDaTarefa } from '@/lib/tarefa-na-url';
import { diaCompleto, instanteCurto } from '@/lib/datas-do-cartao';
import { hojeEmBrasilia } from '@/lib/horas';
import { AvatarDaPessoa } from '@/components/AvatarDaPessoa';
import { IconeDaLista } from './IconeDaLista';
import { AvataresDaTarefa, rotuloDaPessoa, rotuloNaLista, soDaEquipe } from './ResponsavelDaTarefa';
import { EscolhaNaCelula } from './EscolhaNaCelula';
import { BotaoDoMenuDaTarefa, alvoDoMenu, useMenuDaTarefa } from './MenuDaTarefa';
import { diaDoPrazo, prazoDoDia } from './CalendarioDeTarefas';

/*
 * Layout 26/10: A LISTA DE TAREFAS, UMA SÓ PARA O OS.
 *
 * Saiu de dentro do `TrabalhoView` sem mudar nada do que o Trabalho faz: a
 * tabela (seleção, agrupamento, ordem manual), as células que editam na linha
 * (responsável, agente, prazo), a barra do lote e as escritas com a versão lida
 * (`useEscritaDasTarefas`). O Trabalho importa daqui; Pendências › Minhas
 * tarefas usa as mesmas peças, para as duas telas serem a mesma lista.
 */

const INP = 'w-full rounded-lg border border-border bg-surface-2 px-2 py-1 text-[13px] outline-none focus:border-brand-dim disabled:opacity-60';

// Rodada de produção 1: fuso de São Paulo, o DIA do trilho em UTC e nunca "Invalid Date" (`lib/datas-do-cartao.ts`).
export const dataBR = (iso: string | null) => diaCompleto(iso) ?? '—';
export const dataHoraBR = (iso: string | null) => instanteCurto(iso) ?? '—';

/**
 * O NOME DO AGENTE QUE ESTÁ COM A TAREFA (fatia A4).
 *
 * Três estados, e a tela diz os três — nenhum deles é "vazio":
 *   · livre: ninguém travou, e é o normal;
 *   · nome: o agente desta empresa que assumiu;
 *   · "outro agente": o ponteiro não resolve nesta empresa (a API manda
 *     `agenteId` com `agenteNome` nulo). Inventar um nome aqui seria pior do que
 *     admitir que não sabemos de quem é — ver `work/agentes-da-casa.ts`.
 */
export function nomeDoAgente(t: {
  agenteId: string | null;
  agenteNome: string | null;
}): string | null {
  if (!t.agenteId) return null;
  return t.agenteNome ?? 'outro agente';
}

/**
 * ATRASADA É POR DIA (versão final, F4): a régua de prazo do Lucas diz "Hoje" para o
 * que vence hoje, e a tela não pode pintar de vermelho o mesmo cartão. O `overdue` da
 * API compara o instante (o prazo importado do ClickUp é meia-noite de São Paulo e vira
 * "vencido" às 00:01); aqui ele só vale quando o DIA do prazo já passou.
 */
export function atrasada(t: Pick<TrabTarefaResumo, 'overdue' | 'dueDate'>): boolean {
  if (!t.overdue) return false;
  const dia = diaDoPrazo(t.dueDate);
  return !dia || dia < hojeEmBrasilia();
}

/** As etapas do lote em "Todas": o tipo da etapa, com o id virtual `tipo:<tipo>`. */
export const COLUNAS_POR_TIPO = [
  { id: 'tipo:open', name: 'A fazer', type: 'open', color: '#87909e' },
  { id: 'tipo:custom', name: 'Em andamento', type: 'custom', color: '#f9a400' },
  { id: 'tipo:closed', name: 'Concluídas', type: 'closed', color: '#30a46c' },
] as const;

/** A primeira etapa da lista com o tipo pedido (a mesma regra do lote e do quadro de "Todas"). */
export function etapaDoTipo(listas: TrabListaDto[], listId: string, tipo: string): string | null {
  const l = listas.find((x) => x.id === listId);
  return l?.statuses.find((st) => st.type === tipo)?.id ?? null;
}

/** O trilho de onboarding ligado a um cartão (`OnboardingTrilho.cardId`). */
export interface TrilhoDoCartao { id: string; cliente: string; faseRotulo: string }

/*
 * Layout 26/10 (pedido do Lucas): SEM PRAZO É DIFERENTE DE TAREFA RECORRENTE. A célula
 * do prazo da tarefa que repete diz a regra: sem data, "↻ Toda semana: segunda"; com
 * data, a data e o ↻ (a regra inteira no balão). "Sem prazo" (ou o vazio da tela) fica
 * só para a tarefa sem data E sem repetição. Vale para a Lista do Trabalho, Minhas
 * tarefas e as tarefas de uma área (`TarefasDoDia`).
 */
export function PrazoComRepeticao({ texto, recorrencia, semPrazo, testId }: {
  /** O prazo já escrito pela tela (dia), ou nulo quando não há data. */
  texto: string | null;
  recorrencia?: RecorrenciaDaTarefa | null;
  /** O que a tela diz quando não há data nem repetição ("—", "sem prazo"). */
  semPrazo: React.ReactNode;
  testId?: string;
}) {
  if (!recorrencia) return <>{texto ?? semPrazo}</>;
  const regra = descreverRecorrencia(recorrencia);
  if (!texto) {
    return <span data-testid={testId} title={`Repete: ${regra}`} className="whitespace-normal"><span aria-hidden>↻ </span>{regra}</span>;
  }
  return (
    <span data-testid={testId} className="whitespace-nowrap">
      {texto} <span title={`Repete: ${regra}`} aria-label={`Repete: ${regra}`} role="img">↻</span>
    </span>
  );
}

/*
 * O ATALHO DO TRILHO no cartão e na linha (implantação aglutinada, rodada do
 * painel P2). Só aparece no cartão que TEM trilho ligado por `cardId`; o resto
 * da conversa (criar trilho, ligar ao cartão) continua na gaveta da tarefa.
 */
export function AtalhoDoTrilho({ trilho, onAbrir }: { trilho: TrilhoDoCartao; onAbrir: () => void }) {
  // Desde a rodada do trabalho (T2), o trilho é a aba "Trilho" do pop-up do cartão.
  return (
    <button
      type="button"
      data-testid={`trabalho-trilho-${trilho.id}`}
      onClick={(e) => { e.stopPropagation(); onAbrir(); }}
      title={`Trilho de onboarding de ${trilho.cliente}`}
      className="mt-1.5 flex max-w-full items-center gap-1 text-left text-[11px] text-brand underline-offset-2 hover:underline"
    >
      <DoorOpen size={11} className="shrink-0" />
      <span className="truncate">Trilho · {trilho.faseRotulo}</span>
    </button>
  );
}

/**
 * ASSUMIR E SOLTAR, na tela (fatia A4).
 *
 * Duas coisas que esta peça faz de propósito:
 *
 *  1. AGENTE QUE NÃO TRABALHA APARECE DESABILITADO, não escondido. `podeAssumir`
 *     vem da API (quem sabe quais estados trabalham é `estado-do-agente.ts`) e a
 *     opção diz o estado ao lado do nome. Esconder faria a pessoa procurar um
 *     agente que existe; oferecer sem marcar faria ela descobrir a regra pelo
 *     409.
 *  2. O ERRO DA API APARECE COMO VEIO. A frase do 409 nomeia quem ficou com a
 *     tarefa, e reescrevê-la aqui ("não foi possível assumir") trocaria a única
 *     informação útil por educação. O quadro recarrega junto, então a pessoa vê
 *     o dono novo no mesmo instante em que lê o motivo.
 */
export function ControleDoAgente({ t, agentes, token, onMudou, onErro }: {
  t: TrabTarefaResumo; agentes: TrabAgenteDto[]; token: string | null;
  onMudou: () => void; onErro: (m: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);

  const chamar = (caminho: string, corpo: Record<string, unknown>) => {
    setOcupado(true);
    apiPost(`/trabalho/tarefas/${t.id}/${caminho}`, corpo, token)
      .then(onMudou)
      .catch((e) => onErro(e.message))
      .finally(() => setOcupado(false));
  };

  if (t.agenteId) {
    return (
      <button
        disabled={ocupado}
        onClick={() => chamar('soltar', {})}
        title="Devolver a tarefa para a fila. Qualquer pessoa pode soltar — inclusive quando o agente travou e falhou."
        className="mt-2 flex w-full items-center justify-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-1 text-[11px] text-muted transition hover:text-text disabled:opacity-50"
      >
        <Unlock size={10} /> Soltar
      </button>
    );
  }

  return (
    <select
      value=""
      disabled={ocupado || agentes.length === 0}
      onChange={(e) => e.target.value && chamar('assumir', { agente: e.target.value })}
      title="Entregar a um agente. Só um agente é dono da tarefa por vez."
      className="mt-2 w-full rounded border border-dashed border-border bg-surface-2 px-1.5 py-1 text-[11px] text-muted outline-none focus:border-brand-dim disabled:opacity-50"
    >
      <option value="">{agentes.length === 0 ? 'Nenhum agente nesta empresa' : 'Entregar a um agente…'}</option>
      {agentes.map((a) => (
        <option key={a.slug} value={a.slug} disabled={!a.podeAssumir}>
          {a.nome}{a.podeAssumir ? '' : ` — ${a.estado}, não assume`}
        </option>
      ))}
    </select>
  );
}

/**
 * O mesmo checkout, na gaveta da tarefa — com o que o cartão não tem espaço
 * para dizer: o nome de quem está com ela e DESDE QUANDO, em texto, não em
 * `title`. É a gaveta que alguém abre para decidir se solta.
 */
export function ControleDoAgenteNaGaveta({ t, agentes, editable, token, onMudou, onErro }: {
  t: TrabTarefaResumo; agentes: TrabAgenteDto[]; editable: boolean; token: string | null;
  onMudou: () => void; onErro: (m: string) => void;
}) {
  const agente = nomeDoAgente(t);
  return (
    <div className="space-y-1">
      <div className="text-[13px]">
        {agente ? (
          <span className="flex items-center gap-1 text-brand">
            <Bot size={12} className="shrink-0" />
            {agente}
          </span>
        ) : (
          <span className="text-muted">Livre — nenhum agente assumiu</span>
        )}
      </div>
      {agente && (
        <div className="text-[11px] text-muted">desde {dataHoraBR(t.agenteEm)}</div>
      )}
      {editable && (
        <ControleDoAgente t={t} agentes={agentes} token={token} onMudou={onMudou} onErro={onErro} />
      )}
    </div>
  );
}

// ---------- visão tabela ----------

export type PessoaDaEstrutura = NonNullable<TrabEstrutura['pessoas']>[number];

/*
 * A LISTA (tabela). Serve uma lista, "Todas as tarefas" e o "todas as listas" da
 * pessoa. Versão final, F4: seleção em lote (a caixa de cada linha e a do cabeçalho),
 * agrupamento das vistas (inclusive a régua de prazo do Lucas) e ordem manual
 * (arrastar a linha sobre outra grava a sequência da lista, ou do grupo).
 */
export function Tabela({ tarefas, campos, trilhos, onAbrir, mostrarLista = false, pessoas = [], agrupamento = 'nenhum', selecao = null, onReordenar = null, edicao = null, ordenacao = null, abaixoDoTitulo, testIdDaLinha, vazio = 'Nada por aqui.' }: {
  tarefas: TrabTarefaResumo[]; campos: string[]; trilhos: Map<string, TrilhoDoCartao>;
  onAbrir: (id: string, aba?: AbaDaTarefa) => void;
  mostrarLista?: boolean; pessoas?: PessoaDaEstrutura[]; agrupamento?: Agrupamento;
  selecao?: { marcadas: Set<string>; mudar: (s: Set<string>) => void } | null;
  onReordenar?: ((ids: string[]) => Promise<void>) | null;
  /** Layout 26/10 (P-29): sem `edicao` (só leitura), as três células são texto como antes. */
  edicao?: EdicaoNaLinha | null;
  /**
   * Layout 26/10: o cabeçalho que ordena (Minhas tarefas, com as vistas salvas). Clicar
   * na coluna ordena por ela; de novo, inverte. Sem isto, o cabeçalho é texto, como no Trabalho.
   */
  ordenacao?: { campo: CampoDeOrdem | null; direcao: 'asc' | 'desc'; aoOrdenar: (c: CampoDeOrdem) => void; testId: string } | null;
  /** Layout 26/10: uma linha curta embaixo do nome (os motivos e os comentários em Minhas tarefas). */
  abaixoDoTitulo?: (t: TrabTarefaResumo) => React.ReactNode;
  testIdDaLinha?: (id: string) => string;
  vazio?: string;
}) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const menu = useMenuDaTarefa();
  const grupos = useMemo(() => {
    const vista = tarefas.map((t) => ({
      t, titulo: t.title, status: t.statusName, statusTipo: t.statusType, lista: t.listName ?? '',
      cliente: t.clienteNome, prioridade: t.priority, prazo: t.dueDate, criadaEm: '',
    }));
    return agruparTarefas(vista, agrupamento, new Date()).map((g) => ({ ...g, itens: g.itens.map((x) => x.t) }));
  }, [tarefas, agrupamento]);
  const colunas = 7 + campos.length + (mostrarLista ? 1 : 0) + (selecao ? 1 : 0);
  const todasMarcadas = !!selecao && tarefas.length > 0 && tarefas.every((t) => selecao.marcadas.has(t.id));
  const marcar = (id: string, sim: boolean) => {
    if (!selecao) return;
    const n = new Set(selecao.marcadas);
    if (sim) n.add(id); else n.delete(id);
    selecao.mudar(n);
  };
  const soltar = (grupo: TrabTarefaResumo[], alvo: string) => {
    const id = arrastando;
    setArrastando(null);
    if (!id || id === alvo || !onReordenar || !grupo.some((t) => t.id === id)) return;
    const seq = grupo.map((t) => t.id).filter((x) => x !== id);
    seq.splice(Math.max(0, seq.indexOf(alvo)), 0, id);
    void onReordenar(seq);
  };
  const cabecalho = (rotulo: string, campo: CampoDeOrdem) => {
    if (!ordenacao) return <th className="px-3 py-2">{rotulo}</th>;
    const ativo = ordenacao.campo === campo;
    return (
      <th className="px-3 py-2" aria-sort={ativo ? (ordenacao.direcao === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button type="button" onClick={() => ordenacao.aoOrdenar(campo)} data-testid={`${ordenacao.testId}-${campo}`} className="uppercase hover:text-text focus-visible:outline-brand">
          {rotulo}{ativo ? (ordenacao.direcao === 'asc' ? ' ↑' : ' ↓') : ''}
        </button>
      </th>
    );
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-[11px] uppercase tracking-wide text-muted">
            {selecao && (
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox" aria-label="Selecionar todas as tarefas visíveis" data-testid="trabalho-selecionar-todas"
                  checked={todasMarcadas}
                  onChange={(e) => selecao.mudar(e.target.checked ? new Set(tarefas.map((t) => t.id)) : new Set())}
                />
              </th>
            )}
            {cabecalho('Tarefa', 'titulo')}
            {mostrarLista && cabecalho('Lista', 'lista')}
            {cabecalho('Cliente', 'cliente')}
            {cabecalho('Status', 'status')}
            {cabecalho('Prioridade', 'prioridade')}
            <th className="px-3 py-2">Responsável</th>
            {/* Duas colunas, porque são dois eixos: quem responde e quem executa. */}
            <th className="px-3 py-2">Agente</th>
            {cabecalho('Prazo', 'vencimento')}
            {campos.map((c) => <th key={c} className="px-3 py-2">{c}</th>)}
          </tr>
        </thead>
        {grupos.map((g) => (
          <tbody key={g.chave} data-grupo={g.chave}>
            {agrupamento !== 'nenhum' && (
              <tr className="border-b border-border bg-surface-2/60">
                <th colSpan={colunas} scope="colgroup" className="px-3 py-1.5 text-left font-os-mono text-[11px] uppercase tracking-wide text-muted">
                  {g.rotulo} · {g.itens.length}
                </th>
              </tr>
            )}
            {g.itens.map((t) => (
              <tr
                {...alvoDoMenu(menu, t)}
                key={t.id} data-work-task-id={t.id} data-testid={testIdDaLinha?.(t.id)} onClick={() => onAbrir(t.id)}
                draggable={!!onReordenar}
                onDragStart={onReordenar ? (e) => { setArrastando(t.id); e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
                onDragEnd={() => setArrastando(null)}
                onDragOver={onReordenar ? (e) => { if (arrastando) e.preventDefault(); } : undefined}
                onDrop={onReordenar ? (e) => { e.preventDefault(); soltar(g.itens, t.id); } : undefined}
                className={`cursor-pointer border-b border-border/50 hover:bg-surface-2/50 ${arrastando === t.id ? 'opacity-50' : ''}`}
              >
                {selecao && (
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox" aria-label={`Selecionar ${t.title}`} data-testid={`trabalho-selecionar-${t.id}`}
                      checked={selecao.marcadas.has(t.id)} onChange={(e) => marcar(t.id, e.target.checked)}
                    />
                  </td>
                )}
                <td className="px-3 py-2">
                  <button onClick={(e) => { e.stopPropagation(); onAbrir(t.id); }} className="text-left hover:text-brand focus-visible:outline-brand">{t.title}</button>
                  {t.recorrencia && <span title={descreverRecorrencia(t.recorrencia)} className="ml-1 inline-flex align-middle text-muted"><Repeat size={11} /><span className="sr-only">{descreverRecorrencia(t.recorrencia)}</span></span>}
                  {trilhos.get(t.id) && <AtalhoDoTrilho trilho={trilhos.get(t.id)!} onAbrir={() => onAbrir(t.id, 'trilho')} />}
                  <BotaoDoMenuDaTarefa tarefa={t} className="ml-1 inline-grid align-middle" />
                  {abaixoDoTitulo?.(t)}
                </td>
                {mostrarLista && <td className="px-3 py-2 text-muted"><IconeDaLista icone={t.listIcone} cor={t.listCor} tamanho={12} className="mr-1 inline-block align-[-2px]" />{t.listName ?? '—'}</td>}
                <td className="px-3 py-2">{t.clienteNome ?? <span className="font-os-mono text-[10px] text-warn">sem cliente</span>}</td>
                <td className="px-3 py-2">
                  <span className="rounded px-1.5 py-0.5 text-[11px] capitalize" style={{ background: `${t.statusColor}26`, color: t.statusColor }}>
                    {t.statusName}
                  </span>
                </td>
                <td className="px-3 py-2 capitalize">{t.priority}</td>
                {/* Layout 26/10 (P-29): as três células editam ali mesmo; o clique nelas não abre a tarefa. */}
                <td className="px-3 py-2" onClick={edicao ? (e) => e.stopPropagation() : undefined}>
                  {edicao ? (
                    <ResponsavelNaLinha
                      t={t} pessoas={pessoas} equipe={soDaEquipe(pessoas, edicao.idsDaEquipe, [t.assigneeUserId])}
                      onEscolher={(pessoa) => edicao.onResponsavel(t.id, pessoa)}
                    />
                  ) : <AvataresDaTarefa tarefa={t} pessoas={pessoas} testId={`trabalho-responsaveis-${t.id}`} />}
                </td>
                <td className="px-3 py-2" title={t.agenteId ? `Assumida em ${dataHoraBR(t.agenteEm)}` : undefined} onClick={edicao ? (e) => e.stopPropagation() : undefined}>
                  {edicao ? <AgenteNaLinha t={t} edicao={edicao} /> : nomeDoAgente(t) ?? '—'}
                </td>
                <td className={`px-3 py-2 ${atrasada(t) ? 'text-bad' : ''}`} onClick={edicao ? (e) => e.stopPropagation() : undefined}>
                  {edicao ? <PrazoNaLinha t={t} onMudar={(dia) => edicao.onPrazo(t.id, dia)} /> : <PrazoComRepeticao texto={t.dueDate ? dataBR(t.dueDate) : null} recorrencia={t.recorrencia} semPrazo="—" testId={`trabalho-prazo-repete-${t.id}`} />}
                </td>
                {campos.map((c) => {
                  const v = t.values.find((x) => x.fieldName === c);
                  const valor = v?.type === 'moeda' && v.value ? formatarValorMonetario(v.value) : v?.value;
                  return <td key={c} className="px-3 py-2 text-muted">{v?.optionName ?? valor ?? '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        ))}
        {tarefas.length === 0 && (
          <tbody><tr><td colSpan={colunas} className="px-3 py-6 text-center text-muted">{vazio}</td></tr></tbody>
        )}
      </table>
    </div>
  );
}

/*
 * Layout 26/10 (P-29): AS CÉLULAS QUE EDITAM NA LISTA, como no ClickUp. Nenhuma
 * regra nova: responsável e prazo vão pelo mesmo PATCH com a versão lida do
 * calendário e do lote (`editarNaLinha`); o agente, pelo mesmo checkout
 * (`/assumir`, `/soltar`) do cartão e do pop-up (`ControleDoAgenteNaGaveta`).
 */
export type EdicaoNaLinha = {
  idsDaEquipe: Set<string> | null; agentes: TrabAgenteDto[]; token: string | null;
  onMudou: () => void; onErro: (m: string) => void;
  onResponsavel: (id: string, pessoa: string | null) => Promise<void>;
  onPrazo: (id: string, dia: string | null) => Promise<void>;
};

/** O responsável principal: as pessoas da equipe (`soDaEquipe`), com a foto de cada uma. */
export function ResponsavelNaLinha({ t, pessoas, equipe, onEscolher }: {
  t: TrabTarefaResumo; pessoas: PessoaDaEstrutura[]; equipe: PessoaDaEstrutura[];
  onEscolher: (pessoa: string | null) => Promise<void>;
}) {
  const [busca, setBusca] = useState('');
  const disponiveis = equipe.filter((p) => p.isActive || p.id === t.assigneeUserId);
  const termo = tituloNormalizado(busca);
  const achadas = termo ? disponiveis.filter((p) => tituloNormalizado(p.name).includes(termo)) : disponiveis;
  const item = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-2 disabled:opacity-50';
  return (
    <EscolhaNaCelula
      rotulo={`Responsável de ${t.title}`} testId={`trabalho-celula-responsavel-${t.id}`}
      gatilho={<AvataresDaTarefa tarefa={t} pessoas={pessoas} testId={`trabalho-responsaveis-${t.id}`} />}
    >
      {(fechar) => {
        const escolher = (pessoa: string | null) => { fechar(); if (pessoa !== (t.assigneeUserId ?? null)) void onEscolher(pessoa); };
        return (
          <div className="space-y-0.5">
            {/* Com muita gente, a busca vem primeiro (e já com o cursor). */}
            {disponiveis.length > 6 && (
              <input autoFocus aria-label="Buscar pessoa" placeholder="Buscar pessoa…" value={busca} onChange={(e) => setBusca(e.target.value)} className={`${INP} mb-1`} />
            )}
            <button type="button" aria-pressed={!t.assigneeUserId} onClick={() => escolher(null)} className={item}>
              <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-dashed border-border font-os-mono text-[9px] text-dim">?</span>
              <span className="min-w-0 flex-1 truncate text-muted">Sem vínculo de pessoa</span>
              {!t.assigneeUserId && <Check size={13} className="shrink-0 text-brand" />}
            </button>
            {achadas.map((p) => {
              const atual = p.id === t.assigneeUserId;
              return (
                <button key={p.id} type="button" aria-pressed={atual} disabled={!p.isActive} title={p.email} onClick={() => escolher(p.id)} className={item}>
                  <AvatarDaPessoa nome={p.name} pessoaId={p.id} tamanho="p" decorativo />
                  <span className="min-w-0 flex-1 truncate">{rotuloNaLista(p, disponiveis)}{p.isActive ? '' : ' (inativo)'}</span>
                  {atual && <Check size={13} className="shrink-0 text-brand" />}
                </button>
              );
            })}
            {termo && achadas.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted">Ninguém com esse nome.</p>}
            {(t.outrosResponsaveisIds ?? []).length > 0 && <p className="px-2 pt-1 text-[11px] text-muted">Os outros responsáveis mudam no pop-up da tarefa.</p>}
          </div>
        );
      }}
    </EscolhaNaCelula>
  );
}

/** O agente: o nome (ou "—") abre o mesmo controle de entregar/soltar do pop-up. */
export function AgenteNaLinha({ t, edicao }: { t: TrabTarefaResumo; edicao: EdicaoNaLinha }) {
  const agente = nomeDoAgente(t);
  return (
    <EscolhaNaCelula
      rotulo={`Agente de ${t.title}`} testId={`trabalho-celula-agente-${t.id}`} largura={260}
      gatilho={agente ? <><Bot size={12} className="shrink-0 text-muted" /><span className="truncate">{agente}</span></> : <span className="text-muted">—</span>}
    >
      {(fechar) => (
        <div className="p-1.5">
          <ControleDoAgenteNaGaveta
            t={t} agentes={edicao.agentes} editable token={edicao.token}
            onMudou={() => { fechar(); edicao.onMudou(); }} onErro={(m) => { fechar(); edicao.onErro(m); }}
          />
        </div>
      )}
    </EscolhaNaCelula>
  );
}

/**
 * O prazo: o dia escrito, como antes; o clique troca por um campo de data e já abre o
 * calendário. Grava ao sair do campo, e só se o dia mudou (como o campo Prazo do pop-up).
 */
export function PrazoNaLinha({ t, onMudar }: { t: TrabTarefaResumo; onMudar: (dia: string | null) => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const dia = diaDoPrazo(t.dueDate) ?? '';
  useEffect(() => {
    if (!editando || !campo.current) return;
    campo.current.focus();
    try { campo.current.showPicker(); } catch { /* navegador sem showPicker: o campo já está com o foco */ }
  }, [editando]);
  if (!editando) {
    return (
      <button type="button" aria-label={`Prazo de ${t.title}`} title="Mudar o prazo" data-testid={`trabalho-celula-prazo-${t.id}`} onClick={() => setEditando(true)} className="-mx-1 rounded px-1 py-0.5 hover:bg-surface-2 focus-visible:outline-brand">
        <PrazoComRepeticao texto={t.dueDate ? dataBR(t.dueDate) : null} recorrencia={t.recorrencia} semPrazo="—" testId={`trabalho-prazo-repete-${t.id}`} />
      </button>
    );
  }
  return (
    <input
      ref={campo} type="date" aria-label={`Prazo de ${t.title}`} defaultValue={dia}
      onBlur={(e) => { const novo = e.target.value; setEditando(false); if (novo !== dia) void onMudar(novo || null); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { e.currentTarget.value = dia; e.currentTarget.blur(); }
      }}
      className="w-[8.75rem] rounded border border-brand-dim bg-surface-2 px-1 py-0.5 text-[13px] text-text outline-none"
    />
  );
}

/*
 * A BARRA DO LOTE (versão final, F4): etapa, responsável, prazo e concluir para as
 * tarefas marcadas. Numa lista, as etapas são as dela; em "Todas" (várias listas), o
 * tipo da etapa, que cada tarefa traduz para a primeira etapa daquele tipo na lista dela.
 */
export function BarraDoLote({ quantas, pessoas, etapas, onLimpar, onEtapa, onConcluir, onResponsavel, onPrazo }: {
  quantas: number; pessoas: PessoaDaEstrutura[]; etapas: TrabListaDto['statuses'] | null;
  onLimpar: () => void; onEtapa: (statusId: string) => void; onConcluir: () => void;
  onResponsavel: (id: string | null) => void; onPrazo: (dia: string | null) => void;
}) {
  const [dia, setDia] = useState('');
  const campo = 'rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-brand-dim';
  return (
    <div role="group" aria-label="Alterar as tarefas selecionadas" data-testid="trabalho-lote" className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-lg border border-brand-dim bg-surface px-3 py-2">
      <span className="text-sm"><b className="font-os-mono">{quantas}</b> {quantas === 1 ? 'selecionada' : 'selecionadas'}</span>
      <select aria-label="Mover as selecionadas de etapa" value="" onChange={(e) => e.target.value && onEtapa(e.target.value)} className={campo}>
        <option value="">Etapa…</option>
        {(etapas ?? COLUNAS_POR_TIPO).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
      </select>
      <select aria-label="Responsável das selecionadas" value="" onChange={(e) => e.target.value && onResponsavel(e.target.value === 'sem-vinculo' ? null : e.target.value)} className={campo}>
        <option value="">Responsável…</option>
        {pessoas.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{rotuloDaPessoa(p)}</option>)}
        <option value="sem-vinculo">Sem vínculo de pessoa</option>
      </select>
      <label className="flex items-center gap-1.5 text-sm text-muted">
        Prazo
        <input type="date" aria-label="Prazo das selecionadas" value={dia} onChange={(e) => setDia(e.target.value)} className={campo} />
        <button type="button" disabled={!dia} onClick={() => { onPrazo(dia); setDia(''); }} className="rounded-md border border-border px-2 py-1 text-sm hover:border-brand-dim disabled:opacity-50">Aplicar</button>
      </label>
      <button type="button" data-testid="trabalho-lote-concluir" onClick={onConcluir} className="rounded-md bg-brand/15 px-3 py-1 text-sm text-brand hover:bg-brand/25">Concluir</button>
      <button type="button" onClick={onLimpar} className="ml-auto text-sm text-muted hover:text-text">Limpar seleção</button>
    </div>
  );
}

/** O aviso do lote (quantas foram, quantas pedem recarga), com o "fechar". */
export function AvisoDoLote({ texto, onFechar, testId = 'trabalho-lote-aviso' }: { texto: string; onFechar: () => void; testId?: string }) {
  return (
    <p role="status" data-testid={testId} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
      <span>{texto}</span>
      <button type="button" aria-label="Fechar aviso" onClick={onFechar}><X size={14} /></button>
    </p>
  );
}

/*
 * Layout 26/10: AS ESCRITAS DA LISTA, as mesmas em toda tela de tarefas. Saíram do
 * `TrabalhoView` como estavam: cada escrita vai com a versão lida (`updatedAt`) e
 * um 409 vira a frase de recarregar, nunca uma gravação pela metade.
 *
 * `itens` é a coleção que a tela leu (a versão de cada tarefa sai dela); `onMudou`
 * relê a tela; `limparSelecao` zera as marcadas depois do lote.
 */
export function useEscritaDasTarefas({ itens, editable, token, onMudou, onErro, selecionadas, limparSelecao }: {
  itens: TrabTarefaResumo[] | null | undefined; editable: boolean; token: string | null;
  onMudou: () => void; onErro: (m: string) => void;
  selecionadas: Set<string>; limparSelecao: () => void;
}) {
  const [avisoDoLote, setAvisoDoLote] = useState<string | null>(null);

  /**
   * ORDEM MANUAL (versão final, F4): a sequência da coluna ou da lista vai inteira,
   * cada tarefa com a versão lida. Uma versão vencida derruba tudo (409) e a tela pede
   * para recarregar; nada é gravado pela metade.
   */
  const reordenar = async (ids: string[]) => {
    if (!editable) return;
    const lidos = ids.map((id) => itens?.find((t) => t.id === id)).filter((t): t is TrabTarefaResumo => !!t);
    if (lidos.length !== ids.length || lidos.some((t) => !t.updatedAt)) { onErro('Recarregue a lista antes de reordenar: a versão de alguma tarefa não está disponível.'); return; }
    try {
      await apiPost('/trabalho/tarefas/ordem', { itens: lidos.map((t) => ({ id: t.id, expectedUpdatedAt: t.updatedAt })) }, token);
      onMudou();
    } catch (e) {
      onErro((e as { status?: number }).status === 409 ? 'Alguma tarefa mudou desde que a lista foi lida. Recarregue antes de reordenar.' : (e as Error).message);
    }
  };

  /**
   * Um campo da tarefa sem abrir o pop-up: um PATCH com a versão lida, como os campos
   * do pop-up. Layout 26/10 (P-29): o calendário e as células da Lista (responsável,
   * prazo) passam todos por aqui; `oQue` diz na mensagem de conflito o que não foi gravado.
   */
  const editarNaLinha = async (id: string, mudanca: Record<string, unknown>, oQue: string) => {
    const t = itens?.find((x) => x.id === id);
    if (!editable || !t) return;
    if (!t.updatedAt) { onErro('Recarregue a lista antes de alterar esta tarefa: a versão não está disponível.'); return; }
    try {
      await apiPatch(`/trabalho/tarefas/${t.id}`, { ...mudanca, expectedUpdatedAt: t.updatedAt }, token);
      onMudou();
    } catch (e) {
      onErro((e as { status?: number }).status === 409 ? `A tarefa "${t.title}" mudou desde que a lista foi lida. ${oQue} não foi gravado; recarregue a lista.` : (e as Error).message);
    }
  };

  /**
   * O LOTE (versão final, F4): uma escrita por tarefa, em sequência, cada uma com a
   * versão lida e pelas regras de sempre (cliente, porta da implantação, auditoria).
   * Conflito numa não desfaz as outras: a tela diz quantas foram e quantas pedem recarga.
   */
  const aplicarLote = async (mudanca: (t: TrabTarefaResumo) => Record<string, unknown> | string, oQue: string) => {
    if (!editable || !itens) return;
    const alvo = itens.filter((t) => selecionadas.has(t.id));
    let ok = 0, conflito = 0;
    const erros: string[] = [];
    setAvisoDoLote('Aplicando…');
    for (const t of alvo) {
      const m = mudanca(t);
      if (typeof m === 'string') { erros.push(`${t.title}: ${m}`); continue; }
      if (!t.updatedAt) { erros.push(`${t.title}: a versão não está disponível`); continue; }
      try {
        await apiPatch(`/trabalho/tarefas/${t.id}`, { ...m, expectedUpdatedAt: t.updatedAt }, token);
        ok += 1;
      } catch (e) {
        if ((e as { status?: number }).status === 409) conflito += 1;
        else erros.push(`${t.title}: ${(e as Error).message}`);
      }
    }
    const partes = [`${oQue}: ${ok} ${ok === 1 ? 'tarefa alterada' : 'tarefas alteradas'}.`];
    if (conflito) partes.push(`${conflito} ${conflito === 1 ? 'mudou' : 'mudaram'} desde a leitura e não ${conflito === 1 ? 'foi gravada' : 'foram gravadas'}; recarregue e tente de novo.`);
    if (erros.length) partes.push(erros.join(' · '));
    setAvisoDoLote(partes.join(' '));
    limparSelecao();
    onMudou();
  };

  /** O que a barra do lote faz. Etapa por tipo (`tipo:<tipo>`) vira a primeira etapa daquele tipo na lista de cada tarefa. */
  const acoesDoLote = (listas: TrabListaDto[]) => ({
    onEtapa: (destino: string) => void aplicarLote((t) => {
      if (!destino.startsWith('tipo:')) return { statusId: destino };
      return etapaDoTipo(listas, t.listId, destino.slice(5)) ?? 'a lista não tem uma etapa desse tipo';
    }, 'Etapa'),
    onConcluir: () => void aplicarLote((t) => {
      const fechada = etapaDoTipo(listas, t.listId, 'closed');
      return fechada ? { statusId: fechada } : 'a lista não tem etapa de concluída';
    }, 'Concluir'),
    onResponsavel: (id: string | null) => void aplicarLote(() => ({ assigneeUserId: id }), 'Responsável'),
    onPrazo: (dia: string | null) => void aplicarLote(() => ({ dueDate: dia ? prazoDoDia(dia) : null }), 'Prazo'),
  });

  /** As células que editam na linha (responsável, agente, prazo), pelas escritas acima. */
  const edicao = (idsDaEquipe: Set<string> | null, agentes: TrabAgenteDto[]): EdicaoNaLinha => ({
    idsDaEquipe, agentes, token, onMudou, onErro,
    onResponsavel: (id, pessoa) => editarNaLinha(id, { assigneeUserId: pessoa }, 'O responsável'),
    onPrazo: (id, dia) => editarNaLinha(id, { dueDate: dia ? prazoDoDia(dia) : null }, 'O prazo'),
  });

  return { avisoDoLote, setAvisoDoLote, reordenar, editarNaLinha, aplicarLote, acoesDoLote, edicao };
}
