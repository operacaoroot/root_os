import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { GoogleLoginService } from './google-login.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { ReauthService } from './reauth.service';
import { AgentTokenService } from './agent-token.service';
import { AgentTokenGuard } from './agent-token.guard';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleLoginService,
    ReauthService,
    JwtAuthGuard,
    PermissionsGuard,
    AgentTokenService,
    AgentTokenGuard,
  ],
  // `ReauthService` sai daqui porque quem exige reautenticação é a APROVAÇÃO
  // (R4/R5), e ela mora noutro módulo. Conferir quem é a pessoa continua sendo
  // assunto da autenticação — é aqui que a senha é comparada com o hash.
  exports: [
    GoogleLoginService,
    ReauthService,
    JwtAuthGuard,
    PermissionsGuard,
    AgentTokenService,
    AgentTokenGuard,
    JwtModule,
  ],
})
export class AuthModule {}
