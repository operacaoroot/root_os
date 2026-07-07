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
  | 'ai' | 'messaging' | 'tasks' | 'social' | 'email' | 'storage' | 'knowledge' | 'automation' | 'calendar' | 'finance';

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
  { key: 'gmail', label: 'Gmail', category: 'email', phase: 5, authType: 'oauth2', requires: 'Conectar conta Google (OAuth)' },
  { key: 'gcal', label: 'Google Agenda', category: 'calendar', phase: 5, authType: 'oauth2', requires: 'Conectar conta Google (OAuth)' },
  { key: 'gdocs', label: 'Google Docs', category: 'knowledge', phase: 5, authType: 'oauth2', requires: 'Conectar conta Google (OAuth)' },
  { key: 'drive', label: 'Google Drive', category: 'storage', phase: 5, authType: 'oauth2', requires: 'Conectar conta Google (OAuth)' },
  { key: 'obsidian', label: 'Obsidian', category: 'knowledge', phase: 5, authType: 'builtin', requires: 'pasta/sync do vault' },
  { key: 'whatsapp', label: 'WhatsApp (Zapfy)', category: 'messaging', phase: 6, authType: 'api_key', requires: 'canal próprio (app consolidado)' },
  { key: 'pluggy', label: 'Bancos (Open Finance/Pluggy)', category: 'finance', phase: 2, authType: 'api_key', requires: 'PLUGGY_CLIENT_ID/SECRET (~/.config/root/pluggy.env)' },
  { key: 'ofx', label: 'Extrato OFX (upload)', category: 'finance', phase: 2, authType: 'builtin', requires: 'arquivo .ofx exportado do banco' },
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

// --- Base de conhecimento (Obsidian) ---
export const NoteRowSchema = z.object({
  id: z.string(),
  path: z.string(),
  folder: z.string().nullable(),
  title: z.string(),
  tags: z.array(z.string()),
  links: z.array(z.string()),
  wordCount: z.number().int(),
  fileTime: z.string(), // ISO
});
export type NoteRow = z.infer<typeof NoteRowSchema>;

export const NoteDetailSchema = NoteRowSchema.extend({ content: z.string() });
export type NoteDetail = z.infer<typeof NoteDetailSchema>;

export const KnowledgeListSchema = z.object({
  items: z.array(NoteRowSchema),
  total: z.number().int(),
  folders: z.array(z.string()),
  indexedNotes: z.number().int(),
  source: SourceMetaSchema,
});
export type KnowledgeList = z.infer<typeof KnowledgeListSchema>;

export const SearchHitSchema = NoteRowSchema.extend({
  score: z.number(), // similaridade (0..1) na busca semântica; 0 no keyword
  snippet: z.string(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResultSchema = z.object({
  query: z.string(),
  mode: z.enum(['semantic', 'keyword']),
  items: z.array(SearchHitSchema),
  source: SourceMetaSchema,
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

// --- Financeiro (FinOps: contas, lançamentos, categorias, bancos) ---
export const FINANCE_ACCOUNT_TYPES = ['corrente', 'poupanca', 'caixa', 'cartao', 'investimento'] as const;
export const FinanceAccountTypeSchema = z.enum(FINANCE_ACCOUNT_TYPES);
export type FinanceAccountTypeValue = z.infer<typeof FinanceAccountTypeSchema>;

export const FINANCE_TX_TYPES = ['entrada', 'saida'] as const;
export const FinanceTxTypeSchema = z.enum(FINANCE_TX_TYPES);
export type FinanceTxTypeValue = z.infer<typeof FinanceTxTypeSchema>;

export const FINANCE_TX_STATUS = ['previsto', 'realizado', 'conciliado'] as const;
export const FinanceTxStatusSchema = z.enum(FINANCE_TX_STATUS);
export type FinanceTxStatusValue = z.infer<typeof FinanceTxStatusSchema>;

export const FINANCE_CATEGORY_KINDS = ['receita', 'despesa'] as const;
export const FinanceCategoryKindSchema = z.enum(FINANCE_CATEGORY_KINDS);
export type FinanceCategoryKindValue = z.infer<typeof FinanceCategoryKindSchema>;

export const BANK_CONNECTION_STATUS = ['pending', 'connected', 'error', 'disconnected'] as const;
export const BankConnectionStatusSchema = z.enum(BANK_CONNECTION_STATUS);

// Conta financeira (com saldo derivado dos lançamentos realizados)
export const FinanceAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: FinanceAccountTypeSchema,
  institution: z.string().nullable(),
  currency: z.string(),
  provider: z.string(),
  isActive: z.boolean(),
  openingBalance: z.number(),
  balance: z.number(), // openingBalance + entradas − saídas realizadas
  createdAt: z.string(),
});
export type FinanceAccount = z.infer<typeof FinanceAccountSchema>;

export const FinanceAccountListSchema = z.object({
  items: z.array(FinanceAccountSchema),
  total: z.number().int(),
  source: SourceMetaSchema,
});
export type FinanceAccountList = z.infer<typeof FinanceAccountListSchema>;

export const FinanceCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: FinanceCategoryKindSchema,
  color: z.string().nullable(),
});
export type FinanceCategory = z.infer<typeof FinanceCategorySchema>;

export const FinanceCategoryListSchema = z.object({
  items: z.array(FinanceCategorySchema),
  total: z.number().int(),
  source: SourceMetaSchema,
});
export type FinanceCategoryList = z.infer<typeof FinanceCategoryListSchema>;

export const FinanceTransactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  accountName: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  type: FinanceTxTypeSchema,
  status: FinanceTxStatusSchema,
  description: z.string(),
  amount: z.number(),
  date: z.string(), // ISO
  dueDate: z.string().nullable(),
  paidAt: z.string().nullable(),
  counterparty: z.string().nullable(),
  documentNumber: z.string().nullable(),
  source: z.string(),
  createdAt: z.string(),
});
export type FinanceTransaction = z.infer<typeof FinanceTransactionSchema>;

export const FinanceTransactionListSchema = z.object({
  items: z.array(FinanceTransactionSchema),
  total: z.number().int(),
  totals: z.object({ entradas: z.number(), saidas: z.number(), saldo: z.number() }),
  source: SourceMetaSchema,
});
export type FinanceTransactionList = z.infer<typeof FinanceTransactionListSchema>;

// Resumo do módulo (cards do dashboard financeiro)
export const FinanceSummarySchema = z.object({
  saldoTotal: z.number(),
  contas: z.number().int(),
  mes: z.object({ entradas: z.number(), saidas: z.number(), resultado: z.number() }),
  aReceber: z.number(),
  aPagar: z.number(),
  aReceberVencido: z.number(),
  aPagarVencido: z.number(),
  byAccount: z.array(z.object({ id: z.string(), name: z.string(), balance: z.number() })),
  topCategorias: z.array(z.object({ name: z.string(), kind: z.string(), total: z.number() })),
  bancos: z.object({ conexoes: z.number().int(), conectados: z.number().int(), pluggyConfigurado: z.boolean() }),
  source: SourceMetaSchema,
});
export type FinanceSummary = z.infer<typeof FinanceSummarySchema>;

// Fluxo de caixa projetado (dia a dia, incluindo previstos)
export const CashflowSchema = z.object({
  window: z.object({ from: z.string(), to: z.string() }),
  openingBalance: z.number(),
  days: z.array(
    z.object({
      date: z.string(),
      entradas: z.number(),
      saidas: z.number(),
      resultado: z.number(),
      acumulado: z.number(),
    }),
  ),
  source: SourceMetaSchema,
});
export type Cashflow = z.infer<typeof CashflowSchema>;

export const BankConnectionSchema = z.object({
  id: z.string(),
  provider: z.string(),
  institutionName: z.string().nullable(),
  status: BankConnectionStatusSchema,
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  accounts: z.number().int(),
  createdAt: z.string(),
});
export type BankConnection = z.infer<typeof BankConnectionSchema>;

export const BankConnectionListSchema = z.object({
  items: z.array(BankConnectionSchema),
  total: z.number().int(),
  pluggyConfigurado: z.boolean(),
  source: SourceMetaSchema,
});
export type BankConnectionList = z.infer<typeof BankConnectionListSchema>;

// --- Financeiro: entradas de escrita (write) ---
export const CreateFinanceAccountSchema = z.object({
  name: z.string().min(2).max(120),
  type: FinanceAccountTypeSchema.default('corrente'),
  institution: z.string().max(120).nullable().optional(),
  openingBalance: z.number().optional(),
});
export type CreateFinanceAccountInput = z.infer<typeof CreateFinanceAccountSchema>;

export const CreateFinanceCategorySchema = z.object({
  name: z.string().min(2).max(80),
  kind: FinanceCategoryKindSchema,
  color: z.string().max(20).nullable().optional(),
});
export type CreateFinanceCategoryInput = z.infer<typeof CreateFinanceCategorySchema>;

export const CreateFinanceTransactionSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().nullable().optional(),
  type: FinanceTxTypeSchema,
  status: FinanceTxStatusSchema.default('realizado'),
  description: z.string().min(1).max(280),
  amount: z.number().positive(),
  date: z.string().min(1), // ISO ou yyyy-mm-dd
  dueDate: z.string().nullable().optional(),
  counterparty: z.string().max(160).nullable().optional(),
  documentNumber: z.string().max(80).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type CreateFinanceTransactionInput = z.infer<typeof CreateFinanceTransactionSchema>;

export const UpdateFinanceTransactionSchema = z
  .object({
    status: FinanceTxStatusSchema.optional(),
    categoryId: z.string().nullable().optional(),
    description: z.string().min(1).max(280).optional(),
    amount: z.number().positive().optional(),
    date: z.string().optional(),
    dueDate: z.string().nullable().optional(),
    paidAt: z.string().nullable().optional(),
    counterparty: z.string().max(160).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nada para atualizar' });
export type UpdateFinanceTransactionInput = z.infer<typeof UpdateFinanceTransactionSchema>;

export const OfxImportResultSchema = z.object({
  imported: z.number().int(),
  skipped: z.number().int(),
  accountId: z.string(),
  source: SourceMetaSchema,
});
export type OfxImportResult = z.infer<typeof OfxImportResultSchema>;

export const ImportOfxSchema = z.object({
  accountId: z.string().min(1),
  content: z.string().min(10), // conteúdo do arquivo .ofx
});
export type ImportOfxInput = z.infer<typeof ImportOfxSchema>;

export const RegisterPluggyItemSchema = z.object({ itemId: z.string().min(1) });
export type RegisterPluggyItemInput = z.infer<typeof RegisterPluggyItemSchema>;

export const PluggyConnectTokenSchema = z.object({ itemId: z.string().optional() });
export type PluggyConnectTokenInput = z.infer<typeof PluggyConnectTokenSchema>;
