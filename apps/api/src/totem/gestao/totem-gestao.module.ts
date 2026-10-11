import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { TotemGestaoController } from './totem-gestao.controller';

/**
 * O PAINEL DO TOTEM (frente A): lojas, vínculos, dispositivos, produtos,
 * configuração, resumo e eventos. Ver `docs/totem/CONTRATO.md`.
 *
 * `PrismaService` vem do `PrismaModule` global e não entra nos `imports`.
 */
@Module({
  imports: [AuthModule],
  controllers: [TotemGestaoController],
})
export class TotemGestaoModule {}
