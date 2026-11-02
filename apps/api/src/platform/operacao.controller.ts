import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { OperacaoPainelConsultaSchema, type OperacaoPainelResposta } from '@mktos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { SessaoDaPlataformaGuard } from './sessao-da-plataforma.guard';
import { OperacaoService } from './operacao.service';
import { FluxoNaMemoriaService, type EstadoDoFluxoNaMemoria, type ResultadoDaCargaDoFluxo } from './fluxo-na-memoria.service';
import fluxoDoCliente from './fluxo-do-cliente.json';
import areaDoCliente from './area-do-cliente.json';

/*
 * O painel da operação é da ROOT, não de cliente: mesma porta das propostas
 * (`SessaoDaPlataformaGuard`). Só leitura.
 */
@UseGuards(JwtAuthGuard, SessaoDaPlataformaGuard, PermissionsGuard)
@Controller('tenants/plataforma/operacao')
export class OperacaoController {
  constructor(
    private readonly operacao: OperacaoService,
    private readonly fluxoNaMemoria: FluxoNaMemoriaService,
  ) {}

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
   * O mesmo fluxo como contexto da operação (02/11/2026, P-87): dez notas na
   * Memória da ROOT, que é onde os agentes buscam. A leitura diz a situação de
   * cada nota diante do arquivo; o POST é o botão "Levar para a Memória". As
   * permissões são as da Memória (ver e editar), conferidas de novo no banco
   * pelo `AcessoAtualGuard`, como em `/memoria`.
   */
  @Get('fluxo-do-cliente/memoria')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('dashboard.ver', 'obsidian.ver')
  fluxoNaMemoriaEstado(@CurrentUser() user: JwtUser): Promise<EstadoDoFluxoNaMemoria> {
    return this.fluxoNaMemoria.estado(user.orgId, user.sub);
  }

  @Post('fluxo-do-cliente/memoria')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('dashboard.ver', 'obsidian.editar')
  levarFluxoParaMemoria(@CurrentUser() user: JwtUser): Promise<ResultadoDaCargaDoFluxo> {
    return this.fluxoNaMemoria.levar(user.orgId, user.sub);
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
