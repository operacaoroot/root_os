import { createHash } from 'node:crypto';
import { z } from 'zod';

const uuid = z.string().uuid();
const file = z.object({ taskExternalId: z.string().min(1).max(100), fileId: z.string().min(1).max(100) }).strict();
const content = { title: z.string().trim().min(1).max(400), body: z.string().min(1).max(200000), sourceRef: z.string().trim().min(1).max(1000), files: z.array(file).max(30).default([]) };
export const EditorialCreateSchema = z.object({ requestId: uuid, taskId: uuid, releaseStatusId: uuid, ...content }).strict();
export const EditorialVersionSchema = z.object({ requestId: uuid, expectedRevision: z.number().int().min(1), ...content }).strict();
export const EditorialDecisionSchema = z.object({ requestId: uuid, versionId: uuid, contentHash: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(['approved', 'rejected']), reason: z.string().trim().min(1).max(2000) }).strict();
export const EditorialRevokeSchema = z.object({ requestId: uuid.optional(), reason: z.string().trim().min(1).max(2000) }).strict();
export const EditorialProductionSchema = z.object({ requestId: uuid, taskId: uuid, versionId: uuid, decisionId: uuid, contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type EditorialCreate = z.infer<typeof EditorialCreateSchema>;
export type EditorialVersionInput = z.infer<typeof EditorialVersionSchema>;
export type EditorialDecisionInput = z.infer<typeof EditorialDecisionSchema>;
export type EditorialProductionInput = z.infer<typeof EditorialProductionSchema>;
export interface EditorialFile { taskExternalId: string; fileId: string; name: string; sha256: string; }
export interface EditorialMaterialRow { id: string; orgId: string; taskId: string; title: string; releaseStatusId: string; selectedVersionId: string | null; revision: number; requestId: string; actorId: string; fingerprint: string; createdAt: Date; }
export interface EditorialVersionRow { id: string; orgId: string; materialId: string; number: number; title: string; body: string; files: EditorialFile[]; sourceRef: string; contentHash: string; requestId: string; actorId: string; fingerprint: string; createdAt: Date; }
export interface EditorialDecisionRow { id: string; orgId: string; versionId: string; state: 'approved' | 'rejected'; reason: string; minimumAuthority: string; authority: string; requestId: string; actorId: string; fingerprint: string; revokedAt: Date | null; revokedBy: string | null; revokedReason: string | null; createdAt: Date; }
export interface EditorialProductionRow { id: string; orgId: string; taskId: string; materialId: string; versionId: string; decisionId: string; title: string; body: string; files: EditorialFile[]; sourceRef: string; contentHash: string; requestId: string; actorId: string; fingerprint: string; createdAt: Date; }
const stable = (value: unknown): string => { if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'; if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}'; return JSON.stringify(value); };
export const editorialHash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
export const editorialContentHash = (v: Pick<EditorialVersionRow, 'title' | 'body' | 'files' | 'sourceRef'>) => editorialHash({ title: v.title, body: v.body, files: v.files, sourceRef: v.sourceRef });
export const editorialFingerprint = (orgId: string, actorId: string, operation: string, input: unknown) => editorialHash({ orgId, actorId, operation, input });

export interface EditorialConference { taskId: string; materialId: string; versionId: string; versionNumber: number; decisionId: string; contentHash: string; title: string; body: string; files: EditorialFile[]; sourceRef: string; approvedBy: string; authoredBy: string; }
