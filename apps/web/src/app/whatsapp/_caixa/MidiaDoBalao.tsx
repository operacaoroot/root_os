'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { rotaDaMidiaDaMensagem, rotuloDoTipoDeMensagem, type MensagemDaCaixa } from '@mktos/shared';

import { apiBlob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { duracaoLegivel, tamanhoLegivel } from '@/lib/caixa-whatsapp';

import { FOCO } from '../../comercial/_ui';

/*
 * Layout 27/10 (Lucas: "não consigo nem abrir, nem enviar documentos pelo wpp do OS").
 * O ARQUIVO DENTRO DO BALÃO. Antes era um cartão "mídia não baixada"; agora:
 *
 *   · foto e figurinha: a miniatura no balão (clicar abre grande, com "Baixar");
 *   · áudio: o tocador;
 *   · vídeo: "Assistir" carrega e toca;
 *   · documento: ícone, nome, tamanho, "Abrir" (PDF, em outra aba) e "Baixar".
 *
 * O arquivo vem de `GET /whatsapp/mensagens/:id/midia` com o token no cabeçalho
 * (por isso blob, e não `src` direto). Foto, figurinha e áudio carregam quando
 * aparecem na tela; vídeo e documento, só no clique. A API busca na Evolution na
 * primeira vez e guarda no storage do OS.
 */

type Estado = { fase: 'parado' } | { fase: 'carregando' } | { fase: 'pronto'; url: string; tipo: string } | { fase: 'erro'; frase: string };

function fraseDoErro(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Não deu para abrir o arquivo. Tente de novo.';
}

/** O blob do arquivo da mensagem, sob pedido, com a URL solta ao sair. */
function useArquivo(mensagemId: string) {
  const { token } = useAuth();
  const [estado, setEstado] = useState<Estado>({ fase: 'parado' });
  const pronto = useRef<{ url: string; tipo: string } | null>(null);
  const pedido = useRef<Promise<{ url: string; tipo: string } | null> | null>(null);

  useEffect(
    () => () => {
      if (pronto.current) URL.revokeObjectURL(pronto.current.url);
    },
    [],
  );

  const carregar = useCallback((): Promise<{ url: string; tipo: string } | null> => {
    if (pronto.current) return Promise.resolve(pronto.current);
    if (pedido.current) return pedido.current;
    setEstado({ fase: 'carregando' });
    pedido.current = apiBlob(rotaDaMidiaDaMensagem(mensagemId), token)
      .then((blob) => {
        const r = { url: URL.createObjectURL(blob), tipo: blob.type };
        pronto.current = r;
        setEstado({ fase: 'pronto', ...r });
        return r;
      })
      .catch((e: unknown) => {
        setEstado({ fase: 'erro', frase: fraseDoErro(e) });
        return null;
      })
      .finally(() => {
        pedido.current = null;
      });
    return pedido.current;
  }, [mensagemId, token]);

  return { estado, carregar };
}

/** Chama `aoAparecer` uma vez, quando o elemento entra na tela (sem IntersectionObserver, na hora). */
function useAoAparecer<T extends Element>(aoAparecer: () => void) {
  const ref = useRef<T | null>(null);
  const chamado = useRef(false);
  const fn = useRef(aoAparecer);
  fn.current = aoAparecer;
  useEffect(() => {
    const el = ref.current;
    if (!el || chamado.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      chamado.current = true;
      fn.current();
      return;
    }
    const io = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting) && !chamado.current) {
          chamado.current = true;
          io.disconnect();
          fn.current();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

function baixar(url: string, nome: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** O nome com que o arquivo é baixado. */
function nomeParaBaixar(m: MensagemDaCaixa): string {
  if (m.midia?.nome) return m.midia.nome;
  const ext = m.midia?.mime?.split('/')[1]?.split(/[;+]/)[0] ?? 'bin';
  return `${rotuloDoTipoDeMensagem(m.tipo)}.${ext === 'jpeg' ? 'jpg' : ext}`;
}

const LINK = `rounded-sm text-[12px] font-semibold underline underline-offset-2 hover:opacity-80 disabled:opacity-50 ${FOCO}`;

function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return <span className="wz-meta block text-[12px]">{texto}</span>;
}

function Falha({ frase, deNovo }: { frase: string; deNovo: () => void }) {
  return (
    <span role="alert" className="block text-[12px] text-bad">
      {frase}{' '}
      <button type="button" onClick={deNovo} className={LINK}>
        Tentar de novo
      </button>
    </span>
  );
}

/** A foto grande, numa camada clara por cima da caixa. Esc ou clique fora fecha. */
function FotoGrande({ url, nome, aoFechar }: { url: string; nome: string; aoFechar: () => void }) {
  const fechar = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    fechar.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aoFechar]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={nome}
      data-testid="caixa-foto-grande"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-white/90 p-4 backdrop-blur-sm dark:bg-black/80"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <img src={url} alt={nome} className="max-h-[80vh] max-w-full rounded object-contain shadow-lg" />
      <div className="flex gap-2">
        <button type="button" onClick={() => baixar(url, nome)} className={`rounded border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text hover:border-brand ${FOCO}`}>
          Baixar
        </button>
        <button ref={fechar} type="button" onClick={aoFechar} className={`rounded border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text hover:border-brand ${FOCO}`}>
          Fechar
        </button>
      </div>
    </div>
  );
}

function Foto({ m }: { m: MensagemDaCaixa }) {
  const { estado, carregar } = useArquivo(m.id);
  const ref = useAoAparecer<HTMLSpanElement>(() => void carregar());
  const [grande, setGrande] = useState(false);
  const figurinha = m.tipo === 'sticker';
  const nome = nomeParaBaixar(m);
  return (
    <span ref={ref} data-testid={`caixa-midia-${m.id}`} data-tipo={m.tipo} className="block">
      {estado.fase === 'pronto' ? (
        <button type="button" onClick={() => setGrande(true)} aria-label={`Abrir ${figurinha ? 'figurinha' : 'foto'} grande`} className={`block overflow-hidden rounded ${FOCO}`}>
          <img
            src={estado.url}
            alt={figurinha ? 'figurinha' : m.texto?.trim() || 'foto'}
            className={figurinha ? 'h-28 w-28 object-contain' : 'max-h-72 w-auto max-w-full object-cover'}
          />
        </button>
      ) : estado.fase === 'erro' ? (
        <Falha frase={estado.frase} deNovo={() => void carregar()} />
      ) : (
        <span className={`wz-citacao flex items-center justify-center rounded ${figurinha ? 'h-28 w-28' : 'h-40 w-56 max-w-full'}`}>
          <Carregando texto={figurinha ? 'figurinha…' : 'Carregando a foto…'} />
        </span>
      )}
      {grande && estado.fase === 'pronto' && <FotoGrande url={estado.url} nome={nome} aoFechar={() => setGrande(false)} />}
    </span>
  );
}

function Audio({ m }: { m: MensagemDaCaixa }) {
  const { estado, carregar } = useArquivo(m.id);
  const ref = useAoAparecer<HTMLSpanElement>(() => void carregar());
  return (
    <span ref={ref} data-testid={`caixa-midia-${m.id}`} data-tipo={m.tipo} className="block min-w-[14rem]">
      {estado.fase === 'pronto' ? (
        <audio controls preload="metadata" src={estado.url} className="h-10 w-full max-w-[18rem]">
          áudio
        </audio>
      ) : estado.fase === 'erro' ? (
        <Falha frase={estado.frase} deNovo={() => void carregar()} />
      ) : (
        <Carregando texto={`Carregando o áudio${m.midia?.segundos != null ? ` · ${duracaoLegivel(m.midia.segundos)}` : ''}…`} />
      )}
    </span>
  );
}

function Video({ m }: { m: MensagemDaCaixa }) {
  const { estado, carregar } = useArquivo(m.id);
  const detalhes = [duracaoLegivel(m.midia?.segundos), tamanhoLegivel(m.midia?.tamanho)].filter(Boolean).join(' · ');
  return (
    <span data-testid={`caixa-midia-${m.id}`} data-tipo={m.tipo} className="block">
      {estado.fase === 'pronto' ? (
        <video controls autoPlay src={estado.url} className="max-h-72 w-full max-w-full rounded bg-black" />
      ) : (
        <span className="wz-citacao flex flex-col items-start gap-1 rounded px-2.5 py-2">
          <span className="text-[12.5px]">vídeo{detalhes ? ` · ${detalhes}` : ''}</span>
          {estado.fase === 'erro' ? (
            <Falha frase={estado.frase} deNovo={() => void carregar()} />
          ) : (
            <button type="button" data-testid={`caixa-midia-assistir-${m.id}`} onClick={() => void carregar()} disabled={estado.fase === 'carregando'} className={LINK}>
              {estado.fase === 'carregando' ? 'Carregando…' : 'Assistir'}
            </button>
          )}
        </span>
      )}
    </span>
  );
}

function IconeDeDocumento({ mime }: { mime: string | null | undefined }) {
  const ext = (mime === 'application/pdf' ? 'PDF' : mime?.split('/')[1]?.split(/[.+-]/).pop()?.slice(0, 4) ?? 'ARQ').toUpperCase();
  return (
    <span aria-hidden className="flex h-10 w-8 shrink-0 flex-col items-center justify-end rounded-sm bg-white/80 pb-1 font-os-mono text-[8.5px] font-semibold text-[#c4532d] shadow-sm ring-1 ring-black/10 dark:bg-white/10">
      {ext}
    </span>
  );
}

function Documento({ m }: { m: MensagemDaCaixa }) {
  const { estado, carregar } = useArquivo(m.id);
  const nome = nomeParaBaixar(m);
  const pdf = m.midia?.mime === 'application/pdf' || /\.pdf$/i.test(m.midia?.nome ?? '');
  const detalhes = [tamanhoLegivel(m.midia?.tamanho), pdf ? 'PDF' : m.midia?.mime?.split('/')[1]].filter(Boolean).join(' · ');

  async function abrir() {
    // A aba abre JÁ no clique (senão o bloqueador de pop-up a segura) e recebe o arquivo quando ele chega.
    const aba = window.open('', '_blank');
    const r = await carregar();
    if (!r) {
      aba?.close();
      return;
    }
    if (aba) aba.location.href = r.url;
    else window.location.assign(r.url);
  }

  async function baixarDocumento() {
    const r = await carregar();
    if (r) baixar(r.url, nome);
  }

  return (
    <span data-testid={`caixa-midia-${m.id}`} data-tipo={m.tipo} className="wz-citacao flex min-w-[14rem] items-center gap-2.5 rounded px-2.5 py-2">
      <IconeDeDocumento mime={m.midia?.mime} />
      <span className="min-w-0 flex-1">
        <span data-testid={`caixa-midia-nome-${m.id}`} className="block truncate text-[13px] font-medium" title={nome}>
          {nome}
        </span>
        {detalhes && <span className="wz-meta block text-[11px]">{detalhes}</span>}
        {estado.fase === 'erro' ? (
          <Falha frase={estado.frase} deNovo={() => void carregar()} />
        ) : (
          <span className="mt-0.5 flex gap-3">
            {pdf && (
              <button type="button" data-testid={`caixa-midia-abrir-${m.id}`} onClick={() => void abrir()} disabled={estado.fase === 'carregando'} className={LINK}>
                Abrir
              </button>
            )}
            <button type="button" data-testid={`caixa-midia-baixar-${m.id}`} onClick={() => void baixarDocumento()} disabled={estado.fase === 'carregando'} className={LINK}>
              {estado.fase === 'carregando' ? 'Carregando…' : 'Baixar'}
            </button>
          </span>
        )}
      </span>
    </span>
  );
}

/** O arquivo de uma mensagem de mídia, do jeito do tipo dela. */
export function MidiaDoBalao({ m }: { m: MensagemDaCaixa }) {
  if (m.tipo === 'image' || m.tipo === 'sticker') return <Foto m={m} />;
  if (m.tipo === 'audio') return <Audio m={m} />;
  if (m.tipo === 'video') return <Video m={m} />;
  return <Documento m={m} />;
}
