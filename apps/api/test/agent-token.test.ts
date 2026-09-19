import { createHash } from 'node:crypto';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_TOKEN_SCOPES,
  AgentTokenService,
} from '../src/auth/agent-token.service';
import {
  AgentTokenGuard,
  RequireAgentScopes,
} from '../src/auth/agent-token.guard';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const TOKEN_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function requestContext(req: Record<string, unknown>, handler: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

describe('AgentTokenGuard', () => {
  it('exige metadata de escopo e aceita apenas o escopo declarado', async () => {
    const resolverBearer = vi.fn().mockResolvedValue({ agentTokenScopes: ['memoria.buscar'] });
    const guard = new AgentTokenGuard({ resolverBearer } as any, new Reflector());
    const handler = () => undefined;
    RequireAgentScopes('memoria.buscar')(handler);
    const req: Record<string, any> = { headers: { authorization: `Bearer ros1.${ORG}.${TOKEN_ID}.${SECRET}` } };

    await expect(guard.canActivate(requestContext(req, handler))).resolves.toBe(true);
    expect(req.user).toMatchObject({ agentTokenScopes: ['memoria.buscar'] });

    const wrongHandler = () => undefined;
    RequireAgentScopes('memoria.ler')(wrongHandler);
    await expect(
      guard.canActivate(requestContext({ headers: { authorization: 'Bearer qualquer' } }, wrongHandler)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('falha fechado quando a rota não declara escopo', async () => {
    const guard = new AgentTokenGuard(
      { resolverBearer: vi.fn().mockResolvedValue({ agentTokenScopes: ['memoria.buscar'] }) } as any,
      new Reflector(),
    );
    await expect(
      guard.canActivate(requestContext({ headers: { authorization: 'Bearer qualquer' } }, () => undefined)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AgentTokenService', () => {
  let prisma: any;
  let service: AgentTokenService;
  let tx: any;

  beforeEach(() => {
    tx = {
      $executeRaw: vi.fn(),
      agentToken: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    prisma = {
      agentToken: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      user: { findFirst: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(tx)),
    };
    service = new AgentTokenService(prisma);
  });

  it('resolve por seletor exige hash/id/org e reduz permissões ao escopo', async () => {
    const hash = createHash('sha256').update(SECRET).digest('hex');
    prisma.agentToken.findFirst.mockResolvedValue({
      id: TOKEN_ID,
      orgId: ORG,
      scopes: ['memoria.buscar'],
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: {
        id: USER,
        orgId: ORG,
        name: 'Pessoa',
        email: 'pessoa@teste.local',
        isActive: true,
        org: { isActive: true },
        roles: [{ key: 'admin_master', permissions: [{ key: 'obsidian.ver' }, { key: 'admin.usuarios' }] }],
      },
    });
    const identity = await service.resolverBearer(`ros1.${ORG}.${TOKEN_ID}.${SECRET}`);

    expect(prisma.agentToken.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TOKEN_ID, orgId: ORG, tokenHash: hash },
    }));
    expect(identity).toMatchObject({
      sub: USER,
      orgId: ORG,
      roles: [],
      permissions: ['obsidian.ver'],
      agentTokenScopes: ['memoria.buscar'],
    });
    expect(identity).not.toHaveProperty('tokenHash');
  });

  it('emissão grava somente hash e serializa limite+auditoria na transação', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: USER,
      orgId: ORG,
      name: 'Pessoa',
      email: 'pessoa@teste.local',
      isActive: true,
      org: { isActive: true },
      roles: [{ key: 'leitor', permissions: [{ key: 'obsidian.ver' }] }],
    });
    const result = await service.emitir(ORG, USER, {
      name: 'Claude local',
      scopes: AGENT_TOKEN_SCOPES.slice(0, 1),
      validadeDias: 7,
    });
    expect(result.token).toMatch(/^ros1\.[^.]+\.[^.]+\.[A-Za-z0-9_-]{43}$/);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    const created = tx.agentToken.create.mock.calls[0][0].data;
    expect(created.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const secret = result.token.split('.').at(-1)!;
    expect(created.tokenHash).toBe(createHash('sha256').update(secret).digest('hex'));
    expect(JSON.stringify(tx.agentToken.create.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(secret);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ tokenHash: expect.anything() }),
    }));
  });

  it.each([
    ['revogado', { revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }],
    ['expirado', { revokedAt: null, expiresAt: new Date(Date.now() - 60_000) }],
  ])('recusa bearer %s sem consultar fora do tenant', async (_label, estado) => {
    prisma.agentToken.findFirst.mockResolvedValue({
      id: TOKEN_ID,
      orgId: ORG,
      scopes: ['memoria.buscar'],
      ...estado,
      user: {
        id: USER,
        orgId: ORG,
        name: 'Pessoa',
        email: 'pessoa@teste.local',
        isActive: true,
        org: { isActive: true },
        roles: [{ key: 'leitor', permissions: [{ key: 'obsidian.ver' }] }],
      },
    });
    await expect(service.resolverBearer(`ros1.${ORG}.${TOKEN_ID}.${SECRET}`)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa segredo, id ou tenant trocados quando a consulta não encontra a linha', async () => {
    prisma.agentToken.findFirst.mockResolvedValue(null);
    await expect(service.resolverBearer(`ros1.${ORG}.${TOKEN_ID}.${'B'.repeat(43)}`)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.resolverBearer(`ros1.${ORG}.${'44444444-4444-4444-8444-444444444444'}.${SECRET}`)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.resolverBearer(`ros1.55555555-5555-4555-8555-555555555555.${TOKEN_ID}.${SECRET}`)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.agentToken.findFirst).toHaveBeenCalledTimes(3);
  });

  it('reavalia papéis no request seguinte e recusa quando a permissão foi removida', async () => {
    prisma.agentToken.findFirst.mockResolvedValue({
      id: TOKEN_ID,
      orgId: ORG,
      scopes: ['memoria.buscar'],
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: {
        id: USER,
        orgId: ORG,
        name: 'Pessoa',
        email: 'pessoa@teste.local',
        isActive: true,
        org: { isActive: true },
        roles: [{ key: 'leitor', permissions: [] }],
      },
    });
    await expect(service.resolverBearer(`ros1.${ORG}.${TOKEN_ID}.${SECRET}`)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['usuário desativado', { isActive: false, org: { isActive: true } }],
    ['empresa desativada', { isActive: true, org: { isActive: false } }],
  ])('falha fechado quando %s', async (_label, estado) => {
    prisma.agentToken.findFirst.mockResolvedValue({
      id: TOKEN_ID,
      orgId: ORG,
      scopes: ['memoria.buscar'],
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: {
        id: USER,
        orgId: ORG,
        name: 'Pessoa',
        email: 'pessoa@teste.local',
        ...estado,
        roles: [{ key: 'leitor', permissions: [{ key: 'obsidian.ver' }] }],
      },
    });
    await expect(service.resolverBearer(`ros1.${ORG}.${TOKEN_ID}.${SECRET}`)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lista somente tokens do próprio usuário e revoga somente o próprio id', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: USER, orgId: ORG, name: 'Pessoa', email: 'pessoa@teste.local', isActive: true,
      org: { isActive: true }, roles: [{ key: 'leitor', permissions: [] }],
    });
    prisma.agentToken.findMany.mockResolvedValue([]);
    await service.listar(ORG, USER);
    expect(prisma.agentToken.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: ORG, userId: USER } }));

    tx.agentToken.findFirst.mockResolvedValue({ id: TOKEN_ID, name: 'próprio', scopes: ['memoria.buscar'], revokedAt: null });
    await service.revogar(ORG, USER, TOKEN_ID);
    expect(tx.agentToken.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TOKEN_ID, orgId: ORG, userId: USER } }));
    expect(tx.agentToken.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TOKEN_ID } }));
  });

  it('recusa limite de cinco tokens antes de criar ou auditar', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: USER, orgId: ORG, name: 'Pessoa', email: 'pessoa@teste.local', isActive: true,
      org: { isActive: true }, roles: [{ key: 'leitor', permissions: [{ key: 'obsidian.ver' }] }],
    });
    tx.agentToken.count.mockResolvedValue(5);
    await expect(service.emitir(ORG, USER, { name: 'sexto', scopes: ['memoria.buscar'], validadeDias: 1 })).rejects.toBeInstanceOf(Error);
    expect(tx.agentToken.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('não devolve credencial quando a auditoria falha dentro da mesma transação', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: USER, orgId: ORG, name: 'Pessoa', email: 'pessoa@teste.local', isActive: true,
      org: { isActive: true }, roles: [{ key: 'leitor', permissions: [{ key: 'obsidian.ver' }] }],
    });
    tx.auditLog.create.mockRejectedValue(new Error('falha de auditoria'));
    await expect(service.emitir(ORG, USER, { name: 'sem-rastro', scopes: ['memoria.buscar'], validadeDias: 1 }))
      .rejects.toThrow('falha de auditoria');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('recusa formato inválido antes de consultar o banco', async () => {
    await expect(service.resolverBearer('ros1.invalido')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.agentToken.findFirst).not.toHaveBeenCalled();
  });
});
