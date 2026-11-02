import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  CAPACIDADES_DA_AGENDA,
  PROPRIEDADES_DO_OS,
  montarTituloDeCompromisso,
  sociosDoResponsavel,
  type RetratoDoCompromisso,
  type SocioDaAgenda,
  type TipoQueSeMarca,
} from '@mktos/shared';

import type { ContextoDoEfeito, Efeito } from '../gateway/efeitos.registry';
import {
  CAMPOS_DO_TITULO,
  CHAVE_DO_PEDIDO,
  diferencasDoRetrato,
  eventoIdDaChave,
  retratoDoEvento,
  tipoComMeet,
  tituloDoAlterar,
  type EventoDoGoogle,
} from '../agenda/escrita/escrita-pura';
import type { ChamadorDaAgenda } from './agenda-espelho.google';
import { ErroDoGoogle } from './dubles-do-google';

/*
 * A ESCRITA DA AGENDA NO GOOGLE (agenda v2, 29/10/2026, lane G4).
 *
 * Os efeitos de `agenda.reuniao.marcar` (que muda de casa: sai do
 * `google.service.ts`), `agenda.reuniao.alterar`, `agenda.reuniao.cancelar`,
 * `agenda.reuniao.desmarcar` e `agenda.reuniao.reabrir`. Cada um confere o evento
 * de agora contra o que a pessoa viu antes de escrever, avisa os convidados
 * (`sendUpdates=all`, salvo no cancelar sem aviso e na marca "confirmado com o
 * cliente") e devolve o evento como o Google o gravou. NUNCA APAGA: cancelar e
 * desmarcar põem `status: cancelled` (o Google guarda o evento, e o reabrir o
 * devolve).
 *
 * O título NUNCA vem pronto: sai de `montarTituloDeCompromisso` pelos campos
 * (a mesma função da tela). O id do evento do `marcar` sai da chave do pedido
 * (`eventoIdDaChave`): repetir o pedido não duplica, o 409 do Google devolve o
 * evento que já está lá (só se for o desta chave).
 *
 * O ARQUIVO NÃO IMPORTA O CONECTOR (catraca de arquitetura): o `GoogleService`
 * importa ESTE arquivo e se passa como `ChamadorDaAgenda` na inscrição dos
 * efeitos. As entradas daqui vêm DEPOIS das do conector no registro.
 */

const P = PROPRIEDADES_DO_OS;
const CAMINHO = '/calendar/v3/calendars/primary/events';
const FUSO = 'America/Sao_Paulo';

const texto = (v: unknown): string => String(v ?? '').trim();
const caminhoDoEvento = (id: string): string => `${CAMINHO}/${encodeURIComponent(id)}`;

function instante(v: unknown, nome: string): Date {
  const d = new Date(texto(v));
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${nome} inválido: mande data e hora ISO 8601.`);
  return d;
}

/** A frase da gramática vira 400 (é o que a tela mostra). */
function comGramatica<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException((e as Error).message);
  }
}

async function lerEvento(g: ChamadorDaAgenda, orgId: string, eventoId: string): Promise<EventoDoGoogle> {
  try {
    return await g.chamarAgenda<EventoDoGoogle>(orgId, caminhoDoEvento(eventoId));
  } catch (e) {
    if (e instanceof ErroDoGoogle && (e.status === 404 || e.status === 410)) {
      throw new ConflictException('Esse compromisso não está mais na agenda do Google. Nada foi alterado.');
    }
    throw e;
  }
}

function privadas(e: EventoDoGoogle): Record<string, string> {
  return { ...(e.extendedProperties?.private ?? {}) };
}

/** A escrita só vale sobre o que a própria agenda organizou (convite de outra pessoa não se mexe daqui). */
function exigirDaAgenda(e: EventoDoGoogle): void {
  if (e.organizer?.self !== true) {
    throw new ForbiddenException('Quem organizou este compromisso não é a agenda da Root: mude pelo Google de quem convidou. Nada foi alterado.');
  }
}

function exigirTitulo(e: EventoDoGoogle, tituloAtual: string): void {
  const agora = texto(e.summary).replace(/\s+/g, ' ');
  if (agora !== texto(tituloAtual).replace(/\s+/g, ' ')) {
    throw new ConflictException('O título deste compromisso mudou desde que você o viu. Recarregue a agenda e tente de novo. Nada foi alterado.');
  }
}

/** A mesma chave já foi aplicada neste evento? (repetir o pedido devolve o que já saiu) */
const jaAplicada = (e: EventoDoGoogle, chave: string): boolean =>
  !!chave && privadas(e)[P.ultimaEscrita] === chave;

function resposta(evento: EventoDoGoogle, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    id: evento.id ?? null,
    titulo: evento.summary ?? null,
    link: evento.htmlLink ?? null,
    meet: evento.hangoutLink ?? evento.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? null,
    status: evento.status ?? null,
    ...extra,
    // O evento como o Google o gravou: é o que o espelho reflete.
    evento,
  };
}

function pedidoDeMeet(chave: string | null): Record<string, unknown> {
  // O `requestId` repetido devolve a sala ANTERIOR: com a chave, repetir o pedido não abre outra.
  return {
    createRequest: {
      requestId: chave ? `mktos-${chave}` : `mktos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      conferenceSolutionKey: { type: 'hangoutsMeet' },
    },
  };
}

/* ---------------------------------------------------------------------------
 * marcar
 * ------------------------------------------------------------------------- */

async function marcar(g: ChamadorDaAgenda, orgId: string, a: Record<string, unknown>, ctx: ContextoDoEfeito) {
  const tipo = (['cliente', 'interna', 'bloqueio', 'pessoal', 'fora'].includes(texto(a.tipo)) ? texto(a.tipo) : 'cliente') as TipoQueSeMarca;
  const modalidade = texto(a.modalidade) === 'presencial' ? 'presencial' : 'online';
  // A rota antiga manda só `responsavel` (um sócio ou Todos); a nova manda a lista.
  const responsaveis: string[] = Array.isArray(a.responsaveis) && a.responsaveis.length
    ? (a.responsaveis as unknown[]).map(texto)
    : sociosDoResponsavel(texto(a.responsavel));
  const titulo = comGramatica(() =>
    montarTituloDeCompromisso({
      tipo,
      modalidade,
      cliente: texto(a.cliente) || undefined,
      responsaveis,
      motivo: texto(a.motivo) || undefined,
    }),
  );

  const inicio = instante(a.inicio, 'Início');
  const duracao = Number.isFinite(Number(a.duracaoMinutos)) ? Math.trunc(Number(a.duracaoMinutos)) : 60;
  const fim = texto(a.fim) ? instante(a.fim, 'Fim') : new Date(inicio.getTime() + duracao * 60_000);
  if (fim <= inicio) throw new BadRequestException('O compromisso tem de terminar depois de começar.');

  const chave = texto(a.chave);
  if (chave && !CHAVE_DO_PEDIDO.test(chave)) throw new BadRequestException('Chave do pedido fora do formato.');
  const online = modalidade === 'online' && tipoComMeet(tipo);
  const convidados = Array.isArray(a.convidados)
    ? [...new Set((a.convidados as unknown[]).map((e) => texto(e).toLowerCase()).filter(Boolean))]
    : [];

  const forcado = a.forcado && typeof a.forcado === 'object' ? texto((a.forcado as Record<string, unknown>).motivo) : '';
  const prop: Record<string, string> = {
    [P.criadoPeloOs]: '1',
    [P.tipo]: tipo,
    ...(chave ? { [P.chave]: chave, [P.ultimaEscrita]: chave } : {}),
    ...(forcado ? { [P.forcado]: forcado.slice(0, 300) } : {}),
    ...(ctx.actorId ? { [P.pedidoPor]: String(ctx.actorId).slice(0, 100) } : {}),
    ...(texto(a.leadId) ? { [P.leadId]: texto(a.leadId) } : {}),
    ...(texto(a.clienteId) ? { [P.clienteId]: texto(a.clienteId) } : {}),
  };
  const corpo: Record<string, unknown> = {
    ...(chave ? { id: eventoIdDaChave(orgId, chave) } : {}),
    summary: titulo,
    ...(texto(a.pauta) ? { description: String(a.pauta) } : {}),
    ...(modalidade === 'presencial' && texto(a.local) ? { location: texto(a.local) } : {}),
    start: { dateTime: inicio.toISOString(), timeZone: FUSO },
    end: { dateTime: fim.toISOString(), timeZone: FUSO },
    attendees: convidados.map((email) => ({ email })),
    extendedProperties: { private: prop },
    ...(online ? { conferenceData: pedidoDeMeet(chave || null) } : {}),
  };

  try {
    const criado = await g.chamarAgenda<EventoDoGoogle>(
      orgId,
      `${CAMINHO}?sendUpdates=all${online ? '&conferenceDataVersion=1' : ''}`,
      { method: 'POST', body: JSON.stringify(corpo) },
    );
    return resposta(criado, { reaproveitado: false });
  } catch (e) {
    // 409 = o id já existe: é o mesmo pedido de novo (mesma chave) ou nada feito.
    if (!(e instanceof ErroDoGoogle) || e.status !== 409 || !chave) throw e;
    const existente = await lerEvento(g, orgId, eventoIdDaChave(orgId, chave));
    if (privadas(existente)[P.chave] !== chave) {
      throw new ConflictException('Já existe outro evento com o id deste pedido. Nada foi criado.');
    }
    return resposta(existente, { reaproveitado: true });
  }
}

/* ---------------------------------------------------------------------------
 * alterar
 * ------------------------------------------------------------------------- */

async function alterar(g: ChamadorDaAgenda, orgId: string, a: Record<string, unknown>) {
  const eventoId = texto(a.eventoId);
  const chave = texto(a.chave);
  const antes = a.antes as RetratoDoCompromisso;
  const depois = (a.depois ?? {}) as {
    inicio?: string; fim?: string; modalidade?: 'online' | 'presencial'; responsaveis?: SocioDaAgenda[];
    tipo?: TipoQueSeMarca; cliente?: string; local?: string | null; criarMeet?: boolean; confirmadoComCliente?: boolean;
  };

  const atual = await lerEvento(g, orgId, eventoId);
  exigirDaAgenda(atual);
  const retratoAtual = retratoDoEvento(atual);
  if (jaAplicada(atual, chave)) return resposta(atual, { reaproveitado: true, depois: retratoAtual });
  if (atual.status === 'cancelled') throw new ConflictException('Este compromisso está cancelado: reabra antes de alterar. Nada foi alterado.');
  const diferencas = diferencasDoRetrato(antes, retratoAtual);
  if (diferencas.length) {
    throw new ConflictException(`Este compromisso mudou desde que você o viu (${diferencas.join(', ')}). Recarregue a agenda e tente de novo. Nada foi alterado.`);
  }

  const patch: Record<string, unknown> = {};
  let tipo: TipoQueSeMarca | null = null;
  if (CAMPOS_DO_TITULO.some((c) => depois[c] !== undefined)) {
    const r = comGramatica(() => tituloDoAlterar(retratoAtual.titulo, depois));
    patch.summary = r.titulo;
    tipo = r.tipo;
  }
  const inicio = depois.inicio !== undefined ? instante(depois.inicio, 'Início') : new Date(retratoAtual.inicio);
  const fim = depois.fim !== undefined ? instante(depois.fim, 'Fim') : new Date(retratoAtual.fim);
  if (depois.inicio !== undefined || depois.fim !== undefined) {
    if (!(fim > inicio)) throw new BadRequestException('O compromisso tem de terminar depois de começar.');
    if (depois.inicio !== undefined) patch.start = { dateTime: inicio.toISOString(), timeZone: FUSO };
    if (depois.fim !== undefined) patch.end = { dateTime: fim.toISOString(), timeZone: FUSO };
  }
  if (depois.local !== undefined) patch.location = depois.local?.trim() ? depois.local.trim() : null;
  const querMeet = depois.criarMeet === true || (depois.modalidade === 'online' && !!tipo && tipoComMeet(tipo));
  const pedeMeet = querMeet && !retratoAtual.meet;
  if (pedeMeet) patch.conferenceData = pedidoDeMeet(chave || null);

  const prop = privadas(atual);
  if (depois.confirmadoComCliente !== undefined) prop[P.confirmadoComCliente] = depois.confirmadoComCliente ? '1' : '0';
  if (tipo) prop[P.tipo] = tipo;
  const forcado = a.forcado && typeof a.forcado === 'object' ? texto((a.forcado as Record<string, unknown>).motivo) : '';
  if (forcado) prop[P.forcado] = forcado.slice(0, 300);
  if (chave) prop[P.ultimaEscrita] = chave;
  patch.extendedProperties = { private: prop };

  // Só a marca "confirmado com o cliente": nada muda para os convidados, ninguém é avisado.
  const soMarca = Object.keys(depois).every((k) => k === 'confirmadoComCliente');
  const evento = await g.chamarAgenda<EventoDoGoogle>(
    orgId,
    `${caminhoDoEvento(eventoId)}?sendUpdates=${soMarca ? 'none' : 'all'}${pedeMeet ? '&conferenceDataVersion=1' : ''}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return resposta(evento, { reaproveitado: false, anterior: retratoAtual, depois: retratoDoEvento(evento) });
}

/* ---------------------------------------------------------------------------
 * cancelar, desmarcar, reabrir
 * ------------------------------------------------------------------------- */

function comLinha(descricao: string | undefined, linha: string): string {
  const d = (descricao ?? '').trimEnd();
  return d ? `${d}\n\n${linha}` : linha;
}

async function cancelar(g: ChamadorDaAgenda, orgId: string, a: Record<string, unknown>, desmarcando: boolean) {
  const eventoId = texto(a.eventoId);
  const chave = texto(a.chave);
  const atual = await lerEvento(g, orgId, eventoId);
  exigirDaAgenda(atual);
  if (jaAplicada(atual, chave)) return resposta(atual, { reaproveitado: true });
  if (desmarcando && privadas(atual)[P.criadoPeloOs] !== '1') {
    throw new ForbiddenException('Desmarcar desfaz só o que o OS marcou, e este compromisso não foi criado pelo OS. Use cancelar. Nada foi alterado.');
  }
  exigirTitulo(atual, String(a.tituloAtual ?? ''));
  if (atual.status === 'cancelled') throw new ConflictException('Este compromisso já está cancelado. Nada foi alterado.');

  const prop = privadas(atual);
  if (chave) prop[P.ultimaEscrita] = chave;
  const linha = desmarcando ? 'Desmarcado pelo ROOT OS.' : `Cancelado pelo ROOT OS: ${texto(a.motivo)}`;
  const avisar = desmarcando ? true : a.avisar === true;
  const evento = await g.chamarAgenda<EventoDoGoogle>(
    orgId,
    `${caminhoDoEvento(eventoId)}?sendUpdates=${avisar ? 'all' : 'none'}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled', description: comLinha(atual.description, linha), extendedProperties: { private: prop } }),
    },
  );
  return resposta(evento, { reaproveitado: false, anterior: retratoDoEvento(atual) });
}

async function reabrir(g: ChamadorDaAgenda, orgId: string, a: Record<string, unknown>) {
  const eventoId = texto(a.eventoId);
  const chave = texto(a.chave);
  const atual = await lerEvento(g, orgId, eventoId);
  exigirDaAgenda(atual);
  if (jaAplicada(atual, chave)) return resposta(atual, { reaproveitado: true });
  exigirTitulo(atual, String(a.tituloAtual ?? ''));
  if (atual.status !== 'cancelled') throw new ConflictException('Este compromisso não está cancelado. Nada foi alterado.');

  const prop = privadas(atual);
  if (chave) prop[P.ultimaEscrita] = chave;
  const evento = await g.chamarAgenda<EventoDoGoogle>(orgId, `${caminhoDoEvento(eventoId)}?sendUpdates=all`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed', extendedProperties: { private: prop } }),
  });
  return resposta(evento, { reaproveitado: false });
}

export function efeitosDaEscritaDaAgenda(google: ChamadorDaAgenda): Record<string, Efeito> {
  return {
    [CAPACIDADES_DA_AGENDA.marcar]: (a, org, ctx) => marcar(google, org, a, ctx),
    [CAPACIDADES_DA_AGENDA.alterar]: (a, org) => alterar(google, org, a),
    [CAPACIDADES_DA_AGENDA.cancelar]: (a, org) => cancelar(google, org, a, false),
    [CAPACIDADES_DA_AGENDA.desmarcar]: (a, org) => cancelar(google, org, a, true),
    [CAPACIDADES_DA_AGENDA.reabrir]: (a, org) => reabrir(google, org, a),
  };
}
