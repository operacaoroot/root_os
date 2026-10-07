'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPost, ErroDaApi } from '@/lib/api';
interface Fonte { id: string; title: string; chave: string; versao: number; versoes: { id: string; title: string; versao: number; contentHash: string }[] }
interface Fontes { items: Fonte[]; modelo: { disponivel: boolean; modelo: string | null; motivo: string | null } }
interface Pedido { requestId: string; pedido: string; itemId: string; versionId: string; contentHash: string; expectedItemVersion: number }
interface Execucao { id: string; status: string; motivo: string | null; resposta: string | null;
  modeloConfigurado: string | null; modeloUsado: string | null;
  fonte: { itemId: string; versionId: string; title: string; versao: number; contentHash: string };
  consumo: { tokensIn: number | null; tokensOut: number | null; custoExternoUsd: number; custoMaquinaMedido: boolean } }
const campo = 'mt-1 w-full rounded border border-border bg-bg px-2 py-2 text-sm';
export function ExecucaoLocal({ slug, token, pessoaId, podeExecutar }: { slug: string; token: string | null; pessoaId: string; podeExecutar: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [fontes, setFontes] = useState<Fontes | null>(null);
  const [itemId, setItemId] = useState(''); const [versionId, setVersionId] = useState('');
  const [pedido, setPedido] = useState(''); const [pendente, setPendente] = useState<Pedido | null>(null);
  const [execucao, setExecucao] = useState<Execucao | null>(null); const [erro, setErro] = useState<string | null>(null);
  const [conflito, setConflito] = useState(false);
  const [ocupado, setOcupado] = useState(false); const generation = useRef(0);
  const storage = `rootos:execucao-agente:${pessoaId}:${slug}`;
  const ultima = `${storage}:ultima`;
  function limparSessaoRecusada(e: unknown) {
    if (!(e instanceof ErroDaApi) || e.status !== 401) return;
    generation.current++; setFontes(null); setExecucao(null); setPendente(null);
    setItemId(''); setVersionId(''); setPedido(''); setConflito(false); setOcupado(false);
  }
  useEffect(() => {
    generation.current++; setFontes(null); setExecucao(null); setErro(null); setPendente(null); setItemId(''); setVersionId(''); setPedido(''); setOcupado(false); setConflito(false);
    if (!aberto) return;
    const atual = generation.current;
    try { const p = JSON.parse(localStorage.getItem(storage) ?? 'null');
      if (p?.requestId && p?.versionId && p?.itemId && p?.contentHash && typeof p?.pedido === 'string') { setPendente(p); setItemId(p.itemId); setVersionId(p.versionId); setPedido(p.pedido); }
    } catch { /* Dados incompletos não são enviados. */ }
    apiGet<Fontes>(`/agents/${slug}/procedimento/fontes`, token).then((r) => { if (generation.current === atual) setFontes(r); }).catch((e) => { if (generation.current === atual) { setErro(e.message); limparSessaoRecusada(e); } });
    const id = localStorage.getItem(ultima);
    if (id) apiGet<Execucao>(`/agents/${slug}/procedimento/execucoes/${id}`, token).then((r) => { if (generation.current === atual) setExecucao(r); }).catch((e) => { if (generation.current === atual) { setExecucao(null); setErro(e.message); limparSessaoRecusada(e); } });
    return () => { generation.current++; };
  }, [aberto, slug, token, storage, ultima]);
  const fonte = fontes?.items.find((i) => i.id === itemId);
  const versao = fonte?.versoes.find((v) => v.id === versionId);
  async function conferirExecucao() {
    if (!execucao) return; const atual = generation.current; setOcupado(true); setErro(null);
    try { const r = await apiGet<Execucao>(`/agents/${slug}/procedimento/execucoes/${execucao.id}`, token); if (generation.current === atual) setExecucao(r); }
    catch (e) { if (generation.current === atual) { setExecucao(null); setFontes(null); setErro((e as Error).message); limparSessaoRecusada(e); } }
    finally { if (generation.current === atual) setOcupado(false); }
  }
  async function atualizarFonte() {
    const atual = ++generation.current; setOcupado(true);
    try {
      const r = await apiGet<Fontes>(`/agents/${slug}/procedimento/fontes`, token);
      if (generation.current !== atual) return;
      setFontes(r); setPendente(null); localStorage.removeItem(storage); setConflito(false); setErro(null);
    } catch (e) {
      if (generation.current === atual) { setFontes(null); setErro((e as Error).message); limparSessaoRecusada(e); }
    } finally { if (generation.current === atual) setOcupado(false); }
  }
  async function executar() {
    if (!pendente && (!fonte || !versao || !pedido.trim())) return;
    const input = pendente ?? { requestId: crypto.randomUUID(), pedido: pedido.trim(), itemId, versionId,
      contentHash: versao!.contentHash, expectedItemVersion: fonte!.versao };
    const atual = generation.current; setPendente(input); localStorage.setItem(storage, JSON.stringify(input)); setOcupado(true); setErro(null);
    try { const r = await apiPost<Execucao>(`/agents/${slug}/procedimento/executar`, input, token);
      if (generation.current !== atual) return;
      setExecucao(r); setPendente(null); localStorage.removeItem(storage); localStorage.setItem(ultima, r.id);
    } catch (e) { if (generation.current === atual) { setErro((e as Error).message);
      if (e instanceof ErroDaApi && e.status === 409) setConflito(true);
      if (e instanceof ErroDaApi && [403, 404].includes(e.status)) { setExecucao(null); setFontes(null); }
      limparSessaoRecusada(e);
    } } finally { if (generation.current === atual) setOcupado(false); }
  }
  return <div className="mt-3 border-t border-border pt-3">
    <button type="button" onClick={() => setAberto(!aberto)} className="text-sm text-brand">{aberto ? 'Fechar execução local' : 'Abrir procedimento local'}</button>
    {aberto && <section className="mt-3 space-y-3" aria-label="Procedimento local">
      <p className="text-sm text-muted">Ler uma versão, preparar uma síntese com o modelo local e registrar o resultado. Este procedimento não executa ferramentas externas.</p>
      {fontes && <p className="text-sm">Modelo disponível: {fontes.modelo.disponivel ? fontes.modelo.modelo : fontes.modelo.motivo}</p>}
      {erro && <p role="alert" className="text-bad">{erro}</p>}
      {pendente && <p role="status" className="text-sm">Pedido anterior preservado. Confira o mesmo pedido antes de iniciar outro.</p>}
      <fieldset className="space-y-2" disabled={ocupado || !!pendente || !!execucao || !podeExecutar}>
        <label className="block">Fonte do procedimento<select className={campo} value={itemId} onChange={(e) => { setItemId(e.target.value); setVersionId(''); }}>
          <option value="">Escolha uma fonte</option>{fontes?.items.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
        </select></label>
        <label className="block">Versão da fonte<select className={campo} value={versionId} onChange={(e) => setVersionId(e.target.value)}>
          <option value="">Escolha uma versão</option>{fonte?.versoes.map((v) => <option key={v.id} value={v.id}>v{v.versao} · {v.title}</option>)}
        </select></label>
        <label className="block">Pedido para o agente<textarea className={campo} value={pedido} maxLength={2000} onChange={(e) => setPedido(e.target.value)} /></label>
      </fieldset>
      {conflito && <button type="button" className="text-sm text-brand" disabled={ocupado} onClick={atualizarFonte}>Atualizar fonte e preparar novo pedido</button>}
      {podeExecutar && <button type="button" disabled={ocupado || !!execucao || (!pendente && (!fonte || !versao || !pedido.trim()))}
        className="rounded bg-brand px-3 py-2 text-sm text-ink disabled:opacity-50" onClick={executar}>
        {ocupado ? 'Conferindo…' : pendente ? 'Conferir pedido anterior' : 'Iniciar procedimento local'}</button>}
      {execucao && podeExecutar && <button type="button" onClick={() => { setExecucao(null); setPedido(''); localStorage.removeItem(ultima); }} className="text-sm text-brand">Preparar novo pedido</button>}
      {execucao && <div className="space-y-2 rounded border border-border p-3" aria-label="Resultado do procedimento">
        <p>Execução: <span className="font-os-mono">{execucao.id}</span></p><p>Situação: {execucao.status}</p>
        {execucao.motivo && <p>{execucao.motivo}</p>}
        {execucao.resposta && <p className="whitespace-pre-wrap">{execucao.resposta}</p>}
        <Link className="text-brand" href={`/contexto?nota=${execucao.fonte.itemId}&versao=${execucao.fonte.versionId}`}>Abrir fonte usada · v{execucao.fonte.versao}</Link>
        <p className="text-sm">Modelo configurado: {execucao.modeloConfigurado ?? 'não definido'} · usado: {execucao.modeloUsado ?? 'nenhuma chamada concluída'}</p>
        <p className="text-sm">Tokens observados: entrada {execucao.consumo.tokensIn ?? 'não informado'} · saída {execucao.consumo.tokensOut ?? 'não informado'}.</p>
        <p className="text-sm">Sem cobrança de provedor externo. Consumo da máquina não medido.</p>
        <button type="button" onClick={conferirExecucao} disabled={ocupado} className="text-sm text-brand">Conferir execução e acesso</button>
      </div>}
    </section>}
  </div>;
}
