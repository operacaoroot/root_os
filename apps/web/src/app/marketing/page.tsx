'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { MaquinaPainel, MemoriaPainel, TriagemPainel } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * Marketing › INÍCIO. Cópia da Home do ROOT Estúdio (public/pages/home.js): a faixa
 * escura com "Bora <palavra>" e os quatro cartões vivos que levam para cada parte.
 * Os números vêm da Triagem, da Máquina (Banco e esteira) e da Memória.
 */

const PALAVRAS = ['aprovar', 'gravar', 'revisar', 'publicar'];
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const Seta = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

function useDigitando(palavras: string[]) {
  const [texto, setTexto] = useState(palavras[0]);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let wi = 0;
    let ci = palavras[0].length;
    let apagando = true;
    let t: ReturnType<typeof setTimeout>;
    const passo = () => {
      const w = palavras[wi];
      if (!apagando) {
        ci++;
        setTexto(w.slice(0, ci));
        if (ci === w.length) {
          apagando = true;
          t = setTimeout(passo, 1600);
          return;
        }
        t = setTimeout(passo, 70 + Math.random() * 60);
      } else {
        ci--;
        setTexto(w.slice(0, ci));
        if (ci === 0) {
          apagando = false;
          wi = (wi + 1) % palavras.length;
          t = setTimeout(passo, 350);
          return;
        }
        t = setTimeout(passo, 36);
      }
    };
    t = setTimeout(passo, 1600);
    return () => clearTimeout(t);
  }, [palavras]);
  return texto;
}

export default function MarketingInicioPage() {
  const { user, token, ready, can } = useAuth();
  const palavra = useDigitando(PALAVRAS);
  const [triagem, setTriagem] = useState<TriagemPainel | null>(null);
  const [maquina, setMaquina] = useState<MaquinaPainel | null>(null);
  const [memoria, setMemoria] = useState<MemoriaPainel | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    void apiGet<TriagemPainel>('/marketing/estudio/triagem', token).then(setTriagem).catch(() => undefined);
    void apiGet<MaquinaPainel>('/marketing/maquina', token).then(setMaquina).catch(() => undefined);
    void apiGet<MemoriaPainel>('/marketing/estudio/memoria', token).then(setMemoria).catch(() => undefined);
  }, [ready, token]);

  if (ready && !can('pauta.ver')) return <div className="estudio"><p className="muted">Acesso insuficiente para Marketing.</p></div>;

  const primeiroNome = String(user?.name ?? '').split(/\s+/)[0];
  const paraAprovar = triagem?.contagem.nova ?? 0;
  const posts = maquina?.posts ?? [];
  const noBanco = posts.filter((p) => p.etapa === 'ideia').length;
  const emProducao = posts.filter((p) => p.etapa === 'producao' || p.etapa === 'a_agendar').length;
  const agendados = posts.filter((p) => p.etapa === 'agendado').length;
  const hoje = new Date().toISOString().slice(0, 10);
  const notasHoje = (memoria?.notas ?? []).filter((n) => n.criadaEm.slice(0, 10) === hoje).length;
  const resumo = [
    paraAprovar ? (
      <span key="a">
        <b>{plural(paraAprovar, 'ideia', 'ideias')}</b> para aprovar
      </span>
    ) : (
      <span key="a">nenhuma ideia esperando</span>
    ),
    emProducao ? (
      <span key="p">
        <b>{plural(emProducao, 'peça', 'peças')}</b> em produção
      </span>
    ) : (
      <span key="p">nada em produção</span>
    ),
    <span key="b">
      <b>{plural(noBanco, 'ideia', 'ideias')}</b> no Banco
    </span>,
  ];
  const cta = paraAprovar ? { href: '/marketing/triagem', label: 'Aprovar ideias' } : { href: '/marketing/memoria', label: 'Abrir a Memória' };

  return (
    <div className="estudio">
      <section className="home-hero" style={{ marginTop: 14 }}>
        <div className="home-grid-bg" aria-hidden="true" />
        <p className="home-eyebrow">ROOT · Marketing</p>
        <p className="home-hello">Bem-vindo de volta{primeiroNome ? `, ${primeiroNome}` : ''}</p>
        <h1 className="home-title">
          Bora{' '}
          <span className="home-tw" aria-hidden="true">
            {palavra}
          </span>
          <span className="home-cur" aria-hidden="true" />
          <span className="sr-only">criar conteúdo</span>
        </h1>
        <p className="home-sub">
          Hoje você tem{' '}
          {resumo.map((r, i) => (
            <span key={i}>
              {r}
              {i < resumo.length - 1 ? ', ' : ''}
            </span>
          ))}
          .
        </p>
        <div className="row home-hero-actions">
          <Link className="home-btn" href={cta.href}>
            {cta.label} <Seta />
          </Link>
          {notasHoje > 0 && <span className="home-today-pill">{plural(notasHoje, 'nota chegou', 'notas chegaram')} hoje na Memória</span>}
        </div>
      </section>
      <div className="home-cards">
        <Link className="home-card" href="/marketing/triagem">
          <span className="home-k">Ideias para aprovar</span>
          <span className="home-v">{paraAprovar}</span>
          <span className="home-d">{triagem ? `${triagem.contagem.aprovada} aprovadas até hoje` : '…'}</span>
          <span className="home-go">
            Aprovar ideias <Seta />
          </span>
        </Link>
        <Link className="home-card" href="/marketing/banco">
          <span className="home-k">Ideias de conteúdo</span>
          <span className="home-v">{noBanco}</span>
          <span className="home-d">no Banco, esperando formato</span>
          <span className="home-go">
            Ver o Banco <Seta />
          </span>
        </Link>
        <Link className="home-card" href="/marketing/producao">
          <span className="home-k">Em produção</span>
          <span className="home-v">{emProducao}</span>
          <span className="home-d">{agendados ? `${plural(agendados, 'post agendado', 'posts agendados')}` : 'Aprove uma ideia para começar uma peça.'}</span>
          <span className="home-go">
            Produção <Seta />
          </span>
        </Link>
        <Link className="home-card" href="/marketing/memoria">
          <span className="home-k">Memória</span>
          <span className="home-v">{memoria?.total ?? 0}</span>
          <span className="home-d">{memoria ? `${memoria.pastas.find((p) => p.nome === 'Vídeos')?.n ?? 0} vídeos · ${memoria.pastas.find((p) => p.nome === 'Links')?.n ?? 0} links` : '…'}</span>
          <span className="home-go">
            Abrir a Memória <Seta />
          </span>
        </Link>
      </div>
      <div className="home-shortcuts">
        <Link className="home-shortcut" href="/marketing/formatos">
          <div className="grow">
            <span className="home-k">Formatos</span>
            <p>A régua de cada formato, que a IA segue ao escrever os posts.</p>
          </div>
          <Seta />
        </Link>
        <Link className="home-shortcut" href="/contexto/marca">
          <div className="grow">
            <span className="home-k">Marca</span>
            <p>Cores, fontes, voz e pilares que a IA usa nas peças.</p>
          </div>
          <Seta />
        </Link>
      </div>
    </div>
  );
}
