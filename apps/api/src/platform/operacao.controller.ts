import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { OperacaoPainelConsultaSchema, type OperacaoPainelResposta } from '@mktos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { SessaoDaPlataformaGuard } from './sessao-da-plataforma.guard';
import { OperacaoService } from './operacao.service';
import fluxoDoCliente from './fluxo-do-cliente.json';
import areaDoCliente from './area-do-cliente.json';

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

  /*
   * A área do cliente (30/10/2026): o desenho do portal do cliente dentro da Sala,
   * item a item, com a fonte no OS, a tarefa do fluxo que alimenta cada um, o
   * motor, as levas e as decisões abertas. Lido em Contexto › Área do cliente.
   * É o mapa da construção, não o estado de um cliente: o arquivo é a fonte e
   * nova versão do desenho = trocá-lo.
   */
  @Get('area-do-cliente')
  @RequirePermissions('dashboard.ver')
  areaDoCliente(): typeof areaDoCliente {
    return areaDoCliente;
  }
}
