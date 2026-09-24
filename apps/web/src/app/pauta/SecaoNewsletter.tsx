'use client';

import { useEffect, useState } from 'react';
import {
  PAUTA_REGRA_ANTI_SLOP_ROTULO,
  PautaUrlDoVideoSchema,
  motivoParaNaoGerarNewsletter,
  type PautaEpisodioDetalhe,
  type PautaNewsletterDoEpisodio,
  type PautaNewsletterPainel,
} from '@mktos/shared';
import { apiGet, apiPost, apiPut, apiTexto } from '@/lib/api';
import { baixarArquivo } from '@/lib/baixar';
import { Botao, Chip, inputCls } from '../referencias/ui';

/*
 * A NEWSLETTER DO EPISÓDIO (MC13), dentro do detalhe da aba Episódios: gerar da
 * transcrição, ver a checagem anti-slop (aprovada ou o que foi apontado) e
 * quanto do texto saiu da fala, e copiar ou baixar em markdown ou HTML. O envio
 * é manual por enquanto: o destino da newsletter é a decisão D-MC7.
 */

interface Props {
  token: string | null;
  detalhe: PautaEpisodioDetalhe;
  editavel: boolean;
  /** Gerar gasta IA: exige `automacoes.executar`, como o roteiro e o pacote. */
  podeGastarIa: boolean;
  onErro: (m: string | null) => void;
}

function baixar(nome: string, conteudo: string, tipo: string) {
  baixarArquivo(nome, new Blob([conteudo], { type: tipo }), 'Este navegador não deixou baixar o arquivo. Use o Copiar.');
}

/**
 * O HTML vai à área de transferência formatado quando o navegador deixa (colar
 * no editor do e-mail já sai com título e links); senão, o código.
 */
/**
 * O HTML vem da API como promessa: o Safari só deixa escrever na área de
 * transferência dentro do clique, e um `await` de rede antes da escrita o faz
 * recusar. O item vai na hora e o navegador espera o HTML chegar.
 */
async function copiar(texto: string, html?: Promise<string>) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Este navegador não deixou copiar. Baixe o arquivo e copie de lá.');
  }
  const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (html && Item && navigator.clipboard.write) {
    await navigator.clipboard.write([
      new Item({
        'text/html': html.then((h) => new Blob([h], { type: 'text/html' })),
        'text/plain': new Blob([texto], { type: 'text/plain' }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(html ? await html : texto);
}

export function SecaoNewsletter({ token, detalhe, editavel, podeGastarIa, onErro }: Props) {
  const [newsletter, setNewsletter] = useState<PautaNewsletterDoEpisodio | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [video, setVideo] = useState('');

  const { id, apelido, status, transcricao } = detalhe;
  const noAr = !!detalhe.paginaDeLinks?.publicada;
  const motivo = motivoParaNaoGerarNewsletter(status, transcricao.length);
  const escrevendo = ocupado !== null;
  const semIa = !podeGastarIa ? 'Gerar gasta IA: precisa da permissão automacoes.executar.' : undefined;

  const aplicar = (n: PautaNewsletterDoEpisodio | null) => {
    setNewsletter(n);
    setVideo(n?.urlDoVideo ?? '');
    setCopiado(null);
  };

  useEffect(() => {
    setConfirmando(false);
    setCarregado(false);
    if (!token) return;
    let vivo = true;
    apiGet<PautaNewsletterPainel>(`/pauta/episodios/${id}/newsletter`, token)
      .then((p) => {
        if (vivo) aplicar(p.newsletter);
      })
      .catch((e: Error) => {
        if (vivo) onErro(`A newsletter não carregou: ${e.message}`);
      })
      .finally(() => {
        if (vivo) setCarregado(true);
      });
    return () => {
      vivo = false;
    };
    // A página indo ao ar troca o marcador no texto: recarrega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, noAr, transcricao.length]);

  const gerar = async (substituir: boolean) => {
    setConfirmando(false);
    onErro(null);
    setOcupado('gerar');
    try {
      const r = await apiPost<PautaNewsletterPainel>(`/pauta/episodios/${id}/newsletter/gerar`, { substituir }, token);
      aplicar(r.newsletter);
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const videoValido = video.trim() === '' || PautaUrlDoVideoSchema.safeParse(video).success;
  const salvarVideo = async () => {
    onErro(null);
    setOcupado('video');
    try {
      const url = video.trim() === '' ? null : video.trim();
      aplicar((await apiPut<PautaNewsletterPainel>(`/pauta/episodios/${id}/newsletter/video`, { urlDoVideo: url }, token)).newsletter);
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const copiarComo = async (formato: 'md' | 'html') => {
    if (!newsletter) return;
    onErro(null);
    const html = formato === 'html' ? apiTexto(`/pauta/episodios/${id}/newsletter.html`, token) : undefined;
    try {
      await copiar(newsletter.markdown, html);
      setCopiado(formato);
    } catch (e) {
      // Falhando a API, a mensagem dela diz mais que a recusa da área de transferência.
      const daApi = html ? await html.then(() => null, (x: unknown) => (x as Error).message) : null;
      onErro(daApi ?? (e as Error).message);
    }
  };

  const baixarComo = async (formato: 'md' | 'html') => {
    onErro(null);
    try {
      const conteudo = await apiTexto(`/pauta/episodios/${id}/newsletter.${formato}`, token);
      baixar(`${apelido}-newsletter.${formato}`, conteudo, formato === 'md' ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8');
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  const n = newsletter;
  const mudouVideo = (n?.urlDoVideo ?? '') !== video.trim();

  return (
    <section className="space-y-3" aria-label="Newsletter">
      <h3 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Newsletter</h3>

      <p className="text-xs text-muted" aria-label="Envio manual">
        O envio é manual por enquanto: copie o texto e cole na ferramenta de e-mail. O destino automático ainda está em
        decisão (D-MC7).
      </p>

      {!n && carregado && (
        <p className="text-sm text-muted">
          {motivo ?? 'Sai do que foi dito no vídeo: uma seção por matéria com o link, e o fechamento chamando para a página de links e para o vídeo.'}
        </p>
      )}

      {!motivo && (
        <div className="flex flex-wrap items-center gap-2">
          {!confirmando && (
            <Botao
              tone={n ? 'default' : 'brand'}
              onClick={() => (n ? setConfirmando(true) : gerar(false))}
              disabled={!editavel || !podeGastarIa || escrevendo || !carregado}
              title={semIa}
            >
              {ocupado === 'gerar' ? 'Gerando…' : n ? 'Gerar de novo' : 'Gerar newsletter'}
            </Botao>
          )}
          {confirmando && (
            <>
              <span className="text-sm">Substituir a newsletter? A atual fica como descartada.</span>
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

      {n && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" aria-label="Checagem anti-slop">
            <Chip tone={n.checagem.aprovada ? 'good' : 'warn'}>
              {n.checagem.aprovada
                ? 'Checagem anti-slop aprovada'
                : `Checagem anti-slop: ${n.checagem.apontamentos.length} apontamento(s)`}
            </Chip>
            <span className="text-xs text-muted">
              {n.frases.ditas} de {n.frases.total} frases vêm da fala do vídeo · {n.secoes} seção(ões) · {n.links} link(s)
              {n.tentativas > 1 ? ' · refeita uma vez pela checagem' : ''}
            </span>
          </div>

          {n.checagem.apontamentos.length > 0 && (
            <ul className="space-y-1 text-xs" aria-label="Apontamentos da checagem">
              {n.checagem.apontamentos.map((a, i) => (
                <li key={`${a.regra}-${i}`} className="break-words text-warn">
                  {PAUTA_REGRA_ANTI_SLOP_ROTULO[a.regra]}: “{a.trecho}” — {a.onde}
                </li>
              ))}
            </ul>
          )}

          {n.transcricaoMudou && (
            <p className="text-xs text-warn">A transcrição mudou depois desta newsletter (mídia refeita): gere de novo.</p>
          )}
          {[...n.avisos, ...n.pendentes].length > 0 && (
            <ul className="space-y-1 text-xs text-muted" aria-label="Avisos da newsletter">
              {[...n.avisos, ...n.pendentes].map((a) => (
                <li key={a} className="break-words">
                  {a}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Botao tone="brand" onClick={() => copiarComo('md')}>
              {copiado === 'md' ? 'Markdown copiado' : 'Copiar markdown'}
            </Botao>
            <Botao onClick={() => copiarComo('html')}>{copiado === 'html' ? 'HTML copiado' : 'Copiar HTML'}</Botao>
            <Botao tone="ghost" onClick={() => baixarComo('md')}>
              Baixar .md
            </Botao>
            <Botao tone="ghost" onClick={() => baixarComo('html')}>
              Baixar .html
            </Botao>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="min-w-0 flex-1 basis-full text-sm sm:basis-auto">
              <span className="mb-1 block text-xs text-muted">Link do vídeo no YouTube (depois de subir)</span>
              <input
                className={inputCls}
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={video}
                onChange={(ev) => setVideo(ev.target.value)}
                disabled={!editavel || escrevendo}
                aria-invalid={!videoValido}
              />
            </label>
            <Botao onClick={salvarVideo} disabled={!editavel || escrevendo || !videoValido || !mudouVideo}>
              {ocupado === 'video' ? 'Salvando…' : 'Salvar link'}
            </Botao>
            {!videoValido && <span className="text-xs text-bad">O link começa com https:// e não tem espaço.</span>}
          </div>

          <pre
            className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 p-3 font-sans text-sm"
            aria-label="Texto da newsletter"
          >
            {n.markdown}
          </pre>
          <p className="text-xs text-muted">
            A newsletter também aparece como peça da rodada (canal newsletter), onde dá para editar o texto; a checagem
            acima confere o texto de agora.
          </p>
        </div>
      )}
    </section>
  );
}
