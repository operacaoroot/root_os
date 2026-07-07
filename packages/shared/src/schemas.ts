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
