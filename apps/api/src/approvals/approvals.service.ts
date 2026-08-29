import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, Alcada, ApprovalState, RiskLevel } from '@prisma/client';
import type { Decisao } from '@mktos/policy';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// Recursos da superfície ANTIGA (as 5 rotas com @SensitiveWrite). A porta usa
// o id da capacidade como resourceType, então esta lista não a limita.
export type ResourceType = 'lead' | 'task' | 'campaign' | 'content';

// Chaves que entram no hash de cada recurso legado. Para as capacidades novas,
// quem manda são as hashKeys do catálogo.
const ALLOWED_KEYS: Record<ResourceType, string[]> = {
  lead: ['status', 'nextAction'],
  task: ['status'],
  campaign: ['status'],
  content: ['status'],
};

export function isResourceType(v: unknown): v is ResourceType {
  return typeof v === 'string' && v in ALLOWED_KEYS;
}

/**
 * Normaliza o corpo da mutação e devolve um hash estável — o bind da aprovação
 * à mudança exata.
 *
 * `chaves` vazio significa O CORPO INTEIRO, e isso é falha fechada de propósito:
 * capacidade que esqueceu de declarar hashKeys prende a aprovação a tudo, o que
 * é estrito, não frouxo.
 */
export function canonicalHash(
  escopo: string,
  body: Record<string, unknown>,
  chaves?: string[],
): string {
  const usar = chaves && chaves.length > 0 ? chaves : Object.keys(body ?? {});
  const norm: Record<string, unknown> = {};
  for (const k of usar.slice().sort()) {
    const val = body?.[k];
    if (val !== undefined && val !== null) norm[k] = val;
  }
  const stable = JSON.stringify(norm, Object.keys(norm).sort());
  return createHash('sha256').update(`${escopo}:${stable}`).digest('hex');
}

const hashDoToken = (t: string) => createHash('sha256').update(t).digest('hex');

/*
 * A fila de aprovação, em TABELA.
 *
 * Saiu do Map em memória por dois motivos, e o segundo é o que mordia:
 *
 *  1. Restart da API perdia toda pendência. Com a fila virando superfície de
 *     trabalho — alguém vê a notificação e volta dez minutos depois — isso
 *     deixa de ser aceitável.
 *  2. No Map o uso único era seguro POR ACIDENTE: um processo, JS
 *     single-threaded. Em tabela, duas requisições simultâneas leem
 *     'confirmada' e ambas consomem — e a mensagem sai duas vezes. Quem impede
 *     é o updateMany condicional em `consumir`, não um if.
 *
 * O token cru é devolvido UMA vez e nunca persistido: guardamos só o sha256.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- proposta

  /** Usada pela porta. Prende a aprovação ao conteúdo exato da capacidade. */
  async propor(input: {
    orgId: string;
    propostoPorId: string;
    propostoPorTipo: ActorType;
    capabilityId: string | null;
    decisionId?: string | null;
    toolCallId?: string | null;
    resourceType: string;
    resourceId: string;
    args: Record<string, unknown>;
    hashKeys: string[];
    decisao: Decisao;
    canal?: string;
    resumo?: string;
  }): Promise<{ approvalId: string; token: string; resumo: string; expiraEm: string }> {
    const token = randomBytes(24).toString('base64url');
    const resumo = input.resumo ?? `${input.resourceType} ${input.resourceId}`;
    // A validade encurta conforme o risco sobe — 900s em R2/R3, 600 em R4,
    // 300 em R5. Vem da própria decisão, não de uma constante.
    const expiraEm = new Date(Date.now() + input.decisao.aprovacao.validadeSegundos * 1000);

    const linha = await this.prisma.approval.create({
      data: {
        orgId: input.orgId,
        decisionId: input.decisionId ?? null,
        toolCallId: input.toolCallId ?? null,
        capabilityId: input.capabilityId,
        propostoPorId: input.propostoPorId,
        propostoPorTipo: input.propostoPorTipo,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        contentHash: canonicalHash(input.resourceType, input.args ?? {}, input.hashKeys),
        resumo,
        nivelExigido: input.decisao.nivel as RiskLevel,
        alcadaMinima: input.decisao.aprovacao.alcadaMinima as Alcada,
        exigeReauth: input.decisao.exigeReautenticacao,
        canal: input.canal ?? null,
        tokenHash: hashDoToken(token),
        expiraEm,
      },
      select: { id: true },
    });

    await this.audit.log({
      orgId: input.orgId,
      actorType: input.propostoPorTipo,
      actorId: input.propostoPorId,
      action: 'approval.propose',
      entityType: input.resourceType,
      entityId: input.resourceId,
      after: { approvalId: linha.id, resumo, nivel: input.decisao.nivel },
    });

    return { approvalId: linha.id, token, resumo, expiraEm: expiraEm.toISOString() };
  }

  /** Superfície antiga: as 5 rotas com @SensitiveWrite. */
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

    const token = randomBytes(24).toString('base64url');
    const summary = input.summary ?? `${input.resourceType} ${input.resourceId}`;
    const expiraEm = new Date(Date.now() + 10 * 60 * 1000);

    const linha = await this.prisma.approval.create({
      data: {
        orgId: input.orgId,
        capabilityId: null,
        propostoPorId: input.actorId,
        propostoPorTipo: ActorType.ai,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        contentHash: canonicalHash(
          input.resourceType,
          input.changes ?? {},
          ALLOWED_KEYS[input.resourceType],
        ),
        resumo: summary,
        tokenHash: hashDoToken(token),
        expiraEm,
      },
      select: { id: true },
    });

    await this.audit.log({
      orgId: input.orgId,
      actorType: ActorType.ai,
      actorId: input.actorId,
      action: 'approval.propose',
      entityType: input.resourceType,
      entityId: input.resourceId,
      after: { approvalId: linha.id, summary },
    });

    return {
      approvalId: linha.id,
      token,
      summary,
      expiresAt: expiraEm.toISOString(),
    };
  }

  // ------------------------------------------------------- decisão do humano

  async confirm(
    orgId: string,
    id: string,
    actorId: string,
  ): Promise<{ ok: true; resourceType: string; resourceId: string; summary: string }> {
    const rec = await this.prisma.approval.findFirst({ where: { id, orgId } });
    if (!rec) throw new NotFoundException('Aprovação não encontrada');
    if (rec.expiraEm < new Date()) {
      await this.prisma.approval.updateMany({
        where: { id, status: ApprovalState.pendente },
        data: { status: ApprovalState.expirada },
      });
      throw new BadRequestException('Aprovação expirada');
    }
    if (rec.status !== ApprovalState.pendente) {
      throw new BadRequestException(`Aprovação já ${rec.status}`);
    }
    // Invariante 7 da escada: quem aprova é gente, e nunca quem propôs.
    if (rec.propostoPorId === actorId) {
      throw new ForbiddenException('Quem propôs a ação não pode aprová-la.');
    }

    const { count } = await this.prisma.approval.updateMany({
      where: { id, orgId, status: ApprovalState.pendente },
      data: {
        status: ApprovalState.confirmada,
        aprovadoPorId: actorId,
        aprovadoEm: new Date(),
        ...(rec.exigeReauth ? { reautenticadoEm: new Date() } : {}),
      },
    });
    if (count !== 1) throw new BadRequestException('Aprovação já decidida por outro caminho');

    await this.audit.log({
      orgId,
      actorType: ActorType.user,
      actorId,
      action: 'approval.confirm',
      entityType: rec.resourceType,
      entityId: rec.resourceId,
      after: { approvalId: id, summary: rec.resumo },
    });
    return { ok: true, resourceType: rec.resourceType, resourceId: rec.resourceId, summary: rec.resumo };
  }

  async reject(orgId: string, id: string, actorId: string): Promise<{ ok: true }> {
    const rec = await this.prisma.approval.findFirst({ where: { id, orgId } });
    if (!rec) throw new NotFoundException('Aprovação não encontrada');
    await this.prisma.approval.updateMany({
      where: { id, orgId, status: { in: [ApprovalState.pendente, ApprovalState.confirmada] } },
      data: { status: ApprovalState.rejeitada },
    });
    await this.audit.log({
      orgId,
      actorType: ActorType.user,
      actorId,
      action: 'approval.reject',
      entityType: rec.resourceType,
      entityId: rec.resourceId,
      after: { approvalId: id },
    });
    return { ok: true };
  }

  async get(orgId: string, id: string) {
    const rec = await this.prisma.approval.findFirst({ where: { id, orgId } });
    if (!rec) throw new NotFoundException('Aprovação não encontrada');
    return {
      id: rec.id,
      status: rec.status,
      summary: rec.resumo,
      expiresAt: rec.expiraEm.toISOString(),
    };
  }

  /** A FILA. É a superfície de trabalho do Atendimento e do Console. */
  async listar(orgId: string, status: ApprovalState = ApprovalState.pendente) {
    const agora = new Date();
    const linhas = await this.prisma.approval.findMany({
      where: { orgId, status, ...(status === ApprovalState.pendente ? { expiraEm: { gt: agora } } : {}) },
      orderBy: { criadoEm: 'asc' },
      take: 200,
    });
    return {
      items: linhas.map((a) => ({
        id: a.id,
        resumo: a.resumo,
        nivel: a.nivelExigido,
        capacidade: a.capabilityId,
        recurso: { tipo: a.resourceType, id: a.resourceId },
        exigeReauth: a.exigeReauth,
        alcadaMinima: a.alcadaMinima,
        propostaEm: a.criadoEm.toISOString(),
        expiraEm: a.expiraEm.toISOString(),
        // Tempo de espera é o que faz a fila ser uma fila e não uma lista.
        esperandoMs: agora.getTime() - a.criadoEm.getTime(),
      })),
      total: linhas.length,
    };
  }

  // -------------------------------------------------------------- o consumo

  /**
   * O uso único de verdade. `updateMany` condicional em vez de ler-e-escrever:
   * duas requisições simultâneas com o mesmo token dão exatamente UM sucesso.
   */
  private async consumirToken(orgId: string, token: string): Promise<{
    id: string;
    resourceType: string;
    resourceId: string;
    contentHash: string;
    resumo: string;
    aprovadoPorId: string | null;
    propostoPorId: string;
  }> {
    const rec = await this.prisma.approval.findUnique({
      where: { tokenHash: hashDoToken(token) },
    });
    if (!rec || rec.orgId !== orgId) throw new ForbiddenException('Token de aprovação inválido.');
    if (rec.expiraEm < new Date()) throw new ForbiddenException('Aprovação expirada.');
    if (rec.status === ApprovalState.consumida) {
      throw new ForbiddenException('Aprovação já utilizada (uso único).');
    }
    if (rec.status !== ApprovalState.confirmada) {
      throw new ForbiddenException('Aprovação não confirmada pelo humano.');
    }

    const { count } = await this.prisma.approval.updateMany({
      where: { id: rec.id, status: ApprovalState.confirmada, expiraEm: { gt: new Date() } },
      data: { status: ApprovalState.consumida, consumidoEm: new Date() },
    });
    if (count !== 1) throw new ForbiddenException('Aprovação já utilizada (uso único).');
    return rec;
  }

  /** Usada pela porta. */
  async consumir(input: {
    orgId: string;
    token: string;
    resourceType: string;
    resourceId: string;
    args: Record<string, unknown>;
    hashKeys: string[];
    actorId: string;
  }): Promise<void> {
    const rec = await this.consumirToken(input.orgId, input.token);
    if (rec.resourceType !== input.resourceType || rec.resourceId !== input.resourceId) {
      throw new ForbiddenException('Aprovação não corresponde ao recurso desta ação.');
    }
    if (rec.contentHash !== canonicalHash(input.resourceType, input.args ?? {}, input.hashKeys)) {
      throw new ForbiddenException('A mudança difere do que foi aprovado.');
    }
    await this.audit.log({
      orgId: input.orgId,
      actorType: ActorType.ai,
      actorId: input.actorId,
      action: 'approval.consume',
      entityType: rec.resourceType,
      entityId: rec.resourceId,
      after: { approvalId: rec.id, resumo: rec.resumo },
    });
  }

  /** Gate da escrita nas 5 rotas antigas. Comportamento idêntico ao de antes. */
  async consumeForWrite(input: {
    orgId: string;
    token: string | undefined;
    resourceType: ResourceType;
    resourceId: string;
    body: Record<string, unknown>;
    actorId: string;
  }): Promise<void> {
    if (!input.token) {
      throw new ForbiddenException(
        'Ação sensível requer aprovação humana confirmada (x-approval-token ausente).',
      );
    }
    await this.consumir({
      orgId: input.orgId,
      token: input.token,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      args: input.body ?? {},
      hashKeys: ALLOWED_KEYS[input.resourceType],
      actorId: input.actorId,
    });
  }

  /** Marca expiradas. Chamado pelo agendador — não é mais um setInterval solto. */
  async expirarVencidas(): Promise<number> {
    const { count } = await this.prisma.approval.updateMany({
      where: { status: ApprovalState.pendente, expiraEm: { lt: new Date() } },
      data: { status: ApprovalState.expirada },
    });
    return count;
  }
}
