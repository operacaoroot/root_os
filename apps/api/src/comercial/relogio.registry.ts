import { Injectable } from '@nestjs/common';

/*
 * O RELÓGIO COMERCIAL — o registro das tarefas de tempo (orquestrador, 13/10/2026).
 *
 * A rotina `comercial.relogio` (lane A) acorda a cada minuto, por empresa, e
 * chama cada tarefa inscrita aqui com a empresa e o instante da passagem. Cada
 * lane inscreve as suas no `onModuleInit`: a espinha (decisão vencida, lead
 * parado, reação pendente), a sala e o canal (véspera, M5, M6), o dinheiro
 * (régua de cobrança, marcos do contrato), a inteligência (vigia das 08:00,
 * relator da quinta). A tarefa decide sozinha se é hora de agir e grava o fato
 * pelo `FioService` com uma chave que inclui o dia/horário: a mesma passagem
 * repetida não cria o fato duas vezes.
 *
 * Tarefa que lança não derruba as outras: o executor registra a falha e segue.
 */

export type TarefaDoRelogio = (orgId: string, agora: Date) => Promise<unknown>;

@Injectable()
export class RelogioComercialRegistry {
  private readonly tarefas = new Map<string, TarefaDoRelogio>();

  inscrever(nome: string, fn: TarefaDoRelogio): void {
    if (this.tarefas.has(nome)) throw new Error(`Tarefa do relógio "${nome}" já inscrita.`);
    this.tarefas.set(nome, fn);
  }

  inscritas(): [string, TarefaDoRelogio][] {
    return [...this.tarefas.entries()];
  }
}
