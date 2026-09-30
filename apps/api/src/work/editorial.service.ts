import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';

const CriarArtefato = z.object({
  tipo: z.enum(['roteiro', 'copy', 'pacote']),
  createKey: z.string().trim().min(1).max(200),
}).strict();
const CriarVersao = z.object({
  expectedCurrentVersionId: z.string().uuid().nullable(),
  body: z.string().refine((value) => value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= 524_288,
    'Corpo obrigatório, com até 512 KiB UTF-8.'),
  sourceRefs: z.array(z.never()).max(0).default([]),
  fileIdsEmOrdem: z.array(z.never()).max(0).default([]),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
type ArtefatoInput = z.infer<typeof CriarArtefato>;
type VersaoInput = z.infer<typeof CriarVersao>;

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
function isSerialization(error: unknown): boolean {
  return isPrismaCode(error, 'P2034') ||
    (isPrismaCode(error, 'P2010') && String((error as Prisma.PrismaClientKnownRequestError).meta?.code) === '40001');
}
function resumoVersao(version: { id: string; artifactId: string; numero: number; contentHash: string }, currentVersionId: string | null, replayed: boolean) {
  return { artifactId: version.artifactId, versionId: version.id, numero: version.numero,
    contentHash: version.contentHash, currentVersionId, replayed };
}

/** P10 mínimo: texto versionado; upload, fontes externas e aprovação ficam fechados. */
@Injectable()
export class EditorialService {
  constructor(private readonly prisma: PrismaService) {}

  async criarArtefato(orgId: string, workTaskId: string, raw: unknown) {
    const input: ArtefatoInput = parse(CriarArtefato, raw);
    const requestHash = hash({ workTaskId, tipo: input.tipo, originSystem: null, originRef: null });
    const task = await this.prisma.workTask.findFirst({ where: { id: workTaskId, orgId }, select: { id: true } });
    if (!task) throw new NotFoundException('Card não encontrado nesta empresa.');
    const replay = async () => {
      const existing = await this.prisma.editorialArtifact.findUnique({ where: { orgId_createKey: { orgId, createKey: input.createKey } } });
      if (!existing) return null;
      if (existing.requestHash !== requestHash) throw new ConflictException('Chave de criação usada com outro card ou tipo.');
      return { artifactId: existing.id, workTaskId: existing.workTaskId, tipo: existing.tipo,
        currentVersionId: existing.currentVersionId, replayed: true };
    };
    const prior = await replay();
    if (prior) return prior;
    try {
      const artifact = await this.prisma.editorialArtifact.create({ data: {
        orgId, workTaskId, tipo: input.tipo, createKey: input.createKey, requestHash,
      } });
      return { artifactId: artifact.id, workTaskId, tipo: artifact.tipo, currentVersionId: null, replayed: false };
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) {
        const winner = await replay();
        if (winner) return winner;
        throw new ConflictException('Origem ou chave de artefato já usada.');
      }
      throw error;
    }
  }

  async listar(orgId: string, workTaskId: string) {
    const task = await this.prisma.workTask.findFirst({ where: { id: workTaskId, orgId }, select: { id: true } });
    if (!task) throw new NotFoundException('Card não encontrado nesta empresa.');
    return this.prisma.editorialArtifact.findMany({ where: { orgId, workTaskId },
      select: { id: true, tipo: true, currentVersionId: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
  }

  async lerVersao(orgId: string, workTaskId: string, artifactId: string, numero: number) {
    if (!Number.isSafeInteger(numero) || numero < 1) throw new BadRequestException('Número de versão inválido.');
    const artifact = await this.prisma.editorialArtifact.findFirst({ where: { id: artifactId, orgId, workTaskId }, select: { id: true } });
    if (!artifact) throw new NotFoundException('Artefato não encontrado neste card.');
    const version = await this.prisma.editorialVersion.findFirst({ where: { orgId, workTaskId, artifactId, numero },
      select: { id: true, artifactId: true, numero: true, body: true, sourceRefs: true, contentHash: true,
        authorType: true, authorId: true, createdAt: true, baseVersionId: true } });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    return version;
  }

  async criarVersao(orgId: string, workTaskId: string, artifactId: string, authorId: string, raw: unknown) {
    const input: VersaoInput = parse(CriarVersao, raw);
    const requestHash = hash({ artifactId, expectedCurrentVersionId: input.expectedCurrentVersionId,
      body: input.body, sourceRefs: [], fileIdsEmOrdem: [] });
    const contentHash = hash({ body: input.body, sourceRefs: [], manifestoOrdenado: [] });
    const replay = async (db: Pick<PrismaClient, 'editorialVersion' | 'editorialArtifact'>) => {
      const existing = await db.editorialVersion.findUnique({ where: { orgId_idempotencyKey: { orgId, idempotencyKey: input.idempotencyKey } } });
      if (!existing) return null;
      if (existing.artifactId !== artifactId || existing.workTaskId !== workTaskId || existing.requestHash !== requestHash) {
        throw new ConflictException('Chave de versão usada com outro pedido.');
      }
      const artifact = await db.editorialArtifact.findFirst({ where: { id: artifactId, orgId, workTaskId }, select: { currentVersionId: true } });
      if (!artifact) throw new NotFoundException('Artefato não encontrado neste card.');
      return resumoVersao(existing, artifact.currentVersionId, true);
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const prior = await replay(tx);
          if (prior) return prior;
          const locked = await tx.$queryRaw<Array<{ id: string; workTaskId: string; currentVersionId: string | null }>>`
            SELECT id, "workTaskId", "currentVersionId" FROM "EditorialArtifact"
            WHERE id = ${artifactId} AND "orgId" = ${orgId} AND "workTaskId" = ${workTaskId} FOR UPDATE`;
          const artifact = locked[0];
          if (!artifact) throw new NotFoundException('Artefato não encontrado neste card.');
          // A primeira consulta pode ter ocorrido antes de outro commit.
          const afterLock = await replay(tx);
          if (afterLock) return afterLock;
          if (artifact.currentVersionId !== input.expectedCurrentVersionId) {
            throw new ConflictException('Ponteiro editorial mudou; releia o artefato.');
          }
          const current = artifact.currentVersionId
            ? await tx.editorialVersion.findFirst({ where: { id: artifact.currentVersionId, orgId, artifactId }, select: { numero: true } })
            : null;
          if (artifact.currentVersionId && !current) throw new ConflictException('Ponteiro editorial sem versão correspondente.');
          const version = await tx.editorialVersion.create({ data: {
            orgId, workTaskId, artifactId, numero: (current?.numero ?? 0) + 1,
            baseVersionId: artifact.currentVersionId, body: input.body, sourceRefs: [],
            contentHash, idempotencyKey: input.idempotencyKey, requestHash,
            authorType: ActorType.user, authorId,
          } });
          await tx.editorialArtifact.update({ where: { id: artifactId }, data: { currentVersionId: version.id } });
          return resumoVersao(version, version.id, false);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (isSerialization(error) && attempt < 2) continue;
        if (isPrismaCode(error, 'P2002') || isSerialization(error)) {
          const winner = await replay(this.prisma);
          if (winner) return winner;
          throw new ConflictException('Versão concorrente venceu; releia o artefato.');
        }
        throw error;
      }
    }
    throw new ConflictException('Não foi possível fechar a transação editorial.');
  }
}
