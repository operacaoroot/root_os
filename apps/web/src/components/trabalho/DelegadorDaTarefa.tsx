'use client';

/*
 * O DELEGADOR NO POP-UP DA TAREFA (rodada dos agentes, 21/10/2026, TR-09).
 *
 * Só aparece na tarefa atribuída a um agente. "Propor subtarefas" pede ao Delegador
 * (Opus, função TR-09) uma divisão com dono e prazo; cada proposta nasce SUGESTÃO, e
 * só vira subtarefa quando uma pessoa aceita. Descartar fica registrado. Nada é
 * atribuído sozinho: o agente sugerido aparece como sugestão, e quem aceita decide.
 *
 * Rotas: `GET /trabalho/tarefas/:id/delegacao`, `POST /trabalho/tarefas/:id/delegacao/propor`,
 * `POST /trabalho/delegacoes/:id/aceitar` e `.../descartar`.
 */
import { useCallback, useEffect, useState } from 'react';
import type { DelegacaoDaTarefa, DelegacaoSugestaoDto } from '@mktos/shared';

import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const BOTAO = 'rounded border border-border px-2 py-0.5 text-[11.5px] hover:border-brand disabled:opacity-50 max-md:min-h-[44px]';

export function DelegadorDaTarefa({ taskId, aoCriarSubtarefa }: { taskId: string; aoCriarSubtarefa?: () => void }) {
  const { token, can } = useAuth();
  const [dados, setDados] = useState<DelegacaoDaTarefa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const ler = useCallback(async () => {
    if (!token) return;
    try {
      setDados(await apiGet<DelegacaoDaTarefa>(`/trabalho/tarefas/${encodeURIComponent(taskId)}/delegacao`, token));
    } catch {
      setDados(null);
    }
  }, [taskId, token]);

  useEffect(() => {
    void ler();
  }, [ler]);

  if (!dados || !dados.atribuidaAAgente) return null;
  const pode = can('tarefas.editar');

  const agir = async (chave: string, fn: () => Promise<unknown>) => {
    setOcupado(chave);
    setErro(null);
    try {
      await fn();
      await ler();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const propor = () =>
    agir('propor', () => apiPost<DelegacaoDaTarefa>(`/trabalho/tarefas/${encodeURIComponent(taskId)}/delegacao/propor`, {}, token));
  const aceitar = (s: DelegacaoSugestaoDto) =>
    agir(s.id, async () => {
      await apiPost(`/trabalho/delegacoes/${encodeURIComponent(s.id)}/aceitar`, {}, token);
      aoCriarSubtarefa?.();
    });
  const descartar = (s: DelegacaoSugestaoDto) => agir(s.id, () => apiPost(`/trabalho/delegacoes/${encodeURIComponent(s.id)}/descartar`, {}, token));

  const abertas = dados.sugestoes.filter((s) => s.estado === 'rascunho');
  const decididas = dados.sugestoes.filter((s) => s.estado !== 'rascunho');

  return (
    <section aria-label="Delegador" data-testid="delegador" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-os-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          Delegador{dados.agente ? ` · com ${dados.agente}` : ''}
        </h3>
        {pode && (
          <button type="button" className={BOTAO} disabled={!!ocupado} onClick={propor} data-testid="delegador-propor">
            {ocupado === 'propor' ? 'Propondo…' : abertas.length ? 'Propor de novo' : 'Propor subtarefas'}
          </button>
        )}
      </div>
      <p className="mt-1 text-muted">Propõe subtarefas com dono e prazo. Nada é atribuído sozinho: cada uma espera você aceitar.</p>
      {erro && <p role="alert" className="mt-1 text-bad">{erro}</p>}
      {abertas.length > 0 && (
        <ul className="mt-2 space-y-2">
          {abertas.map((s) => (
            <li key={s.id} data-testid={`delegacao-${s.id}`} className="rounded border border-border px-2 py-1.5">
              <p className="font-medium">{s.titulo}</p>
              <p className="text-muted">
                {s.donoTipo === 'agente' ? `Agente sugerido: ${s.donoNome ?? s.donoFuncao}` : `Pessoa: ${s.donoNome ?? 'sem nome'}`}
                {' · '}
                {s.prazo ? `prazo ${s.prazo.split('-').reverse().join('/')}` : 'sem prazo'}
              </p>
              {s.porque && <p className="text-muted">{s.porque}</p>}
              {pode && (
                <div className="mt-1 flex gap-2">
                  <button type="button" className={BOTAO} disabled={!!ocupado} onClick={() => aceitar(s)} data-testid={`delegacao-aceitar-${s.id}`}>
                    Aceitar
                  </button>
                  <button type="button" className={BOTAO} disabled={!!ocupado} onClick={() => descartar(s)} data-testid={`delegacao-descartar-${s.id}`}>
                    Descartar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {decididas.length > 0 && (
        <p className="mt-2 text-muted">
          {decididas.filter((s) => s.estado === 'aceita').length} aceita(s) · {decididas.filter((s) => s.estado === 'descartada').length} descartada(s)
        </p>
      )}
    </section>
  );
}
