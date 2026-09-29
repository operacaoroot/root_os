'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';

/*
 * MK7 — a porta do bloco Marketing.
 *
 * A organização segue a do app que virou o modelo desta frente: marca, banco de
 * ideias, agenda, estratégia, performance, relatório e concorrentes. O que MUDA
 * aqui é que cada uma dessas coisas mora onde ela já tem dono no OS — a agenda
 * é a aba Semana da Pauta, os concorrentes são o acervo de Referências ganhando
 * número, e a marca é contexto da empresa. Repetir cada uma como tela própria
 * criaria a segunda verdade que a decisão do Pedro manda evitar.
 *
 * Por isso esta página é um MAPA, e não um painel: ela diz onde cada coisa está
 * e o que ainda não existe, com o nome da fatia que traz. Painel de números
 * aqui competiria com a Central, que já é a home do OS.
 */

interface Destino {
  titulo: string;
  o_que: string;
  href: string | null;
  onde: string;
  /** Quando ainda não existe, a fatia que traz. */
  falta?: string;
}

const DESTINOS: Destino[] = [
  {
    titulo: 'Marca e pilares',
    o_que: 'Quem a casa é e sobre o que fala. Entra nos pedidos que a pauta faz à IA, ao lado da voz.',
    href: '/contexto/marca',
    onde: 'Contexto',
  },
  {
    titulo: 'Banco de ideias',
    o_que: 'As ideias por pilar, com gancho, roteiro e legenda. Aprovada, vira peça na agenda da semana.',
    href: '/marketing/ideias',
    onde: 'Marketing',
  },
  {
    titulo: 'Agenda do mês',
    o_que: 'O que vai ao ar e quando, com a grade da semana, os feriados e a aprovação em lote.',
    href: '/pauta',
    onde: 'Pauta · aba Semana',
  },
  {
    titulo: 'Estratégia do mês',
    o_que: 'Os pilares da vez, a cadência, as metas, as apostas e o que parar. A IA propõe, você decide.',
    href: '/marketing/estrategia',
    onde: 'Marketing',
  },
  {
    titulo: 'Performance',
    o_que: 'O desempenho da conta e de cada post contra a mediana da própria casa.',
    href: '/marketing/performance',
    onde: 'Marketing',
  },
  {
    titulo: 'Relatório do mês',
    o_que: 'O fechamento: o que foi ao ar, o que decidimos, como rendeu e o que vem.',
    href: '/marketing/relatorio',
    onde: 'Marketing',
  },
  {
    titulo: 'Concorrentes',
    o_que: 'Os perfis observados com número: a mediana de cada um e o índice de cada post contra ela.',
    href: '/referencias',
    onde: 'Referências · aba Concorrentes',
  },
];

export default function MarketingPage() {
  const { ready } = useAuth();
  if (!ready) return <p className="text-muted">Carregando…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Marketing</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          O que decide o que a casa publica. A Pauta é a máquina que publica; este bloco é o que
          alimenta ela — a marca, os pilares, as ideias, a estratégia do mês e a leitura do que
          rendeu.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {DESTINOS.map((d) => {
          const corpo = (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium">{d.titulo}</h2>
                <span className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  {d.onde}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">{d.o_que}</p>
              {d.falta && (
                <p className="mt-2 font-os-mono text-[11px] text-warn">ainda não existe · fatia {d.falta}</p>
              )}
            </>
          );

          return d.href ? (
            <Link
              key={d.titulo}
              href={d.href}
              className="rounded-xl border border-border bg-surface p-4 transition hover:border-brand-dim"
            >
              {corpo}
            </Link>
          ) : (
            <div key={d.titulo} className="rounded-xl border border-border bg-surface p-4 opacity-60">
              {corpo}
            </div>
          );
        })}
      </div>
    </div>
  );
}
