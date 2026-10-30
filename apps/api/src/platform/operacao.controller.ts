import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { OperacaoPainelConsultaSchema, type OperacaoPainelResposta } from '@mktos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { SessaoDaPlataformaGuard } from './sessao-da-plataforma.guard';
import { OperacaoService } from './operacao.service';
import fluxoDoCliente from './fluxo-do-cliente.json';

/*
 * O painel da operação é da ROOT, não de cliente: mesma porta das propostas
 * (`SessaoDaPlataformaGuard`). Só leitura.
 */
@UseGuards(JwtAuthGuard, SessaoDaPlataformaGuard, PermissionsGuard)
@Controller('tenants/plataforma/operacao')
export class OperacaoController {
  constructor(private readonly operacao: OperacaoService) {}

  @Get('painel')
  @RequirePermissions('dashboard.ver')
  painel(@CurrentUser() user: JwtUser, @Query() query: unknown): Promise<OperacaoPainelResposta> {
    const { rodada } = OperacaoPainelConsultaSchema.parse(query);
    return this.operacao.painel(user.orgId, rodada);
  }

  /*
   * O fluxo do cliente (30/10/2026): da proposta aceita à continuidade ou ao fim,
   * com dono e "feito quando" em cada tarefa. Contexto da operação da ROOT, lido
   * em Contexto › Fluxo do cliente. O arquivo é a fonte; nova versão = trocá-lo.
   */
  @Get('fluxo-do-cliente')
  @RequirePermissions('dashboard.ver')
  fluxoDoCliente(): typeof fluxoDoCliente {
    return fluxoDoCliente;
  }
}
