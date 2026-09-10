import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionCanal } from '@prisma/client';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { AgentsService } from './agents.service';
import { AgentRuntime } from './agent-runtime.service';
import { SessionService } from './session.service';

const PedidoSchema = z.object({
  pedido: z.string().min(1).max(4000),
  canal: z.nativeEnum(SessionCanal).default(SessionCanal.web),
  canalRef: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});

/*
 * QUEM PODE FAZER UM AGENTE RODAR (RF-G-03 · LLM06 · fatia 0.3a).
 *
 * `mcp.executar` sozinho não serve de trava: ele está no perfil `ia_servico`,
 * que o próprio catálogo descreve como "só leitura (menor privilégio)", e
 * também no `ia_acao`. Ou seja, a conta de serviço da IA podia disparar um
 * agente — e um agente alcança a porta, que alcança conector.
 *
 * Enquanto não existir uma permissão dedicada (`agentes.executar` em
 * packages/shared/src/permissions.ts, que é decisão humana e mora fora desta
 * fatia), a trava é a mesma que o resto do código já usa para superfície de
 * administrador: `admin.usuarios` — hoje só o perfil `admin_master`. As rotas
 * de LEITURA seguem em `mcp.ver`: elas não fazem nada acontecer, e fechá-las
 * cegaria o painel sem fechar buraco nenhum.
 *
 * O guarda exige TODAS as permissões da lista (PermissionsGuard usa `every`),
 * então isto é interseção, não alternativa.
 */
const EXECUTAR_AGENTE = ['mcp.executar', 'admin.usuarios'] as const;

/** Declarar a linha de base é escrita na configuração do agente, não execução. */
const CONFIGURAR_AGENTE = ['automacoes.executar', 'admin.usuarios'] as const;

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class AgentsController {
  constructor(
    private readonly agentes: AgentsService,
    private readonly runtime: AgentRuntime,
    private readonly sessoes: SessionService,
  ) {}

  @Get('agents')
  @RequirePermissions('mcp.ver')
  roster(@CurrentUser() user: JwtUser) {
    return this.agentes.roster(user.orgId);
  }

  @Get('agents/:slug')
  @RequirePermissions('mcp.ver')
  detalhe(@CurrentUser() user: JwtUser, @Param('slug') slug: string) {
    return this.agentes.detalhe(user.orgId, slug);
  }

  @Post('agents/:slug/linha-de-base')
  @RequirePermissions(...CONFIGURAR_AGENTE)
  linhaDeBase(
    @CurrentUser() user: JwtUser,
    @Param('slug') slug: string,
    @Body() body: unknown,
  ) {
    const { minutos } = z.object({ minutos: z.number().int().positive() }).parse(body);
    return this.agentes.declararLinhaDeBase(user.orgId, slug, minutos, user.sub);
  }

  @Post('agents/:slug/executar')
  @RequirePermissions(...EXECUTAR_AGENTE)
  executar(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    const input = PedidoSchema.parse(body);
    return this.runtime.executar({
      orgId: user.orgId,
      agentSlug: slug,
      canal: input.canal,
      canalRef: input.canalRef,
      sessionId: input.sessionId,
      pedido: input.pedido,
      solicitanteId: user.sub,
      solicitanteRotulo: user.name ?? user.sub,
    });
  }

  /*
   * O mesmo pedido, respondendo em pedaços.
   *
   * SSE e não WebSocket: o tráfego é de mão única. E com effort alto o primeiro
   * token demora dezenas de segundos — sem streaming a tela fica muda o tempo
   * todo e parece travada.
   *
   * POST que responde text/event-stream porque EventSource não manda header, e
   * token em query string é dado sensível em URL. O front lê com fetch +
   * ReadableStream.
   */
  @Post('agents/:slug/stream')
  @RequirePermissions(...EXECUTAR_AGENTE)
  async stream(
    @CurrentUser() user: JwtUser,
    @Param('slug') slug: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const input = PedidoSchema.parse(body);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // O proxy do Next bufferiza por padrão e o stream chegaria de uma vez só.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const manda = (e: unknown) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };

    try {
      await this.runtime.executar({
        orgId: user.orgId,
        agentSlug: slug,
        canal: input.canal,
        canalRef: input.canalRef,
        sessionId: input.sessionId,
        pedido: input.pedido,
        solicitanteId: user.sub,
        solicitanteRotulo: user.name ?? user.sub,
        onEvento: manda,
      });
    } catch (e) {
      manda({ t: 'erro', mensagem: (e as Error).message });
    } finally {
      res.end();
    }
  }

  @Get('sessions')
  @RequirePermissions('mcp.ver')
  listar(
    @CurrentUser() user: JwtUser,
    @Query('canal') canal?: string,
    @Query('agente') agente?: string,
    @Query('limit') limit?: string,
  ) {
    const canalValido =
      canal && (Object.values(SessionCanal) as string[]).includes(canal)
        ? (canal as SessionCanal)
        : undefined;
    return this.sessoes.listar(user.orgId, {
      canal: canalValido,
      agentSlug: agente,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('sessions/:id')
  @RequirePermissions('mcp.ver')
  traco(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.sessoes.traco(user.orgId, id);
  }
}
