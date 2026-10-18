'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ProcedimentoLocalPedidoSchema, ProcedimentoLocalPainelSchema, ProcedimentoLocalFontesSchema,
  ProcedimentoLocalExecucaoSchema, ProcedimentoLocalRecuperacaoSchema,
  type M05EscopoDto, type ProcedimentoLocalPedido, type ProcedimentoLocalPainel,
  type ProcedimentoLocalFontes, type ProcedimentoLocalExecucao,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import {
  RetratoDaFonte, RecuperacaoIndisponivel, escopoConfere, retratoConfere, chaveDoPedido,
  lerIdentificador, guardarIdentificador, removerIdentificador, type IdentificadorDePedido,
} from '@/app/contexto/RetratoDaFonte';

type Painel = ProcedimentoLocalPainel;
type Fontes = ProcedimentoLocalFontes;
type Pedido = ProcedimentoLocalPedido;
type Execucao = ProcedimentoLocalExecucao;
type Sop = NonNullable<Painel['procedimento']>;
type Proposta = { pedido: string; itemId: string; versionId: string; contentHash: string | null; expectedItemVersion: number | null; expectedSopVersion: number | null };
type Props = { slug: string; token: string | null; pessoaId: string; podeExecutar: boolean };
const campo = 'mt-1 w-full rounded border border-border bg-bg px-2 py-2 text-sm';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const recusada = (e: unknown) => [401, 403, 404].includes((e as { status?: number }).status ?? 0);
const terminalLocal = (status: string) => ['respondida', 'falhou', 'recusada'].includes(status);
class ConferenciaInvalida extends Error {}
class EscolhaAlterada extends Error {}
function dado<T>(r: { success: true; data: T } | { success: false }): T {
  if (!r.success) throw new ConferenciaInvalida();
  return r.data;
}
function mesmaSop(a: Painel['procedimento'], b: Painel['procedimento']) {
  return a === null || b === null ? a === b : a.versao === b.versao && a.proposito === b.proposito
    && a.definicaoDePronto === b.definicaoDePronto && a.passos.length === b.passos.length && a.passos.every((p, i) => p === b.passos[i]);
}

export function ExecucaoLocal(props: Props) {
  return <ExecucaoAutorizada key={`${props.token}:${props.pessoaId}:${props.slug}`} {...props} />;
}
function ExecucaoAutorizada({ slug, token, pessoaId, podeExecutar }: Props) {
  const [aberto, setAberto] = useState(false), [fontes, setFontes] = useState<Fontes | null>(null), [painel, setPainel] = useState<Painel | null>(null);
  const [itemId, setItemId] = useState(''), [versionId, setVersionId] = useState(''), [pedido, setPedido] = useState('');
  const [sopEscolhido, setSopEscolhido] = useState<Sop | null>(null);
  const [pendente, setPendente] = useState<IdentificadorDePedido | null>(null), [execucao, setExecucao] = useState<Execucao | null>(null);
  const [anteriorPendente, setAnteriorPendente] = useState<string | null>(null), [legadoPendente, setLegadoPendente] = useState<string | null>(null);
  const [ausencia, setAusencia] = useState<IdentificadorDePedido | null>(null), [revisando, setRevisando] = useState(false);
  const [divergente, setDivergente] = useState(false), [reciboConferido, setReciboConferido] = useState(false);
  const [erro, setErro] = useState<string | null>(null), [conflito, setConflito] = useState(false), [ocupado, setOcupado] = useState(false);
  const generation = useRef(0), escopo = useRef<M05EscopoDto | null>(null), input = useRef<Pedido | null>(null), trava = useRef(false), sopInicial = useRef(false);
  const proposta = useRef<Proposta | null>(null);
  const fonte = fontes?.items.find((i) => i.id === itemId), versao = fonte?.versoes.find((v) => v.id === versionId);
  proposta.current = input.current && !revisando ? input.current : pedido.trim() || itemId || versionId ? {
    pedido: pedido.trim(), itemId, versionId,
    contentHash: versao?.contentHash ?? (input.current?.itemId === itemId && input.current.versionId === versionId ? input.current.contentHash : null),
    expectedItemVersion: fonte?.versao ?? (input.current?.itemId === itemId ? input.current.expectedItemVersion : null),
    expectedSopVersion: sopEscolhido?.versao ?? null,
  } : null;
  const vigente = (ciclo: number) => generation.current === ciclo;
  function privar() {
    setFontes(null); setPainel(null); setExecucao(null); setAusencia(null); setRevisando(false);
    setItemId(''); setVersionId(''); setPedido(''); setSopEscolhido(null); sopInicial.current = false;
    input.current = null; setDivergente(false); setReciboConferido(false); setConflito(false);
    setErro('Procedimento não disponível para esta conta.');
  }
  function conferirEscopo(e: M05EscopoDto, anterior = escopo.current) {
    if (!escopoConfere(e, pessoaId, anterior, slug) || !e.agentId || !e.agentSlug) throw new ConferenciaInvalida();
  }
  function conferirId(id: IdentificadorDePedido) {
    conferirEscopo(id);
    if (id.operation !== 'procedimento' || !uuid.test(id.requestId)) throw new ConferenciaInvalida();
  }
  function conferirPainel(r: Painel, esperado?: M05EscopoDto) {
    conferirEscopo(r.escopo);
    if (esperado) conferirEscopo(r.escopo, esperado);
    if (r.inicioLocal.permitido && (!r.autoridade.iniciar || !r.procedimento)) throw new ConferenciaInvalida();
  }
  function aceitarPainel(r: Painel) {
    conferirPainel(r); escopo.current = r.escopo; setPainel(r);
    if (!sopInicial.current) { setSopEscolhido(r.procedimento); sopInicial.current = true; }
  }
  function aceitarFontes(r: Fontes) {
    conferirEscopo(r.escopo); conferirPainel(r.painel, r.escopo);
    const ids = new Set<string>();
    for (const f of r.items) {
      if (ids.has(f.id)) throw new ConferenciaInvalida(); ids.add(f.id);
      const versoes = new Set<string>();
      for (const v of f.versoes) {
        if (versoes.has(v.id) || v.versao > f.versao || !retratoConfere(v.retratoFonte, {
          itemId: f.id, versionId: v.id, versao: v.versao, contentHash: v.contentHash, chave: f.chave, title: v.title, body: null,
        }) || v.retratoFonte.origem.tipo !== v.sourceType || v.retratoFonte.origem.referencia !== v.sourceRef) throw new ConferenciaInvalida();
        versoes.add(v.id);
      }
    }
    aceitarPainel(r.painel); setFontes(r);
  }
  function conferirExecucao(r: Execucao, id: IdentificadorDePedido, esperado?: M05EscopoDto) {
    conferirId(id); conferirEscopo(r.escopo, id); conferirPainel(r.painelAtual, r.escopo);
    if (esperado) conferirEscopo(r.escopo, esperado);
    const entrada = r.entradaConfirmada.input;
    if (r.requestId !== id.requestId || entrada.requestId !== r.requestId || r.pessoaId !== pessoaId || r.pedido !== entrada.pedido
      || entrada.itemId !== r.fonte.itemId || entrada.versionId !== r.fonte.versionId || entrada.contentHash !== r.fonte.contentHash
      || entrada.expectedItemVersion < r.fonte.versao || !retratoConfere(r.retratoFonte, r.fonte)
      || r.retratoFonte.origem.tipo !== r.fonte.sourceType || r.retratoFonte.origem.referencia !== r.fonte.sourceRef
      || !mesmaSop(r.procedimentoAtual, r.painelAtual.procedimento)
      || (r.entradaConfirmada.contrato === 2 && r.procedimento.versao !== r.entradaConfirmada.input.expectedSopVersion)) throw new ConferenciaInvalida();
  }
  function propostaDiverge(r: Execucao) {
    const local = proposta.current ?? input.current;
    if (!local) return false;
    const registrada = r.entradaConfirmada.input;
    return local.pedido !== registrada.pedido || local.itemId !== registrada.itemId || local.versionId !== registrada.versionId
      || local.contentHash !== registrada.contentHash || local.expectedItemVersion !== registrada.expectedItemVersion
      || r.entradaConfirmada.contrato !== 2 || local.expectedSopVersion !== r.entradaConfirmada.input.expectedSopVersion;
  }
  function aceitarExecucao(r: Execucao, id: IdentificadorDePedido) {
    conferirExecucao(r, id);
    const diferente = propostaDiverge(r);
    aceitarPainel(r.painelAtual); setExecucao(r); setAusencia(null); setRevisando(false);
    setDivergente(diferente); setReciboConferido(false); setConflito(false); setErro(null);
    if (terminalLocal(r.status) && !diferente) setPendente(null);
    else setPendente(id);
  }
  function tratarErro(e: unknown, id?: IdentificadorDePedido) {
    const anterior = id ?? pendente ?? (execucao && escopo.current ? { ...escopo.current, requestId: execucao.requestId, operation: 'procedimento' as const } : null);
    if (anterior) setPendente(anterior);
    setAusencia(null); setRevisando(false);
    if (recusada(e) || e instanceof ConferenciaInvalida) { privar(); return; }
    if (e instanceof EscolhaAlterada) { setConflito(true); setErro(e.message); return; }
    if ((e as { status?: number }).status === 409) {
      setConflito(true); setErro('O pedido, a fonte ou o procedimento mudou. Confira o pedido original antes de tentar novamente.'); return;
    }
    setFontes(null); setPainel(null); setExecucao(null);
    setErro(e instanceof RecuperacaoIndisponivel ? e.message : 'Não foi possível conferir o procedimento. Tente conferir novamente.');
  }
  async function agir(acao: (ciclo: number) => Promise<void>, id?: IdentificadorDePedido) {
    if (!token || trava.current) return;
    const ciclo = ++generation.current; trava.current = true; setOcupado(true); setErro(null);
    try { await acao(ciclo); }
    catch (e) { if (vigente(ciclo)) tratarErro(e, id); }
    finally { if (vigente(ciclo)) { trava.current = false; setOcupado(false); } }
  }
  async function buscarFontes(ciclo: number) {
    const r = dado(ProcedimentoLocalFontesSchema.safeParse(await apiGet<unknown>(`/agents/${encodeURIComponent(slug)}/procedimento/fontes`, token)));
    if (!vigente(ciclo)) return null;
    aceitarFontes(r); return r;
  }
  async function buscarPainel(ciclo: number) {
    const r = dado(ProcedimentoLocalPainelSchema.safeParse(await apiGet<unknown>(`/agents/${encodeURIComponent(slug)}/procedimento/painel`, token)));
    if (!vigente(ciclo)) return null;
    aceitarPainel(r); return r;
  }
  function pedidoLegado() {
    try {
      const raw = localStorage.getItem(`rootos:execucao-agente:${pessoaId}:${slug}`);
      if (raw === null) return null;
      if (raw.length > 16384) throw new RecuperacaoIndisponivel();
      const valor: unknown = JSON.parse(raw);
      const id = valor && typeof valor === 'object' && 'requestId' in valor ? valor.requestId : null;
      if (typeof id !== 'string' || !uuid.test(id)) throw new RecuperacaoIndisponivel();
      return id;
    } catch { throw new RecuperacaoIndisponivel(); }
  }
  function sessaoAnterior(e: M05EscopoDto): string | null {
    const chave = `${chaveDoPedido(e, 'procedimento')}:sessao`, antiga = `rootos:execucao-agente:${pessoaId}:${slug}:ultima`;
    try {
      const valor = localStorage.getItem(antiga);
      if (valor && uuid.test(valor)) {
        try { localStorage.setItem(chave, JSON.stringify({ ...e, sessionId: valor })); removerIdentificador(antiga); }
        catch { return valor; }
      } else if (valor) throw new RecuperacaoIndisponivel();
      const r: (M05EscopoDto & { sessionId: string }) | null = JSON.parse(localStorage.getItem(chave) ?? 'null');
      return r && Object.keys(r).every((k) => ['orgId', 'userId', 'agentId', 'agentSlug', 'sessionId'].includes(k))
        && escopoConfere(r, pessoaId, e, slug) && uuid.test(r.sessionId) ? r.sessionId : null;
    } catch { throw new RecuperacaoIndisponivel(); }
  }
  async function buscarPedido(id: IdentificadorDePedido, ciclo: number, legado = false) {
    conferirId(id); setPendente(id);
    const r = dado(ProcedimentoLocalRecuperacaoSchema.safeParse(await apiGet<unknown>(`/agents/${encodeURIComponent(slug)}/procedimento/pedidos/${encodeURIComponent(id.requestId)}`, token)));
    if (!vigente(ciclo)) return;
    conferirEscopo(r.escopo, id);
    if (r.requestId !== id.requestId) throw new ConferenciaInvalida();
    if (r.estado === 'ausencia_conferida') {
      setExecucao(null); setDivergente(false); setReciboConferido(false); setConflito(false); setRevisando(false);
      setAusencia(id); setPendente(id);
      if (legado) setLegadoPendente(id.requestId);
      return;
    }
    conferirExecucao(r.execucao, id, r.escopo);
    if (legado) {
      if (!guardarIdentificador(chaveDoPedido(r.escopo, 'procedimento'), id)) throw new RecuperacaoIndisponivel();
      removerIdentificador(`rootos:execucao-agente:${pessoaId}:${slug}`); setLegadoPendente(null);
    }
    aceitarExecucao(r.execucao, id);
  }
  async function buscarAnterior(sessionId: string, ciclo: number) {
    setAnteriorPendente(sessionId);
    const r = dado(ProcedimentoLocalExecucaoSchema.safeParse(await apiGet<unknown>(`/agents/${encodeURIComponent(slug)}/procedimento/execucoes/${encodeURIComponent(sessionId)}`, token)));
    if (!vigente(ciclo)) return;
    if (r.id !== sessionId || !escopo.current) throw new ConferenciaInvalida();
    const id: IdentificadorDePedido = { ...escopo.current, requestId: r.requestId, operation: 'procedimento' };
    conferirExecucao(r, id);
    if (!guardarIdentificador(chaveDoPedido(escopo.current, 'procedimento'), id)) { setPendente(id); throw new RecuperacaoIndisponivel(); }
    removerIdentificador(`${chaveDoPedido(escopo.current, 'procedimento')}:sessao`); setAnteriorPendente(null);
    aceitarExecucao(r, id);
  }
  async function conferirPedido(id: IdentificadorDePedido) {
    await agir((ciclo) => buscarPedido(id, ciclo, legadoPendente === id.requestId), id);
  }
  async function conferirAnterior(sessionId: string) { await agir((ciclo) => buscarAnterior(sessionId, ciclo)); }
  useEffect(() => {
    if (!aberto || !token) return;
    const ciclo = ++generation.current; trava.current = true; setOcupado(true); setFontes(null); setPainel(null); setExecucao(null); setAusencia(null); setRevisando(false); setErro(null);
    const carregar = async () => {
      if (!await buscarFontes(ciclo) || !escopo.current) return;
      const id = lerIdentificador(chaveDoPedido(escopo.current, 'procedimento'), escopo.current, 'procedimento');
      const legado = pedidoLegado();
      const anterior = sessaoAnterior(escopo.current);
      if (id) await buscarPedido(id, ciclo);
      else if (legado) {
        setLegadoPendente(legado);
        await buscarPedido({ ...escopo.current, requestId: legado, operation: 'procedimento' }, ciclo, true);
      } else if (anterior) await buscarAnterior(anterior, ciclo);
    };
    void carregar().catch((e) => { if (vigente(ciclo)) tratarErro(e); }).finally(() => {
      if (vigente(ciclo)) { trava.current = false; setOcupado(false); }
    });
    return () => { generation.current++; trava.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, slug, token, pessoaId]);
  const ausenciaDeA = !!pendente && !!ausencia && ausencia.requestId === pendente.requestId
    && escopoConfere(ausencia, pessoaId, pendente, slug);
  const podeRevisarA = ausenciaDeA && !execucao && !anteriorPendente && legadoPendente !== pendente?.requestId;
  const edicaoPermitida = !pendente && !anteriorPendente || revisando && podeRevisarA;
  const iniciarPermitido = !!painel?.autoridade.iniciar && painel.inicioLocal.permitido && podeExecutar;
  function usarSopAtual() {
    if (trava.current || !painel || !painel.procedimento || execucao || anteriorPendente || pendente && !(revisando && podeRevisarA)) return;
    conferirPainel(painel); setSopEscolhido(painel.procedimento); sopInicial.current = true; setConflito(false); setErro(null);
  }
  async function atualizarFontes() { await agir(async (ciclo) => { await buscarFontes(ciclo); }); }
  async function conferirRegistro() {
    if (!execucao || !escopo.current) return;
    const registroId = execucao.id, id: IdentificadorDePedido = { ...escopo.current, requestId: execucao.requestId, operation: 'procedimento' };
    await agir(async (ciclo) => {
      const r = dado(ProcedimentoLocalExecucaoSchema.safeParse(await apiGet<unknown>(`/agents/${encodeURIComponent(slug)}/procedimento/execucoes/${encodeURIComponent(registroId)}`, token)));
      if (!vigente(ciclo)) return;
      if (r.id !== registroId) throw new ConferenciaInvalida();
      aceitarExecucao(r, id);
    }, id);
  }
  async function executar(repetir = false) {
    if (!token || trava.current || ocupado || !escopo.current || !iniciarPermitido || execucao || anteriorPendente || conflito) return;
    const envioAnterior = repetir ? input.current : null;
    if (repetir && (!envioAnterior || !podeRevisarA || envioAnterior.requestId !== pendente?.requestId)) return;
    if (!repetir && (!edicaoPermitida || !fonte || !versao || !versao.retratoFonte.acesso.novoUsoPermitido || !sopEscolhido || !pedido.trim())) return;
    const escolha = envioAnterior ?? {
      pedido: pedido.trim(), itemId, versionId, contentHash: versao?.contentHash,
      expectedItemVersion: fonte?.versao, expectedSopVersion: sopEscolhido?.versao,
    };
    const sopDaEscolha = envioAnterior ? envioAnterior.expectedSopVersion : sopEscolhido?.versao;
    const idAnterior = pendente;
    await agir(async (ciclo) => {
      const recentes = await buscarFontes(ciclo), atual = recentes?.painel;
      if (!recentes || !atual || !vigente(ciclo)) return;
      if (!atual.autoridade.iniciar || !atual.inicioLocal.permitido) throw new EscolhaAlterada('O início local não está autorizado nesta consulta. Confira o procedimento e o acesso.');
      if (!atual.procedimento || atual.procedimento.versao !== sopDaEscolha || !repetir && !mesmaSop(atual.procedimento, sopEscolhido))
        throw new EscolhaAlterada('O procedimento mudou. Confira a versão atual e escolha explicitamente qual usar.');
      const fonteAtual = recentes.items.find((f) => f.id === escolha.itemId), versaoAtual = fonteAtual?.versoes.find((v) => v.id === escolha.versionId);
      if (!fonteAtual || !versaoAtual || !versaoAtual.retratoFonte.acesso.novoUsoPermitido || fonteAtual.versao !== escolha.expectedItemVersion
        || versaoAtual.contentHash !== escolha.contentHash) throw new EscolhaAlterada('A fonte ou seu acesso mudou. O rascunho foi mantido; confira as fontes antes de confirmar.');
      if (!idAnterior) {
        const guardado = lerIdentificador(chaveDoPedido(atual.escopo, 'procedimento'), atual.escopo, 'procedimento');
        if (guardado) { await buscarPedido(guardado, ciclo); return; }
        const legado = pedidoLegado(), anterior = sessaoAnterior(atual.escopo);
        if (legado) {
          setLegadoPendente(legado);
          await buscarPedido({ ...atual.escopo, requestId: legado, operation: 'procedimento' }, ciclo, true); return;
        }
        if (anterior) { await buscarAnterior(anterior, ciclo); return; }
      }
      const requestId = idAnterior?.requestId ?? crypto.randomUUID();
      const dados = dado(ProcedimentoLocalPedidoSchema.safeParse({ ...escolha, requestId }));
      const id: IdentificadorDePedido = { ...atual.escopo, requestId, operation: 'procedimento' };
      if (idAnterior) conferirEscopo(atual.escopo, idAnterior);
      if (!guardarIdentificador(chaveDoPedido(atual.escopo, 'procedimento'), id)) throw new RecuperacaoIndisponivel();
      input.current = dados; setPendente(id); setAusencia(null); setRevisando(false);
      try {
        const r = dado(ProcedimentoLocalExecucaoSchema.safeParse(await apiPost<unknown>(`/agents/${encodeURIComponent(slug)}/procedimento/executar`, dados, token)));
        if (vigente(ciclo)) aceitarExecucao(r, id);
      } catch (e) { if (vigente(ciclo)) tratarErro(e, id); }
    }, idAnterior ?? undefined);
  }
  async function prepararNovoPedido() {
    if (!execucao || !terminalLocal(execucao.status) || divergente && !reciboConferido || ocupado || trava.current || !podeExecutar || !escopo.current || anteriorPendente || pendente) return;
    const confirmado = execucao;
    await agir(async (ciclo) => {
      const atual = await buscarPainel(ciclo);
      if (!atual || !vigente(ciclo)) return;
      if (!atual.autoridade.iniciar) throw new EscolhaAlterada('Novos pedidos não estão autorizados nesta consulta.');
      conferirEscopo(confirmado.escopo, atual.escopo);
      const chave = chaveDoPedido(atual.escopo, 'procedimento'), guardado = lerIdentificador(chave, atual.escopo, 'procedimento');
      if (guardado && guardado.requestId !== confirmado.requestId) { setPendente(guardado); return; }
      const legado = pedidoLegado(), anterior = sessaoAnterior(atual.escopo);
      if (legado) { setLegadoPendente(legado); await buscarPedido({ ...atual.escopo, requestId: legado, operation: 'procedimento' }, ciclo, true); return; }
      if (anterior) { await buscarAnterior(anterior, ciclo); return; }
      removerIdentificador(chave);
      const restante = lerIdentificador(chave, atual.escopo, 'procedimento');
      if (restante) { setPendente(restante); throw new RecuperacaoIndisponivel(); }
      setPendente(null); setExecucao(null); setPedido(''); setItemId(''); setVersionId(''); input.current = null;
      setSopEscolhido(atual.procedimento); sopInicial.current = true; setDivergente(false); setReciboConferido(false); setConflito(false); setAusencia(null); setRevisando(false);
    }, { ...confirmado.escopo, requestId: confirmado.requestId, operation: 'procedimento' });
  }
  function conferirReciboDivergente() {
    if (trava.current || !execucao || !terminalLocal(execucao.status) || !divergente || !escopo.current) return;
    conferirEscopo(execucao.escopo); setReciboConferido(true); setPendente(null);
  }

  return <div className="mt-3 border-t border-border pt-3">
    <button type="button" onClick={() => setAberto(!aberto)} className="text-sm text-brand">{aberto ? 'Fechar execução local' : 'Abrir procedimento local'}</button>
    {aberto && <section className="mt-3 space-y-3" aria-label="Procedimento local">
      <p className="text-sm text-muted">Ler uma versão, preparar uma síntese com o modelo local e registrar o resultado.</p>
      {painel && <div className="space-y-1 text-sm">
        <p>Estado do agente: {painel.agente.estado}. Autorização para iniciar: {painel.autoridade.iniciar ? 'permitida nesta consulta' : 'indisponível nesta consulta'}.</p>
        <p>Modelo configurado: {painel.modelo.configurado ?? 'não definido'}.</p>
        <p>{painel.modelo.declaracao.estado === 'nao_configurado' ? 'Modelo local não configurado.' : painel.modelo.declaracao.estado === 'configuracao_invalida' ? 'Configuração local inválida.' : 'Configuração declarada, sem verificação de disponibilidade.'} A disponibilidade será conferida após um pedido explícito.</p>
        <p>Leitura de versão, síntese local e registro. Ferramentas externas e agenda indisponíveis; inferência já enviada não é cancelada por esta tela.</p>
        {painel.inicioLocal.impedimentosLocais.map((impedimento, i) => <p key={i}>{impedimento}</p>)}
        <p>Procedimento escolhido: {sopEscolhido ? `v${sopEscolhido.versao}` : 'ainda não escolhido'} · atual: {painel.procedimento ? `v${painel.procedimento.versao}` : 'não definido'}.</p>
        {sopEscolhido && <details><summary className="cursor-pointer text-brand">Conferir procedimento escolhido</summary><SopRegistrado sop={sopEscolhido} /></details>}
        {painel.procedimento && !mesmaSop(sopEscolhido, painel.procedimento) && <details><summary className="cursor-pointer text-brand">Conferir procedimento atual</summary><SopRegistrado sop={painel.procedimento} /></details>}
        {painel.procedimento && !mesmaSop(sopEscolhido, painel.procedimento) && !execucao && edicaoPermitida && <button type="button" disabled={ocupado} className="text-brand disabled:opacity-50" onClick={usarSopAtual}>Usar procedimento atual preservando rascunho</button>}
      </div>}
      {erro && <p role="alert" className="text-bad">{erro}</p>}
      {anteriorPendente && <div className="space-y-2"><p role="status">Execução anterior sem confirmação. Confira o registro antes de iniciar outro pedido.</p><button type="button" className="text-brand" disabled={ocupado} onClick={() => void conferirAnterior(anteriorPendente)}>Conferir execução anterior</button></div>}
      {pendente && <div className="space-y-2">
        <p role="status" className="text-sm">{ausenciaDeA ? 'Não foi encontrado registro nesta consulta. O pedido continua recuperável; um envio anterior ainda pode chegar.' : execucao?.requestId === pendente.requestId && execucao.status === 'rodando' ? 'Execução em andamento. Confira este pedido antes de preparar outro.' : 'Confira o pedido original antes de preparar outro.'}</p>
        {legadoPendente === pendente.requestId && <p className="text-sm">Pedido legado sem vínculo confirmado nesta empresa. A ausência não autoriza reenviá-lo; a pista anterior foi mantida.</p>}
        <button type="button" disabled={ocupado} className="text-sm text-brand" onClick={() => void conferirPedido(pendente)}>Conferir pedido anterior</button>
        {podeRevisarA && !revisando && <button type="button" disabled={ocupado || !iniciarPermitido} className="ml-3 text-sm text-brand" onClick={() => { setRevisando(true); setConflito(false); setErro(null); }}>Revisar proposta deste mesmo pedido</button>}
        {podeRevisarA && input.current && !revisando && <button type="button" disabled={ocupado || !iniciarPermitido} className="ml-3 text-sm text-brand" onClick={() => void executar(true)}>Confirmar e reenviar a entrada original</button>}
      </div>}
      <fieldset className="space-y-2" disabled={ocupado || !edicaoPermitida || !!execucao || !podeExecutar || !fontes}>
        <label className="block">Fonte do procedimento<select className={campo} value={itemId} onChange={(e) => { setItemId(e.target.value); setVersionId(''); }}><option value="">Escolha uma fonte</option>{fontes?.items.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label>
        <label className="block">Versão da fonte<select className={campo} value={versionId} onChange={(e) => setVersionId(e.target.value)}><option value="">Escolha uma versão</option>{fonte?.versoes.map((v) => <option key={v.id} value={v.id}>v{v.versao} · {v.title}</option>)}</select></label>
        <label className="block">Pedido para o agente<textarea className={campo} value={pedido} maxLength={2000} onChange={(e) => setPedido(e.target.value)} /></label>
      </fieldset>
      {versao && !execucao && <RetratoDaFonte fonte={versao.retratoFonte} />}
      <button type="button" className="text-sm text-brand" disabled={ocupado || !token} onClick={() => void atualizarFontes()}>Conferir fontes, procedimento e acesso</button>
      {conflito && edicaoPermitida && !execucao && <button type="button" disabled={ocupado || !fontes} className="text-sm text-brand" onClick={() => { setConflito(false); setErro(null); }}>Revisar rascunho com as fontes conferidas</button>}
      {podeExecutar && edicaoPermitida && !anteriorPendente && <button type="button" disabled={ocupado || !!execucao || conflito || !iniciarPermitido || !fonte || !versao || !pedido.trim() || !sopEscolhido || !versao.retratoFonte.acesso.novoUsoPermitido} className="rounded bg-brand px-3 py-2 text-sm text-ink disabled:opacity-50" onClick={() => void executar()}>{pendente ? 'Confirmar e enviar este mesmo pedido' : 'Iniciar procedimento local'}</button>}
      {execucao && terminalLocal(execucao.status) && podeExecutar && !pendente && !anteriorPendente && (!divergente || reciboConferido) && <button type="button" disabled={ocupado} onClick={() => void prepararNovoPedido()} className="text-sm text-brand disabled:opacity-50">Preparar novo pedido</button>}
      {execucao && <div className="space-y-2 rounded border border-border p-3" aria-label="Registro do procedimento">
        <p>Execução: <span className="font-os-mono">{execucao.id}</span></p><p>Pedido: <span className="font-os-mono">{execucao.requestId}</span></p><p>Situação: {execucao.status}</p>
        {divergente && <div className="space-y-2"><p role="alert" className="text-warn">Este recibo pertence ao pedido anterior e usa outra proposta. Ele não confirma a proposta local atual.</p>{terminalLocal(execucao.status) && !reciboConferido && <button type="button" disabled={ocupado} className="text-brand" onClick={conferirReciboDivergente}>Conferi o recibo deste pedido</button>}</div>}
        <p>Entrada registrada · contrato V{execucao.entradaConfirmada.contrato}:</p><p className="whitespace-pre-wrap">{execucao.entradaConfirmada.input.pedido}</p>
        {execucao.entradaConfirmada.contrato === 1 && <p className="text-sm text-muted">Este contrato histórico não enviava a versão esperada do SOP. Sua entrada permanece disponível para leitura; não pode ser reenviada como pedido novo.</p>}
        {execucao.motivo && <p>{execucao.motivo}</p>}{execucao.resposta && <p className="whitespace-pre-wrap">{execucao.resposta}</p>}
        <p>{execucao.procedimento.versao > 0 ? `Procedimento registrado nesta execução · v${execucao.procedimento.versao}` : 'Esta execução recusada registrou ausência de procedimento.'} · atual: {execucao.procedimentoAtual ? `v${execucao.procedimentoAtual.versao}` : 'não definido'}.</p>
        <details><summary className="cursor-pointer text-brand">Conferir procedimento registrado</summary><SopRegistrado sop={execucao.procedimento} /></details>
        <RetratoDaFonte fonte={execucao.retratoFonte} usada />
        <Link className="text-brand" href={`/contexto?nota=${encodeURIComponent(execucao.fonte.itemId)}&versao=${encodeURIComponent(execucao.fonte.versionId)}`}>Abrir fonte usada · v{execucao.fonte.versao}</Link>
        <p className="text-sm">Modelo configurado: {execucao.modeloConfigurado ?? 'não definido'} · usado: {execucao.modeloUsado ?? 'nenhuma chamada concluída'}.</p>
        <p className="text-sm">Tokens observados: entrada {execucao.consumo.tokensIn ?? 'não informado'} · saída {execucao.consumo.tokensOut ?? 'não informado'}.</p><p className="text-sm">Sem cobrança de provedor externo. Consumo da máquina não medido.</p>
        <button type="button" onClick={() => void conferirRegistro()} disabled={ocupado} className="text-sm text-brand">Conferir execução e acesso</button>
      </div>}
    </section>}
  </div>;
}
function SopRegistrado({ sop }: { sop: Execucao['procedimento'] }) {
  return <div className="space-y-2 py-2 text-sm"><p className="whitespace-pre-wrap">{sop.proposito || 'Sem propósito registrado.'}</p>
    {sop.passos.length > 0 ? <ol className="list-inside list-decimal space-y-1">{sop.passos.map((passo, i) => <li className="whitespace-pre-wrap" key={i}>{passo}</li>)}</ol> : <p>Sem passos registrados.</p>}
    <p className="whitespace-pre-wrap">Definição de pronto: {sop.definicaoDePronto || 'não registrada'}</p>
    <p className="text-xs text-muted">O executor local faz leitura, síntese e registro. A lista de passos não comprova que cada ação foi executada.</p>
  </div>;
}
