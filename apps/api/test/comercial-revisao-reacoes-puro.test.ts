import { describe, expect, it } from 'vitest';

import { FioService, MAX_TENTATIVAS, ReacoesRegistry, esperaDoErroMs, tentativasDe } from '../src/comercial/fio.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * REVISÃO A-2 (13/10/2026): o retry das reações não corre ao lado da reação
 * viva e não repete erro para sempre.
 */

const MIN = 60_000;

function cenario(linhas: Array<{ id: string; estado: string; criadoEm: Date; resultado?: unknown }>, falha = true) {
  const rodou: string[] = [];
  const atualizadas: Record<string, Record<string, unknown>> = {};
  const prisma = {
    comercialReacao: {
      findMany: async ({ where }: { where: { OR: Array<{ estado: string; criadoEm: { lt: Date } }> } }) =>
        linhas.filter((l) => where.OR.some((c) => c.estado === l.estado && l.criadoEm < c.criadoEm.lt)).map((l) => ({ ...l, eventoId: `ev-${l.id}`, reacao: 'r', resultado: l.resultado ?? null })),
      updateMany: async () => ({ count: 1 }),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => void (atualizadas[where.id] = data),
    },
    leadEvent: { findFirst: async ({ where }: { where: { id: string } }) => ({ id: where.id, leadId: 'l', type: 'whats.recebida', payload: {}, occurredAt: new Date() }) },
  } as unknown as PrismaService;
  const reacoes = new ReacoesRegistry();
  reacoes.inscrever('whats.recebida', 'r', async (e) => {
    rodou.push(e.eventoId);
    if (falha) throw new Error('provedor fora');
    return null;
  });
  return { fio: new FioService(prisma, reacoes), rodou, atualizadas };
}

describe('revisão A-2: o retry das reações', () => {
  it('a espera cresce e as tentativas têm teto', () => {
    expect(tentativasDe(null)).toBe(1);
    expect(tentativasDe({ tentativas: 3 })).toBe(3);
    expect(esperaDoErroMs(1)).toBe(0);
    expect(esperaDoErroMs(2)).toBe(2 * MIN);
    expect(esperaDoErroMs(3)).toBe(6 * MIN);
  });

  it('em_curso de 3 min não é tomado (a reação pode estar viva); de 20 min é', async () => {
    const agora = Date.now();
    const corte = new Date(agora - 2 * MIN);
    const { fio, rodou } = cenario([
      { id: 'viva', estado: 'em_curso', criadoEm: new Date(agora - 3 * MIN) },
      { id: 'morta', estado: 'em_curso', criadoEm: new Date(agora - 20 * MIN) },
    ]);
    await fio.reexecutarPendentes('org', corte);
    expect(rodou).toEqual(['ev-morta']);
  });

  it('erro conta a tentativa, respeita a espera e para no teto com a marca de desistência', async () => {
    const agora = Date.now();
    const corte = new Date(agora - 2 * MIN);
    const { fio, rodou, atualizadas } = cenario([
      { id: 'primeira', estado: 'erro', criadoEm: new Date(agora - 3 * MIN) },
      { id: 'cedo', estado: 'erro', criadoEm: new Date(agora - 3 * MIN), resultado: { tentativas: 2 } },
      { id: 'ultima', estado: 'erro', criadoEm: new Date(agora - 60 * MIN), resultado: { tentativas: MAX_TENTATIVAS - 1 } },
      { id: 'parada', estado: 'erro', criadoEm: new Date(agora - 600 * MIN), resultado: { tentativas: MAX_TENTATIVAS, desistiu: true } },
    ]);
    await fio.reexecutarPendentes('org', corte);
    expect(rodou.sort()).toEqual(['ev-primeira', 'ev-ultima']);
    expect(atualizadas.primeira).toMatchObject({ estado: 'erro', resultado: { tentativas: 2, desistiu: false } });
    expect(atualizadas.ultima).toMatchObject({ estado: 'erro', resultado: { tentativas: MAX_TENTATIVAS, desistiu: true } });
  });
});
