import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { comEmpresaResolvida } from '../prisma/contexto-de-plataforma';
import type { JwtUser } from './current-user.decorator';

export const AGENT_TOKEN_SCOPES = ['memoria.buscar', 'memoria.ler'] as const;
export type AgentTokenScope = (typeof AGENT_TOKEN_SCOPES)[number];

const TOKEN_PREFIX = 'ros1';
const MAX_ACTIVE_TOKENS_PER_USER = 5;
const MAX_VALIDITY_DAYS = 30;
const SCOPE_PERMISSION: Record<AgentTokenScope, string> = {
  'memoria.buscar': 'obsidian.ver',
  'memoria.ler': 'obsidian.ver',
};

interface UserForAgentToken {
  id: string;
  orgId: string;
  name: string;
  email: string;
  isActive: boolean;
  org: { isActive: boolean };
  roles: { key: string; permissions: { key: string }[] }[];
}

export interface AgentIdentity extends JwtUser {
  authMethod: 'agent-token';
  agentTokenId: string;
  agentTokenScopes: AgentTokenScope[];
}

export interface EmitAgentTokenInput {
  name: string;
  scopes: readonly string[];
  validadeDias: number;
}

export interface IssuedAgentToken {
  token: string;
  id: string;
  name: string;
  scopes: AgentTokenScope[];
  expiresAt: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function scopesPermitidas(scopes: readonly string[]): scopes is AgentTokenScope[] {
  return scopes.length > 0 && scopes.every((scope) =>
    (AGENT_TOKEN_SCOPES as readonly string[]).includes(scope),
  );
}

/** Bearer individual de agente; não é uma alternativa ao JwtAuthGuard. */
@Injectable()
export class AgentTokenService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async emitir(orgId: string, userId: string, input: EmitAgentTokenInput): Promise<IssuedAgentToken> {
    const name = input.name.trim();
    if (name.length < 1 || name.length > 80) {
      throw new BadRequestException('O nome do token deve ter entre 1 e 80 caracteres.');
    }
    if (!Number.isInteger(input.validadeDias) || input.validadeDias < 1 || input.validadeDias > MAX_VALIDITY_DAYS) {
      throw new BadRequestException(`A validade deve ficar entre 1 e ${MAX_VALIDITY_DAYS} dias.`);
    }
    if (!scopesPermitidas(input.scopes)) {
      throw new BadRequestException('Escopo de token desconhecido ou vazio.');
    }

    return comEmpresaResolvida(orgId, async () => {
      const user = await this.usuarioAtivo(orgId, userId);
      this.exigirEscoposPermitidosPelosPapeis(user, input.scopes);

      const agora = new Date();
      const id = randomUUID();
      const segredo = randomBytes(32).toString('base64url');
      const tokenHash = sha256(segredo);
      const expiresAt = new Date(agora.getTime() + input.validadeDias * 24 * 60 * 60 * 1000);
      await this.prisma.$transaction(async (tx) => {
        // `$transaction` entrega o cliente cru; declare SET LOCAL também nele.
        // Sem isto a transação perderia o ALS do guard e RLS falharia fechado.
        await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
        // Serializa o limite por usuário; count+create sem este lock tem race.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-token:${orgId}:${userId}`}))`;
        const ativos = await tx.agentToken.count({
          where: { userId, revokedAt: null, expiresAt: { gt: agora } },
        });
        if (ativos >= MAX_ACTIVE_TOKENS_PER_USER) {
          throw new BadRequestException(`Limite de ${MAX_ACTIVE_TOKENS_PER_USER} tokens ativos por usuário atingido.`);
        }
        await tx.agentToken.create({
          data: {
            id,
            orgId,
            userId,
            name,
            tokenHash,
            scopes: [...input.scopes],
            expiresAt,
          },
        });
        await tx.auditLog.create({
          data: {
            orgId,
            actorType: ActorType.user,
            actorId: userId,
            action: 'auth.agent_token.created',
            entityType: 'AgentToken',
            entityId: id,
            after: { name, scopes: [...input.scopes], expiresAt: expiresAt.toISOString() },
          },
        });
      });

      return {
        token: `${TOKEN_PREFIX}.${orgId}.${id}.${segredo}`,
        id,
        name,
        scopes: [...input.scopes],
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  async listar(orgId: string, userId: string) {
    return comEmpresaResolvida(orgId, async () => {
      await this.usuarioAtivo(orgId, userId);
      const rows = await this.prisma.agentToken.findMany({
        where: { orgId, userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, scopes: true, expiresAt: true, revokedAt: true, createdAt: true, lastUsedAt: true },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        scopes: row.scopes,
        expiresAt: row.expiresAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      }));
    });
  }

  async revogar(orgId: string, userId: string, tokenId: string) {
    if (!uuid(tokenId)) throw new NotFoundException('Token não encontrado.');
    return comEmpresaResolvida(orgId, async () => {
      const user = await this.usuarioAtivo(orgId, userId);
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
        const row = await tx.agentToken.findFirst({
          where: { id: tokenId, orgId, userId },
          select: { id: true, name: true, scopes: true, revokedAt: true },
        });
        if (!row) throw new NotFoundException('Token não encontrado.');
        if (!row.revokedAt) {
          const revokedAt = new Date();
          await tx.agentToken.update({ where: { id: row.id }, data: { revokedAt } });
          await tx.auditLog.create({
            data: {
              orgId,
              actorType: ActorType.user,
              actorId: user.id,
              action: 'auth.agent_token.revoked',
              entityType: 'AgentToken',
              entityId: row.id,
              after: { name: row.name, scopes: row.scopes, revokedAt: revokedAt.toISOString() },
            },
          });
        }
        return row.id;
      });
      return { id: result, revoked: true };
    });
  }

  /** Resolve bearer only inside the tenant context selected by its untrusted prefix. */
  async resolverBearer(raw: string): Promise<AgentIdentity> {
    const partes = raw.split('.');
    if (partes.length !== 4 || partes[0] !== TOKEN_PREFIX || !uuid(partes[1]) || !uuid(partes[2]) || !/^[A-Za-z0-9_-]{43}$/.test(partes[3])) {
      throw new UnauthorizedException('Token inválido.');
    }
    const orgId = partes[1];
    const tokenId = partes[2];
    const tokenHash = sha256(partes[3]);

    const row = await comEmpresaResolvida(orgId, async () => this.prisma.agentToken.findFirst({
      where: { id: tokenId, orgId, tokenHash },
      select: {
        id: true,
        orgId: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            orgId: true,
            name: true,
            email: true,
            isActive: true,
            org: { select: { isActive: true } },
            roles: { select: { key: true, permissions: { select: { key: true } } } },
          },
        },
      },
    }));

    if (!row || row.orgId !== orgId || row.user.orgId !== orgId || row.revokedAt || row.expiresAt <= new Date()) {
      throw new UnauthorizedException('Token inválido.');
    }
    if (!row.user.isActive || !row.user.org.isActive || !scopesPermitidas(row.scopes)) {
      throw new UnauthorizedException('Token inválido.');
    }
    this.exigirEscoposPermitidosPelosPapeis(row.user, row.scopes);

    await comEmpresaResolvida(orgId, async () => {
      await this.prisma.agentToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    });

    const permissions = [...new Set(row.scopes.map((scope) => SCOPE_PERMISSION[scope]))];
    return {
      sub: row.user.id,
      orgId,
      email: row.user.email,
      name: row.user.name,
      // A bearer não herda papéis administrativos; sua autoridade é somente a
      // interseção explícita entre escopos emitidos e permissões atuais.
      roles: [],
      permissions,
      authMethod: 'agent-token',
      agentTokenId: row.id,
      agentTokenScopes: row.scopes,
    };
  }

  private async usuarioAtivo(orgId: string, userId: string): Promise<UserForAgentToken> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, orgId, isActive: true, org: { isActive: true } },
      include: { org: { select: { isActive: true } }, roles: { include: { permissions: true } } },
    });
    if (!user) throw new ForbiddenException('Usuário inativo ou empresa indisponível.');
    return user;
  }

  private exigirEscoposPermitidosPelosPapeis(
    user: Pick<UserForAgentToken, 'roles'>,
    scopes: readonly string[],
  ): asserts scopes is AgentTokenScope[] {
    const permissions = new Set(user.roles.flatMap((role) => role.permissions.map((permission) => permission.key)));
    if (!scopesPermitidas(scopes) || scopes.some((scope) => !permissions.has(SCOPE_PERMISSION[scope]))) {
      throw new ForbiddenException('O papel atual não permite os escopos solicitados.');
    }
  }
}
