import { z } from 'zod';
import { IntegrationCatalogRowSchema, INTEGRATION_STATUS } from './schemas';

export const ConexaoDeclarativaLinhaSchema = IntegrationCatalogRowSchema.extend({
  health: z.null(), connectedAt: z.null(), lastSyncAt: z.null(), lastError: z.null(),
  registro: z.object({ estado: z.enum(['ausente', 'unico', 'ambiguo']), status: z.enum(INTEGRATION_STATUS).nullable() }).strict(),
  configuracao: z.object({
    estado: z.enum(['nao_configurada', 'declarada_sem_verificacao', 'desconhecida', 'nao_se_aplica']),
    origem: z.enum(['registro_empresa', 'declaracao_processo', 'embutido', 'indisponivel', 'nao_se_aplica']),
  }).strict(),
  desligado: z.boolean(), desligadoEm: z.string().datetime().nullable(),
  desligadoPor: z.null(), motivoDesligado: z.null(), grupo: z.string().nullable(),
  aplicacaoDoDesligamento: z.enum(['recusa', 'registro']), textoDoDesligamento: z.string(),
  contrato: z.object({ chave: z.string(), rotulo: z.string(), escopoDaCredencial: z.enum(['empresa', 'processo']),
    verbos: z.array(z.enum(['autorizar', 'sincronizar', 'saude', 'revogar'])), linhasIrmas: z.array(z.string()) }).strict().nullable(),
  saude: z.null(), recibo: z.null(),
}).strict();
export type ConexaoDeclarativaLinha = z.infer<typeof ConexaoDeclarativaLinhaSchema>;
export const ConexoesDeclarativasSchema = z.object({
  escopo: z.object({ orgId: z.string().uuid(), userId: z.string().uuid() }).strict(),
  sondado: z.literal(false), autoridadeGerenciar: z.boolean(),
  items: z.array(ConexaoDeclarativaLinhaSchema),
  source: z.object({ tool: z.literal('banco-interno'), generatedAt: z.string().datetime() }).strict(),
}).strict();
export type ConexoesDeclarativas = z.infer<typeof ConexoesDeclarativasSchema>;
