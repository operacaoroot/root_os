import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AgentTokenGuard, RequireAgentScopes } from '../auth/agent-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AgentIdentity } from '../auth/agent-token.service';
import { MemoriaService } from './memoria.service';

/** Endpoint estreito da consulta PAT; MCP/UI ficam para E2c. */
@Controller('agent/memoria')
@UseGuards(AgentTokenGuard)
export class AgentMemoriaController {
  constructor(private readonly memoria: MemoriaService) {}

  @Get('buscar')
  @RequireAgentScopes('memoria.buscar')
  buscar(
    @CurrentUser() user: AgentIdentity,
    @Query() query: Record<string, unknown>,
  ) {
    const dados = z
      .object({
        q: z.string().trim().min(1).max(500),
        limite: z.coerce.number().finite().int().min(1).max(20).default(8),
      })
      .strict()
      .parse(query);
    return this.memoria.buscarParaAgente(user.orgId, dados.q, dados.limite, {
      userId: user.sub,
      tokenId: user.agentTokenId,
    });
  }
}
