import {
  CAPACIDADE_DE_APROVAR_A_SEMANA,
  INSTAGRAM_ESCOPO_DE_PUBLICAR,
  PAUTA_CAPACIDADE_DE_PUBLICAR_NO_INSTAGRAM,
  PAUTA_JANELA_DA_PUBLICACAO_MS,
  type PautaPecaStatus,
  type PautaPublicacaoEstado,
} from '@mktos/shared';
import { motivoParaNaoAprovarDaSemana } from './derivacao-do-episodio';
import {
  ESTADOS_EM_CURSO,
  argsDaPublicacao,
  motivoParaNaoPublicar,
  type ArgsDaPublicacao,
  type ContaParaPublicar,
  type PecaParaPublicar,
} from './publicacao-instagram';

/*
 * APROVAR A SEMANA NUM PONTO SÓ (MD8) — a parte pura.
 *
 * O lote da semana é uma lista de publicações: cada item é o pedido EXATO de
 * `instagram.post.publicar` de uma peça (a legenda final, as mídias com o
 * sha256, a conta e o horário), com a janela do slot até 2 h depois. Aqui mora
 * o que decide se uma peça entra, a peça "como ficará" depois de assinada (é
 * dela que sai o hash que a titular assina) e o texto de cada recusa. O banco
 * fica no serviço (`lote-da-semana.service.ts`).
 */

export const CAPACIDADE_DO_ITEM = PAUTA_CAPACIDADE_DE_PUBLICAR_NO_INSTAGRAM;
export const CAPACIDADE_DO_LOTE = CAPACIDADE_DE_APROVAR_A_SEMANA;
/** O tipo de recurso do lote da semana: o episódio. */
export const RECURSO_DO_LOTE = 'pauta_episodio';
/** A validade máxima de um lote de `pauta.semana.aprovar` no catálogo (8 dias). */
export const VALIDADE_MAXIMA_DO_LOTE_MS = 8 * 86_400_000;

/** A peça da semana como o lote a lê. */
export interface PecaDoLote extends PecaParaPublicar {
  slotProposto: Date | null;
}

/** O slot da peça: a agenda da aprovada ou o proposto pelo encadeamento (MD1). */
export function slotDaPeca(p: Pick<PecaDoLote, 'agendadaPara' | 'slotProposto'>): Date | null {
  return p.agendadaPara ?? p.slotProposto ?? null;
}

/**
 * A peça como ela fica quando a assinatura a aprova: `aprovada`, no slot. É
 * sobre ela que o hash do item é calculado — no pedido, na tela da titular, na
 * ativação e, depois, na porta, quando o executor manda publicar.
 */
export function pecaComoAprovada(p: PecaDoLote): PecaParaPublicar {
  return { ...p, status: 'aprovada', agendadaPara: slotDaPeca(p) };
}

/** Os argumentos do item: os mesmos que o executor mandará à porta no horário. */
export function argsDoItem(p: PecaDoLote, conta: ContaParaPublicar): ArgsDaPublicacao {
  return argsDaPublicacao(pecaComoAprovada(p), conta);
}

/** A janela do item: do slot a slot + 2 h (a mesma que a rotina usa para dar a peça por perdida). */
export function janelaDoItem(slot: Date): { janelaDe: Date; janelaAte: Date } {
  return { janelaDe: slot, janelaAte: new Date(slot.getTime() + PAUTA_JANELA_DA_PUBLICACAO_MS) };
}

/**
 * O que impede a SEMANA inteira, antes de olhar peça por peça. A página de
 * links no ar primeiro: sem ela o `/r/` da legenda não redireciona.
 */
export function impedimentosDaSemana(e: {
  status: string;
  paginaNoAr: boolean;
  conta: ContaParaPublicar | null;
  /** `PAUTA_MIDIA_PUBLICA_SEGREDO` e a origem: sem eles a Meta não tem de onde baixar, e cada post cairia no slot. */
  midiaPublicaLigada: boolean;
}): string[] {
  const saida: string[] = [];
  if (e.status !== 'derivacao' && e.status !== 'agendado') {
    saida.push('A semana se aprova na Derivação ou no Agendado: gere a semana de posts antes.');
  }
  if (!e.paginaNoAr) saida.push('A página de links do episódio não está no ar: sem ela, o link da legenda não leva a lugar nenhum. Publique a página antes.');
  if (!e.conta) saida.push('A empresa não tem conta de publicação do Instagram: conecte na aba Semana.');
  else if (!e.conta.escopos.includes(INSTAGRAM_ESCOPO_DE_PUBLICAR)) saida.push('A conta conectada não deu permissão de publicar: reconecte na aba Semana.');
  else if (e.conta.status !== 'ok') saida.push(`A conta de publicação está com problema (${e.conta.status}): reconecte na aba Semana.`);
  if (!e.midiaPublicaLigada) {
    saida.push('A URL pública da mídia está desligada: defina PAUTA_MIDIA_PUBLICA_SEGREDO (32+ caracteres) no servidor. Sem ela, cada post assinado cairia para o manual na hora do slot.');
  }
  return saida;
}

/** As peças que nem aparecem na aprovação: publicadas e descartadas. */
export function entraNaAprovacao(status: PautaPecaStatus): boolean {
  return status === 'rascunho' || status === 'aprovada';
}

/**
 * Por que ESTA peça não entra no lote agora, ou nulo. Cada frase diz o que
 * fazer. A conta já foi conferida em `impedimentosDaSemana`; aqui entra só o que
 * é da peça: slot, prazo, mídia pronta (JPEG por slide ou story e mp4 do corte
 * no storage), carrossel até 10 slides e a legenda até 2.200 caracteres.
 */
export function problemaDaPeca(
  p: PecaDoLote,
  conta: ContaParaPublicar,
  agora: Date,
  ocupado: (formato: string, slot: Date, pecaId: string) => boolean,
): string | null {
  const slot = slotDaPeca(p);
  if (!slot) return 'Sem slot: rode o encadeamento para propor, ou distribua a peça aprovada na aba Semana.';
  if (slot.getTime() <= agora.getTime()) return 'O slot já passou: reagende a peça para um horário à frente.';
  if (slot.getTime() + PAUTA_JANELA_DA_PUBLICACAO_MS > agora.getTime() + VALIDADE_MAXIMA_DO_LOTE_MS) {
    return 'O slot passa dos 8 dias que um lote vale: aprove esta peça na semana dela.';
  }
  const slides = motivoParaNaoAprovarDaSemana(p.formato, p.meta);
  if (slides) return slides;
  const motivo = motivoParaNaoPublicar(pecaComoAprovada(p), conta, INSTAGRAM_ESCOPO_DE_PUBLICAR);
  if (motivo) return motivo;
  if (ocupado(p.formato, slot, p.id)) return 'Já há outra peça do mesmo formato nesse horário: reagende uma das duas.';
  return null;
}

/**
 * Quem já ocupa o horário, somando as outras candidatas do MESMO lote: duas
 * peças da semana do mesmo formato no mesmo slot entrariam juntas e seriam
 * aprovadas no mesmo minuto. A segunda (na ordem da lista) é a que fica com o
 * problema — a regra do reagendar (MC16).
 */
export function ocupadoComAsCandidatas(
  ocupado: (formato: string, slot: Date, pecaId: string) => boolean,
  candidatas: readonly Pick<PecaDoLote, 'id' | 'formato' | 'agendadaPara' | 'slotProposto'>[],
): (formato: string, slot: Date, pecaId: string) => boolean {
  const ordem = new Map(candidatas.map((c, i) => [c.id, i]));
  return (formato, slot, pecaId) => {
    if (ocupado(formato, slot, pecaId)) return true;
    const minha = ordem.get(pecaId) ?? candidatas.length;
    return candidatas.some((c, i) => i < minha && c.id !== pecaId && c.formato === formato && slotDaPeca(c)?.getTime() === slot.getTime());
  };
}

/** A publicação que a peça já tem pelo OS (MD6), como a montagem precisa lê-la. */
export interface PublicacaoEmJogo {
  estado: PautaPublicacaoEstado;
  approvalId: string | null;
  erro: string | null;
  /** O `pendente` espera uma aprovação que ainda pode ser confirmada ("Publicar agora" na fila). */
  pedidoVivo: boolean;
}

/**
 * Por que a publicação que a peça já tem a impede de entrar no lote, ou nulo.
 * A linha em `erro` ou `recusada` (a Meta recusou antes, a janela passou, voltou
 * ao manual) e o pedido que morreu na fila NÃO impedem: a assinatura do lote é a
 * autorização nova, e a ativação reabre a linha para o executor tomar.
 */
export function problemaDaPublicacao(pub: PublicacaoEmJogo | null): string | null {
  if (!pub) return null;
  if (pub.estado === 'publicada') return 'Já publicada pelo OS.';
  if (ESTADOS_EM_CURSO.includes(pub.estado)) return 'A publicação desta peça já está a caminho na Meta: espere terminar.';
  if (pub.estado === 'pendente' && pub.pedidoVivo) {
    return 'Há um "Publicar agora" desta peça esperando na fila de aprovação: resolva-o em /atendimento (ou deixe vencer) antes de pô-la no lote.';
  }
  return null;
}

/**
 * A linha que a ativação devolve a `pendente` sem pedido: `erro`, `recusada`
 * e o `pendente` cujo pedido morreu ou que guarda um erro. Sem isso o executor
 * não a toma no horário (ele só começa de `pendente` ou `erro`, e o efeito não
 * começa de `recusada`), e a semana assinada deixaria o post parado em silêncio.
 */
export function reabreNaAtivacao(pub: PublicacaoEmJogo | null): boolean {
  if (!pub) return false;
  if (pub.estado === 'erro' || pub.estado === 'recusada') return true;
  return pub.estado === 'pendente' && !pub.pedidoVivo && (!!pub.approvalId || !!pub.erro);
}

/**
 * Até quando o lote vale: o fim da última janela. Um lote de uma semana vence
 * sozinho logo depois do último post.
 */
export function validadeDoLote(janelasAte: readonly Date[]): Date {
  return new Date(Math.max(...janelasAte.map((d) => d.getTime())));
}

/**
 * Por que o item não bate mais com a peça de agora — para a titular ver ANTES
 * de assinar e para a ativação revogar. Nulo quando o hash de agora é o
 * assinado.
 */
export function divergenciaDoItem(e: {
  estadoDaPeca: PautaPecaStatus | null;
  hashAgora: string | null;
  hashItem: string;
  erroAoMontar?: string | null;
}): string | null {
  if (e.estadoDaPeca === null) return 'A peça não existe mais.';
  if (!entraNaAprovacao(e.estadoDaPeca)) return `A peça está ${e.estadoDaPeca}: não sai por este lote.`;
  if (e.erroAoMontar) return `A peça não se publica mais como está: ${e.erroAoMontar}`;
  if (e.hashAgora !== e.hashItem) return 'A peça mudou depois de o lote ser montado (texto, mídia, horário ou conta): este item não sai.';
  return null;
}

/**
 * Depois de ativo, mexer numa peça (texto, mídia, horário, status) revoga SÓ o
 * item dela (MD8 item 5). Quem mexe chama isto depois de gravar. Falhar aqui só
 * loga: o hash no consumo já recusaria o conteúdo novo, e a ativação revoga o
 * que não bate — revogar é deixar isso dito, com o motivo, na tela e no RASTRO.
 */
export async function revogarItemDaPeca(
  lotes: { revogarItensDoRecurso(orgId: string, capabilityId: string, recursoId: string, motivo: string, actorId: string): Promise<number> } | undefined,
  log: { warn(m: string): void },
  orgId: string,
  pecaId: string,
  motivo: string,
  actorId: string,
): Promise<number> {
  if (!lotes) return 0;
  try {
    return await lotes.revogarItensDoRecurso(orgId, CAPACIDADE_DO_ITEM, pecaId, motivo, actorId);
  } catch (e) {
    log.warn(`o item de lote da peça ${pecaId} não foi revogado (${motivo}): ${(e as Error).message}`);
    return 0;
  }
}

/**
 * O filtro do item de uma peça num lote ASSINADO e ainda válido — a mesma
 * definição de `LotesService.itensVivos` para o que publica. É ele que decide,
 * dentro da transação de quem troca a mídia, se a peça aprovada sai da agenda:
 * o lote montado e nunca assinado não tira do ar o fluxo manual (MC16).
 */
export function filtroDoItemAssinado(orgId: string, pecaId: string, agora: Date) {
  return {
    orgId,
    capabilityId: CAPACIDADE_DO_ITEM,
    recursoId: pecaId,
    estado: 'ativo' as const,
    lote: { estado: 'ativo' as const, validaAte: { gt: agora } },
  };
}
