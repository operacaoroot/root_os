import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { ComercialPonteExercicioService } from './comercial-ponte-exercicio.service';
import { ComercialPonteExercicioController, ComercialPonteFinanceiroController } from './comercial-ponte-exercicio.controller';
@Module({imports:[TenantsModule],controllers:[ComercialPonteExercicioController,ComercialPonteFinanceiroController],providers:[AcessoAtualGuard,ComercialPonteExercicioService],exports:[ComercialPonteExercicioService]})
export class ComercialPonteExercicioModule {}
