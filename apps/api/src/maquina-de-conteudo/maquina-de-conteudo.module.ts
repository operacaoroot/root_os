import { Module } from '@nestjs/common';
import { PautaModule } from '../pauta/pauta.module';
import { MaquinaDeConteudoController } from './maquina-de-conteudo.controller';
import { MaquinaDeConteudoService } from './maquina-de-conteudo.service';

// Marketing › Máquina de Conteúdo da empresa. Lê os pilares da marca pela pauta.
@Module({
  imports: [PautaModule],
  controllers: [MaquinaDeConteudoController],
  providers: [MaquinaDeConteudoService],
})
export class MaquinaDeConteudoModule {}
