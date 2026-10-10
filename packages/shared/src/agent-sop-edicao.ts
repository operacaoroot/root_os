import { z } from 'zod';

export const AgentSopEdicaoSchema = z.object({
  expectedSopVersion: z.number({ required_error: 'Informe a versão lida do procedimento.' }).int().positive().nullable(),
  procedimento: z.unknown().refine(v => v !== undefined, 'Informe o procedimento.'),
}).strict();
export type AgentSopEdicao = z.infer<typeof AgentSopEdicaoSchema>;

export const AgentSopSalvaSchema = z.object({ ok: z.literal(true), versao: z.number().int().positive() }).strict();
export type AgentSopSalva = z.infer<typeof AgentSopSalvaSchema>;
