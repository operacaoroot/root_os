'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ANEXO_MAX_BYTES, motivoParaRecusarAnexo, type AnexoDaTarefa } from '@mktos/shared';

import { apiBlob, apiGet, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * OS ANEXOS DA TAREFA (rodada dos agentes, 21/10/2026, lane A4, TR-06).
 *
 * No pop-up da tarefa (`?tarefa=`): a lista dos anexos, o botão de enviar e,
 * para cada um, onde está a cópia na pasta do cliente: o link do Drive, o
 * pedido na fila de aprovação, a espera pela pasta, a classificação à mão, ou
 * "só no OS" (tarefa sem cliente ou do cliente interno). Baixar sai do storage
 * do OS como anexo, com o token no cabeçalho.
 */

const ROTULO: Record<AnexoDaTarefa['estado'], string> = {
  enviado: 'Na pasta do cliente',
  aguardando_aprovacao: 'Aguardando aprovação para ir ao Drive',
  na_fila: 'Esperando a pasta do cliente nascer',
  classificar_a_mao: 'Esperando alguém escolher a subpasta (Pendências)',
  so_no_os: 'Só no OS',
  erro: 'Não foi ao Drive',
};

const tamanho = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function AnexosDaTarefa({ taskId, restrito = false }: { taskId: string; restrito?: boolean }) {
  const { token, ready, can, user } = useAuth();
  if (!ready || !token || !can('tarefas.ver')) return null;
  return (
    <Anexos key={JSON.stringify([user?.id, token, taskId, restrito])} taskId={taskId} token={token}
      restrito={restrito} podeEnviar={!restrito && can('tarefas.editar')} />
  );
}

function Anexos({ taskId, token, restrito, podeEnviar }: {
  taskId: string; token: string; restrito: boolean; podeEnviar: boolean;
}) {
  const [anexos, setAnexos] = useState<AnexoDaTarefa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const ciclo = useRef<AbortController | null>(null);
  const base = `/trabalho/tarefas/${encodeURIComponent(taskId)}/anexos`;

  const carregar = useCallback((signal: AbortSignal) => {
    apiGet<AnexoDaTarefa[]>(base, token, signal)
      .then((r) => { if (!signal.aborted) setAnexos(r); })
      .catch((e: Error) => { if (!signal.aborted) setErro(e.message); });
  }, [base, token]);

  useLayoutEffect(() => {
    const controle = new AbortController();
    ciclo.current = controle;
    carregar(controle.signal);
    return () => controle.abort();
  }, [carregar]);

  const enviar = async (arquivo: File | undefined) => {
    const signal = ciclo.current?.signal;
    if (!arquivo || !podeEnviar || !signal || signal.aborted) return;
    const recusa = motivoParaRecusarAnexo(arquivo.name, arquivo.type || 'application/octet-stream', arquivo.size);
    if (recusa) {
      setErro(`Não enviado: ${recusa}`);
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await apiUpload<AnexoDaTarefa>(base, arquivo, token);
      if (!signal.aborted) carregar(signal);
    } catch (e) {
      if (!signal.aborted) setErro(`Não enviado: ${(e as Error).message}`);
    } finally {
      if (!signal.aborted) {
        setEnviando(false);
        if (entrada.current) entrada.current.value = '';
      }
    }
  };

  const baixar = async (a: AnexoDaTarefa) => {
    const signal = ciclo.current?.signal;
    if (!signal || signal.aborted) return;
    try {
      const blob = await apiBlob(`${base}/${encodeURIComponent(a.id)}/arquivo`, token, signal);
      if (signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.nome;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!signal.aborted) setErro(`Não baixou: ${(e as Error).message}`);
    }
  };

  return (
    <section aria-label="Anexos da tarefa" className="space-y-2 rounded-root border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-text">Anexos</h3>
        {podeEnviar && (
          <label className="cursor-pointer text-brand underline">
            {enviando ? 'Enviando…' : '+ anexar arquivo'}
            <input
              ref={entrada}
              type="file"
              className="sr-only"
              disabled={enviando}
              aria-label="Anexar arquivo à tarefa"
              onChange={(e) => void enviar(e.target.files?.[0])}
            />
          </label>
        )}
      </div>
      {!restrito && <p className="text-muted">Até {Math.round(ANEXO_MAX_BYTES / 1048576)} MB: PDF, documento, planilha, apresentação, imagem ou texto.</p>}
      {erro && <p role="alert" className="text-muted">{erro}</p>}
      {anexos === null && !erro && <p className="text-muted">Carregando anexos…</p>}
      {anexos?.length === 0 && <p className="text-muted">Nenhum anexo.</p>}
      {!!anexos?.length && (
        <ul className="space-y-2">
          {anexos.map((a) => (
            <li key={a.id} className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={`break-all text-left text-brand underline${restrito ? ' min-h-11' : ''}`} onClick={() => void baixar(a)}>
                  {a.nome}
                </button>
                <span className="text-muted">{tamanho(a.bytes)} · {a.autorNome}</span>
              </div>
              {!restrito && <div className="flex flex-wrap items-center gap-2 text-muted">
                <span>{ROTULO[a.estado]}{a.subpasta && a.estado !== 'so_no_os' ? ` · ${a.subpasta}` : ''}</span>
                {a.estado === 'enviado' && a.driveUrl && (
                  <a href={a.driveUrl} target="_blank" rel="noreferrer noopener" className="text-brand underline">
                    Abrir no Drive
                  </a>
                )}
                {a.estado === 'aguardando_aprovacao' && (
                  <a href="/atendimento" className="text-brand underline">
                    Ver em Aprovações
                  </a>
                )}
                {a.motivo && (a.estado === 'erro' || a.estado === 'so_no_os') && <span>({a.motivo})</span>}
              </div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
