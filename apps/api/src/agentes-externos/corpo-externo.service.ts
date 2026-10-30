import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { z } from 'zod';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventLogService } from '../gateway/event-log.service';
import { temPapelDeMaquina } from '../approvals/alcada';
import { gerarTokenDeCorpo } from '../auth/corpo-externo';

/*
 * ============================================================================
 * OS CORPOS DE UM AGENTE EXTERNO (A4, 30/10/2026) — criar, listar, revogar
 * ============================================================================
 *
 * Quem cria e revoga é gente com `admin.usuarios` (o freio dos agentes e dos
 * conectores pede a mesma chave), pela API, nunca pelo próprio corpo. O token em
 * claro sai UMA vez, na resposta da criação; depois só existe o hash e o
 * prefixo. Perdeu o token: revoga e cria outro.
 *
 * Criar e revogar entram no RASTRO (`agente.corpo.criado`/`.revogado`) e na
 * auditoria: "quem deu a este processo de fora a voz deste agente, e quando"
 * é pergunta que alguém vai fazer.
 */

export const CriarCorpoSchema = z
  .object({
    /** O nome curto do corpo: `hermes`. */
    corpo: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'use a-z, 0-9 e hífen (até 40)'),
    /** A pessoa padrão (User.id): vale quando o pedido não diz quem pediu. */
    solicitanteId: z.string().uuid(),
  })
  .strict();

export const RevogarCorpoSchema = z.object({ motivo: z.string().trim().min(3).max(500) }).strict();

const COLUNAS_VISIVEIS = {
  id: true,
  corpo: true,
  agentSlug: true,
  solicitanteId: true,
  prefixo: true,
  criadoPorId: true,
  criadoEm: true,
  ultimoUsoEm: true,
  revogadoEm: true,
  revogadoPorId: true,
  motivoRevogacao: true,
} as const;

@Injectable()
export class CorpoExternoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eventos: EventLogService,
  ) {}

  async listar(orgId: string, agentSlug: string) {
    return this.prisma.corpoExterno.findMany({
      where: { orgId, agentSlug },
      orderBy: { criadoEm: 'desc' },
      select: COLUNAS_VISIVEIS,
    });
  }

  async criar(orgId: string, actorId: string, agentSlug: string, corpoBruto: unknown) {
    const e = CriarCorpoSchema.parse(corpoBruto ?? {});
    const agente = await this.prisma.agent.findFirst({ where: { orgId, slug: agentSlug }, select: { id: true } });
    if (!agente) throw new NotFoundException('Agente não encontrado.');
    const pessoa = await this.prisma.user.findFirst({
      where: { id: e.solicitanteId, orgId, isActive: true },
      select: { id: true, roles: { select: { key: true } } },
    });
    if (!pessoa || temPapelDeMaquina(pessoa.roles.map((r) => r.key))) {
      throw new BadRequestException('A pessoa padrão do corpo precisa ser uma pessoa ativa desta empresa.');
    }
    // Um corpo vivo por nome e agente: dois tokens do mesmo "hermes" é um que ninguém lembra de revogar.
    const vivo = await this.prisma.corpoExterno.findFirst({
      where: { orgId, agentSlug, corpo: e.corpo, revogadoEm: null },
      select: { id: true },
    });
    if (vivo) throw new ConflictException(`Já existe o corpo "${e.corpo}" vivo para ${agentSlug}: revogue-o antes de criar outro.`);

    const { token, hash, prefixo } = gerarTokenDeCorpo(orgId);
    const criado = await this.prisma.corpoExterno.create({
      data: { orgId, corpo: e.corpo, agentSlug, solicitanteId: pessoa.id, tokenHash: hash, prefixo, criadoPorId: actorId },
      select: COLUNAS_VISIVEIS,
    });
    await this.audit.log({
      orgId, actorType: ActorType.user, actorId, action: 'agente.corpo.criado', entityType: 'corpo_externo', entityId: criado.id,
      after: { corpo: criado.corpo, agentSlug, solicitanteId: pessoa.id, prefixo },
    });
    await this.eventos.registrar({
      orgId,
      tipo: 'agente.corpo.criado',
      actorType: ActorType.user,
      actorId,
      agentSlug,
      payload: { corpoId: criado.id, corpo: criado.corpo, solicitanteId: pessoa.id, prefixo },
      conteudo: { pergunta: `token do corpo ${criado.corpo} para ${agentSlug}`, motivo: null },
      sensibilidade: 'interna',
    });
    return {
      ...criado,
      /** O token em claro. Só aparece AGORA: guarde no cofre do corpo (o Hermes), não aqui. */
      token,
      aviso: 'Este token não aparece de novo. Guarde-o no corpo; perdeu, revogue e crie outro.',
    };
  }

  async revogar(orgId: string, actorId: string, agentSlug: string, corpoId: string, corpoBruto: unknown) {
    const { motivo } = RevogarCorpoSchema.parse(corpoBruto ?? {});
    const r = await this.prisma.corpoExterno.updateMany({
      where: { id: corpoId, orgId, agentSlug, revogadoEm: null },
      data: { revogadoEm: new Date(), revogadoPorId: actorId, motivoRevogacao: motivo },
    });
    if (r.count !== 1) throw new NotFoundException('Corpo não encontrado ou já revogado.');
    await this.audit.log({
      orgId, actorType: ActorType.user, actorId, action: 'agente.corpo.revogado', entityType: 'corpo_externo', entityId: corpoId,
      after: { agentSlug, motivo },
    });
    await this.eventos.registrar({
      orgId,
      tipo: 'agente.corpo.revogado',
      actorType: ActorType.user,
      actorId,
      agentSlug,
      payload: { corpoId },
      conteudo: { pergunta: `revogar o corpo ${corpoId} de ${agentSlug}`, motivo },
      sensibilidade: 'interna',
    });
    return { ok: true as const, corpoId, revogadoEm: new Date().toISOString() };
  }
}
