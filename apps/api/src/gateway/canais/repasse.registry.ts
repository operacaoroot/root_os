import { Injectable, Logger } from '@nestjs/common';

/**
 * Quem recebe uma CÓPIA do que chegou pelo webhook da Evolution. Devolve um
 * rótulo curto para o log, ou `null` quando a mensagem não é dele.
 */
export type RepasseDoWhatsapp = (orgId: string, evento: unknown) => Promise<string | null>;

/*
 * ============================================================================
 * O REPASSE — uma cópia da mensagem para fora, sem tirar ela de ninguém (A9)
 * ============================================================================
 *
 * 30/10/2026: a Rootinha (o agente que roda no Hermes) age sobre o WhatsApp da
 * empresa, e a Evolution aceita UMA URL de webhook por instância — a do canal
 * de aprovação. Os desvios que já existem (grupo de links e de tarefas por
 * `EntradaDeGrupoRegistry`, a conversa do lead por `EntradaDiretaRegistry`, e o
 * canal de aprovação no fim) CONSOMEM a mensagem: quem a pega, fica com ela.
 *
 * O repasse é diferente de propósito: ele NÃO consome. A mensagem segue para
 * comunidade, links, TR-12, comercial e aprovação exatamente como antes, e o
 * repasse roda AO LADO, com a falha dele presa nele. Por isso um registro
 * próprio, e não uma entrada a mais nos outros dois: lá, inscrever-se seria
 * tirar a mensagem de quem a trata hoje.
 *
 * POR REGISTRO, E NÃO POR IMPORT, como os outros desvios: a porta não importa
 * quem repassa. Quem repassa se inscreve no arranque, e só quando está ligado.
 * Sem inscrito, nada muda.
 */
@Injectable()
export class RepasseDoWhatsappRegistry {
  private readonly log = new Logger('RepasseDoWhatsapp');
  private readonly inscritos: Array<{ fn: RepasseDoWhatsapp; quem: string }> = [];

  registrar(fn: RepasseDoWhatsapp, quem: string): void {
    if (this.inscritos.some((i) => i.quem === quem)) {
      this.log.warn(`${quem} tentou se inscrever duas vezes no repasse; ignorado`);
      return;
    }
    this.inscritos.push({ fn, quem });
    this.log.log(`repasse do WhatsApp ligado por ${quem}`);
  }

  get quantos(): number {
    return this.inscritos.length;
  }

  /**
   * Entrega a cópia a cada inscrito. NUNCA LANÇA: a falha de um vira rótulo, e
   * o webhook já respondeu. Devolve os rótulos de quem disse que a mensagem era
   * dele, para o log.
   */
  async repassar(orgId: string, evento: unknown): Promise<string[]> {
    const rotulos: string[] = [];
    for (const i of this.inscritos) {
      try {
        const r = await i.fn(orgId, evento);
        if (r) rotulos.push(`${i.quem}:${r}`);
      } catch (e) {
        this.log.warn(`repasse de ${i.quem} falhou (${orgId}): ${(e as Error).message}`);
        rotulos.push(`${i.quem}:erro`);
      }
    }
    return rotulos;
  }
}
