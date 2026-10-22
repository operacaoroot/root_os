import { Injectable, Logger } from '@nestjs/common';

/**
 * Quem grava o que chegou pelo webhook da Evolution. Recebe o corpo inteiro e
 * devolve um rótulo curto para o log (sem número nem texto), ou `null` quando
 * não havia o que gravar.
 */
export type GravacaoDoWhatsapp = (orgId: string, evento: unknown) => Promise<string | null>;

/*
 * ============================================================================
 * O REGISTRO DA GRAVAÇÃO — tudo o que chega fica gravado (produção 22C, W1)
 * ============================================================================
 *
 * O número da empresa é um só, e é o mesmo do canal de aprovação: a Evolution
 * manda TUDO para a mesma URL (`POST /approvals/canal/whatsapp/:orgId`). Até a
 * rodada 22C, o que não era resposta de aprovação, grupo de links nem conversa
 * de lead era ignorado e se perdia. Agora o webhook GRAVA PRIMEIRO (toda
 * mensagem, 1:1 e grupo, inclusive `fromMe`) e só DEPOIS entrega aos leitores de
 * sempre, na mesma ordem: grupo de links → entrada do lead (e triagem) → canal.
 *
 * A GRAVAÇÃO NUNCA BARRA OS LEITORES. Falhar aqui (banco fora, corpo torto) vira
 * linha no log e o webhook segue para quem sempre o leu: nada do que já
 * funcionava depende de a mensagem ter sido guardada. E ela não decide nada:
 * gravar não autoriza, não responde, não cria lead.
 *
 * POR REGISTRO, E NÃO POR IMPORT, como o grupo e a entrada direta: a porta não
 * importa o módulo do WhatsApp (`src/whatsapp/`); é ele que se oferece no
 * arranque. Sem inscrito, o webhook é exatamente o de antes. Só UM inscrito.
 *
 * O que passa por aqui já passou pelo segredo do webhook DESTA empresa e roda no
 * contexto dela (`comTenantPublico`), depois de a rota ter respondido. A prova
 * de empresa dentro do corpo (a instância) é conferida pelo inscrito.
 */
@Injectable()
export class GravacaoDoWhatsappRegistry {
  private readonly log = new Logger('GravacaoDoWhatsapp');
  private gravador: { fn: GravacaoDoWhatsapp; quem: string } | null = null;

  registrar(fn: GravacaoDoWhatsapp, quem: string): void {
    if (this.gravador) this.log.warn(`gravação do WhatsApp já era de ${this.gravador.quem}; ${quem} assumiu no lugar`);
    this.gravador = { fn, quem };
  }

  get inscrito(): boolean {
    return this.gravador !== null;
  }

  /** Grava, e nunca lança: a falha vira rótulo e o webhook segue para os leitores. */
  async gravar(orgId: string, evento: unknown): Promise<string | null> {
    if (!this.gravador) return null;
    try {
      return await this.gravador.fn(orgId, evento);
    } catch (e) {
      this.log.warn(`gravação do WhatsApp falhou (${orgId}): ${(e as Error).message}`);
      return 'erro';
    }
  }
}
