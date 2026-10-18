'use client';
import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, ErroDaApi } from '@/lib/api';
interface FileRef { taskExternalId: string; fileId: string; name?: string; sha256?: string }
interface Version { id: string; number: number; title: string; body: string; files: FileRef[]; sourceRef: string; contentHash: string; actorId: string; createdAt: string }
interface Decision { id: string; versionId: string; state: 'approved' | 'rejected'; actorId: string; authority: string; reason: string; revokedAt: string | null; createdAt: string }
interface Production { id: string; versionId: string; decisionId: string; title: string; body: string; sourceRef: string; createdAt: string }
interface State { task: { id: string; title: string; description: string | null; externalId: string | null; statusId: string; statusName: string; archived: boolean; statuses: { id: string; name: string }[] }; material: { id: string; title: string; selectedVersionId: string; releaseStatusId: string; revision: number } | null; versions: Version[]; decisions: Decision[]; productions: Production[]; canDecide: boolean }
interface Pending { path: string; payload: Record<string, unknown>; label: string }
export function taskFileRefs(description: string | null): FileRef[] {
  const result: FileRef[] = [];
  for (const m of (description ?? '').matchAll(/\/trabalho\/arquivos\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/g)) {
    if (!result.some((r) => r.taskExternalId === m[1] && r.fileId === m[2])) result.push({ taskExternalId: m[1], fileId: m[2] });
  }
  return result;
}
export function EditorialPanel({ token, userId, taskId, initialVersionId }: { token: string; userId: string; taskId: string; initialVersionId?: string }) {
  const [data, setData] = useState<State | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null), [title, setTitle] = useState(''), [body, setBody] = useState(''), [sourceRef, setSourceRef] = useState(''), [release, setRelease] = useState(''), [reason, setReason] = useState(''), [selectedFiles, setSelectedFiles] = useState<string[]>([]), [reading, setReading] = useState<string | null>(initialVersionId ?? null), [checked, setChecked] = useState(false);
  const generation = useRef(0), key = 'rootos.editorial:' + userId + ':' + taskId;
  const clearContent = () => { setData(null); setTitle(''); setBody(''); setSourceRef(''); setReason(''); setSelectedFiles([]); setReading(initialVersionId ?? null); setChecked(false); };
  async function load(epoch = generation.current) {
    const result = await apiGet<State>('/pauta/editorial/tarefas/' + encodeURIComponent(taskId), token);
    if (generation.current === epoch) { setData(result); setRelease((r) => r || result.task.statusId); setChecked(false); }
  }
  useEffect(() => {
    const epoch = ++generation.current; clearContent(); setPending(null); setError(null);
    try { const old = JSON.parse(localStorage.getItem(key) ?? 'null') as Pending | null; if (old && typeof old.path === 'string' && old.path.startsWith('/pauta/editorial/') && typeof old.payload?.requestId === 'string') { setPending(old); if (typeof old.payload.title === 'string') setTitle(old.payload.title); if (typeof old.payload.body === 'string') setBody(old.payload.body); if (typeof old.payload.sourceRef === 'string') setSourceRef(old.payload.sourceRef); } } catch { localStorage.removeItem(key); }
    load(epoch).catch((e) => { if (epoch === generation.current) { setError(e.message); clearContent(); } });
    return () => { generation.current++; };
  }, [token, userId, taskId]);
  async function mutate(path: string, payload: Record<string, unknown>, label: string, retry = false) {
    const epoch = generation.current, p = retry && pending ? pending : { path, payload: { ...payload, requestId: crypto.randomUUID() }, label };
    if (pending && !retry) return;
    setBusy(true); setChecked(false); setError(null); setPending(p); localStorage.setItem(key, JSON.stringify(p));
    try {
      await apiPost(p.path, p.payload, token);
      if (epoch !== generation.current) return;
      localStorage.removeItem(key); setPending(null); await load(epoch); setReason('');
    } catch (e) {
      if (epoch !== generation.current) return;
      const err = e as Error; setError(err.message);
      if (e instanceof ErroDaApi && e.status >= 400 && e.status < 500) { localStorage.removeItem(key); setPending(null); }
      if (e instanceof ErroDaApi && [401, 403, 404].includes(e.status)) clearContent();
    } finally { if (epoch === generation.current) setBusy(false); }
  }
  async function refresh() { const epoch = generation.current; setBusy(true); setError(null); try { await load(epoch); } catch (e) { if (epoch === generation.current) { setError((e as Error).message); clearContent(); } } finally { if (epoch === generation.current) setBusy(false); } }
  const selected = data?.versions.find((v) => v.id === data.material?.selectedVersionId), version = reading === null ? selected : data?.versions.find((v) => v.id === reading);
  const decision = selected && data?.decisions.find((d) => d.versionId === selected.id), approved = decision?.state === 'approved' && !decision.revokedAt;
  const viewingSelected = !!selected && version?.id === selected.id;
  const gateInput = selected && decision ? { taskId, versionId: selected.id, decisionId: decision.id, contentHash: selected.contentHash } : null;
  async function check() {
    if (!gateInput || !selected) return; const epoch = generation.current; setBusy(true); setError(null); setChecked(false);
    try { await apiGet('/pauta/editorial/versoes/' + selected.id + '/producao?' + new URLSearchParams({ taskId, decisionId: gateInput.decisionId, contentHash: gateInput.contentHash }), token); if (epoch === generation.current) setChecked(true); }
    catch (e) { if (epoch === generation.current) { setError((e as Error).message); if (e instanceof ErroDaApi && [401, 403, 404].includes(e.status)) clearContent(); } }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  const blocked = busy || !!pending, refs = taskFileRefs(data?.task.description ?? null), content = { title, body, sourceRef, files: refs.filter((r) => selectedFiles.includes(r.fileId)) };
  return <div className="space-y-5">
    <h1 className="text-xl font-semibold">Material e Produção</h1>
    <a href={'/trabalho?tarefa=' + encodeURIComponent(taskId)} className="text-brand underline">Voltar ao mesmo card</a>
    {error && <p role="alert" className="text-bad">{error}</p>}
    <button type="button" disabled={busy} onClick={refresh} className="underline">Conferir estado atual</button>
    {pending && <section aria-label="Pedido a conferir"><p>O resultado de “{pending.label}” precisa ser conferido. O conteúdo do pedido está preservado.</p><button disabled={busy} onClick={() => mutate(pending.path, pending.payload, pending.label, true)}>Conferir pedido anterior</button></section>}
    {!data && !error && <p>Carregando material…</p>}
    {data && <>
      <section aria-label="Tarefa editorial"><h2 className="font-semibold">{data.task.title}</h2><p>Etapa atual: {data.task.statusName}{data.task.archived ? ' · arquivada' : ''}</p>{data.material && <p>Etapa que libera Produção: {data.task.statuses.find((s) => s.id === data.material?.releaseStatusId)?.name ?? 'indisponível'}</p>}</section>
      <section aria-label="Preparar material" className="space-y-3 rounded-root border border-border p-4">
        <h2 className="font-semibold">{data.material ? 'Preparar outra versão' : 'Vincular material existente'}</h2>
        <p>O material permanece ligado a este card. Preparar outra versão seleciona o novo conteúdo e exige outra decisão.</p>
        <button disabled={blocked} onClick={() => { setTitle(data.task.title); setBody(data.task.description ?? ''); setSourceRef('Card de Trabalho ' + taskId); }}>Usar material do card</button>
        {selected && <button disabled={blocked} onClick={() => { setTitle(selected.title); setBody(selected.body); setSourceRef(selected.sourceRef); setSelectedFiles(selected.files.map((f) => f.fileId)); }}>Reaproveitar versão selecionada</button>}
        <label className="block">Título do material<input aria-label="Título do material" disabled={blocked} value={title} onChange={(e) => setTitle(e.target.value)} className="block w-full border border-border p-2" /></label>
        <label className="block">Conteúdo exato<textarea aria-label="Conteúdo exato" disabled={blocked} value={body} onChange={(e) => setBody(e.target.value)} rows={7} className="block w-full border border-border p-2" /></label>
        <label className="block">Origem do material<input aria-label="Origem do material" disabled={blocked} value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} className="block w-full border border-border p-2" /></label>
        {!data.material && <label className="block">Etapa que libera Produção<select aria-label="Etapa que libera Produção" disabled={blocked} value={release} onChange={(e) => setRelease(e.target.value)}>{data.task.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        {refs.length > 0 && <fieldset><legend>Arquivos existentes do card</legend>{refs.map((r) => <label key={r.fileId} className="block"><input type="checkbox" disabled={blocked} checked={selectedFiles.includes(r.fileId)} onChange={(e) => setSelectedFiles((s) => e.target.checked ? [...s, r.fileId] : s.filter((id) => id !== r.fileId))} />Arquivo {r.fileId}</label>)}</fieldset>}
        <button disabled={blocked || !title.trim() || !body || !sourceRef.trim() || !release} onClick={() => mutate(data.material ? '/pauta/editorial/materiais/' + data.material.id + '/versoes' : '/pauta/editorial/materiais', data.material ? { ...content, expectedRevision: data.material.revision } : { ...content, taskId, releaseStatusId: release }, data.material ? 'Preparar e selecionar nova versão' : 'Vincular material')}>{data.material ? 'Preparar e selecionar nova versão' : 'Vincular material'}</button>
      </section>
      {selected && <section aria-label="Versão e decisão" className="space-y-3 rounded-root border border-border p-4">
        <h2 className="font-semibold">Versão selecionada: {selected.number}</h2>
        {reading !== null && !version && <p role="alert">A versão indicada não está disponível. Escolha uma versão do histórico para continuar.</p>}
        <label>Histórico do material<select aria-label="Histórico do material" value={version?.id ?? ''} onChange={(e) => setReading(e.target.value)}>{data.versions.map((v) => <option key={v.id} value={v.id}>Versão {v.number}{v.id === selected.id ? ' · selecionada' : ' · histórico'}</option>)}</select></label>
        {version && <><h3>{version.title}</h3><p className="whitespace-pre-wrap">{version.body}</p><p>Origem: {version.sourceRef}</p>{version.files.map((f) => <p key={f.fileId}>Arquivo preservado: {f.name ?? f.fileId}</p>)}<p>Autoria: {version.actorId} · versão {version.number}</p></>}
        {!viewingSelected && <div><p>Você está lendo o histórico. Para decidir ou usar o material, abra a versão selecionada.</p><button type="button" disabled={blocked} onClick={() => { setReading(selected.id); setReason(''); setChecked(false); }}>Abrir versão selecionada para decidir</button></div>}
        <p>Recusa ou revogação exige preparar outra versão para uma nova decisão.</p>
        <p>Decisão da versão selecionada: {decision ? decision.revokedAt ? 'revogada' : decision.state === 'approved' ? 'aprovada' : 'recusada' : 'pendente'}</p>
        {decision && <p>Decidida por {decision.actorId} · alçada {decision.authority} · {decision.reason}</p>}
        {data.canDecide && <><label>Motivo da decisão<textarea aria-label="Motivo da decisão" disabled={blocked} value={reason} onChange={(e) => setReason(e.target.value)} /></label><button disabled={blocked || !viewingSelected || !reason.trim() || selected.actorId === userId || !!decision} onClick={() => mutate('/pauta/editorial/decisoes', { versionId: selected.id, contentHash: selected.contentHash, state: 'approved', reason }, 'Aprovar conteúdo exato')}>Aprovar conteúdo exato</button><button disabled={blocked || !viewingSelected || !reason.trim() || selected.actorId === userId || !!decision} onClick={() => mutate('/pauta/editorial/decisoes', { versionId: selected.id, contentHash: selected.contentHash, state: 'rejected', reason }, 'Devolver à revisão')}>Devolver à revisão</button>{approved && <button disabled={blocked || !viewingSelected || !reason.trim()} onClick={() => mutate('/pauta/editorial/decisoes/' + decision.id + '/revogar', { reason }, 'Revogar aprovação')}>Revogar aprovação</button>} {selected.actorId === userId && <p>A decisão desta versão precisa de outra pessoa com alçada.</p>}</>}
      </section>}
      {gateInput && <section aria-label="Entrada em Produção" className="space-y-2"><h2 className="font-semibold">Produção</h2><p>A API confere a etapa do card, a versão, a decisão e os arquivos antes de cada novo uso.</p><button disabled={blocked || !viewingSelected} onClick={check}>Conferir liberação de Produção</button>{checked && <p>Versão e tarefa liberadas para este uso.</p>}<button disabled={blocked || !viewingSelected || !checked} onClick={() => mutate('/pauta/editorial/producoes', gateInput, 'Reaproveitar peça aprovada')}>Reaproveitar peça aprovada</button>{approved && viewingSelected && <a href={'/marketing/preparacao?' + new URLSearchParams(gateInput)} className="block text-brand underline">Preparar conta e horário</a>}</section>}
      <section aria-label="Peças produzidas"><h2 className="font-semibold">Peças vinculadas ao card</h2>{data.productions.length === 0 && <p>Nenhuma peça produzida neste material.</p>}{data.productions.map((p) => <article key={p.id} className="border-b border-border py-3"><h3>{p.title}</h3><p>Versão {data.versions.find((v) => v.id === p.versionId)?.number} · origem {p.sourceRef}</p><p className="whitespace-pre-wrap">{p.body}</p><button onClick={() => setReading(p.versionId)}>Abrir versão usada na peça</button></article>)}</section>
    </>}
  </div>;
}
