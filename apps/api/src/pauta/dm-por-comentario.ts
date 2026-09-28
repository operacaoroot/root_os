import { createHmac } from 'node:crypto';
import { INSTAGRAM_USUARIO_RE, PAUTA_DM_JANELA_DIAS, PAUTA_DM_TETO_BYTES, bytesUtf8, checagemAntiSlop, type PautaChecagemAntiSlop } from '@mktos/shared';
import { chaveDeCampanha } from '../bio/link-de-campanha';
import { normalizarPalavra } from './derivacao-do-episodio';
import { semLinksDeCaixaDeEntrada } from './link-publico';

/*
 * ============================================================================
 * A DM POR PALAVRA-CHAVE, RESPONDIDA À MÃO (MD9 = MC18.0 + o coletor) — a parte pura
 * ============================================================================
 *
 * O carrossel e o corte da semana fecham com "comentário com a PALAVRA → o link
 * da matéria e o episódio completo chegam no direct" (D-MC9.7 a: o CTA fica, e a
 * resposta é à mão). A rotina lê os comentários dos posts dos últimos 7 dias, e
 * quem comentou a palavra INTEIRA entra na fila com o texto pronto para colar:
 * o `/r/` do link de campanha da matéria (`campanha:dm:<itemId>`, D-MC9.6 a) e o
 * endereço da página do episódio.
 *
 * O que NUNCA acontece aqui: o texto do comentário não entra em nada — nem no
 * texto da DM, nem num prompt, nem no banco. Dele se usa só se contém a palavra.
 */

/** O link de campanha da DM de uma matéria: um por matéria, o carrossel e o corte dividem. */
export function chaveDaDm(itemId: string): string {
  return chaveDeCampanha('dm', itemId);
}

/**
 * O comentário contém a palavra INTEIRA? A comparação é pela mesma régua da
 * palavra do CTA (`normalizarPalavra`: maiúscula, sem acento, só letras e
 * números), token a token. "AGENTES2" não casa com "AGENTES", "#agentes!" casa.
 */
export function casaPalavraInteira(texto: string, palavra: string): boolean {
  const alvo = normalizarPalavra(String(palavra ?? ''));
  if (!alvo) return false;
  const plano = String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  return plano.split(/[^A-Z0-9]+/).some((t) => t === alvo);
}

/** Por que um comentário lido NÃO entra na fila. */
export type MotivoParaIgnorar = 'propria_conta' | 'resposta' | 'anuncio' | 'antigo' | 'sem_data' | 'sem_autor' | 'sem_palavra';

export interface ComentarioParaTriar {
  texto: string;
  timestamp: string | null;
  deId: string | null;
  deUsuario: string | null;
  parentId: string | null;
  adId: string | null;
}

/**
 * A triagem de um comentário, na ordem em que os freios importam: a própria
 * conta primeiro (responder a si mesma é laço), depois anúncio, resposta a comentário (salvo a nota
 * `pauta.comentarios.respostas`), o prazo de 7 dias da Meta e, por último, a
 * palavra inteira.
 */
export function triarComentario(
  c: ComentarioParaTriar,
  ctx: { palavra: string; igUserId: string; handle: string | null; agora: Date; incluirRespostas: boolean },
): { entra: true; comentadoEm: Date } | { entra: false; motivo: MotivoParaIgnorar } {
  const handle = (ctx.handle ?? '').replace(/^@/, '').toLowerCase();
  if ((c.deId && c.deId === ctx.igUserId) || (handle && (c.deUsuario ?? '').toLowerCase() === handle)) {
    return { entra: false, motivo: 'propria_conta' };
  }
  // Defensivo: `ad_id` chega no webhook de comentários (MD11). A leitura por
  // consulta não o pede — campo que o nó IG Comment não tem dá #100 e derruba a
  // leitura —, então no coletor da MD9 `adId` vem sempre nulo.
  if (c.adId) return { entra: false, motivo: 'anuncio' };
  if (c.parentId && !ctx.incluirRespostas) return { entra: false, motivo: 'resposta' };
  const quando = c.timestamp ? new Date(c.timestamp) : null;
  if (!quando || Number.isNaN(quando.getTime())) return { entra: false, motivo: 'sem_data' };
  if (ctx.agora.getTime() - quando.getTime() > PAUTA_DM_JANELA_DIAS * 86_400_000) return { entra: false, motivo: 'antigo' };
  if (!c.deId || !c.deUsuario || !INSTAGRAM_USUARIO_RE.test(c.deUsuario)) return { entra: false, motivo: 'sem_autor' };
  if (!casaPalavraInteira(c.texto, ctx.palavra)) return { entra: false, motivo: 'sem_palavra' };
  return { entra: true, comentadoEm: quando };
}

/**
 * O que é "esperando resposta" na fila: sem resposta e dentro dos 7 dias. Uma
 * definição só, para a aba Semana (`agenda`) e a fila não divergirem.
 */
export function ondeEsperaResposta(orgId: string, agora: Date): { orgId: string; respondidoEm: null; expiraEm: { gt: Date } } {
  return { orgId, respondidoEm: null, expiraEm: { gt: agora } };
}

/** Até quando o @ fica guardado: o comentário mais os 7 dias da Meta. */
export function expiraEmDo(comentadoEm: Date): Date {
  return new Date(comentadoEm.getTime() + PAUTA_DM_JANELA_DIAS * 86_400_000);
}

/** O tamanho mínimo da chave do HMAC da pessoa. Chave curta demais é chave adivinhável. */
export const TAMANHO_MINIMO_DA_CHAVE_DA_PESSOA = 32;

/** A chave do HMAC do id da pessoa (META_WEBHOOK_PESSOA_HMAC_KEY), ou nulo se ausente ou curta. */
export function chaveDaPessoa(env: NodeJS.ProcessEnv = process.env): string | null {
  const k = (env.META_WEBHOOK_PESSOA_HMAC_KEY ?? '').trim();
  return k.length >= TAMANHO_MINIMO_DA_CHAVE_DA_PESSOA ? k : null;
}

/**
 * O HMAC-SHA256 do id da pessoa no Instagram. É o que o RASTRO e a fila guardam
 * para saber "a mesma pessoa" sem guardar quem ela é. O mesmo nome de chave da
 * MC18: quando a DM automática vier (MD11), "uma DM por pessoa" usa este valor.
 */
export function hmacDaPessoa(idDaPessoa: string, chave: string): string {
  return createHmac('sha256', chave).update(`instagram:${idDaPessoa}`).digest('hex');
}

/**
 * O mesmo post? O permalink colado à mão (MC16) e o que a Graph devolve podem
 * diferir no host (`www.`), na barra final e nos parâmetros (`?igsh=`): compara
 * só o caminho.
 */
export function mesmoPermalink(a: string | null | undefined, b: string | null | undefined): boolean {
  const caminho = (u: string | null | undefined) => {
    try {
      return new URL(String(u ?? '')).pathname.replace(/\/+$/, '').toLowerCase();
    } catch {
      return '';
    }
  };
  const ca = caminho(a);
  return !!ca && ca !== '/' && ca === caminho(b);
}

/** O título da matéria no texto da DM: uma linha, sem link de caixa de entrada, com teto. */
const TETO_DO_TITULO_NA_DM = 140;

/**
 * O texto da DM de uma matéria (D-MC9.5: fixo, sem IA na hora e sem o @ de
 * ninguém). Leva o link rastreado da matéria e o endereço da página do
 * episódio, e passa por `semLinksDeCaixaDeEntrada`: o título veio do modelo e
 * pode ter sido editado à mão. Sem segunda pessoa, como a voz da marca pede.
 */
export function textoDaDm(e: { materia: string; link: string; pagina: string }): string {
  const titulo = semLinksDeCaixaDeEntrada(String(e.materia ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TETO_DO_TITULO_NA_DM);
  const texto = [
    `O link da matéria que saiu no post${titulo ? ` (${titulo})` : ''}:`,
    e.link,
    '',
    'O episódio completo, com todas as matérias da semana:',
    e.pagina,
  ].join('\n');
  return semLinksDeCaixaDeEntrada(texto);
}

/**
 * O que impede um texto de DM de sair: vazio, mais de 1000 bytes (a Meta mede
 * em BYTES), sem o link rastreado da matéria (o clique deixaria de ser medido)
 * ou reprovado na checagem anti-slop da casa.
 */
export function problemaDoTextoDaDm(texto: string, link: string): { motivo: string; checagem: PautaChecagemAntiSlop | null } | null {
  const t = String(texto ?? '').trim();
  if (!t) return { motivo: 'O texto da DM está vazio.', checagem: null };
  const bytes = bytesUtf8(t);
  if (bytes > PAUTA_DM_TETO_BYTES) {
    return { motivo: `O texto da DM tem ${bytes} bytes; a Meta aceita até ${PAUTA_DM_TETO_BYTES} (cada acento conta 2).`, checagem: null };
  }
  if (!t.includes(link)) return { motivo: `O texto precisa levar o link rastreado da matéria (${link}): sem ele o clique não é medido.`, checagem: null };
  const checagem = checagemAntiSlop(t);
  if (!checagem.aprovada) {
    const lista = checagem.apontamentos.map((a) => `${a.trecho} (${a.onde})`).join('; ');
    return { motivo: `O texto não passou na checagem anti-slop da casa: ${lista}.`, checagem };
  }
  return null;
}

/** O resumo da passagem do coletor, para o histórico da rotina (só números). */
export interface ResumoDaColeta {
  midias: number;
  lidos: number;
  novos: number;
  jaNaFila: number;
  ignorados: Partial<Record<MotivoParaIgnorar, number>>;
  truncadas: number;
  semMidia: number;
  expurgados: number;
}

const ROTULO_DO_MOTIVO: Record<MotivoParaIgnorar, string> = {
  propria_conta: 'da própria conta',
  resposta: 'resposta a comentário',
  anuncio: 'de anúncio',
  antigo: 'mais de 7 dias',
  sem_data: 'sem data',
  sem_autor: 'sem autor',
  sem_palavra: 'sem a palavra',
};

export function linhaDoResumo(r: ResumoDaColeta): string {
  const ign = (Object.entries(r.ignorados) as Array<[MotivoParaIgnorar, number | undefined]>)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([k, n]) => `${ROTULO_DO_MOTIVO[k] ?? k} ${n}`)
    .join(', ');
  return [
    `${r.midias} post(s), ${r.lidos} comentário(s) lido(s)`,
    `${r.novos} novo(s) na fila`,
    r.jaNaFila ? `${r.jaNaFila} já estava(m)` : '',
    ign ? `ignorados: ${ign}` : '',
    r.truncadas ? `${r.truncadas} post(s) com mais comentários que o teto de páginas` : '',
    r.semMidia ? `${r.semMidia} peça(s) sem o post achado no Instagram` : '',
    r.expurgados ? `${r.expurgados} @ apagado(s) depois dos 7 dias` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
