import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { Observable, Subscription } from 'rxjs';
import {
  ContextoExecucao,
  comContexto,
  marcarCorrelacaoExterna,
  novaCorrelacao,
} from './contexto-execucao';

/**
 * O que o `JwtAuthGuard` deixa em `req.user`. Declarado aqui de forma estrutural
 * para `common/` não depender de `auth/` — a dependência aponta para dentro
 * (09-PADRÕES §1), e este arquivo é o mais externo dos dois.
 */
interface UsuarioDoPedido {
  sub?: string;
  orgId?: string;
}

/**
 * Cabeçalho de correlação vindo de fora é CONTEÚDO, não instrução: ele entra em
 * linha de log e em resposta HTTP. Aceito só o que é inofensivo nesses dois
 * lugares — sem espaço, sem quebra de linha, sem caractere de controle, e curto.
 * Qualquer coisa fora disso é descartada e a requisição ganha id próprio.
 *
 * 100, e não 120: o que é aceito ainda ganha o prefixo de procedência externa
 * antes de virar o identificador oficial (ver `marcarCorrelacaoExterna`).
 */
const CORRELACAO_ACEITAVEL = /^[A-Za-z0-9_.:-]{1,100}$/;

const CABECALHOS = ['x-correlation-id', 'x-request-id'] as const;

/*
 * ABRE O CONTEXTO DE EXECUÇÃO DE CADA REQUISIÇÃO.
 *
 * Roda DEPOIS dos guards — é assim que a ordem do Nest funciona (middleware →
 * guard → interceptor → handler) — e é justamente o que se quer: quando este
 * código roda, o `JwtAuthGuard` já resolveu quem é o usuário e de que empresa,
 * então o contexto nasce completo em vez de nascer pela metade e ser remendado.
 *
 * ROTA PÚBLICA NÃO GANHA TENANT DE CONSOLAÇÃO. Sem usuário, `orgId` fica `null`
 * e quem precisar de empresa LANÇA (RF-T-04). O contexto continua existindo por
 * causa da correlação: uma chamada anônima que estoura precisa aparecer no log
 * com o mesmo identificador do resto da jornada.
 *
 * POR QUE O `new Observable` EM VEZ DE `return comContexto(ctx, () =>
 * next.handle())`
 * `next.handle()` devolve um observable PREGUIÇOSO: o handler da rota só roda
 * quando alguém assina. Devolver o observable de dentro do `run` fecha o escopo
 * antes da assinatura e o contexto chega vazio no handler. Assinando aqui
 * dentro, o handler inteiro — e tudo que ele chamar — roda dentro do escopo.
 */
@Injectable()
export class ContextoInterceptor implements NestInterceptor {
  intercept(execCtx: ExecutionContext, next: CallHandler): Observable<unknown> {
    // WebSocket, gRPC e o laço de cron não têm requisição; não há o que abrir.
    if (execCtx.getType() !== 'http') return next.handle();

    const req = execCtx.switchToHttp().getRequest();
    const correlationId = this.correlacaoDoPedido(req) ?? novaCorrelacao('http');
    const usuario = req?.user as UsuarioDoPedido | undefined;

    const ctx: ContextoExecucao = {
      orgId: usuario?.orgId ?? null,
      actorType: usuario?.sub ? ActorType.user : null,
      actorId: usuario?.sub ?? null,
      agentSlug: null,
      correlationId,
      origem: 'http',
    };

    // Devolve a correlação para quem chamou: sem isto, o front tem o erro na
    // tela e o log tem a causa, e ninguém consegue juntar os dois. Cabeçalho de
    // resposta é por requisição — rota que responde CACHEÁVEL tem de derrubá-lo
    // antes de escrever o corpo (ver `bio-public.controller.ts`, o avatar).
    req.correlationId = correlationId;
    execCtx.switchToHttp().getResponse()?.setHeader?.('x-correlation-id', correlationId);

    return new Observable((assinante) => {
      let assinatura: Subscription | undefined;
      comContexto(ctx, () => {
        assinatura = next.handle().subscribe(assinante);
      });
      return () => assinatura?.unsubscribe();
    });
  }

  /*
   * A correlação que o CHAMADOR mandou — aceita, mas nunca confundida com a
   * nossa.
   *
   * Continuamos reaproveitando o identificador de fora, porque é ele que liga o
   * log daqui ao de quem chamou (e o front precisa disso). O que muda é que ele
   * entra MARCADO: o valor oficial da requisição passa a ser `ext-<o que veio>`.
   *
   * Por que marcar em vez de só aceitar de proxy confiável. As duas saídas
   * fecham o furo; a diferença é o que custam. Confiar no proxy exigiria o
   * Traefik apagar `x-correlation-id` e `x-request-id` do cliente antes de
   * repassar — configuração de infraestrutura que hoje não existe, que o
   * `docker-compose.yml` não descreve, e cujo esquecimento reabre o buraco em
   * silêncio, sem nada no código denunciando. A marca vale no processo, viaja
   * junto com o identificador para o log, para a resposta e para o RASTRO, e
   * não depende de ninguém configurar nada. Quando houver proxy que higienize
   * de verdade, ele passa a ser uma defesa a mais, não a única.
   */
  private correlacaoDoPedido(req: { headers?: Record<string, unknown> }): string | null {
    for (const nome of CABECALHOS) {
      const bruto = req?.headers?.[nome];
      const valor = Array.isArray(bruto) ? bruto[0] : bruto;
      if (typeof valor === 'string' && CORRELACAO_ACEITAVEL.test(valor)) {
        return marcarCorrelacaoExterna(valor);
      }
    }
    return null;
  }
}
