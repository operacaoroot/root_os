import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { EstadoDaSalaNoPainel, LinkDaSalaCopiado } from '@mktos/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { comContexto } from '../src/common/contexto-execucao';
import { ContextoInterceptor } from '../src/common/contexto.interceptor';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { SalaEstadoController } from '../src/comercial/sala-estado.controller';
import { SalaEstadoService, SoGenteNaSalaGuard, entregaDoLink } from '../src/comercial/sala-estado.service';
import { MARCADOR_DO_LINK_DA_SALA } from '../src/comercial/sala-token';
import { SalaService } from '../src/comercial/sala.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * QUANDO A SALA ENTRA (rodada de produção 1, P9, 21/10/2026).
 *
 *  1. a linha do tempo sai do que está gravado: sala criada pelo `lead.chegou`,
 *     o link "não entregue: WhatsApp simulado", nenhuma versão no ar, nenhuma
 *     visita; depois a versão na porta (com o caminho de Aprovações) e a visita;
 *  2. o estado NUNCA leva o link em claro;
 *  3. copiar o link: só `leads.editar` (403 sem ela), só gente (403 para conta
 *     de máquina, mesmo com a permissão no token), relido no banco (403 quando
 *     a permissão saiu depois do login); o link sai só na resposta, com
 *     auditoria `sala.link.copiado` sem o token, e o token não passa por log
 *     nenhum do processo nem fica gravado no banco;
 *  4. a regra da entrega, pura, em todos os ramos.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresa, pessoas, lead, sala, mensagem, versão, aprovação)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';

const MARCA = `se${Date.now().toString(36).slice(-6)}`;
const PERMS = ['leads.ver', 'leads.editar'];

describe('a regra da entrega do link (pura)', () => {
  const base = { id: 'm', template: 'M1', criadoEm: new Date('2026-10-20T12:00:00Z'), enviadaEm: null as Date | null };
  it('provedor de verdade = entregue, e vence a simulada', () => {
    const r = entregaDoLink([
      { ...base, provedor: 'simulado', estado: 'enviada', enviadaEm: new Date('2026-10-20T12:01:00Z') },
      { ...base, id: 'm2', template: 'M2', provedor: 'evolution', estado: 'enviada', enviadaEm: new Date('2026-10-21T09:00:00Z') },
    ]);
    expect(r.entrega).toBe('entregue');
    expect(r.marco.detalhe).toContain('Evolution');
    expect(r.marco.em).toBe('2026-10-21T09:00:00.000Z');
  });
  it('só simulada = "não entregue: WhatsApp simulado"', () => {
    const r = entregaDoLink([{ ...base, provedor: 'simulado', estado: 'enviada' }]);
    expect(r.entrega).toBe('simulado');
    expect(r.marco.rotulo).toBe('Não entregue: WhatsApp simulado');
    expect(r.marco.detalhe).toContain('primeira mensagem (M1)');
  });
  it('na fila aponta para Aprovações; falha e ausência dizem o que houve', () => {
    expect(entregaDoLink([{ ...base, provedor: 'evolution', estado: 'na_fila' }]).marco.link).toBe('/atendimento');
    expect(entregaDoLink([{ ...base, provedor: 'evolution', estado: 'falhou' }]).entrega).toBe('falhou');
    const nada = entregaDoLink([]);
    expect(nada.entrega).toBe('nao_preparado');
    expect(nada.marco.em).toBeNull();
  });
  it('nenhum texto da regra tem travessão', () => {
    const todos = [
      entregaDoLink([{ ...base, provedor: 'simulado', estado: 'enviada' }]),
      entregaDoLink([{ ...base, provedor: 'meta', estado: 'enviada' }]),
      entregaDoLink([{ ...base, provedor: 'evolution', estado: 'em_veto' }]),
      entregaDoLink([{ ...base, provedor: 'evolution', estado: 'falhou' }]),
      entregaDoLink([]),
    ];
    for (const r of todos) expect(`${r.marco.rotulo} ${r.marco.detalhe}`).not.toMatch(/[—–]/);
  });
});

describe.skipIf(!URL)('a aba Sala: o estado e copiar o link', { timeout: 30_000 }, () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const p = prisma as unknown as PrismaService;
  let ORG = '';
  let app: INestApplication;
  let baseUrl = '';
  let jwt: JwtService;
  let sala: SalaService;
  let leadId = '';
  let token = '';
  const ana = { id: '' };
  const leo = { id: '' };
  const robo = { id: '' };
  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> => comContexto({ orgId: ORG, correlationId: `sala-estado-${MARCA}`, origem: 'http' }, fn);

  const sessao = (id: string, permissions: string[], roles: string[]) =>
    jwt.signAsync({ typ: 'sessao', sub: id, orgId: ORG, permissions, roles, email: `${id}@qa.invalid`, name: 'Pessoa sintética' });
  const pedir = async (metodo: 'GET' | 'POST', caminho: string, tk: string) => {
    const r = await fetch(`${baseUrl}${caminho}`, { method: metodo, headers: { authorization: `Bearer ${tk}`, 'content-type': 'application/json' } });
    const texto = await r.text();
    return { status: r.status, texto, corpo: texto ? JSON.parse(texto) : null, cache: r.headers.get('cache-control') };
  };

  beforeAll(async () => {
    vi.setSystemTime(new Date('2026-10-21T14:00:00-03:00'));
    ORG = (await prisma.org.create({ data: { name: `Sala estado ${MARCA}`, slug: `sala-estado-${MARCA}` } })).id;
    for (const key of PERMS) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    const gestor = await prisma.role.create({ data: { orgId: ORG, key: 'gestor_marketing', name: 'Gestor', permissions: { connect: PERMS.map((key) => ({ key })) } } });
    const leitor = await prisma.role.create({ data: { orgId: ORG, key: 'leitor', name: 'Leitor', permissions: { connect: [{ key: 'leads.ver' }] } } });
    const maquina = await prisma.role.create({ data: { orgId: ORG, key: 'ia_servico', name: 'IA', permissions: { connect: PERMS.map((key) => ({ key })) } } });
    ana.id = (await prisma.user.create({ data: { orgId: ORG, name: 'Ana', email: `ana.${MARCA}@qa.invalid`, passwordHash: 'x', roles: { connect: { id: gestor.id } } } })).id;
    leo.id = (await prisma.user.create({ data: { orgId: ORG, name: 'Leo', email: `leo.${MARCA}@qa.invalid`, passwordHash: 'x', roles: { connect: { id: leitor.id } } } })).id;
    robo.id = (await prisma.user.create({ data: { orgId: ORG, name: 'Robo', email: `robo.${MARCA}@qa.invalid`, passwordHash: 'x', roles: { connect: { id: maquina.id } } } })).id;

    const reacoes = new ReacoesRegistry();
    const fio = new FioService(p, reacoes);
    sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    leadId = (await prisma.lead.create({ data: { orgId: ORG, name: 'Marina Sintética', phone: '5532999990009' } })).id;
    await prisma.comercialFicha.create({ data: { leadId, orgId: ORG, empresa: 'Empresa Sintética' } });
    // A sala nasce PELA REAÇÃO ao `lead.chegou`, como na produção.
    await naEmpresa(() => fio.registrar(ORG, leadId, 'lead.chegou', `chegou-${MARCA}`, { telefone: '5532999990009', texto: 'oi' }));
    const link = await naEmpresa(() => sala.linkDoLead(ORG, leadId));
    token = link!.split('/s/').pop()!;
    // A primeira mensagem levou o MARCADOR (nunca o link) e saiu pelo simulado.
    await prisma.comercialMensagem.create({
      data: { orgId: ORG, leadId, direcao: 'saida', provedor: 'simulado', destino: 'lead', template: 'M1', texto: `Oi, a sua sala: ${MARCADOR_DO_LINK_DA_SALA}`, estado: 'enviada', enviadaEm: new Date() },
    });

    jwt = new JwtService({ secret: randomUUID() + randomUUID(), signOptions: { expiresIn: '15m' } });
    const reflector = new Reflector();
    const servico = new SalaEstadoService(p, sala, new AuditService(p));
    Reflect.defineMetadata('design:paramtypes', [SalaEstadoService], SalaEstadoController);
    const modulo = await Test.createTestingModule({
      controllers: [SalaEstadoController],
      providers: [{ provide: SalaEstadoService, useValue: servico }, { provide: JwtService, useValue: jwt }, Reflector, SoGenteNaSalaGuard],
    })
      .overrideGuard(JwtAuthGuard).useValue(new JwtAuthGuard(jwt))
      .overrideGuard(PermissionsGuard).useValue(new PermissionsGuard(reflector))
      .compile();
    app = modulo.createNestApplication({ logger: ['error', 'warn', 'log'] });
    app.useGlobalInterceptors(new ContextoInterceptor());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (app) await app.close();
    if (ORG) {
      await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
      await prisma.approval.deleteMany({ where: { orgId: ORG } });
      await prisma.salaVersao.deleteMany({ where: { leadId } });
      await prisma.comercialMensagem.deleteMany({ where: { leadId } });
      await prisma.comercialReacao.deleteMany({ where: { leadId } });
      await prisma.salaDoCliente.deleteMany({ where: { leadId } });
      await prisma.comercialFicha.deleteMany({ where: { leadId } });
      await prisma.leadEvent.deleteMany({ where: { leadId } });
      await prisma.lead.deleteMany({ where: { orgId: ORG } });
      await prisma.user.deleteMany({ where: { orgId: ORG } });
      await prisma.role.deleteMany({ where: { orgId: ORG } });
      await prisma.org.delete({ where: { id: ORG } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('a linha do tempo sai do que está gravado, e o estado não leva o link', async () => {
    const r = await pedir('GET', `/comercial/lead/${leadId}/sala/estado`, await sessao(leo.id, ['leads.ver'], ['leitor']));
    expect(r.status).toBe(200);
    const e = r.corpo as EstadoDaSalaNoPainel;
    expect(e.temSala).toBe(true);
    expect(e.ativa).toBe(true);
    expect(e.linkDisponivel).toBe(true);
    expect(e.entrega).toBe('simulado');
    const porTipo = Object.fromEntries(e.marcos.map((m) => [m.tipo, m]));
    expect(porTipo.criada.detalhe).toContain('lead.chegou');
    expect(porTipo.criada.em).not.toBeNull();
    expect(porTipo.link.rotulo).toBe('Não entregue: WhatsApp simulado');
    expect(porTipo.publicada.rotulo).toBe('Nenhuma versão publicada');
    expect(porTipo.visita.em).toBeNull();
    expect(porTipo.na_porta).toBeUndefined();
    expect(r.texto).not.toContain(token);
    expect(r.texto).not.toContain('/s/');
  });

  it('a versão na porta aponta para Aprovações; a visita do cliente aparece', async () => {
    const aprovacao = await prisma.approval.create({
      data: {
        orgId: ORG, propostoPorId: ana.id, propostoPorTipo: 'user', capabilityId: 'comercial.sala.publicar',
        resourceType: 'comercial.sala', resourceId: `${leadId}:v1`, contentHash: 'h', resumo: 'publicar a sala v1',
        tokenHash: `tk-${MARCA}`, expiraEm: new Date(Date.now() + 3_600_000),
      },
    });
    await prisma.salaVersao.create({ data: { orgId: ORG, leadId, numero: 1, estado: 'na_porta', conteudo: {}, hash: 'a'.repeat(64), approvalId: aprovacao.id } });
    await naEmpresa(() => sala.visita(token, new Date(), { userAgent: 'Mozilla/5.0' }));

    const e = (await pedir('GET', `/comercial/lead/${leadId}/sala/estado`, await sessao(leo.id, ['leads.ver'], ['leitor']))).corpo as EstadoDaSalaNoPainel;
    const porTipo = Object.fromEntries(e.marcos.map((m) => [m.tipo, m]));
    expect(porTipo.na_porta.rotulo).toBe('Versão 1 esperando outra pessoa');
    expect(porTipo.na_porta.link).toBe('/atendimento');
    expect(porTipo.visita.rotulo).toBe('Última visita do cliente');
    expect(porTipo.visita.detalhe).toBe('Uma visita até agora.');

    // Vencida, o pedido deixa de valer e o marco diz isso.
    await prisma.approval.update({ where: { id: aprovacao.id }, data: { expiraEm: new Date(Date.now() - 1000) } });
    const vencido = (await pedir('GET', `/comercial/lead/${leadId}/sala/estado`, await sessao(leo.id, ['leads.ver'], ['leitor']))).corpo as EstadoDaSalaNoPainel;
    expect(vencido.marcos.find((m) => m.tipo === 'na_porta')?.rotulo).toBe('O pedido da versão 1 não vale mais');
  });

  it('copiar o link: sem leads.editar é 403, e conta de máquina também', async () => {
    const semEditar = await pedir('POST', `/comercial/lead/${leadId}/sala/link`, await sessao(leo.id, ['leads.ver'], ['leitor']));
    expect(semEditar.status).toBe(403);
    expect(semEditar.texto).not.toContain(token);
    const maquina = await pedir('POST', `/comercial/lead/${leadId}/sala/link`, await sessao(robo.id, PERMS, ['ia_servico']));
    expect(maquina.status).toBe(403);
    expect(maquina.texto).not.toContain(token);
    // Token antigo de quem tinha a permissão, mas o papel no banco não diz mais isso.
    const forjado = await pedir('POST', `/comercial/lead/${leadId}/sala/link`, await sessao(leo.id, PERMS, ['leitor']));
    expect(forjado.status).toBe(403);
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: 'sala.link.copiado' } })).toBe(0);
  });

  it('copiar o link: o token sai só na resposta, a auditoria diz quem e quando, nenhum log nem tabela guarda o token', async () => {
    const saidas: string[] = [];
    const guardar = (...a: unknown[]) => { saidas.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
    const espias = [
      vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => { guardar(String(c)); return true; }),
      vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => { guardar(String(c)); return true; }),
      vi.spyOn(console, 'log').mockImplementation(guardar),
      vi.spyOn(console, 'warn').mockImplementation(guardar),
      vi.spyOn(console, 'error').mockImplementation(guardar),
      vi.spyOn(Logger.prototype, 'log').mockImplementation(guardar as never),
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(guardar as never),
      vi.spyOn(Logger.prototype, 'error').mockImplementation(guardar as never),
    ];
    let r: Awaited<ReturnType<typeof pedir>>;
    try {
      r = await pedir('POST', `/comercial/lead/${leadId}/sala/link`, await sessao(ana.id, PERMS, ['gestor_marketing']));
    } finally {
      for (const e of espias) e.mockRestore();
    }
    expect(r.status).toBe(200);
    expect(r.cache).toBe('no-store');
    const copiado = r.corpo as LinkDaSalaCopiado;
    expect(copiado.link.endsWith(`/s/${token}`)).toBe(true);
    expect(saidas.join('\n')).not.toContain(token);

    const auditoria = await prisma.auditLog.findMany({ where: { orgId: ORG, action: 'sala.link.copiado' } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0].actorId).toBe(ana.id);
    expect(auditoria[0].createdAt).toBeInstanceOf(Date);
    expect(JSON.stringify(auditoria[0])).not.toContain(token);

    const tudo = JSON.stringify([
      await prisma.auditLog.findMany({ where: { orgId: ORG } }),
      await prisma.leadEvent.findMany({ where: { leadId } }),
      await prisma.comercialMensagem.findMany({ where: { leadId } }),
      await prisma.comercialReacao.findMany({ where: { leadId } }),
      await prisma.salaDoCliente.findMany({ where: { leadId }, select: { dados: true, slug: true } }),
    ]);
    expect(tudo).not.toContain(token);
  });
});
