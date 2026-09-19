import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ActorType,
  ConnectorDeletionRule,
  ConnectorMode,
  ConnectorSourceType,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { comTenantResolvido } from '../common/contexto-execucao';
import { PrismaService } from '../prisma/prisma.service';

const PAIRING_TTL_MS = 15 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 5;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024 * 1024;

export interface ConnectorSourceInput {
  nome: string;
  tipo: ConnectorSourceType;
  raizLogica: string;
  incluir: string[];
  excluir: string[];
  tiposPermitidos: string[];
  modo: ConnectorMode;
  regraExclusao: ConnectorDeletionRule;
  tamanhoMaximo: number;
}

export interface ConnectorDeviceIdentity {
  id: string;
  orgId: string;
  nome: string;
}

export interface ConnectorPulseInput {
  versao: string;
  so: string;
  usuarioLocal: string;
  relogio: string;
}

interface PairingRow {
  id: string;
  orgId: string;
  createdByUserId: string;
  codeHash: string;
  sourceIds: string[];
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  usedAt: Date | null;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function safeHashEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearerParts(value: string): { orgId: string; deviceId: string; secret: string } | null {
  const parts = value.trim().split('.');
  if (parts.length !== 4 || parts[0] !== 'rcon1') return null;
  const [_, orgId, deviceId, secret] = parts;
  if (!orgId || !deviceId || !/^[A-Za-z0-9_-]{40,64}$/.test(secret)) return null;
  return { orgId, deviceId, secret };
}

/** Identidade e escopo do receptor; não acessa filesystem e não conhece PAT. */
@Injectable()
export class ConectorService {
  constructor(private readonly prisma: PrismaService) {}

  async criarFonte(orgId: string, actorId: string, input: ConnectorSourceInput) {
    const config = validarFonte(input);
    return comTenantResolvido(orgId, async () => {
      await this.exigirAutoridadeAtual(orgId, actorId);
      return this.prisma.$transaction(async (tx) => {
        await this.definirTenant(tx, orgId);
        const row = await tx.connectorSource.create({
          data: {
            orgId,
            nome: config.nome,
            tipo: config.tipo,
            raizLogica: config.raizLogica,
            incluir: config.incluir,
            excluir: config.excluir,
            tiposPermitidos: config.tiposPermitidos,
            modo: config.modo,
            regraExclusao: config.regraExclusao,
            tamanhoMaximo: BigInt(config.tamanhoMaximo),
          },
        });
        await this.audit(tx, orgId, actorId, 'conector.fonte.criada', 'ConnectorSource', row.id, {
          tipo: row.tipo,
          nome: row.nome,
          raizLogica: row.raizLogica,
          escopoVersao: row.escopoVersao,
        });
        return this.publicSource(row);
      });
    });
  }

  async listarFontes(orgId: string, actorId: string) {
    return comTenantResolvido(orgId, async () => {
      await this.exigirAutoridadeAtual(orgId, actorId);
      const rows = await this.prisma.connectorSource.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => this.publicSource(row));
    });
  }

  async revogarFonte(orgId: string, actorId: string, sourceId: string) {
    return comTenantResolvido(orgId, async () => {
      await this.exigirAutoridadeAtual(orgId, actorId);
      return this.prisma.$transaction(async (tx) => {
        await this.definirTenant(tx, orgId);
        const row = await tx.connectorSource.findFirst({ where: { id: sourceId, orgId } });
        if (!row) throw new NotFoundException('Fonte não encontrada.');
        if (row.revokedAt) return { id: row.id, revoked: true };
        const revokedAt = new Date();
        const updated = await tx.connectorSource.update({
          where: { id: row.id },
          data: { revokedAt },
        });
        await this.audit(tx, orgId, actorId, 'conector.fonte.revogada', 'ConnectorSource', row.id, {
          revokedAt: revokedAt.toISOString(),
        });
        return { id: updated.id, revoked: true };
      });
    });
  }

  async emitirCodigo(
    orgId: string,
    actorId: string,
    nomeDispositivo: string,
    sourceIds: string[],
  ) {
    const nome = nomeDispositivo.trim();
    if (!nome || nome.length > 80) throw new BadRequestException('Nome de dispositivo inválido.');
    if (!Array.isArray(sourceIds) || sourceIds.length < 1 || sourceIds.length > 50) {
      throw new BadRequestException('Selecione entre uma e cinquenta fontes.');
    }
    const ids = [...new Set(sourceIds)];
    if (ids.length !== sourceIds.length || ids.some((id) => !/^[0-9a-f-]{20,}$/i.test(id))) {
      throw new BadRequestException('Fontes inválidas.');
    }

    return comTenantResolvido(orgId, async () => {
      await this.exigirAutoridadeAtual(orgId, actorId);
      return this.prisma.$transaction(async (tx) => {
        await this.definirTenant(tx, orgId);
        const fontes = await tx.connectorSource.findMany({
          where: { orgId, id: { in: ids }, revokedAt: null },
          select: { id: true },
        });
        if (fontes.length !== ids.length) throw new BadRequestException('Fonte inválida ou revogada.');
        const code = randomBytes(16).toString('base64url');
        const row = await tx.connectorPairingCode.create({
          data: {
            orgId,
            createdByUserId: actorId,
            codeHash: hashSecret(code),
            sourceIds: ids,
            expiresAt: new Date(Date.now() + PAIRING_TTL_MS),
            maxAttempts: MAX_PAIRING_ATTEMPTS,
          },
        });
        await this.audit(tx, orgId, actorId, 'conector.pareamento.codigo_emitido', 'ConnectorPairingCode', row.id, {
          sourceCount: ids.length,
          expiresAt: row.expiresAt.toISOString(),
        });
        // `code` is returned only by this emission call; it never reaches the
        // database, list endpoints or audit payload.
        return { id: row.id, nomeDispositivo: nome, codigo: code, expiraEm: row.expiresAt };
      });
    });
  }

  async parear(orgId: string, pairingId: string, code: string, nomeDispositivo: string) {
    const nome = nomeDispositivo.trim();
    if (!nome || nome.length > 80) throw new UnauthorizedException('Pareamento inválido.');
    const result = await comTenantResolvido(orgId, async () => {
      return this.prisma.$transaction(async (tx) => {
        await this.definirTenant(tx, orgId);
        const rows = await tx.$queryRaw<PairingRow[]>(Prisma.sql`
          SELECT "id", "orgId", "createdByUserId", "codeHash", "sourceIds",
                 "expiresAt", "attempts", "maxAttempts", "usedAt"
          FROM "ConnectorPairingCode"
          WHERE "id" = ${pairingId} AND "orgId" = ${orgId}
          FOR UPDATE
        `);
        const row = rows[0];
        if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now() || row.attempts >= row.maxAttempts) {
          return null;
        }
        const expected = hashSecret(code);
        if (!safeHashEqual(row.codeHash, expected)) {
          await tx.connectorPairingCode.update({
            where: { id: row.id },
            data: { attempts: { increment: 1 } },
          });
          await this.audit(tx, orgId, null, 'conector.pareamento.tentativa_recusada', 'ConnectorPairingCode', row.id, {
            tentativa: row.attempts + 1,
          });
          return null;
        }

        // O código não congela a autoridade de quem o emitiu. Um downgrade,
        // desativação do usuário ou suspensão da empresa entre emissão e troca
        // fecha o pareamento sem consumir o código nem criar dispositivo.
        const issuer = await tx.user.findFirst({
          where: { id: row.createdByUserId, orgId, isActive: true, org: { isActive: true } },
          select: { roles: { select: { permissions: { select: { key: true } } } } },
        });
        const permissions = new Set(issuer?.roles.flatMap((role) => role.permissions.map((permission) => permission.key)) ?? []);
        if (!issuer || !permissions.has('admin.permissoes') || !permissions.has('obsidian.editar')) {
          return null;
        }

        const fontes = await tx.connectorSource.findMany({
          where: { orgId, id: { in: row.sourceIds }, revokedAt: null },
          select: { id: true },
        });
        if (fontes.length !== row.sourceIds.length) {
          await tx.connectorPairingCode.update({
            where: { id: row.id },
            data: { attempts: { increment: 1 } },
          });
          await this.audit(tx, orgId, null, 'conector.pareamento.tentativa_recusada', 'ConnectorPairingCode', row.id, {
            tentativa: row.attempts + 1,
            fonteRevogada: true,
          });
          return null;
        }

        const deviceId = cryptoUuid();
        const secret = randomBytes(32).toString('base64url');
        const token = `rcon1.${orgId}.${deviceId}.${secret}`;
        const device = await tx.connectorDevice.create({
          data: { id: deviceId, orgId, nome, tokenHash: hashSecret(secret) },
        });
        await tx.connectorDeviceSource.createMany({
          data: row.sourceIds.map((sourceId) => ({ orgId, deviceId: device.id, sourceId })),
        });
        await tx.connectorPairingCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
        await this.audit(tx, orgId, null, 'conector.dispositivo.pareado', 'ConnectorDevice', device.id, {
          pairingId: row.id,
          sourceCount: row.sourceIds.length,
        });
        return { id: device.id, orgId, nome: device.nome, token };
      });
    });
    if (!result) throw new UnauthorizedException('Pareamento inválido.');
    return result;
  }

  async listarDispositivos(orgId: string, actorId: string) {
    return comTenantResolvido(orgId, async () => {
      await this.exigirAutoridadeAtual(orgId, actorId);
      const rows = await this.prisma.connectorDevice.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        include: { sources: { select: { sourceId: true } } },
      });
      return rows.map((row) => ({
        id: row.id,
        nome: row.nome,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        revokedAt: row.revokedAt,
        fonteIds: row.sources.map((source) => source.sourceId),
      }));
    });
  }

  async revogarDispositivo(orgId: string, actorId: string, deviceId: string) {
    return comTenantResolvido(orgId, async () => {
      await this.exigirAutoridadeAtual(orgId, actorId);
      return this.prisma.$transaction(async (tx) => {
        await this.definirTenant(tx, orgId);
        const row = await tx.connectorDevice.findFirst({ where: { id: deviceId, orgId } });
        if (!row) throw new NotFoundException('Dispositivo não encontrado.');
        if (row.revokedAt) return { id: row.id, revoked: true };
        const revokedAt = new Date();
        await tx.connectorDevice.update({ where: { id: row.id }, data: { revokedAt } });
        await this.audit(tx, orgId, actorId, 'conector.dispositivo.revogado', 'ConnectorDevice', row.id, {
          revokedAt: revokedAt.toISOString(),
        });
        return { id: row.id, revoked: true };
      });
    });
  }

  async resolverDispositivo(bearer: string): Promise<ConnectorDeviceIdentity> {
    const parts = bearerParts(bearer);
    if (!parts) throw new UnauthorizedException('Credencial do conector inválida.');
    return comTenantResolvido(parts.orgId, async () => {
      const row = await this.prisma.connectorDevice.findFirst({
        where: {
          id: parts.deviceId,
          orgId: parts.orgId,
          tokenHash: hashSecret(parts.secret),
          revokedAt: null,
          org: { isActive: true },
        },
        select: { id: true, orgId: true, nome: true },
      });
      if (!row) throw new UnauthorizedException('Credencial do conector inválida.');
      await this.prisma.connectorDevice.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
      return row;
    });
  }

  async pulso(device: ConnectorDeviceIdentity, _input: ConnectorPulseInput) {
    return comTenantResolvido(device.orgId, async () => {
      const row = await this.prisma.connectorDevice.findFirst({
        where: { id: device.id, orgId: device.orgId, revokedAt: null, org: { isActive: true } },
        include: {
          sources: {
            where: { orgId: device.orgId, source: { orgId: device.orgId, revokedAt: null } },
            include: { source: true },
          },
        },
      });
      if (!row) throw new UnauthorizedException('Credencial do conector inválida.');
      const fontes = row.sources.map((link) => this.publicSource(link.source));
      return {
        revogado: fontes.length === 0,
        fontes,
        intervaloMs: 5 * 60 * 1000,
      };
    });
  }

  private async exigirAutoridadeAtual(orgId: string, actorId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: actorId, orgId, isActive: true, org: { isActive: true } },
      select: { roles: { select: { permissions: { select: { key: true } } } } },
    });
    const permissions = new Set(user?.roles.flatMap((role) => role.permissions.map((p) => p.key)) ?? []);
    if (!user || !permissions.has('admin.permissoes') || !permissions.has('obsidian.editar')) {
      throw new ForbiddenException('As permissões atuais admin.permissoes e obsidian.editar são necessárias.');
    }
  }

  private async definirTenant(tx: Prisma.TransactionClient, orgId: string): Promise<void> {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    orgId: string,
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    after: Prisma.InputJsonValue,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        orgId,
        actorType: actorId ? ActorType.user : ActorType.system,
        actorId,
        action,
        entityType,
        entityId,
        after,
      },
    });
  }

  private publicSource(row: {
    id: string;
    nome: string;
    tipo: ConnectorSourceType;
    raizLogica: string;
    incluir: string[];
    excluir: string[];
    tiposPermitidos: string[];
    modo: ConnectorMode;
    regraExclusao: ConnectorDeletionRule;
    tamanhoMaximo: bigint;
    escopoVersao: number;
    revokedAt: Date | null;
    createdAt: Date;
    ultimaRemessaTentativaEm?: Date | null;
    ultimaRemessaSucessoEm?: Date | null;
    ultimaRemessaStatus?: string | null;
    ultimaRemessaItens?: number | null;
    ultimaRemessaErros?: number | null;
  }) {
    return {
      id: row.id,
      nome: row.nome,
      tipo: row.tipo,
      raizLogica: row.raizLogica,
      incluir: row.incluir,
      excluir: row.excluir,
      tiposPermitidos: row.tiposPermitidos,
      modo: row.modo,
      regraExclusao: row.regraExclusao,
      tamanhoMaximo: Number(row.tamanhoMaximo),
      escopoVersao: row.escopoVersao,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      ultimaRemessaTentativaEm: row.ultimaRemessaTentativaEm ?? null,
      ultimaRemessaSucessoEm: row.ultimaRemessaSucessoEm ?? null,
      ultimaRemessaStatus: row.ultimaRemessaStatus ?? null,
      ultimaRemessaItens: row.ultimaRemessaItens ?? null,
      ultimaRemessaErros: row.ultimaRemessaErros ?? null,
    };
  }
}

function cryptoUuid(): string {
  // UUID format is only a selector; the random device secret is the bearer.
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validarFonte(input: ConnectorSourceInput): ConnectorSourceInput {
  const nome = input.nome.trim();
  if (!nome || nome.length > 120) throw new BadRequestException('Nome de fonte inválido.');
  if (input.tipo !== ConnectorSourceType.pasta && input.tipo !== ConnectorSourceType.arquivo) {
    throw new BadRequestException('Tipo de fonte inválido.');
  }
  const raiz = validarSeletorLogico(input.raizLogica, 'raiz lógica');
  const arrays = [input.incluir, input.excluir];
  if (arrays.some((list) => !Array.isArray(list) || list.length > 100)) {
    throw new BadRequestException('Filtros inválidos.');
  }
  const incluir = input.incluir.map((value) => validarSeletorLogico(value, 'filtro'));
  const excluir = input.excluir.map((value) => validarSeletorLogico(value, 'filtro'));
  if (!Array.isArray(input.tiposPermitidos) || input.tiposPermitidos.length > 50) {
    throw new BadRequestException('Extensões inválidas.');
  }
  const tiposPermitidos = input.tiposPermitidos.map((value) => {
    if (!/^\.[A-Za-z0-9]{1,12}$/.test(value)) throw new BadRequestException('Extensão inválida.');
    return value.toLowerCase();
  });
  if (!Object.values(ConnectorMode).includes(input.modo) || !Object.values(ConnectorDeletionRule).includes(input.regraExclusao)) {
    throw new BadRequestException('Modo ou regra de exclusão inválidos.');
  }
  if (!Number.isSafeInteger(input.tamanhoMaximo) || input.tamanhoMaximo < 1 || input.tamanhoMaximo > MAX_SOURCE_BYTES) {
    throw new BadRequestException('Limite de tamanho inválido.');
  }
  return { ...input, nome, raizLogica: raiz, incluir, excluir, tiposPermitidos };
}

function validarSeletorLogico(value: string, campo: string): string {
  const result = value.trim();
  if (!result || result.length > 500 || result.startsWith('/') || result.startsWith('\\') || result.startsWith('~') || /^[A-Za-z]:/.test(result)) {
    throw new BadRequestException(`${campo} deve ser lógico, relativo e sem raiz absoluta.`);
  }
  const parts = result.split(/[\\/]/);
  if (parts.some((part) => part === '..' || part === '')) {
    throw new BadRequestException(`${campo} não pode conter travessia de caminho.`);
  }
  return result;
}
