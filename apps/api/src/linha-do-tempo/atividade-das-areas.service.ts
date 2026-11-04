import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/*
 * A ATIVIDADE DAS ÁREAS (etapa 9, F-26, decisão do Lucas em 04/11/2026). A Atividade mostra também o
 * que aconteceu no Comercial (o fio do lead), no WhatsApp e na implantação; o Registro de ações
 * continua sendo o histórico técnico. Só lê e só projeta:
 *   · Comercial: os fatos do lead (`LeadEvent`), com o nome do lead e o tipo do fato, sem o payload;
 *   · WhatsApp: quantas mensagens cada conversa teve no período, NUNCA o texto (só o nome da conversa);
 *   · Implantação: os marcos do trilho (`OnboardingMarco`), o texto que a própria casa escreveu.
 */
export interface ItemDaArea {
  em: string;
  area: 'comercial' | 'whatsapp' | 'implantacao';
  texto: string;
  link: string | null;
}

const TETO = 150;
const legivel = (tipo: string) => tipo.replace(/[._]/g, ' ');

@Injectable()
export class AtividadeDasAreasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(orgId: string, dias = 7, agora: Date = new Date()): Promise<ItemDaArea[]> {
    const desde = new Date(agora.getTime() - Math.min(Math.max(dias, 1), 30) * 86_400_000);
    const [fatos, conversas, marcos] = await Promise.all([
      this.prisma.leadEvent.findMany({ where: { orgId, occurredAt: { gte: desde } }, orderBy: { occurredAt: 'desc' }, take: TETO, select: { leadId: true, type: true, occurredAt: true } }),
      this.prisma.whatsAppMensagem.groupBy({ by: ['conversaId'], where: { orgId, timestamp: { gte: desde } }, _count: { _all: true }, _max: { timestamp: true } }),
      this.prisma.onboardingMarco.findMany({ where: { orgId, em: { gte: desde } }, orderBy: { em: 'desc' }, take: TETO, select: { trilhoId: true, texto: true, tipo: true, em: true, trilho: { select: { cliente: true } } } }),
    ]);
    const leadIds = [...new Set(fatos.map((f) => f.leadId))];
    const leads = leadIds.length
      ? await this.prisma.lead.findMany({ where: { orgId, id: { in: leadIds } }, select: { id: true, name: true, ficha: { select: { empresa: true } } } })
      : [];
    const nomeDoLead = new Map(leads.map((l) => [l.id, l.ficha?.empresa || l.name]));
    const conversaIds = conversas.map((c) => c.conversaId);
    const nomes = conversaIds.length
      ? await this.prisma.whatsAppConversa.findMany({ where: { orgId, id: { in: conversaIds } }, select: { id: true, nome: true } })
      : [];
    const nomeDaConversa = new Map(nomes.map((c) => [c.id, (c.nome ?? '').trim() || 'conversa sem nome']));

    const itens: ItemDaArea[] = [
      ...fatos.map((f) => ({ em: f.occurredAt.toISOString(), area: 'comercial' as const, texto: `${nomeDoLead.get(f.leadId) ?? 'Lead'}: ${legivel(f.type)}`, link: `/comercial/lead/${f.leadId}` })),
      ...conversas.map((c) => ({
        em: (c._max.timestamp ?? agora).toISOString(), area: 'whatsapp' as const,
        texto: `${nomeDaConversa.get(c.conversaId) ?? 'Conversa'}: ${c._count._all} ${c._count._all === 1 ? 'mensagem' : 'mensagens'} no período`, link: '/whatsapp',
      })),
      ...marcos.map((m) => ({ em: m.em.toISOString(), area: 'implantacao' as const, texto: `${m.trilho?.cliente ?? 'Implantação'}: ${m.texto || legivel(m.tipo)}`, link: null })),
    ];
    return itens.sort((a, b) => b.em.localeCompare(a.em)).slice(0, TETO * 2);
  }
}
