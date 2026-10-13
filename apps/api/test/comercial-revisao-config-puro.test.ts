import { describe, expect, it } from 'vitest';

import type { AuditService } from '../src/audit/audit.service';
import { ConfigComercialService } from '../src/comercial/config.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * REVISÃO A-1 (13/10/2026): os interruptores da mesa (K08) e a autonomia
 * mudam pela tela só com o RASTRO do antes e do depois, e conta de máquina não
 * mexe neles. A permissão da rota (`aprovacoes.decidir`) é conferida pelo
 * guarda; aqui ficam a recusa da conta de máquina e o registro.
 */

function dublês() {
  let linha: Record<string, unknown> | null = null;
  const logs: Array<Record<string, unknown>> = [];
  const prisma = {
    comercialConfig: {
      findUnique: async () => linha,
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        linha = linha ? { ...linha, ...update, atualizadoEm: new Date() } : { envioAutomatico: false, fechamentoAutomatico: false, silencioAprova: false, ...create, atualizadoEm: new Date() };
        return linha;
      },
    },
  } as unknown as PrismaService;
  const audit = { log: async (x: Record<string, unknown>) => void logs.push(x) } as unknown as AuditService;
  return { svc: new ConfigComercialService(prisma, audit), logs };
}

describe('revisão A-1: os interruptores da mesa mudam com rastro', () => {
  it('conta de máquina é recusada e nada é gravado', async () => {
    const { svc, logs } = dublês();
    await expect(svc.gravar('org', { envioAutomatico: true }, { id: 'u1', papeis: ['ia_acao'] })).rejects.toMatchObject({ status: 403 });
    expect(logs).toHaveLength(0);
    expect((await svc.ler('org')).envioAutomatico).toBe(false);
  });

  it('pela tela, a escrita vai ao RASTRO com o antes e o depois só do que mudou', async () => {
    const { svc, logs } = dublês();
    await svc.gravar('org', { decisaoExpiraHoras: 1, envioAutomatico: true }, { id: 'u1', papeis: ['diretor'], ip: '127.0.0.1' });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'comercial.config.alterada', actorId: 'u1', entityType: 'comercial.config' });
    expect(logs[0].before).toMatchObject({ envioAutomatico: false, decisaoExpiraHoras: null });
    expect(logs[0].after).toMatchObject({ envioAutomatico: true, decisaoExpiraHoras: 1 });
    // A mesma escrita de novo não muda nada e não gera linha.
    await svc.gravar('org', { decisaoExpiraHoras: 1, envioAutomatico: true }, { id: 'u1', papeis: ['diretor'] });
    expect(logs).toHaveLength(1);
  });
});
