import { z } from 'zod';

const id = z.string().min(1).max(200);
const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true }).transform(v => new Date(v).toISOString());
const escopo = { orgId: id, actorId: id, requestId: uuid };
export const MarketingPedidoEscopoSchema = z.object({ orgId: id, actorId: id }).strict();
export type MarketingPedidoEscopo = z.infer<typeof MarketingPedidoEscopoSchema>;
export const MarketingContaReciboSchema = z.object({
  id: uuid, connectionId: uuid, handle: z.string().max(400), ownerId: id,
  operators: z.array(id).max(30), revision: z.number().int().positive(), active: z.boolean(),
}).strict();
export const MarketingPreparoReciboSchema = z.object({
  id: uuid, accountId: uuid, accountRevision: z.number().int().positive(), connectionId: uuid,
  handle: z.string().max(400), taskId: uuid, versionId: uuid, decisionId: uuid,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), scheduledAt: iso,
  timezone: z.string().min(1).max(80), state: z.literal('prepared'),
}).strict();
export const MarketingContaRecuperacaoSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('confirmado'), tipo: z.literal('configuracao_conta'), ...escopo,
    conta: MarketingContaReciboSchema,
    disponibilidadeAtual: z.object({ contaAtiva: z.boolean(), conexaoCorrespondente: z.boolean(),
      conexaoAptaPorRegistroLocal: z.boolean(), verificacaoExternaAgora: z.literal(false),
    }).strict(),
  }).strict(),
  z.object({ estado: z.literal('ausencia_conferida'), tipo: z.literal('configuracao_conta'), ...escopo }).strict(),
]);
export type MarketingContaRecuperacao = z.infer<typeof MarketingContaRecuperacaoSchema>;
export const MarketingPreparoRecuperacaoSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('confirmado'), tipo: z.literal('preparo'), ...escopo,
    preparo: MarketingPreparoReciboSchema,
    disponibilidadeAtual: z.object({ contaAtiva: z.boolean(), conexaoAptaPorRegistroLocal: z.boolean(),
      materialNaVersaoSelecionada: z.boolean(), decisaoPreservadaAprovada: z.boolean(),
      novaPreparacaoVerificada: z.literal(false), verificacaoExternaAgora: z.literal(false),
    }).strict(), publicationAvailable: z.literal(false), metricsAvailable: z.literal(false), externalEffect: z.literal(false),
  }).strict(),
  z.object({ estado: z.literal('ausencia_conferida'), tipo: z.literal('preparo'), ...escopo }).strict(),
]);
export type MarketingPreparoRecuperacao = z.infer<typeof MarketingPreparoRecuperacaoSchema>;
