import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, ContextSource } from '@prisma/client';
import { comTenantResolvido } from '../common/contexto-execucao';
import { PrismaService } from '../prisma/prisma.service';

/** Campos que podem ser concedidos; a lista é fechada por desenho do ADR-015. */
export const AGENT_MEMORY_FIELDS = [
  'sourceRef',
  'title',
  'body',
  'tags',
  'kind',
  'confidence',
  'validFrom',
  'validUntil',
] as const;
export type AgentMemoryField = (typeof AGENT_MEMORY_FIELDS)[number];

export interface AgentDataGrantInput {
  sourceType: ContextSource;
  sourceRef: string;
  field: string;
  provider: string;
  consentVersion: string;
  consentText: string;
}

export interface ActiveAgentDataGrant {
  sourceType: ContextSource;
  sourceRef: string;
  field: AgentMemoryField;
  provider: string;
}

function isField(value: string): value is AgentMemoryField {
  return (AGENT_MEMORY_FIELDS as readonly string[]).includes(value);
}

function exactSourceRef(value: string): string {
  const result = value.trim();
  if (!result || result.length > 1000 || /[*]/.test(result)) {
    throw new BadRequestException('A fonte deve ser uma referência exata, sem curingas.');
  }
  return result;
}

/** CRUD humano da fronteira de dados; a consulta de agente só lê concessões ativas. */
@Injectable()
export class AgentDataGrantService {
  constructor(private readonly prisma: PrismaService) {}

  async conceder(orgId: string, actorId: string, input: AgentDataGrantInput) {
    const sourceRef = exactSourceRef(input.sourceRef);
    if (!isField(input.field)) throw new BadRequestException('Campo fora da allowlist.');
    if (!input.consentVersion.trim() || input.consentVersion.length > 100) {
      throw new BadRequestException('Versão de consentimento inválida.');
    }
    if (!input.consentText.trim() || input.consentText.length > 5000) {
      throw new BadRequestException('Texto de consentimento inválido.');
    }
    const provider = input.provider.trim();
    if (provider !== 'agente_externo') {
      throw new BadRequestException('O destino desta concessão deve ser agente_externo.');
    }

    return comTenantResolvido(orgId, async () => {
      await this.exigirPermissaoAtual(orgId, actorId);
      return this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memory-grant:${orgId}:${input.sourceType}:${sourceRef}:${input.field}`}))`;
        const row = await tx.agentDataGrant.upsert({
          where: {
            orgId_sourceType_sourceRef_field: {
              orgId,
              sourceType: input.sourceType,
              sourceRef,
              field: input.field,
            },
          },
          create: {
            orgId,
            sourceType: input.sourceType,
            sourceRef,
            field: input.field,
            provider,
            consentVersion: input.consentVersion.trim(),
            consentText: input.consentText.trim(),
            grantedByUserId: actorId,
            // E2b is textual. A read grant never silently authorizes embeddings.
            allowVectorization: false,
          },
          update: {
            provider,
            consentVersion: input.consentVersion.trim(),
            consentText: input.consentText.trim(),
            grantedByUserId: actorId,
            grantedAt: new Date(),
            revokedAt: null,
            revokedByUserId: null,
            allowVectorization: false,
          },
        });
        await tx.auditLog.create({
          data: {
            orgId,
            actorType: ActorType.user,
            actorId,
            action: 'memoria.agent_grant.concedido',
            entityType: 'AgentDataGrant',
            entityId: row.id,
            after: {
              sourceType: input.sourceType,
              sourceRef,
              field: input.field,
              provider,
              consentVersion: input.consentVersion.trim(),
              allowVectorization: false,
            },
          },
        });
        return this.publicRow(row);
      });
    });
  }

  async listar(orgId: string, actorId: string) {
    return comTenantResolvido(orgId, async () => {
      await this.exigirPermissaoAtual(orgId, actorId);
      const rows = await this.prisma.agentDataGrant.findMany({
        where: { orgId },
        orderBy: { grantedAt: 'desc' },
      });
      return rows.map((row) => this.publicRow(row));
    });
  }

  async revogar(orgId: string, actorId: string, id: string) {
    return comTenantResolvido(orgId, async () => {
      await this.exigirPermissaoAtual(orgId, actorId);
      return this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
        const row = await tx.agentDataGrant.findFirst({ where: { id, orgId } });
        if (!row) throw new NotFoundException('Concessão não encontrada.');
        const revokedAt = new Date();
        const updated = await tx.agentDataGrant.update({
          where: { id: row.id },
          data: { revokedAt, revokedByUserId: actorId },
        });
        await tx.auditLog.create({
          data: {
            orgId,
            actorType: ActorType.user,
            actorId,
            action: 'memoria.agent_grant.revogado',
            entityType: 'AgentDataGrant',
            entityId: row.id,
            before: { sourceType: row.sourceType, sourceRef: row.sourceRef, field: row.field },
            after: { revokedAt: revokedAt.toISOString() },
          },
        });
        return { id: updated.id, revoked: true };
      });
    });
  }

  async ativos(orgId: string): Promise<ActiveAgentDataGrant[]> {
    return comTenantResolvido(orgId, async () => {
      const rows = await this.prisma.agentDataGrant.findMany({
        where: { orgId, revokedAt: null },
        select: { sourceType: true, sourceRef: true, field: true, provider: true },
      });
      return rows.filter(
        (row): row is ActiveAgentDataGrant => isField(row.field) && row.provider === 'agente_externo',
      );
    });
  }

  /** Used by the legacy embedding cron: reading is never enough to vectorize. */
  async fontesComVetorizacaoExplicitamentePermitida(orgId: string): Promise<ActiveAgentDataGrant[]> {
    return comTenantResolvido(orgId, async () => {
      const rows = await this.prisma.agentDataGrant.findMany({
        where: { orgId, revokedAt: null, field: 'body', allowVectorization: true },
        select: { sourceType: true, sourceRef: true, field: true, provider: true },
      });
      return rows.filter(
        (row): row is ActiveAgentDataGrant => isField(row.field) && row.provider === 'agente_externo',
      );
    });
  }

  private async exigirPermissaoAtual(orgId: string, actorId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: actorId, orgId, isActive: true, org: { isActive: true } },
      select: {
        roles: { select: { permissions: { select: { key: true } } } },
      },
    });
    const permissions = new Set(user?.roles.flatMap((role) => role.permissions.map((p) => p.key)) ?? []);
    if (!user || !permissions.has('admin.permissoes')) {
      throw new ForbiddenException('A permissão admin.permissoes atual é necessária.');
    }
  }

  private publicRow(row: {
    id: string;
    sourceType: ContextSource;
    sourceRef: string;
    field: string;
    provider: string;
    consentVersion: string;
    grantedAt: Date;
    revokedAt: Date | null;
    allowVectorization: boolean;
  }) {
    return {
      id: row.id,
      sourceType: row.sourceType,
      sourceRef: row.sourceRef,
      field: row.field,
      provider: row.provider,
      consentVersion: row.consentVersion,
      grantedAt: row.grantedAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      allowVectorization: row.allowVectorization,
    };
  }
}
