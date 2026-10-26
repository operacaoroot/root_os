'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { VisaoGeralDasTarefas } from '@/components/tarefas/VisaoGeralDasTarefas';
import { ImplantacaoNoDiaADia } from '@/components/tarefas/ImplantacaoNoDiaADia';
import { AniversariosDoDia } from '@/components/AniversariosDoDia';
import { useModulos } from '@/components/modulos';
import { WhatsappNoDiaADia } from '@/components/whatsapp/WhatsappNoDiaADia';

/*
 * DIA A DIA › VISÃO GERAL (versão final, 19/10/2026): a primeira aba e a entrada
 * do Dia a dia. O dash das tarefas do Lucas, organizado pelas pastas e listas do
 * Trabalho. A lista de todas as tarefas que morava aqui virou "Todas" no
 * Trabalho; cada número abre essa lista já filtrada.
 *
 * LAYOUT (26/10/2026, só arrumação, nada sai): os quatro números abrem a tela,
 * WhatsApp e Implantação dividem a mesma linha (antes o WhatsApp ocupava meia
 * linha e a outra metade ficava vazia) e a frase que explica a tela mora no "?".
 */
const EXPLICACAO = 'As tarefas de todas as pastas, num dash só. Cada número abre a lista no Trabalho.';

export default function VisaoGeralPage() {
  const { can, token } = useAuth();
  const { ligado } = useModulos();
  const comWhatsapp = can('leads.ver') && ligado('leads');
  // Produção 22C (W4): o WhatsApp no Dia a dia, só com o comercial contratado e quem vê os leads.
  const whatsapp = comWhatsapp ? <WhatsappNoDiaADia token={token} /> : null;
  return (
    <div className="com-tema mx-auto max-w-[1240px] space-y-5 text-text">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <details className="relative mr-auto">
          <summary
            aria-label="O que é esta tela"
            title={EXPLICACAO}
            className="grid h-7 w-7 cursor-pointer list-none place-items-center rounded-full border border-border text-sm text-muted hover:border-brand hover:text-text [&::-webkit-details-marker]:hidden"
          >
            ?
          </summary>
          <p className="absolute left-0 z-20 mt-2 w-72 rounded-md border border-border bg-surface p-3 text-sm text-muted shadow-lg">{EXPLICACAO}</p>
        </details>
        <Link href="/trabalho?pasta=todas&visao=lista" className="text-sm text-muted underline hover:text-brand">todas as tarefas no Trabalho</Link>
      </div>
      {/* Produção 22B (I6): o aniversário do dia, junto do dash (quem não vê as tarefas não carrega nada aqui). */}
      {can('tarefas.ver') && <AniversariosDoDia />}
      {can('tarefas.ver') ? (
        <VisaoGeralDasTarefas
          meio={
            <div className={`grid items-start gap-5 ${whatsapp ? 'lg:grid-cols-2' : ''}`}>
              {whatsapp}
              <ImplantacaoNoDiaADia token={token} />
            </div>
          }
        />
      ) : (
        <>
          {whatsapp && <div className="grid gap-5 lg:grid-cols-2">{whatsapp}</div>}
          <p className="text-muted">Sem acesso às tarefas.</p>
        </>
      )}
    </div>
  );
}
