import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClienteEscopoService } from './cliente-escopo.service';
import { ClienteEscopoInterceptor } from './cliente-escopo.interceptor';
import { ClienteEscopoController } from './cliente-escopo.controller';
import { EfeitoClienteEscopoService } from './efeito-cliente-escopo.service';
import { TarefaEscopoService } from './tarefa-escopo.service';
import { OrigemArquivoClienteService } from './origem-arquivo-cliente.service';
@Global()
@Module({controllers:[ClienteEscopoController],providers:[ClienteEscopoService,TarefaEscopoService,OrigemArquivoClienteService,EfeitoClienteEscopoService,{provide:APP_INTERCEPTOR,useClass:ClienteEscopoInterceptor}],exports:[ClienteEscopoService,TarefaEscopoService,OrigemArquivoClienteService,EfeitoClienteEscopoService]})
export class ClienteEscopoModule {}
