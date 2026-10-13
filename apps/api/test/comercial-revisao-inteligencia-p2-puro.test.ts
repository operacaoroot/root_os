import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { DiagnosticoService } from '../src/comercial/diagnostico.service';
import type { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { InteligenciaController } from '../src/comercial/inteligencia.controller';
import type { LlmProvider } from '../src/llm/llm.provider';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * REVISÃO ADVERSARIAL, P2 da inteligência e da sala (lane G, 13/10/2026).
 * Cada caso fica vermelho sem o conserto do item que cita.
 */

function diagnosticoDublê(vigente: { id: string; payload: Record<string, unknown> } | null) {
  const registrados: Array<{ chave: string; payload: Record<string, unknown> }> = [];
  const prisma = {
    leadEvent: {
      findFirst: async () => (vigente ? { id: vigente.id, occurredAt: new Date('2026-10-13T12:00:00Z'), payload: vigente.payload } : null),
    },
  } as unknown as PrismaService;
  const fio = {
    registrar: async (_o: string, _l: string, _t: string, chave: string, payload: Record<string, unknown>) => {
      registrados.push({ chave, payload });
      return { eventoId: `ev-${registrados.length}`, novo: true };
    },
  } as unknown as FioService;
  const svc = new DiagnosticoService(prisma, fio, {} as ReacoesRegistry, {} as LlmProvider);
  return { svc, registrados };
}

describe('revisão E-4/C-8: aprovar o diagnóstico é decisão de mesa sobre a versão lida', () => {
  it('a rota pede aprovacoes.decidir, não leads.editar', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, InteligenciaController.prototype.aprovarDiagnostico) as string[];
    expect(perms).toEqual(['aprovacoes.decidir']);
  });

  it('conta de máquina é recusada com 403 e nada é gravado', async () => {
    const { svc, registrados } = diagnosticoDublê({ id: 'diag-A', payload: { dores: [], aprovadoEm: null } });
    await expect(svc.aprovar('org', 'lead', { id: 'bot', nome: null, papeis: ['ia_acao'] }, 'diag-A')).rejects.toMatchObject({ status: 403 });
    expect(registrados).toHaveLength(0);
  });

  it('o diagnóstico refeito enquanto a pessoa lia: aprovar o lido responde 409 e não aprova o novo', async () => {
    const { svc, registrados } = diagnosticoDublê({ id: 'diag-B', payload: { dores: [], aprovadoEm: null } });
    await expect(svc.aprovar('org', 'lead', { id: 'socia', nome: 'Lidiane', papeis: ['diretor'] }, 'diag-A')).rejects.toMatchObject({ status: 409 });
    expect(registrados).toHaveLength(0);
  });

  it('sem o eventoId lido, 400; com o vigente, aprova e prende o evento', async () => {
    const { svc, registrados } = diagnosticoDublê({ id: 'diag-B', payload: { dores: [], aprovadoEm: null } });
    await expect(svc.aprovar('org', 'lead', { id: 'socia', nome: 'Lidiane', papeis: ['diretor'] }, '')).rejects.toMatchObject({ status: 400 });
    await svc.aprovar('org', 'lead', { id: 'socia', nome: 'Lidiane', papeis: ['diretor'] }, 'diag-B');
    expect(registrados).toEqual([expect.objectContaining({ chave: 'aprovado:diag-B', payload: expect.objectContaining({ aprovaOEvento: 'diag-B', aprovadoPorId: 'socia' }) })]);
  });
});
