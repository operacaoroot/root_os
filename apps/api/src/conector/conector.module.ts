import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConectorController } from './conector.controller';
import { ConectorDeviceGuard } from './conector-device.guard';
import { ConectorPublicController } from './conector-public.controller';
import { ConectorService } from './conector.service';
import { ConectorRemessaService } from './conector-remessa.service';

@Module({
  imports: [AuthModule],
  controllers: [ConectorController, ConectorPublicController],
  providers: [ConectorService, ConectorRemessaService, ConectorDeviceGuard],
  exports: [ConectorService],
})
export class ConectorModule {}
