import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CAPACIDADES_DA_AGENDA, PROPRIEDADES_DO_OS, type PedidoDeEscrita, type ResultadoDaRegua } from '@mktos/shared';

import { efeitosDaEscritaDaAgenda } from '../src/google/agenda-escrita.google';
import type { ChamadorDaAgenda } from '../src/google/agenda-espelho.google';
import { ErroDoGoogle } from '../src/google/dubles-do-google';
import {
  chamadaDoPedido,
  desfazerDaEscrita,
  eventoIdDaChave,
  linhaDoHistorico,
  novaChave,
  PedidoDeEscritaSchema,
  type EventoDoGoogle,
} from '../src/agenda/escrita/escrita-pura';
import { EscritaDaAgendaService, chaveDerivada } from '../src/agenda/escrita/escrita.service';
import type { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import type { PolicyService } from '../src/policy/policy.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { ReguaService } from '../src/agenda/regua/regua.service';
import type { EspelhoService } from '../src/agenda/espelho/espelho.service';

/*
 * A ESCRITA DA AGENDA NO GOOGLE (agenda v2, lane G4) — sem banco, com um dublê
 * do Google: um `ChamadorDaAgenda` que guarda o que recebeu e responde como o
 * Calendar (409 no id repetido, o evento como foi gravado).
 *
 * O que fica provado: o título sai da gramática; o id do evento sai da chave e
 * repetir não duplica; o Meet nasce na online com `conferenceDataVersion=1`; os
 * convidados recebem `sendUpdates=all`; o alterar recusa quando o evento de agora
 * não é o que a pessoa viu, sem escrever nada; o desmarcar recusa evento que o OS
 * não criou; ninguém apaga (`DELETE` nunca sai daqui); e o serviço não chama a
 * porta quando a régua dá vermelho sem `forcado`.
 */

const ORG = 'org-escrita-ficticia';
const P = PROPRIEDADES_DO_OS;

interface Pedido { metodo: string; caminho: string; corpo: Record<string, unknown> | null }

class GoogleDeMentira implements ChamadorDaAgenda {
  readonly pedidos: Pedido[] = [];
  readonly eventos = new Map<string, EventoDoGoogle>();
  private n = 0;

  async chamarAgenda<T = unknown>(_orgId: string, caminho: string, init?: RequestInit): Promise<T> {
    const metodo = init?.method ?? 'GET';
    const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    this.pedidos.push({ metodo, caminho, corpo });
    const [base] = caminho.split('?');
    const m = /^\/calendar\/v3\/calendars\/primary\/events(?:\/(.+))?$/.exec(base);
    if (!m) throw new ErroDoGoogle(404, 'caminho', base);
    const id = m[1] ? decodeURIComponent(m[1]) : null;
    if (metodo === 'POST' && !id) {
      const novoId = (corpo?.id as string | undefined) ?? `gerado${++this.n}`;
      if (this.eventos.has(novoId)) throw new ErroDoGoogle(409, 'duplicate', base);
      const online = Boolean(corpo?.conferenceData) && caminho.includes('conferenceDataVersion=1');
      const e: EventoDoGoogle = {
        ...(corpo as EventoDoGoogle),
        id: novoId,
        status: 'confirmed',
        organizer: { email: 'agenda@root.invalid', self: true },
        htmlLink: `https://agenda.invalid/${novoId}`,
        ...(online ? { hangoutLink: `https://meet.invalid/${novoId}` } : {}),
      };
      delete (e as Record<string, unknown>).conferenceData;
      this.eventos.set(novoId, e);
      return JSON.parse(JSON.stringify(e)) as T;
    }
    if (!id) throw new ErroDoGoogle(400, 'sem id', base);
    const atual = this.eventos.get(id);
    if (!atual) throw new ErroDoGoogle(404, 'notFound', base);
    if (metodo === 'GET') return JSON.parse(JSON.stringify(atual)) as T;
    if (metodo === 'PATCH') {
      const novo: EventoDoGoogle = { ...atual, ...(corpo as EventoDoGoogle) };
      if (corpo?.conferenceData && caminho.includes('conferenceDataVersion=1')) novo.hangoutLink = `https://meet.invalid/${id}`;
      delete (novo as Record<string, unknown>).conferenceData;
      this.eventos.set(id, novo);
      return JSON.parse(JSON.stringify(novo)) as T;
    }
    throw new ErroDoGoogle(405, `método ${metodo} não é usado pela agenda`, base);
  }

  escritas(): Pedido[] {
    return this.pedidos.filter((p) => p.metodo !== 'GET');
  }
}

const CTX = { orgId: ORG, actorId: 'pessoa-ficticia', actorType: 'user' as const };

const ARGS_DO_MARCAR = (extra: Record<string, unknown> = {}) => ({
  chave: 'abcdefghij0123456789',
  tipo: 'cliente',
  modalidade: 'online',
  cliente: 'Papeleira Ficticia',
  responsavel: 'Rodrigo',
  responsaveis: ['Rodrigo'],
  inicio: '2026-11-03T15:00:00-03:00',
  fim: '2026-11-03T16:00:00-03:00',
  convidados: ['cliente@papeleira.invalid', 'rodrigo@root.invalid'],
  ...extra,
});

describe('a chave do pedido e o id do evento', () => {
  it('a mesma chave dá o mesmo id; outra empresa, outro id; o id é base32hex', () => {
    const a = eventoIdDaChave(ORG, 'abcdefghij0123456789');
    expect(a).toBe(eventoIdDaChave(ORG, 'abcdefghij0123456789'));
    expect(a).not.toBe(eventoIdDaChave('outra-org', 'abcdefghij0123456789'));
    expect(a).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(novaChave()).toMatch(/^[a-v0-9]{26}$/);
    expect(chaveDerivada('x')).toMatch(/^[a-v0-9]{32}$/);
  });
});

describe('os efeitos no Google', () => {
  let g: GoogleDeMentira;
  let efeitos: ReturnType<typeof efeitosDaEscritaDaAgenda>;
  beforeEach(() => {
    g = new GoogleDeMentira();
    efeitos = efeitosDaEscritaDaAgenda(g);
  });

  it('inscreve as cinco capacidades da escrita, e nenhuma outra', () => {
    expect(Object.keys(efeitos).sort()).toEqual(
      [CAPACIDADES_DA_AGENDA.marcar, CAPACIDADES_DA_AGENDA.alterar, CAPACIDADES_DA_AGENDA.cancelar, CAPACIDADES_DA_AGENDA.desmarcar, CAPACIDADES_DA_AGENDA.reabrir].sort(),
    );
  });

  it('marcar: título da gramática, id da chave, Meet na online, convidados avisados, propriedades do OS', async () => {
    const r = (await efeitos[CAPACIDADES_DA_AGENDA.marcar](ARGS_DO_MARCAR({ leadId: 'lead-1', forcado: { motivo: 'cliente só pode nesse horário' } }), ORG, CTX)) as Record<string, unknown>;
    const [p] = g.escritas();
    expect(p.metodo).toBe('POST');
    expect(p.caminho).toContain('sendUpdates=all');
    expect(p.caminho).toContain('conferenceDataVersion=1');
    expect(p.corpo?.summary).toBe('Reunião Online - Papeleira Ficticia - Rodrigo');
    expect(p.corpo?.id).toBe(eventoIdDaChave(ORG, 'abcdefghij0123456789'));
    expect((p.corpo?.conferenceData as { createRequest: { requestId: string } }).createRequest.requestId).toBe('mktos-abcdefghij0123456789');
    expect(p.corpo?.attendees).toEqual([{ email: 'cliente@papeleira.invalid' }, { email: 'rodrigo@root.invalid' }]);
    const prop = (p.corpo?.extendedProperties as { private: Record<string, string> }).private;
    expect(prop).toMatchObject({
      [P.criadoPeloOs]: '1',
      [P.chave]: 'abcdefghij0123456789',
      [P.tipo]: 'cliente',
      [P.pedidoPor]: 'pessoa-ficticia',
      [P.leadId]: 'lead-1',
      [P.forcado]: 'cliente só pode nesse horário',
    });
    expect(r).toMatchObject({ ok: true, titulo: 'Reunião Online - Papeleira Ficticia - Rodrigo', reaproveitado: false });
    expect(r.meet).toBeTruthy();
    expect((r.evento as EventoDoGoogle).id).toBe(r.id);
  });

  it('marcar de novo com a mesma chave não duplica: o 409 devolve o evento que já existe', async () => {
    const a = (await efeitos[CAPACIDADES_DA_AGENDA.marcar](ARGS_DO_MARCAR(), ORG, CTX)) as Record<string, unknown>;
    const b = (await efeitos[CAPACIDADES_DA_AGENDA.marcar](ARGS_DO_MARCAR(), ORG, CTX)) as Record<string, unknown>;
    expect(b.id).toBe(a.id);
    expect(b.reaproveitado).toBe(true);
    expect(g.eventos.size).toBe(1);
  });

  it('o 409 de um evento de OUTRA chave no mesmo id não é devolvido como se fosse este', async () => {
    const id = eventoIdDaChave(ORG, 'abcdefghij0123456789');
    g.eventos.set(id, { id, summary: 'Outro', organizer: { self: true }, extendedProperties: { private: { [P.chave]: 'outrachave0000' } } });
    await expect(efeitos[CAPACIDADES_DA_AGENDA.marcar](ARGS_DO_MARCAR(), ORG, CTX)).rejects.toBeInstanceOf(ConflictException);
  });

  it('bloqueio: "Fechado Nome", sem Meet e sem convidados', async () => {
    await efeitos[CAPACIDADES_DA_AGENDA.marcar](ARGS_DO_MARCAR({ tipo: 'bloqueio', cliente: undefined, convidados: undefined }), ORG, CTX);
    const [p] = g.escritas();
    expect(p.corpo?.summary).toBe('Fechado Rodrigo');
    expect(p.corpo?.conferenceData).toBeUndefined();
    expect(p.caminho).not.toContain('conferenceDataVersion');
    expect(p.corpo?.attendees).toEqual([]);
  });

  it('a rota antiga (só `responsavel`, sem chave nem fim) continua marcando no padrão', async () => {
    const r = (await efeitos[CAPACIDADES_DA_AGENDA.marcar](
      { tipo: 'interna', modalidade: 'online', responsavel: 'Todos', inicio: '2026-11-03T08:00:00-03:00' },
      ORG,
      CTX,
    )) as Record<string, unknown>;
    const [p] = g.escritas();
    expect(p.corpo?.summary).toBe('Reunião Interna - Todos');
    expect(p.corpo?.id).toBeUndefined();
    expect(Date.parse((p.corpo?.end as { dateTime: string }).dateTime) - Date.parse((p.corpo?.start as { dateTime: string }).dateTime)).toBe(3_600_000);
    expect(r.titulo).toBe('Reunião Interna - Todos');
    expect(r.meet).toBeTruthy();
  });

  it('marcar sem o que a gramática exige é 400, e nada sai', async () => {
    await expect(efeitos[CAPACIDADES_DA_AGENDA.marcar](ARGS_DO_MARCAR({ cliente: undefined }), ORG, CTX)).rejects.toBeInstanceOf(BadRequestException);
    expect(g.escritas()).toEqual([]);
  });

  async function marcado(): Promise<{ id: string; titulo: string; evento: EventoDoGoogle }> {
    const r = (await efeitos[CAPACIDADES_DA_AGENDA.marcar](ARGS_DO_MARCAR(), ORG, CTX)) as { id: string; titulo: string; evento: EventoDoGoogle };
    g.pedidos.length = 0;
    return r;
  }
  const retrato = (e: EventoDoGoogle) => ({ titulo: e.summary!, inicio: e.start!.dateTime!, fim: e.end!.dateTime!, local: null, meet: true });

  it('alterar: com o evento como a pessoa viu, muda horário e título pela gramática e devolve o anterior', async () => {
    const m = await marcado();
    const r = (await efeitos[CAPACIDADES_DA_AGENDA.alterar](
      { chave: 'bcdefghij01234567890', eventoId: m.id, antes: retrato(m.evento), depois: { inicio: '2026-11-03T17:00:00-03:00', fim: '2026-11-03T18:00:00-03:00', responsaveis: ['Lucas'] } },
      ORG,
      CTX,
    )) as Record<string, unknown>;
    const [p] = g.escritas();
    expect(p.metodo).toBe('PATCH');
    expect(p.caminho).toContain('sendUpdates=all');
    expect(p.corpo?.summary).toBe('Reunião Online - Papeleira Ficticia - Lucas');
    expect((p.corpo?.start as { dateTime: string }).dateTime).toBe(new Date('2026-11-03T17:00:00-03:00').toISOString());
    expect((r.anterior as { titulo: string }).titulo).toBe('Reunião Online - Papeleira Ficticia - Rodrigo');
    expect((r.depois as { titulo: string }).titulo).toBe('Reunião Online - Papeleira Ficticia - Lucas');

    // O mesmo pedido de novo (mesma chave): devolve o que já saiu, sem escrever.
    g.pedidos.length = 0;
    const de_novo = (await efeitos[CAPACIDADES_DA_AGENDA.alterar](
      { chave: 'bcdefghij01234567890', eventoId: m.id, antes: retrato(m.evento), depois: { inicio: '2026-11-03T17:00:00-03:00' } },
      ORG,
      CTX,
    )) as Record<string, unknown>;
    expect(de_novo.reaproveitado).toBe(true);
    expect(g.escritas()).toEqual([]);
  });

  it('alterar: antes ≠ agora recusa, e nada é escrito', async () => {
    const m = await marcado();
    // Alguém mudou o horário no celular depois que a pessoa abriu a tela.
    g.eventos.get(m.id)!.start = { dateTime: '2026-11-03T19:00:00.000Z' };
    await expect(
      efeitos[CAPACIDADES_DA_AGENDA.alterar]({ chave: 'cdefghij012345678901', eventoId: m.id, antes: retrato(m.evento), depois: { local: 'Sala 2' } }, ORG, CTX),
    ).rejects.toThrow(/mudou desde que você o viu \(o início\)/);
    expect(g.escritas()).toEqual([]);
  });

  it('alterar só "confirmado com o cliente": marca no evento e ninguém é avisado', async () => {
    const m = await marcado();
    await efeitos[CAPACIDADES_DA_AGENDA.alterar]({ chave: 'defghij0123456789012', eventoId: m.id, antes: retrato(m.evento), depois: { confirmadoComCliente: true } }, ORG, CTX);
    const [p] = g.escritas();
    expect(p.caminho).toContain('sendUpdates=none');
    expect(p.corpo?.summary).toBeUndefined();
    expect((p.corpo?.extendedProperties as { private: Record<string, string> }).private[P.confirmadoComCliente]).toBe('1');
    // As outras propriedades do OS ficam (o mapa inteiro vai no PATCH).
    expect((p.corpo?.extendedProperties as { private: Record<string, string> }).private[P.criadoPeloOs]).toBe('1');
  });

  it('alterar recusa compromisso que a agenda da Root não organizou', async () => {
    g.eventos.set('convite-de-fora', { id: 'convite-de-fora', summary: 'Call', organizer: { email: 'x@fora.invalid' }, start: { dateTime: '2026-11-03T10:00:00.000Z' }, end: { dateTime: '2026-11-03T11:00:00.000Z' } });
    await expect(
      efeitos[CAPACIDADES_DA_AGENDA.alterar]({ chave: 'efghij01234567890123', eventoId: 'convite-de-fora', antes: { titulo: 'Call', inicio: '2026-11-03T10:00:00.000Z', fim: '2026-11-03T11:00:00.000Z', local: null, meet: false }, depois: { local: 'x' } }, ORG, CTX),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(g.escritas()).toEqual([]);
  });

  it('cancelar: status cancelled (nunca DELETE), motivo na descrição, aviso conforme o pedido', async () => {
    const m = await marcado();
    await efeitos[CAPACIDADES_DA_AGENDA.cancelar]({ chave: 'fghij012345678901234', eventoId: m.id, tituloAtual: m.titulo, motivo: 'cliente remarcou', avisar: false }, ORG, CTX);
    const [p] = g.escritas();
    expect(p.metodo).toBe('PATCH');
    expect(p.caminho).toContain('sendUpdates=none');
    expect(p.corpo?.status).toBe('cancelled');
    expect(String(p.corpo?.description)).toContain('Cancelado pelo ROOT OS: cliente remarcou');
    expect(g.pedidos.some((x) => x.metodo === 'DELETE')).toBe(false);
    expect(g.eventos.get(m.id)?.status).toBe('cancelled');
  });

  it('cancelar recusa título diferente do que a pessoa viu', async () => {
    const m = await marcado();
    await expect(
      efeitos[CAPACIDADES_DA_AGENDA.cancelar]({ chave: 'ghij0123456789012345', eventoId: m.id, tituloAtual: 'Outro título', motivo: 'x x x', avisar: true }, ORG, CTX),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(g.escritas()).toEqual([]);
  });

  it('desmarcar recusa evento que o OS não criou', async () => {
    g.eventos.set('do-celular', { id: 'do-celular', summary: 'Reunião Interna - Todos', organizer: { self: true }, status: 'confirmed' });
    await expect(
      efeitos[CAPACIDADES_DA_AGENDA.desmarcar]({ chave: 'hij01234567890123456', eventoId: 'do-celular', tituloAtual: 'Reunião Interna - Todos' }, ORG, CTX),
    ).rejects.toThrow(/não foi criado pelo OS/);
    expect(g.escritas()).toEqual([]);
  });

  it('desmarcar o que o OS marcou: cancelled com aviso; reabrir devolve com aviso', async () => {
    const m = await marcado();
    await efeitos[CAPACIDADES_DA_AGENDA.desmarcar]({ chave: 'ij012345678901234567', eventoId: m.id, tituloAtual: m.titulo }, ORG, CTX);
    let [p] = g.escritas();
    expect(p.corpo?.status).toBe('cancelled');
    expect(p.caminho).toContain('sendUpdates=all');

    g.pedidos.length = 0;
    await efeitos[CAPACIDADES_DA_AGENDA.reabrir]({ chave: 'j0123456789012345678', eventoId: m.id, tituloAtual: m.titulo }, ORG, CTX);
    [p] = g.escritas();
    expect(p.corpo?.status).toBe('confirmed');
    expect(p.caminho).toContain('sendUpdates=all');
    expect(g.eventos.get(m.id)?.status).toBe('confirmed');
  });

  it('reabrir recusa o que não está cancelado', async () => {
    const m = await marcado();
    await expect(
      efeitos[CAPACIDADES_DA_AGENDA.reabrir]({ chave: 'k0123456789012345678', eventoId: m.id, tituloAtual: m.titulo }, ORG, CTX),
    ).rejects.toThrow(/não está cancelado/);
  });
});

describe('o desfazer de cada escrita', () => {
  const marcar: PedidoDeEscrita = {
    acao: 'marcar',
    chave: 'abcdefghij0123456789',
    compromisso: { tipo: 'cliente', modalidade: 'online', cliente: 'Papeleira Ficticia', responsaveis: ['Rodrigo'], inicio: '2026-11-03T15:00:00-03:00', fim: '2026-11-03T16:00:00-03:00' },
  };

  it('marcar → desmarcar o evento da chave', () => {
    const d = desfazerDaEscrita(marcar, null, ORG, 'chavedavolta0000');
    expect(d).toEqual({ acao: 'desmarcar', chave: 'chavedavolta0000', eventoId: eventoIdDaChave(ORG, marcar.chave), tituloAtual: 'Reunião Online - Papeleira Ficticia - Rodrigo' });
  });

  it('alterar → alterar com antes e depois trocados (título de volta pela gramática)', () => {
    const antes = { titulo: 'Reunião Online - Papeleira Ficticia - Rodrigo', inicio: '2026-11-03T15:00:00-03:00', fim: '2026-11-03T16:00:00-03:00', local: null, meet: true };
    const d = desfazerDaEscrita(
      { acao: 'alterar', chave: 'abcdefghij0123456780', eventoId: 'ev1', antes, depois: { inicio: '2026-11-03T17:00:00-03:00', fim: '2026-11-03T18:00:00-03:00', responsaveis: ['Lucas'] } },
      null,
      ORG,
      'chavedavolta0001',
    );
    expect(d).toEqual({
      acao: 'alterar',
      chave: 'chavedavolta0001',
      eventoId: 'ev1',
      antes: { titulo: 'Reunião Online - Papeleira Ficticia - Lucas', inicio: '2026-11-03T17:00:00-03:00', fim: '2026-11-03T18:00:00-03:00', local: null, meet: true },
      depois: { inicio: antes.inicio, fim: antes.fim, tipo: 'cliente', responsaveis: ['Rodrigo'], modalidade: 'online', cliente: 'Papeleira Ficticia' },
    });
  });

  it('cancelar e desmarcar → reabrir; reabrir não tem volta pelo OS', () => {
    expect(desfazerDaEscrita({ acao: 'cancelar', chave: 'abcdefghij0123456781', eventoId: 'ev1', tituloAtual: 'T', motivo: 'xyz', avisar: true }, null, ORG, 'chavedavolta0002'))
      .toEqual({ acao: 'reabrir', chave: 'chavedavolta0002', eventoId: 'ev1', tituloAtual: 'T' });
    expect(desfazerDaEscrita({ acao: 'reabrir', chave: 'abcdefghij0123456782', eventoId: 'ev1', tituloAtual: 'T' }, null, ORG)).toBeNull();
  });

  it('os argumentos do catálogo: só cliente e interna convidam a Equipe; o responsável antigo vem junto', () => {
    const c = chamadaDoPedido(marcar, ['rodrigo@root.invalid']);
    expect(c.capacidade).toBe(CAPACIDADES_DA_AGENDA.marcar);
    expect(c.args).toMatchObject({ responsavel: 'Rodrigo', responsaveis: ['Rodrigo'], convidados: ['rodrigo@root.invalid'] });
    const fora = chamadaDoPedido({ ...marcar, compromisso: { ...marcar.compromisso, tipo: 'fora', motivo: 'viagem' } }, ['rodrigo@root.invalid']);
    expect(fora.args.convidados).toBeUndefined();
    const todos = chamadaDoPedido({ ...marcar, compromisso: { ...marcar.compromisso, responsaveis: ['Rodrigo', 'Lucas', 'Pedro'] } });
    expect(todos.args.responsavel).toBe('Todos');
  });

  it('o esquema do pedido é estrito e recusa título pronto', () => {
    expect(PedidoDeEscritaSchema.safeParse(marcar).success).toBe(true);
    expect(PedidoDeEscritaSchema.safeParse({ ...marcar, compromisso: { ...marcar.compromisso, titulo: 'Qualquer' } }).success).toBe(false);
  });
});

describe('o histórico, lido do registro da porta', () => {
  it('mapeia a chamada em linha, com o desfazer só do que saiu', () => {
    const base = {
      criadoEm: new Date('2026-11-03T17:02:00Z'),
      capabilityId: CAPACIDADES_DA_AGENDA.marcar,
      actorId: 'u1',
      agentSlug: null,
      args: { chave: 'abcdefghij0123456789', tipo: 'cliente', modalidade: 'online', cliente: 'Papeleira Ficticia', responsavel: 'Rodrigo', responsaveis: ['Rodrigo'], inicio: '2026-11-03T15:00:00-03:00', fim: '2026-11-03T16:00:00-03:00', forcado: { motivo: 'cliente pediu' } },
      resultado: null,
    };
    const nome = (id: string | null) => (id === 'u1' ? 'Rodrigo' : null);
    const feita = linhaDoHistorico({ ...base, id: 't1', status: 'executado' }, ORG, nome)!;
    expect(feita).toMatchObject({ verbo: 'marcou', quem: 'Rodrigo', titulo: 'Reunião Online - Papeleira Ficticia - Rodrigo', eventoId: eventoIdDaChave(ORG, 'abcdefghij0123456789'), forcado: { motivo: 'cliente pediu' } });
    expect(feita.desfazer?.acao).toBe('desmarcar');
    const retida = linhaDoHistorico({ ...base, id: 't2', status: 'aguardando_aprovacao' }, ORG, nome)!;
    expect(retida.desfazer).toBeNull();
    expect(linhaDoHistorico({ ...base, id: 't3', status: 'executado', capabilityId: 'email.enviar' }, ORG, nome)).toBeNull();
  });
});

describe('o serviço da escrita, com dublês da porta e da régua', () => {
  const vermelho: ResultadoDaRegua = { cor: 'vermelho', itens: [{ nivel: 'bloqueio', regra: 'choque', frase: 'Rodrigo já tem reunião às 15:00.' }] };
  const pedido: PedidoDeEscrita = {
    acao: 'marcar',
    chave: 'abcdefghij0123456789',
    compromisso: { tipo: 'cliente', modalidade: 'online', cliente: 'Papeleira Ficticia', responsaveis: ['Rodrigo'], inicio: '2026-11-03T15:00:00-03:00', fim: '2026-11-03T16:00:00-03:00', convidados: ['cliente@papeleira.invalid'] },
  };

  function montar(cor: ResultadoDaRegua, resposta: unknown = { ok: true, id: 'ev1', titulo: 'T', evento: { id: 'ev1' } }) {
    const portaChamadas: Array<Record<string, unknown>> = [];
    const refletidos: unknown[] = [];
    const porta = { executar: async (e: Record<string, unknown>) => { portaChamadas.push(e); return resposta; } } as unknown as PortaDoOperador;
    const regua = { avaliar: async () => cor } as unknown as ReguaService;
    const espelho = { refletir: async (_o: string, e: unknown) => { refletidos.push(e); return null; } } as unknown as EspelhoService;
    const policy = { simular: () => ({ nivel: 'R2' }) } as unknown as PolicyService;
    const usuarios = [
      { id: 'u1', name: 'Rodrigo Ficticio', email: 'rodrigo@root.invalid', isActive: true, roles: [{ key: 'admin_master' }], passwordHash: 'x' },
      { id: 'm1', name: 'Rodrigo Robo', email: 'robo@root.invalid', isActive: true, roles: [{ key: 'ia_acao' }], passwordHash: 'x' },
    ];
    const prisma = {
      user: {
        findFirst: async ({ where }: { where: { id: string } }) => usuarios.find((u) => u.id === where.id) ?? null,
        findMany: async () => usuarios,
      },
    } as unknown as PrismaService;
    return { servico: new EscritaDaAgendaService(prisma, porta, regua, espelho, policy), portaChamadas, refletidos };
  }

  it('vermelho sem `forcado`: recusado com a régua, e a porta NÃO é chamada', async () => {
    const { servico, portaChamadas } = montar(vermelho);
    const r = await servico.executar({ orgId: ORG, actorType: 'user', actorId: 'u1', naTela: true }, pedido);
    expect(r.status).toBe('recusado');
    expect(r.regua).toEqual(vermelho);
    expect(portaChamadas).toEqual([]);
  });

  it('vermelho COM `forcado`: vai à porta com o motivo nos argumentos', async () => {
    const { servico, portaChamadas, refletidos } = montar(vermelho);
    const r = await servico.executar({ orgId: ORG, actorType: 'user', actorId: 'u1', naTela: true }, { ...pedido, forcado: { motivo: 'o cliente só pode agora' } } as PedidoDeEscrita);
    expect(r.status).toBe('executado');
    expect((portaChamadas[0].args as Record<string, unknown>).forcado).toEqual({ motivo: 'o cliente só pode agora' });
    expect(portaChamadas[0].naTela).toBe(true);
    // O e-mail do responsável vem da Equipe (a conta de máquina de mesmo nome não conta).
    expect((portaChamadas[0].args as Record<string, unknown>).convidados).toEqual(['cliente@papeleira.invalid', 'rodrigo@root.invalid']);
    expect(refletidos).toEqual([{ id: 'ev1' }]);
    expect(r.desfazer?.acao).toBe('desmarcar');
  });

  it('responsável sem e-mail na Equipe: o convite segue e a resposta diz quem ficou de fora', async () => {
    const { servico } = montar({ cor: 'verde', itens: [] });
    const r = await servico.executar({ orgId: ORG, actorType: 'user', actorId: 'u1', naTela: true }, { ...pedido, compromisso: { ...pedido.compromisso, responsaveis: ['Rodrigo', 'Pedro'] } } as PedidoDeEscrita);
    expect(r.responsaveisSemEmail).toEqual(['Pedro']);
  });

  it.each([
    ['rotina', 'system' as const, 'vigia-da-agenda'],
    ['agente', 'ai' as const, 'agente-x'],
    ['conta de máquina', 'user' as const, 'm1'],
  ])('%s não leva `naTela` à porta, mesmo pedindo', async (_n, actorType, actorId) => {
    const { servico, portaChamadas } = montar({ cor: 'verde', itens: [] }, { status: 'aguardando_aprovacao', approvalId: 'a1', nivel: 'R2' });
    const r = await servico.executar({ orgId: ORG, actorType, actorId, naTela: true }, pedido);
    expect(portaChamadas[0].naTela).toBeUndefined();
    expect(r.status).toBe('aguardando_aprovacao');
    expect(r.approvalId).toBe('a1');
  });

  it('a recusa da porta (403/409 do efeito) vira `recusado` com a frase, sem estourar', async () => {
    const portaQueRecusa = { executar: async () => { throw new ConflictException('Este compromisso mudou desde que você o viu.'); } } as unknown as PortaDoOperador;
    const { servico } = montar({ cor: 'verde', itens: [] });
    (servico as unknown as { porta: PortaDoOperador }).porta = portaQueRecusa;
    const r = await servico.executar({ orgId: ORG, actorType: 'user', actorId: 'u1', naTela: true }, { acao: 'cancelar', chave: 'abcdefghij0123456780', eventoId: 'ev1', tituloAtual: 'T', motivo: 'xyz', avisar: true });
    expect(r.status).toBe('recusado');
    expect(r.mensagem).toMatch(/mudou/);
  });
});
