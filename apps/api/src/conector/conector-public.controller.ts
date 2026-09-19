import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ConectorDeviceGuard, conectorDeviceFrom } from './conector-device.guard';
import { ConectorService } from './conector.service';

const ParearSchema = z.object({
  orgId: z.string().uuid(),
  pairingId: z.string().uuid(),
  code: z.string().min(20).max(100),
  nomeDispositivo: z.string().trim().min(1).max(80),
}).strict();

const PulsoSchema = z.object({
  versao: z.string().trim().min(1).max(80),
  so: z.string().trim().min(1).max(80),
  usuarioLocal: z.string().trim().min(1).max(160),
  relogio: z.string().datetime(),
}).strict();

/** Superfície pública mínima: parear seleciona por id, mas só o código autoriza. */
@Controller('conector')
export class ConectorPublicController {
  constructor(private readonly conector: ConectorService) {}

  @Post('pareamento')
  parear(@Body() body: unknown) {
    const data = ParearSchema.parse(body);
    return this.conector.parear(data.orgId, data.pairingId, data.code, data.nomeDispositivo);
  }

  @Post('pulso')
  @HttpCode(200)
  @UseGuards(ConectorDeviceGuard)
  pulso(@Req() request: { connectorDevice?: ReturnType<typeof conectorDeviceFrom> }, @Body() body: unknown) {
    const data = PulsoSchema.parse(body);
    return this.conector.pulso(conectorDeviceFrom(request), data);
  }
}
