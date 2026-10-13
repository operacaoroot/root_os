import { Body, Controller, Get, Headers, HttpCode, NotImplementedException, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';

/*
 * DINHEIRO, ASSINATURA, FECHAMENTO E CONTRATO VIVO — Lane 0 → Lane D.
 *
 * Duas superfícies no mesmo prefixo `comercial`:
 *   · as internas (fechamento e contrato vivo), com sessão e permissão;
 *   · os WEBHOOKS dos provedores (`/comercial/webhooks/asaas|zapsign`), sem
 *     sessão e conferidos por segredo no cabeçalho — é por eles que o Pix pago
 *     e o contrato assinado entram no fio. O gate de módulos deixa anônimo
 *     passar; quem confere a empresa é o serviço, pelo id externo da linha.
 *
 * Toda escrita em provedor sai pela PORTA (`PortaDoOperador`), com o efeito
 * registrado dentro do conector: `finance/asaas.service.ts` ganha as escritas
 * de cobrança; o ZapSign é conector novo em `comercial/conectores/`.
 */
const PENDENTE = (oQue: string) =>
  new NotImplementedException(`${oQue}: ainda não implementado nesta versão (lane D da passagem).`);

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class DinheiroController {
  /** Tela 10: o fechamento do lead, escrita a escrita. */
  @Get('fechamentos/:leadId')
  @RequirePermissions('leads.ver')
  fechamento(@CurrentUser() _user: JwtUser, @Param('leadId') _leadId: string) {
    throw PENDENTE('o fechamento');
  }

  /** Roda (ou re-roda) o fechamento com chave. Idempotente: não duplica escrita. */
  @Post('fechamentos/:leadId/rodar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  rodarFechamento(@CurrentUser() _user: JwtUser, @Param('leadId') _leadId: string, @Body() _body: unknown) {
    throw PENDENTE('rodar o fechamento');
  }

  /** Um sócio assina pela Root (um toque): manda o documento para o signatário da casa. */
  @Post('contratos/:leadId/assinar-pela-root')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  assinarPelaRoot(@CurrentUser() _user: JwtUser, @Param('leadId') _leadId: string) {
    throw PENDENTE('assinar pela Root');
  }

  /** Tela 11: o contrato vivo — parcelas, régua de cobrança, entregas, saúde e marcos. */
  @Get('contratos/:leadId')
  @RequirePermissions('leads.ver')
  contratoVivo(@CurrentUser() _user: JwtUser, @Param('leadId') _leadId: string) {
    throw PENDENTE('o contrato vivo');
  }

  /** A lista de contratos vivos da empresa. */
  @Get('contratos')
  @RequirePermissions('leads.ver')
  contratos(@CurrentUser() _user: JwtUser) {
    throw PENDENTE('os contratos vivos');
  }
}

/** Webhooks dos provedores: sem sessão, com segredo no cabeçalho. */
@Controller('comercial/webhooks')
export class WebhooksDoDinheiroController {
  @Post('asaas')
  @HttpCode(200)
  asaas(@Headers('asaas-access-token') _token: string | undefined, @Body() _body: unknown) {
    throw PENDENTE('o webhook do Asaas');
  }

  @Post('zapsign')
  @HttpCode(200)
  zapsign(@Headers('x-zapsign-token') _token: string | undefined, @Body() _body: unknown) {
    throw PENDENTE('o webhook do ZapSign');
  }
}
