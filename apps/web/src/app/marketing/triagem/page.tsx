'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FORMATOS_COM_REGUA, MOTIVOS_RAPIDOS, type TriagemCard, type TriagemPainel, type TriagemStatus, type TriagemTodas } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * Marketing › IDEIAS DE CONTEÚDO › Para aprovar. Cópia da tela do ROOT Estúdio
 * (public/pages/ideias.js): "Mandar referência", um card por vez com a imagem à
 * esquerda e o texto editável, Recusar/Aprovar e os motivos rápidos. Teclas ← e →.
 * O cabeçalho e as abas vêm do AppShell (AbasDoMarketing).
 *
 * A referência mandada aqui entra na Memória (vira nota e depois card). Aprovar
 * manda para o Banco da Produção; recusar ensina (o peso da fonte desce).
 *
 * "Ver todas" (30/10/2026, pedido do Lucas): a grade com todos os cards de um status
 * (para avaliar, aprovadas, recusadas, descartadas pela IA), com busca, sem a ordem do
 * um por vez. Card que nasceu com a IA fora do ar aparece marcado e a IA relê sozinha.
 */

const firstLine = (v: string, n = 90) => {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const dataCurta = (s: string | null) => {
  if (!s) return '';
  try {
    return new Date(s).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
};

const FILTROS: [TriagemStatus, string][] = [
  ['nova', 'Para avaliar'],
  ['aprovada', 'Aprovadas'],
  ['recusada', 'Recusadas'],
  ['descartada_ia', 'Descartadas pela IA'],
];

type Edicao = { titulo: string; resumo: string; gancho: string; formato: string };

export default function TriagemPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const [painel, setPainel] = useState<TriagemPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [montando, setMontando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [comentario, setComentario] = useState('');
  const [ref, setRef] = useState({ url: '', nota: '' });
  const [enviando, setEnviando] = useState(false);
  const [modo, setModo] = useState<'um' | 'todas'>('um');
  const [foco, setFoco] = useState<TriagemCard | null>(null);
  const [todas, setTodas] = useState<TriagemTodas | null>(null);
  const [filtro, setFiltro] = useState<TriagemStatus>('nova');
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<'relevancia' | 'recentes'>('relevancia');
  const [relendo, setRelendo] = useState<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('ver') === 'todas') setModo('todas');
  }, []);
  const trocarModo = (m: 'um' | 'todas') => {
    setModo(m);
    const u = new URL(window.location.href);
    if (m === 'todas') u.searchParams.set('ver', 'todas');
    else u.searchParams.delete('ver');
    window.history.replaceState(null, '', u);
  };

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      setPainel(await apiGet<TriagemPainel>('/marketing/estudio/triagem', token));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token]);

  const carregarTodas = useCallback(async () => {
    if (!token) return;
    try {
      setTodas(await apiGet<TriagemTodas>(`/marketing/estudio/triagem/todas?status=${filtro}`, token));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token, filtro]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  useEffect(() => {
    if (ready && modo === 'todas') void carregarTodas();
  }, [ready, modo, carregarTodas]);

  // Enquanto a IA lê, a tela se atualiza sozinha.
  useEffect(() => {
    if (!painel?.lendo) return;
    const t = setInterval(() => {
      void carregar();
      if (modo === 'todas') void carregarTodas();
    }, 8000);
    return () => clearInterval(t);
  }, [painel?.lendo, modo, carregar, carregarTodas]);

  // O card em foco (aberto pela grade) vem com o texto mais novo quando o painel recarrega.
  const card: TriagemCard | undefined = (foco && (painel?.cards.find((c) => c.id === foco.id) ?? todas?.cards.find((c) => c.id === foco.id) ?? foco)) || painel?.cards[0];
  useEffect(() => {
    setEdicao(card ? { titulo: card.titulo, resumo: card.resumo, gancho: card.como.gancho, formato: card.como.formato } : null);
    setComentario('');
  }, [card?.id, card?.lida, card?.titulo, card?.porque]); // eslint-disable-line react-hooks/exhaustive-deps

  const decidir = useCallback(
    async (alvo: TriagemCard, decisao: 'aprovada' | 'recusada', extra: { motivo?: string; edicao?: Edicao | null; comentario?: string } = {}) => {
      if (ocupado) return;
      setOcupado(true);
      try {
        const nota = extra.comentario?.trim() || undefined;
        const e = extra.edicao;
        const corpo = decisao === 'aprovada' ? { decisao, titulo: e?.titulo, resumo: e?.resumo, gancho: e?.gancho, formato: e?.formato, comentario: nota } : { decisao, motivo: extra.motivo, comentario: nota };
        await apiPost(`/marketing/estudio/triagem/${alvo.id}/decisao`, corpo, token);
        setAviso(decisao === 'aprovada' ? 'Aprovada. Está no Banco de ideias.' : 'Recusada. A fonte pesa um pouco menos na próxima.');
        if (foco?.id === alvo.id) setFoco(null);
        await Promise.all([carregar(), modo === 'todas' ? carregarTodas() : Promise.resolve()]);
      } catch (err) {
        setErro((err as Error).message);
      } finally {
        setOcupado(false);
      }
    },
    [ocupado, token, foco, modo, carregar, carregarTodas],
  );

  const decidirAtual = useCallback(
    (decisao: 'aprovada' | 'recusada', motivo?: string) => (card ? decidir(card, decisao, { motivo, edicao: decisao === 'aprovada' ? edicao : null, comentario }) : undefined),
    [card, decidir, edicao, comentario],
  );

  useEffect(() => {
    if (!editavel || modo !== 'um') return;
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') void decidirAtual('aprovada');
      if (e.key === 'ArrowLeft') void decidirAtual('recusada');
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [decidirAtual, editavel, modo]);

  const montar = async () => {
    setMontando(true);
    setAviso(null);
    try {
      const r = await apiPost<{ lidos: number; cards: number; descartados: number; falharam: number }>('/marketing/estudio/triagem/montar', { quantas: 12 }, token);
      setAviso(r.lidos === 0 ? 'Nada novo para ler.' : `${r.cards} ideias novas${r.descartados ? ` (${r.descartados} fora do tema)` : ''}${r.falharam ? `, ${r.falharam} falharam` : ''}.`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setMontando(false);
    }
  };

  /** Reler com a IA: um card (id) ou todos os que nasceram sem leitura. */
  const reler = async (id?: string) => {
    setRelendo(id ?? 'todos');
    setAviso(id ? null : 'A IA está lendo as ideias. Os cards se atualizam sozinhos.');
    try {
      const pedido = apiPost<{ lidos: number; relidos: number; falharam: number }>('/marketing/estudio/triagem/reler', id ? { ids: [id] } : {}, token);
      if (!id) {
        // Todos demora: a tela acompanha pelo painel, sem esperar a resposta.
        void pedido.catch((e) => setErro((e as Error).message));
        setTimeout(() => void carregar(), 1500);
        return;
      }
      const r = await pedido;
      setAviso(r.relidos ? 'A IA leu e reescreveu o card.' : 'A IA não conseguiu ler esse card agora. Tente de novo em instantes.');
      await Promise.all([carregar(), modo === 'todas' ? carregarTodas() : Promise.resolve()]);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setRelendo(null);
    }
  };

  const mandarReferencia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ref.url.trim()) return;
    setEnviando(true);
    try {
      await apiPost('/marketing/estudio/memoria/captura', { texto: `${ref.url.trim()} ${ref.nota.trim()}`.trim() }, token);
      setRef({ url: '', nota: '' });
      setAviso('Entrou na Memória. Quando a IA terminar de ler, vira ideia aqui.');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const desfazer = async () => {
    if (!painel?.ultima) return;
    try {
      await apiPost(`/marketing/estudio/triagem/${painel.ultima.id}/desfazer`, {}, token);
      await Promise.all([carregar(), modo === 'todas' ? carregarTodas() : Promise.resolve()]);
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const cards = (todas?.cards ?? []).filter((c) => !q || `${c.titulo} ${c.resumo} ${c.como.gancho} ${c.url ?? ''}`.toLowerCase().includes(q));
    if (ordem === 'recentes') return [...cards].sort((a, b) => String(b.publicadoEm ?? '').localeCompare(String(a.publicadoEm ?? '')));
    return cards;
  }, [todas, busca, ordem]);

  if (ready && !can('pauta.ver')) return <div className="estudio"><p className="muted">Acesso insuficiente para Marketing.</p></div>;

  const restantes = painel?.contagem.nova ?? 0;
  const pendentes = painel ? (painel.pendentes >= 500 ? 'mais de 500' : String(painel.pendentes)) : '0';
  const semLeitura = painel?.semLeitura ?? 0;

  const abrir = (c: TriagemCard) => {
    setFoco(c);
    trocarModo('um');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="estudio">
      {editavel && (
        <form className="ideias-ref" onSubmit={mandarReferencia}>
          <strong>Mandar referência</strong>
          <input type="url" required value={ref.url} onChange={(e) => setRef({ ...ref, url: e.target.value })} placeholder="Cole o link (post, vídeo, matéria)" aria-label="Link da referência" />
          <input value={ref.nota} onChange={(e) => setRef({ ...ref, nota: e.target.value })} placeholder="Nota (opcional)" aria-label="Nota" />
          <button className="primary" type="submit" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </form>
      )}
      <div className="row between ideias-topo">
        <div className="row">
          <div className="filters ideias-filters ideias-modo" role="group" aria-label="Como ver as ideias">
            <button className={modo === 'um' ? 'active' : ''} onClick={() => trocarModo('um')}>
              Um por vez
            </button>
            <button className={modo === 'todas' ? 'active' : ''} onClick={() => trocarModo('todas')}>
              Ver todas
            </button>
          </div>
          <span className="ideias-counter">{restantes ? `${restantes} ${restantes === 1 ? 'ideia' : 'ideias'} para avaliar` : ''}</span>
        </div>
        <div className="row">
          {editavel && painel?.ultima && (
            <button className="ghost" onClick={() => void desfazer()} title={`Desfazer: ${painel.ultima.status === 'aprovada' ? 'aprovou' : 'recusou'} "${painel.ultima.titulo}"`}>
              ↶ Desfazer
            </button>
          )}
          {editavel && painel?.ia && semLeitura > 0 && !painel.lendo && (
            <button className="small" onClick={() => void reler()} disabled={!!relendo}>
              Ler com a IA ({semLeitura})
            </button>
          )}
          {editavel && painel?.ia && (painel?.pendentes ?? 0) > 0 && card && (
            <button className="small" onClick={() => void montar()} disabled={montando}>
              {montando ? 'Buscando…' : 'Buscar mais ideias'}
            </button>
          )}
        </div>
      </div>
      {painel?.lendo && (
        <div className="notice ideias-lendo">
          <div className="ideias-progress">
            <span />
          </div>
          A IA está lendo as ideias{semLeitura ? `: faltam ${semLeitura} ${semLeitura === 1 ? 'card' : 'cards'} que chegaram com ela fora do ar` : ''}. A tela se atualiza sozinha.
        </div>
      )}
      {!painel?.lendo && painel && !painel.ia && semLeitura > 0 && (
        <div className="notice warn">A IA está fora do ar: {semLeitura} ideias estão só com o resumo da nota. Quando ela voltar, a leitura começa sozinha.</div>
      )}
      {aviso && <div className="notice">{aviso}</div>}
      {erro && <div className="notice warn">{erro}</div>}

      {modo === 'todas' ? (
        <div className="ideias-todas">
          <div className="ideias-base-bar">
            <div className="filters ideias-filters" role="group" aria-label="Filtrar por situação">
              {FILTROS.map(([k, l]) => (
                <button key={k} className={filtro === k ? 'active' : ''} onClick={() => setFiltro(k)}>
                  {l} {(todas ?? painel)?.contagem[k] ?? ''}
                </button>
              ))}
            </div>
            <div className="row">
              <input type="search" className="search ideias-search" placeholder="Buscar nas ideias" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar nas ideias" />
              <select className="ideias-ordem" value={ordem} onChange={(e) => setOrdem(e.target.value as 'relevancia' | 'recentes')} aria-label="Ordem">
                <option value="relevancia">Mais relevantes</option>
                <option value="recentes">Mais recentes</option>
              </select>
            </div>
          </div>
          {!todas ? (
            <p className="muted">Carregando…</p>
          ) : lista.length === 0 ? (
            <div className="empty">
              <h3>{busca ? 'Nada com essa busca' : 'Nenhuma ideia aqui'}</h3>
              <p>{filtro === 'nova' ? 'Guarde links e Reels na Memória ou cadastre fontes de tema.' : 'As ideias aparecem aqui conforme vocês decidem.'}</p>
            </div>
          ) : (
            <div className="cards ideias-grade">
              {lista.map((c) => (
                <article key={c.id} className="content-card ideias-mini">
                  {c.imagemUrl && /^https?:\/\//.test(c.imagemUrl) ? (
                    <div className="ideias-mini-img">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.imagemUrl} alt="" referrerPolicy="no-referrer" loading="lazy" onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')} />
                    </div>
                  ) : null}
                  <div className="card-body">
                    <div className="ideias-source">
                      <span className={`ideias-origin ideias-origin-${c.origem}`}>{c.origem === 'salvo' ? 'Salvo' : (c.fonte?.nome ?? 'Da fonte')}</span>
                      <span className="badge">{c.como.formato || c.formatoSugerido}</span>
                      {!c.lida && <span className="badge revisao">IA ainda não leu</span>}
                    </div>
                    <h3>
                      {c.status === 'nova' ? (
                        <button className="ideias-mini-titulo" onClick={() => abrir(c)} title="Abrir no um por vez para editar">
                          {c.titulo}
                        </button>
                      ) : (
                        c.titulo
                      )}
                    </h3>
                    {c.resumo && c.resumo !== c.titulo && <p>{c.resumo}</p>}
                    {c.como.gancho && <p className="ideias-mini-gancho">{c.como.gancho}</p>}
                    {c.porque && (
                      <details className="ideias-mini-mais">
                        <summary>Por que tem a ver</summary>
                        <p>{c.porque}</p>
                        {c.como.pontos.length > 0 && (
                          <ul>
                            {c.como.pontos.map((p, i) => (
                              <li key={i}>{p}</li>
                            ))}
                          </ul>
                        )}
                      </details>
                    )}
                    {(c.motivo || c.comentario) && (
                      <blockquote className="ideias-note">
                        <span>{c.motivo ?? 'Comentário'}</span>
                        {c.comentario}
                      </blockquote>
                    )}
                    <div className="card-meta">
                      <span>{c.decididaEm ? `${c.status === 'aprovada' ? 'Aprovada' : c.status === 'recusada' ? 'Recusada' : ''} em ${dataCurta(c.decididaEm)}` : dataCurta(c.publicadoEm)}</span>
                      {c.url && /^https?:\/\//.test(c.url) && (
                        <a href={c.url} target="_blank" rel="noopener noreferrer">
                          ver original ↗
                        </a>
                      )}
                    </div>
                    {editavel && c.status === 'nova' && (
                      <div className="ideias-mini-acoes">
                        <button className="small ideias-no" disabled={ocupado} onClick={() => void decidir(c, 'recusada')}>
                          ✕ Recusar
                        </button>
                        {!c.lida && painel?.ia && (
                          <button className="small ghost" disabled={!!relendo || painel.lendo} onClick={() => void reler(c.id)}>
                            {relendo === c.id ? 'Lendo…' : 'Ler agora'}
                          </button>
                        )}
                        <button className="small primary" disabled={ocupado} onClick={() => void decidir(c, 'aprovada')}>
                          ✓ Aprovar
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="ideias-stage" style={{ minHeight: 480 }}>
          {!painel ? (
            <p className="muted">Carregando…</p>
          ) : montando && !card ? (
            <div className="empty ideias-empty">
              <h3>Buscando ideias…</h3>
              <p>A IA está lendo o que chegou. As ideias aparecem aqui quando ficarem prontas.</p>
              <div className="ideias-progress">
                <span />
              </div>
            </div>
          ) : !card ? (
            <div className="empty">
              <h3>Nenhuma ideia para avaliar</h3>
              <p>{painel.pendentes > 0 ? `Há ${pendentes} itens das fontes e da Memória esperando a IA ler.` : 'Guarde links e Reels na Memória ou cadastre fontes de tema.'}</p>
              <div className="row ideias-empty-actions" style={{ justifyContent: 'center' }}>
                {editavel && painel.ia && painel.pendentes > 0 && (
                  <button className="primary" onClick={() => void montar()}>
                    Buscar ideias agora
                  </button>
                )}
                <Link className="ideias-link-btn" href="/referencias">
                  Ver fontes
                </Link>
              </div>
            </div>
          ) : (
            <>
              <article className="ideias-card" key={card.id}>
                {card.imagemUrl && /^https?:\/\//.test(card.imagemUrl) && (
                  <div className="ideias-media">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={card.imagemUrl} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')} />
                  </div>
                )}
                <form className="ideias-body ideias-edit" onSubmit={(e) => e.preventDefault()}>
                  <div className="ideias-source">
                    <span className={`ideias-origin ideias-origin-${card.fonte?.id === 'memoria' ? 'salvo' : 'fonte'}`}>{card.fonte?.id === 'memoria' ? 'Salvo' : 'Da fonte'}</span>
                    <span className="ideias-origin-line">
                      {card.fonte?.id === 'memoria' ? (
                        <>Você guardou na Memória{card.publicadoEm ? ` em ${dataCurta(card.publicadoEm)}` : ''}</>
                      ) : (
                        <>
                          <strong>{card.fonte?.nome ?? 'Uma fonte'}</strong>
                          {card.publicadoEm ? ` postou em ${dataCurta(card.publicadoEm)}` : ''} · extraído pela Root
                        </>
                      )}
                    </span>
                    {!card.lida && <span className="badge revisao">IA ainda não leu</span>}
                    {editavel && painel.ia && (
                      <button type="button" className="small ghost ideias-reler" disabled={!!relendo || painel.lendo} onClick={() => void reler(card.id)} title="A IA reescreve título, resumo, gancho e o porquê com a marca e o que vocês já decidiram">
                        {relendo === card.id ? 'Lendo…' : card.lida ? '↻ Reler com a IA' : 'Ler agora'}
                      </button>
                    )}
                    {card.url && (
                      <a href={card.url} target="_blank" rel="noopener noreferrer">
                        ver original ↗
                      </a>
                    )}
                  </div>
                  <label className="sr-only" htmlFor="ideias-f-title">
                    Título
                  </label>
                  <textarea id="ideias-f-title" className="ideias-title ideias-input" rows={2} maxLength={300} value={edicao?.titulo ?? ''} onChange={(e) => setEdicao((x) => x && { ...x, titulo: e.target.value })} readOnly={!editavel} />
                  <label className="ideias-label">
                    Resumo
                    <textarea className="ideias-input ideias-summary" rows={3} maxLength={1000} value={edicao?.resumo ?? ''} onChange={(e) => setEdicao((x) => x && { ...x, resumo: e.target.value })} readOnly={!editavel} />
                  </label>
                  <div className="ideias-edit-row">
                    <label className="ideias-label">
                      Gancho
                      <textarea className="ideias-input" rows={2} maxLength={500} value={edicao?.gancho ?? ''} onChange={(e) => setEdicao((x) => x && { ...x, gancho: e.target.value })} readOnly={!editavel} />
                    </label>
                    <label className="ideias-label">
                      Formato sugerido
                      <select value={edicao?.formato ?? card.formatoSugerido} onChange={(e) => setEdicao((x) => x && { ...x, formato: e.target.value })} disabled={!editavel}>
                        {FORMATOS_COM_REGUA.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {card.porque && (
                    <details className="ideias-fold">
                      <summary>
                        <strong>Por que tem a ver com você</strong> <span className="muted">{firstLine(card.porque, 70)}</span>
                      </summary>
                      <p>{card.porque}</p>
                    </details>
                  )}
                  {card.como.pontos.length > 0 && (
                    <details className="ideias-fold">
                      <summary>
                        <strong>Pontos principais</strong>{' '}
                        <span className="muted">
                          {firstLine(card.como.pontos[0], 70)}
                          {card.como.pontos.length > 1 ? ` (+${card.como.pontos.length - 1})` : ''}
                        </span>
                      </summary>
                      <ul>
                        {card.como.pontos.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {card.como.clipe && (
                    <details className="ideias-fold">
                      <summary>
                        <strong>Clipe de abertura</strong> <span className="muted">{firstLine(card.como.clipe, 70)}</span>
                      </summary>
                      <p>{card.como.clipe}</p>
                    </details>
                  )}
                </form>
              </article>
              {editavel && (
                <div className="ideias-actions">
                  <label className="ideias-label" style={{ margin: '0 0 12px' }}>
                    Seu comentário (ensina a IA e vai para o Obsidian)
                    <textarea className="ideias-input" rows={2} maxLength={2000} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Por que aprova ou recusa? Ex.: notícia de game não tem a ver com dono de PME." />
                  </label>
                  <div className="ideias-buttons">
                    <button className="ideias-btn ideias-no" title="Recusar (←)" disabled={ocupado} onClick={() => void decidirAtual('recusada')}>
                      <span aria-hidden="true">✕</span> Recusar
                    </button>
                    <button className="ideias-btn ideias-yes primary" title="Aprovar (→)" disabled={ocupado} onClick={() => void decidirAtual('aprovada')}>
                      <span aria-hidden="true">✓</span> Aprovar
                    </button>
                  </div>
                  <div className="ideias-reasons">
                    <span className="muted tiny">Recusar com motivo:</span>
                    {MOTIVOS_RAPIDOS.map((r) => (
                      <button key={r} className="small" disabled={ocupado} onClick={() => void decidirAtual('recusada', r)}>
                        {r}
                      </button>
                    ))}
                  </div>
                  <p className="ideias-keys tiny muted">Teclado: ← recusar · → aprovar</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
