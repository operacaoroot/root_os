import { Injectable } from '@nestjs/common';
import type { ActorType } from '@prisma/client';
import { contextoAtual, exigirTenant } from '../common/contexto-execucao';

/**
 * O contexto que acompanha um efeito até o conector: por conta de QUEM ele age
 * e a que história pertence (RF-T-04, RNF-09).
 *
 * Só `orgId` é obrigatório — e é obrigatório de verdade: `executar()` lança
 * quando ele falta, em vez de deixar o efeito rodar sem empresa. O resto é
 * anulável porque existe caminho legítimo sem ator identificado (um cron, um
 * script de manutenção), e mentir um ator seria pior que registrar `null`.
 */
export interface ContextoDoEfeito {
  orgId: string;
  actorType?: ActorType | null;
  actorId?: string | null;
  agentSlug?: string | null;
  correlationId?: string | null;
  /**
   * A aprovação que liberou este disparo, quando ele vem da fila
   * (`AcoesService.executarAprovada`). Não se herda do ambiente: só quem
   * consumiu a aprovação sabe qual foi.
   */
  approvalId?: string | null;
  /**
   * O item de lote consumido pela porta nesta passagem (MD7). Só a porta o
   * escreve; o efeito lê daqui que a saída foi autorizada pelo lote.
   */
  loteItemId?: string | null;
  /**
   * A PESSOA que pediu ao agente, quando ela é diferente do ator (30/10/2026,
   * a Rootinha). No caminho do agente externo o ator é o AGENTE — é ele quem
   * propõe, e é isso que deixa qualquer sócio confirmar o que ele propôs —, e o
   * efeito que escreve em nome de gente (a tarefa, o comentário) precisa saber
   * de quem é o nome. Não se herda do ambiente: só quem montou o pedido sabe.
   */
  solicitanteId?: string | null;
  /**
   * O pedido veio de texto de terceiro (RF-G-07), dito por quem montou o pedido —
   * o booleano da marca `ExecCtx.procedenciaExterna`, com outro nome porque a
   * porta entrega o próprio `ExecCtx` como contexto do efeito. A porta já usou a marca para subir o degrau; o efeito só a lê quando ele
   * mesmo abre outra passagem (invocar um agente) e a marca precisa ir junto.
   * Mão única como a da porta: ausente quer dizer "ninguém marcou".
   */
  pedidoDeFora?: boolean | null;
}

/**
 * O código que realiza uma capacidade.
 *
 * O `orgId` continua sendo o SEGUNDO parâmetro, e não foi trocado por um objeto,
 * por um motivo prático: os dez efeitos de leitura já ligados em
 * `agents/efeitos.service.ts` são `(args, org) => this.servico.algo(org)`.
 * Acrescentar um terceiro parâmetro mantém todos eles válidos — em TypeScript,
 * função que declara menos parâmetros satisfaz um tipo que declara mais — e dá
 * ao efeito de ESCRITA o que ele não tinha: ator e correlação.
 *
 * Quem escrever efeito novo que precise saber por conta de quem age usa o
 * terceiro parâmetro; quem só precisa da empresa continua com dois.
 */
export type Efeito = (
  args: Record<string, unknown>,
  orgId: string,
  ctx: ContextoDoEfeito,
) => Promise<unknown>;

/*
 * O mapa capacidade → código que a realiza.
 *
 * Mora aqui, e não dentro do AgentRuntime, porque DOIS caminhos precisam dele:
 * o laço do agente (que propõe) e a execução da ação aprovada (que acontece
 * depois, quando uma pessoa confirma). Deixar o mapa dentro do runtime obrigaria
 * a fila de aprovação a conhecer o runtime só para achar uma função.
 */
@Injectable()
export class EfeitosRegistry {
  private readonly mapa = new Map<string, Efeito>();
  /** Quem inscreveu cada capacidade. Só existe para a mensagem da catraca. */
  private readonly dono = new Map<string, string>();

  /**
   * Um serviço declara as capacidades que realiza.
   *
   * ------------------------------------------------------------------------
   * A CATRACA DE DONO — reinscrição é ERRO, não "a última vence"
   * ------------------------------------------------------------------------
   * Até a correção da fatia 3.3 este método era `mapa.set()` seco: qualquer
   * serviço podia registrar qualquer identificador, inclusive um já registrado
   * por outro conector, e a segunda inscrição vencia EM SILÊNCIO. O registro
   * irmão (`ConectoresConfiguradosRegistry`) ao menos avisava no log.
   *
   * O que isso valia, concretamente: um arquivo de um módulo qualquer inscreve
   * `email.enviar` e passa a executar código dele com a CLASSIFICAÇÃO ALHEIA —
   * a porta continua vendo um R3 do Google, continua retendo para aprovação,
   * continua registrando no RASTRO "e-mail enviado", e quem sai é outro código.
   * Nada no log, nada no rastro, nada na tela. Sequestro de efeito.
   *
   * O que a catraca NÃO precisa cobrir, e o revisor confirmou: registrar um
   * identificador FORA do catálogo não abre caminho nenhum — a porta recusa
   * capacidade sem classificação antes de qualquer efeito (vale R5, que é
   * bloqueio). O furo era a colisão, e é ela que fecha aqui.
   *
   * LANÇA no arranque, e derrubar a API é o comportamento desejado: duas
   * inscrições para a mesma capacidade é sempre erro de programação, e o lugar
   * de descobrir isso é o boot, não o dia do incidente. `quem` entra na
   * mensagem porque sem ele o erro diz que houve colisão e não onde.
   */
  registrar(entradas: Record<string, Efeito>, quem = 'serviço não identificado'): void {
    for (const [id, fn] of Object.entries(entradas)) {
      const anterior = this.dono.get(id);
      if (anterior !== undefined) {
        throw new Error(
          `Efeito de "${id}" inscrito duas vezes: por "${anterior}" e agora por "${quem}". ` +
            'Cada capacidade tem UM dono — quem fala com o sistema de terceiro é o conector ' +
            'daquele sistema. A segunda inscrição executaria código de um módulo com a ' +
            'classificação de risco do outro, sem nada no RASTRO denunciando a troca.',
        );
      }
      this.mapa.set(id, fn);
      this.dono.set(id, quem);
    }
  }

  tem(capabilityId: string): boolean {
    return this.mapa.has(capabilityId);
  }

  /** As capacidades inscritas. Serve à suíte, que as cruza com o catálogo. */
  get inscritas(): string[] {
    return [...this.mapa.keys()].sort();
  }

  /** Quem inscreveu esta capacidade, ou `null`. Para diagnóstico e para a suíte. */
  donoDe(capabilityId: string): string | null {
    return this.dono.get(capabilityId) ?? null;
  }

  get tamanho(): number {
    return this.mapa.size;
  }

  /**
   * Dispara o efeito de uma capacidade.
   *
   * O terceiro parâmetro aceita o contexto completo OU só o `orgId`. A forma
   * curta existe porque o laço do agente ainda chama `executar(cap, args,
   * orgId)`: ali o ator e a correlação vêm do contexto de execução que a porta
   * abriu em volta do efeito, e não precisam ser repetidos. A forma completa é
   * a da execução por aprovação, onde quem age (a pessoa que aprovou) não é
   * quem propôs, e o registro tem de dizer isso.
   *
   * Lança quando a capacidade está classificada mas ainda sem efeito ligado, e
   * lança quando o tenant não foi resolvido (RF-T-04) — antes de chamar
   * qualquer coisa, nunca com "todos" no lugar da empresa. A forma completa tem
   * de TRAZER a empresa; só a curta herda. Ver `completar`.
   */
  async executar(
    capabilityId: string,
    args: Record<string, unknown>,
    contexto: ContextoDoEfeito | string,
  ): Promise<unknown> {
    const ctx = this.completar(capabilityId, contexto);
    const fn = this.mapa.get(capabilityId);
    if (!fn) {
      throw new Error(
        `capacidade "${capabilityId}" está classificada e registrada, mas ainda não tem efeito ligado nesta versão`,
      );
    }
    return fn(args, ctx.orgId, ctx);
  }

  /**
   * Junta o que veio por parâmetro com o que está no contexto de execução. O
   * PARÂMETRO VENCE: dado explícito é mais confiável que dado ambiente, e a
   * execução por aprovação depende disso — o ator dela é quem aprovou, não quem
   * abriu a requisição.
   *
   * A EMPRESA é a exceção, e a exceção tem um lado só. Na forma COMPLETA ela é
   * EXIGIDA: quem monta um `ContextoDoEfeito` inteiro e esquece o `orgId` não
   * está sem informação, está com informação errada — e herdar faria o efeito
   * rodar no tenant de quem por acaso estivesse em volta, sem nada denunciando.
   * O tipo já declara `orgId: string`; aqui isso passa a ser cobrado em tempo de
   * execução, que é onde o JavaScript chega. Só a forma CURTA
   * (`executar(cap, args, orgId)`) mantém o `??` para o ambiente, e mantém por
   * contrato, não por necessidade: ali o terceiro parâmetro É a empresa, e uma
   * string em branco continua lançando como sempre lançou.
   *
   * Terceiro parâmetro ausente (`null`/`undefined`) não é forma curta coisa
   * nenhuma — é chamador distraído, e cai no lado que lança.
   */
  private completar(
    capabilityId: string,
    contexto: ContextoDoEfeito | string,
  ): ContextoDoEfeito {
    const herdado = contextoAtual();
    const onde = `efeito de "${capabilityId}"`;
    const curta = typeof contexto === 'string';
    const bruto: Partial<ContextoDoEfeito> = curta ? { orgId: contexto } : (contexto ?? {});
    return {
      orgId: curta ? exigirTenant(bruto.orgId ?? herdado?.orgId, onde) : exigirTenant(bruto.orgId, onde),
      actorType: bruto.actorType ?? herdado?.actorType ?? null,
      actorId: bruto.actorId ?? herdado?.actorId ?? null,
      agentSlug: bruto.agentSlug ?? herdado?.agentSlug ?? null,
      correlationId: bruto.correlationId ?? herdado?.correlationId ?? null,
      ...(bruto.approvalId ? { approvalId: bruto.approvalId } : {}),
      ...(bruto.loteItemId ? { loteItemId: bruto.loteItemId } : {}),
      ...(bruto.solicitanteId ? { solicitanteId: bruto.solicitanteId } : {}),
      ...(bruto.pedidoDeFora ? { pedidoDeFora: true } : {}),
    };
  }
}
