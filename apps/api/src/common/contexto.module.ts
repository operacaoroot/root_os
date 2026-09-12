import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ContextoInterceptor } from './contexto.interceptor';

/*
 * Liga o contexto de execução à aplicação: um interceptor global que abre o
 * escopo de cada requisição (RF-T-04, RNF-09).
 *
 * `APP_INTERCEPTOR` declarado em módulo importado vale para a aplicação
 * inteira. Este módulo é importado pelo `AppModule` — o módulo RAIZ —, e não
 * por um módulo de domínio: quem abre contexto para todas as rotas pertence à
 * lista de infraestrutura do topo, onde se procura por ele.
 *
 * O logger correlacionado NÃO é instalado aqui. Ele é efeito de processo
 * inteiro e mora no `main.ts`, com `app.useLogger()` — ver a explicação em
 * `logger-correlacao.ts`.
 */
// Sem `@Global()`: o módulo não exporta provider nenhum. O que ele instala —
// um interceptor global — já vale para a aplicação inteira.
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: ContextoInterceptor }],
})
export class ContextoModule {}
