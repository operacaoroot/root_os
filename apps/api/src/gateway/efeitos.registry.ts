import { Injectable } from '@nestjs/common';

export type Efeito = (args: Record<string, unknown>, orgId: string) => Promise<unknown>;

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

  /** Lança quando a capacidade está classificada mas ainda sem efeito ligado. */
  async executar(capabilityId: string, args: Record<string, unknown>, orgId: string): Promise<unknown> {
    const fn = this.mapa.get(capabilityId);
    if (!fn) {
      throw new Error(
        `capacidade "${capabilityId}" está classificada e registrada, mas ainda não tem efeito ligado nesta versão`,
      );
    }
    return fn(args, orgId);
  }
}
