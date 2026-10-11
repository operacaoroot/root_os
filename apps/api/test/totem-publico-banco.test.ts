import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TotemEventosQuiosqueSchema } from '@mktos/shared';

import type { PrismaService } from '../src/prisma/prisma.service';
import { gerarToken, hashToken } from '../src/totem/comum/segredos';
import { LoteVigenteService } from '../src/totem/lote/lote-vigente.service';
import { TotemPublicoService } from '../src/totem/publico/totem-publico.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O QUIOSQUE CONTRA O BANCO (frente B): ativação de uso único, 401 de token
 * revogado, catálogo sem preço e eventos que não duplicam no reenvio.
 *
 * Empresa com id aleatório a cada rodada, como em `assinatura.test.ts`: a
 * suíte padrão roda em paralelo no mesmo banco e nada aqui conta linha sem
 * `where` da própria empresa.
 */

const URL_DO_BANCO = process.env.TEST_DATABASE_URL;
if (URL_DO_BANCO) exigirBancoDescartavel(URL_DO_BANCO, 'totem-publico-banco.test.ts');

const ORG = `totem-publico-${randomUUID()}`;
const SEM_MODULO = `totem-publico-sem-${randomUUID()}`;
const UMA_HORA = 3_600_000;

describe.skipIf(!URL_DO_BANCO)('totem público no banco', () => {
  let prisma: PrismaClient;
  let svc: TotemPublicoService;
  let lojaId: string;
  let produtoId: string;

  async function aparelhoComCodigo(org: string, loja: string, codigo: string, expiraEm: Date) {
    return prisma.totemDispositivo.create({
      data: {
        orgId: org,
        lojaId: loja,
        nome: `Totem ${codigo}`,
        codigoAtivacaoHash: hashToken(codigo),
        ativacaoExpiraEm: expiraEm,
      },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL_DO_BANCO } } });
    await prisma.$connect();
    const cliente = prisma as unknown as PrismaService;
    svc = new TotemPublicoService(cliente, new LoteVigenteService(cliente));

    for (const [id, modulos] of [
      [ORG, ['totem']],
      [SEM_MODULO, ['leads']],
    ] as const) {
      await prisma.org.upsert({
        where: { id },
        create: { id, name: `Empresa ${id}`, slug: id, modulos: [...modulos] },
        update: {},
      });
    }
    await prisma.totemConfig.create({
      data: {
        orgId: ORG,
        nomeExibicao: 'Senhor aGranel',
        corPrimaria: '#28371D',
        corFundo: '#F5F3EC',
        controladorNome: 'Empresa de teste',
        politicaVersao: '1',
        precoLigado: false,
        cadastroLigado: false,
      },
    });
    const loja = await prisma.totemLoja.create({ data: { orgId: ORG, codigo: 'L1', nome: 'Loja Centro' } });
    lojaId = loja.id;
    const produto = await prisma.totemProduto.create({
      data: {
        orgId: ORG,
        codigo: 'EX001',
        nome: 'Castanha-do-pará',
        nomeBusca: 'castanha do para',
        precoCentavos: 8990,
        unidadePreco: 'kg',
        selos: ['vegano'],
      },
    });
    produtoId = produto.id;
    await prisma.totemProduto.create({
      data: { orgId: ORG, codigo: 'EX002', nome: 'Fora de linha', nomeBusca: 'fora de linha', ativo: false },
    });
    const lojaSemModulo = await prisma.totemLoja.create({ data: { orgId: SEM_MODULO, codigo: 'L1', nome: 'Outra' } });
    await aparelhoComCodigo(SEM_MODULO, lojaSemModulo.id, 'SEMMOD23', new Date(Date.now() + UMA_HORA));
  });

  afterAll(async () => {
    if (!prisma) return;
    for (const org of [ORG, SEM_MODULO]) {
      await prisma.totemEvento.deleteMany({ where: { orgId: org } });
      await prisma.totemDispositivo.deleteMany({ where: { orgId: org } });
      await prisma.totemProduto.deleteMany({ where: { orgId: org } });
      await prisma.totemLoja.deleteMany({ where: { orgId: org } });
      await prisma.totemConfig.deleteMany({ where: { orgId: org } });
      await prisma.org.deleteMany({ where: { id: org } });
    }
    await prisma.$disconnect();
  });

  it('ativa com o código, guarda só o hash do token e apaga o código', async () => {
    const d = await aparelhoComCodigo(ORG, lojaId, 'ATIVA234', new Date(Date.now() + UMA_HORA));
    const r = await svc.ativar('ATIVA234', 'Mozilla/5.0 (Linux; Android 13) Chrome');
    expect(r.dispositivo).toEqual({ id: d.id, nome: d.nome });
    expect(r.loja).toEqual({ id: lojaId, nome: 'Loja Centro' });
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const gravado = await prisma.totemDispositivo.findUniqueOrThrow({ where: { id: d.id } });
    expect(gravado.tokenHash).toBe(hashToken(r.token));
    expect(gravado.codigoAtivacaoHash).toBeNull();
    expect(gravado.ativacaoExpiraEm).toBeNull();
    expect(gravado.ativadoEm).not.toBeNull();
    expect(gravado.userAgent).toContain('Android');

    await expect(svc.ativar('ATIVA234', undefined)).rejects.toBeInstanceOf(NotFoundException);
    expect(await svc.aparelhoDoToken(r.token)).toEqual({ dispositivoId: d.id, orgId: ORG, lojaId });
  });

  it('código vencido, inexistente ou de empresa sem o módulo dão a mesma 404', async () => {
    await aparelhoComCodigo(ORG, lojaId, 'VENCID23', new Date(Date.now() - 1000));
    const erros = await Promise.all(
      ['VENCID23', 'NUNCA234', 'SEMMOD23'].map((c) => svc.ativar(c, undefined).catch((e: unknown) => e)),
    );
    for (const e of erros) {
      expect(e).toBeInstanceOf(NotFoundException);
      expect((e as NotFoundException).message).toBe('Não encontramos o que você procurou.');
    }
  });

  it('token inventado ou de aparelho revogado dá 401', async () => {
    await expect(svc.aparelhoDoToken(gerarToken())).rejects.toBeInstanceOf(UnauthorizedException);

    await aparelhoComCodigo(ORG, lojaId, 'REVOGA23', new Date(Date.now() + UMA_HORA));
    const { token, dispositivo } = await svc.ativar('REVOGA23', undefined);
    await prisma.totemDispositivo.update({ where: { id: dispositivo.id }, data: { revogadoEm: new Date() } });
    await expect(svc.aparelhoDoToken(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('o catálogo sai sem preço, só com produto ativo, e marca o aparelho como visto', async () => {
    await aparelhoComCodigo(ORG, lojaId, 'CATAL234', new Date(Date.now() + UMA_HORA));
    const { token } = await svc.ativar('CATAL234', undefined);
    const a = await svc.aparelhoDoToken(token);
    const c = await svc.catalogo(a);

    expect(c.produtos.map((p) => p.codigo)).toEqual(['EX001']);
    expect(JSON.stringify(c)).not.toContain('precoCentavos');
    expect(c.config).toMatchObject({ nomeExibicao: 'Senhor aGranel', precoLigado: false, cadastroLigado: false });
    expect(c.campanha).toBeNull();

    const gravado = await prisma.totemDispositivo.findUniqueOrThrow({ where: { id: a.dispositivoId } });
    expect(gravado.catalogoVersao).toBe(c.versao);
    expect(gravado.vistoEm).not.toBeNull();

    expect((await svc.catalogo(a)).versao).toBe(c.versao);
  });

  it('eventos reenviados não duplicam e o batimento grava a versão do app', async () => {
    await aparelhoComCodigo(ORG, lojaId, 'EVENT234', new Date(Date.now() + UMA_HORA));
    const { token } = await svc.ativar('EVENT234', undefined);
    const a = await svc.aparelhoDoToken(token);
    const { eventos } = TotemEventosQuiosqueSchema.parse({
      eventos: [
        { id: randomUUID(), tipo: 'ver_produto', produtoId, ocorridoEm: new Date().toISOString() },
        { id: randomUUID(), tipo: 'busca', termo: '(27) 99876-5432', ocorridoEm: new Date().toISOString() },
        { id: randomUUID(), tipo: 'busca_sem_resultado', termo: 'quinoa', ocorridoEm: new Date().toISOString() },
      ],
    });

    await svc.eventos(a, eventos);
    await svc.eventos(a, eventos);
    const gravados = await prisma.totemEvento.findMany({
      where: { orgId: ORG, dispositivoId: a.dispositivoId },
      orderBy: { tipo: 'asc' },
    });
    expect(gravados).toHaveLength(3);
    expect(gravados.map((e) => [e.tipo, e.termo])).toEqual([
      ['busca', null],
      ['busca_sem_resultado', 'quinoa'],
      ['ver_produto', null],
    ]);
    expect(gravados.every((e) => e.lojaId === lojaId)).toBe(true);

    await svc.batimento(a, '1.0.0', 'abc123');
    const d = await prisma.totemDispositivo.findUniqueOrThrow({ where: { id: a.dispositivoId } });
    expect(d.versaoApp).toBe('1.0.0');
    expect(d.catalogoVersao).toBe('abc123');
  });
});
