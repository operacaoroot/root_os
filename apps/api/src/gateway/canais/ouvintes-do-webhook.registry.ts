import { Injectable, Logger } from '@nestjs/common';

/**
 * Quem OUVE o webhook da Evolution sem decidir nada sobre ele. Recebe o corpo
 * inteiro e devolve um rótulo curto para o log — nunca para a resposta HTTP.
 */
export type OuvinteDoWebhook = (orgId: string, evento: unknown) => Promise<string>;

/*
 * ============================================================================
 * OUVINTES DO WEBHOOK ÚNICO — mais um destino, nenhum consumidor a menos
 * ============================================================================
 *
 * A Evolution aceita UMA URL de webhook por instância, e a da ROOT aponta para
 * `POST /approvals/canal/whatsapp/:orgId` (ver `canal-de-aprovacao.controller.ts`).
 * Ali já moram três consumidores: o canal de aprovação (conversa direta de quem
 * assina), o grupo de links da pauta (`EntradaDeGrupoRegistry`) e, na saída, o
 * aviso a quem pode assinar. A caixa de atendimento (Dia a dia › Conversas)
 * precisa ver as mesmas mensagens — e NÃO pode tirar nenhuma delas de quem já
 * as recebia, nem trocar a URL do webhook.
 *
 * Então ela OUVE, em vez de DESVIAR:
 *   · o ouvinte roda DEPOIS do caminho de sempre (grupo inscrito ou canal), já
 *     com o desfecho dele decidido; nada que o ouvinte faça muda esse desfecho;
 *   · roda inclusive quando o caminho de sempre falha, e a falha do ouvinte vira
 *     rótulo de log, nunca exceção — um não derruba o outro;
 *   · o webhook já respondeu antes de tudo isto (resposta constante no corpo e
 *     no tempo), então ouvir não muda nada do lado de fora.
 *
 * O que o ouvinte NÃO deve guardar (o canal de aprovação, o grupo de links) é
 * problema dele, e a caixa resolve na própria entrada — ver
 * `atendimento/entrada-do-atendimento.service.ts`.
 *
 * POR REGISTRO, E NÃO POR IMPORT, como o `EntradaDeGrupoRegistry`: o canal mora
 * na pasta da porta e é `@Global`; importar a caixa daqui fecharia ciclo.
 */
@Injectable()
export class OuvintesDoWebhookRegistry {
  private readonly log = new Logger('OuvintesDoWebhook');
  private readonly ouvintes = new Map<string, OuvinteDoWebhook>();

  registrar(nome: string, ouvinte: OuvinteDoWebhook): void {
    if (this.ouvintes.has(nome)) this.log.warn(`ouvinte "${nome}" inscrito de novo; o último vale`);
    this.ouvintes.set(nome, ouvinte);
    this.log.log(`ouvinte "${nome}" ligado ao webhook da Evolution`);
  }

  get quantos(): number {
    return this.ouvintes.size;
  }

  /** Avisa todos os ouvintes, um de cada vez. Nunca lança. */
  async avisar(orgId: string, evento: unknown): Promise<string[]> {
    const rotulos: string[] = [];
    for (const [nome, ouvinte] of this.ouvintes) {
      try {
        rotulos.push(`${nome}:${await ouvinte(orgId, evento)}`);
      } catch (e) {
        this.log.warn(`ouvinte "${nome}" falhou (${orgId}): ${(e as Error).message}`);
        rotulos.push(`${nome}:erro`);
      }
    }
    return rotulos;
  }
}
