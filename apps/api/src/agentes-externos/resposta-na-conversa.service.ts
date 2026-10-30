import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import {
  RESPOSTA_DE_GENTE_PELA_EVOLUTION,
  type RespostaDeGentePelaEvolution,
} from '../gateway/canais/evolution.port';
import { ConversaResponderArgs, JANELA_DA_RESPOSTA_MS, dentroDaJanela, lerArgumentos } from './argumentos-da-central';

/*
 * ============================================================================
 * `whatsapp.conversa.responder` — RESPONDER NA MESMA CONVERSA (política 1.13.0)
 * ============================================================================
 *
 * A Rootinha recebe o pedido pelo WhatsApp da empresa (o repasse do webhook) e
 * responde ali mesmo. O que esta capacidade NÃO deixa fazer é o que a separa de
 * `whatsapp.mensagem.enviar`/`comercial.whatsapp.enviar`: escolher para quem.
 *
 * O DESTINO SAI DA MENSAGEM GRAVADA. O argumento é o `mensagemId` (o id da
 * Evolution) da mensagem que pediu; o efeito acha a linha em `WhatsAppMensagem`
 * DESTA empresa, confere que ela CHEGOU (não é do próprio número) e responde no
 * `chatJid` dela. Um id inventado não acha linha; um id de outra empresa não
 * acha linha; uma conversa velha passa da janela de 24 h.
 *
 * O NÍVEL É R3, E NÃO O R1 QUE FOI PEDIDO. Mandar mensagem no WhatsApp sai da
 * casa e não tem desenviar, e a escada classifica isso como R3 (o teste "a
 * escrita que sai para fora sem volta nunca é menos que R3" da política é a
 * catraca). Declarar R1 exigiria mentir no `efeito` do catálogo, e o nível real
 * é o MAIOR entre o declarado e o calculado — a porta trataria como R3 de
 * qualquer jeito, só que com o catálogo dizendo outra coisa. Então: a resposta
 * fica retida para aprovação até alguém decidir mudar a régua (ver o relatório).
 * Quando sair, sai pela mesma porta da caixa (`responderComoPessoa`), que
 * confere o interruptor do conector e a credencial da empresa.
 *
 * Mora fora do conector e conversa com ele pela PORTA da caixa
 * (`RESPOSTA_DE_GENTE_PELA_EVOLUTION`), como `whatsapp/caixa.service.ts`: a
 * catraca de arquitetura proíbe importar o serviço do conector fora do gateway.
 */
@Injectable()
export class RespostaNaConversaService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registro: EfeitosRegistry,
    @Optional() @Inject(RESPOSTA_DE_GENTE_PELA_EVOLUTION) private readonly evolution?: RespostaDeGentePelaEvolution,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(
      { 'whatsapp.conversa.responder': (a, org, ctx) => this.responder(a, org, ctx) },
      'RespostaNaConversaService (whatsapp.conversa.responder, política 1.13.0)',
    );
  }

  async responder(bruto: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito) {
    const a = lerArgumentos(ConversaResponderArgs, bruto, 'whatsapp.conversa.responder');
    const origem = await this.prisma.whatsAppMensagem.findFirst({
      where: { orgId, mensagemExternaId: a.mensagemId, deMim: false },
      orderBy: { timestamp: 'desc' },
      select: { chatJid: true, timestamp: true, grupo: true },
    });
    if (!origem) {
      throw new Error(
        'a mensagem que pediu não está gravada nesta empresa (ou é do próprio número): responder só vale ' +
          'na conversa de onde o pedido veio. Nada foi enviado.',
      );
    }
    if (!dentroDaJanela(origem.timestamp)) {
      throw new Error(
        `a mensagem que pediu tem mais de ${JANELA_DA_RESPOSTA_MS / 3_600_000} h: responder agora é começar ` +
          'conversa nova, que é whatsapp.mensagem.enviar. Nada foi enviado.',
      );
    }
    if (!this.evolution) throw new Error('o WhatsApp da empresa não está ligado nesta instância. Nada foi enviado.');
    const r = await this.evolution.responderComoPessoa(orgId, origem.chatJid, a.texto);
    return {
      enviado: true,
      id: r.id,
      conversa: origem.chatJid,
      grupo: origem.grupo,
      respondeA: a.mensagemId,
      caracteres: a.texto.length,
      // A Evolution não tem campo para ator: quem pediu sai no resultado, que é o que a porta grava.
      porOrdemDe: ctx.actorId ?? null,
      agente: ctx.agentSlug ?? null,
    };
  }
}
