import { Body, Controller, Header, HttpCode, HttpException, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { RESPOSTA_DO_FORMULARIO, TETO_DO_FORMULARIO_POR_HORA } from '@mktos/shared';

import { enderecoDeOrigem, type RequisicaoComEndereco } from '../../auth/endereco-de-origem';
import { TetoPorOrigem } from '../sala.controller';
import { FormularioDoSiteService } from './formulario-do-site.service';

/*
 * `POST /api/publico/lead` — o formulário do site (rodada dos agentes, CO-15).
 *
 * Rota ANÔNIMA, sem guard. O prefixo `publico` é declarado em
 * `tenants/modulos.ts` como módulo `leads`: o gate deixa anônimo passar e o
 * serviço confere o módulo da empresa da chave. O CORS e o tamanho do corpo
 * ficam no middleware de `cors.ts` (montado no `main.ts`, antes do CORS geral).
 *
 * Teto por origem (IP) em memória, por hora, e um teto geral do processo, para
 * um robô espalhado em muitos IPs não encher o funil de uma vez.
 */
export const TETO_GERAL_DO_FORMULARIO_POR_HORA = 300;

@Controller('publico')
export class FormularioDoSiteController {
  private readonly log = new Logger('ComercialFormularioDoSite');
  private readonly teto = new TetoPorOrigem();
  private readonly tetoGeral = new TetoPorOrigem();
  /** Os tetos desta instância. A suíte os abaixa para medir o 429 sem mandar dezenas de pedidos. */
  readonly tetos = { porOrigem: TETO_DO_FORMULARIO_POR_HORA, geral: TETO_GERAL_DO_FORMULARIO_POR_HORA };

  constructor(private readonly svc: FormularioDoSiteService) {}

  @Post('lead')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async lead(@Body() body: unknown, @Req() req?: RequisicaoComEndereco): Promise<typeof RESPOSTA_DO_FORMULARIO> {
    const origem = enderecoDeOrigem(req) ?? null;
    if (!this.teto.registrar(origem, this.tetos.porOrigem) || !this.tetoGeral.registrar('*', this.tetos.geral)) {
      this.log.warn('formulário do site: teto de envios estourado');
      throw new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Muitos envios. Tente de novo mais tarde.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.svc.receber(body);
  }
}
