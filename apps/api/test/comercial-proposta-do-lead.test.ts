import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  CriarLeadDaPropostaSchema,
  PROPOSTA_JA_VINCULADA,
  VincularPropostaSchema,
  VistaFunilSchema,
  refDaPropostaDoServico,
} from '@mktos/shared';

import { AuditService } from '../src/audit/audit.service';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { ConfigComercialService } from '../src/comercial/config.service';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { MoverService, SoGenteGuard } from '../src/comercial/mover.service';
import { PropostaDoLeadController } from '../src/comercial/proposta-do-lead.controller';
import { PropostaDoLeadService, refDaEntradaDaProposta } from '../src/comercial/proposta-do-lead.service';
import { leadIdDaEntrada } from '../src/leads/entrada-de-lead';
import { LeadsService } from '../src/leads/leads.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A PROPOSTA É DO LEAD (rodada de produção 3, I5, 22/10/2026).
 *
 *  1. as regras puras: a referência da proposta do serviço, os schemas, a vista do funil com colunas e ordem;
 *  2. as rotas: ler é `leads.ver`; vincular e criar são `leads.editar` e de gente (`SoGenteGuard`);
 *  3. contra o banco: vincular grava com auditoria, de novo ao mesmo lead não muda nada, a outro lead é
 *     409 com a frase; lead de outra empresa é 404; conta de máquina e quem só lê são recusadas no banco;
 *     criar lead nasce em Qualificação pela entrada da tela (a mesma referência de antes), fica ligado à
 *     proposta, repetir não cria outro, e a proposta de outro lead é 409.
 */

describe('proposta do lead: as regras puras', () => {
  it('a referência da proposta do serviço só aceita os segmentos do serviço', () => {
    expect(refDaPropostaDoServico('cliente-x', 'escopo_1')).toBe('servico:cliente-x/escopo_1');
    expect(refDaPropostaDoServico('a', 'escopo')).toBeNull();
    expect(refDaPropostaDoServico('cliente/x', 'escopo')).toBeNull();
    expect(refDaPropostaDoServico('cliente', '../x')).toBeNull();
    expect(refDaEntradaDaProposta('servico:cliente-x/escopo_1')).toBe('proposta:cliente-x/escopo_1');
  });

  it('os schemas recusam referência torta, lead que não é id, nome vazio e campo a mais', () => {
    const lead = '0b7f2b0e-2c1a-4f3e-9a55-111111111111';
    expect(VincularPropostaSchema.safeParse({ proposta: 'servico:cli/escopo', leadId: lead }).success).toBe(true);
    expect(VincularPropostaSchema.safeParse({ proposta: 'sala:cli/escopo', leadId: lead }).success).toBe(false);
    expect(VincularPropostaSchema.safeParse({ proposta: 'servico:cli/escopo', leadId: 'x' }).success).toBe(false);
    expect(VincularPropostaSchema.safeParse({ proposta: 'servico:cli/escopo', leadId: lead, extra: 1 }).success).toBe(false);
    expect(CriarLeadDaPropostaSchema.safeParse({ proposta: 'servico:cli/escopo', nome: '  ' }).success).toBe(false);
    expect(CriarLeadDaPropostaSchema.safeParse({ proposta: 'servico:cli/escopo', nome: 'Empresa' }).success).toBe(true);
  });

  it('a vista do funil leva colunas e ordem, e a vista antiga continua valendo', () => {
    const base = { visao: 'lista', filtros: { dono: '', produto: '', perfil: '', etapa: '', parado: '', decisao: '', q: '' } };
    expect(VistaFunilSchema.safeParse(base).success).toBe(true);
    expect(VistaFunilSchema.safeParse({ ...base, colunas: ['empresa', 'valor'], ordem: 'valor:desc' }).success).toBe(true);
    expect(VistaFunilSchema.safeParse({ ...base, outra: 1 }).success).toBe(false);
  });

  it('as rotas: ler é leads.ver; vincular e criar são leads.editar e só de gente', () => {
    const h = PropostaDoLeadController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h.listar)).toEqual(['leads.ver']);
    for (const m of [h.vincular, h.criarLead]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, m)).toEqual(['leads.editar']);
      expect(Reflect.getMetadata('__guards__', m)).toEqual([SoGenteGuard]);
    }
  });
});

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-proposta-do-lead-i5';
const ORG2 = 'org-teste-proposta-do-lead-i5-b';
const PROPOSTA = 'servico:cliente-sintetico/escopo-ficticio';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, leads, fichas, fatos do fio, vínculos e auditoria)');

describe.skipIf(!URL)('proposta do lead contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: PropostaDoLeadService;
  type Quem = { id: string; nome: string | null; papeis: string[]; permissoes: string[] };
  let gente: Quem;
  let maquina: Quem;
  let leitor: Quem;

  async function limpar() {
    for (const org of [ORG, ORG2]) {
      const leads = (await prisma.lead.findMany({ where: { orgId: org }, select: { id: true } })).map((l) => l.id);
      await prisma.propostaDoLead.deleteMany({ where: { orgId: org } });
      await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.leadEvent.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.lead.deleteMany({ where: { orgId: org } });
      await prisma.auditLog.deleteMany({ where: { orgId: org } });
    }
  }

  async function lead(nome: string, org = ORG) {
    return (await prisma.lead.create({ data: { orgId: org, name: nome }, select: { id: true } })).id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await limpar();
    for (const org of [ORG, ORG2]) {
      await prisma.user.deleteMany({ where: { orgId: org } });
      await prisma.role.deleteMany({ where: { orgId: org } });
      await prisma.org.upsert({ where: { id: org }, create: { id: org, name: org, slug: org }, update: {} });
    }
    for (const key of ['leads.ver', 'leads.editar']) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin', permissions: { connect: [{ key: 'leads.ver' }, { key: 'leads.editar' }] } }, select: { id: true } });
    const ia = await prisma.role.create({ data: { orgId: ORG, key: 'ia_acao', name: 'IA ação', permissions: { connect: [{ key: 'leads.ver' }, { key: 'leads.editar' }] } }, select: { id: true } });
    const ver = await prisma.role.create({ data: { orgId: ORG, key: 'leitor_i5', name: 'Só lê', permissions: { connect: [{ key: 'leads.ver' }] } }, select: { id: true } });
    const criar = async (nome: string, roleId: string, papel: string, permissoes: string[]): Promise<Quem> => ({
      id: (await prisma.user.create({ data: { orgId: ORG, email: `${papel}-i5@proposta-do-lead.teste`, name: nome, passwordHash: 'x', roles: { connect: { id: roleId } } }, select: { id: true } })).id,
      nome,
      papeis: [papel],
      permissoes,
    });
    gente = await criar('Pessoa da Mesa', admin.id, 'admin_master', ['leads.ver', 'leads.editar']);
    maquina = await criar('Conta de IA', ia.id, 'ia_acao', ['leads.ver', 'leads.editar']);
    // O token ainda diz leads.editar; o banco não: a releitura recusa.
    leitor = await criar('Pessoa que só lê', ver.id, 'leitor_i5', ['leads.ver', 'leads.editar']);

    const p = prisma as unknown as PrismaService;
    const fio = new FioService(p, new ReacoesRegistry());
    const fichas = new FichaService(p, fio, new ConfigComercialService(p));
    const leads = new LeadsService(p, new AuditService(p), {} as never);
    svc = new PropostaDoLeadService(p, leads, fichas, new MoverService(p, fichas));
  }, 60_000);
  beforeEach(limpar);
  afterAll(async () => {
    await limpar();
    for (const org of [ORG, ORG2]) {
      await prisma.user.deleteMany({ where: { orgId: org } });
      await prisma.role.deleteMany({ where: { orgId: org } });
      await prisma.org.deleteMany({ where: { id: org } });
    }
    await prisma.$disconnect();
  });

  it('vincular grava o vínculo com a auditoria; de novo ao mesmo lead não muda nada', async () => {
    const a = await lead('Empresa Sintética A');
    const r = await svc.vincular(ORG, { proposta: PROPOSTA, leadId: a }, gente);
    expect(r).toMatchObject({ mudou: true, vinculo: { proposta: PROPOSTA, leadId: a, como: 'vinculada' } });
    const de = await svc.vincular(ORG, { proposta: PROPOSTA, leadId: a }, gente);
    expect(de.mudou).toBe(false);
    expect(await prisma.propostaDoLead.count({ where: { orgId: ORG } })).toBe(1);
    const auditoria = await prisma.auditLog.findMany({ where: { orgId: ORG, action: 'comercial.proposta.vinculada' } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ actorId: gente.id, entityType: 'lead', entityId: a });
    expect((await svc.listar(ORG)).vinculos).toEqual([expect.objectContaining({ proposta: PROPOSTA, leadId: a, como: 'vinculada' })]);
    expect((await svc.listar(ORG2)).vinculos).toEqual([]);
  });

  it('a proposta já vinculada a outro lead é 409 com a frase, e o vínculo fica onde estava', async () => {
    const a = await lead('Empresa Sintética A');
    const b = await lead('Empresa Sintética B');
    await svc.vincular(ORG, { proposta: PROPOSTA, leadId: a }, gente);
    const erro = await svc.vincular(ORG, { proposta: PROPOSTA, leadId: b }, gente).catch((e) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as ConflictException).getResponse()).toMatchObject({ message: PROPOSTA_JA_VINCULADA, leadId: a });
    expect((await prisma.propostaDoLead.findFirstOrThrow({ where: { orgId: ORG, proposta: PROPOSTA } })).leadId).toBe(a);
  });

  it('dois pedidos ao mesmo tempo para leads diferentes: um grava, o outro ouve 409', async () => {
    const a = await lead('Empresa Sintética A');
    const b = await lead('Empresa Sintética B');
    const r = await Promise.allSettled([svc.vincular(ORG, { proposta: PROPOSTA, leadId: a }, gente), svc.vincular(ORG, { proposta: PROPOSTA, leadId: b }, gente)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.filter((x) => x.status === 'rejected').map((x) => (x as PromiseRejectedResult).reason)).toEqual([expect.any(ConflictException)]);
    expect(await prisma.propostaDoLead.count({ where: { orgId: ORG } })).toBe(1);
  });

  it('lead de outra empresa é 404, corpo torto é 400, e nada é gravado', async () => {
    const deFora = await lead('Empresa de Fora', ORG2);
    await expect(svc.vincular(ORG, { proposta: PROPOSTA, leadId: deFora }, gente)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.vincular(ORG, { proposta: 'servico:x/y', leadId: deFora }, gente)).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.propostaDoLead.count()).toBe(0);
  });

  it('conta de máquina e quem perdeu leads.editar são recusadas na releitura do banco', async () => {
    const a = await lead('Empresa Sintética A');
    await expect(svc.vincular(ORG, { proposta: PROPOSTA, leadId: a }, maquina)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.vincular(ORG, { proposta: PROPOSTA, leadId: a }, leitor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.criarLead(ORG, { proposta: PROPOSTA, nome: 'Empresa Nova' }, leitor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await prisma.propostaDoLead.count({ where: { orgId: ORG } })).toBe(0);
    expect(await prisma.lead.count({ where: { orgId: ORG } })).toBe(1);
  });

  it('criar lead: nasce em Qualificação pela entrada da tela, ligado à proposta; repetir não cria outro', async () => {
    const r = await svc.criarLead(ORG, { proposta: PROPOSTA, nome: 'Empresa Nova Sintética' }, gente);
    expect(r).toMatchObject({ mudou: true, leadCriado: true, vinculo: { proposta: PROPOSTA, como: 'criada' } });
    const id = r.vinculo.leadId;
    // A mesma referência que a tela usava antes: o lead criado por ela é o mesmo.
    expect(id).toBe(leadIdDaEntrada(ORG, { tipo: 'manual', ref: 'proposta:cliente-sintetico/escopo-ficticio' }));
    expect(await prisma.lead.findFirstOrThrow({ where: { id, orgId: ORG } })).toMatchObject({ name: 'Empresa Nova Sintética' });
    expect((await prisma.comercialFicha.findFirstOrThrow({ where: { leadId: id } })).etapa).toBe('qualificacao');
    expect(await prisma.leadEvent.count({ where: { leadId: id, type: 'etapa.movida_a_mao' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: 'comercial.proposta.lead_criado', entityId: id } })).toBe(1);

    const de = await svc.criarLead(ORG, { proposta: PROPOSTA, nome: 'Empresa Nova Sintética' }, gente);
    expect(de).toMatchObject({ mudou: false, leadCriado: false, vinculo: { leadId: id } });
    expect(await prisma.lead.count({ where: { orgId: ORG } })).toBe(1);
    expect(await prisma.leadEvent.count({ where: { leadId: id, type: 'etapa.movida_a_mao' } })).toBe(1);
  });

  it('criar lead para a proposta que já é de outro lead é 409, e nenhum lead nasce', async () => {
    const a = await lead('Empresa Sintética A');
    await svc.vincular(ORG, { proposta: PROPOSTA, leadId: a }, gente);
    await expect(svc.criarLead(ORG, { proposta: PROPOSTA, nome: 'Outra' }, gente)).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.lead.count({ where: { orgId: ORG } })).toBe(1);
  });

  it('criar lead reaproveita o lead que a tela criou antes pela proposta e não mexe na etapa dele', async () => {
    const id = leadIdDaEntrada(ORG, { tipo: 'manual', ref: refDaEntradaDaProposta(PROPOSTA) });
    await prisma.lead.create({ data: { id, orgId: ORG, name: 'Criado Antes' } });
    await prisma.comercialFicha.create({ data: { leadId: id, etapa: 'proposta' } });
    const r = await svc.criarLead(ORG, { proposta: PROPOSTA, nome: 'Criado Antes' }, gente);
    expect(r).toMatchObject({ mudou: true, leadCriado: false, vinculo: { leadId: id, como: 'criada' } });
    expect((await prisma.comercialFicha.findFirstOrThrow({ where: { leadId: id } })).etapa).toBe('proposta');
  });
});
