import { z } from 'zod';
import { LeadSchema } from './schemas.js';

const SourceSchema = z.object({ tool: z.string(), generatedAt: z.string() });

// --- Funil ---
export const FunnelStageSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int(),
  convFromPrev: z.number().nullable(), // % em relação à etapa anterior
});
export type FunnelStage = z.infer<typeof FunnelStageSchema>;

export const FunnelMetricsSchema = z.object({
  stages: z.array(FunnelStageSchema),
  source: SourceSchema,
});
export type FunnelMetrics = z.infer<typeof FunnelMetricsSchema>;

// --- Campanhas ---
export const CampaignItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  objective: z.string().nullable(),
  channel: z.string().nullable(),
  status: z.string(),
  budget: z.number().nullable(),
  spend: z.number().nullable(),
  leads: z.number().int(),
  conversions: z.number().int(),
  cpl: z.number().nullable(),
});
export type CampaignItem = z.infer<typeof CampaignItemSchema>;

export const CampaignListSchema = z.object({
  items: z.array(CampaignItemSchema),
  source: SourceSchema,
});
export type CampaignList = z.infer<typeof CampaignListSchema>;

export const CampaignDossierSchema = z.object({
  campaign: CampaignItemSchema,
  metrics: z.object({
    leads: z.number().int(),
    conversions: z.number().int(),
    revenue: z.number().nullable(), // null = sem atribuição de valor ainda (Fase 2+)
    cpl: z.number().nullable(),
    cpa: z.number().nullable(),
  }),
  leads: z.array(LeadSchema),
  source: SourceSchema,
});
export type CampaignDossier = z.infer<typeof CampaignDossierSchema>;

// --- Tarefas ---
export const TaskItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string().nullable(),
  assignee: z.string().nullable(),
  dueDate: z.string().nullable(),
  tool: z.string(),
  overdue: z.boolean(),
});
export type TaskItem = z.infer<typeof TaskItemSchema>;

export const TaskListSchema = z.object({
  items: z.array(TaskItemSchema),
  total: z.number().int(),
  overdue: z.number().int(),
  source: SourceSchema,
});
export type TaskList = z.infer<typeof TaskListSchema>;
