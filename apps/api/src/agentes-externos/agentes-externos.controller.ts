import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { EfeitosDaCentralService } from './efeitos-da-central.service';
import { ExecucaoExternaService } from './execucao-externa.service';

/*
 * Quem pode fazer um agente executar UMA capacidade pela porta, em nome de si:
 * a MESMA interseção de `POST /agents/:slug/executar` (`mcp.executar` e
 * `admin.usuarios`) — a conta de serviço da IA tem `mcp.executar` e não pode
 * acordar agente. É o caminho do console: quem administra testa a Rootinha
 * como se fosse ela, e vira o solicitante.
 */
const EXECUTAR_AGENTE = ['mcp.executar', 'admin.usuarios'] as const;

/*
 * AS ROTAS DA CENTRAL PARA QUEM ESTÁ FORA DO LAÇO (política 1.13.0).
 *
 * `GET /agents/:slug/ultima-passagem` é a leitura que implementa `briefing.ler`
 * (a rota do catálogo é a desta rota com `briefing-diario` no lugar do slug):
 * a última passagem RESPONDIDA de um agente, para quem quer o resumo da manhã
 * sem acordar o agente de novo. `mcp.ver`, a mesma chave das outras leituras de
 * agente — ler não faz nada acontecer.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class AgentesExternosController {
  constructor(
    private readonly central: EfeitosDaCentralService,
    private readonly execucao: ExecucaoExternaService,
  ) {}

  /**
   * A2 — UMA capacidade, pela porta, por conta de um agente que roda fora do OS.
   *
   * Responde 200 nos três desfechos da porta (`executado`, `aguardando_aprovacao`
   * com o bilhete, `recusado` com o motivo) e no `erro` do efeito: quem chama é
   * um modelo, e o desfecho é dado para ele decidir o próximo passo, não falha
   * de transporte. 404 para agente que não existe nesta empresa; 400 para corpo
   * malformado ou solicitante que não é gente desta empresa.
   */
  @Post('agents/:slug/capacidades/:id/executar')
  @HttpCode(200)
  @RequirePermissions(...EXECUTAR_AGENTE)
  executar(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Param('id') id: string, @Body() body: unknown) {
    return this.execucao.executar({ orgId: user.orgId, solicitantePadraoId: user.sub }, slug, id, body);
  }

  @Get('agents/:slug/ultima-passagem')
  @RequirePermissions('mcp.ver')
  ultimaPassagem(@CurrentUser() user: JwtUser, @Param('slug') slug: string) {
    return this.central.ultimaPassagem(user.orgId, slug);
  }
}
