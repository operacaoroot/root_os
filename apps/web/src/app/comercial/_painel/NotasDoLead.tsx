'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LinhaDoFio } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROTULO_DA_ABA, type AbaDoPainel } from './estado';

/*
 * Etapa 9b (#19, pedido do Lucas): o painel do lead ganha um campo de notas e comentários e as abas
 * ligadas entre si. A nota vai para o fio do lead como `nota.manual`, pela rota que já existia
 * (`POST /comercial/lead/:id/fio/nota`); a lista mostra as notas do fio, da mais nova para a mais
 * velha. Os atalhos levam às outras abas do mesmo lead sem fechar o painel.
 */
const ATALHOS: AbaDoPainel[] = ['pendencias', 'contrato', 'sala', 'area', 'whatsapp'];
const quando = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

export function NotasDoLead({ leadId, irParaAba }: { leadId: string; irParaAba: (a: AbaDoPainel) => void }) {
  const { token, can } = useAuth();
  // A rota da nota pede `leads.editar`: sem ela, só a lista.
  const editavel = can('leads.editar');
  const [notas, setNotas] = useState<LinhaDoFio[] | null>(null);
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiGet<{ fio: LinhaDoFio[] }>(`/comercial/lead/${leadId}/fio`, token);
      setNotas(r.fio.filter((l) => l.type === 'nota.manual').sort((a, b) => b.em.localeCompare(a.em)));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [leadId, token]);
  useEffect(() => { void carregar(); }, [carregar]);

  const guardar = async () => {
    if (!token || !texto.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await apiPost(`/comercial/lead/${leadId}/fio/nota`, { texto: texto.trim() }, token);
      setTexto('');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_15rem]">
      <section aria-label="Notas e comentários" className="rounded-md border border-border bg-surface p-4">
        <h3 className="text-[0.95rem] font-semibold">Notas e comentários</h3>
        <p className="text-sm text-muted">O que a equipe precisa lembrar deste lead. Fica no histórico do lead, com quem escreveu e quando.</p>
        {editavel && (
          <div className="mt-3">
            <label htmlFor={`nota-${leadId}`} className="com-rotulo mb-1 block">Nova nota</label>
            <textarea
              id={`nota-${leadId}`}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Ex.: ligou pedindo para falar depois do dia 15; o sócio decide junto."
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted">{texto.length}/1000</span>
              <button type="button" onClick={() => void guardar()} disabled={salvando || !texto.trim()} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50">
                {salvando ? 'Guardando…' : 'Guardar nota'}
              </button>
            </div>
          </div>
        )}
        {erro && <p className="mt-2 text-sm text-bad">{erro}</p>}
        <ul className="mt-3 divide-y divide-border">
          {notas === null ? (
            <li className="py-2 text-sm text-muted">Carregando…</li>
          ) : notas.length === 0 ? (
            <li className="py-2 text-sm text-muted">Nenhuma nota ainda.</li>
          ) : (
            notas.map((n) => (
              <li key={n.eventoId} className="py-2 text-sm">
                <span className="mr-2 font-os-mono text-xs text-muted">{quando(n.em)}</span>
                {n.resumo}
              </li>
            ))
          )}
        </ul>
      </section>
      <nav aria-label="Outras partes do lead" className="rounded-md border border-border bg-surface p-4">
        <h3 className="text-[0.95rem] font-semibold">Ir para</h3>
        <ul className="mt-2 space-y-1">
          {ATALHOS.map((a) => (
            <li key={a}>
              <button type="button" onClick={() => irParaAba(a)} className="text-sm text-brand hover:underline">
                {ROTULO_DA_ABA[a]} →
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
