'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { PainelComercial, PainelComercialNegocio } from '@mktos/shared';
import { apiGet, apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * FUNIL DE VENDAS: o CRM (lista "Gestão de Leads") como quadro. Uma coluna por
 * etapa, na ordem do funil; arrastar o cartão muda a etapa, clicar abre a
 * ficha do lead. Lê o mesmo `/comercial/painel` do painel do comercial, então
 * os dois nunca discordam.
 */
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export default function FunilPage() {
  const { token, ready, can } = useAuth();
  const pode = can('tarefas.editar');
  const [p, setP] = useState<PainelComercial | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<PainelComercialNegocio | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<PainelComercial>('/comercial/painel', token).then(setP).catch((e) => setErro(e.message));
  }, [token]);

  useEffect(() => {
    if (ready && token) carregar();
  }, [ready, token, carregar]);

  const mover = async (n: PainelComercialNegocio, statusId: string) => {
    if (!token || !p || n.statusId === statusId) return;
    const etapa = p.etapas.find((e) => e.id === statusId)!;
    // Otimista: o cartão muda de coluna já; se a API recusar, recarrega.
    setP({ ...p, negocios: p.negocios.map((x) => (x.id === n.id ? { ...x, statusId, etapa: etapa.nome, resultado: etapa.resultado } : x)) });
    try {
      await apiPatch(`/trabalho/tarefas/${n.id}`, { statusId, expectedUpdatedAt: n.atualizadoEm }, token);
    } catch (e) {
      setErro((e as Error).message);
    }
    carregar();
  };

  if (erro && !p) return <p className="text-bad">{erro}</p>;
  if (!p) return <p className="text-muted">Carregando…</p>;
  if (!p.lista) return <p className="text-muted">Ainda não existe a lista Gestão de Leads.</p>;

  return (
    <div className="com-tema space-y-4 text-text">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted">
          Arraste o cartão para mudar a etapa. Clique para abrir a ficha.
        </p>
        <Link href="/comercial" className="text-sm text-muted underline hover:text-text">ver o painel</Link>
      </div>
      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {p.etapas.map((e) => {
          const cartoes = p.negocios.filter((n) => n.statusId === e.id).sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));
          const soma = cartoes.reduce((s, n) => s + (n.valor ?? 0), 0);
          return (
            <div
              key={e.id}
              onDragOver={(ev) => { if (arrastando) { ev.preventDefault(); setSobre(e.id); } }}
              onDragLeave={() => setSobre((s) => (s === e.id ? null : s))}
              onDrop={(ev) => { ev.preventDefault(); setSobre(null); if (arrastando) mover(arrastando, e.id); setArrastando(null); }}
              // Coluna vazia fica estreita: o que tem cartão ganha a largura da tela.
              className={`flex ${cartoes.length || sobre === e.id ? 'w-64' : 'w-36'} shrink-0 flex-col rounded-md border bg-surface transition-[width] ${sobre === e.id ? 'border-brand' : 'border-border'} ${e.resultado === 'perdido' ? 'opacity-80' : ''}`}
            >
              <div className="border-b border-border px-3 py-2.5" style={{ borderTop: `3px solid ${e.cor}` }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{e.nome}</span>
                  <span className="com-num text-sm text-muted">{cartoes.length}</span>
                </div>
                <div className="com-num text-sm text-muted">{soma ? brl(soma) : '—'}</div>
              </div>
              <div className="flex min-h-[8rem] flex-col gap-2 p-2">
                {cartoes.map((n) => (
                  <Link
                    key={n.id}
                    href={`/comercial/lead/${n.id}`}
                    draggable={pode}
                    onDragStart={() => setArrastando(n)}
                    onDragEnd={() => { setArrastando(null); setSobre(null); }}
                    className="block rounded-md border border-border bg-surface-2 px-3 py-2 hover:border-brand/60"
                  >
                    <div className="text-sm font-medium leading-snug">{n.titulo}</div>
                    {n.contato && <div className="mt-0.5 text-xs text-muted">{n.contato}</div>}
                    <div className="mt-2 flex items-baseline justify-between gap-2 text-xs text-muted">
                      <span>
                        {n.vendedor ?? 'sem vendedor'}
                        {n.resultado === 'aberta' && n.diasNaEtapa != null && ` · ${n.diasNaEtapa}d`}
                      </span>
                      <span className="com-num text-sm text-text">{n.valor != null ? brl(n.valor) : '—'}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
