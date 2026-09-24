'use client';

import { useEffect, useState } from 'react';
import {
  PAUTA_MARCADOR_DA_PAGINA_DE_LINKS,
  PAUTA_TETO_DA_DESCRICAO_DO_YOUTUBE,
  PAUTA_TETO_DO_TITULO_DO_YOUTUBE,
  capitulosDaDescricao,
  conferirCapitulos,
  midiaDoEpisodio,
  motivoParaNaoGerarPacote,
  motivoParaNaoMexerNoPacote,
  tempoDoVideo,
  type PautaEpisodioDetalhe,
  type PautaPacoteGerado,
  type PautaThumbDoPacote,
} from '@mktos/shared';
import { apiBlob, apiPost, apiPut } from '@/lib/api';
import { Botao, Chip } from '../referencias/ui';

/*
 * O PACOTE DO YOUTUBE (MC11), dentro do detalhe da aba Episódios: gerar da
 * transcrição, escolher o título, copiar a descrição e ver as thumbs que o Mac
 * renderizou. Subir no YouTube é manual na V1 (D-MC6).
 */

interface Props {
  token: string | null;
  detalhe: PautaEpisodioDetalhe;
  editavel: boolean;
  /** Gerar gasta IA: exige `automacoes.executar`, como o roteiro. */
  podeGastarIa: boolean;
  onErro: (m: string | null) => void;
  /** O episódio que a escrita devolveu. */
  onDetalhe: (d: PautaEpisodioDetalhe) => void;
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

async function copiar(texto: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('Este navegador não deixou copiar. Selecione o texto e copie à mão.');
  }
  await navigator.clipboard.writeText(texto);
}

function TextoDaThumb({ t }: { t: PautaThumbDoPacote }) {
  let feito = false;
  const alvo = t.destaque.toLowerCase();
  return (
    <>
      {t.texto.split(' ').map((p, i) => {
        const destaca = !feito && alvo !== '' && p.toLowerCase() === alvo;
        if (destaca) feito = true;
        return (
          <span key={i} className={destaca ? 'text-bad' : undefined}>
            {i > 0 ? ' ' : ''}
            {p}
          </span>
        );
      })}
    </>
  );
}

export function SecaoPacote({ token, detalhe, editavel, podeGastarIa, onErro, onDetalhe }: Props) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [retorno, setRetorno] = useState<{ avisos: string[]; correcoes: string[] } | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [imagens, setImagens] = useState<Record<number, string>>({});

  const { id, apelido, status, titulos, descricao, thumbs, transcricao } = detalhe;
  const motivo = motivoParaNaoGerarPacote(status, transcricao.length);
  const travado = motivoParaNaoMexerNoPacote(status);
  const temPacote = titulos.length > 0 || descricao.trim() !== '' || thumbs.length > 0;
  const escrevendo = ocupado !== null;
  const semIa = !podeGastarIa ? 'Gerar gasta IA: precisa da permissão automacoes.executar.' : undefined;

  useEffect(() => {
    setRetorno(null);
    setConfirmando(false);
    setCopiado(null);
  }, [id]);

  // A prévia só existe para a thumb que o Mac já subiu; muda quando sobe outra.
  const chaveDasImagens = thumbs.map((t) => `${t.n}:${t.imagem?.enviadaEm ?? ''}`).join('|');
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    const urls: string[] = [];
    const comImagem = thumbs.filter((t) => t.imagem);
    setImagens({});
    Promise.all(
      comImagem.map(async (t) => {
        const blob = await apiBlob(`/pauta/episodios/${id}/thumbs/${t.n}/imagem`, token);
        if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return [t.n, url] as const;
      }),
    )
      .then((pares) => {
        if (vivo) setImagens(Object.fromEntries(pares.filter((p): p is readonly [number, string] => p !== null)));
      })
      .catch((e: Error) => {
        if (vivo) onErro(`A prévia das thumbs não carregou: ${e.message}`);
      });
    return () => {
      vivo = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, chaveDasImagens, onErro]);

  const gerar = async (substituir: boolean) => {
    setConfirmando(false);
    onErro(null);
    setRetorno(null);
    setOcupado('gerar');
    try {
      const r = await apiPost<PautaPacoteGerado>(`/pauta/episodios/${id}/pacote/gerar`, { substituir }, token);
      setRetorno({ avisos: r.avisos, correcoes: r.correcoes });
      onDetalhe(r.episodio);
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const escolher = async (n: number | null) => {
    onErro(null);
    setOcupado(`titulo-${n}`);
    try {
      onDetalhe(await apiPut<PautaEpisodioDetalhe>(`/pauta/episodios/${id}/pacote/titulo`, { n }, token));
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const copiarTexto = async (nome: string, texto: string) => {
    onErro(null);
    try {
      await copiar(texto);
      setCopiado(nome);
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  const capitulos = capitulosDaDescricao(descricao);
  const duracao = midiaDoEpisodio(detalhe.midia)?.duracaoSeg ?? transcricao[transcricao.length - 1]?.fim ?? null;
  const errosDosCapitulos = capitulos.length ? conferirCapitulos(capitulos, duracao) : [];
  const tamanho = bytes(descricao);
  const comMarcador = descricao.includes(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS);

  return (
    <section className="space-y-3" aria-label="Pacote do YouTube">
      <h3 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Pacote do YouTube</h3>

      {motivo && (!temPacote || travado) && <p className="text-sm text-muted">{motivo}</p>}

      {!motivo && (
        <div className="flex flex-wrap items-center gap-2">
          {!confirmando && (
            <Botao
              tone={temPacote ? 'default' : 'brand'}
              onClick={() => (temPacote ? setConfirmando(true) : gerar(false))}
              disabled={!editavel || !podeGastarIa || escrevendo}
              title={semIa}
            >
              {ocupado === 'gerar' ? 'Gerando…' : temPacote ? 'Gerar de novo' : 'Gerar pacote'}
            </Botao>
          )}
          {confirmando && (
            <>
              <span className="text-sm">Substituir títulos, descrição e thumbs? As imagens enviadas saem junto.</span>
              <Botao tone="bad" onClick={() => gerar(true)} disabled={escrevendo}>
                Substituir
              </Botao>
              <Botao tone="ghost" onClick={() => setConfirmando(false)}>
                Cancelar
              </Botao>
            </>
          )}
          {semIa && <span className="text-xs text-muted">{semIa}</span>}
        </div>
      )}

      {retorno && (retorno.avisos.length > 0 || retorno.correcoes.length > 0) && (
        <ul className="space-y-1 text-xs" aria-label="O que o sistema ajustou">
          {retorno.avisos.map((a) => (
            <li key={a} className="text-warn">
              {a}
            </li>
          ))}
          {retorno.correcoes.map((c) => (
            <li key={c} className="text-muted">
              {c}
            </li>
          ))}
        </ul>
      )}

      {titulos.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Título (marque o que vai ao ar)</legend>
          {titulos.map((t, i) => (
            <div key={`${i}-${t.texto}`} className="flex flex-wrap items-start gap-2 rounded-lg border border-border p-2">
              <label className="flex min-w-0 flex-1 basis-full items-start gap-2 text-sm sm:basis-auto">
                <input
                  type="radio"
                  name={`titulo-${id}`}
                  className="mt-1"
                  checked={t.escolhido}
                  onChange={() => escolher(i + 1)}
                  disabled={!editavel || escrevendo || travado !== null}
                />
                <span className="min-w-0 break-words">{t.texto}</span>
              </label>
              {t.angulo && <Chip>{t.angulo}</Chip>}
              <span className="text-[11px] text-muted">
                {t.texto.length}/{PAUTA_TETO_DO_TITULO_DO_YOUTUBE}
              </span>
              <Botao tone="ghost" onClick={() => copiarTexto(`titulo-${i + 1}`, t.texto)}>
                {copiado === `titulo-${i + 1}` ? 'Copiado' : 'Copiar'}
              </Botao>
            </div>
          ))}
          {titulos.some((t) => t.escolhido) && !travado && (
            <Botao tone="ghost" onClick={() => escolher(null)} disabled={!editavel || escrevendo}>
              Desmarcar
            </Botao>
          )}
        </fieldset>
      )}

      {descricao.trim() !== '' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Descrição</span>
            <span className={`text-[11px] ${tamanho > PAUTA_TETO_DA_DESCRICAO_DO_YOUTUBE ? 'text-bad' : 'text-muted'}`}>
              {tamanho}/{PAUTA_TETO_DA_DESCRICAO_DO_YOUTUBE} bytes
            </span>
            <Botao onClick={() => copiarTexto('descricao', descricao)}>
              {copiado === 'descricao' ? 'Descrição copiada' : 'Copiar descrição'}
            </Botao>
          </div>
          <pre
            className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 p-3 font-sans text-sm"
            aria-label="Descrição do vídeo"
          >
            {descricao}
          </pre>
          <p className={`text-xs ${capitulos.length && !errosDosCapitulos.length ? 'text-good' : 'text-warn'}`} aria-label="Capítulos">
            {capitulos.length === 0
              ? 'Sem capítulos na descrição.'
              : errosDosCapitulos.length
                ? `Capítulos fora da regra do YouTube: ${errosDosCapitulos.join(' ')}`
                : `${capitulos.length} capítulos dentro da regra do YouTube (00:00, 10 s ou mais cada).`}
          </p>
          {comMarcador && (
            <p className="text-xs text-muted">
              O marcador <code>{PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}</code> vira o endereço da página de links do episódio
              quando ela estiver no ar (seção Página de links); até lá, troque à mão ao colar no YouTube.
            </p>
          )}
        </div>
      )}

      {thumbs.length > 0 && (
        <div className="space-y-2">
          <span className="text-sm font-medium">Thumbs</span>
          <ul className="grid gap-3 sm:grid-cols-3" aria-label="Thumbs do episódio">
            {thumbs.map((t) => (
              <li key={t.n} className="space-y-1">
                {imagens[t.n] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imagens[t.n]} alt={`Thumb ${t.n}: ${t.texto}`} className="aspect-video w-full rounded-lg border border-border object-cover" />
                ) : (
                  <div className="flex aspect-video w-full items-center rounded-lg border border-dashed border-border bg-surface-2 p-3 font-mono text-base font-bold leading-tight text-brand">
                    <span className="break-words">
                      <TextoDaThumb t={t} />
                    </span>
                  </div>
                )}
                <p className="text-xs text-muted">
                  {t.n}. frame em {tempoDoVideo(t.tempoSeg)} · destaque “{t.destaque}”
                  {t.imagem ? ` · ${t.imagem.largura}×${t.imagem.altura}` : ' · falta renderizar'}
                </p>
              </li>
            ))}
          </ul>
          {thumbs.some((t) => !t.imagem) && !travado && (
            <p className="text-xs text-muted">
              Renderize no Mac: <code className="break-all">/root-midia thumbs {apelido}</code> — tira o frame do vídeo
              final, aplica o template da marca e sobe o PNG.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
