import type { M05EscopoDto, M05FonteAutorizadaDto } from './fonte-autorizada.js';
import { z } from 'zod';
import { IndiceEscopoHumanoSchema, EspelhoOnboardingFonteSchema } from './onboarding-indice.js';
import { RecorrenciaSchema, type RecorrenciaDaTarefa } from './tarefas-do-dia.js';
import { TrabCorSchema, TrabIconeSchema, type CorDoTrabalho } from './aparencia-do-trabalho.js';

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
  /*
   * DE QUEM É ESTE EVENTO — RF-T-04. O `id` da empresa (uuid), publicado pelo
   * pixel em `data-key` (ver `apps/web/public/pixel.js`).
   *
   * `z.unknown()` e não `z.string()`, de propósito. Este é um `z.object` sem
   * `passthrough`: tipar como string faria o Zod REPROVAR o corpo inteiro
   * quando a chave viesse como número, lista ou nulo — e a resposta viraria um
   * 400, quando o desenho desta rota anônima é responder SEMPRE a mesma coisa
   * (ver `apps/api/src/events/events.controller.ts`). Chave com lixo tem de
   * cair no caminho de recusa contada, não no de erro de validação: o evento é
   * descartado do mesmo jeito, mas quem chama não ganha um sinal para varrer.
   *
   * Quem classifica o valor é `chaveDoPixel` em `events/pixel-tenant.service.ts`,
   * que separa AUSENTE (pixel antigo, cai na empresa padrão) de INUTILIZÁVEL
   * (instalação errada ou sonda, recusa). Declarar o campo aqui é o que impede
   * o schema de DESCARTÁ-LO em silêncio — foi por isso que o controller nasceu
   * lendo o corpo cru.
   */
  pixel_key: z.unknown().optional(),
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
  // Rodada dos agentes (A6): a OpenAI fica só para vetores (embeddings) e transcrição de áudio; o texto é a Anthropic.
  { key: 'openai', label: 'OpenAI (vetores e áudio)', category: 'ai', phase: 2, authType: 'api_key', requires: 'OPENAI_API_KEY no ambiente da API (só vetores e transcrição de áudio)' },
  { key: 'telegram', label: 'Telegram', category: 'messaging', phase: 2, authType: 'api_key', requires: 'TELEGRAM_BOT_TOKEN (~/.config/root)' },
  { key: 'clickup', label: 'ClickUp', category: 'tasks', phase: 2, authType: 'api_key', requires: 'API token do ClickUp' },
  { key: 'asana', label: 'Asana', category: 'tasks', phase: 2, authType: 'oauth2', requires: 'OAuth/PAT do Asana' },
  { key: 'zapier', label: 'Zapier', category: 'automation', phase: 3, authType: 'webhook', requires: 'webhook (suspenso por ora)' },
  { key: 'apify', label: 'Apify', category: 'automation', phase: 3, authType: 'api_key', requires: 'API token (suspenso por ora)' },
  { key: 'instagram', label: 'Instagram', category: 'social', phase: 4, authType: 'oauth2', requires: 'App Meta + OAuth (Graph API)' },
  // MD10: projeto próprio no Google Cloud, separado do Google da empresa (outro par cliente/segredo, outros escopos).
  { key: 'youtube', label: 'YouTube', category: 'social', phase: 4, authType: 'oauth2', requires: 'OAuth do canal (YOUTUBE_CLIENT_ID/SECRET, projeto próprio no Google Cloud)' },
  { key: 'gmail', label: 'Gmail', category: 'email', phase: 5, authType: 'oauth2', requires: 'Conectar conta Google (OAuth)' },
  { key: 'gcal', label: 'Google Agenda', category: 'calendar', phase: 5, authType: 'oauth2', requires: 'Conectar conta Google (OAuth)' },
  { key: 'gdocs', label: 'Google Docs', category: 'knowledge', phase: 5, authType: 'oauth2', requires: 'Conectar conta Google (OAuth)' },
  { key: 'drive', label: 'Google Drive', category: 'storage', phase: 5, authType: 'oauth2', requires: 'Conectar conta Google (OAuth)' },
  { key: 'obsidian', label: 'Obsidian', category: 'knowledge', phase: 5, authType: 'builtin', requires: 'pasta/sync do vault' },
  // O canal de aprovação e o grupo da pauta pela Evolution do processo (`EVOLUTION_*`); o comercial tem a linha `evolution`.
  { key: 'whatsapp', label: 'WhatsApp (Evolution)', category: 'messaging', phase: 6, authType: 'api_key', requires: 'EVOLUTION_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCIA do processo (canal de aprovação e grupo da pauta)' },
  { key: 'pluggy', label: 'Bancos (Open Finance/Pluggy)', category: 'finance', phase: 2, authType: 'api_key', requires: 'PLUGGY_CLIENT_ID/SECRET (~/.config/root/pluggy.env)' },
  { key: 'asaas', label: 'Asaas (cobranças + conta digital)', category: 'finance', phase: 2, authType: 'api_key', requires: 'ASAAS_API_KEY (~/.config/root/asaas.env)' },
  // Cockpit do lead (13/10/2026): o contrato do comercial sai para assinar pela ZapSign (API v1).
  { key: 'zapsign', label: 'ZapSign (assinatura de contrato)', category: 'knowledge', phase: 6, authType: 'api_key', requires: 'token da API da ZapSign (plano de API)' },
  { key: 'ofx', label: 'Extrato OFX (upload)', category: 'finance', phase: 2, authType: 'builtin', requires: 'arquivo .ofx exportado do banco' },
  // Reuniões do Granola chegam pelo Zap (Webhooks by Zapier). Senha por empresa no cofre, gerada em Conexões.
  { key: 'granola', label: 'Granola (reuniões)', category: 'knowledge', phase: 3, authType: 'webhook', requires: 'Zap do Granola com a senha gerada em Conexões' },
  // Produção 21 (P8): o WhatsApp do comercial pela Evolution. Endereço, chave e instância por empresa no cofre.
  { key: 'evolution', label: 'WhatsApp do comercial (Evolution)', category: 'messaging', phase: 6, authType: 'api_key', requires: 'endereço, chave da API e instância da Evolution, salvos em Integrações' },
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
  id: z.string(), path: z.string(), folder: z.string().nullable(),
  title: z.string(), tags: z.array(z.string()), links: z.array(z.string()),
  wordCount: z.number().int(), fileTime: z.string(),
  fonteCanonica: EspelhoOnboardingFonteSchema.nullable(),
}).strict();
// Null somente em nota nativa autorizada. SQL/producer recusam onboarding sem vínculo;
// parser não descobre identidade ou permissão a partir do path, hash ou null.
const Detail = NoteRowSchema.extend({ content: z.string(), escopo: IndiceEscopoHumanoSchema });
export const NoteDetailSchema = Detail.superRefine((r, c) => {
  if (r.fonteCanonica && r.fonteCanonica.orgId !== r.escopo.orgId)
    c.addIssue({ code: z.ZodIssueCode.custom, message: 'A fonte pertence a outra empresa.' });
});
export const SearchHitSchema = NoteRowSchema.extend({ score: z.number(), snippet: z.string() });
const Lista = z.object({
  escopo: IndiceEscopoHumanoSchema, items: z.array(NoteRowSchema),
  total: z.number().int().nonnegative().safe(), folders: z.array(z.string()),
  indexedNotes: z.number().int().nonnegative().safe(), source: SourceMetaSchema,
}).strict();
export const KnowledgeListSchema = Lista.superRefine((r, c) => {
  if (r.indexedNotes > r.total || r.items.length > r.total)
    c.addIssue({ code: z.ZodIssueCode.custom, message: 'Confira a população usada na contagem.' });
  r.items.forEach((item, i) => {
    if (item.fonteCanonica && item.fonteCanonica.orgId !== r.escopo.orgId)
      c.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i, 'fonteCanonica'], message: 'A fonte pertence a outra empresa.' });
  });
});
const Busca = z.object({
  escopo: IndiceEscopoHumanoSchema, query: z.string(),
  mode: z.enum(['semantic', 'keyword']), items: z.array(SearchHitSchema), source: SourceMetaSchema,
}).strict();
export const SearchResultSchema = Busca.superRefine((r, c) => {
  r.items.forEach((item, i) => {
    if (item.fonteCanonica && item.fonteCanonica.orgId !== r.escopo.orgId)
      c.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i, 'fonteCanonica'], message: 'A fonte pertence a outra empresa.' });
  });
});
export type NoteRow = z.infer<typeof NoteRowSchema>;
export type NoteDetail = z.infer<typeof NoteDetailSchema>;
export type KnowledgeList = z.infer<typeof KnowledgeListSchema>;
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
// Não aplicar este envelope público a callers sem pessoa. Contrato interno distinto,
// com alcanceOnboarding:nao_conferido e sem espelho, antes de adaptar efeitos/saúde.
// Cada consumidor público confere escopo/geração atual; schema não substitui autoridade.

// Fachada interna sem pessoa: nunca retorna o envelope humano.
const HitNativoInterno = SearchHitSchema.omit({ fonteCanonica: true }).extend({ fonteCanonica: z.null() });
export const BuscaIndiceInternaSemSolicitanteSchema = z.object({
 natureza: z.literal('indice_interno_sem_solicitante'), orgId: z.string().uuid(),
 query: z.string(), mode: z.enum(['semantic', 'keyword']), items: z.array(HitNativoInterno),
 source: SourceMetaSchema,
 alcanceOnboarding: z.object({ estado: z.literal('nao_conferida'), total: z.null(), comVetor: z.null(),
  motivo: z.literal('solicitante_nao_identificado'), observadoEm: z.string().datetime() }).strict(),
}).strict();
export type BuscaIndiceInternaSemSolicitante = z.infer<typeof BuscaIndiceInternaSemSolicitanteSchema>;

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
    // classificação: vale também p/ lançamentos importados (Asaas/OFX/Pluggy); o sync não sobrescreve
    chartAccountId: z.string().nullable().optional(),
    partnerId: z.string().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    splits: z.array(RateioSplitInputSchema).optional(), // [] remove o rateio; soma = amount
    // pago de uma vez para N meses de uso (plano anual = 12); null volta a 1 mês
    mesesDeUso: z.number().int().min(1).max(36).nullable().optional(),
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
  custoFixo: z.boolean(),
  natureza: z.string().nullable(),
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

// Por ora só o que a Análise edita: se a conta é custo fixo.
export const NaturezaDaContaSchema = z.enum(['fixo', 'variavel', 'eventual']);
export const UpdateChartAccountSchema = z
  .object({ custoFixo: z.boolean().optional(), natureza: NaturezaDaContaSchema.nullable().optional() })
  .refine((v) => v.custoFixo !== undefined || v.natureza !== undefined, { message: 'Nada para atualizar' });
export type UpdateChartAccountInput = z.infer<typeof UpdateChartAccountSchema>;

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

// Gerar o lançamento de um contrato leva o vencimento que quem chama viu na
// lista. É ele que separa a repetição de um pedido cuja resposta se perdeu de
// um pedido novo para a parcela seguinte.
export const GerarContratoSchema = z.object({
  vencimento: z.string().datetime({ offset: true }),
});
export type GerarContratoInput = z.infer<typeof GerarContratoSchema>;

// `replayed: true`: o lançamento daquele vencimento já existia e nada foi
// gravado agora; a resposta é a mesma da chamada que o gerou.
export const GerarContratoRespostaSchema = z.object({
  ok: z.literal(true),
  transactionId: z.string(),
  proximoVencimento: z.string(),
  replayed: z.boolean(),
});
export type GerarContratoResposta = z.infer<typeof GerarContratoRespostaSchema>;

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
  exercicioFinanceiro: z.boolean().optional(),
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

/*
 * MARCAR REUNIÃO — a escrita que o OS oferece no lugar de "criar evento".
 *
 * A diferença entre este esquema e o `CreateEventSchema` acima é a única que
 * interessa: aqui NÃO existe campo `title`. O título é montado pelo servidor
 * com `montarTituloDeReuniao` (ver `agenda.ts`), e é por isso que nem a tela
 * nem um agente conseguem escrever "Reunião c/ Andrade" na agenda da Root.
 *
 * `CreateEventSchema` continua vivo para o que NÃO é reunião — bloqueio de
 * agenda, viagem, lembrete —, e é o caminho em que o título é livre.
 */
export const MarcarReuniaoSchema = z
  .object({
    tipo: z.enum(['cliente', 'interna']),
    /**
     * Sempre exigida, inclusive na interna: ela não vai para o título da
     * interna, mas é ela que decide o link do Meet e o campo de local.
     */
    modalidade: z.enum(['online', 'presencial']),
    /** Obrigatório quando `tipo: 'cliente'` — o refine abaixo cobra. */
    cliente: z.string().min(1).max(120).optional(),
    /** Um sócio, ou "Todos". */
    responsavel: z.string().min(1).max(120),
    inicio: z.string().min(1), // ISO datetime
    /** O fim, quando declarado; do contrário vale `duracaoMinutos`. */
    fim: z.string().min(1).optional(),
    duracaoMinutos: z.number().int().min(10).max(600).optional(),
    /** Vai para a descrição do evento, acima do que o Google acrescentar. */
    pauta: z.string().max(5000).optional(),
    /** Endereço, sala — só faz sentido na presencial. */
    local: z.string().max(300).optional(),
    convidados: z.array(z.string().email()).max(50).optional(),
  })
  .refine((v) => v.tipo !== 'cliente' || !!v.cliente?.trim(), {
    message: 'Reunião de cliente precisa do nome do cliente.',
    path: ['cliente'],
  });
export type MarcarReuniaoInput = z.infer<typeof MarcarReuniaoSchema>;

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

/**
 * Para que a conexão OAuth foi pedida (MD5) — espelho do enum `BioFinalidade`
 * do Prisma, na mesma ordem. `publicacao` é a conta da própria empresa que o OS
 * usa para publicar; `bio` é a do criador, que só lê.
 */
export const BIO_FINALIDADES = ['bio', 'publicacao'] as const;
export type BioFinalidade = (typeof BIO_FINALIDADES)[number];

/** O escopo sem o qual a conexão do Instagram não vira conta de publicação. */
export const INSTAGRAM_ESCOPO_DE_PUBLICAR = 'instagram_business_content_publish';
/** O escopo que a fila de comentários (MD9) vai usar; já pedido na MD5 para não exigir outra reconexão. */
export const INSTAGRAM_ESCOPO_DE_COMENTARIOS = 'instagram_business_manage_comments';
/**
 * O escopo de mensagens (MD11). A página "Private Replies" da Meta pede só o de
 * comentários, mas o relato de campo mostra a DM falhando sem este para quem
 * não tem papel no app: vai no mesmo App Review, e a conexão só o pede com
 * `INSTAGRAM_PEDIR_MENSAGENS=sim`.
 */
export const INSTAGRAM_ESCOPO_DE_MENSAGENS = 'instagram_business_manage_messages';

/**
 * A conta de publicação do Instagram como a aba Semana a mostra
 * (`GET /pauta/instagram/conexao`). Nunca carrega token.
 */
export interface PautaContaDePublicacao {
  /** Há credencial do app do Instagram (tela, cofre ou ambiente) para começar a conexão. */
  credencialConfigurada: boolean;
  /** Os escopos que "Conectar" pede à Meta. */
  escoposPedidos: string[];
  conexao: {
    id: string;
    handle: string;
    escopos: string[];
    podePublicar: boolean;
    podeComentarios: boolean;
    status: 'ok' | 'token_expirado' | 'conta_pessoal' | 'privada' | 'erro';
    expiraEm: string | null;
    ultimoErro: string | null;
    conectadaEm: string;
    atualizadaEm: string;
  } | null;
  source: { tool: string; generatedAt: string };
}

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

export const PAUTA_FONTE_TIPOS = ['rss', 'perfil', 'busca', 'manual', 'gmail'] as const;
export type PautaFonteTipo = (typeof PAUTA_FONTE_TIPOS)[number];

export const PAUTA_FONTE_ROTULOS: Record<PautaFonteTipo, string> = {
  rss: 'Feed RSS',
  perfil: 'Perfil vigiado',
  busca: 'Busca no Google',
  manual: 'Manual',
  gmail: 'Etiqueta do Gmail',
};

/**
 * Onde o perfil vigiado mora (fonte `perfil`, MC4). Perfil gravado sem
 * plataforma é Instagram: era a única antes do MC4.
 */
export const PAUTA_PERFIL_PLATAFORMAS = ['instagram', 'tiktok', 'x', 'youtube'] as const;
export type PautaPerfilPlataforma = (typeof PAUTA_PERFIL_PLATAFORMAS)[number];

export const PAUTA_PERFIL_PLATAFORMA_ROTULOS: Record<PautaPerfilPlataforma, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X (Twitter)',
  youtube: 'YouTube',
};

/**
 * A letra que a curadoria mostra ao lado de cada item da rodada (MC4): de que
 * origem ele veio. W grupo de WhatsApp, N busca/notícia, R feed RSS, C creator
 * (perfil vigiado), L newsletter (etiqueta do Gmail).
 */
export const PAUTA_ORIGENS = ['W', 'N', 'R', 'C', 'L'] as const;
export type PautaOrigem = (typeof PAUTA_ORIGENS)[number];

export const PAUTA_ORIGEM_ROTULOS: Record<PautaOrigem, string> = {
  W: 'Grupo de WhatsApp',
  N: 'Busca/notícia',
  R: 'Feed RSS',
  C: 'Creator',
  L: 'Newsletter',
};

/**
 * A origem de um item pela fonte que o trouxe. Fonte `manual` só é W quando é
 * o grupo de links do WhatsApp; outra manual (ou captura sem fonte, colada na
 * tela de referências) não é insumo de rodada e fica `null`.
 */
export function origemDaFonte(
  fonte: { tipo: PautaFonteTipo; plataforma?: string | null } | null | undefined,
): PautaOrigem | null {
  switch (fonte?.tipo) {
    case 'rss':
      return 'R';
    case 'busca':
      return 'N';
    case 'perfil':
      return 'C';
    case 'gmail':
      return 'L';
    case 'manual':
      return fonte.plataforma === 'whatsapp' ? 'W' : null;
    default:
      return null;
  }
}

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
  // @perfil, etiqueta do Gmail ou a consulta da busca (MC3, até 200). A API corta os outros tipos em 60.
  handle: z.string().max(200).optional().nullable(),
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

// ---------- Pauta: rotinas, rodadas e peças (ondas 2 e 3) ----------

export const PAUTA_CANAIS = ['whatsapp', 'instagram', 'newsletter', 'clickup'] as const;
export type PautaCanal = (typeof PAUTA_CANAIS)[number];

export const PAUTA_CANAL_LABEL: Record<PautaCanal, string> = {
  whatsapp: 'WhatsApp (grupo)',
  instagram: 'Instagram',
  newsletter: 'Newsletter',
  clickup: 'ClickUp',
};

export const PAUTA_PECA_STATUS = ['rascunho', 'aprovada', 'publicada', 'descartada'] as const;
export type PautaPecaStatus = (typeof PAUTA_PECA_STATUS)[number];

export const PAUTA_RODADA_STATUS = [
  'coletando',
  'aguardando_curadoria',
  'curada',
  'aprovada',
  'publicada',
  'falhou',
] as const;
export type PautaRodadaStatus = (typeof PAUTA_RODADA_STATUS)[number];

/**
 * Curadoria humana (MC6). A rodada "para curadoria" nasce em
 * `aguardando_curadoria` com TODOS os candidatos da janela até este teto; a IA
 * só sugere, e o operador marca o que segue. O teto é alto de propósito e o
 * que passa dele fica registrado no log e na auditoria da rodada.
 */
export const PAUTA_TETO_DE_CANDIDATOS = 200;

/** Janela padrão da rodada para curadoria: a semana do episódio. */
export const PAUTA_HORAS_DA_CURADORIA = 168;

const PautaFonteIdsRssSchema = z.array(z.string().uuid()).min(1).max(50).refine(
  (ids) => new Set(ids).size === ids.length,
  'Selecione cada fonte RSS uma vez.',
);

/** Seleção manual de RSS; sem `fonteIds` a coleta continua como antes. */
export const PautaColetarFeedsSchema = z.object({
  fonteIds: PautaFonteIdsRssSchema.optional(),
});

export const PautaGerarCuradoriaSchema = z.object({
  horas: z.number().int().min(6).max(336).optional(),
  origens: z.array(z.enum(PAUTA_ORIGENS)).min(1).max(PAUTA_ORIGENS.length).optional(),
  fonteIds: PautaFonteIdsRssSchema.optional(),
}).refine(
  (input) => !input.fonteIds || !input.origens || (input.origens.length === 1 && input.origens[0] === 'R'),
  { message: 'A seleção de fontes RSS aceita apenas a origem R.', path: ['origens'] },
);
export type PautaGerarCuradoriaInput = z.infer<typeof PautaGerarCuradoriaSchema>;

const idDoCandidato = z.string().min(1).max(64);

/** Quais candidatos ficam. Lista vazia é válida aqui: é desmarcar tudo. */
export const PautaCuradoriaMarcacaoSchema = z.object({
  marcados: z.array(idDoCandidato).max(PAUTA_TETO_DE_CANDIDATOS),
});
export type PautaCuradoriaMarcacaoInput = z.infer<typeof PautaCuradoriaMarcacaoSchema>;

/** Confirmar pode levar a marcação junto; sem ela, vale a que foi salva. */
export const PautaCuradoriaConfirmacaoSchema = z.object({
  marcados: z.array(idDoCandidato).max(PAUTA_TETO_DE_CANDIDATOS).optional(),
});
export type PautaCuradoriaConfirmacaoInput = z.infer<typeof PautaCuradoriaConfirmacaoSchema>;

// Cron de 5 campos. A validação forte é no servidor (parseCron); aqui só barra
// o que é obviamente inválido antes da viagem.
const CRON_RE = /^(\S+\s+){4}\S+$/;

export const PautaRotinaSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/, 'slug: 2-40 caracteres, a-z 0-9 -'),
  nome: z.string().min(1).max(120),
  cron: z.string().regex(CRON_RE, 'cron precisa de 5 campos (min hora dia mês diaDaSemana)'),
  tz: z.string().max(60).default('America/Sao_Paulo'),
  ativo: z.boolean().default(true),
  // Janela de coleta do insumo. 72h é a validade prática de uma notícia.
  horas: z.number().int().min(6).max(336).default(72),
  coletarAntes: z.boolean().default(true),
  // De que origens a curadoria lê (MC4). Sem o campo, todas; ['R', 'N'] é a
  // rodada de antes do MC4, que lia só o feed e a busca.
  origens: z.array(z.enum(PAUTA_ORIGENS)).min(1).max(PAUTA_ORIGENS.length).optional(),
});
export type PautaRotinaInput = z.infer<typeof PautaRotinaSchema>;

export const PautaRotinaUpdateSchema = PautaRotinaSchema.partial();
export type PautaRotinaUpdateInput = z.infer<typeof PautaRotinaUpdateSchema>;

export interface PautaRotinaItem {
  id: string;
  slug: string;
  nome: string;
  cron: string;
  tz: string;
  ativo: boolean;
  horas: number;
  ultimoRun: string | null;
  ultimoStatus: string | null;
  proximoRun: string | null;
  rodadas: number;
}

export interface PautaRotinaList {
  items: PautaRotinaItem[];
  cronAtivo: boolean;
  source: { tool: string; generatedAt: string };
}

export interface PautaRodadaResumo {
  id: string;
  titulo: string;
  status: PautaRodadaStatus;
  rotina: string | null;
  itens: number;
  /** Quantos candidatos o operador já marcou (MC6); 0 fora da curadoria. */
  marcados: number;
  pecas: number;
  provider: string | null;
  model: string | null;
  erro: string | null;
  janelaIni: string;
  janelaFim: string;
  criadaEm: string;
  /** O episódio que nasceu desta rodada (MC7), se já nasceu. */
  episodio?: PautaEpisodioRef | null;
}

export interface PautaRodadaList {
  items: PautaRodadaResumo[];
  source: { tool: string; generatedAt: string };
}

export interface PautaItemCurado {
  titulo: string;
  url: string;
  porque?: string;
  ganchoBr?: string;
  /** De que origem o item veio (MC4). Rodada de antes do MC4 não tem. */
  origem?: PautaOrigem;
  // --- Curadoria humana (MC6): só nos itens da rodada "para curadoria". ---
  /** O id da captura que trouxe o item: é o que a marcação envia. */
  id?: string;
  /** Todas as origens em que a matéria apareceu, quando foi mais de uma. */
  origens?: PautaOrigem[];
  fonte?: string | null;
  resumo?: string;
  /** A IA achou que vale; `porque` diz por quê. Não decide nada sozinho. */
  sugerido?: boolean;
  /** O operador marcou. Só existe enquanto a rodada aguarda a curadoria. */
  marcado?: boolean;
  /** Link de caixa de entrada (newsletter): nunca vira o link publicado. */
  semLinkPublico?: boolean;
}

export interface PautaPecaItem {
  id: string;
  canal: PautaCanal;
  formato: string;
  titulo: string;
  corpo: string;
  meta: Record<string, unknown>;
  status: PautaPecaStatus;
  externalId: string | null;
  bioLinkId: string | null;
  erro: string | null;
  publicadaEm: string | null;
}

export interface PautaRodadaDetalhe {
  id: string;
  titulo: string;
  status: PautaRodadaStatus;
  rotina: string | null;
  corpo: string;
  itens: PautaItemCurado[];
  fichasUsadas: number;
  provider: string | null;
  model: string | null;
  erro: string | null;
  janelaIni: string;
  janelaFim: string;
  criadaEm: string;
  pecas: PautaPecaItem[];
  /** O episódio que nasceu desta rodada (MC7), se já nasceu. */
  episodio?: PautaEpisodioRef | null;
}

// ---------- Pauta: o episódio (MC7) ----------
// A coleta e a curadoria são estados da RODADA; o episódio nasce de uma rodada
// `curada` e anda daqui até o concluído. Espelho do enum `PautaEpisodioStatus`
// do Prisma — a ORDEM é a do trabalho e é dela que as transições saem.

export const PAUTA_EPISODIO_STATUS = [
  'roteiro',
  'gravacao',
  'edicao',
  'pacote',
  'derivacao',
  'agendado',
  'concluido',
] as const;
export type PautaEpisodioStatus = (typeof PAUTA_EPISODIO_STATUS)[number];

export const PAUTA_EPISODIO_STATUS_ROTULO: Record<PautaEpisodioStatus, string> = {
  roteiro: 'Roteiro',
  gravacao: 'Gravação',
  edicao: 'Edição',
  pacote: 'Pacote',
  derivacao: 'Derivação',
  agendado: 'Agendado',
  concluido: 'Concluído',
};

/** Os dois vizinhos do status: é só para eles que o episódio anda. */
export function vizinhosDoEpisodio(atual: PautaEpisodioStatus): {
  avancar: PautaEpisodioStatus | null;
  voltar: PautaEpisodioStatus | null;
} {
  const i = PAUTA_EPISODIO_STATUS.indexOf(atual);
  return {
    avancar: i >= 0 && i < PAUTA_EPISODIO_STATUS.length - 1 ? PAUTA_EPISODIO_STATUS[i + 1] : null,
    voltar: i > 0 ? PAUTA_EPISODIO_STATUS[i - 1] : null,
  };
}

/**
 * Quem pode ir para onde. Um passo à frente, ou um passo atrás para refazer —
 * pular etapa não existe: a mídia (MC9) parte do roteiro gravado, o pacote
 * (MC11) da transcrição, e um episódio que pulasse chegaria sem o insumo.
 */
export function transicaoDoEpisodio(
  de: PautaEpisodioStatus,
  para: PautaEpisodioStatus,
): { ok: true; sentido: 'avancar' | 'voltar' } | { ok: false; erro: string } {
  if (!(PAUTA_EPISODIO_STATUS as readonly string[]).includes(de)) {
    return { ok: false, erro: `Status atual desconhecido: "${de}".` };
  }
  if (!(PAUTA_EPISODIO_STATUS as readonly string[]).includes(para)) {
    return { ok: false, erro: `Status desconhecido: "${para}".` };
  }
  if (de === para) return { ok: false, erro: `O episódio já está em ${PAUTA_EPISODIO_STATUS_ROTULO[de]}.` };
  const v = vizinhosDoEpisodio(de);
  if (para === v.avancar) return { ok: true, sentido: 'avancar' };
  if (para === v.voltar) return { ok: true, sentido: 'voltar' };
  const quais = [v.avancar, v.voltar].filter((x): x is PautaEpisodioStatus => x !== null);
  return {
    ok: false,
    erro:
      `De ${PAUTA_EPISODIO_STATUS_ROTULO[de]} o episódio só vai para ` +
      `${quais.map((q) => PAUTA_EPISODIO_STATUS_ROTULO[q]).join(' ou ')} — um passo por vez.`,
  };
}

/**
 * O avanço à mão que chegaria sem o insumo. Da Edição ao Pacote só com a
 * transcrição: quem leva até lá é o `/root-midia` (a transcrição move o
 * episódio), e o Pacote sem ela prende o episódio — o Mac só enxerga Gravação e
 * Edição, e a transcrição só entra na Edição. Nulo = pode avançar.
 */
export function motivoParaNaoAvancar(
  de: PautaEpisodioStatus,
  para: PautaEpisodioStatus,
  insumo: { segmentos: number },
): string | null {
  if (de === 'edicao' && para === 'pacote' && insumo.segmentos === 0) {
    return 'O Pacote parte da transcrição do vídeo final: rode /root-midia no Mac, que manda a transcrição e leva o episódio ao Pacote.';
  }
  return null;
}

/** `ep-07`: o apelido do episódio no Mac (`/root-midia ep-07`) e na página de links. */
export function apelidoDoEpisodio(numero: number): string {
  return `ep-${String(numero).padStart(2, '0')}`;
}

const tituloDoEpisodio = z.string().trim().min(1, 'O título não pode ficar vazio.').max(160);

export const PautaEpisodioCriarSchema = z.object({
  rodadaId: z.string().uuid('rodadaId precisa ser o id de uma rodada.'),
  titulo: tituloDoEpisodio.optional(),
});
export type PautaEpisodioCriarInput = z.infer<typeof PautaEpisodioCriarSchema>;

export const PautaEpisodioAtualizarSchema = z.object({ titulo: tituloDoEpisodio });
export type PautaEpisodioAtualizarInput = z.infer<typeof PautaEpisodioAtualizarSchema>;

export const PautaEpisodioStatusSchema = z.object({ para: z.enum(PAUTA_EPISODIO_STATUS) });
export type PautaEpisodioStatusInput = z.infer<typeof PautaEpisodioStatusSchema>;

export interface PautaEpisodioRef {
  id: string;
  numero: number;
  status: PautaEpisodioStatus;
}

export interface PautaEpisodioResumo {
  id: string;
  numero: number;
  apelido: string;
  titulo: string;
  status: PautaEpisodioStatus;
  rodadaId: string;
  rodadaTitulo: string;
  /** Quantos itens a curadoria manteve na rodada. */
  itens: number;
  criadoEm: string;
  atualizadoEm: string;
}

export interface PautaEpisodioList {
  items: PautaEpisodioResumo[];
  source: { tool: string; generatedAt: string };
}

export interface PautaEpisodioDetalhe extends Omit<PautaEpisodioResumo, 'itens'> {
  /** Os itens que a curadoria manteve, na ordem da rodada. */
  itens: PautaItemCurado[];
  janelaIni: string;
  janelaFim: string;
  roteiro: string;
  descricao: string;
  midia: Record<string, unknown>;
  transcricao: Array<{ inicio: number; fim: number; texto: string }>;
  transcricaoTexto: string;
  /** Os títulos do pacote do YouTube (MC11); vazio até gerar. */
  titulos: PautaTituloDoPacote[];
  /** Os briefs das thumbs (MC11) e, quando o Mac já renderizou, a imagem. */
  thumbs: PautaThumbDoPacote[];
  bioPageId: string | null;
  /** A página de links do episódio (MC12); nula até montar. */
  paginaDeLinks: PautaPaginaDeLinks | null;
  criadoPor: string | null;
  /** Para onde o episódio pode andar agora (os dois vizinhos da ordem). */
  avancar: PautaEpisodioStatus | null;
  voltar: PautaEpisodioStatus | null;
}

// ---------- Pauta: o roteiro do episódio (MC8) ----------

/**
 * D-MC2: a palavra dita em voz alta a cada erro na gravação; a edição (MC9)
 * corta dali para trás. Vale a do episódio; sem ela, a da empresa (nota da
 * memória com a chave abaixo); sem as duas, esta.
 */
export const PAUTA_PALAVRA_DE_CORTE_PADRAO = 'root, corta';

/** A chave da nota da memória que guarda a palavra de corte da empresa. */
export const PAUTA_CHAVE_DA_PALAVRA_DE_CORTE = 'pauta.palavra-de-corte';

/**
 * As chaves lidas, na ordem. A segunda é a que a tela Contexto dá a uma nota
 * de título "Palavra de corte" (`operador:<slug do título>`) — mas a tela só
 * cria nota com a memória vazia; fora disso, a nota se cria por `POST /memoria`.
 */
export const PAUTA_CHAVES_DA_PALAVRA_DE_CORTE = [PAUTA_CHAVE_DA_PALAVRA_DE_CORTE, 'operador:palavra-de-corte'] as const;

/** Só roteiro e gravação geram roteiro: depois da gravação ele é registro do que foi dito. */
export const PAUTA_STATUS_QUE_GERAM_ROTEIRO = ['roteiro', 'gravacao'] as const satisfies readonly PautaEpisodioStatus[];

export function podeGerarRoteiro(status: PautaEpisodioStatus): boolean {
  return (PAUTA_STATUS_QUE_GERAM_ROTEIRO as readonly string[]).includes(status);
}

/** Teto do roteiro em caracteres: um episódio de 20 min cabe folgado em 60 mil. */
export const PAUTA_TETO_DO_ROTEIRO = 60_000;

/** O lembrete do topo do roteiro: a primeira coisa que quem grava lê. */
export function lembreteDaPalavraDeCorte(palavra: string): string {
  return (
    `> **Palavra de corte: “${palavra}”.** Errou? Diga a palavra, respire e repita a frase ` +
    'inteira — a edição corta daí para trás.'
  );
}

const LINHA_DO_LEMBRETE = /^> \*\*Palavra de corte: “.*”\.\*\*.*$/m;

/**
 * O roteiro com o lembrete trocado pela palavra que vale agora. A palavra muda
 * depois de gerar (no episódio ou na nota da empresa) e quem grava não pode ler
 * uma no cabeçalho e outra no texto. Sem o lembrete, o texto fica como está.
 */
export function comPalavraDeCorte(roteiro: string, palavra: string): string {
  return roteiro.replace(LINHA_DO_LEMBRETE, () => lembreteDaPalavraDeCorte(palavra));
}

export const PautaPalavraDeCorteSchema = z
  .string()
  .trim()
  .min(2, 'A palavra de corte precisa de pelo menos 2 caracteres.')
  .max(40, 'A palavra de corte tem no máximo 40 caracteres.')
  .regex(/^[^\u0000-\u001f\u007f]+$/, 'A palavra de corte é uma linha só, sem caractere de controle.');

export const PautaRoteiroGerarSchema = z.object({
  /** O episódio já tem roteiro: gerar de novo só com a confirmação explícita. */
  substituir: z.boolean().default(false),
});
export type PautaRoteiroGerarInput = z.infer<typeof PautaRoteiroGerarSchema>;

export const PautaRoteiroSalvarSchema = z.object({
  roteiro: z.string().max(PAUTA_TETO_DO_ROTEIRO, `O roteiro tem no máximo ${PAUTA_TETO_DO_ROTEIRO} caracteres.`),
  /** O `atualizadoEm` que a tela leu: diferente do atual é edição de outra aba (409). */
  versao: z.string().datetime().optional(),
});
export type PautaRoteiroSalvarInput = z.infer<typeof PautaRoteiroSalvarSchema>;

/** `null` devolve o episódio à palavra da empresa. */
export const PautaPalavraDeCorteDoEpisodioSchema = z.object({
  palavraDeCorte: PautaPalavraDeCorteSchema.nullable(),
});
export type PautaPalavraDeCorteDoEpisodioInput = z.infer<typeof PautaPalavraDeCorteDoEpisodioSchema>;

export type PautaOrigemDaPalavraDeCorte = 'episodio' | 'empresa' | 'padrao';

export interface PautaRoteiroDoEpisodio {
  episodioId: string;
  apelido: string;
  titulo: string;
  status: PautaEpisodioStatus;
  roteiro: string;
  /** Vai de volta no salvar (`versao`). */
  atualizadoEm: string;
  palavraDeCorte: {
    efetiva: string;
    origem: PautaOrigemDaPalavraDeCorte;
    doEpisodio: string | null;
    daEmpresa: string | null;
  };
  podeGerar: boolean;
  /** Por que não dá para gerar agora (status, rodada sem itens), ou nulo. */
  motivo: string | null;
  /** O resultado do espelho na escrita que devolveu esta resposta; ausente = não tentou. */
  espelho?: { caminho: string | null; erro: string | null } | null;
}

// ---------- Pauta: a mídia do episódio (MC9) ----------
// O vídeo é editado e transcrito NO MAC (`tools/root-midia`) e fica lá: o MinIO
// da VPS não é público; desde a MD10 o Mac o manda direto ao YouTube. O OS só
// recebe o que é leve — onde estão os arquivos, a duração, o que foi cortado e
// a transcrição com os tempos do vídeo FINAL.

/** Os status em que o Mac tem trabalho: gravado (falta editar) e em edição (falta transcrever). */
export const PAUTA_STATUS_PENDENTES_DE_MIDIA = ['gravacao', 'edicao'] as const satisfies readonly PautaEpisodioStatus[];

/** Quatro horas: nenhum episódio chega perto, e um número absurdo é arquivo errado. */
export const PAUTA_TETO_DA_DURACAO_SEG = 4 * 3600;
/** Cortes de uma edição: os silêncios de um bruto de 1h, com folga. */
export const PAUTA_TETO_DE_CORTES = 3000;
/*
 * Os tetos da transcrição valem para 1h de fala (~1 segmento a cada 3 s, ~150
 * palavras/min). São eles que limitam o tamanho do que a rota aceita: o corpo
 * JSON da API é de 100 kb, que acabava por volta de 40 min de fala, e as duas
 * rotas de mídia do episódio aceitam até `PAUTA_TETO_DO_CORPO_DA_MIDIA` (MC-R).
 */
export const PAUTA_TETO_DE_SEGMENTOS = 2000;
export const PAUTA_TETO_DO_SEGMENTO = 2000;
export const PAUTA_TETO_DA_TRANSCRICAO = 120_000;
/**
 * O corpo JSON das rotas `POST /pauta/episodios/:id/midia` e `/transcricao`, em
 * bytes. O pior corpo que os tetos acima deixam passar (2000 segmentos com
 * tempos de 4h e 120 mil caracteres fora do ASCII, escapados em `\uXXXX`) fica
 * abaixo de 1 MB; 2 MB é o dobro disso, e nenhuma outra rota muda.
 */
export const PAUTA_TETO_DO_CORPO_DA_MIDIA = 2 * 1024 * 1024;
/**
 * Folga entre o fim da transcrição e a duração do vídeo final (s): o whisper
 * arredonda o último segmento para cima e o ffprobe mede o contêiner.
 */
export const PAUTA_FOLGA_DA_TRANSCRICAO_SEG = 1.5;

/**
 * Uma linha só, sem caractere de controle. O NUL, além de tudo, derruba o
 * Postgres (22P05 no jsonb e no text) — viraria 500 em vez de 400.
 */
const SEM_CONTROLE = /^[^\u0000-\u001f\u007f]+$/;
/** Texto corrido: tab e quebra de linha valem, o resto do controle não. */
const SEM_CONTROLE_NO_TEXTO = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

const caminhoNoMac = z
  .string()
  .trim()
  .min(1, 'O caminho do arquivo não pode ficar vazio.')
  .max(500, 'O caminho do arquivo tem no máximo 500 caracteres.')
  .regex(SEM_CONTROLE, 'O caminho do arquivo é uma linha só, sem caractere de controle.');

const segundos = z
  .number({ invalid_type_error: 'Tempo em segundos.' })
  .finite()
  .min(0, 'Tempo negativo.')
  .max(PAUTA_TETO_DA_DURACAO_SEG, `Tempo acima de ${PAUTA_TETO_DA_DURACAO_SEG} s.`);

export const PAUTA_MOTIVOS_DE_CORTE = ['silencio', 'palavra-de-corte', 'manual'] as const;
export type PautaMotivoDeCorte = (typeof PAUTA_MOTIVOS_DE_CORTE)[number];

export const PAUTA_EDITORES_DE_MIDIA = ['palmier', 'ffmpeg', 'manual'] as const;
export type PautaEditorDeMidia = (typeof PAUTA_EDITORES_DE_MIDIA)[number];

/**
 * Intervalos em ordem e sem sobreposição; encostar no anterior (fim = início)
 * vale. Os 10 ms de folga são o arredondamento do whisper.
 */
function conferirOrdem(
  lista: ReadonlyArray<{ inicio: number; fim: number }>,
  ctx: z.RefinementCtx,
  campo: string,
  rotulo: string,
  { duracaoZeroVale }: { duracaoZeroVale: boolean },
) {
  let fimAnterior = -Infinity;
  lista.forEach((s, i) => {
    if (duracaoZeroVale ? s.fim < s.inicio : s.fim <= s.inicio) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo, i, 'fim'], message: `O ${rotulo} ${i + 1} termina antes de começar.` });
    }
    if (s.inicio < fimAnterior - 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [campo, i, 'inicio'],
        message: `O ${rotulo} ${i + 1} começa antes do fim do anterior — a lista vem em ordem, sem sobreposição.`,
      });
    }
    fimAnterior = Math.max(fimAnterior, s.fim);
  });
}

export const PautaCorteDeMidiaSchema = z.object({
  inicio: segundos,
  fim: segundos,
  motivo: z.enum(PAUTA_MOTIVOS_DE_CORTE),
});
export type PautaCorteDeMidia = z.infer<typeof PautaCorteDeMidiaSchema>;

/** `POST /pauta/episodios/:id/midia` — o que a estação de mídia devolve depois de editar. */
export const PautaMidiaSchema = z
  .object({
    arquivoBruto: caminhoNoMac,
    arquivoFinal: caminhoNoMac,
    /** Duração do vídeo FINAL: é nela que a transcrição tem de caber. */
    duracaoSeg: segundos.refine((s) => s > 0, 'A duração do vídeo final precisa ser maior que zero.'),
    duracaoBrutoSeg: segundos.optional(),
    /** O que foi TIRADO do bruto, em segundos do bruto. */
    cortes: z
      .array(PautaCorteDeMidiaSchema)
      .max(PAUTA_TETO_DE_CORTES, `No máximo ${PAUTA_TETO_DE_CORTES} cortes.`)
      .default([]),
    /** A palavra que a edição procurou; nula = só silêncios (sem transcrição do bruto). */
    palavraDeCorte: PautaPalavraDeCorteSchema.nullable().default(null),
    editor: z.enum(PAUTA_EDITORES_DE_MIDIA).default('ffmpeg'),
  })
  .superRefine((m, ctx) => {
    conferirOrdem(m.cortes, ctx, 'cortes', 'corte', { duracaoZeroVale: false });
    if (m.duracaoBrutoSeg === undefined) return;
    const bruto = m.duracaoBrutoSeg;
    const fora = m.cortes.findIndex((c) => c.fim > bruto + 0.01);
    if (fora >= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cortes', fora, 'fim'], message: `O corte ${fora + 1} passa do fim do bruto.` });
    }
    if (m.duracaoSeg > bruto + 0.5) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['duracaoSeg'], message: 'O vídeo final não pode ser mais longo que o bruto.' });
    }
  });
export type PautaMidiaInput = z.infer<typeof PautaMidiaSchema>;

/** Como a mídia fica guardada no episódio: o que veio, mais quando chegou. */
export type PautaMidiaDoEpisodio = PautaMidiaInput & { recebidaEm: string };

/** A mídia guardada no JSON do episódio, ou nula (vazia, de antes do MC9, fora da forma). */
export function midiaDoEpisodio(valor: unknown): PautaMidiaDoEpisodio | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const recebidaEm = (valor as { recebidaEm?: unknown }).recebidaEm;
  if (typeof recebidaEm !== 'string') return null;
  const r = PautaMidiaSchema.safeParse(valor);
  return r.success ? { ...r.data, recebidaEm } : null;
}

export const PautaSegmentoSchema = z.object({
  inicio: segundos,
  fim: segundos,
  texto: z
    .string()
    .trim()
    .min(1, 'Segmento sem texto.')
    .max(PAUTA_TETO_DO_SEGMENTO, `Segmento com mais de ${PAUTA_TETO_DO_SEGMENTO} caracteres.`)
    .regex(SEM_CONTROLE_NO_TEXTO, 'O texto do segmento tem caractere de controle.'),
});
export type PautaSegmento = z.infer<typeof PautaSegmentoSchema>;

/** `POST /pauta/episodios/:id/transcricao` — os tempos são do vídeo FINAL. */
export const PautaTranscricaoSchema = z
  .object({
    segmentos: z
      .array(PautaSegmentoSchema)
      .min(1, 'A transcrição precisa de pelo menos um segmento.')
      .max(PAUTA_TETO_DE_SEGMENTOS, `No máximo ${PAUTA_TETO_DE_SEGMENTOS} segmentos.`),
    idioma: z.string().trim().min(2).max(10).regex(SEM_CONTROLE, 'O idioma não pode ter caractere de controle.').optional(),
    /** O modelo que transcreveu (nome do arquivo ggml), para o RASTRO. */
    modelo: z.string().trim().min(1).max(120).regex(SEM_CONTROLE, 'O modelo não pode ter caractere de controle.').optional(),
  })
  .superRefine((t, ctx) => {
    conferirOrdem(t.segmentos, ctx, 'segmentos', 'segmento', { duracaoZeroVale: true });
    const total = t.segmentos.reduce((n, s) => n + s.texto.length, 0);
    if (total > PAUTA_TETO_DA_TRANSCRICAO) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['segmentos'],
        message: `A transcrição tem ${total} caracteres; o teto é ${PAUTA_TETO_DA_TRANSCRICAO}.`,
      });
    }
  });
export type PautaTranscricaoInput = z.infer<typeof PautaTranscricaoSchema>;

/** O texto corrido da transcrição, que a voz (MC10) e a newsletter (MC13) leem. */
export function textoDaTranscricao(segmentos: ReadonlyArray<{ texto: string }>): string {
  return segmentos
    .map((s) => s.texto.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

/** `12:34` ou `1:02:03`: o tempo como a tela e a descrição do YouTube mostram. */
export function tempoDoVideo(seg: number): string {
  const t = Math.max(0, Math.floor(Number.isFinite(seg) ? seg : 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export interface PautaEpisodioPendenteDeMidia {
  id: string;
  numero: number;
  apelido: string;
  titulo: string;
  status: PautaEpisodioStatus;
  /** A palavra que vale agora (episódio > empresa > padrão): é ela que a edição procura. */
  palavraDeCorte: string;
  /** O que falta: editar e mandar a mídia, ou transcrever o vídeo final. */
  falta: 'midia' | 'transcricao';
  arquivoFinal: string | null;
  atualizadoEm: string;
  /**
   * Desde quando o episódio está no status atual (MD2; o banco carimba em toda
   * troca). O vigia do Mac só aceita bruto do OBS gravado DEPOIS disso.
   */
  statusDesde: string;
}

/** O que falta renderizar de um formato: quantas peças, e a assinatura delas (muda quando o texto ou a mídia mudam). */
export interface PautaRenderPendente {
  pecas: number;
  assinatura: string;
}

/** Um episódio na Derivação com peça da semana sem render (MD2): é o que o vigia do Mac renderiza sozinho. */
export interface PautaEpisodioPendenteDeRender {
  id: string;
  numero: number;
  apelido: string;
  titulo: string;
  status: PautaEpisodioStatus;
  statusDesde: string;
  arquivoFinal: string | null;
  precisaDeRender: Partial<Record<PautaFormatoDaSemana, PautaRenderPendente>>;
}

export interface PautaEpisodiosPendentesDeMidia {
  items: PautaEpisodioPendenteDeMidia[];
  /** Só os da Derivação com algo a renderizar (peça da transcrição atual, em rascunho ou aprovada). */
  derivacao: PautaEpisodioPendenteDeRender[];
  source: { tool: string; generatedAt: string };
}

// ---------- Pauta: o pacote do YouTube (MC11) ----------
// Da transcrição do vídeo final saem 3 títulos, a descrição com capítulos e 3
// briefs de thumb. As regras dos capítulos são do YouTube e moram aqui porque a
// tela confere a descrição com a mesma conta da API. As thumbs são renderizadas
// no Mac, num template HTML da marca (D-MC4), e sobem como PNG.

export const PAUTA_TITULOS_DO_PACOTE = 3;
export const PAUTA_THUMBS_DO_PACOTE = 3;
/** O YouTube não aceita título acima de 100 caracteres. */
export const PAUTA_TETO_DO_TITULO_DO_YOUTUBE = 100;
/** O YouTube recusa descrição acima de 5.000 bytes (não caracteres: acento conta 2). */
export const PAUTA_TETO_DA_DESCRICAO_DO_YOUTUBE = 5000;
/** A thumb se lê de relance no celular: no máximo 4 palavras. */
export const PAUTA_PALAVRAS_DA_THUMB = 4;
/** O PNG da thumb: o YouTube aceita até 2 MB. */
export const PAUTA_THUMB_MAX_BYTES = 2 * 1024 * 1024;
export const PAUTA_THUMB_LARGURA = 1280;
export const PAUTA_THUMB_ALTURA = 720;
/**
 * O lugar da página de links do episódio na descrição. O MC12 cria a página e
 * troca o marcador pela URL; até lá, quem copia a descrição é avisado.
 */
export const PAUTA_MARCADOR_DA_PAGINA_DE_LINKS = '{{pagina-de-links}}';
/**
 * A folga, em bytes, que a descrição guarda para a URL que entra no lugar do
 * marcador: a conta dos 5.000 é feita com o marcador, e a URL do MC12 tem de
 * caber aqui para a troca não estourar o teto.
 */
export const PAUTA_RESERVA_DA_PAGINA_DE_LINKS = 200;

/** O pacote sai da transcrição do final: antes do Pacote não há transcrição, depois da Derivação o vídeo já foi agendado. */
export const PAUTA_STATUS_QUE_GERAM_PACOTE = ['pacote', 'derivacao'] as const satisfies readonly PautaEpisodioStatus[];

/**
 * Depois de agendado, o pacote é o registro do que subiu: nem gerar de novo,
 * nem trocar o título marcado, nem a imagem de uma thumb. Nulo = pode mexer.
 */
export function motivoParaNaoMexerNoPacote(status: PautaEpisodioStatus): string | null {
  return status === 'agendado' || status === 'concluido'
    ? `O vídeo já foi agendado (${PAUTA_EPISODIO_STATUS_ROTULO[status]}): o pacote é o registro do que subiu.`
    : null;
}

/**
 * Sem transcrição depois da Edição, o `/root-midia` não acha o episódio (a fila
 * do Mac é Gravação e Edição): o caminho é voltar o status antes.
 */
const SEM_TRANSCRICAO_NO_PACOTE =
  'O episódio não tem transcrição do vídeo final — volte o status até Edição e rode /root-midia no Mac.';

/** Por que não dá para gerar o pacote agora, ou nulo. */
export function motivoParaNaoGerarPacote(status: PautaEpisodioStatus, segmentos: number): string | null {
  if (!(PAUTA_STATUS_QUE_GERAM_PACOTE as readonly string[]).includes(status)) {
    return (
      motivoParaNaoMexerNoPacote(status) ??
      `O pacote sai da transcrição do vídeo final, que chega no Pacote (o episódio está em ${PAUTA_EPISODIO_STATUS_ROTULO[status]}).`
    );
  }
  if (segmentos === 0) return SEM_TRANSCRICAO_NO_PACOTE;
  return null;
}

/** As regras do YouTube para os capítulos virarem marcadores no vídeo. */
export const PAUTA_MINIMO_DE_CAPITULOS = 3;
export const PAUTA_CAPITULO_MINIMO_SEG = 10;

export interface PautaCapitulo {
  inicioSeg: number;
  titulo: string;
}

/**
 * `00:00`, `12:34` ou, em vídeo de uma hora ou mais, `00:12:34` em todos — o
 * YouTube lê os dois, e a lista num formato só fica alinhada.
 */
export function tempoDoCapitulo(seg: number, comHoras = false): string {
  const t = Math.max(0, Math.floor(Number.isFinite(seg) ? seg : 0));
  const h = Math.floor(t / 3600);
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  return comHoras || h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * O que impede a lista de virar capítulos no YouTube; vazia = vale. O primeiro
 * começa em 00:00, são pelo menos 3, em ordem crescente, e cada um dura 10 s
 * ou mais — o último conta até o fim do vídeo, quando a duração é conhecida.
 */
export function conferirCapitulos(capitulos: ReadonlyArray<PautaCapitulo>, duracaoSeg?: number | null): string[] {
  const erros: string[] = [];
  if (capitulos.length < PAUTA_MINIMO_DE_CAPITULOS) {
    erros.push(`São ${capitulos.length} capítulo(s); o YouTube pede pelo menos ${PAUTA_MINIMO_DE_CAPITULOS}.`);
  }
  if (capitulos.length && Math.floor(capitulos[0].inicioSeg) !== 0) {
    erros.push(`O primeiro capítulo começa em ${tempoDoCapitulo(capitulos[0].inicioSeg)}; tem de ser 00:00.`);
  }
  capitulos.forEach((c, i) => {
    if (!c.titulo.trim()) erros.push(`O capítulo ${i + 1} está sem título.`);
    if (i === 0) return;
    const antes = capitulos[i - 1];
    if (Math.floor(c.inicioSeg) <= Math.floor(antes.inicioSeg)) {
      erros.push(`O capítulo ${i + 1} (${tempoDoCapitulo(c.inicioSeg)}) não vem depois do anterior.`);
    } else if (Math.floor(c.inicioSeg) - Math.floor(antes.inicioSeg) < PAUTA_CAPITULO_MINIMO_SEG) {
      erros.push(`O capítulo ${i} (${tempoDoCapitulo(antes.inicioSeg)}) dura menos de ${PAUTA_CAPITULO_MINIMO_SEG} s.`);
    }
  });
  const ultimo = capitulos[capitulos.length - 1];
  if (ultimo && typeof duracaoSeg === 'number' && Number.isFinite(duracaoSeg) && duracaoSeg - ultimo.inicioSeg < PAUTA_CAPITULO_MINIMO_SEG) {
    erros.push(`O último capítulo (${tempoDoCapitulo(ultimo.inicioSeg)}) dura menos de ${PAUTA_CAPITULO_MINIMO_SEG} s até o fim do vídeo.`);
  }
  return erros;
}

/** As linhas `00:00 Título` da descrição, num formato só. */
export function linhasDosCapitulos(capitulos: ReadonlyArray<PautaCapitulo>, duracaoSeg?: number | null): string[] {
  const comHoras = capitulos.some((c) => c.inicioSeg >= 3600) || (typeof duracaoSeg === 'number' && duracaoSeg >= 3600);
  return capitulos.map((c) => `${tempoDoCapitulo(c.inicioSeg, comHoras)} ${c.titulo}`);
}

const LINHA_DE_CAPITULO = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(\S.*)$/;

/**
 * Os capítulos que o YouTube leria da descrição: as linhas que começam por um
 * tempo. Serve para a tela conferir a descrição que está gravada.
 */
export function capitulosDaDescricao(descricao: string): PautaCapitulo[] {
  const saida: PautaCapitulo[] = [];
  for (const linha of String(descricao ?? '').split(/\r?\n/)) {
    const m = LINHA_DE_CAPITULO.exec(linha.trim());
    if (!m || Number(m[3]) > 59 || (m[1] !== undefined && Number(m[2]) > 59)) continue;
    saida.push({ inicioSeg: Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]), titulo: m[4].trim() });
  }
  return saida;
}

/**
 * A descrição pronta para colar: com a URL da página de links (MC12), ou como
 * está. A URL cabe na folga de `PAUTA_RESERVA_DA_PAGINA_DE_LINKS` bytes — folga
 * para UMA URL, então só a última ocorrência (a linha que a montagem pôs, antes
 * das hashtags) é trocada: um marcador vindo de texto de fora não multiplica a
 * URL e não empurra a descrição para além do teto do YouTube.
 */
export function descricaoComPaginaDeLinks(descricao: string, url: string | null | undefined): string {
  const u = (url ?? '').trim();
  const i = descricao.lastIndexOf(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS);
  if (!u || i < 0) return descricao;
  return descricao.slice(0, i) + u + descricao.slice(i + PAUTA_MARCADOR_DA_PAGINA_DE_LINKS.length);
}

export interface PautaTituloDoPacote {
  texto: string;
  /** O ângulo que o título explora (curiosidade, resultado, lista…). */
  angulo: string;
  escolhido: boolean;
}

export interface PautaImagemDaThumb {
  bytes: number;
  largura: number;
  altura: number;
  enviadaEm: string;
}

export interface PautaThumbDoPacote {
  /** 1 a 3: o número da thumb na rota de envio. */
  n: number;
  /** Até 4 palavras. */
  texto: string;
  /** A palavra do texto que vai na cor de acento. */
  destaque: string;
  /** O frame sugerido, em segundos do vídeo final. */
  tempoSeg: number;
  /** A imagem que o Mac renderizou e subiu; nula até lá. */
  imagem: PautaImagemDaThumb | null;
}

function textoCurto(v: unknown, teto: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, teto) : '';
}

/** Os títulos guardados no JSON do episódio; o que não tiver a forma fica de fora. */
export function titulosDoPacote(valor: unknown): PautaTituloDoPacote[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof (t as { texto?: unknown }).texto === 'string')
    .map((t) => ({
      texto: textoCurto(t.texto, PAUTA_TETO_DO_TITULO_DO_YOUTUBE),
      angulo: textoCurto(t.angulo, 60),
      escolhido: t.escolhido === true,
    }))
    .filter((t) => t.texto);
}

/** Os briefs guardados; a chave do storage fica no banco e não sai para a tela. */
export function thumbsDoPacote(valor: unknown): PautaThumbDoPacote[] {
  if (!Array.isArray(valor)) return [];
  const saida: PautaThumbDoPacote[] = [];
  for (const t of valor) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    const n = Number(r.n);
    const tempoSeg = Number(r.tempoSeg);
    if (!Number.isInteger(n) || n < 1 || n > PAUTA_THUMBS_DO_PACOTE || !Number.isFinite(tempoSeg)) continue;
    const texto = textoCurto(r.texto, 60);
    if (!texto) continue;
    const img = r.imagem && typeof r.imagem === 'object' ? (r.imagem as Record<string, unknown>) : null;
    saida.push({
      n,
      texto,
      destaque: textoCurto(r.destaque, 60),
      tempoSeg: Math.max(0, tempoSeg),
      imagem:
        img && typeof img.enviadaEm === 'string' && Number.isFinite(Number(img.bytes))
          ? { bytes: Number(img.bytes), largura: Number(img.largura) || 0, altura: Number(img.altura) || 0, enviadaEm: img.enviadaEm }
          : null,
    });
  }
  return saida;
}

export const PautaPacoteGerarSchema = z.object({
  /** O episódio já tem pacote: gerar de novo só com a confirmação (as imagens das thumbs saem junto). */
  substituir: z.boolean().default(false),
});
export type PautaPacoteGerarInput = z.infer<typeof PautaPacoteGerarSchema>;

/** `null` desmarca: nenhum título escolhido. */
export const PautaTituloEscolhidoSchema = z.object({
  n: z.number().int().min(1).max(PAUTA_TITULOS_DO_PACOTE).nullable(),
});
export type PautaTituloEscolhidoInput = z.infer<typeof PautaTituloEscolhidoSchema>;

/** O `:n` da rota da thumb. */
export const PautaNumeroDaThumbSchema = z.coerce
  .number({ invalid_type_error: 'A thumb é 1, 2 ou 3.' })
  .int('A thumb é 1, 2 ou 3.')
  .min(1, 'A thumb é 1, 2 ou 3.')
  .max(PAUTA_THUMBS_DO_PACOTE, 'A thumb é 1, 2 ou 3.');

/** `GET /pauta/episodios/:id/thumbs` — o que o Mac precisa para renderizar. */
export interface PautaThumbsParaRender {
  episodioId: string;
  apelido: string;
  titulo: string;
  status: PautaEpisodioStatus;
  /** O vídeo final no Mac, de onde sai o frame; nulo sem mídia. */
  arquivoFinal: string | null;
  duracaoSeg: number | null;
  thumbs: Array<Omit<PautaThumbDoPacote, 'imagem'> & { tempo: string; temImagem: boolean }>;
}

/** `POST /pauta/episodios/:id/pacote/gerar`: o episódio e o que o sistema consertou ou recusou. */
export interface PautaPacoteGerado {
  episodio: PautaEpisodioDetalhe;
  /** Capítulos recusados (a descrição saiu sem eles), com o motivo. */
  avisos: string[];
  /** O que foi consertado no que a IA devolveu (tempos, ordem, texto de thumb longo). */
  correcoes: string[];
}

// ---------- Pauta: a página de links do episódio (MC12) ----------
// Uma BioPage por episódio no bio.operacaoroot.com, com um botão por matéria
// mantida que tem link público (nunca o permalink da newsletter) e os links de
// chamada da casa. O clique segue o caminho de sempre da bio: /r/:linkId →
// BioEvent + PixelEvent.

/**
 * As notas da memória com os links de chamada da casa, lidas em ordem (só
 * leitura; a nota se cria por `POST /memoria`, caminho da ADR-011). Uma linha
 * por link: `Rótulo | https://…`, `[Rótulo](https://…)` ou só a URL.
 */
export const PAUTA_CHAVES_DOS_LINKS_DA_CASA = ['pauta.pagina-de-links.chamadas', 'operador:links-da-casa'] as const;
export const PAUTA_MAXIMO_DE_LINKS_DA_CASA = 5;

/** De onde veio o botão: matéria do episódio, chamada da casa ou o painel da bio. */
export const PAUTA_ORIGENS_DO_LINK_DA_PAGINA = ['item', 'casa', 'painel'] as const;
export type PautaOrigemDoLinkDaPagina = (typeof PAUTA_ORIGENS_DO_LINK_DA_PAGINA)[number];

export interface PautaLinkDaPagina {
  id: string;
  rotulo: string;
  destino: string;
  ativo: boolean;
  origem: PautaOrigemDoLinkDaPagina;
}

export interface PautaPaginaDeLinks {
  id: string;
  handle: string;
  /** O endereço público (`<origem da bio>/@handle`), o que entra na descrição. */
  url: string;
  titulo: string;
  /** Rascunho responde 404 lá fora; a descrição só aponta para página publicada. */
  publicada: boolean;
  links: PautaLinkDaPagina[];
}

/** `POST /pauta/episodios/:id/pagina-de-links/publicar`. */
export const PautaPaginaDeLinksPublicarSchema = z.object({ publicada: z.boolean() });
export type PautaPaginaDeLinksPublicarInput = z.infer<typeof PautaPaginaDeLinksPublicarSchema>;

/** `POST /pauta/episodios/:id/pagina-de-links`: o episódio e a conta do que mudou na página. */
export interface PautaPaginaDeLinksMontada {
  episodio: PautaEpisodioDetalhe;
  criados: number;
  atualizados: number;
  /** Botões que a montagem anterior pôs e esta não pôs mais: saem da página, o histórico de cliques fica. */
  desativados: number;
  /** O que ficou de fora e por quê (newsletter, link longo demais, nota da casa ilegível). */
  avisos: string[];
}

// ---------- Pauta: a voz do autor (MC10) ----------
// O perfil de voz é uma nota da MEMÓRIA (kind `definicao`), escrita só pelo
// caminho da ADR-011: cada perfil novo é uma VERSÃO da mesma nota, e as
// anteriores ficam no histórico. Os prompts que escrevem (roteiro e peças)
// recebem o perfil; sem ele, o tom da casa.

/** A chave da nota com o perfil, quando a empresa não escolheu outra. */
export const PAUTA_CHAVE_DA_VOZ_PADRAO = 'voz.pedro';

/**
 * A nota que guarda QUAL chave a empresa usa (a primeira linha é a chave). Ela
 * mesma é memória, pelo caminho da ADR-011 — a configuração tem histórico.
 */
export const PAUTA_CHAVE_DA_CHAVE_DA_VOZ = 'pauta.voz.chave';

/**
 * A chave da voz mora sob `voz.`: quem só tem `pauta.editar` escreve o perfil,
 * e a chave presa ao prefixo impede que "aprender" sobrescreva uma regra da
 * casa escolhendo a chave dela.
 */
export const PAUTA_TETO_DA_CHAVE_DA_VOZ = 63;
export const PautaChaveDaVozSchema = z
  .string()
  .trim()
  .max(PAUTA_TETO_DA_CHAVE_DA_VOZ)
  .regex(
    /^voz\.[a-z0-9][a-z0-9-]{0,58}$/,
    'A chave da voz começa com "voz." e segue com letras minúsculas, números e hífen (ex.: voz.pedro).',
  );

/** Regras de marca da ROOT que valem com ou sem perfil (brand kit e prompts da casa). */
export const PAUTA_VOZ_PALAVRAS_PROIBIDAS = [
  'alavancar',
  'potencializar',
  'solução completa',
  'disruptivo',
  'sinergia',
  'mindset',
  'jornada de transformação',
] as const;

/**
 * As regras da casa que o perfil do autor NÃO substitui: o tom da casa sem as
 * linhas de estilo (frase curta, para quem toca o negócio), que o perfil troca.
 */
export const PAUTA_VOZ_REGRAS_DA_MARCA: readonly string[] = [
  `Nunca usar: ${PAUTA_VOZ_PALAVRAS_PROIBIDAS.map((p) => `"${p}"`).join(', ')} — nem as variações.`,
  'Sem emoji.',
  'Sem "no mundo da IA" e sem jargão de palco.',
  'Não promete o que a matéria não sustenta.',
];

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// O radical pega a conjugação ("alavancando", "potencializa", "disruptiva").
const RADICAIS_PROIBIDOS: ReadonlyArray<{ palavra: (typeof PAUTA_VOZ_PALAVRAS_PROIBIDAS)[number]; re: RegExp }> = [
  { palavra: 'alavancar', re: /\balavanc\w*/ },
  { palavra: 'potencializar', re: /\bpotencializ\w*/ },
  { palavra: 'solução completa', re: /\bsolucao completa\b/ },
  { palavra: 'disruptivo', re: /\bdisrupt\w*/ },
  { palavra: 'sinergia', re: /\bsinergi\w*/ },
  { palavra: 'mindset', re: /\bmindsets?\b/ },
  { palavra: 'jornada de transformação', re: /\bjornada de transformacao\b/ },
];

/** As palavras proibidas que aparecem no texto (sem acento, sem caixa). */
export function palavrasProibidasEm(texto: string): string[] {
  const t = semAcento(String(texto ?? '')).replace(/\s+/g, ' ');
  return RADICAIS_PROIBIDOS.filter((r) => r.re.test(t)).map((r) => r.palavra);
}

/** Teto do perfil: voz é instrução curta, não acervo. É o que entra no prompt. */
export const PAUTA_TETO_DO_PERFIL_DE_VOZ = 4_000;
/** Abaixo disso não é perfil, é um lembrete. */
export const PAUTA_PISO_DO_PERFIL_DE_VOZ = 80;
export const PAUTA_TETO_DE_EPISODIOS_DA_VOZ = 6;
export const PAUTA_TETO_DE_TEXTOS_DA_VOZ = 5;
/** Um texto colado: de um parágrafo de verdade a um artigo longo. */
export const PAUTA_PISO_DO_TEXTO_DA_VOZ = 200;
export const PAUTA_TETO_DO_TEXTO_DA_VOZ = 20_000;
/** O que vai ao modelo, somadas as fontes; o excedente é cortado e a procedência diz. */
export const PAUTA_TETO_DO_MATERIAL_DA_VOZ = 60_000;
/**
 * A soma dos textos colados. O corpo JSON da API morre em 100 kb (body-parser
 * do Nest) antes do esquema; 60 mil caracteres de português cabem com folga
 * para acento e escape, e acima disso o material seria cortado de todo jeito.
 */
export const PAUTA_TETO_DOS_TEXTOS_DA_VOZ = PAUTA_TETO_DO_MATERIAL_DA_VOZ;

/** `POST /pauta/voz/aprender`: episódios transcritos e/ou textos colados. */
export const PautaVozAprenderSchema = z
  .object({
    episodios: z
      .array(z.string().uuid('Episódio inválido.'))
      .max(PAUTA_TETO_DE_EPISODIOS_DA_VOZ, `No máximo ${PAUTA_TETO_DE_EPISODIOS_DA_VOZ} episódios por vez.`)
      .default([]),
    textos: z
      .array(
        z.object({
          titulo: z
            .string()
            .trim()
            .max(120, 'O título do texto tem no máximo 120 caracteres.')
            .regex(/^[^\u0000-\u001f\u007f]*$/, 'O título é uma linha só.')
            .optional(),
          texto: z
            .string()
            .trim()
            .min(PAUTA_PISO_DO_TEXTO_DA_VOZ, `Cada texto precisa de pelo menos ${PAUTA_PISO_DO_TEXTO_DA_VOZ} caracteres.`)
            .max(PAUTA_TETO_DO_TEXTO_DA_VOZ, `Cada texto tem no máximo ${PAUTA_TETO_DO_TEXTO_DA_VOZ} caracteres.`)
            .regex(SEM_CONTROLE_NO_TEXTO, 'O texto tem caractere de controle.'),
        }),
      )
      .max(PAUTA_TETO_DE_TEXTOS_DA_VOZ, `No máximo ${PAUTA_TETO_DE_TEXTOS_DA_VOZ} textos por vez.`)
      .default([]),
  })
  .superRefine((v, ctx) => {
    if (!v.episodios.length && !v.textos.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['episodios'],
        message: 'Escolha ao menos um episódio transcrito ou cole um texto.',
      });
    }
    if (new Set(v.episodios).size !== v.episodios.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['episodios'], message: 'Episódio repetido.' });
    }
    const soma = v.textos.reduce((s, t) => s + t.texto.length, 0);
    if (soma > PAUTA_TETO_DOS_TEXTOS_DA_VOZ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['textos'],
        message: `Os textos somam no máximo ${PAUTA_TETO_DOS_TEXTOS_DA_VOZ / 1000} mil caracteres.`,
      });
    }
  });
export type PautaVozAprenderInput = z.infer<typeof PautaVozAprenderSchema>;

/** `PUT /pauta/voz`: a edição à mão, que vira uma versão nova da nota. */
export const PautaVozSalvarSchema = z.object({
  perfil: z
    .string()
    .trim()
    .min(PAUTA_PISO_DO_PERFIL_DE_VOZ, `O perfil precisa de pelo menos ${PAUTA_PISO_DO_PERFIL_DE_VOZ} caracteres.`)
    .max(PAUTA_TETO_DO_PERFIL_DE_VOZ, `O perfil tem no máximo ${PAUTA_TETO_DO_PERFIL_DE_VOZ} caracteres.`)
    .regex(SEM_CONTROLE_NO_TEXTO, 'O perfil tem caractere de controle.'),
  /** A versão da nota que a tela leu: diferente da atual é outra aba (409). */
  versao: z.number().int().min(1).optional(),
  /** A chave que a tela leu: trocada no meio da edição, o rascunho é de outra nota (409). */
  chave: PautaChaveDaVozSchema.optional(),
  motivo: z.string().trim().max(300).regex(/^[^\u0000-\u001f\u007f]*$/, 'O motivo é uma linha só.').optional(),
});
export type PautaVozSalvarInput = z.infer<typeof PautaVozSalvarSchema>;

export const PautaVozChaveSchema = z.object({ chave: PautaChaveDaVozSchema });
export type PautaVozChaveInput = z.infer<typeof PautaVozChaveSchema>;

export interface PautaVozVersao {
  versao: number;
  mudanca: string;
  procedencia: string;
  motivo: string | null;
  criadoEm: string;
}

export interface PautaVozPainel {
  chave: string;
  origemDaChave: 'empresa' | 'padrao';
  /** A nota vigente. Arquivada conta como sem perfil: os prompts caem no tom da casa. */
  perfil: {
    id: string;
    corpo: string;
    versao: number;
    procedencia: string;
    sourceType: string;
    sourceRef: string | null;
    atualizadoEm: string;
    arquivado: boolean;
  } | null;
  /** As últimas versões, da mais nova para a mais velha. */
  historico: PautaVozVersao[];
  regrasDaMarca: readonly string[];
  /** Os episódios com transcrição, de onde a voz pode aprender. */
  episodios: Array<{ id: string; apelido: string; titulo: string; caracteres: number }>;
  iaConfigurada: boolean;
}

export interface PautaVozAprendida extends PautaVozPainel {
  material: { fontes: number; caracteres: number; cortado: boolean };
}

// ---------- Pauta: a marca e os pilares (MK1) ----------
// A voz (MC10) diz COMO a casa fala. A marca diz QUEM ela é e sobre O QUE fala:
// quem somos, como falamos, o que queremos, o que rejeitamos, público e
// diretrizes; e os pilares, que são os assuntos que se repetem.
//
// As duas são NOTA DA MEMÓRIA, como a voz e como a grade da semana
// (`pauta.semana.grade`): escrita só por `MemoriaService` (caminho da ADR-011,
// com evento no RASTRO e versão), leitura por `porChave`. Nenhuma tabela nova —
// isto é configuração que uma pessoa edita e lê, não registro que o sistema
// acumula. E, como a voz, o corpo é CONTEÚDO EXTERNO: passa por
// `neutralizarConteudoExterno` antes de chegar ao modelo.
//
// Os pilares moram em nota separada da marca de propósito: o perfil da marca é
// prosa que muda devagar, e os pilares são uma lista que muda com a estratégia
// do mês (MK4). Juntá-los faria uma edição de rotina reescrever a outra.

/** O perfil da marca: prosa em seções fixas. */
export const PAUTA_CHAVE_DA_MARCA = 'pauta.marca';
/** Os pilares: uma linha por pilar. */
export const PAUTA_CHAVE_DOS_PILARES = 'pauta.marca.pilares';

/** As seções do perfil, na ordem em que o prompt as recebe. */
export const PAUTA_SECOES_DA_MARCA = [
  'Quem somos',
  'Como falamos',
  'O que queremos',
  'O que rejeitamos',
  'Público',
  'Diretrizes',
] as const;
export type PautaSecaoDaMarca = (typeof PAUTA_SECOES_DA_MARCA)[number];

/** Teto do que entra no prompt: a marca é instrução curta, não manual. */
export const PAUTA_TETO_DO_PERFIL_DA_MARCA = 4_000;
/** Abaixo disso não é perfil de marca, é um lembrete. */
export const PAUTA_PISO_DO_PERFIL_DA_MARCA = 80;
/** Mais que isto não é pilar, é lista de assuntos: o prompt perde o foco. */
export const PAUTA_TETO_DE_PILARES = 8;
export const PAUTA_TETO_DO_NOME_DO_PILAR = 40;
export const PAUTA_TETO_DA_DESCRICAO_DO_PILAR = 240;
/** A nota inteira, com folga para oito linhas cheias e comentários. */
export const PAUTA_TETO_DO_TEXTO_DOS_PILARES = 4_000;

/**
 * As cores que um pilar sem cor declarada recebe, na ordem. São as da marca
 * ROOT (as mesmas do `:root` do app que virou o modelo desta frente), para a
 * etiqueta do pilar sair igual no banco de ideias (MK3) e na performance (MK5).
 */
export const PAUTA_CORES_DOS_PILARES = [
  '#9bdb1f',
  '#ff1f6b',
  '#1fffa8',
  '#c4ff2e',
  '#8aa48f',
  '#e0a63a',
  '#5a7344',
  '#b8d4be',
] as const;

export interface PautaPilar {
  /** Como a pessoa escreveu. */
  nome: string;
  /** Estável, sem acento e sem caixa: é o que casa pilar de post com pilar da lista. */
  chave: string;
  /** `#rrggbb`, sempre em minúscula. */
  cor: string;
  descricao: string;
}

/** A chave estável de um pilar. Acento e caixa não podem criar um pilar novo. */
export function chaveDoPilar(nome: string): string {
  return semAcento(String(nome ?? ''))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PAUTA_TETO_DO_NOME_DO_PILAR);
}

const COR_DO_PILAR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` vira `#aabbcc`: o resto do sistema compara e guarda uma forma só. */
function corNormalizada(c: string): string | null {
  const v = c.trim().toLowerCase();
  if (!COR_DO_PILAR.test(v)) return null;
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}

/**
 * Lê os pilares da nota. Uma linha por pilar, `Nome | cor | descrição`; a cor e
 * a descrição são opcionais e a cor sem elas vem da paleta, pela posição.
 * Linha vazia e linha que começa com `//` são ignoradas (é nota que gente
 * edita, e gente comenta).
 *
 * Nada aqui LANÇA: nota malfeita não pode derrubar a geração de um roteiro. O
 * que não deu para ler vira aviso, e quem chama decide se mostra ou se cai no
 * padrão — mesma escolha que `gradeDaNota` faz com a grade da semana.
 */
export function lerPilaresDoTexto(texto: string): { pilares: PautaPilar[]; avisos: string[] } {
  const avisos: string[] = [];
  const pilares: PautaPilar[] = [];
  const vistos = new Set<string>();
  const linhas = String(texto ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'));

  for (const linha of linhas) {
    if (pilares.length >= PAUTA_TETO_DE_PILARES) {
      avisos.push(`A lista passa de ${PAUTA_TETO_DE_PILARES} pilares: as linhas seguintes ficaram de fora.`);
      break;
    }
    const [bruto = '', corBruta = '', ...resto] = linha.split('|');
    const nome = bruto.trim().replace(/\s+/g, ' ').slice(0, PAUTA_TETO_DO_NOME_DO_PILAR);
    if (!nome) {
      avisos.push(`Uma linha começa sem nome de pilar e ficou de fora: "${linha.slice(0, 60)}".`);
      continue;
    }
    const chave = chaveDoPilar(nome);
    if (!chave) {
      avisos.push(`O pilar "${nome}" não tem letra nem número no nome e ficou de fora.`);
      continue;
    }
    if (vistos.has(chave)) {
      avisos.push(`O pilar "${nome}" aparece mais de uma vez: vale a primeira linha.`);
      continue;
    }
    // Sem "|" nenhum, a linha inteira é o nome — e aí não há cor nem descrição
    // para ler. Com um "|" só, o segundo campo é cor se parecer cor, senão é a
    // descrição: quem escreve "Bastidores | como a Root trabalha" quis descrever.
    let cor = corNormalizada(corBruta);
    let descricao = resto.join('|').trim();
    if (!cor && corBruta.trim()) {
      if (corBruta.trim().startsWith('#')) {
        avisos.push(`A cor do pilar "${nome}" não é um código hexadecimal (ex.: #9bdb1f): vale a cor da paleta.`);
      } else {
        descricao = [corBruta.trim(), descricao].filter(Boolean).join(' ').trim();
      }
    }
    cor = cor ?? PAUTA_CORES_DOS_PILARES[pilares.length % PAUTA_CORES_DOS_PILARES.length];
    vistos.add(chave);
    pilares.push({
      nome,
      chave,
      cor,
      descricao: descricao.replace(/\s+/g, ' ').slice(0, PAUTA_TETO_DA_DESCRICAO_DO_PILAR),
    });
  }
  return { pilares, avisos };
}

/** `PUT /pauta/marca`: o perfil escrito à mão, com a versão de onde a aba partiu. */
export const PautaMarcaSalvarSchema = z.object({
  perfil: z
    .string()
    .trim()
    .min(PAUTA_PISO_DO_PERFIL_DA_MARCA, `O perfil da marca precisa de pelo menos ${PAUTA_PISO_DO_PERFIL_DA_MARCA} caracteres.`)
    .max(PAUTA_TETO_DO_PERFIL_DA_MARCA, `O perfil da marca tem no máximo ${PAUTA_TETO_DO_PERFIL_DA_MARCA} caracteres.`),
  versao: z.number().int().positive().optional(),
});
export type PautaMarcaSalvarInput = z.infer<typeof PautaMarcaSalvarSchema>;

/** `PUT /pauta/marca/pilares`: a nota dos pilares como a pessoa a escreveu. */
export const PautaPilaresSalvarSchema = z.object({
  pilares: z
    .string()
    .trim()
    .max(PAUTA_TETO_DO_TEXTO_DOS_PILARES, `A lista de pilares tem no máximo ${PAUTA_TETO_DO_TEXTO_DOS_PILARES} caracteres.`),
  versao: z.number().int().positive().optional(),
});
export type PautaPilaresSalvarInput = z.infer<typeof PautaPilaresSalvarSchema>;

export const PautaMarcaDestinoSchema = z.enum(['perfil', 'pilares']);
export type PautaMarcaDestino = z.infer<typeof PautaMarcaDestinoSchema>;
export interface PautaMarcaSecaoUsada { titulo: string; hash: string }

/** A prévia e o pedido carregam o estado exato que a memória deve reencontrar sob lock. */
export const PautaMarcaAplicarSchema = z.object({
  fonteContextItemId: z.string().uuid(),
  fonteVersao: z.number().int().positive(),
  fonteHash: z.string().regex(/^[a-f0-9]{64}$/),
  destinoContextItemId: z.string().uuid().nullable(),
  destinoVersao: z.number().int().positive().nullable(),
  destinoHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  secoesUsadas: z.array(z.object({ titulo: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(8),
  textoFinal: z.string().max(PAUTA_TETO_DO_PERFIL_DA_MARCA),
});
export type PautaMarcaAplicarInput = z.infer<typeof PautaMarcaAplicarSchema>;

export interface PautaMarcaPrevia {
  destino: PautaMarcaDestino;
  fonteContextItemId: string | null;
  fonteChave: string;
  fonteVersao: number | null;
  fonteHash: string | null;
  secoesUsadas: PautaMarcaSecaoUsada[];
  textoProposto: string;
  destinoContextItemId: string | null;
  destinoVersao: number | null;
  destinoHash: string | null;
  textoAtual: string;
  diferenca: boolean;
  estado: 'pronto' | 'fonte_ausente' | 'fonte_arquivada' | 'excede_limite' | 'destino_alterado' | 'fonte_alterada' | 'ja_aplicado';
  aviso: string | null;
}

export interface PautaMarcaVinculo {
  versaoDestino: number;
  fonteContextItemId: string;
  fonteChave: string;
  fonteVersao: number;
  fonteHash: string;
  secoesUsadas: PautaMarcaSecaoUsada[];
  atual: boolean;
}

export interface PautaMarcaPainel {
  perfil: string | null;
  perfilVersao: number | null;
  perfilAtualizadoEm: string | null;
  /** O texto cru da nota, que é o que a aba edita. */
  pilaresTexto: string;
  pilaresVersao: number | null;
  pilares: PautaPilar[];
  /** O que a leitura da nota não entendeu. Vazio quando está tudo lido. */
  avisos: string[];
  /** O que os prompts da pauta recebem agora — a prova visível do ponto único. */
  bloco: string;
  /** Último vínculo aplicado por destino; atual=false após edição ou arquivamento. */
  projecoes: { perfil: PautaMarcaVinculo | null; pilares: PautaMarcaVinculo | null };
}

// ---------- Pauta: concorrentes com números (MK2) ----------
// O acervo de referências (`/referencias`) diz o que um perfil publica. O que
// faltava é o NÚMERO: qual post daquele perfil rendeu, e quanto.
//
// A régua é a MEDIANA DO PRÓPRIO PERFIL, nunca um número absoluto nem a
// comparação entre perfis. Um perfil de 500 mil seguidores e um de 5 mil não se
// comparam por visualização; o que se compara é cada post contra o que aquele
// perfil costuma fazer. Mediana e não média porque um viral só move a média e
// esconde o resto — é justamente o post que se quer achar.
//
// Estas contas moram no shared porque a tela mostra o mesmo índice que a API
// calcula, e duas contas em dois lugares viram dois números.

export interface PautaMetricasDoPost {
  visualizacoes: number | null;
  curtidas: number | null;
  comentarios: number | null;
  compartilhamentos: number | null;
  duracaoSeg: number | null;
}

/** As métricas que ganham mediana e índice. Duração descreve, não mede alcance. */
export const PAUTA_METRICAS_DO_CONCORRENTE = ['visualizacoes', 'curtidas', 'comentarios', 'compartilhamentos'] as const;
export type PautaMetricaDoConcorrente = (typeof PAUTA_METRICAS_DO_CONCORRENTE)[number];

/**
 * Abaixo disto a mediana não diz nada: com três posts, o índice é ruído com
 * cara de medida. A análise devolve o índice nulo e a tela diz que falta post.
 */
export const PAUTA_PISO_DE_POSTS_DO_INDICE = 5;

/** A partir daqui o post estourou para o tamanho daquele perfil. */
export const PAUTA_INDICE_ESTOUROU = 2;
export const PAUTA_INDICE_ACIMA = 1.2;
export const PAUTA_INDICE_ABAIXO = 0.5;

export type PautaFaixaDoIndice = 'estourou' | 'acima' | 'na-media' | 'abaixo';

/** A mediana, ignorando o que não é número. Nulo quando não sobrou nada. */
export function medianaDe(ns: ReadonlyArray<number | null | undefined>): number | null {
  const v = ns.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

/**
 * Quantas vezes a mediana do próprio perfil o post fez. Mediana zero devolve
 * nulo em vez de infinito: um perfil cuja mediana é zero não tem régua.
 */
export function indiceDoPost(valor: number | null | undefined, mediana: number | null): number | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
  if (mediana === null || mediana <= 0) return null;
  return Math.round((valor / mediana) * 100) / 100;
}

export function faixaDoIndice(indice: number | null): PautaFaixaDoIndice | null {
  if (indice === null) return null;
  if (indice >= PAUTA_INDICE_ESTOUROU) return 'estourou';
  if (indice >= PAUTA_INDICE_ACIMA) return 'acima';
  if (indice < PAUTA_INDICE_ABAIXO) return 'abaixo';
  return 'na-media';
}

/** Quantos posts do perfil vão ao modelo no dossiê. O prompt lê recorte, não acervo. */
export const PAUTA_TETO_DE_POSTS_DO_DOSSIE = 20;
export const PAUTA_TETO_DA_LEGENDA_NO_DOSSIE = 600;

export interface PautaPostDeConcorrente {
  capturaId: string;
  url: string;
  titulo: string;
  legenda: string;
  publicadoEm: string | null;
  metricas: PautaMetricasDoPost;
  /** Por métrica, quantas vezes a mediana do perfil. Nulo onde não deu para medir. */
  indices: Record<PautaMetricaDoConcorrente, number | null>;
  /** A faixa da métrica de referência do perfil (visualizações, ou curtidas quando não há). */
  faixa: PautaFaixaDoIndice | null;
}

export interface PautaAnaliseDoConcorrente {
  fonteId: string;
  plataforma: string;
  handle: string;
  posts: PautaPostDeConcorrente[];
  medianas: Record<PautaMetricaDoConcorrente, number | null>;
  /** A métrica pela qual o perfil foi medido; nula quando nenhuma tinha número. */
  metricaDeReferencia: PautaMetricaDoConcorrente | null;
  /** Quantos posts entraram na conta, e se deu para medir. */
  postsContados: number;
  medivel: boolean;
  /** O que a leitura não conseguiu: fonte sem post, sem métrica, poucos posts. */
  avisos: string[];
}

export interface PautaDossieDoConcorrente {
  oQueRende: string;
  aberturas: string[];
  assuntos: string[];
  ctas: string[];
  oQueAproveitar: string[];
  geradoEm: string;
  modelo: string;
}

// ---------- Pauta: a estratégia do mês (MK4) ----------
// Um documento por mês: os pilares da vez, a cadência, as metas, as apostas e o
// que parar. A IA propõe a partir do que a casa é (MK1), do que os concorrentes
// fizeram (MK2) e do que foi publicado no mês anterior; uma pessoa edita.
//
// É NOTA DA MEMÓRIA, uma por mês (`pauta.estrategia.2026-09`), pelo mesmo
// caminho da voz e da marca. Um mês é um documento que alguém escreve e revisa,
// não registro que o sistema acumula — e a nota já dá versão, histórico e
// RASTRO. A chave leva o mês porque o histórico da nota guarda as VERSÕES
// daquele mês; misturar meses na mesma nota perderia o de antes.

export const PAUTA_PREFIXO_DA_ESTRATEGIA = 'pauta.estrategia.';

/** `AAAA-MM`. O mês é a identidade do documento. */
export const PautaMesSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'O mês é AAAA-MM (ex.: 2026-09).');

export function chaveDaEstrategia(mes: string): string {
  return `${PAUTA_PREFIXO_DA_ESTRATEGIA}${mes}`;
}

/** O mês de uma chave de estratégia, ou nulo quando a chave não é de uma. */
export function mesDaChaveDaEstrategia(chave: string): string | null {
  if (!chave.startsWith(PAUTA_PREFIXO_DA_ESTRATEGIA)) return null;
  const mes = chave.slice(PAUTA_PREFIXO_DA_ESTRATEGIA.length);
  return PautaMesSchema.safeParse(mes).success ? mes : null;
}

/** As seções do documento, na ordem em que são escritas e lidas. */
export const PAUTA_SECOES_DA_ESTRATEGIA = [
  'Pilares da vez',
  'Cadência',
  'Metas',
  'Apostas',
  'O que parar',
] as const;

export const PAUTA_TETO_DA_ESTRATEGIA = 6_000;
export const PAUTA_TETO_DE_ITENS_DA_ESTRATEGIA = 6;

export interface PautaEstrategiaDaIa {
  pilaresDaVez: string[];
  cadencia: string;
  metas: string[];
  apostas: string[];
  oQueParar: string[];
}

export interface PautaEstrategiaDoMes {
  mes: string;
  /** O markdown, que é o que a pessoa edita. */
  documento: string;
  versao: number | null;
  atualizadoEm: string | null;
  /** `operador` quando alguém escreveu à mão, `promocao` quando veio da IA. */
  origem: string | null;
}

export interface PautaEstrategiaPainel extends PautaEstrategiaDoMes {
  /** Os meses que já têm documento, do mais novo para o mais velho. */
  meses: string[];
  /** O que faltou para a IA propor (sem marca, sem pilar, sem mês publicado). */
  avisos: string[];
  iaConfigurada: boolean;
}

/** `PUT /pauta/estrategia/:mes`. */
export const PautaEstrategiaSalvarSchema = z.object({
  documento: z
    .string()
    .trim()
    .min(1, 'A estratégia do mês não pode ficar vazia.')
    .max(PAUTA_TETO_DA_ESTRATEGIA, `A estratégia tem no máximo ${PAUTA_TETO_DA_ESTRATEGIA} caracteres.`),
  versao: z.number().int().positive().optional(),
});
export type PautaEstrategiaSalvarInput = z.infer<typeof PautaEstrategiaSalvarSchema>;

// ---------- Pauta: o relatório do mês (MK6) ----------
// O fechamento de um mês em markdown: o que foi ao ar, o que foi decidido, como
// rendeu, o que vem e a estratégia que valia. Nota da memória por mês, como a
// estratégia (MK4) — mesmo motivo e mesmo caminho da ADR-011.
//
// OS NÚMEROS SÃO DO SISTEMA, A NARRATIVA É DA IA. O que foi ao ar sai da
// consulta, não do modelo: relatório é prestação de contas, e número escrito
// por modelo é número que ninguém pode conferir.

export const PAUTA_PREFIXO_DO_RELATORIO = 'pauta.relatorio.';

export function chaveDoRelatorio(mes: string): string {
  return `${PAUTA_PREFIXO_DO_RELATORIO}${mes}`;
}

export function mesDaChaveDoRelatorio(chave: string): string | null {
  if (!chave.startsWith(PAUTA_PREFIXO_DO_RELATORIO)) return null;
  const mes = chave.slice(PAUTA_PREFIXO_DO_RELATORIO.length);
  return PautaMesSchema.safeParse(mes).success ? mes : null;
}

export const PAUTA_SECOES_DO_RELATORIO = [
  'O que foi ao ar',
  'O que decidimos',
  'Como rendeu',
  'Próximos passos',
  'A estratégia que valia',
] as const;

export const PAUTA_TETO_DO_RELATORIO = 12_000;

export interface PautaRelatorioDaIa {
  /** A leitura do mês em 2 a 4 frases. */
  leitura: string;
  decisoes: string[];
  proximosPassos: string[];
}

export interface PautaRelatorioPainel {
  mes: string;
  documento: string;
  versao: number | null;
  atualizadoEm: string | null;
  origem: string | null;
  meses: string[];
  /** Quantas peças o mês publicou — o número que o relatório presta contas. */
  publicadas: number;
  /** O que faltou para o relatório ficar completo (performance, estratégia). */
  avisos: string[];
  iaConfigurada: boolean;
}

/** `PUT /pauta/relatorio/:mes`. */
export const PautaRelatorioSalvarSchema = z.object({
  documento: z
    .string()
    .trim()
    .min(1, 'O relatório não pode ficar vazio.')
    .max(PAUTA_TETO_DO_RELATORIO, `O relatório tem no máximo ${PAUTA_TETO_DO_RELATORIO} caracteres.`),
  versao: z.number().int().positive().optional(),
});
export type PautaRelatorioSalvarInput = z.infer<typeof PautaRelatorioSalvarSchema>;

// ---------- Pauta: a newsletter do episódio (MC13) ----------
// A newsletter sai do que foi DITO no vídeo (a transcrição), não de um texto
// novo: uma seção por matéria com o link da matéria, e o fechamento chamando
// para a página de links e para o vídeo. É uma PautaPeca (canal newsletter,
// formato email) da rodada do episódio. Não publica: o destino é a D-MC7, e até
// lá sai como markdown e HTML para copiar.

/** O link do vídeo no YouTube, que só existe depois do envio manual (D-MC6). */
export const PAUTA_MARCADOR_DO_VIDEO = '{{video}}';

/**
 * A transcrição do vídeo final chega no Pacote; a newsletter pode sair até o
 * vídeo agendado. Concluído é registro.
 */
export const PAUTA_STATUS_QUE_GERAM_NEWSLETTER = ['pacote', 'derivacao', 'agendado'] as const satisfies readonly PautaEpisodioStatus[];

/** Por que não dá para gerar a newsletter agora, ou nulo. */
export function motivoParaNaoGerarNewsletter(status: PautaEpisodioStatus, segmentos: number): string | null {
  if (!(PAUTA_STATUS_QUE_GERAM_NEWSLETTER as readonly string[]).includes(status)) {
    return status === 'concluido'
      ? 'O episódio está concluído: a newsletter dele é registro.'
      : `A newsletter sai da transcrição do vídeo final, que chega no Pacote (o episódio está em ${PAUTA_EPISODIO_STATUS_ROTULO[status]}).`;
  }
  if (segmentos === 0) return SEM_TRANSCRICAO_NO_PACOTE;
  return null;
}

/** Parágrafo acima disso vira paredão na tela do celular. */
export const PAUTA_PALAVRAS_POR_PARAGRAFO = 60;

/** Frases que denunciam texto de IA. A conferência é sem acento e sem caixa, em qualquer ponto do texto. */
export const PAUTA_FRASES_DE_IA = [
  'Neste artigo',
  'Nesta newsletter, vamos',
  'Vamos explorar',
  'Vamos mergulhar',
  'Em um mundo cada vez mais',
  'Num mundo cada vez mais',
  'No mundo da IA',
  'No cenário atual',
  'Nos dias de hoje',
  'Você já se perguntou',
  'Sem mais delongas',
  'É importante ressaltar',
] as const;

export const PAUTA_REGRAS_ANTI_SLOP = ['palavra_proibida', 'emoji', 'frase_de_ia', 'paragrafo_longo'] as const;
export type PautaRegraAntiSlop = (typeof PAUTA_REGRAS_ANTI_SLOP)[number];

export const PAUTA_REGRA_ANTI_SLOP_ROTULO: Record<PautaRegraAntiSlop, string> = {
  palavra_proibida: 'Palavra proibida da casa',
  emoji: 'Emoji',
  frase_de_ia: 'Frase de IA',
  paragrafo_longo: 'Parágrafo longo para o celular',
};

export interface PautaApontamentoAntiSlop {
  regra: PautaRegraAntiSlop;
  /** O que foi achado: a palavra, o emoji, a frase ou o começo do parágrafo. */
  trecho: string;
  /** "título …", "parágrafo 3" — onde procurar. */
  onde: string;
}

export interface PautaChecagemAntiSlop {
  aprovada: boolean;
  apontamentos: PautaApontamentoAntiSlop[];
}

/*
 * Emoji como a tela mostra: bandeira (par de indicadores regionais), keycap
 * (1️⃣), o que já nasce emoji e o pictograma de texto forçado a emoji (❤️).
 * Fica de fora o que é tipografia e só vira emoji com o seletor: © ® ™ ↔ ‼.
 */
const EMOJI_NO_TEXTO = /\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/gu;
const LINK_MARKDOWN = /\[([^\]]*)\]\(([^)\s]*)\)/g;
const URL_SOLTA = /\b(?:https?:\/\/|www\.)[^\s<>]+/gi;

/** O texto sem emoji (e sem o que sobra dele: junção, seletor e tom de pele), em uma linha limpa. */
export function semEmoji(texto: string): string {
  return String(texto ?? '')
    .replace(EMOJI_NO_TEXTO, ' ')
    .replace(/[\u200D\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Os blocos do texto (separados por linha em branco) com o rótulo de onde estão. */
function blocosDoTexto(texto: string): Array<{ texto: string; onde: string; titulo: boolean }> {
  let paragrafo = 0;
  return String(texto ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const titulo = /^#{1,6}\s/.test(b);
      return { texto: b, titulo, onde: titulo ? `título “${b.replace(/^#+\s*/, '').slice(0, 60)}”` : `parágrafo ${++paragrafo}` };
    });
}

function palavrasDoBloco(b: string): string[] {
  return b.replace(LINK_MARKDOWN, '$1').split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
}

/**
 * A checagem anti-slop da casa: as palavras proibidas, emoji, as frases de
 * abertura de IA e o parágrafo longo demais para ler no celular. Aprovada é
 * zero apontamento. Pura: a API confere o que a IA escreveu e a tela mostra.
 * O endereço de um link não é texto: só o rótulo é conferido. `ignorarBloco`
 * pula o que o sistema montou (a IA não tem como corrigir), sem mudar a
 * numeração dos parágrafos que a tela mostra.
 */
export function checagemAntiSlop(
  texto: string,
  opcoes: { palavrasPorParagrafo?: number; ignorarBloco?: (bloco: string) => boolean } = {},
): PautaChecagemAntiSlop {
  const teto = opcoes.palavrasPorParagrafo ?? PAUTA_PALAVRAS_POR_PARAGRAFO;
  const frases = PAUTA_FRASES_DE_IA.map((f) => ({ f, chave: semAcento(f).replace(/\s+/g, ' ') }));
  const apontamentos: PautaApontamentoAntiSlop[] = [];
  for (const b of blocosDoTexto(texto)) {
    if (opcoes.ignorarBloco?.(b.texto)) continue;
    const legivel = b.texto.replace(LINK_MARKDOWN, '$1').replace(URL_SOLTA, ' ');
    for (const p of palavrasProibidasEm(legivel)) apontamentos.push({ regra: 'palavra_proibida', trecho: p, onde: b.onde });
    const emojis = [...new Set(legivel.match(EMOJI_NO_TEXTO) ?? [])];
    if (emojis.length) apontamentos.push({ regra: 'emoji', trecho: emojis.join(' '), onde: b.onde });
    const plano = semAcento(legivel).replace(/\s+/g, ' ');
    for (const { f, chave } of frases) {
      if (plano.includes(chave)) apontamentos.push({ regra: 'frase_de_ia', trecho: f, onde: b.onde });
    }
    if (!b.titulo) {
      const palavras = palavrasDoBloco(b.texto);
      if (palavras.length > teto) {
        apontamentos.push({
          regra: 'paragrafo_longo',
          trecho: `${palavras.slice(0, 8).join(' ')}…`,
          onde: `${b.onde} (${palavras.length} palavras; o teto é ${teto})`,
        });
      }
    }
  }
  return { aprovada: apontamentos.length === 0, apontamentos };
}

/** O link do vídeo publicado: https, uma linha. */
export const PautaUrlDoVideoSchema = z
  .string()
  .trim()
  .max(500, 'O link do vídeo tem no máximo 500 caracteres.')
  .regex(/^https:\/\/[^\s<>"'`{}]+$/i, 'O link do vídeo começa com https:// e não tem espaço.');

export const PautaNewsletterGerarSchema = z.object({
  /** O episódio já tem newsletter: gerar de novo só com a confirmação (a anterior vira descartada). */
  substituir: z.boolean().default(false),
  urlDoVideo: PautaUrlDoVideoSchema.nullable().optional(),
});
export type PautaNewsletterGerarInput = z.infer<typeof PautaNewsletterGerarSchema>;

/** Nulo tira o link. */
export const PautaNewsletterVideoSchema = z.object({ urlDoVideo: PautaUrlDoVideoSchema.nullable() });
export type PautaNewsletterVideoInput = z.infer<typeof PautaNewsletterVideoSchema>;

/** A newsletter vigente do episódio, pronta para copiar. */
export interface PautaNewsletterDoEpisodio {
  pecaId: string;
  titulo: string;
  status: PautaPecaStatus;
  criadaEm: string;
  /** O markdown com os marcadores trocados pelo que já existe (página no ar, link do vídeo). */
  markdown: string;
  /** Conferida no texto de agora: a peça pode ter sido editada depois de gerada. */
  checagem: PautaChecagemAntiSlop;
  /** Quantas chamadas à IA a geração levou (2 = a primeira foi reprovada e refeita). */
  tentativas: number;
  /** Frases do texto (5 palavras ou mais) e quantas delas saíram da fala do vídeo. */
  frases: { total: number; ditas: number };
  secoes: number;
  links: number;
  urlDoVideo: string | null;
  /** O que ainda falta para o texto sair inteiro (o marcador fica até lá). */
  pendentes: string[];
  /** A transcrição mudou depois desta newsletter (mídia refeita): gere de novo. */
  transcricaoMudou: boolean;
  avisos: string[];
}

/** `GET /pauta/episodios/:id/newsletter` e o retorno das escritas. */
export interface PautaNewsletterPainel {
  newsletter: PautaNewsletterDoEpisodio | null;
}

// ---------- Pauta: a semana de posts — derivação por notícia (MC15) ----------
// Cada matéria mantida do episódio vira três peças para revisar: um carrossel,
// um story e um corte vertical do vídeo. São `PautaPeca` do canal instagram da
// rodada do episódio, com o formato abaixo (texto livre no banco, sem migration)
// e a meta `{episodioId, itemId, …}` que as amarra à matéria.

export const PAUTA_FORMATOS_DA_SEMANA = ['carrossel', 'story', 'corte'] as const;
export type PautaFormatoDaSemana = (typeof PAUTA_FORMATOS_DA_SEMANA)[number];

export const PAUTA_FORMATO_DA_SEMANA_ROTULO: Record<PautaFormatoDaSemana, string> = {
  carrossel: 'Carrossel',
  story: 'Story',
  corte: 'Corte vertical',
};

/**
 * Deriva no Pacote (e leva o episódio a Derivação) e na Derivação. Depois de
 * agendado, gerar de novo não vale mais (como o título e a thumb do pacote). O
 * render (PNG e mp4) segue aceito, porque a peça aprovada ainda precisa dele.
 */
export const PAUTA_STATUS_QUE_DERIVAM = ['pacote', 'derivacao'] as const satisfies readonly PautaEpisodioStatus[];

/**
 * Por que o texto das peças da semana não se edita mais, ou nulo. Desde a MD8
 * o Agendado (a semana assinada) ainda edita: a peça editada volta a rascunho,
 * sai da agenda e o item dela no lote é revogado, sem mexer no resto da semana.
 * Concluído é registro.
 */
export function motivoParaNaoEditarASemana(status: PautaEpisodioStatus): string | null {
  return status === 'concluido'
    ? `O episódio já foi concluído (${PAUTA_EPISODIO_STATUS_ROTULO[status]}): o texto das peças é o registro do que foi ao ar.`
    : null;
}

export function motivoParaNaoDerivar(status: PautaEpisodioStatus, segmentos: number, itens: number): string | null {
  if (!(PAUTA_STATUS_QUE_DERIVAM as readonly string[]).includes(status)) {
    return `A semana de posts sai no Pacote ou na Derivação (este episódio está em ${PAUTA_EPISODIO_STATUS_ROTULO[status]}).`;
  }
  if (segmentos === 0) return 'O episódio não tem transcrição: o corte de cada matéria sai dela. Rode a /root-midia antes.';
  if (itens === 0) return 'O episódio não tem matérias mantidas: não há o que derivar.';
  return null;
}

/** O corte vertical tem MENOS de 3 minutos (o teto do Reels e do TikTok de trecho) e pelo menos 10 s. */
export const PAUTA_CORTE_MAXIMO_SEG = 180;
export const PAUTA_CORTE_MINIMO_SEG = 10;

/**
 * O trecho do corte está de pé? Nulo = sim; senão, o porquê. A mesma conta na
 * API (o que a IA escolheu e o que alguém editou) e na tela (antes de salvar).
 */
export function conferirTrechoDoCorte(inicio: unknown, fim: unknown, duracaoSeg: number | null | undefined): string | null {
  if (typeof inicio !== 'number' || typeof fim !== 'number' || !Number.isFinite(inicio) || !Number.isFinite(fim)) {
    return 'O início e o fim do corte são números em segundos.';
  }
  if (inicio < 0) return 'O corte não começa antes do vídeo (início negativo).';
  if (fim <= inicio) return 'O fim do corte vem depois do início.';
  if (typeof duracaoSeg === 'number' && Number.isFinite(duracaoSeg) && fim > duracaoSeg + 0.05) {
    return `O corte passa do fim do vídeo (${fim.toFixed(1)} s num vídeo de ${duracaoSeg.toFixed(1)} s).`;
  }
  const dura = fim - inicio;
  if (dura >= PAUTA_CORTE_MAXIMO_SEG) return `O corte tem ${dura.toFixed(1)} s; precisa ter menos de ${PAUTA_CORTE_MAXIMO_SEG / 60} minutos.`;
  if (dura < PAUTA_CORTE_MINIMO_SEG) return `O corte tem ${dura.toFixed(1)} s; o mínimo é ${PAUTA_CORTE_MINIMO_SEG} s.`;
  return null;
}

/**
 * MD13: a derivação devolve até 3 trechos candidatos para o corte de cada
 * matéria, cada um com uma nota de 0 a 10 e o motivo dela. A nota só ordena a
 * revisão humana; não mede alcance.
 */
export const PAUTA_CORTE_CANDIDATOS_MAXIMO = 3;
export const PAUTA_TETO_DO_MOTIVO_DO_CORTE = 200;

/** O carrossel da máquina de carrossel: 4 a 10 slides, com a capa no 1 e o CTA da palavra-chave no último. */
export const PAUTA_SLIDES_MINIMO = 4;
export const PAUTA_SLIDES_MAXIMO = 10;
export const PAUTA_TETO_DO_TITULO_DO_SLIDE = 90;
export const PAUTA_TETO_DO_TEXTO_DO_SLIDE = 240;
export const PAUTA_TETO_DA_LEGENDA = 2000;
export const PAUTA_TETO_DO_TEXTO_DO_STORY = 180;
export const PAUTA_TETO_DA_CHAMADA_DO_STORY = 90;
export const PAUTA_TETO_DO_TITULO_DA_PECA = 120;
/** A palavra do CTA ("comenta X"): maiúsculas e números, sem acento, para o DM do MC18 casar sem ambiguidade. */
export const PautaPalavraChaveSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]{3,20}$/, 'A palavra-chave tem de 3 a 20 letras maiúsculas ou números, sem acento nem espaço.');

export const PautaDerivacaoGerarSchema = z.object({
  /** Já há peças em rascunho: gerar de novo só com a confirmação (aprovada e publicada nunca são tocadas). */
  substituir: z.boolean().default(false),
  /** Só estas matérias (o número na lista do episódio); ausente = todas. */
  itens: z.array(z.number().int().min(1).max(200)).min(1).max(200).optional(),
});
export type PautaDerivacaoGerarInput = z.infer<typeof PautaDerivacaoGerarSchema>;

const textoDaPeca = (teto: number) => z.string().trim().min(1, 'O texto não pode ficar vazio.').max(teto);

/**
 * Editar o texto de uma peça da semana. Cada formato aceita os seus campos; o
 * serviço recusa o campo de outro formato. Editar uma peça aprovada a devolve
 * ao rascunho: o que foi aprovado é o texto de antes.
 */
export const PautaPecaDaSemanaEditarSchema = z
  .object({
    titulo: textoDaPeca(PAUTA_TETO_DO_TITULO_DA_PECA).optional(),
    legenda: z.string().trim().max(PAUTA_TETO_DA_LEGENDA).optional(),
    slides: z
      .array(
        z.object({
          titulo: z.string().trim().max(PAUTA_TETO_DO_TITULO_DO_SLIDE),
          texto: z.string().trim().max(PAUTA_TETO_DO_TEXTO_DO_SLIDE),
        }),
      )
      .min(PAUTA_SLIDES_MINIMO - 1)
      .max(PAUTA_SLIDES_MAXIMO - 1)
      .optional(),
    palavraChave: PautaPalavraChaveSchema.optional(),
    texto: textoDaPeca(PAUTA_TETO_DO_TEXTO_DO_STORY).optional(),
    chamada: textoDaPeca(PAUTA_TETO_DA_CHAMADA_DO_STORY).optional(),
    inicio: z.number().finite().min(0).max(PAUTA_TETO_DA_DURACAO_SEG).optional(),
    fim: z.number().finite().min(0).max(PAUTA_TETO_DA_DURACAO_SEG).optional(),
    /** MD13: troca o trecho do corte por outro candidato da derivação (o número na lista, de 1 em diante). */
    candidato: z.number().int().min(1).max(PAUTA_CORTE_CANDIDATOS_MAXIMO).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nada para mudar.')
  .refine((v) => (v.inicio === undefined) === (v.fim === undefined), 'O corte muda com início e fim juntos.')
  .refine((v) => v.candidato === undefined || v.inicio === undefined, 'Escolha um candidato ou edite o trecho, não os dois.');
export type PautaPecaDaSemanaEditarInput = z.infer<typeof PautaPecaDaSemanaEditarSchema>;

/** As imagens que o Mac renderiza: PNG, no tamanho do formato, até 5 MB (o frame de vídeo pesa no story). */
export const PAUTA_PNG_DA_PECA_MAX_BYTES = 5 * 1024 * 1024;
export const PAUTA_DIMENSOES_DA_PECA: Record<'carrossel' | 'story', { largura: number; altura: number }> = {
  carrossel: { largura: 1080, altura: 1350 },
  story: { largura: 1080, altura: 1920 },
};
/** O corte vertical: 1080×1920, a tela em cima e o rosto embaixo. */
export const PAUTA_DIMENSOES_DO_CORTE = { largura: 1080, altura: 1920 } as const;
/*
 * MD4: o JPEG da peça, que é o que a Graph da Meta aceita (só JPEG, até 8 MB,
 * largura de 320 a 1440). O Mac converte o PNG com o `sips` e sobe os dois; a
 * proporção é a do formato (carrossel 4:5, story 9:16).
 */
export const PAUTA_JPEG_DA_PECA_MAX_BYTES = 8 * 1024 * 1024;
export const PAUTA_JPEG_LARGURA_MINIMA = 320;
export const PAUTA_JPEG_LARGURA_MAXIMA = 1440;
/**
 * MD4: o teto padrão do mp4 do corte que sobe ao storage (o do Reels na Graph é
 * 300 MB). `PAUTA_VIDEO_MAX_BYTES` troca na API.
 */
export const PAUTA_VIDEO_DO_CORTE_MAX_BYTES = 300 * 1024 * 1024;
/** MD4: a URL pública assinada da mídia vale no máximo 1 h. */
export const PAUTA_MIDIA_PUBLICA_VALIDADE_MAXIMA_SEG = 3600;

export const PautaNumeroDaImagemSchema = z.coerce
  .number({ invalid_type_error: 'O número da imagem é 1 a 10.' })
  .int('O número da imagem é 1 a 10.')
  .min(1, 'O número da imagem é 1 a 10.')
  .max(PAUTA_SLIDES_MAXIMO, 'O número da imagem é 1 a 10.');

/**
 * O mp4 do corte FICA NO MAC, como o vídeo do episódio (MC9): o MinIO da VPS
 * não é público, e um corte de 1–3 min pesa dezenas de MB. A peça guarda onde
 * ele está e o que o Mac mediu.
 */
export const PautaVideoDoCorteSchema = z
  .object({
    arquivo: z
      .string()
      .trim()
      .min(2)
      .max(500)
      .regex(/^\/[^\0\n\r]*\.mp4$/i, 'O arquivo é o caminho absoluto do .mp4 no Mac.'),
    duracaoSeg: z.number().finite().positive().max(PAUTA_CORTE_MAXIMO_SEG + 5),
    largura: z.literal(PAUTA_DIMENSOES_DO_CORTE.largura),
    altura: z.literal(PAUTA_DIMENSOES_DO_CORTE.altura),
    bytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
    /** MD13: o trecho que o Mac renderizou. Opcional para o Mac antigo; vindo, tem de ser o da peça. */
    inicio: z.number().finite().min(0).max(PAUTA_TETO_DA_DURACAO_SEG).optional(),
    fim: z.number().finite().min(0).max(PAUTA_TETO_DA_DURACAO_SEG).optional(),
  })
  .strict()
  .refine((v) => (v.inicio === undefined) === (v.fim === undefined), 'O trecho renderizado vem com início e fim juntos.');
export type PautaVideoDoCorteInput = z.infer<typeof PautaVideoDoCorteSchema>;

export interface PautaImagemDaPeca {
  n: number;
  largura: number;
  altura: number;
  bytes: number;
  enviadaEm: string;
  /** MD4: o sha256 inteiro do arquivo (o Mac compara antes de reenviar). Ausente nas imagens de antes. */
  sha256?: string;
}

/**
 * MD4: o mp4 do corte. O caminho no Mac (MC15, `PUT …/video`) e, depois do
 * envio (`POST …/video/arquivo`), a chave no storage com o sha256 e a data. Um
 * sem o outro é normal: o registro vem antes do envio, e o envio sem registro
 * não tem caminho.
 */
export interface PautaVideoDaPeca {
  arquivo: string | null;
  duracaoSeg: number;
  largura: number;
  altura: number;
  bytes: number;
  registradoEm?: string;
  /** No storage da casa (MD4). */
  chave?: string;
  sha256?: string;
  enviadoEm?: string;
}

/**
 * MD4: as URLs públicas assinadas da mídia de uma peça (`POST
 * /pauta/pecas/:id/midia-publica`), válidas até `exp`. É o que a Graph da Meta
 * baixa (MD6): o JPEG de cada imagem e o mp4 do corte.
 */
export interface PautaMidiaPublicaDaPeca {
  pecaId: string;
  exp: string;
  midias: Array<{ tipo: 'jpeg' | 'mp4'; n: number | null; url: string; bytes: number; sha256: string | null }>;
}

export interface PautaSlideDaSemana {
  titulo: string;
  texto: string;
}

/** O CTA do último slide, no formato do fechamento da máquina de carrossel. */
export interface PautaCtaDoCarrossel {
  instrucao: string;
  palavra: string;
  beneficio: string;
}

/**
 * MD13: um trecho candidato ao corte da matéria, na ordem da nota (o 1 é o que
 * a derivação escolheu). `atual` diz se é o trecho que a peça usa agora: depois
 * de editar o trecho à mão, nenhum é.
 */
export interface PautaCandidatoDoCorte {
  n: number;
  titulo: string;
  inicio: number;
  fim: number;
  trecho: string;
  /** De 0 a 10; nula quando o modelo não deu nota. */
  nota: number | null;
  motivo: string;
  atual: boolean;
}

/** Uma peça da semana, como a tela e o Mac a leem. Os campos de cada formato só vêm nele. */
export interface PautaPecaDaSemana {
  id: string;
  formato: PautaFormatoDaSemana;
  status: PautaPecaStatus;
  titulo: string;
  /** Carrossel e corte: a legenda. Story: o texto. */
  corpo: string;
  criadaEm: string;
  // carrossel
  slides?: PautaSlideDaSemana[];
  cta?: PautaCtaDoCarrossel;
  palavraChave?: string;
  // story
  chamada?: string;
  /** O segundo do vídeo final de onde sai o frame do story (o começo do corte da matéria). */
  tempoSeg?: number | null;
  // corte
  inicio?: number;
  fim?: number;
  /** O que é dito no trecho, dos segmentos da transcrição. */
  trecho?: string;
  video?: PautaVideoDaPeca | null;
  /** MD13: os trechos candidatos ao corte, do de maior nota para o de menor. */
  candidatos?: PautaCandidatoDoCorte[];
  /** O que o Mac já renderizou e subiu em PNG (carrossel: um por slide; story: 1). */
  imagens: PautaImagemDaPeca[];
  /** MD4: os JPEG que a Graph da Meta baixa, um por imagem, ao lado do PNG. */
  jpegs?: PautaImagemDaPeca[];
  avisos: string[];
  /** A transcrição mudou depois desta peça (mídia refeita): o corte pode não bater mais. */
  transcricaoMudou: boolean;
  /** O slot da semana (MC16), em ISO; nulo fora da agenda. */
  agendadaPara?: string | null;
  /** Postada (à mão, MC16, ou pela MC17): quando, e o endereço público se houver. */
  postada?: PautaPostagemDaPeca | null;
}

export interface PautaMateriaDaSemana {
  /** O número da matéria na lista do episódio. */
  n: number;
  itemId: string;
  titulo: string;
  origem: PautaOrigem | null;
  /** O link público da matéria, pela regra única; nulo para newsletter e caixa de entrada. */
  link: string | null;
  pecas: Partial<Record<PautaFormatoDaSemana, PautaPecaDaSemana>>;
}

/** `GET /pauta/episodios/:id/semana` e o retorno das escritas. */
export interface PautaSemanaDePosts {
  episodioId: string;
  apelido: string;
  status: PautaEpisodioStatus;
  /** Onde está o vídeo final no Mac (MC9) e quanto dura: o corte e o frame do story saem dele. */
  arquivoFinal: string | null;
  duracaoSeg: number | null;
  /** A página de links no ar, para onde o story chama; nula enquanto não estiver no ar. */
  paginaDeLinks: string | null;
  motivo: string | null;
  materias: PautaMateriaDaSemana[];
}

export interface PautaSemanaGerada extends PautaSemanaDePosts {
  /** Quantas peças saíram novas, quantas substituíram um rascunho e quantas ficaram (aprovada/publicada). */
  conta: { criadas: number; substituidas: number; mantidas: number; falharam: number };
  avisos: string[];
}

// ---------- Pauta: o calendário da semana e a postagem com um toque (MC16) ----------
// As peças APROVADAS da semana de posts ganham um slot (`PautaPeca.agendadaPara`)
// numa grade por empresa — nota da memória `pauta.semana.grade`, lida no fuso
// de São Paulo — e cada slot entrega a legenda e a mídia para postar À MÃO.
// Postar pelo OS no Instagram/TikTok é a MC17 (D-MC8). "Marcar como postada" é
// registro interno: status `publicada`, `publicadaEm`/`publicadaPor`, a URL
// pública opcional em `urlPublicada` e `externalId` nulo (o id na rede é da MC17).

export const PAUTA_FUSO_DA_AGENDA = 'America/Sao_Paulo';

/** A grade da empresa é uma nota da memória (caminho da ADR-011), com esta chave. */
export const PAUTA_CHAVE_DA_GRADE = 'pauta.semana.grade';

/** Quantos dias o distribuir procura slot livre; o reagendar aceita até o teto. */
export const PAUTA_HORIZONTE_DA_AGENDA_DIAS = 28;
export const PAUTA_TETO_DO_REAGENDAR_DIAS = 90;
/** O "a partir de" do distribuir vai até aqui: somado ao horizonte, não passa do teto do reagendar. */
export const PAUTA_TETO_DO_A_PARTIR_DE_DIAS = PAUTA_TETO_DO_REAGENDAR_DIAS - PAUTA_HORIZONTE_DA_AGENDA_DIAS;

export const PAUTA_DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
export type PautaDiaDaSemana = (typeof PAUTA_DIAS_DA_SEMANA)[number];
export const PAUTA_DIA_DA_SEMANA_ROTULO: Record<PautaDiaDaSemana, string> = {
  dom: 'Dom',
  seg: 'Seg',
  ter: 'Ter',
  qua: 'Qua',
  qui: 'Qui',
  sex: 'Sex',
  sab: 'Sáb',
};

const DIA_CIVIL_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface PartesNoFuso {
  dia: string;
  hora: string;
  diaDaSemana: PautaDiaDaSemana;
}

const formatadores = new Map<string, Intl.DateTimeFormat>();
function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatadores.set(fuso, f);
  }
  return f;
}

/** O dia civil e a hora de parede de um instante no fuso. */
export function partesNoFuso(instante: Date, fuso: string = PAUTA_FUSO_DA_AGENDA): PartesNoFuso {
  const p = Object.fromEntries(formatador(fuso).formatToParts(instante).map((x) => [x.type, x.value]));
  const dia = `${p.year}-${p.month}-${p.day}`;
  return { dia, hora: `${p.hour}:${p.minute}`, diaDaSemana: diaDaSemanaDe(dia) };
}

export const diaNoFuso = (instante: Date, fuso: string = PAUTA_FUSO_DA_AGENDA) => partesNoFuso(instante, fuso).dia;
export const horaNoFuso = (instante: Date, fuso: string = PAUTA_FUSO_DA_AGENDA) => partesNoFuso(instante, fuso).hora;

/** O dia da semana de um dia civil `AAAA-MM-DD` (o calendário não depende de fuso). */
export function diaDaSemanaDe(dia: string): PautaDiaDaSemana {
  const [a, m, d] = dia.split('-').map(Number);
  return PAUTA_DIAS_DA_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}

export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A segunda-feira da semana do dia (a semana da agenda vai de segunda a domingo). */
export function segundaDaSemana(dia: string): string {
  const i = PAUTA_DIAS_DA_SEMANA.indexOf(diaDaSemanaDe(dia));
  return somarDias(dia, -((i + 6) % 7));
}

/**
 * O instante em que o relógio de parede do fuso marca `hora` no `dia`, como o
 * "compatible" do Temporal: na hora repetida (fim do horário de verão) vale a
 * primeira; na hora que não existe (início), empurra para depois pelo tamanho
 * do salto — 00:30 no dia em que 00:00 vira 01:00 é 01:30, nunca o dia anterior.
 * São Paulo não tem horário de verão desde 2019, mas o tzdata pode mudar.
 */
export function instanteNoFuso(dia: string, hora: string, fuso: string = PAUTA_FUSO_DA_AGENDA): Date {
  const [a, m, d] = dia.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  const comoUtc = Date.UTC(a, m - 1, d, h, mi);
  const desvio = (t: number) => {
    const p = partesNoFuso(new Date(t), fuso);
    const [pa, pm, pd] = p.dia.split('-').map(Number);
    const [ph, pmi] = p.hora.split(':').map(Number);
    return Date.UTC(pa, pm - 1, pd, ph, pmi) - t;
  };
  // As viradas de um fuso ficam a meses uma da outra: o desvio da véspera e o do
  // dia seguinte são os únicos candidatos.
  const UM_DIA = 24 * 3600_000;
  const candidatos = [...new Set([desvio(comoUtc - UM_DIA), desvio(comoUtc + UM_DIA)])].map((o) => comoUtc - o);
  const validos = candidatos.filter((t) => t + desvio(t) === comoUtc);
  return new Date(validos.length ? Math.min(...validos) : Math.max(...candidatos));
}

/** Domingo de Páscoa (algoritmo gregoriano anônimo), `AAAA-MM-DD`. */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Os feriados nacionais do ano (leis 662/1949, 6.802/1980 e 14.759/2023) mais
 * Carnaval e Corpus Christi, pontos facultativos em que a agenda também não
 * posta. Feriado local entra pela grade da empresa (`feriados:`).
 */
export function feriadosDoAno(ano: number): Array<{ dia: string; nome: string }> {
  const p = pascoa(ano);
  const fixos: Array<[string, string]> = [
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['11-20', 'Consciência Negra'],
    ['12-25', 'Natal'],
  ];
  return [
    ...fixos.map(([md, nome]) => ({ dia: `${ano}-${md}`, nome })),
    { dia: somarDias(p, -48), nome: 'Carnaval' },
    { dia: somarDias(p, -47), nome: 'Carnaval' },
    { dia: somarDias(p, -2), nome: 'Sexta-feira Santa' },
    { dia: somarDias(p, 60), nome: 'Corpus Christi' },
  ].sort((x, y) => x.dia.localeCompare(y.dia));
}

/** O nome do feriado do dia (nacional ou da grade da empresa), ou nulo. */
export function feriadoDoDia(dia: string, extras: readonly string[] = []): string | null {
  if (extras.includes(dia)) return 'Feriado da empresa';
  return feriadosDoAno(Number(dia.slice(0, 4))).find((f) => f.dia === dia)?.nome ?? null;
}

export interface PautaSlotDaGrade {
  formato: PautaFormatoDaSemana;
  dia: PautaDiaDaSemana;
  /** `HH:MM`, relógio de São Paulo. */
  hora: string;
}

export interface PautaGradeDaSemana {
  slots: PautaSlotDaGrade[];
  /** Feriados da empresa, `AAAA-MM-DD` (os nacionais já são pulados). */
  feriados: string[];
}

/** O padrão: carrossel seg/qua/sex 12h, corte ter/qui 18h, story todo dia útil 9h. */
export const PAUTA_GRADE_PADRAO: PautaGradeDaSemana = {
  slots: [
    ...(['seg', 'ter', 'qua', 'qui', 'sex'] as const).map((dia) => ({ formato: 'story' as const, dia, hora: '09:00' })),
    ...(['seg', 'qua', 'sex'] as const).map((dia) => ({ formato: 'carrossel' as const, dia, hora: '12:00' })),
    ...(['ter', 'qui'] as const).map((dia) => ({ formato: 'corte' as const, dia, hora: '18:00' })),
  ],
  feriados: [],
};

export const PAUTA_TETO_DE_SLOTS_DA_GRADE = 70;
export const PAUTA_TETO_DO_TEXTO_DA_GRADE = 2_000;

const ORDEM_DO_DIA: Record<PautaDiaDaSemana, number> = { seg: 0, ter: 1, qua: 2, qui: 3, sex: 4, sab: 5, dom: 6 };

function ordenarSlots(slots: PautaSlotDaGrade[]): PautaSlotDaGrade[] {
  const f = (x: PautaFormatoDaSemana) => PAUTA_FORMATOS_DA_SEMANA.indexOf(x);
  return [...slots].sort((a, b) => ORDEM_DO_DIA[a.dia] - ORDEM_DO_DIA[b.dia] || a.hora.localeCompare(b.hora) || f(a.formato) - f(b.formato));
}

function diaDoTexto(t: string): PautaDiaDaSemana | null {
  const limpo = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().slice(0, 3);
  return (PAUTA_DIAS_DA_SEMANA as readonly string[]).includes(limpo) ? (limpo as PautaDiaDaSemana) : null;
}

function horaDoTexto(t: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2})|h(\d{2})?)$/i.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? m[3] ?? 0);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function diaCivilDoTexto(t: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const [a, m, d] = iso ? [iso[1], iso[2], iso[3]] : br ? [br[3], br[2], br[1]] : [];
  if (!a) return null;
  const dia = `${a}-${m}-${d}`;
  return somarDias(dia, 0) === dia ? dia : null;
}

/**
 * Lê a grade do texto da nota. Uma linha por formato — `carrossel: seg, qua,
 * sex 12:00`, `story: dias úteis 9h`, `corte: ter-qui 18h` — e `feriados:
 * 20/11/2026, 2026-12-24`. `#` comenta. Linha que não fecha vira aviso e fica
 * de fora; o que não é da grade não é inventado.
 */
export function lerGradeDoTexto(texto: string): { grade: PautaGradeDaSemana; avisos: string[] } {
  const slots: PautaSlotDaGrade[] = [];
  const feriados: string[] = [];
  const avisos: string[] = [];
  const linhas = String(texto ?? '').split(/\r?\n/);
  linhas.forEach((bruta, i) => {
    const linha = bruta.replace(/#.*$/, '').trim();
    if (!linha) return;
    // Corta no primeiro ':' (linear): uma regex com quantificador preguiçoso aqui
    // é quadrática numa linha longa sem ':'.
    const doisPontos = linha.indexOf(':');
    const rotulo = doisPontos < 0 ? '' : linha.slice(0, doisPontos).trim();
    const onde = `Linha ${i + 1}`;
    if (!rotulo || !/^[a-zà-ú ]+$/i.test(rotulo)) {
      avisos.push(`${onde}: esperava "formato: dias hora" (ex.: carrossel: seg, qua, sex 12:00).`);
      return;
    }
    const chave = rotulo.toLowerCase();
    const resto = linha.slice(doisPontos + 1).trim();
    if (chave === 'feriados' || chave === 'feriado') {
      for (const t of resto.split(/[\s,;]+/).filter(Boolean)) {
        const d = diaCivilDoTexto(t);
        if (d) feriados.push(d);
        else avisos.push(`${onde}: "${t}" não é uma data (use 20/11/2026 ou 2026-11-20).`);
      }
      return;
    }
    const formato = chave === 'corte vertical' ? 'corte' : chave === 'stories' ? 'story' : chave === 'carrosseis' || chave === 'carrosséis' ? 'carrossel' : chave;
    if (!(PAUTA_FORMATOS_DA_SEMANA as readonly string[]).includes(formato)) {
      avisos.push(`${onde}: "${rotulo}" não é formato da semana (carrossel, story ou corte).`);
      return;
    }
    const expandido = resto
      .toLowerCase()
      .replace(/todo dia [uú]til|todos os dias [uú]teis|dias [uú]teis/g, 'seg-sex')
      .replace(/todos os dias|todo dia/g, 'dom-sab');
    const dias = new Set<PautaDiaDaSemana>();
    const horas = new Set<string>();
    let ruim: string | null = null;
    for (const t of expandido.split(/[\s,;]+/).filter((x) => x && x !== 'e' && x !== 'às' && x !== 'as')) {
      const faixa = /^([a-zà-ú]+)-([a-zà-ú]+)$/i.exec(t);
      if (faixa) {
        const de = diaDoTexto(faixa[1]);
        const ate = diaDoTexto(faixa[2]);
        if (!de || !ate) {
          ruim = t;
          break;
        }
        for (let k = PAUTA_DIAS_DA_SEMANA.indexOf(de); ; k = (k + 1) % 7) {
          dias.add(PAUTA_DIAS_DA_SEMANA[k]);
          if (PAUTA_DIAS_DA_SEMANA[k] === ate) break;
        }
        continue;
      }
      const dia = diaDoTexto(t);
      if (dia && t.length <= 7) {
        dias.add(dia);
        continue;
      }
      const hora = horaDoTexto(t);
      if (hora) {
        horas.add(hora);
        continue;
      }
      ruim = t;
      break;
    }
    if (ruim) avisos.push(`${onde}: não entendi "${ruim}".`);
    else if (!dias.size) avisos.push(`${onde}: faltam os dias (ex.: seg, qua, sex ou dias úteis).`);
    else if (!horas.size) avisos.push(`${onde}: falta a hora (ex.: 12:00 ou 12h).`);
    else for (const dia of dias) for (const hora of horas) slots.push({ formato: formato as PautaFormatoDaSemana, dia, hora });
  });
  const vistos = new Set<string>();
  const unicos = slots.filter((s) => {
    const k = `${s.formato}|${s.dia}|${s.hora}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  if (unicos.length > PAUTA_TETO_DE_SLOTS_DA_GRADE) {
    avisos.push(`A grade tem ${unicos.length} slots; o teto é ${PAUTA_TETO_DE_SLOTS_DA_GRADE} por semana.`);
  }
  return {
    grade: { slots: ordenarSlots(unicos.slice(0, PAUTA_TETO_DE_SLOTS_DA_GRADE)), feriados: [...new Set(feriados)].sort() },
    avisos,
  };
}

/** A grade escrita como a nota guarda (e como a tela edita). */
export function textoDaGrade(grade: PautaGradeDaSemana): string {
  const linhas = ['# Grade da semana de posts (MC16) · horário de São Paulo'];
  for (const formato of PAUTA_FORMATOS_DA_SEMANA) {
    const porHora = new Map<string, PautaDiaDaSemana[]>();
    for (const s of ordenarSlots(grade.slots.filter((x) => x.formato === formato))) {
      porHora.set(s.hora, [...(porHora.get(s.hora) ?? []), s.dia]);
    }
    for (const [hora, dias] of [...porHora].sort(([a], [b]) => a.localeCompare(b))) {
      linhas.push(`${formato}: ${dias.join(', ')} ${hora}`);
    }
  }
  if (grade.feriados.length) {
    linhas.push(`feriados: ${grade.feriados.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`).join(', ')}`);
  }
  return `${linhas.join('\n')}\n`;
}

export const PautaGradeSalvarSchema = z
  .object({
    texto: z.string().max(PAUTA_TETO_DO_TEXTO_DA_GRADE),
    /** A versão da nota de quando a tela abriu o editor: outra aba no meio = 409. */
    versao: z.number().int().positive().optional(),
  })
  .strict();
export type PautaGradeSalvarInput = z.infer<typeof PautaGradeSalvarSchema>;

/** Um dia civil `AAAA-MM-DD` que existe, entre 2000 e 2100 (a conta de fuso não passa do ano 9999). */
export const PautaDiaCivilSchema = z
  .string()
  .regex(DIA_CIVIL_RE, 'A data é AAAA-MM-DD.')
  .refine((d) => somarDias(d, 0) === d, 'Essa data não existe.')
  .refine((d) => d >= '2000-01-01' && d <= '2100-12-31', 'A data vai de 2000 a 2100.');

export const PautaDistribuirSchema = z
  .object({
    /**
     * O primeiro dia (São Paulo) em que pode haver slot; ausente = agora. Dia
     * passado vale como agora; além de `PAUTA_TETO_DO_A_PARTIR_DE_DIAS` é 400
     * no serviço (depende de hoje).
     */
    aPartirDe: PautaDiaCivilSchema.optional(),
  })
  .strict();
export type PautaDistribuirInput = z.infer<typeof PautaDistribuirSchema>;

export const PautaReagendarSchema = z
  .object({
    /** O instante novo (ISO com fuso), ou nulo para tirar a peça da agenda. */
    agendadaPara: z.string().datetime({ offset: true, message: 'A data e a hora vão em ISO (2026-09-29T12:00:00-03:00).' }).nullable(),
  })
  .strict();
export type PautaReagendarInput = z.infer<typeof PautaReagendarSchema>;

export const PautaMarcarPostadaSchema = z
  .object({
    /** O link público do post (opcional): só https, sem espaço. */
    url: z
      .string()
      .trim()
      .max(500)
      .url('O link do post é um endereço completo (https://…).')
      .regex(/^https:\/\/[^\s]+$/i, 'O link do post começa com https://.')
      .optional(),
  })
  .strict();
export type PautaMarcarPostadaInput = z.infer<typeof PautaMarcarPostadaSchema>;

/** Distribuir e reagendar: da Derivação em diante, enquanto a semana está viva. */
export const PAUTA_STATUS_QUE_AGENDAM = ['derivacao', 'agendado'] as const satisfies readonly PautaEpisodioStatus[];

export function motivoParaNaoAgendar(status: PautaEpisodioStatus): string | null {
  return (PAUTA_STATUS_QUE_AGENDAM as readonly string[]).includes(status)
    ? null
    : `A agenda da semana vale na Derivação e no Agendado (este episódio está em ${PAUTA_EPISODIO_STATUS_ROTULO[status]}).`;
}

export interface PautaPostagemDaPeca {
  em: string;
  /** Postada à mão pelo operador (MC16) ou pela publicação automática (MC17). */
  manual: boolean;
  url: string | null;
}

/**
 * Onde está a mídia para postar: no storage da casa (baixar) ou no Mac (o
 * caminho). `parcial` é o PNG que subiu pela metade (o carrossel de 7 com 3 no
 * storage): não se posta, e o comando completa.
 */
export type PautaMidiaNaAgenda =
  | { onde: 'storage'; imagens: number[]; esperadas: number }
  | { onde: 'parcial'; imagens: number[]; esperadas: number; faltam: number[]; comando: string }
  | { onde: 'mac'; arquivo: string }
  /** MD4: o mp4 do corte subiu ao storage (baixar pela tela); o caminho no Mac, se registrado. */
  | { onde: 'video'; arquivo: string | null; bytes: number }
  | { onde: 'nenhuma'; comando: string };

export interface PautaPecaNaAgenda {
  id: string;
  formato: PautaFormatoDaSemana;
  status: PautaPecaStatus;
  titulo: string;
  /** O que se cola no post: a legenda (carrossel e corte) ou o texto (story). */
  legenda: string;
  palavraChave: string | null;
  episodioId: string;
  apelido: string;
  itemN: number;
  materia: string;
  /** `agendadaPara`, ou — postada sem slot — quando foi postada. */
  em: string;
  agendadaPara: string | null;
  midia: PautaMidiaNaAgenda;
  postada: PautaPostagemDaPeca | null;
  /** Por que o episódio não deixa reagendar agora (fora da Derivação/Agendado), ou nulo. */
  motivoParaNaoAgendar: string | null;
  /**
   * MD1: o slot que o encadeamento propôs para a peça ainda sem agenda. A peça
   * aparece nele em cinza ("proposto, falta aprovar"); virar agenda de verdade é
   * decisão humana. Opcional porque web e API sobem separadas.
   */
  slotProposto?: string | null;
  /** MD6: a publicação pelo OS no Instagram, quando alguém pediu. Opcional pelo mesmo motivo. */
  publicacao?: PautaPublicacaoDaPeca | null;
  /** MD8: o item vivo do lote da semana (montado, na fila ou ativo). Opcional pelo mesmo motivo. */
  lote?: PautaLoteDaPeca | null;
  /** MD13: no corte, os trechos candidatos, para trocar antes do lote. Opcional pelo mesmo motivo. */
  candidatos?: PautaCandidatoDoCorte[];
}

export interface PautaLinhaDoDia {
  /** `HH:MM`, São Paulo. */
  hora: string;
  formato: PautaFormatoDaSemana;
  em: string;
  /** É um slot da grade (vazio ou não), ou uma peça posta à mão fora da grade. */
  daGrade: boolean;
  peca: PautaPecaNaAgenda | null;
}

export interface PautaDiaDaAgenda {
  dia: string;
  diaDaSemana: PautaDiaDaSemana;
  feriado: string | null;
  linhas: PautaLinhaDoDia[];
}

export interface PautaEpisodioParaDistribuir {
  episodioId: string;
  apelido: string;
  titulo: string;
  status: PautaEpisodioStatus;
  aprovadasSemData: number;
  motivo: string | null;
}

/** `GET /pauta/agenda?de=AAAA-MM-DD`: sete dias a partir de `de`. */
export interface PautaAgendaDaSemana {
  de: string;
  ate: string;
  fuso: string;
  hoje: string;
  grade: PautaGradeDaSemana;
  origemDaGrade: 'empresa' | 'padrao';
  dias: PautaDiaDaAgenda[];
  /** Episódios com peça aprovada ainda sem slot: o "Distribuir". */
  paraDistribuir: PautaEpisodioParaDistribuir[];
  /** MD8: a nota `pauta.publicacao.automatica` da empresa (desligada = o lote assinado não sai sozinho). */
  publicacaoAutomatica?: boolean;
  /** MD9: quantos comentários com a palavra esperam a DM à mão, dentro dos 7 dias. */
  comentariosPendentes?: number;
  /** MD11: a nota `pauta.dm.automatica` (desligada = a DM segue à mão). */
  dmAutomatica?: boolean;
  /** Se a DM automática pode ser ligada neste servidor (`INSTAGRAM_PEDIR_MENSAGENS=sim`, depois do App Review). */
  dmPodeLigar?: boolean;
  /** A rotina `pauta.publicar-agendadas`: é ela que publica a semana assinada no horário. */
  rotinaDePublicacao?: PautaRotinaDaPauta;
}

/**
 * Uma rotina da pauta como a tela precisa dela: sem ela criada em /rotinas,
 * nada anda sozinho. `calada` é a variável que desliga o tique neste servidor
 * (`ROTINAS_CRON=off` ou `PAUTA_CRON=off`); com ela, `dispara` é falso.
 */
export interface PautaRotinaDaPauta {
  existe: boolean;
  dispara: boolean;
  nome: string | null;
  calada: string | null;
}

/**
 * O que falta para a rotina de publicação disparar, em uma frase, ou nulo. A
 * tela põe isto no lugar do "sai no horário" quando a publicação automática
 * está ligada, para a promessa não ficar sem quem a cumpra.
 */
export function faltaNaRotinaDePublicacao(r: PautaRotinaDaPauta | null | undefined): string | null {
  if (!r) return null;
  if (!r.existe) return 'sem a rotina "Publicação da semana" em /rotinas: nada sai no horário';
  if (r.calada) return `a rotina de publicação está calada neste servidor (${r.calada}): nada sai no horário`;
  if (!r.dispara) return 'a rotina de publicação está parada em /rotinas: nada sai no horário';
  return null;
}

/** `GET /pauta/agenda/grade` e o retorno do PUT. */
export interface PautaGradePainel {
  grade: PautaGradeDaSemana;
  texto: string;
  origem: 'empresa' | 'padrao';
  /** A versão da nota (para o PUT conferir), nula no padrão. */
  versao: number | null;
  avisos: string[];
}

/** `POST /pauta/episodios/:id/agenda/distribuir`. */
export interface PautaDistribuicao {
  conta: { alocadas: number; jaAgendadas: number; semVaga: number };
  pecas: Array<{ id: string; formato: PautaFormatoDaSemana; itemN: number; em: string }>;
  avisos: string[];
}

export interface PautaCanalEstado {
  configurada: boolean;
  conectada: boolean;
  motivo: string | null;
  grupo: string | null;
}
// ---------- Pauta: o encadeamento da transcrição à semana em rascunho (MD1) ----------

/**
 * As etapas que a rotina `pauta.encadear` anda sozinha, na ordem. Nenhuma sai
 * do OS: a página só é MONTADA (pôr no ar é humano) e os slots são PROPOSTOS em
 * peças rascunho (agenda de verdade é só de peça aprovada).
 */
export const PAUTA_ETAPAS_DO_ENCADEAMENTO = ['pacote', 'pagina', 'newsletter', 'semana', 'slots'] as const;
export type PautaEtapaDoEncadeamento = (typeof PAUTA_ETAPAS_DO_ENCADEAMENTO)[number];

export const PAUTA_ETAPA_DO_ENCADEAMENTO_ROTULO: Record<PautaEtapaDoEncadeamento, string> = {
  pacote: 'gerar o pacote do YouTube',
  pagina: 'montar a página de links (sem pôr no ar)',
  newsletter: 'gerar a newsletter',
  semana: 'gerar a semana de posts',
  slots: 'propor os slots da semana',
};

/** O tipo da rotina (o executor mora na API, `routines/executores/pauta-encadear.executor.ts`). */
export const PAUTA_TIPO_DA_ROTINA_DE_ENCADEAMENTO = 'pauta.encadear';

/** A `config` da rotina: sem `etapas`, todas. */
export const PautaEncadeamentoConfigSchema = z
  .object({ etapas: z.array(z.enum(PAUTA_ETAPAS_DO_ENCADEAMENTO)).min(1).max(PAUTA_ETAPAS_DO_ENCADEAMENTO.length).optional() })
  .strict();
export type PautaEncadeamentoConfig = z.infer<typeof PautaEncadeamentoConfigSchema>;

/** O desfecho de um passo, como fica no RASTRO (`pauta.encadeamento_passo`). */
export type PautaResultadoDoPasso = 'ok' | 'erro' | 'pulada' | 'dispensada' | 'travada';

export interface PautaPassoRegistrado {
  etapa: PautaEtapaDoEncadeamento;
  resultado: PautaResultadoDoPasso;
  detalhe: string | null;
  em: string;
}

/** `GET /pauta/episodios/:id/encadeamento`. */
export interface PautaEncadeamentoDoEpisodio {
  episodioId: string;
  /** A etapa que a próxima passagem roda, ou `parar` (com o motivo). Nunca publica. */
  passo: PautaEtapaDoEncadeamento | 'parar';
  motivo: string | null;
  /** As etapas que a rotina anda (a config dela; sem rotina, todas). */
  etapas: PautaEtapaDoEncadeamento[];
  /**
   * A rotina `pauta.encadear` da empresa: sem ela criada, nada anda sozinho.
   * `calada` é a variável que desliga o tique neste servidor (`ROTINAS_CRON=off`
   * ou `PAUTA_CRON=off`); com ela, `dispara` é falso.
   */
  rotina: { existe: boolean; dispara: boolean; nome: string | null; calada: string | null };
  /** Os últimos passos registrados, do mais novo. */
  ultimos: PautaPassoRegistrado[];
}

// ---------- Aprovação de lote com uso contado (MD7) ----------

/**
 * Espelha o enum `LoteEstado` do Prisma. `proposta`: montado, sem pedido de
 * assinatura; `aguardando`: a aprovação R4 está na fila; `ativo`: assinado, e
 * cada item vale um uso contado; `encerrado`: nenhum item ativo sobrou;
 * `vencido`: passou do `validaAte`; `revogado`: cancelado inteiro.
 */
export const LOTE_ESTADOS = ['proposta', 'aguardando', 'ativo', 'encerrado', 'vencido', 'revogado'] as const;
export type LoteEstado = (typeof LOTE_ESTADOS)[number];

export const LOTE_ESTADO_ROTULO: Record<LoteEstado, string> = {
  proposta: 'montado, sem pedido de assinatura',
  aguardando: 'aguardando a assinatura de outra pessoa',
  ativo: 'assinado e valendo',
  encerrado: 'encerrado: nenhum item ativo',
  vencido: 'vencido',
  revogado: 'revogado',
};

/**
 * Espelha o enum `ItemDoLoteEstado` do Prisma. `consumido`: gastou todos os
 * usos; `revogado`: o conteúdo da peça mudou depois da assinatura, ou alguém o
 * tirou do lote — só ele cai, os outros seguem.
 */
export const ITEM_DO_LOTE_ESTADOS = ['ativo', 'consumido', 'revogado'] as const;
export type ItemDoLoteEstado = (typeof ITEM_DO_LOTE_ESTADOS)[number];

/** A capacidade da régua (R4) que aprova a semana inteira de uma vez. */
export const CAPACIDADE_DE_APROVAR_A_SEMANA = 'pauta.semana.aprovar';

// ---------- Pauta: o publicador do Instagram (MD6) ----------

/** Espelha o enum `PautaRede` do Prisma. O TikTok está em espera (MD12) e o YouTube é da MD10. */
export const PAUTA_REDES = ['instagram', 'youtube', 'tiktok'] as const;
export type PautaRede = (typeof PAUTA_REDES)[number];

/**
 * Espelha o enum `PautaPublicacaoEstado` do Prisma. `container_criado`: o
 * container está pronto na Meta e o publish ainda não foi confirmado;
 * `processando`: o vídeo ainda está em IN_PROGRESS; `recusada`: a peça mudou
 * depois do pedido, ou alguém a devolveu ao fluxo manual.
 */
export const PAUTA_PUBLICACAO_ESTADOS = ['pendente', 'container_criado', 'processando', 'publicada', 'erro', 'recusada'] as const;
export type PautaPublicacaoEstado = (typeof PAUTA_PUBLICACAO_ESTADOS)[number];

export const PAUTA_PUBLICACAO_ESTADO_ROTULO: Record<PautaPublicacaoEstado, string> = {
  pendente: 'publicação pendente',
  container_criado: 'enviada à Meta',
  processando: 'a Meta está processando',
  publicada: 'publicada pelo OS',
  erro: 'a publicação falhou',
  recusada: 'de volta ao manual',
};

/** A capacidade da régua (R3) que publica no Instagram. */
export const PAUTA_CAPACIDADE_DE_PUBLICAR_NO_INSTAGRAM = 'instagram.post.publicar';

/** O tipo da rotina que olha as peças agendadas (executor em `routines/executores/pauta-publicar.executor.ts`). */
export const PAUTA_TIPO_DA_ROTINA_DE_PUBLICACAO = 'pauta.publicar-agendadas';

/**
 * A nota da memória que liga a publicação AUTOMÁTICA da empresa (D-MD1): a
 * primeira linha `ligada`. Sem ela, o executor não publica nada sozinho e a
 * peça segue o caminho manual (MC16) ou o "Publicar agora" item a item.
 */
export const PAUTA_CHAVE_DA_PUBLICACAO_AUTOMATICA = 'pauta.publicacao.automatica';

/** A legenda do Instagram aceita até 2.200 caracteres (a conferir no primeiro post real). */
export const PAUTA_LEGENDA_DO_INSTAGRAM_MAXIMO = 2200;

/** A janela da publicação automática: do slot até 2 h depois. Passou disso, volta ao manual. */
export const PAUTA_JANELA_DA_PUBLICACAO_MS = 2 * 3600_000;

/** A publicação de uma peça, como a aba Semana a mostra. */
export interface PautaPublicacaoDaPeca {
  id: string;
  rede: PautaRede;
  estado: PautaPublicacaoEstado;
  externalId: string | null;
  permalink: string | null;
  erro: string | null;
  tentativas: number;
  proximaEm: string | null;
  atualizadaEm: string;
}

// ---------- Pauta: aprovar a semana num ponto só (MD8) ----------

/**
 * O caminho de uma peça da semana até o ar, como a aba Semana o desenha. Só a
 * assinatura de OUTRA pessoa leva de `aguardando` a `ativo`; daí em diante é o
 * executor (`pauta.publicar-agendadas`) que publica no horário, se a nota
 * `pauta.publicacao.automatica` estiver ligada.
 */
export const PAUTA_ETAPAS_DA_PECA_NA_SEMANA = ['rascunho', 'proposto', 'aguardando', 'ativo', 'publicando', 'publicada'] as const;
export type PautaEtapaDaPecaNaSemana = (typeof PAUTA_ETAPAS_DA_PECA_NA_SEMANA)[number];

export const PAUTA_ETAPA_DA_PECA_NA_SEMANA_ROTULO: Record<PautaEtapaDaPecaNaSemana, string> = {
  rascunho: 'rascunho',
  proposto: 'proposto',
  aguardando: 'aguardando assinatura',
  ativo: 'ativo',
  publicando: 'publicando',
  publicada: 'publicada',
};

/** O item de lote vivo da peça (o lote da semana, MD7/MD8), como a agenda o mostra. */
export interface PautaLoteDaPeca {
  loteId: string;
  itemId: string;
  estadoDoLote: LoteEstado;
  estadoDoItem: ItemDoLoteEstado;
  /** Até quando o item pode sair (slot + 2 h). */
  janelaAte: string;
}

/**
 * Em que etapa a peça está. Postada (à mão ou pelo OS) é `publicada`; a
 * publicação a caminho na Meta é `publicando`; o item ativo num lote ativo é
 * `ativo` só com a peça `aprovada` e a publicação fora do manual (`recusada`
 * não sai); o item num lote montado ou na fila é `aguardando`; a peça com slot
 * (proposto ou agendado) sem lote vivo é `proposto`.
 */
export function etapaDaPecaNaSemana(p: {
  status: PautaPecaStatus;
  agendadaPara?: string | null;
  slotProposto?: string | null;
  postada?: unknown;
  publicacao?: Pick<PautaPublicacaoDaPeca, 'estado'> | null;
  lote?: Pick<PautaLoteDaPeca, 'estadoDoLote' | 'estadoDoItem'> | null;
}): PautaEtapaDaPecaNaSemana {
  if (p.status === 'publicada' || p.postada || p.publicacao?.estado === 'publicada') return 'publicada';
  if (p.publicacao && (p.publicacao.estado === 'container_criado' || p.publicacao.estado === 'processando')) return 'publicando';
  if (p.lote?.estadoDoItem === 'ativo') {
    if (p.lote.estadoDoLote === 'ativo' && p.status === 'aprovada' && p.publicacao?.estado !== 'recusada') return 'ativo';
    if (p.lote.estadoDoLote === 'proposta' || p.lote.estadoDoLote === 'aguardando') return 'aguardando';
  }
  if (p.agendadaPara || p.slotProposto) return 'proposto';
  return 'rascunho';
}

/** `POST /pauta/episodios/:id/semana/preparar-aprovacao`: as peças que ficam FORA do lote. */
export const PautaPrepararAprovacaoSchema = z
  .object({ fora: z.array(z.string().trim().min(1).max(64)).max(60).default([]) })
  .strict();
export type PautaPrepararAprovacaoInput = z.infer<typeof PautaPrepararAprovacaoSchema>;

/** Uma peça da semana diante do lote: o slot, o que a impede de entrar e o lote em que já está. */
export interface PautaPecaParaAprovar {
  id: string;
  formato: PautaFormatoDaSemana;
  itemN: number;
  titulo: string;
  status: PautaPecaStatus;
  /** `agendadaPara` da aprovada, ou o `slotProposto` (MD1). */
  slot: string | null;
  /** Por que esta peça não entra no lote agora (a tela a deixa de fora), ou nulo. */
  problema: string | null;
  /** O lote vivo em que ela já está: não entra em lote novo. */
  noLote: { loteId: string; estadoDoLote: LoteEstado } | null;
  etapa: PautaEtapaDaPecaNaSemana;
}

/** Um lote da semana deste episódio, ainda em curso (montado, na fila ou ativo). */
export interface PautaLoteDaSemana {
  id: string;
  estado: LoteEstado;
  validaAte: string;
  hashCurto: string;
  approvalId: string | null;
  aprovadoEm: string | null;
  itens: number;
  ativos: number;
  /** Quem montou é quem pede a assinatura (e pede de novo quando a anterior venceu). */
  montadoPorMim: boolean;
}

/** `GET /pauta/episodios/:id/semana/aprovacao`. */
export interface PautaAprovacaoDaSemana {
  episodioId: string;
  apelido: string;
  status: PautaEpisodioStatus;
  /** A nota `pauta.publicacao.automatica`: desligada, o lote ativo não publica sozinho. */
  automaticaLigada: boolean;
  /** A rotina que publica o lote no horário. Opcional: a API anterior não a mandava. */
  rotinaDePublicacao?: PautaRotinaDaPauta;
  /** O que impede a semana inteira (página de links fora do ar, conta de publicação, status). */
  impedimentos: string[];
  pecas: PautaPecaParaAprovar[];
  lotes: PautaLoteDaSemana[];
  /** O vídeo do episódio no YouTube (MD10): entra no mesmo lote quando está pronto. */
  youtube: PautaYoutubeNoLote;
  /** As regras da DM automática (MD11): uma por matéria com palavra e link público. */
  dm?: PautaDmNoLote;
}

/** O retorno da montagem: o lote em `proposta`, pronto para pedir a assinatura. */
export interface PautaLoteMontado {
  loteId: string;
  hashConteudo: string;
  validaAte: string;
  itens: number;
  fora: string[];
  /** Os lotes montados antes e ainda sem assinatura que este substituiu. */
  substituidos: string[];
}

/** Um item do lote como a titular o lê em /atendimento, com o hash recalculado da peça de agora. */
export interface PautaItemDoConteudoDoLote {
  itemId: string;
  pecaId: string;
  formato: string;
  titulo: string;
  apelido: string;
  itemN: number;
  /** A legenda inteira que vai ao ar (no story, o texto da imagem, que não vai como legenda). */
  legenda: string;
  /** O que a Meta vai baixar: as imagens (JPEG) pela ordem, ou o mp4 do corte. */
  midia: { tipo: 'imagens'; n: number[] } | { tipo: 'video'; bytes: number | null; duracaoSeg: number | null } | { tipo: 'nenhuma' };
  agendadaPara: string;
  janelaAte: string;
  /** O @ de destino (a conta de publicação da empresa de agora). */
  handle: string | null;
  estadoDoItem: ItemDoLoteEstado;
  hashCurto: string;
  /** Por que o conteúdo de agora não é o que o hash cobre, ou nulo quando bate. */
  divergente: string | null;
}

/** `GET /pauta/lotes/:id/conteudo`. */
export interface PautaConteudoDoLote {
  loteId: string;
  estado: LoteEstado;
  hashCurto: string;
  validaAte: string;
  total: number;
  divergentes: number;
  handle: string | null;
  itens: PautaItemDoConteudoDoLote[];
  /** Os itens do YouTube (MD10): o envio privado e o agendamento, com o título, a descrição e a thumb. */
  youtube: PautaItemDoYoutubeNoLote[];
  /** As regras da DM automática (MD11): a palavra, o texto exato, o link e o destino, o teto e a janela. */
  dm?: PautaItemDaDmNoLote[];
}

// ---------- Pauta: a DM por palavra-chave, respondida à mão (MD9) ----------

/**
 * A capacidade da régua que lê os comentários das mídias da semana na Graph.
 * É leitura (R0): nada sai do OS, e o que ela devolve não carrega o texto do
 * comentário — o casamento da palavra acontece dentro do efeito.
 */
export const PAUTA_CAPACIDADE_DE_LER_COMENTARIOS = 'instagram.comentario.ler';

/** O tipo da rotina que monta a fila "quem comentou e o que responder" (`routines/executores/pauta-comentarios.executor.ts`). */
export const PAUTA_TIPO_DA_ROTINA_DE_COMENTARIOS = 'pauta.coletar-comentarios';

/**
 * A nota da memória que põe na fila também as RESPOSTAS a comentário (o
 * `parent_id` da Graph). Primeira linha `ligada`; sem ela, só o comentário de
 * primeiro nível entra. A própria conta e o comentário com mais de 7 dias
 * nunca entram, com ou sem nota.
 */
export const PAUTA_CHAVE_DAS_RESPOSTAS_NA_FILA = 'pauta.comentarios.respostas';

/** A janela da resposta privada da Meta: 7 dias do comentário. Também é o prazo em que o @ fica guardado. */
export const PAUTA_DM_JANELA_DIAS = 7;

/** A Meta mede o texto da mensagem em BYTES UTF-8, não em caracteres: "1000 bytes or less". */
export const PAUTA_DM_TETO_BYTES = 1000;

/** Quantos bytes o texto ocupa em UTF-8 (acento = 2, emoji = 4). Sem `TextEncoder`: roda igual no navegador e no Node. */
export function bytesUtf8(texto: string): number {
  let n = 0;
  for (const c of String(texto ?? '')) {
    const cp = c.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** O texto da DM de uma matéria, editado à mão. `null` volta ao texto padrão. */
export const PautaTextoDaDmSchema = z.object({
  texto: z
    .string()
    .trim()
    .min(1, 'O texto da DM não pode ficar vazio (para voltar ao padrão, use "Voltar ao padrão").')
    .refine((t) => bytesUtf8(t) <= PAUTA_DM_TETO_BYTES, {
      message: `O texto da DM passa de ${PAUTA_DM_TETO_BYTES} bytes: a Meta mede em bytes, e cada acento conta 2.`,
    })
    .nullable(),
});
export type PautaTextoDaDmInput = z.infer<typeof PautaTextoDaDmSchema>;

/** Um @ do Instagram: letras, números, ponto e sublinhado, até 30. */
export const INSTAGRAM_USUARIO_RE = /^[A-Za-z0-9._]{1,30}$/;

/** O endereço do perfil de quem comentou, para o "abrir perfil"; nulo quando o @ não tem a forma do Instagram. */
export function perfilDoInstagram(usuario: string | null | undefined): string | null {
  const u = String(usuario ?? '').trim().replace(/^@/, '');
  return INSTAGRAM_USUARIO_RE.test(u) ? `https://www.instagram.com/${u}/` : null;
}

/** O texto da DM de uma matéria, pronto para copiar (MC18.0). */
export interface PautaTextoDaDm {
  episodioId: string;
  apelido: string;
  itemId: string;
  itemN: number;
  palavra: string;
  materia: string;
  /** O que se cola no direct: o link rastreado da matéria e o endereço da página do episódio. Nulo com o `motivo`. */
  texto: string | null;
  motivo: string | null;
  /** O `/r/` do link de campanha `campanha:dm:<itemId>`, um por matéria. */
  link: string | null;
  bytes: number;
  /** O texto foi editado à mão (senão é o padrão, montado agora). */
  editado: boolean;
  /** A checagem anti-slop do texto de agora. */
  checagem: PautaChecagemAntiSlop | null;
}

/** Uma linha da fila "quem comentou e o que responder". Nunca traz o texto do comentário: ele não é gravado. */
export interface PautaComentarioNaFila {
  id: string;
  /** O @ de quem comentou. Some (nulo) depois de `expiraEm`: é dado pessoal e só vive enquanto a Meta deixaria responder. */
  usuario: string | null;
  palavra: string;
  pecaId: string;
  formato: PautaFormatoDaSemana;
  apelido: string;
  itemN: number;
  tituloDaPeca: string;
  comentadoEm: string;
  expiraEm: string;
  respondidoEm: string | null;
  /** O nome de quem marcou como respondido. */
  respondidoPor: string | null;
  texto: string | null;
  motivo: string | null;
  /** MD11: o envio automático desta linha, quando houve. */
  automatica?: PautaEnvioAutomatico | null;
}

/** `GET /pauta/comentarios`. */
export interface PautaFilaDeComentarios {
  linhas: PautaComentarioNaFila[];
  /** O texto da DM de cada matéria com palavra, das peças aprovadas ou publicadas nos últimos 7 dias. */
  textos: PautaTextoDaDm[];
  /** Quantas linhas ainda esperam resposta dentro dos 7 dias. */
  pendentes: number;
  conta: { handle: string | null; podeLerComentarios: boolean };
  /** A última passagem da rotina de comentários, ou nulo se ela nunca rodou. */
  ultimaColeta: { em: string; status: string; resumo: string | null } | null;
  /** MD11: a DM automática (a nota e as regras do lote). */
  dmAutomatica?: PautaDmAutomaticaNaFila;
  source: { tool: string; generatedAt: string };
}

// ---------- Pauta: o YouTube pela API (MD10) ----------
//
// O Mac manda os bytes do vídeo final direto ao YouTube, numa sessão de envio
// resumable que o OS abre com os metadados travados (sempre privado). O OS
// guarda a credencial, confere o vídeo que chegou, define a thumb e, com o lote
// da semana assinado, manda o `publishAt`: daí em diante quem publica é o
// YouTube. O vídeo nunca passa pela VPS.

/** A capacidade (R3, sob o lote da semana) que abre a sessão de envio e conclui o vídeo privado. */
export const PAUTA_CAPACIDADE_DE_ENVIAR_AO_YOUTUBE = 'youtube.video.enviar';
/** A capacidade (R3, sob o lote da semana) que agenda a publicação (`publishAt`), com a thumb e a playlist. */
export const PAUTA_CAPACIDADE_DE_PUBLICAR_NO_YOUTUBE = 'youtube.video.publicar';

/**
 * O interruptor da auditoria do projeto no Google (D-MC6), pela variável
 * `YOUTUBE_AUDITORIA`. Todo vídeo enviado por projeto sem auditoria fica
 * privado para SEMPRE, sem recurso: `pendente` (o padrão) recusa a sessão e a
 * publicação; `teste` libera o envio SÓ para o canal de `YOUTUBE_CANAL_DE_TESTE`
 * (o vídeo enviado nesse modo nunca é publicado depois) e recusa a publicação;
 * `aprovada` libera tudo. O envio é sempre privado, em qualquer um.
 */
export const YOUTUBE_AUDITORIAS = ['pendente', 'teste', 'aprovada'] as const;
export type YoutubeAuditoria = (typeof YOUTUBE_AUDITORIAS)[number];

export const YOUTUBE_AUDITORIA_ROTULO: Record<YoutubeAuditoria, string> = {
  pendente: 'auditoria pendente: nada vai ao YouTube',
  teste: 'modo teste: o envio vai só ao canal de teste e fica privado para sempre; a publicação não',
  aprovada: 'auditoria aprovada: envio e publicação',
};

/** O valor da variável, ou `pendente` quando vazia ou fora da lista (falha fechada). */
export function youtubeAuditoria(valor: string | null | undefined): YoutubeAuditoria {
  const v = String(valor ?? '').trim().toLowerCase();
  return (YOUTUBE_AUDITORIAS as readonly string[]).includes(v) ? (v as YoutubeAuditoria) : 'pendente';
}

/** Por que a auditoria não deixa ENVIAR, ou nulo. */
export function motivoDaAuditoriaParaEnviar(a: YoutubeAuditoria): string | null {
  return a === 'pendente'
    ? 'YOUTUBE_AUDITORIA=pendente: o projeto do Google ainda não passou pela auditoria, e todo vídeo enviado agora ficaria PRIVADO PARA SEMPRE, sem recurso. Nada foi enviado. Para testar num canal de teste, use YOUTUBE_AUDITORIA=teste com YOUTUBE_CANAL_DE_TESTE.'
    : null;
}

/** Por que a auditoria não deixa PUBLICAR, ou nulo. */
export function motivoDaAuditoriaParaPublicar(a: YoutubeAuditoria): string | null {
  if (a === 'aprovada') return null;
  return a === 'teste'
    ? 'YOUTUBE_AUDITORIA=teste: o envio vale só para o canal de teste, e o vídeo enviado nesse modo fica privado para sempre. A publicação espera a auditoria (YOUTUBE_AUDITORIA=aprovada).'
    : 'YOUTUBE_AUDITORIA=pendente: sem a auditoria do projeto, o YouTube não deixa o vídeo sair do privado. Nada foi enviado.';
}

/**
 * Espelha o enum `EnvioAoYoutubeEstado` do Prisma. `declarado`: o Mac disse o
 * sha256 e o tamanho do vídeo final; `sessao_aberta`: a sessão de envio existe
 * (vale 7 dias); `conferido`: o vídeo chegou, está privado, os metadados batem
 * e a thumb foi definida; `agendado`: o `publishAt` foi aceito; `erro`: a
 * última tentativa falhou, com o motivo.
 */
export const ENVIO_AO_YOUTUBE_ESTADOS = ['declarado', 'sessao_aberta', 'conferido', 'agendado', 'erro'] as const;
export type EnvioAoYoutubeEstado = (typeof ENVIO_AO_YOUTUBE_ESTADOS)[number];

export const ENVIO_AO_YOUTUBE_ESTADO_ROTULO: Record<EnvioAoYoutubeEstado, string> = {
  declarado: 'vídeo final declarado pelo Mac',
  sessao_aberta: 'envio em curso',
  conferido: 'no YouTube, privado e conferido',
  agendado: 'publicação agendada no YouTube',
  erro: 'o envio falhou',
};

/** O bloco que o Mac manda por pedido: 64 MiB. */
export const YOUTUBE_BLOCO_DO_ENVIO = 64 * 1024 * 1024;
/** Todo bloco que não é o último tem de ser múltiplo de 256 KiB (regra do upload resumable). */
export const YOUTUBE_MULTIPLO_DO_BLOCO = 256 * 1024;
/** O teto do YouTube para um vídeo: 256 GB. */
export const YOUTUBE_VIDEO_MAX_BYTES = 256 * 1024 * 1024 * 1024;
/** O vídeo final sai do ffmpeg do Mac como mp4; o .mov do OBS também vale. */
export const YOUTUBE_MIMES_DO_VIDEO = ['video/mp4', 'video/quicktime'] as const;
/** A sessão de envio resumable vale uma semana do lado do YouTube. */
export const YOUTUBE_VALIDADE_DA_SESSAO_MS = 7 * 86_400_000;
/** O envio precisa terminar até 1 h antes do horário do vídeo: a janela do item de envio fecha aí. */
export const YOUTUBE_ANTECEDENCIA_DO_ENVIO_MS = 3600_000;
/** O `publishAt` é mandado até 15 min antes do horário: a janela do item de publicação fecha aí. */
export const YOUTUBE_ANTECEDENCIA_DA_PUBLICACAO_MS = 15 * 60_000;
/** Cada sessão aberta e a conclusão gastam um uso do item de envio: três sessões (404, 7 dias) e a conclusão. */
export const YOUTUBE_USOS_DO_ENVIO = 4;
/** O `publishAt` pode ser reenviado depois de uma resposta perdida. */
export const YOUTUBE_USOS_DA_PUBLICACAO = 2;

/** Nota da memória: a playlist (o id, `PL…`) onde o vídeo entra. Sem ela, nenhuma. */
export const PAUTA_CHAVE_DA_PLAYLIST_DO_YOUTUBE = 'pauta.youtube.playlist';
/** Nota da memória: a categoria do vídeo (o número do YouTube). Sem ela, 28 (Ciência e tecnologia). */
export const PAUTA_CHAVE_DA_CATEGORIA_DO_YOUTUBE = 'pauta.youtube.categoria';
export const YOUTUBE_CATEGORIA_PADRAO = '28';

/** "fica fora" do lote da semana: este valor deixa o YouTube de fora (os outros são ids de peça). */
export const PAUTA_FORA_DO_LOTE_YOUTUBE = 'youtube';

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'O sha256 é hexadecimal minúsculo, com 64 caracteres.');

/** `PUT /pauta/episodios/:id/youtube/arquivo` e `POST …/youtube/sessao`: o vídeo final como o Mac o mediu. */
export const YoutubeArquivoSchema = z
  .object({
    sha256: sha256Hex,
    bytes: z.number().int().positive().max(YOUTUBE_VIDEO_MAX_BYTES, 'O YouTube aceita até 256 GB.'),
    mime: z.enum(YOUTUBE_MIMES_DO_VIDEO).default('video/mp4'),
  })
  .strict();
export type YoutubeArquivoInput = z.infer<typeof YoutubeArquivoSchema>;

/** `POST …/youtube/sessao`: o arquivo, e `nova` quando a sessão anterior sumiu (404) e o envio recomeça do zero. */
export const YoutubeSessaoSchema = YoutubeArquivoSchema.extend({ nova: z.boolean().default(false) }).strict();
export type YoutubeSessaoInput = z.infer<typeof YoutubeSessaoSchema>;

/** O id que o YouTube devolve no fim do envio. */
export const YoutubeVideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{6,32}$/, 'O id do vídeo do YouTube tem letras, números, - e _.');

/** `POST …/youtube/concluido`. */
export const YoutubeConcluidoSchema = z.object({ videoId: YoutubeVideoIdSchema }).strict();
export type YoutubeConcluidoInput = z.infer<typeof YoutubeConcluidoSchema>;

/** `PUT …/pacote/thumb`: a thumb que sobe ao YouTube (1 a 3), ou nenhuma. */
export const PautaThumbEscolhidaSchema = z
  .object({ n: z.number().int().min(1).max(PAUTA_THUMBS_DO_PACOTE).nullable() })
  .strict();
export type PautaThumbEscolhidaInput = z.infer<typeof PautaThumbEscolhidaSchema>;

/** `PUT …/pacote/horario`: quando o vídeo vai ao ar no YouTube (ISO com fuso), ou nenhum. */
export const PautaHorarioDoYoutubeSchema = z
  .object({ publicarEm: z.string().datetime({ offset: true, message: 'O horário vai em ISO com o fuso (ex.: 2026-09-29T18:00:00-03:00).' }).nullable() })
  .strict();
export type PautaHorarioDoYoutubeInput = z.infer<typeof PautaHorarioDoYoutubeSchema>;

/** O que falta para o YouTube entrar no lote da semana, com a frase de cada coisa. Vazio = pronto. */
export function faltasDoYoutube(e: {
  conectado: boolean;
  auditoria: YoutubeAuditoria;
  tituloEscolhido: boolean;
  descricao: boolean;
  thumbEscolhida: boolean;
  thumbComImagem: boolean;
  arquivo: boolean;
  publicarEm: Date | null;
  agora: Date;
  validadeMaximaMs: number;
}): string[] {
  const saida: string[] = [];
  const auditoria = motivoDaAuditoriaParaEnviar(e.auditoria);
  if (auditoria) saida.push(auditoria);
  if (!e.conectado) saida.push('O canal do YouTube não está conectado: conecte em Conexões (o OAuth é feito na conta dona do canal).');
  if (!e.tituloEscolhido) saida.push('Marque o título do vídeo no pacote.');
  if (!e.descricao) saida.push('O pacote não tem descrição: gere o pacote.');
  if (!e.thumbEscolhida) saida.push('Escolha a thumb que sobe na seção YouTube do episódio.');
  else if (!e.thumbComImagem) saida.push('A thumb escolhida ainda não foi renderizada: rode root-midia thumbs no Mac.');
  if (!e.arquivo) saida.push('O Mac ainda não declarou o vídeo final: rode root-midia youtube ep-NN --declarar.');
  if (!e.publicarEm) saida.push('Defina o horário do vídeo na seção YouTube do episódio.');
  else if (e.publicarEm.getTime() - YOUTUBE_ANTECEDENCIA_DO_ENVIO_MS <= e.agora.getTime()) {
    saida.push('O horário do vídeo precisa estar pelo menos 1 h à frente: o envio fecha 1 h antes.');
  } else if (e.publicarEm.getTime() > e.agora.getTime() + e.validadeMaximaMs) {
    saida.push('O horário do vídeo passa dos 8 dias que um lote vale: aprove o vídeo na semana dele.');
  }
  return saida;
}

/** O envio ao YouTube de um episódio, como a tela e o Mac o leem. Nunca traz a URI da sessão nem token. */
export interface PautaEnvioAoYoutube {
  estado: EnvioAoYoutubeEstado;
  sha256: string;
  bytes: number;
  mime: string;
  videoId: string | null;
  /** Até quando a sessão aberta vale. */
  sessaoExpiraEm: string | null;
  sessoes: number;
  conferidoEm: string | null;
  thumbDefinidaEm: string | null;
  playlistId: string | null;
  publicarEm: string | null;
  agendadoEm: string | null;
  erro: string | null;
  /** O vídeo subiu com `YOUTUBE_AUDITORIA=teste` (canal de teste): fica privado para sempre e nunca é publicado. */
  enviadoEmTeste: boolean;
  atualizadoEm: string;
}

/** `GET /pauta/episodios/:id/youtube`. */
export interface PautaYoutubeDoEpisodio {
  episodioId: string;
  apelido: string;
  auditoria: YoutubeAuditoria;
  /** O canal conectado (há credencial no cofre desta empresa); a saúde de verdade é a de Conexões. */
  conectado: boolean;
  tituloEscolhido: string | null;
  thumbEscolhida: number | null;
  publicarEm: string | null;
  /** O caminho do vídeo final no Mac (MC9). */
  arquivoFinal: string | null;
  envio: PautaEnvioAoYoutube | null;
  /** O que falta para o YouTube entrar no lote da semana. */
  faltas: string[];
  /** Os itens do YouTube num lote em curso. */
  itens: Array<{ capabilityId: string; itemId: string; loteId: string; estadoDoLote: LoteEstado; estadoDoItem: ItemDoLoteEstado; janelaAte: string }>;
  /** O link do vídeo, só depois de agendado (o vídeo privado não abre para ninguém de fora). */
  url: string | null;
  /** A nota `pauta.publicacao.automatica` e a rotina que marca o horário. Opcionais: a API anterior não os mandava. */
  automatica?: boolean;
  rotinaDePublicacao?: PautaRotinaDaPauta;
}

/** `POST …/youtube/sessao` e `…/sessao/token`: o que só o Mac recebe, e nunca vai ao RASTRO. */
export interface PautaSessaoDoYoutube {
  uri: string;
  /** Token de acesso curto (~1 h). O refresh token nunca sai do cofre. */
  token: string;
  tokenExpiraEm: string;
  sessaoExpiraEm: string;
  bytes: number;
  sha256: string;
  /** Uma sessão nova (a anterior sumiu ou venceu) começa do byte zero. */
  nova: boolean;
}

/** Um episódio com envio ao YouTube liberado pelo lote e ainda não concluído: o que o vigia do Mac envia. */
export interface PautaYoutubePendente {
  id: string;
  numero: number;
  apelido: string;
  arquivoFinal: string | null;
  sha256: string | null;
  estado: EnvioAoYoutubeEstado | null;
  janelaAte: string;
}

/** O YouTube diante do lote da semana. */
export interface PautaYoutubeNoLote {
  /** Entra no próximo lote (as faltas estão vazias e o item não está num lote ativo). */
  entra: boolean;
  faltas: string[];
  publicarEm: string | null;
  /** Os itens que entram: só o envio no modo teste, os dois com a auditoria aprovada, só o agendamento com o vídeo já no YouTube. */
  capacidades: string[];
  noLote: { loteId: string; estadoDoLote: LoteEstado } | null;
  /** A nota `pauta.publicacao.automatica` ligada: sem ela, o agendamento no horário não sai sozinho. */
  automatica: boolean;
}

/** Um item do YouTube do lote, como a titular o lê. */
export interface PautaItemDoYoutubeNoLote {
  itemId: string;
  capabilityId: string;
  /** O episódio: a miniatura da thumb assinada sai de `GET /pauta/episodios/:id/thumbs/:n/imagem`. */
  episodioId: string;
  titulo: string;
  descricao: string;
  bytesDaDescricao: number;
  categoria: string;
  thumbN: number | null;
  arquivo: { sha256Curto: string; bytes: number };
  /** O horário do vídeo (o `publishAt`), só no item de publicação. */
  publicarEm: string | null;
  janelaAte: string;
  estadoDoItem: ItemDoLoteEstado;
  hashCurto: string;
  divergente: string | null;
}

// ---------- Pauta: a DM automática sob o lote da semana (MD11) ----------
//
// Quem comenta a palavra recebe a resposta privada da Meta sem ninguém
// digitar. A regra de cada matéria (a palavra, o texto fixo, o link rastreado
// e o destino) é um ITEM do lote da semana, assinado pela titular com o resto
// da semana, com teto por dia e janela de 7 dias. O disparo é a rotina de
// comentários (MD9). Tudo nasce DESLIGADO pela nota `pauta.dm.automatica`:
// desligada, a fila da DM à mão continua sendo o caminho.

/** A capacidade (R3; R4 com a procedência externa que o executor sempre marca) que manda UMA resposta privada, sob o lote. */
export const PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO = 'instagram.resposta_privada.enviar';
/** A capacidade (R0: só diminui o alcance) que pausa a regra de uma matéria: o item de lote dela é revogado, e voltar pede assinatura nova. */
export const PAUTA_CAPACIDADE_DE_PAUSAR_A_DM = 'instagram.regra_de_resposta.pausar';

/**
 * A nota da memória que liga a DM automática da empresa: a primeira linha
 * `ligada`. Nasce desligada e só deve ser ligada depois do App Review da Meta
 * (Advanced Access de mensagens), do seed assinado e da segunda pessoa.
 */
export const PAUTA_CHAVE_DA_DM_AUTOMATICA = 'pauta.dm.automatica';

/**
 * Os dois interruptores da D-MD1 que a aba Semana liga e desliga: cada um é
 * uma nota da memória (ADR-011), gravada com motivo, versão e RASTRO.
 */
export const PAUTA_AUTOMACOES = ['publicacao', 'dm'] as const;
export type PautaAutomacao = (typeof PAUTA_AUTOMACOES)[number];
export const PAUTA_CHAVE_DA_AUTOMACAO: Readonly<Record<PautaAutomacao, string>> = {
  publicacao: PAUTA_CHAVE_DA_PUBLICACAO_AUTOMATICA,
  dm: PAUTA_CHAVE_DA_DM_AUTOMATICA,
};
export const PAUTA_AUTOMACAO_ROTULO: Readonly<Record<PautaAutomacao, string>> = {
  publicacao: 'publicação automática',
  dm: 'DM automática',
};
export const PautaAutomacaoSalvarSchema = z
  .object({
    ligada: z.boolean(),
    motivo: z.string().trim().min(10, 'Diga o motivo em pelo menos 10 caracteres.').max(300),
  })
  .strict();
export type PautaAutomacaoSalvarInput = z.infer<typeof PautaAutomacaoSalvarSchema>;

/** `INSTAGRAM_PEDIR_MENSAGENS`: a DM automática só existe com o escopo de mensagens pedido na conexão. */
export function pedeMensagensDoInstagram(valor: string | undefined): boolean {
  return /^(1|sim|true)$/i.test((valor ?? '').trim());
}

/** "fica fora" do lote da semana: este valor deixa as regras da DM de fora. */
export const PAUTA_FORA_DO_LOTE_DM = 'dm';

/** O teto de envios por dia de cada regra (D-MC9.4), contado no dia de São Paulo. */
export const PAUTA_DM_TETO_POR_DIA_PADRAO = 100;
/**
 * O teto absoluto por regra (D-MC9.2): nenhuma regra passa disso. Mora aqui,
 * como constante, e não no catálogo da política: o `tetoPorDia` do item é
 * calculado por `tetoDaRegra` e entra no hash do lote que a titular assina.
 */
export const PAUTA_DM_TETO_POR_DIA_MAXIMO = 200;

/**
 * Espelha o enum `EnvioDeRespostaEstado` do Prisma. `segurado`: fora da
 * janela de horário, espera ela abrir; `enviando`: o pedido está na porta;
 * `enviado`: a Meta aceitou; `recusado`: não saiu, com o porquê (a regra caiu,
 * a porta ou o próprio efeito recusou antes da Meta); `erro`: a Meta recusou;
 * `ignorado`: a mesma pessoa já recebeu a DM desta regra; `incerto`: a Meta
 * não respondeu (rede, prazo, 5xx sem corpo, a passagem caiu no meio) e a DM
 * pode ter saído — a trava da pessoa fica.
 */
export const ENVIO_DE_RESPOSTA_ESTADOS = ['segurado', 'enviando', 'enviado', 'recusado', 'erro', 'ignorado', 'incerto'] as const;
export type EnvioDeRespostaEstado = (typeof ENVIO_DE_RESPOSTA_ESTADOS)[number];

export const ENVIO_DE_RESPOSTA_ESTADO_ROTULO: Record<EnvioDeRespostaEstado, string> = {
  segurado: 'DM automática segurada até a janela de horário abrir',
  enviando: 'DM automática saindo',
  enviado: 'DM automática enviada',
  recusado: 'a DM automática não saiu',
  erro: 'a Meta recusou a DM automática',
  ignorado: 'a mesma pessoa já recebeu a DM desta matéria',
  incerto: 'a Meta não respondeu: a DM automática pode ter saído, confira no Instagram antes de responder à mão',
};

/** O envio automático de uma linha da fila, como a tela o mostra. */
export interface PautaEnvioAutomatico {
  estado: EnvioDeRespostaEstado;
  seguradoAte: string | null;
  enviadoEm: string | null;
  motivo: string | null;
}

/** Uma regra da DM (uma matéria) diante do próximo lote da semana. */
export interface PautaRegraDaDmParaAprovar {
  itemId: string;
  itemN: number;
  palavra: string;
  materia: string;
  /** O texto exato que sai, com a linha de mensagem automática no começo. Nulo com o `problema`. */
  texto: string | null;
  bytes: number;
  link: string | null;
  destino: string | null;
  janelaDe: string | null;
  janelaAte: string | null;
  tetoPorDia: number;
  /** Por que esta regra não entra no lote agora, ou nulo. */
  problema: string | null;
  noLote: { loteId: string; estadoDoLote: LoteEstado } | null;
}

/** As regras da DM no "Aprovar a semana". */
export interface PautaDmNoLote {
  /** A nota `pauta.dm.automatica`: desligada, a regra assinada não manda nada e a fila à mão continua. */
  automatica: boolean;
  regras: PautaRegraDaDmParaAprovar[];
}

/** Um item de DM do lote, como a titular o lê em /atendimento. */
export interface PautaItemDaDmNoLote {
  itemId: string;
  apelido: string;
  itemN: number;
  palavra: string;
  materia: string;
  texto: string;
  bytes: number;
  link: string;
  destino: string;
  /** Os posts onde a regra vale (carrossel e corte da matéria). */
  pecas: Array<{ id: string; formato: string; titulo: string }>;
  tetoPorDia: number | null;
  janelaDe: string;
  janelaAte: string;
  handle: string | null;
  estadoDoItem: ItemDoLoteEstado;
  hashCurto: string;
  divergente: string | null;
  /** A janela de horário da política em que a DM sai (`08:00–20:00`), no fuso dela. */
  horario: string;
  fuso: string;
}

/** Uma regra do lote, como a fila da DM a mostra. */
export interface PautaRegraDaDmNaFila {
  loteItemId: string;
  apelido: string;
  itemN: number;
  palavra: string;
  estadoDoItem: ItemDoLoteEstado;
  /** Por que a regra caiu (pausada à mão, destino mudado, Advanced Access, três recusas). */
  motivoDaPausa: string | null;
  tetoPorDia: number;
  /** Quantas saíram hoje (dia de São Paulo). */
  enviadasHoje: number;
  janelaAte: string;
}

/** O estado da DM automática na fila. */
export interface PautaDmAutomaticaNaFila {
  ligada: boolean;
  regras: PautaRegraDaDmNaFila[];
}

/** `POST /pauta/dm/regras/:itemId/pausar`: o porquê, que vai ao RASTRO. */
export const PautaPausarRegraDaDmSchema = z
  .object({ motivo: z.string().trim().min(3, 'Diga em poucas palavras por que a regra vai parar.').max(300) })
  .strict();
export type PautaPausarRegraDaDmInput = z.infer<typeof PautaPausarRegraDaDmSchema>;

// ---------- Trabalho (gestão de tarefas estilo ClickUp) ----------
// Contratos do módulo /trabalho: réplica de usabilidade do espaço `root` do
// ClickUp (fotografia 25/07/2026). Todo campo visível é editável.

export const WorkStatusTypeSchema = z.enum(['open', 'custom', 'closed']);
export type WorkStatusTypeDto = z.infer<typeof WorkStatusTypeSchema>;

export const WorkPrioritySchema = z.enum(['urgente', 'alta', 'normal', 'baixa']);
export type WorkPriorityDto = z.infer<typeof WorkPrioritySchema>;

// `moeda` guarda o texto canônico `BRL 1500.00` e não tem opções; quem confere
// o formato é o serviço, com a regra de `valor-monetario.ts`.
export const WorkFieldTypeSchema = z.enum(['drop_down', 'texto', 'numero', 'data', 'checkbox', 'url', 'moeda']);
export type WorkFieldTypeDto = z.infer<typeof WorkFieldTypeSchema>;

const corHex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'cor em hex, ex.: #6bc950');

/*
 * A ÁRVORE: espaço → pastas aninhadas → listas (ROOT-16). Cada nó tem UM pai:
 * a pasta fica no topo de um espaço (`spaceId`) ou dentro de outra pasta
 * (`parentId`); a lista fica numa pasta (`folderId`) ou solta no espaço
 * (`spaceId`). Sem nenhum dos dois, o nó fica fora de espaço, como tudo o que
 * existia antes da fatia.
 *
 * No PATCH, mandar qualquer uma das duas chaves é MOVER, e o destino é o par
 * inteiro: a chave ausente vale nulo. `{ parentId: X }` põe a pasta dentro de X;
 * `{ spaceId: Y }` leva ao topo de Y; `{ parentId: null }` tira do espaço.
 */
export const TrabEspacoCreateSchema = z.object({ name: z.string().min(1).max(80) });
export const TrabEspacoUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  order: z.number().int().min(0).optional(),
});
export type TrabEspacoCreateInput = z.infer<typeof TrabEspacoCreateSchema>;
export type TrabEspacoUpdateInput = z.infer<typeof TrabEspacoUpdateSchema>;

export const TRAB_PASTA_COM_DOIS_PAIS = 'A pasta fica no topo de um espaço ou dentro de outra pasta, não nos dois.';
export const TRAB_LISTA_COM_DOIS_PAIS = 'A lista fica numa pasta ou solta no espaço, não nos dois.';

export const TrabPastaCreateSchema = z.object({
  name: z.string().min(1).max(80),
  spaceId: z.string().uuid().nullish(),
  parentId: z.string().uuid().nullish(),
}).refine((p) => !(p.spaceId && p.parentId), TRAB_PASTA_COM_DOIS_PAIS);
export const TrabPastaUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  order: z.number().int().min(0).optional(),
  spaceId: z.string().uuid().nullish(),
  parentId: z.string().uuid().nullish(),
  /** Ícone e cor (I1, 22/10/2026): `null` apaga. Ver `aparencia-do-trabalho.ts`. */
  icone: TrabIconeSchema,
  cor: TrabCorSchema,
}).refine((p) => !(p.spaceId && p.parentId), TRAB_PASTA_COM_DOIS_PAIS);
export type TrabPastaCreateInput = z.infer<typeof TrabPastaCreateSchema>;
export type TrabPastaUpdateInput = z.infer<typeof TrabPastaUpdateSchema>;

export const TrabListaCreateSchema = z.object({
  folderId: z.string().uuid().nullish(),
  spaceId: z.string().uuid().nullish(),
  name: z.string().min(1).max(80),
}).refine((l) => !(l.folderId && l.spaceId), TRAB_LISTA_COM_DOIS_PAIS);
export const TrabListaUpdateSchema = z.object({
  folderId: z.string().uuid().nullish().optional(),
  spaceId: z.string().uuid().nullish(),
  name: z.string().min(1).max(80).optional(),
  order: z.number().int().min(0).optional(),
  /** Ícone e cor (I1, 22/10/2026): `null` apaga. Ver `aparencia-do-trabalho.ts`. */
  icone: TrabIconeSchema,
  cor: TrabCorSchema,
}).refine((l) => !(l.folderId && l.spaceId), TRAB_LISTA_COM_DOIS_PAIS);
export type TrabListaCreateInput = z.infer<typeof TrabListaCreateSchema>;
export type TrabListaUpdateInput = z.infer<typeof TrabListaUpdateSchema>;

/*
 * EXCLUIR LISTA PELA TELA (rodada de produção 1, P3, 21/10/2026). A pessoa
 * escreve o nome da lista para confirmar; a comparação ignora maiúscula, acento
 * não (é o nome que ela vê) e espaço sobrando. A lista só sai vazia ou com todas
 * as tarefas arquivadas: vazia é apagada; com tarefas arquivadas ela é ARQUIVADA
 * (`arquivadaEm`), porque apagar levaria as tarefas junto. Na tela, as duas são
 * "excluir".
 */
export const TrabListaExcluirSchema = z.object({
  confirmarNome: z.string().min(1).max(120),
}).strict();
export type TrabListaExcluirInput = z.infer<typeof TrabListaExcluirSchema>;

/** O nome como a confirmação compara: sem espaço nas pontas nem duplicado, sem diferença de maiúscula. */
export function nomeParaConfirmar(nome: string): string {
  return nome.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

/** O que a exclusão fez: `apagada` (a lista estava vazia) ou `arquivada` (as tarefas arquivadas ficam no banco). */
export interface TrabListaExcluida {
  id: string;
  modo: 'apagada' | 'arquivada';
  tarefasArquivadas: number;
}

/** O que a exclusão de pasta fez: `apagada` (vazia) ou `arquivada` (só guardava listas ou pastas já arquivadas). */
export interface TrabPastaExcluida {
  id: string;
  modo: 'apagada' | 'arquivada';
}

/** "Arquivar todas as tarefas da lista": quantas foram arquivadas agora. */
export const TrabListaArquivarTarefasSchema = z.object({
  /** Quantas a tela mostrou. Se o número mudou, nada é arquivado (409): alguém mexeu na lista. */
  esperadas: z.number().int().min(0).max(100_000),
}).strict();
export type TrabListaArquivarTarefasInput = z.infer<typeof TrabListaArquivarTarefasSchema>;
export interface TrabListaTarefasArquivadas {
  id: string;
  arquivadas: number;
}

/**
 * Limite de trabalho em andamento da etapa (o WIP do kanban). `null` apaga o
 * limite. AVISA, NÃO TRAVA — ver `WorkStatus.limite` no schema do Prisma.
 */
const limiteDeEtapa = z.number().int().min(1).max(99);

export const TrabStatusCreateSchema = z.object({
  name: z.string().min(1).max(60),
  type: WorkStatusTypeSchema.default('custom'),
  color: corHex.optional(),
  limite: limiteDeEtapa.nullish(),
});
export const TrabStatusUpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  type: WorkStatusTypeSchema.optional(),
  color: corHex.optional(),
  order: z.number().int().min(0).optional(),
  limite: limiteDeEtapa.nullish().optional(),
});

export const TrabCampoCreateSchema = z.object({
  listId: z.string().uuid().nullish(), // nulo = espaço todo
  name: z.string().min(1).max(60),
  type: WorkFieldTypeSchema.default('drop_down'),
});
export const TrabCampoUpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  order: z.number().int().min(0).optional(),
});

export const TrabOpcaoCreateSchema = z.object({ name: z.string().min(1).max(60), color: corHex.optional() });
export const TrabOpcaoUpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: corHex.optional(),
  order: z.number().int().min(0).optional(),
});

export const TrabTagCreateSchema = z.object({ name: z.string().min(1).max(40), color: corHex.optional() });
export const TrabTagUpdateSchema = z.object({ name: z.string().min(1).max(40).optional(), color: corHex.optional() });

// valor de campo por tarefa: dropdown usa optionId; demais tipos usam value
export const TrabCampoValorSchema = z.object({
  optionId: z.string().uuid().nullish(),
  value: z.string().max(2000).nullish(),
});

/** `interno` = o cliente da casa (pastas Administrativa e Gestão); senão o id do `Partner`. */
export const TRAB_CLIENTE_INTERNO = 'interno';
export const TrabClienteIdSchema = z.union([z.literal(TRAB_CLIENTE_INTERNO), z.string().uuid()]);

/** O que o seletor de cliente lista (`GET /trabalho/clientes`). */
export interface TrabClienteDto {
  id: string;
  nome: string;
  /** Só o final do documento ("…0190"): o cadastro inteiro é do Financeiro. */
  cnpj: string | null;
  interno: boolean;
}

/**
 * A DICA DO NOME DA TAREFA (rodada do trabalho T4): verbo no imperativo + objeto,
 * curto. O cliente NÃO entra no nome (é campo). Só orienta: validar por regex seria
 * frágil. A IA das atas e das ideias propõe neste formato.
 */
export const DICA_DO_NOME_DA_TAREFA = 'Verbo no imperativo + objeto, curto: "Enviar proposta revisada", "Marcar kickoff", "Instalar o kit". O cliente fica no campo Cliente, não no nome.';

export const TrabTarefaCreateSchema = z.object({
  listId: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(20000).nullish(),
  statusId: z.string().uuid().optional(), // default: primeiro status da lista
  priority: WorkPrioritySchema.optional(),
  assignee: z.string().max(120).nullish(),
  assigneeUserId: z.string().uuid().nullish(),
  dueDate: z.string().datetime().nullish(),
  startDate: z.string().datetime().nullish(),
  parentId: z.string().uuid().nullish(),
  tagIds: z.array(z.string().uuid()).optional(),
  campos: z.record(z.string().uuid(), TrabCampoValorSchema).optional(),
  /**
   * O CLIENTE DA TAREFA (rodada do trabalho T4, 19/10/2026): o id de um `Partner`
   * cliente desta empresa, ou `interno` para o cliente da casa (criado sob demanda).
   * A rota de criação exige; subtarefa sem cliente herda o da mãe.
   */
  clienteId: TrabClienteIdSchema.nullish(),
});

export const TrabTarefaUpdateSchema = z.object({
  listId: z.string().uuid().optional(), // mover de lista (re-status obrigatório via statusId)
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(20000).nullish().optional(),
  statusId: z.string().uuid().optional(),
  priority: WorkPrioritySchema.optional(),
  assignee: z.string().max(120).nullish().optional(),
  assigneeUserId: z.string().uuid().nullish().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  dueDate: z.string().datetime().nullish().optional(),
  startDate: z.string().datetime().nullish().optional(),
  parentId: z.string().uuid().nullish().optional(),
  archived: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
  campos: z.record(z.string().uuid(), TrabCampoValorSchema).optional(),
  /** Trocar o cliente. Nulo não é aceito: tirar o cliente de uma tarefa iria contra a regra. */
  clienteId: TrabClienteIdSchema.optional(),
  /**
   * VÁRIOS RESPONSÁVEIS (versão final, 19/10/2026, trazido do Lucas): o principal
   * continua em `assigneeUserId`; os demais, aqui. Lista vazia tira os demais.
   */
  outrosResponsaveisIds: z.array(z.string().uuid()).max(20).optional(),
  /** A regra de repetição; nulo tira. Concluir a tarefa cria a próxima ocorrência. */
  recorrencia: RecorrenciaSchema.nullable().optional(),
});
// HTTP e escritores de WorkTask usam o schema com versão obrigatória; o schema-base permanece exportado.
export const TrabTarefaUpdateHttpSchema = TrabTarefaUpdateSchema.extend({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
});
export const TrabTarefaArchiveHttpSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();
export type TrabTarefaUpdateHttpInput = z.infer<typeof TrabTarefaUpdateHttpSchema>;
export type TrabTarefaArchiveHttpInput = z.infer<typeof TrabTarefaArchiveHttpSchema>;

/**
 * ORDEM MANUAL (versão final, 19/10/2026): a sequência de uma coluna ou da lista,
 * cada tarefa com a versão lida. Uma versão vencida derruba a sequência inteira (409).
 */
export const TrabTarefasOrdemSchema = z.object({
  itens: z.array(z.object({
    id: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  }).strict()).min(1).max(500),
}).strict();
export type TrabTarefasOrdemInput = z.infer<typeof TrabTarefasOrdemSchema>;

export type TrabTarefaCreateInput = z.infer<typeof TrabTarefaCreateSchema>;
export type TrabTarefaUpdateInput = z.infer<typeof TrabTarefaUpdateSchema>;

export const TrabComentarioSchema = z.object({ text: z.string().min(1).max(10000) });

/* ----------------------------------------------------------------------------
 * HORAS APONTADAS — a esteira de clientes (17/09/2026)
 *
 * `minutos` inteiros, de 1 a 1440 (o banco confere o mesmo intervalo). A tela
 * converte "1,5 h" em 90; a API não aceita fração para que a soma nunca dependa
 * de arredondamento de quem chamou.
 *
 * `dia` é a data em que o trabalho aconteceu, no formato AAAA-MM-DD. Ausente =
 * hoje no fuso de Brasília. Dia futuro é recusado pelo serviço: hora ainda não
 * gasta não é apontamento, é previsão.
 * -------------------------------------------------------------------------- */
export const TrabApontamentoCreateSchema = z.object({
  minutos: z.number().int().min(1).max(1440),
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dia no formato AAAA-MM-DD').optional(),
  nota: z.string().max(500).nullish(),
});
export type TrabApontamentoCreateInput = z.infer<typeof TrabApontamentoCreateSchema>;

/* ----------------------------------------------------------------------------
 * MODELOS DE LISTA — uma lista pronta em um clique
 *
 * O modelo é DADO versionado aqui, não linha de banco: é o mesmo para toda
 * empresa, e mudá-lo é decisão de produto que passa por revisão de código. Criar
 * a lista a partir dele copia as etapas e os campos; depois disso a lista é da
 * empresa e se edita como qualquer outra — o modelo não fica amarrado a ela.
 *
 * A esteira de clientes nasceu do plano de produto da Root (15–16/09/2026):
 * seis etapas de trabalho e uma de saída, com limite de duas implantações ao
 * mesmo tempo enquanto as horas por implantação não forem medidas.
 * -------------------------------------------------------------------------- */
export interface ModeloDeLista {
  chave: string;
  nome: string;
  descricao: string;
  etapas: ReadonlyArray<{ name: string; type: WorkStatusTypeDto; color: string; limite: number | null }>;
  campos: ReadonlyArray<{
    name: string;
    type: WorkFieldTypeDto;
    opcoes?: ReadonlyArray<{ name: string; color: string }>;
  }>;
}

export const MODELOS_DE_LISTA = {
  'esteira-de-clientes': {
    chave: 'esteira-de-clientes',
    nome: 'Esteira de clientes',
    descricao: 'Da qualificação à operação, com limite de implantações simultâneas e horas por etapa.',
    etapas: [
      { name: 'Qualificação', type: 'open', color: '#87909e', limite: null },
      { name: 'Diagnóstico', type: 'custom', color: '#4194f6', limite: null },
      { name: 'Contrato', type: 'custom', color: '#a875ff', limite: null },
      { name: 'Onboarding', type: 'custom', color: '#f9d900', limite: null },
      { name: 'Implantação', type: 'custom', color: '#ff7800', limite: 2 },
      { name: 'Operação', type: 'custom', color: '#1bbc9c', limite: null },
      { name: 'Encerrado', type: 'closed', color: '#6b7280', limite: null },
    ],
    campos: [
      {
        name: 'Perfil',
        type: 'drop_down',
        opcoes: [
          { name: 'P1 · conhece o ChatGPT', color: '#87909e' },
          { name: 'P2 · tem sistema e base', color: '#4194f6' },
          { name: 'P3 · muito dado, não cruza', color: '#a875ff' },
        ],
      },
      {
        name: 'Origem',
        type: 'drop_down',
        opcoes: [
          { name: 'Indicação', color: '#1bbc9c' },
          { name: 'Evento', color: '#ff7800' },
          { name: 'Tráfego', color: '#4194f6' },
          { name: 'Parceiro ERP', color: '#a875ff' },
          { name: 'Rede dos sócios', color: '#f9d900' },
        ],
      },
      { name: 'Sistema / ERP', type: 'texto' },
      { name: 'Valor do contrato (R$)', type: 'numero' },
      { name: 'Próximo passo', type: 'texto' },
    ],
  },
  /*
   * ONBOARDING DE CLIENTE (rodada do painel P2, 18/10/2026). As etapas são as
   * cinco fases do trilho de onboarding (`onboarding/trilho/fases.ts`,
   * `ROTULO_DA_FASE`) e a saída, na mesma ordem e com os mesmos nomes. Nenhuma
   * regra nova: sem limite (o trilho não tem limite de fase) e sem campo. O
   * PORTÃO continua sendo do trilho, não da lista: mover o cartão de coluna não
   * cumpre portão nenhum, e o cartão ligado a um trilho linka o trilho.
   */
  'onboarding-de-cliente': {
    chave: 'onboarding-de-cliente',
    nome: 'Onboarding de cliente',
    // Rodada da implantação I1 (18/10/2026): as etapas do mockup aprovado. O card nasce em
    // "Fechado no comercial" pela sexta escrita do fechamento; a lista criada antes desta data
    // migra pelo caminho normal de edição de etapa (`homolog/migrar-etapas-onboarding.mjs`), sem apagar tarefa.
    descricao: 'A implantação de cada cliente, do fechamento no comercial à operação assistida. O card nasce sozinho quando o contrato fecha.',
    etapas: [
      { name: 'Fechado no comercial', type: 'open', color: '#87909e', limite: null },
      { name: 'Kickoff marcado', type: 'custom', color: '#4194f6', limite: null },
      { name: 'Kit montado', type: 'custom', color: '#a875ff', limite: null },
      { name: 'Contexto carregado', type: 'custom', color: '#f08a24', limite: null },
      { name: 'Imersão', type: 'custom', color: '#f9d900', limite: null },
      { name: 'Operação assistida', type: 'custom', color: '#1bbc9c', limite: null },
      { name: 'Encerrado', type: 'closed', color: '#6b7280', limite: null },
    ],
    campos: [],
  },
} as const satisfies Record<string, ModeloDeLista>;

/* ----------------------------------------------------------------------------
 * A ESTRUTURA SUGERIDA DO TRABALHO (rodada do painel P2, 18/10/2026)
 *
 * Pastas são `WorkFolder` (já existiam, com `parentId` e `spaceId`); NÃO há
 * tabela de pasta paralela. Isto é só a SEMENTE que um clique cria quando a
 * empresa ainda não tem pasta: três pastas de topo e, dentro de Clientes, a
 * esteira, o onboarding e a execução. Depois de criada é da empresa e se edita
 * na tela como qualquer pasta ou lista.
 *
 * A rota (`POST /trabalho/estrutura/sugerida`) e o seed da homologação criam SÓ
 * o que falta, conferindo pelo nome (sem diferença de maiúscula e espaço): nunca
 * duplica, nunca renomeia, nunca move o que já existe. `modelo: null` = lista
 * com as etapas padrão (A fazer, Em andamento, Concluída).
 * -------------------------------------------------------------------------- */
export interface ListaSugerida { nome: string; modelo: ChaveDeModeloDeLista | null }
export interface PastaSugerida {
  nome: string; listas: readonly ListaSugerida[];
  /** Do Comercial (I3, 22/10/2026): nasce marcada, fora da árvore do Trabalho (ver `pasta-do-comercial.ts`). */
  doComercial?: boolean;
}

/*
 * Rodada de produção 1 (21/10/2026, a ata do Rodrigo): Gestão leva Administrativo,
 * Financeiro e Pessoas; a pasta "Administrativa" saiu do desenho e nunca é recriada.
 * Lista de mesmo nome que já existe SOLTA (sem pasta) é movida para a pasta sugerida
 * em vez de ganhar uma gêmea: mover preserva tarefas e ids.
 */
export const ESTRUTURA_SUGERIDA: readonly PastaSugerida[] = [
  {
    nome: 'Gestão',
    listas: [
      { nome: 'Administrativo', modelo: null },
      { nome: 'Financeiro', modelo: null },
      { nome: 'Pessoas', modelo: null },
    ],
  },
  {
    nome: 'Clientes',
    doComercial: true,
    listas: [
      { nome: 'Esteira de clientes', modelo: 'esteira-de-clientes' },
      { nome: 'Onboarding de cliente', modelo: 'onboarding-de-cliente' },
      { nome: 'Execução', modelo: null },
    ],
  },
];

/** O que a criação da estrutura sugerida fez. Os nomes vêm como `Pasta` ou `Pasta / Lista`. */
export interface TrabEstruturaSugeridaResultado {
  criadas: { pastas: string[]; listas: string[] };
  jaExistiam: { pastas: string[]; listas: string[] };
  /** Listas soltas de mesmo nome levadas para a pasta sugerida (`Pasta / Lista`). Ausente na API antiga. */
  movidas?: { listas: string[] };
}

export type ChaveDeModeloDeLista = keyof typeof MODELOS_DE_LISTA;

export const TrabListaDoModeloSchema = z.object({
  modelo: z.enum(Object.keys(MODELOS_DE_LISTA) as [ChaveDeModeloDeLista, ...ChaveDeModeloDeLista[]]),
  folderId: z.string().uuid().nullish(),
  spaceId: z.string().uuid().nullish(),
  /** Ausente = o nome do modelo. */
  name: z.string().min(1).max(80).optional(),
}).refine((l) => !(l.folderId && l.spaceId), TRAB_LISTA_COM_DOIS_PAIS);
export type TrabListaDoModeloInput = z.infer<typeof TrabListaDoModeloSchema>;

/* ----------------------------------------------------------------------------
 * O CHECKOUT ATÔMICO — assumir e soltar tarefa (fatia A4)
 *
 * `agente` é o SLUG, não o id: é o que a tela mostra, é estável por empresa
 * (`@@unique([orgId, slug])`) e não deixa o cliente adivinhar uuid de agente de
 * outra empresa. Quem traduz slug para id é o serviço, com consulta escopada.
 *
 * `statusId` é opcional e move a tarefa NA MESMA instrução do checkout — é o
 * "transição para em andamento exige checkout atômico" do plano. Nulo/ausente =
 * assume sem mover de etapa.
 * -------------------------------------------------------------------------- */
export const TrabAssumirSchema = z.object({
  agente: z.string().min(1).max(64),
  statusId: z.string().uuid().nullish(),
});
export const TrabSoltarSchema = z.object({
  /** Por que está devolvendo. Opcional: soltar é freio, e freio não pede redação. */
  motivo: z.string().max(500).nullish(),
});
export type TrabAssumirInput = z.infer<typeof TrabAssumirSchema>;
export type TrabSoltarInput = z.infer<typeof TrabSoltarSchema>;

// ---- Formatos de resposta (GET) ----
export interface TrabOpcaoDto { id: string; name: string; color: string; order: number }
export interface TrabCampoDto {
  id: string; listId: string | null; name: string; type: WorkFieldTypeDto; order: number;
  options: TrabOpcaoDto[];
}
export interface TrabStatusDto {
  id: string; name: string; type: WorkStatusTypeDto; color: string; order: number; total: number;
  /** Limite de trabalho em andamento; `null` = sem limite. `total` acima dele é aviso, não erro. */
  limite: number | null;
}
export interface TrabListaDto {
  id: string; name: string; order: number; externalId: string | null; total: number;
  /** Só na lista solta no espaço; a que está numa pasta herda o espaço dela. */
  spaceId: string | null;
  statuses: TrabStatusDto[]; fields: TrabCampoDto[];
  /** `cadastro` não recebe tarefa movida de outra lista (A3); ausente = `tarefas`. */
  natureza?: 'tarefas' | 'cadastro';
  /** Ícone e cor na frente do nome (I1, 22/10/2026); ausente ou nulo = sem. */
  icone?: string | null;
  cor?: CorDoTrabalho | null;
}
/**
 * `folders` traz TODAS as pastas, de qualquer nível, numa lista só: quem quiser
 * a árvore monta por `spaceId` e `parentId`, e quem só junta as listas (o quadro
 * de hoje) continua achando todas em `folders[].lists` e `listasSoltas`.
 */
export interface TrabPastaDto {
  id: string; name: string; order: number; lists: TrabListaDto[];
  spaceId: string | null; parentId: string | null; externalId: string | null;
  /** Ícone e cor na frente do nome (I1, 22/10/2026); ausente ou nulo = sem. */
  icone?: string | null;
  cor?: CorDoTrabalho | null;
}
export interface TrabEspacoDto { id: string; name: string; order: number; externalId: string | null }
export interface TrabTagDto { id: string; name: string; color: string }
/**
 * Um agente, como o quadro de Trabalho precisa vê-lo (fatia A4).
 *
 * `podeAssumir` vem DA API e não é recalculado na tela: quem sabe quais estados
 * trabalham é `agents/estado-do-agente.ts`, e repetir a regra no componente é
 * como as duas telas passaram a publicar horas contraditórias. `tarefas` é a
 * carga atual — quantas tarefas não arquivadas ele tem travadas.
 */
export interface TrabAgenteDto {
  id: string;
  slug: string;
  nome: string;
  iniciais: string;
  estado: string;
  podeAssumir: boolean;
  tarefas: number;
}

export interface TrabPessoaDto { id: string; name: string; email: string; isActive: boolean }

export interface TrabEstrutura {
  espacos: TrabEspacoDto[];
  folders: TrabPastaDto[];
  listasSoltas: TrabListaDto[];
  /**
   * A pasta Clientes e as listas dela (I3, 22/10/2026): do Comercial, fora da árvore.
   * Para ACHAR uma lista pelo id, nunca para desenhar; ver `pasta-do-comercial.ts`.
   */
  pastasDoComercial?: TrabPastaDto[];
  camposGlobais: TrabCampoDto[];
  tags: TrabTagDto[];
  /** Os responsáveis HUMANOS que aparecem nas tarefas (texto livre). */
  responsaveis: string[];
  /** Contas desta empresa para associação explícita, incluindo vínculos inativos. */
  pessoas?: TrabPessoaDto[];
  /** Os agentes desta empresa — a quem a tarefa pode ser entregue. */
  agentes: TrabAgenteDto[];
}

export interface TrabValorDto {
  fieldId: string; fieldName: string; type: WorkFieldTypeDto;
  optionId: string | null; optionName: string | null; optionColor: string | null;
  value: string | null;
}
export interface TrabTarefaResumo {
  id: string; listId: string; title: string;
  statusId: string; statusName: string; statusType: WorkStatusTypeDto; statusColor: string;
  priority: WorkPriorityDto;
  /** O responsável HUMANO (texto livre). Não é quem executa. */
  assignee: string | null;
  /** Vínculo por conta. O texto legado permanece separado. */
  assigneeUserId?: string | null;
  assigneeUserName?: string | null;
  assigneeUserEmail?: string | null;
  assigneeUserIsActive?: boolean | null;
  updatedAt?: string;
  /**
   * O AGENTE EXECUTOR que tem a tarefa na mão, ou nulo quando ela está livre
   * (fatia A4).
   *
   * `agenteId` preenchido com `agenteSlug` e `agenteNome` NULOS é o terceiro
   * caso, e ele quer dizer uma coisa só: o ponteiro não resolve em agente desta
   * empresa. A tarefa está travada e a tela diz "outro agente" em vez de
   * inventar nome — ver `work/agentes-da-casa.ts`.
   */
  agenteId: string | null; agenteSlug: string | null; agenteNome: string | null;
  /** Desde quando está travada. É o que responde "isto está parado?". */
  agenteEm: string | null;
  /**
   * Desde quando está NA ETAPA ATUAL — a idade do cartão no kanban. Carimbado
   * pelo banco. Nulo = tarefa anterior à esteira (17/09/2026): a data real não
   * existe, e a tela não mostra idade em vez de inventar uma.
   */
  statusDesde: string | null;
  /** Soma das horas apontadas nesta tarefa, em minutos. */
  minutos: number;
  dueDate: string | null; startDate: string | null; overdue: boolean;
  parentId: string | null; subtasks: number; comments: number;
  externalId: string | null; externalUrl: string | null; archived: boolean; order: number;
  tags: TrabTagDto[]; values: TrabValorDto[];
  /** O cliente (T4). Nulo = tarefa antiga sem cliente: a tela mostra o selo "sem cliente". */
  clienteId: string | null; clienteNome: string | null;
  /** Os demais responsáveis por conta (o principal é `assigneeUserId`). */
  outrosResponsaveisIds?: string[];
  /** A regra de repetição; nulo = não repete. */
  recorrencia?: RecorrenciaDaTarefa | null;
  /** O nome da lista, para a visão "Todas" (tarefas de várias listas juntas). */
  listName?: string;
}
/* ----------------------------------------------------------------------------
 * O MOVIMENTO DO CARTÃO no quadro denso (rodada da implantação I2, 18/10/2026)
 *
 * O rodapé do cartão ("Pedro · moveu para Kit montado · há 2h") e o balão dos
 * três últimos passos LEEM a mesma auditoria (`work.task.create`/`update`) e os
 * mesmos `WorkComment` que a caixa de entrada consome: nenhuma segunda fonte.
 * `em` vai em ISO; o "há 2h" é conta da tela.
 * -------------------------------------------------------------------------- */
export type TrabTipoDoPasso = 'criacao' | 'status' | 'atribuicao' | 'vencimento' | 'edicao' | 'comentario';
export interface TrabPassoDoCartao {
  tipo: TrabTipoDoPasso;
  quem: string;
  /** "moveu para Kit montado", "abriu o card", ou o trecho do comentário entre aspas. */
  frase: string;
  em: string;
}
export interface TrabMovimentoDoCartao {
  tarefaId: string;
  /** O mais novo entre a última movimentação e o último comentário: o rodapé. */
  ultimo: TrabPassoDoCartao | null;
  /** As três últimas movimentações (sem comentário), da mais nova para a mais velha: o balão. */
  passos: TrabPassoDoCartao[];
  ultimoComentario: TrabPassoDoCartao | null;
  /**
   * A próxima ação da linha 2 do cartão, só de fonte real: o próximo passo do
   * trilho ligado ao card, a primeira subtarefa aberta, ou (card que nasceu do
   * fechamento e ainda sem kickoff) "marcar o kickoff". Sem fonte, nulo.
   */
  proximaAcao: { texto: string; dono: string | null; quando: string | null; fonte: 'trilho' | 'subtarefa' | 'implantacao' } | null;
  /**
   * O selo de procedência do card que veio do comercial: aberto pelo fechamento (I1);
   * iniciado antes do fechamento, com o lead ainda no funil (ajustes A2); ou o aviso de
   * que o lead do card antecipado saiu do funil e alguém precisa decidir (A2).
   */
  procedencia: { tipo: 'fechamento' | 'antecipado' | 'saiu_do_funil'; leadId: string; rotulo: string } | null;
}
export interface TrabMovimentoDoQuadro { itens: TrabMovimentoDoCartao[] }

export interface TrabComentarioDto {
  id: string; authorId: string | null; authorName: string; text: string; createdAt: string;
}
export interface TrabAtividadeDto {
  id: string; actorType: string; actorName: string | null; action: string;
  before: unknown; after: unknown; createdAt: string;
}
/** Atividade ordenada dentro da âncora da primeira consulta. */
export interface TrabAtividadePagina {
  escopo: { orgId: string; taskId: string; userId: string };
  consultadoEm: string;
  items: TrabAtividadeDto[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  anchor: { createdAt: string; id: string } | null;
}
export interface TrabApontamentoDto {
  id: string; autorId: string | null; autorNome: string;
  minutos: number;
  /** AAAA-MM-DD — o dia em que o trabalho aconteceu. */
  dia: string;
  /** Nome da etapa no momento do lançamento (fotografia). */
  etapa: string;
  nota: string | null; createdAt: string;
}
export interface TrabTarefaDetalhe extends TrabTarefaResumo {
  description: string | null; listName: string;
  createdAt: string; updatedAt: string;
  comentarios: TrabComentarioDto[]; atividade: TrabAtividadeDto[];
  /** Os lançamentos, do dia mais recente para o mais antigo (até 200). */
  apontamentos: TrabApontamentoDto[];
  /** Soma por etapa, na ordem em que as etapas apareceram pela primeira vez. Cobre TODOS os lançamentos, não só os 200 listados. */
  minutosPorEtapa: Array<{ etapa: string; minutos: number }>;
  filhos: Array<{ id: string; title: string; statusName: string; statusColor: string }>;
  /** Devolvido pela edição que concluiu uma tarefa que se repete: a próxima ocorrência. */
  proxima?: { id: string; dueDate: string | null } | null;
}
export interface TrabTarefaLista {
  items: TrabTarefaResumo[]; total: number;
  source: { tool: string; generatedAt: string };
}

/* ==========================================================================
 * A LINHA DO TEMPO — fatia A9
 * ==========================================================================
 *
 * O contrato da leitura narrativa do RASTRO. `interface` e não schema Zod pela
 * mesma razão dos tipos de Trabalho logo acima: o web consome, não valida — e a
 * validação que importa é a da ENTRADA, que mora na API (`narrativa.ts`).
 *
 * NENHUM CAMPO DE CONTEÚDO AQUI, e isso é o desenho: `temConteudo` diz que o
 * evento carrega conteúdo, e `/atendimento` é onde ele se lê, com permissão
 * própria. Ver o cabeçalho de `apps/api/src/linha-do-tempo/narrativa.ts`.
 */
export interface LinhaDoTempoItem {
  id: string;
  /** `EventLog.seq` como texto: BigInt não viaja em JSON. Ordem da cadeia. */
  seq: string;
  /** O tipo CRU do evento. Sempre presente, inclusive quando é o rótulo. */
  tipo: string;
  /** O que a pessoa lê. Igual a `tipo` quando `conhecido` é falso. */
  rotulo: string;
  familia: string;
  /** Falso = a tela não sabe nomear este evento, e diz isso. */
  conhecido: boolean;
  ocorreuEm: string;
  atorTipo: 'user' | 'ai' | 'system';
  atorId: string | null;
  /**
   * O nome de quem fez, resolvido DENTRO da empresa.
   *
   * `atorTipo: 'user'` com `atorId` preenchido e `ator` nulo é o terceiro caso, e
   * quer dizer uma coisa só: o ponteiro não resolve em gente desta empresa. A
   * tela diz "fora desta empresa" em vez de inventar nome — mesma regra de
   * `agents/donos-da-casa.ts`.
   */
  ator: string | null;
  agenteSlug: string | null;
  /** Nulo com `agenteSlug` preenchido = agente que não é mais desta casa. */
  agenteNome: string | null;
  capacidade: string | null;
  nivel: string | null;
  correlacao: string | null;
  /** Identificadores legíveis do objeto do evento. Nunca conteúdo. */
  objeto: { chave: string; valor: string }[];
  sensibilidade: string | null;
  /** `payload.rastro.completo` — a linha saiu com tudo o que o nível exige? */
  registroCompleto: boolean | null;
  /** O evento carrega conteúdo que esta rota não devolve. */
  temConteudo: boolean;
}

export interface LinhaDoTempoFiltros {
  agentes: { slug: string; nome: string | null; eventos: number }[];
  familias: { chave: string; rotulo: string; eventos: number }[];
  tipos: { tipo: string; rotulo: string; conhecido: boolean; eventos: number }[];
  /** Quantos tipos distintos a tela não sabe nomear, na janela contada. */
  desconhecidos: number;
  /** Quantos eventos a contagem varreu. Diz que ela é PARCIAL quando é. */
  janela: number;
  parcial: boolean;
}

export interface LinhaDoTempoResposta {
  itens: LinhaDoTempoItem[];
  /** Nulo = fim da linha. Opaco: devolva-o como veio. */
  proximoCursor: string | null;
  /**
   * Só vem na PRIMEIRA página (sem cursor). Paginar não recalcula as contagens:
   * elas não mudam enquanto se rola, e recalculá-las a cada página pagaria duas
   * varreduras por rolagem para mostrar o mesmo número.
   */
  filtros: LinhaDoTempoFiltros | null;
  /** O prazo de guarda desta empresa. É o horizonte real da tela. */
  retencaoDias: number;
  source: { tool: string; generatedAt: string };
}

/* ==========================================================================
 * A CAIXA PESSOAL — "o que precisa de mim", fatia A7
 * ==========================================================================
 *
 * `GET /api/caixa` e `GET /api/caixa/contador`. A caixa AGREGA o que já existe
 * (aprovações, tarefas, comentários do quadro) e não tem fonte própria — nem
 * tabela, nem coluna, nem caminho de escrita. As regras estão em
 * `apps/api/src/caixa/o-que-espera.ts`.
 *
 * O QUE ELA NÃO DEVOLVE, de propósito: o conteúdo exato de uma ação retida. Esse
 * corpo tem UMA superfície neste repositório (`GET /approvals/fila`, e só para
 * quem tem `aprovacoes.decidir`), e uma segunda ampliaria aquela exposição de
 * fininho. A caixa mostra o resumo e leva para `/atendimento`.
 */

/** Por que um eixo da caixa veio vazio. Vazio por motivo ≠ vazio por vitória. */
export type CaixaEstadoDoEixo =
  | 'ok'
  | 'sem_permissao'
  /** Acompanha a fila e não decide nela — permissão não é alçada. */
  | 'nao_decide'
  | 'modulo_desligado'
  /** Não há por qual nome procurar a pessoa no campo de responsável. */
  | 'sem_identidade'
  /** O token não corresponde a usuário ativo desta empresa. */
  | 'fora_da_casa';

/** Por que uma tarefa está parada. Rótulos estáveis; a frase é da tela. */
export type CaixaMotivoDaParada = 'prazo_vencido' | 'sem_movimento' | 'presa_com_agente';

export interface CaixaAprovacao {
  id: string;
  /** O resumo assinado na proposta. NÃO é o conteúdo exato da ação. */
  resumo: string;
  nivel: string;
  capacidade: string | null;
  canal: string | null;
  alcadaMinima: string;
  /** R4/R5 pedem motivo escrito — e a tela diz isso ANTES do clique. */
  exigeMotivo: boolean;
  exigeReauth: boolean;
  /** Nome de quem propôs, ou 'agente' quando foi máquina. */
  proponente: string;
  proponenteTipo: 'user' | 'ai' | 'system';
  propostaEm: string;
  expiraEm: string;
  esperandoMs: number;
  /** Quanto falta para vencer. Vencida não chega aqui. */
  venceEmMs: number;
}

export interface CaixaEixoAprovacoes {
  estado: CaixaEstadoDoEixo;
  itens: CaixaAprovacao[];
  /**
   * Alcançam a sua alçada e a porta recusaria HOJE (capacidade fora do catálogo,
   * régua mudada, argumento fora do formato). Não estão na lista nem na conta:
   * não esperam por você, esperam por um conserto. Quem explica é `/atendimento`.
   */
  retidasPorImpedimento: number;
  truncado: boolean;
  teto: number;
}

export interface CaixaTarefa {
  id: string;
  titulo: string;
  lista: string | null;
  status: string;
  statusCor: string;
  prioridade: string;
  /** Texto legado preservado; a responsabilidade usa o ID da conta. */
  responsavel: string | null;
  prazo: string | null;
  atualizadaEm: string;
  agenteSlug: string | null;
  /** Nulo com slug preenchido = agente que não é desta empresa. */
  agenteNome: string | null;
  agenteDesde: string | null;
  motivos: CaixaMotivoDaParada[];
}

export interface CaixaEixoTarefas {
  estado: CaixaEstadoDoEixo;
  itens: CaixaTarefa[];
  truncado: boolean;
  teto: number;
  /** Campo mantido por compatibilidade; nomes não atribuem responsabilidade. */
  identidades: string[];
  diasSemMovimento: number;
  horasPresa: number;
}

export interface CaixaConversa {
  id: string;
  tarefaId: string;
  tarefaTitulo: string;
  autor: string;
  /** Trecho. O corpo inteiro se lê no quadro, onde ele nasceu. */
  trecho: string;
  trechoCortado: boolean;
  criadaEm: string;
}

export interface CaixaEixoConversa {
  /**
   * NÃO É MENÇÃO, e a tela diz isso: menção não existe como dado neste produto
   * (`WorkComment` tem autor e texto, e nada mais — sem tabela de menção, sem
   * convenção de `@nome`, sem estado de lido). O que existe é comentário de
   * OUTRA pessoa numa tarefa em que você é o responsável, na última semana.
   */
  estado: CaixaEstadoDoEixo;
  itens: CaixaConversa[];
  truncado: boolean;
  dias: number;
  teto: number;
}

export interface CaixaResposta {
  agora: string;
  eu: {
    id: string;
    nome: string | null;
    /** 'nenhuma' quando o papel não concede alçada alguma. */
    alcada: string;
    /** Decide segundo o BANCO. */
    decide: boolean;
    /** Decide segundo o banco E segundo o token desta sessão. */
    decideNestaSessao: boolean;
    /** O token corresponde a usuário ativo desta empresa? */
    ativo: boolean;
  };
  aprovacoes: CaixaEixoAprovacoes;
  tarefas: CaixaEixoTarefas;
  conversa: CaixaEixoConversa;
  /**
   * O que espera AÇÃO SUA: aprovações que você assina + tarefas paradas. A
   * conversa fica fora — sem estado de lido, ela nunca sairia da conta, e
   * contador que não zera é número que a pessoa aprende a ignorar.
   */
  total: number;
  /** Algum eixo bateu no teto: o total é PISO, não o número exato. */
  totalParcial: boolean;
  source: { tool: string; generatedAt: string };
}

export interface CaixaContador {
  quantos: number;
  /** Verdadeiro = "N+", nunca "N". */
  parcial: boolean;
  aprovacoes: number;
  tarefas: number;
  /** Quando esta contagem foi medida. O selo da casca não mente sobre isso. */
  medidoEm: string;
}

/* ==========================================================================
 * A CAIXA DE ENTRADA — atividade e minhas tarefas (rodada do painel P1, 18/10/2026)
 * ==========================================================================
 *
 * `GET /api/caixa/atividade`, `POST /api/caixa/limpar` e `GET /api/caixa/tarefas`.
 * A atividade é uma LEITURA do que as telas donas já gravam: a auditoria de
 * `WorkTask` (`AuditLog`, `entityType = 'work_task'`, com o antes e o depois) e
 * os comentários (`WorkComment`). A única escrita nova é a marca pessoal de
 * "limpei isto" (`CaixaVisto`), que não muda estado de negócio nenhum. Regras
 * em `apps/api/src/caixa/atividade-da-caixa.ts`.
 */

/** De onde veio o evento. É o prefixo do id do item (`auditoria:<id>`). */
export const CAIXA_ORIGENS_DA_ATIVIDADE = ['auditoria', 'comentario'] as const;
export type CaixaOrigemDaAtividade = (typeof CAIXA_ORIGENS_DA_ATIVIDADE)[number];

/** O que aconteceu. `edicao` = título ou prioridade; o resto tem nome próprio. */
export type CaixaTipoDaAtividade =
  | 'status'
  | 'atribuicao'
  | 'vencimento'
  | 'comentario'
  | 'criacao'
  | 'edicao';

/** Um campo que mudou, de → para. Vencimento vem em ISO (a tela formata o dia); nulo = vazio. */
export interface CaixaMudanca {
  campo: 'status' | 'responsavel' | 'vencimento' | 'titulo' | 'prioridade';
  de: string | null;
  para: string | null;
}

export interface CaixaAtividade {
  /** `<origem>:<eventoId>` — é o id que `POST /caixa/limpar` recebe. */
  id: string;
  origem: CaixaOrigemDaAtividade;
  /** O tipo principal (o primeiro da lista de mudanças, ou comentário/criação). */
  tipo: CaixaTipoDaAtividade;
  tarefaId: string;
  tarefaTitulo: string;
  lista: string | null;
  /** Nome de quem fez; nulo quando o registro não guardou ninguém. */
  quem: string | null;
  quemTipo: 'user' | 'ai' | 'system';
  /** Fui eu que fiz. Só aparece com `incluirMeus`. */
  porMim: boolean;
  quando: string;
  mudancas: CaixaMudanca[];
  /** O trecho do comentário. Nulo nos eventos que não são comentário. */
  trecho: string | null;
  trechoCortado: boolean;
  /** Limpo por mim (um a um ou pelo "limpar tudo"). Só aparece com `incluirLimpos`. */
  limpo: boolean;
}

export interface CaixaAtividadeResposta {
  estado: CaixaEstadoDoEixo;
  itens: CaixaAtividade[];
  /** O cursor da próxima página (`antesDe`). Nulo = acabou. */
  proximo: string | null;
  /** Por quais nomes a caixa procurou você no responsável das tarefas. */
  identidades: string[];
  /** Até quando o "limpar tudo" já limpou. Nulo = nunca limpou tudo. */
  limpoAte: string | null;
  incluirLimpos: boolean;
  incluirMeus: boolean;
  /** Bateu no teto de tarefas lidas: tarefa sua mais antiga pode ter ficado de fora. */
  tarefasTruncadas: boolean;
  agora: string;
}

/** `{ ids }` limpa um a um; `{ tudo: true, ate? }` limpa tudo até `ate` (padrão: agora). */
export const CaixaLimparSchema = z.union([
  z.object({
    ids: z
      .array(z.string().regex(/^(auditoria|comentario):[A-Za-z0-9_-]{1,120}$/))
      .min(1)
      .max(200),
  }).strict(),
  z.object({ tudo: z.literal(true), ate: z.string().datetime({ offset: true }).optional() }).strict(),
]);
export type CaixaLimparInput = z.infer<typeof CaixaLimparSchema>;

export interface CaixaLimparResposta {
  /** Quantos itens foram marcados agora (um a um). No "tudo", zero. */
  limpos: number;
  limpoAte: string | null;
}

/** Os filtros de vencimento da aba Minhas tarefas. */
export const CAIXA_FILTROS_DE_VENCIMENTO = ['vencidas', 'hoje', 'semana'] as const;
export type CaixaFiltroDeVencimento = (typeof CAIXA_FILTROS_DE_VENCIMENTO)[number];

export const CaixaTarefasQuerySchema = z.object({
  listaId: z.string().min(1).max(120).optional(),
  pastaId: z.string().min(1).max(120).optional(),
  status: z.string().min(1).max(200).optional(),
  vencimento: z.enum(CAIXA_FILTROS_DE_VENCIMENTO).optional(),
  responsavel: z.enum(['eu', 'qualquer']).default('eu'),
  encerradas: z
    .enum(['sim', 'nao'])
    .default('nao')
    .transform((v) => v === 'sim'),
});
export type CaixaTarefasQuery = z.infer<typeof CaixaTarefasQuerySchema>;

export interface CaixaMinhaTarefa {
  id: string;
  titulo: string;
  listaId: string;
  lista: string;
  pastaId: string | null;
  pasta: string | null;
  status: string;
  statusCor: string;
  statusTipo: string;
  prazo: string | null;
  /** O texto gravado em `assignee` (texto livre herdado do ClickUp). */
  responsavel: string | null;
  comentarios: number;
  atualizadaEm: string;
  /** Os mesmos motivos de parada da caixa (prazo vencido, sem movimento, presa). */
  motivos: CaixaMotivoDaParada[];
  /** Rodada do trabalho T3/T4: para ordenar, agrupar e filtrar por cliente. */
  criadaEm: string;
  prioridade: WorkPriorityDto;
  clienteId: string | null;
  cliente: string | null;
}

export interface CaixaTarefasResposta {
  estado: CaixaEstadoDoEixo;
  itens: CaixaMinhaTarefa[];
  truncado: boolean;
  teto: number;
  identidades: string[];
  /** As listas e pastas para o filtro, da empresa inteira. */
  listas: { id: string; nome: string; pastaId: string | null; pasta: string | null }[];
  /** Os nomes de status que aparecem nas tarefas lidas, para o filtro. */
  status: string[];
  filtros: CaixaTarefasQuery;
  agora: string;
}

// ---------- Pauta: o banco de ideias (MK3) ----------
// A máquina de conteúdo parte do que o mundo publicou. O banco parte do
// contrário: do que a casa quer dizer. Ideia aprovada vira `PautaPeca` e cai na
// MESMA agenda e na mesma aprovação da semana — quem posta não deveria ter dois
// lugares para olhar.
//
// Os enums são espelho do schema do Prisma. Duas listas em dois lugares é como
// a contagem de ferramentas do MCP passou anos dizendo 10 quando eram 35.

export const PAUTA_IDEIA_STATUS = ['ideia', 'em_producao', 'aprovada', 'descartada'] as const;
export type PautaIdeiaStatus = (typeof PAUTA_IDEIA_STATUS)[number];

export const PAUTA_IDEIA_PRIORIDADES = ['baixa', 'media', 'alta'] as const;
export type PautaIdeiaPrioridade = (typeof PAUTA_IDEIA_PRIORIDADES)[number];

/**
 * O que cada status alcança. A ideia anda para frente e volta para trás um
 * passo, como o episódio (`transicaoDoEpisodio`) — e `descartada` é alcançável
 * de qualquer lugar, porque desistir de uma ideia nunca precisa de cerimônia.
 *
 * `aprovada` é o fim da linha AQUI: dali em diante quem manda é a peça, e o
 * status dela é que diz se foi ao ar. Deixar a ideia voltar de `aprovada`
 * deixaria dois donos para a mesma verdade.
 */
const DE_PARA_DA_IDEIA: Record<PautaIdeiaStatus, readonly PautaIdeiaStatus[]> = {
  ideia: ['em_producao', 'descartada'],
  em_producao: ['ideia', 'aprovada', 'descartada'],
  aprovada: [],
  descartada: ['ideia'],
};

export function transicaoDaIdeia(de: PautaIdeiaStatus, para: PautaIdeiaStatus): boolean {
  return DE_PARA_DA_IDEIA[de].includes(para);
}

/** Por que a ideia não pode virar peça ainda, ou nulo quando pode. */
export function motivoParaNaoAprovarIdeia(i: {
  status: PautaIdeiaStatus;
  titulo: string;
  legenda: string;
  formato: string;
}): string | null {
  if (i.status === 'aprovada') return 'Esta ideia já virou peça.';
  if (i.status === 'descartada') return 'Ideia descartada: reabra antes de aprovar.';
  if (!i.titulo.trim()) return 'A ideia precisa de título.';
  // A peça vai para a agenda e alguém vai postar a partir dela: sem legenda,
  // aprovar só empurra o trabalho para a hora do post, que é a pior hora.
  if (!i.legenda.trim()) return 'A ideia precisa de legenda antes de virar peça — é ela que vai ao ar.';
  if (!(PAUTA_FORMATOS_DA_SEMANA as readonly string[]).includes(i.formato)) {
    return `Formato inválido: a semana entende ${PAUTA_FORMATOS_DA_SEMANA.join(', ')}.`;
  }
  return null;
}

export const PAUTA_TETO_DO_TITULO_DA_IDEIA = 200;
export const PAUTA_TETO_DO_TEXTO_DA_IDEIA = 6_000;
/** Quantas ideias a IA propõe de uma vez. Mais que isto ninguém tria. */
export const PAUTA_TETO_DE_IDEIAS_PROPOSTAS = 5;

export interface PautaFonteDaIdeia {
  rotulo: string;
  url?: string;
}

export interface PautaIdeiaHist {
  em: string;
  de: PautaIdeiaStatus;
  para: PautaIdeiaStatus;
  por: string;
}

export interface PautaIdeiaNaLista {
  id: string;
  pilar: string;
  titulo: string;
  ganchoFala: string;
  ganchoTela: string;
  roteiro: string;
  legenda: string;
  cta: string;
  porque: string;
  fontes: PautaFonteDaIdeia[];
  formato: string;
  prioridade: PautaIdeiaPrioridade;
  status: PautaIdeiaStatus;
  hist: PautaIdeiaHist[];
  pecaId: string | null;
  origem: string;
  criadaEm: string;
  atualizadaEm: string;
}

export interface PautaIdeiasPainel {
  ideias: PautaIdeiaNaLista[];
  /** Os pilares da marca (MK1), para a tela oferecer e para a IA escolher. */
  pilares: PautaPilar[];
  avisos: string[];
  iaConfigurada: boolean;
}

const textoDaIdeia = (max = PAUTA_TETO_DO_TEXTO_DA_IDEIA) => z.string().trim().max(max).default('');

/** `POST /pauta/ideias` e `PUT /pauta/ideias/:id`. */
export const PautaIdeiaSalvarSchema = z.object({
  pilar: z.string().trim().min(1, 'Escolha um pilar.').max(PAUTA_TETO_DO_NOME_DO_PILAR),
  titulo: z.string().trim().min(1, 'A ideia precisa de título.').max(PAUTA_TETO_DO_TITULO_DA_IDEIA),
  ganchoFala: textoDaIdeia(600),
  ganchoTela: textoDaIdeia(300),
  roteiro: textoDaIdeia(),
  legenda: textoDaIdeia(),
  cta: textoDaIdeia(300),
  porque: textoDaIdeia(1_000),
  fontes: z
    .array(z.object({ rotulo: z.string().trim().min(1).max(200), url: z.string().trim().url().max(500).optional() }))
    .max(10)
    .default([]),
  formato: z.enum(PAUTA_FORMATOS_DA_SEMANA),
  prioridade: z.enum(PAUTA_IDEIA_PRIORIDADES).default('media'),
});
export type PautaIdeiaSalvarInput = z.infer<typeof PautaIdeiaSalvarSchema>;

/** `PATCH /pauta/ideias/:id/status`. */
export const PautaIdeiaStatusSchema = z.object({ status: z.enum(PAUTA_IDEIA_STATUS) });
export type PautaIdeiaStatusInput = z.infer<typeof PautaIdeiaStatusSchema>;

/** `POST /pauta/ideias/propor`: a IA propõe para um pilar. */
export const PautaIdeiasProporSchema = z.object({
  pilar: z.string().trim().min(1, 'Escolha um pilar.').max(PAUTA_TETO_DO_NOME_DO_PILAR),
  formato: z.enum(PAUTA_FORMATOS_DA_SEMANA).default('carrossel'),
  quantas: z.number().int().min(1).max(PAUTA_TETO_DE_IDEIAS_PROPOSTAS).default(3),
});
export type PautaIdeiasProporInput = z.infer<typeof PautaIdeiasProporSchema>;

// ---------- Pauta: a performance da casa (MK5) ----------
// A MK2 mede o perfil dos outros; esta mede o nosso, com a MESMA régua e as
// mesmas funções: a mediana da própria casa e o índice de cada post contra ela.
// Duas contas diferentes para "o que rendeu" dariam dois números para a mesma
// pergunta — e o de dentro sempre pareceria melhor.
//
// O snapshot é do MÊS e é uma fotografia: os números da Graph mudam com o tempo
// (um post velho continua somando visualização), e comparar meses exige que
// cada mês guarde o que viu quando viu. Nota da memória por mês, como a
// estratégia (MK4) e o relatório (MK6).

export const PAUTA_PREFIXO_DA_PERFORMANCE = 'pauta.performance.';

export function chaveDaPerformance(mes: string): string {
  return `${PAUTA_PREFIXO_DA_PERFORMANCE}${mes}`;
}

export function mesDaChaveDaPerformance(chave: string): string | null {
  if (!chave.startsWith(PAUTA_PREFIXO_DA_PERFORMANCE)) return null;
  const mes = chave.slice(PAUTA_PREFIXO_DA_PERFORMANCE.length);
  return PautaMesSchema.safeParse(mes).success ? mes : null;
}

/** As métricas dos NOSSOS posts. Salvamento entra aqui e não na MK2: é o que a casa persegue. */
export const PAUTA_METRICAS_DA_CASA = [
  'visualizacoes',
  'curtidas',
  'comentarios',
  'salvamentos',
  'compartilhamentos',
] as const;
export type PautaMetricaDaCasa = (typeof PAUTA_METRICAS_DA_CASA)[number];

export interface PautaNumerosDoPost {
  visualizacoes: number | null;
  curtidas: number | null;
  comentarios: number | null;
  salvamentos: number | null;
  compartilhamentos: number | null;
}

export interface PautaPostMedido {
  pecaId: string;
  titulo: string;
  formato: string;
  publicadaEm: string | null;
  urlPublicada: string | null;
  numeros: PautaNumerosDoPost;
  indices: Record<PautaMetricaDaCasa, number | null>;
  faixa: PautaFaixaDoIndice | null;
  /** Por que este post ficou sem número, quando ficou. */
  semNumero: string | null;
}

export interface PautaSnapshotDaPerformance {
  mes: string;
  /** Quando a fotografia foi tirada. É o que torna dois meses comparáveis. */
  coletadoEm: string;
  seguidores: number | null;
  posts: PautaPostMedido[];
  medianas: Record<PautaMetricaDaCasa, number | null>;
  metricaDeReferencia: PautaMetricaDaCasa | null;
  medidos: number;
  publicados: number;
  avisos: string[];
}

export interface PautaPerformancePainel {
  mes: string;
  snapshot: PautaSnapshotDaPerformance | null;
  meses: string[];
  /** Falso quando não há conta do Instagram conectada — a tela diz como conectar. */
  conectado: boolean;
  /** O que falta para medir, em português. Vazio quando dá para coletar. */
  comoConectar: string | null;
}

// Uso humano de uma versão de Contexto, com repetição identificada pelo pedido.
export const ContextoTarefaCreateSchema = z.object({
  requestId: z.string().uuid(),
  versionId: z.string().uuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedItemVersion: z.number().int().min(1),
  listId: z.string().uuid(),
  statusId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(300),
  assigneeUserId: z.string().uuid().nullish(),
}).strict();
export type ContextoTarefaCreateInput = z.infer<typeof ContextoTarefaCreateSchema>;

export interface ContextoFonteUtilizadaDto {
  id: string;
  itemId: string;
  versionId: string;
  chave: string;
  versao: number;
  contentHash: string;
  sourceType: string;
  sourceRef: string | null;
  title: string;
  body: string;
  procedencia: string;
  criadoEm: string;
  utilizadaEm: string;
  versaoAtual: number;
  arquivada: boolean;
  retratoFonte?: M05FonteAutorizadaDto;
}
export interface ContextoTarefaCreateResponse {
  escopo?: M05EscopoDto;
  taskId: string;
  listId: string;
  replayed: boolean;
  fonte: ContextoFonteUtilizadaDto;
}
export interface ContextoFontesDaTarefaResponse {
  escopo?: M05EscopoDto;
  fontes: ContextoFonteUtilizadaDto[];
}
