import { Inject, Injectable, Logger, OnModuleInit, Optional, forwardRef } from '@nestjs/common';
import { AgentEstado, Prisma } from '@prisma/client';

import { exigirTenant } from '../common/contexto-execucao';
import { LEITURA_DA_EVOLUTION, type LeituraDaEvolution } from '../gateway/canais/evolution.port';
import { proximaOcorrencia } from '../pauta/cron';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../routines/executores.registry';
import { LIVRE, TIPO_WHATSAPP_SINCRONIZAR, type ResultadoDaRotina } from '../routines/rotina.tipos';
import { ehEmpresaDaCasa } from '../tenants/empresa-da-casa';
import { GravadorDoWhatsappService } from './gravador.service';
import { lerChatDaEvolution, lerGrupoDaEvolution, lerRegistroDaEvolution, type ChatLido, type GrupoLido } from './leitura-da-evolution';

/*
 * ============================================================================
 * A SINCRONIZAÇÃO DO WHATSAPP (produção 22C, W1) — rotina `whatsapp.sincronizar`
 * ============================================================================
 *
 * O webhook grava o que chega; esta rotina traz o que ele PERDEU (API fora do
 * ar, reentrega que não veio) e mantém as conversas com nome, foto e
 * participantes. A cada 5 minutos, SÓ LEITURA, pela porta `LEITURA_DA_EVOLUTION`
 * (injeção por símbolo: este módulo nunca importa o conector):
 *
 *   1. `conversas` (`chat/findChats`) e `grupos` (`group/fetchAllGroups`):
 *      cria a conversa que falta e atualiza nome, foto e participantes. O nome
 *      do GRUPO acompanha o assunto (grupo é renomeado); o do 1:1 só entra
 *      quando a conversa ainda não tem nome;
 *   2. `mensagens` (`chat/findMessages`) das conversas com novidade (a última
 *      mensagem que a Evolution conhece é mais nova que a nossa, a conversa
 *      nunca foi sincronizada, ou a Evolution não diz a última e a conversa não
 *      é conferida há `REVISITA_MS`), a mais recente primeiro, até `TETO_DE_CONVERSAS`
 *      conversas e `TETO_DE_MENSAGENS` mensagens por passagem; o resto fica para
 *      a próxima. Por conversa, até `TETO_DE_PAGINAS` páginas, e para de
 *      paginar quando a página só traz o que já estava gravado;
 *   3. cada mensagem é gravada pela MESMA função do webhook
 *      (`GravadorDoWhatsappService.gravarMensagem`), com `origem: sincronizacao`
 *      e idempotente pelo `mensagemExternaId`;
 *   4. `casarConversa` (lane C) em cada conversa tocada.
 *
 * NÃO LIDAS, A DECISÃO (documentada no RESULTADO): a mensagem de ENTRADA que a
 * sincronização acha pela primeira vez soma 1 só se for mais nova que a
 * sincronização ANTERIOR daquela conversa (`sincronizadaEm` lido antes da
 * passagem). A primeira sincronização de uma conversa não soma nada: ela traz o
 * histórico que a Evolution guardava, e encher a bolha de "não lidas" com o que
 * a casa já leu no celular seria mentir. O que a casa mandou nunca soma.
 *
 * QUANDO NÃO RODA (`pulada`, sem linha de histórico): fora da empresa da casa,
 * sem a porta, com o conector desligado em Conexões ou sem a Evolution
 * configurada. FALHA DA EVOLUTION não derruba nada: `erro` com um resumo de
 * contagens (sem nome nem número) e a próxima passagem tenta de novo.
 *
 * NASCE LIGADA, e só na empresa da casa (o número da casa é o que tem a caixa):
 * ao contrário do vigia da agenda, ela não escreve fora do OS nem gasta
 * modelo; só lê a Evolution que a própria casa configurou.
 */

export const SLUG_DA_ROTINA_DO_WHATSAPP = 'whatsapp-sincronizar';
export const CRON_DO_WHATSAPP = '*/5 * * * *';
export const FUSO_DO_WHATSAPP = 'America/Sao_Paulo';

/** Quantas conversas buscam mensagens numa passagem. */
export const TETO_DE_CONVERSAS = 40;
/** Quantas mensagens a passagem lê no total. */
export const TETO_DE_MENSAGENS = 1500;
/** Quantas páginas por conversa. */
export const TETO_DE_PAGINAS = 3;
/** Mensagens por página pedida à Evolution. */
export const POR_PAGINA = 50;
/** Conversa cujo chat não diz a última mensagem é conferida de novo depois disto. */
export const REVISITA_MS = 30 * 60_000;

export const RESUMO_FORA_DA_CASA = 'A sincronização do WhatsApp só roda na empresa da casa: nada foi lido.';

interface Contagem {
  conversas: number;
  criadas: number;
  grupos: number;
  lidas: number;
  novas: number;
  falhas: number;
}

@Injectable()
export class SincronizacaoDoWhatsappService implements OnModuleInit {
  private readonly log = new Logger('SincronizacaoDoWhatsapp');
  private readonly semeadas = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => GravadorDoWhatsappService)) private readonly gravador: GravadorDoWhatsappService,
    @Optional() @Inject(LEITURA_DA_EVOLUTION) private readonly leitura?: LeituraDaEvolution,
    @Optional() private readonly executores?: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.executores?.registrar({ [TIPO_WHATSAPP_SINCRONIZAR]: (ctx) => this.passagem(ctx.orgId, ctx.agora) }, 'SincronizacaoDoWhatsappService');
  }

  /** A empresa é a da casa? A suíte troca. */
  protected ehDaCasa(orgId: string): Promise<boolean> {
    return ehEmpresaDaCasa(this.prisma, orgId);
  }

  /**
   * CONTRATO (chamado pela caixa, lane B, ao listar; e pelo gravador): semeia a
   * rotina `whatsapp.sincronizar` nesta empresa, só na empresa da casa, LIGADA
   * (`ativo: true`, `rodando`), a cada 5 min em São Paulo. Idempotente (uma vez
   * por processo e empresa; a linha que já existe não é tocada: se alguém a
   * pausou em /rotinas, fica pausada); nunca lança.
   */
  async garantirRotina(orgId: string): Promise<void> {
    if (!orgId || this.semeadas.has(orgId)) return;
    try {
      // Fora da casa não semeia (e não guarda o "não": a resposta é do banco, a cada vez).
      if (!(await this.ehDaCasa(orgId))) return;
      await this.prisma.rotina.upsert({
        where: { orgId_slug: { orgId, slug: SLUG_DA_ROTINA_DO_WHATSAPP } },
        create: {
          orgId,
          slug: SLUG_DA_ROTINA_DO_WHATSAPP,
          nome: 'Sincronizar o WhatsApp da empresa',
          tipo: TIPO_WHATSAPP_SINCRONIZAR,
          config: {} as Prisma.InputJsonValue,
          cron: CRON_DO_WHATSAPP,
          tz: FUSO_DO_WHATSAPP,
          ativo: true,
          estado: AgentEstado.rodando,
          origem: 'manual',
          refExterna: null,
          agenteSlug: null,
          reservadoEm: LIVRE,
          reservadoAte: LIVRE,
          proximaExecucaoEm: proximaOcorrencia(CRON_DO_WHATSAPP, FUSO_DO_WHATSAPP, new Date()),
        },
        update: {},
      });
      this.semeadas.add(orgId);
    } catch (e) {
      this.log.warn(`empresa ${orgId}: não semeei a rotina do WhatsApp (${(e as Error).name})`);
    }
  }

  /** Uma passagem. Ver o cabeçalho. */
  async passagem(orgIdBruto: string, agora: Date = new Date()): Promise<ResultadoDaRotina> {
    const orgId = exigirTenant(orgIdBruto, 'SincronizacaoDoWhatsappService.passagem');
    if (!(await this.ehDaCasa(orgId))) return { status: 'pulada', resumo: RESUMO_FORA_DA_CASA };
    const leitura = this.leitura;
    if (!leitura) return { status: 'pulada', resumo: 'Sem o conector da Evolution neste processo: nada foi lido.' };
    if (!(await leitura.ligado(orgId))) return { status: 'pulada', resumo: 'WhatsApp (Evolution) desligado em Conexões nesta empresa: nada foi lido.' };
    const instancia = await leitura.instanciaDaEmpresa(orgId);
    if (!instancia) return { status: 'pulada', resumo: 'Evolution não configurada nesta empresa: nada foi lido.' };

    const conta: Contagem = { conversas: 0, criadas: 0, grupos: 0, lidas: 0, novas: 0, falhas: 0 };
    const tocadas = new Set<string>();

    // 1. Os chats e os grupos. Uma leitura que falha não impede a outra.
    let chats: ChatLido[] = [];
    let grupos: GrupoLido[] = [];
    try {
      chats = (await leitura.conversas(orgId)).map((c) => lerChatDaEvolution(c, agora)).filter((c): c is ChatLido => !!c);
    } catch (e) {
      conta.falhas++;
      this.log.warn(`empresa ${orgId}: a Evolution não devolveu os chats (${(e as Error).name})`);
    }
    try {
      grupos = (await leitura.grupos(orgId)).map(lerGrupoDaEvolution).filter((g): g is GrupoLido => !!g);
    } catch (e) {
      conta.falhas++;
      this.log.warn(`empresa ${orgId}: a Evolution não devolveu os grupos (${(e as Error).name})`);
    }

    /** A conversa de cada chat, com o que ela era ANTES desta passagem. */
    const candidatas: Array<{ id: string; chatJid: string; lidJid: string | null; ultimaEvolution: Date | null; antes: { ultima: Date | null; sincronizada: Date | null } }> = [];
    const porJid = new Map<string, ChatLido>();
    for (const c of chats) porJid.set(c.chatJid, c);
    for (const g of grupos) if (!porJid.has(g.chatJid)) porJid.set(g.chatJid, { chatJid: g.chatJid, lidJid: null, grupo: true, nome: null, fotoUrl: null, ultimaEm: null });
    const grupoPorJid = new Map(grupos.map((g) => [g.chatJid, g]));

    for (const chat of porJid.values()) {
      try {
        const conversa = await this.gravador.garantirConversa(orgId, instancia, { chatJid: chat.chatJid, lidJid: chat.lidJid, grupo: chat.grupo });
        conta.conversas++;
        if (conversa.criada) conta.criadas++;
        const antes = await this.prisma.whatsAppConversa.findUniqueOrThrow({
          where: { id: conversa.id },
          select: { ultimaMensagemEm: true, sincronizadaEm: true, nome: true, fotoUrl: true, lidJid: true },
        });
        const g = grupoPorJid.get(chat.chatJid);
        const dados: Prisma.WhatsAppConversaUpdateInput = {};
        if (g) {
          conta.grupos++;
          if (g.nome && g.nome !== antes.nome) dados.nome = g.nome;
          if (g.participantes !== null) dados.participantes = g.participantes;
          if (g.participantesLista) dados.participantesLista = g.participantesLista as unknown as Prisma.InputJsonValue;
          if (g.fotoUrl && g.fotoUrl !== antes.fotoUrl) dados.fotoUrl = g.fotoUrl;
        } else if (!chat.grupo && chat.nome && !antes.nome) {
          dados.nome = chat.nome;
        }
        if (!g && chat.fotoUrl && chat.fotoUrl !== antes.fotoUrl) dados.fotoUrl = chat.fotoUrl;
        if (Object.keys(dados).length) {
          await this.prisma.whatsAppConversa.update({ where: { id: conversa.id }, data: dados });
          tocadas.add(conversa.id);
        }
        if (conversa.criada) tocadas.add(conversa.id);
        // Tem novidade? Nunca sincronizou; ou a última da Evolution é mais nova que a nossa; ou a
        // Evolution não diz quando foi a última e a conversa não é conferida há `REVISITA_MS`.
        const novidade =
          !antes.sincronizadaEm ||
          (chat.ultimaEm ? !antes.ultimaMensagemEm || chat.ultimaEm > antes.ultimaMensagemEm : agora.getTime() - antes.sincronizadaEm.getTime() >= REVISITA_MS);
        if (novidade) {
          candidatas.push({
            id: conversa.id,
            chatJid: conversa.chatJid,
            lidJid: antes.lidJid,
            ultimaEvolution: chat.ultimaEm,
            antes: { ultima: antes.ultimaMensagemEm, sincronizada: antes.sincronizadaEm },
          });
        }
      } catch (e) {
        conta.falhas++;
        this.log.warn(`empresa ${orgId}: não consegui gravar uma conversa (${(e as Error).name})`);
      }
    }

    // 2. As mensagens das conversas com novidade, a mais recente primeiro.
    candidatas.sort((a, b) => (b.ultimaEvolution?.getTime() ?? 0) - (a.ultimaEvolution?.getTime() ?? 0));
    for (const c of candidatas.slice(0, TETO_DE_CONVERSAS)) {
      if (conta.lidas >= TETO_DE_MENSAGENS) break;
      const r = await this.mensagensDaConversa(orgId, instancia, c, agora, conta);
      if (r.tocou) tocadas.add(c.id);
      if (r.completa) {
        await this.prisma.whatsAppConversa.update({ where: { id: c.id }, data: { sincronizadaEm: agora } });
      }
      // A Evolution não devolveu as mensagens: as outras conversas ficam para a próxima passagem.
      if (r.falhou) break;
    }

    // 3. O vínculo (lane C) de cada conversa tocada.
    for (const id of tocadas) await this.gravador.casar(orgId, id);

    const resumo =
      `${conta.conversas} conversa(s) (${conta.criadas} nova(s), ${conta.grupos} grupo(s)); ` +
      `${conta.lidas} mensagem(ns) lida(s), ${conta.novas} gravada(s) agora` +
      (conta.falhas ? `; ${conta.falhas} leitura(s) falharam e voltam na próxima passagem` : '');
    if (conta.falhas && !conta.conversas && !conta.lidas) return { status: 'erro', resumo: `A Evolution não respondeu: ${resumo}.` };
    return { status: conta.falhas ? 'erro' : 'ok', resumo: `${resumo}.` };
  }

  /**
   * As páginas de uma conversa (e do lid dela, quando há): para quando a página
   * acaba, quando só traz o que já estava gravado, ou nos tetos. `completa` =
   * leu tudo o que precisava (então a conversa ganha `sincronizadaEm`).
   */
  private async mensagensDaConversa(
    orgId: string,
    instancia: string,
    c: { id: string; chatJid: string; lidJid: string | null; antes: { sincronizada: Date | null } },
    agora: Date,
    conta: Contagem,
  ): Promise<{ tocou: boolean; completa: boolean; falhou?: boolean }> {
    const leitura = this.leitura!;
    let tocou = false;
    const jids = [c.chatJid, ...(c.lidJid && c.lidJid !== c.chatJid ? [c.lidJid] : [])];
    for (const jid of jids) {
      for (let pagina = 1; pagina <= TETO_DE_PAGINAS; pagina++) {
        if (conta.lidas >= TETO_DE_MENSAGENS) return { tocou, completa: false };
        let lote: { registros: unknown[]; paginas: number };
        try {
          lote = await leitura.mensagens(orgId, jid, pagina, POR_PAGINA);
        } catch (e) {
          conta.falhas++;
          this.log.warn(`empresa ${orgId}: a Evolution não devolveu as mensagens de uma conversa (${(e as Error).name})`);
          return { tocou, completa: false, falhou: true };
        }
        let novasNaPagina = 0;
        for (const reg of lote.registros) {
          const l = lerRegistroDaEvolution(reg, agora);
          if (!('mensagem' in l)) continue;
          conta.lidas++;
          // Só o que é desta conversa (a Evolution devolve pelo filtro, mas o corpo é de fora).
          const daConversa = new Set([c.chatJid, c.lidJid].filter((x): x is string => !!x));
          if (!daConversa.has(l.mensagem.chatJid) && !(l.mensagem.lidJid && daConversa.has(l.mensagem.lidJid))) continue;
          const somarNaoLida = !!c.antes.sincronizada && l.mensagem.timestamp > c.antes.sincronizada;
          try {
            const g = await this.gravador.gravarMensagem(orgId, instancia, l.mensagem, 'sincronizacao', { somarNaoLida });
            if (g.nova) {
              novasNaPagina++;
              conta.novas++;
              tocou = true;
            }
          } catch (e) {
            conta.falhas++;
            this.log.warn(`empresa ${orgId}: não consegui gravar uma mensagem sincronizada (${(e as Error).name})`);
          }
        }
        // Página vazia, última página, ou página só com o que já estava gravado: esta conversa acabou.
        if (!lote.registros.length || pagina >= lote.paginas || novasNaPagina === 0) break;
      }
    }
    return { tocou, completa: true };
  }
}
