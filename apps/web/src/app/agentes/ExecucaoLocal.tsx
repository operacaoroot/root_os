'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { M05EscopoDto, M05FonteAutorizadaDto, M05CapacidadesExecutorDto } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { RetratoDaFonte, RecuperacaoIndisponivel, escopoConfere, retratoConfere, chaveDoPedido, lerIdentificador, guardarIdentificador, removerIdentificador, migrarPedidoLegado, type IdentificadorDePedido } from '@/app/contexto/RetratoDaFonte';
interface Versao { id: string; title: string; versao: number; contentHash: string; retratoFonte: M05FonteAutorizadaDto }
interface Fonte { id: string; title: string; chave: string; versao: number; versoes: Versao[] }
interface Fontes { items: Fonte[]; modelo: { disponivel: boolean; modelo: string | null; motivo: string | null }; escopo: M05EscopoDto; capacidadesExecutor: M05CapacidadesExecutorDto }
interface Pedido { requestId: string; pedido: string; itemId: string; versionId: string; contentHash: string; expectedItemVersion: number }
interface Execucao { id: string; requestId: string; pedido?: string; status: string; motivo: string | null; resposta: string | null;
  escopo: M05EscopoDto; retratoFonte: M05FonteAutorizadaDto; capacidadesExecutor: M05CapacidadesExecutorDto;
  modeloConfigurado: string | null; modeloUsado: string | null;
  fonte: { itemId: string; versionId: string; title: string; versao: number; contentHash: string };
  consumo: { tokensIn: number | null; tokensOut: number | null; custoExternoUsd: number; custoMaquinaMedido: boolean } }
const campo = 'mt-1 w-full rounded border border-border bg-bg px-2 py-2 text-sm';
const recusada = (e: unknown) => [401, 403, 404].includes((e as { status?: number }).status ?? 0);
type Props = { slug: string; token: string | null; pessoaId: string; podeExecutar: boolean };
export function ExecucaoLocal(props: Props) { return <ExecucaoAutorizada key={`${props.token}:${props.pessoaId}:${props.slug}`} {...props} />; }
function ExecucaoAutorizada({ slug, token, pessoaId, podeExecutar }: Props) {
  const [aberto, setAberto] = useState(false), [fontes, setFontes] = useState<Fontes | null>(null);
  const [itemId, setItemId] = useState(''), [versionId, setVersionId] = useState(''), [pedido, setPedido] = useState('');
  const [pendente, setPendente] = useState<IdentificadorDePedido | null>(null), [execucao, setExecucao] = useState<Execucao | null>(null);
  const [anteriorPendente, setAnteriorPendente] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null), [conflito, setConflito] = useState(false), [ocupado, setOcupado] = useState(false);
  const generation = useRef(0), escopo = useRef<M05EscopoDto | null>(null), input = useRef<Pedido | null>(null), escrita = useRef(false);
  function privar() {
    generation.current++; escrita.current = false; input.current = null;
    setFontes(null); setExecucao(null); setItemId(''); setVersionId(''); setPedido(''); setConflito(false); setOcupado(false);
    setErro('Procedimento não disponível para esta conta.');
  }
  function capacidadesConferem(c: M05CapacidadesExecutorDto | undefined, e: M05EscopoDto) {
    return !!c && c.modo === 'sintese_local_sem_ferramentas' && c.agente?.id === e.agentId && c.agente.slug === slug
      && c.modelo?.provider === 'llama.cpp-local' && c.capacidades?.lerVersao === true && c.capacidades.sintetizarLocalmente === true
      && c.capacidades.registrarResultado === true && c.capacidades.ferramentasExternas === false && c.capacidades.agendamento === false && c.capacidades.cancelarInferencia === false;
  }
  function aceitarFontes(r: Fontes) {
    if (!escopoConfere(r.escopo, pessoaId, escopo.current, slug) || !capacidadesConferem(r.capacidadesExecutor, r.escopo)
      || !Array.isArray(r.items) || r.items.some((f) => !Array.isArray(f.versoes) || f.versoes.some((v) => !retratoConfere(v.retratoFonte, { itemId: f.id, versionId: v.id, versao: v.versao, contentHash: v.contentHash, chave: f.chave, title: v.title, body: null })))) { privar(); return false; }
    escopo.current = r.escopo; setFontes(r); return true;
  }
  function aceitarExecucao(r: Execucao, id: IdentificadorDePedido, original?: Pedido | null) {
    if (!escopoConfere(r.escopo, pessoaId, escopo.current, slug) || !capacidadesConferem(r.capacidadesExecutor, r.escopo) || r.requestId !== id.requestId
      || !r.id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(r.requestId) || !r.fonte || !retratoConfere(r.retratoFonte, r.fonte)
      || (original && (r.fonte.itemId !== original.itemId || r.fonte.versionId !== original.versionId || r.fonte.contentHash !== original.contentHash))) { privar(); return false; }
    setExecucao(r); setPendente(null); input.current = null; setConflito(false); setErro(null); return true;
  }
  function sessaoAnterior(e: M05EscopoDto): string | null {
    const chave = `${chaveDoPedido(e, 'procedimento')}:sessao`, antiga = `rootos:execucao-agente:${pessoaId}:${slug}:ultima`;
    try {
      const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
      const valor = localStorage.getItem(antiga);
      if (valor && uuid.test(valor)) {
        try { localStorage.setItem(chave, JSON.stringify({ ...e, sessionId: valor })); removerIdentificador(antiga); }
        catch { return valor; }
      } else if (valor) removerIdentificador(antiga);
      const r: (M05EscopoDto & { sessionId: string }) | null = JSON.parse(localStorage.getItem(chave) ?? 'null');
      return r && Object.keys(r).every((k) => ['orgId', 'userId', 'agentId', 'agentSlug', 'sessionId'].includes(k)) && escopoConfere(r, pessoaId, e, slug) && uuid.test(r.sessionId) ? r.sessionId : null;
    } catch { throw new RecuperacaoIndisponivel(); }
  }
  async function conferirAnterior(sessionId: string, atual = generation.current) {
    setOcupado(true); setErro(null); setAnteriorPendente(sessionId);
    try {
      const r = await apiGet<Execucao>(`/agents/${encodeURIComponent(slug)}/procedimento/execucoes/${encodeURIComponent(sessionId)}`, token);
      if (generation.current !== atual) return;
      if (r.id !== sessionId || !escopo.current) { privar(); return; }
      const id: IdentificadorDePedido = { ...escopo.current, requestId: r.requestId, operation: 'procedimento' };
      if (aceitarExecucao(r, id)) {
        guardarIdentificador(chaveDoPedido(escopo.current, 'procedimento'), id);
        removerIdentificador(`${chaveDoPedido(escopo.current, 'procedimento')}:sessao`); setAnteriorPendente(null);
      }
    } catch (e) { if (generation.current !== atual) return; if (recusada(e) || e instanceof RecuperacaoIndisponivel) { privar(); if (e instanceof RecuperacaoIndisponivel) setErro(e.message); } else setErro((e as Error).message); }
    finally { if (generation.current === atual) setOcupado(false); }
  }
  async function conferirPedido(id: IdentificadorDePedido, atual = generation.current) {
    setOcupado(true); setErro(null);
    try {
      const r = await apiGet<Execucao>(`/agents/${encodeURIComponent(slug)}/procedimento/pedidos/${encodeURIComponent(id.requestId)}`, token);
      if (generation.current === atual) aceitarExecucao(r, id, input.current);
    } catch (e) {
      if (generation.current !== atual) return;
      if (recusada(e) || e instanceof RecuperacaoIndisponivel) { privar(); setPendente(id); if (e instanceof RecuperacaoIndisponivel) setErro(e.message); } else setErro((e as Error).message);
    } finally { if (generation.current === atual) setOcupado(false); }
  }
  useEffect(() => {
    if (!aberto) return;
    const atual = ++generation.current;
    setFontes(null); setExecucao(null); setErro(null); setOcupado(true);
    apiGet<Fontes>(`/agents/${encodeURIComponent(slug)}/procedimento/fontes`, token).then(async (r) => {
      if (generation.current !== atual || !aceitarFontes(r)) return;
      const migrado = migrarPedidoLegado(`rootos:execucao-agente:${pessoaId}:${slug}`, chaveDoPedido(r.escopo, 'procedimento'), r.escopo, 'procedimento');
      const id = lerIdentificador(chaveDoPedido(r.escopo, 'procedimento'), r.escopo, 'procedimento') ?? migrado;
      const anterior = sessaoAnterior(r.escopo);
      if (id) { setPendente(id); await conferirPedido(id, atual); }
      else if (anterior) await conferirAnterior(anterior, atual);
    }).catch((e) => { if (generation.current !== atual) return; if (recusada(e) || e instanceof RecuperacaoIndisponivel) { privar(); if (e instanceof RecuperacaoIndisponivel) setErro(e.message); } else setErro(e.message); })
      .finally(() => { if (generation.current === atual) setOcupado(false); });
    return () => { generation.current++; };
  }, [aberto, slug, token, pessoaId]);
  const fonte = fontes?.items.find((i) => i.id === itemId), versao = fonte?.versoes.find((v) => v.id === versionId);
  const capacidades = execucao?.capacidadesExecutor ?? fontes?.capacidadesExecutor;
  async function conferirExecucao() {
    if (!execucao || !escopo.current) return; const atual = generation.current; setOcupado(true); setErro(null);
    const id: IdentificadorDePedido = { ...escopo.current, requestId: execucao.requestId, operation: 'procedimento' };
    try { const r = await apiGet<Execucao>(`/agents/${encodeURIComponent(slug)}/procedimento/execucoes/${encodeURIComponent(execucao.id)}`, token); if (generation.current === atual) aceitarExecucao(r, id); }
    catch (e) { if (generation.current !== atual) return; if (recusada(e) || e instanceof RecuperacaoIndisponivel) { privar(); if (e instanceof RecuperacaoIndisponivel) setErro(e.message); } else { setExecucao(null); setErro((e as Error).message); } }
    finally { if (generation.current === atual) setOcupado(false); }
  }
  async function atualizarFonte() {
    const atual = ++generation.current; escrita.current = false; setOcupado(true); setErro(null);
    try { const r = await apiGet<Fontes>(`/agents/${encodeURIComponent(slug)}/procedimento/fontes`, token); if (generation.current === atual) aceitarFontes(r); }
    catch (e) { if (generation.current !== atual) return; if (recusada(e) || e instanceof RecuperacaoIndisponivel) { privar(); if (e instanceof RecuperacaoIndisponivel) setErro(e.message); } else { setFontes(null); setErro((e as Error).message); } }
    finally { if (generation.current === atual) setOcupado(false); }
  }
  async function executar(repetir = false) {
    if (!podeExecutar || !token || !escopo.current || escrita.current || ocupado || execucao || conflito) return;
    if (!repetir && (pendente || anteriorPendente || !fonte || !versao || !pedido.trim() || !capacidades?.novasExecucoesPermitidas || !versao.retratoFonte.acesso.novoUsoPermitido)) return;
    const dados = repetir ? input.current : { requestId: crypto.randomUUID(), pedido: pedido.trim(), itemId, versionId, contentHash: versao!.contentHash, expectedItemVersion: fonte!.versao };
    if (!dados) return;
    const id: IdentificadorDePedido = { ...escopo.current, requestId: dados.requestId, operation: 'procedimento' };
    if (!guardarIdentificador(chaveDoPedido(escopo.current, 'procedimento'), id)) { setErro('Não foi possível guardar o identificador. O pedido não foi enviado.'); return; }
    const atual = generation.current; input.current = dados; setPendente(id); escrita.current = true; setOcupado(true); setErro(null);
    try { const r = await apiPost<Execucao>(`/agents/${encodeURIComponent(slug)}/procedimento/executar`, dados, token); if (generation.current === atual) aceitarExecucao(r, id, dados); }
    catch (e) { if (generation.current !== atual) return; if (recusada(e) || e instanceof RecuperacaoIndisponivel) { privar(); if (e instanceof RecuperacaoIndisponivel) setErro(e.message); } else { setErro((e as Error).message); if ((e as { status?: number }).status === 409) setConflito(true); } }
    finally { if (generation.current === atual) { escrita.current = false; setOcupado(false); } }
  }
  return <div className="mt-3 border-t border-border pt-3">
    <button type="button" onClick={() => setAberto(!aberto)} className="text-sm text-brand">{aberto ? 'Fechar execução local' : 'Abrir procedimento local'}</button>
    {aberto && <section className="mt-3 space-y-3" aria-label="Procedimento local">
      <p className="text-sm text-muted">Ler uma versão, preparar uma síntese com o modelo local e registrar o resultado.</p>
      {capacidades && <div className="space-y-1 text-sm"><p>Estado do agente: {capacidades.agente.estado}</p><p>Modelo disponível: {capacidades.modelo.disponivel ? capacidades.modelo.modelo : capacidades.modelo.motivo ?? 'indisponível'}</p><p>Capacidades: leitura de versão, síntese local e registro do resultado.</p><p>Ferramentas externas e agenda indisponíveis. Pausar impede novo uso; uma inferência já enviada pode ter consumido tokens.</p>{!capacidades.novasExecucoesPermitidas && <p>{capacidades.impedimento ?? 'Novas execuções indisponíveis.'}</p>}</div>}
      {erro && <p role="alert" className="text-bad">{erro}</p>}
      {anteriorPendente && <div className="space-y-2"><p role="status">Execução anterior sem confirmação. Confira o registro antes de iniciar outro pedido.</p><button type="button" className="text-brand" disabled={ocupado} onClick={() => void conferirAnterior(anteriorPendente)}>Conferir execução anterior</button></div>}
      {pendente && <div className="space-y-2"><p role="status" className="text-sm">Pedido sem confirmação. Confira o pedido original antes de iniciar outro.</p><button type="button" disabled={ocupado} className="text-sm text-brand" onClick={() => void conferirPedido(pendente)}>Conferir pedido anterior</button>{input.current && !conflito && <button type="button" disabled={ocupado || !podeExecutar} className="ml-3 text-sm text-brand" onClick={() => void executar(true)}>Reenviar mesmo pedido</button>}</div>}
      <fieldset className="space-y-2" disabled={ocupado || !!pendente || !!anteriorPendente || !!execucao || !podeExecutar || !fontes}>
        <label className="block">Fonte do procedimento<select className={campo} value={itemId} onChange={(e) => { setItemId(e.target.value); setVersionId(''); }}><option value="">Escolha uma fonte</option>{fontes?.items.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label>
        <label className="block">Versão da fonte<select className={campo} value={versionId} onChange={(e) => setVersionId(e.target.value)}><option value="">Escolha uma versão</option>{fonte?.versoes.map((v) => <option key={v.id} value={v.id}>v{v.versao} · {v.title}</option>)}</select></label>
        <label className="block">Pedido para o agente<textarea className={campo} value={pedido} maxLength={2000} onChange={(e) => setPedido(e.target.value)} /></label>
      </fieldset>
      {versao && !execucao && <RetratoDaFonte fonte={versao.retratoFonte} />}
      {fontes && <button type="button" className="text-sm text-brand" disabled={ocupado} onClick={() => void atualizarFonte()}>{conflito ? 'Atualizar fonte e conferir pedido' : 'Conferir fontes e acesso'}</button>}
      {podeExecutar && !pendente && !anteriorPendente && <button type="button" disabled={ocupado || !!execucao || conflito || !fonte || !versao || !pedido.trim() || !capacidades?.novasExecucoesPermitidas || !versao.retratoFonte.acesso.novoUsoPermitido} className="rounded bg-brand px-3 py-2 text-sm text-ink disabled:opacity-50" onClick={() => void executar()}>Iniciar procedimento local</button>}
      {execucao && podeExecutar && <button type="button" onClick={() => { if (!escopo.current) return; const chave = chaveDoPedido(escopo.current, 'procedimento'); removerIdentificador(chave); setPendente(lerIdentificador(chave, escopo.current, 'procedimento')); setExecucao(null); setPedido(''); setItemId(''); setVersionId(''); const anterior = sessaoAnterior(escopo.current); if (anterior) void conferirAnterior(anterior); }} className="text-sm text-brand">Preparar novo pedido</button>}
      {execucao && <div className="space-y-2 rounded border border-border p-3" aria-label="Resultado do procedimento">
        <p>Execução: <span className="font-os-mono">{execucao.id}</span></p><p>Situação: {execucao.status}</p>{execucao.motivo && <p>{execucao.motivo}</p>}{execucao.resposta && <p className="whitespace-pre-wrap">{execucao.resposta}</p>}
        <RetratoDaFonte fonte={execucao.retratoFonte} usada />
        <Link className="text-brand" href={`/contexto?nota=${encodeURIComponent(execucao.fonte.itemId)}&versao=${encodeURIComponent(execucao.fonte.versionId)}`}>Abrir fonte usada · v{execucao.fonte.versao}</Link>
        <p className="text-sm">Modelo configurado: {execucao.modeloConfigurado ?? 'não definido'} · usado: {execucao.modeloUsado ?? 'nenhuma chamada concluída'}</p>
        <p className="text-sm">Tokens observados: entrada {execucao.consumo.tokensIn ?? 'não informado'} · saída {execucao.consumo.tokensOut ?? 'não informado'}.</p><p className="text-sm">Sem cobrança de provedor externo. Consumo da máquina não medido.</p>
        <button type="button" onClick={() => void conferirExecucao()} disabled={ocupado} className="text-sm text-brand">Conferir execução e acesso</button>
      </div>}
    </section>}
  </div>;
}
