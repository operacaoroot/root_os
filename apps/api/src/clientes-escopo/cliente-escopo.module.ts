import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClienteEscopoService } from './cliente-escopo.service';
import { ClienteEscopoInterceptor } from './cliente-escopo.interceptor';
import { ClienteEscopoController } from './cliente-escopo.controller';
import { TarefaEscopoService } from './tarefa-escopo.service';
@Global()
@Module({controllers:[ClienteEscopoController],providers:[ClienteEscopoService,TarefaEscopoService,{provide:APP_INTERCEPTOR,useClass:ClienteEscopoInterceptor}],exports:[ClienteEscopoService,TarefaEscopoService]})
export class ClienteEscopoModule {}
