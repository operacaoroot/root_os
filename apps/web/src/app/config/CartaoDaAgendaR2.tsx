'use client';

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';

import { apiGet } from '@/lib/api';

/*
 * AGENDA: MARCAR PELA TELA SAI NO CLIQUE? (agenda v2, 29/10/2026, decisão 2).
 *
 * Só leitura. O valor é a `aprovacaoR2Ligada` da versão ativa da política da
 * empresa, e só muda por sobrescrita assinada (o comando
 * `sobrescrita-r2-da-agenda.cli`, com autor e motivo): não existe botão aqui de
 * propósito. Vale só para gente na tela; agente, rotina e link público seguem
 * pela fila.
 */
interface EstadoDaAprovacaoR2 {
  ligada: boolean;
  desde: string | null;
  versao: number | null;
  assinadoPor: string | null;
  motivo: string | null;
}

const data = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

export function CartaoDaAgendaR2({ token }: { token: string | null }) {
  const [estado, setEstado] = useState<EstadoDaAprovacaoR2 | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiGet<EstadoDaAprovacaoR2>('/agenda/aprovacao-r2', token).then(setEstado).catch((e: Error) => setErro(e.message));
  }, [token]);

  const sai = estado ? !estado.ligada : null;
  return (
    <section className="rounded-xl border border-border bg-surface p-5" data-cartao-agenda-r2="">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <CalendarClock size={16} className="text-brand" /> Agenda: marcar pela tela sai no clique?
      </div>
      {erro && <p className="text-sm text-bad">{erro}</p>}
      {!erro && !estado && <p className="text-sm text-muted">…</p>}
      {estado && (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Sai no clique</dt>
            <dd className={`text-right font-medium ${sai ? 'text-good' : 'text-text'}`}>{sai ? 'sim' : 'não'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Desde</dt>
            <dd className="text-right">{estado.desde && sai ? data(estado.desde) : 'sempre foi assim'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Quem assinou</dt>
            <dd className="text-right">{sai ? (estado.assinadoPor ?? 'sem registro') : 'ninguém'}</dd>
          </div>
          {sai && estado.motivo && (
            <div>
              <dt className="text-muted">Motivo</dt>
              <dd className="mt-1 text-[13px]">{estado.motivo}</dd>
            </div>
          )}
          <p className="pt-1 text-[12px] text-muted">
            {sai
              ? 'Marcar, alterar, cancelar e desmarcar feitos por uma pessoa na tela saem na hora, com desfazer. Agente, rotina e link de escolha seguem para a fila. Reabrir (R3) sempre pede outra pessoa.'
              : 'Toda escrita na agenda vai para a fila de aprovações e outra pessoa confirma. Mudar isso é uma sobrescrita assinada da política, com responsável e motivo.'}
          </p>
        </dl>
      )}
    </section>
  );
}
