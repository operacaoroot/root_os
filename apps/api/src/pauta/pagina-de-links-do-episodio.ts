import { createHash } from 'node:crypto';
import {
  BIO_HANDLE_RE,
  PAUTA_MAXIMO_DE_LINKS_DA_CASA,
  PAUTA_RESERVA_DA_PAGINA_DE_LINKS,
  apelidoDoEpisodio,
  type PautaItemCurado,
  type PautaLinkDaPagina,
  type PautaOrigemDoLinkDaPagina,
  type PautaPaginaDeLinks,
} from '@mktos/shared';
import { linkDoPacote } from './pacote-do-episodio';
import { ehLinkPrivado } from './link-publico';
import { ehLinkDeCampanha } from '../bio/link-de-campanha';

/*
 * ============================================================================
 * A PÁGINA DE LINKS DO EPISÓDIO (MC12) — a parte pura
 * ============================================================================
 *
 * Uma BioPage por episódio: um botão por matéria mantida com link público, na
 * ordem da rodada, e depois os links de chamada da casa. O link da newsletter
 * (origem L, `semLinkPublico`, host de caixa de entrada) nunca entra — a regra
 * é a mesma da descrição do YouTube (`linkDoPacote`), para a página e a
 * descrição citarem as mesmas matérias.
 *
 * Cada botão montado aqui leva uma CHAVE (`pauta:item:<hash>`/`pauta:casa:<hash>`),
 * única por página no banco: montar de novo atualiza o botão em vez de empilhar
 * outro. Botão sem chave é do painel da bio, e o de chave `campanha:` é o link
 * de uma peça (`bio/link-de-campanha.ts`): a montagem não toca em nenhum dos dois.
 */

/** O teto do rótulo e do destino de um botão da bio (`BioLinkSchema`). */
export const TETO_DO_ROTULO = 80;
export const TETO_DO_DESTINO = 500;

const PREFIXO_DA_CHAVE = 'pauta:';

export interface LinkPlanejado {
  chave: string;
  origem: Exclude<PautaOrigemDoLinkDaPagina, 'painel'>;
  rotulo: string;
  destino: string;
  destaque: boolean;
}

export interface LinkDaCasa {
  rotulo: string;
  url: string;
}

/** A chave do botão: a URL decide, não a posição — reordenar a rodada não troca o botão. */
export function chaveDoLink(origem: LinkPlanejado['origem'], url: string): string {
  return `${PREFIXO_DA_CHAVE}${origem}:${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;
}

/** Botão que uma montagem pôs (e a próxima pode tirar). */
export function ehChaveDaMontagem(chave: string | null | undefined): boolean {
  return typeof chave === 'string' && chave.startsWith(PREFIXO_DA_CHAVE);
}

export function origemDaChave(chave: string | null | undefined): PautaOrigemDoLinkDaPagina {
  if (!ehChaveDaMontagem(chave)) return 'painel';
  return chave!.startsWith(`${PREFIXO_DA_CHAVE}casa:`) ? 'casa' : 'item';
}

/** Uma linha, sem `<>`, cortada no teto sem partir palavra. */
export function rotuloDoBotao(v: unknown, reserva = ''): string {
  const s = (typeof v === 'string' ? v : '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length <= TETO_DO_ROTULO) return s || reserva;
  const corte = s.slice(0, TETO_DO_ROTULO);
  const i = corte.lastIndexOf(' ');
  return `${(i > TETO_DO_ROTULO * 0.6 ? corte.slice(0, i) : corte.slice(0, TETO_DO_ROTULO - 1)).replace(/[\s,;:.–—-]+$/, '')}…`;
}

function hostDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const URL_HTTP = /https?:\/\/[^\s<>()\]]+/i;

/**
 * Os links de chamada da casa, da nota da memória: uma linha por link, no
 * formato `Rótulo | https://…`, `Rótulo: https://…`, `[Rótulo](https://…)` ou
 * só a URL (o rótulo vira o domínio). Linha sem http(s) é ignorada; passou de
 * cinco, o resto fica de fora com aviso. Nota arquivada não vale.
 */
export function linksDaCasaDaNota(
  nota: { body: string; arquivadoEm?: Date | string | null } | null | undefined,
): { links: LinkDaCasa[]; avisos: string[] } {
  if (!nota || nota.arquivadoEm) return { links: [], avisos: [] };
  const links: LinkDaCasa[] = [];
  const avisos: string[] = [];
  const vistos = new Set<string>();
  let sobra = 0;
  for (const bruta of (nota.body ?? '').split('\n')) {
    const linha = bruta.trim().replace(/^[-*+>]\s+/, '');
    const m = URL_HTTP.exec(linha);
    if (!m) continue;
    const url = m[0].replace(/[.,;:!?]+$/, '');
    if (url.length > TETO_DO_DESTINO) {
      avisos.push(`Um link da casa passa de ${TETO_DO_DESTINO} caracteres e ficou de fora.`);
      continue;
    }
    if (vistos.has(url)) continue;
    if (links.length >= PAUTA_MAXIMO_DE_LINKS_DA_CASA) {
      sobra += 1;
      continue;
    }
    vistos.add(url);
    const markdown = /^\[([^\]]+)\]\(/.exec(linha);
    const antes = markdown ? markdown[1] : linha.slice(0, m.index).replace(/[\s|:–—-]+$/, '');
    links.push({ rotulo: rotuloDoBotao(antes, hostDe(url)), url });
  }
  if (sobra) avisos.push(`A página leva no máximo ${PAUTA_MAXIMO_DE_LINKS_DA_CASA} links da casa; ${sobra} ficaram de fora.`);
  return { links, avisos };
}

export interface PlanoDaPagina {
  links: LinkPlanejado[];
  /** Matérias citadas que têm link público — as que o critério de pronto conta. */
  materias: number;
  avisos: string[];
}

/**
 * O que a página tem de mostrar, na ordem: as matérias mantidas com link
 * público (sem repetir URL) e depois as chamadas da casa, em destaque. Chamada
 * que repete a URL de uma matéria não entra de novo.
 */
export function planoDaPagina(itens: readonly PautaItemCurado[], casa: readonly LinkDaCasa[]): PlanoDaPagina {
  const links: LinkPlanejado[] = [];
  const avisos: string[] = [];
  const vistos = new Set<string>();
  let privados = 0;
  let longos = 0;
  for (const item of itens) {
    const url = linkDoPacote(item);
    if (!url) {
      if (ehLinkPrivado(item)) privados += 1;
      continue;
    }
    if (url.length > TETO_DO_DESTINO) {
      longos += 1;
      continue;
    }
    if (vistos.has(url)) continue;
    vistos.add(url);
    links.push({ chave: chaveDoLink('item', url), origem: 'item', rotulo: rotuloDoBotao(item.titulo, hostDe(url)), destino: url, destaque: false });
  }
  const materias = links.length;
  for (const c of casa) {
    if (vistos.has(c.url)) continue;
    vistos.add(c.url);
    links.push({ chave: chaveDoLink('casa', c.url), origem: 'casa', rotulo: c.rotulo, destino: c.url, destaque: true });
  }
  if (privados) {
    avisos.push(`${privados} matéria(s) de newsletter ficaram de fora: o link delas é da caixa de entrada, não é público.`);
  }
  if (longos) avisos.push(`${longos} link(s) passam de ${TETO_DO_DESTINO} caracteres e ficaram de fora.`);
  return { links, materias, avisos };
}

/** A parte do slug da empresa que cabe num handle da bio. */
function slugParaHandle(slug: string, teto: number): string {
  return (slug ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, Math.max(0, teto))
    .replace(/^[-._]+|[-._]+$/g, '');
}

/**
 * Os handles a tentar, em ordem. O handle é ÚNICO NA BIO INTEIRA (todas as
 * empresas), então leva o slug da empresa na frente: `root-ep-07`. O segundo
 * leva um pedaço do id do episódio, para o caso de alguém já ter criado aquele
 * handle à mão no painel. Todos cabem nos 30 caracteres do `BIO_HANDLE_RE`.
 */
export function handlesDaPagina(slugDaEmpresa: string, numero: number, episodioId: string): string[] {
  const ep = apelidoDoEpisodio(numero);
  const sufixo = (episodioId ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 4) || 'x';
  const comSlug = (resto: string) => {
    const s = slugParaHandle(slugDaEmpresa, 30 - resto.length - 1);
    return s ? `${s}-${resto}` : resto;
  };
  const candidatos = [comSlug(ep), comSlug(`${ep}-${sufixo}`)];
  return [...new Set(candidatos)].filter((h) => BIO_HANDLE_RE.test(h));
}

/** A origem pública da bio, sem barra no fim. */
export function origemDaBio(v: string | undefined | null): string {
  return (v ?? '').trim().replace(/\/+$/, '') || 'https://bio.operacaoroot.com';
}

/** `https://bio.operacaoroot.com/@root-ep-07`: o middleware do web reescreve `/@handle` para a página. */
export function urlDaPagina(origem: string, handle: string): string {
  return `${origemDaBio(origem)}/@${handle}`;
}

/** A URL tem de caber na folga que a descrição do MC11 guardou para ela. */
export function cabeNaDescricao(url: string): boolean {
  return new TextEncoder().encode(url).length <= PAUTA_RESERVA_DA_PAGINA_DE_LINKS;
}

export interface LinhaDaPagina {
  id: string;
  handle: string;
  titulo: string;
  publicada: boolean;
  links: Array<{ id: string; rotulo: string; destino: string; ativo: boolean; chave: string | null; ordem: number }>;
}

/**
 * A página como o detalhe do episódio a mostra: os botões na ordem da página.
 * Os links de campanha das peças ficam de fora — os de agora pela chave, os de
 * antes do MC12 por serem inativos sem chave: não são botões da página, são o
 * rastreio de uma mensagem.
 */
export function paginaParaATela(p: LinhaDaPagina, origem: string): PautaPaginaDeLinks {
  const links: PautaLinkDaPagina[] = [...p.links]
    .sort((a, b) => a.ordem - b.ordem)
    .filter((l) => !ehLinkDeCampanha(l.chave) && (l.ativo || ehChaveDaMontagem(l.chave)))
    .map((l) => ({ id: l.id, rotulo: l.rotulo, destino: l.destino, ativo: l.ativo, origem: origemDaChave(l.chave) }));
  return { id: p.id, handle: p.handle, url: urlDaPagina(origem, p.handle), titulo: p.titulo, publicada: p.publicada, links };
}

export interface PassoDaSincronia {
  criar: Array<LinkPlanejado & { ordem: number }>;
  atualizar: Array<{ id: string; rotulo: string; destino: string; destaque: boolean; ordem: number; ativo: true }>;
  desativar: string[];
  /** Os outros botões (painel, campanha, os que saíram do plano), depois dos da montagem, na ordem em que estavam. */
  reordenar: Array<{ id: string; ordem: number }>;
}

/**
 * O que muda na página para ela bater com o plano. Idempotente: com a página já
 * montada e o mesmo plano, nada é criado e ninguém muda de lugar.
 */
export function sincronia(
  existentes: ReadonlyArray<{ id: string; chave: string | null; ordem: number; ativo: boolean; rotulo: string; destino: string; destaque: boolean }>,
  plano: readonly LinkPlanejado[],
): PassoDaSincronia & { atualizados: number } {
  const porChave = new Map(existentes.filter((l) => ehChaveDaMontagem(l.chave)).map((l) => [l.chave as string, l]));
  const passo: PassoDaSincronia = { criar: [], atualizar: [], desativar: [], reordenar: [] };
  const doPlano = new Set<string>();
  let atualizados = 0;
  plano.forEach((p, i) => {
    const ordem = i + 1;
    const atual = porChave.get(p.chave);
    if (!atual) {
      passo.criar.push({ ...p, ordem });
      return;
    }
    porChave.delete(p.chave);
    doPlano.add(atual.id);
    const mudou = atual.rotulo !== p.rotulo || atual.destino !== p.destino || atual.destaque !== p.destaque || !atual.ativo || atual.ordem !== ordem;
    if (mudou) {
      atualizados += 1;
      passo.atualizar.push({ id: atual.id, rotulo: p.rotulo, destino: p.destino, destaque: p.destaque, ordem, ativo: true });
    }
  });
  for (const sobra of porChave.values()) if (sobra.ativo) passo.desativar.push(sobra.id);
  const outros = [...existentes].filter((l) => !doPlano.has(l.id)).sort((a, b) => a.ordem - b.ordem);
  outros.forEach((l, i) => {
    const ordem = plano.length + i + 1;
    if (l.ordem !== ordem) passo.reordenar.push({ id: l.id, ordem });
  });
  return { ...passo, atualizados };
}
