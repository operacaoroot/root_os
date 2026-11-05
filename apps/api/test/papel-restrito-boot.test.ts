import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { anunciarPapel } from '../src/prisma/sessao-de-banco';

const seguro = {
  papel: 'mktos_app', bypassa: false, superusuario: false, dono: 'mkt',
  herdaPrivilegio: false, possuiTabela: false, tabelasSemRls: [], criaNoSchema: false, podeTruncar: false,
};
const cliente = (resultado: unknown) => ({
  $queryRawUnsafe: vi.fn().mockResolvedValue(resultado),
}) as unknown as PrismaClient;

describe('arranque em impor exige papel restrito comprovado', () => {
  it.each([
    { superusuario: true }, { bypassa: true }, { dono: 'mktos_app' },
    { papel: 'outro_papel' }, { herdaPrivilegio: true }, { possuiTabela: true },
    { tabelasSemRls: ['_diario_teste'] }, { criaNoSchema: true }, { podeTruncar: true },
  ])('recusa configuração insegura %j antes do arranque', async (alteracao) => {
    await expect(anunciarPapel(cliente([{ ...seguro, ...alteracao }]), 'impor', vi.fn()))
      .rejects.toThrow(/papel restrito não comprovado/i);
  });
  it('recusa diagnóstico que falhou sem imprimir erro com credenciais', async () => {
    const base = cliente([]);
    vi.mocked(base.$queryRawUnsafe).mockRejectedValue(new Error('postgres://segredo@host'));
    const log = vi.fn();
    await expect(anunciarPapel(base, 'impor', log)).rejects.toThrow(/papel restrito não comprovado/i);
    expect(JSON.stringify(log.mock.calls)).not.toContain('segredo');
  });
  it('recusa resultado vazio ou incompleto do catálogo', async () => {
    await expect(anunciarPapel(cliente([]), 'impor', vi.fn())).rejects.toThrow(/papel restrito não comprovado/i);
    await expect(anunciarPapel(cliente([{ ...seguro, herdaPrivilegio: undefined }]), 'impor', vi.fn()))
      .rejects.toThrow(/papel restrito não comprovado/i);
  });
  it('preserva observar para desenvolvimento sem declarar proteção', async () => {
    await expect(anunciarPapel(cliente([{ ...seguro, superusuario: true }]), 'observar', vi.fn()))
      .resolves.toBeUndefined();
  });
});
