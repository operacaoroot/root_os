import { Body, Controller, Get, Inject, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CONEXAO_DIRETA_DO_GRANOLA, type ConexaoDiretaDoGranola } from './conexao-direta';

/*
 * O GRANOLA DIRETO NO HTTP (rodada da interface, 20/10/2026).
 *
 * O prefixo é `trabalho/granola`, o mesmo do webhook do Zap: o primeiro
 * segmento é `trabalho`, que o gate de módulos já conhece. Nenhum prefixo novo.
 *
 * `GET callback` é PÚBLICO: quem chega é o navegador devolvido pelo Granola,
 * sem sessão. O `state` é um token assinado de 10 minutos (`typ` próprio, que o
 * guarda de sessão recusa) com a empresa e quem pediu; ele é conferido ANTES de
 * qualquer consulta, e toda falha volta para Conexões com um motivo curto, sem
 * dizer se a empresa existe. Conectar é o verbo `autorizar` do contrato
 * (`POST /integrations/granola/autorizacao`), como os outros conectores.
 *
 * Os controladores recebem a conexão por injeção: a catraca "conector só pela
 * porta" não deixa controller importar o serviço do conector.
 */
@Controller('trabalho/granola')
export class GranolaRetornoController {
  constructor(@Inject(CONEXAO_DIRETA_DO_GRANOLA) private readonly conexao: ConexaoDiretaDoGranola) {}

  @Get('callback')
  async callback(
    @Query('code') codigo: string | undefined,
    @Query('state') estado: string | undefined,
    @Query('error') erro: string | undefined,
    @Res() res: Response,
  ) {
    const destino = await this.conexao.concluirAutorizacao(
      typeof estado === 'string' ? estado : '',
      typeof codigo === 'string' ? codigo : undefined,
      typeof erro === 'string' ? erro : undefined,
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(destino);
  }
}

const RevogacaoDiretaSchema = z.object({ motivo: z.string().trim().max(500).nullish() });

/**
 * O estado da conexão direta (cartão do Granola em Conexões) e a revogação SÓ
 * dela: o Zap continua com a senha dele. A revogação do contrato
 * (`/integrations/granola/revogacao`) queima as duas.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho/granola/direto')
export class GranolaDiretoController {
  constructor(@Inject(CONEXAO_DIRETA_DO_GRANOLA) private readonly conexao: ConexaoDiretaDoGranola) {}

  @Get()
  @RequirePermissions('tarefas.ver')
  estado(@CurrentUser() u: JwtUser) {
    return this.conexao.estado(u.orgId);
  }

  @Post('revogacao')
  @RequirePermissions('admin.usuarios')
  revogar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    const { motivo } = RevogacaoDiretaSchema.parse(body ?? {});
    return this.conexao.revogar({ orgId: u.orgId, actorId: u.sub, motivo: motivo ?? 'revogada no cartão do Granola' });
  }
}
