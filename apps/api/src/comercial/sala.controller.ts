import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { enderecoDeOrigem, type RequisicaoComEndereco } from '../auth/endereco-de-origem';
import { SalaService } from './sala.service';

/*
 * A SALA DO CLIENTE — rotas ANÔNIMAS do link (`/api/sala/:token`), Lane B.
 *
 * O mesmo contrato de `tenants/onboarding/link`: não há sessão, a empresa é
 * achada pelo HASH do token (sentinela pública) e o resto do pedido roda em
 * `comTenantPublico`. Token inexistente, expirado e revogado respondem a MESMA
 * coisa (404 sem detalhe). Teto de taxa por origem, em memória, como o do
 * onboarding: a rota anônima não vira ferramenta de varredura. Resposta com
 * dado do cliente nunca fica em cache compartilhado (`no-store`).
 *
 * O prefixo `sala` está declarado em `tenants/modulos.ts` como módulo `leads`.
 */

/** Por origem e por hora. Ler o estado é barato; o arquivo é o caro. */
export const SALA_TETO_POR_HORA = 600;
export const SALA_TETO_DE_ARQUIVO_POR_HORA = 30;
const HORA_MS = 3_600_000;

export class TetoPorOrigem {
  private readonly baldes = new Map<string, { ate: number; n: number }>();

  registrar(origem: string | null, teto: number, agora = Date.now()): boolean {
    const chave = origem ?? 'desconhecida';
    const b = this.baldes.get(chave);
    if (!b || b.ate <= agora) {
      if (this.baldes.size > 5000) this.baldes.clear();
      this.baldes.set(chave, { ate: agora + HORA_MS, n: 1 });
      return true;
    }
    b.n += 1;
    return b.n <= teto;
  }
}

@Controller('sala')
export class SalaController {
  private readonly log = new Logger('ComercialSalaLink');
  private readonly teto = new TetoPorOrigem();
  private readonly tetoDeArquivo = new TetoPorOrigem();

  constructor(private readonly svc: SalaService) {}

  private conferirTeto(req: RequisicaoComEndereco | undefined, arquivo = false): void {
    const origem = enderecoDeOrigem(req) ?? null;
    const ok = arquivo ? this.tetoDeArquivo.registrar(origem, SALA_TETO_DE_ARQUIVO_POR_HORA) : this.teto.registrar(origem, SALA_TETO_POR_HORA);
    if (!ok) {
      this.log.warn(`sala: teto de taxa (${arquivo ? 'arquivo' : 'geral'}) estourado para ${origem ?? '?'}`);
      throw new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Muitas tentativas. Espere alguns minutos.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** O estado da sala: estágio, plano de ação, proposta, aceite, começo. Só lê (B-11). */
  @Get(':token')
  @Header('Cache-Control', 'no-store')
  estado(@Param('token') token: string, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.estado(token, new Date());
  }

  /** A visita de gente (B-11): a página chama uma vez ao abrir; conta o acesso e o fato do dia. */
  @Post(':token/visita')
  @Header('Cache-Control', 'no-store')
  visita(@Param('token') token: string, @Req() req?: RequisicaoComEndereco & { headers?: Record<string, string | string[] | undefined> }) {
    this.conferirTeto(req);
    const ua = req?.headers?.['user-agent'];
    return this.svc.visita(token, new Date(), { userAgent: Array.isArray(ua) ? ua[0] : ua ?? null });
  }

  /** O formulário de qualificação (tela 01). */
  @Post(':token/form')
  @Header('Cache-Control', 'no-store')
  form(@Param('token') token: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.form(token, body);
  }

  /** A escolha de horário entre os oferecidos (tela 01/02). */
  @Post(':token/agenda')
  @Header('Cache-Control', 'no-store')
  agenda(@Param('token') token: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.agenda(token, body);
  }

  /** O arquivo opcional (tela 02: "deixe pronto um relatório de fechamento"). */
  @Post(':token/arquivo')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  arquivo(@Param('token') token: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req, true);
    return this.svc.arquivo(token, file);
  }

  /** Leitura rastreada por bloco (tela 07): o termômetro do follow-up. */
  @Post(':token/proposta/lida')
  @Header('Cache-Control', 'no-store')
  propostaLida(@Param('token') token: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.propostaLida(token, body);
  }

  /** "Tirar uma dúvida": grava o fato; a resposta é do assistente da proposta (lane E). */
  @Post(':token/proposta/duvida')
  @Header('Cache-Control', 'no-store')
  duvida(@Param('token') token: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.duvida(token, body);
  }

  /** "Pedir ajuste": grava o fato; a decisão na fila é aberta pela espinha. */
  @Post(':token/proposta/ajuste')
  @Header('Cache-Control', 'no-store')
  ajuste(@Param('token') token: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.ajuste(token, body);
  }

  /** Tela 08, passo 1: os dados do contratante. */
  @Post(':token/aceite/dados')
  @Header('Cache-Control', 'no-store')
  aceiteDados(@Param('token') token: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.aceiteDados(token, body);
  }

  /** Tela 08, passo 2: aceitar a oferta e escolher a forma (a cobrança é da lane D). */
  @Post(':token/aceite/pagamento')
  @Header('Cache-Control', 'no-store')
  aceitePagamento(@Param('token') token: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.aceitePagamento(token, body);
  }

  /** Tela 08, passo 3: o contrato para assinar (lane D). */
  @Post(':token/aceite/contrato')
  @Header('Cache-Control', 'no-store')
  aceiteContrato(@Param('token') token: string, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.aceiteContrato(token);
  }

  /** O começo: o horário do kickoff. */
  @Post(':token/kickoff/horario')
  @Header('Cache-Control', 'no-store')
  kickoff(@Param('token') token: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.kickoff(token, body);
  }
}
