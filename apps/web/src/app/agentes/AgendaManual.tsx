'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AgentEstadoHumanoEscopoSchema, AgentEstadoHumanoPainelSchema,
  AgendaLocalConfiguracaoSchema, AgendaLocalCriarSchema, AgendaLocalEditarSchema,
  AgendaLocalEstadoSchema, AgendaLocalDispararSchema, AgendaLocalListaSchema, AgendaLocalListaConsultaSchema,
  AgendaLocalPainelSchema, AgendaLocalRecuperacaoSchema, AgendaLocalRecuperacaoConsultaSchema,
  ProcedimentoLocalFontesSchema,
  type AgentEstadoHumanoEscopo, type AgentEstadoHumanoPainel, type AgentEstadoHumano,
  type AgendaLocalCriar, type AgendaLocalEditar, type AgendaLocalEstado, type AgendaLocalDisparar,
  type AgendaLocalConfiguracao, type AgendaLocalRevisao, type AgendaLocalPainel,
  type AgendaLocalLista, type AgendaLocalRecuperacao, type AgendaLocalRecuperacaoConsulta,
  type ProcedimentoLocalFontes, type ProcedimentoLocalPainel, type ProcedimentoLocalExecucao,
} from '@mktos/shared';
import { apiGet, apiPost, apiPut, ErroDaApi } from '@/lib/api';
import { RetratoDaFonte, retratoConfere } from '@/app/contexto/RetratoDaFonte';

export type EscopoDaAgenda = AgentEstadoHumanoEscopo;
export type TipoDeOperacaoLocal = AgendaLocalRecuperacaoConsulta['tipoEsperado'];
export type PistaDaOperacaoLocal = EscopoDaAgenda & {
  tipo: TipoDeOperacaoLocal; agendaId: string | null; requestId: string;
};
export type ResultadoDaOperacaoLocal = Extract<AgendaLocalRecuperacao, { estado: 'confirmado' }>;
export type ExpectativaDaOperacaoLocal =
  | { tipo: 'agenda_criar'; entrada: AgendaLocalCriar; fonte: EscolhaDaFonte; procedimento: NonNullable<ProcedimentoLocalPainel['procedimento']> }
  | { tipo: 'agenda_editar'; entrada: AgendaLocalEditar; anterior: AgendaLocalRevisao; fonte: EscolhaDaFonte; procedimento: NonNullable<ProcedimentoLocalPainel['procedimento']> }
  | { tipo: 'agenda_estado'; entrada: AgendaLocalEstado; anterior: AgendaLocalRevisao }
  | { tipo: 'agenda_disparar'; entrada: AgendaLocalDisparar; anterior: AgendaLocalRevisao }
  | { tipo: 'agente_estado'; entrada: AgentEstadoHumano; anterior: AgentEstadoHumanoPainel; destino: AgentEstadoHumanoPainel['base']['estado'] };
type CausaEmMemoria = { pista: PistaDaOperacaoLocal; caminho: string; metodo: 'POST' | 'PUT'; expectativa: ExpectativaDaOperacaoLocal };
type Conferencia = { resposta: AgendaLocalRecuperacao; divergente: boolean };
const prefixo = 'rootos:agenda-manual:';
const campo = 'mt-1 w-full rounded border border-border bg-bg px-2 py-2 text-sm';
const botao = 'rounded border border-border px-3 py-2 text-sm text-brand disabled:opacity-50';
export class ConferenciaDaAgendaInvalida extends Error {}
export class EscolhaDaAgendaAlterada extends Error {}
class ArmazenamentoDaAgendaIndisponivel extends Error {}
export function dadoDaAgenda<T>(r: { success: true; data: T } | { success: false }): T {
  if (!r.success) throw new ConferenciaDaAgendaInvalida();
  return r.data;
}
export function entradaDaAgenda<T>(r: { success: true; data: T } | { success: false }): T {
  if (!r.success) throw new EscolhaDaAgendaAlterada('Confira os campos e os limites do formulário. Seu texto foi mantido.');
  return r.data;
}
export function mesmoEscopoDaAgenda(a: EscopoDaAgenda, b: EscopoDaAgenda): boolean {
  return a.orgId === b.orgId && a.actorId === b.actorId && a.agentId === b.agentId && a.agentSlug === b.agentSlug;
}
export function mesmoValorDaAgenda(a: unknown, b: unknown): boolean {
  function canonico(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonico);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)]));
    return v;
  }
  return JSON.stringify(canonico(a)) === JSON.stringify(canonico(b));
}
export function conferirEscopoDoProcedimento(e: ProcedimentoLocalPainel['escopo'], s: EscopoDaAgenda) {
  if (e.orgId !== s.orgId || e.userId !== s.actorId || e.agentId !== s.agentId || e.agentSlug !== s.agentSlug) throw new ConferenciaDaAgendaInvalida();
}
function conferirRevisao(v: AgendaLocalRevisao, s: EscopoDaAgenda) {
  const c = v.configuracao;
  if (v.agendaId !== c.agendaId || c.orgId !== s.orgId || c.agentId !== s.agentId
    || c.pedido.itemId !== c.fonte.itemId || c.pedido.versionId !== c.fonte.versionId
    || c.pedido.contentHash !== c.fonte.contentHash || c.pedido.expectedItemVersion !== c.fonte.expectedItemVersion
    || c.fonte.versao > c.fonte.expectedItemVersion || c.pedido.expectedSopVersion !== c.procedimento.versao) throw new ConferenciaDaAgendaInvalida();
}
export function conferirPainelDaAgenda(p: AgendaLocalPainel, s: EscopoDaAgenda, agendaId?: string) {
  if (!mesmoEscopoDaAgenda(p.escopo, s) || p.agendaId !== p.revisao.agendaId || agendaId && p.agendaId !== agendaId) throw new ConferenciaDaAgendaInvalida();
  conferirEscopoDoProcedimento(p.painelLocal.escopo, s); conferirRevisao(p.revisao, s);
}
function conferirFontes(f: ProcedimentoLocalFontes, s: EscopoDaAgenda) {
  conferirEscopoDoProcedimento(f.escopo, s); conferirEscopoDoProcedimento(f.painel.escopo, s);
  const ids = new Set<string>();
  for (const i of f.items) {
    if (ids.has(i.id)) throw new ConferenciaDaAgendaInvalida(); ids.add(i.id);
    const versoes = new Set<string>();
    for (const v of i.versoes) {
      if (versoes.has(v.id) || v.versao > i.versao || v.retratoFonte.versaoAtual !== i.versao || !retratoConfere(v.retratoFonte, { itemId: i.id, versionId: v.id, versao: v.versao, contentHash: v.contentHash, chave: i.chave, title: v.title, body: null })
        || v.retratoFonte.origem.tipo !== v.sourceType || v.retratoFonte.origem.referencia !== v.sourceRef) throw new ConferenciaDaAgendaInvalida();
      versoes.add(v.id);
    }
  }
}
function conferirExecucaoDaAgenda(e: ProcedimentoLocalExecucao, p: PistaDaOperacaoLocal) {
  conferirEscopoDoProcedimento(e.escopo, p); conferirEscopoDoProcedimento(e.painelAtual.escopo, p);
  const i = e.entradaConfirmada.input;
  if (e.requestId !== p.requestId || i.requestId !== p.requestId || e.pessoaId !== p.actorId || e.pedido !== i.pedido
    || e.entradaConfirmada.contrato !== 2 || (e.entradaConfirmada.contrato === 2 && e.procedimento.versao !== e.entradaConfirmada.input.expectedSopVersion)
    || e.fonte.itemId !== i.itemId || e.fonte.versionId !== i.versionId || e.fonte.contentHash !== i.contentHash || e.fonte.versao > i.expectedItemVersion
    || !retratoConfere(e.retratoFonte, e.fonte) || e.retratoFonte.origem.tipo !== e.fonte.sourceType || e.retratoFonte.origem.referencia !== e.fonte.sourceRef) throw new ConferenciaDaAgendaInvalida();
}
function conferirResultadoDaAgenda(r: AgendaLocalRecuperacao, p: PistaDaOperacaoLocal) {
  if (!mesmoEscopoDaAgenda(r.escopo, p) || r.requestId !== p.requestId) throw new ConferenciaDaAgendaInvalida();
  if (r.estado === 'ausencia_conferida') return;
  const c = r.recibo;
  if (r.tipo !== p.tipo || c.tipo !== p.tipo || c.requestId !== p.requestId || !mesmoEscopoDaAgenda(c.escopo, p)
    || new Set(c.auditIds).size !== c.auditIds.length || new Set(c.eventSnapshot.map(e => e.id)).size !== c.eventSnapshot.length) throw new ConferenciaDaAgendaInvalida();
  if ('revisao' in c) {
    conferirRevisao(c.revisao, p);
    if (p.agendaId !== null && c.revisao.agendaId !== p.agendaId) throw new ConferenciaDaAgendaInvalida();
  }
  if (r.tipo === 'agenda_disparar' && c.tipo === 'agenda_disparar') {
    conferirExecucaoDaAgenda(r.execucao, p);
    if (c.agendaId !== p.agendaId || c.sessionId !== r.execucao.id || !mesmoValorDaAgenda(c.entradaConfirmada, r.execucao.entradaConfirmada.input)) throw new ConferenciaDaAgendaInvalida();
  }
}
function correspondeAEscolha(r: ResultadoDaOperacaoLocal, e?: ExpectativaDaOperacaoLocal): boolean {
  if (!e) return true;
  const c = r.recibo;
  if (c.tipo !== e.tipo) return false;
  if (e.tipo === 'agente_estado' && c.tipo === 'agente_estado') return c.marcaAnterior === e.entrada.marcaEsperada && mesmoValorDaAgenda(c.anterior, { escopo: e.anterior.escopo, base: e.anterior.base, marca: e.anterior.marca }) && c.posterior.base.estado === e.destino;
  if (e.tipo === 'agenda_disparar' && c.tipo === 'agenda_disparar' && r.tipo === 'agenda_disparar') {
    const v = e.anterior, cfg = v.configuracao;
    return c.agendaId === v.agendaId && c.revisionId === v.revisionId && c.agendaVersion === e.entrada.expectedAgendaVersion && c.agendaVersion === v.numero && c.snapshotHash === v.snapshotHash
      && mesmoValorDaAgenda(c.entradaConfirmada, { requestId: e.entrada.requestId, ...cfg.pedido })
      && cfg.pedido.expectedSopVersion === e.entrada.expectedSopVersion && r.execucao.modeloConfigurado === cfg.modeloConfigurado
      && mesmoValorDaAgenda(r.execucao.fonte, { itemId: cfg.fonte.itemId, versionId: cfg.fonte.versionId, contentHash: cfg.fonte.contentHash, versao: cfg.fonte.versao, chave: cfg.fonte.chave, sourceType: cfg.fonte.sourceType, sourceRef: cfg.fonte.sourceRef, title: cfg.fonte.title });
  }
  if ('revisao' in c && (e.tipo === 'agenda_criar' || e.tipo === 'agenda_editar' || e.tipo === 'agenda_estado')) {
    const v = c.revisao, cfg = v.configuracao;
    if (e.tipo === 'agenda_criar' || e.tipo === 'agenda_editar') {
      const i = e.entrada.configuracao;
      if (!mesmoValorDaAgenda(cfg.fonte, e.fonte) || !mesmoValorDaAgenda(procedimentoDaRevisao(v), e.procedimento) || cfg.nome !== i.nome || cfg.previstoPara !== i.previstoPara || cfg.responsavelId !== i.responsavelId || cfg.modeloConfigurado !== i.modeloConfiguradoEsperado || !mesmoValorDaAgenda(cfg.pedido, i.pedido) || v.estado !== 'pausada') return false;
    }
    if (e.tipo === 'agenda_criar') return c.anterior === null && v.numero === 1;
    return !!c.anterior && c.anterior.revisionId === e.anterior.revisionId && c.anterior.numero === e.entrada.expectedAgendaVersion && c.anterior.estado === e.anterior.estado
      && v.agendaId === e.anterior.agendaId && v.numero === e.anterior.numero + 1 && v.revisionId !== e.anterior.revisionId
      && (e.tipo !== 'agenda_estado' || v.estado === e.entrada.estado && v.motivo === e.entrada.motivo && mesmoValorDaAgenda(cfg, e.anterior.configuracao));
  }
  return false;
}
function chaveDaPista(p: PistaDaOperacaoLocal) {
  return `${prefixo}${p.orgId}:${p.actorId}:${p.agentId}:${p.tipo}:${p.agendaId ?? 'sem-agenda'}:${p.requestId}`;
}
function lerPista(raw: string): PistaDaOperacaoLocal {
  if (raw.length > 4096) throw new ArmazenamentoDaAgendaIndisponivel();
  const v: unknown = JSON.parse(raw);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ArmazenamentoDaAgendaIndisponivel();
  const o = v as Record<string, unknown>, campos = ['orgId', 'actorId', 'agentId', 'agentSlug', 'tipo', 'agendaId', 'requestId'];
  if (Object.keys(o).length !== campos.length || !Object.keys(o).every(k => campos.includes(k))) throw new ArmazenamentoDaAgendaIndisponivel();
  const s = dadoDaAgenda(AgentEstadoHumanoEscopoSchema.safeParse({ orgId: o.orgId, actorId: o.actorId, agentId: o.agentId, agentSlug: o.agentSlug }));
  const t = dadoDaAgenda(AgendaLocalRecuperacaoConsultaSchema.safeParse({ tipoEsperado: o.tipo }));
  const requestId = dadoDaAgenda(AgentEstadoHumanoEscopoSchema.shape.orgId.safeParse(o.requestId));
  const agendaId = o.agendaId === null ? null : dadoDaAgenda(AgentEstadoHumanoEscopoSchema.shape.orgId.safeParse(o.agendaId));
  if (t.tipoEsperado === 'agente_estado' && agendaId !== null || t.tipoEsperado !== 'agente_estado' && t.tipoEsperado !== 'agenda_criar' && agendaId === null) throw new ArmazenamentoDaAgendaIndisponivel();
  return { ...s, tipo: t.tipoEsperado, agendaId, requestId };
}
function lerPistas(s: EscopoDaAgenda): PistaDaOperacaoLocal[] {
  const encontradas: PistaDaOperacaoLocal[] = [], inicio = `${prefixo}${s.orgId}:${s.actorId}:${s.agentId}:`;
  try {
    for (let n = 0; n < localStorage.length; n++) {
      const chave = localStorage.key(n); if (!chave?.startsWith(inicio)) continue;
      const raw = localStorage.getItem(chave); if (raw === null) throw new ArmazenamentoDaAgendaIndisponivel();
      const p = lerPista(raw);
      if (!mesmoEscopoDaAgenda(p, s) || chaveDaPista(p) !== chave) throw new ArmazenamentoDaAgendaIndisponivel();
      encontradas.push(p);
    }
    return encontradas;
  } catch { throw new ArmazenamentoDaAgendaIndisponivel(); }
}
function guardarPista(p: PistaDaOperacaoLocal) {
  try {
    const chave = chaveDaPista(p), anterior = localStorage.getItem(chave);
    if (anterior !== null && !mesmoValorDaAgenda(lerPista(anterior), p)) throw new ArmazenamentoDaAgendaIndisponivel();
    localStorage.setItem(chave, JSON.stringify(p));
    const raw = localStorage.getItem(chave);
    if (raw === null || !mesmoValorDaAgenda(lerPista(raw), p)) throw new ArmazenamentoDaAgendaIndisponivel();
  } catch { throw new ArmazenamentoDaAgendaIndisponivel(); }
}
const terminal = (s: string) => ['respondida', 'falhou', 'recusada'].includes(s);

// Hook isolado por instância. Somente helpers puros são compartilhados; nenhum dado global.
export function useOperacoesLocaisDaAgenda({ token, pessoaId, slug }: { token: string | null; pessoaId: string; slug: string }) {
  const [escopo, setEscopo] = useState<EscopoDaAgenda | null>(null), [pistas, setPistas] = useState<PistaDaOperacaoLocal[]>([]);
  const [conferencias, setConferencias] = useState<Record<string, Conferencia>>({}), [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false), [storageBloqueado, setStorageBloqueado] = useState(false), [privada, setPrivada] = useState(false);
  const geracao = useRef(0), trava = useRef(false), escopoRef = useRef<EscopoDaAgenda | null>(null);
  const causas = useRef(new Map<string, CausaEmMemoria>()), atuais = useRef({ token, pessoaId, slug }), dona = useRef({ token, pessoaId, slug });
  atuais.current = { token, pessoaId, slug };
  const instanciaAtual = atuais.current.token === dona.current.token && atuais.current.pessoaId === dona.current.pessoaId && atuais.current.slug === dona.current.slug;
  const vigente = (c: number) => geracao.current === c && atuais.current.token === dona.current.token && atuais.current.pessoaId === dona.current.pessoaId && atuais.current.slug === dona.current.slug;
  function privar() { setPrivada(true); setConferencias({}); causas.current.clear(); setErro('Dados indisponíveis para esta conta. Confira o acesso antes de continuar.'); }
  function adotarEscopo(s: EscopoDaAgenda) {
    if (!instanciaAtual || s.actorId !== pessoaId || s.agentSlug !== slug || escopoRef.current && !mesmoEscopoDaAgenda(s, escopoRef.current)) throw new ConferenciaDaAgendaInvalida();
    escopoRef.current = s; setEscopo(s); setPrivada(false);
    try { setPistas(lerPistas(s)); setStorageBloqueado(false); }
    catch { setStorageBloqueado(true); setErro('Não foi possível conferir os pedidos guardados. Novos envios estão bloqueados; as pistas foram preservadas.'); }
  }
  function tratarErro(e: unknown) {
    if (e instanceof ConferenciaDaAgendaInvalida || e instanceof ErroDaApi && [401, 403, 404].includes(e.status)) { privar(); return; }
    if (e instanceof ArmazenamentoDaAgendaIndisponivel) { setStorageBloqueado(true); setErro('Não foi possível conferir o armazenamento. Nenhuma pista foi apagada. Novos envios estão bloqueados.'); return; }
    setErro(e instanceof EscolhaDaAgendaAlterada ? e.message : e instanceof ErroDaApi && e.status === 409
      ? 'A escolha ou o pedido mudou. Seu texto e o pedido original foram mantidos; confira antes de reenviar.'
      : 'Não foi possível conferir o resultado. Mantenha o pedido e consulte-o novamente.');
  }
  async function agir(acao: (c: number) => Promise<void>) {
    if (!token || !instanciaAtual || trava.current) return;
    trava.current = true; const c = ++geracao.current; setOcupado(true); setErro(null);
    try { await acao(c); } catch (e) { if (vigente(c)) tratarErro(e); }
    finally { if (vigente(c)) { trava.current = false; setOcupado(false); } }
  }
  async function lerResposta(p: PistaDaOperacaoLocal, c: number) {
    if (!escopoRef.current || !mesmoEscopoDaAgenda(p, escopoRef.current)) throw new ConferenciaDaAgendaInvalida();
    const q = dadoDaAgenda(AgendaLocalRecuperacaoConsultaSchema.safeParse({ tipoEsperado: p.tipo }));
    const raw = await apiGet<unknown>(`/agents/${encodeURIComponent(slug)}/operacoes-locais/${p.requestId}?tipoEsperado=${encodeURIComponent(q.tipoEsperado)}`, token);
    if (!vigente(c)) return null;
    const r = dadoDaAgenda(AgendaLocalRecuperacaoSchema.safeParse(raw)); conferirResultadoDaAgenda(r, p);
    setPrivada(false); const divergente = r.estado === 'confirmado' && !correspondeAEscolha(r, causas.current.get(p.requestId)?.expectativa);
    setConferencias(v => ({ ...v, [p.requestId]: { resposta: r, divergente } })); return r;
  }
  async function conferir(p: PistaDaOperacaoLocal) {
    await agir(async c => { setConferencias(v => { const n = { ...v }; delete n[p.requestId]; return n; }); await lerResposta(p, c); });
  }
  async function enviar(causa: CausaEmMemoria, c: number) {
    if (!escopoRef.current || !mesmoEscopoDaAgenda(causa.pista, escopoRef.current) || storageBloqueado) throw new ArmazenamentoDaAgendaIndisponivel();
    const pendencias = lerPistas(escopoRef.current);
    if (pendencias.some(p => p.tipo === causa.pista.tipo && p.agendaId === causa.pista.agendaId && p.requestId !== causa.pista.requestId)) throw new EscolhaDaAgendaAlterada('Há outro pedido desta ação a conferir. Não foi criado um envio para substituí-lo.');
    guardarPista(causa.pista); causas.current.set(causa.pista.requestId, causa); setPistas(lerPistas(escopoRef.current));
    setConferencias(v => { const n = { ...v }; delete n[causa.pista.requestId]; return n; });
    const raw = causa.metodo === 'PUT' ? await apiPut<unknown>(causa.caminho, causa.expectativa.entrada, token) : await apiPost<unknown>(causa.caminho, causa.expectativa.entrada, token);
    if (!vigente(c)) return;
    const r = dadoDaAgenda(AgendaLocalRecuperacaoSchema.safeParse(raw)); conferirResultadoDaAgenda(r, causa.pista);
    if (r.estado !== 'confirmado') throw new ConferenciaDaAgendaInvalida();
    setConferencias(v => ({ ...v, [causa.pista.requestId]: { resposta: r, divergente: !correspondeAEscolha(r, causa.expectativa) } }));
  }
  async function retirar(p: PistaDaOperacaoLocal) {
    const mostrada = conferencias[p.requestId]?.resposta;
    if (!mostrada || mostrada.estado !== 'confirmado' || storageBloqueado) return;
    await agir(async c => {
      const r = await lerResposta(p, c); if (!r || r.estado !== 'confirmado' || !vigente(c)) return;
      if (r.tipo === 'agenda_disparar' && !terminal(r.execucao.status)) throw new EscolhaDaAgendaAlterada('A execução ainda não tem um desfecho final conferido. A pista continua guardada.');
      if (!mesmoValorDaAgenda(mostrada.recibo, r.recibo) || mostrada.tipo === 'agenda_disparar' && r.tipo === 'agenda_disparar'
        && !mesmoValorDaAgenda({ status: mostrada.execucao.status, resposta: mostrada.execucao.resposta, motivo: mostrada.execucao.motivo, entrada: mostrada.execucao.entradaConfirmada }, { status: r.execucao.status, resposta: r.execucao.resposta, motivo: r.execucao.motivo, entrada: r.execucao.entradaConfirmada })) throw new EscolhaDaAgendaAlterada('O registro foi atualizado. Confira os dados apresentados antes de retirar a pista.');
      try {
        const chave = chaveDaPista(p), raw = localStorage.getItem(chave);
        if (raw === null || !mesmoValorDaAgenda(lerPista(raw), p)) throw new ArmazenamentoDaAgendaIndisponivel();
        localStorage.removeItem(chave); if (localStorage.getItem(chave) !== null) throw new ArmazenamentoDaAgendaIndisponivel();
      } catch { throw new ArmazenamentoDaAgendaIndisponivel(); }
      causas.current.delete(p.requestId); setPistas(lerPistas(p));
      setConferencias(v => { const n = { ...v }; delete n[p.requestId]; return n; });
    });
  }
  useEffect(() => {
    dona.current = { token, pessoaId, slug }; geracao.current++; trava.current = false; escopoRef.current = null; causas.current.clear();
    setEscopo(null); setPistas([]); setConferencias({}); setPrivada(false); setStorageBloqueado(false); setErro(null); setOcupado(false);
    return () => { geracao.current++; trava.current = false; causas.current.clear(); };
  }, [token, pessoaId, slug]);
  useEffect(() => {
    function atualizar(e: StorageEvent) {
      if (!e.key?.startsWith(prefixo) || !escopoRef.current) return;
      try { setPistas(lerPistas(escopoRef.current)); setStorageBloqueado(false); }
      catch { setStorageBloqueado(true); setErro('Os pedidos guardados não puderam ser conferidos. As pistas foram preservadas.'); }
    }
    window.addEventListener('storage', atualizar); return () => window.removeEventListener('storage', atualizar);
  }, []);
  return { escopo: instanciaAtual ? escopo : null, pistas: instanciaAtual ? pistas : [], conferencias: instanciaAtual && !privada ? conferencias : {},
    erro: instanciaAtual ? erro : null, ocupado, storageBloqueado, privada: privada || !instanciaAtual, vigente, adotarEscopo, agir, enviar, conferir, retirar,
    causa: (id: string) => causas.current.get(id), pendente: (tipo: TipoDeOperacaoLocal, agendaId: string | null) => pistas.some(p => p.tipo === tipo && p.agendaId === agendaId) };
}

export function PedidosLocaisDaAgenda({ operacoes, filtro, reenviar }: {
  operacoes: ReturnType<typeof useOperacoesLocaisDaAgenda>; filtro: (p: PistaDaOperacaoLocal) => boolean;
  reenviar: (p: PistaDaOperacaoLocal) => void;
}) {
  return <div className="space-y-3">{operacoes.pistas.filter(filtro).map(p => {
    const c = operacoes.conferencias[p.requestId], r = c?.resposta;
    const podeRetirar = r?.estado === 'confirmado' && (r.tipo !== 'agenda_disparar' || terminal(r.execucao.status));
    return <section key={p.requestId} className="space-y-2 rounded border border-border p-3 text-sm" aria-label="Pedido local guardado">
      <p>Pedido <span className="font-os-mono break-all">{p.requestId}</span>{p.agendaId && <> · agenda <span className="font-os-mono break-all">{p.agendaId}</span></>}.</p>
      <button type="button" className={botao} disabled={operacoes.ocupado} onClick={() => void operacoes.conferir(p)}>Conferir pedido original</button>
      {r?.estado === 'ausencia_conferida' && <p>Não foi encontrado registro nesta consulta. Um envio anterior ainda pode chegar; o identificador continua guardado.</p>}
      {operacoes.causa(p.requestId) && r?.estado !== 'confirmado' && <button type="button" className={botao} disabled={operacoes.ocupado || operacoes.storageBloqueado || operacoes.privada} onClick={() => reenviar(p)}>Confirmar e reenviar a entrada original</button>}
      {!operacoes.causa(p.requestId) && r?.estado !== 'confirmado' && <p className="text-muted">O corpo original não está nesta janela. A consulta não reconstrói nem reenvia o pedido.</p>}
      {r?.estado === 'confirmado' && <>
        {c?.divergente && <p role="alert" className="text-warn">Este registro usa outra proposta. Confira as condições reais abaixo; ele não confirma o rascunho atual.</p>}
        <ReciboLocalDaAgenda resultado={r} />
        {podeRetirar ? <button type="button" className={botao} disabled={operacoes.ocupado || operacoes.storageBloqueado} onClick={() => void operacoes.retirar(p)}>Conferi este registro; retirar pista local</button> : <p>A execução ainda está em andamento ou sem desfecho final conferido. Consulte este mesmo pedido.</p>}
      </>}
    </section>;
  })}</div>;
}
function ReciboLocalDaAgenda({ resultado: r }: { resultado: ResultadoDaOperacaoLocal }) {
  const c = r.recibo;
  return <div className="space-y-2">
    <p>Registro do pedido original, confirmado em {new Date(c.confirmadoEm).toLocaleString('pt-BR')}. O rascunho desta janela permanece separado.</p>
    {'revisao' in c && <><p>{c.revisao.configuracao.nome} · versão {c.revisao.numero} · {c.revisao.estado}.</p><ConfiguracaoRegistrada revisao={c.revisao} /></>}
    {c.tipo === 'agente_estado' && <><p>Estado registrado: {c.anterior.base.estado} → {c.posterior.base.estado}.</p>{c.posterior.base.estadoMotivo && <p>Motivo: {c.posterior.base.estadoMotivo}</p>}
      <p>Tarefas liberadas neste pedido: {c.tarefasSoltas.length}.</p><ul>{c.tarefasSoltas.map(t => <li key={t.id}>{t.titulo} · <span className="font-os-mono break-all">{t.id}</span>{t.desde && ` · desde ${new Date(t.desde).toLocaleString('pt-BR')}`}</li>)}</ul></>}
    {r.tipo === 'agenda_disparar' && c.tipo === 'agenda_disparar' && <><p>Compromisso inicial: {c.estadoNoCompromisso}. Situação conferida: {r.execucao.status}.</p><p>Sessão: <span className="font-os-mono break-all">{c.sessionId}</span> · disparo: <span className="font-os-mono break-all">{c.dispatchId}</span>.</p>
      <p>Agenda versão {c.agendaVersion} · procedimento consumido v{r.execucao.procedimento.versao} · atual {r.execucao.procedimentoAtual ? `v${r.execucao.procedimentoAtual.versao}` : 'não definido'}.</p>
      <p className="whitespace-pre-wrap">Entrada registrada: {r.execucao.entradaConfirmada.input.pedido}</p>{r.execucao.motivo && <p>{r.execucao.motivo}</p>}{r.execucao.resposta && <p className="whitespace-pre-wrap">{r.execucao.resposta}</p>}
      <RetratoDaFonte fonte={r.execucao.retratoFonte} usada /><Link className="text-brand" href={`/contexto?nota=${encodeURIComponent(r.execucao.fonte.itemId)}&versao=${encodeURIComponent(r.execucao.fonte.versionId)}`}>Abrir fonte consumida · v{r.execucao.fonte.versao}</Link>
      <p>Modelo configurado: {r.execucao.modeloConfigurado ?? 'não definido'} · usado: {r.execucao.modeloUsado ?? 'nenhuma chamada concluída'}.</p></>}
    <p className="text-muted">Estado atual observado: agente {r.disponibilidadeAtual.agente.estado}{r.disponibilidadeAtual.agenda && ` · agenda ${r.disponibilidadeAtual.agenda.estado}, versão ${r.disponibilidadeAtual.agenda.numero}`}. Essa observação não altera a configuração consumida.</p>
    <details><summary className="cursor-pointer text-brand">Conferir registros do rastro</summary><ul>{c.auditIds.map(id => <li className="break-all" key={id}>Auditoria: {id}</li>)}{c.eventSnapshot.map(e => <li className="break-all" key={e.id}>{e.tipo} · {e.id} · sequência {e.seq} · {e.hash}</li>)}</ul></details>
  </div>;
}
function ConfiguracaoRegistrada({ revisao: v }: { revisao: AgendaLocalRevisao }) {
  const c = v.configuracao;
  return <div className="space-y-1 text-sm"><p>Planejado para: {c.previstoPara ? new Date(c.previstoPara).toLocaleString('pt-BR') : 'sem data'} · responsável: <span className="font-os-mono break-all">{c.responsavelId}</span>.</p>
    <p>Fonte: {c.fonte.title} · v{c.fonte.versao} · procedimento v{c.procedimento.versao}.</p><p>Modelo escolhido: {c.modeloConfigurado ?? 'não definido'}.</p><p className="whitespace-pre-wrap">Pedido: {c.pedido.pedido}</p>
    <details><summary className="cursor-pointer text-brand">Procedimento consumido</summary><p>{c.procedimento.proposito}</p><ol className="list-inside list-decimal">{c.procedimento.passos.map((p, i) => <li className="whitespace-pre-wrap" key={i}>{p}</li>)}</ol><p>{c.procedimento.definicaoDePronto}</p></details>
    <Link className="text-brand" href={`/contexto?nota=${encodeURIComponent(c.fonte.itemId)}&versao=${encodeURIComponent(c.fonte.versionId)}`}>Abrir versão da fonte</Link></div>;
}

type Props = { slug: string; token: string | null; pessoaId: string; podeLer: boolean; podeConfigurar: boolean; podeExecutar: boolean; aoMudar: () => void };
type EscolhaDaFonte = AgendaLocalRevisao['configuracao']['fonte'];
function procedimentoDaRevisao(v: AgendaLocalRevisao): NonNullable<ProcedimentoLocalPainel['procedimento']> {
  const p = v.configuracao.procedimento;
  return { versao: p.versao, proposito: p.proposito, passos: p.passos, definicaoDePronto: p.definicaoDePronto };
}
type Draft = { nome: string; previstoPara: string; responsavelId: string; pedido: string; itemId: string; versionId: string };
const vazio: Draft = { nome: '', previstoPara: '', responsavelId: '', pedido: '', itemId: '', versionId: '' };
export function AgendaManual({ slug, token, pessoaId, podeLer, podeConfigurar, podeExecutar, aoMudar }: Props) {
  const op = useOperacoesLocaisDaAgenda({ slug, token, pessoaId });
  const [aberta, setAberta] = useState(false), [lista, setLista] = useState<AgendaLocalLista | null>(null);
  const [selecionada, setSelecionada] = useState<AgendaLocalPainel | null>(null), [atual, setAtual] = useState<AgendaLocalPainel | null>(null);
  const [configuracao, setConfiguracao] = useState<AgendaLocalConfiguracao | null>(null), [fontes, setFontes] = useState<ProcedimentoLocalFontes | null>(null);
  const [painel, setPainel] = useState<ProcedimentoLocalPainel | null>(null), [estadoHumano, setEstadoHumano] = useState<AgentEstadoHumanoPainel | null>(null);
  const [draft, setDraft] = useState<Draft>(vazio), [procedimentoEscolhido, setProcedimentoEscolhido] = useState<ProcedimentoLocalPainel['procedimento']>(null);
  const [modeloEscolhido, setModeloEscolhido] = useState<string | null>(null), [criando, setCriando] = useState(false), [motivo, setMotivo] = useState('');
  const [escolhaFonte, setEscolhaFonte] = useState<EscolhaDaFonte | null>(null);
  const draftRevision = useRef(0);
  function limparProtegido() { setLista(null); setSelecionada(null); setAtual(null); setConfiguracao(null); setFontes(null); setPainel(null); setEstadoHumano(null); setDraft(vazio); setProcedimentoEscolhido(null); setModeloEscolhido(null); setEscolhaFonte(null); setCriando(false); setMotivo(''); draftRevision.current++; }
  useEffect(limparProtegido, [token, pessoaId, slug]);
  useEffect(() => { if (op.privada) limparProtegido(); }, [op.privada]);
  function mudar(c: Partial<Draft>) { draftRevision.current++; setDraft(d => ({ ...d, ...c })); }
  async function lerLista(c: number, cursorId?: string) {
    const consulta = dadoDaAgenda(AgendaLocalListaConsultaSchema.safeParse(cursorId ? { cursorId } : {}));
    const sufixo = consulta.cursorId ? `?cursorId=${encodeURIComponent(consulta.cursorId)}` : '';
    const raw = await apiGet<unknown>(`/agents/${encodeURIComponent(slug)}/agendas-locais${sufixo}`, token); if (!op.vigente(c)) return null;
    const r = dadoDaAgenda(AgendaLocalListaSchema.safeParse(raw)); op.adotarEscopo(r.escopo);
    const ids = new Set<string>(); for (const i of r.items) { conferirPainelDaAgenda(i, r.escopo); if (ids.has(i.agendaId) || i.agendaId === cursorId) throw new ConferenciaDaAgendaInvalida(); ids.add(i.agendaId); }
    if (r.proximoId && (r.items.length === 0 || r.proximoId !== r.items[r.items.length - 1].agendaId || r.proximoId === cursorId)) throw new ConferenciaDaAgendaInvalida();
    setLista(r); return r;
  }
  async function lerAtual(agendaId: string, c: number) {
    const raw = await apiGet<unknown>(`/agents/${encodeURIComponent(slug)}/agendas-locais/${agendaId}`, token); if (!op.vigente(c)) return null;
    const r = dadoDaAgenda(AgendaLocalPainelSchema.safeParse(raw)); op.adotarEscopo(r.escopo); conferirPainelDaAgenda(r, r.escopo, agendaId); setAtual(r); return r;
  }
  async function lerFontes(c: number, escopo: EscopoDaAgenda) {
    const raw = await apiGet<unknown>(`/agents/${encodeURIComponent(slug)}/procedimento/fontes`, token); if (!op.vigente(c)) return null;
    const f = dadoDaAgenda(ProcedimentoLocalFontesSchema.safeParse(raw)); conferirFontes(f, escopo);
    setFontes(f); setPainel(f.painel); return f;
  }
  async function lerEscolhas(c: number) {
    const confRaw = await apiGet<unknown>(`/agents/${encodeURIComponent(slug)}/agendas-locais/configuracao`, token); if (!op.vigente(c)) return null;
    const conf = dadoDaAgenda(AgendaLocalConfiguracaoSchema.safeParse(confRaw)); op.adotarEscopo(conf.escopo);
    const estadoRaw = await apiGet<unknown>(`/agents/${encodeURIComponent(slug)}/estado-humano`, token); if (!op.vigente(c)) return null;
    const estado = dadoDaAgenda(AgentEstadoHumanoPainelSchema.safeParse(estadoRaw)); if (!mesmoEscopoDaAgenda(estado.escopo, conf.escopo)) throw new ConferenciaDaAgendaInvalida();
    const f = await lerFontes(c, conf.escopo); if (!f || !op.vigente(c)) return null;
    setConfiguracao(conf); setEstadoHumano(estado); return { conf, estado, fontes: f, painel: f.painel };
  }
  async function abrir() {
    if (aberta) { setAberta(false); return; }
    setAberta(true); if (podeLer) await op.agir(async c => { await lerLista(c); });
  }
  async function escolher(id: string) {
    if (op.ocupado || !op.escopo) return;
    if ((draft.nome || draft.pedido) && !window.confirm('Trocar de agenda descarta o rascunho desta janela. Os pedidos guardados continuam recuperáveis. Continuar?')) return;
    const revision = ++draftRevision.current;
    await op.agir(async c => { const p = await lerAtual(id, c); if (!p || !op.vigente(c) || draftRevision.current !== revision) return; setSelecionada(p); setCriando(false); setConfiguracao(null); setFontes(null); setPainel(p.painelLocal); setProcedimentoEscolhido(procedimentoDaRevisao(p.revisao)); setEscolhaFonte(p.revisao.configuracao.fonte); setModeloEscolhido(p.revisao.configuracao.modeloConfigurado); setMotivo('');
      const i = p.revisao.configuracao; setDraft({ nome: i.nome, previstoPara: i.previstoPara ?? '', responsavelId: i.responsavelId, pedido: i.pedido.pedido, itemId: i.fonte.itemId, versionId: i.fonte.versionId }); });
  }
  async function nova() {
    if (!podeConfigurar || op.ocupado || op.pendente('agenda_criar', null)) return;
    if ((draft.nome || draft.pedido) && !window.confirm('Criar outra configuração descarta o rascunho desta janela. Continuar?')) return;
    const revision = ++draftRevision.current;
    await op.agir(async c => { const e = await lerEscolhas(c); if (!e || !op.vigente(c) || draftRevision.current !== revision) return; setSelecionada(null); setAtual(null); setCriando(true); setEscolhaFonte(null); setDraft(vazio); setProcedimentoEscolhido(e.painel.procedimento); setModeloEscolhido(e.painel.modelo.configurado); setMotivo(''); });
  }
  function adotarAtual(descartar: boolean) {
    if (!atual || op.ocupado || op.pistas.some(p => p.agendaId === atual.agendaId)) return;
    setSelecionada(atual); draftRevision.current++; setCriando(false);
    if (descartar) { const c = atual.revisao.configuracao; setDraft({ nome: c.nome, previstoPara: c.previstoPara ?? '', responsavelId: c.responsavelId, pedido: c.pedido.pedido, itemId: c.fonte.itemId, versionId: c.fonte.versionId }); setModeloEscolhido(c.modeloConfigurado); setEscolhaFonte(c.fonte); setProcedimentoEscolhido(procedimentoDaRevisao(atual.revisao)); }
  }
  function fonteObservada() { const i = fontes?.items.find(i => i.id === draft.itemId); return { item: i, versao: i?.versoes.find(v => v.id === draft.versionId) }; }
  function escolherVersao(versionId: string) {
    const i = fontes?.items.find(i => i.id === draft.itemId), v = i?.versoes.find(v => v.id === versionId);
    mudar({ versionId });
    setEscolhaFonte(i && v ? { itemId: i.id, versionId: v.id, versao: v.versao, contentHash: v.contentHash, expectedItemVersion: i.versao, chave: i.chave, sourceType: v.sourceType, sourceRef: v.sourceRef, title: v.title } : null);
  }
  function conferirFonte(f: ProcedimentoLocalFontes, pedido: AgendaLocalCriar['configuracao']['pedido'], escolhida?: EscolhaDaFonte) {
    const i = f.items.find(i => i.id === pedido.itemId), v = i?.versoes.find(v => v.id === pedido.versionId);
    if (!i || !v || i.versao !== pedido.expectedItemVersion || v.contentHash !== pedido.contentHash || !v.retratoFonte.acesso.novoUsoPermitido
      || escolhida && !mesmoValorDaAgenda({ itemId: i.id, versionId: v.id, versao: v.versao, contentHash: v.contentHash, expectedItemVersion: i.versao, chave: i.chave, sourceType: v.sourceType, sourceRef: v.sourceRef, title: v.title }, escolhida)) throw new EscolhaDaAgendaAlterada('A fonte ou seu acesso mudou. A escolha e seu texto foram mantidos; confira antes de continuar.');
  }
  function conferirEscolha(e: Awaited<ReturnType<typeof lerEscolhas>>, input: AgendaLocalCriar['configuracao'], fonte?: EscolhaDaFonte) {
    if (!e || !e.estado.autoridade.comandar || e.estado.base.donoId !== input.responsavelId || !e.conf.pessoas.some(p => p.id === input.responsavelId)) throw new EscolhaDaAgendaAlterada('O responsável precisa ser uma pessoa ativa e o dono atual deste agente.');
    conferirFonte(e.fontes, input.pedido, fonte);
    if (!e.painel.procedimento || e.painel.procedimento.versao !== input.pedido.expectedSopVersion || e.painel.modelo.configurado !== input.modeloConfiguradoEsperado) throw new EscolhaDaAgendaAlterada('O procedimento ou o modelo mudou. Seu rascunho foi mantido; confira as escolhas antes de salvar.');
  }
  function conferirDisparo(a: AgendaLocalPainel, f: ProcedimentoLocalFontes, revisao: AgendaLocalRevisao) {
    const cfg = revisao.configuracao;
    conferirFonte(f, cfg.pedido, cfg.fonte);
    if (a.revisao.estado !== 'habilitada_manual' || !a.painelLocal.autoridade.iniciar || !a.painelLocal.inicioLocal.permitido
      || !f.painel.autoridade.iniciar || !f.painel.inicioLocal.permitido || !f.painel.agente.responsavelDisponivel
      || !mesmoValorDaAgenda(f.painel.procedimento, procedimentoDaRevisao(revisao)) || f.painel.modelo.configurado !== cfg.modeloConfigurado
      || a.disponibilidadeAtual.agente.donoId !== cfg.responsavelId || a.ultimoDisparo && !terminal(a.ultimoDisparo.status)) throw new EscolhaDaAgendaAlterada('O disparo não está permitido nesta consulta. Confira a fonte, o responsável, o procedimento e o pedido anterior.');
  }
  async function salvar() {
    const fonte = escolhaFonte, selecionadaAntes = selecionada, s = op.escopo;
    if (!podeConfigurar || !s || op.pendente(selecionadaAntes ? 'agenda_editar' : 'agenda_criar', selecionadaAntes?.agendaId ?? null) || !procedimentoEscolhido || !fonte || fonte.itemId !== draft.itemId || fonte.versionId !== draft.versionId || !estadoHumano || !fontes || op.storageBloqueado || op.privada) return;
    const rascunho = draft, revision = draftRevision.current, sop = procedimentoEscolhido, modelo = modeloEscolhido;
    await op.agir(async c => {
      const input = { nome: rascunho.nome, previstoPara: rascunho.previstoPara.trim() || null, responsavelId: rascunho.responsavelId, modeloConfiguradoEsperado: modelo,
        pedido: { pedido: rascunho.pedido, itemId: fonte.itemId, versionId: fonte.versionId, contentHash: fonte.contentHash, expectedItemVersion: fonte.expectedItemVersion, expectedSopVersion: sop.versao } };
      const e = await lerEscolhas(c); if (!op.vigente(c) || draftRevision.current !== revision) return; conferirEscolha(e, input, fonte);
      if (selecionadaAntes) { const recente = await lerAtual(selecionadaAntes.agendaId, c); if (!recente || !op.vigente(c) || draftRevision.current !== revision) return; if (recente.revisao.revisionId !== selecionadaAntes.revisao.revisionId || recente.revisao.numero !== selecionadaAntes.revisao.numero) throw new EscolhaDaAgendaAlterada('A configuração mudou. Confira a versão atual; seu rascunho continua nesta janela.'); }
      const requestId = crypto.randomUUID();
      const expectativa: ExpectativaDaOperacaoLocal = selecionadaAntes
        ? { tipo: 'agenda_editar', entrada: entradaDaAgenda(AgendaLocalEditarSchema.safeParse({ requestId, expectedAgendaVersion: selecionadaAntes.revisao.numero, configuracao: input })), anterior: selecionadaAntes.revisao, fonte, procedimento: sop }
        : { tipo: 'agenda_criar', entrada: entradaDaAgenda(AgendaLocalCriarSchema.safeParse({ requestId, configuracao: input })), fonte, procedimento: sop };
      await op.enviar({ pista: { ...s, requestId, tipo: expectativa.tipo, agendaId: selecionadaAntes?.agendaId ?? null }, caminho: `/agents/${encodeURIComponent(slug)}/agendas-locais${selecionadaAntes ? `/${selecionadaAntes.agendaId}` : ''}`, metodo: selecionadaAntes ? 'PUT' : 'POST', expectativa }, c);
      if (op.vigente(c)) aoMudar();
    });
  }
  async function acaoDaAgenda(tipo: 'agenda_estado' | 'agenda_disparar', destino?: AgendaLocalEstado['estado']) {
    const base = selecionada, s = op.escopo, motivoTexto = motivo, revision = draftRevision.current;
    if (!base || !s || op.pendente(tipo, base.agendaId) || op.privada || op.storageBloqueado || tipo === 'agenda_estado' && !podeConfigurar || tipo === 'agenda_disparar' && !podeExecutar) return;
    await op.agir(async c => {
      const atual = await lerAtual(base.agendaId, c); if (!atual || !op.vigente(c) || draftRevision.current !== revision) return;
      if (atual.revisao.revisionId !== base.revisao.revisionId || atual.revisao.numero !== base.revisao.numero || atual.revisao.snapshotHash !== base.revisao.snapshotHash) throw new EscolhaDaAgendaAlterada('A configuração mudou. Confira a versão atual antes desta ação.');
      if (tipo === 'agenda_estado') { const e = await lerEscolhas(c); if (!e || !op.vigente(c) || draftRevision.current !== revision) return; }
      if (tipo === 'agenda_disparar') { const f = await lerFontes(c, s); if (!f || !op.vigente(c) || draftRevision.current !== revision) return; conferirDisparo(atual, f, base.revisao); }
      const requestId = crypto.randomUUID();
      const expectativa: ExpectativaDaOperacaoLocal = tipo === 'agenda_estado'
        ? { tipo, entrada: entradaDaAgenda(AgendaLocalEstadoSchema.safeParse({ requestId, expectedAgendaVersion: base.revisao.numero, estado: destino, motivo: motivoTexto.trim() || null })), anterior: base.revisao }
        : { tipo, entrada: entradaDaAgenda(AgendaLocalDispararSchema.safeParse({ requestId, expectedAgendaVersion: base.revisao.numero, expectedSopVersion: base.revisao.configuracao.procedimento.versao })), anterior: base.revisao };
      await op.enviar({ pista: { ...s, requestId, tipo, agendaId: base.agendaId }, caminho: `/agents/${encodeURIComponent(slug)}/agendas-locais/${base.agendaId}/${tipo === 'agenda_estado' ? 'estado' : 'disparar'}`, metodo: 'POST', expectativa }, c); if (op.vigente(c)) aoMudar();
    });
  }
  async function reenviar(p: PistaDaOperacaoLocal) {
    const a = op.causa(p.requestId); if (!a) return;
    const e = a.expectativa; if (e.tipo === 'agente_estado' || !op.escopo || op.privada) return;
    await op.agir(async c => {
      if (e.tipo !== 'agenda_disparar') {
        if (!podeConfigurar) return;
        const recentes = await lerEscolhas(c); if (!recentes || !op.vigente(c)) return;
        if (e.tipo === 'agenda_criar' || e.tipo === 'agenda_editar') conferirEscolha(recentes, e.entrada.configuracao, e.fonte);
      }
      if (e.tipo !== 'agenda_criar') {
        const atual = await lerAtual(e.anterior.agendaId, c); if (!atual || !op.vigente(c)) return;
        if (atual.revisao.revisionId !== e.anterior.revisionId || atual.revisao.numero !== e.anterior.numero) throw new EscolhaDaAgendaAlterada('A revisão original mudou. Confira o pedido original; o reenvio não foi iniciado.');
        if (e.tipo === 'agenda_disparar') { if (!podeExecutar || !op.escopo) return; const f = await lerFontes(c, op.escopo); if (!f || !op.vigente(c)) return; conferirDisparo(atual, f, e.anterior); }
      }
      if (!op.vigente(c)) return; await op.enviar(a, c);
    });
  }
  const f = fonteObservada(), visivel = !op.privada;
  const podeEditar = podeConfigurar && !op.ocupado && !op.storageBloqueado && visivel && (criando || !!selecionada) && !!configuracao;
  return <div className="mt-3 border-t border-border pt-3">
    <button type="button" className="text-sm text-brand" onClick={() => void abrir()}>{aberta ? 'Fechar agenda manual' : 'Abrir agenda manual'}</button>
    {aberta && <section className="mt-3 space-y-3" aria-label="Agenda manual do agente">
      <p className="text-sm text-muted">A data indica o planejamento; cada execução exige o botão de disparo. Pausar impede novos disparos e não cancela uma execução já enviada.</p>
      {op.erro && <p role="alert" className="text-sm text-bad">{op.erro}</p>}
      <button type="button" className={botao} disabled={op.ocupado || !podeLer} onClick={() => void op.agir(async c => { setLista(null); await lerLista(c); })}>Conferir agendas e acesso</button>
      {podeConfigurar && <button type="button" className={botao} disabled={op.ocupado || op.storageBloqueado || op.pendente('agenda_criar', null)} onClick={() => void nova()}>Criar configuração pausada</button>}
      {visivel && lista && <><ul className="space-y-2">{lista.items.map(i => <li key={i.agendaId}><button type="button" className={botao} disabled={op.ocupado} onClick={() => void escolher(i.agendaId)}>{i.revisao.configuracao.nome} · v{i.revisao.numero} · {i.revisao.estado}</button></li>)}</ul>
        {lista.items.length === 0 && <p className="text-sm text-muted">Nenhuma agenda legível nesta página.</p>}{lista.proximoId && <button type="button" className={botao} disabled={op.ocupado} onClick={() => { const cursor = lista.proximoId; if (cursor) void op.agir(async c => { setLista(null); await lerLista(c, cursor); }); }}>Próxima página</button>}<p className="text-sm text-muted">A lista mostra esta página de agendas legíveis. Conferir agendas retorna à primeira página.</p></>}
      {visivel && selecionada && <div className="space-y-2 rounded border border-border p-3"><p>Configuração escolhida: v{selecionada.revisao.numero} · {selecionada.revisao.estado}.</p><ConfiguracaoRegistrada revisao={selecionada.revisao} />
        <button type="button" className={botao} disabled={op.ocupado} onClick={() => void op.agir(async c => { setAtual(null); await lerAtual(selecionada.agendaId, c); })}>Conferir versão atual</button>
        {atual && atual.revisao.revisionId !== selecionada.revisao.revisionId && <><p className="text-warn">Existe outra configuração atual: v{atual.revisao.numero}. Seu rascunho e sua escolha foram mantidos.</p><ConfiguracaoRegistrada revisao={atual.revisao} /><button type="button" className={botao} disabled={op.ocupado || op.pistas.some(p => p.agendaId === atual.agendaId)} onClick={() => adotarAtual(false)}>Usar revisão atual preservando texto</button><button type="button" className={botao} disabled={op.ocupado || op.pistas.some(p => p.agendaId === atual.agendaId)} onClick={() => adotarAtual(true)}>Descartar texto e usar revisão atual</button></>}
        {podeConfigurar && <><button type="button" className={botao} disabled={op.ocupado} onClick={() => void op.agir(async c => { await lerEscolhas(c); })}>Conferir escolhas para revisão pausada</button><label className="block text-sm">Motivo da mudança de estado<input className={campo} maxLength={500} value={motivo} disabled={op.ocupado} onChange={e => { draftRevision.current++; setMotivo(e.target.value); }} /></label>
          {selecionada.revisao.estado !== 'encerrada' && <>{selecionada.revisao.estado === 'pausada' ? <button type="button" className={botao} disabled={op.ocupado || op.storageBloqueado || op.pendente('agenda_estado', selecionada.agendaId)} onClick={() => void acaoDaAgenda('agenda_estado', 'habilitada_manual')}>Habilitar para disparo manual</button> : <button type="button" className={botao} disabled={op.ocupado || op.storageBloqueado || op.pendente('agenda_estado', selecionada.agendaId)} onClick={() => void acaoDaAgenda('agenda_estado', 'pausada')}>Pausar agenda</button>}
          <button type="button" className={botao} disabled={op.ocupado || op.storageBloqueado || op.pendente('agenda_estado', selecionada.agendaId)} onClick={() => { if (window.confirm('Encerrar esta agenda é definitivo. Confirmar?')) void acaoDaAgenda('agenda_estado', 'encerrada'); }}>Encerrar agenda</button></>}
        </>}
        {podeExecutar && selecionada.revisao.estado === 'habilitada_manual' && <button type="button" className={botao} disabled={op.ocupado || op.storageBloqueado || op.pendente('agenda_disparar', selecionada.agendaId)} onClick={() => void acaoDaAgenda('agenda_disparar')}>Confirmar e disparar agora</button>}
      </div>}
      {visivel && (criando || selecionada) && <div className="space-y-2"><fieldset className="space-y-2" disabled={!podeEditar}>
        <label className="block text-sm">Nome<input className={campo} maxLength={120} value={draft.nome} onChange={e => mudar({ nome: e.target.value })} /></label>
        <label className="block text-sm">Data planejada (UTC, opcional)<input className={campo} value={draft.previstoPara} placeholder="2026-10-12T09:00:00.000Z" onChange={e => mudar({ previstoPara: e.target.value })} /></label>
        <label className="block text-sm">Responsável<select className={campo} value={draft.responsavelId} onChange={e => mudar({ responsavelId: e.target.value })}><option value="">Escolha o dono do agente</option>{configuracao?.pessoas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="block text-sm">Fonte<select className={campo} value={draft.itemId} onChange={e => { setEscolhaFonte(null); mudar({ itemId: e.target.value, versionId: '' }); }}><option value="">Escolha uma fonte</option>{fontes?.items.map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label>
        <label className="block text-sm">Versão<select className={campo} value={draft.versionId} onChange={e => escolherVersao(e.target.value)}><option value="">Escolha uma versão</option>{f.item?.versoes.map(v => <option key={v.id} value={v.id}>v{v.versao} · {v.title}</option>)}</select></label>
        <label className="block text-sm">Pedido<textarea className={campo} maxLength={2000} value={draft.pedido} onChange={e => mudar({ pedido: e.target.value })} /></label>
      </fieldset>
      <p className="text-sm">Procedimento escolhido: {procedimentoEscolhido ? `v${procedimentoEscolhido.versao}` : 'não escolhido'} · atual: {painel?.procedimento ? `v${painel.procedimento.versao}` : 'não definido'}. Modelo escolhido: {modeloEscolhido ?? 'não definido'}.</p>
      {painel && <p className="text-sm text-muted">Consulta declarativa: o modelo não foi sondado. {painel.inicioLocal.impedimentosLocais.join(' · ')}</p>}
      {painel && <button type="button" className={botao} disabled={op.ocupado || op.pistas.some(p => p.agendaId === selecionada?.agendaId || p.tipo === 'agenda_criar' && criando)} onClick={() => { draftRevision.current++; setProcedimentoEscolhido(painel.procedimento); setModeloEscolhido(painel.modelo.configurado); }}>Usar procedimento e modelo atuais preservando texto</button>}
      <button type="button" className={botao} disabled={op.ocupado || !podeConfigurar} onClick={() => void op.agir(async c => { await lerEscolhas(c); })}>Conferir fontes, dono e procedimento</button>
      {escolhaFonte && <p className="text-sm">Fonte escolhida: {escolhaFonte.title} · v{escolhaFonte.versao}; memória lida em v{escolhaFonte.expectedItemVersion}.</p>}
      {f.versao && <><RetratoDaFonte fonte={f.versao.retratoFonte} /><button type="button" className={botao} disabled={!podeEditar || !f.versao.retratoFonte.acesso.novoUsoPermitido || op.pistas.some(p => p.agendaId === selecionada?.agendaId || p.tipo === 'agenda_criar' && criando)} onClick={() => escolherVersao(draft.versionId)}>Usar esta versão com os dados conferidos</button></>}
      <button type="button" className={botao} disabled={!podeEditar || !draft.nome.trim() || !draft.pedido.trim() || !escolhaFonte || !f.versao?.retratoFonte.acesso.novoUsoPermitido || !procedimentoEscolhido || op.pendente(selecionada ? 'agenda_editar' : 'agenda_criar', selecionada?.agendaId ?? null)} onClick={() => void salvar()}>Salvar configuração pausada</button>
      </div>}
      <PedidosLocaisDaAgenda operacoes={op} filtro={p => p.tipo !== 'agente_estado'} reenviar={p => void reenviar(p)} />
    </section>}
  </div>;
}
