import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Conector Google (OAuth 2.0) — Gmail/Agenda/Docs/Drive. Credencial PRÓPRIA do root
// (google.env), tokens guardados por org (isolado do escritório). Escopos read+write
// (a escrita entra pelo fluxo de aprovação; reads já expostos).
const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
];

@Injectable()
export class GoogleService {
  private readonly log = new Logger('GoogleService');
  private readonly clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  private readonly redirectUri = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/google/callback';
  private readonly webBase = process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get configured(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  private assert() {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Google não configurado: defina GOOGLE_CLIENT_ID/SECRET em ~/.config/root/google.env e reinicie a API.',
      );
    }
  }

  // ---------- OAuth ----------
  authUrl(state: string): string {
    this.assert();
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent', // garante refresh_token
      include_granted_scopes: 'true',
      scope: SCOPES.join(' '),
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  /** Troca o code por tokens, descobre o e-mail e guarda a conexão. Retorna p/ onde redirecionar. */
  async handleCallback(orgId: string, code: string): Promise<string> {
    this.assert();
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new BadRequestException(`Troca de código falhou: HTTP ${res.status}`);
    const t = (await res.json()) as {
      access_token: string; refresh_token?: string; expires_in: number; scope?: string; token_type?: string;
    };
    const email = await this.fetchEmail(t.access_token);
    const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);

    await this.prisma.googleAccount.upsert({
      where: { orgId },
      update: {
        email, accessToken: t.access_token, tokenType: t.token_type, scope: t.scope, expiresAt,
        ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
      },
      create: {
        orgId, email, accessToken: t.access_token, refreshToken: t.refresh_token,
        tokenType: t.token_type, scope: t.scope, expiresAt,
      },
    });
    await this.upsertIntegration(orgId, 'connected');
    await this.audit.log({ orgId, action: 'google.connect', entityType: 'integration', entityId: 'google', after: { email } });
    this.log.log(`Google conectado: ${email}`);
    return `${this.webBase}/google`;
  }

  private async fetchEmail(accessToken: string): Promise<string | null> {
    const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    return ((await r.json()) as { email?: string }).email ?? null;
  }

  /** Access token válido (renova via refresh_token se expirou). */
  private async token(orgId: string): Promise<string> {
    this.assert();
    const acc = await this.prisma.googleAccount.findUnique({ where: { orgId } });
    if (!acc) throw new ServiceUnavailableException('Google não conectado. Conecte em Integrações.');
    if (acc.expiresAt > new Date()) return acc.accessToken;
    if (!acc.refreshToken) throw new ServiceUnavailableException('Sessão Google expirada. Reconecte.');

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId, client_secret: this.clientSecret,
        refresh_token: acc.refreshToken, grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new ServiceUnavailableException(`Refresh do Google falhou: HTTP ${res.status}`);
    const t = (await res.json()) as { access_token: string; expires_in: number };
    const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);
    await this.prisma.googleAccount.update({ where: { orgId }, data: { accessToken: t.access_token, expiresAt } });
    return t.access_token;
  }

  /** Chamada autenticada a uma API do Google. */
  async api<T = any>(orgId: string, url: string, init?: RequestInit): Promise<T> {
    const at = await this.token(orgId);
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`Google ${url.split('?')[0]} → HTTP ${res.status} ${body.slice(0, 160)}`);
    }
    return res.json() as Promise<T>;
  }

  async status(orgId: string) {
    const acc = await this.prisma.googleAccount.findUnique({ where: { orgId } });
    return {
      configured: this.configured,
      connected: !!acc,
      email: acc?.email ?? null,
      scopes: acc?.scope?.split(' ') ?? [],
      connectedAt: acc?.connectedAt?.toISOString() ?? null,
      authUrl: this.configured ? this.authUrl(orgId) : null,
    };
  }

  async disconnect(orgId: string) {
    await this.prisma.googleAccount.deleteMany({ where: { orgId } });
    await this.upsertIntegration(orgId, 'disconnected');
    await this.audit.log({ orgId, action: 'google.disconnect', entityType: 'integration', entityId: 'google' });
    return { ok: true };
  }

  private async upsertIntegration(orgId: string, status: 'connected' | 'disconnected') {
    // marca as 4 integrações Google no hub (cria o registro se ainda não existir)
    const labels: Record<string, string> = { gmail: 'Gmail', drive: 'Google Drive', gcal: 'Google Agenda', gdocs: 'Google Docs' };
    for (const key of Object.keys(labels)) {
      const ex = await this.prisma.integrationAccount.findFirst({ where: { orgId, key } });
      if (ex) {
        await this.prisma.integrationAccount.update({
          where: { id: ex.id },
          data: { status, connectedAt: status === 'connected' ? new Date() : ex.connectedAt },
        });
      } else {
        await this.prisma.integrationAccount.create({
          data: { orgId, key, label: labels[key], status, connectedAt: status === 'connected' ? new Date() : null },
        });
      }
    }
  }

  // ---------- Leitura ----------
  async calendarUpcoming(orgId: string, maxResults = 10) {
    const now = new Date().toISOString();
    const j = await this.api<{ items: any[] }>(orgId,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`);
    return (j.items ?? []).map((e) => ({
      id: e.id,
      title: e.summary ?? '(sem título)',
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      location: e.location ?? null,
      link: e.htmlLink ?? null,
      attendees: (e.attendees ?? []).map((a: any) => a.email).filter(Boolean),
    }));
  }

  async gmailRecent(orgId: string, q = '', maxResults = 10) {
    const list = await this.api<{ messages?: Array<{ id: string }> }>(orgId,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    const ids = (list.messages ?? []).map((m) => m.id);
    const out = [];
    for (const id of ids) {
      const m = await this.api<any>(orgId,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      const h = (name: string) => (m.payload?.headers ?? []).find((x: any) => x.name === name)?.value ?? null;
      out.push({ id, from: h('From'), subject: h('Subject'), date: h('Date'), snippet: m.snippet ?? '', unread: (m.labelIds ?? []).includes('UNREAD') });
    }
    return out;
  }

  async gmailGet(orgId: string, id: string) {
    const m = await this.api<any>(orgId, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
    const h = (name: string) => (m.payload?.headers ?? []).find((x: any) => x.name === name)?.value ?? null;
    return { id, from: h('From'), to: h('To'), subject: h('Subject'), date: h('Date'), snippet: m.snippet ?? '', body: extractBody(m.payload) };
  }

  async driveList(orgId: string, q = '', pageSize = 15) {
    const query = q ? `name contains '${q.replace(/'/g, "\\'")}'` : "trashed = false";
    const j = await this.api<{ files: any[] }>(orgId,
      `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&orderBy=modifiedTime desc&q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))')}`);
    return (j.files ?? []).map((f) => ({
      id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime,
      link: f.webViewLink ?? null, owner: f.owners?.[0]?.displayName ?? null,
    }));
  }

  async docGet(orgId: string, docId: string) {
    const d = await this.api<any>(orgId, `https://docs.googleapis.com/v1/documents/${docId}`);
    return { id: docId, title: d.title ?? '(sem título)', content: extractDocText(d) };
  }
}

// Decodifica base64url do corpo do Gmail (prioriza text/plain).
function extractBody(payload: any): string {
  const walk = (p: any): string => {
    if (!p) return '';
    if (p.mimeType === 'text/plain' && p.body?.data) return b64url(p.body.data);
    for (const part of p.parts ?? []) { const r = walk(part); if (r) return r; }
    if (p.body?.data) return b64url(p.body.data);
    return '';
  };
  return walk(payload).slice(0, 20000);
}
function b64url(s: string): string {
  try { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; }
}
function extractDocText(doc: any): string {
  let out = '';
  for (const el of doc.body?.content ?? []) {
    for (const pe of el.paragraph?.elements ?? []) out += pe.textRun?.content ?? '';
  }
  return out.slice(0, 20000);
}
