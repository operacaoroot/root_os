import { Inject, Injectable, Logger, OnModuleInit, Optional, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { CONECTOR_EVOLUTION, LEITURA_DA_EVOLUTION, type LeituraDaEvolution } from '../gateway/canais/evolution.port';
import { GravacaoDoWhatsappRegistry } from '../gateway/canais/gravacao-do-whatsapp.registry';
import { RegistroDeConectores } from '../integrations/conectores.registry';
import { PrismaService } from '../prisma/prisma.service';
import { lerCorpoDoWebhook, type MensagemLida } from './leitura-da-evolution';
import { SincronizacaoDoWhatsappService } from './sincronizacao.service';
import { VinculoDoWhatsappService } from './vinculo.service';

/*
 * ============================================================================
 * O GRAVADOR — tudo o que chega fica gravado (produção 22C, W1)
 * ============================================================================
 *
 * Inscreve-se no `GravacaoDoWhatsappRegistry` (da porta, global) e recebe o
 * corpo do webhook da Evolution ANTES dos leitores de sempre (grupo de links,
 * entrada do lead, canal de aprovação). Grava e devolve um rótulo curto; nunca
 * lança, e nada do que ele faz muda o que os leitores recebem (o controlador
 * entrega a eles o MESMO corpo, depois).
 *
 * A PROVA DE EMPRESA é a mesma da entrada do lead: o segredo do webhook já
 * abriu o contexto da empresa do caminho, e a INSTÂNCIA do corpo tem de ser a
 * desta empresa (`LEITURA_DA_EVOLUTION.instanciaDaEmpresa`). Sem instância no
 * corpo, ou de outra instância, não grava. Conector desligado em Conexões
 * também não grava: desligado é "nada sai nem entra".
 *
 * A MESMA FUNÇÃO GRAVA O QUE A SINCRONIZAÇÃO TRAZ (`gravarMensagem`): um lugar
 * só para a conversa canônica, a idempotência por `(empresa, instância,
 * mensagemExternaId)` e a conta das não lidas.
 *
 * NÃO LIDAS: soma 1 só na mensagem de ENTRADA gravada pela primeira vez (a
 * duplicata não muda nada; o que a casa mandou, `deMim`, não soma). O que a
 * sincronização acha pela primeira vez soma só se o chamador disser
 * (`somarNaoLida`), e ela diz só para mensagem mais nova que a sincronização
 * anterior daquela conversa (ver `sincronizacao.service.ts`).
 *
 * `CONNECTION_UPDATE`: o estado da instância mudou; a sonda guardada da
 * Evolution desta empresa é esquecida (`RegistroDeConectores.esquecer`), e a
 * tela de Conexões mede de novo na próxima leitura. O log leva o estado, nunca
 * o número.
 *
 * NO LOG: rótulos e contagens. Nunca número, nome, texto nem corpo.
 */

/** Como a linha chegou (a coluna `WhatsAppMensagem.origem`). */
export type OrigemDaGravacao = 'webhook' | 'sincronizacao';

export interface OpcoesDaGravacao {
  /** Mensagem de entrada nova soma 1 nas não lidas? (webhook: sempre; sincronização: o chamador decide.) */
  somarNaoLida: boolean;
}

export interface ResultadoDaGravacao {
  conversaId: string;
  nova: boolean;
}

/** A conversa que a gravação acha ou cria. */
export interface ConversaGarantida {
  id: string;
  chatJid: string;
  nome: string | null;
  leadId: string | null;
  clienteId: string | null;
  criada: boolean;
}

/** A dica de conversa que a gravação recebe (o que se sabe do chat). */
export interface DicaDaConversa {
  chatJid: string;
  lidJid: string | null;
  grupo: boolean;
}

const SELECT_GARANTIDA = { id: true, chatJid: true, nome: true, leadId: true, clienteId: true } satisfies Prisma.WhatsAppConversaSelect;

function ehDuplicata(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

@Injectable()
export class GravadorDoWhatsappService implements OnModuleInit {
  private readonly log = new Logger('GravadorDoWhatsapp');

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly registro?: GravacaoDoWhatsappRegistry,
    @Optional() @Inject(LEITURA_DA_EVOLUTION) private readonly leitura?: LeituraDaEvolution,
    @Optional() private readonly conectores?: RegistroDeConectores,
    @Optional() private readonly vinculo?: VinculoDoWhatsappService,
    @Optional() @Inject(forwardRef(() => SincronizacaoDoWhatsappService)) private readonly sincronizacao?: SincronizacaoDoWhatsappService,
  ) {}

  onModuleInit(): void {
    this.registro?.registrar((orgId, evento) => this.gravar(orgId, evento), 'whatsapp/gravador');
  }

  /** O que o webhook entrega. Devolve o rótulo para o log (sem número nem texto); nunca lança. */
  async gravar(orgId: string, evento: unknown, agora: Date = new Date()): Promise<string | null> {
    try {
      return await this.gravarOuLancar(orgId, evento, agora);
    } catch (e) {
      this.log.warn(`empresa ${orgId}: gravação do WhatsApp falhou (${(e as Error).name})`);
      return 'erro';
    }
  }

  private async gravarOuLancar(orgId: string, evento: unknown, agora: Date): Promise<string | null> {
    const lido = lerCorpoDoWebhook(evento, agora);
    if (lido.tipo === 'ignorado') return `ignorado: ${lido.motivo}`;
    if (!this.leitura) return 'ignorado: sem conector';
    if (!(await this.leitura.ligado(orgId))) return 'ignorado: conector desligado';
    const instancia = await this.leitura.instanciaDaEmpresa(orgId);
    if (!instancia || !lido.instancia) return 'ignorado: sem instância';
    if (lido.instancia !== instancia) return 'ignorado: outra instância';

    if (lido.tipo === 'conexao') {
      this.conectores?.esquecer(orgId, CONECTOR_EVOLUTION);
      this.log.log(`empresa ${orgId}: instância do WhatsApp em "${lido.estado}"`);
      return `conexão: ${lido.estado}`;
    }

    if (!lido.lidas.length) return `ignorado: ${lido.ignoradas[0] ?? 'sem mensagem'}`;
    let novas = 0;
    let repetidas = 0;
    const tocadas = new Set<string>();
    for (const m of lido.lidas) {
      const r = await this.gravarMensagem(orgId, instancia, m, 'webhook', { somarNaoLida: true });
      tocadas.add(r.conversaId);
      if (r.nova) novas++;
      else repetidas++;
    }
    for (const id of tocadas) await this.casar(orgId, id);
    await this.sincronizacao?.garantirRotina(orgId);
    return novas ? `gravada${novas > 1 ? `s ${novas}` : ''}` : `repetida${repetidas > 1 ? `s ${repetidas}` : ''}`;
  }

  /** O contrato da lane C, que nunca lança; protegido mesmo assim (o webhook não pode cair por ele). */
  async casar(orgId: string, conversaId: string): Promise<void> {
    try {
      await this.vinculo?.casarConversa(orgId, conversaId);
    } catch (e) {
      this.log.warn(`empresa ${orgId}: casar a conversa falhou (${(e as Error).name})`);
    }
  }

  // ---------------------------------------------------------------- a conversa

  /**
   * Acha (ou cria) a conversa de um chat, na ordem:
   *   1. pelo `chatJid` canônico;
   *   2. com o lid na mão: a conversa que já guarda este lid em `lidJid`, ou a
   *      que nasceu só com ele (`chatJid` = lid). Esta última, quando agora se
   *      sabe o número, PASSA a ser a do número (o lid vai para `lidJid`, as
   *      mensagens dela também mudam de `chatJid`);
   *   3. chegou só o lid: a conversa do número que já o conhece (`lidJid`);
   *   4. cria. Duas entregas ao mesmo tempo para um chat novo: a segunda cai no
   *      índice único e relê.
   */
  async garantirConversa(orgId: string, instancia: string, dica: DicaDaConversa): Promise<ConversaGarantida> {
    const porChat = await this.prisma.whatsAppConversa.findUnique({
      where: { orgId_instancia_chatJid: { orgId, instancia, chatJid: dica.chatJid } },
      select: { ...SELECT_GARANTIDA, lidJid: true },
    });
    if (porChat) {
      if (dica.lidJid && porChat.lidJid !== dica.lidJid) {
        // O lid novo desta conversa (o antigo, se havia, fica para trás: o WhatsApp não reaproveita lid).
        await this.prisma.whatsAppConversa.update({ where: { id: porChat.id }, data: { lidJid: dica.lidJid } });
      }
      return { ...porChat, criada: false };
    }

    const lid = dica.lidJid ?? (dica.chatJid.endsWith('@lid') ? dica.chatJid : null);
    if (lid) {
      const doLid = await this.prisma.whatsAppConversa.findFirst({
        where: { orgId, instancia, OR: [{ lidJid: lid }, { chatJid: lid }] },
        orderBy: { criadoEm: 'asc' },
        select: SELECT_GARANTIDA,
      });
      if (doLid) {
        const promover = !!dica.lidJid && doLid.chatJid === lid && dica.chatJid !== lid;
        if (promover) {
          try {
            await this.prisma.$transaction([
              this.prisma.whatsAppConversa.update({ where: { id: doLid.id }, data: { chatJid: dica.chatJid, lidJid: lid } }),
              this.prisma.whatsAppMensagem.updateMany({ where: { orgId, conversaId: doLid.id }, data: { chatJid: dica.chatJid } }),
            ]);
            return { ...doLid, chatJid: dica.chatJid, criada: false };
          } catch (e) {
            if (!ehDuplicata(e)) throw e;
            // Outra entrega criou a do número no meio do caminho: fica com ela.
            return this.garantirConversa(orgId, instancia, { ...dica, lidJid: null });
          }
        }
        return { ...doLid, criada: false };
      }
    }

    try {
      const criada = await this.prisma.whatsAppConversa.create({
        data: { orgId, instancia, chatJid: dica.chatJid, lidJid: dica.lidJid, grupo: dica.grupo },
        select: SELECT_GARANTIDA,
      });
      return { ...criada, criada: true };
    } catch (e) {
      if (!ehDuplicata(e)) throw e;
      const outra = await this.prisma.whatsAppConversa.findUniqueOrThrow({
        where: { orgId_instancia_chatJid: { orgId, instancia, chatJid: dica.chatJid } },
        select: SELECT_GARANTIDA,
      });
      return { ...outra, criada: false };
    }
  }

  // ---------------------------------------------------------------- a mensagem

  /**
   * Grava UMA mensagem lida (do webhook ou da sincronização). Idempotente por
   * `(empresa, instância, mensagemExternaId)`: a duplicata não muda nada.
   */
  async gravarMensagem(orgId: string, instancia: string, m: MensagemLida, origem: OrigemDaGravacao, opcoes: OpcoesDaGravacao): Promise<ResultadoDaGravacao> {
    const conversa = await this.garantirConversa(orgId, instancia, { chatJid: m.chatJid, lidJid: m.lidJid, grupo: m.grupo });

    // A duplicata mais comum (o webhook e a sincronização trazendo a mesma) sai sem tentar o insert.
    const ja = await this.prisma.whatsAppMensagem.findUnique({
      where: { orgId_instancia_mensagemExternaId: { orgId, instancia, mensagemExternaId: m.mensagemExternaId } },
      select: { conversaId: true },
    });
    if (ja) return { conversaId: ja.conversaId, nova: false };

    try {
      await this.prisma.whatsAppMensagem.create({
        data: {
          orgId,
          conversaId: conversa.id,
          instancia,
          chatJid: conversa.chatJid,
          grupo: m.grupo,
          remetenteJid: m.remetenteJid,
          remetenteNumero: m.remetenteNumero,
          remetenteNome: m.remetenteNome,
          deMim: m.deMim,
          direcao: m.direcao,
          tipo: m.tipo,
          texto: m.texto,
          midia: m.midia ? (m.midia as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          mensagemExternaId: m.mensagemExternaId,
          citaMensagemExternaId: m.citaMensagemExternaId,
          timestamp: m.timestamp,
          leadId: conversa.leadId,
          clienteId: conversa.clienteId,
          origem,
        },
        select: { id: true },
      });
    } catch (e) {
      if (ehDuplicata(e)) return { conversaId: conversa.id, nova: false };
      throw e;
    }

    // A conversa anda: última mensagem (só para frente), não lidas e o nome do contato.
    await this.prisma.whatsAppConversa.updateMany({
      where: { id: conversa.id, orgId, OR: [{ ultimaMensagemEm: null }, { ultimaMensagemEm: { lt: m.timestamp } }] },
      data: { ultimaMensagemEm: m.timestamp },
    });
    if (opcoes.somarNaoLida && m.direcao === 'entrada') {
      await this.prisma.whatsAppConversa.update({ where: { id: conversa.id }, data: { naoLidas: { increment: 1 } } });
    }
    // O nome do 1:1 pelo pushName de quem escreveu, só quando ainda não há nome (nunca o da casa, nunca no grupo).
    if (!m.grupo && !m.deMim && !conversa.nome && m.remetenteNome) {
      await this.prisma.whatsAppConversa.updateMany({ where: { id: conversa.id, orgId, nome: null }, data: { nome: m.remetenteNome } });
    }
    return { conversaId: conversa.id, nova: true };
  }
}
