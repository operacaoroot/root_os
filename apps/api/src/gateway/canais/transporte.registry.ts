import { Injectable, Logger } from '@nestjs/common';

/**
 * Como se entrega uma linha de texto a um endereço de canal.
 *
 * `destino` é a chave de identidade (o número, em `whatsapp`) — quem sabe
 * traduzi-la para o endereço do fornecedor é o conector, não este registro.
 */
export type EntregaDeCanal = (destino: string, texto: string) => Promise<void>;

/*
 * ============================================================================
 * O REGISTRO DE TRANSPORTE DO CANAL DE APROVAÇÃO — e por que não é um import
 * ============================================================================
 *
 * Quem SABE mandar uma mensagem de WhatsApp é `pauta/evolution.service.ts`, o
 * conector. Quem PRECISA mandar é o canal de aprovação, que mora na pasta da
 * porta. Importar o conector daqui fecharia o ciclo de módulo (a porta é
 * `@Global` e inicializa antes do módulo de pauta) e a aplicação não subiria —
 * é o mesmo problema, e a mesma saída, do `InterruptoresRegistry` e do
 * `EfeitosRegistry`: o registro mora na pasta da porta e RECEBE a função no
 * arranque, de quem sabe respondê-la. A dependência passa a ser do conector para
 * a porta, que é a direção que já existe.
 *
 * ----------------------------------------------------------------------------
 * ESTE REGISTRO **NÃO** DERRUBA O ARRANQUE QUANDO NINGUÉM SE INSCREVE — e a
 * diferença para os outros quatro é deliberada
 * ----------------------------------------------------------------------------
 * `InterruptoresRegistry`, o provedor de teto e os outros recusam subir sem
 * inscrito porque são FREIOS: sem eles o sistema age mais do que deveria, em
 * silêncio. Este é o contrário — é uma SAÍDA opcional. Sem inscrito, o canal de
 * aprovação simplesmente não existe: ninguém recebe pedido por WhatsApp e
 * ninguém decide por lá. A fila na tela continua sendo a superfície de sempre, e
 * nada sai da casa sem passar por ela.
 *
 * Derrubar o arranque aqui transformaria uma funcionalidade opcional numa
 * dependência obrigatória do processo inteiro — e o `EvolutionService` só existe
 * quando o módulo de pauta está carregado, que é uma decisão de produto por
 * empresa, não do arranque.
 *
 * ----------------------------------------------------------------------------
 * O QUE ELE **NÃO** É
 * ----------------------------------------------------------------------------
 * Não é um segundo caminho até o conector para uso geral. O que passa por aqui é
 * uma linha de texto de SERVIÇO — o pedido de decisão e a resposta a quem
 * decidiu —, nunca conteúdo que o agente quis publicar. Publicar continua sendo
 * `whatsapp.mensagem.enviar`, que é R3 e passa pela porta com aprovação de
 * gente. A distinção está escrita em `envio-de-aprovacao.service.ts`, no bloco
 * "POR QUE ISTO NÃO É AÇÃO DO GATEWAY".
 */
@Injectable()
export class TransporteDeCanalRegistry {
  private readonly log = new Logger('TransporteDeCanal');
  private readonly entregas = new Map<string, EntregaDeCanal>();

  /** Quem sabe entregar se inscreve no arranque. O último a registrar vence. */
  registrar(canal: string, entrega: EntregaDeCanal, quem: string): void {
    if (this.entregas.has(canal)) {
      // Não lança: sobrescrever é o comportamento dos outros registros da casa,
      // e uma inscrição dupla aqui não abre porta nenhuma — abriria se o
      // registro CONCEDESSE autoridade, e ele só entrega texto.
      this.log.warn(`canal "${canal}" já tinha transporte; ${quem} assumiu no lugar`);
    }
    this.entregas.set(canal, entrega);
    this.log.log(`transporte do canal "${canal}" ligado por ${quem} (RF-A-06)`);
  }

  /** Há transporte para este canal? É o que decide se o canal existe hoje. */
  ligado(canal: string): boolean {
    return this.entregas.has(canal);
  }

  /**
   * Entrega, ou devolve `false` quando não há transporte.
   *
   * NUNCA LANÇA. Quem chama está no meio de um caminho de decisão (a proposta de
   * uma aprovação, a resposta a quem acabou de aprovar): uma falha de entrega de
   * WhatsApp não pode derrubar a retenção de uma ação nem desfazer uma execução
   * que já saiu. A falha vira log e `false`.
   */
  async entregar(canal: string, destino: string, texto: string): Promise<boolean> {
    const entrega = this.entregas.get(canal);
    if (!entrega) return false;
    try {
      await entrega(destino, texto);
      return true;
    } catch (e) {
      this.log.warn(`falha ao entregar no canal "${canal}": ${(e as Error).message}`);
      return false;
    }
  }
}
