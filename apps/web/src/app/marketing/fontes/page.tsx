'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * Marketing › IDEIAS DE CONTEÚDO › Fontes. Cópia da tela Fontes do ROOT Estúdio
 * (public/pages/fontes.js): os perfis e sites que o robô acompanha, com ligar/desligar,
 * buscar agora, remover, adicionar um ou vários. O cadastro é o da Pauta (/pauta/fontes):
 * a mesma fonte aparece em Referências › Radar. O peso sobe quando você aprova ideias da
 * fonte e desce quando recusa.
 */

interface Fonte {
  id: string;
  tipo: string;
  nome: string;
  url: string | null;
  handle: string | null;
  plataforma: string | null;
  ativo: boolean;
  ultimaLeitura: string | null;
  ultimoErro: string | null;
  capturas: number;
  runsNoMes: number;
  tetoRunsMes: number;
}
interface Detectada { tipo: string; nome: string; url: string | null; handle: string | null; plataforma: string | null }

const TIPO: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', web: 'Site', gmail: 'Gmail', google: 'Busca', whatsapp: 'WhatsApp' };
const rotulo = (f: Fonte) => TIPO[f.plataforma ?? ''] ?? (f.tipo === 'rss' ? 'Site' : f.tipo);
const linkDa = (f: Fonte) =>
  f.tipo === 'perfil' ? (f.plataforma === 'tiktok' ? `https://www.tiktok.com/@${f.handle}` : `https://www.instagram.com/${f.handle}`) : f.url ?? '';
const quando = (s: string | null) => {
  if (!s) return 'ainda não leu';
  try {
    return `leu em ${new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;
  } catch {
    return '';
  }
};
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export default function FontesPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const podeBuscar = editavel && can('automacoes.executar');
  const [fontes, setFontes] = useState<Fonte[] | null>(null);
  const [apify, setApify] = useState(false);
  const [pesos, setPesos] = useState<Record<string, number>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [novo, setNovo] = useState({ url: '', nome: '' });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [varios, setVarios] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ url: string; ok: boolean; texto: string }[]>([]);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const [l, p] = await Promise.all([
        apiGet<{ items: Fonte[]; apifyConfigurado: boolean }>('/pauta/fontes', token),
        apiGet<Record<string, number>>('/marketing/estudio/fontes/pesos', token).catch(() => ({})),
      ]);
      setFontes(l.items.filter((f) => f.tipo !== 'manual'));
      setApify(l.apifyConfigurado);
      setPesos(p);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token]);
  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  const adicionarUm = async (url: string, nome?: string): Promise<string> => {
    const d = await apiPost<Detectada>('/marketing/estudio/fontes/detectar', { url, nome }, token);
    await apiPost('/pauta/fontes', { tipo: d.tipo, nome: d.nome, url: d.url, handle: d.handle, plataforma: d.plataforma, ativo: true }, token);
    return `${TIPO[d.plataforma ?? ''] ?? 'Fonte'} · ${d.nome}`;
  };

  const agir = async (qual: string, fn: () => Promise<void>) => {
    setOcupado(qual);
    setErro(null);
    try {
      await fn();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  if (ready && !can('pauta.ver')) return <div className="estudio"><p className="muted">Acesso insuficiente para Marketing.</p></div>;
  const ligadas = (fontes ?? []).filter((f) => f.ativo).length;

  return (
    <div className="estudio">
      {aviso && <div className="notice">{aviso}</div>}
      {erro && <div className="notice warn">{erro}</div>}
      <section className="panel fontes-list">
        <div className="row between fontes-list-head">
          <div>
            <h2>Perfis e sites que o robô acompanha</h2>
            <span className="muted tiny">
              {plural(fontes?.length ?? 0, 'fonte', 'fontes')}, {plural(ligadas, 'ligada', 'ligadas')}
            </span>
          </div>
          {editavel && <button onClick={() => setVarios('')}>Adicionar várias</button>}
        </div>
        <div className="notice fontes-notice">
          YouTube e sites com RSS são grátis. Instagram e TikTok são lidos pelo Apify, que é pago por coleta.
          {apify ? '' : ' O Apify ainda não está configurado no servidor (APIFY_TOKEN), então esses perfis ficam parados até lá.'}
        </div>
        {editavel && (
          <>
            <form
              className="fontes-add-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!novo.url.trim()) return;
                void agir('add', async () => {
                  const r = await adicionarUm(novo.url.trim(), novo.nome.trim() || undefined);
                  setNovo({ url: '', nome: '' });
                  setAviso(`Adicionada: ${r}.`);
                  await carregar();
                });
              }}
            >
              <label className="grow">
                Link
                <input value={novo.url} onChange={(e) => setNovo({ ...novo, url: e.target.value })} inputMode="url" autoComplete="off" placeholder="Perfil do Instagram/TikTok, canal do YouTube, site ou feed RSS" required />
              </label>
              <label className="fontes-add-name">
                Nome (opcional)
                <input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} maxLength={120} autoComplete="off" />
              </label>
              <button className="primary" type="submit" disabled={ocupado === 'add'}>
                {ocupado === 'add' ? 'Conferindo…' : 'Adicionar'}
              </button>
            </form>
            <p className="muted tiny fontes-add-hint">Em site comum, o OS procura o feed sozinho. No YouTube, use o link do canal (ex.: youtube.com/@canal).</p>
          </>
        )}
        {!fontes ? (
          <p className="muted">Carregando…</p>
        ) : fontes.length === 0 ? (
          <div className="empty">
            <h3>Nenhuma fonte ainda</h3>
            <p>Adicione os perfis e sites que você quer acompanhar. O robô lê cada um e as novidades viram ideias.</p>
          </div>
        ) : (
          fontes.map((f) => {
            const link = linkDa(f);
            const peso = pesos[f.id];
            return (
              <div key={f.id} className={`fontes-item${f.ativo ? '' : ' fontes-off'}`}>
                <div className="fontes-main">
                  <div className="row fontes-title">
                    <span className={`badge fontes-kind fontes-kind-${f.plataforma ?? f.tipo}`}>{rotulo(f)}</span>
                    <h3>{f.nome}</h3>
                    {!f.ativo && <span className="badge">Desligada</span>}
                  </div>
                  {link && (
                    <a className="fontes-link" href={link} target="_blank" rel="noopener noreferrer">
                      {link}
                    </a>
                  )}
                  <p className="fontes-meta">
                    {quando(f.ultimaLeitura)} · {plural(f.capturas, 'item', 'itens')}
                    {f.tipo === 'perfil' ? ` · ${f.runsNoMes}/${f.tetoRunsMes} coletas no mês` : ''} ·{' '}
                    <span title="Sobe quando você aprova ideias desta fonte e desce quando recusa. Vai de 0,3 a 2.">peso {(peso ?? 1).toFixed(2).replace('.', ',')}</span>
                  </p>
                  {f.ultimoErro && <p className="inline-error fontes-error">{f.ultimoErro}</p>}
                </div>
                {editavel && (
                  <div className="fontes-actions">
                    <label className="fontes-toggle">
                      <input
                        type="checkbox"
                        checked={f.ativo}
                        onChange={(e) =>
                          void agir(`t-${f.id}`, async () => {
                            await apiPatch(`/pauta/fontes/${f.id}`, { ativo: e.target.checked }, token);
                            await carregar();
                          })
                        }
                      />{' '}
                      Ligada
                    </label>
                    {podeBuscar && f.ativo && (f.tipo !== 'perfil' || apify) && (
                      <button
                        className="small"
                        disabled={!!ocupado}
                        onClick={() =>
                          void agir(`b-${f.id}`, async () => {
                            const r = await apiPost<{ novas?: number; capturas?: number; criadas?: number }>(`/pauta/fontes/${f.id}/coletar`, {}, token);
                            const n = r.novas ?? r.criadas ?? r.capturas;
                            setAviso(`${f.nome}: ${typeof n === 'number' ? plural(n, 'item novo', 'itens novos') : 'leitura feita'}. Em Para aprovar, clique em Buscar ideias agora.`);
                            await carregar();
                          })
                        }
                      >
                        {ocupado === `b-${f.id}` ? 'Buscando…' : 'Buscar'}
                      </button>
                    )}
                    <button
                      className="small danger"
                      disabled={!!ocupado}
                      onClick={() => {
                        if (!confirm(`Remover ${f.nome}? O robô para de ler essa fonte. As ideias que já vieram dela continuam.`)) return;
                        void agir(`r-${f.id}`, async () => {
                          await apiDelete(`/pauta/fontes/${f.id}`, token);
                          await carregar();
                        });
                      }}
                    >
                      Remover
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      {varios !== null && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#16200f80', display: 'grid', placeItems: 'center', padding: 14 }} onClick={() => setVarios(null)}>
          <dialog open style={{ position: 'static' }} onClick={(e) => e.stopPropagation()}>
            <div className="dialog-head">
              <h2>Adicionar várias fontes</h2>
              <button className="ghost" onClick={() => setVarios(null)}>
                Fechar
              </button>
            </div>
            <div className="dialog-body">
              <label>
                Links, um por linha
                <textarea className="fontes-bulk-text" rows={9} value={varios} onChange={(e) => setVarios(e.target.value)} placeholder={'https://www.retaildive.com/feeds/news/\nhttps://www.youtube.com/@CNBC\nhttps://www.instagram.com/perfil'} />
              </label>
              {resultado.length > 0 && (
                <ul className="fontes-bulk-list">
                  {resultado.map((r, i) => (
                    <li key={i} className={r.ok ? 'ok' : 'fail'}>
                      <span className={`badge ${r.ok ? 'success' : 'error'}`}>{r.ok ? 'Ok' : 'Erro'}</span> <span className="fontes-bulk-url">{r.url}</span>
                      <br />
                      <span className={r.ok ? 'muted' : 'inline-error'}>{r.texto}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="dialog-actions">
                <button onClick={() => setVarios(null)}>Fechar</button>
                <button
                  className="primary"
                  disabled={ocupado === 'varios'}
                  onClick={() =>
                    void agir('varios', async () => {
                      const urls = [...new Set((varios ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean))].slice(0, 40);
                      const saida: { url: string; ok: boolean; texto: string }[] = [];
                      for (const url of urls) {
                        try {
                          saida.push({ url, ok: true, texto: await adicionarUm(url) });
                        } catch (e) {
                          saida.push({ url, ok: false, texto: (e as Error).message });
                        }
                        setResultado([...saida]);
                      }
                      await carregar();
                    })
                  }
                >
                  {ocupado === 'varios' ? 'Conferindo…' : 'Adicionar'}
                </button>
              </div>
            </div>
          </dialog>
        </div>
      )}
    </div>
  );
}
