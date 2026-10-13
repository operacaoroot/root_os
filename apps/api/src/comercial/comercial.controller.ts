import { Body, Controller, Get, NotImplementedException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';

/*
 * A ESPINHA DO COCKPIT — rotas internas do módulo comercial (Lane 0 → Lane A).
 *
 * Declaradas aqui com o contrato fechado; o corpo que ainda responde 501 diz
 * qual lane o preenche. Permissões: `leads.ver` lê, `leads.editar` escreve.
 * A etapa NUNCA se escreve por aqui (não há PATCH de etapa): quem move é a
 * reação a um evento, e o portão recusa com a lista do que falta.
 */
const PENDENTE = (lane: string, oQue: string) =>
  new NotImplementedException(`${oQue}: ainda não implementado nesta versão (lane ${lane} da passagem).`);

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class ComercialController {
  /** Tela 03: a fila de decisões, o que rodou sozinho hoje e os contadores. */
  @Get('fila')
  @RequirePermissions('leads.ver')
  fila(@CurrentUser() _user: JwtUser) {
    throw PENDENTE('A', 'a fila de decisões');
  }

  /** Tela 04: o funil vivo, com as saídas visíveis. */
  @Get('funil')
  @RequirePermissions('leads.ver')
  funil(@CurrentUser() _user: JwtUser, @Query('filtro') _filtro?: string) {
    throw PENDENTE('A', 'o funil vivo');
  }

  /** Tela 05: a ficha do lead — projeção do fio, com o portão da próxima etapa. */
  @Get('lead/:id')
  @RequirePermissions('leads.ver')
  ficha(@CurrentUser() _user: JwtUser, @Param('id') _id: string) {
    throw PENDENTE('A', 'a ficha do lead');
  }

  /** O fio cru (os eventos) — para a tela 05 e para a suíte. */
  @Get('lead/:id/fio')
  @RequirePermissions('leads.ver')
  fio(@CurrentUser() _user: JwtUser, @Param('id') _id: string) {
    throw PENDENTE('A', 'o fio do lead');
  }

  /** E1: o lead entra pelo WhatsApp (simulador ou provedor). Idempotente pelo telefone e pela mensagem. */
  @Post('entrada/whats')
  @RequirePermissions('leads.editar')
  entradaWhats(@CurrentUser() _user: JwtUser, @Body() _body: unknown) {
    throw PENDENTE('A', 'a entrada pelo WhatsApp');
  }

  /** E4: a ata da sessão chega (texto do Granola ou colado). Grava só o hash; dispara o leitor (lane E). */
  @Post('lead/:id/ata')
  @RequirePermissions('leads.editar')
  ata(@CurrentUser() _user: JwtUser, @Param('id') _id: string, @Body() _body: unknown) {
    throw PENDENTE('A', 'a chegada da ata');
  }

  /** Saída com motivo e dono (desqualificado, geladeira, perdido, parceiro). */
  @Post('lead/:id/saida')
  @RequirePermissions('leads.editar')
  saida(@CurrentUser() _user: JwtUser, @Param('id') _id: string, @Body() _body: unknown) {
    throw PENDENTE('A', 'a saída do lead');
  }

  /** A fila de decisões (abertas, tomadas, expiradas). */
  @Get('decisoes')
  @RequirePermissions('leads.ver')
  decisoes(@CurrentUser() _user: JwtUser, @Query('estado') _estado?: string) {
    throw PENDENTE('A', 'as decisões');
  }

  /** Um toque: responde a decisão pela tela. */
  @Post('decisoes/:id/responder')
  @RequirePermissions('leads.editar')
  responder(@CurrentUser() _user: JwtUser, @Param('id') _id: string, @Body() _body: unknown) {
    throw PENDENTE('A', 'a resposta da decisão');
  }

  /** Os interruptores e a régua por empresa (K08). */
  @Get('config')
  @RequirePermissions('leads.ver')
  config(@CurrentUser() _user: JwtUser) {
    throw PENDENTE('A', 'a configuração');
  }

  @Put('config')
  @RequirePermissions('leads.editar')
  salvarConfig(@CurrentUser() _user: JwtUser, @Body() _body: unknown) {
    throw PENDENTE('A', 'a configuração');
  }
}
