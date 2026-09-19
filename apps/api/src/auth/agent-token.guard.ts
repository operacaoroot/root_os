import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AgentTokenService } from './agent-token.service';

export const AGENT_SCOPES_KEY = 'agent_token_scopes';

/** Toda rota de agente precisa declarar sua capacidade mínima explicitamente. */
export const RequireAgentScopes = (...scopes: string[]) =>
  SetMetadata(AGENT_SCOPES_KEY, scopes);

/**
 * Guarda separado do JWT de sessão. Só rotas de agente devem opt-in neste
 * guarda; rotas humanas continuam exclusivamente com JwtAuthGuard.
 */
@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: AgentTokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'] as string | undefined;
    if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('Sem token.');
    const user = await this.tokens.resolverBearer(auth.slice('Bearer '.length));
    const required = this.reflector.getAllAndOverride<string[]>(AGENT_SCOPES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) throw new ForbiddenException('A rota de agente não declarou escopo.');
    if (!required.every((scope) => (user.agentTokenScopes as readonly string[]).includes(scope))) {
      throw new ForbiddenException('Escopo do token insuficiente.');
    }
    req.user = user;
    return true;
  }
}
