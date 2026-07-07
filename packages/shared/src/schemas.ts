import { z } from 'zod';

// --- Auth ---
export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const SessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

// --- Leads ---
export const LEAD_STATUS = [
  'novo', 'qualificado', 'oportunidade', 'reuniao', 'proposta', 'ganho', 'perdido',
] as const;
export const LeadStatusSchema = z.enum(LEAD_STATUS);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const LeadSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  source: z.string().nullable(),
  campaign: z.string().nullable(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
  status: LeadStatusSchema,
  owner: z.string().nullable(),
  score: z.number().int().min(0).max(100).nullable(),
  enteredAt: z.string(), // ISO
});
export type Lead = z.infer<typeof LeadSchema>;

export const LeadListSchema = z.object({
  items: z.array(LeadSchema),
  total: z.number().int(),
  source: z.object({ tool: z.string(), generatedAt: z.string() }),
});
export type LeadList = z.infer<typeof LeadListSchema>;

// --- Dashboard ---
export const DashboardSummarySchema = z.object({
  leadsToday: z.number().int(),
  leadsWeek: z.number().int(),
  leadsMonth: z.number().int(),
  conversions: z.number().int(),
  sales: z.number().int(),
  revenue: z.number(),
  conversionRate: z.number(),
  cpl: z.number().nullable(),
  overdueTasks: z.number().int(),
  activeCampaigns: z.number().int(),
  campaignsAtRisk: z.number().int(),
  criticalAlerts: z.number().int(),
  source: z.object({ tool: z.string(), generatedAt: z.string() }),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

// --- Pixel / eventos (ingestão) ---
export const TrackEventSchema = z.object({
  event_name: z.string().min(1),
  event_id: z.string().min(1),
  session_id: z.string().min(1),
  anonymous_id: z.string().min(1),
  user_id: z.string().optional(),
  url: z.string().optional(),
  referrer: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_content: z.string().optional(),
  utm_term: z.string().optional(),
  device: z.string().optional(),
  value: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
  ts: z.number().optional(),
});
export type TrackEventInput = z.infer<typeof TrackEventSchema>;

// --- Pixel / eventos (painel — leitura autenticada) ---
export const SourceMetaSchema = z.object({ tool: z.string(), generatedAt: z.string() });

export const EventsSummarySchema = z.object({
  window: z.object({ since: z.string(), until: z.string(), days: z.number().int() }),
  totals: z.object({
    events: z.number().int(),
    sessions: z.number().int(),
    visitors: z.number().int(), // anonymousId distintos
    purchases: z.number().int(),
    revenue: z.number(),
  }),
  lastEventAt: z.string().nullable(),
  byEvent: z.array(z.object({ name: z.string(), count: z.number().int() })),
  bySource: z.array(z.object({ source: z.string(), count: z.number().int() })),
  topPages: z.array(z.object({ url: z.string(), count: z.number().int() })),
  daily: z.array(
    z.object({ date: z.string(), events: z.number().int(), sessions: z.number().int() }),
  ),
  source: SourceMetaSchema,
});
export type EventsSummary = z.infer<typeof EventsSummarySchema>;

export const EventRowSchema = z.object({
  id: z.string(),
  eventName: z.string(),
  url: z.string().nullable(),
  referrer: z.string().nullable(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
  device: z.string().nullable(),
  value: z.number().nullable(),
  sessionId: z.string(),
  anonymousId: z.string(),
  occurredAt: z.string(), // ISO
});
export type EventRow = z.infer<typeof EventRowSchema>;

export const EventsRecentSchema = z.object({
  items: z.array(EventRowSchema),
  total: z.number().int(),
  source: SourceMetaSchema,
});
export type EventsRecent = z.infer<typeof EventsRecentSchema>;

// --- Relatórios gerados por IA (resumo diário) ---
export const DailyReportSchema = z.object({
  id: z.string(),
  type: z.literal('daily'),
  title: z.string(),
  summary: z.string(), // markdown
  provider: z.string(), // openai | anthropic
  model: z.string(),
  periodStart: z.string(), // ISO
  periodEnd: z.string(),
  createdAt: z.string(),
});
export type DailyReport = z.infer<typeof DailyReportSchema>;

export const ReportListSchema = z.object({
  items: z.array(DailyReportSchema),
  total: z.number().int(),
  source: SourceMetaSchema,
});
export type ReportList = z.infer<typeof ReportListSchema>;

// --- Auditoria ---
export const ACTOR_TYPES = ['user', 'ai', 'system'] as const;
export const AuditLogRowSchema = z.object({
  id: z.string(),
  actorType: z.enum(ACTOR_TYPES),
  actorName: z.string().nullable(), // nome resolvido (ou o id, ou null)
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(), // ISO
});
export type AuditLogRow = z.infer<typeof AuditLogRowSchema>;

export const AuditListSchema = z.object({
  items: z.array(AuditLogRowSchema),
  total: z.number().int(),
  source: SourceMetaSchema,
});
export type AuditList = z.infer<typeof AuditListSchema>;

// --- Usuários & permissões ---
export const UserRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  roles: z.array(z.string()), // keys dos perfis
});
export type UserRow = z.infer<typeof UserRowSchema>;

export const UserListSchema = z.object({
  items: z.array(UserRowSchema),
  total: z.number().int(),
  source: SourceMetaSchema,
});
export type UserList = z.infer<typeof UserListSchema>;

export const RoleInfoSchema = z.object({
  key: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
  userCount: z.number().int(),
});
export type RoleInfo = z.infer<typeof RoleInfoSchema>;

export const RoleListSchema = z.object({
  items: z.array(RoleInfoSchema),
  source: SourceMetaSchema,
});
export type RoleList = z.infer<typeof RoleListSchema>;

export const CreateUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  roles: z.array(z.string()).min(1),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    isActive: z.boolean().optional(),
    roles: z.array(z.string()).min(1).optional(),
    password: z.string().min(8).optional(),
  })
  .refine((v) => v.isActive !== undefined || v.roles !== undefined || v.password !== undefined, {
    message: 'Nada para atualizar',
  });
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

// --- Configurações ---
export const INTEGRATION_STATUS = ['disconnected', 'connected', 'error'] as const;
export const HEALTH_STATUS = ['ok', 'degraded', 'down'] as const;

export const IntegrationRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(INTEGRATION_STATUS),
  health: z.enum(HEALTH_STATUS).nullable(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type IntegrationRow = z.infer<typeof IntegrationRowSchema>;

export const ConfigOverviewSchema = z.object({
  org: z.object({ name: z.string(), slug: z.string() }),
  appName: z.string(),
  counts: z.object({ users: z.number().int(), roles: z.number().int() }),
  integrations: z.array(IntegrationRowSchema),
  source: SourceMetaSchema,
});
export type ConfigOverview = z.infer<typeof ConfigOverviewSchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

// --- Ações (write) sobre entidades ---
export const TASK_STATUS = ['aberta', 'em_andamento', 'concluida', 'bloqueada'] as const;
export const TaskStatusSchema = z.enum(TASK_STATUS);
export type TaskStatusValue = z.infer<typeof TaskStatusSchema>;

export const CAMPAIGN_STATUS = [
  'planejada', 'ativa', 'pausada', 'analise', 'encerrada', 'problema',
] as const;
export const CampaignStatusSchema = z.enum(CAMPAIGN_STATUS);
export type CampaignStatusValue = z.infer<typeof CampaignStatusSchema>;

export const UpdateLeadSchema = z
  .object({
    status: LeadStatusSchema.optional(),
    nextAction: z.string().max(280).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.nextAction !== undefined, {
    message: 'Nada para atualizar',
  });
export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;

export const UpdateTaskSchema = z.object({ status: TaskStatusSchema });
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export const UpdateCampaignSchema = z.object({ status: CampaignStatusSchema });
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>;

// --- Integrações / conectores (arcabouço Fase 3–7) ---
export type ConnectorCategory =
  | 'ai' | 'messaging' | 'tasks' | 'social' | 'email' | 'storage' | 'knowledge' | 'automation';

export interface ConnectorInfo {
  key: string;
  label: string;
  category: ConnectorCategory;
  phase: number;
  authType: 'api_key' | 'oauth2' | 'webhook' | 'builtin';
  requires: string; // credencial/config necessária (para o painel deixar claro o que falta)
}

// Catálogo único dos conectores planejados. A ligação real de cada um entra na sua fase;
// os OAuth (Instagram/Gmail/Drive) dependem de credencial PRÓPRIA do root.
export const CONNECTORS: ConnectorInfo[] = [
  { key: 'openai', label: 'OpenAI (IA)', category: 'ai', phase: 2, authType: 'api_key', requires: 'OPENAI_API_KEY (~/.config/root)' },
  { key: 'telegram', label: 'Telegram', category: 'messaging', phase: 2, authType: 'api_key', requires: 'TELEGRAM_BOT_TOKEN (~/.config/root)' },
  { key: 'clickup', label: 'ClickUp', category: 'tasks', phase: 2, authType: 'api_key', requires: 'API token do ClickUp' },
  { key: 'asana', label: 'Asana', category: 'tasks', phase: 2, authType: 'oauth2', requires: 'OAuth/PAT do Asana' },
  { key: 'zapier', label: 'Zapier', category: 'automation', phase: 3, authType: 'webhook', requires: 'webhook (suspenso por ora)' },
  { key: 'apify', label: 'Apify', category: 'automation', phase: 3, authType: 'api_key', requires: 'API token (suspenso por ora)' },
  { key: 'instagram', label: 'Instagram', category: 'social', phase: 4, authType: 'oauth2', requires: 'App Meta + OAuth (Graph API)' },
  { key: 'gmail', label: 'Gmail', category: 'email', phase: 5, authType: 'oauth2', requires: 'OAuth Google (Gmail)' },
  { key: 'drive', label: 'Google Drive', category: 'storage', phase: 5, authType: 'oauth2', requires: 'OAuth Google (Drive)' },
  { key: 'obsidian', label: 'Obsidian', category: 'knowledge', phase: 5, authType: 'builtin', requires: 'pasta/sync do vault' },
  { key: 'whatsapp', label: 'WhatsApp (Zapfy)', category: 'messaging', phase: 6, authType: 'api_key', requires: 'canal próprio (app consolidado)' },
];

export const IntegrationCatalogRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  category: z.string(),
  phase: z.number().int(),
  authType: z.string(),
  requires: z.string(),
  status: z.enum(INTEGRATION_STATUS),
  health: z.enum(HEALTH_STATUS).nullable(),
  connectedAt: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  managed: z.boolean(), // true = dá p/ ligar/desligar manualmente (api_key/webhook/builtin)
});
export type IntegrationCatalogRow = z.infer<typeof IntegrationCatalogRowSchema>;

export const IntegrationCatalogSchema = z.object({
  items: z.array(IntegrationCatalogRowSchema),
  source: SourceMetaSchema,
});
export type IntegrationCatalog = z.infer<typeof IntegrationCatalogSchema>;

export const ToggleIntegrationSchema = z.object({
  status: z.enum(INTEGRATION_STATUS),
});
export type ToggleIntegrationInput = z.infer<typeof ToggleIntegrationSchema>;

// --- Conteúdo (pipeline do ClickUp) ---
export const ContentItemSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  listName: z.string().nullable(),
  title: z.string(),
  status: z.string(),
  statusType: z.string().nullable(),
  formato: z.string().nullable(),
  eixo: z.string().nullable(),
  tipo: z.string().nullable(),
  fonte: z.string().nullable(),
  assignee: z.string().nullable(),
  url: z.string().nullable(),
  dueDate: z.string().nullable(),
  updatedAt: z.string(),
});
export type ContentItem = z.infer<typeof ContentItemSchema>;

export const ContentListSchema = z.object({
  items: z.array(ContentItemSchema),
  total: z.number().int(),
  // ordem canônica das etapas (para o board) + facetas p/ filtro
  statuses: z.array(z.string()),
  eixos: z.array(z.string()),
  formatos: z.array(z.string()),
  source: SourceMetaSchema,
});
export type ContentList = z.infer<typeof ContentListSchema>;

export const UpdateContentSchema = z.object({ status: z.string().min(1) });
export type UpdateContentInput = z.infer<typeof UpdateContentSchema>;

export const ContentStatsSchema = z.object({
  total: z.number().int(),
  byStatus: z.array(z.object({ key: z.string(), count: z.number().int() })),
  byEixo: z.array(z.object({ key: z.string(), count: z.number().int() })),
  byFormato: z.array(z.object({ key: z.string(), count: z.number().int() })),
  source: SourceMetaSchema,
});
export type ContentStats = z.infer<typeof ContentStatsSchema>;
