'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { EditorialPanel } from './EditorialPanel';
export default function EditorialPage() {
  const { token, user, ready } = useAuth();
  const [taskId, setTaskId] = useState(''), [versionId, setVersionId] = useState<string | undefined>();
  useEffect(() => { const query = new URLSearchParams(window.location.search); setTaskId(query.get('taskId') ?? ''); setVersionId(query.get('versionId') ?? undefined); }, []);
  if (!ready) return <p>Carregando…</p>;
  if (!token || !user) return <p>Entre na sua conta para abrir o material.</p>;
  return taskId ? <EditorialPanel key={user.id + ':' + token + ':' + taskId} token={token} userId={user.id} taskId={taskId} initialVersionId={versionId} /> : <p>Abra o card em <a href="/trabalho" className="underline">Trabalho</a> e escolha “Abrir material e Produção”.</p>;
}
