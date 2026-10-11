import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  TotemCadastroIdSchema,
  type TotemAnonimizacaoEmLote,
  type TotemCampanhaResumo,
  type TotemClienteDetalhe,
  type TotemClientePagina,
  type TotemCupomDetalhe,
  type TotemLojaDoEscopo,
} from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { TotemCampanhasService } from './totem-campanhas.service';

/**
 * `/api/totem-campanhas` — campanhas, clientes, consentimentos e cupons no
 * painel (frente D). Toda rota exige login e a permissão da área; o escopo de
 * lojas é conferido no serviço.
 */
@Controller('totem-campanhas')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TotemCampanhasController {
  constructor(private readonly svc: TotemCampanhasService) {}

  /** Id fora do formato responde como id inexistente. */
  private id(bruto: string, mensagem: string): string {
    const r = TotemCadastroIdSchema.safeParse(bruto);
    if (!r.success) throw new NotFoundException(mensagem);
    return r.data;
  }

  @Get('lojas')
  @RequirePermissions('totem.ver')
  lojas(@CurrentUser() user: JwtUser): Promise<TotemLojaDoEscopo[]> {
    return this.svc.lojas(user);
  }

  // --- Campanhas ---

  @Get()
  @RequirePermissions('totem.campanhas')
  listar(@CurrentUser() user: JwtUser): Promise<TotemCampanhaResumo[]> {
    return this.svc.listarCampanhas(user);
  }

  @Post()
  @RequirePermissions('totem.campanhas')
  criar(@CurrentUser() user: JwtUser, @Body() body: unknown): Promise<TotemCampanhaResumo> {
    return this.svc.criarCampanha(user, body);
  }

  @Patch(':id')
  @RequirePermissions('totem.campanhas')
  editar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown): Promise<TotemCampanhaResumo> {
    return this.svc.editarCampanha(user, this.id(id, 'Não encontramos esta campanha.'), body);
  }

  @Delete(':id')
  @RequirePermissions('totem.campanhas')
  apagar(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<{ ok: true }> {
    return this.svc.apagarCampanha(user, this.id(id, 'Não encontramos esta campanha.'));
  }

  // --- Clientes ---

  @Get('clientes')
  @RequirePermissions('totem.clientes')
  @Header('Cache-Control', 'no-store')
  clientes(@CurrentUser() user: JwtUser, @Query() query: unknown): Promise<TotemClientePagina> {
    return this.svc.listarClientes(user, query);
  }

  @Post('clientes/localizar')
  @HttpCode(200)
  @RequirePermissions('totem.clientes')
  @Header('Cache-Control', 'no-store')
  localizar(@CurrentUser() user: JwtUser, @Body() body: unknown): Promise<TotemClienteDetalhe> {
    return this.svc.localizarCliente(user, body);
  }

  @Post('clientes/anonimizar-inativos')
  @HttpCode(200)
  @RequirePermissions('totem.clientes', 'totem.rede')
  anonimizarInativos(@CurrentUser() user: JwtUser): Promise<TotemAnonimizacaoEmLote> {
    return this.svc.anonimizarInativos(user);
  }

  @Get('clientes/:id')
  @RequirePermissions('totem.clientes')
  @Header('Cache-Control', 'no-store')
  cliente(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<TotemClienteDetalhe> {
    return this.svc.detalheCliente(user, this.id(id, 'Não encontramos este cliente.'));
  }

  @Post('clientes/:id/revogar')
  @HttpCode(200)
  @RequirePermissions('totem.clientes')
  revogar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown): Promise<TotemClienteDetalhe> {
    return this.svc.revogar(user, this.id(id, 'Não encontramos este cliente.'), body);
  }

  @Post('clientes/:id/anonimizar')
  @HttpCode(200)
  @RequirePermissions('totem.clientes')
  anonimizar(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<TotemClienteDetalhe> {
    return this.svc.anonimizar(user, this.id(id, 'Não encontramos este cliente.'));
  }

  // --- Cupons (caixa) ---

  @Get('cupons/:codigo')
  @RequirePermissions('totem.cupons')
  @Header('Cache-Control', 'no-store')
  cupom(@CurrentUser() user: JwtUser, @Param('codigo') codigo: string): Promise<TotemCupomDetalhe> {
    return this.svc.consultarCupom(user, codigo);
  }

  @Post('cupons/:codigo/baixa')
  @HttpCode(200)
  @RequirePermissions('totem.cupons')
  baixa(@CurrentUser() user: JwtUser, @Param('codigo') codigo: string, @Body() body: unknown): Promise<TotemCupomDetalhe> {
    return this.svc.darBaixa(user, codigo, body);
  }

  @Post('cupons/:codigo/cancelar')
  @HttpCode(200)
  @RequirePermissions('totem.cupons')
  cancelar(@CurrentUser() user: JwtUser, @Param('codigo') codigo: string): Promise<TotemCupomDetalhe> {
    return this.svc.cancelar(user, codigo);
  }
}
