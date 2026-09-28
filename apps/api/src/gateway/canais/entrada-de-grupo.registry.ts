import { Injectable, Logger } from '@nestjs/common';

import { EVENTO_ACEITO } from './resposta-de-canal';
import { ehGrupoDeWhatsapp } from './identidade-de-canal';

/**
 * Quem trata a mensagem de UM grupo. Recebe o corpo inteiro do webhook e devolve
 * um rótulo curto para o log — nunca para a resposta HTTP.
 */
export type EntradaDeGrupo = (orgId: string, evento: unknown) => Promise<string>;

/*
 * ============================================================================
 * O REGISTRO DE ENTRADA POR GRUPO — um webhook, mais de um destino (MC1)
 * ============================================================================
 *
 * A Evolution aceita UMA URL de webhook por instância, e a instância da ROOT já
 * aponta para o canal de aprovação (`POST /approvals/canal/whatsapp/:orgId`).
 * O grupo "Root · links" mora nessa mesma instância. Um endpoint próprio em
 * `pauta/` (o desenho original do MC1) nunca receberia nada: a Evolution não
 * teria como mandar para os dois.
 *
 * Então a triagem acontece NA ENTRADA ÚNICA, antes do canal ler a mensagem:
 * mensagem de um grupo INSCRITO aqui vai para quem se inscreveu; todo o resto
 * segue para o canal de aprovação exatamente como antes — e o canal continua
 * descartando grupo (`resposta-de-canal.ts`, ataque 1). Nada do que passa por
 * este registro chega perto de decisão: ele só é consultado para GRUPO, e
 * grupo nunca foi decisão.
 *
 * POR REGISTRO, E NÃO POR IMPORT, pelo motivo de sempre: o canal mora na pasta
 * da porta e é `@Global`; quem sabe o que fazer com um link é a pauta. Importar
 * a pauta daqui fecharia ciclo de módulo. A pauta se inscreve no arranque — é o
 * mesmo arranjo do `TransporteDeCanalRegistry`, na direção contrária (lá o
 * conector oferece uma SAÍDA; aqui a pauta oferece um DESTINO).
 *
 * SEM INSCRITO, NADA MUDA. Não derruba o arranque: é entrada opcional, ligada
 * por variável de ambiente de quem se inscreve.
 */
@Injectable()
export class EntradaDeGrupoRegistry {
  private readonly log = new Logger('EntradaDeGrupo');
  private readonly entradas = new Map<string, EntradaDeGrupo>();

  /**
   * Inscreve o destino de um grupo. Só aceita JID de GRUPO (`@g.us`): um número
   * de telefone aqui desviaria conversa direta — que é onde a decisão mora — do
   * canal de aprovação.
   */
  registrar(jid: string, entrada: EntradaDeGrupo, quem: string): boolean {
    const chave = jidCanonico(jid);
    if (!chave || !ehGrupoDeWhatsapp(chave)) {
      this.log.warn(`${quem} tentou inscrever "${jid}", que não é JID de grupo (@g.us); ignorado`);
      return false;
    }
    if (this.entradas.has(chave)) {
      this.log.warn(`grupo ${chave} já tinha entrada; ${quem} assumiu no lugar`);
    }
    this.entradas.set(chave, entrada);
    this.log.log(`entrada do grupo ${chave} ligada por ${quem}`);
    return true;
  }

  /** Há alguém inscrito para este grupo? */
  inscrito(jid: string): boolean {
    const chave = jidCanonico(jid);
    return chave !== null && this.entradas.has(chave);
  }

  /**
   * Despacha o corpo para o inscrito do grupo, ou devolve `null` para o chamador
   * seguir o caminho de sempre.
   *
   * `null` quando: não é `messages.upsert`, não é de grupo, ou é de grupo que
   * ninguém inscreveu. A falha do inscrito vira rótulo, não exceção: o webhook
   * já respondeu e o canal não tem nada a fazer com mensagem de grupo.
   */
  async despachar(orgId: string, evento: unknown): Promise<string | null> {
    if (this.entradas.size === 0) return null;
    const jid = grupoDoEvento(evento);
    if (!jid) return null;
    const entrada = this.entradas.get(jid);
    if (!entrada) return null;
    try {
      return await entrada(orgId, evento);
    } catch (e) {
      this.log.warn(`entrada do grupo falhou (${orgId}): ${(e as Error).message}`);
      return 'erro';
    }
  }
}

function jidCanonico(jid: unknown): string | null {
  if (typeof jid !== 'string') return null;
  const s = jid.trim().toLowerCase();
  return s === '' ? null : s;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** O JID do grupo de uma mensagem nova, ou `null` quando não é mensagem nova de grupo. */
export function grupoDoEvento(evento: unknown): string | null {
  const raiz = objeto(evento);
  if (typeof raiz?.event !== 'string' || raiz.event.trim().toLowerCase() !== EVENTO_ACEITO) {
    return null;
  }
  const key = objeto(objeto(raiz.data)?.key);
  const jid = jidCanonico(key?.remoteJid);
  return jid && ehGrupoDeWhatsapp(jid) ? jid : null;
}
