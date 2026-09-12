import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { PolicyService } from '../../policy/policy.service';
import { exigeMotivo } from '../../approvals/alcada';
import { exigirTenant } from '../../common/contexto-execucao';
import {
  FRASE_DA_QUEIXA,
  diagnosticoDoCanal,
  segredoDoCodigo,
  capacidadesDoCanal,
} from './configuracao-do-canal';
import { CANAL, decisoresComCanal } from './quem-decide';
import { codigoDaAprovacao } from './resposta-de-canal';
import { fraseDaRecusa, motivoParaNaoDecidir } from './pode-decidir-no-canal';
import {
  conteudoExato,
  conteudoFoiRedigido,
  textoDoAviso,
  textoDoPedido,
  type PedidoParaOCanal,
} from './pedido-no-canal';
import { TransporteDeCanalRegistry } from './transporte.registry';

/*
 * ============================================================================
 * O PEDIDO SAI PARA QUEM PODE ASSINAR — e só para quem pode assinar (RF-A-06)
 * ============================================================================
 *
 * ----------------------------------------------------------------------------
 * POR QUE ISTO NÃO É AÇÃO DO GATEWAY — a pergunta que 02-CONSTRAINTS obriga
 * ----------------------------------------------------------------------------
 * "Nunca ação fora do Tool Gateway." Mandar uma mensagem de WhatsApp daqui
 * parece violar isso, e a distinção precisa estar escrita, não subentendida.
 *
 * O que a porta governa é AÇÃO SOBRE O MUNDO POR CONTA DO SISTEMA: o agente quer
 * publicar, o operador quer enviar, e a régua decide se pode. É por isso que
 * `whatsapp.mensagem.enviar` é R3 e pede assinatura de gente.
 *
 * O que sai daqui é outra coisa: é a NOTIFICAÇÃO de que existe uma decisão
 * esperando, entregue à pessoa que precisa decidi-la. É da mesma natureza de um
 * e-mail de "alguém pediu sua aprovação" — o sistema falando com o próprio
 * operador sobre o próprio sistema. Não escolhe destinatário (é sempre quem já
 * está cadastrado e já pode assinar aquela linha), não carrega conteúdo que o
 * agente tenha escolhido publicar, e não produz efeito nenhum fora do OS além da
 * própria mensagem.
 *
 * A prova de que a distinção não é retórica: se ela fosse ação de catálogo, o
 * pedido de aprovação de uma mensagem de WhatsApp exigiria... uma aprovação, que
 * exigiria um pedido, que exigiria uma aprovação. Um canal de aprovação não pode
 * depender de si mesmo para existir.
 *
 * O QUE ISSO CUSTA, declarado: o número da instância da ROOT manda mensagem sem
 * passar por classificação. O que contém o alcance é (1) o destino nunca vem de
 * fora — sai de `ChannelIdentity` desta empresa, filtrado por quem pode assinar;
 * (2) o texto é montado por função pura deste repositório, nunca por modelo; (3)
 * o canal inteiro está atrás dos dois segredos de `configuracao-do-canal.ts`, e
 * desligado é o padrão; (4) a promessa de que este não é um segundo caminho até
 * o conector deixou de ser comentário e virou catraca — ver
 * `test/arquitetura.test.ts`, "mensagem de serviço do canal só sai do canal".
 *
 * ----------------------------------------------------------------------------
 * O DEGRAU QUE ESTE CANAL NÃO ALCANÇA — "reautenticar por WhatsApp" não existe
 * ----------------------------------------------------------------------------
 * R4 e R5 exigem que a pessoa PROVE de novo que é ela (`Decisao.exigeReautenticacao`,
 * conferido em `ApprovalsService.confirm` contra `ReauthService`) e exigem MOTIVO
 * ESCRITO. Pelo WhatsApp, as duas coisas são impossíveis de fazer direito:
 *
 *  · A prova é a SENHA (ou um token curto emitido por `POST /auth/reautenticar`).
 *    Pedir senha numa conversa de WhatsApp a escreveria em claro no aparelho de
 *    quem digitou, na prévia da notificação da tela de bloqueio, e no banco da
 *    instância da Evolution — que fica fora do OS, fora da cifragem do cofre e
 *    fora da retenção do RASTRO. Seria trocar uma reautenticação por um
 *    vazamento de credencial.
 *  · E o fator em si é mais FRACO do que o que já se tem, não mais forte: quem
 *    responde no canal provou posse de um número de telefone, e número de
 *    telefone é o fator que se toma de alguém com uma troca de chip. Aceitar isso
 *    como "reautenticação" seria chamar de segunda prova o que é uma prova pior
 *    que a primeira.
 *  · O motivo escrito poderia, em tese, ser digitado. Não vale a pena: ele só é
 *    exigido nos mesmos degraus que exigem reautenticação, e um canal que aceita
 *    metade do rito de R4 é um canal que parece aceitar R4.
 *
 * Então a resposta honesta é a que a fatia pediu que se desse se fosse o caso:
 * **não dá**, e o canal fica limitado aos degraus em que dá — R2 e R3, que é
 * onde mora a única capacidade com efeito ligado hoje. Em R4/R5 a pessoa recebe
 * um AVISO sem código: sabe que há algo esperando, e decide na tela. A recusa
 * também é reforçada do lado de dentro (`canal-de-aprovacao.service.ts`), para
 * que um pedido montado à mão não consiga o que o envio não oferece.
 */
@Injectable()
export class EnvioDeAprovacaoService implements OnModuleInit {
  private readonly log = new Logger('CanalDeAprovacao.envio');

  constructor(
    private readonly prisma: PrismaService,
    private readonly transporte: TransporteDeCanalRegistry,
    /*
     * O CATÁLOGO — para UMA pergunta: qual a sensibilidade do efeito desta
     * capacidade. É ela que decide entre o pedido com conteúdo exato e o aviso
     * sem código (ver `pode-decidir-no-canal.ts`).
     *
     * `@Optional()` porque as suítes montam este serviço à mão. A ausência é
     * FALHA FECHADA: sem catálogo, `motivoParaNaoDecidir` responde
     * `'sem-catalogo'` e o canal manda o aviso — nunca o conteúdo.
     */
    @Optional() private readonly policy?: PolicyService,
  ) {}

  /**
   * O ARRANQUE FALA EM VOZ ALTA sobre o canal mal configurado.
   *
   * `diagnosticoDoCanal` existia e não era chamada por ninguém: quem preenchia
   * só um dos dois segredos, ou um segredo curto, recebia silêncio absoluto e
   * concluía que o canal estava ligado. Não DERRUBA o arranque — o canal é uma
   * saída opcional (ver `transporte.registry.ts`), e derrubar a API por causa
   * dele transformaria o opcional em obrigatório.
   */
  onModuleInit(): void {
    const { ligado, queixas } = diagnosticoDoCanal();
    if (queixas.length > 0) {
      this.log.error(
        'CANAL DE APROVAÇÃO MAL CONFIGURADO — ele fica DESLIGADO (nenhum pedido sai, o webhook ' +
          `responde 404): ${queixas.map((q) => FRASE_DA_QUEIXA[q]).join(' ')}`,
      );
      return;
    }
    if (!ligado) return; // ninguém preencheu nada: desligado é o padrão
    this.log.log(
      `canal de aprovação configurado; capacidades que ele pode decidir: ${
        capacidadesDoCanal().join(', ') || '(nenhuma)'
      }`,
    );
  }

  /** O canal está ligado? Os dois segredos configurados E transporte inscrito. */
  get ligado(): boolean {
    return segredoDoCodigo() !== null && this.transporte.ligado(CANAL);
  }

  /**
   * Manda o pedido de decisão para quem pode assiná-lo.
   *
   * NUNCA LANÇA e nunca bloqueia: quem chama é `ApprovalsService.propor`, no
   * meio da retenção de uma ação. Uma Evolution fora do ar não pode impedir uma
   * ação de ser RETIDA — reter é a parte que protege; notificar é conforto.
   *
   * Devolve quantas pessoas receberam, para o log e para o teste.
   */
  async notificar(orgId: string, approvalId: string): Promise<number> {
    if (!this.ligado) return 0;
    try {
      return await this.tentarNotificar(orgId, approvalId);
    } catch (e) {
      this.log.warn(
        `não deu para avisar sobre a aprovação ${approvalId}: ${(e as Error).message}`,
      );
      return 0;
    }
  }

  private async tentarNotificar(orgId: string, approvalId: string): Promise<number> {
    exigirTenant(orgId, 'EnvioDeAprovacaoService.notificar');
    const segredo = segredoDoCodigo();
    if (!segredo) return 0;

    const ap = await this.prisma.approval.findFirst({
      where: { id: approvalId, orgId },
      select: {
        id: true,
        tokenHash: true,
        resumo: true,
        nivelExigido: true,
        alcadaMinima: true,
        exigeReauth: true,
        capabilityId: true,
        toolCallId: true,
        contentHash: true,
        expiraEm: true,
        propostoPorId: true,
      },
    });
    if (!ap) return 0;

    const destinos = await decisoresComCanal(
      this.prisma as never,
      orgId,
      ap.alcadaMinima,
      ap.propostoPorId,
    );
    if (destinos.length === 0) return 0;

    const chamada = ap.toolCallId
      ? await this.prisma.toolCall.findFirst({
          where: { id: ap.toolCallId, orgId },
          select: { args: true },
        })
      : null;
    const args = (chamada?.args ?? {}) as Record<string, unknown>;

    const comum = {
      resumo: ap.resumo,
      nivel: String(ap.nivelExigido),
      capacidade: ap.capabilityId,
      hashCurto: ap.contentHash.slice(0, 12),
      expiraEm: ap.expiraEm,
      args,
    };

    const texto = this.montarTexto(orgId, ap, comum, segredo, !!chamada);

    let entregues = 0;
    for (const destino of destinos) {
      const ok = await this.transporte.entregar(CANAL, destino.enderecoDoCanal, texto);
      if (ok) entregues += 1;
    }
    this.log.log(
      `aprovação ${approvalId} (${ap.nivelExigido}) avisada a ${entregues}/${destinos.length} ` +
        'identidade(s) do canal',
    );
    return entregues;
  }

  /**
   * A SENSIBILIDADE DO EFEITO desta capacidade, do catálogo.
   *
   * `undefined` quando não há catálogo injetado OU quando a capacidade não está
   * no catálogo desta empresa — e os dois casos dão no mesmo: `motivoParaNaoDecidir`
   * recusa mostrar o conteúdo.
   */
  private sensibilidadeDe(orgId: string, capabilityId: string | null): string | undefined {
    if (!capabilityId || !this.policy) return undefined;
    return this.policy.resolverCapacidade(orgId, capabilityId)?.efeito?.sensibilidade;
  }

  /**
   * O texto: pedido com conteúdo exato, ou aviso sem código.
   *
   * AS RAZÕES PARA NÃO OFERECER A DECISÃO, todas explícitas e em ordem:
   *   · o degrau exige reautenticação ou motivo escrito (R4/R5);
   *   · a capacidade não está na LISTA DE PERMISSÃO desta empresa;
   *   · o efeito dela NÃO é de sensibilidade `publica` — e este canal não repete
   *     conteúdo não público numa conversa de WhatsApp;
   *   · não há catálogo para responder as duas perguntas acima;
   *   · não há ação retida (superfície antiga, sem conteúdo para mostrar);
   *   · o conteúdo não cabe inteiro ou veio redigido pela porta.
   *
   * A SEGUNDA E A TERCEIRA são a correção da fatia: ver o cabeçalho de
   * `pode-decidir-no-canal.ts`. E são a MESMA função que
   * `CanalDeAprovacaoService.aprovar` chama de novo do lado de dentro — quem tem
   * o segredo de derivação produz código para qualquer aprovação, então "o canal
   * não ofereceu" nunca pode ser a única trava.
   */
  private montarTexto(
    orgId: string,
    ap: {
      id: string;
      tokenHash: string;
      exigeReauth: boolean;
      nivelExigido: unknown;
      capabilityId: string | null;
    },
    comum: Omit<PedidoParaOCanal, 'codigo'>,
    segredo: string,
    temAcaoRetida: boolean,
  ): string {
    if (ap.exigeReauth || exigeMotivo(String(ap.nivelExigido))) {
      return textoDoAviso(
        comum,
        'Este degrau exige reautenticação e motivo escrito. O WhatsApp não serve para ' +
          'provar identidade — decidir aqui seria pedir sua senha numa conversa.',
      );
    }
    if (!temAcaoRetida) {
      return textoDoAviso(
        comum,
        'Esta aprovação não retém uma ação com conteúdo — não há o que mostrar por aqui.',
      );
    }

    const recusa = motivoParaNaoDecidir({
      capabilityId: ap.capabilityId,
      sensibilidade: this.sensibilidadeDe(orgId, ap.capabilityId),
      temCatalogo: !!this.policy,
    });
    if (recusa) return textoDoAviso(comum, fraseDaRecusa(recusa));

    const conteudo = conteudoExato(comum.args);
    if (conteudo === null) {
      return textoDoAviso(
        comum,
        conteudoFoiRedigido(comum.args)
          ? 'O conteúdo desta ação é restrito e está redigido no registro: só a tela mostra.'
          : 'O conteúdo é longo demais para caber inteiro numa mensagem, e decidir sobre um ' +
              'trecho cortado não é decidir sobre o que vai sair.',
      );
    }
    return textoDoPedido(
      { ...comum, codigo: codigoDaAprovacao(segredo, orgId, ap.id, ap.tokenHash) },
      conteudo,
    );
  }

  /** Uma linha de serviço para uma identidade já resolvida. Só o canal usa. */
  async responder(destino: string, texto: string): Promise<boolean> {
    return this.transporte.entregar(CANAL, destino, texto);
  }
}
