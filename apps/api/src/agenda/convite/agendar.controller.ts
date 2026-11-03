import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { EstadoDoConvitePublico } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { enderecoDeOrigem, type RequisicaoComEndereco } from '../../auth/endereco-de-origem';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { SoGenteNaAgendaGuard } from '../escrita/so-gente-na-agenda.guard';
import { TetoPorOrigem } from './convite-puro';
import { ConviteDaAgendaService, type ConviteDaLista, type RespostaDaConfirmacao } from './convite.service';

/*
 * Mora num arquivo só dele porque a catraca de módulos (`test/modulos-por-tenant.test.ts`)
 * lê UM `@Controller` por arquivo: junto do controlador interno, o prefixo `agendar`
 * sumia do inventário.
 */
/** Por origem e por hora. Ler é barato; confirmar marca na agenda. */
export const TETO_DE_LEITURA_POR_HORA = 300;
export const TETO_DE_CONFIRMACAO_POR_HORA = 20;

/**
 * O LINK DE ESCOLHA PARA O CLIENTE — as rotas anônimas (prefixo `agendar`,
 * espinha em `tenants/modulos.ts`).
 *
 * Sem guarda de sessão, como o link do onboarding. O que segura: o token (256
 * bits) é a única credencial e a rota responde o MESMO 404 para errado,
 * vencido, revogado e usado sem escolha; TETO DE TAXA por origem, em memória;
 * `Cache-Control: no-store`. A página só vê horários livres: nenhum título,
 * nenhum nome de outro cliente.
 */
@Controller('agendar')
export class AgendarController {
  private readonly log = new Logger('LinkDeEscolha');
  readonly teto = new TetoPorOrigem();
  readonly tetoDeConfirmacao = new TetoPorOrigem();

  constructor(private readonly convites: ConviteDaAgendaService) {}

  private conferirTeto(req: RequisicaoComEndereco | undefined, confirmando = false): void {
    const origem = enderecoDeOrigem(req) ?? null;
    const ok = confirmando
      ? this.tetoDeConfirmacao.registrar(origem, TETO_DE_CONFIRMACAO_POR_HORA)
      : this.teto.registrar(origem, TETO_DE_LEITURA_POR_HORA);
    if (!ok) {
      this.log.warn(`link de escolha: teto de taxa (${confirmando ? 'confirmação' : 'leitura'}) estourado para ${origem ?? '?'}`);
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Muitas tentativas. Espere alguns minutos.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  estado(@Param('token') token: string, @Req() req?: RequisicaoComEndereco): Promise<EstadoDoConvitePublico> {
    this.conferirTeto(req);
    return this.convites.estadoPublico(token);
  }

  @Post(':token/confirmar')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  confirmar(@Param('token') token: string, @Body() corpo: unknown, @Req() req?: RequisicaoComEndereco): Promise<RespostaDaConfirmacao> {
    this.conferirTeto(req);
    this.conferirTeto(req, true);
    return this.convites.confirmar(token, corpo ?? {});
  }

  @Get(':token/ics')
  async ics(
    @Param('token') token: string,
    @Req() req: RequisicaoComEndereco,
    @Res({ passthrough: true }) res: { setHeader(nome: string, valor: string): void },
  ): Promise<string> {
    this.conferirTeto(req);
    const corpo = await this.convites.ics(token);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reuniao-root.ics"');
    res.setHeader('Cache-Control', 'no-store');
    return corpo;
  }
}
