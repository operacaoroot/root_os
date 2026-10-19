import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/** O que a caixa de atendimento precisa do WhatsApp, e nada mais. */
export interface WhatsappDoAtendimento {
  /** Manda texto para a conversa (número ou grupo). Devolve o `key.id` da Evolution. */
  enviarTexto(jid: string, texto: string): Promise<{ id: string | null }>;
  /** Baixa o arquivo de uma mensagem recebida, ou `null` quando a Evolution não tem mais. */
  baixarMidia(chave: { id: string; remoteJid: string; fromMe: boolean }): Promise<{ base64: string; mimetype: string | null } | null>;
}

/*
 * ============================================================================
 * O WHATSAPP DA CAIXA DE ATENDIMENTO — oferecido pelo conector, por registro
 * ============================================================================
 *
 * A catraca de arquitetura (`test/arquitetura.test.ts`, "conector só pela
 * porta") proíbe módulo novo de importar o `EvolutionService`. A caixa de
 * atendimento precisa de duas coisas dele — mandar a resposta assinada e baixar
 * o anexo recebido — e as recebe daqui, do mesmo jeito que o canal de aprovação
 * recebe a saída pelo `TransporteDeCanalRegistry`: o conector se inscreve no
 * arranque, quem usa só conhece esta interface.
 *
 * Quem fala com a Evolution continua sendo o conector, com a credencial dele.
 * E a resposta ao cliente só chega a `enviarTexto` por dentro do efeito
 * `atendimento.whatsapp.responder`, que a porta só solta com assinatura (R3) e
 * com o conector `whatsapp` ligado em Conexões.
 */
@Injectable()
export class WhatsappDoAtendimentoRegistry {
  private readonly log = new Logger('WhatsappDoAtendimento');
  private atual: { impl: WhatsappDoAtendimento; quem: string } | null = null;

  registrar(impl: WhatsappDoAtendimento, quem: string): void {
    if (this.atual) this.log.warn(`${quem} assumiu o WhatsApp do atendimento no lugar de ${this.atual.quem}`);
    this.atual = { impl, quem };
  }

  get disponivel(): boolean {
    return this.atual !== null;
  }

  private exigir(): WhatsappDoAtendimento {
    if (!this.atual) {
      throw new ServiceUnavailableException('O WhatsApp (Evolution) não está configurado nesta API.');
    }
    return this.atual.impl;
  }

  enviarTexto(jid: string, texto: string): Promise<{ id: string | null }> {
    return this.exigir().enviarTexto(jid, texto);
  }

  async baixarMidia(chave: { id: string; remoteJid: string; fromMe: boolean }) {
    if (!this.atual) return null;
    return this.atual.impl.baixarMidia(chave);
  }
}
