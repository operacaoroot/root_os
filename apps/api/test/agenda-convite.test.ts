import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { lerCompromisso, montarTituloDeCompromisso, type DiaLivre, type PedidoDeEscrita, type ResultadoDaEscrita } from '@mktos/shared';

import { AUDITORIA_CONVITE_CRIADO, AUDITORIA_CONVITE_REVOGADO, AUDITORIA_PEDIDO_CAIU, ConviteDaAgendaService } from '../src/agenda/convite/convite.service';
import { AgendarController, TETO_DE_CONFIRMACAO_POR_HORA } from '../src/agenda/convite/agendar.controller';
import {
  TOKEN_DO_CONVITE,
  TetoPorOrigem,
  conviteAbre,
  empresaDoToken,
  hashDoConvite,
  icsDoConvite,
  instanteEmSaoPaulo,
  NOME_DIGITADO_MAX,
  nomeDigitadoParaTitulo,
  pedidoDoConviteCaiu,
  semHorariosReservados,
} from '../src/agenda/convite/convite-puro';
import type { EscritaDaAgendaService, QuemPedeAEscrita } from '../src/agenda/escrita/escrita.service';
import type { ReguaService } from '../src/agenda/regua/regua.service';
import { exigirBancoDescartavel } from './banco-de-teste';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * O LINK DE ESCOLHA (agenda v2, lane G6). Sem banco: o token, o 404 único, o
 * teto e o `.ics`. Com banco (`TEST_DATABASE_URL`): o token só em hash, o 404
 * igual nos quatro casos, o uso único NA CORRIDA (dois cliques ao mesmo tempo =
 * um uso, uma escrita), nada da agenda além de horários, e o isolamento entre
 * empresas. A régua e a escrita são dublês: o que se mede aqui é o convite.
 */

describe('o token e o convite, sem banco', () => {
  it('o token leva a empresa e 32 bytes; fora da forma, nem consulta', () => {
    expect(empresaDoToken('org-1.' + 'a'.repeat(43))).toBe('org-1');
    expect(empresaDoToken('org-1.' + 'a'.repeat(42))).toBeNull();
    expect(empresaDoToken('semponto')).toBeNull();
    expect(empresaDoToken(undefined)).toBeNull();
    expect(TOKEN_DO_CONVITE.test('../etc.' + 'a'.repeat(43))).toBe(false);
  });

  it('errado, vencido, revogado e usado sem escolha: o mesmo "não abre"; usado com escolha abre', () => {
    const agora = new Date('2026-11-01T12:00:00Z');
    const vivo = { validoAte: new Date('2026-11-05T00:00:00Z'), usadoEm: null, revogadoEm: null, escolhidoInicio: null };
    expect(conviteAbre(vivo, agora)).toBe(true);
    expect(conviteAbre(null, agora)).toBe(false);
    expect(conviteAbre({ ...vivo, validoAte: new Date('2026-11-01T11:00:00Z') }, agora)).toBe(false);
    expect(conviteAbre({ ...vivo, revogadoEm: agora }, agora)).toBe(false);
    expect(conviteAbre({ ...vivo, usadoEm: agora }, agora)).toBe(false);
    expect(conviteAbre({ ...vivo, usadoEm: agora, escolhidoInicio: agora }, agora)).toBe(true);
  });

  it('A1: o pedido caiu quando a aprovação venceu, foi recusada ou sumiu; viva, consumida ou executando não', () => {
    const agora = new Date('2026-11-02T12:00:00Z');
    const depois = new Date(agora.getTime() + 60_000);
    const antes = new Date(agora.getTime() - 60_000);
    const usado = { usadoEm: antes, escolhidoInicio: agora, approvalId: 'ap' };
    const ap = (status: 'pendente' | 'confirmada' | 'consumida' | 'rejeitada' | 'expirada', expiraEm: Date, capabilityId: string | null = 'agenda.reuniao.marcar') => ({ status, expiraEm, capabilityId });
    expect(pedidoDoConviteCaiu(usado, ap('pendente', depois), agora)).toBe(false);
    expect(pedidoDoConviteCaiu(usado, ap('pendente', antes), agora)).toBe(true);
    expect(pedidoDoConviteCaiu(usado, ap('pendente', agora), agora)).toBe(true);
    expect(pedidoDoConviteCaiu(usado, ap('rejeitada', depois), agora)).toBe(true);
    expect(pedidoDoConviteCaiu(usado, ap('expirada', depois), agora)).toBe(true);
    expect(pedidoDoConviteCaiu(usado, null, agora)).toBe(true);
    expect(pedidoDoConviteCaiu(usado, ap('consumida', antes), agora)).toBe(false);
    // Confirmada pela porta (com capacidade): está executando, não caiu.
    expect(pedidoDoConviteCaiu(usado, ap('confirmada', antes), agora)).toBe(false);
    expect(pedidoDoConviteCaiu(usado, ap('confirmada', antes, null), agora)).toBe(true);
    // Sem pedido gravado, ou sem escolha: nada a reabrir.
    expect(pedidoDoConviteCaiu({ ...usado, approvalId: null }, null, agora)).toBe(false);
    expect(pedidoDoConviteCaiu({ ...usado, escolhidoInicio: null }, null, agora)).toBe(false);
    expect(pedidoDoConviteCaiu({ ...usado, usadoEm: null }, null, agora)).toBe(false);
  });

  it('M2: o horário que outro convite pendente pediu sai dos verdes (com a duração deste convite)', () => {
    const dias = [{ dia: '2026-11-03', manha: ['10:30', '11:00'], tarde: ['14:00', '15:30'] }];
    // Reserva 14:30 a 15:30 (SP): a de 14:00 por 60 min encosta; a de 15:30 não.
    const reservas = [{ inicio: new Date('2026-11-03T17:30:00Z'), fim: new Date('2026-11-03T18:30:00Z') }];
    expect(semHorariosReservados(dias, reservas, 60)).toEqual([{ dia: '2026-11-03', manha: ['10:30', '11:00'], tarde: ['15:30'] }]);
    expect(semHorariosReservados(dias, reservas, 30)).toEqual([{ dia: '2026-11-03', manha: ['10:30', '11:00'], tarde: ['14:00', '15:30'] }]);
    expect(semHorariosReservados(dias, [], 60)).toEqual(dias);
  });

  it('M4: o nome digitado perde os separadores da gramática e o excesso; o título lê o cliente e o sócio certos', () => {
    expect(nomeDigitadoParaTitulo('X - Lucas')).toBe('X Lucas');
    expect(nomeDigitadoParaTitulo('Loja Ficticia – Pedro — Lucas')).toBe('Loja Ficticia Pedro Lucas');
    expect(nomeDigitadoParaTitulo('- Lucas')).toBe('Lucas');
    expect(nomeDigitadoParaTitulo('Lucas -')).toBe('Lucas');
    expect(nomeDigitadoParaTitulo('A · B | C')).toBe('A B C');
    expect(nomeDigitadoParaTitulo('Ana-Maria Exemplo')).toBe('Ana-Maria Exemplo');
    expect(nomeDigitadoParaTitulo('   ')).toBeNull();
    expect(nomeDigitadoParaTitulo('x'.repeat(200))).toHaveLength(NOME_DIGITADO_MAX);
    const cliente = nomeDigitadoParaTitulo('X - Lucas') as string;
    const titulo = montarTituloDeCompromisso({ tipo: 'cliente', modalidade: 'online', cliente, responsaveis: ['Rodrigo'] });
    expect(lerCompromisso(titulo)).toMatchObject({ tipo: 'cliente', cliente: 'X Lucas', responsaveis: ['Rodrigo'] });
    // Sem o conserto, o mesmo nome cru faria a leitura achar outro cliente ou outro sócio.
    const cru = montarTituloDeCompromisso({ tipo: 'cliente', modalidade: 'online', cliente: 'X - Lucas', responsaveis: ['Rodrigo'] });
    expect(lerCompromisso(cru)).not.toMatchObject({ cliente: 'X - Lucas', responsaveis: ['Rodrigo'] });
  });

  it('dia e hora de São Paulo viram o instante certo (-03:00)', () => {
    expect(instanteEmSaoPaulo('2026-11-04', '15:30')?.toISOString()).toBe('2026-11-04T18:30:00.000Z');
    expect(instanteEmSaoPaulo('2026-11-04', '25:00')).toBeNull();
  });

  it('o .ics é um VEVENT com o horário em UTC', () => {
    const ics = icsDoConvite({ uid: 'x@y', inicio: new Date('2026-11-04T18:30:00Z'), fim: new Date('2026-11-04T19:30:00Z'), titulo: 'Reunião, com vírgula', descricao: 'linha', agora: new Date('2026-11-01T00:00:00Z') });
    expect(ics).toContain('DTSTART:20261104T183000Z');
    expect(ics).toContain('SUMMARY:Reunião\\, com vírgula');
  });

  it('o teto por origem conta por endereço e solta na janela seguinte', () => {
    const t = new TetoPorOrigem(1000);
    expect(t.registrar('1.1.1.1', 2, 0)).toBe(true);
    expect(t.registrar('1.1.1.1', 2, 1)).toBe(true);
    expect(t.registrar('1.1.1.1', 2, 2)).toBe(false);
    expect(t.registrar('2.2.2.2', 2, 2)).toBe(true);
    expect(t.registrar('1.1.1.1', 2, 1001)).toBe(true);
  });

  it('a rota pública responde 429 depois do teto de confirmação por IP', async () => {
    const svc = { confirmar: async () => { throw new NotFoundException('link não encontrado.'); } } as unknown as ConviteDaAgendaService;
    const ctrl = new AgendarController(svc);
    const req = { ip: '203.0.113.9' };
    for (let i = 0; i < TETO_DE_CONFIRMACAO_POR_HORA; i++) {
      await expect(ctrl.confirmar('x', {}, req)).rejects.toBeInstanceOf(NotFoundException);
    }
    let erro: unknown;
    try { await ctrl.confirmar('x', {}, req); } catch (e) { erro = e; }
    expect(erro).toBeInstanceOf(HttpException);
    expect((erro as HttpException).getStatus()).toBe(429);
    // Outro endereço segue livre.
    await expect(ctrl.confirmar('x', {}, { ip: '203.0.113.10' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'escreve convites da agenda');

const ORG_A = 'org-convite-a';
const ORG_B = 'org-convite-b';
const AGORA = new Date('2026-11-02T12:00:00Z'); // segunda, 09:00 em São Paulo

const DIAS: DiaLivre[] = [
  { dia: '2026-11-03', manha: ['10:30', '11:00'], tarde: ['14:00', '15:30'] },
  { dia: '2026-11-04', manha: [], tarde: ['16:30'] },
];

describe.skipIf(!URL)('o link de escolha, com banco', () => {
  let prisma: PrismaClient;
  let svc: ConviteDaAgendaService;
  let livres: DiaLivre[];
  let escritas: Array<{ quem: QuemPedeAEscrita; pedido: PedidoDeEscrita }>;
  let respostaDaEscrita: ResultadoDaEscrita;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const [id, slug] of [[ORG_A, 'convite-a'], [ORG_B, 'convite-b']]) {
      await prisma.org.upsert({ where: { id }, create: { id, name: `Convite ${slug}`, slug }, update: {} });
    }
    await prisma.lead.upsert({
      where: { id: 'lead-convite-a' },
      create: { id: 'lead-convite-a', orgId: ORG_A, name: 'Marcos Ficticio da Silva', email: 'marcos@cliente.invalid' },
      update: {},
    });
    const regua = { livres: async () => livres } as unknown as ReguaService;
    const escrita = {
      executar: async (quem: QuemPedeAEscrita, pedido: PedidoDeEscrita) => {
        escritas.push({ quem, pedido });
        // A corrida: a segunda confirmação chegaria aqui enquanto a primeira espera a porta.
        await new Promise((r) => setTimeout(r, 30));
        return respostaDaEscrita;
      },
    } as unknown as EscritaDaAgendaService;
    svc = new ConviteDaAgendaService(prisma as unknown as PrismaService, regua, escrita);
  });

  afterAll(async () => {
    await prisma.agendaConvite.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.agendaEvento.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.approval.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.lead.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.org.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await prisma.$disconnect();
  });

  let nAprovacao = 0;
  /** Uma aprovação de verdade na fila (a do `marcar` do link), com o prazo e o estado pedidos. */
  const aprovacao = async (
    status: 'pendente' | 'confirmada' | 'consumida' | 'rejeitada' | 'expirada' = 'pendente',
    expiraEm = new Date(AGORA.getTime() + 15 * 60_000),
  ): Promise<string> => {
    nAprovacao += 1;
    const id = `aprovacao-convite-${nAprovacao}-${Date.now()}`;
    await prisma.approval.create({
      data: {
        id, orgId: ORG_A, propostoPorId: 'link-de-escolha', propostoPorTipo: 'system', resourceType: 'agenda.reuniao.marcar',
        resourceId: id, contentHash: 'h', resumo: 'marcar pelo link', status, nivelExigido: 'R2', tokenHash: `tk-${id}`, expiraEm,
      },
    });
    return id;
  };

  beforeEach(async () => {
    // Cada caso começa sem convite pendente dos casos anteriores (eles reservariam horário, M2).
    await prisma.agendaConvite.updateMany({ where: { orgId: { in: [ORG_A, ORG_B] }, revogadoEm: null }, data: { revogadoEm: AGORA } });
    livres = DIAS;
    escritas = [];
    respostaDaEscrita = {
      status: 'aguardando_aprovacao', nivel: 'R2', eventoId: 'osevento', approvalId: await aprovacao(),
      precisaDeOutraPessoa: false, mensagem: 'fila', desfazer: null,
    };
  });

  const tokenDe = (url: string): string => url.split('/agendar/')[1];
  const novo = (org = ORG_A, extra: Record<string, unknown> = {}) =>
    svc.criar(org, 'quem-criou', { socio: 'Rodrigo', tipo: 'cliente', modalidade: 'online', duracaoMin: 60, ...extra }, AGORA);

  it('o banco guarda só o hash do token; a URL é a pública da casa', async () => {
    const c = await novo(ORG_A, { leadId: 'lead-convite-a' });
    const token = tokenDe(c.url);
    expect(token).toMatch(TOKEN_DO_CONVITE);
    const linha = await prisma.agendaConvite.findUnique({ where: { id: c.id } });
    expect(linha?.tokenHash).toBe(hashDoConvite(token));
    expect(JSON.stringify(linha)).not.toContain(token.split('.')[1]);
    expect(linha?.nome).toBe('Marcos');
    expect(new Date(c.validoAte).getTime() - AGORA.getTime()).toBe(7 * 86_400_000);
    const lista = await svc.listar(ORG_A, AGORA);
    expect(JSON.stringify(lista)).not.toContain(token.split('.')[1]);
    expect(JSON.stringify(lista)).not.toContain(linha!.tokenHash);
  });

  it('M3: criar e revogar ficam na auditoria, com quem, sócio e validade, sem o token nem o hash', async () => {
    const c = await novo(ORG_A, { socio: 'Pedro' });
    const token = tokenDe(c.url);
    const linha = await prisma.agendaConvite.findUniqueOrThrow({ where: { id: c.id } });
    await svc.revogar(ORG_A, c.id, AGORA, 'quem-revogou');
    const audit = await prisma.auditLog.findMany({ where: { orgId: ORG_A, entityId: c.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual([AUDITORIA_CONVITE_CRIADO, AUDITORIA_CONVITE_REVOGADO]);
    expect(audit[0]).toMatchObject({ actorType: 'user', actorId: 'quem-criou', entityType: 'agenda_convite', after: expect.objectContaining({ socio: 'Pedro', validoAte: c.validoAte }) });
    expect(audit[1]).toMatchObject({ actorType: 'user', actorId: 'quem-revogou', metadata: expect.objectContaining({ socio: 'Pedro', criadoPorId: 'quem-criou' }) });
    const tudo = JSON.stringify(audit);
    expect(tudo).not.toContain(token.split('.')[1]);
    expect(tudo).not.toContain(linha.tokenHash);
    // Revogar de novo não audita outra vez.
    await expect(svc.revogar(ORG_A, c.id, AGORA, 'quem-revogou')).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.auditLog.count({ where: { orgId: ORG_A, entityId: c.id } })).toBe(2);
  });

  it('a página vê só horários: nada de título, nome de outro cliente ou id de evento', async () => {
    livres = DIAS;
    const c = await novo(ORG_A, { leadId: 'lead-convite-a' });
    const e = await svc.estadoPublico(tokenDe(c.url), AGORA);
    expect(e).toEqual({
      socio: 'Rodrigo', modalidade: 'online', duracaoMin: 60, nome: 'Marcos', emailObrigatorio: true,
      dias: DIAS, validoAte: c.validoAte, escolhido: null,
    });
    expect(Object.keys(e).sort()).toEqual(['dias', 'duracaoMin', 'emailObrigatorio', 'escolhido', 'modalidade', 'nome', 'socio', 'validoAte']);
  });

  it('o MESMO 404 para token errado, vencido, revogado e usado sem escolha', async () => {
    const msgs: string[] = [];
    const pegar = async (token: string, agora = AGORA) => {
      try { await svc.estadoPublico(token, agora); } catch (e) { expect(e).toBeInstanceOf(NotFoundException); msgs.push((e as Error).message); return; }
      throw new Error('abriu');
    };
    const vivo = await novo();
    const certo = tokenDe(vivo.url);
    await pegar(`${ORG_A}.${'x'.repeat(43)}`);
    await pegar(certo, new Date(AGORA.getTime() + 8 * 86_400_000));
    const revogado = await novo();
    await svc.revogar(ORG_A, revogado.id, AGORA);
    await pegar(tokenDe(revogado.url));
    const usado = await novo();
    await prisma.agendaConvite.update({ where: { id: usado.id }, data: { usadoEm: AGORA } });
    await pegar(tokenDe(usado.url));
    await pegar('lixo');
    expect(new Set(msgs).size).toBe(1);
  });

  it('confirmar: e-mail obrigatório na online; horário que não é verde recusa', async () => {
    const c = await novo();
    await expect(svc.confirmar(tokenDe(c.url), { dia: '2026-11-03', hora: '14:00' }, AGORA)).rejects.toThrow(/e-mail/);
    await expect(svc.confirmar(tokenDe(c.url), { dia: '2026-11-03', hora: '13:00', email: 'm@cliente.invalid' }, AGORA)).rejects.toBeInstanceOf(ConflictException);
    expect(escritas).toEqual([]);
    const linha = await prisma.agendaConvite.findUnique({ where: { id: c.id } });
    expect(linha?.usadoEm).toBeNull();
  });

  it('uso único NA CORRIDA: dois cliques ao mesmo tempo = um uso e uma escrita, pela porta como sistema e sem `naTela`', async () => {
    const c = await novo(ORG_A, { leadId: 'lead-convite-a' });
    const token = tokenDe(c.url);
    const corpo = { dia: '2026-11-03', hora: '15:30', email: 'marcos@cliente.invalid' };
    const r = await Promise.allSettled([svc.confirmar(token, corpo, AGORA), svc.confirmar(token, corpo, AGORA)]);
    const ok = r.filter((x) => x.status === 'fulfilled');
    const nao = r.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(nao).toHaveLength(1);
    expect(nao[0].reason).toBeInstanceOf(ConflictException);
    expect(escritas).toHaveLength(1);
    const [{ quem, pedido }] = escritas;
    expect(quem).toEqual({ orgId: ORG_A, actorType: 'system', actorId: 'link-de-escolha', agentSlug: 'link-de-escolha' });
    expect(quem.naTela).toBeUndefined();
    expect(pedido.acao).toBe('marcar');
    if (pedido.acao === 'marcar') {
      expect(pedido.compromisso).toMatchObject({
        tipo: 'cliente', modalidade: 'online', cliente: 'Marcos Ficticio da Silva', leadId: 'lead-convite-a',
        responsaveis: ['Rodrigo'], inicio: '2026-11-03T18:30:00.000Z', fim: '2026-11-03T19:30:00.000Z', convidados: ['marcos@cliente.invalid'],
      });
    }
    const res = (ok[0] as PromiseFulfilledResult<{ mensagem: string; escolhido: unknown; dias: unknown[] }>).value;
    expect(res.mensagem).toBe('Horário reservado. O convite com o link do Meet chega no seu e-mail assim que a Root confirmar.');
    expect(res.escolhido).toEqual({ inicio: '2026-11-03T18:30:00.000Z', fim: '2026-11-03T19:30:00.000Z' });
    expect(res.dias).toEqual([]);
    const linha = await prisma.agendaConvite.findUnique({ where: { id: c.id } });
    expect(linha).toMatchObject({ approvalId: respostaDaEscrita.approvalId, eventoId: 'osevento', emailInformado: 'marcos@cliente.invalid' });

    // Depois de usado: a página mostra o escolhido, e confirmar de novo é recusado.
    const e = await svc.estadoPublico(token, AGORA);
    expect(e.escolhido).toEqual(res.escolhido);
    expect(e.dias).toEqual([]);
    await expect(svc.confirmar(token, corpo, AGORA)).rejects.toBeInstanceOf(ConflictException);
    const ics = await svc.ics(token, AGORA);
    expect(ics).toContain('DTSTART:20261103T183000Z');
    expect(ics).not.toContain('Marcos');
  });

  it('M4: sem lead nem cliente, o nome digitado entra no título sem separador', async () => {
    const c = await novo();
    await svc.confirmar(tokenDe(c.url), { dia: '2026-11-03', hora: '10:30', email: 'x@cliente.invalid', nome: 'X - Lucas' }, AGORA);
    expect(escritas).toHaveLength(1);
    const p = escritas[0].pedido;
    expect(p.acao === 'marcar' ? p.compromisso.cliente : null).toBe('X Lucas');
  });

  it('a escrita recusada (o horário foi tomado na régua) devolve o uso: dá para escolher outro', async () => {
    respostaDaEscrita = { ...respostaDaEscrita, status: 'recusado', approvalId: null, mensagem: 'vermelho' };
    const c = await novo();
    await expect(svc.confirmar(tokenDe(c.url), { dia: '2026-11-03', hora: '14:00', email: 'x@cliente.invalid' }, AGORA)).rejects.toBeInstanceOf(ConflictException);
    const linha = await prisma.agendaConvite.findUnique({ where: { id: c.id } });
    expect(linha?.usadoEm).toBeNull();
    expect(linha?.escolhidoInicio).toBeNull();
  });

  it('o .ics só existe depois da escolha (antes, o mesmo 404)', async () => {
    const c = await novo();
    await expect(svc.ics(tokenDe(c.url), AGORA)).rejects.toBeInstanceOf(NotFoundException);
  });

  /** Um convite escolhido com o pedido na fila, com a aprovação dada. */
  let nEvento = 0;
  const escolhidoComPedido = async (approvalId: string) => {
    nEvento += 1;
    const eventoId = `osevconvite${nEvento}${Date.now()}`;
    const c = await novo();
    await prisma.agendaConvite.update({
      where: { id: c.id },
      data: {
        usadoEm: new Date(AGORA.getTime() - 20 * 60_000), escolhidoInicio: new Date('2026-11-03T18:30:00Z'), escolhidoFim: new Date('2026-11-03T19:30:00Z'),
        emailInformado: 'x@cliente.invalid', approvalId, eventoId,
      },
    });
    return { ...c, token: tokenDe(c.url), eventoId };
  };
  const auditoriasDe = (id: string) => prisma.auditLog.findMany({ where: { orgId: ORG_A, entityId: id, action: AUDITORIA_PEDIDO_CAIU } });

  it('A1: com a aprovação viva, o convite segue escolhido e nada é auditado', async () => {
    const c = await escolhidoComPedido(await aprovacao('pendente'));
    const e = await svc.estadoPublico(c.token, AGORA);
    expect(e.escolhido).toEqual({ inicio: '2026-11-03T18:30:00.000Z', fim: '2026-11-03T19:30:00.000Z' });
    expect(e.pedidoAnteriorCaiu).toBeUndefined();
    expect((await svc.listar(ORG_A, AGORA)).find((x) => x.id === c.id)?.estado).toBe('escolhido');
    expect(await auditoriasDe(c.id)).toHaveLength(0);
  });

  it('A1: aprovação vencida na fila: a casa vê "pedido vencido", a página reabre a escolha, avisa e audita UMA vez', async () => {
    const c = await escolhidoComPedido(await aprovacao('pendente', new Date(AGORA.getTime() - 60_000)));
    expect((await svc.listar(ORG_A, AGORA)).find((x) => x.id === c.id)?.estado).toBe('pedido_vencido');
    // Duas abas ao mesmo tempo: uma reabertura, uma linha de auditoria.
    const [e1, e2] = await Promise.all([svc.estadoPublico(c.token, AGORA), svc.estadoPublico(c.token, AGORA)]);
    for (const e of [e1, e2]) {
      expect(e.escolhido).toBeNull();
      expect(e.dias).toEqual(DIAS);
    }
    expect([e1, e2].some((e) => e.pedidoAnteriorCaiu === true)).toBe(true);
    const audit = await auditoriasDe(c.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: 'system', actorId: 'link-de-escolha', entityType: 'agenda_convite' });
    expect(JSON.stringify(audit[0])).not.toContain(c.token.split('.')[1]);
    const linha = await prisma.agendaConvite.findUnique({ where: { id: c.id } });
    expect(linha).toMatchObject({ usadoEm: null, escolhidoInicio: null, approvalId: null, eventoId: null, emailInformado: null });
    // A leitura seguinte continua avisando; a lista mostra aberto.
    expect((await svc.estadoPublico(c.token, AGORA)).pedidoAnteriorCaiu).toBe(true);
    expect((await svc.listar(ORG_A, AGORA)).find((x) => x.id === c.id)?.estado).toBe('aberto');
    // E dá para escolher de novo: um pedido novo vai à porta.
    const r = await svc.confirmar(c.token, { dia: '2026-11-04', hora: '16:30', email: 'x@cliente.invalid' }, AGORA);
    expect(r.escolhido).toEqual({ inicio: '2026-11-04T19:30:00.000Z', fim: '2026-11-04T20:30:00.000Z' });
    expect(escritas).toHaveLength(1);
  });

  it('A1: aprovação recusada ou sumida: confirmar direto reabre e aceita o novo horário', async () => {
    for (const [ap, hora, iso] of [[await aprovacao('rejeitada'), '10:30', '2026-11-03T13:30:00.000Z'], ['aprovacao-que-sumiu', '15:30', '2026-11-03T18:30:00.000Z']]) {
      escritas = [];
      const c = await escolhidoComPedido(ap);
      const r = await svc.confirmar(c.token, { dia: '2026-11-03', hora, email: 'x@cliente.invalid' }, AGORA);
      expect(r.escolhido?.inicio).toBe(iso);
      expect(escritas).toHaveLength(1);
      expect(await auditoriasDe(c.id)).toHaveLength(1);
    }
  });

  it('A1: o evento que já nasceu no espelho não reabre, mesmo com a aprovação vencida', async () => {
    const c = await escolhidoComPedido(await aprovacao('expirada'));
    await prisma.agendaEvento.create({
      data: {
        orgId: ORG_A, agenda: 'primary', googleId: c.eventoId, inicio: new Date('2026-11-03T18:30:00Z'), fim: new Date('2026-11-03T19:30:00Z'),
        titulo: 'Reunião Online - Cliente Exemplo A - Rodrigo',
      },
    });
    const e = await svc.estadoPublico(c.token, AGORA);
    expect(e.escolhido).not.toBeNull();
    await expect(svc.confirmar(c.token, { dia: '2026-11-03', hora: '10:30', email: 'x@cliente.invalid' }, AGORA)).rejects.toBeInstanceOf(ConflictException);
    expect(await auditoriasDe(c.id)).toHaveLength(0);
  });

  it('M2: o horário pedido por outro convite do mesmo sócio, ainda na fila, some dos verdes e a confirmação recusa', async () => {
    const corpo = { dia: '2026-11-04', hora: '16:30', email: 'x@cliente.invalid' };
    const x = await novo(ORG_A, { socio: 'Lucas' });
    const y = await novo(ORG_A, { socio: 'Lucas' });
    const outroSocio = await novo(ORG_A, { socio: 'Pedro' });
    await svc.confirmar(tokenDe(x.url), corpo, AGORA);
    const vistoPorY = await svc.estadoPublico(tokenDe(y.url), AGORA);
    expect(vistoPorY.dias.find((d) => d.dia === '2026-11-04')?.tarde).toEqual([]);
    expect((await svc.estadoPublico(tokenDe(outroSocio.url), AGORA)).dias.find((d) => d.dia === '2026-11-04')?.tarde).toEqual(['16:30']);
    await expect(svc.confirmar(tokenDe(y.url), corpo, AGORA)).rejects.toBeInstanceOf(ConflictException);
    expect((await prisma.agendaConvite.findUnique({ where: { id: y.id } }))?.usadoEm).toBeNull();
    // O pedido de X vence na fila: o horário volta para Y.
    const linhaX = await prisma.agendaConvite.findUniqueOrThrow({ where: { id: x.id } });
    await prisma.approval.update({ where: { id: linhaX.approvalId as string }, data: { status: 'expirada' } });
    expect((await svc.estadoPublico(tokenDe(y.url), AGORA)).dias.find((d) => d.dia === '2026-11-04')?.tarde).toEqual(['16:30']);
  });

  it('M2 NA CORRIDA: dois convites do mesmo sócio confirmando o mesmo horário ao mesmo tempo = um leva', async () => {
    const corpo = { dia: '2026-11-03', hora: '14:00', email: 'x@cliente.invalid' };
    const a = await novo(ORG_A, { socio: 'Pedro' });
    const b = await novo(ORG_A, { socio: 'Pedro' });
    escritas = [];
    const r = await Promise.allSettled([svc.confirmar(tokenDe(a.url), corpo, AGORA), svc.confirmar(tokenDe(b.url), corpo, AGORA)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const nao = r.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(nao).toHaveLength(1);
    expect(nao[0].reason).toBeInstanceOf(ConflictException);
    expect(escritas).toHaveLength(1);
  });

  it('isolamento: o token de A com a empresa trocada para B não abre, e B não lista os convites de A', async () => {
    const c = await novo(ORG_A);
    const segredo = tokenDe(c.url).split('.')[1];
    await expect(svc.estadoPublico(`${ORG_B}.${segredo}`, AGORA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.confirmar(`${ORG_B}.${segredo}`, { dia: '2026-11-03', hora: '14:00', email: 'x@cliente.invalid' }, AGORA)).rejects.toBeInstanceOf(NotFoundException);
    const deB = await svc.listar(ORG_B, AGORA);
    expect(deB.map((x) => x.id)).not.toContain(c.id);
    await expect(svc.revogar(ORG_B, c.id, AGORA)).rejects.toBeInstanceOf(ConflictException);
    // O lead de outra empresa não entra no convite.
    await expect(novo(ORG_B, { leadId: 'lead-convite-a' })).rejects.toThrow(/lead não existe/);
  });
});
