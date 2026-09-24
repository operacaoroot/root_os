'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  PAUTA_CHAVES_DOS_LINKS_DA_CASA,
  type PautaEpisodioDetalhe,
  type PautaOrigemDoLinkDaPagina,
  type PautaPaginaDeLinksMontada,
} from '@mktos/shared';
import { apiPost } from '@/lib/api';
import { useModulos } from '@/components/modulos';
import { Botao, Chip } from '../referencias/ui';

/*
 * A PÁGINA DE LINKS DO EPISÓDIO (MC12), dentro do detalhe da aba Episódios:
 * montar a página com as matérias que têm link público (a newsletter fica de
 * fora) e os links da casa, e pôr no ar — pelo mesmo caminho do /bio. No ar, o
 * endereço entra na descrição do YouTube no lugar do marcador. A página mora na
 * bio: sem o módulo bio contratado a seção não aparece (a API recusa igual).
 */

interface Props {
  token: string | null;
  detalhe: PautaEpisodioDetalhe;
  /** `pauta.editar`: montar a página em rascunho. */
  editavel: boolean;
  /** `bio.editar`: mexer numa página que já está no ar, como no /bio. */
  podeMexerNoAr: boolean;
  /** `pauta.publicar` + `bio.editar`: pôr no ar ou tirar. */
  podePublicar: boolean;
  onErro: (m: string | null) => void;
  onDetalhe: (d: PautaEpisodioDetalhe) => void;
}

const ORIGEM: Record<PautaOrigemDoLinkDaPagina, string> = { item: 'matéria', casa: 'da casa', painel: 'do /bio' };

export function SecaoPaginaDeLinks({ token, detalhe, editavel, podeMexerNoAr, podePublicar, onErro, onDetalhe }: Props) {
  const { ligado } = useModulos();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [retorno, setRetorno] = useState<Omit<PautaPaginaDeLinksMontada, 'episodio'> | null>(null);

  const { id, paginaDeLinks: pagina } = detalhe;
  const escrevendo = ocupado !== null;
  const noAr = !!pagina?.publicada;
  const bloqueioDeMontar = !editavel
    ? 'Montar a página pede pauta.editar.'
    : noAr && !podeMexerNoAr
      ? 'A página já está no ar: mudar os botões pede bio.editar, como no /bio.'
      : undefined;
  const ativos = pagina?.links.filter((l) => l.ativo) ?? [];

  useEffect(() => setRetorno(null), [id]);

  const montar = async () => {
    onErro(null);
    setRetorno(null);
    setOcupado('montar');
    try {
      const { episodio, ...conta } = await apiPost<PautaPaginaDeLinksMontada>(`/pauta/episodios/${id}/pagina-de-links`, {}, token);
      setRetorno(conta);
      onDetalhe(episodio);
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const publicar = async (publicada: boolean) => {
    onErro(null);
    setOcupado(publicada ? 'publicar' : 'despublicar');
    try {
      onDetalhe(await apiPost<PautaEpisodioDetalhe>(`/pauta/episodios/${id}/pagina-de-links/publicar`, { publicada }, token));
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  if (!ligado('bio')) return null;

  return (
    <section className="space-y-3" aria-label="Página de links">
      <h3 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Página de links</h3>

      {!pagina && (
        <p className="text-sm text-muted">
          Um botão por matéria com link público (a newsletter fica de fora) e os links da casa, na bio. No ar, o endereço
          entra na descrição do YouTube.
        </p>
      )}

      {pagina && (
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={noAr ? 'good' : 'warn'}>{noAr ? 'No ar' : 'Rascunho'}</Chip>
          {noAr ? (
            <a
              href={pagina.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1 break-all text-sm text-brand hover:underline"
            >
              {pagina.url}
              <ExternalLink size={12} aria-hidden />
            </a>
          ) : (
            <span className="min-w-0 break-all font-mono text-sm text-muted">{pagina.url}</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Botao tone={pagina ? 'default' : 'brand'} onClick={montar} disabled={!!bloqueioDeMontar || escrevendo} title={bloqueioDeMontar}>
          {ocupado === 'montar' ? 'Montando…' : pagina ? 'Montar de novo' : 'Criar página de links'}
        </Botao>
        {pagina && !noAr && (
          <Botao
            tone="brand"
            onClick={() => publicar(true)}
            disabled={!podePublicar || escrevendo || ativos.length === 0}
            title={!podePublicar ? 'Publicar pede pauta.publicar e bio.editar.' : undefined}
          >
            {ocupado === 'publicar' ? 'Publicando…' : 'Publicar'}
          </Botao>
        )}
        {pagina && noAr && (
          <Botao tone="ghost" onClick={() => publicar(false)} disabled={!podePublicar || escrevendo}>
            {ocupado === 'despublicar' ? 'Tirando…' : 'Tirar do ar'}
          </Botao>
        )}
        {bloqueioDeMontar && <span className="text-xs text-muted">{bloqueioDeMontar}</span>}
        {pagina && !podePublicar && <span className="text-xs text-muted">Publicar pede pauta.publicar e bio.editar.</span>}
      </div>

      {retorno && (
        <div className="space-y-1 text-xs" aria-label="O que a montagem fez">
          <p className="text-muted">
            {retorno.criados} botão(ões) novo(s), {retorno.atualizados} atualizado(s), {retorno.desativados} tirado(s) da página.
          </p>
          {retorno.avisos.map((a) => (
            <p key={a} className="text-warn">
              {a}
            </p>
          ))}
        </div>
      )}

      {pagina && (
        <ul className="space-y-1.5" aria-label="Botões da página">
          {pagina.links.map((l) => (
            <li key={l.id} className={`flex flex-wrap items-center gap-2 text-sm ${l.ativo ? '' : 'text-muted line-through'}`}>
              <Chip tone={l.origem === 'casa' ? 'brand' : 'muted'}>{ORIGEM[l.origem]}</Chip>
              <span className="min-w-0 flex-1 basis-full break-words sm:basis-auto">{l.rotulo}</span>
              <span className="min-w-0 basis-full break-all text-[11px] text-muted sm:basis-auto">{l.destino}</span>
            </li>
          ))}
        </ul>
      )}

      {pagina && !noAr && (
        <p className="text-xs text-muted">
          A descrição do YouTube só troca o marcador pelo endereço quando a página estiver no ar.
        </p>
      )}
      <p className="text-xs text-muted">
        Links da casa: nota da memória <code>{PAUTA_CHAVES_DOS_LINKS_DA_CASA[0]}</code>, um por linha (
        <code>Rótulo | https://…</code>), criada pela API da memória — receita em <code>docs/PAUTA.md</code>.
      </p>
    </section>
  );
}
