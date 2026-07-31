import { Module } from '@nestjs/common';
import { GoogleController } from './google.controller';
import { GoogleService } from './google.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // login com Gmail volta pelo callback deste conector
  controllers: [GoogleController],
  providers: [GoogleService],
})
export class GoogleModule {}
