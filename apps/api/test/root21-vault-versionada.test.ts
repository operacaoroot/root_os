import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@prisma/client';
import { ContextBuilder } from '../src/agents/context-builder.service';
import { VaultVersionadaService } from '../src/agents/vault-versionada.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { hashDoCorpo } from '../src/memory/procedencia';
import type { ObsidianService } from '../src/obsidian/obsidian.service';

const body = readFileSync(`${__dirname}/fixtures/root21/primeiro-artefato.md`, 'utf8');
const hash = hashDoCorpo(body);
const pedido = { orgId: 'casa-sintetica', agentId: 'agente-sintetico', solicitanteId: 'pessoa-sintetica' };
const agent = { id: pedido.agentId, slug: 'ensaio', contextoFixo: [] } as unknown as Agent;

/** Banco em memória com consultas observáveis; não prova Postgres/RLS nem ingestão. */
function bancada() {
  const estado = { concessao: true, permissao: true, ativo: true, desligado: false };
  const item = { id: 'item-sintetico', orgId: pedido.orgId, chave: 'vault:root21/primeiro-artefato.md',
    sourceType: 'vault', arquivadoEm: null, versao: 1, contentHash: hash, body, title: 'Artefato sintético' };
  const versao = { ...item, id: 'versao-sintetica-1', itemId: item.id };
  const prisma = {
    org: { findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => where.id === pedido.orgId && where.slug === 'root' ? { id: where.id } : null) },
    agent: { findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => {
      expect(where).toEqual({ id: pedido.agentId, orgId: pedido.orgId, capacidades: { has: 'contexto.memoria.buscar' } });
      return estado.concessao ? { id: where.id } : null;
    }) },
    user: { findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => {
      expect(where).toEqual({ id: pedido.solicitanteId, orgId: pedido.orgId, isActive: true,
        roles: { some: { orgId: pedido.orgId, permissions: { some: { key: 'obsidian.ver' } } } } });
      return estado.permissao && estado.ativo ? { id: where.id } : null;
    }) },
    conectorDesligado: { findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => {
      expect(where).toEqual({ orgId: pedido.orgId, conector: 'obsidian' });
      return estado.desligado ? { id: 'interruptor' } : null;
    }) },
    contextItem: {
      findMany: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        expect(where).toMatchObject({ orgId: pedido.orgId, sourceType: 'vault', chave: { startsWith: 'vault:' }, arquivadoEm: null });
        if (where.id?.in) return where.id.in.includes(item.id) ? [{ ...item }] : [];
        return where.AND.OR.some((x: { body?: { contains: string }; title?: { contains: string } }) =>
          (x.body && item.body.includes(x.body.contains)) || (x.title && item.title.includes(x.title.contains))) ? [{ ...item }] : [];
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        expect(where).toMatchObject({ id: where.id, orgId: pedido.orgId, arquivadoEm: null });
        return where.id === item.id ? { ...item } : null;
      }),
    },
    contextItemVersion: { findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => {
      expect(where.orgId).toBe(pedido.orgId);
      expect(where.sourceType).toBe('vault');
      return where.itemId === versao.itemId && where.versao === versao.versao && where.contentHash === versao.contentHash ? { ...versao } : null;
    }) },
  };
  const leitor = new VaultVersionadaService(prisma as unknown as PrismaService);
  const builder = new ContextBuilder({ search: vi.fn(() => { throw new Error('índice legado não deve ser chamado'); }) } as unknown as ObsidianService, leitor);
  const montar = (solicitanteId: string | null = pedido.solicitanteId) => builder.montarVaultVersionada(pedido.orgId, '17', agent, solicitanteId);
  return { estado, item, versao, prisma, leitor, montar };
}

describe('ROOT-21: primeiro artefato sintético, leitor explícito', () => {
  it('cita chave, item, versão, versionId e hash do corpo recuperado no ContextBuilder', async () => {
    const b = bancada();
    const contexto = await b.montar();
    expect(contexto.blocos).toContain('17 unidades');
    expect(contexto.blocos).toContain(b.item.chave);
    expect(contexto.blocos).toContain(`"versionId":"${b.versao.id}"`);
    expect(contexto.blocos).toContain(hash);
    expect(contexto.fontes[0].citacao).toEqual({ chave: b.item.chave, itemId: b.item.id,
      versao: 1, versionId: b.versao.id, contentHash: hash });
    expect(contexto.ausencia).toBeNull();
    expect((await b.leitor.get(pedido, b.item.id))?.content).toBe(body);
  });

  it.each(['concessao', 'permissao', 'ativo', 'desligado'] as const)
  ('revoga %s depois do primeiro acesso: busca, leitura direta e contexto escondem todo o artefato', async (campo) => {
    const b = bancada();
    expect((await b.montar()).fontes).toHaveLength(1);
    b.estado[campo] = campo === 'desligado';
    const busca = await b.leitor.search(pedido, '17');
    const direto = await b.leitor.get(pedido, b.item.id);
    const contexto = await b.montar();
    expect(busca.items).toEqual([]);
    expect(direto).toBeNull();
    expect(contexto.fontes).toEqual([]);
    expect(contexto.ausencia?.motivo).toBe('acesso_negado');
    for (const segredo of [body.trim(), b.item.id, b.versao.id, b.item.chave, hash, '17 unidades']) {
      expect(JSON.stringify({ busca, direto, contexto })).not.toContain(segredo);
    }
  });

  it('nega sem solicitante e para outra empresa antes de consultar conteúdo', async () => {
    const b = bancada();
    expect((await b.montar(null)).fontes).toEqual([]);
    expect(await b.leitor.get({ ...pedido, solicitanteId: null }, b.item.id)).toBeNull();
    expect(await b.leitor.search({ ...pedido, orgId: 'cliente-sintetico' }, '17')).toMatchObject({ items: [] });
    expect(await b.leitor.get({ ...pedido, orgId: 'cliente-sintetico' }, b.item.id)).toBeNull();
    expect(b.prisma.contextItem.findMany).not.toHaveBeenCalled();
    expect(b.prisma.contextItem.findFirst).not.toHaveBeenCalled();
  });

  it('recusa hash/corpo divergente ou versão ausente, sem inventar versionId', async () => {
    const b = bancada();
    b.versao.body = 'Corpo adulterado';
    expect((await b.montar()).fontes).toEqual([]);
    expect(await b.leitor.get(pedido, b.item.id)).toBeNull();
    b.versao.body = body;
    b.versao.versao = 2;
    expect((await b.montar()).fontes).toEqual([]);
  });

  it('citação acompanha uma segunda versão de entrada na base, sem alias ou rename', async () => {
    const b = bancada();
    const novo = body + '\nSegunda versão sintética: 23 unidades.\n';
    Object.assign(b.item, { body: novo, versao: 2, contentHash: hashDoCorpo(novo) });
    Object.assign(b.versao, { body: novo, versao: 2, contentHash: hashDoCorpo(novo), id: 'versao-sintetica-2' });
    const contexto = await b.montar();
    expect(contexto.fontes[0].citacao).toMatchObject({ versao: 2, versionId: 'versao-sintetica-2', contentHash: hashDoCorpo(novo) });
    expect(contexto.blocos).toContain('23 unidades');
  });

  it('recusa hash inválido mesmo quando item e versão têm o mesmo corpo adulterado', async () => {
    const b = bancada();
    b.item.body = b.versao.body = 'Corpo sintético adulterado: 17 unidades';
    expect((await b.montar()).fontes).toEqual([]);
    expect(await b.leitor.get(pedido, b.item.id)).toBeNull();
  });

  it('revogação durante a leitura retira também o resultado já consultado', async () => {
    const b = bancada();
    b.prisma.contextItemVersion.findFirst.mockImplementationOnce(async () => {
      b.estado.permissao = false;
      return { ...b.versao };
    });
    expect(await b.leitor.search(pedido, '17')).toMatchObject({ items: [] });
    b.estado.permissao = true;
    b.prisma.contextItemVersion.findFirst.mockImplementationOnce(async () => {
      b.estado.concessao = false;
      return { ...b.versao };
    });
    expect(await b.leitor.get(pedido, b.item.id)).toBeNull();
  });
});
