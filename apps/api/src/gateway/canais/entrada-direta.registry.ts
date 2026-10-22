import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ehGrupoDeWhatsapp, formasDaChave, remetenteDaKey } from './identidade-de-canal';
import { CANAL } from './quem-decide';
import { EVENTO_ACEITO } from './resposta-de-canal';

/**
 * Quem trata uma conversa 1:1 que chegou pelo webhook da Evolution. Recebe o
 * corpo inteiro e a chave do remetente (só os dígitos), e devolve um rótulo
 * curto para o log, ou `null` quando a mensagem NÃO é dele (aí ela segue para
 * o canal de aprovação, como sempre).
 */
export type EntradaDireta = (orgId: string, evento: unknown, remetente: string) => Promise<string | null>;

/*
 * ============================================================================
 * O REGISTRO DA ENTRADA DIRETA — a conversa do lead no mesmo webhook (P8)
 * ============================================================================
 *
 * Rodada de produção 1 (21/10/2026): o comercial passa a falar com o lead pela
 * Evolution, e a Evolution aceita UMA URL de webhook por instância, que é a do
 * canal de aprovação (`POST /approvals/canal/whatsapp/:orgId`, com o segredo no
 * cabeçalho). O grupo de links já é desviado ali (`entrada-de-grupo.registry.ts`);
 * este registro faz o mesmo com a conversa INDIVIDUAL: a resposta de um número
 * que é lead do comercial vai para a entrada do comercial, e o resto segue para
 * o canal exatamente como antes.
 *
 * O CANAL VEM PRIMEIRO. Antes de perguntar ao comercial, o registro confere se
 * o remetente é uma IDENTIDADE CADASTRADA do canal nesta empresa
 * (`ChannelIdentity` ativa, as mesmas formas literais de `formasDaChave`): se
 * for, a mensagem é de quem decide aprovação e nunca é desviada, mesmo que o
 * número também apareça num lead. O desvio só existe para quem o canal ignoraria
 * de qualquer jeito, e por isso não abre caminho até decisão nenhuma.
 *
 * POR REGISTRO, E NÃO POR IMPORT: a porta não importa o comercial. O comercial
 * se inscreve no arranque (`comercial/evolution-entrada.service.ts`). Sem
 * inscrito, nada muda. Só UM inscrito: um segundo assume no lugar, com aviso.
 *
 * O que passa por aqui já passou pelo segredo do webhook e roda no contexto da
 * empresa do caminho (`comTenantPublico`), depois de a rota ter respondido.
 */
@Injectable()
export class EntradaDiretaRegistry {
  private readonly log = new Logger('EntradaDireta');
  private entrada: { fn: EntradaDireta; quem: string } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  registrar(fn: EntradaDireta, quem: string): void {
    if (this.entrada) this.log.warn(`entrada direta já era de ${this.entrada.quem}; ${quem} assumiu no lugar`);
    this.entrada = { fn, quem };
  }

  get inscrito(): boolean {
    return this.entrada !== null;
  }

  /**
   * Despacha a conversa 1:1 para o inscrito, ou devolve `null` para o chamador
   * seguir para o canal: sem inscrito, evento que não é mensagem nova, mensagem
   * da própria instância, grupo, remetente sem telefone, identidade do canal, ou
   * o inscrito disse que não é dele. A falha do inscrito vira rótulo.
   */
  async despachar(orgId: string, evento: unknown): Promise<string | null> {
    if (!this.entrada) return null;
    const leitura = lerRemetenteDireto(evento);
    if (!leitura) return null;
    if ('ignorado' in leitura) {
      // Produção 22, M4: segue para o canal como antes; a razão fica no registro (sem número).
      this.log.log(`entrada direta (${orgId}): ${leitura.ignorado}`);
      return null;
    }
    const remetente = leitura.remetente;
    const identidade = await this.prisma.channelIdentity.findFirst({
      where: { orgId, canal: CANAL, ativo: true, externalId: { in: formasDaChave(remetente) } },
      select: { id: true },
    });
    if (identidade) return null;
    try {
      return await this.entrada.fn(orgId, evento, remetente);
    } catch (e) {
      this.log.warn(`entrada direta falhou (${orgId}): ${(e as Error).message}`);
      return 'erro';
    }
  }
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A razão de uma conversa `@lid` não ser desviada (Produção 22, M4). */
export const RAZAO_DO_LID_SEM_NUMERO = 'ignorado: remetente @lid sem número real';

/**
 * Quem mandou uma mensagem NOVA numa conversa individual: a chave (dígitos), a
 * razão de não ter (o `@lid` sem número real ao lado), ou `null` para evento
 * que não é `messages.upsert`, eco da própria instância, grupo (também pelo
 * `participant`) e remetente que não é telefone.
 */
export function lerRemetenteDireto(evento: unknown): { remetente: string } | { ignorado: string } | null {
  const raiz = objeto(evento);
  if (typeof raiz?.event !== 'string' || raiz.event.trim().toLowerCase() !== EVENTO_ACEITO) return null;
  const key = objeto(objeto(raiz.data)?.key);
  if (!key || key.fromMe === true) return null;
  if (ehGrupoDeWhatsapp(key.remoteJid)) return null;
  if (typeof key.participant === 'string' && key.participant.trim() !== '') return null;
  const r = remetenteDaKey(key);
  if (!r) return null;
  return 'lid' in r ? { ignorado: RAZAO_DO_LID_SEM_NUMERO } : { remetente: r.chave };
}

/** A chave (dígitos) do remetente 1:1, ou `null` (ver `lerRemetenteDireto`). */
export function remetenteDireto(evento: unknown): string | null {
  const r = lerRemetenteDireto(evento);
  return r && 'remetente' in r ? r.remetente : null;
}
