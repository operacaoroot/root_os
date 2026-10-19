'use client';

import { useEffect, useState } from 'react';
import type { MaquinaPost, MaquinaPostSalvarInput } from '@mktos/shared';
import { EditorDePost, PostAberto, btnPrimario, useLevar } from './pecas';
import { useMaquina, type Maquina } from './useMaquina';

export interface Contexto {
  m: Maquina;
  painel: NonNullable<Maquina['painel']>;
  abrir: (id: string) => void;
  novo: (inicial?: Partial<MaquinaPostSalvarInput>) => void;
  levar: ReturnType<typeof useLevar>['levar'];
}

/*
 * A moldura das telas da Máquina: título, botão "Novo post", erro, e as janelas
 * do post aberto e do editor. O post aberto mora na URL (?post=<id>) para o link
 * poder ser mandado a alguém e o voltar do navegador fechar a janela.
 */
export function MaquinaPagina(props: {
  titulo: string;
  nota?: string;
  acoes?: React.ReactNode;
  /** A home não mostra o cabeçalho padrão. */
  semCabecalho?: boolean;
  children: (ctx: Contexto) => React.ReactNode;
}) {
  const m = useMaquina();
  const { levar, janela } = useLevar(m);
  const [aberto, setAberto] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ post?: MaquinaPost; inicial?: Partial<MaquinaPostSalvarInput> } | null>(null);

  useEffect(() => {
    const ler = () => setAberto(new URLSearchParams(window.location.search).get('post'));
    ler();
    window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, []);

  const abrir = (id: string | null) => {
    const q = new URLSearchParams(window.location.search);
    if (id) q.set('post', id);
    else q.delete('post');
    const s = q.toString();
    window.history.pushState(null, '', `${window.location.pathname}${s ? `?${s}` : ''}`);
    setAberto(id);
  };

  if (!m.pronto) return <p className="text-muted">Carregando…</p>;
  if (!m.podeVer) return <p className="text-muted">Acesso insuficiente para Marketing.</p>;

  const post = aberto ? m.painel?.posts.find((p) => p.id === aberto) : undefined;

  return (
    <div className="com-tema space-y-5">
      {!props.semCabecalho && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{props.titulo}</h1>
            {props.nota && <p className="mt-1 text-sm text-muted">{props.nota}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {props.acoes}
            {m.editavel && (
              <button className={btnPrimario} onClick={() => setEditando({})}>
                + Novo post
              </button>
            )}
          </div>
        </div>
      )}
      {m.erro && (
        <p role="alert" className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {m.erro}
        </p>
      )}
      {!m.painel && !m.erro && <p className="text-muted">Carregando…</p>}
      {m.painel && props.children({ m, painel: m.painel, abrir, novo: (inicial) => setEditando({ inicial }), levar })}

      {post && !editando && <PostAberto m={m} post={post} onFechar={() => abrir(null)} onEditar={() => setEditando({ post })} />}
      {editando && (
        <EditorDePost
          m={m}
          post={editando.post}
          inicial={editando.inicial}
          onFechar={() => setEditando(null)}
          onSalvo={(p) => {
            setEditando(null);
            abrir(p.id);
          }}
        />
      )}
      {janela}
    </div>
  );
}
