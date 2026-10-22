import { Controller, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';

/** Rotas `/whatsapp/conversas` (produção 22C, lane B). Esqueleto do contrato: a lane B preenche. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('whatsapp/conversas')
export class CaixaDoWhatsappController {}
