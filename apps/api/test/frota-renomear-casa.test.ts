import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EditarCasaSchema } from '../src/frota/frota.schemas';
import { FrotaService } from '../src/frota/frota.service';

// Caso real de 27/10/2026: a casa nasceu "promedica" na Nova casa, o servidor dizia
// "promedical" e o relator levou 400 sem ter como corrigir o nome pela tela.

const usuario = { sub: 'u1', email: 'pedro@root', name: 'Pedro' } as never;

function casa(over: Record<string, unknown> = {}) {
  return {
    id: 'c1', orgId: 'o1', casa: 'promedica', cliente: 'ProMedical', dono: null, responsavel: null, etapa: 'fora-do-kit',
    provedor: null, hostname: null, ip: null, vpn: null, sistema: null, maquina: null, kitVersao: null, acesso: 'publico',
    estado: 'ne', estadoTexto: null, tokenHash: 'h', ultimoRelatoEm: null, relato: null, ficha: {}, lgpd: {},
    observacoes: null, arquivadaEm: null, createdAt: new Date(), updatedAt: new Date(), acessos: [], ordens: [],
    ...over,
  };
}

function montar(atual: ReturnType<typeof casa>, outra: { id: string } | null = null) {
  const prisma = {
    frotaCasa: {
      findFirst: vi.fn().mockResolvedValueOnce(atual).mockResolvedValueOnce(outra),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...atual, ...data })),
    },
    frotaEvento: { create: vi.fn() },
  };
  const service = new FrotaService(prisma as never, { log: vi.fn() } as never);
  return { prisma, service };
}

describe('Frota · renomear a casa pela Ficha', () => {
  it('troca o nome antes do primeiro relato e registra a troca', async () => {
    const { prisma, service } = montar(casa());
    const r = await service.editarCasa('o1', usuario, 'c1', EditarCasaSchema.parse({ casa: 'promedical' }));
    expect(prisma.frotaCasa.update.mock.calls[0][0].data.casa).toBe('promedical');
    expect(r.casa.casa).toBe('promedical');
    const acoes = prisma.frotaEvento.create.mock.calls.map((c) => (c[0] as { data: { acao: string } }).data.acao);
    expect(acoes).toContain('Casa renomeada: promedica → promedical.');
  });

  it('recusa depois do primeiro relato, porque o servidor já usa o nome', async () => {
    const { prisma, service } = montar(casa({ ultimoRelatoEm: new Date() }));
    await expect(service.editarCasa('o1', usuario, 'c1', { casa: 'promedical' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.frotaCasa.update).not.toHaveBeenCalled();
  });

  it('recusa nome que outra casa já usa', async () => {
    const { prisma, service } = montar(casa(), { id: 'c2' });
    await expect(service.editarCasa('o1', usuario, 'c1', { casa: 'root' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.frotaCasa.update).not.toHaveBeenCalled();
  });

  it('salvar a Ficha sem mexer no nome não é renomear', async () => {
    const { prisma, service } = montar(casa({ ultimoRelatoEm: new Date() }));
    await service.editarCasa('o1', usuario, 'c1', { cliente: 'ProMedical Ltda', casa: 'promedica' });
    expect(prisma.frotaCasa.update.mock.calls[0][0].data.casa).toBeUndefined();
  });

  it('o nome segue a regra do kit: minúsculas, números e hífen', () => {
    expect(EditarCasaSchema.safeParse({ casa: 'ProMedical' }).success).toBe(false);
    expect(EditarCasaSchema.safeParse({ casa: 'pro medical' }).success).toBe(false);
    expect(EditarCasaSchema.safeParse({ casa: 'pro-medical2' }).success).toBe(true);
  });
});
