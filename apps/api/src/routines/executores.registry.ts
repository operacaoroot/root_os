import { Injectable } from '@nestjs/common';
import type { ContextoDaRotina, ExecutorDeRotina, ResultadoDaRotina } from './rotina.tipos';

/**
 * O mapa `Rotina.tipo` → código que a realiza.
 *
 * Mesmo desenho e mesma catraca do registro de efeitos da porta
 * (`gateway/efeitos.registry.ts`), e pelo mesmo motivo: DOIS caminhos precisam
 * do mapa — o tique do agendador e o "rodar agora" da tela —, e deixá-lo dentro
 * de um deles obrigaria o outro a conhecê-lo só para achar uma função.
 *
 * ------------------------------------------------------------------------
 * REINSCRIÇÃO É ERRO, NÃO "A ÚLTIMA VENCE"
 * ------------------------------------------------------------------------
 * Um `mapa.set()` seco deixaria qualquer módulo inscrever um `tipo` já
 * inscrito, e a segunda inscrição venceria em silêncio: a rotina continuaria
 * com o mesmo nome na tela, o mesmo histórico e o mesmo dono aparente, e quem
 * executasse seria outro código. LANÇA no arranque — duas inscrições para o
 * mesmo tipo é sempre erro de programação, e o lugar de descobrir isso é o boot,
 * não o dia em que a rodada da madrugada fizer outra coisa.
 */
@Injectable()
export class ExecutoresDeRotinaRegistry {
  private readonly mapa = new Map<string, ExecutorDeRotina>();
  /** Quem inscreveu cada tipo. Só existe para a mensagem da catraca. */
  private readonly dono = new Map<string, string>();

  registrar(entradas: Record<string, ExecutorDeRotina>, quem = 'serviço não identificado'): void {
    for (const [tipo, fn] of Object.entries(entradas)) {
      const anterior = this.dono.get(tipo);
      if (anterior !== undefined) {
        throw new Error(
          `Executor de rotina "${tipo}" inscrito duas vezes: por "${anterior}" e agora por ` +
            `"${quem}". Cada tipo tem UM dono — a segunda inscrição executaria outro código com ` +
            'o nome, o histórico e os contadores do primeiro, sem nada denunciando a troca.',
        );
      }
      this.mapa.set(tipo, fn);
      this.dono.set(tipo, quem);
    }
  }

  tem(tipo: string): boolean {
    return this.mapa.has(tipo);
  }

  /** Os tipos inscritos. Serve à tela (que marca rotina órfã) e à suíte. */
  get inscritos(): string[] {
    return [...this.mapa.keys()].sort();
  }

  donoDe(tipo: string): string | null {
    return this.dono.get(tipo) ?? null;
  }

  /**
   * Dispara o executor de um tipo.
   *
   * LANÇA quando ninguém o inscreveu, e não devolve "pulada": rotina apontando
   * para executor inexistente é defeito de configuração, e transformá-lo em
   * silêncio faria a rotina parecer saudável para sempre. O agendador trata a
   * exceção como falha da rotina — que é o que ela é — e ela aparece no
   * histórico com o motivo escrito.
   *
   * `async` para que o tipo inexistente vire promessa REJEITADA e não uma
   * exceção síncrona: o chamador que fizesse `.catch()` sem `await` perderia a
   * segunda e trataria a primeira — duas formas de falhar para o mesmo erro é
   * como uma delas fica sem tratamento.
   */
  async executar(tipo: string, ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    const fn = this.mapa.get(tipo);
    if (!fn) {
      throw new Error(
        `Rotina "${ctx.slug}" pede o executor "${tipo}", que ninguém inscreveu. ` +
          `Inscritos hoje: ${this.inscritos.join(', ') || '(nenhum)'}.`,
      );
    }
    return fn(ctx);
  }
}
