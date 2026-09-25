import { createHash } from 'node:crypto';
import {
  PAUTA_EPISODIO_STATUS_ROTULO,
  PAUTA_FORMATOS_DA_SEMANA,
  PAUTA_FOLGA_DA_TRANSCRICAO_SEG,
  PAUTA_STATUS_PENDENTES_DE_MIDIA,
  apelidoDoEpisodio,
  midiaDoEpisodio,
  tempoDoVideo,
  type PautaEpisodioPendenteDeMidia,
  type PautaEpisodioPendenteDeRender,
  type PautaFormatoDaSemana,
  type PautaEpisodioStatus,
  type PautaMidiaDoEpisodio,
  type PautaMidiaInput,
  type PautaMotivoDeCorte,
  type PautaRenderPendente,
  type PautaSegmento,
} from '@mktos/shared';
import { palavraDeCorteEfetiva } from './roteiro-do-episodio';
import { ehPecaDaSemana, lerMetaDaSemana, tipoDaImagem, versaoDoTexto } from './derivacao-do-episodio';
import { midiaDaPeca } from './agenda-da-semana';

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
  statusDesde: Date;
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
    statusDesde: e.statusDesde.toISOString(),
  };
}

export interface PecaParaRender {
  id: string;
  formato: string;
  status: string;
  titulo: string;
  corpo: string;
  meta: unknown;
}

/** Um JPEG por imagem esperada (MD4): é o que a Graph da Meta baixa. */
function jpegsCompletos(meta: { imagens: readonly { n: number; tipo?: string }[] }, esperadas: number): boolean {
  const jpegs = new Set(meta.imagens.filter((i) => tipoDaImagem(i) === 'jpeg').map((i) => i.n));
  return Array.from({ length: esperadas }, (_, i) => i + 1).every((n) => jpegs.has(n));
}

/**
 * A mídia da peça está inteira para a Meta (MD4): o corte com o mp4 no storage
 * (só registrado no Mac não basta), o carrossel e o story com um PNG e um JPEG
 * por imagem. A régua única do vigia (`renderPendente`) e do encadeamento (MD1).
 */
export function midiaProntaDaPeca(formato: PautaFormatoDaSemana, meta: unknown, apelido: string): boolean {
  const midia = midiaDaPeca(formato, meta, apelido);
  if (formato === 'corte') return midia.onde === 'video';
  return midia.onde === 'storage' && jpegsCompletos(lerMetaDaSemana(meta), midia.esperadas);
}

/**
 * O que o vigia do Mac (MD2) ainda tem a renderizar num episódio: a peça da
 * semana deste episódio, da transcrição ATUAL (`sha`), em rascunho ou aprovada,
 * sem a mídia inteira — o corte sem mp4, o story sem PNG, o carrossel sem um PNG
 * por slide. A mesma régua do `root-midia` (`aceitaRender`) e da agenda
 * (`midiaDaPeca`). A assinatura muda quando o texto ou a mídia de alguma delas
 * muda: é o que deixa o vigia não refazer o mesmo render que já falhou (o
 * carrossel com texto estourado, por exemplo) a cada passagem.
 *
 * Desde a MD4 "a mídia inteira" é a que a Meta consegue baixar: o mp4 do corte
 * no storage (só registrado no Mac não basta) e um JPEG por imagem.
 */
export function renderPendente(
  pecas: readonly PecaParaRender[],
  e: { id: string; numero: number; sha: string },
): PautaEpisodioPendenteDeRender['precisaDeRender'] {
  const apelido = apelidoDoEpisodio(e.numero);
  const porFormato = new Map<PautaFormatoDaSemana, string[]>();
  for (const p of pecas) {
    if (p.status !== 'rascunho' && p.status !== 'aprovada') continue;
    if (!ehPecaDaSemana(p.meta, e.id)) continue;
    const formato = p.formato as PautaFormatoDaSemana;
    if (!(PAUTA_FORMATOS_DA_SEMANA as readonly string[]).includes(formato)) continue;
    const meta = lerMetaDaSemana(p.meta);
    if (meta.transcricaoSha !== e.sha) continue;
    if (midiaProntaDaPeca(formato, p.meta, apelido)) continue;
    const midia = midiaDaPeca(formato, p.meta, apelido);
    const imagens = meta.imagens.map((i) => `${i.n}${tipoDaImagem(i) === 'jpeg' ? 'j' : ''}`).sort();
    // `renderPedidoEm` só entra quando existe, para não mudar a assinatura das peças de antes da MD13.
    const linha = [p.id, versaoDoTexto(p), midia.onde, imagens.join(','), ...(meta.renderPedidoEm ? [meta.renderPedidoEm] : [])].join(':');
    porFormato.set(formato, [...(porFormato.get(formato) ?? []), linha]);
  }
  const saida: Partial<Record<PautaFormatoDaSemana, PautaRenderPendente>> = {};
  for (const formato of PAUTA_FORMATOS_DA_SEMANA) {
    const linhas = porFormato.get(formato);
    if (!linhas?.length) continue;
    const assinatura = createHash('sha256').update(linhas.sort().join('|')).digest('hex').slice(0, 16);
    saida[formato] = { pecas: linhas.length, assinatura };
  }
  return saida;
}
