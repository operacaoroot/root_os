import { Module } from '@nestjs/common';
import { GoogleController } from './google.controller';
import { GoogleService } from './google.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // login com Gmail volta pelo callback deste conector
  controllers: [GoogleController],
  providers: [GoogleService],
  exports: [GoogleService], // o espelho .md do módulo Pauta grava no Drive por aqui
})
export class GoogleModule {}
