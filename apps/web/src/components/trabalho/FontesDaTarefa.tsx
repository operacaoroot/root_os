'use client';

import type { ContextoFonteUtilizadaDto, ContextoFontesDaTarefaResponse } from '@mktos/shared';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { quando } from '@/app/contexto/tipos';

export function FontesDaTarefa({ taskId }: { taskId: string }) {
  const { token, ready, can } = useAuth();
  if (!ready || !token || !can('tarefas.ver') || !can('obsidian.ver')) return null;
  return <FontesAutorizadas key={`${token}:${taskId}`} taskId={taskId} token={token} />;
}

function FontesAutorizadas({ taskId, token }: { taskId: string; token: string }) {
  const [fontes, setFontes] = useState<ContextoFonteUtilizadaDto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rodada, setRodada] = useState(0);
  useEffect(() => {
    let vivo = true; setFontes(null); setErro(null);
    apiGet<ContextoFontesDaTarefaResponse>(`/trabalho/tarefas/${encodeURIComponent(taskId)}/fontes`, token)
      .then((r) => { if (vivo) setFontes(r.fontes); })
      .catch((e) => { if (!vivo) return; setFontes(null); setErro([403, 404].includes(e.status) ? 'Fontes não disponíveis para esta conta.' : 'Não conseguimos ler as fontes desta tarefa.'); });
    return () => { vivo = false; };
  }, [taskId, token, rodada]);
  if (fontes?.length === 0) return null;
  return <section aria-label="Fontes usadas na tarefa" className="space-y-2 rounded-root border border-border p-3 text-xs">
    <h3 className="font-medium text-text">Fontes usadas</h3>
    {erro ? <p role="alert" className="text-muted">{erro}</p> : fontes === null ? <p className="text-muted">Carregando fontes…</p> : <ul className="space-y-3">{fontes.map((f) => <li key={f.id}>
      <p className="font-medium">{f.title} · v{f.versao}</p>
      <p className="break-words text-muted">{f.procedencia}</p>
      <p className="text-muted">Usada em {quando(f.utilizadaEm)} · versão atual v{f.versaoAtual}{f.arquivada ? ' · fonte arquivada' : ''}</p>
      <a className="text-brand underline" href={`/contexto?nota=${encodeURIComponent(f.itemId)}&versao=${encodeURIComponent(f.versionId)}`}>Abrir versão usada</a>
    </li>)}</ul>}
    <button type="button" className="text-brand underline" onClick={() => setRodada((r) => r + 1)}>Conferir acesso às fontes</button>
  </section>;
}
