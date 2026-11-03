import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { notaDaBusca, ordenarBusca } from '../src/agenda/busca/busca';
import { BuscaDaAgendaService } from '../src/agenda/busca/busca.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A BUSCA DO CLIENTE NO PAINEL DE MARCAR (agenda v2, 29/10/2026, lane G3).
 * Tudo FICTÍCIO: empresas e e-mails inventados.
 *
 *  · sem acento e sem caixa, por nome do lead, empresa da ficha e cliente;
 *  · a etapa do Funil e o contato vêm junto;
 *  · conta no espelho quantas vezes o nome esteve na agenda (sem cancelado, sem futuro);
 *  · NUNCA atravessa empresa: o lead e o evento de outra empresa não aparecem nem contam;
 *  · menos de 2 letras é 400; no máximo 8 resultados.
 */

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-agenda-busca-g3';
const ORG2 = 'org-teste-agenda-busca-g3-b';

describe('a ordem da busca (pura)', () => {
  const c = (nome: string, tipo: 'lead' | 'cliente' = 'lead', outros: string[] = []) => ({ id: nome, tipo, nome, outros });
  it('começa > palavra começa > contém; nada casa = nulo', () => {
    expect(notaDaBusca('fic', c('Fictícia Peças'))).toBe(0);
    expect(notaDaBusca('pec', c('Fictícia Peças'))).toBe(1);
    expect(notaDaBusca('eca', c('Fictícia Peças'))).toBe(2);
    expect(notaDaBusca('xyz', c('Fictícia Peças'))).toBeNull();
  });
  it('sem acento e sem caixa, também pelos outros nomes', () => {
    expect(notaDaBusca('PECAS', c('Fictícia Peças'))).toBe(1);
    expect(notaDaBusca('joao', c('Ferragens Ficticias', 'lead', ['João Exemplo']))).toBe(0);
  });
  it('no empate, cliente antes de lead; até o limite', () => {
    const r = ordenarBusca('ab', [c('Abc Lead'), c('Abc Cliente', 'cliente'), c('Zab'), c('Abd')], 3);
    expect(r.map((x) => x.nome)).toEqual(['Abc Cliente', 'Abc Lead', 'Abd']);
  });
});

if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (duas empresas, leads, fichas, clientes e eventos do espelho)');

describe.skipIf(!URL)('GET /agenda/clientes contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: BuscaDaAgendaService;
  const AGORA = new Date('2026-10-29T15:00:00.000Z');

  async function limpar() {
    for (const org of [ORG, ORG2]) {
      await prisma.agendaEvento.deleteMany({ where: { orgId: org } });
      const leads = (await prisma.lead.findMany({ where: { orgId: org }, select: { id: true } })).map((l) => l.id);
      await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.lead.deleteMany({ where: { orgId: org } });
      await prisma.partner.deleteMany({ where: { orgId: org } });
    }
  }

  let seq = 0;
  async function evento(org: string, cliente: string, inicio: string, responsaveis: string[], status = 'confirmado') {
    seq++;
    await prisma.agendaEvento.create({
      data: {
        orgId: org,
        agenda: 'primary',
        googleId: `ev-g3-${seq}`,
        titulo: `Reunião Online - ${cliente} - ${responsaveis[0]}`,
        inicio: new Date(inicio),
        fim: new Date(new Date(inicio).getTime() + 3_600_000),
        status,
        leituraTipo: 'cliente',
        leituraCliente: cliente,
        leituraResponsaveis: responsaveis,
        leituraModalidade: 'online',
      },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const org of [ORG, ORG2]) {
      await prisma.org.upsert({ where: { id: org }, create: { id: org, name: org, slug: org }, update: {} });
    }
    await limpar();

    // Empresa A
    const ficticia = await prisma.lead.create({ data: { orgId: ORG, name: 'Marcos Exemplo', email: 'marcos@ficticia.exemplo' }, select: { id: true } });
    await prisma.comercialFicha.create({ data: { leadId: ficticia.id, empresa: 'Fictícia Peças', etapa: 'proposta' } });
    await prisma.lead.create({ data: { orgId: ORG, name: 'João Ficticio' } });
    await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Exemplaria Serviços Ltda', nomeFantasia: 'Exemplaria', email: 'contato@exemplaria.invalid' } });
    await prisma.partner.create({ data: { orgId: ORG, isCliente: false, isFornecedor: true, razaoSocial: 'Fictícia Fornecedor' } });
    for (let i = 0; i < 10; i++) await prisma.lead.create({ data: { orgId: ORG, name: `Abelha ${i} Exemplo` } });
    await evento(ORG, 'Fictícia Peças', '2026-10-15T13:00:00.000Z', ['Pedro']);
    await evento(ORG, 'Ficticia Pecas', '2026-10-21T13:00:00.000Z', ['Rodrigo']);
    await evento(ORG, 'Fictícia Peças', '2026-10-25T13:00:00.000Z', ['Lucas'], 'cancelado');
    await evento(ORG, 'Fictícia Peças', '2026-11-06T18:00:00.000Z', ['Rodrigo']);

    // Empresa B: o mesmo nome, que nunca pode aparecer nem contar na A.
    const deB = await prisma.lead.create({ data: { orgId: ORG2, name: 'Pessoa de Outra Empresa', email: 'b@outra.exemplo' }, select: { id: true } });
    await prisma.comercialFicha.create({ data: { leadId: deB.id, empresa: 'Fictícia Peças Filial', etapa: 'contrato' } });
    await evento(ORG2, 'Fictícia Peças', '2026-10-20T13:00:00.000Z', ['Lucas']);
    await evento(ORG2, 'Fictícia Peças', '2026-10-22T13:00:00.000Z', ['Lucas']);

    svc = new BuscaDaAgendaService(prisma as unknown as PrismaService);
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    for (const org of [ORG, ORG2]) await prisma.org.deleteMany({ where: { id: org } });
    await prisma.$disconnect();
  });

  it('acha o lead pela empresa da ficha, sem acento, com etapa, contato e a agenda', async () => {
    const r = await svc.buscar(ORG, 'ficticia pecas', AGORA);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      tipo: 'lead',
      nome: 'Fictícia Peças',
      etapa: 'Proposta',
      contato: { nome: 'Marcos Exemplo', email: 'marcos@ficticia.exemplo' },
    });
    // Duas vezes no passado (o cancelado e o futuro não contam), a última em 21/10 com o Rodrigo.
    expect(r[0].naAgenda).toEqual({ vezes: 2, ultima: '2026-10-21T13:00:00.000Z', com: ['Rodrigo'] });
  });

  it('acha o cliente (Partner) pelo nome fantasia e pela razão social; fornecedor não entra', async () => {
    const porFantasia = await svc.buscar(ORG, 'EXEMPLARIA', AGORA);
    expect(porFantasia.map((x) => [x.tipo, x.nome])).toEqual([['cliente', 'Exemplaria']]);
    expect(porFantasia[0].contato).toEqual({ nome: null, email: 'contato@exemplaria.invalid' });
    expect((await svc.buscar(ORG, 'servicos', AGORA)).map((x) => x.nome)).toEqual(['Exemplaria']);
    expect((await svc.buscar(ORG, 'ficticia', AGORA)).map((x) => x.nome)).toEqual(['Fictícia Peças']);
  });

  it('acha o lead pelo nome da pessoa, sem acento', async () => {
    const r = await svc.buscar(ORG, 'joao', AGORA);
    expect(r.map((x) => x.nome)).toEqual(['João Ficticio']);
    expect(r[0].naAgenda).toEqual({ vezes: 0, ultima: null, com: [] });
  });

  it('nunca atravessa empresa: nem o lead, nem a contagem da outra', async () => {
    const naB = await svc.buscar(ORG2, 'ficticia', AGORA);
    expect(naB).toHaveLength(1);
    expect(naB[0]).toMatchObject({ nome: 'Fictícia Peças Filial', etapa: 'Contrato' });
    // O nome é outro: os dois eventos de "Fictícia Peças" da B não somam ao da filial, nem aos da A.
    expect(naB[0].naAgenda.vezes).toBe(0);
    const naA = await svc.buscar(ORG, 'filial', AGORA);
    expect(naA).toEqual([]);
  });

  it('menos de 2 letras é 400; no máximo 8 resultados', async () => {
    await expect(svc.buscar(ORG, 'a', AGORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.buscar(ORG, '  ', AGORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.buscar(ORG, undefined, AGORA)).rejects.toBeInstanceOf(BadRequestException);
    expect(await svc.buscar(ORG, 'abelha', AGORA)).toHaveLength(8);
  });
});
