import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CONEXAO_DO_YOUTUBE, type ConexaoDoYoutube } from './conexao-do-youtube';

/*
 * O retorno do OAuth do YouTube (MD10) — PÚBLICO: quem chega é o navegador
 * redirecionado pelo Google, sem sessão. O `state` é um token assinado de 10
 * minutos (`typ` próprio, que o guarda de sessão recusa) com a empresa e quem
 * pediu; ele é conferido ANTES de qualquer consulta, e toda falha volta para a
 * mesma tela com um motivo curto, sem dizer se a empresa existe.
 *
 * Prefixo `youtube` = módulo `pauta` (`tenants/modulos.ts`): a rota anônima
 * passa pelo gate de módulos, como o callback da bio.
 */
@Controller('youtube')
export class YoutubeConexaoController {
  constructor(@Inject(CONEXAO_DO_YOUTUBE) private readonly conexao: ConexaoDoYoutube) {}

  @Get('callback')
  async callback(
    @Query('code') codigo: string | undefined,
    @Query('state') estado: string | undefined,
    @Query('error') erro: string | undefined,
    @Res() res: Response,
  ) {
    const destino = await this.conexao.concluirAutorizacao(String(estado ?? ''), typeof codigo === 'string' ? codigo : undefined, typeof erro === 'string' ? erro : undefined);
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(destino);
  }
}
