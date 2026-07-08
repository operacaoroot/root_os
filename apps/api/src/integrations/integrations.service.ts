import { BadRequestException, Injectable } from '@nestjs/common';
import { CONNECTORS, type IntegrationCatalog } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Conectores que dá para ligar/desligar manualmente (têm credencial via env/API key).
// Os OAuth (Instagram/Gmail/Drive) exigem o fluxo de OAuth + credencial própria do root
// e ficam como "requer credencial" até isso existir.
function isManaged(authType: string): boolean {
  return authType !== 'oauth2';
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async catalog(orgId: string): Promise<IntegrationCatalog> {
    const accounts = await this.prisma.integrationAccount.findMany({
      where: { orgId },
      include: { health: true },
    });
    const byKey = new Map(accounts.map((a) => [a.key, a]));

    // Status derivado da CONFIG real quando não há registro no banco: conectores por
    // env/API-key ligam quando a credencial existe; builtin (OFX/Obsidian) já contam.
    const env = process.env;
    const derived: Record<string, boolean> = {
      openai: !!env.OPENAI_API_KEY,
      telegram: !!env.TELEGRAM_BOT_TOKEN,
      clickup: !!env.CLICKUP_API_TOKEN,
      pluggy: !!(env.PLUGGY_CLIENT_ID && env.PLUGGY_CLIENT_SECRET),
      asaas: !!env.ASAAS_API_KEY,
      obsidian: !!env.OBSIDIAN_VAULT_PATH, // vault montada + indexada
      ofx: true, // builtin — importação de extrato sempre disponível
    };

    const items = CONNECTORS.map((c) => {
      const acc = byKey.get(c.key);
      // status: registro do banco tem precedência (OAuth/toggle); senão, deriva da config.
      let status = acc?.status ?? 'disconnected';
      if (!acc && c.key in derived) status = derived[c.key] ? 'connected' : 'disconnected';

      return {
        key: c.key,
        label: c.label,
        category: c.category,
        phase: c.phase,
        authType: c.authType,
        requires: c.requires,
        status,
        health: acc?.health?.status ?? null,
        connectedAt: acc?.connectedAt?.toISOString() ?? null,
        lastSyncAt: acc?.health?.lastSyncAt?.toISOString() ?? null,
        lastError: acc?.health?.lastError ?? null,
        managed: isManaged(c.authType),
      };
    });

    return { items, source: { tool: 'banco-interno', generatedAt: new Date().toISOString() } };
  }

  async toggle(orgId: string, key: string, status: string, actorId: string) {
    const connector = CONNECTORS.find((c) => c.key === key);
    if (!connector) throw new BadRequestException(`Conector desconhecido: ${key}`);
    if (!isManaged(connector.authType)) {
      throw new BadRequestException(
        `"${connector.label}" usa ${connector.authType.toUpperCase()} — precisa do fluxo de OAuth + credencial própria do root. Ainda não disponível.`,
      );
    }

    const existing = await this.prisma.integrationAccount.findFirst({ where: { orgId, key } });
    const connectedAt = status === 'connected' ? new Date() : null;
    const row = existing
      ? await this.prisma.integrationAccount.update({
          where: { id: existing.id },
          data: { status: status as any, connectedAt },
        })
      : await this.prisma.integrationAccount.create({
          data: { orgId, key, label: connector.label, status: status as any, connectedAt },
        });

    await this.audit.log({
      orgId,
      actorId,
      action: 'integration.toggle',
      entityType: 'integration',
      entityId: key,
      after: { status },
    });
    return { ok: true, key, status: row.status };
  }
}
