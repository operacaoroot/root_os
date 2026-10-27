'use client';

import { useEffect, useState } from 'react';
import type { TriagemBase, TriagemCard } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * Marketing › IDEIAS DE CONTEÚDO › Base. Cópia da aba Base do ROOT Estúdio
 * (public/pages/ideias.js, tab "base"): tudo o que foi aprovado, separado entre o que
 * você salvou (Memória) e o que veio das fontes, com busca. O comentário que você
 * deixou ao aprovar aparece junto: é o que ensina a IA.
 */

const dataCurta = (s: string | null) => {
  if (!s) return '';
  try {
    return new Date(s).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
};

function Item({ c }: { c: TriagemCard }) {
  return (
    <article className={`ideias-base-item ideias-base-${c.origem}`}>
      <div className="ideias-source">
        <span className={`ideias-origin ideias-origin-${c.origem}`}>{c.origem === 'salvo' ? 'Salvo' : 'Da fonte'}</span>
        <span className="ideias-origin-line">
          {c.origem === 'salvo' ? (
            <>Você salvou{c.publicadoEm ? ` em ${dataCurta(c.publicadoEm)}` : ''}</>
          ) : (
            <>
              <strong>{c.fonte?.nome ?? 'Uma fonte'}</strong>
              {c.publicadoEm ? ` postou em ${dataCurta(c.publicadoEm)}` : ''} · extraído pela Root
            </>
          )}
        </span>
        {c.url && /^https?:\/\//.test(c.url) && (
          <a href={c.url} target="_blank" rel="noopener noreferrer">
            ver original ↗
          </a>
        )}
      </div>
      <h3>{c.titulo}</h3>
      {c.resumo && <p className="ideias-base-summary">{c.resumo}</p>}
      {c.comentario && (
        <blockquote className="ideias-note">
          <span>Seu comentário</span>
          {c.comentario}
        </blockquote>
      )}
      {c.como.pontos.length > 0 && (
        <section className="ideias-points">
          <h3>Pontos principais</h3>
          <ul>
            {c.como.pontos.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

export default function BasePage() {
  const { token, ready, can } = useAuth();
  const [origem, setOrigem] = useState('');
  const [q, setQ] = useState('');
  const [base, setBase] = useState<TriagemBase | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    const t = setTimeout(() => {
      apiGet<TriagemBase>(`/marketing/estudio/triagem/base?${new URLSearchParams({ q, origem })}`, token)
        .then((b) => {
          setBase(b);
          setErro(null);
        })
        .catch((e) => setErro((e as Error).message));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [ready, token, q, origem]);

  if (ready && !can('pauta.ver')) return <div className="estudio"><p className="muted">Acesso insuficiente para Marketing.</p></div>;
  const salvos = (base?.cards ?? []).filter((c) => c.origem === 'salvo');
  const fontes = (base?.cards ?? []).filter((c) => c.origem === 'fonte');
  const secao = (titulo: string, itens: TriagemCard[]) =>
    itens.length ? (
      <section className="ideias-base-section">
        <h2>
          {titulo} <span className="muted">{itens.length}</span>
        </h2>
        {itens.map((c) => (
          <Item key={c.id} c={c} />
        ))}
      </section>
    ) : null;

  return (
    <div className="estudio">
      <div className="ideias-base">
        <div className="ideias-base-bar">
          <div className="filters ideias-filters" role="group" aria-label="Filtrar por origem">
            {[
              ['', 'Tudo'],
              ['fonte', `Das fontes${base ? ` ${base.contagem.fonte}` : ''}`],
              ['salvo', `Salvos por você${base ? ` ${base.contagem.salvo}` : ''}`],
            ].map(([k, l]) => (
              <button key={k} className={origem === k ? 'active' : ''} onClick={() => setOrigem(k)}>
                {l}
              </button>
            ))}
          </div>
          <input type="search" className="search ideias-search" placeholder="Buscar na Base" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar na Base" />
        </div>
        {erro && <div className="notice warn">{erro}</div>}
        <div className="ideias-base-list">
          {!base ? (
            <p className="muted">Carregando…</p>
          ) : base.cards.length === 0 ? (
            <div className="empty">
              <h3>{q || origem ? 'Nada com esse filtro' : 'A Base está vazia'}</h3>
              <p>As ideias que você aprova em Para aprovar ficam guardadas aqui.</p>
            </div>
          ) : origem ? (
            base.cards.map((c) => <Item key={c.id} c={c} />)
          ) : (
            <>
              {secao('Salvos por você', salvos)}
              {secao('Das fontes', fontes)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
