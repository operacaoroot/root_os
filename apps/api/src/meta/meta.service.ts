import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Conector Meta/Instagram (OAuth 2.0 via Login do Facebook) — MÉTRICAS do Instagram
// Business. Credencial PRÓPRIA do root (meta.env), tokens por org (isolado do escritório).
// Fluxo: Login do Facebook → user token longo → Página → conta Instagram Business → insights.
const SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
  'instagram_basic',
  'instagram_manage_insights',
];

@Injectable()
export class MetaService {
  private readonly log = new Logger('MetaService');
  private readonly appId = process.env.META_APP_ID ?? '';
  private readonly appSecret = process.env.META_APP_SECRET ?? '';
  private readonly redirectUri = process.env.META_REDIRECT_URI ?? 'http://localhost:4000/api/meta/callback';
  private readonly graph = (process.env.META_GRAPH_URL ?? 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
  private readonly webBase = process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get configured(): boolean {
    return this.appId.length > 0 && this.appSecret.length > 0;
  }
  private assert() {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Meta não configurado: defina META_APP_ID/SECRET em ~/.config/root/meta.env e reinicie a API.',
      );
    }
  }

  // ---------- OAuth ----------
  authUrl(state: string): string {
    this.assert();
    const p = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      state,
      scope: SCOPES.join(','),
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${p}`;
  }

  private async g<T = any>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(`Meta ${url.split('?')[0]} → HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }
  /** Igual ao g(), mas engole erro (métrica indisponível p/ certo tipo de mídia). */
  private async gSafe<T = any>(url: string): Promise<T | null> {
    try { return await this.g<T>(url); } catch { return null; }
  }

  async handleCallback(orgId: string, code: string): Promise<string> {
    this.assert();
    // 1) code → token curto
    const short = await this.g<{ access_token: string }>(
      `${this.graph}/oauth/access_token?client_id=${this.appId}&client_secret=${this.appSecret}` +
      `&redirect_uri=${encodeURIComponent(this.redirectUri)}&code=${encodeURIComponent(code)}`,
    );
    // 2) token curto → token longo (~60d)
    const long = await this.g<{ access_token: string; expires_in?: number }>(
      `${this.graph}/oauth/access_token?grant_type=fb_exchange_token&client_id=${this.appId}` +
      `&client_secret=${this.appSecret}&fb_exchange_token=${short.access_token}`,
    );
    const userToken = long.access_token;
    const expiresAt = new Date(Date.now() + (long.expires_in ?? 60 * 24 * 3600) * 1000);

    // 3) Página com conta Instagram Business vinculada
    const pages = await this.g<{ data: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }> }>(
      `${this.graph}/me/accounts?fields=name,access_token,instagram_business_account{id,username}&access_token=${userToken}`,
    );
    const page = (pages.data ?? []).find((p) => p.instagram_business_account) ?? (pages.data ?? [])[0];

    await this.prisma.metaAccount.upsert({
      where: { orgId },
      update: {
        userToken, expiresAt, scope: SCOPES.join(','),
        pageId: page?.id ?? null, pageName: page?.name ?? null, pageToken: page?.access_token ?? null,
        igUserId: page?.instagram_business_account?.id ?? null, igUsername: page?.instagram_business_account?.username ?? null,
      },
      create: {
        orgId, userToken, expiresAt, scope: SCOPES.join(','),
        pageId: page?.id ?? null, pageName: page?.name ?? null, pageToken: page?.access_token ?? null,
        igUserId: page?.instagram_business_account?.id ?? null, igUsername: page?.instagram_business_account?.username ?? null,
      },
    });
    await this.upsertIntegration(orgId, 'connected');
    await this.audit.log({ orgId, action: 'meta.connect', entityType: 'integration', entityId: 'instagram', after: { page: page?.name, ig: page?.instagram_business_account?.username } });
    this.log.log(`Meta conectado: página "${page?.name}" · IG @${page?.instagram_business_account?.username ?? '?'}`);
    return `${this.webBase}/instagram`;
  }

  private async account(orgId: string) {
    this.assert();
    const acc = await this.prisma.metaAccount.findUnique({ where: { orgId } });
    if (!acc) throw new ServiceUnavailableException('Instagram não conectado. Conecte em /instagram.');
    if (acc.expiresAt < new Date()) throw new ServiceUnavailableException('Sessão do Facebook expirada. Reconecte o Instagram.');
    if (!acc.igUserId || !acc.pageToken) throw new BadRequestException('Nenhuma conta Instagram Business vinculada à Página.');
    return acc;
  }

  async status(orgId: string) {
    const acc = await this.prisma.metaAccount.findUnique({ where: { orgId } });
    return {
      configured: this.configured,
      connected: !!acc,
      page: acc?.pageName ?? null,
      igUsername: acc?.igUsername ?? null,
      hasInstagram: !!acc?.igUserId,
      connectedAt: acc?.connectedAt?.toISOString() ?? null,
      authUrl: this.configured ? this.authUrl(orgId) : null,
    };
  }

  async disconnect(orgId: string) {
    await this.prisma.metaAccount.deleteMany({ where: { orgId } });
    await this.upsertIntegration(orgId, 'disconnected');
    await this.audit.log({ orgId, action: 'meta.disconnect', entityType: 'integration', entityId: 'instagram' });
    return { ok: true };
  }

  private async upsertIntegration(orgId: string, status: 'connected' | 'disconnected') {
    const ex = await this.prisma.integrationAccount.findFirst({ where: { orgId, key: 'instagram' } });
    if (ex) {
      await this.prisma.integrationAccount.update({ where: { id: ex.id }, data: { status, connectedAt: status === 'connected' ? new Date() : ex.connectedAt } });
    } else {
      await this.prisma.integrationAccount.create({ data: { orgId, key: 'instagram', label: 'Instagram', status, connectedAt: status === 'connected' ? new Date() : null } });
    }
  }

  // ---------- Métricas (leitura) ----------
  async overview(orgId: string) {
    const acc = await this.account(orgId);
    const t = acc.pageToken!;
    const prof = await this.g<any>(`${this.graph}/${acc.igUserId}?fields=username,name,followers_count,follows_count,media_count,profile_picture_url,biography&access_token=${t}`);
    // insights de conta dos últimos 28 dias (best-effort — a API varia por versão/conta)
    const until = Math.floor(Date.now() / 1000);
    const since = until - 28 * 86400;
    const ins = await this.gSafe<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
      `${this.graph}/${acc.igUserId}/insights?metric=reach,impressions,profile_views&period=day&since=${since}&until=${until}&access_token=${t}`);
    const sum = (name: string) => (ins?.data?.find((d) => d.name === name)?.values ?? []).reduce((s, v) => s + (v.value ?? 0), 0);
    return {
      username: prof.username ?? null,
      name: prof.name ?? null,
      biography: prof.biography ?? null,
      profilePic: prof.profile_picture_url ?? null,
      followers: prof.followers_count ?? 0,
      follows: prof.follows_count ?? 0,
      mediaCount: prof.media_count ?? 0,
      reach28: ins ? sum('reach') : null,
      impressions28: ins ? sum('impressions') : null,
      profileViews28: ins ? sum('profile_views') : null,
      source: { tool: 'instagram-graph', generatedAt: new Date().toISOString() },
    };
  }

  async media(orgId: string, limit = 12) {
    const acc = await this.account(orgId);
    const t = acc.pageToken!;
    const list = await this.g<{ data: any[] }>(
      `${this.graph}/${acc.igUserId}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count&limit=${Math.min(Math.max(limit, 1), 30)}&access_token=${t}`);
    const items = [];
    for (const m of list.data ?? []) {
      const ins = await this.gSafe<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
        `${this.graph}/${m.id}/insights?metric=reach,impressions,saved&access_token=${t}`);
      const val = (name: string) => ins?.data?.find((d) => d.name === name)?.values?.[0]?.value ?? null;
      items.push({
        id: m.id,
        caption: (m.caption ?? '').slice(0, 200),
        type: m.media_product_type ?? m.media_type ?? null,
        permalink: m.permalink ?? null,
        timestamp: m.timestamp ?? null,
        likes: m.like_count ?? 0,
        comments: m.comments_count ?? 0,
        reach: val('reach'),
        impressions: val('impressions'),
        saved: val('saved'),
      });
    }
    return { items, total: items.length, source: { tool: 'instagram-graph', generatedAt: new Date().toISOString() } };
  }
}
