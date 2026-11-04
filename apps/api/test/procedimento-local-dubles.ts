import { vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ProcedimentoLocalExecucaoSchema } from '@mktos/shared';
import { AuditService } from '../src/audit/audit.service';
import { AgendaLocalService } from '../src/agents/agenda-local.service';
import { ModeloLocalService } from '../src/agents/modelo-local.service';
import { ProcedimentoDoAgenteService } from '../src/agents/procedimento-do-agente.service';
import { EventLogService } from '../src/gateway/event-log.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { comContexto } from '../src/common/contexto-execucao';
import { randomUUID } from 'node:crypto';

export class ModeloProcedimentoDuble extends ModeloLocalService {
  override prontidao = vi.fn<ModeloLocalService['prontidao']>(() => ({
    estado: 'declarado_sem_verificacao', provider: 'llama.cpp-local', disponivel: null, modelo: null, verificadoAgora: false,
  }));
  override estado = vi.fn<ModeloLocalService['estado']>();
  override resumir = vi.fn<ModeloLocalService['resumir']>();
}

export function montarProcedimento(db: PrismaClient, model: ModeloLocalService) {
  const prisma: PrismaService = db;
  const audit = new AuditService(prisma);
  const service = new ProcedimentoDoAgenteService(prisma, audit, model,
    new AgendaLocalService(prisma, audit, new EventLogService(prisma)));
  return new Proxy(service, { get(target, key) {
    const value: unknown = Reflect.get(target, key);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      const [orgId, actorId] = args;
      if (typeof orgId !== 'string' || typeof actorId !== 'string') throw new Error('O harness exige pessoa e empresa explícitas.');
      return comContexto({ orgId, actorId, actorType: 'user', correlationId: randomUUID(), origem: 'http' },
        () => Reflect.apply(value, target, args));
    };
  } });
}

/** A chamada direta deve cumprir o DTO de execução, nunca um recibo de agenda. */
export async function executarProcedimento(service: ProcedimentoDoAgenteService,
  ...args: Parameters<ProcedimentoDoAgenteService['executar']>) {
  const [orgId, actorId] = args;
  return comContexto({ orgId, actorId, actorType: 'user', correlationId: randomUUID(), origem: 'http' },
    async () => ProcedimentoLocalExecucaoSchema.parse(await service.executar(...args)));
}

export async function recuperarExecucao(service: ProcedimentoDoAgenteService,
  ...args: Parameters<ProcedimentoDoAgenteService['porPedido']>) {
  const result = await service.porPedido(...args);
  if (result.estado !== 'confirmado') throw new Error('O pedido deveria ter uma execução confirmada.');
  return result.execucao;
}

/** Simula uma revogação confirmada após a consulta inicial de fontes e antes da revalidação. */
export function depoisDeListarFontes(db: PrismaClient, action: () => Promise<unknown>): PrismaClient {
  let usado = false;
  return new Proxy(db, { get(target, key) {
    if (key === 'contextItem') return new Proxy(target.contextItem, { get(delegate, method) {
      const value: unknown = Reflect.get(delegate, method);
      if (typeof value !== 'function') return value;
      if (method !== 'findMany') return value.bind(delegate);
      return async (...args: unknown[]) => {
        const result: unknown = await Reflect.apply(value, delegate, args);
        if (!usado) { usado = true; await action(); }
        return result;
      };
    } });
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
