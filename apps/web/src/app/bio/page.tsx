'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AbaPagina } from './AbaPagina';
import { AbaDesafio } from './AbaDesafio';
import { AbaConexoes } from './AbaConexoes';
import { AbaAnalytics } from './AbaAnalytics';
import type { BioPageDetalhe, BioPageResumo, Lista } from './tipos';
import { Botao, Campo, Card, inputCls } from './ui';

const ABAS = ['Página', 'Desafio', 'Conexões', 'Analytics'] as const;
type Aba = (typeof ABAS)[number];

export default function BioPage() {
  const { token, ready, can } = useAuth();
  const params = useSearchParams();
  const editavel = can('bio.editar');
  const admin = can('admin.usuarios');

  const [pages, setPages] = useState<BioPageResumo[] | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<BioPageDetalhe | null>(null);
  const [aba, setAba] = useState<Aba>(params.get('conexao') ? 'Conexões' : 'Página');
  const [erro, setErro] = useState<string | null>(null);
  const [bump, setBump] = useState(0);

  const recarregar = useCallback(() => setBump((b) => b + 1), []);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<Lista<BioPageResumo>>('/bio/pages', token)
      .then((r) => {
        setPages(r.items);
        setPageId((atual) => atual ?? r.items[0]?.id ?? null);
      })
      .catch((e: Error) => setErro(e.message));
  }, [ready, token, bump]);

  useEffect(() => {
    if (!token || !pageId) return;
    apiGet<BioPageDetalhe>(`/bio/pages/${pageId}`, token)
      .then(setDetalhe)
      .catch((e: Error) => setErro(e.message));
  }, [token, pageId, bump]);

  const publicar = (publicada: boolean) =>
    apiPost(`/bio/pages/${pageId}/publish`, { publicada }, token)
      .then(recarregar)
      .catch((e: Error) => setErro(e.message));

  if (pages && pages.length === 0) {
    return <PrimeiraPagina token={token} editavel={editavel} onCriou={recarregar} onErro={setErro} erro={erro} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Link na bio</h1>
          <p className="text-sm text-muted">
            Página pública, contador do desafio e o rastreio de quem clica — os cliques alimentam
            sozinhos a métrica de bio em <a href="/metas" className="text-brand hover:underline">Metas</a>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pages && pages.length > 1 && (
            <select
              className={`${inputCls} w-auto`}
              value={pageId ?? ''}
              onChange={(e) => {
                // Limpa o detalhe junto: sem isso a tela mostra os dados do perfil
                // anterior até a nova busca responder.
                setDetalhe(null);
                setPageId(e.target.value);
              }}
            >
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  @{p.handle}
                </option>
              ))}
            </select>
          )}
          {detalhe && (
            <>
              <a
                href={`/b/${detalhe.page.handle}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted hover:text-text"
              >
                <ExternalLink size={13} /> Ver página
              </a>
              {editavel && (
                <Botao
                  tone={detalhe.page.publicada ? 'default' : 'brand'}
                  onClick={() => publicar(!detalhe.page.publicada)}
                >
                  {detalhe.page.publicada ? 'Despublicar' : 'Publicar'}
                </Botao>
              )}
            </>
          )}
        </div>
      </div>

      {erro && (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          {erro}
        </div>
      )}

      <div className="flex gap-1 border-b border-border">
        {ABAS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAba(a)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              aba === a
                ? 'border-brand text-text'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {!detalhe && <p className="text-sm text-muted">Carregando…</p>}

      {/* key = id da página: trocar de perfil no seletor precisa RECRIAR as abas
          de formulário. Os campos nascem de useState(props), que só lê o valor na
          primeira montagem — sem isto o formulário fica com os dados do perfil
          anterior enquanto a prévia já mostra o novo. */}
      {detalhe && aba === 'Página' && (
        <AbaPagina
          key={detalhe.page.id}
          detalhe={detalhe}
          token={token}
          editavel={editavel}
          onMudou={recarregar}
          onErro={setErro}
        />
      )}
      {detalhe && aba === 'Desafio' && (
        <AbaDesafio
          key={detalhe.page.id}
          detalhe={detalhe}
          token={token}
          editavel={editavel}
          onMudou={recarregar}
          onErro={setErro}
        />
      )}
      {detalhe && aba === 'Conexões' && (
        <AbaConexoes
          token={token}
          editavel={editavel}
          admin={admin}
          aviso={params.get('conexao')}
          onErro={setErro}
        />
      )}
      {detalhe && aba === 'Analytics' && (
        <AbaAnalytics pageId={detalhe.page.id} token={token} onErro={setErro} />
      )}
    </div>
  );
}

/** Estado vazio: a org ainda não tem página de bio nenhuma. */
function PrimeiraPagina({
  token,
  editavel,
  onCriou,
  onErro,
  erro,
}: {
  token: string | null;
  editavel: boolean;
  onCriou: () => void;
  onErro: (m: string) => void;
  erro: string | null;
}) {
  const [handle, setHandle] = useState('');
  const [titulo, setTitulo] = useState('');

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Link na bio</h1>
        <p className="text-sm text-muted">Crie a primeira página para começar.</p>
      </div>
      {erro && (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{erro}</div>
      )}
      <Card>
        <div className="space-y-3">
          <Campo label="Handle" hint={`bio.operacaoroot.com/@${handle || '…'}`}>
            <input
              className={inputCls}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="lucascreator"
            />
          </Campo>
          <Campo label="Título">
            <input
              className={inputCls}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Lucas Creator"
            />
          </Campo>
          <Botao
            tone="brand"
            disabled={!editavel || !handle.trim() || !titulo.trim()}
            onClick={() =>
              apiPost('/bio/pages', { handle: handle.trim().toLowerCase(), titulo: titulo.trim() }, token)
                .then(onCriou)
                .catch((e: Error) => onErro(e.message))
            }
          >
            Criar página
          </Botao>
        </div>
      </Card>
    </div>
  );
}
