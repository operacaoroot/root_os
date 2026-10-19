import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AtendimentoDirecao, AtendimentoStatusEnvio, Prisma, SessionCanal } from '@prisma/client';
import {
  type AvisoDeEnvio,
  type MensagemRecebida,
  TETO_DO_ANEXO_BYTES,
  lerEventoDaEvolution,
  statusSobe,
  tipoDeAnexoAceito,
} from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OuvintesDoWebhookRegistry } from '../gateway/canais/ouvintes-do-webhook.registry';
import { EntradaDeGrupoRegistry } from '../gateway/canais/entrada-de-grupo.registry';
import { WhatsappDoAtendimentoRegistry } from '../gateway/canais/whatsapp-do-atendimento.registry';
import { chaveDeIdentidadeWhatsapp, formasDaChave } from '../gateway/canais/identidade-de-canal';
import { PREFIXO_DO_CODIGO, pareceTentativaDeDecisao } from '../gateway/canais/resposta-de-canal';

/** Onde o anexo de uma mensagem mora no MinIO. Por empresa, nunca público. */
export function chaveDoAnexo(orgId: string, mensagemId: string): string {
  return `atendimento/${orgId}/${mensagemId}`;
}

/** Quanto tempo o eco do próprio envio leva para voltar, no máximo. */
const JANELA_DO_ECO_MS = 5 * 60_000;

export function ehErroDeChaveRepetida(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/*
 * ============================================================================
 * A ENTRADA DA CAIXA DE ATENDIMENTO — ouve o webhook único, guarda o que é dela
 * ============================================================================
 *
 * Adaptado de `supabase/functions/evolution-webhook` do FinOps. Recebe o corpo
 * do webhook pelo `OuvintesDoWebhookRegistry`, DEPOIS de o canal de aprovação e
 * o grupo de links terem feito o que sempre fizeram.
 *
 * O QUE NÃO ENTRA NA CAIXA, para cada consumidor continuar dono do seu:
 *   · conversa direta com quem está cadastrado em `ChannelIdentity` (é quem
 *     assina pelo WhatsApp: os pedidos de assinatura e as respostas a eles);
 *   · resposta no formato `APROVAR|RECUSAR ROOT-…`, venha de quem vier;
 *   · grupo inscrito por outro módulo (o grupo de links da pauta);
 *   · status, transmissão e newsletter (`lerEventoDaEvolution`).
 *
 * DESLIGADA POR PADRÃO: sem `AtendimentoAjuste.ativo` a empresa não guarda nada.
 *
 * EVENTO REPETIDO NÃO DUPLICA: `(orgId, evolutionId)` é único no banco, e o
 * repetido vira rótulo de log. A Evolution reentrega webhook, e o mesmo
 * `messages.upsert` pode chegar duas vezes.
 *
 * O QUE ESTE SERVIÇO NUNCA FAZ: responder, mandar mensagem, chamar IA. A
 * resposta automática do FinOps ficou de fora de propósito.
 */
@Injectable()
export class EntradaDoAtendimentoService implements OnModuleInit {
  private readonly log = new Logger('EntradaDoAtendimento');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ouvintes: OuvintesDoWebhookRegistry,
    private readonly grupos: EntradaDeGrupoRegistry,
    private readonly whatsapp: WhatsappDoAtendimentoRegistry,
  ) {}

  onModuleInit(): void {
    this.ouvintes.registrar('atendimento', (orgId, corpo) => this.ouvir(orgId, corpo));
  }

  /** O corpo inteiro do webhook, já dentro do contexto da empresa. */
  async ouvir(orgId: string, corpo: unknown): Promise<string> {
    const eventos = lerEventoDaEvolution(corpo);
    if (eventos.length === 0) return 'nada';
    const ajuste = await this.prisma.atendimentoAjuste.findUnique({ where: { orgId } });
    if (!ajuste?.ativo) return 'caixa_desligada';
    const rotulos: string[] = [];
    for (const ev of eventos) {
      if (ev.tipo === 'mensagem') rotulos.push(await this.mensagem(orgId, ev));
      else if (ev.tipo === 'aviso') rotulos.push(await this.aviso(orgId, ev));
      else rotulos.push(await this.apagada(orgId, ev.evolutionId));
    }
    return rotulos.join(',');
  }

  /** É de outro consumidor do mesmo webhook? Devolve o motivo, ou `null`. */
  private async deOutroConsumidor(orgId: string, m: MensagemRecebida): Promise<string | null> {
    if (m.grupo) return this.grupos.inscrito(m.jidConversa) ? 'grupo_inscrito' : null;
    if (m.texto && pareceTentativaDeDecisao(m.texto) && m.texto.toUpperCase().includes(PREFIXO_DO_CODIGO)) {
      return 'resposta_de_aprovacao';
    }
    const chave = chaveDeIdentidadeWhatsapp(m.jidConversa) ?? m.telefone;
    if (!chave) return null;
    const quem = await this.prisma.channelIdentity.findFirst({
      where: { orgId, canal: SessionCanal.whatsapp, ativo: true, externalId: { in: formasDaChave(chave) } },
      select: { id: true },
    });
    return quem ? 'canal_de_aprovacao' : null;
  }

  private async mensagem(orgId: string, m: MensagemRecebida): Promise<string> {
    const outro = await this.deOutroConsumidor(orgId, m);
    if (outro) return outro;

    const ja = await this.prisma.atendimentoMensagem.findUnique({
      where: { orgId_evolutionId: { orgId, evolutionId: m.evolutionId } },
      select: { id: true },
    });
    if (ja) return 'repetida';

    const contato = await this.prisma.atendimentoContato.upsert({
      where: { orgId_jid: { orgId, jid: m.jidConversa } },
      create: {
        orgId,
        jid: m.jidConversa,
        grupo: m.grupo,
        telefone: m.telefone,
        nome: m.grupo ? null : m.remetenteNome,
        ultimaMensagemEm: m.momento,
      },
      update: {},
    });

    if (m.fromMe) {
      const eco = await this.ecoDoEnvio(orgId, contato.id, m);
      if (eco) return eco;
    }

    const tipoAceito = m.midia ? tipoDeAnexoAceito(m.midia.mimetype) : null;
    const grande = m.midia?.tamanho != null && m.midia.tamanho > TETO_DO_ANEXO_BYTES;
    let criada: { id: string };
    try {
      criada = await this.prisma.atendimentoMensagem.create({
        data: {
          orgId,
          contatoId: contato.id,
          direcao: m.fromMe ? AtendimentoDirecao.saida : AtendimentoDirecao.entrada,
          evolutionId: m.evolutionId,
          tipo: m.tipoMensagem,
          texto: m.texto,
          remetenteJid: m.remetenteJid,
          remetenteNome: m.fromMe ? 'pelo celular' : m.remetenteNome,
          // Mandada direto do celular, fora do OS: a Evolution já aceitou.
          statusEnvio: m.fromMe ? AtendimentoStatusEnvio.aceita : null,
          aceitaEm: m.fromMe ? m.momento : null,
          anexoTipo: m.midia ? (tipoAceito ?? m.midia.mimetype) : null,
          anexoNome: m.midia?.nome ?? null,
          anexoTamanho: m.midia?.tamanho ?? null,
          anexoSituacao: m.midia ? (!tipoAceito || grande ? 'recusado' : 'pendente') : null,
          momento: m.momento,
        },
        select: { id: true },
      });
    } catch (e) {
      if (ehErroDeChaveRepetida(e)) return 'repetida';
      throw e;
    }

    await this.atualizarConversa(orgId, contato, m);
    if (m.midia && tipoAceito && !grande) await this.guardarAnexo(orgId, criada.id, m, tipoAceito);
    return m.fromMe ? 'saida_pelo_celular' : 'guardada';
  }

  /**
   * O eco da resposta que o próprio OS mandou. Quando ele chega antes de o
   * efeito gravar o id da Evolution, casa com a resposta "enviando" de mesmo
   * texto na mesma conversa e só completa o id — senão a resposta apareceria
   * duas vezes (a do OS e a "pelo celular").
   */
  private async ecoDoEnvio(orgId: string, contatoId: string, m: MensagemRecebida): Promise<string | null> {
    if (!m.texto) return null;
    const minha = await this.prisma.atendimentoMensagem.findFirst({
      where: {
        orgId,
        contatoId,
        direcao: AtendimentoDirecao.saida,
        evolutionId: null,
        texto: m.texto,
        statusEnvio: { in: [AtendimentoStatusEnvio.enviando, AtendimentoStatusEnvio.erro] },
        atualizadoEm: { gte: new Date(Date.now() - JANELA_DO_ECO_MS) },
      },
      orderBy: { atualizadoEm: 'desc' },
      select: { id: true },
    });
    if (!minha) return null;
    try {
      await this.prisma.atendimentoMensagem.update({
        where: { id: minha.id },
        data: { evolutionId: m.evolutionId, statusEnvio: AtendimentoStatusEnvio.aceita, aceitaEm: m.momento, erroEnvio: null },
      });
    } catch (e) {
      if (ehErroDeChaveRepetida(e)) return 'repetida';
      throw e;
    }
    return 'eco_do_envio';
  }

  private async atualizarConversa(
    orgId: string,
    contato: { id: string; nome: string | null; ultimaMensagemEm: Date | null; encerradaEm: Date | null },
    m: MensagemRecebida,
  ): Promise<void> {
    const data: Prisma.AtendimentoContatoUpdateManyMutationInput = {};
    if (!contato.ultimaMensagemEm || m.momento > contato.ultimaMensagemEm) data.ultimaMensagemEm = m.momento;
    if (!m.grupo && !m.fromMe && !contato.nome && m.remetenteNome) data.nome = m.remetenteNome;
    // A próxima mensagem do cliente reabre a conversa encerrada (FinOps:
    // `trg_reabrir_conversa_chat_entrada`). Mensagem nossa não reabre.
    if (!m.fromMe && contato.encerradaEm) {
      data.encerradaEm = null;
      data.encerradaPor = null;
      data.versao = { increment: 1 };
    }
    if (Object.keys(data).length === 0) return;
    await this.prisma.atendimentoContato.updateMany({ where: { id: contato.id, orgId }, data });
  }

  /**
   * Baixa o arquivo e guarda no MinIO. Falhar aqui não perde a mensagem: ela já
   * está gravada, e o anexo fica marcado "falhou" para a tela dizer isso.
   */
  private async guardarAnexo(orgId: string, mensagemId: string, m: MensagemRecebida, tipo: string): Promise<void> {
    try {
      let base64 = m.midia?.base64 ?? null;
      let mimetype = tipo;
      if (!base64) {
        const baixado = await this.whatsapp.baixarMidia({ id: m.evolutionId, remoteJid: m.jidConversa, fromMe: m.fromMe });
        if (!baixado) throw new Error('a Evolution não devolveu o arquivo');
        base64 = baixado.base64;
        mimetype = tipoDeAnexoAceito(baixado.mimetype) ?? tipo;
      }
      const arquivo = Buffer.from(base64.replace(/^data:[^,]+,/, ''), 'base64');
      if (arquivo.length === 0) throw new Error('arquivo vazio');
      if (arquivo.length > TETO_DO_ANEXO_BYTES) {
        await this.marcarAnexo(orgId, mensagemId, { anexoSituacao: 'recusado', anexoTamanho: arquivo.length });
        return;
      }
      await this.storage.put(chaveDoAnexo(orgId, mensagemId), arquivo, mimetype);
      await this.marcarAnexo(orgId, mensagemId, {
        anexoSituacao: 'guardado',
        anexoChave: chaveDoAnexo(orgId, mensagemId),
        anexoTipo: mimetype,
        anexoTamanho: arquivo.length,
      });
    } catch (e) {
      this.log.warn(`anexo da mensagem ${mensagemId} não foi guardado: ${(e as Error).message}`);
      await this.marcarAnexo(orgId, mensagemId, { anexoSituacao: 'falhou' });
    }
  }

  private async marcarAnexo(orgId: string, id: string, data: Prisma.AtendimentoMensagemUpdateManyMutationInput) {
    await this.prisma.atendimentoMensagem.updateMany({ where: { id, orgId }, data });
  }

  /** `messages.update`: aceita → entregue → lida, sem nunca descer. */
  private async aviso(orgId: string, a: AvisoDeEnvio): Promise<string> {
    const m = await this.prisma.atendimentoMensagem.findUnique({
      where: { orgId_evolutionId: { orgId, evolutionId: a.evolutionId } },
      select: { id: true, direcao: true, statusEnvio: true },
    });
    if (!m || m.direcao !== AtendimentoDirecao.saida) return 'aviso_sem_mensagem';
    if (!statusSobe(m.statusEnvio, a.status)) return 'aviso_antigo';
    const agora = new Date();
    const r = await this.prisma.atendimentoMensagem.updateMany({
      // Condicional: dois avisos ao mesmo tempo não se atropelam.
      where: { id: m.id, orgId, statusEnvio: m.statusEnvio },
      data: {
        statusEnvio: a.status as AtendimentoStatusEnvio,
        erroEnvio: null,
        ...(a.status === 'aceita' ? { aceitaEm: agora } : {}),
        ...(a.status === 'entregue' ? { entregueEm: agora } : {}),
        ...(a.status === 'lida' ? { lidaPeloClienteEm: agora } : {}),
      },
    });
    return r.count === 1 ? `aviso_${a.status}` : 'aviso_concorrente';
  }

  /** `messages.delete`: some da conversa, mas a linha fica (como no FinOps). */
  private async apagada(orgId: string, evolutionId: string): Promise<string> {
    const r = await this.prisma.atendimentoMensagem.updateMany({
      where: { orgId, evolutionId, apagadaEm: null },
      data: { apagadaEm: new Date() },
    });
    return r.count ? 'apagada' : 'apagada_sem_mensagem';
  }
}
