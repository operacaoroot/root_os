'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MEMORIA_PASTAS,
  type MemoriaGrafo,
  type MemoriaNota,
  type MemoriaNotaBreve,
  type MemoriaPainel,
  type MemoriaPasta,
} from '@mktos/shared';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { GrafoDaMemoria, COR_DO_TIPO } from '@/components/marketing/GrafoDaMemoria';
import { markdownDaMemoria } from '@/components/marketing/markdown-da-memoria';

/*
 * Marketing › MEMÓRIA. Cópia da tela do ROOT Estúdio (public/pages/memoria.js), com as
 * mesmas classes (memoria-*) e o CSS do Estúdio preso a `.estudio`.
 * Captura no topo; abas Notas, Grafo, Vídeos e Obsidian. Links e Reels mandados no
 * grupo "Memória ROOT" do WhatsApp chegam aqui sozinhos; cada nota pronta vira .md no
 * Drive Root (40-marca-e-conteudo/Memória), que é o Obsidian.
 */

type Aba = 'notas' | 'grafo' | 'videos' | 'obsidian';
const ICONE: Record<string, string> = { video: '🎬', link: '🔗', ideia: '💡', nota: '📝' };
const ST: Record<string, [string, string]> = { fila: ['running', 'na fila'], processando: ['running', 'processando'], pronto: ['success', 'pronto'], erro: ['error', 'erro'] };
const quando = (s: string) => {
  try {
    return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
};
function Badge({ s }: { s: string }) {
  if (!s || s === 'pronto') return null;
  const [cls, txt] = ST[s] ?? ['', s];
  return <span className={`badge ${cls}`}>{txt}</span>;
}

export default function MemoriaPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const [aba, setAba] = useState<Aba>('notas');
  const [painel, setPainel] = useState<MemoriaPainel | null>(null);
  const [busca, setBusca] = useState('');
  const [tag, setTag] = useState('');
  const [pasta, setPasta] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [captura, setCaptura] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [versao, setVersao] = useState(0);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const q = new URLSearchParams({ q: busca, tag, pasta: aba === 'videos' ? 'Vídeos' : pasta });
      setPainel(await apiGet<MemoriaPainel>(`/marketing/estudio/memoria?${q}`, token));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token, busca, tag, pasta, aba]);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void carregar(), busca ? 350 : 0);
    return () => clearTimeout(t);
  }, [ready, carregar, busca, versao]);

  useEffect(() => {
    if (!painel?.notas.some((n) => n.status === 'fila' || n.status === 'processando')) return;
    const t = setTimeout(() => setVersao((v) => v + 1), 6000);
    return () => clearTimeout(t);
  }, [painel]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  const capturar = async () => {
    const texto = captura.trim();
    if (!texto) return setAviso('Escreva ou cole alguma coisa.');
    setSalvando(true);
    try {
      const r = await apiPost<{ nota: MemoriaNotaBreve; repetida: boolean }>('/marketing/estudio/memoria/captura', { texto }, token);
      setCaptura('');
      if (r.repetida) setAviso('Esse link já estava na Memória.');
      else if (r.nota.tipo === 'video') setAviso('Vídeo na fila: em 1 a 3 min a nota aparece em Vídeos.');
      else if (r.nota.tipo === 'link') setAviso('Link guardado. A IA está resumindo.');
      else setAviso('Ideia guardada.');
      if (r.nota.tipo === 'video' && !r.repetida) setAba('videos');
      else {
        setAba('notas');
        setAberta(r.nota.id);
      }
      setVersao((v) => v + 1);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  if (ready && !can('pauta.ver')) return <div className="estudio"><p className="muted">Acesso insuficiente para Marketing.</p></div>;

  return (
    <div className="estudio">
      <div className="pagehead">
        <div>
          <h1>Memória</h1>
          <p>Suas ideias, links e Reels guardados, em notas que a IA organiza.</p>
        </div>
      </div>
      {editavel && (
        <div className="memoria-captura">
          <textarea
            rows={1}
            value={captura}
            onChange={(e) => {
              setCaptura(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void capturar();
              }
            }}
            placeholder="Link, Reel ou ideia…"
            aria-label="Guardar na Memória"
          />
          <button className="primary" onClick={() => void capturar()} disabled={salvando}>
            Salvar
          </button>
        </div>
      )}
      {painel?.ligacoes.grupo && <p className="memoria-dica">Mande links e Reels para o grupo Memória ROOT no WhatsApp: eles chegam aqui sozinhos.</p>}
      {aviso && <div className="notice">{aviso}</div>}
      {erro && <div className="notice warn">{erro}</div>}

      <div className="memoria-abas" role="tablist">
        {(
          [
            ['notas', 'Notas'],
            ['grafo', 'Grafo'],
            ['videos', 'Vídeos'],
            ['obsidian', 'Obsidian'],
          ] as [Aba, string][]
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={aba === k} className={aba === k ? 'active' : ''} onClick={() => setAba(k)}>
            {l}
          </button>
        ))}
      </div>

      <div id="memoria-corpo">
        {!painel ? (
          <p className="muted">Carregando…</p>
        ) : aba === 'notas' ? (
          <AbaNotas
            painel={painel}
            editavel={editavel}
            token={token}
            busca={busca}
            setBusca={setBusca}
            tag={tag}
            setTag={setTag}
            pasta={pasta}
            setPasta={setPasta}
            aberta={aberta}
            setAberta={setAberta}
            mudou={() => setVersao((v) => v + 1)}
            setErro={setErro}
            setAviso={setAviso}
          />
        ) : aba === 'grafo' ? (
          <AbaGrafo
            token={token}
            onNota={(id) => {
              setPasta('');
              setTag('');
              setAberta(id);
              setAba('notas');
            }}
            onTag={(t) => {
              setTag(t);
              setAberta(null);
              setAba('notas');
            }}
          />
        ) : aba === 'videos' ? (
          <AbaVideos
            notas={painel.notas}
            editavel={editavel}
            token={token}
            onAbrir={(id) => {
              setPasta('');
              setAberta(id);
              setAba('notas');
            }}
            mudou={() => setVersao((v) => v + 1)}
            setErro={setErro}
          />
        ) : (
          <AbaObsidian painel={painel} editavel={editavel} token={token} mudou={() => setVersao((v) => v + 1)} setAviso={setAviso} setErro={setErro} />
        )}
      </div>
    </div>
  );
}

function AbaNotas(props: {
  painel: MemoriaPainel;
  editavel: boolean;
  token: string | null;
  busca: string;
  setBusca: (s: string) => void;
  tag: string;
  setTag: (s: string) => void;
  pasta: string;
  setPasta: (s: string) => void;
  aberta: string | null;
  setAberta: (s: string | null) => void;
  mudou: () => void;
  setErro: (s: string | null) => void;
  setAviso: (s: string | null) => void;
}) {
  const { painel } = props;
  const [nova, setNova] = useState(false);
  const filtrando = !!(props.busca || props.tag || props.pasta);
  return (
    <div className="memoria-grade">
      <div className="memoria-lista">
        <div className="memoria-busca">
          <input type="search" value={props.busca} onChange={(e) => props.setBusca(e.target.value)} placeholder="Buscar nas notas" aria-label="Buscar nas notas" />
          {props.editavel && <button onClick={() => setNova(true)}>+ Nota</button>}
        </div>
        <div className="memoria-chips">
          <button className={`memoria-chip ${props.pasta ? '' : 'on'}`} onClick={() => props.setPasta('')}>
            Todas <span>{painel.total}</span>
          </button>
          {painel.pastas.map((p) => (
            <button key={p.nome} className={`memoria-chip ${props.pasta === p.nome ? 'on' : ''}`} onClick={() => props.setPasta(p.nome)}>
              {p.nome} <span>{p.n}</span>
            </button>
          ))}
        </div>
        {painel.tags.length > 0 && (
          <div className="memoria-chips memoria-tags">
            {painel.tags.slice(0, 30).map((t) => (
              <button key={t.t} className={`memoria-chip tag ${props.tag === t.t ? 'on' : ''}`} onClick={() => props.setTag(props.tag === t.t ? '' : t.t)}>
                #{t.t} <span>{t.n}</span>
              </button>
            ))}
          </div>
        )}
        <div id="memoria-itens">
          {painel.notas.length === 0 && <div className="memoria-vazio">{filtrando ? 'Nada com esse filtro.' : 'Sua Memória está vazia. Cole um link, um Reel ou uma ideia aí em cima.'}</div>}
          {painel.notas.map((n) => (
            <button key={n.id} className={`memoria-item ${props.aberta === n.id ? 'on' : ''}`} onClick={() => props.setAberta(n.id)}>
              <span className="memoria-item-t">
                {ICONE[n.tipo] ?? '📝'} {n.titulo} <Badge s={n.status} />
              </span>
              <span className="memoria-item-m">
                {n.via === 'whatsapp' && (
                  <>
                    <span className="memoria-wa">WhatsApp</span>{' '}
                  </>
                )}
                {n.pasta} · {quando(n.atualizadaEm)}
                {n.tags.length > 0 && ` · ${n.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}`}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="memoria-leitor" id="memoria-leitor">
        {props.aberta ? (
          <Leitor
            key={props.aberta}
            id={props.aberta}
            token={props.token}
            editavel={props.editavel}
            onAbrir={props.setAberta}
            onTag={(t) => {
              props.setTag(t);
              props.setAberta(null);
            }}
            mudou={props.mudou}
            setErro={props.setErro}
            setAviso={props.setAviso}
          />
        ) : (
          <div className="memoria-vazio">Escolha uma nota.</div>
        )}
      </div>
      {nova && (
        <NovaNota
          token={props.token}
          onFechar={() => setNova(false)}
          onCriada={(id) => {
            setNova(false);
            props.setAberta(id);
            props.mudou();
          }}
          setErro={props.setErro}
        />
      )}
    </div>
  );
}

function Leitor(props: { id: string; token: string | null; editavel: boolean; onAbrir: (id: string | null) => void; onTag: (t: string) => void; mudou: () => void; setErro: (s: string | null) => void; setAviso: (s: string | null) => void }) {
  const [n, setN] = useState<MemoriaNota | null>(null);
  const [sumiu, setSumiu] = useState(false);
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState({ titulo: '', pasta: 'Conhecimento' as MemoriaPasta, corpo: '' });
  const artigo = useRef<HTMLElement>(null);

  const abrir = useCallback(async () => {
    try {
      const nota = await apiGet<MemoriaNota>(`/marketing/estudio/memoria/notas/${props.id}`, props.token);
      setN(nota);
      setRascunho({ titulo: nota.titulo, pasta: nota.pasta, corpo: nota.corpo });
    } catch {
      setSumiu(true);
    }
  }, [props.id, props.token]);

  useEffect(() => {
    void abrir();
  }, [abrir]);

  useEffect(() => {
    if (!n || n.status === 'pronto' || n.status === 'erro' || editando) return;
    const t = setTimeout(() => void abrir(), 6000);
    return () => clearTimeout(t);
  }, [n, editando, abrir]);

  // [[Nota]] abre a nota (ou oferece criar); #tag filtra a lista.
  useEffect(() => {
    const a = artigo.current;
    if (!a) return;
    const clique = async (e: MouseEvent) => {
      const alvo = (e.target as HTMLElement).closest('a');
      if (!alvo) return;
      if (alvo.dataset.tag) {
        e.preventDefault();
        props.onTag(alvo.dataset.tag);
      } else if (alvo.dataset.wiki) {
        e.preventDefault();
        const nome = alvo.dataset.wiki;
        try {
          const r = await apiGet<MemoriaPainel>(`/marketing/estudio/memoria?q=${encodeURIComponent(nome)}`, props.token);
          const achou = r.notas.find((x) => x.titulo.toLowerCase() === nome.toLowerCase());
          if (achou) props.onAbrir(achou.id);
          else if (props.editavel && confirm(`A nota "${nome}" ainda não existe. Criar agora?`)) {
            const c = await apiPost<MemoriaNotaBreve>('/marketing/estudio/memoria/notas', { titulo: nome, pasta: 'Conhecimento', corpo: '' }, props.token);
            props.mudou();
            props.onAbrir(c.id);
          }
        } catch (err) {
          props.setErro((err as Error).message);
        }
      }
    };
    a.addEventListener('click', clique);
    return () => a.removeEventListener('click', clique);
  });

  if (sumiu) return <div className="memoria-vazio">Essa nota não existe mais.</div>;
  if (!n) return <p className="muted">Abrindo…</p>;

  const agir = async (fn: () => Promise<unknown>) => {
    try {
      props.setErro(null);
      await fn();
    } catch (e) {
      props.setErro((e as Error).message);
    }
  };
  const pronta = n.status === 'pronto';
  const fonte = n.url && /^https?:\/\//i.test(n.url) ? n.url : '';

  return (
    <>
      <div className="memoria-leitor-head">
        <div className="grow">
          {editando ? (
            <input className="memoria-titulo-in" value={rascunho.titulo} onChange={(e) => setRascunho({ ...rascunho, titulo: e.target.value })} aria-label="Título" />
          ) : (
            <h2 className="memoria-titulo">{n.titulo}</h2>
          )}
          <div className="memoria-item-m">
            {n.pasta} · {quando(n.atualizadaEm)}
            {n.noDrive ? ' · no Drive' : ''}
          </div>
          {n.via === 'whatsapp' && <span className="memoria-wa">WhatsApp</span>}
        </div>
        {props.editavel && (
          <div className="row">
            {editando ? (
              <>
                <button onClick={() => setEditando(false)}>Cancelar</button>
                <button
                  className="primary"
                  onClick={() =>
                    void agir(async () => {
                      await apiPut(`/marketing/estudio/memoria/notas/${n.id}`, rascunho, props.token);
                      setEditando(false);
                      props.setAviso('Nota salva.');
                      await abrir();
                      props.mudou();
                    })
                  }
                >
                  Salvar
                </button>
              </>
            ) : (
              <>
                {pronta && <button onClick={() => setEditando(true)}>Editar</button>}
                <button
                  className="danger"
                  onClick={() => {
                    if (!confirm('Apagar esta nota do OS? O arquivo no Drive continua lá.')) return;
                    void agir(async () => {
                      await apiDelete(`/marketing/estudio/memoria/notas/${n.id}`, props.token);
                      props.onAbrir(null);
                      props.setAviso('Nota apagada.');
                      props.mudou();
                    });
                  }}
                >
                  Apagar
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {!editando && (n.autor || fonte || !pronta) && (
        <div className="memoria-chips">
          <Badge s={n.status} />
          {n.autor && (
            <span className="memoria-chip">
              {n.tipo === 'video' ? '@' : ''}
              {n.autor}
            </span>
          )}
          {fonte && (
            <a className="memoria-chip" href={fonte} target="_blank" rel="noopener noreferrer">
              Abrir fonte ↗
            </a>
          )}
        </div>
      )}
      {n.status === 'erro' && (
        <div className="notice warn memoria-aviso">
          {n.erro || 'Não deu para processar este link.'}{' '}
          {props.editavel && (
            <button
              className="small"
              onClick={() =>
                void agir(async () => {
                  await apiPost(`/marketing/estudio/memoria/notas/${n.id}/tentar`, {}, props.token);
                  await abrir();
                  props.mudou();
                })
              }
            >
              Tentar de novo
            </button>
          )}
        </div>
      )}
      {(n.status === 'fila' || n.status === 'processando') && <p className="muted memoria-aviso">A IA está lendo este link. A nota completa aparece aqui em instantes.</p>}
      {editando ? (
        <>
          <label className="memoria-pasta-in">
            Pasta
            <select value={rascunho.pasta} onChange={(e) => setRascunho({ ...rascunho, pasta: e.target.value as MemoriaPasta })}>
              {MEMORIA_PASTAS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <textarea className="memoria-editor" aria-label="Texto da nota" spellCheck value={rascunho.corpo} onChange={(e) => setRascunho({ ...rascunho, corpo: e.target.value })} />
          <p className="tiny muted">Markdown. Ligue notas com [[Nome da nota]] e marque assuntos com #tag.</p>
        </>
      ) : (
        <article ref={artigo} className="memoria-md" dangerouslySetInnerHTML={{ __html: markdownDaMemoria(n.corpo) || (pronta ? '<p class="muted">Nota vazia.</p>' : '') }} />
      )}
      {n.citadaEm.length > 0 && (
        <>
          <h3 className="memoria-sec">Citada em</h3>
          <div className="memoria-back">
            {n.citadaEm.map((c) => (
              <button key={c.id} className="memoria-item" onClick={() => props.onAbrir(c.id)}>
                <span className="memoria-item-t">{c.titulo}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function NovaNota(props: { token: string | null; onFechar: () => void; onCriada: (id: string) => void; setErro: (s: string | null) => void }) {
  const [titulo, setTitulo] = useState('');
  const [pasta, setPasta] = useState<MemoriaPasta>('Conhecimento');
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#16200f80', display: 'grid', placeItems: 'center', padding: 14 }} onClick={props.onFechar}>
      <dialog open style={{ position: 'static' }} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Nova nota</h2>
          <button className="ghost" onClick={props.onFechar}>
            Fechar
          </button>
        </div>
        <form
          className="dialog-body"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!titulo.trim()) return;
            try {
              const r = await apiPost<MemoriaNotaBreve>('/marketing/estudio/memoria/notas', { titulo: titulo.trim(), pasta, corpo: '' }, props.token);
              props.onCriada(r.id);
            } catch (err) {
              props.setErro((err as Error).message);
            }
          }}
        >
          <label>
            Título
            <input autoFocus autoComplete="off" required value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Ideias para o livro" />
          </label>
          <label>
            Pasta
            <select value={pasta} onChange={(e) => setPasta(e.target.value as MemoriaPasta)}>
              {MEMORIA_PASTAS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <div className="dialog-actions">
            <button className="primary" type="submit">
              Criar
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function AbaGrafo(props: { token: string | null; onNota: (id: string) => void; onTag: (t: string) => void }) {
  const [g, setG] = useState<MemoriaGrafo | null>(null);
  useEffect(() => {
    void apiGet<MemoriaGrafo>('/marketing/estudio/memoria/grafo', props.token).then(setG).catch(() => setG({ nodes: [], links: [] }));
  }, [props.token]);
  if (!g) return <p className="muted">Carregando…</p>;
  return (
    <>
      <p className="muted memoria-dica">
        Cada ponto é uma nota. As linhas ligam notas às tags, às notas citadas com [[título]] e a notas do mesmo autor ou site. Arraste para mexer, use a roda do mouse para aproximar e clique numa nota para abrir.
      </p>
      <div className="memoria-legenda">
        {Object.values(COR_DO_TIPO).map((t) => (
          <span key={t.nome}>
            <i style={{ background: t.cor }} />
            {t.nome}
          </span>
        ))}
      </div>
      {g.nodes.length ? <GrafoDaMemoria grafo={g} onNota={props.onNota} onTag={props.onTag} /> : <div className="memoria-grafo"><div className="memoria-vazio">Sem notas ainda. Guarde um link ou uma ideia para ver o grafo.</div></div>}
    </>
  );
}

function AbaVideos(props: { notas: MemoriaNotaBreve[]; editavel: boolean; token: string | null; onAbrir: (id: string) => void; mudou: () => void; setErro: (s: string | null) => void }) {
  return (
    <>
      <p className="muted memoria-dica">No Instagram: Compartilhar → grupo Memória ROOT no WhatsApp (ou cole o link aí em cima). A Memória baixa o vídeo, transcreve e destrincha gancho, estrutura, formato e CTA.</p>
      <div className="memoria-videos">
        {props.notas.length === 0 && <div className="memoria-vazio">Nenhum vídeo ainda.</div>}
        {props.notas.map((v) => (
          <div key={v.id} className="memoria-video">
            <div className="grow">
              <div className="memoria-item-t">{v.titulo}</div>
              <div className="memoria-item-m">
                {quando(v.criadaEm)}
                {v.url && /^https?:\/\//.test(v.url) && (
                  <>
                    {' · '}
                    <a href={v.url} target="_blank" rel="noopener noreferrer">
                      {v.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}
                    </a>
                  </>
                )}
                {v.erro && <span className="memoria-erro"> · {v.erro}</span>}
              </div>
            </div>
            {v.status === 'pronto' ? <span className="badge success">pronto</span> : <Badge s={v.status} />}
            {v.status === 'erro' && props.editavel && (
              <button
                className="small"
                onClick={async () => {
                  try {
                    await apiPost(`/marketing/estudio/memoria/notas/${v.id}/tentar`, {}, props.token);
                    props.mudou();
                  } catch (e) {
                    props.setErro((e as Error).message);
                  }
                }}
              >
                Tentar de novo
              </button>
            )}
            {v.status === 'pronto' && (
              <button className="small" onClick={() => props.onAbrir(v.id)}>
                Abrir nota
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function AbaObsidian(props: { painel: MemoriaPainel; editavel: boolean; token: string | null; mudou: () => void; setAviso: (s: string | null) => void; setErro: (s: string | null) => void }) {
  const [enviando, setEnviando] = useState(false);
  const faltam = props.painel.notas.filter((n) => n.status === 'pronto' && !n.noDrive).length;
  return (
    <div className="memoria-obs">
      <h2>Abrir a Memória no Obsidian</h2>
      <p className="muted">
        Cada nota pronta vira um arquivo .md no Drive Root, em 40-marca-e-conteudo/Memória, separado por pasta (Ideias, Links, Vídeos, Conhecimento, Diário), com título, tags, fonte e datas no cabeçalho. O Drive Root já está no seu
        Obsidian, então as notas aparecem lá sozinhas.
      </p>
      {props.editavel && faltam > 0 && (
        <button
          className="memoria-obs-btn"
          disabled={enviando}
          onClick={async () => {
            setEnviando(true);
            try {
              const r = await apiPost<{ enviadas: number; falharam: number }>('/marketing/estudio/memoria/drive/sincronizar', {}, props.token);
              props.setAviso(r.falharam ? `${r.enviadas} enviadas, ${r.falharam} falharam. Confira a conexão do Google.` : `${r.enviadas} notas enviadas para o Drive.`);
              props.mudou();
            } catch (e) {
              props.setErro((e as Error).message);
            } finally {
              setEnviando(false);
            }
          }}
        >
          {enviando ? 'Enviando…' : `Mandar para o Drive as ${faltam} que faltam`}
        </button>
      )}
      <ol>
        <li>No Obsidian, abra a pasta Root › 40-marca-e-conteudo › Memória.</li>
        <li>Para mudar uma nota, edite aqui: o arquivo do Drive é regravado.</li>
        <li>Apagar aqui não apaga o arquivo do Drive.</li>
      </ol>
    </div>
  );
}
