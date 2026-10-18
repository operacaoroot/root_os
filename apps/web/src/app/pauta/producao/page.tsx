'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { EditorialPanel } from './EditorialPanel';
export default function EditorialPage() {
  const { token, user, ready, can } = useAuth();
  const [taskId, setTaskId] = useState(''), [versionId, setVersionId] = useState<string | undefined>();
  useEffect(() => { const query = new URLSearchParams(window.location.search); setTaskId(query.get('taskId') ?? ''); setVersionId(query.get('versionId') ?? undefined); }, []);
  if (!ready) return <p>Carregando…</p>;
  if (!token || !user) return <p>Entre na sua conta para abrir o material.</p>;
  if (!can('pauta.ver') || !can('tarefas.ver')) return <p>Acesso insuficiente para consultar o material da tarefa.</p>;
  return taskId ? <EditorialPanel key={user.id + ':' + token + ':' + taskId} token={token} userId={user.id} taskId={taskId} initialVersionId={versionId} /> : <section aria-label="Começar a produção editorial" className="max-w-2xl space-y-4 rounded-xl border border-border bg-surface p-5">
    <h1 className="text-xl font-semibold">Material e Produção</h1>
    <p className="text-sm text-muted">Cada material fica ligado a uma tarefa. Comece pelo card para preservar a origem e a versão.</p>
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      <li>Abra ou crie uma tarefa em Trabalho e escolha “Abrir material e Produção”.</li>
      <li>Vincule o material, selecione sua versão e siga a revisão disponível à sua conta.</li>
      <li>Com a versão aprovada e liberada, escolha “Preparar conta e horário”.</li>
    </ol>
    <a href="/trabalho" className="inline-flex min-h-11 items-center rounded-lg border border-brand-dim px-3 text-sm text-brand">Escolher tarefa em Trabalho</a>
  </section>;
}
