'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Fonte = {
  id: string; nome: string; tipo: 'pasta' | 'arquivo'; raizLogica: string;
  incluir: string[]; excluir: string[]; tiposPermitidos: string[];
  modo: 'importacao' | 'sincronizacao'; regraExclusao: 'ignorar' | 'arquivar';
  tamanhoMaximo: number; escopoVersao: number; revokedAt: string | null;
  ultimaRemessaTentativaEm: string | null; ultimaRemessaSucessoEm: string | null;
  ultimaRemessaStatus: string | null; ultimaRemessaItens: number | null; ultimaRemessaErros: number | null;
};

type Dispositivo = {
  id: string; nome: string; createdAt: string; lastSeenAt: string | null;
  revokedAt: string | null; fonteIds: string[];
};

const INSTRUCAO_CLI = 'python3 -B tools/conector-local/cli.py --help\npython3 -B tools/conector-local/cli.py --api <URL_HTTPS_DA_API> pair --org-id <ORG_ID> --pairing-id <PAIRING_ID> --name "Este dispositivo"\n# O cliente atual faz somente importação consentida; sincronização contínua ainda não está habilitada.';

function idade(iso: string | null): string {
  if (!iso) return 'ainda não visto';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'agora';
  const minutos = Math.floor(ms / 60_000);
  return minutos < 60 ? `${minutos} min atrás` : `${Math.floor(minutos / 60)} h atrás`;
}

/** Painel humano da fonte lógica; não cria nem acessa uma raiz local. */
export function ConectorLocal() {
  const { token, can } = useAuth();
  const autorizado = can('admin.permissoes') && can('obsidian.editar');
  const tokenRef = useRef(token);
  if (tokenRef.current !== token) tokenRef.current = token;
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'pasta' | 'arquivo'>('pasta');
  const [raizLogica, setRaizLogica] = useState('');
  const [incluir, setIncluir] = useState('**/*.md');
  const [excluir, setExcluir] = useState('');
  const [tipos, setTipos] = useState('.md');
  const [modo, setModo] = useState<'importacao' | 'sincronizacao'>('importacao');
  const [regraExclusao, setRegraExclusao] = useState<'ignorar' | 'arquivar'>('ignorar');
  const [tamanhoMaximo, setTamanhoMaximo] = useState('2097152');
  const [dispositivoNome, setDispositivoNome] = useState('');
  const [fontesDoCodigo, setFontesDoCodigo] = useState<string[]>([]);
  const [codigoNovo, setCodigoNovo] = useState<{ id: string; orgId: string; codigo: string; expiraEm: string; sourceIds: string[]; sessao: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!token || !autorizado) return;
    const sessao = token;
    Promise.all([
      apiGet<Fonte[]>('/conector/fontes', token),
      apiGet<Dispositivo[]>('/conector/dispositivos', token),
    ]).then(([novasFontes, novosDispositivos]) => {
      if (tokenRef.current !== sessao) return;
      setFontes(novasFontes); setDispositivos(novosDispositivos);
      setFontesDoCodigo((atuais) => atuais.filter((id) => novasFontes.some((fonte) => fonte.id === id && !fonte.revokedAt)));
    }).catch((erro: Error) => {
      if (tokenRef.current === sessao) setNotice(erro.message);
    });
  }, [token, autorizado]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    setFontes([]); setDispositivos([]); setCodigoNovo(null); setFontesDoCodigo([]); setNotice(null); setBusy(false);
  }, [token]);

  async function criarFonte() {
    if (!token || !nome.trim() || !raizLogica.trim()) return;
    const sessao = token;
    setBusy(true); setNotice(null);
    try {
      await apiPost('/conector/fontes', {
        nome: nome.trim(), tipo, raizLogica: raizLogica.trim(),
        incluir: incluir.split(',').map((item) => item.trim()).filter(Boolean),
        excluir: excluir.split(',').map((item) => item.trim()).filter(Boolean),
        tiposPermitidos: tipos.split(',').map((item) => item.trim()).filter(Boolean),
        modo, regraExclusao, tamanhoMaximo: Number(tamanhoMaximo),
      }, token);
      if (tokenRef.current !== sessao) return;
      setNome(''); setRaizLogica(''); carregar();
    } catch (erro) {
      if (tokenRef.current === sessao) setNotice(erro instanceof Error ? erro.message : 'Não foi possível criar a fonte.');
    } finally {
      if (tokenRef.current === sessao) setBusy(false);
    }
  }

  async function revogarFonte(id: string) {
    if (!token) return;
    const sessao = token;
    setBusy(true);
    try { await apiPost(`/conector/fontes/${encodeURIComponent(id)}/revogar`, {}, token); if (tokenRef.current === sessao) carregar(); }
    catch (erro) { if (tokenRef.current === sessao) setNotice(erro instanceof Error ? erro.message : 'Não foi possível revogar a fonte.'); }
    finally { if (tokenRef.current === sessao) setBusy(false); }
  }

  async function emitirCodigo() {
    if (!token || !dispositivoNome.trim() || fontesDoCodigo.length === 0) return;
    const sessao = token;
    setBusy(true); setNotice(null);
    try {
      const result = await apiPost<{ id: string; orgId: string; codigo: string; expiraEm: string; sourceIds: string[] }>('/conector/pareamento/codigo', {
        nomeDispositivo: dispositivoNome.trim(), fonteIds: fontesDoCodigo,
      }, token);
      if (tokenRef.current !== sessao) return;
      setCodigoNovo({ ...result, sessao }); setDispositivoNome(''); carregar();
    } catch (erro) { if (tokenRef.current === sessao) setNotice(erro instanceof Error ? erro.message : 'Não foi possível emitir o código.'); }
    finally { if (tokenRef.current === sessao) setBusy(false); }
  }

  async function revogarDispositivo(id: string) {
    if (!token) return;
    const sessao = token;
    setBusy(true);
    try { await apiPost(`/conector/dispositivos/${encodeURIComponent(id)}/revogar`, {}, token); if (tokenRef.current === sessao) carregar(); }
    catch (erro) { if (tokenRef.current === sessao) setNotice(erro instanceof Error ? erro.message : 'Não foi possível revogar o dispositivo.'); }
    finally { if (tokenRef.current === sessao) setBusy(false); }
  }

  if (!token || !autorizado) return null;
  return (
    <section className="space-y-4 rounded-root border border-border bg-surface p-4" aria-labelledby="conector-local-titulo">
      <div>
        <h2 id="conector-local-titulo" className="text-sm font-semibold">Conector local</h2>
        <p className="mt-1 text-xs text-muted">A ROOT guarda somente a fonte lógica. O dispositivo escolhe a pasta local depois de um consentimento separado; criar fonte não concede memória ao agente.</p>
        <p className="mt-1 text-xs text-muted">Revogar fonte ou dispositivo interrompe novas coletas; não apaga o que já foi recebido nem revoga automaticamente grants do agente. Use o controle de acesso à memória para isso.</p>
      </div>
      {notice && <p role="alert" className="text-xs text-bad">{notice}</p>}
      {codigoNovo && codigoNovo.sessao === token && <div className="rounded-root border border-warn/40 bg-warn/10 p-3 text-xs"><strong>Código exibido uma única vez</strong><p className="mt-1">Pareamento {codigoNovo.id} · empresa {codigoNovo.orgId}</p><p className="mt-1">Fontes: {codigoNovo.sourceIds.map((id) => { const fonte = fontes.find((item) => item.id === id); return `${id} (escopo ${fonte?.escopoVersao ?? '?'})`; }).join(', ')}</p><p className="mt-1 break-all font-mono">{codigoNovo.codigo}</p><p className="mt-1">Expira em {new Date(codigoNovo.expiraEm).toLocaleString()}.</p><p className="mt-1">Guarde o código no dispositivo; ele não será listado novamente.</p><button type="button" className="mt-2 rounded-root border border-border px-2 py-1" onClick={() => setCodigoNovo(null)}>Ocultar código</button></div>}

      <div className="space-y-2 border-t border-border pt-3">
        <h3 className="text-sm font-semibold">Nova fonte lógica</h3>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-xs text-muted">Nome<input aria-label="Nome da fonte" className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <label className="text-xs text-muted">Tipo<select aria-label="Tipo da fonte" className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}><option value="pasta">pasta</option><option value="arquivo">arquivo</option></select></label>
          <label className="text-xs text-muted">Raiz lógica (não é caminho local)<input aria-label="Raiz lógica" className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5" value={raizLogica} onChange={(e) => setRaizLogica(e.target.value)} /></label>
          <label className="text-xs text-muted">Extensões permitidas<input aria-label="Extensões permitidas" className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5" value={tipos} onChange={(e) => setTipos(e.target.value)} /></label>
          <label className="text-xs text-muted">Incluir (glob literal)<input aria-label="Filtros de inclusão" className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5" value={incluir} onChange={(e) => setIncluir(e.target.value)} /></label>
          <label className="text-xs text-muted">Excluir (glob literal)<input aria-label="Filtros de exclusão" className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5" value={excluir} onChange={(e) => setExcluir(e.target.value)} /></label>
          <label className="text-xs text-muted">Modo<select aria-label="Modo da fonte" className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5" value={modo} onChange={(e) => setModo(e.target.value as typeof modo)}><option value="importacao">importação</option><option value="sincronizacao" disabled>sincronização (cliente pendente)</option></select></label>
          <label className="text-xs text-muted">Regra de exclusão<select aria-label="Regra de exclusão" className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5" value={regraExclusao} onChange={(e) => setRegraExclusao(e.target.value as typeof regraExclusao)}><option value="ignorar">ignorar</option><option value="arquivar">arquivar</option></select></label>
          <label className="text-xs text-muted">Máximo por arquivo (bytes)<input aria-label="Tamanho máximo" type="number" min="1" className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5" value={tamanhoMaximo} onChange={(e) => setTamanhoMaximo(e.target.value)} /></label>
        </div>
        <button type="button" disabled={busy || !nome.trim() || !raizLogica.trim()} onClick={criarFonte} className="rounded-root bg-brand px-3 py-2 text-sm text-white disabled:opacity-50">Criar fonte lógica</button>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <h3 className="text-sm font-semibold">Fontes e frescor</h3>
        {fontes.map((fonte) => <div key={fonte.id} className="flex flex-wrap items-center justify-between gap-2 rounded-root border border-border px-3 py-2 text-xs"><span><strong>{fonte.nome}</strong> · id {fonte.id} · escopo {fonte.escopoVersao} · {fonte.tipo}:{fonte.raizLogica} · {fonte.modo} · limite {fonte.tamanhoMaximo} B · tentativa {idade(fonte.ultimaRemessaTentativaEm)} · sucesso {idade(fonte.ultimaRemessaSucessoEm)} · {fonte.ultimaRemessaItens ?? 0} item(ns), {fonte.ultimaRemessaErros ?? 0} erro(s) · {fonte.ultimaRemessaStatus ?? 'sem remessa'}</span>{fonte.revokedAt ? <span className="text-muted">revogada</span> : <button type="button" disabled={busy} onClick={() => revogarFonte(fonte.id)} className="text-bad">Revogar fonte</button>}</div>)}
        {fontes.length === 0 && <p className="text-xs text-muted">Nenhuma fonte lógica cadastrada.</p>}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <h3 className="text-sm font-semibold">Parear dispositivo</h3>
        <p className="text-xs text-muted">Escolha fontes já criadas. O código vale 15 minutos, uma vez, e não amplia o escopo depois.</p>
        <label className="text-xs text-muted">Nome do dispositivo<input aria-label="Nome do dispositivo" className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5" value={dispositivoNome} onChange={(e) => setDispositivoNome(e.target.value)} /></label>
        <div className="space-y-1">{fontes.filter((fonte) => !fonte.revokedAt).map((fonte) => <label key={fonte.id} className="block text-xs"><input type="checkbox" checked={fontesDoCodigo.includes(fonte.id)} onChange={(e) => setFontesDoCodigo((atual) => e.target.checked ? [...atual, fonte.id] : atual.filter((id) => id !== fonte.id))} /> <span className="ml-1">{fonte.nome} ({fonte.raizLogica})</span></label>)}</div>
        <button type="button" disabled={busy || !dispositivoNome.trim() || fontesDoCodigo.length === 0} onClick={emitirCodigo} className="rounded-root border border-border px-3 py-2 text-sm disabled:opacity-50">Emitir código de pareamento</button>
      </div>

      <div className="space-y-2 border-t border-border pt-3"><h3 className="text-sm font-semibold">Dispositivos</h3>{dispositivos.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-root border border-border px-3 py-2 text-xs"><span><strong>{item.nome}</strong> · visto {idade(item.lastSeenAt)} · {item.fonteIds.length} fonte(s)</span>{item.revokedAt ? <span className="text-muted">revogado</span> : <button type="button" disabled={busy} onClick={() => revogarDispositivo(item.id)} className="text-bad">Revogar dispositivo</button>}</div>)}{dispositivos.length === 0 && <p className="text-xs text-muted">Nenhum dispositivo pareado.</p>}</div>

      <details className="border-t border-border pt-3 text-xs"><summary className="cursor-pointer font-semibold">Instrução curta para o operador local</summary><p className="mt-2 text-muted">Use o cliente local já instalado. O token fica no cofre do sistema; nunca o coloque em argumento, arquivo ou projeto versionado. O cliente atual faz somente importação consentida; não trate sincronização contínua como disponível.</p><pre className="mt-2 overflow-x-auto rounded-root bg-surface-2 p-2">{INSTRUCAO_CLI}</pre></details>
    </section>
  );
}
