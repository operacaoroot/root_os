import { ConsoleLogger } from '@nestjs/common';
import { camposDeContexto } from './contexto-execucao';

/*
 * O LOG CARREGA A CORRELAÇÃO (RNF-09).
 *
 * O problema que isto resolve: a API loga `porta em modo IMPOR`,
 * `whatsapp.mensagem.enviar executada após aprovação de pedro`,
 * `[observar] RETIDO ...` — cada linha de um serviço diferente, nenhuma dizendo
 * a que jornada pertence. Com dois agentes rodando ao mesmo tempo, o log é uma
 * conversa cruzada onde não dá para saber qual frase responde qual.
 *
 * A correlação já viaja no `ContextoExecucao`; o que faltava era o log lê-la. E
 * o log não pode receber o contexto por parâmetro: `new Logger('ToolGateway')`
 * é chamado de dentro de qualquer serviço, sem acesso ao pedido. É exatamente o
 * caso para o armazém.
 *
 * ONDE ISTO É INSTALADO: `main.ts`, com `app.useLogger(new LoggerDeCorrelacao())`.
 *
 * É o ponto canônico do Nest, e a escolha não é de gosto. Por baixo,
 * `app.useLogger()` faz o mesmo `Logger.overrideLogger()` — troca o destino de
 * TODA instância de `Logger`, inclusive as já construídas, porque `Logger`
 * delega para uma referência estática. Uma instalação cobre o processo inteiro,
 * sem tocar em nenhum dos ~40 serviços que já logam.
 *
 * Instalar de dentro de um módulo (era o que o `ContextoModule` fazia) usa o
 * MESMO mecanismo por outro caminho: quem acrescentasse o `app.useLogger()`
 * canônico ao arranque venceria em silêncio, porque roda depois — e a
 * correlação sumiria do log sem erro nenhum, só parando de aparecer. Efeito de
 * processo inteiro disparado do `onModuleInit` de um módulo de infraestrutura
 * também é invisível para quem procura "onde o logger foi trocado".
 *
 * Efeito colateral bem-vindo da mudança: os scripts de `src/scripts/` criam o
 * contexto da aplicação com `logger: ['error','warn']` e agora esse recorte
 * vale de verdade — antes o `onModuleInit` o atropelava no boot.
 */
export class LoggerDeCorrelacao extends ConsoleLogger {
  /**
   * Prefixo estruturado antes da mensagem: `[cor:… org:… ator:…]`. Prefixo, e
   * não sufixo, porque o `optionalParams` do Nest termina com o contexto do
   * logger (`ToolGateway`, `Efeitos`) e mexer no fim daquela lista quebraria a
   * formatação de quem chama com stack trace.
   */
  private marcar(mensagem: unknown): unknown {
    const campos = camposDeContexto();
    const chaves = Object.keys(campos);
    if (chaves.length === 0) return mensagem;
    const marca = `[${chaves.map((k) => `${k}:${campos[k]}`).join(' ')}]`;
    return typeof mensagem === 'string' ? `${marca} ${mensagem}` : mensagem;
  }

  log(mensagem: unknown, ...resto: unknown[]): void {
    super.log(this.marcar(mensagem) as string, ...(resto as [string]));
  }

  error(mensagem: unknown, ...resto: unknown[]): void {
    super.error(this.marcar(mensagem) as string, ...(resto as [string]));
  }

  warn(mensagem: unknown, ...resto: unknown[]): void {
    super.warn(this.marcar(mensagem) as string, ...(resto as [string]));
  }

  debug(mensagem: unknown, ...resto: unknown[]): void {
    super.debug(this.marcar(mensagem) as string, ...(resto as [string]));
  }

  verbose(mensagem: unknown, ...resto: unknown[]): void {
    super.verbose(this.marcar(mensagem) as string, ...(resto as [string]));
  }

  // `fatal` acorda gente de madrugada (09-PADRÕES, parte 3, §2). Deixá-lo de
  // fora seria perder a correlação exatamente na linha em que ela mais serve.
  fatal(mensagem: unknown, ...resto: unknown[]): void {
    super.fatal(this.marcar(mensagem) as string, ...(resto as [string]));
  }
}
