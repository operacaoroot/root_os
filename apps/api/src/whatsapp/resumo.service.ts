import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ResumoDoWhatsapp } from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';

/*
 * O RESUMO DO WHATSAPP (produção 22C, W4, lane D).
 *
 * O que o cartão "WhatsApp" do Dia a dia e a bolha do menu lateral leem: as não
 * lidas por leads, clientes, sem vínculo e equipe, e quantas conversas ainda
 * esperam um vínculo. Só leitura, só contagem: nada vira tarefa nem pendência.
 *
 * AS QUATRO FAIXAS NÃO SE SOBREPÕEM, e a soma delas é o total:
 *   · equipe       = `equipe = true` (grupo dos sócios, 1:1 com gente da casa),
 *                    mesmo que alguém tenha ligado um lead nela;
 *   · leads        = fora da equipe, com `leadId`;
 *   · clientes     = fora da equipe, com `clienteId` (o banco não deixa uma
 *                    conversa ter lead e cliente: `WhatsAppConversa_vinculo_check`;
 *                    o `leadId: null` aqui só repete a regra);
 *   · sem vínculo  = fora da equipe, sem lead e sem cliente.
 * Layout 26/10: e a quinta, comunidade = `comunidade = true` fora da equipe; as
 * três de cima saem também do que é comunidade.
 * Conversa arquivada não conta em nenhuma: arquivar é "isto não me interessa".
 *
 * LEVE DE PROPÓSITO: quatro agregações no banco, nenhuma linha trazida. A bolha
 * relê a cada 30 s por aba aberta, então o resultado fica 30 s guardado por
 * empresa no processo (e duas abas pedindo ao mesmo tempo dividem a mesma
 * consulta). O número pode estar até 30 s atrasado, e `geradoEm` diz de quando
 * ele é. Quem muda a contagem de propósito (marcar lida, arquivar, vincular)
 * pode chamar `esquecer(orgId)` para a próxima leitura medir de novo.
 */

/** Quanto tempo o resumo de uma empresa vale no processo. */
export const VALIDADE_DO_RESUMO_MS = 30_000;

interface Guardado {
  ate: number;
  valor: Promise<ResumoDoWhatsapp>;
}

@Injectable()
export class ResumoDoWhatsappService {
  private readonly guardados = new Map<string, Guardado>();

  /** O relógio (trocado nos testes). */
  agora: () => number = () => Date.now();

  constructor(private readonly prisma: PrismaService) {}

  /** O resumo da empresa, do cache de 30 s ou medido agora. */
  async doResumo(orgId: string): Promise<ResumoDoWhatsapp> {
    const t = this.agora();
    const g = this.guardados.get(orgId);
    if (g && g.ate > t) return g.valor;
    this.podar(t);
    const valor = this.medir(orgId, t);
    this.guardados.set(orgId, { ate: t + VALIDADE_DO_RESUMO_MS, valor });
    // Medição que falhou não fica guardada: a próxima leitura tenta de novo.
    valor.catch(() => {
      if (this.guardados.get(orgId)?.valor === valor) this.guardados.delete(orgId);
    });
    return valor;
  }

  /** Esquece o resumo guardado da empresa (a próxima leitura mede de novo). */
  esquecer(orgId: string): void {
    this.guardados.delete(orgId);
  }

  private podar(t: number): void {
    for (const [org, g] of this.guardados) if (g.ate <= t) this.guardados.delete(org);
  }

  private async medir(orgId: string, t: number): Promise<ResumoDoWhatsapp> {
    const base: Prisma.WhatsAppConversaWhereInput = { orgId, arquivadaEm: null };
    // Layout 26/10: a comunidade é a quinta faixa, tratada como a equipe: fora de leads,
    // clientes e sem vínculo, e somada no total. Equipe vence (as faixas não se sobrepõem).
    const resto: Prisma.WhatsAppConversaWhereInput = { ...base, equipe: false, comunidade: false };
    const [equipe, comunidade, leads, clientes, semVinculo, conversasNaoLidas] = await Promise.all([
      this.prisma.whatsAppConversa.aggregate({ where: { ...base, equipe: true }, _sum: { naoLidas: true } }),
      this.prisma.whatsAppConversa.aggregate({ where: { ...base, equipe: false, comunidade: true }, _sum: { naoLidas: true } }),
      this.prisma.whatsAppConversa.aggregate({ where: { ...resto, leadId: { not: null } }, _sum: { naoLidas: true } }),
      this.prisma.whatsAppConversa.aggregate({
        where: { ...resto, leadId: null, clienteId: { not: null } },
        _sum: { naoLidas: true },
      }),
      this.prisma.whatsAppConversa.aggregate({
        where: { ...resto, leadId: null, clienteId: null },
        _sum: { naoLidas: true },
        _count: { _all: true },
      }),
      // Layout 27/10 (Lucas): o selo conta conversas com mensagem nova, não mensagens (grupo inflava o número).
      this.prisma.whatsAppConversa.count({ where: { ...base, naoLidas: { gt: 0 }, OR: [{ equipe: true }, { comunidade: false }] } }),
    ]);
    const n = (x: number | null | undefined) => (typeof x === 'number' && x > 0 ? x : 0);
    const naoLidas = {
      leads: n(leads._sum.naoLidas),
      clientes: n(clientes._sum.naoLidas),
      semVinculo: n(semVinculo._sum.naoLidas),
      equipe: n(equipe._sum.naoLidas),
      comunidade: n(comunidade._sum.naoLidas),
      total: 0,
    };
    // Layout 26/10: a comunidade (grupo grande, não é trabalho) fica fora do total do selo "Chat" e do menu.
    naoLidas.total = naoLidas.leads + naoLidas.clientes + naoLidas.semVinculo + naoLidas.equipe;
    return { naoLidas, conversasSemVinculo: n(semVinculo._count._all), conversasNaoLidas: n(conversasNaoLidas), geradoEm: new Date(t).toISOString() };
  }
}
