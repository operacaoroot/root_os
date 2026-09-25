import {
  PAUTA_CAPACIDADE_DE_ENVIAR_AO_YOUTUBE,
  PAUTA_CAPACIDADE_DE_PUBLICAR_NO_YOUTUBE,
  PAUTA_MARCADOR_DA_PAGINA_DE_LINKS,
  PAUTA_TETO_DA_DESCRICAO_DO_YOUTUBE,
  PAUTA_TETO_DO_TITULO_DO_YOUTUBE,
  YOUTUBE_ANTECEDENCIA_DA_PUBLICACAO_MS,
  YOUTUBE_ANTECEDENCIA_DO_ENVIO_MS,
  YOUTUBE_CATEGORIA_PADRAO,
  bytesUtf8,
  descricaoComPaginaDeLinks,
  titulosDoPacote,
  type YoutubeAuditoria,
} from '@mktos/shared';
import { cabeNaDescricao, urlDaPagina } from './pagina-de-links-do-episodio';
import type { VideoNoYoutube } from './cliente-do-youtube';

/*
 * O YOUTUBE DO EPISÓDIO (MD10) — a parte pura.
 *
 * Os argumentos dos dois itens do lote saem daqui, do episódio de AGORA: o
 * título marcado, a descrição com a página de links no lugar do marcador, a
 * categoria, a thumb escolhida (a chave e o sha curto do PNG no storage) e o
 * vídeo final que o Mac declarou (sha256 e tamanho). O de publicação soma o
 * horário. É o mesmo cálculo na montagem do lote, na tela da titular, na
 * ativação, na abertura da sessão e na rotina — e a porta confere o hash.
 */

export const CAPACIDADE_DE_ENVIAR = PAUTA_CAPACIDADE_DE_ENVIAR_AO_YOUTUBE;
export const CAPACIDADE_DE_PUBLICAR = PAUTA_CAPACIDADE_DE_PUBLICAR_NO_YOUTUBE;

export interface ArgsDoEnvioAoYoutube {
  episodioId: string;
  sha256: string;
  bytes: number;
  titulo: string;
  descricao: string;
  categoria: string;
  thumbN: number;
  thumbChave: string;
  thumbSha: string;
}

export interface ArgsDaPublicacaoNoYoutube extends ArgsDoEnvioAoYoutube {
  publicarEm: string;
}

/** O episódio como o YouTube o lê. `thumbs` é o JSON cru (a chave do storage não sai para a tela, mas entra no hash). */
export interface EpisodioParaOYoutube {
  id: string;
  titulos: unknown;
  descricao: string;
  thumbs: unknown;
  thumbEscolhida: number | null;
  publicarNoYoutubeEm: Date | null;
  bioPage: { handle: string; publicada: boolean } | null;
}

export interface ArquivoDoVideo {
  sha256: string;
  bytes: number;
}

/** A thumb escolhida com a imagem no storage, lida do JSON cru do episódio. */
export function thumbEscolhida(thumbs: unknown, n: number | null): { n: number; chave: string; sha: string } | null {
  if (!n || !Array.isArray(thumbs)) return null;
  const t = thumbs.find((x) => x && typeof x === 'object' && Number((x as { n?: unknown }).n) === n) as { imagem?: { chave?: unknown; sha?: unknown } } | undefined;
  const chave = t?.imagem?.chave;
  const sha = t?.imagem?.sha;
  if (typeof chave !== 'string' || !chave || typeof sha !== 'string' || !/^[0-9a-f]{12}$/.test(sha)) return null;
  return { n, chave, sha };
}

/** A descrição que sobe: a do pacote com a URL da página no ar no lugar do marcador. */
export function descricaoQueSobe(descricao: string, pagina: { handle: string; publicada: boolean } | null, origemDaBio: string): string {
  const url = pagina?.publicada ? urlDaPagina(origemDaBio, pagina.handle) : null;
  return descricaoComPaginaDeLinks(descricao, url && cabeNaDescricao(url) ? url : null);
}

/** Por que o texto não sobe ao YouTube, ou nulo: título até 100 caracteres, descrição até 5.000 BYTES, sem `<` `>`. */
export function problemaDoTexto(titulo: string, descricao: string): string | null {
  if (!titulo.trim()) return 'Marque o título do vídeo no pacote.';
  if ([...titulo].length > PAUTA_TETO_DO_TITULO_DO_YOUTUBE) return `O título passa de ${PAUTA_TETO_DO_TITULO_DO_YOUTUBE} caracteres.`;
  if (!descricao.trim()) return 'O pacote não tem descrição: gere o pacote.';
  if (descricao.includes(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS)) {
    return 'A descrição ainda tem o marcador da página de links: publique a página do episódio antes.';
  }
  const bytes = bytesUtf8(descricao);
  if (bytes > PAUTA_TETO_DA_DESCRICAO_DO_YOUTUBE) return `A descrição tem ${bytes} bytes; o YouTube aceita até ${PAUTA_TETO_DA_DESCRICAO_DO_YOUTUBE}.`;
  if (/[<>]/.test(titulo) || /[<>]/.test(descricao)) return 'O YouTube recusa < e > no título e na descrição.';
  return null;
}

/** A categoria da nota `pauta.youtube.categoria` (primeira linha, só o número), ou a padrão. */
export function categoriaDaNota(corpo: string | null | undefined): string {
  const linha = String(corpo ?? '').split(/\r?\n/)[0]?.trim() ?? '';
  return /^[0-9]{1,3}$/.test(linha) ? linha : YOUTUBE_CATEGORIA_PADRAO;
}

/** A playlist da nota `pauta.youtube.playlist` (primeira linha, o id `PL…`), ou nula. */
export function playlistDaNota(corpo: string | null | undefined): string | null {
  const linha = String(corpo ?? '').split(/\r?\n/)[0]?.trim() ?? '';
  return /^[A-Za-z0-9_-]{10,64}$/.test(linha) ? linha : null;
}

/**
 * Os argumentos do item de ENVIO do episódio de agora, ou o motivo de não
 * haver: cada falta tem a frase que diz o que fazer.
 */
export function argsDoEnvio(
  e: EpisodioParaOYoutube,
  arquivo: ArquivoDoVideo | null,
  ctx: { origemDaBio: string; categoria: string },
): { args: ArgsDoEnvioAoYoutube } | { problema: string } {
  const titulo = titulosDoPacote(e.titulos).find((t) => t.escolhido)?.texto ?? '';
  const descricao = descricaoQueSobe(e.descricao ?? '', e.bioPage, ctx.origemDaBio);
  const texto = problemaDoTexto(titulo, descricao);
  if (texto) return { problema: texto };
  if (!e.thumbEscolhida) return { problema: 'Escolha a thumb que sobe ao YouTube no pacote.' };
  const thumb = thumbEscolhida(e.thumbs, e.thumbEscolhida);
  if (!thumb) return { problema: 'A thumb escolhida ainda não foi renderizada: rode root-midia thumbs no Mac.' };
  if (!arquivo) return { problema: 'O Mac ainda não declarou o vídeo final: rode root-midia youtube ep-NN --declarar.' };
  return {
    args: {
      episodioId: e.id,
      sha256: arquivo.sha256,
      bytes: arquivo.bytes,
      titulo,
      descricao,
      categoria: ctx.categoria,
      thumbN: thumb.n,
      thumbChave: thumb.chave,
      thumbSha: thumb.sha,
    },
  };
}

/** Os argumentos do item de PUBLICAÇÃO: os do envio mais o horário do pacote. */
export function argsDaPublicacao(
  e: EpisodioParaOYoutube,
  arquivo: ArquivoDoVideo | null,
  ctx: { origemDaBio: string; categoria: string },
): { args: ArgsDaPublicacaoNoYoutube } | { problema: string } {
  const envio = argsDoEnvio(e, arquivo, ctx);
  if ('problema' in envio) return envio;
  if (!e.publicarNoYoutubeEm) return { problema: 'Defina o horário do vídeo no pacote.' };
  return { args: { ...envio.args, publicarEm: e.publicarNoYoutubeEm.toISOString() } };
}

/**
 * As janelas dos dois itens: o envio vale da montagem até 1 h antes do horário,
 * e o agendamento até 15 min antes (o `publishAt` tem de estar no futuro quando
 * chega ao YouTube).
 */
export function janelasDoYoutube(publicarEm: Date, agora: Date): { envio: { janelaDe: Date; janelaAte: Date }; publicacao: { janelaDe: Date; janelaAte: Date } } {
  return {
    envio: { janelaDe: agora, janelaAte: new Date(publicarEm.getTime() - YOUTUBE_ANTECEDENCIA_DO_ENVIO_MS) },
    publicacao: { janelaDe: agora, janelaAte: new Date(publicarEm.getTime() - YOUTUBE_ANTECEDENCIA_DA_PUBLICACAO_MS) },
  };
}

/** Quais capacidades entram no lote com esta auditoria: só o envio no modo teste. */
export function capacidadesDoLote(auditoria: YoutubeAuditoria): string[] {
  if (auditoria === 'aprovada') return [CAPACIDADE_DE_ENVIAR, CAPACIDADE_DE_PUBLICAR];
  if (auditoria === 'teste') return [CAPACIDADE_DE_ENVIAR];
  return [];
}

/** Os `uploadStatus` de vídeo que não vai ao ar; `uploaded` (processando) e `processed` valem. */
const ESTADOS_DE_ENVIO_PERDIDO: readonly string[] = ['rejected', 'failed', 'deleted'];

/** O YouTube recusou o vídeo, o processamento falhou ou ele foi apagado. */
export function envioPerdido(v: VideoNoYoutube): boolean {
  return !!v.uploadStatus && ESTADOS_DE_ENVIO_PERDIDO.includes(v.uploadStatus);
}

/**
 * No modo teste, o envio só vale para o canal de `YOUTUBE_CANAL_DE_TESTE`: um
 * vídeo que sobe por projeto sem auditoria fica privado para sempre, e mandar o
 * episódio real ao canal da empresa o queimaria. Nulo = pode abrir a sessão.
 */
export function motivoDoCanalDeTeste(auditoria: YoutubeAuditoria, canalDeTeste: string | null | undefined, canalConectado: string | null): string | null {
  if (auditoria !== 'teste') return null;
  const teste = String(canalDeTeste ?? '').trim();
  if (!teste) {
    return 'YOUTUBE_AUDITORIA=teste exige YOUTUBE_CANAL_DE_TESTE com o id do canal de teste (UC…): sem ele, o episódio real iria ao canal da empresa e ficaria privado para sempre. Nada foi enviado.';
  }
  if (canalConectado !== teste) {
    return `O canal conectado (${canalConectado ?? 'desconhecido'}) não é o canal de teste (YOUTUBE_CANAL_DE_TESTE): no modo teste o vídeo ficaria privado para sempre. Conecte o canal de teste, ou espere a auditoria. Nada foi enviado.`;
  }
  return null;
}

/**
 * Por que o vídeo que está no YouTube não é o assinado, ou nulo. Confere que
 * ele existe, que está PRIVADO e que o título, a descrição e a categoria são
 * os do hash. `publishAt` já marcado só vale quando é o mesmo horário.
 */
export function divergenciaDoVideo(v: VideoNoYoutube | null, a: ArgsDoEnvioAoYoutube & { publicarEm?: string }): string | null {
  if (!v) return 'O vídeo não existe no canal conectado (ou é de outro canal).';
  if (envioPerdido(v)) {
    return `O YouTube marcou o vídeo como "${v.uploadStatus}" (recusado, falhou no processamento ou foi apagado; por exemplo, por duplicata): ele não vai ao ar. Confira no Studio e envie o arquivo de novo.`;
  }
  if (v.privacidade !== 'private') return `O vídeo está "${v.privacidade ?? '?'}" no YouTube, não privado: alguém mexeu no Studio. Nada foi enviado.`;
  if ((v.titulo ?? '') !== a.titulo) return 'O título do vídeo no YouTube não é o assinado.';
  if ((v.descricao ?? '').replace(/\r\n/g, '\n') !== a.descricao.replace(/\r\n/g, '\n')) return 'A descrição do vídeo no YouTube não é a assinada.';
  if (v.categoria !== null && v.categoria !== a.categoria) return 'A categoria do vídeo no YouTube não é a assinada.';
  // O sha256 o YouTube não expõe; o tamanho, sim (só ao dono). Ausente, vale a amarra da sessão aberta pelo OS.
  if (v.tamanho != null && v.tamanho !== a.bytes) {
    return `O arquivo do vídeo no YouTube tem ${v.tamanho} bytes, e o assinado tem ${a.bytes}: não é o vídeo final da semana.`;
  }
  if (v.publishAt && a.publicarEm && new Date(v.publishAt).getTime() !== new Date(a.publicarEm).getTime()) {
    return 'O vídeo já tem outro horário de publicação no YouTube.';
  }
  return null;
}

/** O `sha` curto do PNG confere com o assinado? (o nome no storage leva os 12 primeiros do sha256). */
export function pngDaThumbConfere(sha256DoPng: string, thumbSha: string): boolean {
  return sha256DoPng.slice(0, 12) === thumbSha;
}

/** Comparação dos argumentos por campo, na ordem das chaves: é o que o hash da porta cobre. */
export function mesmosArgs(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}
