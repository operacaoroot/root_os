import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SalaFormSchema } from '@mktos/shared';

import { ADMINISTRACAO_DO_DIGISAC, type AdministracaoDoDigisac } from '../gateway/canais/digisac.port';
import { PrismaService } from '../prisma/prisma.service';
import { escolhaNumerada, lerWebhookDoDigisac, respostaDoFormulario } from './canais/digisac.provider';
import type { Interativo } from './canais/whatsapp.port';
import { normalizarTelefone } from './eventos';
import { SalaService } from './sala.service';
import { WhatsappComercialService } from './whatsapp.service';

/*
 * A ENTRADA DO DIGISAC (Interface 20/10, lane U6).
 *
 * O webhook do DigiSac (`message.created`) chega em
 * `POST /api/comercial/webhooks/digisac/:orgId`. A rota confere o segredo da
 * empresa ANTES de qualquer outra coisa (`webhook-do-digisac.controller.ts`);
 * daqui para baixo o corpo já é de quem sabe o segredo.
 *
 * O caminho de uma mensagem:
 *   1. o conector desligado nesta empresa recusa (a recusa fica no RASTRO);
 *   2. `lerWebhookDoDigisac` deixa passar só o texto que o CONTATO mandou
 *      (mensagem da própria conta, de robô, comentário e grupo ficam de fora);
 *   3. mensagem de outra conexão da mesma conta é ignorada;
 *   4. o número vem do corpo ou, sem ele, do contato no DigiSac;
 *   5. telefone novo cria o lead (`receberEntrada`); conhecido grava a mensagem
 *      (`receberDoLead`) e, se a última mensagem enviada ao lead tinha botões
 *      ou formulário, a resposta numerada vira a escolha (o horário da agenda)
 *      ou o formulário respondido, pelos MESMOS caminhos do simulador.
 *
 * O desfecho volta para o log, nunca para quem chamou: a resposta da rota é
 * sempre a mesma. Nem o número nem o texto vão para o log.
 */

const ISO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

@Injectable()
export class DigisacEntradaService {
  private readonly log = new Logger('ComercialDigisac.entrada');

  constructor(
    private readonly prisma: PrismaService,
    private readonly whats: WhatsappComercialService,
    private readonly sala: SalaService,
    @Optional() @Inject(ADMINISTRACAO_DO_DIGISAC) private readonly digisac?: AdministracaoDoDigisac,
  ) {}

  /** O segredo confere? Sem o conector carregado ou sem segredo configurado, nunca. */
  async autentico(orgId: string, apresentado: string | null | undefined): Promise<boolean> {
    if (!this.digisac) return false;
    return this.digisac.webhookAutentico(orgId, apresentado);
  }

  /** Processa um corpo já autenticado. Devolve o desfecho para o log e para a suíte. */
  async processar(orgId: string, corpo: unknown): Promise<{ desfecho: string; leadId?: string }> {
    if (!this.digisac) return { desfecho: 'conector ausente' };
    if (!(await this.digisac.ligado(orgId))) return { desfecho: 'conector desligado' };

    const leitura = lerWebhookDoDigisac(corpo);
    if ('ignorado' in leitura) return { desfecho: `ignorado: ${leitura.ignorado}` };
    const m = leitura.mensagem;

    const servico = await this.digisac.servicoDaEmpresa(orgId);
    if (servico && m.servicoId && m.servicoId !== servico) return { desfecho: 'ignorado: outra conexão da conta' };

    let numero = m.numero;
    if (!numero) {
      const contato = await this.digisac.buscarContato(orgId, m.contatoId);
      if (!contato) return { desfecho: 'ignorado: contato desconhecido no DigiSac' };
      if (contato.grupo) return { desfecho: 'ignorado: mensagem de grupo' };
      numero = contato.numero;
    }
    const telefone = normalizarTelefone(numero ?? '');
    if (!/^\d{10,15}$/.test(telefone)) return { desfecho: 'ignorado: contato sem número de WhatsApp' };

    const lead = await this.prisma.lead.findFirst({ where: { orgId, phone: telefone }, select: { id: true }, orderBy: { enteredAt: 'asc' } });
    if (!lead) {
      const r = await this.whats.receberEntrada(orgId, { telefone, texto: m.texto, mensagemId: m.mensagemId.slice(0, 120) });
      return { desfecho: r.leadNovo ? 'lead novo' : 'mensagem de lead', leadId: r.leadId };
    }

    // A interativa a que esta mensagem pode responder: a última enviada ao lead.
    const ultima = await this.prisma.comercialMensagem.findFirst({
      where: { orgId, leadId: lead.id, direcao: 'saida', destino: 'lead', estado: 'enviada' },
      orderBy: { enviadaEm: 'desc' },
      select: { interativo: true },
    });
    await this.whats.receberDoLead(orgId, lead.id, m.texto, m.mensagemId.slice(0, 120));

    const inter = (ultima?.interativo ?? null) as Interativo | null;
    if (inter?.botoes?.length) {
      const chave = escolhaNumerada(m.texto, inter.botoes);
      if (chave && ISO_COM_FUSO.test(chave)) {
        await this.sala.escolherHorario(orgId, lead.id, chave);
        return { desfecho: 'botão escolhido', leadId: lead.id };
      }
    }
    if (inter?.formulario) {
      const campos = respostaDoFormulario(m.texto, inter.formulario);
      const form = campos ? SalaFormSchema.safeParse(campos) : null;
      if (form?.success) {
        await this.sala.responderFormulario(orgId, lead.id, form.data);
        return { desfecho: 'formulário respondido', leadId: lead.id };
      }
    }
    return { desfecho: 'mensagem de lead', leadId: lead.id };
  }

  /** Para o log: o desfecho sem número nem texto. */
  registrar(orgId: string, desfecho: string): void {
    this.log.debug(`webhook do DigiSac (${orgId}): ${desfecho}`);
  }
}
