import { BadRequestException, CanActivate, ConflictException, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import {
  ComercialMoverSchema,
  type ComercialEtapa,
  type ComercialMoverInput,
  type ComercialResultadoDoMover,
} from '@mktos/shared';

import { temPapelDeMaquina } from '../approvals/alcada';
import { lerAprovador } from '../auth/aprovador';
import type { JwtUser } from '../auth/current-user.decorator';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { PrismaService } from '../prisma/prisma.service';
import { FichaService } from './ficha.service';

/*
 * MOVER O CARTÃO PELA TELA, SEM LIMITAÇÃO (rodada da interface U4, 20/10/2026).
 *
 * DECISÃO DO DONO DO PRODUTO (20/10/2026): uma PESSOA com `leads.editar` move
 * o lead para QUALQUER etapa, por arrasto ou pelo menu: para a frente, para
 * trás, para as etapas de sistema (contrato, negócio fechado), de volta de uma
 * saída, de e para a geladeira. Sem pedido, sem assinatura de outra pessoa,
 * sem token. A tela diz só a mensagem ("Movido para…", e "sem as conclusões
 * de…" quando a etapa de origem tinha portão em aberto).
 *
 * Antes (rodada do painel P5, 18/10) o mover pedia a assinatura de outra pessoa
 * pelo `ApprovalGuard`, como o `PATCH /leads/:id`. O pedido saiu deste caminho;
 * o `PATCH /leads/:id` com `status` continua com a proteção dele.
 *
 * PESSOA ≠ AGENTE, como sempre. Conta de máquina é recusada no token
 * (`SoGenteGuard`) e no banco (`exigirGente`), e a permissão é relida no banco
 * (quem perdeu `leads.editar` não move até o token vencer). O agente não tem
 * caminho aqui: as reações e o relógio seguem em `mudarEtapa` SEM `pessoa`, e
 * o portão recusa como sempre. A liberdade mora só no ramo `pessoa`.
 *
 * O QUE O MOVER À MÃO NÃO FAZ: nenhuma escrita automática do fechamento ou do
 * contrato (cobrança, contrato, card da implantação, cliente, trilho, grupo).
 * Essas nascem de FATOS (`proposta.aceita`, `pix.pago`, `contrato.assinado_*`,
 * `cliente.ativo`), nunca da etapa; mover para "negócio fechado" à mão é só a
 * etapa, com o fato `etapa.movida_a_mao` no fio, a linha na auditoria e o
 * aviso no cartão.
 *
 * QUEM ESCREVE A ETAPA continua sendo `mudarEtapa` (etapa, `Lead.status`,
 * `etapa.mudou`, `etapa.movida_a_mao`, a auditoria e, na saída, `saida.registrada`,
 * numa transação só).
 */

const RECUSA_DE_MAQUINA = 'Mover cartão é de gente: conta de serviço (IA) não muda etapa pela tela. O agente segue os portões.';

/** O texto do pedido aposentado: o mover não pede mais assinatura. */
export const PEDIDO_DE_MOVER_APOSENTADO =
  'O pedido de mover foi aposentado em 20/10/2026: a pessoa com leads.editar move direto no funil (POST /comercial/lead/:id/mover), sem assinatura de outra pessoa.';

/** Recusa conta de máquina pelo token, antes de qualquer leitura. */
@Injectable()
export class SoGenteGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user?.sub || temPapelDeMaquina(user.roles ?? [])) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    return true;
  }
}

@Injectable()
export class MoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fichas: FichaService,
  ) {}

  /** Gente de verdade, relida no banco: ativa, desta empresa, sem papel de máquina e com `leads.editar` agora. */
  private async exigirGente(orgId: string, quem: { id: string; papeis: readonly string[] }): Promise<{ nome: string | null }> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem move precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    await exigirAcessoAtual(this.prisma, orgId, quem.id, ['leads.editar']);
    const u = await this.prisma.user.findFirst({ where: { id: quem.id, orgId }, select: { name: true } });
    return { nome: u?.name ?? null };
  }

  private corpo(corpo: unknown): ComercialMoverInput {
    const r = ComercialMoverSchema.safeParse(corpo);
    if (!r.success) {
      throw new BadRequestException({ message: 'Destino inválido.', erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    return r.data;
  }

  /**
   * MOVER. Grava direto, por `mudarEtapa` com `pessoa`. A mesma mudança
   * repetida (mesma etapa de origem, mesmo instante de entrada nela) cai nos
   * mesmos fatos; chegar à etapa em que o lead já está não muda nada.
   */
  async mover(orgId: string, leadId: string, corpo: unknown, quem: { id: string; nome: string | null; papeis: readonly string[] }): Promise<ComercialResultadoDoMover> {
    const entrada = this.corpo(corpo);
    const gente = await this.exigirGente(orgId, quem);
    const pessoa = { id: quem.id, nome: gente.nome ?? quem.nome };
    const r = await this.fichas.moverAMao(orgId, leadId, entrada, pessoa);
    if (!r.ok) throw new ConflictException({ message: 'Não deu para mover.', faltando: r.faltando });
    const balao = (await this.fichas.baloes(orgId, [leadId])).get(leadId) ?? null;
    return {
      ok: true,
      mudou: r.mudou,
      de: r.de,
      para: (r.para ?? entrada.para) as ComercialEtapa,
      balao,
      pendencias: r.pendencias ?? [],
      semConclusoesDe: r.semConclusoesDe ?? [],
      mensagem: r.mensagem ?? '',
      aviso: r.aviso ?? null,
    };
  }
}
