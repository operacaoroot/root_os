import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ActorType } from '@prisma/client';

/*
 * O CONTEXTO DE EXECUÇÃO — quem age, por conta de qual empresa, dentro de qual
 * história (RF-T-04, RNF-09).
 *
 * Três coisas viajam juntas do começo ao fim de um pedido:
 *
 *  - TENANT (`orgId`). "Nenhuma consulta pode ser executada sem tenant
 *    resolvido. Ausência de tenant é erro, nunca 'todos'" — é o RF-T-04 escrito
 *    com todas as letras. Por isso `tenantAtual()` LANÇA em vez de devolver
 *    `undefined`: um `undefined` que escorrega para um `where` do Prisma vira
 *    consulta sem filtro, e consulta sem filtro num sistema multiempresa é
 *    vazamento, não bug de digitação.
 *
 *  - ATOR (`actorType` + `actorId`, e `agentSlug` quando é agente). É o que
 *    responde "quem mandou isso acontecer" quando alguém abre o RASTRO seis
 *    meses depois.
 *
 *  - CORRELAÇÃO (`correlationId`). Um único identificador atravessando pedido
 *    HTTP, execução de agente e chamada de ferramenta (RNF-09). É o que permite
 *    reconstruir a jornada inteira a partir de uma linha de log.
 *
 * POR QUE AsyncLocalStorage E NÃO UM PARÂMETRO EM TODA FUNÇÃO
 * Porque o parâmetro já existe onde importa (`ExecCtx` na porta,
 * `ContextoDoEfeito` no registro de efeitos) e continua sendo o caminho
 * preferido: dado explícito é melhor que dado ambiente. O armazém existe para
 * o que NÃO tem como receber parâmetro — o logger, que é chamado de dentro de
 * qualquer serviço, e o código antigo que ainda passa só o `orgId`. É o
 * mecanismo que o Node já traz (`node:async_hooks`); nenhuma dependência nova
 * entrou por causa disto (02-CONSTRAINTS).
 *
 * REGRA DE LEITURA: o armazém COMPLEMENTA o parâmetro, nunca o substitui. Quem
 * recebe `orgId` explícito usa o explícito; o armazém só preenche o que faltou.
 */
export interface ContextoExecucao {
  /** Empresa dona da operação. `null` significa "ainda não resolvido" — e
   *  quem precisa dele tem que LANÇAR, nunca assumir "todos". */
  orgId?: string | null;
  actorType?: ActorType | null;
  actorId?: string | null;
  agentSlug?: string | null;
  /** Atravessa pedido, execução de agente e chamada de ferramenta (RNF-09). */
  correlationId: string;
  /**
   * A correlação do escopo de FORA, quando a história em curso trocou de
   * identificador no meio do caminho (a requisição HTTP abre uma execução de
   * agente, que tem identificador próprio — o da sessão).
   *
   * Sem isto, a jornada se parte: a porta loga com a correlação da requisição,
   * o efeito loga com a da sessão, e nenhuma linha carrega as duas — não há
   * como ligar uma ponta na outra, que é justamente o que a RNF-09 pede.
   * Preenchido sozinho por `comContexto`; ninguém precisa repassá-lo à mão.
   */
  correlacaoPai?: string | null;
  /** De onde a história começou. Só para o log — não muda decisão nenhuma. */
  origem?: OrigemDoContexto;
}

export type OrigemDoContexto = 'http' | 'agente' | 'aprovacao' | 'cron' | 'script';

/**
 * Invariante violada, não erro de usuário: alguém chegou até uma operação de
 * dados sem empresa resolvida. Falha ruidosa de propósito (09-PADRÕES §3.4).
 */
export class SemTenantError extends Error {
  constructor(onde: string) {
    super(
      `tenant não resolvido em ${onde}: ausência de empresa é erro, nunca "todos" (RF-T-04)`,
    );
    this.name = 'SemTenantError';
  }
}

const armazem = new AsyncLocalStorage<ContextoExecucao>();

/**
 * Roda `fn` dentro do contexto. É a ÚNICA forma de abrir escopo aqui, de
 * propósito: `AsyncLocalStorage` também tem `enterWith()`, que entra no
 * contexto e não sai mais — vaza para a continuação de quem chamou e vira uma
 * variável global disfarçada. `run()` começa e termina onde a função começa e
 * termina.
 */
export function comContexto<T>(ctx: ContextoExecucao, fn: () => T): T {
  return armazem.run({ ...ctx, correlacaoPai: paiDe(ctx) }, fn);
}

/**
 * De onde esta história nasceu, deduzido da pilha de escopos em vez de
 * repassado à mão.
 *
 * A regra tem três degraus, nesta ordem: quem informou o pai explicitamente
 * manda; senão, se o escopo de fora tinha OUTRA correlação, é ele o pai (é o
 * caso da requisição HTTP que abre uma sessão de agente); senão, o escopo de
 * fora é a mesma história e o pai dele continua valendo — é o que faz a marca
 * sobreviver aos escopos internos (a porta reabre o contexto em volta do efeito
 * com a mesma correlação, e o efeito continuaria sabendo de onde veio).
 */
function paiDe(ctx: ContextoExecucao): string | null {
  if (ctx.correlacaoPai !== undefined) return ctx.correlacaoPai;
  const fora = armazem.getStore();
  if (!fora) return null;
  return fora.correlationId !== ctx.correlationId ? fora.correlationId : (fora.correlacaoPai ?? null);
}

export function contextoAtual(): ContextoExecucao | undefined {
  return armazem.getStore();
}

/**
 * A empresa da operação em curso. LANÇA quando não há — é o RF-T-04.
 * @param onde nome do ponto que precisou do tenant, para o erro dizer onde doeu.
 */
export function tenantAtual(onde = 'contexto de execução'): string {
  return exigirTenant(contextoAtual()?.orgId, onde);
}

/**
 * O mesmo guarda, para valor que chegou por parâmetro em vez do armazém. String
 * vazia e string de espaços contam como ausência: `where: { orgId: '' }` não
 * vaza, mas `orgId` em branco é sempre um bug a montante, e engolir em silêncio
 * só adia a descoberta.
 */
export function exigirTenant(orgId: string | null | undefined, onde: string): string {
  if (typeof orgId !== 'string' || orgId.trim() === '') throw new SemTenantError(onde);
  return orgId;
}

/** O identificador da história em curso, quando existe. */
export function correlacaoAtual(): string | undefined {
  return contextoAtual()?.correlationId;
}

/*
 * A MARCA DE PROCEDÊNCIA EXTERNA.
 *
 * Um cabeçalho de correlação pode vir de qualquer chamador — inclusive de uma
 * rota pública, sem token. Aceitá-lo tal e qual faz o identificador ESCOLHIDO
 * POR TERCEIRO ficar indistinguível do que nós cunhamos, e a correlação
 * aparece em lugar que não se apaga: o campo `correlacaoDaConfirmacao` dos
 * eventos `acao.executada` e `acao.falhou`, no RASTRO append-only. Quem aprova
 * escolheria a string gravada ali, e poderia apontar uma ação para a história
 * de outra.
 *
 * Todo valor vindo de fora entra prefixado. A propriedade que isso garante é
 * uma só, e é suficiente: NENHUM valor cunhado por nós começa com `ext-`, logo
 * qualquer correlação com esse começo é, por construção, escolha de chamador —
 * e nenhum chamador consegue produzir um identificador que pareça nosso.
 *
 * Não deduplicamos o prefixo de propósito: `ext-ext-abc` é feio e honesto, e
 * deduplicar devolveria ao chamador o poder de escolher a string inteira depois
 * da marca. `novaCorrelacao` recusa o prefixo reservado para que a invariante
 * seja cobrada pelo código, não pela lembrança de quem lê isto aqui.
 */
export const PREFIXO_EXTERNO = 'ext';

/** Marca um identificador que veio de fora. Ver `PREFIXO_EXTERNO`. */
export function marcarCorrelacaoExterna(valor: string): string {
  return `${PREFIXO_EXTERNO}-${valor}`;
}

/** Esta correlação foi escolhida por quem chamou? (para log, teste e leitura do RASTRO) */
export function correlacaoEhExterna(correlationId: string | null | undefined): boolean {
  return typeof correlationId === 'string' && correlationId.startsWith(`${PREFIXO_EXTERNO}-`);
}

/**
 * Um identificador de correlação novo. Prefixo curto porque quem lê log lê com
 * o olho: `http-9f2c…` diz de onde a história saiu antes de qualquer campo.
 */
export function novaCorrelacao(prefixo?: string): string {
  if (prefixo === PREFIXO_EXTERNO) {
    throw new Error(
      `"${PREFIXO_EXTERNO}-" é reservado para correlação vinda de fora e não pode ser cunhado aqui`,
    );
  }
  const id = randomUUID();
  return prefixo ? `${prefixo}-${id}` : id;
}

/**
 * O recorte do contexto que vai para o log.
 *
 * Sai como objeto porque é assim que ele é montado e testado — campo a campo,
 * sem frase para regexar. Hoje o único consumidor é o `LoggerDeCorrelacao`, que
 * o achata num prefixo `[cor:… org:…]` para caber no `ConsoleLogger` do Nest:
 * enquanto o destino do log for texto, é o formato possível. O objeto existe
 * para o dia em que houver um coletor que aceite campo estruturado — trocar o
 * formato do log é decisão de operação, não de quem escreve este arquivo (está
 * em PERGUNTAS da fatia 1.2).
 */
export function camposDeContexto(): Record<string, string> {
  const c = contextoAtual();
  if (!c) return {};
  const campos: Record<string, string> = { cor: c.correlationId };
  // Logo depois da correlação: é o par que liga log de porta a log de efeito.
  if (c.correlacaoPai) campos.pai = c.correlacaoPai;
  if (c.orgId) campos.org = c.orgId;
  if (c.actorId) campos.ator = c.actorId;
  if (c.agentSlug) campos.agente = c.agentSlug;
  return campos;
}
