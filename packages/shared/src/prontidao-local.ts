import { z } from 'zod';

const id = z.string().min(1).max(200);
const escopo = z.object({ orgId: id, userId: id }).strict();

export const ProntidaoModeloLocalSchema = z.object({
  estado: z.enum(['nao_configurado', 'configuracao_invalida', 'declarado_sem_verificacao']),
  provider: z.literal('llama.cpp-local'), disponivel: z.null(), modelo: z.null(),
  verificadoAgora: z.literal(false),
}).strict();
export type ProntidaoModeloLocal = z.infer<typeof ProntidaoModeloLocalSchema>;

export const ProntidaoAgentesSchema = z.object({
  escopo, modelo: ProntidaoModeloLocalSchema,
  fontes: z.object({ consultaPermitida: z.boolean(), quantidade: z.null() }).strict(),
}).strict();
export type ProntidaoAgentes = z.infer<typeof ProntidaoAgentesSchema>;

export const ProntidaoFonteLocalSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('nao_se_aplica'), tipo: z.null(), verificadaAgora: z.literal(false) }).strict(),
  z.object({ estado: z.literal('nao_configurada'), tipo: z.enum(['pasta', 'drive']), verificadaAgora: z.literal(false) }).strict(),
  z.object({ estado: z.literal('declarada_sem_verificacao'), tipo: z.enum(['pasta', 'drive']), verificadaAgora: z.literal(false) }).strict(),
]);
export const ProntidaoMemoriaSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('vazia_confirmada'), quantidade: z.literal(0) }).strict(),
  z.object({ estado: z.literal('com_contexto'), quantidade: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
]);
export const ProntidaoContextoSchema = z.object({
  escopo, fonte: ProntidaoFonteLocalSchema, memoria: ProntidaoMemoriaSchema,
}).strict();
export type ProntidaoContexto = z.infer<typeof ProntidaoContextoSchema>;
