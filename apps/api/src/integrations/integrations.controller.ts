import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ToggleIntegrationSchema } from '@mktos/shared';
import { IntegrationsService } from './integrations.service';
import { ClickupService } from './clickup.service';
import { ConectoresService } from './conectores.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/**
 * O corpo do desligamento (RF-G-06).
 *
 * `motivo` é opcional mas entra na frase que o agente recebe quando a
 * ferramenta é recusada — e é o que, seis meses depois, explica no RASTRO por
 * que o conector ficou parado. A tela pede; a API não obriga, porque desligar
 * em emergência não pode esbarrar num campo de texto.
 */
const DesligamentoSchema = z.object({
  motivo: z.string().trim().max(500).optional(),
});

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly svc: IntegrationsService,
    private readonly clickup: ClickupService,
    private readonly conectores: ConectoresService,
  ) {}

  @Get('catalog')
  @RequirePermissions('dashboard.ver')
  catalog(@CurrentUser() user: JwtUser) {
    return this.svc.catalog(user.orgId);
  }

  // Ligar/desligar manualmente um conector (só os com credencial via env/API key).
  // Gerência de integrações é ação de admin.
  @Put(':key')
  @RequirePermissions('admin.usuarios')
  toggle(@CurrentUser() user: JwtUser, @Param('key') key: string, @Body() body: unknown) {
    const input = ToggleIntegrationSchema.parse(body);
    return this.svc.toggle(user.orgId, key, input.status, user.sub);
  }

  /**
   * DESLIGAR um conector desta empresa — RF-G-06, capacidade `conector.desligar`.
   *
   * Rota SEPARADA do `PUT :key` de propósito. Aquele muda a CONFIGURAÇÃO da
   * integração e recusa os conectores de OAuth (`isManaged`) — justamente os do
   * Google, que são os que mais importa poder desligar depressa. Este vale para
   * todos, porque a pergunta é outra: "pare de usar isto agora".
   *
   * DESLIGAR E RELIGAR SÃO DUAS ROTAS, e não um `desligado: boolean` num corpo
   * só, porque são DUAS CAPACIDADES com níveis diferentes na régua
   * (`conector.desligar` é R3, `conector.religar` é R4 — ver
   * `politica-marketing-os.json`). Um booleano no corpo esconderia isso: a mesma
   * rota valeria dois níveis, e nem o catálogo nem o futuro gancho da porta
   * teriam como dizer qual das duas está sendo chamada. O recurso é "o
   * desligamento": criá-lo é POST, removê-lo é DELETE.
   *
   * `chave` aceita conector (`gmail`) ou grupo (`google` = as quatro
   * superfícies). Alvo desconhecido devolve 400 com a lista do que existe.
   */
  @Post(':chave/desligamento')
  @RequirePermissions('admin.usuarios')
  desligar(@CurrentUser() user: JwtUser, @Param('chave') chave: string, @Body() body: unknown) {
    const input = DesligamentoSchema.parse(body ?? {});
    return this.conectores.desligar(user.orgId, chave, {
      motivo: input.motivo,
      actorId: user.sub,
    });
  }

  /**
   * RELIGAR — capacidade `conector.religar`, R4 na régua.
   *
   * NENHUMA CREDENCIAL É TOCADA: religar apaga a linha do desligamento e o
   * conector volta ao estado exato de antes, sem nova autorização.
   */
  @Delete(':chave/desligamento')
  @RequirePermissions('admin.usuarios')
  religar(@CurrentUser() user: JwtUser, @Param('chave') chave: string) {
    return this.conectores.religar(user.orgId, chave, { actorId: user.sub });
  }

  // Sincroniza as tarefas reais do ClickUp → módulo Tarefas.
  @Post('clickup/sync')
  @RequirePermissions('tarefas.editar')
  syncClickup(@CurrentUser() user: JwtUser) {
    return this.clickup.sync(user.orgId, user.sub);
  }
}
