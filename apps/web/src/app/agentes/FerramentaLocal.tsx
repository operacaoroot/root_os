'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ProcedimentoFerramentaLocalPainelSchema, ProcedimentoFerramentaLocalPedidoSchema,
  ProcedimentoFerramentaLocalConfiguracaoSchema, ProcedimentoFerramentaLocalConfiguracaoResultadoSchema,
  ProcedimentoFerramentaLocalReciboSchema, ProcedimentoFerramentaLocalRecuperacaoSchema, ProcedimentoLocalFontesSchema,
  textoCanonicoDaFerramentaLocal, type ProcedimentoFerramentaLocalPainel, type ProcedimentoFerramentaLocalPedido,
  type ProcedimentoFerramentaLocalRecibo, type ProcedimentoFerramentaLocalRecuperacao, type ProcedimentoLocalFontes,
} from '@mktos/shared';
import { z } from 'zod';
import { apiGet, apiPost, apiPut, ErroDaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Scope = ProcedimentoFerramentaLocalPainel['escopo'];
class ConflitoDaBaseLocal extends Error {}
const PistaSchema = z.object({ schemaVersion: z.literal(1), orgId: z.string().uuid(), actorId: z.string().uuid(), agentId: z.string().uuid(),
  agentSlug: z.string(), requestId: z.string().uuid(), operation: z.literal('ferramenta_memoria_v3') }).strict();
type Pista = z.infer<typeof PistaSchema>;
type Escolha = { item: ProcedimentoLocalFontes['items'][number]; v: ProcedimentoLocalFontes['items'][number]['versoes'][number] };
const chave = (s: Scope) => `rootos:v3:ferramenta-memoria:${[s.orgId, s.actorId, s.agentId, s.agentSlug].map(encodeURIComponent).join(':')}`;
const mesmoScope = (a: Scope, b: Scope) => a.orgId === b.orgId && a.actorId === b.actorId && a.agentId === b.agentId && a.agentSlug === b.agentSlug;
const classe = 'w-full rounded-root border border-border bg-bg p-2 text-xs text-text';

function conferirRecibo(r: ProcedimentoFerramentaLocalRecibo, s: Scope, requestId: string) {
  if (!mesmoScope(r.escopo, s) || r.requestId !== requestId || r.entrada.requestId !== requestId
    || r.inputCanonico !== textoCanonicoDaFerramentaLocal(s, r.entrada) || r.sop.versao !== r.entrada.expectedSopVersion
    || r.sop.configHash !== r.entrada.expectedToolConfigHash || r.sop.ferramentaLocal.limit !== r.entrada.limit
    || r.fonteEscolhida.itemId !== r.entrada.itemId || r.fonteEscolhida.versionId !== r.entrada.versionId || r.fonteEscolhida.contentHash !== r.entrada.contentHash
    || r.fonteEscolhida.versao > r.entrada.expectedItemVersion || r.passoPedidoId === r.passoFinalId || new Set(r.auditIds).size !== r.auditIds.length)
    throw new Error('O recibo não corresponde ao pedido desta pessoa e agente.');
  if (r.status === 'executada') {
    const v = r.resultado;
    if (JSON.stringify(r.fonteConsumida) !== JSON.stringify(r.fonteEscolhida) || v.itemId !== r.entrada.itemId || v.versionId !== r.entrada.versionId
      || v.versao !== r.fonteEscolhida.versao || v.contentHash !== r.entrada.contentHash || v.q !== r.entrada.q || v.limit !== r.entrada.limit
      || v.correspondencias.length > v.limit || v.totalLinhasComCorrespondencia < v.correspondencias.length
      || v.parcial !== (v.totalLinhasComCorrespondencia > v.correspondencias.length)
      || v.correspondencias.some((x, i, xs) => i > 0 && x.linha <= xs[i - 1].linha)) throw new Error('O resultado não corresponde à versão escolhida.');
  }
}
function conferirFontes(f: ProcedimentoLocalFontes, scope: Scope) {
  if (f.escopo.orgId !== scope.orgId || f.escopo.userId !== scope.actorId || f.escopo.agentId !== scope.agentId || f.escopo.agentSlug !== scope.agentSlug)
    throw new Error('As fontes não correspondem à pessoa e ao agente atuais.');
  for (const item of f.items) for (const v of item.versoes) {
    const m = v.retratoFonte;
    if (m.itemId !== item.id || m.versao.versionId !== v.id || m.versao.numero !== v.versao || m.versao.contentHash !== v.contentHash
      || m.versaoAtual !== item.versao || m.origem.tipo !== v.sourceType || m.origem.referencia !== v.sourceRef || m.title !== v.title)
      throw new Error('O retrato de uma fonte não pôde ser conferido.');
  }
}
function candidata(e: Escolha): boolean {
  const m = e.v.retratoFonte;
  return ['operador', 'vault'].includes(e.v.sourceType) && m.acesso.modelo === 'local_por_pessoa' && m.acesso.novoUsoPermitido && !m.arquivada;
}

export function FerramentaLocal({ slug, token, pessoaId, podeLer, podeExecutar, podeConfigurar, aoMudar }: {
  slug: string; token: string | null; pessoaId: string; podeLer: boolean; podeExecutar: boolean; podeConfigurar: boolean; aoMudar: () => void;
}) {
  const auth = useAuth();
  const [aberto, setAberto] = useState(false); const [busy, setBusy] = useState(false);
  const [painel, setPainel] = useState<ProcedimentoFerramentaLocalPainel | null>(null);
  const [observacao, setObservacao] = useState<{ p: ProcedimentoFerramentaLocalPainel; f: ProcedimentoLocalFontes } | null>(null);
  const [fontes, setFontes] = useState<ProcedimentoLocalFontes | null>(null); const [escolha, setEscolha] = useState<Escolha | null>(null);
  const [q, setQ] = useState(''); const [pedido, setPedido] = useState(''); const [limit, setLimit] = useState(5);
  const [pista, setPista] = useState<Pista | null>(null); const [ausencia, setAusencia] = useState(false);
  const [recibo, setRecibo] = useState<ProcedimentoFerramentaLocalRecibo | null>(null);
  const [atual, setAtual] = useState<Extract<ProcedimentoFerramentaLocalRecuperacao, { estado: 'confirmado' }>['disponibilidadeAtual'] | null>(null);
  const [aviso, setAviso] = useState(''); const [configIncerta, setConfigIncerta] = useState(false);
  const [outroPedidoConfirmado, setOutroPedidoConfirmado] = useState(false); const [epochDaLeitura, setEpochDaLeitura] = useState(-1);
  const generation = useRef(0); const lastInput = useRef<ProcedimentoFerramentaLocalPedido | null>(null);
  const identidade = { token, pessoaId, slug, user: auth.user, authToken: auth.token, ready: auth.ready, podeLer, podeExecutar, podeConfigurar };
  const corrente = useRef(identidade); corrente.current = identidade;
  const leituraPin = useRef<typeof identidade | null>(null);
  const identidadeIgual = (a: typeof identidade, b: typeof identidade) => a.token === b.token && a.authToken === b.authToken
    && a.user === b.user && a.ready === b.ready && a.pessoaId === b.pessoaId && a.slug === b.slug
    && a.podeLer === b.podeLer && a.podeExecutar === b.podeExecutar && a.podeConfigurar === b.podeConfigurar;
  const guard = () => {
    const pin = corrente.current; const epoch = generation.current;
    return () => corrente.current.token === pin.token && corrente.current.authToken === pin.authToken && corrente.current.user === pin.user
      && corrente.current.ready === pin.ready && corrente.current.pessoaId === pin.pessoaId && corrente.current.slug === pin.slug
      && corrente.current.podeLer === pin.podeLer && corrente.current.podeExecutar === pin.podeExecutar && corrente.current.podeConfigurar === pin.podeConfigurar
      && generation.current === epoch && pin.ready && pin.token === pin.authToken && pin.user?.id === pin.pessoaId;
  };
  function leituraValida() {
    return leituraPin.current !== null && epochDaLeitura === generation.current && identidadeIgual(leituraPin.current, corrente.current)
      && corrente.current.ready && corrente.current.token !== null && corrente.current.token === corrente.current.authToken
      && corrente.current.user?.id === corrente.current.pessoaId && corrente.current.podeLer;
  }
  function observar(p: ProcedimentoFerramentaLocalPainel, f: ProcedimentoLocalFontes) {
    leituraPin.current = corrente.current; setObservacao({ p, f }); setEpochDaLeitura(generation.current);
  }
  function adotarBaseObservada() {
    if (!observacao || !leituraValida() || busy || pista !== null && (!ausencia || recibo !== null)) return;
    if (painel && !mesmoScope(painel.escopo, observacao.p.escopo)) { invalidarLeitura(); return; }
    if (painel === null) setLimit(observacao.p.sop?.config?.limit ?? 5);
    setPainel(observacao.p); setFontes(observacao.f); setEscolha(null);
    setAviso('Base adotada por esta ação. Consulta, motivo e limite editado foram conservados; escolha novamente a fonte e a versão.');
  }
  function apagarPrivado() {
    leituraPin.current = null; setPainel(null); setObservacao(null); setFontes(null); setEscolha(null); setRecibo(null); setAtual(null);
    setQ(''); setPedido(''); setLimit(5); setOutroPedidoConfirmado(false); lastInput.current = null; setEpochDaLeitura(-1);
  }
  function invalidarLeitura() { generation.current++; apagarPrivado(); setAusencia(false); setBusy(false); }
  useEffect(() => {
    generation.current++; apagarPrivado(); setPista(null); setAusencia(false); setConfigIncerta(false); setBusy(false); setAviso(''); setAberto(false);
  }, [token, pessoaId, slug, auth.user, auth.token, auth.ready, podeLer, podeExecutar, podeConfigurar]);
  const base = `/agents/${encodeURIComponent(slug)}/procedimento/ferramenta`;
  function scopeValido(s: Scope, esperado?: Scope) {
    if (s.actorId !== pessoaId || s.agentSlug !== slug || esperado && !mesmoScope(s, esperado)) throw new Error('O escopo atual não pôde ser conferido.');
  }
  async function ler(esperado?: Scope) {
    const p = ProcedimentoFerramentaLocalPainelSchema.parse(await apiGet<unknown>(`${base}/painel`, token)); scopeValido(p.escopo, esperado);
    const f = ProcedimentoLocalFontesSchema.parse(await apiGet<unknown>(`/agents/${encodeURIComponent(slug)}/procedimento/fontes`, token)); conferirFontes(f, p.escopo);
    return { p, f };
  }
  function falhou(e: unknown) {
    if (e instanceof ConflitoDaBaseLocal) { setAviso(e.message); return; }
    if (e instanceof ErroDaApi && [400, 409].includes(e.status)) { setRecibo(null); setAtual(null); setAviso(e.message); return; }
    invalidarLeitura();
    setAviso(e instanceof ErroDaApi && [400, 403, 404, 409].includes(e.status) ? e.message : 'Não foi possível conferir o resultado. O identificador do pedido foi conservado.');
  }
  async function abrir() {
    setAberto(true); if (!podeLer || !token) { invalidarLeitura(); setAviso('A configuração visual precisa de acesso à base física do procedimento.'); return; }
    const valida = guard(); setBusy(true); setAviso('');
    try {
      const { p, f } = await ler(painel?.escopo); if (!valida()) return;
      const saved = localStorage.getItem(chave(p.escopo));
      let id: Pista | null = null;
      if (saved !== null) { id = PistaSchema.parse(JSON.parse(saved)); if (!mesmoScope(id, p.escopo)) throw new Error('Identificador incompatível com o escopo.'); }
      if (pista !== null && (id === null || id.requestId !== pista.requestId)) throw new Error('O identificador pendente não corresponde ao armazenamento atual.');
      observar(p, f); if (pista === null) setPista(id);
      setAviso('Leitura atual observada. Adotar esta base exige uma ação explícita.');
      if (id) setAviso('Existe um pedido neste agente. Confira sua recuperação antes de reenviar.');
    } catch (e) { if (valida()) { invalidarLeitura(); setAviso('A leitura não foi conferida. Nenhum novo pedido foi liberado.'); } }
    finally { if (valida()) setBusy(false); }
  }
  async function configurar(remover: boolean) {
    if (!leituraValida() || !painel?.sop || !podeConfigurar || !painel.autoridade.configurar || pista || busy) return;
    const chosen = painel; const valida = guard(); setBusy(true); let enviado = false;
    try {
      const { p, f } = await ler(chosen.escopo); if (!valida()) return;
      observar(p, f);
      if (!p.sop || p.sop.id !== chosen.sop!.id || p.sop.versao !== chosen.sop!.versao || p.sop.configHash !== chosen.sop!.configHash) throw new ConflitoDaBaseLocal('A base mudou. O rascunho foi conservado; adote a base observada explicitamente antes de salvar.');
      const input = ProcedimentoFerramentaLocalConfiguracaoSchema.parse({ expectedSopVersion: chosen.sop!.versao, expectedConfigHash: chosen.sop!.configHash,
        config: remover ? null : { schemaVersion: 1, capacidade: 'contexto.memoria.buscar', modo: 'literal_versao_escolhida_v1', consulta: 'pedido.q', limit, maxFonteBytes: 262144, maxTrechoPontos: 300 } });
      enviado = true;
      const r = ProcedimentoFerramentaLocalConfiguracaoResultadoSchema.parse(await apiPut<unknown>(`${base}/configuracao`, input, token)); if (!valida()) return;
      scopeValido(r.escopo, chosen.escopo);
      if (r.sopId !== chosen.sop!.id || r.versao !== chosen.sop!.versao + 1 || JSON.stringify(r.config) !== JSON.stringify(input.config)
        || (r.config === null) !== (r.configHash === null)) throw new Error('A confirmação da configuração não pôde ser conferida.');
      setPainel({ ...chosen, sop: { id: r.sopId, versao: r.versao, config: r.config, configHash: r.configHash } }); setObservacao(null); setConfigIncerta(false);
      setAviso('Configuração gravada na versão indicada. Faça nova leitura antes de executar.'); aoMudar();
    } catch (e) { if (valida()) { if (enviado) setConfigIncerta(true); falhou(e); if (enviado) setAviso('A configuração não foi confirmada. Releitura mostra o estado atual e não comprova a autoria deste envio.'); } }
    finally { if (valida()) setBusy(false); }
  }
  function confirmar(r: ProcedimentoFerramentaLocalRecibo, scope: Scope, id: string) {
    conferirRecibo(r, scope, id);
    setOutroPedidoConfirmado(lastInput.current !== null ? textoCanonicoDaFerramentaLocal(scope, lastInput.current) !== r.inputCanonico : q !== r.entrada.q || pedido !== r.entrada.pedido);
    setRecibo(r); setAusencia(false); setEpochDaLeitura(generation.current);
  }
  async function recuperar(sessionId?: string) {
    const chosen = painel ?? observacao?.p;
    if (!leituraValida() || !chosen || !pista || busy) return;
    const id = pista.requestId; const valida = guard(); setBusy(true);
    try {
      const p = ProcedimentoFerramentaLocalPainelSchema.parse(await apiGet<unknown>(`${base}/painel`, token)); if (!valida()) return; scopeValido(p.escopo, chosen.escopo);
      const route = sessionId ? `${base}/execucoes/${encodeURIComponent(sessionId)}` : `${base}/pedidos/${encodeURIComponent(id)}`;
      const r = ProcedimentoFerramentaLocalRecuperacaoSchema.parse(await apiGet<unknown>(route, token)); if (!valida()) return;
      scopeValido(r.escopo, chosen.escopo); if (r.requestId !== id || sessionId && (r.estado !== 'confirmado' || r.recibo.sessionId !== sessionId)) throw new Error('Recuperação incompatível.');
      if (r.estado === 'ausencia_conferida') { setRecibo(null); setAtual(null); setAusencia(true); setAviso('Ausência observada. O mesmo identificador foi mantido; um envio atrasado ainda pode chegar. Revise antes de reenviar explicitamente.'); }
      else { confirmar(r.recibo, chosen.escopo, id); setAtual(r.disponibilidadeAtual); setAviso('Recibo próprio conferido; disponibilidade atual apresentada separadamente.'); }
    } catch (e) { if (valida()) { setAusencia(false); falhou(e); } }
    finally { if (valida()) setBusy(false); }
  }
  async function executar() {
    if (!leituraValida() || !painel?.sop?.configHash || !painel.sop.config || !escolha || !podeExecutar || !painel.autoridade.executar || busy || configIncerta || pista && !ausencia) return;
    const chosen = painel; const source = escolha; const sop = painel.sop; const valida = guard(); setBusy(true);
    try {
      const { p, f } = await ler(chosen.escopo); if (!valida()) return;
      observar(p, f);
      const item = f.items.find((i) => i.id === source.item.id); const v = item?.versoes.find((x) => x.id === source.v.id);
      if (!item || !v || item.versao !== source.item.versao || item.chave !== source.item.chave
        || v.id !== source.v.id || v.title !== source.v.title || v.versao !== source.v.versao || v.contentHash !== source.v.contentHash
        || v.sourceType !== source.v.sourceType || v.sourceRef !== source.v.sourceRef || v.retratoFonte.chave !== source.v.retratoFonte.chave
        || !candidata({ item, v }) || !p.sop || p.sop.id !== sop.id || p.sop.versao !== sop.versao || p.sop.configHash !== sop.configHash
        || !p.inicioLocal.permitido) throw new ConflitoDaBaseLocal('A fonte, o procedimento ou a disponibilidade mudou. O rascunho e o identificador foram conservados; revise e adote a base observada explicitamente.');
      const requestId = pista?.requestId ?? crypto.randomUUID();
      const input = ProcedimentoFerramentaLocalPedidoSchema.parse({ requestId, pedido, q, limit: sop.config!.limit, itemId: source.item.id,
        versionId: source.v.id, contentHash: source.v.contentHash, expectedItemVersion: source.item.versao, expectedSopVersion: sop.versao, expectedToolConfigHash: sop.configHash });
      const identifier = PistaSchema.parse({ schemaVersion: 1, ...chosen.escopo, requestId, operation: 'ferramenta_memoria_v3' });
      const key = chave(chosen.escopo);
      if (!navigator.locks) throw new Error('Este navegador não permite reservar o identificador entre abas.');
      await navigator.locks.request(key, async () => {
        if (!valida()) throw new Error('A pessoa ou a sessão mudou.');
        const saved = localStorage.getItem(key);
        if (saved !== null) {
          const existing = PistaSchema.parse(JSON.parse(saved));
          if (!mesmoScope(existing, chosen.escopo) || existing.requestId !== requestId) throw new Error('Outro identificador permanece pendente neste agente.');
        }
        localStorage.setItem(key, JSON.stringify(identifier));
        if (localStorage.getItem(key) !== JSON.stringify(identifier)) throw new Error('Não foi possível conservar o identificador.');
      });
      if (!valida()) return; setPista(identifier); setAusencia(false); setRecibo(null); setAtual(null); lastInput.current = input;
      const r = ProcedimentoFerramentaLocalReciboSchema.parse(await apiPost<unknown>(`${base}/executar`, input, token)); if (!valida()) return;
      confirmar(r, chosen.escopo, requestId); setAviso('Recibo conferido. Um novo pedido exige uma nova ação explícita.');
    } catch (e) { if (valida()) falhou(e); }
    finally { if (valida()) setBusy(false); }
  }
  async function novoPedido() {
    const chosen = painel ?? observacao?.p;
    if (!leituraValida() || !chosen || !pista || !recibo || busy) return;
    if (outroPedidoConfirmado) { setOutroPedidoConfirmado(false); setAviso('O recibo original foi reconhecido. Agora você pode pedir uma nova busca.'); return; }
    const valida = guard();
    try {
      const key = chave(chosen.escopo); const saved = localStorage.getItem(key);
      if (!saved || !navigator.locks) throw new Error('O identificador não pôde ser conferido.');
      await navigator.locks.request(key, async () => {
        if (!valida()) throw new Error('A pessoa ou a sessão mudou.');
        const value = localStorage.getItem(key); if (value === null) throw new Error('O identificador mudou.');
        const existing = PistaSchema.parse(JSON.parse(value));
        if (!mesmoScope(existing, chosen.escopo) || existing.requestId !== pista.requestId) throw new Error('O identificador mudou.');
        localStorage.removeItem(key); if (localStorage.getItem(key) !== null) throw new Error('O identificador não foi removido.');
      });
      if (!valida()) return;
      setPista(null); setRecibo(null); setAtual(null); setAusencia(false); lastInput.current = null; setAviso('Novo pedido liberado por esta ação. Escolha e revise a versão.');
    } catch { if (valida()) setAviso('Não foi possível liberar um novo pedido. O identificador anterior foi mantido.'); }
  }
  const autorizado = auth.ready && auth.user?.id === pessoaId && token !== null && token === auth.token && podeLer;
  const visivel = autorizado && leituraValida();
  return <div className="mt-3 border-t border-border pt-3">
    <button type="button" className="text-xs text-brand" onClick={() => aberto ? setAberto(false) : void abrir()}>{aberto ? 'Fechar busca local' : 'Buscar na versão da fonte'}</button>
    {aberto && <div className="mt-3 space-y-3 text-xs">
      <h3 className="font-medium text-text">Busca local na versão escolhida</h3>
      <p className="text-muted">Uma consulta literal em uma versão persistida. Sem chamada de modelo ou conector.</p>
      {aviso && <p role="status" className="text-warn">{aviso}</p>}
      {!autorizado && <p className="text-warn">A leitura física deste procedimento não está disponível para a pessoa atual.</p>}
      {visivel && observacao && <section className="space-y-2 rounded-root border border-border p-3">
        <h4 className="font-medium">Base observada, separada do rascunho</h4>
        <p>SOP observada: {observacao.p.sop ? `v${observacao.p.sop.versao}` : 'ausente'} · estado observado {observacao.p.agente.estado}</p>
        <p className="text-muted">Adotar esta base troca a marca escolhida e pede uma nova escolha de fonte. Consulta, motivo e limite já editado ficam no rascunho.</p>
        <button disabled={busy || pista !== null && (!ausencia || recibo !== null)} type="button" className="text-brand disabled:opacity-40" onClick={adotarBaseObservada}>Adotar esta base para o rascunho</button>
      </section>}
      {visivel && painel && <>
        <p className="text-muted">Base escolhida do rascunho: SOP {painel.sop ? `v${painel.sop.versao}` : 'ausente'} · estado na leitura {painel.agente.estado}</p>
        {painel.inicioLocal.impedimentosLocais.map((x) => <p key={x} className="text-warn">{x}</p>)}
        <button disabled={busy} type="button" className="text-brand disabled:opacity-40" onClick={() => void abrir()}>Reler base e fontes</button>
        {painel.sop && podeConfigurar && painel.autoridade.configurar && <fieldset disabled={busy || pista !== null} className="space-y-2 rounded-root border border-border p-3">
          <legend>Configuração escolhida</legend>
          <label className="block">Máximo de linhas retornadas <input type="number" min={1} max={10} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={classe} /></label>
          <button type="button" className="mr-3 text-brand" onClick={() => void configurar(false)}>Gravar perfil na SOP escolhida</button>
          <button type="button" className="text-warn" onClick={() => void configurar(true)}>Remover configuração explicitamente</button>
          {configIncerta && <p>Envio incerto. A releitura não identifica quem alterou a configuração.</p>}
        </fieldset>}
        <fieldset disabled={busy || configIncerta || !!pista && !ausencia || !!recibo} className="space-y-2">
          <label className="block">Fonte e versão <select className={classe} value={escolha ? `${escolha.item.id}:${escolha.v.id}` : ''} onChange={(e) => {
            const [itemId, versionId] = e.target.value.split(':'); const item = fontes?.items.find((i) => i.id === itemId); const v = item?.versoes.find((x) => x.id === versionId);
            setEscolha(item && v ? { item, v } : null);
          }}><option value="">Escolha uma versão</option>{fontes?.items.flatMap((item) => item.versoes.map((v) => <option key={v.id} value={`${item.id}:${v.id}`} disabled={!candidata({ item, v })}>{item.title} · v{v.versao} · {v.sourceType}</option>))}</select></label>
          {escolha && <p className="text-muted">Versão escolhida v{escolha.v.versao}; nota atual v{escolha.item.versao}. Elegibilidade local a conferir no servidor.</p>}
          <p className="text-muted">Rascunho da próxima proposta, separado da entrada registrada no recibo.</p>
          <label className="block">Motivo do pedido <textarea className={classe} value={pedido} maxLength={2000} onChange={(e) => setPedido(e.target.value)} /></label>
          <label className="block">Consulta literal <input className={classe} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <button type="button" className="text-brand disabled:opacity-40" disabled={!escolha || !painel.sop?.config || !painel.inicioLocal.permitido || !podeExecutar || !painel.autoridade.executar}
            onClick={() => void executar()}>{pista ? 'Reenviar explicitamente com o mesmo identificador' : 'Executar esta busca'}</button>
        </fieldset>
      </>}
        {visivel && pista && <div className="space-y-2"><p className="font-os-mono text-dim">Pedido {pista.requestId}</p>
          <button disabled={busy} type="button" className="text-brand" onClick={() => void recuperar()}>Conferir recuperação deste pedido</button>
          {recibo && <button disabled={busy} type="button" className="ml-3 text-brand" onClick={() => void recuperar(recibo.sessionId)}>Reler execução própria</button>}
        </div>}
        {visivel && recibo && <section className="space-y-2 rounded-root border border-border p-3">
          <h4 className="font-medium">{recibo.status === 'executada' ? 'Busca executada' : 'Pedido recusado sem chamar a ferramenta'}</h4>
          <div className="space-y-1 border-b border-border pb-2">
            <h5 className="font-medium">Entrada original registrada neste pedido</h5>
            <p>Consulta literal:</p><pre className="whitespace-pre-wrap break-words">{recibo.entrada.q}</pre>
            <p>Motivo:</p><pre className="whitespace-pre-wrap break-words">{recibo.entrada.pedido}</pre>
            <p>Fonte: {recibo.fonteEscolhida.title} · versão escolhida v{recibo.fonteEscolhida.versao} · limite {recibo.entrada.limit} · SOP v{recibo.sop.versao}</p>
            <p className="text-dim">Esta entrada pertence ao recibo confirmado e não confirma o rascunho exibido acima.</p>
          </div>
          {outroPedidoConfirmado && <p className="text-warn">Um envio anterior com este identificador confirmou outra proposta. Este é o recibo original.</p>}
          {recibo.status === 'recusada' ? <p>{recibo.motivoCode}</p> : <>
            <p>{recibo.resultado.totalLinhasComCorrespondencia} linha(s) nesta versão contêm a consulta. {recibo.resultado.parcial ? 'Resultado parcial pelo limite escolhido.' : 'Todas as linhas correspondentes foram retornadas.'}</p>
            {recibo.resultado.correspondencias.map((x) => <div key={x.linha} className="border-t border-border pt-2"><p>Linha {x.linha}{x.corteInicio || x.corteFim ? ' · trecho recortado' : ''}</p><pre className="whitespace-pre-wrap break-words text-muted">{x.trecho}</pre></div>)}
          </>}
          {atual && <p className="text-dim">Disponibilidade atual, separada do consumo: v{atual.fonte.versaoAtual}; {atual.fonte.arquivada ? 'arquivada' : 'não arquivada'}; {atual.fonte.novoUsoPermitido ? 'novo uso elegível' : 'novo uso indisponível'}.</p>}
          <p className="text-dim">Histórico amplo: conteúdo V3 não conferido por essa superfície; consulta e trechos ficam nesta rota própria.</p>
          <Link className="text-brand" href={`/sessoes/${encodeURIComponent(recibo.sessionId)}`}>Metadados gerais da sessão</Link>
          <button disabled={busy} type="button" className="ml-3 text-brand" onClick={() => void novoPedido()}>{outroPedidoConfirmado ? 'Reconhecer o recibo original' : 'Preparar um novo pedido'}</button>
        </section>}
    </div>}
  </div>;
}
