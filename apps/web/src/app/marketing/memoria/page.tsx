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
import { btn, btnPrimario } from '@/components/maquina/pecas';
import { GrafoDaMemoria, COR_DO_TIPO } from '@/components/marketing/GrafoDaMemoria';
import { markdownDaMemoria } from '@/components/marketing/markdown-da-memoria';

/*
 * Marketing › MEMÓRIA, a do ROOT Estúdio dentro do OS (26/10/2026).
 * Captura no topo; abas Notas, Grafo, Vídeos e Obsidian. Links e Reels mandados
 * no grupo "Memória ROOT" do WhatsApp chegam aqui sozinhos; cada nota pronta
 * vira .md no Drive Root (40-marca-e-conteudo/Memória), que é o Obsidian.
 */

type Aba = 'notas' | 'grafo' | 'videos' | 'obsidian';
const ICONE: Record<string, string> = { video: '🎬', link: '🔗', ideia: '💡', nota: '📝' };
const quando = (s: string) => {
  try {
    return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
};
const campo = 'w-full rounded border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-brand';
const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-xs transition ${on ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-text'}`;
const PROSA =
  'text-[0.95rem] leading-relaxed [&_a]:text-brand [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_code]:font-os-mono [&_code]:text-[0.85em] [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-border [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-2 [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5';

function Status({ s }: { s: string }) {
  if (s === 'pronto') return null;
  const tom = s === 'erro' ? 'border-bad/40 text-bad' : 'border-brand-dim text-brand';
  const texto = s === 'fila' ? 'na fila' : s === 'processando' ? 'processando' : 'erro';
  return <span className={`ml-1 rounded border px-1.5 py-px font-os-mono text-[0.62rem] uppercase ${tom}`}>{texto}</span>;
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
    const t = setTimeout(() => void carregar(), busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [ready, carregar, busca, versao]);

  // Atualiza sozinho enquanto há link ou vídeo sendo lido.
  useEffect(() => {
    if (!painel?.notas.some((n) => n.status === 'fila' || n.status === 'processando')) return;
    const t = setTimeout(() => setVersao((v) => v + 1), 6000);
    return () => clearTimeout(t);
  }, [painel]);

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

  if (ready && !can('pauta.ver')) return <p className="text-muted">Acesso insuficiente para Marketing.</p>;

  return (
    <div className="com-tema space-y-4">
      {editavel && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <textarea
              rows={1}
              value={captura}
              onChange={(e) => setCaptura(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void capturar();
                }
              }}
              placeholder="Link, Reel ou ideia…"
              aria-label="Guardar na Memória"
              className={`${campo} min-h-[2.4rem] resize-y`}
            />
            <button className={btnPrimario} onClick={() => void capturar()} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
          {painel?.ligacoes.grupo && (
            <p className="text-xs text-muted">Mande links e Reels no grupo Memória ROOT do WhatsApp: eles chegam aqui sozinhos.</p>
          )}
        </div>
      )}
      {aviso && (
        <p role="status" className="rounded border border-brand-dim bg-brand/5 px-3 py-2 text-sm" onClick={() => setAviso(null)}>
          {aviso}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {erro}
        </p>
      )}

      <div role="tablist" className="flex gap-1 border-b border-border">
        {(
          [
            ['notas', 'Notas'],
            ['grafo', 'Grafo'],
            ['videos', 'Vídeos'],
            ['obsidian', 'Obsidian'],
          ] as [Aba, string][]
        ).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={aba === k}
            onClick={() => setAba(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === k ? 'border-brand font-medium text-text' : 'border-transparent text-muted hover:text-text'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {!painel ? (
        <p className="text-muted">Carregando…</p>
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
}) {
  const { painel } = props;
  const [nova, setNova] = useState(false);
  const filtrando = !!(props.busca || props.tag || props.pasta);
  return (
    <div className="grid gap-4 min-[900px]:grid-cols-[minmax(260px,340px)_1fr]">
      <div className="space-y-2">
        <div className="flex gap-2">
          <input type="search" value={props.busca} onChange={(e) => props.setBusca(e.target.value)} placeholder="Buscar nas notas" aria-label="Buscar nas notas" className={campo} />
          {props.editavel && (
            <button className={btn} onClick={() => setNova(true)}>
              + Nota
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button className={chip(!props.pasta)} onClick={() => props.setPasta('')}>
            Todas <span className="font-os-mono">{painel.total}</span>
          </button>
          {painel.pastas.map((p) => (
            <button key={p.nome} className={chip(props.pasta === p.nome)} onClick={() => props.setPasta(p.nome)}>
              {p.nome} <span className="font-os-mono">{p.n}</span>
            </button>
          ))}
        </div>
        {painel.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {painel.tags.slice(0, 30).map((t) => (
              <button key={t.t} className={chip(props.tag === t.t)} onClick={() => props.setTag(props.tag === t.t ? '' : t.t)}>
                #{t.t} <span className="font-os-mono">{t.n}</span>
              </button>
            ))}
          </div>
        )}
        <div className="divide-y divide-border rounded border border-border">
          {painel.notas.length === 0 && (
            <p className="p-4 text-sm text-muted">{filtrando ? 'Nada com esse filtro.' : 'A Memória está vazia. Cole um link, um Reel ou uma ideia aí em cima.'}</p>
          )}
          {painel.notas.map((n) => (
            <button key={n.id} onClick={() => props.setAberta(n.id)} className={`block w-full px-3 py-2 text-left hover:bg-surface-2 ${props.aberta === n.id ? 'bg-surface-2' : ''}`}>
              <span className="block text-sm">
                {ICONE[n.tipo] ?? '📝'} {n.titulo}
                <Status s={n.status} />
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                {n.via === 'whatsapp' && <span className="text-brand">WhatsApp · </span>}
                {n.pasta} · {quando(n.atualizadaEm)}
                {n.tags.length > 0 && ` · ${n.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}`}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 rounded border border-border p-4">
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
          />
        ) : (
          <p className="text-sm text-muted">Escolha uma nota.</p>
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

function Leitor(props: { id: string; token: string | null; editavel: boolean; onAbrir: (id: string | null) => void; onTag: (t: string) => void; mudou: () => void; setErro: (s: string | null) => void }) {
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

  // Links internos do markdown: [[Nota]] abre a nota; #tag filtra.
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
        const r = await apiGet<MemoriaPainel>(`/marketing/estudio/memoria?q=${encodeURIComponent(nome)}`, props.token);
        const achou = r.notas.find((x) => x.titulo.toLowerCase() === nome.toLowerCase());
        if (achou) props.onAbrir(achou.id);
        else if (props.editavel && confirm(`A nota "${nome}" ainda não existe. Criar agora?`)) {
          const c = await apiPost<MemoriaNotaBreve>('/marketing/estudio/memoria/notas', { titulo: nome, pasta: 'Conhecimento', corpo: '' }, props.token);
          props.mudou();
          props.onAbrir(c.id);
        }
      }
    };
    a.addEventListener('click', clique);
    return () => a.removeEventListener('click', clique);
  });

  if (sumiu) return <p className="text-sm text-muted">Essa nota não existe mais.</p>;
  if (!n) return <p className="text-sm text-muted">Abrindo…</p>;

  const agir = async (fn: () => Promise<unknown>) => {
    try {
      props.setErro(null);
      await fn();
    } catch (e) {
      props.setErro((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editando ? (
            <input value={rascunho.titulo} onChange={(e) => setRascunho({ ...rascunho, titulo: e.target.value })} className={`${campo} text-lg font-semibold`} aria-label="Título" />
          ) : (
            <h2 className="text-lg font-semibold leading-snug">{n.titulo}</h2>
          )}
          <p className="mt-0.5 text-xs text-muted">
            {n.pasta} · {quando(n.atualizadaEm)}
            {n.via === 'whatsapp' && <span className="text-brand"> · WhatsApp</span>}
            {n.noDrive && <span> · no Drive</span>}
          </p>
        </div>
        {props.editavel && (
          <div className="flex gap-2">
            {editando ? (
              <>
                <button className={btn} onClick={() => setEditando(false)}>
                  Cancelar
                </button>
                <button
                  className={btnPrimario}
                  onClick={() =>
                    void agir(async () => {
                      await apiPut(`/marketing/estudio/memoria/notas/${n.id}`, rascunho, props.token);
                      setEditando(false);
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
                {n.status === 'pronto' && (
                  <button className={btn} onClick={() => setEditando(true)}>
                    Editar
                  </button>
                )}
                <button
                  className={`${btn} hover:border-bad hover:text-bad`}
                  onClick={() => {
                    if (!confirm('Apagar esta nota do OS? O arquivo no Drive continua lá.')) return;
                    void agir(async () => {
                      await apiDelete(`/marketing/estudio/memoria/notas/${n.id}`, props.token);
                      props.onAbrir(null);
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
      {!editando && (n.autor || n.url) && (
        <div className="flex flex-wrap gap-1.5">
          {n.autor && <span className={chip(false)}>{n.tipo === 'video' ? '@' : ''}{n.autor}</span>}
          {n.url && /^https?:\/\//i.test(n.url) && (
            <a className={chip(false)} href={n.url} target="_blank" rel="noopener noreferrer">
              Abrir fonte ↗
            </a>
          )}
        </div>
      )}
      {n.status === 'erro' && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          <span>{n.erro || 'Não deu para processar este link.'}</span>
          {props.editavel && (
            <button
              className={btn}
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
      {(n.status === 'fila' || n.status === 'processando') && <p className="text-sm text-muted">A IA está lendo este link. A nota completa aparece aqui em instantes.</p>}
      {editando ? (
        <>
          <label className="block text-sm">
            <span className="com-rotulo mb-1 block">Pasta</span>
            <select value={rascunho.pasta} onChange={(e) => setRascunho({ ...rascunho, pasta: e.target.value as MemoriaPasta })} className={campo}>
              {MEMORIA_PASTAS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <textarea rows={18} value={rascunho.corpo} onChange={(e) => setRascunho({ ...rascunho, corpo: e.target.value })} className={`${campo} font-os-mono text-[0.85rem]`} aria-label="Texto da nota" spellCheck />
          <p className="text-xs text-muted">Markdown. Ligue notas com [[Nome da nota]] e marque assuntos com #tag.</p>
        </>
      ) : (
        <article ref={artigo} className={PROSA} dangerouslySetInnerHTML={{ __html: markdownDaMemoria(n.corpo) || (n.status === 'pronto' ? '<p class="text-muted">Nota vazia.</p>' : '') }} />
      )}
      {n.citadaEm.length > 0 && (
        <div>
          <h3 className="com-rotulo mb-1">Citada em</h3>
          <div className="flex flex-wrap gap-1.5">
            {n.citadaEm.map((c) => (
              <button key={c.id} className={chip(false)} onClick={() => props.onAbrir(c.id)}>
                {c.titulo}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NovaNota(props: { token: string | null; onFechar: () => void; onCriada: (id: string) => void; setErro: (s: string | null) => void }) {
  const [titulo, setTitulo] = useState('');
  const [pasta, setPasta] = useState<MemoriaPasta>('Conhecimento');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onClick={props.onFechar}>
      <form
        className="w-full max-w-md space-y-3 rounded border border-border bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
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
        <h2 className="text-lg font-semibold">Nova nota</h2>
        <label className="block text-sm">
          <span className="com-rotulo mb-1 block">Título</span>
          <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Ideias para o livro" className={campo} />
        </label>
        <label className="block text-sm">
          <span className="com-rotulo mb-1 block">Pasta</span>
          <select value={pasta} onChange={(e) => setPasta(e.target.value as MemoriaPasta)} className={campo}>
            {MEMORIA_PASTAS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={props.onFechar}>
            Fechar
          </button>
          <button type="submit" className={btnPrimario} disabled={!titulo.trim()}>
            Criar
          </button>
        </div>
      </form>
    </div>
  );
}

function AbaGrafo(props: { token: string | null; onNota: (id: string) => void; onTag: (t: string) => void }) {
  const [g, setG] = useState<MemoriaGrafo | null>(null);
  useEffect(() => {
    void apiGet<MemoriaGrafo>('/marketing/estudio/memoria/grafo', props.token).then(setG).catch(() => setG({ nodes: [], links: [] }));
  }, [props.token]);
  if (!g) return <p className="text-muted">Carregando…</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        Cada ponto é uma nota. As linhas ligam notas às tags, às notas citadas com [[título]] e a notas do mesmo autor ou site. Arraste para mexer, use a roda do mouse para aproximar e clique numa nota para abrir.
      </p>
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        {Object.values(COR_DO_TIPO).map((t) => (
          <span key={t.nome} className="inline-flex items-center gap-1">
            <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.cor }} />
            {t.nome}
          </span>
        ))}
      </div>
      {g.nodes.length ? <GrafoDaMemoria grafo={g} onNota={props.onNota} onTag={props.onTag} /> : <p className="text-sm text-muted">Sem notas ainda. Guarde um link ou uma ideia para ver o grafo.</p>}
    </div>
  );
}

function AbaVideos(props: { notas: MemoriaNotaBreve[]; editavel: boolean; token: string | null; onAbrir: (id: string) => void; mudou: () => void; setErro: (s: string | null) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        No Instagram: Compartilhar → grupo Memória ROOT no WhatsApp (ou cole o link aí em cima). A Memória baixa o vídeo, transcreve e destrincha gancho, estrutura, formato e CTA.
      </p>
      <div className="divide-y divide-border rounded border border-border">
        {props.notas.length === 0 && <p className="p-4 text-sm text-muted">Nenhum vídeo ainda.</p>}
        {props.notas.map((v) => (
          <div key={v.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                {v.titulo}
                <Status s={v.status} />
              </p>
              <p className="truncate text-xs text-muted">
                {quando(v.criadaEm)}
                {v.url && ` · ${v.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}`}
                {v.erro && <span className="text-bad"> · {v.erro}</span>}
              </p>
            </div>
            {v.status === 'pronto' && (
              <button className={btn} onClick={() => props.onAbrir(v.id)}>
                Abrir nota
              </button>
            )}
            {v.status === 'erro' && props.editavel && (
              <button
                className={btn}
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
          </div>
        ))}
      </div>
    </div>
  );
}

function AbaObsidian(props: { painel: MemoriaPainel; editavel: boolean; token: string | null; mudou: () => void; setAviso: (s: string) => void; setErro: (s: string | null) => void }) {
  const [enviando, setEnviando] = useState(false);
  const faltam = props.painel.notas.filter((n) => n.status === 'pronto' && !n.noDrive).length;
  return (
    <div className="max-w-2xl space-y-3 text-sm">
      <h2 className="text-lg font-semibold">A Memória no Obsidian</h2>
      <p className="text-muted">
        Cada nota pronta vira um arquivo .md no Drive Root, em <span className="font-os-mono">40-marca-e-conteudo/Memória/&lt;pasta&gt;</span> (Ideias, Links, Vídeos, Conhecimento, Diário), com título, tags, fonte e datas no cabeçalho. O Drive Root já está no cofre do Obsidian, então as notas aparecem lá sozinhas.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-muted">
        <li>No Obsidian, abra a pasta Root › 40-marca-e-conteudo › Memória.</li>
        <li>Editar no Obsidian não volta para o OS: para mudar uma nota, edite aqui, e o arquivo é regravado.</li>
        <li>Apagar no OS não apaga o arquivo do Drive.</li>
      </ol>
      {props.editavel && faltam > 0 && (
        <button
          className={btn}
          disabled={enviando}
          onClick={async () => {
            setEnviando(true);
            try {
              const r = await apiPost<{ enviadas: number; falharam: number }>('/marketing/estudio/memoria/drive/sincronizar', {}, props.token);
              props.setAviso(r.falharam ? `${r.enviadas} enviadas, ${r.falharam} falharam. Confira a conexão do Google em Conexões.` : `${r.enviadas} notas enviadas para o Drive.`);
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
    </div>
  );
}
