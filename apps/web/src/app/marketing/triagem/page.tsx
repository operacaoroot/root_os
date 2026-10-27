'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FORMATOS_COM_REGUA, MOTIVOS_RAPIDOS, type TriagemCard, type TriagemPainel } from '@mktos/shared';
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

export default function TriagemPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const [painel, setPainel] = useState<TriagemPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [montando, setMontando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [edicao, setEdicao] = useState<{ titulo: string; resumo: string; gancho: string; formato: string } | null>(null);
  const [ref, setRef] = useState({ url: '', nota: '' });
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      setPainel(await apiGet<TriagemPainel>('/marketing/estudio/triagem', token));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  const card: TriagemCard | undefined = painel?.cards[0];
  useEffect(() => {
    setEdicao(card ? { titulo: card.titulo, resumo: card.resumo, gancho: card.como.gancho, formato: card.como.formato } : null);
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const decidir = useCallback(
    async (decisao: 'aprovada' | 'recusada', motivo?: string) => {
      if (!card || ocupado) return;
      setOcupado(true);
      try {
        const corpo = decisao === 'aprovada' ? { decisao, titulo: edicao?.titulo, resumo: edicao?.resumo, gancho: edicao?.gancho, formato: edicao?.formato } : { decisao, motivo };
        await apiPost(`/marketing/estudio/triagem/${card.id}/decisao`, corpo, token);
        setAviso(decisao === 'aprovada' ? 'Aprovada. Está no Banco de ideias.' : 'Recusada. A fonte pesa um pouco menos na próxima.');
        await carregar();
      } catch (e) {
        setErro((e as Error).message);
      } finally {
        setOcupado(false);
      }
    },
    [card, ocupado, edicao, token, carregar],
  );

  useEffect(() => {
    if (!editavel) return;
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') void decidir('aprovada');
      if (e.key === 'ArrowLeft') void decidir('recusada');
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [decidir, editavel]);

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
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  if (ready && !can('pauta.ver')) return <div className="estudio"><p className="muted">Acesso insuficiente para Marketing.</p></div>;

  const restantes = painel?.contagem.nova ?? 0;
  const pendentes = painel ? (painel.pendentes >= 500 ? 'mais de 500' : String(painel.pendentes)) : '0';

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
      <div className="row between" style={{ margin: '0 0 14px' }}>
        <span className="ideias-counter">{restantes ? `${restantes} ${restantes === 1 ? 'ideia' : 'ideias'} para avaliar` : ''}</span>
        <div className="row">
          {editavel && painel?.ultima && (
            <button className="ghost" onClick={() => void desfazer()} title={`Desfazer: ${painel.ultima.status === 'aprovada' ? 'aprovou' : 'recusou'} "${painel.ultima.titulo}"`}>
              ↶ Desfazer
            </button>
          )}
          {editavel && painel?.ia && (painel?.pendentes ?? 0) > 0 && card && (
            <button className="small" onClick={() => void montar()} disabled={montando}>
              {montando ? 'Buscando…' : 'Buscar mais ideias'}
            </button>
          )}
        </div>
      </div>
      {aviso && <div className="notice">{aviso}</div>}
      {erro && <div className="notice warn">{erro}</div>}

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
                <div className="ideias-buttons">
                  <button className="ideias-btn ideias-no" title="Recusar (←)" disabled={ocupado} onClick={() => void decidir('recusada')}>
                    <span aria-hidden="true">✕</span> Recusar
                  </button>
                  <button className="ideias-btn ideias-yes primary" title="Aprovar (→)" disabled={ocupado} onClick={() => void decidir('aprovada')}>
                    <span aria-hidden="true">✓</span> Aprovar
                  </button>
                </div>
                <div className="ideias-reasons">
                  <span className="muted tiny">Recusar com motivo:</span>
                  {MOTIVOS_RAPIDOS.map((r) => (
                    <button key={r} className="small" disabled={ocupado} onClick={() => void decidir('recusada', r)}>
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
    </div>
  );
}
