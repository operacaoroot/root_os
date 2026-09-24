import { Prisma } from '@prisma/client';
import {
  apelidoDoEpisodio,
  descricaoComPaginaDeLinks,
  thumbsDoPacote,
  titulosDoPacote,
  vizinhosDoEpisodio,
  type PautaEpisodioDetalhe,
  type PautaEpisodioResumo,
  type PautaEpisodioStatus,
  type PautaItemCurado,
} from '@mktos/shared';
import { cabeNaDescricao, paginaParaATela, type LinhaDaPagina } from './pagina-de-links-do-episodio';
import { ehLinkPrivado } from './link-publico';

/*
 * O EPISÓDIO (MC7) — a parte pura: número, título padrão e a leitura dos
 * campos JSON. A regra de quem anda para onde mora no shared
 * (`transicaoDoEpisodio`), porque a tela desenha os botões com a mesma conta.
 */

/** Só a rodada `curada` vira episódio: antes disso ninguém escolheu o que entra. */
export const STATUS_DA_RODADA_QUE_VIRA_EPISODIO = 'curada';

/**
 * P2003: a FK ou o gatilho `mktos_orgid_do_pai` barrou a escrita — a rodada
 * sumiu antes do insert, ou ganhou episódio antes do delete.
 */
export function semPai(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';
}

/** O próximo número da empresa, a partir do maior já dado (nulo = nenhum). */
export function proximoNumero(maior: number | null | undefined): number {
  return typeof maior === 'number' && Number.isInteger(maior) && maior > 0 ? maior + 1 : 1;
}

/**
 * Sem título pedido, o episódio herda o da rodada. O apelido (`ep-NN`) fica
 * fora: a tela já o mostra ao lado, e repeti-lo gasta uma linha no celular.
 */
export function tituloPadrao(numero: number, tituloDaRodada: string): string {
  const base = (tituloDaRodada ?? '').replace(/\s+/g, ' ').trim();
  return (base || `Episódio ${numero}`).slice(0, 160);
}

/**
 * Os itens que a curadoria manteve. Depois de confirmada, a rodada só guarda
 * os marcados (MC6); a rodada do modo antigo guarda os que a IA escolheu. A
 * marca `marcado` é da tela de curadoria e não tem sentido aqui.
 */
export function itensMantidos(itens: unknown): PautaItemCurado[] {
  if (!Array.isArray(itens)) return [];
  return itens
    .filter((i): i is PautaItemCurado => !!i && typeof i === 'object' && typeof (i as { titulo?: unknown }).titulo === 'string')
    .map((i) => {
      const { marcado: _marcado, ...resto } = i;
      // O link de caixa de entrada é privado: o episódio é a fonte da página
      // de links pública (MC12) e não pode nem carregá-lo. A marca é regravada
      // porque o item antigo chega sem ela (`link-publico.ts`).
      return ehLinkPrivado(resto) ? { ...resto, url: '', semLinkPublico: true } : resto;
    });
}

/** Segmentos `{inicio, fim, texto}`; o que não tiver essa forma fica de fora. */
export function lerTranscricao(valor: unknown): PautaEpisodioDetalhe['transcricao'] {
  if (!Array.isArray(valor)) return [];
  return valor.filter(
    (s): s is { inicio: number; fim: number; texto: string } =>
      !!s &&
      typeof s === 'object' &&
      typeof (s as { inicio?: unknown }).inicio === 'number' &&
      typeof (s as { fim?: unknown }).fim === 'number' &&
      typeof (s as { texto?: unknown }).texto === 'string',
  );
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

export interface LinhaDoEpisodio {
  id: string;
  numero: number;
  titulo: string;
  status: PautaEpisodioStatus;
  rodadaId: string;
  criadoEm: Date;
  atualizadoEm: Date;
  rodada: { titulo: string; itens: unknown; janelaIni?: Date; janelaFim?: Date };
}

export function resumoDoEpisodio(e: LinhaDoEpisodio): PautaEpisodioResumo {
  return {
    id: e.id,
    numero: e.numero,
    apelido: apelidoDoEpisodio(e.numero),
    titulo: e.titulo,
    status: e.status,
    rodadaId: e.rodadaId,
    rodadaTitulo: e.rodada.titulo,
    itens: itensMantidos(e.rodada.itens).length,
    criadoEm: e.criadoEm.toISOString(),
    atualizadoEm: e.atualizadoEm.toISOString(),
  };
}

export function detalheDoEpisodio(
  e: LinhaDoEpisodio & {
    rodada: { titulo: string; itens: unknown; janelaIni: Date; janelaFim: Date };
    roteiro: string;
    descricao: string;
    midia: unknown;
    transcricao: unknown;
    transcricaoTexto: string;
    titulos: unknown;
    thumbs: unknown;
    bioPageId: string | null;
    bioPage?: LinhaDaPagina | null;
    criadoPor: string | null;
  },
  origemDaBio = '',
): PautaEpisodioDetalhe {
  const { itens: _quantos, ...resumo } = resumoDoEpisodio(e);
  const { avancar, voltar } = vizinhosDoEpisodio(e.status);
  const paginaDeLinks = e.bioPage ? paginaParaATela(e.bioPage, origemDaBio) : null;
  // A descrição só aponta para página no ar: rascunho responde 404 a quem clica.
  const url = paginaDeLinks?.publicada && cabeNaDescricao(paginaDeLinks.url) ? paginaDeLinks.url : null;
  return {
    ...resumo,
    itens: itensMantidos(e.rodada.itens),
    janelaIni: e.rodada.janelaIni.toISOString(),
    janelaFim: e.rodada.janelaFim.toISOString(),
    roteiro: e.roteiro,
    descricao: descricaoComPaginaDeLinks(e.descricao, url),
    midia: objeto(e.midia),
    transcricao: lerTranscricao(e.transcricao),
    transcricaoTexto: e.transcricaoTexto,
    titulos: titulosDoPacote(e.titulos),
    thumbs: thumbsDoPacote(e.thumbs),
    bioPageId: e.bioPageId,
    paginaDeLinks,
    criadoPor: e.criadoPor,
    avancar,
    voltar,
  };
}
