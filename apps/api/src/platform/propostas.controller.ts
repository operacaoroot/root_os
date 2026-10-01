import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { SessaoDaPlataformaGuard } from './sessao-da-plataforma.guard';
import { PropostasService, type DetalheDaProposta, type ListaDePropostas } from './propostas.service';

/*
 * As propostas comerciais são da ROOT, não de cliente: só a sessão da
 * plataforma entra (o mesmo `SessaoDaPlataformaGuard` do console). Só leitura.
 */
@UseGuards(JwtAuthGuard, SessaoDaPlataformaGuard, PermissionsGuard)
@Controller('tenants/plataforma/propostas')
export class PropostasController {
  constructor(private readonly propostas: PropostasService) {}

  @Get()
  @RequirePermissions('dashboard.ver')
  lista(): Promise<ListaDePropostas> {
    return this.propostas.lista();
  }

  @Get(':cliente/:chave')
  @RequirePermissions('dashboard.ver')
  detalhe(@Param('cliente') cliente: string, @Param('chave') chave: string): Promise<DetalheDaProposta> {
    return this.propostas.detalhe(cliente, chave);
  }
}
