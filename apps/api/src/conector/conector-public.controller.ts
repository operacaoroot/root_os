import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ConectorDeviceGuard, conectorDeviceFrom } from './conector-device.guard';
import { ConectorService } from './conector.service';
import { ConectorRemessaService } from './conector-remessa.service';
import { ConnectorMode } from '@prisma/client';

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

const RemessaSchema = z.object({
  fonteId: z.string().uuid(),
  modo: z.enum([ConnectorMode.importacao, ConnectorMode.sincronizacao]),
  chaveRequisicao: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/),
}).strict();
const ItemSchema = z.object({
  caminhoRelativo: z.string().min(1).max(500),
  texto: z.string().max(2 * 1024 * 1024),
  hashConteudo: z.string().regex(/^[a-f0-9]{64}$/),
  tamanho: z.number().finite().int().nonnegative().max(2 * 1024 * 1024),
  mime: z.string().min(1).max(80),
}).strict();
const LoteSchema = z.object({ itens: z.array(ItemSchema).min(1).max(100) }).strict();
const FimSchema = z.object({
  itensVistos: z.array(z.object({ caminhoRelativo: z.string().min(1).max(500) }).strict()).max(10_000),
  itensEnviados: z.number().finite().int().nonnegative(),
  erros: z.array(z.string().min(1).max(300)).max(100),
  manifestoCompleto: z.boolean(),
}).strict();

/** Superfície pública mínima: parear seleciona por id, mas só o código autoriza. */
@Controller('conector')
export class ConectorPublicController {
  constructor(private readonly conector: ConectorService, private readonly remessas: ConectorRemessaService) {}

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

  @Post('remessa')
  @UseGuards(ConectorDeviceGuard)
  abrirRemessa(@Req() request: { connectorDevice?: ReturnType<typeof conectorDeviceFrom> }, @Body() body: unknown) {
    return this.remessas.abrir(conectorDeviceFrom(request), RemessaSchema.parse(body));
  }

  @Post('remessa/:id/lote')
  @HttpCode(200)
  @UseGuards(ConectorDeviceGuard)
  lote(@Req() request: { connectorDevice?: ReturnType<typeof conectorDeviceFrom> }, @Param('id') id: string, @Body() body: unknown) {
    const data = LoteSchema.parse(body);
    return this.remessas.lote(conectorDeviceFrom(request), id, data.itens);
  }

  @Post('remessa/:id/fim')
  @HttpCode(200)
  @UseGuards(ConectorDeviceGuard)
  fim(@Req() request: { connectorDevice?: ReturnType<typeof conectorDeviceFrom> }, @Param('id') id: string, @Body() body: unknown) {
    return this.remessas.fim(conectorDeviceFrom(request), id, FimSchema.parse(body));
  }
}
