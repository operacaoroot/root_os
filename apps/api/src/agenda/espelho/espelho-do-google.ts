import { createHash } from 'node:crypto';

import {
  PROPRIEDADES_DO_OS,
  lerCompromisso,
  type ConvidadoDoEvento,
  type EventoDaAgenda,
  type LeituraDoCompromisso,
  type OrigemDoEvento,
  type RespostaDoConvidado,
  type SocioDaAgenda,
  type StatusDoEvento,
  type TipoDeCompromisso,
} from '@mktos/shared';

/*
 * O EVENTO DO GOOGLE DESMONTADO PARA O ESPELHO (agenda v2, 29/10/2026, lane G1).
 *
 * PURO: sem banco, sem rede, sem relógio. `linhaDoEvento` lê o corpo cru de
 * `events.list/insert/patch/get` e devolve a linha de `AgendaEvento`;
 * `eventoDaLinha` faz o caminho de volta, para a tela, a régua e o link
 * (`EventoDaAgenda`, contrato em `packages/shared/src/agenda-v2.ts`).
 *
 * DIA INTEIRO: o Google manda `date` (`2026-11-02`) sem hora. A linha guarda a
 * meia-noite de São Paulo (-03:00, o Brasil não tem horário de verão desde
 * 2019), para a janela da consulta pegar o dia certo; `diaInteiro` diz à tela
 * que a hora não conta.
 */

/** A agenda da casa no espelho (o `calendarId` do Google). */
export const AGENDA_DA_CASA = 'primary';
/** O teto da descrição (o mesmo da coluna). */
export const TETO_DA_DESCRICAO_NO_ESPELHO = 8000;

/** O que o espelho grava de um evento (as colunas de `AgendaEvento`, menos `orgId` e carimbos). */
export interface LinhaDoEspelho {
  agenda: string;
  origem: OrigemDoEvento;
  googleId: string;
  titulo: string | null;
  descricao: string | null;
  inicio: Date;
  fim: Date;
  diaInteiro: boolean;
  local: string | null;
  meet: string | null;
  convidados: ConvidadoDoEvento[];
  organizador: string | null;
  organizadorEhAgenda: boolean;
  status: StatusDoEvento;
  atualizadoNoGoogle: Date | null;
  serieId: string | null;
  criadoPeloOs: boolean;
  link: string | null;
  leituraTipo: TipoDeCompromisso;
  leituraCliente: string | null;
  leituraResponsaveis: string[];
  leituraModalidade: string | null;
  leituraMotivo: string | null;
  propriedades: Record<string, string>;
}

/** O que a desmontagem achou: uma linha inteira, ou só "este id foi cancelado" (o incremental manda só o id). */
export type EventoDesmontado =
  | { tipo: 'linha'; linha: LinhaDoEspelho }
  | { tipo: 'cancelado'; googleId: string }
  | { tipo: 'invalido' };

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const ouNulo = (v: unknown): string | null => texto(v) || null;
const DATA_SO = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-11-02` → a meia-noite de São Paulo; ISO com hora → como veio. */
export function instanteDoGoogle(ponto: unknown): { instante: Date; diaInteiro: boolean } | null {
  if (!ponto || typeof ponto !== 'object') return null;
  const p = ponto as { dateTime?: unknown; date?: unknown };
  const dt = texto(p.dateTime);
  if (dt) {
    const d = new Date(dt);
    return Number.isNaN(d.getTime()) ? null : { instante: d, diaInteiro: false };
  }
  const so = texto(p.date);
  if (DATA_SO.test(so)) {
    const d = new Date(`${so}T00:00:00-03:00`);
    return Number.isNaN(d.getTime()) ? null : { instante: d, diaInteiro: true };
  }
  return null;
}

export function statusDoGoogle(s: unknown): StatusDoEvento {
  const v = texto(s).toLowerCase();
  if (v === 'cancelled') return 'cancelado';
  if (v === 'tentative') return 'provisorio';
  return 'confirmado';
}

function respostaDoGoogle(s: unknown): RespostaDoConvidado {
  switch (texto(s)) {
    case 'accepted':
      return 'aceito';
    case 'declined':
      return 'recusado';
    case 'tentative':
      return 'talvez';
    default:
      return 'pendente';
  }
}

function convidadosDoGoogle(lista: unknown): ConvidadoDoEvento[] {
  if (!Array.isArray(lista)) return [];
  const saida: ConvidadoDoEvento[] = [];
  for (const a of lista) {
    if (!a || typeof a !== 'object') continue;
    const c = a as { email?: unknown; displayName?: unknown; organizer?: unknown; optional?: unknown; responseStatus?: unknown };
    const email = texto(c.email).toLowerCase();
    if (!email) continue;
    saida.push({
      email,
      nome: ouNulo(c.displayName),
      ...(c.organizer === true ? { organizador: true } : {}),
      ...(c.optional === true ? { opcional: true } : {}),
      resposta: respostaDoGoogle(c.responseStatus),
    });
  }
  return saida;
}

function meetDoGoogle(e: { hangoutLink?: unknown; conferenceData?: unknown }): string | null {
  const direto = texto(e.hangoutLink);
  if (direto) return direto;
  const pontos = (e.conferenceData as { entryPoints?: unknown } | undefined)?.entryPoints;
  if (Array.isArray(pontos)) {
    for (const p of pontos) {
      const ep = p as { entryPointType?: unknown; uri?: unknown };
      if (texto(ep?.entryPointType) === 'video' && texto(ep?.uri)) return texto(ep.uri);
    }
  }
  return null;
}

/** Só as propriedades privadas de texto (é o que o Google guarda); o resto é descartado. */
function propriedadesDoGoogle(e: { extendedProperties?: unknown }): Record<string, string> {
  const priv = (e.extendedProperties as { private?: unknown } | undefined)?.private;
  if (!priv || typeof priv !== 'object') return {};
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(priv as Record<string, unknown>)) {
    if (typeof v === 'string' && k.length <= 100) saida[k] = v.slice(0, 1000);
  }
  return saida;
}

/** As colunas `leitura*` de uma leitura da gramática. */
export function colunasDaLeitura(l: LeituraDoCompromisso): Pick<
  LinhaDoEspelho,
  'leituraTipo' | 'leituraCliente' | 'leituraResponsaveis' | 'leituraModalidade' | 'leituraMotivo'
> {
  return {
    leituraTipo: l.tipo,
    leituraCliente: l.cliente,
    leituraResponsaveis: [...l.responsaveis],
    leituraModalidade: l.modalidade,
    leituraMotivo: l.motivo ?? l.feriado ?? null,
  };
}

/**
 * Desmonta um evento cru do Google. `feriados` são os nomes que a gramática
 * reconhece como feriado (a tabela `Feriado` da empresa, ou `feriadosDoAno`).
 */
export function linhaDoEvento(cru: unknown, feriados: readonly string[], agenda: string = AGENDA_DA_CASA): EventoDesmontado {
  if (!cru || typeof cru !== 'object') return { tipo: 'invalido' };
  const e = cru as Record<string, unknown>;
  const googleId = texto(e.id);
  if (!googleId || googleId.length > 1024) return { tipo: 'invalido' };
  const status = statusDoGoogle(e.status);
  const inicio = instanteDoGoogle(e.start) ?? (status === 'cancelado' ? instanteDoGoogle(e.originalStartTime) : null);
  const fim = instanteDoGoogle(e.end);
  if (!inicio) return status === 'cancelado' ? { tipo: 'cancelado', googleId } : { tipo: 'invalido' };
  // Fim ausente ou antes do começo: a linha fica com duração zero (o banco recusa fim < início).
  const fimValido = fim && fim.instante.getTime() >= inicio.instante.getTime() ? fim.instante : inicio.instante;

  const titulo = ouNulo(e.summary);
  const propriedades = propriedadesDoGoogle(e);
  const organizador = e.organizer as { email?: unknown; self?: unknown } | undefined;
  const atualizado = texto(e.updated);
  const descricao = typeof e.description === 'string' && e.description.trim() ? e.description.slice(0, TETO_DA_DESCRICAO_NO_ESPELHO) : null;

  return {
    tipo: 'linha',
    linha: {
      agenda,
      origem: 'google',
      googleId,
      titulo,
      descricao,
      inicio: inicio.instante,
      fim: fimValido,
      diaInteiro: inicio.diaInteiro,
      local: ouNulo(e.location),
      meet: meetDoGoogle(e),
      convidados: convidadosDoGoogle(e.attendees),
      organizador: ouNulo(organizador?.email)?.toLowerCase() ?? null,
      organizadorEhAgenda: organizador?.self === true,
      status,
      atualizadoNoGoogle: atualizado && !Number.isNaN(Date.parse(atualizado)) ? new Date(atualizado) : null,
      serieId: ouNulo(e.recurringEventId),
      criadoPeloOs: propriedades[PROPRIEDADES_DO_OS.criadoPeloOs] === '1',
      link: ouNulo(e.htmlLink),
      ...colunasDaLeitura(lerCompromisso(titulo, feriados)),
      propriedades,
    },
  };
}

/** A chave estável de um intervalo do livre/ocupado: a mesma agenda, começo e fim = a mesma linha. */
export function idDoIntervalo(agenda: string, inicio: string, fim: string): string {
  return `lo-${createHash('sha256').update(`${agenda.toLowerCase()}|${new Date(inicio).toISOString()}|${new Date(fim).toISOString()}`).digest('hex').slice(0, 40)}`;
}

/** A linha "Fechado <Nome>" de um intervalo ocupado da agenda pessoal: sem título, sem descrição, sem local. */
export function linhaDoIntervalo(agenda: string, nome: SocioDaAgenda, inicio: string, fim: string): LinhaDoEspelho {
  return {
    agenda: agenda.toLowerCase(),
    origem: 'livre_ocupado',
    googleId: idDoIntervalo(agenda, inicio, fim),
    titulo: null,
    descricao: null,
    inicio: new Date(inicio),
    fim: new Date(fim),
    diaInteiro: false,
    local: null,
    meet: null,
    convidados: [],
    organizador: null,
    organizadorEhAgenda: false,
    status: 'confirmado',
    atualizadoNoGoogle: null,
    serieId: null,
    criadoPeloOs: false,
    link: null,
    leituraTipo: 'fechado',
    leituraCliente: null,
    leituraResponsaveis: [nome],
    leituraModalidade: null,
    leituraMotivo: null,
    propriedades: {},
  };
}

/** A linha do banco, do jeito que o Prisma a devolve (só o que a volta lê). */
export interface LinhaGravada {
  googleId: string;
  agenda: string;
  origem: string;
  titulo: string | null;
  descricao?: string | null;
  inicio: Date;
  fim: Date;
  diaInteiro: boolean;
  local: string | null;
  meet: string | null;
  convidados: unknown;
  organizador: string | null;
  organizadorEhAgenda: boolean;
  status: string;
  atualizadoNoGoogle: Date | null;
  serieId: string | null;
  criadoPeloOs: boolean;
  link: string | null;
  leituraTipo: string;
  leituraCliente: string | null;
  leituraResponsaveis: string[];
  leituraModalidade: string | null;
  leituraMotivo: string | null;
  /** As propriedades privadas que o OS gravou no evento (`PROPRIEDADES_DO_OS`). */
  propriedades?: unknown;
}

/** A linha do espelho como a tela a recebe. */
export function eventoDaLinha(l: LinhaGravada, opcoes: { comDescricao?: boolean } = {}): EventoDaAgenda {
  const tipo = l.leituraTipo as TipoDeCompromisso;
  return {
    id: l.googleId,
    agenda: l.agenda,
    origem: l.origem === 'livre_ocupado' ? 'livre_ocupado' : 'google',
    titulo: l.titulo,
    inicio: l.inicio.toISOString(),
    fim: l.fim.toISOString(),
    diaInteiro: l.diaInteiro,
    local: l.local,
    meet: l.meet,
    convidados: Array.isArray(l.convidados) ? (l.convidados as ConvidadoDoEvento[]) : [],
    organizador: l.organizador,
    organizadorEhAgenda: l.organizadorEhAgenda,
    status: (['confirmado', 'provisorio', 'cancelado'].includes(l.status) ? l.status : 'confirmado') as StatusDoEvento,
    atualizadoNoGoogle: l.atualizadoNoGoogle ? l.atualizadoNoGoogle.toISOString() : null,
    serieId: l.serieId,
    criadoPeloOs: l.criadoPeloOs,
    link: l.link,
    ...(opcoes.comDescricao ? { descricao: l.descricao ?? null } : {}),
    // Integração da agenda v2: os Conflitos e os Relatórios leem o "assim mesmo" e o "confirmado" daqui.
    ...(l.propriedades && typeof l.propriedades === 'object' && !Array.isArray(l.propriedades)
      ? {
          propriedades: Object.fromEntries(
            Object.entries(l.propriedades as Record<string, unknown>).filter((par): par is [string, string] => typeof par[1] === 'string'),
          ),
        }
      : {}),
    leitura: {
      tipo,
      modalidade: (l.leituraModalidade as LeituraDoCompromisso['modalidade']) ?? null,
      cliente: l.leituraCliente,
      responsaveis: l.leituraResponsaveis as SocioDaAgenda[],
      motivo: tipo === 'fora' ? l.leituraMotivo : null,
      feriado: tipo === 'feriado' ? l.leituraMotivo : null,
    },
  };
}

/**
 * Um evento da LEITURA DIRETA (`comunicacao.agenda.periodo`, o formato do
 * `GoogleService.calendarPeriodo`) no formato do espelho. É o caminho de quando
 * o espelho atrasou: perde o que aquela leitura não traz (resposta dos
 * convidados, série, propriedades), e a tela sabe disso pelo `fonte: google`.
 */
export function eventoDaLeituraDireta(cru: unknown, feriados: readonly string[]): EventoDaAgenda | null {
  if (!cru || typeof cru !== 'object') return null;
  const e = cru as Record<string, unknown>;
  const id = texto(e.id);
  const ini = texto(e.start);
  if (!id || !ini) return null;
  const diaInteiro = e.diaInteiro === true || DATA_SO.test(ini);
  const paraData = (v: string): Date => (DATA_SO.test(v) ? new Date(`${v}T00:00:00-03:00`) : new Date(v));
  const inicio = paraData(ini);
  const fimBruto = texto(e.end);
  const fim = fimBruto ? paraData(fimBruto) : inicio;
  if (Number.isNaN(inicio.getTime())) return null;
  const titulo = texto(e.title) && texto(e.title) !== '(sem título)' ? texto(e.title) : null;
  return {
    id,
    agenda: AGENDA_DA_CASA,
    origem: 'google',
    titulo,
    inicio: inicio.toISOString(),
    fim: (Number.isNaN(fim.getTime()) || fim < inicio ? inicio : fim).toISOString(),
    diaInteiro,
    local: ouNulo(e.location),
    meet: ouNulo(e.meet),
    convidados: Array.isArray(e.attendees)
      ? (e.attendees as unknown[]).map(texto).filter(Boolean).map((email) => ({ email: email.toLowerCase(), resposta: 'pendente' as const }))
      : [],
    organizador: ouNulo(e.organizador)?.toLowerCase() ?? null,
    organizadorEhAgenda: e.organizadorEhAgenda === true,
    status: statusDoGoogle(e.status),
    atualizadoNoGoogle: null,
    serieId: null,
    criadoPeloOs: false,
    link: ouNulo(e.link),
    descricao: typeof e.description === 'string' ? e.description : null,
    leitura: lerCompromisso(titulo, feriados),
  };
}
