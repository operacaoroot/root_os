import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FRASE_DO_USUARIO_DESATIVADO,
  JwtAuthGuard,
  PRAZO_DO_CACHE_DE_ATIVO_MS,
  TIPO_DA_SESSAO,
  esquecerUsuarioAtivo,
} from '../src/auth/jwt-auth.guard';
import { contextoAtual } from '../src/common/contexto-execucao';
import type { PrismaService } from '../src/prisma/prisma.service';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * PRODUÇÃO 22, M4 · O GUARDA RELÊ `isActive`.
 *
 * Usuário desativado deixa de entrar na hora (no máximo 60 s depois), sem
 * esperar a sessão de oito horas vencer. Usuário ativo segue igual. O cache de
 * 60 s por usuário evita uma consulta ao banco a cada pedido.
 */

const jwt = new JwtService({ secret: 'segredo-da-suite-de-usuario-ativo' });

function contextoCom(token: string) {
  const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: `Bearer ${token}` } };
  return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext };
}

const sessao = (sub: string, orgId: string) => jwt.sign({ typ: TIPO_DA_SESSAO, sub, orgId, roles: [], permissions: [] });

/** Um banco de mentira: conta as consultas e anota a empresa do contexto em que cada uma rodou. */
function bancoDeMentira(usuarios: Record<string, { orgId: string; isActive: boolean }>) {
  const empresas: Array<string | null | undefined> = [];
  const findFirst = vi.fn(async ({ where }: { where: { id: string; orgId: string } }) => {
    empresas.push(contextoAtual()?.orgId);
    const u = usuarios[where.id];
    return u && u.orgId === where.orgId ? { isActive: u.isActive } : null;
  });
  return { prisma: { user: { findFirst } } as unknown as PrismaService, findFirst, empresas, usuarios };
}

describe('o guarda de sessão relê se o usuário está ativo', () => {
  beforeEach(() => esquecerUsuarioAtivo());

  it('usuário ativo passa, e a consulta roda dentro da empresa do token', async () => {
    const banco = bancoDeMentira({ 'u-ativo': { orgId: 'org-a', isActive: true } });
    const guarda = new JwtAuthGuard(jwt, banco.prisma);
    const { ctx, req } = contextoCom(sessao('u-ativo', 'org-a'));
    await expect(guarda.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toMatchObject({ sub: 'u-ativo', orgId: 'org-a' });
    expect(banco.empresas).toEqual(['org-a']);
  });

  it('usuário desativado é recusado com 401 e a frase', async () => {
    const banco = bancoDeMentira({ 'u-fora': { orgId: 'org-a', isActive: false } });
    const guarda = new JwtAuthGuard(jwt, banco.prisma);
    const { ctx, req } = contextoCom(sessao('u-fora', 'org-a'));
    const erro = await guarda.canActivate(ctx).catch((e: unknown) => e);
    expect((erro as { getStatus(): number }).getStatus()).toBe(401);
    expect((erro as Error).message).toBe(FRASE_DO_USUARIO_DESATIVADO);
    expect(req.user).toBeUndefined();
  });

  it('usuário inexistente, ou de outra empresa que não a do token, é recusado igual', async () => {
    const banco = bancoDeMentira({ 'u-b': { orgId: 'org-b', isActive: true } });
    const guarda = new JwtAuthGuard(jwt, banco.prisma);
    await expect(guarda.canActivate(contextoCom(sessao('u-sumiu', 'org-a')).ctx)).rejects.toThrow(FRASE_DO_USUARIO_DESATIVADO);
    await expect(guarda.canActivate(contextoCom(sessao('u-b', 'org-a')).ctx)).rejects.toThrow(FRASE_DO_USUARIO_DESATIVADO);
  });

  it('o cache faz UMA consulta para N pedidos dentro do prazo, partilhada entre instâncias do guarda', async () => {
    const banco = bancoDeMentira({ 'u-ativo': { orgId: 'org-a', isActive: true } });
    const guarda = new JwtAuthGuard(jwt, banco.prisma);
    const outro = new JwtAuthGuard(jwt, banco.prisma);
    for (let i = 0; i < 20; i++) await guarda.canActivate(contextoCom(sessao('u-ativo', 'org-a')).ctx);
    await outro.canActivate(contextoCom(sessao('u-ativo', 'org-a')).ctx);
    expect(banco.findFirst).toHaveBeenCalledTimes(1);
  });

  it('depois de 60 s relê: quem foi desativado no meio cai na releitura seguinte', async () => {
    const banco = bancoDeMentira({ 'u-x': { orgId: 'org-a', isActive: true } });
    const guarda = new JwtAuthGuard(jwt, banco.prisma);
    let agora = 1_000_000;
    guarda.agora = () => agora;
    await expect(guarda.canActivate(contextoCom(sessao('u-x', 'org-a')).ctx)).resolves.toBe(true);

    banco.usuarios['u-x'].isActive = false;
    agora += PRAZO_DO_CACHE_DE_ATIVO_MS - 1;
    // ainda dentro do prazo: o cache responde, sem consultar
    await expect(guarda.canActivate(contextoCom(sessao('u-x', 'org-a')).ctx)).resolves.toBe(true);
    expect(banco.findFirst).toHaveBeenCalledTimes(1);

    agora += 2;
    await expect(guarda.canActivate(contextoCom(sessao('u-x', 'org-a')).ctx)).rejects.toThrow(FRASE_DO_USUARIO_DESATIVADO);
    expect(banco.findFirst).toHaveBeenCalledTimes(2);
  });

  it('esquecer um usuário obriga a releitura dele, sem esperar o prazo', async () => {
    const banco = bancoDeMentira({ 'u-y': { orgId: 'org-a', isActive: true } });
    const guarda = new JwtAuthGuard(jwt, banco.prisma);
    await guarda.canActivate(contextoCom(sessao('u-y', 'org-a')).ctx);
    banco.usuarios['u-y'].isActive = false;
    esquecerUsuarioAtivo('org-a', 'u-y');
    await expect(guarda.canActivate(contextoCom(sessao('u-y', 'org-a')).ctx)).rejects.toThrow(FRASE_DO_USUARIO_DESATIVADO);
  });

  it('token que não é sessão continua recusado ANTES de qualquer consulta ao banco', async () => {
    const banco = bancoDeMentira({});
    const guarda = new JwtAuthGuard(jwt, banco.prisma);
    const prova = jwt.sign({ typ: 'reauth', sub: 'u-1', orgId: 'org-a' });
    await expect(guarda.canActivate(contextoCom(prova).ctx)).rejects.toThrow(/Token inválido/);
    expect(banco.findFirst).not.toHaveBeenCalled();
  });

  it('fora de teste, o guarda sem banco não sobe (a releitura não some em silêncio)', () => {
    const antes = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new JwtAuthGuard(jwt)).toThrow(/precisa do banco/);
    } finally {
      process.env.NODE_ENV = antes;
    }
  });
});

const URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL)('o guarda contra o banco de verdade', { timeout: 30_000 }, () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const MARCA = randomUUID().slice(0, 8);
  let ORG = '';
  let USUARIO = '';

  beforeAll(async () => {
    exigirBancoDescartavel(URL!, 'cria e apaga empresa e usuário de teste');
    ORG = (await prisma.org.create({ data: { name: `Sessão ativa ${MARCA}`, slug: `sessao-ativa-${MARCA}` } })).id;
    USUARIO = (await prisma.user.create({ data: { orgId: ORG, name: 'Pessoa Sintética', email: `ativa.${MARCA}@qa.invalid`, passwordHash: 'x' } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  it('ativo passa; desativado no banco é recusado na releitura', async () => {
    esquecerUsuarioAtivo();
    const guarda = new JwtAuthGuard(jwt, prisma as unknown as PrismaService);
    await expect(guarda.canActivate(contextoCom(sessao(USUARIO, ORG)).ctx)).resolves.toBe(true);
    await prisma.user.update({ where: { id: USUARIO }, data: { isActive: false } });
    esquecerUsuarioAtivo(ORG, USUARIO);
    await expect(guarda.canActivate(contextoCom(sessao(USUARIO, ORG)).ctx)).rejects.toThrow(FRASE_DO_USUARIO_DESATIVADO);
    await prisma.user.update({ where: { id: USUARIO }, data: { isActive: true } });
  });

  /*
   * Com o PAPEL RESTRITO e o isolamento por linha (RLS_NO_TESTE=1, banco `_rls`
   * e `TENANT_DATABASE_URL`): a consulta do guarda roda na empresa do token e
   * acha o usuário; um token com a empresa trocada não enxerga o usuário de
   * outra empresa e é recusado.
   */
  it.skipIf(!(process.env.RLS_NO_TESTE === '1' && process.env.TENANT_DATABASE_URL))(
    'sob o papel restrito: a releitura acha o usuário na empresa do token, e não em outra',
    async () => {
      const restrito = comTenantNaSessao(new PrismaClient({ datasourceUrl: process.env.TENANT_DATABASE_URL }), { modo: 'impor' });
      try {
        esquecerUsuarioAtivo();
        const guarda = new JwtAuthGuard(jwt, restrito as unknown as PrismaService);
        await expect(guarda.canActivate(contextoCom(sessao(USUARIO, ORG)).ctx)).resolves.toBe(true);
        const OUTRA = (await prisma.org.create({ data: { name: `Outra ${MARCA}`, slug: `sessao-outra-${MARCA}` } })).id;
        try {
          await expect(guarda.canActivate(contextoCom(sessao(USUARIO, OUTRA)).ctx)).rejects.toThrow(FRASE_DO_USUARIO_DESATIVADO);
        } finally {
          await prisma.org.deleteMany({ where: { id: OUTRA } });
        }
      } finally {
        await restrito.$disconnect();
      }
    },
  );
});
