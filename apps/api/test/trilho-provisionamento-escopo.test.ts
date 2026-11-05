import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { comContexto } from '../src/common/contexto-execucao';
import { KitDoTrilhoService } from '../src/onboarding/trilho/kit/kit.service';
import { TrilhoService } from '../src/onboarding/trilho/trilho.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import { exigirBancoDescartavel } from './banco-de-teste';
import { exigirParDeBancosDescartaveis } from './papel-restrito-banco';

const URL = process.env.TEST_DATABASE_URL;
const URL_RESTRITA = process.env.MKTOS_TESTAR_TRILHO_RLS === '1' ? process.env.TENANT_DATABASE_URL : undefined;
if (process.env.MKTOS_TESTAR_TRILHO_RLS === '1') {
  exigirParDeBancosDescartaveis(URL ?? '', URL_RESTRITA ?? '');
} else {
  exigirBancoDescartavel(URL ?? '', 'testa vínculos de provisionamento e memória do trilho');
}

describe.skipIf(!URL)('prova do destino da memória do trilho', () => {
  let prisma: PrismaClient;
  let aplicacao: PrismaService;
  const origemId = randomUUID();
  const alvos: string[] = [];
  const quem = { id: randomUUID(), nome: 'Operador sintético' };
  const naOrigem = <T>(fn: () => Promise<T>) =>
    comContexto({ orgId: origemId, actorType: 'user', actorId: quem.id, correlationId: randomUUID(), origem: 'http' }, fn);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    aplicacao = URL_RESTRITA
      ? comTenantNaSessao(new PrismaService({ datasourceUrl: URL_RESTRITA }), { modo: 'impor' })
      : prisma as unknown as PrismaService;
    await prisma.org.create({ data: { id: origemId, slug: `qa-${origemId}`, name: 'Origem sintética' } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.onboardingTrilho.deleteMany({ where: { orgId: origemId } });
    await prisma.contextItem.deleteMany({ where: { orgId: { in: alvos } } });
    await prisma.org.deleteMany({ where: { id: { in: [origemId, ...alvos] } } });
    if (URL_RESTRITA) await aplicacao.$disconnect();
    await prisma.$disconnect();
  });

  async function cenario(vinculado = false) {
    const alvoId = randomUUID();
    const slug = `qa-${alvoId}`;
    await prisma.org.create({ data: { id: alvoId, slug, name: 'Destino sintético' } });
    alvos.push(alvoId);
    const trilho = await prisma.onboardingTrilho.create({
      data: { orgId: origemId, slug, cliente: 'Cliente sintético', empresaId: vinculado ? alvoId : null },
    });
    const provisionar = vi.fn().mockResolvedValue({ orgId: alvoId, slug, criada: false });
    const memoria = {
      porChave: vi.fn().mockResolvedValue(null),
      criar: vi.fn().mockResolvedValue({ id: randomUUID() }),
    };
    const eventos = { registrar: vi.fn().mockResolvedValue({ id: randomUUID() }) };
    const servico = new TrilhoService(aplicacao, memoria as never, eventos as never, { provisionar } as never);
    return { alvoId, slug, trilho, servico, provisionar, memoria };
  }

  it('não adota uma empresa preexistente com o mesmo slug', async () => {
    const { alvoId, trilho, servico } = await cenario();

    await expect(naOrigem(() => servico.provisionarEmpresa(origemId, trilho.id, quem))).rejects.toMatchObject({ status: 409 });
    expect(await prisma.onboardingTrilho.findUnique({ where: { id: trilho.id } })).toMatchObject({ empresaId: null });
    expect(await prisma.onboardingMarco.count({
      where: { orgId: origemId, trilhoId: trilho.id, dados: { path: ['empresaId'], equals: alvoId } },
    })).toBe(0);
  });

  it('recusa gravar memória e reutilizar um vínculo legado por mera coincidência de slug', async () => {
    const { alvoId, trilho, servico, memoria, provisionar } = await cenario(true);
    await prisma.onboardingMarco.create({
      data: { orgId: origemId, trilhoId: trilho.id, tipo: 'empresa.provisionada', texto: 'já existia', dados: { empresaId: alvoId, criada: false } },
    });
    await prisma.onboardingItem.create({
      data: { orgId: origemId, trilhoId: trilho.id, temaId: 'negocio', bloco: 'B', status: 'confirmado', textoFinal: 'Conteúdo sintético de outra empresa.' },
    });

    await expect(naOrigem(() => servico.carregarMemoria(origemId, trilho.id, quem))).rejects.toMatchObject({ status: 409 });
    await expect(naOrigem(() => servico.provisionarEmpresa(origemId, trilho.id, quem))).rejects.toMatchObject({ status: 409 });
    expect(memoria.porChave).not.toHaveBeenCalled();
    expect(memoria.criar).not.toHaveBeenCalled();
    expect(provisionar).not.toHaveBeenCalled();
  });

  it('o kit usa o contexto local quando o vínculo legado não foi comprovado', async () => {
    const { alvoId, trilho, servico } = await cenario(true);
    await prisma.onboardingItem.create({
      data: { orgId: origemId, trilhoId: trilho.id, temaId: 'negocio', bloco: 'B', status: 'confirmado', textoFinal: 'Contexto sintético do trilho.' },
    });
    await prisma.contextItem.create({
      data: { orgId: alvoId, chave: 'onboarding:negocio', title: 'Nota sintética do destino', body: 'Nota exclusiva do destino.', sourceType: 'operador', contentHash: 'qa-kit' },
    });
    const pararNoModelo = new Error('fim da observação');
    const step = vi.fn().mockRejectedValue(pararNoModelo);
    const kit = new KitDoTrilhoService({ step } as never, aplicacao, servico);

    await expect(naOrigem(() => kit.montar(origemId, trilho.id, quem))).rejects.toBe(pararNoModelo);
    expect(step).toHaveBeenCalledOnce();
    const prompt = step.mock.calls[0][0].turns[0].text;
    expect(prompt).toContain('Contexto sintético do trilho.');
    expect(prompt).not.toContain('Nota exclusiva do destino.');

    await prisma.onboardingMarco.create({
      data: { orgId: origemId, trilhoId: trilho.id, tipo: 'empresa.provisionada', texto: 'criada', dados: { empresaId: alvoId, criada: true } },
    });
    await expect(naOrigem(() => kit.montar(origemId, trilho.id, quem))).rejects.toBe(pararNoModelo);
    expect(step.mock.calls[1][0].turns[0].text).toContain('Nota exclusiva do destino.');
  });

  it('preserva a prova do único vencedor quando o outro pedido encontra o mesmo slug', async () => {
    const { alvoId, slug, trilho, servico, provisionar } = await cenario();
    let liberarVencedor!: () => void;
    let liberarConcorrente!: () => void;
    let entrouVencedor!: () => void;
    let entrouConcorrente!: () => void;
    const vencedorEntrou = new Promise<void>((resolve) => { entrouVencedor = resolve; });
    const concorrenteEntrou = new Promise<void>((resolve) => { entrouConcorrente = resolve; });
    provisionar.mockImplementationOnce(async () => {
      entrouVencedor();
      await new Promise<void>((resolve) => { liberarVencedor = resolve; });
      return { orgId: alvoId, slug, criada: true };
    }).mockImplementationOnce(async () => {
      entrouConcorrente();
      await new Promise<void>((resolve) => { liberarConcorrente = resolve; });
      return { orgId: alvoId, slug, criada: false };
    });

    const vencedor = naOrigem(() => servico.provisionarEmpresa(origemId, trilho.id, quem));
    await vencedorEntrou;
    const concorrente = naOrigem(() => servico.provisionarEmpresa(origemId, trilho.id, quem));
    await concorrenteEntrou;
    liberarVencedor();
    expect(await vencedor).toMatchObject({ empresaId: alvoId });
    liberarConcorrente();
    expect(await concorrente).toMatchObject({ empresaId: alvoId });

    const marcos = await prisma.onboardingMarco.findMany({ where: { orgId: origemId, trilhoId: trilho.id, tipo: 'empresa.provisionada' } });
    expect(marcos.map((m) => m.dados)).toEqual([{ empresaId: alvoId, criada: true }]);
  });

  it('revalida se o destino comprovado ainda existe e permanece ativo antes de gravar', async () => {
    const { alvoId, slug, trilho, servico, provisionar, memoria } = await cenario();
    provisionar.mockResolvedValueOnce({ orgId: alvoId, slug, criada: true });
    await expect(naOrigem(() => servico.provisionarEmpresa(origemId, trilho.id, quem))).resolves.toMatchObject({ empresaId: alvoId });
    await prisma.org.update({ where: { id: alvoId }, data: { isActive: false } });

    await expect(naOrigem(() => servico.carregarMemoria(origemId, trilho.id, quem))).rejects.toMatchObject({ status: 409 });
    expect(memoria.porChave).not.toHaveBeenCalled();
  });
});
