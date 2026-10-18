import { createHash } from 'node:crypto';

import { BadRequestException, CanActivate, ConflictException, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import {
  COMERCIAL_ROTULO_DA_ETAPA,
  ComercialMoverSchema,
  destinoDoMover,
  type ComercialEtapa,
  type ComercialEtapaAtiva,
  type ComercialPedidoDeMover,
  type ComercialResultadoDoMover,
} from '@mktos/shared';

import { ActorType } from '@prisma/client';

import { temPapelDeMaquina } from '../approvals/alcada';
import { ApprovalsService } from '../approvals/approvals.service';
import { lerAprovador } from '../auth/aprovador';
import type { JwtUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { FichaService } from './ficha.service';
import { pendenciasDoMover } from './portoes';

/*
 * MOVER O CARTÃO PELA TELA (rodada do painel P5, 18/10/2026).
 *
 * A RÉGUA NÃO AFROUXA. A mudança manual de etapa que já existia é o
 * `PATCH /leads/:id` com `status`: `leads.editar` + `@SensitiveWrite('lead')`
 * + `ApprovalGuard` — um `x-approval-token` de uso único, CONFIRMADO por OUTRA
 * pessoa com alçada, preso ao recurso e ao conteúdo exato da mudança (justificativa
 * E26 do CLAUDE.md: a etapa e a próxima ação são o que a régua protege). O mover
 * tem a MESMA proteção: o pedido cria a aprovação legada do recurso `lead`
 * (a chave `para` entra no hash, ver `ALLOWED_KEYS`), outra pessoa confirma em
 * /atendimento, e a rota de mover consome o token pelo mesmo `ApprovalGuard`.
 *
 * PESSOA ≠ AGENTE. O aviso no lugar da trava vale só para gente: conta de
 * máquina (`ia_servico`, `ia_acao`) é recusada no token E no banco, antes de
 * consumir qualquer aprovação. O agente não tem caminho aqui; as reações seguem
 * em `mudarEtapa` sem `pessoa`, e o portão recusa como sempre.
 *
 * O QUE ESTE SERVIÇO NÃO FAZ: escrever etapa. Quem escreve é `mudarEtapa`, o
 * único caminho (etapa, `Lead.status`, `etapa.mudou` e, com pendência,
 * `etapa.movida_com_pendencia`, numa transação só).
 */

const RECUSA_DE_MAQUINA = 'Mover cartão é de gente: conta de serviço (IA) não muda etapa pela tela. O agente segue os portões.';

/** Recusa conta de máquina pelo token, ANTES do `ApprovalGuard` consumir a aprovação. */
@Injectable()
export class SoGenteGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user?.sub || temPapelDeMaquina(user.roles ?? [])) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    return true;
  }
}

/** A chave do fato: o resumo do token de uso único (nunca o token). O mesmo pedido cai no mesmo fato. */
export function chaveDoMover(token: string): string {
  return `mover:${createHash('sha256').update(token).digest('hex').slice(0, 24)}`;
}

@Injectable()
export class MoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fichas: FichaService,
    private readonly approvals: ApprovalsService,
  ) {}

  /** Gente de verdade, relida no banco: ativa, desta empresa e sem papel de máquina. */
  private async exigirGente(orgId: string, quem: { id: string; papeis: readonly string[] }): Promise<void> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem move precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
  }

  private destino(corpo: unknown): ComercialEtapaAtiva {
    const r = ComercialMoverSchema.safeParse(corpo);
    if (!r.success) {
      throw new BadRequestException({ message: 'Destino inválido. Saída vai por /saida, com motivo.', erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    return r.data.para;
  }

  /**
   * O PEDIDO. Confere que gente pode mover para lá e diz o que fica pendente;
   * cria a aprovação retida (outra pessoa assina em /atendimento). Não muda nada.
   */
  async pedir(orgId: string, leadId: string, corpo: unknown, quem: { id: string; nome: string | null; papeis: readonly string[] }): Promise<ComercialPedidoDeMover> {
    const para = this.destino(corpo);
    await this.exigirGente(orgId, quem);
    const { ficha, estado } = await this.fichas.estado(orgId, leadId);
    const de = ficha.etapa as ComercialEtapa;
    const d = destinoDoMover(de, para, (ficha.etapaAntesDaSaida as ComercialEtapaAtiva | null) ?? null);
    if (!d.permitido || d.caminho !== 'mover') throw new ConflictException({ message: 'Mover recusado.', faltando: [d.motivo ?? 'saída vai pelo registro de saída, com motivo'] });
    const { pendencias } = pendenciasDoMover(estado, de, para);
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { name: true } });
    const quemNome = ficha.empresa ?? lead?.name ?? leadId;
    const resumo = `Mover ${quemNome} de ${COMERCIAL_ROTULO_DA_ETAPA[de]} para ${COMERCIAL_ROTULO_DA_ETAPA[para]}${pendencias.length ? ` com pendências: ${pendencias.join('; ')}` : ' (portões cumpridos)'}. Pedido por ${quem.nome ?? 'pessoa da mesa'} pela tela do funil.`;
    const t = await this.approvals.create({ orgId, actorId: quem.id, resourceType: 'lead', resourceId: leadId, changes: { para }, summary: resumo.slice(0, 900), propostoPorTipo: ActorType.user });
    return { approvalId: t.approvalId, token: t.token, expiraEm: t.expiresAt, de, para, pendencias, resumo: t.summary };
  }

  /**
   * A MUDANÇA, depois que o `ApprovalGuard` consumiu o token confirmado. Executa
   * por `mudarEtapa` com `pessoa`: com pendência, muda e grava o aviso.
   */
  async mover(orgId: string, leadId: string, corpo: unknown, quem: { id: string; nome: string | null; papeis: readonly string[] }, token: string): Promise<ComercialResultadoDoMover> {
    const para = this.destino(corpo);
    await this.exigirGente(orgId, quem);
    const r = await this.fichas.mudarEtapa(orgId, leadId, para, {
      motivo: `movido à mão por ${quem.nome ?? 'pessoa da mesa'} pela tela do funil`,
      eventoGatilho: chaveDoMover(token),
      pessoa: { id: quem.id, nome: quem.nome },
    });
    if (!r.ok) throw new ConflictException({ message: 'Mover recusado.', faltando: r.faltando });
    const balao = (await this.fichas.baloes(orgId, [leadId])).get(leadId) ?? null;
    return { ok: true, mudou: r.mudou, de: r.de, para: r.para ?? para, balao };
  }
}
