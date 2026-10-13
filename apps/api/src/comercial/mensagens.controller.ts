import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { WhatsappComercialService } from './whatsapp.service';

/*
 * AS MENSAGENS DO COMERCIAL — a rota que o catálogo declara para
 * `comercial.whatsapp.enviar` (Lane B, 13/10/2026).
 *
 * `POST /comercial/mensagens/:id/enviar`: uma pessoa pede o envio de uma
 * mensagem já preparada (rascunho ou que falhou). O pedido vai à porta em nome
 * dela; R3 fica retido e OUTRA pessoa libera em `/atendimento` (ou no botão
 * "liberar envio" do celular da mesa, que chama a mesma confirmação
 * `POST /approvals/:id/confirm`). Mensagem já na fila volta com o `approvalId`.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial/mensagens')
export class MensagensController {
  constructor(private readonly whats: WhatsappComercialService) {}

  @Post(':id/enviar')
  @RequirePermissions('leads.editar')
  enviar(@CurrentUser() user: JwtUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.whats.pedirEnvio(user.orgId, id, { id: user.sub });
  }
}
