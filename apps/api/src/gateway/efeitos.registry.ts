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

  registrar(entradas: Record<string, Efeito>): void {
    for (const [id, fn] of Object.entries(entradas)) this.mapa.set(id, fn);
  }

  tem(capabilityId: string): boolean {
    return this.mapa.has(capabilityId);
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
    };
  }
}
