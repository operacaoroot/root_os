import { Controller, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';

/** Rotas `/whatsapp/resumo` (produção 22C, lane D). Esqueleto do contrato: a lane D preenche. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('whatsapp/resumo')
export class ResumoDoWhatsappController {}
