import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';

// Contexto de escrita sensível que exige aprovação humana confirmada.
export type ResourceType = 'lead' | 'task' | 'campaign' | 'content';

// Só estas chaves entram no "changes" canônico por recurso — o resto é ruído e
// é ignorado no hash (robusto a ordem de chave e a campos extras).
const ALLOWED_KEYS: Record<ResourceType, string[]> = {
  lead: ['status', 'nextAction'],
  task: ['status'],
  campaign: ['status'],
  content: ['status'],
};

export function isResourceType(v: unknown): v is ResourceType {
  return typeof v === 'string' && v in ALLOWED_KEYS;
}

/** Normaliza o corpo da mutação e devolve um hash estável — bind da aprovação à mudança exata. */
export function canonicalHash(resourceType: ResourceType, body: Record<string, unknown>): string {
  const keys = ALLOWED_KEYS[resourceType];
  const norm: Record<string, unknown> = {};
  for (const k of keys) {
    const val = body?.[k];
    if (val !== undefined && val !== null) norm[k] = val;
  }
  const stable = JSON.stringify(norm, Object.keys(norm).sort());
  return createHash('sha256').update(`${resourceType}:${stable}`).digest('hex');
}

type ApprovalStatus = 'pending' | 'confirmed' | 'consumed' | 'rejected';

interface ApprovalRecord {
  id: string;
  token: string;
  orgId: string;
  actorId: string;
  resourceType: ResourceType;
  resourceId: string;
  changesHash: string;
  summary: string;
  status: ApprovalStatus;
  createdAt: number;
  expiresAt: number;
  confirmedAt?: number;
  consumedAt?: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 min

// Estado efêmero em memória (API roda em 1 processo). O rastro durável fica em
// audit_logs (propose/confirm/reject/consume). Restart perde pendências — ok:
// são de vida curta, é só re-propor.
@Injectable()
export class ApprovalsService implements OnModuleDestroy {
  private readonly byId = new Map<string, ApprovalRecord>();
  private readonly idByToken = new Map<string, string>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(private readonly audit: AuditService) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, rec] of this.byId) {
      if (rec.expiresAt < now || rec.status === 'consumed' || rec.status === 'rejected') {
        this.byId.delete(id);
        this.idByToken.delete(rec.token);
      }
    }
  }

  async create(input: {
    orgId: string;
    actorId: string;
    resourceType: ResourceType;
    resourceId: string;
    changes: Record<string, unknown>;
    summary?: string;
  }): Promise<{ approvalId: string; token: string; summary: string; expiresAt: string }> {
    if (!isResourceType(input.resourceType)) {
      throw new BadRequestException(`resourceType inválido: ${input.resourceType}`);
    }
    if (!input.resourceId) throw new BadRequestException('resourceId ausente');

    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    const now = Date.now();
    const rec: ApprovalRecord = {
      id,
      token,
      orgId: input.orgId,
      actorId: input.actorId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      changesHash: canonicalHash(input.resourceType, input.changes ?? {}),
      summary: input.summary ?? `${input.resourceType} ${input.resourceId}`,
      status: 'pending',
      createdAt: now,
      expiresAt: now + TTL_MS,
    };
    this.byId.set(id, rec);
    this.idByToken.set(token, id);

    await this.audit.log({
      orgId: input.orgId,
      actorType: ActorType.ai,
      actorId: input.actorId,
      action: 'approval.propose',
      entityType: rec.resourceType,
      entityId: rec.resourceId,
      after: { approvalId: id, summary: rec.summary },
    });
    return { approvalId: id, token, summary: rec.summary, expiresAt: new Date(rec.expiresAt).toISOString() };
  }

  private mustOwn(orgId: string, id: string): ApprovalRecord {
    const rec = this.byId.get(id);
    if (!rec || rec.orgId !== orgId) throw new NotFoundException('Aprovação não encontrada');
    if (rec.expiresAt < Date.now()) {
      rec.status = 'rejected';
      throw new BadRequestException('Aprovação expirada');
    }
    return rec;
  }

  async confirm(orgId: string, id: string, actorId: string): Promise<{ ok: true; resourceType: ResourceType; resourceId: string; summary: string }> {
    const rec = this.mustOwn(orgId, id);
    if (rec.status !== 'pending') throw new BadRequestException(`Aprovação já ${rec.status}`);
    rec.status = 'confirmed';
    rec.confirmedAt = Date.now();
    await this.audit.log({
      orgId,
      actorType: ActorType.user,
      actorId,
      action: 'approval.confirm',
      entityType: rec.resourceType,
      entityId: rec.resourceId,
      after: { approvalId: id, summary: rec.summary },
    });
    return { ok: true, resourceType: rec.resourceType, resourceId: rec.resourceId, summary: rec.summary };
  }

  async reject(orgId: string, id: string, actorId: string): Promise<{ ok: true }> {
    const rec = this.byId.get(id);
    if (!rec || rec.orgId !== orgId) throw new NotFoundException('Aprovação não encontrada');
    rec.status = 'rejected';
    await this.audit.log({
      orgId,
      actorType: ActorType.user,
      actorId,
      action: 'approval.reject',
      entityType: rec.resourceType,
      entityId: rec.resourceId,
      after: { approvalId: id },
    });
    this.byId.delete(id);
    this.idByToken.delete(rec.token);
    return { ok: true };
  }

  get(orgId: string, id: string): { id: string; status: ApprovalStatus; summary: string; expiresAt: string } {
    const rec = this.byId.get(id);
    if (!rec || rec.orgId !== orgId) throw new NotFoundException('Aprovação não encontrada');
    return { id: rec.id, status: rec.status, summary: rec.summary, expiresAt: new Date(rec.expiresAt).toISOString() };
  }

  /** Gate da escrita: token confirmado, no prazo, single-use e casando recurso+mudança exata. */
  async consumeForWrite(input: {
    orgId: string;
    token: string | undefined;
    resourceType: ResourceType;
    resourceId: string;
    body: Record<string, unknown>;
    actorId: string;
  }): Promise<void> {
    const { orgId, token, resourceType, resourceId, body, actorId } = input;
    if (!token) throw new ForbiddenException('Ação sensível requer aprovação humana confirmada (x-approval-token ausente).');

    const id = this.idByToken.get(token);
    const rec = id ? this.byId.get(id) : undefined;
    if (!rec || rec.orgId !== orgId) throw new ForbiddenException('Token de aprovação inválido.');
    if (rec.expiresAt < Date.now()) throw new ForbiddenException('Aprovação expirada.');
    if (rec.status === 'consumed') throw new ForbiddenException('Aprovação já utilizada (single-use).');
    if (rec.status !== 'confirmed') throw new ForbiddenException('Aprovação não confirmada pelo humano.');
    if (rec.resourceType !== resourceType || rec.resourceId !== resourceId) {
      throw new ForbiddenException('Aprovação não corresponde ao recurso desta escrita.');
    }
    if (rec.changesHash !== canonicalHash(resourceType, body ?? {})) {
      throw new ForbiddenException('A mudança difere do que foi aprovado.');
    }

    rec.status = 'consumed';
    rec.consumedAt = Date.now();
    this.idByToken.delete(token);
    await this.audit.log({
      orgId,
      actorType: ActorType.ai,
      actorId,
      action: 'approval.consume',
      entityType: resourceType,
      entityId: resourceId,
      after: { approvalId: rec.id, summary: rec.summary },
    });
  }
}
