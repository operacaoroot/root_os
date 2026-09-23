import {
  BadRequestException,
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
import { z } from 'zod';

import { enderecoDeOrigem, type RequisicaoComEndereco } from '../../auth/endereco-de-origem';
import { MAX_BYTES_DE_AUDIO } from '../../llm/transcricao.provider';
import { LinkPublicoService } from './link-publico.service';

/* ==========================================================================
 * O LINK DO CLIENTE — as rotas anônimas
 * ==========================================================================
 *
 * Sem guard, como `/api/events/track` e a bio pública: quem abre o link não
 * tem token e não vai ter. O que segura:
 *
 *   · o TOKEN (256 bits) é a única credencial, e a rota responde 404 igual
 *     para inexistente, expirado e revogado;
 *   · TETO DE TAXA por origem, em memória, para a rota anônima não virar
 *     ferramenta de varredura nem de gasto (o áudio chama modelo);
 *   · `Cache-Control: no-store` — resposta com dado do cliente nunca fica em
 *     cache compartilhado (o mesmo argumento do mapa público).
 *
 * O prefixo `tenants` é espinha do OS: requisição anônima passa pelo gate de
 * módulos de propósito, e a família já está declarada.
 */

const NomeSchema = z.object({ nome: z.string().trim().max(120).nullish() });
const TextoSchema = NomeSchema.extend({ texto: z.string().min(1).max(4000) });

/** Por origem e por hora. Ler o estado é barato; o áudio é o caro. */
const TETO_POR_HORA = 600;
const TETO_DE_AUDIO_POR_HORA = 60;
const HORA_MS = 3_600_000;

class TetoPorOrigem {
  private readonly baldes = new Map<string, { ate: number; n: number }>();

  registrar(origem: string | null, teto: number, agora = Date.now()): boolean {
    const chave = origem ?? 'desconhecida';
    const b = this.baldes.get(chave);
    if (!b || b.ate <= agora) {
      this.baldes.set(chave, { ate: agora + HORA_MS, n: 1 });
      if (this.baldes.size > 5000) this.baldes.clear();
      return true;
    }
    b.n += 1;
    return b.n <= teto;
  }
}

@Controller('tenants/onboarding/link')
export class LinkPublicoController {
  private readonly log = new Logger('OnboardingLink');
  private readonly teto = new TetoPorOrigem();
  private readonly tetoDeAudio = new TetoPorOrigem();

  constructor(private readonly svc: LinkPublicoService) {}

  private conferirTeto(req: RequisicaoComEndereco | undefined, audio = false): void {
    const origem = enderecoDeOrigem(req) ?? null;
    const ok = audio
      ? this.tetoDeAudio.registrar(origem, TETO_DE_AUDIO_POR_HORA)
      : this.teto.registrar(origem, TETO_POR_HORA);
    if (!ok) {
      this.log.warn(`link público: teto de taxa (${audio ? 'áudio' : 'geral'}) estourado para ${origem ?? '?'}`);
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Muitas tentativas. Espere alguns minutos.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  estado(@Param('token') token: string, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.estado(token);
  }

  @Get(':token/retrato')
  @Header('Cache-Control', 'no-store')
  retrato(@Param('token') token: string, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.retrato(token);
  }

  @Post(':token/itens/:temaId/confirmar')
  @Header('Cache-Control', 'no-store')
  confirmar(@Param('token') token: string, @Param('temaId') temaId: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.confirmar(token, temaId, NomeSchema.parse(body ?? {}).nome ?? null);
  }

  @Post(':token/itens/:temaId/corrigir')
  @Header('Cache-Control', 'no-store')
  corrigir(@Param('token') token: string, @Param('temaId') temaId: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    const { texto, nome } = TextoSchema.parse(body);
    return this.svc.corrigir(token, temaId, texto, nome ?? null);
  }

  @Post(':token/itens/:temaId/responder')
  @Header('Cache-Control', 'no-store')
  responder(@Param('token') token: string, @Param('temaId') temaId: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    const { texto, nome } = TextoSchema.parse(body);
    return this.svc.responder(token, temaId, texto, nome ?? null, 'texto');
  }

  @Post(':token/itens/:temaId/audio')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES_DE_AUDIO } }))
  audio(
    @Param('token') token: string,
    @Param('temaId') temaId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { nome?: string },
    @Req() req?: RequisicaoComEndereco,
  ) {
    this.conferirTeto(req, true);
    if (!file) throw new BadRequestException('nenhum áudio enviado (campo "file").');
    const nome = typeof body?.nome === 'string' ? body.nome.trim().slice(0, 120) : null;
    return this.svc.responderPorAudio(token, temaId, file.buffer, file.mimetype, nome || null);
  }

  @Post(':token/concluir')
  @Header('Cache-Control', 'no-store')
  concluir(@Param('token') token: string, @Body() body: unknown, @Req() req?: RequisicaoComEndereco) {
    this.conferirTeto(req);
    return this.svc.concluir(token, NomeSchema.parse(body ?? {}).nome ?? null);
  }
}
