import { DIAS_DA_AGENDA_DO_CARTAO, lerTituloDeReuniao, normalizarParaAgenda, type ProximaReuniaoDoCartao } from '@mktos/shared';

/*
 * A PRÓXIMA REUNIÃO DO CLIENTE NO CARTÃO: a parte que CASA (rodada de produção 2,
 * M1, S1, 22/10/2026).
 *
 * PURO: sem rede, sem banco, sem relógio (o "agora" entra por parâmetro). O
 * serviço lê a agenda UMA vez por empresa e por passagem, pela porta, e entrega
 * aqui os eventos e os cards; aqui só se decide qual evento é de qual card.
 *
 * A REGRA, nesta ordem:
 *   1. pelo E-MAIL: um e-mail de contato do card está entre os participantes do
 *      evento. Um card só casa; dois ou mais = dúvida, e não casa;
 *   2. sem e-mail que case, pelo NOME do cliente no título, conforme a regra de
 *      título da Root (`lerTituloDeReuniao` do shared: `Reunião Online -
 *      Cliente - Pedro`). O nome tem de ser IGUAL a um nome do card (sem
 *      diferença de maiúscula, acento e espaço): nome parcial não casa. Dois
 *      cards com o mesmo nome = dúvida, e não casa;
 *   3. e-mail e título apontando para cards diferentes = dúvida, e não casa.
 *
 * Fica de fora: evento cancelado, evento que já acabou, evento além da janela
 * (14 dias) e título de reunião interna (que nunca casa pelo nome).
 */

const DIA_MS = 86_400_000;

/** O recorte de um evento que a regra usa (o mesmo formato de `comunicacao.agenda.periodo`). */
export interface EventoDaAgenda {
  id: string;
  title: string | null;
  start: string | null;
  end?: string | null;
  diaInteiro?: boolean;
  status?: string | null;
  attendees?: readonly string[] | null;
  organizador?: string | null;
}

/** O que a regra sabe de um card: os e-mails do contato e os nomes do cliente. */
export interface CartaoParaCasar {
  cardId: string;
  emails: readonly (string | null | undefined)[];
  nomes: readonly (string | null | undefined)[];
}

const emailLimpo = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/** Data sem hora (`2026-10-23`): dia inteiro, meia-noite em São Paulo. */
const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** O instante de início (ou de fim) do evento; nulo quando não dá para ler. */
export function instanteDoEvento(v: string | null | undefined): Date | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(SO_DATA.test(s) ? `${s}T00:00:00-03:00` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Casa os eventos com os cards e devolve, por card, a PRÓXIMA reunião (a de
 * início mais cedo entre as que ainda não acabaram e começam dentro da janela).
 */
export function casarReunioes(
  eventos: readonly EventoDaAgenda[],
  cartoes: readonly CartaoParaCasar[],
  agora: Date,
  dias: number = DIAS_DA_AGENDA_DO_CARTAO,
): Map<string, ProximaReuniaoDoCartao> {
  const limite = agora.getTime() + dias * DIA_MS;
  const porEmail = new Map<string, Set<string>>();
  const porNome = new Map<string, Set<string>>();
  for (const c of cartoes) {
    for (const e of c.emails) {
      const k = emailLimpo(e);
      if (k.includes('@')) (porEmail.get(k) ?? porEmail.set(k, new Set()).get(k)!).add(c.cardId);
    }
    for (const n of c.nomes) {
      const k = normalizarParaAgenda(n);
      if (k.length >= 3) (porNome.get(k) ?? porNome.set(k, new Set()).get(k)!).add(c.cardId);
    }
  }

  const saida = new Map<string, ProximaReuniaoDoCartao>();
  for (const e of eventos) {
    if (!e?.id) continue;
    if (String(e.status ?? '').toLowerCase() === 'cancelled') continue;
    const inicio = instanteDoEvento(e.start);
    if (!inicio) continue;
    const fim = instanteDoEvento(e.end) ?? inicio;
    if (fim.getTime() <= agora.getTime() && inicio.getTime() <= agora.getTime()) continue;
    if (inicio.getTime() > limite) continue;

    const pelosEmails = new Set<string>();
    for (const a of e.attendees ?? []) for (const id of porEmail.get(emailLimpo(a)) ?? []) pelosEmails.add(id);
    const titulo = lerTituloDeReuniao(e.title);
    const pelosNomes = titulo?.tipo === 'cliente' ? porNome.get(normalizarParaAgenda(titulo.cliente)) ?? new Set<string>() : new Set<string>();

    let card: string | null = null;
    let casadoPor: ProximaReuniaoDoCartao['casadoPor'] = 'email';
    if (pelosEmails.size === 1) {
      const [unico] = pelosEmails;
      // O título nomeia OUTRO card: dúvida.
      if (pelosNomes.size > 0 && !pelosNomes.has(unico)) continue;
      card = unico;
    } else if (pelosEmails.size === 0 && pelosNomes.size === 1) {
      [card] = pelosNomes;
      casadoPor = 'nome';
    } else {
      continue;
    }

    const antes = saida.get(card);
    if (antes && new Date(antes.inicio).getTime() <= inicio.getTime()) continue;
    saida.set(card, {
      inicio: inicio.toISOString(),
      diaInteiro: !!e.diaInteiro || SO_DATA.test(String(e.start ?? '').trim()),
      titulo: String(e.title ?? '').trim(),
      casadoPor,
    });
  }
  return saida;
}
