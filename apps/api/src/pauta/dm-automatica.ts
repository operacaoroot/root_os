import {
  PAUTA_CAPACIDADE_DE_PAUSAR_A_DM,
  PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO,
  PAUTA_DM_JANELA_DIAS,
  PAUTA_DM_TETO_POR_DIA_MAXIMO,
  PAUTA_DM_TETO_POR_DIA_PADRAO,
  diaNoFuso,
  instanteNoFuso,
  somarDias,
  type EnvioDeRespostaEstado,
} from '@mktos/shared';
import { foraDaJanela, minutosNoFuso } from '../policy/limites';
import { problemaDoTextoDaDm } from './dm-por-comentario';

/*
 * ============================================================================
 * A DM AUTOMÁTICA SOB O LOTE DA SEMANA (MD11 = MC18.1 a 18.4 no lote) — a parte pura
 * ============================================================================
 *
 * A regra de cada matéria (a palavra, o texto fixo, o link rastreado, o destino
 * e as peças onde vale) é um ITEM do lote da semana (MD7/MD8), assinado pela
 * titular com o resto da semana. O item tem teto por dia (a virada do dia em
 * São Paulo mora no mesmo UPDATE do consumo, `LotesService.consumirItem`) e
 * janela de 7 dias a partir da publicação. Quem dispara é a rotina de
 * comentários (MD9), por consulta; o webhook fica para depois do App Review.
 *
 * O hash do item cobre SÓ o que se assina: o id do comentário e a pessoa ficam
 * fora dos argumentos (senão nenhum envio casaria com o item), e o efeito os
 * lê da linha do envio pela correlação da passagem.
 */

export const CAPACIDADE_DA_DM = PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO;
export const CAPACIDADE_DE_PAUSAR = PAUTA_CAPACIDADE_DE_PAUSAR_A_DM;

/** Quem age quando a DM sai sozinha: a fila mostra "DM automática" em `respondidoPor`. */
export const ATOR_DA_DM = 'dm-automatica';

/** Quanto tempo a linha do envio vive (D-MC9.9). */
export const RETENCAO_DO_ENVIO_DIAS = 90;

/** Três recusas seguidas da Meta numa regra a pausam (o disjuntor de erro da MC18). */
export const RECUSAS_QUE_PAUSAM = 3;

/**
 * O erro da Meta quando a mensagem exige Advanced Access: quem comentou não tem
 * papel no app, e o app ainda não passou pelo App Review de mensagens.
 */
export const CODIGO_SEM_ADVANCED_ACCESS = '100/2534001';

/** Quantos dias um item de DM pode durar: 7 da janela da Meta, mais o dia que começa pela metade. */
const DIAS_DO_ITEM = PAUTA_DM_JANELA_DIAS + 1;
const DIA_MS = 86_400_000;

/** O recurso do item de lote da regra: a matéria do episódio. */
export function recursoDaRegra(episodioId: string, itemId: string): string {
  return `${episodioId}:${itemId}`;
}

/** O contrário de `recursoDaRegra`, ou nulo quando não tem a forma. */
export function lerRecursoDaRegra(recursoId: string): { episodioId: string; itemId: string } | null {
  const i = recursoId.indexOf(':');
  if (i <= 0 || i === recursoId.length - 1) return null;
  return { episodioId: recursoId.slice(0, i), itemId: recursoId.slice(i + 1) };
}

/**
 * A primeira linha de toda DM automática: quem recebe sabe que não foi uma
 * pessoa digitando (ajuste (ii) da pesquisa da onda D). Sem o @ de ninguém.
 */
export function avisoDeMensagemAutomatica(palavra: string): string {
  return `Mensagem automática, enviada porque você comentou ${palavra} no nosso post.`;
}

/** O texto que sai: o aviso, uma linha em branco e o texto da DM da matéria (o padrão ou o editado à mão). */
export function textoDaDmAutomatica(base: string, palavra: string): string {
  return `${avisoDeMensagemAutomatica(palavra)}\n\n${base.trim()}`;
}

/** Por que o texto automático não sai, ou nulo. As mesmas regras da DM à mão: bytes, link rastreado e anti-slop. */
export function problemaDoTextoAutomatico(texto: string, link: string): string | null {
  return problemaDoTextoDaDm(texto, link)?.motivo ?? null;
}

/** Os argumentos de `instagram.resposta_privada.enviar`: o conteúdo exato que a titular assina. */
export interface ArgsDaRegra {
  igUserId: string;
  palavra: string;
  texto: string;
  bioLinkId: string;
  destinoAprovado: string;
  /** As peças (carrossel e corte) da matéria, em ordem: o hash não depende da ordem de leitura. */
  midias: string[];
}

export function argsDaRegra(e: Omit<ArgsDaRegra, 'midias'> & { midias: readonly string[] }): ArgsDaRegra {
  return {
    igUserId: e.igUserId,
    palavra: e.palavra,
    texto: e.texto,
    bioLinkId: e.bioLinkId,
    destinoAprovado: e.destinoAprovado,
    midias: [...new Set(e.midias)].sort(),
  };
}

/** O teto por dia de uma regra: o padrão, preso entre 1 e o teto do catálogo. */
export function tetoDaRegra(pedido?: number | null): number {
  const n = Number.isInteger(pedido) ? (pedido as number) : PAUTA_DM_TETO_POR_DIA_PADRAO;
  return Math.min(Math.max(n, 1), PAUTA_DM_TETO_POR_DIA_MAXIMO);
}

/**
 * Quantos usos o item pode somar na vida inteira: o teto do dia vezes os dias
 * que ele pode durar. O freio que vale é o do dia; este só impede um item de
 * viver além do que foi assinado.
 */
export function usoMaximoDaRegra(tetoPorDia: number): number {
  return tetoPorDia * DIAS_DO_ITEM;
}

/**
 * A janela do item: da primeira publicação da matéria (o slot, ou a data em
 * que o post saiu) até 7 dias depois (D-MC9.4), sem passar do que um lote vale
 * a partir de agora. Nulo quando não há o que responder (nenhum horário, ou a
 * janela já fechou).
 */
export function janelaDaRegra(
  inicios: readonly Date[],
  agora: Date,
  validadeMaximaDoLoteMs: number,
): { janelaDe: Date; janelaAte: Date } | null {
  if (!inicios.length) return null;
  const janelaDe = new Date(Math.min(...inicios.map((d) => d.getTime())));
  const ate = Math.min(janelaDe.getTime() + PAUTA_DM_JANELA_DIAS * DIA_MS, agora.getTime() + validadeMaximaDoLoteMs - 60_000);
  if (ate <= Math.max(janelaDe.getTime(), agora.getTime())) return null;
  return { janelaDe, janelaAte: new Date(ate) };
}

/** Agora está dentro da janela de horário da política, no fuso dela? Janela ilegível conta como fora (falha fechada). */
export function dentroDoHorario(agora: Date, janela: readonly [string, string], fuso: string): boolean {
  return !foraDaJanela(minutosNoFuso(agora, fuso), janela);
}

/**
 * Quando a janela de horário abre de novo: hoje no começo dela, se ainda não
 * abriu, ou amanhã. É até aí que o envio fora do horário fica segurado.
 */
export function proximaAbertura(agora: Date, janela: readonly [string, string], fuso: string): Date {
  if (dentroDoHorario(agora, janela, fuso)) return agora;
  const [ini] = janela;
  const hoje = diaNoFuso(agora, fuso);
  const abreHoje = instanteNoFuso(hoje, ini, fuso);
  return abreHoje.getTime() > agora.getTime() ? abreHoje : instanteNoFuso(somarDias(hoje, 1), ini, fuso);
}

/**
 * A trava "uma DM por pessoa por regra": única enquanto a tentativa vale. A
 * regra é a matéria (`recursoDaRegra`), não o item do lote: pausada e assinada
 * de novo num lote seguinte, ela ganha outro item, e quem já recebeu não
 * recebe outra.
 */
export function travaDaPessoa(recursoId: string, pessoaHmac: string): string {
  return `${recursoId}:${pessoaHmac}`;
}

/**
 * Quanto tempo uma linha pode ficar em `enviando` antes de a passagem seguinte
 * dá-la por incerta: o processo caiu entre tomar a linha e ouvir a porta. O
 * pedido à Graph tem prazo de segundos, e a rotina roda de 10 em 10 minutos.
 */
export const PRAZO_DO_ENVIANDO_MS = 15 * 60_000;

export const MOTIVO_INCERTO = 'sem resposta da Meta: a DM pode ter saído; confira no Instagram antes de responder à mão';

export function expiraEmDoEnvio(agora: Date): Date {
  return new Date(agora.getTime() + RETENCAO_DO_ENVIO_DIAS * DIA_MS);
}

/** O que se sabe de uma recusa da Meta, lido do erro que o conector lança. */
export interface FalhaDaMeta {
  codigo: string | null;
  mensagem: string;
  semAdvancedAccess: boolean;
  /**
   * Sem corpo de erro da Meta e sem status (rede, prazo) ou com 5xx: o pedido
   * pode ter chegado e a DM pode ter saído. Não é recusa, e a trava da pessoa
   * fica.
   */
  incerto: boolean;
}

export function lerFalhaDaMeta(e: unknown): FalhaDaMeta {
  const mensagem = String((e as Error)?.message ?? e ?? 'erro desconhecido').slice(0, 400);
  const m = (e as { codigoDaMeta?: { code?: unknown; subcode?: unknown } } | null)?.codigoDaMeta;
  const code = typeof m?.code === 'number' ? m.code : null;
  const subcode = typeof m?.subcode === 'number' ? m.subcode : null;
  const codigo = code === null ? null : subcode === null ? String(code) : `${code}/${subcode}`;
  const status = (e as { status?: unknown } | null)?.status;
  const incerto = code === null && (typeof status !== 'number' || status >= 500);
  return { codigo, mensagem, semAdvancedAccess: codigo === CODIGO_SEM_ADVANCED_ACCESS, incerto };
}

/**
 * As últimas tentativas que chegaram à Meta nesta regra (as mais novas
 * primeiro) somam três recusas seguidas? Só `enviado` e `erro` contam: o que
 * nem chegou à Meta (segurado, recusado pela porta ou pelo próprio efeito,
 * ignorado) e o que ficou sem resposta (`incerto`) não dizem nada sobre ela.
 */
export function recusasSeguidasDaMeta(ultimas: readonly EnvioDeRespostaEstado[]): boolean {
  const naMeta = ultimas.filter((e) => e === 'enviado' || e === 'erro');
  return naMeta.length >= RECUSAS_QUE_PAUSAM && naMeta.slice(0, RECUSAS_QUE_PAUSAM).every((e) => e === 'erro');
}

/** A linha que o resumo da passagem leva: só números e o porquê das pausas. */
export interface ResumoDaDm {
  enviadas: number;
  seguradas: number;
  ignoradas: number;
  noTeto: number;
  recusadas: number;
  erros: number;
  pausadas: string[];
  semTempo: number;
  incertos: number;
  /** O começo da janela de horário da política (`08:00`), para dizer até quando a segurada espera. */
  abertura: string;
}

export function linhaDoResumoDaDm(r: ResumoDaDm): string {
  const partes = [`DM automática: ${r.enviadas} enviada(s)`];
  if (r.seguradas) partes.push(`${r.seguradas} segurada(s) até a janela abrir (${r.abertura})`);
  if (r.ignoradas) partes.push(`${r.ignoradas} da mesma pessoa, ignorada(s)`);
  if (r.noTeto) partes.push(`${r.noTeto} esperando o teto do dia virar`);
  if (r.semTempo) partes.push(`${r.semTempo} sem tempo antes de a janela abrir (fica(m) à mão)`);
  if (r.recusadas) partes.push(`${r.recusadas} recusada(s) pela porta`);
  if (r.erros) partes.push(`${r.erros} recusada(s) pela Meta`);
  if (r.incertos) partes.push(`${r.incertos} sem resposta da Meta (pode ter saído)`);
  if (r.pausadas.length) partes.push(`regra(s) pausada(s): ${r.pausadas.join('; ')}`);
  return partes.join(' · ');
}
