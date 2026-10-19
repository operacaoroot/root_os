import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { ComercialPonteExercicioService } from './comercial-ponte-exercicio.service';

@Controller('leads')
@UseGuards(JwtAuthGuard,AcessoAtualGuard)
export class ComercialPonteExercicioController {
 constructor(private readonly svc:ComercialPonteExercicioService){}
 @Get(':id/exercicio/ponte/catalogos') @RequirePermissions('leads.ver','tarefas.ver')
 catalogos(@CurrentUser() a:JwtUser,@Param('id') id:string){return this.svc.catalogos(a,id);}
 @Get(':id/exercicio/ponte/pedidos/:requestId') @RequirePermissions('leads.ver','tarefas.ver')
 pedido(@CurrentUser() a:JwtUser,@Param('id') id:string,@Param('requestId') requestId:string){return this.svc.porPedido(a,requestId,{leadId:id});}
 @Get(':id/exercicio/ponte') @RequirePermissions('leads.ver','tarefas.ver')
 ler(@CurrentUser() a:JwtUser,@Param('id') id:string){return this.svc.ler(a,id);}
 @Post(':id/exercicio/projeto') @HttpCode(200) @RequirePermissions('leads.ver','leads.editar','tarefas.ver','tarefas.editar')
 projeto(@CurrentUser() a:JwtUser,@Param('id') id:string,@Body() body:unknown){return this.svc.criarProjeto(a,id,body);}
 @Post(':id/exercicio/projetos/:projectId/obrigacao') @HttpCode(200) @RequirePermissions('leads.ver','leads.editar','tarefas.ver','tarefas.editar','financeiro.ver','financeiro.editar')
 obrigacao(@CurrentUser() a:JwtUser,@Param('id') id:string,@Param('projectId') projectId:string,@Body() body:unknown){return this.svc.registrarObrigacao(a,id,projectId,body);}
}
@Controller('finance/exercicio/comercial/obrigacoes')
@UseGuards(JwtAuthGuard,AcessoAtualGuard)
export class ComercialPonteFinanceiroController {
 constructor(private readonly svc:ComercialPonteExercicioService){}
 @Get(':id/pedidos/:requestId') @RequirePermissions('financeiro.ver')
 pedido(@CurrentUser() a:JwtUser,@Param('id') id:string,@Param('requestId') requestId:string){return this.svc.porPedido(a,requestId,{transactionId:id});}
 @Get(':id') @RequirePermissions('financeiro.ver')
 detalhe(@CurrentUser() a:JwtUser,@Param('id') id:string){return this.svc.detalheFinanceiro(a,id);}
 @Post(':id/decisoes') @HttpCode(200) @RequirePermissions('financeiro.ver','financeiro.editar')
 decidir(@CurrentUser() a:JwtUser,@Param('id') id:string,@Body() body:unknown){return this.svc.decidir(a,id,body);}
}
