'use client';

import {
  PAUTA_STATUS_PENDENTES_DE_MIDIA,
  midiaDoEpisodio,
  tempoDoVideo,
  type PautaEpisodioDetalhe,
  type PautaMotivoDeCorte,
} from '@mktos/shared';

/*
 * A MÍDIA DO EPISÓDIO (MC9), dentro do detalhe da aba Episódios. Só leitura:
 * quem edita e transcreve é a estação de mídia no Mac (`/root-midia ep-NN` no
 * Claude Code), que devolve o leve. O vídeo fica no Mac — aqui aparece onde ele
 * está, a duração, o que foi cortado e a transcrição com os tempos do final.
 */

type Props = Pick<PautaEpisodioDetalhe, 'apelido' | 'status' | 'midia' | 'transcricao'>;

const MOTIVO: Record<PautaMotivoDeCorte, string> = {
  silencio: 'silêncio',
  'palavra-de-corte': 'palavra de corte',
  manual: 'à mão',
};

const EDITOR = { ffmpeg: 'ffmpeg', palmier: 'PalmierPro', manual: 'à mão' } as const;

function nome(caminho: string) {
  return caminho.split(/[\\/]/).filter(Boolean).pop() ?? caminho;
}

export function SecaoMidia({ apelido, status, midia: bruta, transcricao }: Props) {
  const midia = midiaDoEpisodio(bruta);
  const naFila = (PAUTA_STATUS_PENDENTES_DE_MIDIA as readonly string[]).includes(status);
  const comando = `/root-midia ${apelido}`;

  const porMotivo = new Map<PautaMotivoDeCorte, number>();
  let removido = 0;
  for (const c of midia?.cortes ?? []) {
    porMotivo.set(c.motivo, (porMotivo.get(c.motivo) ?? 0) + 1);
    removido += c.fim - c.inicio;
  }

  return (
    <section className="space-y-3" aria-label="Mídia do episódio">
      <h3 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Mídia</h3>

      {!midia && (
        <p className="text-sm text-muted">
          {naFila ? (
            <>
              Ainda sem mídia. No Mac, rode <code className="break-all">{comando}</code> no Claude Code: ele corta os
              silêncios e as tomadas erradas, transcreve e devolve aqui. O vídeo fica no Mac.
            </>
          ) : status === 'roteiro' ? (
            'A mídia vem depois da gravação.'
          ) : (
            'Este episódio não tem mídia registrada.'
          )}
        </p>
      )}

      {midia && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Vídeo final</dt>
          <dd className="min-w-0 break-all font-mono text-xs" title={midia.arquivoFinal}>
            {nome(midia.arquivoFinal)}
          </dd>
          <dt className="text-muted">Duração</dt>
          <dd>
            {tempoDoVideo(midia.duracaoSeg)}
            {midia.duracaoBrutoSeg !== undefined && (
              <span className="text-muted"> (bruto {tempoDoVideo(midia.duracaoBrutoSeg)})</span>
            )}
          </dd>
          <dt className="text-muted">Cortes</dt>
          <dd>
            {midia.cortes.length === 0
              ? 'nenhum'
              : `${midia.cortes.length} — ${[...porMotivo].map(([m, n]) => `${n} de ${MOTIVO[m]}`).join(', ')}; ${tempoDoVideo(removido)} tirados`}
          </dd>
          <dt className="text-muted">Edição</dt>
          <dd>
            {EDITOR[midia.editor]}
            {midia.palavraDeCorte && <span className="text-muted"> · palavra “{midia.palavraDeCorte}”</span>}
            <span className="text-muted"> · {new Date(midia.recebidaEm).toLocaleString('pt-BR')}</span>
          </dd>
        </dl>
      )}

      {midia && transcricao.length === 0 && (
        <p className="text-sm text-muted">
          {status === 'edicao' ? (
            <>
              Falta a transcrição do vídeo final: <code className="break-all">{comando}</code> transcreve e manda o
              episódio para o Pacote.
            </>
          ) : (
            'Sem transcrição registrada.'
          )}
        </p>
      )}

      {transcricao.length > 0 && (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm">
            Transcrição — {transcricao.length} trecho(s), até {tempoDoVideo(transcricao[transcricao.length - 1].fim)}
          </summary>
          <ol className="max-h-96 space-y-1 overflow-y-auto px-3 pb-3 text-sm" aria-label="Transcrição">
            {transcricao.map((s, i) => (
              <li key={`${i}-${s.inicio}`} className="flex gap-2">
                <span className="shrink-0 font-mono text-xs text-muted">{tempoDoVideo(s.inicio)}</span>
                <span className="min-w-0 break-words">{s.texto}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
