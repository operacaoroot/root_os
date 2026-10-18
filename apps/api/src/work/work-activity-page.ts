import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TrabAtividadeDto } from '@mktos/shared';

export interface ActivityPoint { createdAt: string; id: string }
export interface ActivityScope { orgId: string; taskId: string; userId: string }
interface ActivityCursor {
  version: 1;
  scope: ActivityScope;
  limit: number;
  anchor: ActivityPoint;
  after: ActivityPoint;
}
export interface ActivityQuery {
  limit: number;
  anchor: ActivityPoint | null;
  after: ActivityPoint | null;
}
export interface ActivityRow {
  id: string; actorType: string; actorId: string | null; action: string;
  before: unknown; after: unknown; createdAt: Date;
}

// A continuação pertence a esta instância. Reiniciar exige uma consulta nova.
const cursorKey = randomBytes(32);
function invalid(): never {
  throw new BadRequestException({ error: 'work_activity_cursor_invalid', code: 'work_activity_cursor_invalid',
    message: 'Consulta de atividade inválida. Atualize o histórico.' });
}
function object(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function point(value: unknown): value is ActivityPoint {
  if (!object(value, ['createdAt', 'id']) || typeof value.id !== 'string' || value.id.length === 0 ||
      typeof value.createdAt !== 'string') return false;
  const date = new Date(value.createdAt);
  return Number.isFinite(date.getTime()) && date.toISOString() === value.createdAt;
}
function beforeOrEqual(a: ActivityPoint, b: ActivityPoint): boolean {
  const timeA = new Date(a.createdAt).getTime(), timeB = new Date(b.createdAt).getTime();
  return timeA < timeB || timeA === timeB && a.id <= b.id;
}
function sign(payload: string): Buffer { return createHmac('sha256', cursorKey).update(payload).digest(); }
function parseCursor(value: string, scope: ActivityScope): ActivityCursor {
  if (value.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) invalid();
  const [payload, encodedSignature] = value.split('.');
  const signature = Buffer.from(encodedSignature, 'base64url');
  if (signature.length !== 32 || signature.toString('base64url') !== encodedSignature || !timingSafeEqual(signature, sign(payload))) invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch { invalid(); }
  if (!object(parsed, ['version', 'scope', 'limit', 'anchor', 'after']) || parsed.version !== 1 ||
      !object(parsed.scope, ['orgId', 'taskId', 'userId']) ||
      parsed.scope.orgId !== scope.orgId || parsed.scope.taskId !== scope.taskId || parsed.scope.userId !== scope.userId ||
      !Number.isInteger(parsed.limit) || (parsed.limit as number) < 1 || (parsed.limit as number) > 100 ||
      !point(parsed.anchor) || !point(parsed.after) || !beforeOrEqual(parsed.after, parsed.anchor)) invalid();
  return parsed as unknown as ActivityCursor;
}

export function parseActivityQuery(query: Record<string, unknown>, scope: ActivityScope): ActivityQuery {
  if (!query || typeof query !== 'object' || Array.isArray(query) ||
      Object.keys(query).some(key => key !== 'limit' && key !== 'cursor')) invalid();
  let requestedLimit: number | undefined;
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^(?:[1-9][0-9]?|100)$/.test(query.limit)) invalid();
    requestedLimit = Number(query.limit);
  }
  if (query.cursor === undefined) return { limit: requestedLimit ?? 50, anchor: null, after: null };
  if (typeof query.cursor !== 'string') invalid();
  const cursor = parseCursor(query.cursor, scope);
  if (requestedLimit !== undefined && requestedLimit !== cursor.limit) invalid();
  return { limit: cursor.limit, anchor: cursor.anchor, after: cursor.after };
}
export function activityCursor(scope: ActivityScope, limit: number, anchor: ActivityPoint, after: ActivityPoint): string {
  const cursor: ActivityCursor = { version: 1, scope, limit, anchor, after };
  const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  return payload + '.' + sign(payload).toString('base64url');
}
export function activityPoint(row: Pick<ActivityRow, 'id' | 'createdAt'>): ActivityPoint {
  return { createdAt: row.createdAt.toISOString(), id: row.id };
}
export function activityWhere(orgId: string, taskId: string, query: ActivityQuery): Prisma.AuditLogWhereInput {
  const conditions: Prisma.AuditLogWhereInput[] = [];
  if (query.anchor) conditions.push({ OR: [
    { createdAt: { lt: new Date(query.anchor.createdAt) } },
    { createdAt: new Date(query.anchor.createdAt), id: { lte: query.anchor.id } },
  ] });
  if (query.after) conditions.push({ OR: [
    { createdAt: { lt: new Date(query.after.createdAt) } },
    { createdAt: new Date(query.after.createdAt), id: { lt: query.after.id } },
  ] });
  return { orgId, entityType: 'work_task', entityId: taskId, ...(conditions.length ? { AND: conditions } : {}) };
}
export async function activityNames(db: Pick<Prisma.TransactionClient, 'user'>, orgId: string, rows: ActivityRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.filter(row => row.actorType === 'user' && row.actorId).map(row => row.actorId!))];
  const users = ids.length ? await db.user.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } }) : [];
  return new Map(users.map(user => [user.id, user.name]));
}
export function activityDto(row: ActivityRow, names: Map<string, string>): TrabAtividadeDto {
  return { id: row.id, actorType: row.actorType,
    actorName: row.actorType === 'user' && row.actorId ? names.get(row.actorId) ?? null : null,
    action: row.action, before: row.before, after: row.after, createdAt: row.createdAt.toISOString() };
}
