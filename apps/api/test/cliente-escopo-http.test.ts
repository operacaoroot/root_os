import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanActivate, Controller, ExecutionContext, Get, Global, Injectable, Module, UseGuards } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { ContextoModule } from '../src/common/contexto.module';
import { contextoAtual } from '../src/common/contexto-execucao';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { ClienteEscopoModule } from '../src/clientes-escopo/cliente-escopo.module';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import { ClienteEscopoController } from '../src/clientes-escopo/cliente-escopo.controller';
import { ClienteEscopoInterceptor } from '../src/clientes-escopo/cliente-escopo.interceptor';
import { EscopoClienteAdaptado } from '../src/clientes-escopo/cliente-escopo.decorator';
import { JwtAuthGuard, esquecerUsuarioAtivo } from '../src/auth/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { GoogleLoginService } from '../src/auth/google-login.service';
import { ReauthService } from '../src/auth/reauth.service';
import { CampaignsController } from '../src/campaigns/campaigns.controller';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { ApprovalGuard } from '../src/approvals/approval.guard';
import { ApprovalsService } from '../src/approvals/approvals.service';

// HTTP/Nest/JWT reais; somente persistência e efeitos de negócio são dublês.
// Importar o módulo real mede APP_INTERCEPTOR, sem instalar o interceptor à mão.
const orgId = randomUUID(), userId = randomUUID(), clienteId = randomUUID();
const state: { modo: 'ALL' | 'SELECTED' | null; ativo: boolean } = { modo: 'SELECTED', ativo: true };
const contextos: Array<string | null | undefined> = [];
const prisma = {
  user: { findFirst: vi.fn(async ({ where }: any) => {
    contextos.push(contextoAtual()?.orgId);
    return where.id === userId && where.orgId === orgId && state.ativo ? { id: userId, isActive: true } : null;
  }) },
  clienteAcessoPerfil: { findFirst: vi.fn(async ({ where }: any) =>
    where.orgId === orgId && where.userId === userId && state.modo ? { modo: state.modo } : null) },
  clienteAcessoVinculo: { findMany: vi.fn(async () => [{ clienteId }]) },
  partner: { findMany: vi.fn(async () => [{ id: clienteId, razaoSocial: 'Cliente permitido', nomeFantasia: null, interno: false }]) },
};
const jwt = new JwtService({ secret: randomUUID(), signOptions: { expiresIn: '10m' } });
const campanhas = { list: vi.fn(async () => [{ id: 'campanha-secreta' }]), update: vi.fn(async () => ({ ok: true })) };
const aprovacoes = { consumeForWrite: vi.fn(async () => undefined) };

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: prisma },
    { provide: AuditService, useValue: { log: vi.fn() } },
    { provide: JwtService, useValue: jwt },
  ],
  exports: [PrismaService, AuditService, JwtService],
})
class DependenciasDeTeste {}

@Controller('prova')
@UseGuards(JwtAuthGuard)
@EscopoClienteAdaptado() // A marca na classe NÃO deve liberar métodos novos.
class ProvaController {
  @Get('futura') futura() { return { segredo: 'nao pode sair' }; }
  @Get('adaptada') @EscopoClienteAdaptado()
  adaptada() { return { orgId: contextoAtual()?.orgId }; }
}

@Controller('publico')
class PublicoController {
  @Get() publico() { return { formulario: true }; }
}

// Outra autenticação, sem chamar JwtAuthGuard: a defesa global também precisa agir.
@Injectable()
class OutraAutenticacao implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.user = await jwt.verifyAsync(req.headers.authorization.slice(7));
    return true;
  }
}
@Controller('outra-autenticacao')
@UseGuards(OutraAutenticacao)
class OutraAutenticacaoController {
  @Get() ler() { return { segredo: 'nao pode sair' }; }
}

describe('contenção por cliente em HTTP real', () => {
  let app: INestApplication, base: string, token: string;
  const pedir = (caminho: string, init: RequestInit = {}) => fetch(`${base}${caminho}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });

  beforeAll(async () => {
    // Vitest/esbuild não emite design:paramtypes; mantém os tokens usados pelo Nest em produção.
    for (const [tipo, deps] of [
      [ClienteEscopoService, [PrismaService, AuditService]],
      [ClienteEscopoController, [ClienteEscopoService]],
      [ClienteEscopoInterceptor, [Reflector, ClienteEscopoService]],
      [JwtAuthGuard, [JwtService, PrismaService, ClienteEscopoService]],
      [PermissionsGuard, [Reflector]],
      [ApprovalGuard, [Reflector, ApprovalsService]],
      [CampaignsController, [CampaignsService]],
      [AuthController, [AuthService, GoogleLoginService, ReauthService]],
    ] as const) Reflect.defineMetadata('design:paramtypes', deps, tipo);
    const modulo = await Test.createTestingModule({
      imports: [DependenciasDeTeste, ContextoModule, ClienteEscopoModule],
      controllers: [CampaignsController, AuthController, ProvaController, PublicoController, OutraAutenticacaoController],
      providers: [
        { provide: CampaignsService, useValue: campanhas },
        { provide: ApprovalsService, useValue: aprovacoes },
        { provide: AuthService, useValue: {} },
        { provide: GoogleLoginService, useValue: {} },
        { provide: ReauthService, useValue: {} },
      ],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    token = await jwt.signAsync({ typ: 'sessao', sub: userId, orgId, name: 'Pessoa sintética', roles: ['admin_master'], permissions: ['campanhas.ver', 'campanhas.editar'] });
  });
  beforeEach(() => {
    state.modo = 'SELECTED'; state.ativo = true;
    contextos.length = 0;
    vi.clearAllMocks();
    esquecerUsuarioAtivo();
  });
  afterAll(async () => { await app?.close(); esquecerUsuarioAtivo(); });

  it('recusa módulo não adaptado antes de consultar seus dados', async () => {
    expect((await pedir('/campaigns')).status).toBe(403);
    expect(campanhas.list).not.toHaveBeenCalled();
  });
  it('recusa antes do ApprovalGuard consumir uma autorização de escrita', async () => {
    const res = await pedir('/campaigns/campanha-secreta', { method: 'PATCH', headers: { 'x-approval-token': 'aprovacao-anterior' }, body: JSON.stringify({ status: 'pausada' }) });
    expect(res.status).toBe(403);
    expect(aprovacoes.consumeForWrite).not.toHaveBeenCalled();
    expect(campanhas.update).not.toHaveBeenCalled();
  });
  it('exercita o mesmo ApprovalGuard quando o perfil amplo autoriza a rota', async () => {
    state.modo = 'ALL';
    const res = await pedir('/campaigns/campanha-secreta', { method: 'PATCH', headers: { 'x-approval-token': 'aprovacao-anterior' }, body: JSON.stringify({ status: 'pausada' }) });
    expect(res.status).toBe(200);
    expect(aprovacoes.consumeForWrite).toHaveBeenCalledWith(expect.objectContaining({ orgId, actorId: userId, resourceId: 'campanha-secreta' }));
    expect(campanhas.update).toHaveBeenCalledTimes(1);
  });
  it('relê ALL → SELECTED e perfil removido sem trocar o JWT', async () => {
    state.modo = 'ALL';
    expect((await pedir('/campaigns')).status).toBe(200);
    state.modo = 'SELECTED';
    expect((await pedir('/campaigns')).status).toBe(403);
    state.modo = null;
    expect((await pedir('/campaigns')).status).toBe(403);
    expect(campanhas.list).toHaveBeenCalledTimes(1);
  });
  it('perfil ausente permite somente a identidade própria, mesmo com papel admin no JWT', async () => {
    state.modo = null;
    const me = await pedir('/auth/me');
    expect(me.status).toBe(200);
    expect((await me.json()).id).toBe(userId);
    expect((await pedir('/clientes-escopo/me')).status).toBe(403);
    expect((await pedir('/prova/adaptada')).status).toBe(403);
  });
  it('marca apenas no controller não libera método futuro; método adaptado preserva contexto', async () => {
    expect((await pedir('/prova/futura')).status).toBe(403);
    const res = await pedir('/prova/adaptada');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId });
    expect(contextos.length).toBeGreaterThan(0);
    expect(contextos.every(id => id === orgId)).toBe(true);
    const clientes = await pedir('/clientes-escopo/me');
    expect(clientes.status).toBe(200);
    expect((await clientes.json()).amplo).toBe(false);
  });
  it('APP_INTERCEPTOR real contém outras autenticações e preserva o formulário público', async () => {
    expect((await pedir('/outra-autenticacao')).status).toBe(403);
    state.modo = 'ALL';
    expect((await pedir('/outra-autenticacao')).status).toBe(200);
    const publico = await fetch(`${base}/publico`);
    expect(publico.status).toBe(200);
    expect(await publico.json()).toEqual({ formulario: true });
  });
  it('continua exigindo autenticação e recusa usuário desativado', async () => {
    expect((await fetch(`${base}/campaigns`)).status).toBe(401);
    state.ativo = false;
    expect((await pedir('/auth/me')).status).toBe(401);
  });
});
