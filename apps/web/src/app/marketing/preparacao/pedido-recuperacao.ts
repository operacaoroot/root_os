'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MarketingPedidoEscopoSchema, MarketingContaRecuperacaoSchema, MarketingPreparoRecuperacaoSchema,
  type MarketingPedidoEscopo, type MarketingContaRecuperacao, type MarketingPreparoRecuperacao,
} from '@mktos/shared';
import { apiGet, apiPost, ErroDaApi } from '@/lib/api';

type Tipo = 'configuracao_conta' | 'preparo';
export type PedidoMarketing = MarketingPedidoEscopo & { schemaVersion: 1; tipo: Tipo; requestId: string };
export type ReciboMarketing = Extract<MarketingContaRecuperacao | MarketingPreparoRecuperacao, { estado: 'confirmado' }>;
type Opcoes = { tipo: Tipo; actorId: string; token: string; permitido: boolean;
  sessaoAtual: () => boolean; onIndisponivel: (e: unknown) => void; onAtualizar: () => void;
  confereProposta: (r: ReciboMarketing) => boolean | null };
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const BASE = '/marketing/preparacao';
const key = (s: MarketingPedidoEscopo, tipo: Tipo) => 'rootos:marketing-pedido:' + encodeURIComponent(s.orgId) + ':' + encodeURIComponent(s.actorId) + ':' + tipo;
const legacyKey = (actorId: string, tipo: Tipo) => (tipo === 'preparo' ? 'marketing-preparo:' : 'marketing-conta:') + actorId;
const mesmoPedido = (a: PedidoMarketing | null, b: PedidoMarketing | null) => !!a && !!b && a.orgId === b.orgId && a.actorId === b.actorId && a.tipo === b.tipo && a.requestId === b.requestId;
function lerPedido(s: MarketingPedidoEscopo, tipo: Tipo): PedidoMarketing | null {
  const raw = localStorage.getItem(key(s, tipo));
  if (!raw) return null;
  if (raw.length > 1200) throw new Error('O identificador preservado está fora do limite.');
  const p: unknown = JSON.parse(raw);
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Identificador preservado inválido.');
  const v = p as Partial<PedidoMarketing>;
  if (Object.keys(v).length !== 5 || v.schemaVersion !== 1 || v.orgId !== s.orgId || v.actorId !== s.actorId || v.tipo !== tipo
    || typeof v.requestId !== 'string' || !UUID.test(v.requestId)) throw new Error('O identificador não confere com esta empresa e pessoa.');
  return { schemaVersion: 1, orgId: s.orgId, actorId: s.actorId, tipo, requestId: v.requestId };
}
function lerLegado(actorId: string, tipo: Tipo): string | null {
  const raw = localStorage.getItem(legacyKey(actorId, tipo));
  if (!raw) return null;
  if (raw.length > 64000) throw new Error('O registro antigo está fora do limite; nenhum novo pedido foi autorizado.');
  const p: unknown = JSON.parse(raw);
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Registro antigo inválido.');
  const id = (p as { requestId?: unknown }).requestId;
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('O pedido antigo não pôde ser identificado.');
  return id; // Os demais campos antigos não são usados, mostrados ou reenviados.
}
function guardar(p: PedidoMarketing) {
  const anterior = lerPedido(p, p.tipo);
  if (anterior && !mesmoPedido(anterior, p)) throw new Error('Outro pedido deste escopo continua preservado. Nenhum identificador foi substituído.');
  localStorage.setItem(key(p, p.tipo), JSON.stringify(p));
  if (!mesmoPedido(lerPedido(p, p.tipo), p)) throw new Error('O identificador não pôde ser preservado.');
}

export function usePedidoMarketing(opcoes: Opcoes) {
  const atual = useRef(opcoes); atual.current = opcoes;
  const geracao = useRef(0), operacao = useRef(false);
  const [escopo, setEscopo] = useState<MarketingPedidoEscopo | null>(null);
  const [pendente, setPendente] = useState<PedidoMarketing | null>(null);
  const [legado, setLegado] = useState<string | null>(null);
  const [ausencia, setAusencia] = useState<PedidoMarketing | null>(null);
  const [recibo, setRecibo] = useState<ReciboMarketing | null>(null);
  const [divergente, setDivergente] = useState(false), [ocupado, setOcupado] = useState(false);
  const [bloqueado, setBloqueado] = useState(false), [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const pathEscopo = BASE + (opcoes.tipo === 'configuracao_conta' ? '/contas/escopo' : '/escopo');
  const pathPedido = BASE + (opcoes.tipo === 'configuracao_conta' ? '/contas/pedidos/' : '/pedidos/');
  const vigente = (g: number) => g === geracao.current && atual.current.permitido && atual.current.sessaoAtual();
  function privar(e: unknown) {
    ++geracao.current; setBloqueado(true); setEscopo(null); setRecibo(null); setAusencia(null);
    setErro(e instanceof Error ? e.message : 'Pedido indisponível para esta conta.'); atual.current.onIndisponivel(e);
  }
  async function conferirEscopo(g: number, esperado?: MarketingPedidoEscopo | null) {
    const raw = await apiGet<unknown>(pathEscopo, opcoes.token);
    if (!vigente(g)) throw new Error('A sessão mudou; a resposta foi descartada.');
    const parsed = MarketingPedidoEscopoSchema.safeParse(raw);
    if (!parsed.success || parsed.data.actorId !== opcoes.actorId
      || (esperado && (parsed.data.orgId !== esperado.orgId || parsed.data.actorId !== esperado.actorId))) {
      const e = new Error('A empresa ou a pessoa da sessão mudou. Nenhum pedido será enviado.'); privar(e); throw e;
    }
    return parsed.data;
  }
  useEffect(() => {
    const g = ++geracao.current;
    if (!opcoes.permitido) return;
    void conferirEscopo(g).then(s => {
      if (!vigente(g)) return;
      setEscopo(s); setPendente(lerPedido(s, opcoes.tipo)); setLegado(lerLegado(opcoes.actorId, opcoes.tipo));
    }).catch(e => { if (vigente(g)) { setBloqueado(true); setErro(e instanceof Error ? e.message : 'Não foi possível conferir os pedidos preservados.'); if (e instanceof ErroDaApi && [401, 403].includes(e.status)) privar(e); } });
    return () => { ++geracao.current; operacao.current = false; };
  }, [opcoes.actorId, opcoes.token, opcoes.tipo, opcoes.permitido]);

  async function consultar(g: number, id: string, s: MarketingPedidoEscopo, antigo = false) {
    await conferirEscopo(g, s);
    if (!vigente(g)) return;
    const raw = await apiGet<unknown>(pathPedido + encodeURIComponent(id), opcoes.token);
    if (!vigente(g)) return;
    const parsed = opcoes.tipo === 'configuracao_conta' ? MarketingContaRecuperacaoSchema.safeParse(raw) : MarketingPreparoRecuperacaoSchema.safeParse(raw);
    if (!parsed.success) throw new Error('O recibo não pôde ser validado. O identificador permanece preservado.');
    const r = parsed.data;
    if (r.tipo !== opcoes.tipo || r.orgId !== s.orgId || r.actorId !== opcoes.actorId || r.requestId.toLowerCase() !== id.toLowerCase()) {
      const e = new Error('A conferência não corresponde à empresa, pessoa e pedido atuais.'); privar(e); throw e;
    }
    await conferirEscopo(g, s);
    if (!vigente(g)) return;
    const p: PedidoMarketing = { ...s, schemaVersion: 1, tipo: opcoes.tipo, requestId: id };
    if (r.estado === 'ausencia_conferida') {
      if (antigo) { setAviso('O registro antigo não informa a empresa. A ausência neste escopo não resolve sua origem; o ID antigo permanece preservado e não será reenviado automaticamente.'); return; }
      if (recibo?.requestId.toLowerCase() === id.toLowerCase()) { setErro('A consulta divergiu do recibo já recebido. O recibo e o identificador permanecem para conferência.'); return; }
      setAusencia(p); setAviso('Ausência observada nesta consulta. Um POST atrasado ainda pode chegar; revise os campos e confirme explicitamente o mesmo pedido.'); return;
    }
    setRecibo(r); setAusencia(null); setDivergente(atual.current.confereProposta(r) === false); setErro(null);
    setAviso('Pedido confirmado pelo servidor. Confira o recibo e o estado atual antes de iniciar outro pedido.');
    if (antigo) {
      const outro = lerPedido(s, opcoes.tipo);
      if (outro && !mesmoPedido(outro, p)) {
        setAviso('O recibo antigo foi confirmado neste escopo. Outro ID continua preservado; a conferência deste recibo não irá substituí-lo.');
      } else {
        guardar(p); setPendente(p);
        // Só o recibo confirmado no escopo atual permite migrar o ID antigo.
        if (lerLegado(opcoes.actorId, opcoes.tipo)?.toLowerCase() === id.toLowerCase()) localStorage.removeItem(legacyKey(opcoes.actorId, opcoes.tipo));
        setLegado(null);
      }
    }
    atual.current.onAtualizar();
  }
  async function recuperar(antigo = false) {
    if (operacao.current || bloqueado || !escopo || (!pendente && !legado) || !opcoes.permitido || !atual.current.sessaoAtual()) return;
    const id = antigo ? legado : pendente?.requestId ?? legado;
    if (!id) return;
    const g = geracao.current; operacao.current = true; setOcupado(true); setErro(null);
    try { await consultar(g, id, escopo, antigo || (!pendente && !!legado)); }
    catch (e) { if (vigente(g)) { setErro(e instanceof Error ? e.message : 'Não foi possível conferir o pedido.'); if (e instanceof ErroDaApi && [401, 403].includes(e.status)) privar(e); } }
    finally { if (g === geracao.current) { operacao.current = false; setOcupado(false); } }
  }
  async function enviar(campos: Record<string, unknown>) {
    if (operacao.current || bloqueado || !escopo || legado || recibo || (pendente && !mesmoPedido(pendente, ausencia)) || !opcoes.permitido || !atual.current.sessaoAtual()) return;
    const g = geracao.current; operacao.current = true; setOcupado(true); setErro(null); setAviso(null);
    try {
      const s = await conferirEscopo(g, escopo);
      if (!vigente(g)) return;
      if (lerLegado(opcoes.actorId, opcoes.tipo)) throw new Error('Um pedido antigo ainda está preservado; confira esse ID antes de enviar.');
      const armazenado = lerPedido(s, opcoes.tipo);
      if (armazenado && !mesmoPedido(armazenado, pendente)) { setPendente(armazenado); setAusencia(null); throw new Error('Há um pedido preservado neste escopo. Nenhum novo pedido foi enviado.'); }
      const p: PedidoMarketing = pendente ?? { ...s, schemaVersion: 1, tipo: opcoes.tipo, requestId: crypto.randomUUID() };
      guardar(p); setPendente(p); setAusencia(null);
      if (!vigente(g)) return;
      await apiPost(opcoes.tipo === 'configuracao_conta' ? BASE + '/contas' : BASE, { ...campos, requestId: p.requestId }, opcoes.token);
      if (!vigente(g)) return;
      // O corpo de POST não é usado como recibo: o GET retorna a projeção sanitizada.
      await consultar(g, p.requestId, s);
    } catch (e) {
      if (vigente(g)) { setErro(e instanceof Error ? e.message : 'Resultado incerto. Consulte o pedido preservado.'); if (e instanceof ErroDaApi && [401, 403].includes(e.status)) privar(e); }
    } finally { if (g === geracao.current) { operacao.current = false; setOcupado(false); } }
  }
  function concluirConferencia() {
    if (operacao.current || bloqueado || !escopo || !recibo || !atual.current.sessaoAtual()
      || recibo.orgId !== escopo.orgId || recibo.actorId !== opcoes.actorId) return;
    try {
      const id = recibo.requestId.toLowerCase();
      if (legado?.toLowerCase() === id && pendente?.requestId.toLowerCase() !== id) {
        if (lerLegado(opcoes.actorId, opcoes.tipo)?.toLowerCase() !== id) throw new Error('O ID antigo mudou. Nenhum registro foi retirado.');
        localStorage.removeItem(legacyKey(opcoes.actorId, opcoes.tipo)); setLegado(null);
      } else {
        if (!pendente || pendente.requestId.toLowerCase() !== id) throw new Error('O recibo não corresponde ao ID preservado.');
        const salvo = lerPedido(escopo, opcoes.tipo);
        if (salvo && !mesmoPedido(salvo, pendente)) throw new Error('O pedido preservado mudou em outra aba. Nenhum identificador foi removido.');
        if (salvo) localStorage.removeItem(key(escopo, opcoes.tipo));
        setPendente(null); setAusencia(null);
      }
      setRecibo(null); setDivergente(false); setErro(null); setAviso('Recibo conferido. Um novo pedido exige nova confirmação dos campos.');
    } catch (e) { setErro(e instanceof Error ? e.message : 'O identificador continua preservado.'); }
  }
  return { escopo, pendente, legado, recibo, divergente, ocupado, bloqueado, erro, aviso,
    podeReusar: !legado && mesmoPedido(pendente, ausencia), recuperar, enviar, concluirConferencia };
}
