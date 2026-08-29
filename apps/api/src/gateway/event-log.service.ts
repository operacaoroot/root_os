import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma, RiskLevel } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface EventoInput {
  orgId: string;
  tipo: string;
  actorType?: ActorType;
  actorId?: string | null;
  agentSlug?: string | null;
  capabilityId?: string | null;
  toolCallId?: string | null;
  decisionId?: string | null;
  nivel?: RiskLevel | null;
  correlationId?: string | null;
  payload?: Prisma.InputJsonValue;
  contentHash?: string | null;
}

/*
 * O RASTRO. Duas propriedades e nada mais:
 *
 *  1. É PRÉ-CONDIÇÃO. A porta grava, faz COMMIT, e só então executa o efeito.
 *     Se o banco recusar o registro, a ação não acontece. Por isso a gravação
 *     vive numa transação curta PRÓPRIA: se o efeito entrasse na mesma
 *     transação, um rollback apagaria o evento e recriaria exatamente o buraco
 *     que a regra fecha.
 *
 *  2. É ENCADEADO. Cada linha carrega o hash da anterior. Um elo quebrado
 *     prova adulteração, e é isso que transforma "tudo fica registrado" de
 *     promessa em verificação.
 *
 * O encadeamento precisa de uma cauda serializada por empresa. A implementação
 * ingênua (lê o último hash, insere) BIFURCA em silêncio com dois escritores
 * simultâneos — e a cadeia existe justamente para provar que nada sumiu. Daí o
 * advisory lock por org, que solta no commit e não trava outras empresas.
 */
@Injectable()
export class EventLogService {
  private readonly log = new Logger('EventLog');
  private readonly retencaoDias = Number(process.env.RASTRO_RETENCAO_DIAS ?? 1825);

  constructor(private readonly prisma: PrismaService) {}

  async registrar(input: EventoInput): Promise<{ id: string; seq: bigint; hash: string }> {
    return this.prisma.$transaction(async (tx) => {
      // Serializa só os escritores DESTA empresa. hashtext devolve int4; o
      // advisory lock de transação solta sozinho no commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.orgId}))`;

      const ultimo = await tx.eventLog.findFirst({
        where: { orgId: input.orgId },
        orderBy: { seq: 'desc' },
        select: { seq: true, hash: true },
      });

      const seq = (ultimo?.seq ?? 0n) + 1n;
      const prevHash = ultimo?.hash ?? null;
      const ocorreuEm = new Date();
      const hash = this.encadear({ ...input, seq, prevHash, ocorreuEm });

      const linha = await tx.eventLog.create({
        data: {
          orgId: input.orgId,
          seq,
          tipo: input.tipo,
          actorType: input.actorType ?? ActorType.ai,
          actorId: input.actorId ?? null,
          agentSlug: input.agentSlug ?? null,
          capabilityId: input.capabilityId ?? null,
          toolCallId: input.toolCallId ?? null,
          decisionId: input.decisionId ?? null,
          nivel: input.nivel ?? null,
          correlationId: input.correlationId ?? null,
          payload: input.payload,
          contentHash: input.contentHash ?? null,
          prevHash,
          hash,
          ocorreuEm,
          retencaoAte: new Date(ocorreuEm.getTime() + this.retencaoDias * 86_400_000),
        },
        select: { id: true, seq: true, hash: true },
      });
      return linha;
    });
  }

  private encadear(e: {
    orgId: string;
    seq: bigint;
    tipo: string;
    prevHash: string | null;
    ocorreuEm: Date;
    capabilityId?: string | null;
    contentHash?: string | null;
    payload?: unknown;
  }): string {
    // O payload entra pelo JSON estável: chave fora de ordem não pode mudar o
    // hash, senão a verificação acusa adulteração onde não houve.
    const corpo = JSON.stringify(e.payload ?? null, Object.keys((e.payload as object) ?? {}).sort());
    return createHash('sha256')
      .update(
        [
          e.prevHash ?? '',
          e.orgId,
          e.seq.toString(),
          e.tipo,
          e.capabilityId ?? '',
          e.contentHash ?? '',
          e.ocorreuEm.toISOString(),
          corpo,
        ].join('|'),
      )
      .digest('hex');
  }

  /**
   * Percorre a cadeia e devolve o primeiro elo quebrado. É isto que transforma
   * "cadeia íntegra" de enfeite de tela em afirmação verificável.
   */
  async verificar(
    orgId: string,
    limite = 5000,
  ): Promise<{ ok: boolean; verificados: number; quebrouEm?: { seq: string; motivo: string } }> {
    const linhas = await this.prisma.eventLog.findMany({
      where: { orgId },
      orderBy: { seq: 'asc' },
      take: limite,
      select: {
        seq: true,
        tipo: true,
        prevHash: true,
        hash: true,
        ocorreuEm: true,
        capabilityId: true,
        contentHash: true,
        payload: true,
      },
    });

    let anterior: string | null = null;
    let esperado = 1n;
    for (const l of linhas) {
      if (l.seq !== esperado) {
        return {
          ok: false,
          verificados: Number(esperado - 1n),
          quebrouEm: { seq: l.seq.toString(), motivo: `sequência pulou de ${esperado} para ${l.seq}` },
        };
      }
      if (l.prevHash !== anterior) {
        return {
          ok: false,
          verificados: Number(esperado - 1n),
          quebrouEm: { seq: l.seq.toString(), motivo: 'prevHash não casa com o hash anterior' },
        };
      }
      const recalculado = this.encadear({
        orgId,
        seq: l.seq,
        tipo: l.tipo,
        prevHash: l.prevHash,
        ocorreuEm: l.ocorreuEm,
        capabilityId: l.capabilityId,
        contentHash: l.contentHash,
        payload: l.payload,
      });
      if (recalculado !== l.hash) {
        return {
          ok: false,
          verificados: Number(esperado - 1n),
          quebrouEm: { seq: l.seq.toString(), motivo: 'conteúdo não bate com o hash gravado' },
        };
      }
      anterior = l.hash;
      esperado += 1n;
    }

    return { ok: true, verificados: linhas.length };
  }
}
