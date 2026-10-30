/*
 * A PORTA DE VERDADE COM O BANCO DE MENTIRA (30/10/2026, a Rootinha).
 *
 * As suítes da porta (`porta.test.ts`, `runtime.test.ts`) precisam de Postgres e
 * se pulam sem `TEST_DATABASE_URL`. As capacidades novas da central precisam de
 * uma prova que rode em QUALQUER máquina: a recusa fora da declaração, a recusa
 * de argumento e a retenção acontecem DENTRO de `ToolGateway.executar`, e é ele
 * que tem de ser exercitado — não uma cópia da regra.
 *
 * Aqui o `ToolGateway` é o da aplicação, com a política RESOLVIDA dos dois JSON
 * do repositório (base + delta) e a decisão do `avaliar` de verdade. O que é de
 * mentira é só o que fala com o banco: a decisão gravada, o `ToolCall`, o RASTRO
 * e a fila, que viram listas em memória para o teste conferir.
 *
 * NÃO termina em `.test.ts`: é ajudante, não suíte.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { avaliar, lerDelta, lerPolitica, resolverPolitica, type Capacidade, type CapacidadeCatalogo } from '@mktos/policy';

import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';

const RAIZ = path.resolve(__dirname, '../../..');
const json = (rel: string) => JSON.parse(readFileSync(path.join(RAIZ, rel), 'utf8')) as unknown;

/** A política que vale em runtime para o produto: a base da ROOT com o delta deste repositório. */
export const POLITICA = resolverPolitica(
  lerPolitica(json('packages/policy/politica-root.json'), 'politica-root.json'),
  lerDelta(json('packages/policy/politica-marketing-os.json'), 'politica-marketing-os.json'),
);

export function capacidade(id: string): CapacidadeCatalogo {
  const c = POLITICA.capacidades.find((x) => x.id === id);
  if (!c) throw new Error(`"${id}" não está na política resolvida`);
  return c;
}

export interface Registro {
  toolCalls: Array<Record<string, unknown>>;
  eventos: Array<{ tipo: string; payload?: Record<string, unknown>; actorId?: string | null; agentSlug?: string | null }>;
  propostas: Array<Record<string, unknown>>;
}

/** A porta da aplicação, com banco de mentira. `efeitos` é o registro real, para quem quiser inscrever. */
export function portaDublada(opcoes: { sinais?: string[] } = {}) {
  const registro: Registro = { toolCalls: [], eventos: [], propostas: [] };
  let n = 0;
  const prisma = {
    policyDecision: { update: async () => ({}) },
    toolCall: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `tc-${++n}`;
        registro.toolCalls.push({ id, ...data });
        return { id };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const t = registro.toolCalls.find((x) => x.id === where.id);
        if (t) Object.assign(t, data);
        return t;
      },
    },
  };
  const policy = {
    resolverCapacidade: (_org: string, id: string) => POLITICA.capacidades.find((c) => c.id === id) ?? null,
    avaliarERegistrar: async ({ capabilityId, ctx }: { capabilityId: string | null; ctx: { sinais?: string[] } }) => {
      const cap = capabilityId ? (POLITICA.capacidades.find((c) => c.id === capabilityId) ?? null) : null;
      return { decisao: avaliar(cap as unknown as Capacidade | null, { sinais: (ctx.sinais ?? []) as never }), decisionId: `d-${++n}` };
    },
  };
  const sinais = {
    calcular: async (p: { procedenciaExterna?: unknown }) => {
      const s = [...(opcoes.sinais ?? [])];
      // A mesma leitura da marca que o `SinaisService` faz: o booleano, ou a marca que diz `eExterna`.
      const marca = p.procedenciaExterna as { eExterna?: boolean } | boolean | undefined;
      if (marca === true || (typeof marca === 'object' && marca?.eExterna)) s.push('fonte_nao_confiavel');
      return s;
    },
  };
  const approvals = {
    propor: async (p: Record<string, unknown>) => {
      registro.propostas.push(p);
      return { approvalId: `ap-${++n}`, resumo: `pedido ${String(p.capabilityId)}`, expiraEm: new Date(Date.now() + 900_000).toISOString() };
    },
    consumir: async () => {
      throw new Error('este teste não consome aprovação');
    },
  };
  const eventos = {
    registrar: async (e: Registro['eventos'][number]) => {
      registro.eventos.push(e);
      return { id: `ev-${++n}` };
    },
  };
  const efeitos = new EfeitosRegistry();
  const porta = new ToolGateway(
    prisma as never,
    policy as never,
    sinais as never,
    approvals as never,
    eventos as never,
    undefined,
    undefined,
    efeitos,
    undefined,
  );
  return { porta, efeitos, registro };
}
