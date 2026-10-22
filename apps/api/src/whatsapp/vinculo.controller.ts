import { Controller, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';

/** Rotas `/whatsapp/vinculos` (produção 22C, lane C). Esqueleto do contrato: a lane C preenche. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('whatsapp/vinculos')
export class VinculoDoWhatsappController {}
