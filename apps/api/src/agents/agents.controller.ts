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
  @RequirePermissions('automacoes.executar')
  linhaDeBase(
    @CurrentUser() user: JwtUser,
    @Param('slug') slug: string,
    @Body() body: unknown,
  ) {
    const { minutos } = z.object({ minutos: z.number().int().positive() }).parse(body);
    return this.agentes.declararLinhaDeBase(user.orgId, slug, minutos, user.sub);
  }

  @Post('agents/:slug/executar')
  @RequirePermissions('mcp.executar')
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
  @RequirePermissions('mcp.executar')
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
