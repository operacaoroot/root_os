import { Body, Controller, Get, NotImplementedException, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';

/*
 * O SIMULADOR DE WHATSAPP — o "celular" do lead e da mesa (tela /comercial/simulador), Lane 0 → Lane B.
 *
 * No provedor `simulado` as mensagens vivem em `ComercialMensagem`: o que a
 * casa mandaria ao lead aparece aqui com formulário e botões renderizados, e o
 * que o lead "responde" entra pelo mesmo caminho que um webhook de provedor
 * entraria. A mesa (tela 09) também é um celular simulado: as decisões chegam
 * aqui com os botões e a resposta vira evento no fio do lead.
 */
const PENDENTE = (oQue: string) =>
  new NotImplementedException(`${oQue}: ainda não implementado nesta versão (lane B da passagem).`);

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial/simulador')
export class SimuladorController {
  /** Os celulares: um por lead (número) e o da mesa. */
  @Get('celulares')
  @RequirePermissions('leads.ver')
  celulares(@CurrentUser() _user: JwtUser) {
    throw PENDENTE('a lista de celulares');
  }

  /** A conversa de um lead como o lead a vê. */
  @Get('lead/:leadId')
  @RequirePermissions('leads.ver')
  conversa(@CurrentUser() _user: JwtUser, @Param('leadId') _leadId: string) {
    throw PENDENTE('a conversa do lead');
  }

  /** O lead "digita" no celular: texto livre, resposta de formulário ou toque em botão. */
  @Post('lead/:leadId/responder')
  @RequirePermissions('leads.editar')
  responder(@CurrentUser() _user: JwtUser, @Param('leadId') _leadId: string, @Body() _body: unknown) {
    throw PENDENTE('a resposta do lead');
  }

  /** O celular da mesa (tela 09): decisões e vetos com botões. */
  @Get('mesa')
  @RequirePermissions('leads.ver')
  mesa(@CurrentUser() _user: JwtUser) {
    throw PENDENTE('o celular da mesa');
  }

  /** A mesa toca num botão (aprovar, manter, VETO). */
  @Post('mesa/responder')
  @RequirePermissions('leads.editar')
  mesaResponder(@CurrentUser() _user: JwtUser, @Body() _body: unknown) {
    throw PENDENTE('a resposta da mesa');
  }
}
