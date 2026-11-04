import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { CofreDaEmpresaController } from './cofre-da-empresa.controller';
import { CofreDaEmpresaService } from './cofre-da-empresa.service';
import { CofreDepositoService } from './deposito.service';
import { CofreDepositoController, CofreReceberController, LimiteDeposito } from './deposito.controller';

// Cofre das PESSOAS (senhas, dados e documentos dos sócios). O cofre de
// conectores, que guarda o que o sistema usa, é o módulo `cofre/`.
@Module({
  imports: [StorageModule],
  controllers: [CofreDaEmpresaController, CofreDepositoController, CofreReceberController],
  providers: [CofreDaEmpresaService, CofreDepositoService, LimiteDeposito, AcessoAtualGuard],
})
export class CofreDaEmpresaModule {}
