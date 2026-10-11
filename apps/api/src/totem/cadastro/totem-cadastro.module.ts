import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { TotemCadastroController } from './totem-cadastro.controller';
import { TotemCadastroService } from './totem-cadastro.service';
import { TotemCampanhasController } from './totem-campanhas.controller';
import { TotemCampanhasService } from './totem-campanhas.service';

/**
 * CADASTRO E CUPOM (frente D): a rota pública de cadastro e política
 * (`/api/totem-cadastro`) e o painel de campanhas, clientes e cupons
 * (`/api/totem-campanhas`).
 */
@Module({
  imports: [AuthModule],
  controllers: [TotemCadastroController, TotemCampanhasController],
  providers: [TotemCadastroService, TotemCampanhasService],
})
export class TotemCadastroModule {}
