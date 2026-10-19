import { Body, Controller, Get, Headers, HttpCode, Ip, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ActorType } from '@prisma/client';

import { ContratoEncerrarSchema } from '@mktos/shared';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ContratoVivoService } from './contrato-vivo.service';
import { DinheiroService } from './dinheiro.service';
import { FechamentoService } from './fechamento.service';

/*
 * DINHEIRO, ASSINATURA, FECHAMENTO E CONTRATO VIVO (lane D, 13/10/2026).
 *
 * Duas superfícies no mesmo prefixo `comercial`:
 *   · as internas (fechamento e contrato vivo), com sessão e permissão;
 *   · os WEBHOOKS dos provedores (`/comercial/webhooks/asaas|zapsign`), sem
 *     sessão e conferidos por segredo no cabeçalho (no conector, em tempo
 *     constante; sem segredo configurado, tudo é recusado). É por eles que o
 *     Pix pago e o contrato assinado entram no fio. A empresa é achada pela
 *     linha (`ComercialCobranca`/`ComercialDocumento`) sob a sentinela pública.
 *
 * Nenhuma rota escreve no provedor: as escritas são EFEITOS de capacidades da
 * régua (`comercial.cobranca.criar`, `comercial.contrato.enviar`,
 * `comercial.fechamento.executar`, todas R4), que a porta dispara depois da
 * assinatura da titular. As rotas que "rodam de novo" só PROPÕEM à porta, em
 * nome de quem clicou; essa pessoa não pode assinar a própria proposta.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class DinheiroController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dinheiro: DinheiroService,
    private readonly fechamentos: FechamentoService,
    private readonly contratos: ContratoVivoService,
  ) {}

  /** Tela 10: o fechamento do lead, escrita a escrita. */
  @Get('fechamentos/:leadId')
  @RequirePermissions('leads.ver')
  fechamento(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string) {
    return this.fechamentos.doLead(user.orgId, leadId);
  }

  /** Propõe (de novo) o fechamento à porta. A chave impede duplicar; R4 espera a titular. */
  @Post('fechamentos/:leadId/rodar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  async rodarFechamento(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string, @Body() _body: unknown) {
    await this.exigirLead(user.orgId, leadId);
    return this.fechamentos.propor(user.orgId, leadId, { id: user.sub, tipo: ActorType.user });
  }

  /** Propõe (de novo) a cobrança e o contrato do aceite, quando a aprovação anterior venceu. */
  @Post('aceites/:leadId/propor')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  async proporAceite(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string) {
    await this.exigirLead(user.orgId, leadId);
    return this.dinheiro.proporAceite(user.orgId, leadId, { id: user.sub, tipo: ActorType.user });
  }

  /**
   * O signatário da Root pede o link para assinar (D-1): só o signatário
   * cadastrado no documento, titular relido no banco, com a senha conferida
   * agora (`{ senha }` no corpo). Nada é escrito no provedor aqui; a assinatura
   * volta pelo webhook.
   */
  @Post('contratos/:leadId/assinar-pela-root')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  async assinarPelaRoot(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string, @Body() body: unknown, @Ip() ip: string) {
    await this.exigirLead(user.orgId, leadId);
    const b = (body ?? {}) as { senha?: unknown };
    const senha = typeof b.senha === 'string' ? b.senha : undefined;
    return this.dinheiro.linkParaAssinarPelaRoot(user.orgId, leadId, { id: user.sub, papeis: user.roles ?? [], ip }, senha);
  }

  /** Tela 11: o contrato vivo, com parcelas, régua de cobrança, entregas, saúde e marcos. */
  @Get('contratos/:leadId')
  @RequirePermissions('leads.ver')
  contratoVivo(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string) {
    return this.contratos.doLead(user.orgId, leadId);
  }

  /**
   * Encerrar à mão (rodada do trabalho T8): concluir ou desativar, com motivo.
   * Escrita interna classificada R0 pela escada; o gate é `leads.editar`.
   */
  @Post('contratos/:leadId/encerrar')
  @RequirePermissions('leads.editar')
  encerrarContrato(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string, @Body() body: unknown) {
    return this.contratos.encerrar(user.orgId, leadId, { id: user.sub, papeis: user.roles ?? [] }, ContratoEncerrarSchema.parse(body ?? {}));
  }

  /** A lista de contratos vivos da empresa. */
  @Get('contratos')
  @RequirePermissions('leads.ver')
  lista(@CurrentUser() user: JwtUser) {
    return this.contratos.lista(user.orgId);
  }

  private async exigirLead(orgId: string, leadId: string): Promise<void> {
    const l = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!l) throw new NotFoundException('Lead não encontrado.');
  }
}

/** Webhooks dos provedores: sem sessão, com segredo no cabeçalho. Token errado = 401. */
@Controller('comercial/webhooks')
export class WebhooksDoDinheiroController {
  constructor(private readonly dinheiro: DinheiroService) {}

  @Post('asaas')
  @HttpCode(200)
  asaas(@Headers('asaas-access-token') token: string | undefined, @Body() corpo: unknown) {
    return this.dinheiro.webhookDoAsaas(token, corpo);
  }

  @Post('zapsign')
  @HttpCode(200)
  zapsign(@Headers('x-zapsign-token') token: string | undefined, @Body() corpo: unknown) {
    return this.dinheiro.webhookDaZapsign(token, corpo);
  }
}
