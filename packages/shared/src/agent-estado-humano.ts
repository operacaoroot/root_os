// PROPOSTA TIPADA PARA REVISÃO. Somente evidência; não é SDK instalado.
// Referências imutáveis: manifesto-proposta-01.json. Sem index/export de produto.
import { z } from 'zod';

const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const iso = z.string().datetime();
const estadoAgente = z.enum(['planejado', 'ativo', 'pausado', 'encerrado']);

function limitado<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T, z.output<T>, z.input<T>> {
  return schema.superRefine((v, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(v)).byteLength > 65_536)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'O documento tem no máximo 64 KiB.' });
  });
}

// A marca é dos fatos reais; Agent não tem versão fictícia.
export const AgentEstadoHumanoEscopoSchema = z.object({
  orgId: id, actorId: id, agentId: id, agentSlug: z.string().min(1).max(200),
}).strict();
export const AgentEstadoHumanoBaseSchema = z.object({
  estado: estadoAgente, ativo: z.boolean(), donoId: id.nullable(), estadoPorId: id.nullable(),
  estadoEm: iso.nullable(), estadoMotivo: z.string().nullable(), atualizadoEm: iso,
}).strict();
export const AgentEstadoHumanoMarcaSchema = z.object({
  escopo: AgentEstadoHumanoEscopoSchema, base: AgentEstadoHumanoBaseSchema, marca: hash,
}).strict();
export type AgentEstadoHumanoEscopo = z.infer<typeof AgentEstadoHumanoEscopoSchema>;
export type AgentEstadoHumanoBase = z.infer<typeof AgentEstadoHumanoBaseSchema>;
export type AgentEstadoHumanoMarca = z.infer<typeof AgentEstadoHumanoMarcaSchema>;

export const AgentEstadoHumanoSchema = limitado(z.object({
  requestId: id, marcaEsperada: hash, motivo: z.string().trim().max(500).nullable(),
}).strict());
export type AgentEstadoHumano = z.infer<typeof AgentEstadoHumanoSchema>;

export const AgentEstadoHumanoPainelSchema = limitado(AgentEstadoHumanoMarcaSchema.extend({
  autoridade: z.object({ comandar: z.boolean(), verificadaEm: iso }).strict(),
  transicoes: z.array(estadoAgente).max(4),
}).strict());
export type AgentEstadoHumanoPainel = z.infer<typeof AgentEstadoHumanoPainelSchema>;

// Destino vem da rota pausar/retomar/encerrar. Encerrar exige motivo real não vazio.
// Produtor confere autoridade, transição e marca canônica escolhida sob lock.
// Parser não calcula marca, não concede autorização e não confirma pedido por GET.
