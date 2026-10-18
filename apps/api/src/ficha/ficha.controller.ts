import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { NovaReuniaoSchema, NovaTarefaDoClienteSchema, NovoContratoSchema } from '@mktos/shared';
import { z } from 'zod';
import { FichaService } from './ficha.service';
import { JornadaService } from './jornada.service';
import { TarefasDoClienteService } from './tarefas-do-cliente.service';
import { ContratosDoClienteService } from './contratos-do-cliente.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/**
 * A ficha do cliente: o card do CRM (um por lead/cliente) e o que pende dele,
 * reuniões, tarefas e contratos. Mora sob `trabalho/` porque o card é do Trabalho.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho/fichas')
export class FichaController {
  constructor(
    private readonly svc: FichaService,
    private readonly jornadas: JornadaService,
    private readonly tarefas: TarefasDoClienteService,
    private readonly contratos: ContratosDoClienteService,
  ) {}

  /** O quadro do CRM (`?lista=crm-root-lista`): as abas filtram pela fase da etapa. */
  @Get('quadro')
  @RequirePermissions('tarefas.ver')
  quadro(@CurrentUser() u: JwtUser, @Query('lista') lista: string) {
    return this.jornadas.quadro(u.orgId, String(lista ?? ''));
  }

  // ---- contratos do cliente ----
  @Get(':taskId/contratos')
  @RequirePermissions('tarefas.ver')
  listarContratos(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string) {
    return this.contratos.listar(u.orgId, taskId);
  }

  @Post(':taskId/contratos')
  @RequirePermissions('tarefas.editar')
  criarContrato(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string, @Body() body: unknown) {
    return this.contratos.criar(u.orgId, taskId, NovoContratoSchema.parse(body));
  }

  /** Chamado quando o card vira cliente: sem contrato, registra um com o valor da proposta. */
  @Post(':taskId/contratos/garantir')
  @RequirePermissions('tarefas.editar')
  garantirContrato(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string) {
    return this.contratos.garantir(u.orgId, taskId);
  }

  @Post('contratos/:id/cancelar')
  @RequirePermissions('tarefas.editar')
  cancelarContrato(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.contratos.cancelar(u.orgId, id);
  }

  // ---- tarefas do cliente ----
  @Get(':taskId/tarefas')
  @RequirePermissions('tarefas.ver')
  listarTarefas(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string) {
    return this.tarefas.listar(u.orgId, taskId);
  }

  @Post(':taskId/tarefas')
  @RequirePermissions('tarefas.editar')
  criarTarefa(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string, @Body() body: unknown) {
    return this.tarefas.criar(u.orgId, taskId, NovaTarefaDoClienteSchema.parse(body));
  }

  @Post(':taskId/tarefas/rotina')
  @RequirePermissions('tarefas.editar')
  rotina(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string, @Body() body: unknown) {
    const { responsavel } = z.object({ responsavel: z.string().max(120).nullish() }).parse(body ?? {});
    return this.tarefas.rotina(u.orgId, taskId, responsavel);
  }

  @Post('tarefas/:id/alternar')
  @RequirePermissions('tarefas.editar')
  alternar(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.tarefas.alternar(u.orgId, id);
  }

  // ---- reuniões ----
  @Get(':taskId/reunioes')
  @RequirePermissions('tarefas.ver')
  listar(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string) {
    return this.svc.listar(u.orgId, taskId);
  }

  @Get('reunioes/:id')
  @RequirePermissions('tarefas.ver')
  ler(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.ler(u.orgId, id);
  }

  @Post(':taskId/reunioes')
  @RequirePermissions('tarefas.editar')
  criar(@CurrentUser() u: JwtUser, @Param('taskId') taskId: string, @Body() body: unknown) {
    return this.svc.criar(u.orgId, u.sub, taskId, NovaReuniaoSchema.parse(body));
  }

  @Delete('reunioes/:id')
  @RequirePermissions('tarefas.editar')
  apagar(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagar(u.orgId, id);
  }
}
