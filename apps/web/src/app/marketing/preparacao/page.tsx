'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { instanteNoFuso } from '@mktos/shared';
import { apiGet, apiPost, ErroDaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Account = { id: string; handle: string; ownerId: string; operators: string[]; revision: number; active: boolean; canPrepare: boolean; status: string; pending: string };
type Preparation = { id: string; accountId: string; handle: string; taskId: string; versionId: string; decisionId: string; contentHash: string; scheduledAt: string; timezone: string; state: string };
type Catalog = { accounts: Account[]; preparations: Preparation[]; qa: boolean };
type Config = { connections: { id: string; handle: string; status: string }[]; people: { id: string; name: string }[] };
type Pending = { requestId: string; accountId: string; expectedAccountRevision: number; taskId: string; versionId: string; decisionId: string; contentHash: string; scheduledAt: string; timezone: string };
const inputClass = 'w-full rounded border border-border bg-surface p-2';
const buttonClass = 'rounded border border-border px-3 py-2 disabled:opacity-40';

export default function PreparacaoMarketingPage() {
  const { ready, token, user, can } = useAuth();
  const query = useSearchParams();
  const identity = user?.id + ':' + token;
  const current = useRef(identity); current.current = identity;
  const loadGeneration = useRef(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [when, setWhen] = useState('');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<Preparation | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState('');
  const [owner, setOwner] = useState('');
  const [operators, setOperators] = useState<string[]>([]);
  const configRequest = useRef<string | null>(null);
  const [configPending, setConfigPending] = useState<unknown | null>(null);
  const storageKey = 'marketing-preparo:' + user?.id;
  const configKey = 'marketing-conta:' + user?.id;
  const mayConfigure = can('bio.editar') && can('admin.usuarios');
  const mayPrepare = ['pauta.editar', 'pauta.publicar', 'tarefas.ver', 'tarefas.editar'].every(can);

  async function load() {
    const expected = identity;
    const generation = ++loadGeneration.current;
    try {
      const c = await apiGet<Catalog>('/marketing/preparacao', token);
      if (current.current !== expected || loadGeneration.current !== generation) return;
      setCatalog(c); setLoadedFor(expected);
      if (mayConfigure) {
        const settings = await apiGet<Config>('/marketing/preparacao/configuracao', token);
        if (current.current === expected && loadGeneration.current === generation) setConfig(settings);
      }
    } catch (e) {
      if (current.current !== expected || loadGeneration.current !== generation) return;
      setCatalog(null); setConfig(null); setResult(null); setError((e as Error).message); setLoadedFor(expected);
    }
  }
  useEffect(() => {
    loadGeneration.current++;
    setCatalog(null); setConfig(null); setResult(null); setPending(null); setConfigPending(null);
    setAccountId(''); setError(null); setConflict(false); setBusy(false); setLoadedFor(null);
    configRequest.current = null;
    if (!ready || !token || !can('pauta.ver')) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      if (saved && typeof saved.requestId === 'string' && typeof saved.accountId === 'string' && typeof saved.contentHash === 'string') {
        setPending(saved); setAccountId(saved.accountId); setTimezone(saved.timezone);
      }
      const savedConfig = JSON.parse(localStorage.getItem(configKey) ?? 'null');
      if (savedConfig && typeof savedConfig.requestId === 'string') setConfigPending(savedConfig);
    } catch { /* Um registro ilegível não vira pedido. */ }
    void load();
  }, [identity, ready]);

  async function configure() {
    const expected = identity; setBusy(true); setError(null);
    try {
      const payload = configPending ?? { requestId: configRequest.current ?? crypto.randomUUID(), connectionId: connection, ownerId: owner, operators };
      setConfigPending(payload); localStorage.setItem(configKey, JSON.stringify(payload));
      await apiPost('/marketing/preparacao/contas', payload, token);
      if (current.current !== expected) return;
      localStorage.removeItem(configKey); setConfigPending(null); configRequest.current = null; await load();
    } catch (e) {
      if (current.current === expected) {
        setError((e as Error).message);
        if (e instanceof ErroDaApi && [401, 403, 404].includes(e.status)) { setCatalog(null); setConfig(null); setResult(null); }
      }
    }
    finally { if (current.current === expected) setBusy(false); }
  }
  async function prepare() {
    const expected = identity; setBusy(true); setError(null); setConflict(false);
    try {
      const a = catalog?.accounts.find((v) => v.id === accountId);
      if (!pending && (!a || !when)) throw new Error('Selecione a conta e o horário.');
      const payload: Pending = pending ?? {
        requestId: crypto.randomUUID(), accountId, expectedAccountRevision: a!.revision,
        taskId: query.get('taskId') ?? '', versionId: query.get('versionId') ?? '',
        decisionId: query.get('decisionId') ?? '', contentHash: query.get('contentHash') ?? '',
        scheduledAt: instanteNoFuso(when.slice(0, 10), when.slice(11, 16), timezone).toISOString(), timezone,
      };
      setPending(payload); localStorage.setItem(storageKey, JSON.stringify(payload));
      const response = await apiPost<{ preparation: Preparation; replayed: boolean }>('/marketing/preparacao', payload, token);
      if (current.current !== expected) return;
      setResult(response.preparation); setPending(null); localStorage.removeItem(storageKey); await load();
    } catch (e) {
      if (current.current !== expected) return;
      setError((e as Error).message);
      if (e instanceof ErroDaApi && e.status === 409) setConflict(true);
      if (e instanceof ErroDaApi && [401, 403, 404].includes(e.status)) { setCatalog(null); setConfig(null); setResult(null); }
    } finally { if (current.current === expected) setBusy(false); }
  }
  if (!ready) return <p>Carregando…</p>;
  if (!can('pauta.ver')) return <p>Acesso insuficiente para Marketing.</p>;
  const visible = loadedFor === identity ? catalog : null;
  const selected = visible?.accounts.find((a) => a.id === accountId);
  const completeSource = ['taskId', 'versionId', 'decisionId', 'contentHash'].every((k) => query.get(k));
  const sourceTaskId = query.get('taskId');
  const sourceVersionId = query.get('versionId');
  const sourceHref = sourceTaskId ? '/pauta/producao?taskId=' + encodeURIComponent(sourceTaskId) + (sourceVersionId ? '&versionId=' + encodeURIComponent(sourceVersionId) : '') : '/trabalho';
  return <div className="space-y-5">
    <h1 className="text-xl font-semibold">Contas e preparação de Marketing</h1>
    <p>Escolha a conta e o horário para uma versão aprovada. O preparo fica salvo; publicar exige a integração e a autorização da ação.</p>
    {visible?.qa && <p className="text-warn">Ambiente local de QA. As contas desta prova são sintéticas.</p>}
    {error && <p role="alert" className="text-bad">{error}</p>}
    <button className={buttonClass} onClick={() => void load()} disabled={busy}>Conferir contas e preparos</button>
    {loadedFor !== identity && !error && <p>Carregando contas…</p>}
    {visible && <section aria-label="Contas disponíveis" className="space-y-2">
      <h2 className="font-semibold">Contas disponíveis</h2>
      {!visible.accounts.length && <><p>Nenhuma conta foi concedida à sua pessoa.</p><p className="text-sm text-muted">{mayConfigure ? 'Confira as conexões disponíveis e defina dono e operadores na seção abaixo.' : 'Uma pessoa com acesso de configuração precisa conceder o destino à sua conta.'}</p></>}
      {visible.accounts.map((a) => <div className="rounded border border-border p-3" key={a.id}>
        <p>@{a.handle} · {a.canPrepare ? 'disponível para preparar' : 'preparo indisponível'}</p>
        <p className="text-sm">{a.pending}</p>
      </div>)}
    </section>}
    {mayConfigure && loadedFor === identity && config && <section aria-label="Configurar dono e operadores" className="space-y-2">
      <h2 className="font-semibold">Dono e operadores da conexão</h2>
      {!config.connections.length && <p className="text-sm text-muted">Não há conexões Instagram disponíveis para configurar. Primeiro é necessária uma conexão autorizada; o cadastro de dono e operadores não conecta o provedor.</p>}
      <label className="block">Conexão Instagram<select aria-label="Conexão Instagram" className={inputClass} value={connection} onChange={(e) => setConnection(e.target.value)} disabled={!!configPending || busy}>
        <option value="">Selecione</option>{config.connections.map((c) => <option key={c.id} value={c.id}>@{c.handle}</option>)}
      </select></label>
      <label className="block">Dono da conta<select aria-label="Dono da conta" className={inputClass} value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!!configPending || busy}>
        <option value="">Selecione</option>{config.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <label className="block">Operadores da conta<select multiple aria-label="Operadores da conta" className={inputClass} value={operators} onChange={(e) => setOperators(Array.from(e.target.selectedOptions, (v) => v.value))} disabled={!!configPending || busy}>
        {config.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <button className={buttonClass} onClick={() => void configure()} disabled={busy || (!configPending && (!connection || !owner))}>{configPending ? 'Conferir configuração anterior' : 'Salvar dono e operadores'}</button>
    </section>}
    {mayPrepare && visible && (completeSource || pending) && <form aria-label="Preparar versão para a conta" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void prepare(); }}>
      <h2 className="font-semibold">Preparar versão aprovada</h2>
      <label className="block">Conta de destino<select aria-label="Conta de destino" className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!!pending || busy}>
        <option value="">Selecione</option>{visible.accounts.map((a) => <option value={a.id} key={a.id} disabled={!a.canPrepare}>@{a.handle}</option>)}
      </select></label>
      <label className="block">Horário de preparo<input aria-label="Horário de preparo" type="datetime-local" className={inputClass} value={when} onChange={(e) => setWhen(e.target.value)} disabled={!!pending || busy} /></label>
      <label className="block">Fuso horário<select aria-label="Fuso horário" className={inputClass} value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!!pending || busy}>
        <option>America/Sao_Paulo</option><option>America/Manaus</option><option>UTC</option>
      </select></label>
      {pending && <p>Pedido anterior aguardando conferência: destino e horário estão preservados.</p>}
      <button type="submit" className={buttonClass} disabled={busy || (!pending && (!selected?.canPrepare || !when))}>{pending ? 'Conferir preparo anterior' : 'Salvar preparo'}</button>
      {conflict && <button type="button" className={buttonClass} onClick={() => { localStorage.removeItem(storageKey); setPending(null); setConflict(false); void load(); }}>Revisar preparo após conflito</button>}
    </form>}
    {visible && !completeSource && !pending && <section aria-label="Escolher versão para o preparo" className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="font-semibold">Comece pela versão aprovada</h2>
      <p className="text-sm text-muted">Abra o material de uma tarefa, confira a aprovação e escolha “Preparar conta e horário”. Esse caminho traz a tarefa, a versão e a decisão corretas.</p>
      {can('tarefas.ver') ? <Link href={sourceHref} className="inline-flex min-h-11 items-center rounded border border-brand-dim px-3 text-sm text-brand">{sourceTaskId ? 'Abrir material da tarefa' : 'Escolher tarefa em Trabalho'}</Link> : <p className="text-sm text-muted">Sua conta também precisa de acesso a Trabalho para escolher a tarefa.</p>}
    </section>}
    {visible && !mayPrepare && <p className="text-sm text-muted">Sua conta pode consultar os preparos. Salvar um preparo exige acesso para editar e publicar na Pauta e editar a tarefa.</p>}
    {loadedFor === identity && result && <p role="status">Preparo salvo para @{result.handle}. Publicação ainda não executada.</p>}
    {visible && <section aria-label="Preparos salvos" className="space-y-2">
      <h2 className="font-semibold">Preparos salvos</h2>
      {!visible.preparations.length && <p className="text-sm text-muted">Nenhum preparo salvo está disponível para sua conta.</p>}
      {visible.preparations.map((p) => <article key={p.id} className="rounded border border-border p-3">
        <p>@{p.handle} · {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: p.timezone }).format(new Date(p.scheduledAt))} · {p.timezone}</p>
        <p>Preparado. Publicação e métricas externas pendentes.</p>
        <Link className="underline" href={'/pauta/producao?taskId=' + p.taskId + '&versionId=' + p.versionId}>Abrir versão preparada</Link>
        {' · '}<Link className="underline" href={'/trabalho?tarefa=' + p.taskId}>Abrir tarefa</Link>
      </article>)}
    </section>}
  </div>;
}
