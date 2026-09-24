import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { FerramentasController } from './ferramentas.controller';
import { FerramentasService } from './ferramentas.service';

@Module({
  imports: [AuthModule, TenantsModule],
  controllers: [FerramentasController],
  providers: [FerramentasService],
  exports: [FerramentasService],
})
export class FerramentasModule {}
