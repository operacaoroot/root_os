import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { classificar } from '@mktos/policy';
import { ContratoEncerrarSchema } from '@mktos/shared';
import { ContratoVivoService, EFEITO_DE_ENCERRAR_CONTRATO, ordenarContratos } from '../src/comercial/contrato-vivo.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import type { DecisoesService } from '../src/comercial/decisoes.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * CONTRATOS VIVOS: ENCERRAR À MÃO (rodada do trabalho T8, 19/10/2026).
 *
 *  1. o nível sai do efeito pela escada: escrita interna, R0;
 *  2. motivo obrigatório; conta de máquina não encerra;
 *  3. parcela em aberto AVISA e pede ciência, e a cobrança fica como está;
 *  4. vai ao fio e à auditoria, uma vez só (o segundo é 409);
 *  5. a lista põe ativos primeiro e concluídos e desativados por último; em
 *     implantação é o ativo com o card da implantação aberto.
 */

describe('encerrar contrato: as regras puras', () => {
  it('o efeito classifica R0 pela escada', () => {
    expect(classificar(EFEITO_DE_ENCERRAR_CONTRATO)).toBe('R0');
  });
  it('motivo é obrigatório', () => {
    expect(ContratoEncerrarSchema.safeParse({ situacao: 'concluido', motivo: '' }).success).toBe(false);
    expect(ContratoEncerrarSchema.safeParse({ situacao: 'cancelado', motivo: 'acabou o escopo' }).success).toBe(false);
    expect(ContratoEncerrarSchema.safeParse({ situacao: 'desativado', motivo: 'cliente pediu a pausa' }).success).toBe(true);
  });
});

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-contrato-encerrar';
const EU = 'u-contrato-encerrar';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (uma empresa, leads, fichas, cobranças e o fio)');

describe.skipIf(!URL)('encerrar contrato contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: ContratoVivoService;
  const quem = { id: EU, papeis: ['admin_master'] };

  async function limpar() {
    const leads = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
    await prisma.comercialCobranca.deleteMany({ where: { leadId: { in: leads } } });
    await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leads } } });
    await prisma.leadEvent.deleteMany({ where: { leadId: { in: leads } } });
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.workTask.deleteMany({ where: { orgId: ORG } });
    await prisma.workStatus.deleteMany({ where: { orgId: ORG } });
    await prisma.workList.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
  }

  async function cliente(nome: string, opcoes: { parcelaAberta?: boolean; cardAberto?: boolean } = {}) {
    const lead = await prisma.lead.create({ data: { orgId: ORG, name: nome, status: 'ganho' }, select: { id: true } });
    let cardId: string | null = null;
    if (opcoes.cardAberto) {
      const lista = await prisma.workList.create({ data: { orgId: ORG, name: `Onboarding ${nome}` } });
      const st = await prisma.workStatus.create({ data: { orgId: ORG, listId: lista.id, name: 'Kickoff marcado', type: 'open', order: 0 } });
      cardId = (await prisma.workTask.create({ data: { orgId: ORG, listId: lista.id, statusId: st.id, title: nome } })).id;
    }
    await prisma.comercialFicha.create({ data: { leadId: lead.id, etapa: 'fechado', empresa: nome, cnpj: '12345678000190', socioDaConta: 'Rodrigo', cardId } });
    await prisma.leadEvent.create({ data: { leadId: lead.id, type: 'cliente.ativo', payload: { chave: `fech-${lead.id}-v1` }, occurredAt: new Date() } });
    if (opcoes.parcelaAberta) {
      await prisma.comercialCobranca.create({ data: { leadId: lead.id, provedor: 'asaas', externoId: `pay-${lead.id}`, parcela: 1, parcelas: 3, valorCentavos: 399_900, forma: 'pix', vence: new Date(Date.now() + 5 * 86_400_000) } });
    }
    return lead.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    svc = new ContratoVivoService(p, new FioService(p, new ReacoesRegistry()), new RelogioComercialRegistry(), {} as DecisoesService);
    await prisma.org.upsert({ where: { id: ORG }, create: { id: ORG, name: ORG, slug: ORG }, update: {} });
    await prisma.user.upsert({ where: { id: EU }, create: { id: EU, orgId: ORG, name: 'Rodrigo Saggioro', email: `${EU}@teste.local`, passwordHash: 'x' }, update: {} });
  });
  beforeEach(limpar);
  afterAll(async () => {
    await limpar();
    await prisma.user.deleteMany({ where: { id: EU } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  it('concluir vai ao fio e à auditoria uma vez, e o contrato vai para o fim da lista', async () => {
    const a = await cliente('Construtora Alicerce');
    const b = await cliente('Studio Lume', { cardAberto: true });
    const c = await cliente('Café Serra');
    let lista = await svc.lista(ORG);
    expect(lista.map((x) => [x.cliente, x.situacao])).toEqual([['Café Serra', 'ativo'], ['Construtora Alicerce', 'ativo'], ['Studio Lume', 'em_implantacao']]);
    const feito = await svc.encerrar(ORG, a, quem, { situacao: 'concluido', motivo: 'Escopo entregue e aceito.' });
    expect(feito.situacao).toBe('concluido');
    expect(feito.encerramento).toMatchObject({ situacao: 'concluido', motivo: 'Escopo entregue e aceito.', por: 'Rodrigo Saggioro', parcelasEmAberto: 0 });
    await expect(svc.encerrar(ORG, a, quem, { situacao: 'desativado', motivo: 'de novo' })).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.leadEvent.count({ where: { leadId: a, type: { in: ['contrato.concluido', 'contrato.desativado'] } } })).toBe(1);
    const linha = await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: 'comercial.contrato.encerrado', entityId: a } });
    expect(linha.after).toMatchObject({ situacao: 'concluido', nivel: 'R0' });
    await svc.encerrar(ORG, c, quem, { situacao: 'desativado', motivo: 'Cliente pediu a pausa.' });
    lista = await svc.lista(ORG);
    expect(lista.map((x) => [x.cliente, x.situacao])).toEqual([
      ['Studio Lume', 'em_implantacao'], ['Construtora Alicerce', 'concluido'], ['Café Serra', 'desativado'],
    ]);
    expect(ordenarContratos(lista)).toEqual(lista);
    void b;
  });

  it('parcela em aberto avisa e pede ciência; a cobrança fica como está', async () => {
    const a = await cliente('Ótica Vista', { parcelaAberta: true });
    await expect(svc.encerrar(ORG, a, quem, { situacao: 'desativado', motivo: 'Cliente desistiu.' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.leadEvent.count({ where: { leadId: a, type: 'contrato.desativado' } })).toBe(0);
    const r = await svc.encerrar(ORG, a, quem, { situacao: 'desativado', motivo: 'Cliente desistiu.', cienteDasParcelas: true });
    expect(r.encerramento?.parcelasEmAberto).toBe(1);
    const cobranca = await prisma.comercialCobranca.findFirstOrThrow({ where: { leadId: a } });
    expect(cobranca.pagaEm).toBeNull();
    expect(cobranca.estado).not.toBe('cancelada');
  });

  it('conta de máquina não encerra; lead sem contrato vivo é 404', async () => {
    const a = await cliente('Rede Pão Bom');
    await expect(svc.encerrar(ORG, a, { id: EU, papeis: ['ia_acao'] }, { situacao: 'concluido', motivo: 'tentativa da máquina' })).rejects.toBeInstanceOf(ForbiddenException);
    const solto = await prisma.lead.create({ data: { orgId: ORG, name: 'Sem contrato', status: 'novo' }, select: { id: true } });
    await expect(svc.encerrar(ORG, solto.id, quem, { situacao: 'concluido', motivo: 'não existe' })).rejects.toThrow(/Contrato vivo não encontrado/);
  });
});
