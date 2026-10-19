import { Injectable } from '@nestjs/common';

/*
 * QUEM NÃO ASSINA ESTE PEDIDO, ALÉM DE QUEM PROPÔS (rodada do trabalho T1b, revisão P2-2, 19/10/2026).
 *
 * A invariante 7 diz que quem propõe não assina. Há pedidos em que outra pessoa
 * também não pode assinar, por causa do CONTEÚDO: o fechamento de quem fechou
 * fora do sistema leva dados que uma pessoa DECLAROU, e quem declarou não
 * confere a própria declaração, mesmo quando outra pessoa propôs de novo.
 *
 * Essa regra é do domínio, e a fila não importa os domínios (ciclo de módulo).
 * Por isso um registro, como o dos efeitos e o do "pedir de novo": o domínio se
 * inscreve com a capacidade e diz, a partir dos argumentos gravados, quem não
 * assina e por quê. A fila usa a resposta para tirar a pessoa de "quem pode
 * aprovar" e dizer o porquê no lugar do botão; a rota de confirmação recusa com
 * 403 ANTES de `confirm`, sem gastar a aprovação. Só RESTRINGE: nada aqui deixa
 * alguém assinar o que a régua não deixaria. O efeito do domínio continua sendo
 * a segunda tranca.
 */

export interface QuemNaoAssina {
  /** Os ids de usuário que não assinam este pedido. */
  ids: string[];
  /** A frase para quem está na lista, em português. */
  motivo: string;
}

export type ConsultaDeQuemNaoAssina = (orgId: string, args: Record<string, unknown>) => Promise<QuemNaoAssina | null>;

@Injectable()
export class QuemNaoAssinaRegistry {
  private readonly porCapacidade = new Map<string, { fn: ConsultaDeQuemNaoAssina; quem: string }>();

  inscrever(capabilityId: string, fn: ConsultaDeQuemNaoAssina, quem: string): void {
    const ja = this.porCapacidade.get(capabilityId);
    if (ja) throw new Error(`${quem} tentou inscrever "quem não assina" de ${capabilityId}, que já é de ${ja.quem}`);
    this.porCapacidade.set(capabilityId, { fn, quem });
  }

  /**
   * Quem não assina este pedido. Falha da consulta FECHA: sem conseguir
   * perguntar ao domínio, ninguém além de quem já não assinava fica liberado, e
   * a frase diz que não deu para conferir.
   */
  async consultar(orgId: string, capabilityId: string | null, args: Record<string, unknown> | null, quem?: string): Promise<QuemNaoAssina | null> {
    if (!capabilityId || !args) return null;
    const r = this.porCapacidade.get(capabilityId);
    if (!r) return null;
    try {
      return await r.fn(orgId, args);
    } catch {
      return { ids: quem ? [quem] : [], motivo: 'Não foi possível conferir quem pode assinar este pedido agora: tente de novo em instantes.' };
    }
  }
}
