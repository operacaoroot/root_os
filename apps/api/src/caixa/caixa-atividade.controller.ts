import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import {
  CaixaLimparSchema,
  CaixaTarefasQuerySchema,
  type CaixaAtividadeResposta,
  type CaixaLimparResposta,
  type CaixaTarefasResposta,
} from '@mktos/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { CaixaAtividadeService } from './caixa-atividade.service';
import { CaixaVistoService } from './caixa-visto.service';
import { ligado, limiteDaPagina } from './atividade-da-caixa';

/**
 * A CAIXA DE ENTRADA — `GET /api/caixa/atividade`, `GET /api/caixa/tarefas` e
 * `POST /api/caixa/limpar` (rodada do painel P1, 18/10/2026).
 *
 * CONTROLLER SEPARADO de `CaixaController` de propósito: aquele segue sem verbo
 * de escrita nenhum (a suíte `caixa.test.ts` reprova se ganhar um `@Post`), e
 * o único `@Post` daqui grava a marca pessoal de "limpei" — ver o cabeçalho de
 * `caixa-visto.service.ts` para por que essa escrita não fere a promessa da
 * caixa.
 *
 * MESMA PERMISSÃO da caixa (`dashboard.ver`, que todo perfil de gente tem), e
 * o quadro é conferido DENTRO do serviço (`tarefas.ver` e o módulo `trabalho`),
 * como em `/caixa`. Mesmo prefixo, já declarado em `PREFIXOS_DA_ESPINHA`.
 *
 * Os comentários da tarefa (o popover da aba Minhas tarefas) NÃO têm rota
 * aqui: a tela usa `GET /trabalho/tarefas/:id`, a rota dona, com a permissão e o
 * gate de módulo dela. Uma segunda rota de comentários seria um segundo lugar
 * para esquecer uma trava.
 *
 * Rotas sem parâmetro: não há `:id` para engolir `atividade`, `tarefas` ou
 * `limpar`, e o `@Get()` de `CaixaController` só casa `/caixa` exato.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('caixa')
export class CaixaAtividadeController {
  constructor(
    private readonly leitura: CaixaAtividadeService,
    private readonly vistos: CaixaVistoService,
  ) {}

  @Get('atividade')
  @RequirePermissions('dashboard.ver')
  atividade(
    @CurrentUser() user: JwtUser,
    @Query() query: Record<string, unknown> = {},
  ): Promise<CaixaAtividadeResposta> {
    return this.leitura.atividade({
      orgId: user.orgId,
      usuarioId: user.sub,
      permissoes: user.permissions ?? [],
      antesDe: typeof query.antesDe === 'string' ? query.antesDe : null,
      incluirLimpos: ligado(query.incluirLimpos),
      incluirMeus: ligado(query.incluirMeus),
      limite: limiteDaPagina(query.limite),
    });
  }

  @Get('tarefas')
  @RequirePermissions('dashboard.ver')
  tarefas(
    @CurrentUser() user: JwtUser,
    @Query() query: Record<string, unknown> = {},
  ): Promise<CaixaTarefasResposta> {
    return this.leitura.tarefas({
      orgId: user.orgId,
      usuarioId: user.sub,
      permissoes: user.permissions ?? [],
      filtros: CaixaTarefasQuerySchema.parse(query),
    });
  }

  @Post('limpar')
  @HttpCode(200)
  @RequirePermissions('dashboard.ver')
  limpar(@CurrentUser() user: JwtUser, @Body() body: unknown): Promise<CaixaLimparResposta> {
    return this.vistos.limpar({
      orgId: user.orgId,
      usuarioId: user.sub,
      entrada: CaixaLimparSchema.parse(body),
    });
  }
}
