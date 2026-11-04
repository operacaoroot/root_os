import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, mergeMap } from 'rxjs';
import { ClienteEscopoService } from './cliente-escopo.service';
import { ESCOPO_CLIENTE_ADAPTADO, ESCOPO_IDENTIDADE_PROPRIA } from './cliente-escopo.decorator';
@Injectable()
export class ClienteEscopoInterceptor implements NestInterceptor {
  constructor(private readonly reflector:Reflector,private readonly escopo:ClienteEscopoService) {}
  intercept(ctx:ExecutionContext,next:CallHandler):Observable<unknown> {
    if(ctx.getType()!=='http') return next.handle();
    const user=ctx.switchToHttp().getRequest()?.user;
    if(!user) return next.handle(); // rotas públicas têm autorização própria (capacidade, assinatura etc.)
    // Só métodos explicitamente marcados; não herdar marcação da classe.
    if(this.reflector.get(ESCOPO_IDENTIDADE_PROPRIA,ctx.getHandler())) return next.handle();
    return from(this.escopo.perfil(user.orgId,user.sub)).pipe(mergeMap(perfil=>{
      if(perfil.modo!=='ALL'&&!this.reflector.get(ESCOPO_CLIENTE_ADAPTADO,ctx.getHandler()))
        throw new ForbiddenException('Esta área ainda não está disponível para acesso por cliente.');
      return next.handle();
    }));
  }
}
