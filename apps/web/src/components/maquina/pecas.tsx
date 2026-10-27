'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  MAQUINA_ESTEIRA,
  MAQUINA_FORMATOS,
  COMUNIDADE_SUBTIPOS,
  MAQUINA_METRICAS,
  MAQUINA_PRIORIDADES,
  MAQUINA_TIPOS_DE_FONTE,
  proximoPassoDoPost,
  ROTULO_DA_ETAPA,
  datasLivres,
  etapaPrecisaDeData,
  type MaquinaEtapa,
  type MaquinaFonte,
  type MaquinaPost,
  type MaquinaPostSalvarInput,
} from '@mktos/shared';
import type { Maquina } from './useMaquina';
import { GerarComRegua } from './GerarComRegua';

/*
 * AS PEÇAS DA MÁQUINA DE CONTEÚDO (Marketing). O vocabulário da Máquina dos
 * clientes (conteudo.operacaoroot.com) com as cores do OS: um acento só (lima),
 * mono só em rótulo, chip e número, vermelho só para problema.
 */

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const DIAS_DA_SEMANA = DIAS;
export const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export function dataCurta(iso: string | null): string {
  if (!iso) return 'sem data';
  const d = new Date(`${iso}T12:00:00Z`);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${DIAS[d.getUTCDay()]}`;
}
export const rotuloDoPost = (p: MaquinaPost) => (p.numero ? `${p.numero} · ${p.titulo}` : p.titulo);

export const btn =
  'inline-flex items-center gap-1.5 rounded border border-border-strong px-3 py-1.5 font-os-mono text-[0.68rem] uppercase tracking-[0.1em] text-text transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40';
export const btnPrimario =
  'inline-flex items-center gap-1.5 rounded border border-brand bg-brand px-3 py-1.5 font-os-mono text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink transition hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-40';
const campo = 'w-full rounded border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-brand';

/** O chip da etapa: contorno até "A agendar", lima cheio em "Postado". */
export function EtapaChip({ etapa }: { etapa: MaquinaEtapa }) {
  const tom: Record<MaquinaEtapa, string> = {
    ideia: 'border-border-strong text-muted',
    producao: 'border-brand-dim text-brand',
    a_agendar: 'border-brand text-brand',
    agendado: 'border-brand bg-brand/15 text-brand',
    publicado: 'border-brand bg-brand text-ink',
    arquivado: 'border-border text-dim line-through',
  };
  return (
    <span className={`inline-block whitespace-nowrap rounded-sm border px-1.5 py-px font-os-mono text-[0.62rem] uppercase tracking-[0.08em] ${tom[etapa]}`}>
      {ROTULO_DA_ETAPA[etapa]}
    </span>
  );
}

/** A barra de etapas do post: onde ele está na esteira. */
export function Etapas({ etapa }: { etapa: MaquinaEtapa }) {
  const i = MAQUINA_ESTEIRA.indexOf(etapa);
  return (
    <ol className="flex flex-wrap gap-1">
      {MAQUINA_ESTEIRA.map((e, k) => (
        <li
          key={e}
          className={`rounded-sm px-2 py-0.5 font-os-mono text-[0.6rem] uppercase tracking-[0.08em] ${
            k < i ? 'bg-brand/15 text-brand' : k === i ? 'bg-brand text-ink' : 'bg-surface-2 text-dim'
          }`}
        >
          {ROTULO_DA_ETAPA[e]}
        </li>
      ))}
    </ol>
  );
}

/** A casca das janelas (post, editor, data). Fecha no Esc e no fundo. */
export function Janela(props: { titulo: string; onFechar: () => void; largura?: string; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && props.onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [props]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-10" onMouseDown={props.onFechar}>
      <div
        role="dialog"
        aria-label={props.titulo}
        className={`com-tema w-full ${props.largura ?? 'max-w-3xl'} rounded-md border border-border bg-surface shadow-xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="truncate text-[1.05rem] font-semibold">{props.titulo}</h2>
          <button onClick={props.onFechar} className="com-rotulo hover:text-text" aria-label="Fechar">
            fechar ✕
          </button>
        </div>
        <div className="px-5 py-4">{props.children}</div>
      </div>
    </div>
  );
}

/** Escolher o dia: as datas livres da cadência primeiro, e qualquer dia no campo. */
export function EscolherData(props: {
  m: Maquina;
  titulo: string;
  inicial?: string | null;
  comLink?: boolean;
  onEscolher: (data: string, link?: string) => void;
  onFechar: () => void;
}) {
  const [data, setData] = useState(props.inicial ?? '');
  const [link, setLink] = useState('');
  const livres = useMemo(
    () => (props.m.painel ? datasLivres(props.m.painel.posts, props.m.painel.cadencia, hojeSP()) : []),
    [props.m.painel],
  );
  return (
    <Janela titulo={props.titulo} onFechar={props.onFechar} largura="max-w-md">
      {!props.comLink && livres.length > 0 && (
        <>
          <div className="com-rotulo">Dias livres da cadência</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {livres.map((d) => (
              <button key={d} onClick={() => setData(d)} className={`${btn} ${data === d ? 'border-brand text-brand' : ''}`}>
                {dataCurta(d)}
              </button>
            ))}
          </div>
        </>
      )}
      <label className="com-rotulo mt-4 block">{props.comLink ? 'Dia em que foi ao ar' : 'Ou escolha o dia'}</label>
      <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={`${campo} mt-1`} />
      {props.comLink && (
        <>
          <label className="com-rotulo mt-3 block">Link do post (opcional)</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://instagram.com/p/…" className={`${campo} mt-1`} />
        </>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button className={btn} onClick={props.onFechar}>
          Cancelar
        </button>
        <button className={btnPrimario} disabled={!data} onClick={() => props.onEscolher(data, link || undefined)}>
          Confirmar
        </button>
      </div>
    </Janela>
  );
}

/** Levar o post a uma etapa: pede a data quando a etapa exige, senão vai direto. */
export function useLevar(m: Maquina) {
  const [pedido, setPedido] = useState<{ post: MaquinaPost; para: MaquinaEtapa } | null>(null);
  const levar = (post: MaquinaPost, para: MaquinaEtapa) => {
    if (post.etapa === para) return;
    if (etapaPrecisaDeData(para)) setPedido({ post, para });
    else void m.mudarEtapa(post.id, para);
  };
  const janela = pedido && (
    <EscolherData
      m={m}
      titulo={pedido.para === 'publicado' ? `Postado: ${pedido.post.titulo}` : `Agendar: ${pedido.post.titulo}`}
      inicial={pedido.post.data ?? (pedido.para === 'publicado' ? hojeSP() : null)}
      comLink={pedido.para === 'publicado'}
      onFechar={() => setPedido(null)}
      onEscolher={async (data, link) => {
        await m.mudarEtapa(pedido.post.id, pedido.para, data, link);
        setPedido(null);
      }}
    />
  );
  return { levar, janela };
}

/** A linha da lista: alça de arrastar, número, título, meta e o próximo passo. */
export function PostLinha(props: {
  post: MaquinaPost;
  pilar?: string;
  editavel: boolean;
  /** Na tela de uma etapa só, o chip da etapa é repetição. */
  semEtapa?: boolean;
  onAbrir: () => void;
  onProximo?: () => void;
  arrastavel?: boolean;
  onArrastar?: (e: React.DragEvent) => void;
  onSoltar?: (e: React.DragEvent) => void;
}) {
  const p = props.post;
  const passo = proximoPassoDoPost(p);
  return (
    <li
      draggable={props.arrastavel}
      onDragStart={props.onArrastar}
      onDragOver={(e) => props.onSoltar && e.preventDefault()}
      onDrop={props.onSoltar}
      className="group flex items-center gap-3 border-b border-border px-2 py-2.5 last:border-b-0 hover:bg-surface-2"
    >
      {props.arrastavel && (
        <span className="cursor-grab select-none text-dim opacity-40 group-hover:opacity-100" title="Arraste para mudar a ordem">
          ⠿
        </span>
      )}
      <span className="w-16 shrink-0 font-os-mono text-xs text-muted">{p.numero || '—'}</span>
      <button onClick={props.onAbrir} className="min-w-0 flex-1 text-left">
        <div className="truncate font-medium hover:text-brand">{p.titulo}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {!props.semEtapa && <EtapaChip etapa={p.etapa} />}
          <span>{p.formato}{p.subtipo ? ` · ${p.subtipo}` : ''}</span>
          {props.pilar && <span>· {props.pilar}</span>}
          {p.data && <span className="font-os-mono">· {dataCurta(p.data)}</span>}
          {p.prioridade === 'alta' && <span className="font-os-mono text-warn">· prioridade alta</span>}
        </div>
      </button>
      {props.editavel && passo && props.onProximo && (
        <button onClick={props.onProximo} className={`${btn} hidden sm:inline-flex`}>
          {passo.rotulo}
        </button>
      )}
    </li>
  );
}

/** Lista com reordenação por arrasto. A ordem é a da esteira inteira (um campo só). */
export function ListaDePosts(props: {
  m: Maquina;
  posts: MaquinaPost[];
  onAbrir: (id: string) => void;
  levar: (p: MaquinaPost, para: MaquinaEtapa) => void;
  vazio: string;
  semEtapa?: boolean;
}) {
  const { m } = props;
  const [arrastado, setArrastado] = useState<string | null>(null);
  const pilares = new Map((m.painel?.pilares ?? []).map((p) => [p.chave, p.nome]));
  if (!props.posts.length) return <p className="px-2 py-6 text-sm text-muted">{props.vazio}</p>;
  const soltarSobre = (alvo: string) => {
    if (!arrastado || arrastado === alvo || !m.painel) return;
    const ordem = [...m.painel.posts].sort((a, b) => a.ordem - b.ordem).map((p) => p.id).filter((id) => id !== arrastado);
    ordem.splice(ordem.indexOf(alvo), 0, arrastado);
    void m.ordenar(ordem);
    setArrastado(null);
  };
  return (
    <ul className="rounded-md border border-border bg-surface">
      {props.posts.map((p) => (
        <PostLinha
          key={p.id}
          post={p}
          pilar={pilares.get(p.pilar) ?? p.pilar}
          editavel={m.editavel}
          semEtapa={props.semEtapa}
          arrastavel={m.editavel}
          onArrastar={() => setArrastado(p.id)}
          onSoltar={() => soltarSobre(p.id)}
          onAbrir={() => props.onAbrir(p.id)}
          onProximo={() => {
            const passo = proximoPassoDoPost(p);
            if (passo) props.levar(p, passo.para);
          }}
        />
      ))}
    </ul>
  );
}

/** O kanban da esteira: arrastar para outra coluna muda a etapa. */
export function Kanban(props: {
  m: Maquina;
  posts: MaquinaPost[];
  colunas?: readonly MaquinaEtapa[];
  onAbrir: (id: string) => void;
  levar: (p: MaquinaPost, para: MaquinaEtapa) => void;
}) {
  const [arrastado, setArrastado] = useState<string | null>(null);
  const colunas = props.colunas ?? MAQUINA_ESTEIRA;
  return (
    <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${colunas.length}, minmax(220px, 1fr))` }}>
      {colunas.map((etapa) => {
        const doCol = props.posts.filter((p) => p.etapa === etapa);
        return (
          <section
            key={etapa}
            onDragOver={(e) => props.m.editavel && e.preventDefault()}
            onDrop={() => {
              const p = props.posts.find((x) => x.id === arrastado);
              if (p) props.levar(p, etapa);
              setArrastado(null);
            }}
            className="flex max-h-[75vh] flex-col rounded-md border border-border bg-surface-2"
          >
            <header className="sticky top-0 flex items-baseline justify-between px-3 pb-2 pt-3">
              <span className="com-rotulo">{ROTULO_DA_ETAPA[etapa]}</span>
              <span className="com-num text-sm text-muted">{doCol.length}</span>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {doCol.map((p) => (
                <button
                  key={p.id}
                  draggable={props.m.editavel}
                  onDragStart={() => setArrastado(p.id)}
                  onClick={() => props.onAbrir(p.id)}
                  className="block w-full rounded border border-border bg-surface p-2.5 text-left text-sm transition hover:border-brand-dim"
                >
                  {p.numero && <div className="font-os-mono text-[0.65rem] text-muted">{p.numero}</div>}
                  <div className="font-medium leading-snug">{p.titulo}</div>
                  <div className="mt-1 text-xs text-muted">
                    {p.formato}
                    {p.data && <span className="font-os-mono"> · {dataCurta(p.data)}</span>}
                  </div>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Lista ou Kanban, lembrado por tela neste navegador. */
export function useVisao(chave: string, padrao: 'lista' | 'kanban' | 'calendario' = 'lista') {
  const [visao, setVisao] = useState<string>(padrao);
  useEffect(() => {
    try {
      const v = localStorage.getItem(`maquina_visao_${chave}`);
      if (v) setVisao(v);
    } catch {}
  }, [chave]);
  const trocar = (v: string) => {
    setVisao(v);
    try {
      localStorage.setItem(`maquina_visao_${chave}`, v);
    } catch {}
  };
  return [visao, trocar] as const;
}

export function SeletorDeVisao(props: { visao: string; opcoes: { v: string; rotulo: string }[]; onTrocar: (v: string) => void }) {
  return (
    <div className="inline-flex rounded border border-border bg-surface p-0.5">
      {props.opcoes.map((o) => (
        <button
          key={o.v}
          onClick={() => props.onTrocar(o.v)}
          className={`rounded-sm px-2.5 py-1 font-os-mono text-[0.65rem] uppercase tracking-[0.1em] ${
            props.visao === o.v ? 'bg-brand text-ink' : 'text-muted hover:text-text'
          }`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

function Bloco({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-3 first:border-t-0">
      <div className="com-rotulo mb-1.5">{rotulo}</div>
      {children}
    </section>
  );
}
const texto = (s: string) => <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed">{s}</p>;

/** O post aberto: o conteúdo inteiro, o próximo passo, comentários, números e histórico. */
export function PostAberto(props: { m: Maquina; post: MaquinaPost; onEditar: () => void; onFechar: () => void }) {
  const { m, post: p } = props;
  const { levar, janela } = useLevar(m);
  const [comentario, setComentario] = useState('');
  const [metricas, setMetricas] = useState<Record<string, string>>({});
  const [link, setLink] = useState(p.linkPublicado);
  const passo = proximoPassoDoPost(p);
  const pilar = m.painel?.pilares.find((x) => x.chave === p.pilar)?.nome ?? p.pilar;
  useEffect(() => {
    setMetricas(Object.fromEntries(MAQUINA_METRICAS.map((x) => [x.chave, p.metricas[x.chave]?.toString() ?? ''])));
    setLink(p.linkPublicado);
  }, [p]);

  return (
    <Janela titulo={rotuloDoPost(p)} onFechar={props.onFechar}>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <EtapaChip etapa={p.etapa} />
        <span>{p.formato}{p.subtipo ? ` · ${p.subtipo}` : ''}</span>
        {pilar && <span>· {pilar}</span>}
        <span className="font-os-mono">· {dataCurta(p.data)}</span>
      </div>
      <div className="mt-3">
        <Etapas etapa={p.etapa === 'arquivado' ? 'ideia' : p.etapa} />
      </div>

      {m.editavel && (
        <div className="mt-4 flex flex-wrap gap-2">
          {passo && (
            <button className={btnPrimario} onClick={() => levar(p, passo.para)}>
              {passo.rotulo}
            </button>
          )}
          {(p.etapa === 'agendado' || p.etapa === 'a_agendar') && (
            <button className={btn} onClick={() => levar({ ...p, etapa: 'a_agendar' }, 'agendado')}>
              {p.data ? 'Mudar data' : 'Escolher data'}
            </button>
          )}
          <button className={btn} onClick={props.onEditar}>
            Editar
          </button>
          <GerarComRegua m={m} post={p} />
          {p.etapa !== 'ideia' && p.etapa !== 'arquivado' && (
            <button className={btn} onClick={() => levar(p, 'ideia')}>
              Voltar ao banco
            </button>
          )}
          {p.etapa === 'arquivado' ? (
            <button className={btn} onClick={() => levar(p, 'ideia')}>
              Tirar do arquivo
            </button>
          ) : (
            <button className={`${btn} hover:border-bad hover:text-bad`} onClick={() => levar(p, 'arquivado')}>
              Arquivar
            </button>
          )}
        </div>
      )}

      <div className="mt-4">
        {(p.headline || p.subHeadline) && (
          <Bloco rotulo="Headline">
            {p.headline && <p className="text-lg font-semibold leading-snug">{p.headline}</p>}
            {p.subHeadline && <p className="mt-1 text-muted">{p.subHeadline}</p>}
          </Bloco>
        )}
        {p.tipoCard === 'arte' && p.slides.length > 0 && (
          <Bloco rotulo={`Slides (${p.slides.length})`}>
            <ol className="space-y-1.5">
              {p.slides.map((s, i) => (
                <li key={i} className="flex gap-2 text-[0.95rem]">
                  <span className="font-os-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
                  <span className="whitespace-pre-wrap">{s}</span>
                </li>
              ))}
            </ol>
          </Bloco>
        )}
        {p.tipoCard === 'arte' && p.design && <Bloco rotulo="Orientação de design">{texto(p.design)}</Bloco>}
        {p.roteiro && <Bloco rotulo="Roteiro">{texto(p.roteiro)}</Bloco>}
        {p.legenda && <Bloco rotulo="Legenda">{texto(p.legenda)}</Bloco>}
        {p.cta && <Bloco rotulo="CTA">{texto(p.cta)}</Bloco>}
        {p.porque && <Bloco rotulo="Por que este post">{texto(p.porque)}</Bloco>}
        {p.fontes.length > 0 && (
          <Bloco rotulo="Fontes">
            <ul className="space-y-1 text-sm">
              {p.fontes.map((f, i) => (
                <li key={i}>
                  <span className="font-os-mono text-xs text-muted">{f.tipo}</span>{' '}
                  {f.link ? (
                    <a href={f.link} target="_blank" rel="noreferrer" className="text-brand underline">
                      {f.nome}
                    </a>
                  ) : (
                    f.nome
                  )}
                  {f.detalhe && <span className="text-muted"> · {f.detalhe}</span>}
                </li>
              ))}
            </ul>
          </Bloco>
        )}
        {p.recursos.length > 0 && (
          <Bloco rotulo="O que precisa para gravar">
            <ul className="list-inside list-disc text-sm">
              {p.recursos.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Bloco>
        )}

        {p.etapa === 'publicado' && (
          <Bloco rotulo="Números do post">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              disabled={!m.editavel}
              placeholder="Link do post"
              className={`${campo} mb-2`}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MAQUINA_METRICAS.map((x) => (
                <label key={x.chave} className="text-xs text-muted">
                  {x.rotulo}
                  <input
                    inputMode="numeric"
                    value={metricas[x.chave] ?? ''}
                    disabled={!m.editavel}
                    onChange={(e) => setMetricas({ ...metricas, [x.chave]: e.target.value.replace(/\D/g, '') })}
                    className={`${campo} com-num mt-0.5`}
                  />
                </label>
              ))}
            </div>
            {m.editavel && (
              <button
                className={`${btn} mt-2`}
                onClick={() =>
                  void m.salvarMetricas(
                    p.id,
                    link,
                    Object.fromEntries(Object.entries(metricas).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])),
                  )
                }
              >
                Salvar números
              </button>
            )}
          </Bloco>
        )}

        <Bloco rotulo={`Conversa (${p.comentarios.length})`}>
          <ul className="space-y-2">
            {p.comentarios.map((c, i) => (
              <li key={i} className="rounded bg-surface-2 px-3 py-2 text-sm">
                <div className="com-rotulo">
                  {c.autor} · {new Date(c.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap">{c.texto}</p>
              </li>
            ))}
          </ul>
          {m.editavel && (
            <div className="mt-2 flex gap-2">
              <input value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Escreva um comentário" className={campo} />
              <button
                className={btn}
                disabled={!comentario.trim()}
                onClick={async () => {
                  if (await m.comentar(p.id, comentario.trim())) setComentario('');
                }}
              >
                Enviar
              </button>
            </div>
          )}
        </Bloco>

        {p.hist.length > 0 && (
          <Bloco rotulo="Histórico">
            <ul className="space-y-0.5 text-xs text-muted">
              {[...p.hist].reverse().map((h, i) => (
                <li key={i}>
                  <span className="font-os-mono">{new Date(h.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span> ·{' '}
                  {h.de ? `${ROTULO_DA_ETAPA[h.de]} → ` : 'criado em '}
                  {ROTULO_DA_ETAPA[h.para]} · {h.por}
                </li>
              ))}
            </ul>
          </Bloco>
        )}
      </div>
      {janela}
    </Janela>
  );
}

const VAZIO: MaquinaPostSalvarInput = {
  numero: '', titulo: '', pilar: '', formato: 'Reel', subtipo: '', tipoCard: 'video', prioridade: 'media',
  headline: '', subHeadline: '', roteiro: '', slides: [], design: '', legenda: '', cta: '', porque: '',
  fontes: [], recursos: [],
};

/** Criar ou editar um post. Vídeo pede roteiro; Arte/Carrossel pede slides e orientação de design. */
export function EditorDePost(props: {
  m: Maquina;
  post?: MaquinaPost;
  /** Para o "+" do calendário: nasce agendado (ou postado) naquele dia. */
  inicial?: Partial<MaquinaPostSalvarInput>;
  onFechar: () => void;
  onSalvo: (p: MaquinaPost) => void;
}) {
  const { m } = props;
  const [f, setF] = useState<MaquinaPostSalvarInput>(() =>
    props.post
      ? {
          numero: props.post.numero, titulo: props.post.titulo, pilar: props.post.pilar, formato: props.post.formato, subtipo: props.post.subtipo,
          tipoCard: props.post.tipoCard, prioridade: props.post.prioridade, headline: props.post.headline,
          subHeadline: props.post.subHeadline, roteiro: props.post.roteiro, slides: props.post.slides, design: props.post.design,
          legenda: props.post.legenda, cta: props.post.cta, porque: props.post.porque, fontes: props.post.fontes,
          recursos: props.post.recursos,
        }
      : { ...VAZIO, ...props.inicial },
  );
  const [salvando, setSalvando] = useState(false);
  const set = <K extends keyof MaquinaPostSalvarInput>(k: K, v: MaquinaPostSalvarInput[K]) => setF((a) => ({ ...a, [k]: v }));
  const area = (k: 'roteiro' | 'legenda' | 'cta' | 'porque' | 'design', linhas = 4) => (
    <textarea rows={linhas} value={f[k]} onChange={(e) => set(k, e.target.value)} className={campo} />
  );
  const rotulo = (t: string) => <span className="com-rotulo mb-1 block">{t}</span>;

  async function salvar() {
    setSalvando(true);
    const limpo = {
      ...f,
      slides: f.slides.filter((s) => s.trim()),
      recursos: f.recursos.filter((s) => s.trim()),
      fontes: f.fontes.filter((x) => x.nome.trim()),
    };
    const p = props.post ? await m.salvar(props.post.id, limpo) : await m.criar(limpo);
    setSalvando(false);
    if (p) props.onSalvo(p);
  }

  return (
    <Janela titulo={props.post ? `Editar: ${props.post.titulo}` : 'Novo post'} onFechar={props.onFechar}>
      <div className="space-y-4">
        <div className="flex gap-2">
          {(['video', 'arte'] as const).map((t) => (
            <button
              key={t}
              onClick={() => set('tipoCard', t)}
              className={`${btn} ${f.tipoCard === t ? 'border-brand bg-brand/10 text-brand' : ''}`}
            >
              {t === 'video' ? 'Vídeo' : 'Arte / Carrossel'}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <label>
            {rotulo('Número')}
            <input value={f.numero} onChange={(e) => set('numero', e.target.value)} placeholder="ROOT-051" className={`${campo} font-os-mono`} />
          </label>
          <label>
            {rotulo('Título')}
            <input value={f.titulo} onChange={(e) => set('titulo', e.target.value)} className={campo} autoFocus />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            {rotulo('Pilar')}
            <select value={f.pilar} onChange={(e) => set('pilar', e.target.value)} className={campo}>
              <option value="">—</option>
              {(m.painel?.pilares ?? []).map((p) => (
                <option key={p.chave} value={p.chave}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            {rotulo('Formato')}
            <select
              value={f.formato}
              onChange={(e) => {
                const formato = e.target.value;
                // Comunidade Wpp é texto do grupo: usa slides como opções da enquete e não passa por gravação.
                setF((a) => ({ ...a, formato, ...(formato === 'Comunidade Wpp' ? { tipoCard: 'arte' as const, subtipo: a.subtipo || 'News semanal' } : { subtipo: '' }) }));
              }}
              className={campo}
            >
              {MAQUINA_FORMATOS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            {rotulo('Prioridade')}
            <select value={f.prioridade} onChange={(e) => set('prioridade', e.target.value as MaquinaPostSalvarInput['prioridade'])} className={campo}>
              {MAQUINA_PRIORIDADES.map((x) => (
                <option key={x} value={x}>
                  {x === 'media' ? 'média' : x}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          {rotulo('Headline')}
          <input value={f.headline} onChange={(e) => set('headline', e.target.value)} className={campo} />
        </label>
        <label className="block">
          {rotulo('Sub headline')}
          <input value={f.subHeadline} onChange={(e) => set('subHeadline', e.target.value)} className={campo} />
        </label>
        {f.formato === 'Comunidade Wpp' && (
          <>
            <div className="flex flex-wrap gap-2">
              {COMUNIDADE_SUBTIPOS.map((t) => (
                <button key={t} type="button" onClick={() => set('subtipo', t)} className={`${btn} ${f.subtipo === t ? 'border-brand bg-brand/10 text-brand' : ''}`}>
                  {t}
                </button>
              ))}
            </div>
            <label className="block">
              {rotulo(f.subtipo === 'Enquete' ? 'Mensagem antes da enquete' : 'Mensagem do grupo (*negrito*, _itálico_)')}
              {area('roteiro', 12)}
            </label>
            {f.subtipo === 'Enquete' && <p className="text-xs text-muted">A pergunta vai em Sub headline (até 100 caracteres) e as opções em Slides (3 ou 4, até 25 cada).</p>}
          </>
        )}
        {f.tipoCard === 'arte' ? (
          <>
            <div>
              {rotulo('Slides')}
              <div className="space-y-1.5">
                {f.slides.map((s, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="w-6 pt-2 font-os-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
                    <textarea rows={2} value={s} onChange={(e) => set('slides', f.slides.map((x, k) => (k === i ? e.target.value : x)))} className={campo} />
                    <button className="text-dim hover:text-bad" onClick={() => set('slides', f.slides.filter((_, k) => k !== i))} aria-label="Tirar slide">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button className={`${btn} mt-2`} onClick={() => set('slides', [...f.slides, ''])}>
                + slide
              </button>
            </div>
            <label className="block">
              {rotulo('Orientação de design')}
              {area('design', 3)}
            </label>
          </>
        ) : (
          <label className="block">
            {rotulo('Roteiro')}
            {area('roteiro', 8)}
          </label>
        )}
        <label className="block">
          {rotulo('Legenda')}
          {area('legenda', 5)}
        </label>
        <label className="block">
          {rotulo('CTA')}
          {area('cta', 2)}
        </label>
        <label className="block">
          {rotulo('Por que este post')}
          {area('porque', 2)}
        </label>
        <div>
          {rotulo('Fontes')}
          <div className="space-y-1.5">
            {f.fontes.map((x, i) => {
              const muda = (v: Partial<MaquinaFonte>) => set('fontes', f.fontes.map((y, k) => (k === i ? { ...y, ...v } : y)));
              return (
                <div key={i} className="grid gap-1.5 sm:grid-cols-[8rem_1fr_1fr_auto]">
                  <select value={x.tipo} onChange={(e) => muda({ tipo: e.target.value })} className={campo}>
                    {MAQUINA_TIPOS_DE_FONTE.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <input value={x.nome} onChange={(e) => muda({ nome: e.target.value })} placeholder="Nome" className={campo} />
                  <input value={x.link ?? ''} onChange={(e) => muda({ link: e.target.value })} placeholder="Link" className={campo} />
                  <button className="text-dim hover:text-bad" onClick={() => set('fontes', f.fontes.filter((_, k) => k !== i))} aria-label="Tirar fonte">
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
          <button className={`${btn} mt-2`} onClick={() => set('fontes', [...f.fontes, { tipo: 'ideia', nome: '' }])}>
            + fonte
          </button>
        </div>
        <label className="block">
          {rotulo('O que precisa para gravar (um por linha)')}
          <textarea
            rows={3}
            value={f.recursos.join('\n')}
            onChange={(e) => set('recursos', e.target.value.split('\n'))}
            className={campo}
          />
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
        <button className={btn} onClick={props.onFechar}>
          Cancelar
        </button>
        <button className={btnPrimario} disabled={!f.titulo.trim() || salvando} onClick={() => void salvar()}>
          {props.post ? 'Salvar' : props.inicial?.etapa ? 'Criar no calendário' : 'Criar no banco de ideias'}
        </button>
      </div>
    </Janela>
  );
}
