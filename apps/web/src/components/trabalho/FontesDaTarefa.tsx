'use client';

import type { ContextoFonteUtilizadaDto, ContextoFontesDaTarefaResponse, M05EscopoDto } from '@mktos/shared';
import { useEffect, useRef, useState } from 'react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { quando } from '@/app/contexto/tipos';
import { RetratoDaFonte, escopoConfere, retratoConfere } from '@/app/contexto/RetratoDaFonte';

export function FontesDaTarefa({ taskId }: { taskId: string }) {
  const { token, ready, can, user } = useAuth();
  if (!ready || !token || !user || !can('tarefas.ver') || !can('obsidian.ver')) return null;
  return <FontesAutorizadas key={`${token}:${user.id}:${taskId}`} taskId={taskId} token={token} pessoaId={user.id} />;
}
function FontesAutorizadas({ taskId, token, pessoaId }: { taskId: string; token: string; pessoaId: string }) {
  const [fontes, setFontes] = useState<ContextoFonteUtilizadaDto[] | null>(null), [erro, setErro] = useState<string | null>(null), [rodada, setRodada] = useState(0);
  const escopo = useRef<M05EscopoDto | null>(null);
  useEffect(() => {
    let vivo = true; setFontes(null); setErro(null);
    apiGet<ContextoFontesDaTarefaResponse>(`/trabalho/tarefas/${encodeURIComponent(taskId)}/fontes`, token).then((r) => {
      if (!vivo) return;
      if (!escopoConfere(r.escopo, pessoaId, escopo.current) || !Array.isArray(r.fontes) || r.fontes.some((f) => !retratoConfere(f.retratoFonte, f))) { setFontes(null); setErro('Fontes não disponíveis para esta conta.'); return; }
      escopo.current = r.escopo; setFontes(r.fontes);
    }).catch((e) => { if (!vivo) return; setFontes(null); setErro([401, 403, 404].includes(e.status) ? 'Fontes não disponíveis para esta conta.' : 'Não conseguimos ler as fontes desta tarefa.'); });
    return () => { vivo = false; };
  }, [taskId, token, pessoaId, rodada]);
  if (fontes?.length === 0) return null;
  return <section aria-label="Fontes usadas na tarefa" className="space-y-2 rounded-root border border-border p-3 text-xs">
    <h3 className="font-medium text-text">Fontes usadas</h3>
    {erro ? <p role="alert" className="text-muted">{erro}</p> : fontes === null ? <p className="text-muted">Carregando fontes…</p> : <ul className="space-y-3">{fontes.map((f) => <li key={f.id}>
      <p className="font-medium">{f.title} · v{f.versao}</p><p className="break-words text-muted">{f.procedencia}</p><p className="text-muted">Usada em {quando(f.utilizadaEm)}</p>
      <RetratoDaFonte fonte={f.retratoFonte!} usada />
      <a className="text-brand underline" href={`/contexto?nota=${encodeURIComponent(f.itemId)}&versao=${encodeURIComponent(f.versionId)}`}>Abrir versão usada</a>
    </li>)}</ul>}
    <button type="button" className="text-brand underline" onClick={() => setRodada((r) => r + 1)}>Conferir acesso às fontes</button>
  </section>;
}
