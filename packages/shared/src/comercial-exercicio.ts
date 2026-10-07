import { z } from 'zod';
import { ehValorMonetarioCanonico } from './valor-monetario';

const uuid = () => z.string().uuid().transform((v) => v.toLowerCase());
const texto = (max: number) => z.string().trim().min(1).max(max);
const opcional = (max: number) => texto(max).nullish().transform((v) => v ?? null);
const sha = z.string().regex(/^[a-f0-9]{64}$/);

export const ComercialEntradaExercicioSchema = z.object({
  requestId: uuid(), origemRef: uuid(), nome: texto(200), ownerId: uuid().nullish().transform((v) => v ?? null),
}).strict();
export const ComercialCondicoesExercicioSchema = z.object({
  valorCanonico: z.string().trim().refine(ehValorMonetarioCanonico, 'Use valor como BRL 1500.00.').nullish().transform((v) => v ?? null),
  inicio: z.string().datetime().nullish().transform((v) => v ?? null),
  prazo: opcional(300), periodicidade: opcional(120),
}).strict();
export const ComercialDocumentoExercicioSchema = z.object({ titulo: texto(200), corpo: z.string().trim().min(10).max(20000) }).strict();
export const ComercialPropostaExercicioSchema = z.object({
  requestId: uuid(), expectedPropostaVersion: z.number().int().min(0),
  documento: ComercialDocumentoExercicioSchema, condicoes: ComercialCondicoesExercicioSchema,
}).strict();
export const ComercialEvidenciaExercicioSchema = z.object({ tipo: z.literal('exercicio'), texto: z.string().trim().min(10).max(2000) }).strict();
export const ComercialAceiteExercicioSchema = z.object({
  requestId: uuid(), propostaId: uuid(), expectedPropostaVersion: z.number().int().min(1), condicoesHash: sha,
  evidencia: ComercialEvidenciaExercicioSchema, confirmacaoExercicio: z.literal(true),
}).strict();
export const ComercialEntregaExercicioSchema = z.object({
  requestId: uuid(), aceiteId: uuid(), propostaId: uuid(), expectedPropostaVersion: z.number().int().min(1), condicoesHash: sha,
  listId: uuid(), statusId: uuid().optional(), title: texto(300), assigneeUserId: uuid().nullish().transform((v) => v ?? null),
}).strict();
export const ComercialAcompanhamentoExercicioSchema = z.object({
  requestId: uuid(), expectedUpdatedAt: z.string().datetime(),
  status: z.enum(['novo', 'qualificado', 'oportunidade', 'reuniao', 'proposta', 'ganho', 'perdido']),
  nextAction: opcional(500),
}).strict();
export type ComercialEntradaExercicioInput = z.infer<typeof ComercialEntradaExercicioSchema>;
export type ComercialCondicoesExercicio = z.infer<typeof ComercialCondicoesExercicioSchema>;
export type ComercialPropostaExercicioInput = z.infer<typeof ComercialPropostaExercicioSchema>;
export type ComercialAceiteExercicioInput = z.infer<typeof ComercialAceiteExercicioSchema>;
export type ComercialEntregaExercicioInput = z.infer<typeof ComercialEntregaExercicioSchema>;
export type ComercialAcompanhamentoExercicioInput = z.infer<typeof ComercialAcompanhamentoExercicioSchema>;
export interface ComercialPropostaExercicioDto {
  id: string; versao: number; documento: { titulo: string; corpo: string; hash: string };
  condicoes: ComercialCondicoesExercicio; condicoesHash: string; registradaEm: string; atorId: string;
}
export interface ComercialAceiteExercicioDto {
  id: string; propostaId: string; propostaVersao: number; condicoesHash: string;
  evidencia: z.infer<typeof ComercialEvidenciaExercicioSchema>;
  alcada: { minima: 'responsavel'; verificada: 'responsavel' | 'titular' };
  registradaEm: string; atorId: string;
}
export interface ComercialEntregaExercicioDto {
  taskId: string; listId: string; title: string; aceiteId: string; propostaId: string; propostaVersao: number;
  condicoesHash: string; criadaEm: string; atorId: string;
}
export interface ComercialExercicioLeitura {
  modo: 'exercicio'; lead: { id: string; nome: string; ownerId: string | null; status: string; nextAction: string | null; updatedAt: string };
  origem: { tipo: 'manual'; ref: string };
  propostas: ComercialPropostaExercicioDto[]; versaoAtual: number; aceites: ComercialAceiteExercicioDto[];
  entregas: ComercialEntregaExercicioDto[];
  financeiro: { situacao: 'pendente'; pendencias: string[] };
  podeAceitar: boolean; podeEntregar: boolean;
}
export interface ComercialExercicioResposta {
  leadId: string; eventoId: string; replayed: boolean; taskId?: string;
}
