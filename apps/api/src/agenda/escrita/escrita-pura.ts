import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  CAPACIDADES_DA_AGENDA,
  PROPRIEDADES_DO_OS,
  SOCIOS_DA_AGENDA,
  lerCompromisso,
  montarTituloDeCompromisso,
  type LinhaDoHistorico,
  type NovoCompromisso,
  type PedidoDeEscrita,
  type RetratoDoCompromisso,
  type SocioDaAgenda,
  type TipoDeCompromisso,
  type TipoQueSeMarca,
} from '@mktos/shared';

/*
 * A ESCRITA DA AGENDA — a parte pura (agenda v2, 29/10/2026, lane G4).
 *
 * O que a escrita no Google (`google/agenda-escrita.google.ts`), o serviço da
 * escrita (`escrita.service.ts`) e o histórico precisam calcular igual: o id do
 * evento que sai da chave do pedido, o retrato de um evento do Google, a
 * conferência "o evento de agora ainda é o que a pessoa viu", o título pela
 * gramática, os argumentos do catálogo de cada pedido e o desfazer de cada
 * escrita. Sem relógio, sem rede, sem banco (o sorteio da chave nova é a única
 * exceção, e tem nome).
 */

/* ---------------------------------------------------------------------------
 * O evento do Google, no pedaço que a agenda lê
 * ------------------------------------------------------------------------- */

export interface EventoDoGoogle {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email?: string; responseStatus?: string; organizer?: boolean; self?: boolean }>;
  organizer?: { email?: string; self?: boolean };
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}

/* ---------------------------------------------------------------------------
 * A chave do pedido e o id do evento
 * ------------------------------------------------------------------------- */

/** O alfabeto que o Google aceita no id de evento (base32hex, minúsculo). */
const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

/** O formato da chave no catálogo (`argsSchema.chave.pattern`). */
export const CHAVE_DO_PEDIDO = /^[a-v0-9]{10,64}$/;

function emBase32hex(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      saida += BASE32HEX[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += BASE32HEX[(valor << (5 - bits)) & 31];
  return saida;
}

/** Uma chave nova para um pedido (26 caracteres, 130 bits). */
export function novaChave(): string {
  return emBase32hex(randomBytes(17)).slice(0, 26);
}

/**
 * O id do evento que o `marcar` cria: DERIVADO da chave do pedido e da empresa.
 * A mesma chave dá o mesmo id, então repetir o pedido não duplica o evento (o
 * Google responde 409 e o efeito devolve o que já existe). Passa pelo hash para
 * que quem escolhe a chave não escolha o id de um evento que já está lá.
 */
export function eventoIdDaChave(orgId: string, chave: string): string {
  const h = createHash('sha256').update(`mktos-agenda:${orgId}:${chave}`, 'utf8').digest();
  return `os${emBase32hex(h).slice(0, 30)}`;
}

/* ---------------------------------------------------------------------------
 * O retrato e a conferência "ainda é o que a pessoa viu"
 * ------------------------------------------------------------------------- */

export function meetDoEvento(e: EventoDoGoogle): string | null {
  if (e.hangoutLink) return e.hangoutLink;
  const v = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video' && p.uri);
  return v?.uri ?? null;
}

export function retratoDoEvento(e: EventoDoGoogle): RetratoDoCompromisso {
  return {
    titulo: (e.summary ?? '').trim(),
    inicio: e.start?.dateTime ?? e.start?.date ?? '',
    fim: e.end?.dateTime ?? e.end?.date ?? '',
    local: e.location?.trim() ? e.location.trim() : null,
    meet: Boolean(meetDoEvento(e)),
  };
}

const mesmoInstante = (a: string, b: string): boolean => {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x === y : a.trim() === b.trim();
};
const espacos = (v: string | null | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim();

/**
 * O que mudou entre o que a pessoa viu (`antes`) e o evento de agora. Vazio =
 * bate, e a escrita pode seguir. A frase vai para a tela.
 */
export function diferencasDoRetrato(antes: RetratoDoCompromisso, agora: RetratoDoCompromisso): string[] {
  const d: string[] = [];
  if (espacos(antes.titulo) !== espacos(agora.titulo)) d.push('o título');
  if (!mesmoInstante(antes.inicio, agora.inicio)) d.push('o início');
  if (!mesmoInstante(antes.fim, agora.fim)) d.push('o fim');
  if ((espacos(antes.local) || null) !== (espacos(agora.local) || null)) d.push('o local');
  if (Boolean(antes.meet) !== Boolean(agora.meet)) d.push('o Meet');
  return d;
}

/** Os campos que mudam o título. */
export const CAMPOS_DO_TITULO = ['tipo', 'cliente', 'responsaveis', 'modalidade'] as const;

/** O tipo que o painel escreve, a partir do tipo lido. Feriado e "outro" não têm forma de escrita. */
export function tipoQueSeMarcaDe(tipo: TipoDeCompromisso): TipoQueSeMarca | null {
  switch (tipo) {
    case 'cliente':
    case 'interna':
    case 'pessoal':
    case 'fora':
      return tipo;
    case 'fechado':
      return 'bloqueio';
    default:
      return null;
  }
}

/** Só cliente e interna ganham Meet: bloqueio, pessoal e Fora não são conversa. */
export const tipoComMeet = (tipo: TipoQueSeMarca): boolean => tipo === 'cliente' || tipo === 'interna';

/**
 * O título de um alterar: o título lido pela gramática com os campos novos por
 * cima. Lança (com a frase da gramática) quando falta o que a forma exige.
 */
export function tituloDoAlterar(
  tituloAtual: string,
  depois: { tipo?: TipoQueSeMarca; cliente?: string; responsaveis?: SocioDaAgenda[]; modalidade?: 'online' | 'presencial' },
): { titulo: string; tipo: TipoQueSeMarca } {
  const leitura = lerCompromisso(tituloAtual);
  const tipo = depois.tipo ?? tipoQueSeMarcaDe(leitura.tipo);
  if (!tipo) throw new Error('O título de agora não está no padrão da casa: diga o tipo do compromisso.');
  const titulo = montarTituloDeCompromisso({
    tipo,
    modalidade: depois.modalidade ?? leitura.modalidade ?? 'online',
    cliente: depois.cliente ?? leitura.cliente ?? undefined,
    responsaveis: depois.responsaveis ?? leitura.responsaveis,
    motivo: leitura.motivo ?? undefined,
  });
  return { titulo, tipo };
}

/* ---------------------------------------------------------------------------
 * O pedido (validação do corpo de `POST /agenda/escritas`)
 * ------------------------------------------------------------------------- */

const Socio = z.enum(SOCIOS_DA_AGENDA as unknown as [SocioDaAgenda, ...SocioDaAgenda[]]);
const Tipo = z.enum(['cliente', 'interna', 'bloqueio', 'pessoal', 'fora']);
const Modalidade = z.enum(['online', 'presencial']);
const Instante = z.string().min(10).max(40).refine((v) => Number.isFinite(Date.parse(v)), 'data e hora ISO 8601');
const Chave = z.string().regex(CHAVE_DO_PEDIDO, 'chave do pedido: 10 a 64 caracteres de a a v e 0 a 9');
const EventoId = z.string().regex(/^[A-Za-z0-9_@.-]{3,1024}$/, 'id de evento do Google Agenda');
const Titulo = z.string().min(1).max(500);
const Forcado = z.object({ motivo: z.string().trim().min(3).max(300) }).strict();

export const NovoCompromissoSchema = z.object({
  tipo: Tipo,
  modalidade: Modalidade,
  cliente: z.string().trim().min(1).max(120).optional(),
  leadId: z.string().max(64).optional(),
  clienteId: z.string().max(64).optional(),
  responsaveis: z.array(Socio).min(1).max(3),
  inicio: Instante,
  fim: Instante,
  local: z.string().trim().max(300).optional(),
  pauta: z.string().max(4000).optional(),
  convidados: z.array(z.string().trim().toLowerCase().email().max(254)).max(30).optional(),
  motivo: z.string().trim().min(1).max(120).optional(),
}).strict();

const Retrato = z.object({
  titulo: z.string().max(500),
  inicio: z.string().max(40),
  fim: z.string().max(40),
  local: z.string().max(300).nullable(),
  meet: z.boolean(),
}).strict();

export const PedidoDeEscritaSchema = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('marcar'), chave: Chave, compromisso: NovoCompromissoSchema, forcado: Forcado.optional() }).strict(),
  z.object({
    acao: z.literal('alterar'),
    chave: Chave,
    eventoId: EventoId,
    antes: Retrato,
    depois: z.object({
      inicio: Instante.optional(),
      fim: Instante.optional(),
      modalidade: Modalidade.optional(),
      responsaveis: z.array(Socio).min(1).max(3).optional(),
      tipo: Tipo.optional(),
      cliente: z.string().trim().min(1).max(120).optional(),
      local: z.string().trim().max(300).nullable().optional(),
      criarMeet: z.boolean().optional(),
      confirmadoComCliente: z.boolean().optional(),
    }).strict().refine((d) => Object.keys(d).length > 0, 'diga o que muda'),
    forcado: Forcado.optional(),
  }).strict(),
  z.object({ acao: z.literal('cancelar'), chave: Chave, eventoId: EventoId, tituloAtual: Titulo, motivo: z.string().trim().min(3).max(300), avisar: z.boolean() }).strict(),
  z.object({ acao: z.literal('desmarcar'), chave: Chave, eventoId: EventoId, tituloAtual: Titulo }).strict(),
  z.object({ acao: z.literal('reabrir'), chave: Chave, eventoId: EventoId, tituloAtual: Titulo }).strict(),
]);

/* ---------------------------------------------------------------------------
 * Do pedido aos argumentos do catálogo
 * ------------------------------------------------------------------------- */

export interface ChamadaDaPorta {
  capacidade: string;
  args: Record<string, unknown>;
  resource: { type: string; id: string };
}

const RESPONSAVEL_TODOS = 'Todos';

/** O `responsavel` antigo do catálogo (obrigatório no marcar): o primeiro, ou Todos quando vão os três. */
export function responsavelDoTitulo(responsaveis: readonly SocioDaAgenda[]): string {
  const unicos = [...new Set(responsaveis)];
  return unicos.length === SOCIOS_DA_AGENDA.length ? RESPONSAVEL_TODOS : (unicos[0] ?? '');
}

/**
 * Os argumentos do catálogo para um pedido. `convidadosDaEquipe` são os e-mails
 * dos responsáveis lidos da Equipe (só cliente e interna os recebem).
 */
export function chamadaDoPedido(pedido: PedidoDeEscrita, convidadosDaEquipe: readonly string[] = []): ChamadaDaPorta {
  switch (pedido.acao) {
    case 'marcar': {
      const c: NovoCompromisso = pedido.compromisso;
      const conversa = tipoComMeet(c.tipo);
      const convidados = conversa
        ? [...new Set([...(c.convidados ?? []), ...convidadosDaEquipe].map((e) => e.trim().toLowerCase()).filter(Boolean))]
        : [];
      return {
        capacidade: CAPACIDADES_DA_AGENDA.marcar,
        args: {
          chave: pedido.chave,
          tipo: c.tipo,
          modalidade: c.modalidade,
          ...(c.tipo === 'cliente' && c.cliente ? { cliente: c.cliente } : {}),
          responsavel: responsavelDoTitulo(c.responsaveis),
          responsaveis: [...new Set(c.responsaveis)],
          inicio: c.inicio,
          fim: c.fim,
          ...(c.pauta ? { pauta: c.pauta } : {}),
          ...(c.local && c.modalidade === 'presencial' ? { local: c.local } : {}),
          ...(convidados.length ? { convidados } : {}),
          ...(c.tipo === 'fora' && c.motivo ? { motivo: c.motivo } : {}),
          ...(c.leadId ? { leadId: c.leadId } : {}),
          ...(c.clienteId ? { clienteId: c.clienteId } : {}),
          ...(pedido.forcado ? { forcado: { motivo: pedido.forcado.motivo } } : {}),
        },
        resource: {
          type: CAPACIDADES_DA_AGENDA.marcar,
          id: c.tipo === 'cliente' ? (c.cliente ?? 'cliente') : c.tipo,
        },
      };
    }
    case 'alterar':
      return {
        capacidade: CAPACIDADES_DA_AGENDA.alterar,
        args: {
          chave: pedido.chave,
          eventoId: pedido.eventoId,
          antes: { ...pedido.antes, local: pedido.antes.local ?? null },
          depois: { ...pedido.depois },
          ...(pedido.forcado ? { forcado: { motivo: pedido.forcado.motivo } } : {}),
        },
        resource: { type: CAPACIDADES_DA_AGENDA.alterar, id: pedido.eventoId },
      };
    case 'cancelar':
      return {
        capacidade: CAPACIDADES_DA_AGENDA.cancelar,
        args: { chave: pedido.chave, eventoId: pedido.eventoId, tituloAtual: pedido.tituloAtual, motivo: pedido.motivo, avisar: pedido.avisar },
        resource: { type: CAPACIDADES_DA_AGENDA.cancelar, id: pedido.eventoId },
      };
    case 'desmarcar':
      return {
        capacidade: CAPACIDADES_DA_AGENDA.desmarcar,
        args: { chave: pedido.chave, eventoId: pedido.eventoId, tituloAtual: pedido.tituloAtual },
        resource: { type: CAPACIDADES_DA_AGENDA.desmarcar, id: pedido.eventoId },
      };
    case 'reabrir':
      return {
        capacidade: CAPACIDADES_DA_AGENDA.reabrir,
        args: { chave: pedido.chave, eventoId: pedido.eventoId, tituloAtual: pedido.tituloAtual },
        resource: { type: CAPACIDADES_DA_AGENDA.reabrir, id: pedido.eventoId },
      };
  }
}

/* ---------------------------------------------------------------------------
 * O desfazer de cada escrita
 * ------------------------------------------------------------------------- */

/**
 * O retrato do evento DEPOIS de um alterar, calculado só pelo pedido (quando o
 * resultado do Google não está à mão: a execução que saiu da fila). O título é
 * o da gramática; o Meet acrescentado fica (nunca se tira).
 */
export function retratoDepoisDoAlterar(
  antes: RetratoDoCompromisso,
  depois: Extract<PedidoDeEscrita, { acao: 'alterar' }>['depois'],
): RetratoDoCompromisso | null {
  let titulo = antes.titulo;
  let tipo: TipoQueSeMarca | null = tipoQueSeMarcaDe(lerCompromisso(antes.titulo).tipo);
  if (CAMPOS_DO_TITULO.some((c) => depois[c] !== undefined)) {
    try {
      const r = tituloDoAlterar(antes.titulo, depois);
      titulo = r.titulo;
      tipo = r.tipo;
    } catch {
      return null;
    }
  }
  const querMeet = depois.criarMeet === true || (depois.modalidade === 'online' && !!tipo && tipoComMeet(tipo));
  return {
    titulo,
    inicio: depois.inicio ?? antes.inicio,
    fim: depois.fim ?? antes.fim,
    local: depois.local !== undefined ? (depois.local?.trim() || null) : antes.local,
    meet: antes.meet || querMeet,
  };
}

/**
 * O pedido que desfaz uma escrita que SAIU. `resultado` é o que o efeito
 * devolveu (com `evento` e, no alterar, `anterior` e `depois`), quando houver.
 * Nulo quando não há volta pelo OS (o reabrir fecha a cadeia).
 */
export function desfazerDaEscrita(
  pedido: PedidoDeEscrita,
  resultado: { id?: string | null; titulo?: string | null; anterior?: RetratoDoCompromisso | null; depois?: RetratoDoCompromisso | null } | null,
  orgId: string,
  chave: string = novaChave(),
): PedidoDeEscrita | null {
  switch (pedido.acao) {
    case 'marcar': {
      const eventoId = resultado?.id || eventoIdDaChave(orgId, pedido.chave);
      let titulo = resultado?.titulo ?? null;
      if (!titulo) {
        try {
          titulo = montarTituloDeCompromisso(pedido.compromisso);
        } catch {
          return null;
        }
      }
      return { acao: 'desmarcar', chave, eventoId, tituloAtual: titulo };
    }
    case 'alterar': {
      const anterior = resultado?.anterior ?? pedido.antes;
      const agora = resultado?.depois ?? retratoDepoisDoAlterar(pedido.antes, pedido.depois);
      if (!agora) return null;
      const volta: Extract<PedidoDeEscrita, { acao: 'alterar' }>['depois'] = {};
      if (pedido.depois.inicio !== undefined) volta.inicio = anterior.inicio;
      if (pedido.depois.fim !== undefined) volta.fim = anterior.fim;
      if (pedido.depois.local !== undefined) volta.local = anterior.local;
      if (pedido.depois.confirmadoComCliente !== undefined) volta.confirmadoComCliente = !pedido.depois.confirmadoComCliente;
      if (CAMPOS_DO_TITULO.some((c) => pedido.depois[c] !== undefined)) {
        // O título de antes volta pela gramática: só dá quando ele estava no padrão.
        const leitura = lerCompromisso(anterior.titulo);
        const tipo = tipoQueSeMarcaDe(leitura.tipo);
        if (!tipo) return null;
        volta.tipo = tipo;
        if (leitura.responsaveis.length) volta.responsaveis = leitura.responsaveis;
        if (leitura.modalidade) volta.modalidade = leitura.modalidade;
        if (leitura.cliente) volta.cliente = leitura.cliente;
      }
      if (Object.keys(volta).length === 0) return null;
      return { acao: 'alterar', chave, eventoId: pedido.eventoId, antes: agora, depois: volta };
    }
    case 'cancelar':
    case 'desmarcar':
      return { acao: 'reabrir', chave, eventoId: pedido.eventoId, tituloAtual: pedido.tituloAtual };
    case 'reabrir':
      return null;
  }
}

/* ---------------------------------------------------------------------------
 * O histórico (lido do RASTRO da porta: `ToolCall`)
 * ------------------------------------------------------------------------- */

const VERBO: Record<string, string> = {
  [CAPACIDADES_DA_AGENDA.marcar]: 'marcou',
  [CAPACIDADES_DA_AGENDA.alterar]: 'alterou',
  [CAPACIDADES_DA_AGENDA.cancelar]: 'cancelou',
  [CAPACIDADES_DA_AGENDA.desmarcar]: 'desmarcou',
  [CAPACIDADES_DA_AGENDA.reabrir]: 'reabriu',
  'agenda.evento.padronizar': 'padronizou',
  'agenda.evento.restaurar': 'restaurou',
};

/** As capacidades que o histórico lê. */
export const CAPACIDADES_DO_HISTORICO = Object.keys(VERBO);

export interface ChamadaRegistrada {
  id: string;
  criadoEm: Date;
  capabilityId: string | null;
  actorId: string | null;
  agentSlug: string | null;
  status: 'executado' | 'aguardando_aprovacao' | 'recusado' | 'erro';
  args: unknown;
  resultado: unknown;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** O pedido de volta, a partir dos argumentos gravados na porta (sem o corpo do Google). */
function pedidoDosArgs(capacidade: string, a: Record<string, unknown>): PedidoDeEscrita | null {
  const chave = texto(a.chave);
  if (!chave) return null;
  if (capacidade === CAPACIDADES_DA_AGENDA.marcar) {
    const responsaveis = (Array.isArray(a.responsaveis) ? a.responsaveis : []) as SocioDaAgenda[];
    if (!responsaveis.length) return null;
    return {
      acao: 'marcar',
      chave,
      compromisso: {
        tipo: a.tipo as TipoQueSeMarca,
        modalidade: a.modalidade === 'presencial' ? 'presencial' : 'online',
        ...(texto(a.cliente) ? { cliente: texto(a.cliente)! } : {}),
        responsaveis,
        inicio: String(a.inicio ?? ''),
        fim: String(a.fim ?? ''),
        ...(texto(a.motivo) ? { motivo: texto(a.motivo)! } : {}),
      },
    };
  }
  const eventoId = texto(a.eventoId);
  if (!eventoId) return null;
  if (capacidade === CAPACIDADES_DA_AGENDA.alterar && a.antes && a.depois) {
    return { acao: 'alterar', chave, eventoId, antes: a.antes as RetratoDoCompromisso, depois: a.depois as never };
  }
  const tituloAtual = texto(a.tituloAtual) ?? '';
  if (capacidade === CAPACIDADES_DA_AGENDA.cancelar) {
    return { acao: 'cancelar', chave, eventoId, tituloAtual, motivo: String(a.motivo ?? ''), avisar: a.avisar === true };
  }
  if (capacidade === CAPACIDADES_DA_AGENDA.desmarcar) return { acao: 'desmarcar', chave, eventoId, tituloAtual };
  if (capacidade === CAPACIDADES_DA_AGENDA.reabrir) return { acao: 'reabrir', chave, eventoId, tituloAtual };
  return null;
}

/** O título que a linha mostra: o que o OS escreveu (marcar) ou o que a pessoa viu. */
function tituloDaLinha(capacidade: string, a: Record<string, unknown>, resultado: Record<string, unknown> | null): string | null {
  const doResultado = texto(resultado?.titulo);
  if (doResultado) return doResultado;
  if (capacidade === CAPACIDADES_DA_AGENDA.marcar) {
    try {
      const responsaveis = (Array.isArray(a.responsaveis) && a.responsaveis.length ? a.responsaveis : [a.responsavel]) as string[];
      return montarTituloDeCompromisso({
        tipo: a.tipo as TipoQueSeMarca,
        modalidade: a.modalidade === 'presencial' ? 'presencial' : 'online',
        cliente: texto(a.cliente) ?? undefined,
        responsaveis: responsaveis.flatMap((r) => (r === RESPONSAVEL_TODOS ? [...SOCIOS_DA_AGENDA] : [r])),
        motivo: texto(a.motivo) ?? undefined,
      });
    } catch {
      return null;
    }
  }
  if (capacidade === CAPACIDADES_DA_AGENDA.alterar) return texto((a.antes as Record<string, unknown> | undefined)?.titulo);
  if (capacidade === 'agenda.evento.padronizar') return texto(a.tituloNovo);
  if (capacidade === 'agenda.evento.restaurar') return texto(a.tituloOriginal);
  return texto(a.tituloAtual);
}

/** Uma linha do histórico. `nome` traduz o id de quem pediu. */
export function linhaDoHistorico(
  c: ChamadaRegistrada,
  orgId: string,
  nome: (actorId: string | null, agentSlug: string | null) => string | null,
): LinhaDoHistorico | null {
  const capacidade = c.capabilityId ?? '';
  if (!VERBO[capacidade]) return null;
  const a = (c.args && typeof c.args === 'object' ? c.args : {}) as Record<string, unknown>;
  const resultado = c.resultado && typeof c.resultado === 'object' ? (c.resultado as Record<string, unknown>) : null;
  const eventoId = texto(resultado?.id)
    ?? texto(a.eventoId)
    ?? (capacidade === CAPACIDADES_DA_AGENDA.marcar && texto(a.chave) ? eventoIdDaChave(orgId, texto(a.chave)!) : null);
  const forcado = a.forcado && typeof a.forcado === 'object' && texto((a.forcado as Record<string, unknown>).motivo)
    ? { motivo: texto((a.forcado as Record<string, unknown>).motivo)! }
    : null;
  let desfazer: PedidoDeEscrita | null = null;
  if (c.status === 'executado') {
    const pedido = pedidoDosArgs(capacidade, a);
    if (pedido) {
      desfazer = desfazerDaEscrita(
        pedido,
        resultado
          ? {
              id: texto(resultado.id),
              titulo: texto(resultado.titulo),
              anterior: (resultado.anterior as RetratoDoCompromisso | undefined) ?? null,
              depois: (resultado.depois as RetratoDoCompromisso | undefined) ?? null,
            }
          : null,
        orgId,
      );
    }
  }
  return {
    id: c.id,
    quando: c.criadoEm.toISOString(),
    quem: nome(c.actorId, c.agentSlug),
    verbo: VERBO[capacidade],
    capacidade,
    eventoId,
    titulo: tituloDaLinha(capacidade, a, resultado),
    status: c.status,
    forcado,
    desfazer,
  };
}

/** As chaves privadas que o OS grava no evento (re-exportadas para o efeito). */
export { PROPRIEDADES_DO_OS };
