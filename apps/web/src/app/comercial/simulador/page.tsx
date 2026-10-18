'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { CelularDaMesa, CelularDoLead, FichaDoLead, ListaDeCelulares, MensagemNoCelular } from '@mktos/shared';

import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dataHora, explicarEstado, soDigitos } from '@/lib/sala-do-cliente';
import { numeroOuAusente, quandoCurtoSP, quandoRoda } from '@/lib/cockpit';
import {
  FILTROS_DE_ESTADO,
  completarVisto,
  etapasPresentes,
  filtrarConversas,
  horaDaLista,
  previaDaMensagem,
  rotuloDaEtapa,
  temNovidade,
  textoRecolhido,
  vistoInicial,
  type FiltroDeEstado,
  type VistoPorLead,
} from '@/lib/atendimento-whats';

import { BarraDaSaude, BOTAO, BOTAO_PRIMARIO, Chip, FOCO, INPUT, ROTULO, useCarregar } from '../_ui';
import { LinkDoLead, useMudouNoPainel, usePainel } from '../_painel/provedor';

/*
 * O SIMULADOR DE WHATSAPP — os celulares do lead e da mesa (telas 01 e 09), Lane B.
 * Lane P6 (rodada do painel, 18/10/2026): virou a tela de ATENDIMENTO, no
 * desenho do Inbox do FinOps (lista de conversas, conversa, contexto), sem
 * mexer no motor. À esquerda, as conversas com busca e filtros, e o "novo
 * lead" (o primeiro oi do Instagram ou do link da bio). No meio, a conversa
 * do lead: o que a casa mandou (com formulário e botões renderizados) e o que
 * ele responde. À direita, o contexto do lead e o celular da mesa: as decisões
 * abertas com os botões e as mensagens esperando o toque de liberar. No
 * celular, uma coluna por vez, com voltar.
 *
 * Provedor `simulado`: nada sai da máquina.
 *
 * NADA AQUI É ATALHO DA RÉGUA. Mensagem da casa é a capacidade
 * `comercial.whatsapp.enviar` (R3): ela só aparece "entregue" no celular do
 * lead depois que OUTRA pessoa confirma na fila. O botão "liberar envio" da
 * mesa é a mesma confirmação de `/atendimento`, com a mesma alçada.
 */

type Vista = 'lista' | 'conversa' | 'contexto';
type AbaDoContexto = 'lead' | 'mesa';
type Agir = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

const CHAVE_DO_VISTO = 'comercial:simulador:visto';
const COLUNA = 'flex min-h-0 min-w-0 flex-col overflow-hidden rounded border border-border bg-surface';
// Botão que pode receber rótulo comprido: quebra dentro dele, nunca empurra o balão.
const BOTAO_QUE_QUEBRA = `${BOTAO} h-auto max-w-full whitespace-normal text-left`;
const BOTAO_PRIMARIO_QUE_QUEBRA = `${BOTAO_PRIMARIO} h-auto max-w-full whitespace-normal text-left`;

function lerVisto(): VistoPorLead | null {
  try {
    const v = window.localStorage.getItem(CHAVE_DO_VISTO);
    return v ? (JSON.parse(v) as VistoPorLead) : null;
  } catch {
    return null;
  }
}

function gravarVisto(v: VistoPorLead) {
  try {
    window.localStorage.setItem(CHAVE_DO_VISTO, JSON.stringify(v));
  } catch {
    /* sem localStorage, a marca de "nova" só não aparece */
  }
}

export default function SimuladorPage() {
  const { token, ready } = useAuth();
  const painel = usePainel();
  const [lista, setLista] = useState<ListaDeCelulares | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [conversa, setConversa] = useState<CelularDoLead | null>(null);
  const [mesa, setMesa] = useState<CelularDaMesa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>('lista');
  const [abaDoContexto, setAbaDoContexto] = useState<AbaDoContexto>('lead');
  const [visto, setVisto] = useState<VistoPorLead | null>(null);
  // A prévia da última mensagem das conversas já abertas nesta visita (a lista da API não traz o texto).
  const [previas, setPrevias] = useState<Record<string, MensagemNoCelular>>({});
  const leadAtual = useRef<string | null>(null);
  leadAtual.current = leadId;

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const [l, m] = await Promise.all([apiGet<ListaDeCelulares>('/comercial/simulador/celulares', token), apiGet<CelularDaMesa>('/comercial/simulador/mesa', token)]);
      setLista(l);
      setMesa(m);
      if (leadId) {
        const c = await apiGet<CelularDoLead>(`/comercial/simulador/lead/${leadId}`, token);
        // A resposta de outra conversa que chegou atrasada não entra.
        if (leadAtual.current === leadId) {
          setConversa(c);
          const ultima = c.mensagens.at(-1);
          if (ultima) setPrevias((p) => (p[c.leadId]?.id === ultima.id && p[c.leadId]?.texto === ultima.texto ? p : { ...p, [c.leadId]: ultima }));
        }
      }
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token, leadId]);
  useMudouNoPainel(carregar);

  // Vindo do painel do lead ("WhatsApp"), a tela já abre na conversa dele.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('conversa');
    if (c && /^[A-Za-z0-9_-]{1,64}$/.test(c)) {
      setLeadId(c);
      setVista('conversa');
    }
  }, []);

  useEffect(() => {
    if (!ready || !token) return;
    void carregar();
    const t = setInterval(() => void carregar(), 4000);
    return () => clearInterval(t);
  }, [ready, token, carregar]);

  // A marca de "nova": a primeira visita registra o que já estava lá; abrir a conversa marca como vista.
  useEffect(() => {
    if (!lista) return;
    setVisto((atual) => {
      const base = atual ?? lerVisto() ?? vistoInicial(lista.leads);
      let v = completarVisto(base, lista.leads);
      const aberto = leadId ? lista.leads.find((l) => l.leadId === leadId) : null;
      if (aberto?.ultimaEm && v[aberto.leadId] !== aberto.ultimaEm) v = { ...v, [aberto.leadId]: aberto.ultimaEm };
      if (v !== atual) gravarVisto(v);
      return v;
    });
  }, [lista, leadId]);

  // O resultado de cada toque vai ao aviso do canto (o toast do comercial), com o texto da API.
  async function agir(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) painel.avisar(ok, 'bom');
      await carregar();
    } catch (e) {
      painel.avisar((e as Error).message, 'ruim');
    }
  }

  function abrirConversa(id: string) {
    if (id !== leadId) setConversa(null);
    setLeadId(id);
    setVista('conversa');
    setAbaDoContexto('lead');
  }

  function abrirContexto(aba: AbaDoContexto) {
    setAbaDoContexto(aba);
    setVista('contexto');
  }

  const doLead = lista?.leads.find((l) => l.leadId === leadId) ?? null;
  const naMesa = (mesa?.decisoes.length ?? 0) + (mesa?.mensagensNaFila.length ?? 0);

  // Uma coluna por vez no celular; lista + (conversa ou contexto) no meio; as três a partir de 1280 px.
  const classeDaLista = vista === 'lista' ? 'flex' : 'max-md:hidden md:flex';
  const classeDaConversa = vista === 'conversa' ? 'flex' : vista === 'lista' ? 'max-md:hidden flex' : 'hidden xl:flex';
  const classeDoContexto = vista === 'contexto' ? 'flex' : 'hidden xl:flex';

  return (
    // A altura é a da tela menos o topo do OS e a faixa do botão flutuante "Perguntar" (bottom-5 + 44 px),
    // para ele nunca tampar o campo de escrever nem o fim da coluna.
    <div className="flex h-[calc(100dvh-52px-2rem-3.75rem)] min-h-[30rem] min-w-0 flex-col gap-3 min-[820px]:h-[calc(100dvh-46px-3rem-3.5rem)]">
      <header className="shrink-0 space-y-1.5">
        <details className="group text-[13px] text-muted">
          <summary className={`cursor-pointer list-none rounded-sm marker:hidden ${FOCO}`}>
            <span className="text-text">Provedor: <span className="font-os-mono">{lista?.provedor ?? '…'}</span></span>
            <span className="ml-2 underline underline-offset-2 group-open:hidden">como funciona</span>
            <span className="ml-2 hidden underline underline-offset-2 group-open:inline">recolher</span>
          </summary>
          <p className="mt-1 max-w-3xl">
            Os celulares simulados do comercial. Nada sai da máquina; toda mensagem da casa passa pela fila de aprovação antes de aparecer como entregue.
          </p>
        </details>
        {erro && <p role="alert" className="text-[13px] text-bad">{erro}</p>}
      </header>

      <div
        data-testid="whats-atendimento"
        data-vista={vista}
        className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)] xl:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)_minmax(18rem,23rem)]"
      >
        <ListaDeConversas
          className={classeDaLista}
          lista={lista}
          leadId={leadId}
          visto={visto}
          previas={previas}
          naMesa={naMesa}
          token={token}
          aoAbrir={abrirConversa}
          aoAbrirMesa={() => abrirContexto('mesa')}
          aoEntrar={(id) => agir(async () => abrirConversa(id), 'Lead entrou. A M1 foi preparada e está na fila.')}
        />

        <section data-testid="whats-painel-da-conversa" aria-label="conversa" className={`${COLUNA} bg-bg ${classeDaConversa}`}>
          <CabecalhoDaConversa
            nome={conversa?.nome ?? doLead?.nome ?? null}
            telefone={conversa?.telefone ?? doLead?.telefone ?? null}
            etapa={conversa?.etapa ?? doLead?.etapa ?? null}
            mostrarVoltar={vista === 'conversa'}
            aoVoltar={() => setVista('lista')}
            aoContexto={leadId ? () => abrirContexto('lead') : undefined}
          />
          {conversa && conversa.leadId === leadId ? (
            <ConversaDoLead c={conversa} token={token} agir={agir} />
          ) : leadId ? (
            <div role="status" className="flex-1 space-y-2 p-3">
              <span className="sr-only">carregando a conversa…</span>
              {[0, 1, 2].map((i) => (
                <div key={i} aria-hidden className={`h-12 animate-pulse rounded bg-surface-2 motion-reduce:animate-none ${i % 2 ? 'ml-auto w-1/2' : 'w-2/3'}`} />
              ))}
            </div>
          ) : (
            <p className="p-4 text-[12.5px] text-muted">Escolha uma conversa na lista.</p>
          )}
        </section>

        <section data-testid="whats-contexto" aria-label="contexto do lead e mesa" className={`${COLUNA} ${classeDoContexto}`}>
          <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 pt-2">
            {vista === 'contexto' && (
              <button type="button" data-testid="whats-voltar" onClick={() => setVista(leadId ? 'conversa' : 'lista')} className={`${BOTAO} mb-2 mr-1 xl:hidden`} aria-label="voltar">
                voltar
              </button>
            )}
            <div role="tablist" aria-label="contexto" className="flex min-w-0 gap-1">
              {(
                [
                  ['lead', 'lead'],
                  ['mesa', `mesa${naMesa ? ` · ${naMesa}` : ''}`],
                ] as const
              ).map(([aba, rotulo]) => (
                <button
                  key={aba}
                  type="button"
                  role="tab"
                  aria-selected={abaDoContexto === aba}
                  data-testid={`whats-aba-${aba}`}
                  onClick={() => setAbaDoContexto(aba)}
                  className={`shrink-0 border-b-2 px-3 pb-2 pt-1.5 text-[13px] max-md:min-h-[44px] ${abaDoContexto === aba ? 'border-brand font-semibold text-text' : 'border-transparent text-muted hover:text-text'} ${FOCO}`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
          <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
            {abaDoContexto === 'lead' ? (
              leadId ? <ContextoDoLead leadId={leadId} doLead={doLead} conversa={conversa?.leadId === leadId ? conversa : null} /> : <p className="p-4 text-[12.5px] text-muted">Escolha uma conversa para ver a etapa, a próxima ação e o caminho para o cockpit.</p>
            ) : mesa ? (
              <CelularDaMesaView mesa={mesa} token={token} agir={agir} />
            ) : (
              <p className="p-4 text-[12.5px] text-muted">carregando…</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista de conversas
// ---------------------------------------------------------------------------

function ListaDeConversas({
  className,
  lista,
  leadId,
  visto,
  previas,
  naMesa,
  token,
  aoAbrir,
  aoAbrirMesa,
  aoEntrar,
}: {
  className: string;
  lista: ListaDeCelulares | null;
  leadId: string | null;
  visto: VistoPorLead | null;
  previas: Record<string, MensagemNoCelular>;
  naMesa: number;
  token: string | null;
  aoAbrir: (id: string) => void;
  aoAbrirMesa: () => void;
  aoEntrar: (id: string) => void;
}) {
  const [busca, setBusca] = useState('');
  const [etapa, setEtapa] = useState('');
  const [estado, setEstado] = useState<FiltroDeEstado>('todos');
  const leads = useMemo(() => lista?.leads ?? [], [lista]);
  const visiveis = useMemo(() => filtrarConversas(leads, { busca, etapa, estado }), [leads, busca, etapa, estado]);
  const etapas = useMemo(() => etapasPresentes(leads), [leads]);
  const filtrando = !!busca.trim() || !!etapa || estado !== 'todos';

  return (
    <section data-testid="whats-lista" aria-label="conversas" className={`${COLUNA} ${className}`}>
      <div className="shrink-0 space-y-2 border-b border-border p-2">
        <div className="flex items-center gap-2">
          <h2 className={`${ROTULO} min-w-0 flex-1`}>conversas{lista ? ` · ${leads.length}` : ''}</h2>
          <button type="button" data-testid="whats-abrir-mesa" onClick={aoAbrirMesa} className={`${BOTAO} xl:hidden`}>
            mesa{naMesa ? ` · ${naMesa}` : ''}
          </button>
        </div>
        <input
          type="search"
          className={`${INPUT} py-1.5`}
          placeholder="buscar nome ou telefone"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="buscar conversa"
          data-testid="whats-busca"
        />
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <select className={`${INPUT} py-1.5 text-[12.5px]`} value={etapa} onChange={(e) => setEtapa(e.target.value)} aria-label="filtrar por etapa" data-testid="whats-filtro-etapa">
            <option value="">etapa: todas</option>
            {etapas.map((e) => (
              <option key={e} value={e}>{rotuloDaEtapa(e)}</option>
            ))}
          </select>
          <select className={`${INPUT} py-1.5 text-[12.5px]`} value={estado} onChange={(e) => setEstado(e.target.value as FiltroDeEstado)} aria-label="filtrar por estado" data-testid="whats-filtro-estado">
            {FILTROS_DE_ESTADO.map((f) => (
              <option key={f.chave} value={f.chave}>{f.rotulo}</option>
            ))}
          </select>
        </div>
        <details open={lista ? leads.length === 0 : undefined} className="rounded border border-border bg-bg">
          <summary className={`cursor-pointer px-2 py-1.5 text-[12.5px] max-md:min-h-[44px] max-md:py-3 ${FOCO}`}>novo lead</summary>
          <NovoLead aoEntrar={aoEntrar} token={token} />
        </details>
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" aria-label="lista de conversas">
        {!lista && (
          <li role="status" className="space-y-2 p-2">
            <span className="sr-only">carregando…</span>
            {[0, 1, 2].map((i) => <div key={i} aria-hidden className="h-12 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />)}
          </li>
        )}
        {visiveis.map((l) => {
          const ativa = l.leadId === leadId;
          const nova = !ativa && temNovidade(l, visto);
          const previa = previaDaMensagem(previas[l.leadId]);
          const linhaDeApoio = previa || [l.telefone, rotuloDaEtapa(l.etapa)].filter(Boolean).join(' · ');
          return (
            <li key={l.leadId}>
              <button
                type="button"
                data-testid={`whats-conversa-${l.leadId}`}
                aria-current={ativa ? 'true' : undefined}
                onClick={() => aoAbrir(l.leadId)}
                title={l.nome}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 px-2.5 py-2 text-left hover:bg-surface-2 max-md:min-h-[56px] ${ativa ? 'bg-brand/10' : ''} ${FOCO}`}
              >
                <span className={`truncate text-[13px] ${nova ? 'font-bold text-text' : 'font-semibold'}`}>{l.nome}</span>
                <span className="font-os-mono text-[10.5px] tabular-nums text-muted">{horaDaLista(l.ultimaEm)}</span>
                <span className="truncate text-[12px] text-muted" title={previa ? previas[l.leadId]?.texto : linhaDeApoio}>{linhaDeApoio}</span>
                <span className="flex items-center justify-end gap-1">
                  {nova && <span className="h-2 w-2 rounded-full bg-brand" aria-label="mexeu desde a última vez que você abriu" />}
                  {l.naFila > 0 && (
                    <span className="rounded bg-brand px-1.5 font-os-mono text-[10px] font-semibold leading-[1.5] text-ink" title={`${l.naFila} ${l.naFila === 1 ? 'mensagem da casa esperando' : 'mensagens da casa esperando'} liberação na fila`}>
                      {l.naFila}
                      <span className="sr-only"> na fila</span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {lista && !leads.length && <li className="p-3 text-[12.5px] text-muted">Nenhum lead ainda. Comece pelo novo lead acima.</li>}
        {lista && !!leads.length && !visiveis.length && (
          <li className="p-3 text-[12.5px] text-muted">{filtrando ? 'Nenhuma conversa com esse filtro.' : 'Nenhuma conversa.'}</li>
        )}
      </ul>
    </section>
  );
}

function NovoLead({ token, aoEntrar }: { token: string | null; aoEntrar: (leadId: string) => void }) {
  const [telefone, setTelefone] = useState('');
  const [nome, setNome] = useState('');
  const [texto, setTexto] = useState('Oi! Vi o vídeo do fechamento do mês em 1 dia. Funciona com Omie?');
  const [palavra, setPalavra] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <form
      className="space-y-2 p-2 pt-0"
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        setErro(null);
        try {
          const r = await apiPost<{ leadId: string }>('/comercial/simulador/entrada', { telefone: soDigitos(telefone), texto: texto.trim(), ...(nome.trim() ? { nome: nome.trim() } : {}), ...(palavra.trim() ? { palavraChave: palavra.trim() } : {}) }, token);
          aoEntrar(r.leadId);
          setTelefone('');
          setNome('');
        } catch (err) {
          setErro((err as Error).message);
        } finally {
          setEnviando(false);
        }
      }}
    >
      <input className={INPUT} placeholder="telefone com DDD" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} aria-label="telefone" />
      <input className={INPUT} placeholder="nome (opcional)" value={nome} onChange={(e) => setNome(e.target.value)} aria-label="nome" />
      <input className={INPUT} placeholder="palavra-chave (opcional)" value={palavra} onChange={(e) => setPalavra(e.target.value)} aria-label="palavra-chave" />
      <textarea className={`${INPUT} max-h-40 min-h-[3.5rem]`} rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="primeira mensagem" />
      <button type="submit" disabled={enviando || soDigitos(telefone).length < 10 || !texto.trim()} className={`${BOTAO_PRIMARIO} w-full`}>
        {enviando ? 'enviando…' : 'mandar o primeiro oi'}
      </button>
      {erro && <p role="alert" className="text-[12px] text-bad">{erro}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Conversa
// ---------------------------------------------------------------------------

function CabecalhoDaConversa({
  nome,
  telefone,
  etapa,
  mostrarVoltar,
  aoVoltar,
  aoContexto,
}: {
  nome: string | null;
  telefone: string | null;
  etapa: string | null;
  mostrarVoltar: boolean;
  aoVoltar: () => void;
  aoContexto?: () => void;
}) {
  const titulo = nome ?? 'celular do lead';
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-2 py-2 md:px-3">
      {mostrarVoltar && (
        <button type="button" data-testid="whats-voltar" onClick={aoVoltar} className={`${BOTAO} md:hidden`} aria-label="voltar para as conversas">
          voltar
        </button>
      )}
      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full max-sm:hidden bg-brand/15 text-[13px] font-bold text-brand">{titulo.slice(0, 1).toUpperCase()}</span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[13.5px] font-semibold" title={titulo}>{titulo}</h2>
        <p className="truncate font-os-mono text-[10.5px] text-muted" title={[telefone, etapa ? rotuloDaEtapa(etapa) : null].filter(Boolean).join(' · ')}>
          {nome ? [telefone ?? 'telefone ausente', etapa ? rotuloDaEtapa(etapa) : null].filter(Boolean).join(' · ') : 'escolha um lead'}
        </p>
      </div>
      {aoContexto && (
        <button type="button" data-testid="whats-abrir-contexto" onClick={aoContexto} className={`${BOTAO} shrink-0 xl:hidden`}>
          contexto
        </button>
      )}
    </div>
  );
}

function ConversaDoLead({ c, token, agir }: { c: CelularDoLead; token: string | null; agir: Agir }) {
  const [texto, setTexto] = useState('');
  const base = `/comercial/simulador/lead/${c.leadId}/responder`;
  const fim = useRef<HTMLDivElement | null>(null);
  const ultima = c.mensagens.at(-1)?.id;
  // Mensagem nova leva a conversa ao fim (sem animar para quem pediu menos movimento).
  useEffect(() => {
    fim.current?.scrollIntoView?.({ block: 'end' });
  }, [ultima]);

  function enviar() {
    if (!texto.trim()) return;
    void agir(() => apiPost(base, { texto: texto.trim() }, token));
    setTexto('');
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden p-2 md:p-3" aria-live="polite" aria-relevant="additions">
        {c.linkDaSala && (
          <p className="text-center font-os-mono text-[10.5px] text-muted">
            sala: <a href={c.linkDaSala} target="_blank" rel="noreferrer" title={c.linkDaSala} className={`underline underline-offset-2 ${FOCO}`}>abrir</a>
          </p>
        )}
        {!c.mensagens.length && <p className="text-center text-[12.5px] text-muted">Nenhuma mensagem nesta conversa ainda.</p>}
        {c.mensagens.map((m) => (
          <div key={m.id} className="min-w-0">
            <Bolha m={m} aoResponderForm={(f) => agir(() => apiPost(base, { formulario: f }, token), 'Formulário respondido.')} aoTocar={(chave) => agir(() => apiPost(base, { botao: chave }, token), 'Horário escolhido.')} />
            {m.template === 'M6' && m.estado === 'rascunho' && <Novidade id={m.id} token={token} agir={agir} />}
          </div>
        ))}
        <div ref={fim} />
      </div>
      <form
        className="flex shrink-0 items-end gap-2 border-t border-border bg-surface p-2"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <textarea
          rows={1}
          maxLength={2000}
          className={`${INPUT} max-h-32 min-h-[2.5rem] resize-none`}
          placeholder="o lead escreve…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              enviar();
            }
          }}
          aria-label="mensagem do lead"
        />
        <button type="submit" className={`${BOTAO_PRIMARIO} shrink-0`} disabled={!texto.trim()}>enviar</button>
      </form>
    </>
  );
}

function Bolha({ m, aoResponderForm, aoTocar }: { m: MensagemNoCelular; aoResponderForm: (f: Record<string, unknown>) => void; aoTocar: (chave: string) => void }) {
  const doLead = m.direcao === 'entrada';
  const entregue = m.estado === 'enviada';
  const [inteira, setInteira] = useState(false);
  const recolhido = textoRecolhido(m.texto);
  const mostrado = inteira ? m.texto : recolhido.texto;
  return (
    <div className={`flex min-w-0 ${doLead ? 'justify-end' : 'justify-start'}`}>
      <div
        data-testid={`whats-balao-${m.id}`}
        className={`min-w-0 max-w-[min(85%,40rem)] rounded-lg px-3 py-2 text-[13px] [overflow-wrap:anywhere] ${doLead ? 'bg-brand/15' : 'border border-border bg-surface'} ${!doLead && !entregue ? 'border-dashed opacity-80' : ''}`}
      >
        {m.template && <div className="font-os-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">{m.template}</div>}
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{mostrado}</p>
        {recolhido.cortado && (
          <button type="button" onClick={() => setInteira((v) => !v)} aria-expanded={inteira} className={`mt-1 text-[12px] text-muted underline underline-offset-2 hover:text-brand max-md:min-h-[44px] ${FOCO}`}>
            {inteira ? 'recolher' : `ler a mensagem inteira (${m.texto.length} caracteres)`}
          </button>
        )}
        {m.interativo?.formulario && <FormularioNaConversa campos={m.interativo.formulario.campos} ativo={entregue} aoEnviar={aoResponderForm} />}
        {m.interativo?.botoes && (
          <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
            {m.interativo.botoes.map((b) => (
              <button key={b.chave} type="button" disabled={!entregue} onClick={() => aoTocar(b.chave)} className={BOTAO_QUE_QUEBRA}>{b.rotulo}</button>
            ))}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 font-os-mono text-[9.5px] text-muted">
          <span className="tabular-nums">{dataHora(m.enviadaEm ?? m.em)}</span>
          {!doLead && <span className={`min-w-0 ${entregue ? 'text-brand' : m.estado === 'falhou' ? 'text-bad' : ''}`}>{explicarEstado(m.estado, m.vetoAte)}</span>}
        </div>
        {m.estado === 'falhou' && m.erro && <p className="mt-1 text-[11px] text-bad">{m.erro}</p>}
        {m.estado === 'rascunho' && m.erro && <p className="mt-1 text-[11px] text-muted">{m.erro}</p>}
      </div>
    </div>
  );
}

function FormularioNaConversa({ campos, ativo, aoEnviar }: { campos: { chave: string; rotulo: string; tipo: string }[]; ativo: boolean; aoEnviar: (f: Record<string, unknown>) => void }) {
  const [v, setV] = useState<Record<string, string>>({});
  const pronto = campos.every((c) => (v[c.chave] ?? '').trim() !== '');
  return (
    <form
      className="mt-2 min-w-0 space-y-1.5 rounded border border-border bg-bg p-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f: Record<string, unknown> = {};
        for (const c of campos) {
          const x = (v[c.chave] ?? '').trim();
          f[c.chave] = c.tipo === 'sim_nao' ? x === 'sim' : c.tipo === 'numero' ? Number(x) : x;
        }
        aoEnviar(f);
      }}
    >
      {campos.map((c) => (
        <label key={c.chave} className="block min-w-0 text-[12px]">
          {c.rotulo}
          {c.tipo === 'sim_nao' ? (
            <select className={`${INPUT} mt-0.5 py-1`} disabled={!ativo} value={v[c.chave] ?? ''} onChange={(e) => setV((o) => ({ ...o, [c.chave]: e.target.value }))}>
              <option value="">escolha</option>
              <option value="sim">sim</option>
              <option value="nao">não</option>
            </select>
          ) : (
            <input className={`${INPUT} mt-0.5 py-1`} disabled={!ativo} inputMode={c.tipo === 'numero' ? 'numeric' : undefined} value={v[c.chave] ?? ''} onChange={(e) => setV((o) => ({ ...o, [c.chave]: c.tipo === 'numero' ? soDigitos(e.target.value) : e.target.value }))} />
          )}
        </label>
      ))}
      <button type="submit" disabled={!ativo || !pronto} className={`${BOTAO_PRIMARIO} h-auto w-full whitespace-normal`}>{ativo ? 'enviar respostas' : 'chega quando a mensagem for liberada'}</button>
    </form>
  );
}

/** O M6 só sai com uma novidade concreta escrita (C08: nunca só cobrança). */
function Novidade({ id, token, agir }: { id: string; token: string | null; agir: Agir }) {
  const [texto, setTexto] = useState('');
  return (
    <form
      className="mt-1 flex min-w-0 max-w-[min(85%,40rem)] flex-wrap gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void agir(() => apiPost(`/comercial/simulador/mensagens/${id}/novidade`, { novidade: texto.trim() }, token), 'M6 completo: foi para a fila.');
      }}
    >
      <input className={`${INPUT} min-w-[12rem] flex-1`} placeholder="a novidade concreta (caso, prazo, vaga)" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="novidade do M6" />
      <button type="submit" disabled={texto.trim().length < 10} className={BOTAO_PRIMARIO}>completar</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Contexto do lead e mesa
// ---------------------------------------------------------------------------

function ContextoDoLead({ leadId, doLead, conversa }: { leadId: string; doLead: ListaDeCelulares['leads'][number] | null; conversa: CelularDoLead | null }) {
  const { dados: f, erro } = useCarregar<FichaDoLead>(`/comercial/lead/${encodeURIComponent(leadId)}`, 30_000);
  const nome = f?.empresa ?? conversa?.nome ?? doLead?.nome ?? leadId;
  const etapa = f?.etapa ?? conversa?.etapa ?? doLead?.etapa ?? null;
  return (
    <div className="space-y-3 p-3 text-[13px]">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-snug">{nome}</p>
        {f?.empresa && f.empresa !== f.nome && <p className="text-[12.5px] text-muted">{f.nome}</p>}
        <p className="font-os-mono text-[11px] text-muted">{conversa?.telefone ?? doLead?.telefone ?? 'telefone ausente'}</p>
      </div>
      <dl className="grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className={ROTULO}>etapa</dt>
        <dd className="min-w-0"><Chip tom="brand">{rotuloDaEtapa(etapa)}</Chip></dd>
        <dt className={ROTULO}>próxima ação</dt>
        <dd className="min-w-0">
          {f ? (
            f.proximaAcao ? (
              <>
                {f.proximaAcao.descricao}
                {f.proximaAcao.quando && <span className="text-muted tabular-nums"> · {quandoRoda(f.proximaAcao.quando)} ({quandoCurtoSP(f.proximaAcao.quando)})</span>}
              </>
            ) : (
              <span className="text-muted">ausente</span>
            )
          ) : erro ? (
            <span className="text-muted">não carregou</span>
          ) : (
            <span aria-hidden className="inline-block h-4 w-32 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
          )}
        </dd>
        {f && (
          <>
            <dt className={ROTULO}>dono</dt>
            <dd className="min-w-0">{f.dono?.nome ?? 'ausente'}</dd>
            <dt className={ROTULO}>saúde</dt>
            <dd className="min-w-0">
              <span className="tabular-nums">{numeroOuAusente(f.saude)}</span>
              <BarraDaSaude saude={f.saude} />
            </dd>
            {f.portao.faltando.length > 0 && (
              <>
                <dt className={ROTULO}>falta</dt>
                <dd className="min-w-0 text-muted">{f.portao.faltando.join(' · ')}</dd>
              </>
            )}
          </>
        )}
        <dt className={ROTULO}>na fila</dt>
        <dd className="min-w-0 tabular-nums">{doLead ? `${doLead.naFila} ${doLead.naFila === 1 ? 'mensagem' : 'mensagens'}` : 'ausente'}</dd>
      </dl>
      {erro != null && <p role="alert" className="text-[12px] text-bad">A ficha do lead não carregou: {erro instanceof Error ? erro.message : String(erro)}</p>}
      <div className="flex flex-wrap gap-2">
        <LinkDoLead leadId={leadId} aba="fio" data-testid="whats-abrir-cockpit" className={BOTAO_PRIMARIO}>
          abrir no cockpit
        </LinkDoLead>
        {conversa?.linkDaSala && (
          <a href={conversa.linkDaSala} target="_blank" rel="noreferrer" className={BOTAO}>abrir sala</a>
        )}
      </div>
    </div>
  );
}

function CelularDaMesaView({ mesa, token, agir }: { mesa: CelularDaMesa; token: string | null; agir: Agir }) {
  return (
    <div className="space-y-3 p-3">
      <p className={ROTULO}>Vigia Root · WhatsApp interno da mesa</p>
      {mesa.decisoes.map((d) => (
        <div key={d.id} className="min-w-0 rounded border border-border bg-bg px-3 py-2 text-[13px]">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="min-w-0 flex-1 truncate font-os-mono text-[9.5px] uppercase tracking-[0.14em] text-muted" title={`decisão · ${d.leadNome}`}>decisão · {d.leadNome}</span>
            <Link href={`/comercial?lead=${encodeURIComponent(d.leadId)}&aba=decisoes`} className={`shrink-0 text-[11.5px] text-muted underline underline-offset-2 hover:text-brand max-md:py-2 ${FOCO}`}>
              abrir no cockpit
            </Link>
          </div>
          <p className="font-semibold">{d.titulo}</p>
          <p className="text-muted">{d.contexto}</p>
          <p className="mt-1 text-[11.5px] text-muted">Padrão se ninguém responder até {dataHora(d.expiraEm)}: {d.opcoes.find((o) => o.chave === d.padrao)?.rotulo ?? d.padrao}.</p>
          <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
            {d.opcoes.map((o) => (
              <button key={o.chave} type="button" title={o.efeito} onClick={() => agir(() => apiPost('/comercial/simulador/mesa/responder', { decisaoId: d.id, escolha: o.chave }, token), `Decidido: ${o.rotulo}.`)} className={o.chave === d.padrao ? BOTAO_PRIMARIO_QUE_QUEBRA : BOTAO_QUE_QUEBRA}>
                {o.rotulo}
              </button>
            ))}
          </div>
        </div>
      ))}

      {mesa.mensagensNaFila.map((m) => (
        <MensagemNaMesa key={m.id} m={m} token={token} agir={agir} />
      ))}

      {!mesa.decisoes.length && !mesa.mensagensNaFila.length && <p className="text-[12.5px] text-muted">Nada esperando a mesa agora.</p>}
    </div>
  );
}

function MensagemNaMesa({ m, token, agir }: { m: CelularDaMesa['mensagensNaFila'][number]; token: string | null; agir: Agir }) {
  const [inteira, setInteira] = useState(false);
  const recolhido = textoRecolhido(m.texto, 400);
  return (
    <div className="min-w-0 rounded border border-border bg-bg px-3 py-2 text-[13px]">
      <div className="truncate font-os-mono text-[9.5px] uppercase tracking-[0.14em] text-muted" title={`${m.template ?? 'mensagem'} para ${m.leadNome}`}>{m.template ?? 'mensagem'} para {m.leadNome}</div>
      <p className="whitespace-pre-wrap">{inteira ? m.texto : recolhido.texto}</p>
      {recolhido.cortado && (
        <button type="button" onClick={() => setInteira((v) => !v)} aria-expanded={inteira} className={`mt-1 text-[12px] text-muted underline underline-offset-2 hover:text-brand max-md:min-h-[44px] ${FOCO}`}>
          {inteira ? 'recolher' : 'ler a mensagem inteira'}
        </button>
      )}
      <p className="mt-1 text-[11.5px] text-muted">{explicarEstado(m.estado, m.vetoAte)}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {m.estado === 'na_fila' && m.approvalId && (
          <>
            <button type="button" onClick={() => agir(() => apiPost(`/approvals/${m.approvalId}/confirm`, {}, token), 'Envio liberado.')} className={BOTAO_PRIMARIO}>Liberar envio</button>
            <Link href="/atendimento" className={BOTAO}>Abrir na fila</Link>
          </>
        )}
        {m.estado === 'em_veto' && (
          <button type="button" onClick={() => agir(() => apiPost(`/comercial/simulador/mensagens/${m.id}/vetar`, {}, token), 'Vetada: não sai.')} className={BOTAO}>Vetar</button>
        )}
      </div>
    </div>
  );
}
