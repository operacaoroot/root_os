import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import {
  autenticarCorpo,
  caminhoSemPrefixo,
  ehTokenDeCorpo,
  gerarTokenDeCorpo,
  hashDoTokenDeCorpo,
  leituraDeclarada,
  lerTokenDeCorpo,
  rotaCasa,
  rotaDoAgenteDoCorpo,
} from '../src/auth/corpo-externo';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { CorpoOuSessaoGuard } from '../src/agentes-externos/corpo-ou-sessao.guard';
import { CorpoExternoService } from '../src/agentes-externos/corpo-externo.service';
import { chamadorDe } from '../src/agentes-externos/corpo-externo.controller';
import { POLITICA } from './porta-dublada';

/*
 * A4 (30/10/2026): o token do corpo de um agente externo. Vinculado a empresa +
 * agente + pessoa padrão, só o hash no banco, revogável, e com escopo: as rotas
 * do próprio agente e as leituras GET que ele declarou. Nada mais.
 */

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PEDRO = '11111111-1111-4111-8111-111111111111';
const CAPACIDADES_DA_ROOTINHA = ['numeros.painel.ler', 'crm.lead.ler', 'briefing.ler', 'operacao.tarefa.criar'];

function bancoDoCorpo(opcoes: { revogado?: boolean; estado?: string; papel?: string } = {}) {
  const gerado = gerarTokenDeCorpo(ORG);
  const linha = {
    id: 'corpo-1', orgId: ORG, corpo: 'hermes', agentSlug: 'rootinha', solicitanteId: PEDRO,
    tokenHash: gerado.hash, ultimoUsoEm: null as Date | null, revogadoEm: opcoes.revogado ? new Date() : null,
  };
  const prisma = {
    corpoExterno: {
      findFirst: vi.fn(async ({ where }: { where: { orgId: string; tokenHash: string; revogadoEm: null } }) =>
        where.orgId === linha.orgId && where.tokenHash === linha.tokenHash && !linha.revogadoEm ? linha : null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    agent: {
      findFirst: async () => ({ estado: opcoes.estado ?? 'ativo', ativo: true, capacidades: CAPACIDADES_DA_ROOTINHA }),
    },
    user: {
      findFirst: async () => ({
        id: PEDRO, email: 'pedro@root', name: 'Pedro',
        roles: [{ key: opcoes.papel ?? 'admin_master', permissions: [{ key: 'dashboard.ver' }, { key: 'mcp.ver' }, { key: 'leads.ver' }] }],
      }),
    },
  };
  return { token: gerado.token, prisma, linha };
}

const politica = { resolverCapacidade: (_org: string, id: string) => POLITICA.capacidades.find((c) => c.id === id) ?? null };

function contexto(req: Record<string, unknown>, permissoes: string[] = []) {
  const handler = () => undefined;
  Reflect.defineMetadata(PERMISSIONS_KEY, permissoes, handler);
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => class {},
  } as never;
}

describe('A4: o token', () => {
  it('rcx.<empresa>.<segredo>; só o hash é guardado; formato errado não é token de corpo', () => {
    const t = gerarTokenDeCorpo(ORG);
    expect(t.token).toMatch(/^rcx\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(t.hash).toBe(hashDoTokenDeCorpo(t.token));
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.prefixo).not.toContain(t.token.split('.')[2]);
    expect(lerTokenDeCorpo(t.token)).toEqual({ orgId: ORG, hash: t.hash });
    expect(lerTokenDeCorpo('rcx.nao-e-uuid.' + 'a'.repeat(43))).toBeNull();
    expect(lerTokenDeCorpo('eyJhbGciOi.jwt.qualquer')).toBeNull();
    expect(ehTokenDeCorpo('eyJhbGciOi')).toBe(false);
    expect(() => gerarTokenDeCorpo('root')).toThrow();
  });

  it('autentica dentro da empresa do token; revogado não autentica', async () => {
    const vivo = bancoDoCorpo();
    expect(await autenticarCorpo(vivo.prisma as never, vivo.token)).toMatchObject({ id: 'corpo-1', agentSlug: 'rootinha', solicitanteId: PEDRO });
    expect(vivo.prisma.corpoExterno.updateMany).toHaveBeenCalled();
    const morto = bancoDoCorpo({ revogado: true });
    expect(await autenticarCorpo(morto.prisma as never, morto.token)).toBeNull();
    expect(await autenticarCorpo(vivo.prisma as never, vivo.token.slice(0, -1) + 'x')).toBeNull();
  });
});

describe('A4: o escopo', () => {
  it('casa rota do catálogo com o caminho, com parâmetro e sem a consulta', () => {
    expect(rotaCasa('GET /leads/:id', 'GET', '/leads/abc')).toBe(true);
    expect(rotaCasa('GET /leads/:id', 'GET', '/leads/abc/x')).toBe(false);
    expect(rotaCasa('GET /tasks?overdue=1', 'GET', '/tasks')).toBe(true);
    expect(rotaCasa('GET /leads', 'POST', '/leads')).toBe(false);
    expect(caminhoSemPrefixo('/api/dashboard/summary')).toBe('/dashboard/summary');
  });

  it('a leitura só vale se for R0, com rota GET, e DECLARADA pelo agente', () => {
    const cat = (id: string) => (POLITICA.capacidades.find((c) => c.id === id) as { nivel?: string; rota?: string }) ?? null;
    expect(leituraDeclarada(CAPACIDADES_DA_ROOTINHA, cat, 'GET', '/dashboard/summary')).toBe('numeros.painel.ler');
    expect(leituraDeclarada(CAPACIDADES_DA_ROOTINHA, cat, 'GET', '/leads/123')).toBe('crm.lead.ler');
    expect(leituraDeclarada(CAPACIDADES_DA_ROOTINHA, cat, 'GET', '/agents/briefing-diario/ultima-passagem')).toBe('briefing.ler');
    expect(leituraDeclarada(CAPACIDADES_DA_ROOTINHA, cat, 'GET', '/finance/summary')).toBeNull();
    expect(leituraDeclarada(CAPACIDADES_DA_ROOTINHA, cat, 'POST', '/dashboard/summary')).toBeNull();
    expect(leituraDeclarada(['financeiro.resumo.ler'], cat, 'GET', '/dashboard/summary')).toBeNull();
  });

  it('as rotas do próprio agente: executar, catálogo e definição — de outro agente, não', () => {
    expect(rotaDoAgenteDoCorpo('rootinha', 'POST', '/agents/rootinha/capacidades/operacao.tarefa.criar/executar')).toBe(true);
    expect(rotaDoAgenteDoCorpo('rootinha', 'GET', '/agents/rootinha/catalogo-externo')).toBe(true);
    expect(rotaDoAgenteDoCorpo('rootinha', 'GET', '/agents/rootinha/definicao')).toBe(true);
    expect(rotaDoAgenteDoCorpo('rootinha', 'POST', '/agents/briefing-diario/capacidades/briefing.ler/executar')).toBe(false);
    expect(rotaDoAgenteDoCorpo('rootinha', 'POST', '/agents/rootinha/invocar')).toBe(false);
    expect(rotaDoAgenteDoCorpo('rootinha', 'POST', '/agents/rootinha/corpos')).toBe(false);
  });
});

describe('A4: o JwtAuthGuard com token de corpo', () => {
  const jwt = new JwtService({ secret: 'teste' });

  it('GET declarado: passa como a pessoa padrão, com as permissões dela e a marca do corpo', async () => {
    const b = bancoDoCorpo();
    const guarda = new JwtAuthGuard(jwt, b.prisma as never, politica as never);
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${b.token}` }, method: 'GET', path: '/api/leads/abc' };
    expect(await guarda.canActivate(contexto(req))).toBe(true);
    expect(req.user).toMatchObject({ sub: PEDRO, orgId: ORG, permissions: expect.arrayContaining(['leads.ver']), corpoExterno: { capacidade: 'crm.lead.ler' } });
  });

  it('GET não declarado, POST e agente pausado: 401', async () => {
    const b = bancoDoCorpo();
    const guarda = new JwtAuthGuard(jwt, b.prisma as never, politica as never);
    await expect(guarda.canActivate(contexto({ headers: { authorization: `Bearer ${b.token}` }, method: 'GET', path: '/api/finance/summary' }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guarda.canActivate(contexto({ headers: { authorization: `Bearer ${b.token}` }, method: 'POST', path: '/api/leads/abc' }))).rejects.toBeInstanceOf(UnauthorizedException);
    const p = bancoDoCorpo({ estado: 'pausado' });
    await expect(new JwtAuthGuard(jwt, p.prisma as never, politica as never).canActivate(contexto({ headers: { authorization: `Bearer ${p.token}` }, method: 'GET', path: '/api/leads/abc' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('pessoa padrão que virou conta de máquina derruba o corpo; token revogado também', async () => {
    const m = bancoDoCorpo({ papel: 'ia_servico' });
    await expect(new JwtAuthGuard(jwt, m.prisma as never, politica as never).canActivate(contexto({ headers: { authorization: `Bearer ${m.token}` }, method: 'GET', path: '/api/leads/abc' }))).rejects.toBeInstanceOf(UnauthorizedException);
    const r = bancoDoCorpo({ revogado: true });
    await expect(new JwtAuthGuard(jwt, r.prisma as never, politica as never).canActivate(contexto({ headers: { authorization: `Bearer ${r.token}` }, method: 'GET', path: '/api/leads/abc' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('A4: o guarda das rotas do agente', () => {
  const jwt = new JwtService({ secret: 'teste' });

  it('corpo na rota do próprio agente: passa, sem permissão de papel, com o corpo na requisição', async () => {
    const b = bancoDoCorpo();
    const guarda = new CorpoOuSessaoGuard(jwt, new Reflector(), b.prisma as never, politica as never);
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${b.token}` }, method: 'POST', path: '/api/agents/rootinha/capacidades/briefing.ler/executar' };
    expect(await guarda.canActivate(contexto(req, ['mcp.executar', 'admin.usuarios']))).toBe(true);
    expect(req.corpoExterno).toMatchObject({ agentSlug: 'rootinha' });
    expect(chamadorDe(req as never)).toEqual({ orgId: ORG, solicitantePadraoId: PEDRO, corpo: { id: 'corpo-1', nome: 'hermes', agentSlug: 'rootinha' } });
  });

  it('corpo na rota de outro agente, ou em rota que não é das três: 401', async () => {
    const b = bancoDoCorpo();
    const guarda = new CorpoOuSessaoGuard(jwt, new Reflector(), b.prisma as never, politica as never);
    await expect(guarda.canActivate(contexto({ headers: { authorization: `Bearer ${b.token}` }, method: 'POST', path: '/api/agents/briefing-diario/capacidades/briefing.ler/executar' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sem token de corpo é o console: JWT de sessão e a permissão da rota', async () => {
    const b = bancoDoCorpo();
    const guarda = new CorpoOuSessaoGuard(jwt, new Reflector(), b.prisma as never, politica as never);
    await expect(guarda.canActivate(contexto({ headers: {}, method: 'POST', path: '/api/agents/rootinha/capacidades/x/executar' }, ['admin.usuarios']))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('A4: criar e revogar', () => {
  function servico() {
    const criados: Array<Record<string, unknown>> = [];
    const prisma = {
      agent: { findFirst: async ({ where }: { where: { slug: string } }) => (where.slug === 'rootinha' ? { id: 'ag-1' } : null) },
      user: { findFirst: async ({ where }: { where: { id: string } }) => (where.id === PEDRO ? { id: PEDRO, roles: [{ key: 'admin_master' }] } : where.id === 'ia' ? { id: 'ia', roles: [{ key: 'ia_servico' }] } : null) },
      corpoExterno: {
        findFirst: async () => null,
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { criados.push(data); return { id: 'corpo-1', ...data }; }),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findMany: async () => [],
      },
    };
    const audit = { log: vi.fn(async () => undefined) };
    const eventos = { registrar: vi.fn(async () => ({ id: 'ev' })) };
    return { svc: new CorpoExternoService(prisma as never, audit as never, eventos as never), prisma, criados, audit, eventos };
  }

  it('cria com o hash no banco e o token só na resposta', async () => {
    const s = servico();
    const r = await s.svc.criar(ORG, PEDRO, 'rootinha', { corpo: 'hermes', solicitanteId: PEDRO });
    expect(r.token).toMatch(/^rcx\./);
    expect(s.criados[0].tokenHash).toBe(hashDoTokenDeCorpo(r.token));
    expect(JSON.stringify(s.criados[0])).not.toContain(r.token.split('.')[2]);
    expect(s.eventos.registrar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'agente.corpo.criado' }));
    expect(JSON.stringify(s.eventos.registrar.mock.calls)).not.toContain(r.token);
  });

  it('recusa agente que não existe, pessoa de máquina e nome torto', async () => {
    const s = servico();
    await expect(s.svc.criar(ORG, PEDRO, 'nao-existe', { corpo: 'hermes', solicitanteId: PEDRO })).rejects.toThrow(/Agente não encontrado/);
    await expect(s.svc.criar(ORG, PEDRO, 'rootinha', { corpo: 'hermes', solicitanteId: '22222222-2222-4222-8222-222222222222' })).rejects.toThrow(/pessoa ativa/);
    await expect(s.svc.criar(ORG, PEDRO, 'rootinha', { corpo: 'Hermes Agent', solicitanteId: PEDRO })).rejects.toThrow();
  });

  it('revoga com motivo, e a linha fica', async () => {
    const s = servico();
    await s.svc.revogar(ORG, PEDRO, 'rootinha', 'corpo-1', { motivo: 'trocar a chave' });
    expect(s.prisma.corpoExterno.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'corpo-1', orgId: ORG, revogadoEm: null }),
      data: expect.objectContaining({ revogadoPorId: PEDRO, motivoRevogacao: 'trocar a chave' }),
    }));
    await expect(s.svc.revogar(ORG, PEDRO, 'rootinha', 'corpo-1', {})).rejects.toThrow();
  });
});
