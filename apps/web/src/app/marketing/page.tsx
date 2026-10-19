'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { MaquinaEtapa } from '@mktos/shared';
import { MaquinaPagina } from '@/components/maquina/MaquinaPagina';
import { hojeSP } from '@/components/maquina/pecas';
import { useAuth } from '@/lib/auth';

/*
 * Marketing › INÍCIO: a home da Máquina de Conteúdo da empresa, no padrão da
 * Máquina dos clientes: saudação, "Bora <palavra>" e os três lugares onde há
 * trabalho esperando. Nada mais: o resto está nas abas.
 *
 * (Até 19/10/2026 esta página era o mapa de onde cada parte do marketing
 * morava; as abas do módulo fazem esse papel agora.)
 */

const PALAVRAS = ['criar', 'aprovar', 'gravar', 'agendar', 'postar', 'analisar'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Digita, espera 1,6 s e apaga, palavra por palavra, como na Máquina dos clientes. */
function useDigitando(palavras: string[]) {
  const [texto, setTexto] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTexto(palavras[0]);
      return;
    }
    let i = 0;
    let n = 0;
    let apagando = false;
    let t: ReturnType<typeof setTimeout>;
    const passo = () => {
      const p = palavras[i % palavras.length];
      if (!apagando) {
        n++;
        setTexto(p.slice(0, n));
        if (n === p.length) {
          apagando = true;
          t = setTimeout(passo, 1600);
          return;
        }
        t = setTimeout(passo, 70 + Math.random() * 60);
      } else {
        n--;
        setTexto(p.slice(0, n));
        if (n === 0) {
          apagando = false;
          i++;
        }
        t = setTimeout(passo, 36);
      }
    };
    t = setTimeout(passo, 300);
    return () => clearTimeout(t);
  }, [palavras]);
  return texto;
}

const CARTOES: { etapa: MaquinaEtapa; titulo: string; href: string; vazio: string }[] = [
  { etapa: 'ideia', titulo: 'Banco de ideias', href: '/marketing/banco', vazio: 'nenhuma ideia esperando' },
  { etapa: 'producao', titulo: 'Design & Gravação', href: '/marketing/producao', vazio: 'nada em produção' },
  { etapa: 'a_agendar', titulo: 'Agendar', href: '/marketing/agendar', vazio: 'nada pronto sem data' },
];

export default function MarketingInicioPage() {
  const { user } = useAuth();
  const palavra = useDigitando(PALAVRAS);
  const hoje = hojeSP();
  const primeiroNome = user?.name?.split(' ')[0];

  return (
    <MaquinaPagina titulo="Marketing" semCabecalho>
      {({ painel }) => {
        const conta = (e: MaquinaEtapa) => painel.posts.filter((p) => p.etapa === e).length;
        const proximo = painel.posts
          .filter((p) => p.etapa === 'agendado' && p.data && p.data >= hoje)
          .sort((a, b) => a.data!.localeCompare(b.data!))[0];
        return (
          <div className="space-y-10 py-4">
            <section>
              <div className="com-rotulo">
                Marketing · {MESES[Number(hoje.slice(5, 7)) - 1]} {hoje.slice(0, 4)}
              </div>
              <p className="mt-6 text-lg text-muted">
                {primeiroNome ? `${primeiroNome}, bem-vindo` : 'Bem-vindo'} à Máquina de Conteúdo
              </p>
              <h1 className="mt-1 text-[clamp(3rem,9vw,6.5rem)] font-bold leading-[0.95] tracking-[-0.03em]">
                Bora <span className="text-brand">{palavra}</span>
                <span aria-hidden className="ml-1 inline-block w-[0.08em] animate-pulse bg-brand align-baseline">
                  &nbsp;
                </span>
              </h1>
            </section>

            <section className="grid gap-3 md:grid-cols-3">
              {CARTOES.map((c) => {
                const n = conta(c.etapa);
                return (
                  <Link
                    key={c.etapa}
                    href={c.href}
                    className={`group rounded-md border bg-surface p-5 transition hover:border-brand ${n ? 'border-border-strong' : 'border-border'}`}
                  >
                    <div className="com-rotulo">{c.titulo}</div>
                    <div className={`com-num mt-3 text-[3rem] font-bold leading-none ${n ? 'text-text' : 'text-dim'}`}>{n}</div>
                    <div className="mt-3 flex items-center justify-between text-sm text-muted">
                      <span>{n ? (n === 1 ? '1 post' : `${n} posts`) : c.vazio}</span>
                      <span className="font-os-mono text-xs text-brand opacity-70 group-hover:opacity-100">abrir →</span>
                    </div>
                  </Link>
                );
              })}
            </section>

            {proximo && (
              <p className="text-sm text-muted">
                Próximo post: <span className="text-text">{proximo.titulo}</span> ·{' '}
                <Link href={`/marketing/calendario?post=${proximo.id}`} className="text-brand underline">
                  ver no calendário
                </Link>
              </p>
            )}
          </div>
        );
      }}
    </MaquinaPagina>
  );
}
