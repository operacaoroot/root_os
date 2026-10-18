'use client';

import { useCallback, useEffect, useState } from 'react';
import type { QuadroDaLista } from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EVENTO_FICHA_MUDOU, abrirFicha } from '@/lib/ficha';

/*
 * O quadro de uma lista da jornada do cliente (onboarding, sucesso). Arrastar
 * muda a etapa; clicar abre a ficha em janela, sem sair do quadro.
 */
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
type Cartao = QuadroDaLista['cartoes'][number];

export function QuadroDeClientes({ chave, rotuloDoValor }: { chave: string; rotuloDoValor: string }) {
  const { token, ready, can } = useAuth();
  const pode = can('tarefas.editar');
  const [q, setQ] = useState<QuadroDaLista | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<Cartao | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<QuadroDaLista>(`/trabalho/fichas/quadro?lista=${chave}`, token).then(setQ).catch((e) => setErro(e.message));
  }, [token, chave]);

  useEffect(() => {
    if (!ready || !token) return;
    carregar();
    window.addEventListener(EVENTO_FICHA_MUDOU, carregar);
    return () => window.removeEventListener(EVENTO_FICHA_MUDOU, carregar);
  }, [ready, token, carregar]);

  const mover = async (c: Cartao, statusId: string) => {
    if (!token || !q || c.statusId === statusId) return;
    setQ({ ...q, cartoes: q.cartoes.map((x) => (x.id === c.id ? { ...x, statusId } : x)) });
    try {
      await apiPatch(`/trabalho/tarefas/${c.id}`, { statusId, expectedUpdatedAt: c.atualizadoEm }, token);
    } catch (e) {
      setErro((e as Error).message);
    }
    carregar();
  };

  const novo = async () => {
    if (!token || !q?.lista) return;
    const titulo = window.prompt('Nome do cliente (empresa | o que contratou):')?.trim();
    if (!titulo) return;
    try {
      const t = await apiPost<{ id: string }>('/trabalho/tarefas', { listId: q.lista.id, title: titulo }, token);
      carregar();
      abrirFicha(t.id);
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  if (erro && !q) return <p className="text-bad">{erro}</p>;
  if (!q) return <p className="text-muted">Carregando…</p>;
  if (!q.lista) return <p className="text-muted">Esta lista ainda não existe. Rode a carga do CRM (db:seed:crm).</p>;

  const total = q.cartoes.reduce((s, c) => s + (c.valor ?? 0), 0);
  const ativos = q.cartoes.filter((c) => !q.etapas.find((e) => e.id === c.statusId)?.fechada);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-6">
          <div>
            <div className="com-rotulo">Clientes ativos</div>
            <div className="com-num text-[1.6rem] font-bold">{ativos.length}</div>
          </div>
          <div>
            <div className="com-rotulo">{rotuloDoValor}</div>
            <div className="com-num text-[1.6rem] font-bold">{brl(ativos.reduce((s, c) => s + (c.valor ?? 0), 0))}</div>
          </div>
          {total !== ativos.reduce((s, c) => s + (c.valor ?? 0), 0) && (
            <div>
              <div className="com-rotulo">Com os encerrados</div>
              <div className="com-num text-[1.6rem] font-bold text-muted">{brl(total)}</div>
            </div>
          )}
        </div>
        {pode && (
          <button onClick={novo} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90">
            + Novo cliente
          </button>
        )}
      </div>
      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {q.etapas.map((e) => {
          const cartoes = q.cartoes.filter((c) => c.statusId === e.id).sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));
          const soma = cartoes.reduce((s, c) => s + (c.valor ?? 0), 0);
          return (
            <div
              key={e.id}
              onDragOver={(ev) => { if (arrastando) { ev.preventDefault(); setSobre(e.id); } }}
              onDragLeave={() => setSobre((s) => (s === e.id ? null : s))}
              onDrop={(ev) => { ev.preventDefault(); setSobre(null); if (arrastando) mover(arrastando, e.id); setArrastando(null); }}
              className={`flex ${cartoes.length || sobre === e.id ? 'w-64' : 'w-36'} shrink-0 flex-col rounded-md border bg-surface transition-[width] ${sobre === e.id ? 'border-brand' : 'border-border'} ${e.fechada ? 'opacity-80' : ''}`}
            >
              <div className="border-b border-border px-3 py-2.5" style={{ borderTop: `3px solid ${e.cor}` }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{e.nome}</span>
                  <span className="com-num text-sm text-muted">{cartoes.length}</span>
                </div>
                <div className="com-num text-sm text-muted">{soma ? brl(soma) : '—'}</div>
              </div>
              <div className="flex min-h-[8rem] flex-col gap-2 p-2">
                {cartoes.map((c) => (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    draggable={pode}
                    onDragStart={() => setArrastando(c)}
                    onDragEnd={() => { setArrastando(null); setSobre(null); }}
                    onClick={() => abrirFicha(c.id)}
                    onKeyDown={(ev) => ev.key === 'Enter' && abrirFicha(c.id)}
                    className="cursor-pointer rounded-md border border-border bg-surface-2 px-3 py-2 hover:border-brand/60"
                  >
                    <div className="text-sm font-medium leading-snug">{c.titulo}</div>
                    {c.contato && <div className="mt-0.5 text-xs text-muted">{c.contato}</div>}
                    {c.selo && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[0.7rem] text-muted">
                        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c.seloCor ?? '#888' }} />
                        {c.selo}
                      </span>
                    )}
                    <div className="mt-2 flex items-baseline justify-between gap-2 text-xs text-muted">
                      <span>
                        {c.responsavel ?? 'sem responsável'}
                        {c.diasNaEtapa != null && ` · ${c.diasNaEtapa}d`}
                      </span>
                      <span className="com-num text-sm text-text">{c.valor != null ? brl(c.valor) : '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
