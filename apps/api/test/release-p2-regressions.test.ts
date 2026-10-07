import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AuditService } from '../src/audit/audit.service';
import type { ModulosService } from '../src/tenants/modulos.service';
import type { ReciboDaVault } from '../src/obsidian/recibo-da-vault';
import { blobDoGit } from '../src/obsidian/indice-do-git';
import { descobrirNaPasta } from '../src/obsidian/disco-da-vault';
import { lerRepositorioDaVault, marcaDoRepositorio } from '../src/obsidian/estado-do-git';
import { ObsidianService } from '../src/obsidian/obsidian.service';
import { LeadsService } from '../src/leads/leads.service';
import { decisaoMaisRecenteDasCondicoes, estadoDaProposta, eventoIdDaDecisao } from '../src/leads/proposta-comercial';

vi.mock('../src/obsidian/disco-da-vault', () => ({ descobrirNaPasta: vi.fn() }));
vi.mock('../src/obsidian/estado-do-git', async (original) => ({
  ...await original<typeof import('../src/obsidian/estado-do-git')>(),
  lerRepositorioDaVault: vi.fn(),
  marcaDoRepositorio: vi.fn(),
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('P2: colisão NFC na reindexação', () => {
  it.each([false, true])('preserva a KnowledgeNote anterior sem importar os nomes ambíguos (completo=%s)', async (completo) => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('OBSIDIAN_FONTE', 'pasta');
    const buscar = vi.fn(() => { throw new Error('chamada externa inesperada'); });
    vi.stubGlobal('fetch', buscar);
    const NFC = 'Decisões/aprovação.md'.normalize('NFC');
    const NFD = NFC.normalize('NFD');
    const bytes = Buffer.from('# Aprovação\nTexto diferente em colisão.');
    const fileTime = new Date('2026-10-01T00:00:00Z');
    const arquivos = [NFC, NFD].map((c) => ({ caminho: Buffer.from(c), bytes, modificadoEm: fileTime }));
    vi.mocked(descobrirNaPasta).mockReturnValue({ arquivos, ilegiveis: [], atributos: [], mdNoDisco: 2 });
    const marca = { head: null, indiceModificadoEm: null };
    vi.mocked(marcaDoRepositorio).mockReturnValue(marca);
    vi.mocked(lerRepositorioDaVault).mockReturnValue({
      gitDir: 'fixture', marca, naoVerificavel: null,
      montante: {
        repositorio: null, commit: null, commitEm: null, commitEmMotivo: null,
        ultimaBuscaEm: null, ultimaBuscaFalhouEm: null, ultimoAvancoEm: null,
        remotoNaBusca: null, atrasado: false, buscaParada: false, errosDoPull: 'não visível no container',
      },
      indice: { ok: true, versao: 2, extensoes: [], somaNula: false, entradas: arquivos.map((a) => ({ caminho: a.caminho, blob: blobDoGit(bytes), modo: 0o100644, estagio: 0, skipWorktree: false, intentToAdd: false })) },
    });
    const anterior = { path: NFC, folder: 'Decisões', title: 'Aprovação', tags: ['anterior'], content: 'Texto sintético anterior.', links: [], wordCount: 3, fileTime };
    let rows = [{ ...anterior }];
    const prisma = {
      knowledgeNote: {
        findMany: vi.fn(async () => rows.map((r) => ({ ...r }))),
        deleteMany: vi.fn(async () => { rows = []; }),
        create: vi.fn(async ({ data }) => { rows.push(data); return data; }),
      },
      $queryRaw: vi.fn(async () => []),
    };
    const svc = new ObsidianService(prisma as unknown as PrismaService, {} as never, {} as never, {} as never);
    const projetar = vi.fn(async () => null);
    // A fronteira adversa usa o serviço real e dublês apenas para disco, git, banco e projeção.
    const interno = svc as unknown as {
      projetarNaMemoria: typeof projetar;
      reindexar: (org: string, completo: boolean, recibo: ReciboDaVault, lancadas: Set<unknown>, fora: unknown[], marcar: (v: boolean) => void) => Promise<number>;
    };
    interno.projetarNaMemoria = projetar;
    const recibo = { leitura: { lidos: 0, reaproveitados: 0, falhas: 0 }, montante: {} } as ReciboDaVault;
    expect(await interno.reindexar('synthetic-org', completo, recibo, new Set(), [], () => {})).toBe(0);
    expect(rows).toEqual([expect.objectContaining(anterior)]);
    expect(recibo.indexacao).toMatchObject({ gravadas: 0, preservadas: 1 });
    expect(recibo.descoberta).toMatchObject({ colisoesNFC: 2 });
    expect(projetar).toHaveBeenCalledWith('synthetic-org', [], new Map(), [NFC]);
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe('P2: decisões opostas no mesmo instante', () => {
  const hash = 'a'.repeat(64);
  const t = new Date('2026-10-07T12:00:00.123Z');
  const ev = (type: 'aceite' | 'recusa', occurredAt = t, condicoesHash = hash) => ({
    id: eventoIdDaDecisao('org', 'lead', type, condicoesHash), type, occurredAt,
    payload: { condicoesHash, propostaEventoId: 'proposta', evidenciaHash: 'fixture' },
  });
  it.each([false, true])('recusa leitura e replay nas duas ordens (inversa=%s)', async (inversa) => {
    const eventos = [ev('aceite'), ev('recusa')];
    if (inversa) eventos.reverse();
    expect(() => decisaoMaisRecenteDasCondicoes(eventos, hash)).toThrow(/mesmo instante/);
    expect(() => estadoDaProposta(eventos)).toThrow(/mesmo instante/);
    const prisma = {
      lead: { findFirst: vi.fn(async () => ({ id: 'lead' })) },
      leadEvent: {
        findMany: vi.fn(async () => eventos),
        findFirst: vi.fn(async () => ({ payload: eventos[0].payload })),
      },
      $transaction: vi.fn(),
    };
    const modulos = { modulosDaOrg: vi.fn(async () => new Set(['trabalho'])) };
    const svc = new LeadsService(prisma as unknown as PrismaService, {} as AuditService, modulos as unknown as ModulosService);
    await expect(svc.lerProposta('org', 'lead')).rejects.toBeInstanceOf(ConflictException);
    for (const decisao of ['aceite', 'recusa'] as const) {
      await expect(svc.decidir({ sub: 'ator', orgId: 'org', permissions: [] }, 'lead', {
        decisao, condicoesHash: hash, evidencia: { tipo: 'link', url: 'https://exemplo.test/evidencia' },
      })).rejects.toBeInstanceOf(ConflictException);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each([false, true])('mantém a decisão posterior e o empate decisão/proposta (inversa=%s)', (inversa) => {
    const posterior = ev('recusa', new Date(t.getTime() + 1));
    const eventos = [ev('aceite'), posterior];
    if (inversa) eventos.reverse();
    expect(decisaoMaisRecenteDasCondicoes(eventos, hash)).toEqual({ eventoId: posterior.id, decisao: 'recusa', registradaEm: posterior.occurredAt });
    expect(estadoDaProposta(eventos)).toBe('recusa_registrada');
    const comProposta = [{ id: 'p', type: 'proposta', occurredAt: t }, ev('aceite')];
    if (inversa) comProposta.reverse();
    expect(estadoDaProposta(comProposta)).toBe('aceite_registrado');
    expect(decisaoMaisRecenteDasCondicoes([ev('aceite'), ev('recusa', t, 'b'.repeat(64))], hash)?.decisao).toBe('aceite');
  });
});
