import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConectorController } from './conector.controller';
import { ConectorDeviceGuard } from './conector-device.guard';
import { ConectorPublicController } from './conector-public.controller';
import { ConectorService } from './conector.service';

@Module({
  imports: [AuthModule],
  controllers: [ConectorController, ConectorPublicController],
  providers: [ConectorService, ConectorDeviceGuard],
  exports: [ConectorService],
})
export class ConectorModule {}
