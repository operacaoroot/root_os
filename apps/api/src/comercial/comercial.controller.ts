import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { COMERCIAL_ESTADOS_DE_DECISAO, ComercialDecisaoRespostaSchema, type ComercialEstadoDeDecisao } from '@mktos/shared';

import { ApprovalGuard } from '../approvals/approval.guard';
import { SensitiveWrite } from '../approvals/sensitive-write.decorator';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ConfigComercialService } from './config.service';
import { DecisoesService } from './decisoes.service';
import { FichaService } from './ficha.service';
import { MoverService, SoGenteGuard } from './mover.service';
import { RelogioDaEspinha } from './relogio-da-espinha';

/*
 * A ESPINHA DO COCKPIT — rotas internas do módulo comercial (lane A).
 *
 * Permissões: `leads.ver` lê, `leads.editar` escreve; responder decisão pede
 * também `aprovacoes.decidir` (é a fila de quem decide, como `/atendimento`).
 * A etapa NUNCA se escreve por aqui: não há PATCH de etapa. Quem move é a
 * reação a um evento, e o portão recusa com a lista do que falta. A saída é um
 * FATO com motivo (`saida.registrada`), conferido por `podeSair` antes de entrar
 * no fio. A exceção, desde a rodada do painel (P5, 18/10/2026), é a PESSOA que
 * move o cartão adiante: pedido → assinatura de OUTRA pessoa → mover com o
 * token, com a mesma proteção do `PATCH /leads/:id` (ver `mover.service.ts`).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class ComercialController {
  constructor(
    private readonly fichas: FichaService,
    private readonly decisoesSvc: DecisoesService,
    private readonly configSvc: ConfigComercialService,
    private readonly relogio: RelogioDaEspinha,
    private readonly moverSvc: MoverService,
  ) {}

  /** Tela 03: a fila de decisões, o que rodou sozinho hoje e os contadores. */
  @Get('fila')
  @RequirePermissions('leads.ver')
  fila(@CurrentUser() user: JwtUser) {
    return this.decisoesSvc.fila(user.orgId);
  }

  /** Tela 04: o funil vivo, com as saídas visíveis. Filtro: todos, parados, decisao, P1/P2/P3 ou produto. */
  @Get('funil')
  @RequirePermissions('leads.ver')
  funil(@CurrentUser() user: JwtUser, @Query('filtro') filtro?: string) {
    return this.fichas.funil(user.orgId, filtro ?? null);
  }

  /** Tela 05: a ficha do lead — projeção do fio, com o portão da próxima etapa. */
  @Get('lead/:id')
  @RequirePermissions('leads.ver')
  ficha(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.fichas.projecao(user.orgId, id);
  }

  /** O fio cru (as linhas) — para a tela 05 e para a suíte. */
  @Get('lead/:id/fio')
  @RequirePermissions('leads.ver')
  async fio(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    const f = await this.fichas.projecao(user.orgId, id);
    return { leadId: id, fio: f.fio };
  }

  /** E1: o lead entra pelo WhatsApp (simulador ou provedor). Idempotente pelo telefone e pela mensagem. */
  @Post('entrada/whats')
  @RequirePermissions('leads.editar')
  async entradaWhats(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    await this.relogio.garantirRotina(user.orgId);
    return this.fichas.entrarPeloWhats(user.orgId, body);
  }

  /** E4: a ata da sessão chega. Só o hash vai para o fio; quem sobe a ata é o sócio da conta. */
  @Post('lead/:id/ata')
  @RequirePermissions('leads.editar')
  ata(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.fichas.registrarAta(user.orgId, id, body, { id: user.sub, nome: user.name });
  }

  /** Saída com motivo e dono (desqualificado, geladeira, perdido, parceiro). */
  @Post('lead/:id/saida')
  @RequirePermissions('leads.editar')
  saida(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.fichas.registrarSaida(user.orgId, id, body, { id: user.sub, nome: user.name });
  }

  /**
   * P5 · o PEDIDO de mover o cartão: confere o destino, diz o que fica pendente
   * e cria a aprovação retida do recurso `lead` (outra pessoa assina em
   * /atendimento). Não muda nada. Só gente: conta de máquina é recusada.
   */
  @Post('lead/:id/mover/pedido')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  pedirMover(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.moverSvc.pedir(user.orgId, id, body, { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [] });
  }

  /**
   * Revisão PA-7 · em que pé está o MEU pedido de mover este lead (esperando,
   * confirmada, usada, recusada, venceu), para o cartão acender "concluir a
   * mudança" quando a assinatura chega. Só leitura e só o pedido de quem
   * pergunta; o token nunca sai do servidor por aqui.
   */
  @Get('lead/:id/mover/pedido')
  @RequirePermissions('leads.ver')
  async estadoDoPedido(@CurrentUser() user: JwtUser, @Param('id') id: string, @Query('aprovacao') aprovacao?: string) {
    return { pedido: await this.moverSvc.estadoDoPedido(user.orgId, id, user.sub, aprovacao || undefined) };
  }

  /**
   * P5 · MOVER, com a mesma proteção da mudança manual de etapa que já existia
   * (`PATCH /leads/:id`): `leads.editar` + escrita sensível do recurso `lead` +
   * `x-approval-token` confirmado por outra pessoa, preso ao `para`. O
   * `SoGenteGuard` vem ANTES do `ApprovalGuard`: conta de máquina é recusada sem
   * queimar a aprovação. Com pendência de portão, executa e grava o aviso.
   */
  @Post('lead/:id/mover')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @SensitiveWrite('lead')
  @UseGuards(SoGenteGuard, ApprovalGuard)
  mover(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown, @Headers('x-approval-token') token: string) {
    return this.moverSvc.mover(user.orgId, id, body, { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [] }, token);
  }

  /** A fila de decisões (abertas, tomadas, expiradas). */
  @Get('decisoes')
  @RequirePermissions('leads.ver')
  decisoes(@CurrentUser() user: JwtUser, @Query('estado') estado?: string) {
    if (estado && !(COMERCIAL_ESTADOS_DE_DECISAO as readonly string[]).includes(estado)) {
      throw new BadRequestException(`Estado desconhecido: ${estado}. Use ${COMERCIAL_ESTADOS_DE_DECISAO.join(', ')}.`);
    }
    return this.decisoesSvc.listar(user.orgId, estado as ComercialEstadoDeDecisao | undefined);
  }

  /** Um toque: responde a decisão pela tela. */
  @Post('decisoes/:id/responder')
  @RequirePermissions('leads.editar', 'aprovacoes.decidir')
  responder(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const r = ComercialDecisaoRespostaSchema.safeParse(body);
    if (!r.success) throw new BadRequestException({ message: 'Resposta inválida.', erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return this.decisoesSvc.responder(user.orgId, id, r.data.escolha, { id: user.sub, nome: user.name }, 'tela', r.data.motivo ?? null);
  }

  /** Os interruptores e a régua por empresa (K08). Sem linha gravada, os padrões da regra vigente. */
  @Get('config')
  @RequirePermissions('leads.ver')
  config(@CurrentUser() user: JwtUser) {
    return this.configSvc.ler(user.orgId);
  }

  /**
   * Os interruptores da mesa (K08) e a autonomia são decisão de mesa (A-1): pede
   * `aprovacoes.decidir`, recusa conta de máquina e grava no RASTRO.
   */
  @Put('config')
  @RequirePermissions('aprovacoes.decidir')
  salvarConfig(@CurrentUser() user: JwtUser, @Body() body: unknown, @Ip() ip?: string) {
    return this.configSvc.gravar(user.orgId, body, { id: user.sub, papeis: user.roles ?? [], ip });
  }
}
