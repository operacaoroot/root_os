import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ActorType } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { FerramentasService } from '../src/ferramentas/ferramentas.service';
import { FERRAMENTAS_GERADAS } from '../src/ferramentas-geradas/index';
import type { FerramentaGerada } from '../src/ferramentas/bridge';
import { ModulosController } from '../src/tenants/modulos.controller';

const ORG = 'org-ferramentas-teste';
const USER = 'user-ferramentas-teste';
const ferramenta: FerramentaGerada = {
  slug: 'fixture-tool',
  activationKey: 'ferramentas:fixture-tool',
  tableName: 'tool_fixture_tool_registro',
  listCapability: 'ferramentas.fixture-tool.registro.listar',
  createCapability: 'ferramentas.fixture-tool.registro.criar',
  listarRegistros: vi.fn(async () => [{ id: 'r1', orgId: ORG, titulo: 't', texto: 'x' }]),
  criarRegistro: vi.fn(async () => ({ id: 'r2', orgId: ORG, titulo: 't', texto: 'x' })),
};

const usuarioAtivo = (roles = [{ key: 'analista', permissions: [{ key: 'mcp.ver' }, { key: 'mcp.executar' }] }]) => ({
  isActive: true,
  org: { isActive: true },
  roles,
});

function bancada() {
  const estado = { ativa: true, usuario: usuarioAtivo() };
  const prisma = {
    user: { findFirst: vi.fn(async () => estado.usuario) },
    agent: { findFirst: vi.fn(async (): Promise<null | {
      ativo: boolean;
      estado: string;
      capacidades: string[];
      org: { isActive: boolean };
    }> => null) },
  };
  const modulos = { ferramentaAtivaDaOrg: vi.fn(async () => estado.ativa) };
  const efeitos = new EfeitosRegistry();
  const porta = { executar: vi.fn(async () => [{ id: 'r-porta' }]) };
  const service = new FerramentasService(prisma as never, modulos as never, efeitos, porta as never);
  service.onModuleInit();
  return { estado, prisma, modulos, efeitos, porta, service };
}

const geradas = FERRAMENTAS_GERADAS as unknown as FerramentaGerada[];
afterEach(() => {
  const i = geradas.indexOf(ferramenta);
  if (i >= 0) geradas.splice(i, 1);
});

describe('ferramentas próprias: ativação, porta e revalidação', () => {
  it('slug desconhecido e ferramenta desligada falham antes da Porta', async () => {
    geradas.push(ferramenta);
    const b = bancada();
    await expect(b.service.listarParaOperador('nao-existe', { orgId: ORG, actorId: USER, actorType: ActorType.user }))
      .rejects.toBeInstanceOf(NotFoundException);
    b.estado.ativa = false;
    await expect(b.service.listarParaOperador(ferramenta.slug, { orgId: ORG, actorId: USER, actorType: ActorType.user }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(b.porta.executar).not.toHaveBeenCalled();
  });

  it('relê usuário ativo, papel e permissão atuais — e recusa máquina', async () => {
    geradas.push(ferramenta);
    const b = bancada();
    await expect(b.service.listarParaOperador(ferramenta.slug, { orgId: ORG, actorId: USER, actorType: ActorType.user }))
      .resolves.toEqual([{ id: 'r-porta' }]);
    b.estado.usuario = usuarioAtivo([{ key: 'analista', permissions: [] }]);
    await expect(b.service.listarParaOperador(ferramenta.slug, { orgId: ORG, actorId: USER, actorType: ActorType.user }))
      .rejects.toBeInstanceOf(ForbiddenException);
    b.estado.usuario = usuarioAtivo([{ key: 'ia_acao', permissions: [{ key: 'mcp.ver' }] }]);
    await expect(b.service.listarParaOperador(ferramenta.slug, { orgId: ORG, actorId: USER, actorType: ActorType.user }))
      .rejects.toBeInstanceOf(ForbiddenException);
    b.estado.usuario = { ...usuarioAtivo(), isActive: false };
    await expect(b.service.listarParaOperador(ferramenta.slug, { orgId: ORG, actorId: USER, actorType: ActorType.user }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('efeito interno repete ativação e autoridade, sem aceitar AI fictício', async () => {
    geradas.push(ferramenta);
    const b = bancada();
    await expect(b.efeitos.executar(ferramenta.listCapability, {}, {
      orgId: ORG, actorId: USER, actorType: ActorType.user,
    })).resolves.toEqual([{ id: 'r1', orgId: ORG, titulo: 't', texto: 'x' }]);
    b.estado.ativa = false;
    await expect(b.efeitos.executar(ferramenta.listCapability, {}, {
      orgId: ORG, actorId: USER, actorType: ActorType.user,
    })).rejects.toBeInstanceOf(NotFoundException);
    b.estado.ativa = true;
    await expect(b.efeitos.executar(ferramenta.listCapability, {}, {
      orgId: ORG, actorId: 'inventado', actorType: ActorType.ai,
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('aceita somente AI ativo com a capability declarada e revalida após desativação', async () => {
    geradas.push(ferramenta);
    const b = bancada();
    b.prisma.agent.findFirst.mockResolvedValue({
      ativo: true,
      estado: 'ativo',
      capacidades: [ferramenta.createCapability],
      org: { isActive: true },
    });
    await expect(b.efeitos.executar(ferramenta.createCapability, { titulo: 't', texto: 'x' }, {
      orgId: ORG, actorId: 'agente-real', actorType: ActorType.ai, agentSlug: 'agente-real',
    })).resolves.toMatchObject({ id: 'r2', orgId: ORG });
    b.estado.ativa = false;
    await expect(b.efeitos.executar(ferramenta.createCapability, { titulo: 't', texto: 'x' }, {
      orgId: ORG, actorId: 'agente-real', actorType: ActorType.ai, agentSlug: 'agente-real',
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('painel recebe slug, não a chave interna de ativação', async () => {
    geradas.push(ferramenta);
    const controller = new ModulosController({
      modulosDaOrg: async () => new Set(),
      ferramentasDaOrg: async (_org: string, keys: readonly string[]) => [...keys],
    } as never);
    const resposta = await controller.meus({ orgId: ORG } as never);
    expect(resposta.ferramentas).toContain('fixture-tool');
    expect(resposta.ferramentas.every((slug) => !slug.startsWith('ferramentas:'))).toBe(true);
  });
});

describe('contrato estático de ferramenta', () => {
  const fonte = readFileSync(path.join(process.cwd(), 'src', 'ferramentas', 'ferramentas.service.ts'), 'utf8');
  const cli = readFileSync(path.join(process.cwd(), '..', '..', 'tools', 'ferramentas', 'cli.mjs'), 'utf8');

  it('usa módulo próprio, tabela literal parametrizada e capability proposta R5', () => {
    expect(cli).toContain('Prisma.sql');
    expect(cli).not.toContain('$queryRawUnsafe');
    expect(cli).toContain("risk: 'R5'");
    expect(fonte).toContain('ferramentaAtiva');
    expect(fonte).toContain('this.porta.executar');
    expect(fonte).toContain('temPapelDeMaquina');
  });
});
