import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { autenticarCorpo, caminhoSemPrefixo, ehTokenDeCorpo, rotaDoAgenteDoCorpo, type CorpoAutenticado } from '../auth/corpo-externo';

/** A requisição depois do guarda: o corpo, quando entrou com token de corpo. */
export interface RequisicaoDoCorpo {
  corpoExterno?: CorpoAutenticado;
  user?: { orgId: string; sub?: string };
}

/*
 * ============================================================================
 * O GUARDA DAS ROTAS DO PRÓPRIO AGENTE: o corpo dele, ou uma pessoa (A4)
 * ============================================================================
 *
 * Três rotas aceitam o token do corpo: a de execução de uma capacidade, o
 * catálogo e a definição do agente — e SÓ do agente do token
 * (`rotaDoAgenteDoCorpo`): o token do Hermes da Rootinha não abre
 * `/agents/briefing-diario/...`. Entrando por aqui, o corpo NÃO ganha
 * permissão de papel nenhuma: o que ele pode é o que o agente declarou, e quem
 * confere é a porta, capacidade por capacidade.
 *
 * Sem token de corpo, a mesma rota é do console: o `JwtAuthGuard` de sempre e
 * as permissões que a rota declara (`@RequirePermissions`), pelo
 * `PermissionsGuard` de sempre. Os dois guardas são montados aqui dentro, e não
 * empilhados na rota, porque a ordem é "ou um ou outro", e `@UseGuards` só sabe
 * "um e depois o outro".
 */
@Injectable()
export class CorpoOuSessaoGuard implements CanActivate {
  private readonly sessao: JwtAuthGuard;
  private readonly permissoes: PermissionsGuard;

  constructor(
    jwt: JwtService,
    reflector: Reflector,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() politica?: PolicyService,
  ) {
    this.sessao = new JwtAuthGuard(jwt, prisma, politica);
    this.permissoes = new PermissionsGuard(reflector);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers?.['authorization'] as string | undefined;
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

    if (ehTokenDeCorpo(bearer)) {
      if (!this.prisma) throw new UnauthorizedException('Token inválido');
      const corpo = await autenticarCorpo(this.prisma, bearer);
      if (!corpo) throw new UnauthorizedException('Token inválido');
      const caminho = caminhoSemPrefixo(String(req.path ?? req.originalUrl ?? '').split('?')[0]);
      if (!rotaDoAgenteDoCorpo(corpo.agentSlug, String(req.method ?? ''), caminho)) {
        throw new UnauthorizedException('O token deste corpo só abre as rotas do agente dele.');
      }
      req.corpoExterno = corpo;
      // Só a empresa: é dela que o contexto de execução e os portões de módulo e de
      // suspensão precisam. Sem `sub`, o contexto não finge que há uma pessoa logada.
      req.user = { orgId: corpo.orgId };
      return true;
    }

    await this.sessao.canActivate(ctx);
    return this.permissoes.canActivate(ctx);
  }
}
