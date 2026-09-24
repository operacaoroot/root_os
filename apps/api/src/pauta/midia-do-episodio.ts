import {
  PAUTA_EPISODIO_STATUS_ROTULO,
  PAUTA_FOLGA_DA_TRANSCRICAO_SEG,
  PAUTA_STATUS_PENDENTES_DE_MIDIA,
  apelidoDoEpisodio,
  midiaDoEpisodio,
  tempoDoVideo,
  type PautaEpisodioPendenteDeMidia,
  type PautaEpisodioStatus,
  type PautaMidiaDoEpisodio,
  type PautaMidiaInput,
  type PautaMotivoDeCorte,
  type PautaSegmento,
} from '@mktos/shared';
import { palavraDeCorteEfetiva } from './roteiro-do-episodio';

/*
 * A MÍDIA DO EPISÓDIO (MC9) — a parte pura. O Mac edita e transcreve; aqui
 * mora só quem pode receber o quê e em que status, e o resumo que vai ao
 * RASTRO (sem o caminho inteiro do Mac, que diz o nome da conta de quem grava).
 */

export function ehPendenteDeMidia(status: PautaEpisodioStatus): boolean {
  return (PAUTA_STATUS_PENDENTES_DE_MIDIA as readonly string[]).includes(status);
}

/**
 * A mídia entra na gravação (vai para a edição) e na edição (substitui a de
 * antes, de uma edição refeita). Fora disso, nulo não; o motivo sim.
 */
export function motivoParaNaoReceberMidia(status: PautaEpisodioStatus): string | null {
  if (ehPendenteDeMidia(status)) return null;
  if (status === 'roteiro') return 'O episódio ainda está no roteiro — grave antes de mandar a mídia.';
  return (
    `O episódio já passou da edição (está em ${PAUTA_EPISODIO_STATUS_ROTULO[status]}). ` +
    'Volte o status até Edição para trocar a mídia.'
  );
}

/** A transcrição só entra na edição, e depois da mídia: os tempos são do vídeo final. */
export function motivoParaNaoReceberTranscricao(
  status: PautaEpisodioStatus,
  midia: PautaMidiaDoEpisodio | null,
): string | null {
  if (status === 'edicao') {
    return midia ? null : 'O episódio está em edição, mas a mídia não chegou — mande a mídia antes da transcrição.';
  }
  if (status === 'roteiro') return 'O episódio ainda está no roteiro — não há vídeo para transcrever.';
  if (status === 'gravacao') return 'Mande a mídia antes: a transcrição é do vídeo final, e ele ainda não chegou.';
  return (
    `O episódio já passou da edição (está em ${PAUTA_EPISODIO_STATUS_ROTULO[status]}). ` +
    'Volte o status até Edição para trocar a transcrição.'
  );
}

/**
 * A transcrição que passa do fim do vídeo final é de outro arquivo — quase
 * sempre a do bruto, que é mais longo. Os tempos dela não bateriam com nada.
 */
export function transcricaoForaDoVideo(segmentos: ReadonlyArray<PautaSegmento>, duracaoSeg: number): string | null {
  const fim = segmentos.reduce((m, s) => Math.max(m, s.fim), 0);
  if (fim <= duracaoSeg + PAUTA_FOLGA_DA_TRANSCRICAO_SEG) return null;
  return (
    `A transcrição vai até ${tempoDoVideo(fim)}, mas o vídeo final tem ${tempoDoVideo(duracaoSeg)}. ` +
    'Transcreva o arquivo FINAL (a do bruto tem os tempos de antes dos cortes).'
  );
}

/** Só o nome do arquivo: o RASTRO não precisa saber a pasta do Mac. */
export function nomeDoArquivo(caminho: string): string {
  const partes = caminho.split(/[\\/]/).filter(Boolean);
  return partes[partes.length - 1] ?? caminho;
}

export function resumoDaMidia(m: PautaMidiaInput) {
  const porMotivo: Partial<Record<PautaMotivoDeCorte, number>> = {};
  let removidoSeg = 0;
  for (const c of m.cortes) {
    porMotivo[c.motivo] = (porMotivo[c.motivo] ?? 0) + 1;
    removidoSeg += c.fim - c.inicio;
  }
  return {
    arquivoBruto: nomeDoArquivo(m.arquivoBruto),
    arquivoFinal: nomeDoArquivo(m.arquivoFinal),
    duracaoSeg: m.duracaoSeg,
    duracaoBrutoSeg: m.duracaoBrutoSeg ?? null,
    cortes: m.cortes.length,
    porMotivo,
    removidoSeg: Math.round(removidoSeg * 100) / 100,
    palavraDeCorte: m.palavraDeCorte ?? null,
    editor: m.editor,
  };
}

export interface LinhaPendenteDeMidia {
  id: string;
  numero: number;
  titulo: string;
  status: PautaEpisodioStatus;
  palavraDeCorte: string | null;
  midia: unknown;
  atualizadoEm: Date;
}

export function pendenteDeMidia(e: LinhaPendenteDeMidia, daEmpresa: string | null): PautaEpisodioPendenteDeMidia {
  const midia = midiaDoEpisodio(e.midia);
  return {
    id: e.id,
    numero: e.numero,
    apelido: apelidoDoEpisodio(e.numero),
    titulo: e.titulo,
    status: e.status,
    palavraDeCorte: palavraDeCorteEfetiva(e.palavraDeCorte, daEmpresa).efetiva,
    falta: e.status === 'edicao' && midia ? 'transcricao' : 'midia',
    arquivoFinal: midia?.arquivoFinal ?? null,
    atualizadoEm: e.atualizadoEm.toISOString(),
  };
}
