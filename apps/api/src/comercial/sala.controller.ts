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
import { ReacoesDaPropostaService } from './reacoes-da-proposta.service';
import { hashDoTokenDaSala, tokenDaSalaBemFormado } from './sala-token';
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
/*
 * I4 (18/10/2026): a página da proposta escreve com frequência (uma batida de
 * leitura a cada 15 s por seção visível) e aceita texto do cliente. Além do teto
 * por origem, um teto POR TOKEN, como a regra dura da rodada pede: o mesmo link
 * aberto em várias redes não multiplica a cota. A chave é o HASH do token (o
 * mesmo que o banco guarda); o token cru não fica nem na memória do balde.
 * Reação é rara (60 por hora cobre quem anota muito); leitura com três seções
 * visíveis a cada 15 s dá 720 por hora, e o teto deixa folga para isso.
 */
export const SALA_TETO_DE_REACAO_POR_TOKEN_POR_HORA = 60;
export const SALA_TETO_DE_LEITURA_POR_TOKEN_POR_HORA = 900;
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
  private readonly tetoDeReacaoPorToken = new TetoPorOrigem();
  private readonly tetoDeLeituraPorToken = new TetoPorOrigem();
  /** Os tetos por token desta instância. A suíte os abaixa para medir o 429 sem mandar 60 pedidos. */
  readonly tetosPorToken = { reacao: SALA_TETO_DE_REACAO_POR_TOKEN_POR_HORA, leitura: SALA_TETO_DE_LEITURA_POR_TOKEN_POR_HORA };

  constructor(
    private readonly svc: SalaService,
    private readonly reacoes: ReacoesDaPropostaService,
  ) {}

  /**
   * O teto por token. Token malformado não conta (vai dar o 404 de sempre): o
   * balde só existe para link que pode ser de verdade.
   */
  private conferirTetoDoToken(token: string, qual: 'reacao' | 'leitura'): void {
    if (!tokenDaSalaBemFormado(token)) return;
    const balde = qual === 'reacao' ? this.tetoDeReacaoPorToken : this.tetoDeLeituraPorToken;
    if (!balde.registrar(hashDoTokenDaSala(token), this.tetosPorToken[qual])) {
      this.log.warn(`sala: teto por token (${qual}) estourado`);
      throw new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Muitas tentativas. Espere alguns minutos.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

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

  /** I4: as reações do próprio cliente na versão vigente (as anotações enviadas e o contador). Só lê. */
  @Get(':token/proposta/reacoes')
  @Header('Cache-Control', 'no-store')
  reacoesDaProposta(@Param('token') token: string, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.reacoes.daPagina(token);
  }

  /** I4: "faz sentido", "tenho uma dúvida" ou "anotar uma ideia" numa seção da proposta. Só grava. */
  @Post(':token/proposta/reacao')
  @Header('Cache-Control', 'no-store')
  reacao(@Param('token') token: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    this.conferirTetoDoToken(token, 'reacao');
    return this.reacoes.reagir(token, body);
  }

  /** I4: uma batida de leitura (seção, segundos visíveis desde a última, versão). Só grava. */
  @Post(':token/proposta/leitura')
  @Header('Cache-Control', 'no-store')
  leitura(@Param('token') token: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    this.conferirTetoDoToken(token, 'leitura');
    return this.reacoes.ler(token, body);
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

  /**
   * A área do cliente (leva A, 30/10/2026): o cliente abriu um item publicado.
   * Grava a leitura daquela versão (idempotente) e devolve o estado: o selo
   * "novo" some, e a bancada passa a ver "lido em". Mesmo teto por token da
   * leitura da proposta: a página chama ao ABRIR o item, não ao carregar.
   */
  @Post(':token/area/leitura')
  @Header('Cache-Control', 'no-store')
  leituraDaArea(@Param('token') token: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    this.conferirTetoDoToken(token, 'leitura');
    return this.svc.leituraDaArea(token, body);
  }
}
