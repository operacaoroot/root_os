import { Body, Controller, Header, Headers, HttpCode, HttpException, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { enderecoDeOrigem, type RequisicaoComEndereco } from '../auth/endereco-de-origem';
import { FrotaService } from './frota.service';
import { ResultadosSchema } from './frota.schemas';

/*
 * A PORTA DO RELATOR — anônima, autenticada pelo token da casa no cabeçalho
 * `X-Frota-Token`. É o `kit-relatar` do kit-instalacao-vps quem bate aqui, a
 * cada 5 min, de dentro do servidor do cliente (saída HTTPS; nenhuma porta
 * nova no cliente).
 *
 * Teto por token (um relato a cada 5 min dá 12 por hora; 60 sobra para o
 * reenvio depois de uma ordem) e teto geral por endereço, para o dia em que
 * alguém apontar um laço para cá.
 */
const HORA_MS = 3_600_000;
const TETO_POR_TOKEN_HORA = 60;
const TETO_POR_ORIGEM_HORA = 600;

class Balde {
  private readonly itens = new Map<string, { ate: number; n: number }>();
  registrar(chave: string, teto: number, agora = Date.now()): boolean {
    const b = this.itens.get(chave);
    if (!b || b.ate <= agora) {
      if (this.itens.size > 5000) this.itens.clear();
      this.itens.set(chave, { ate: agora + HORA_MS, n: 1 });
      return true;
    }
    b.n += 1;
    return b.n <= teto;
  }
}

@Controller('frota/relator')
export class FrotaRelatorController {
  private readonly log = new Logger('FrotaRelator');
  private readonly porToken = new Balde();
  private readonly porOrigem = new Balde();

  constructor(private readonly frota: FrotaService) {}

  private conferirTeto(token: string | undefined, req?: RequisicaoComEndereco) {
    const origem = enderecoDeOrigem(req) ?? 'desconhecida';
    const chaveDoToken = token ? createHash('sha256').update(token).digest('hex').slice(0, 16) : 'sem-token';
    if (!this.porOrigem.registrar(origem, TETO_POR_ORIGEM_HORA) || !this.porToken.registrar(chaveDoToken, TETO_POR_TOKEN_HORA)) {
      this.log.warn(`relator: teto estourado (${origem})`);
      throw new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Muitos relatos. O timer do kit manda um a cada 5 min.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  @Post('relato')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  relato(@Headers('x-frota-token') token: string | undefined, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(token, req);
    return this.frota.receberRelato(token, body);
  }

  @Post('resultados')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  resultados(@Headers('x-frota-token') token: string | undefined, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(token, req);
    return this.frota.receberResultados(token, ResultadosSchema.parse(body));
  }
}
