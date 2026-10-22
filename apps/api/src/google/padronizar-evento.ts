import { lerTituloDeReuniao } from '@mktos/shared';

/*
 * PÔR UM EVENTO DA AGENDA NO PADRÃO (rodada dos agentes, 21/10/2026, capacidade
 * `agenda.evento.padronizar`, R3), a parte pura.
 *
 * O efeito lê o evento, confere e manda UM patch com só três campos: o título,
 * a descrição (com "Título original: <antigo>" na primeira linha) e, quando a
 * reunião é online e ainda não tem sala, o pedido de Meet. Horário, convidados,
 * local, recorrência e lembretes NUNCA vão no patch: o que não está no corpo de
 * um PATCH da Agenda fica como está. Nada é apagado.
 */

export const PREFIXO_DO_TITULO_ORIGINAL = 'Título original: ';

/** O evento foi organizado por outra agenda (um convite): nada é mudado nele. */
export const FRASE_DE_OUTRO_ORGANIZADOR =
  'quem organizou o evento não é esta agenda (é um convite de outra pessoa): nada foi alterado.';

export interface EventoLido {
  summary?: string | null;
  description?: string | null;
  hangoutLink?: string | null;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> } | null;
  status?: string | null;
  /** `organizer.self` é `true` só quando quem organizou é a própria agenda lida (o Google omite o falso). */
  organizer?: { email?: string | null; self?: boolean | null } | null;
}

export interface PedidoDePadronizacao {
  tituloAtual: string;
  tituloNovo: string;
  adicionarMeet: boolean;
}

export type PlanoDaPadronizacao =
  | { tipo: 'patch'; corpo: Record<string, unknown>; pedeMeet: boolean }
  | { tipo: 'nada'; motivo: string }
  | { tipo: 'recusa'; motivo: string };

const limpa = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** O evento já tem sala de vídeo? */
export function eventoTemMeet(e: EventoLido): boolean {
  if (limpa(e.hangoutLink)) return true;
  return (e.conferenceData?.entryPoints ?? []).some((p) => p.entryPointType === 'video' && limpa(p.uri));
}

/**
 * O que mandar ao Google. Recusa quando o título de AGORA não é o que a
 * aprovação viu (alguém mudou o evento depois da proposta), quando o título
 * novo não está no padrão da casa, quando o evento foi cancelado e quando quem
 * ORGANIZOU o evento não é a própria agenda (revisão adversarial de 21/10/2026):
 * evento de outro organizador é convite; mudar o título da cópia da casa não é
 * mudar a reunião de quem convidou, e a régua não assinou mexer nele.
 */
export function planoDaPadronizacao(evento: EventoLido, pedido: PedidoDePadronizacao, requestId: string): PlanoDaPadronizacao {
  if (evento.status === 'cancelled') return { tipo: 'recusa', motivo: 'o evento foi cancelado na Agenda.' };
  if (evento.organizer?.self !== true) {
    return { tipo: 'recusa', motivo: FRASE_DE_OUTRO_ORGANIZADOR };
  }
  const atual = limpa(evento.summary);
  if (atual !== limpa(pedido.tituloAtual)) {
    return {
      tipo: 'recusa',
      motivo: 'o título do evento mudou depois da proposta: nada foi alterado. Proponha de novo a partir do título de agora.',
    };
  }
  const novo = limpa(pedido.tituloNovo);
  if (!novo || !lerTituloDeReuniao(novo)) {
    return { tipo: 'recusa', motivo: 'o título novo não está no padrão da casa (Reunião Online|Presencial - Cliente - Responsável).' };
  }
  const pedeMeet = pedido.adicionarMeet && !eventoTemMeet(evento);
  if (novo === atual && !pedeMeet) return { tipo: 'nada', motivo: 'o evento já está no padrão.' };

  const corpo: Record<string, unknown> = { summary: novo };
  if (novo !== atual) {
    const descricao = String(evento.description ?? '');
    const linha = `${PREFIXO_DO_TITULO_ORIGINAL}${atual || '(sem título)'}`;
    // Já tem a linha (uma padronização anterior)? Não empilha outra.
    corpo.description = descricao.startsWith(PREFIXO_DO_TITULO_ORIGINAL) ? descricao : descricao ? `${linha}\n${descricao}` : linha;
  }
  if (pedeMeet) {
    corpo.conferenceData = { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  return { tipo: 'patch', corpo, pedeMeet };
}

/*
 * DESFAZER A PADRONIZAÇÃO (produção 22, 22/10/2026, capacidade
 * `agenda.evento.restaurar`, R3), a parte pura.
 *
 * A padronização guarda o título antigo na primeira linha da descrição
 * ("Título original: <antigo>") e não empilha outra linha se já houver uma, então
 * essa linha é sempre o título de ANTES da primeira padronização. Restaurar
 * devolve esse título e tira a linha: a descrição volta a ser a de antes. O Meet
 * acrescentado fica (o link pode já ter sido mandado a alguém). Recusa quando o
 * título de agora ou a linha guardada não são os que a aprovação viu, quando o
 * evento foi cancelado e quando quem organizou não é a própria agenda.
 */

export interface PedidoDeRestauracao {
  tituloAtual: string;
  tituloOriginal: string;
}

export type PlanoDaRestauracao =
  | { tipo: 'patch'; corpo: { summary: string; description: string } }
  | { tipo: 'recusa'; motivo: string };

/** A linha guardada pela padronização, ou `null` quando a descrição não começa por ela. */
export function tituloGuardado(descricao: string | null | undefined): { titulo: string; resto: string } | null {
  const d = String(descricao ?? '');
  if (!d.startsWith(PREFIXO_DO_TITULO_ORIGINAL)) return null;
  const quebra = d.indexOf('\n');
  const linha = quebra < 0 ? d : d.slice(0, quebra);
  const resto = quebra < 0 ? '' : d.slice(quebra + 1);
  const titulo = linha.slice(PREFIXO_DO_TITULO_ORIGINAL.length).replace(/\r$/, '');
  return { titulo: titulo === '(sem título)' ? '' : titulo, resto };
}

export function planoDaRestauracao(evento: EventoLido, pedido: PedidoDeRestauracao): PlanoDaRestauracao {
  if (evento.status === 'cancelled') return { tipo: 'recusa', motivo: 'o evento foi cancelado na Agenda.' };
  if (evento.organizer?.self !== true) return { tipo: 'recusa', motivo: FRASE_DE_OUTRO_ORGANIZADOR };
  if (limpa(evento.summary) !== limpa(pedido.tituloAtual)) {
    return { tipo: 'recusa', motivo: 'o título do evento mudou depois do pedido: nada foi alterado. Peça de novo a partir do título de agora.' };
  }
  const guardado = tituloGuardado(evento.description);
  if (!guardado) {
    return { tipo: 'recusa', motivo: 'a descrição não começa pela linha "Título original": não há o que restaurar, nada foi alterado.' };
  }
  const original = limpa(pedido.tituloOriginal) === '(sem título)' ? '' : limpa(pedido.tituloOriginal);
  if (limpa(guardado.titulo) !== original) {
    return { tipo: 'recusa', motivo: 'a linha "Título original" mudou depois do pedido: nada foi alterado.' };
  }
  return { tipo: 'patch', corpo: { summary: guardado.titulo, description: guardado.resto } };
}
