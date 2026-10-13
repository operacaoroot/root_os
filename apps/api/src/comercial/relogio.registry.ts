import { Injectable } from '@nestjs/common';

import type { GuardaDaAutonomia } from './fio.service';

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

/**
 * E-19 (revisão): as marcas "já feito no dia" das tarefas do relógio, que
 * crescem com empresa × dia × tarefa enquanto o processo vive. Aqui só fica o
 * dia mais novo visto: quando ele vira, as marcas dos dias anteriores saem.
 * Marca de dia mais velho que o corrente não fica guardada (vale como "não
 * feito", e quem chama confere no banco, como já fazia ao subir o processo).
 */
export class MarcasDoDia {
  private dia = '';
  private readonly marcas = new Set<string>();

  tem(dia: string, marca: string): boolean {
    this.virar(dia);
    return dia === this.dia && this.marcas.has(marca);
  }

  marcar(dia: string, marca: string): void {
    this.virar(dia);
    if (dia === this.dia) this.marcas.add(marca);
  }

  get tamanho(): number {
    return this.marcas.size;
  }

  private virar(dia: string): void {
    if (dia > this.dia) {
      this.dia = dia;
      this.marcas.clear();
    }
  }
}

@Injectable()
export class RelogioComercialRegistry {
  private readonly tarefas = new Map<string, TarefaDoRelogio>();
  private guardaInstalada: GuardaDaAutonomia | null = null;

  /** A guarda da autonomia (lane E): tarefa de automação em A0 é pulada. Sem guarda, tudo roda. */
  definirGuarda(fn: GuardaDaAutonomia): void {
    this.guardaInstalada = fn;
  }

  get guarda(): GuardaDaAutonomia | null {
    return this.guardaInstalada;
  }

  inscrever(nome: string, fn: TarefaDoRelogio): void {
    if (this.tarefas.has(nome)) throw new Error(`Tarefa do relógio "${nome}" já inscrita.`);
    this.tarefas.set(nome, fn);
  }

  inscritas(): [string, TarefaDoRelogio][] {
    return [...this.tarefas.entries()];
  }
}
