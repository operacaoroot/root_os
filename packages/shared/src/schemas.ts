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
  { key: 'asaas', label: 'Asaas (cobranças + conta digital)', category: 'finance', phase: 2, authType: 'api_key', requires: 'ASAAS_API_KEY (~/.config/root/asaas.env)' },
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
  chartAccountId: z.string().nullable(),
  chartCodigo: z.string().nullable(), // código do plano de contas (ex.: 3.1.01)
  partnerId: z.string().nullable(),
  partnerName: z.string().nullable(),
  approvalStatus: z.string(), // nao_requer | aguardando | aprovado | rejeitado
  temRateio: z.boolean(),
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
  bancos: z.object({ conexoes: z.number().int(), conectados: z.number().int(), pluggyConfigurado: z.boolean(), asaasConfigurado: z.boolean() }),
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
  asaasConfigurado: z.boolean(),
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

export const RateioSplitInputSchema = z.object({
  chartAccountId: z.string().nullable().optional(),
  departamentoId: z.string().nullable().optional(),
  projetoId: z.string().nullable().optional(),
  valor: z.number().positive(),
});
export type RateioSplitInput = z.infer<typeof RateioSplitInputSchema>;

export const CreateFinanceTransactionSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().nullable().optional(),
  chartAccountId: z.string().nullable().optional(),
  partnerId: z.string().nullable().optional(),
  contractId: z.string().nullable().optional(),
  departamentoId: z.string().nullable().optional(),
  projetoId: z.string().nullable().optional(),
  splits: z.array(RateioSplitInputSchema).optional(), // rateio (soma = amount)
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

// --- FinOps: Plano de Contas (chart of accounts) ---
export const ChartAccountSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  codigo: z.string(),
  nome: z.string(),
  tipo: z.string(), // receita | despesa
  nivel: z.number().int(),
  permiteLancamento: z.boolean(),
  dreLineId: z.string().nullable(),
  dreCodigo: z.string().nullable(),
  ativo: z.boolean(),
});
export type ChartAccount = z.infer<typeof ChartAccountSchema>;

export const ChartAccountListSchema = z.object({
  items: z.array(ChartAccountSchema),
  total: z.number().int(),
  source: SourceMetaSchema,
});
export type ChartAccountList = z.infer<typeof ChartAccountListSchema>;

export const CreateChartAccountSchema = z.object({
  codigo: z.string().min(1).max(20),
  nome: z.string().min(2).max(120),
  tipo: z.enum(['receita', 'despesa']),
  nivel: z.number().int().min(1).max(3),
  parentId: z.string().nullable().optional(),
  permiteLancamento: z.boolean().optional(),
  dreCodigo: z.string().nullable().optional(),
});
export type CreateChartAccountInput = z.infer<typeof CreateChartAccountSchema>;

// --- FinOps: DRE (Demonstrativo de Resultado — "Motor Vortex") ---
export const DreLineResultSchema = z.object({
  codigo: z.string(),
  nome: z.string(),
  operador: z.string(),
  tipo: z.string(), // origem | grupo | calculado | indicador
  ordem: z.number().int(),
  visivel: z.boolean(),
  valor: z.number(),
  isPercent: z.boolean(),
});
export type DreLineResult = z.infer<typeof DreLineResultSchema>;

export const DreSchema = z.object({
  period: z.object({ from: z.string(), to: z.string(), label: z.string() }),
  lines: z.array(DreLineResultSchema),
  source: SourceMetaSchema,
});
export type Dre = z.infer<typeof DreSchema>;

// --- FinOps AP/AR: fornecedores/clientes, dimensões, contratos, aprovação ---
export const APPROVAL_STATUS = ['nao_requer', 'aguardando', 'aprovado', 'rejeitado'] as const;
export const CONTRACT_STATUS = ['ativo', 'pausado', 'encerrado'] as const;
export const PERIODICIDADES = ['mensal', 'bimestral', 'trimestral', 'semestral', 'anual'] as const;

export const PartnerSchema = z.object({
  id: z.string(),
  isCliente: z.boolean(),
  isFornecedor: z.boolean(),
  razaoSocial: z.string(),
  nomeFantasia: z.string().nullable(),
  cnpjCpf: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  ativo: z.boolean(),
});
export type Partner = z.infer<typeof PartnerSchema>;

export const PartnerListSchema = z.object({
  items: z.array(PartnerSchema),
  total: z.number().int(),
  source: SourceMetaSchema,
});
export type PartnerList = z.infer<typeof PartnerListSchema>;

export const CreatePartnerSchema = z.object({
  razaoSocial: z.string().min(2).max(160),
  nomeFantasia: z.string().max(160).nullable().optional(),
  cnpjCpf: z.string().max(20).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  isCliente: z.boolean().optional(),
  isFornecedor: z.boolean().optional(),
});
export type CreatePartnerInput = z.infer<typeof CreatePartnerSchema>;

export const DimensionSchema = z.object({ id: z.string(), nome: z.string(), ativo: z.boolean() });
export type Dimension = z.infer<typeof DimensionSchema>;
export const DimensionListSchema = z.object({
  items: z.array(DimensionSchema),
  total: z.number().int(),
  source: SourceMetaSchema,
});
export type DimensionList = z.infer<typeof DimensionListSchema>;
export const CreateDimensionSchema = z.object({ nome: z.string().min(1).max(80) });
export type CreateDimensionInput = z.infer<typeof CreateDimensionSchema>;

export const ContractSchema = z.object({
  id: z.string(),
  tipo: FinanceTxTypeSchema,
  partnerId: z.string().nullable(),
  partnerName: z.string().nullable(),
  descricao: z.string(),
  valor: z.number(),
  diaVencimento: z.number().int(),
  periodicidade: z.string(),
  chartAccountId: z.string().nullable(),
  accountId: z.string().nullable(),
  dataInicio: z.string(),
  dataFim: z.string().nullable(),
  proximoVencimento: z.string(),
  status: z.enum(CONTRACT_STATUS),
});
export type Contract = z.infer<typeof ContractSchema>;

export const ContractListSchema = z.object({
  items: z.array(ContractSchema),
  total: z.number().int(),
  source: SourceMetaSchema,
});
export type ContractList = z.infer<typeof ContractListSchema>;

export const CreateContractSchema = z.object({
  tipo: FinanceTxTypeSchema,
  partnerId: z.string().nullable().optional(),
  descricao: z.string().min(1).max(200),
  valor: z.number().positive(),
  diaVencimento: z.number().int().min(1).max(31),
  periodicidade: z.enum(PERIODICIDADES).default('mensal'),
  chartAccountId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  dataInicio: z.string().min(1),
  dataFim: z.string().nullable().optional(),
});
export type CreateContractInput = z.infer<typeof CreateContractSchema>;

// Item de conta a pagar/receber (lançamento previsto, com vencido/dias)
export const PayableRowSchema = z.object({
  id: z.string(),
  tipo: FinanceTxTypeSchema, // saida = pagar | entrada = receber
  description: z.string(),
  partnerName: z.string().nullable(),
  chartCodigo: z.string().nullable(),
  amount: z.number(),
  dueDate: z.string().nullable(),
  status: FinanceTxStatusSchema,
  approvalStatus: z.string(),
  vencido: z.boolean(),
  diasAtraso: z.number().int(),
});
export type PayableRow = z.infer<typeof PayableRowSchema>;

export const PayablesSchema = z.object({
  items: z.array(PayableRowSchema),
  total: z.number().int(),
  totals: z.object({ aPagar: z.number(), aReceber: z.number(), vencidoPagar: z.number(), vencidoReceber: z.number(), aguardandoAprovacao: z.number().int() }),
  approvalLimit: z.number(),
  source: SourceMetaSchema,
});
export type Payables = z.infer<typeof PayablesSchema>;

export const ApproveSchema = z.object({ aprovar: z.boolean() });
export type ApproveInput = z.infer<typeof ApproveSchema>;

// --- FinOps: Conciliação bancária (score) ---
export const ConciliacaoMovimentoSchema = z.object({
  id: z.string(),
  date: z.string(),
  type: FinanceTxTypeSchema,
  amount: z.number(),
  description: z.string(),
  sugestaoTituloId: z.string().nullable(),
  sugestaoDescricao: z.string().nullable(),
  sugestaoScore: z.number(),
  sugestaoAuto: z.boolean(),
});
export type ConciliacaoMovimento = z.infer<typeof ConciliacaoMovimentoSchema>;

export const ConciliacaoTituloSchema = z.object({
  id: z.string(),
  type: FinanceTxTypeSchema,
  amount: z.number(),
  dueDate: z.string().nullable(),
  description: z.string(),
  partnerName: z.string().nullable(),
});
export type ConciliacaoTitulo = z.infer<typeof ConciliacaoTituloSchema>;

export const ConciliacaoSchema = z.object({
  movimentos: z.array(ConciliacaoMovimentoSchema),
  titulos: z.array(ConciliacaoTituloSchema),
  stats: z.object({ movimentosAbertos: z.number().int(), titulosAbertos: z.number().int() }),
  source: SourceMetaSchema,
});
export type Conciliacao = z.infer<typeof ConciliacaoSchema>;

export const AutoConciliarResultSchema = z.object({
  conciliados: z.number().int(),
  sugestoes: z.number().int(),
  source: SourceMetaSchema,
});
export type AutoConciliarResult = z.infer<typeof AutoConciliarResultSchema>;

export const MatchConciliacaoSchema = z.object({
  movimentoId: z.string().min(1),
  tituloId: z.string().min(1),
});
export type MatchConciliacaoInput = z.infer<typeof MatchConciliacaoSchema>;

// --- FinOps: KPIs (painel de indicadores) ---
export const KpisSchema = z.object({
  mes: z.string(),
  dre: z.object({ fb: z.number(), fl: z.number(), mc: z.number(), ebitda: z.number(), ll: z.number() }),
  margens: z.object({ bruta: z.number(), ebitda: z.number(), liquida: z.number() }),
  inadimplencia: z.number(), // % do a receber que está vencido
  aReceberVencido: z.number(),
  acuracidade: z.number(), // % de movimentos bancários conciliados (índice de acurácia)
  bankTotal: z.number().int(),
  bankConciliado: z.number().int(),
  source: SourceMetaSchema,
});
export type Kpis = z.infer<typeof KpisSchema>;

// --- Google: escrita com aprovação (enviar email, criar evento, criar/editar doc) ---
export const SendEmailSchema = z.object({
  to: z.string().min(3).max(400),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20000),
  cc: z.string().max(400).optional(),
});
export type SendEmailInput = z.infer<typeof SendEmailSchema>;

export const CreateEventSchema = z.object({
  title: z.string().min(1).max(300),
  start: z.string().min(1), // ISO datetime
  end: z.string().min(1),
  description: z.string().max(5000).optional(),
  location: z.string().max(300).optional(),
  attendees: z.array(z.string().email()).max(50).optional(),
});
export type CreateEventInput = z.infer<typeof CreateEventSchema>;

export const CreateDocSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().max(50000).optional(),
});
export type CreateDocInput = z.infer<typeof CreateDocSchema>;

export const AppendDocSchema = z.object({ text: z.string().min(1).max(50000) });
export type AppendDocInput = z.infer<typeof AppendDocSchema>;

// ============================================================================
// METAS DO PROJETO — sistema de métricas do LucasCreator (ver SISTEMA.md)
// Desafio 365 dias: 1.000 posts · 20M views · 1.000 vendas (produto perpétuo R$300).
// Três camadas: MARCOS (destinos), INPUTS (o que se controla), TAXAS (eficiência).
// ============================================================================

export const GOAL_MARCOS = {
  posts: 1000,
  views: 20_000_000,
  lista: 30_000, // lista própria (e-mail/WhatsApp) — motor real da venda
  vendas: 1000,
  dias: 365,
  produtoPreco: 300,
} as const;

// Inputs (controle total do criador) — julgados toda semana, em qualquer fase.
export const GOAL_INPUTS = {
  postsPorSemana: 35, // 5/dia → fecha 1.000 no dia ~200
  recalibragemAbaixoDe: 25, // 2 semanas seguidas <25 obrigam recalibrar o ritmo
} as const;

// Escada de views: meta de média/post por FAIXA de posts (não por mês do calendário).
export const GOAL_ESCADA = [
  { de: 1, ate: 250, metaMediaPost: 2_000, viewsFaixa: 500_000 },
  { de: 251, ate: 500, metaMediaPost: 10_000, viewsFaixa: 2_500_000 },
  { de: 501, ate: 750, metaMediaPost: 24_000, viewsFaixa: 6_000_000 },
  { de: 751, ate: 1000, metaMediaPost: 44_000, viewsFaixa: 11_000_000 },
] as const;

// Fases de leitura (transição por SINAL, não por calendário).
// Fase 0 (aquecimento): só inputs julgados. Sai quando média 1.000+ views nos últimos
//   ~20 posts E ≥50% das views de não-seguidores → "conta quente".
// Fase 1 (baseline): 4 semanas após o gatilho; taxas visíveis, farol OFF.
// Fase 2 (regime): farol + projeções ligados.
export const GOAL_FASE = {
  gatilhoMediaViews: 1000,
  gatilhoNaoSeguidoresPct: 50,
  baselineSemanas: 4,
} as const;

// Cenários de projeção de vendas (vendas por milhão de views).
export const GOAL_CENARIOS = { pessimista: 50, mediano: 110 } as const;

// As 11 taxas do funil (cada elo da jornada). unidade: como o número é lido.
// fonteMeta: se o dado vem/pode vir do Instagram (Meta). ativa: trafego/captura só
// ligam quando o canal existir (produto no link / canal de captura definido).
export interface GoalTaxaDef {
  id: string;
  label: string;
  descricao: string;
  formula: string;
  piso: number;
  meta: number;
  unidade: '/1000' | '%' | 'escada';
  fonteMeta: boolean;
  ativa: boolean;
}

export const GOAL_TAXAS: GoalTaxaDef[] = [
  { id: 'distribuicao', label: 'Distribuição', descricao: 'Compartilhamentos por 1.000 views — o sinal que mais amplia alcance (leva pra fora da rede).', formula: 'shares ÷ views × 1000', piso: 3, meta: 5, unidade: '/1000', fonteMeta: false, ativa: true },
  { id: 'interesse', label: 'Interesse', descricao: 'Salvamentos por 1.000 views — densidade do conteúdo (público analítico salva pra consultar).', formula: 'saves ÷ views × 1000', piso: 5, meta: 8, unidade: '/1000', fonteMeta: true, ativa: true },
  { id: 'conversa', label: 'Conversa (ManyChat)', descricao: 'Comentários por 1.000 views — elo de venda: a automação responde e conduz pra lista.', formula: 'comments ÷ views × 1000', piso: 3, meta: 8, unidade: '/1000', fonteMeta: true, ativa: true },
  { id: 'curiosidade', label: 'Curiosidade', descricao: 'Visitas ao perfil por 1.000 views — quem viu quis conhecer quem fez.', formula: 'profile_visits ÷ views × 1000', piso: 8, meta: 10, unidade: '/1000', fonteMeta: true, ativa: true },
  { id: 'conversao_perfil', label: 'Conversão do perfil', descricao: '% de visitas que viram seguidor — testa a bio/destaques/grade (a "porta").', formula: 'novos_seguidores ÷ profile_visits × 100', piso: 5, meta: 10, unidade: '%', fonteMeta: true, ativa: true },
  { id: 'crescimento', label: 'Crescimento', descricao: 'Seguidores novos por 1.000 views — taxa-síntese (Curiosidade × Conversão do perfil).', formula: 'novos_seguidores ÷ views × 1000', piso: 1, meta: 1.5, unidade: '/1000', fonteMeta: true, ativa: true },
  { id: 'descoberta', label: 'Descoberta', descricao: '% de views de não-seguidores — termômetro de furar a bolha (compõe o gatilho da fase).', formula: '% views de não-seguidores', piso: 60, meta: 70, unidade: '%', fonteMeta: true, ativa: true },
  { id: 'alcance', label: 'Alcance', descricao: 'Média de views por post vs a faixa da escada — o caminho aritmético dos 20M.', formula: 'views ÷ posts (vs escada)', piso: 0, meta: 0, unidade: 'escada', fonteMeta: true, ativa: true },
  { id: 'vinculo', label: 'Vínculo', descricao: '% da base que vê stories — mede tribo (o "diário da expedição").', formula: 'story_viewers ÷ seguidores × 100', piso: 10, meta: 15, unidade: '%', fonteMeta: false, ativa: true },
  // Ativa desde que o módulo Link na bio passou a alimentar bioClicks sozinho.
  { id: 'trafego_venda', label: 'Tráfego de venda', descricao: 'Cliques no link da bio por 1.000 views — rota passiva da venda perpétua.', formula: 'cliques_bio ÷ views × 1000', piso: 3, meta: 5, unidade: '/1000', fonteMeta: false, ativa: true },
  { id: 'captura', label: 'Captura', descricao: 'Entradas na lista por 1.000 views — transforma view em patrimônio; carrega a meta de vendas.', formula: 'entradas_lista ÷ views × 1000', piso: 2, meta: 4, unidade: '/1000', fonteMeta: false, ativa: false },
];

// Entrada semanal (14 números crus — registrar SEMPRE o bruto e calcular a taxa depois).
export const GoalWeekSchema = z.object({
  weekNumber: z.number().int().min(1).max(60),
  startDate: z.string().optional(), // ISO (início da semana)
  posts: z.number().int().min(0).default(0),
  views: z.number().int().min(0).default(0),
  shares: z.number().int().min(0).default(0),
  saves: z.number().int().min(0).default(0),
  comments: z.number().int().min(0).default(0),
  profileVisits: z.number().int().min(0).default(0),
  newFollowers: z.number().int().min(0).default(0),
  totalFollowers: z.number().int().min(0).default(0),
  nonFollowerPct: z.number().min(0).max(100).default(0),
  storyViewers: z.number().int().min(0).default(0),
  storyReplies: z.number().int().min(0).default(0),
  listEntries: z.number().int().min(0).default(0),
  bioClicks: z.number().int().min(0).default(0),
  lives: z.number().int().min(0).default(0),
  storyDays: z.number().int().min(0).max(7).default(0),
});
export type GoalWeekInput = z.infer<typeof GoalWeekSchema>;

// Tipos do painel (retorno de GET /goals/panel).
export type Farol = 'verde' | 'amarelo' | 'vermelho' | 'off' | 'na';
export interface GoalMarco { key: string; label: string; atual: number; meta: number; pct: number; hint?: string }
export interface GoalTaxaLive {
  id: string; label: string; descricao: string; formula: string;
  valor: number | null; piso: number; meta: number; unidade: string;
  absoluto: number; farol: Farol; ativa: boolean; refEscada?: number;
}
export interface GoalWeekPoint { weekNumber: number; posts: number; viewsPerPost: number; status: 'meta' | 'abaixo' | 'recalibrar' }
export interface GoalPanel {
  fase: 0 | 1 | 2;
  faseLabel: string;
  farolLigado: boolean;
  diaDesafio: number;
  semanasRegistradas: number;
  marcos: GoalMarco[];
  inputs: { postsUltimaSemana: number; metaPostsSemana: number; okUltimaSemana: boolean };
  taxas: GoalTaxaLive[];
  escada: { faixaDe: number; faixaAte: number; metaMediaPost: number; mediaAtual: number };
  projecoes: { viewsDia365: number; pctMetaViews: number; diaPost1000: number | null; vendasMin: number; vendasMax: number };
  semanas: GoalWeekPoint[];
  janela: { semanas: number };
  source: { tool: string; generatedAt: string };
}

// ---------- Bio (link na bio) ----------
// Handle é o caminho público (bio.operacaoroot.com/@handle): minúsculo, sem espaço.
export const BIO_HANDLE_RE = /^[a-z0-9._-]{2,30}$/;

export const BioPageSchema = z.object({
  id: z.string().uuid().optional(),
  handle: z.string().regex(BIO_HANDLE_RE, 'handle: 2-30 caracteres, a-z 0-9 . _ -'),
  titulo: z.string().min(1).max(80),
  subtitulo: z.string().max(200).optional().nullable(),
  // 2048: URL de CDN (Instagram, Cloudinary) vem assinada e passa de 500 fácil.
  // A coluna no Postgres é TEXT, então o limite aqui é o único que barra.
  avatarUrl: z.string().url().max(2048).optional().nullable(),
});
export type BioPageInput = z.infer<typeof BioPageSchema>;

export const BIO_LINK_TIPOS = ['url', 'whatsapp', 'email'] as const;
export type BioLinkTipo = (typeof BIO_LINK_TIPOS)[number];

export const BioLinkSchema = z.object({
  tipo: z.enum(BIO_LINK_TIPOS).default('url'),
  rotulo: z.string().min(1).max(80),
  // url: https://... | whatsapp: só dígitos (DDI+DDD+número) | email: endereço
  destino: z.string().min(1).max(500),
  icone: z.string().max(40).optional().nullable(),
  destaque: z.boolean().default(false),
  ativo: z.boolean().default(true),
});
export type BioLinkInput = z.infer<typeof BioLinkSchema>;

export const BioLinkUpdateSchema = BioLinkSchema.partial();
export type BioLinkUpdateInput = z.infer<typeof BioLinkUpdateSchema>;

export const BioLinkMoveSchema = z.object({ direcao: z.enum(['cima', 'baixo']) });

export const BIO_PLATAFORMAS = ['instagram', 'tiktok'] as const;
export type BioPlataforma = (typeof BIO_PLATAFORMAS)[number];

export const BioChallengeSchema = z.object({
  id: z.string().uuid().optional(),
  pageId: z.string().uuid(),
  titulo: z.string().min(1).max(120),
  inicio: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  fim: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  metaPosts: z.number().int().min(1).max(100000),
  exibir: z.boolean().default(true),
});
export type BioChallengeInput = z.infer<typeof BioChallengeSchema>;

export const BioChallengeAccountSchema = z.object({
  challengeId: z.string().uuid(),
  plataforma: z.enum(BIO_PLATAFORMAS),
  handle: z.string().min(1).max(60),
  modo: z.enum(['conectado', 'descoberta', 'manual']).default('manual'),
  conexaoId: z.string().uuid().optional().nullable(),
  baselineCount: z.number().int().min(0).default(0),
});
export type BioChallengeAccountInput = z.infer<typeof BioChallengeAccountSchema>;

export const BioManualCountSchema = z.object({
  contagem: z.number().int().min(0).max(1000000),
});

export const BioCredencialSchema = z.object({
  appId: z.string().min(1).max(200),
  segredo: z.string().min(1).max(500),
  global: z.boolean().default(true),
});
export type BioCredencialInput = z.infer<typeof BioCredencialSchema>;

// Ingestão do pageview vindo do RSC da página pública (server-to-server).
export const BioTrackSchema = z.object({
  handle: z.string().regex(BIO_HANDLE_RE),
  rid: z.string().min(8).max(64),
  url: z.string().max(1000).optional(),
  referrer: z.string().max(1000).optional().nullable(),
  userAgent: z.string().max(500).optional().nullable(),
  params: z.record(z.string().max(300)).optional(),
});
export type BioTrackInput = z.infer<typeof BioTrackSchema>;

// Payload público da página (o que o RSC renderiza).
export interface BioPublicLink {
  id: string;
  tipo: BioLinkTipo;
  rotulo: string;
  icone: string | null;
  destaque: boolean;
}

export interface BioPublicDesafio {
  titulo: string;
  feitos: number;
  meta: number;
  diaAtual: number;
  totalDias: number;
  pctFeito: number;
  pctTempo: number;
  ritmoNecessario: number;
  saldo: number; // adiantado (+) / atrasado (−) vs ritmo linear
}

export interface BioPublicPage {
  handle: string;
  titulo: string;
  subtitulo: string | null;
  avatarUrl: string | null;
  links: BioPublicLink[];
  desafio: BioPublicDesafio | null;
}

// ---------- Pauta (acervo de referência) ----------
// Ver docs/PAUTA.md. A taxonomia vem do estudo do vault Cerebro-Conteudo
// ("9 - Engenharia Reversa das Referências"): 8 famílias × 7 objetivos, das quais
// 4 famílias são as campeãs do estudo _ESTRUTURAS-CAMPEAS.md.

export const PAUTA_FAMILIAS = ['CUR', 'REA', 'STO', 'DEM', 'CON', 'INT', 'TRE', 'ENC', 'outra'] as const;
export type PautaFamilia = (typeof PAUTA_FAMILIAS)[number];

export const PAUTA_FAMILIA_LABEL: Record<PautaFamilia, string> = {
  CUR: 'Curiosidade / Revelação',
  REA: 'React / Análise de terceiro',
  STO: 'Storytelling pessoal',
  DEM: 'Demonstração prática',
  CON: 'Contraste / Comparação',
  INT: 'Interação com a audiência',
  TRE: 'Trend / Meme',
  ENC: 'Encenação / Esquete',
  outra: 'Outra',
};

// As 4 que o estudo elegeu (_ESTRUTURAS-CAMPEAS.md): 83,3% do que é ensinado nos
// bunkers maduros. As outras existem no acervo, mas não entram no prompt de geração.
export const PAUTA_FAMILIAS_CAMPEAS: PautaFamilia[] = ['CUR', 'REA', 'STO', 'DEM'];

export const PAUTA_OBJETIVOS = ['ALC', 'AUT', 'VIN', 'VEN', 'ENG', 'PRO', 'LEA'] as const;
export type PautaObjetivo = (typeof PAUTA_OBJETIVOS)[number];

export const PAUTA_OBJETIVO_LABEL: Record<PautaObjetivo, string> = {
  ALC: 'Alcance',
  AUT: 'Autoridade',
  VIN: 'Vínculo',
  VEN: 'Venda',
  ENG: 'Engajamento',
  PRO: 'Prova social',
  LEA: 'Leads',
};

export const PAUTA_CAPTURA_TIPOS = ['link', 'print', 'texto'] as const;
export type PautaCapturaTipo = (typeof PAUTA_CAPTURA_TIPOS)[number];

export const PAUTA_CAPTURA_STATUS = ['rascunho', 'processando', 'ficha', 'descartada', 'erro'] as const;
export type PautaCapturaStatus = (typeof PAUTA_CAPTURA_STATUS)[number];

export const PAUTA_FONTE_TIPOS = ['rss', 'perfil', 'busca', 'manual'] as const;
export type PautaFonteTipo = (typeof PAUTA_FONTE_TIPOS)[number];

// --- Entradas (write) ---

// Captura aceita link OU texto colado; o print sobe pelo endpoint de upload.
export const PautaCapturaSchema = z
  .object({
    tipo: z.enum(PAUTA_CAPTURA_TIPOS).default('link'),
    url: z.string().url().max(2048).optional().nullable(),
    titulo: z.string().max(300).optional().nullable(),
    nota: z.string().max(2000).optional().nullable(),
    texto: z.string().max(20000).optional().nullable(),
    fonteId: z.string().uuid().optional().nullable(),
  })
  .refine((v) => (v.tipo === 'link' ? !!v.url : true), {
    message: 'captura do tipo link exige url',
    path: ['url'],
  })
  .refine((v) => (v.tipo === 'texto' ? !!v.texto : true), {
    message: 'captura do tipo texto exige o texto',
    path: ['texto'],
  });
export type PautaCapturaInput = z.infer<typeof PautaCapturaSchema>;

// Os 14 campos da ficha. Só os 7 primeiros são obrigatórios — o resto o método
// admite "não consta" (ver as fichas do vault).
export const PautaReferenciaSchema = z.object({
  titulo: z.string().min(1).max(300),
  plataforma: z.string().max(40).optional().nullable(),
  autor: z.string().max(120).optional().nullable(),
  url: z.string().url().max(2048).optional().nullable(),
  publicadoEm: z.string().datetime().optional().nullable(),
  familia: z.enum(PAUTA_FAMILIAS),
  objetivo: z.enum(PAUTA_OBJETIVOS),
  materiaPrima: z.string().min(1).max(4000),
  tensaoCentral: z.string().min(1).max(4000),
  emocaoAlvo: z.string().min(1).max(2000),
  motorPsicologico: z.string().min(1).max(4000),
  formulaHeadline: z.string().min(1).max(2000),
  estruturaCorpo: z.string().min(1).max(6000),
  prova: z.string().min(1).max(4000),
  cta: z.string().max(2000).optional().nullable(),
  preRequisitos: z.string().max(2000).optional().nullable(),
  antiPadroes: z.string().max(4000).optional().nullable(),
  teoriaImplicita: z.string().max(4000).optional().nullable(),
  tags: z.array(z.string().max(40)).max(20).default([]),
  campea: z.boolean().default(false),
});
export type PautaReferenciaInput = z.infer<typeof PautaReferenciaSchema>;

export const PautaReferenciaUpdateSchema = PautaReferenciaSchema.partial();
export type PautaReferenciaUpdateInput = z.infer<typeof PautaReferenciaUpdateSchema>;

export const PautaFonteSchema = z.object({
  tipo: z.enum(PAUTA_FONTE_TIPOS),
  nome: z.string().min(1).max(120),
  url: z.string().url().max(2048).optional().nullable(),
  handle: z.string().max(60).optional().nullable(),
  plataforma: z.string().max(40).optional().nullable(),
  ativo: z.boolean().default(true),
  intervaloMin: z.number().int().min(30).max(20160).default(720),
  tetoRunsMes: z.number().int().min(0).max(10000).default(30),
});
export type PautaFonteInput = z.infer<typeof PautaFonteSchema>;

export const PautaFonteUpdateSchema = PautaFonteSchema.partial();
export type PautaFonteUpdateInput = z.infer<typeof PautaFonteUpdateSchema>;

// --- Saídas (read) ---

export interface PautaCapturaItem {
  id: string;
  tipo: PautaCapturaTipo;
  url: string | null;
  titulo: string | null;
  nota: string | null;
  status: PautaCapturaStatus;
  erro: string | null;
  imagens: string[];
  temFicha: boolean;
  referenciaId: string | null;
  custoUsd: number | null;
  fonte: { id: string; nome: string } | null;
  capturadoEm: string;
}

export interface PautaCapturaList {
  items: PautaCapturaItem[];
  total: number;
  porStatus: Array<{ status: PautaCapturaStatus; count: number }>;
  source: { tool: string; generatedAt: string };
}

export interface PautaReferenciaItem {
  id: string;
  titulo: string;
  plataforma: string | null;
  autor: string | null;
  url: string | null;
  publicadoEm: string | null;
  familia: PautaFamilia;
  objetivo: PautaObjetivo;
  materiaPrima: string;
  tensaoCentral: string;
  emocaoAlvo: string;
  motorPsicologico: string;
  formulaHeadline: string;
  estruturaCorpo: string;
  prova: string;
  cta: string | null;
  preRequisitos: string | null;
  antiPadroes: string | null;
  teoriaImplicita: string | null;
  metricas: Record<string, unknown> | null;
  tags: string[];
  campea: boolean;
  origem: string | null;
  vaultPath: string | null;
  criadaEm: string;
  atualizadaEm: string;
  // preenchido só na busca semântica
  similaridade?: number;
}

export interface PautaReferenciaList {
  items: PautaReferenciaItem[];
  total: number;
  porFamilia: Array<{ key: PautaFamilia; count: number }>;
  porObjetivo: Array<{ key: PautaObjetivo; count: number }>;
  campeas: number;
  source: { tool: string; generatedAt: string };
}

export interface PautaFonteItem {
  id: string;
  tipo: PautaFonteTipo;
  nome: string;
  url: string | null;
  handle: string | null;
  plataforma: string | null;
  ativo: boolean;
  intervaloMin: number;
  tetoRunsMes: number;
  runsNoMes: number;
  ultimaLeitura: string | null;
  ultimoErro: string | null;
  capturas: number;
}

export interface PautaFonteList {
  items: PautaFonteItem[];
  apifyConfigurado: boolean;
  espelho: { destino: 'off' | 'local' | 'drive'; alvo: string | null; disponivel: boolean; motivo: string | null };
  source: { tool: string; generatedAt: string };
}
