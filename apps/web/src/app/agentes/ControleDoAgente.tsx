'use client';

import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { AgentEstadoHumanoPainelSchema, AgentEstadoHumanoSchema, type AgentEstadoHumanoPainel } from '@mktos/shared';
import { entradaDaAgenda, dadoDaAgenda, mesmoValorDaAgenda, useOperacoesLocaisDaAgenda, PedidosLocaisDaAgenda, EscolhaDaAgendaAlterada, ConferenciaDaAgendaInvalida, type PistaDaOperacaoLocal } from './AgendaManual';
import {
  AVISO_DA_INVOCACAO,
  EXPLICA_O_ESTADO,
  ROTULO_DA_SITUACAO,
  ROTULO_DO_ESTADO,
  TOM_DA_SITUACAO,
  botoesDeEstado,
  type BotaoDeEstado,
  type EstadoDeAgente,
  type SituacaoDeAgente,
  type Tom,
} from './estado';

/*
 * ============================================================================
 * O ESTADO DO AGENTE NA MÃO DO DONO — fatia A2
 * ============================================================================
 *
 * DOIS SELOS, e não um. O de cima é a DECISÃO (ativo, pausado, encerrado); o de
 * baixo é o que ESTÁ ACONTECENDO (rodando agora, ocioso, erro na última
 * passagem). Os dois vêm do servidor — `estado` é coluna, `situacao` é derivada
 * lá — e aparecem juntos porque um sozinho esconderia o outro: "ativo" não
 * responde se ele trabalhou hoje, e "erro" não responde se alguém já o parou.
 *
 * Quando os dois dizem a mesma coisa (agente pausado tem situação `pausado`), o
 * segundo selo não aparece: repetir a palavra ocuparia espaço sem informar.
 *
 * A TELA NÃO CALCULA NADA. Quais botões existem vem de `agente.transicoes`;
 * quem recusa de verdade é a API. O que esta peça faz é DIZER O QUE CADA BOTÃO
 * FAZ antes de alguém clicar — inclusive que uma ação do agente pode ficar
 * retida esperando outra pessoa.
 */

const CORES: Record<Tom, string> = {
  ok: 'bg-good/15 text-good',
  atencao: 'bg-warn/15 text-warn',
  erro: 'bg-bad/15 text-bad',
  neutro: 'bg-surface-3 text-muted',
};

function Selo({ texto, tom, titulo }: { texto: string; tom: Tom; titulo?: string }) {
  return (
    <span
      title={titulo}
      className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-root px-[6px] py-[2px] font-os-mono text-[10px] font-medium uppercase tracking-[0.1em] ${CORES[tom]}`}
    >
      {/* O ponto faz o estado ler por FORMA também, não só por cor — a mesma
          decisão do `StatusChip` dos leads (daltonismo, tema mono, impressão). */}
      <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-current" />
      {texto}
    </span>
  );
}

export interface AgenteComEstado {
  slug: string;
  nome: string;
  estado: EstadoDeAgente;
  situacao: SituacaoDeAgente;
  estadoPor: string | null;
  estadoEm: string | null;
  estadoMotivo: string | null;
  transicoes: string[];
}

/** Os dois selos, lado a lado. Vale sozinho — a lista e o mapa também o usam. */
export function SelosDoAgente({ agente }: { agente: AgenteComEstado }) {
  const mesmaPalavra = agente.situacao === agente.estado;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Selo
        texto={ROTULO_DO_ESTADO[agente.estado] ?? agente.estado}
        tom={TOM_DA_SITUACAO[agente.estado] ?? 'neutro'}
        titulo={EXPLICA_O_ESTADO[agente.estado]}
      />
      {!mesmaPalavra && (
        <Selo
          texto={ROTULO_DA_SITUACAO[agente.situacao] ?? agente.situacao}
          tom={TOM_DA_SITUACAO[agente.situacao] ?? 'neutro'}
          titulo="o que está acontecendo agora — medido das sessões, não declarado"
        />
      )}
    </span>
  );
}

interface Props {
  agente: AgenteComEstado;
  token: string | null;
  pessoaId: string;
  podeComandar: boolean;
  podeInvocar: boolean;
  aoMudar: () => void;
}

export function ControleDoAgente({ agente, token, pessoaId, podeComandar, podeInvocar, aoMudar }: Props) {
  const op = useOperacoesLocaisDaAgenda({ token, pessoaId, slug: agente.slug });
  const [escolhido, setEscolhido] = useState<AgentEstadoHumanoPainel | null>(null), [atual, setAtual] = useState<AgentEstadoHumanoPainel | null>(null);
  const [abrindo, setAbrindo] = useState<BotaoDeEstado | null>(null), [motivo, setMotivo] = useState('');
  const [desfecho, setDesfecho] = useState<{ status: string; texto: string | null } | null>(null);
  const draftRevision = useRef(0);
  function limpar() { setEscolhido(null); setAtual(null); setAbrindo(null); setMotivo(''); setDesfecho(null); draftRevision.current++; }
  useEffect(limpar, [token, pessoaId, agente.slug]);
  useEffect(() => { if (op.privada || !podeComandar) { setEscolhido(null); setAtual(null); setAbrindo(null); setMotivo(''); setDesfecho(null); draftRevision.current++; } }, [op.privada, podeComandar]);
  async function lerAtual(c: number) {
    const raw = await apiGet<unknown>(`/agents/${encodeURIComponent(agente.slug)}/estado-humano`, token);
    if (!op.vigente(c)) return null;
    const r = dadoDaAgenda(AgentEstadoHumanoPainelSchema.safeParse(raw)); op.adotarEscopo(r.escopo); setAtual(r); return r;
  }
  useEffect(() => {
    if (!token || !podeComandar) return;
    void op.agir(async c => { const r = await lerAtual(c); if (r && op.vigente(c)) setEscolhido(r); });
    // GET declarativo inicial; nenhum comando é enviado ao montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, pessoaId, agente.slug, podeComandar]);
  const botoes = escolhido?.autoridade.comandar && !op.privada ? botoesDeEstado(escolhido.transicoes) : [];
  async function mandar(b: BotaoDeEstado, texto: string) {
    const base = escolhido, revision = draftRevision.current;
    if (!podeComandar || !base || !base.autoridade.comandar || op.privada || op.storageBloqueado || op.pendente('agente_estado', null)) return;
    await op.agir(async c => {
      const recente = await lerAtual(c); if (!recente || !op.vigente(c) || draftRevision.current !== revision) return;
      if (!recente.autoridade.comandar || !recente.transicoes.includes(b.destino) || recente.marca !== base.marca || !mesmoValorDaAgenda(recente.base, base.base)) throw new EscolhaDaAgendaAlterada('O estado do agente mudou. Seu motivo foi mantido; confira a decisão atual antes deste comando.');
      const entrada = entradaDaAgenda(AgentEstadoHumanoSchema.safeParse({ requestId: crypto.randomUUID(), marcaEsperada: base.marca, motivo: texto.trim() || null }));
      await op.enviar({ pista: { ...base.escopo, tipo: 'agente_estado', agendaId: null, requestId: entrada.requestId }, caminho: `/agents/${encodeURIComponent(agente.slug)}/${b.rota}`, metodo: 'POST', expectativa: { tipo: 'agente_estado', entrada, anterior: base, destino: b.destino } }, c);
      if (op.vigente(c)) { setAbrindo(null); aoMudar(); }
    });
  }
  async function reenviar(p: PistaDaOperacaoLocal) {
    const causa = op.causa(p.requestId); if (!causa || causa.expectativa.tipo !== 'agente_estado' || !podeComandar || op.privada) return;
    const expectativa = causa.expectativa;
    await op.agir(async c => {
      const r = await lerAtual(c); if (!r || !op.vigente(c)) return;
      if (!r.autoridade.comandar || !r.transicoes.includes(expectativa.destino) || r.marca !== expectativa.entrada.marcaEsperada || !mesmoValorDaAgenda(r.base, expectativa.anterior.base)) throw new EscolhaDaAgendaAlterada('A decisão original mudou. Confira o pedido original; a consulta não autorizou um reenvio.');
      await op.enviar(causa, c); if (op.vigente(c)) aoMudar();
    });
  }
  async function invocar() {
    if (!podeInvocar || op.privada) return;
    await op.agir(async c => {
      setDesfecho(null);
      const r = await apiPost<{ status: string; motivo?: string | null; resposta?: string }>(`/agents/${encodeURIComponent(agente.slug)}/invocar`, {}, token);
      if (!op.vigente(c)) return;
      if (!r || typeof r.status !== 'string' || r.motivo != null && typeof r.motivo !== 'string' || r.resposta != null && typeof r.resposta !== 'string') throw new ConferenciaDaAgendaInvalida();
      setDesfecho({ status: r.status, texto: r.motivo ?? r.resposta ?? null }); aoMudar();
    });
  }
  return <div className="mt-3 space-y-2 border-t border-border pt-3">
    {!op.privada && <><div className="flex flex-wrap items-center gap-2"><SelosDoAgente agente={agente} />{agente.estadoEm && <span className="font-os-mono text-[9.5px] text-dim">desde {new Date(agente.estadoEm).toLocaleString('pt-BR')}{agente.estadoPor ? ` · por ${agente.estadoPor}` : ''}</span>}</div>{agente.estadoMotivo && <p className="text-sm text-muted">Motivo registrado: {agente.estadoMotivo}</p>}</>}
    {op.erro && <p role="alert" className="text-sm text-bad">{op.erro}</p>}
    {podeComandar && <button type="button" disabled={op.ocupado} className="text-sm text-brand disabled:opacity-50" onClick={() => void op.agir(async c => { setAtual(null); await lerAtual(c); })}>Conferir decisão e acesso atuais</button>}
    {!op.privada && escolhido && <p className="text-sm text-muted">Decisão escolhida: {escolhido.base.estado} · conferida em {new Date(escolhido.autoridade.verificadaEm).toLocaleString('pt-BR')}.</p>}
    {!op.privada && atual && (!escolhido || atual.marca !== escolhido.marca) && <div className="space-y-2"><p className="text-sm">Decisão atual: {atual.base.estado}. O motivo escrito foi mantido.</p><button type="button" className="text-sm text-brand disabled:opacity-50" disabled={op.ocupado || op.pendente('agente_estado', null)} onClick={() => { if (op.ocupado || op.pendente('agente_estado', null)) return; draftRevision.current++; setEscolhido(atual); setAbrindo(null); }}>Usar decisão atual para o próximo comando</button></div>}
    {!op.privada && desfecho && <p className="text-sm text-muted">Passagem geral: <span className="text-text">{desfecho.status}</span>{desfecho.texto ? ` — ${desfecho.texto}` : ''}</p>}
    {!op.privada && abrindo ? <div className="space-y-2 rounded-root border border-bad/40 bg-bad/5 p-2"><p className="text-sm text-muted">{abrindo.explica}</p><label className="block text-sm" htmlFor={`motivo-${agente.slug}`}>Motivo obrigatório</label><input id={`motivo-${agente.slug}`} autoFocus value={motivo} disabled={op.ocupado} onChange={e => { draftRevision.current++; setMotivo(e.target.value); }} maxLength={500} className="w-full rounded border border-border bg-bg px-2 py-1 text-sm" /><div className="flex gap-2"><button type="button" disabled={!motivo.trim() || op.ocupado || op.storageBloqueado || op.pendente('agente_estado', null)} onClick={() => void mandar(abrindo, motivo)} className="rounded-root bg-bad px-2 py-1 text-sm text-ink disabled:opacity-50">Confirmar encerramento</button><button type="button" disabled={op.ocupado} onClick={() => setAbrindo(null)} className="text-sm text-muted">Voltar sem enviar</button></div></div> : !op.privada && <div className="flex flex-wrap items-center gap-2">{podeComandar && botoes.map(b => <button key={b.rota} type="button" title={b.explica} disabled={op.ocupado || op.storageBloqueado || op.pendente('agente_estado', null)} onClick={() => b.pedeMotivo ? setAbrindo(b) : void mandar(b, '')} className={`rounded-root border px-2 py-1 text-sm disabled:opacity-50 ${b.tom === 'erro' ? 'border-bad/50 text-bad' : b.tom === 'atencao' ? 'border-warn/50 text-warn' : 'border-good/50 text-good'}`}>{b.rotulo}</button>)}{podeInvocar && agente.estado === 'ativo' && <button type="button" title={AVISO_DA_INVOCACAO} disabled={op.ocupado} onClick={() => void invocar()} className="rounded-root bg-brand px-2 py-1 text-sm text-ink disabled:opacity-50">Invocar</button>}</div>}
    {!op.privada && !abrindo && podeComandar && botoes.length > 0 && <ul className="space-y-1 text-xs text-muted">{botoes.map(b => <li key={b.rota}>{b.rotulo}: {b.explica}</li>)}</ul>}
    {!op.privada && !abrindo && podeInvocar && agente.estado === 'ativo' && <p className="text-xs text-muted">{AVISO_DA_INVOCACAO}</p>}
    {!op.privada && agente.estado === 'encerrado' && <p className="text-xs text-muted">Encerrado não volta. O histórico permanece em Sessões e no Rastro.</p>}
    <PedidosLocaisDaAgenda operacoes={op} filtro={p => p.tipo === 'agente_estado'} reenviar={p => void reenviar(p)} />
  </div>;
}
