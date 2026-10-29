import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, type Prisma } from '@prisma/client';
import {
  COMERCIAL_ROTULO_DA_ETAPA,
  ProcuraDeLeadParecidoSchema,
  VendaNovaDoClienteSchema,
  acharLeadsParecidos,
  paraLeadParecido,
  type CandidatoAParecido,
  type ComercialEtapa,
  type ComercialProduto,
  type LeadsParecidosResposta,
} from '@mktos/shared';

import { LeadsService } from '../leads/leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { FichaGeralService } from './ficha-geral.service';
import { FichaService } from './ficha.service';

/*
 * O LEAD QUE JÁ EXISTE, NO "+ LEAD" (29/10/2026). A regra de comparação e o
 * contrato moram em `packages/shared/src/lead-parecido.ts`; aqui, o banco:
 *
 *   · `parecidos`: lê os leads da empresa (os mais novos, até o teto) e devolve
 *     os que batem com o que foi digitado. Só leitura;
 *   · `vendaNova`: lead novo para quem já é cliente, pela MESMA entrada
 *     idempotente do "+ lead" (`LeadsService.entrada`, origem `manual`,
 *     referência `venda-nova:<lead de origem>:<clique>`), com a empresa do
 *     cliente, ligado ao MESMO cadastro (`ComercialFicha.partnerId`, auditoria
 *     `comercial.ficha.cliente`, o caminho dos scripts de 26/10) e com uma nota
 *     no fio dizendo de onde veio. Não move etapa, não manda mensagem, não cobra.
 */

const TETO = 3000;

export interface QuemPede {
  id: string;
  nome: string | null;
  papeis: readonly string[];
  permissoes: string[];
}

@Injectable()
export class LeadRepetidoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly fichas: FichaService,
    private readonly fichaGeral: FichaGeralService,
  ) {}

  async parecidos(orgId: string, consulta: unknown): Promise<LeadsParecidosResposta> {
    const r = ProcuraDeLeadParecidoSchema.safeParse(consulta ?? {});
    if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Procura inválida.');
    const p = r.data;
    const temAlgo = [p.empresa, p.contato, p.telefone, p.email].some((v) => (v ?? '').trim().length >= 3);
    if (!temAlgo) return { parecidos: [] };
    const linhas = await this.prisma.lead.findMany({
      where: { orgId, NOT: { name: { startsWith: '[QA]' } } },
      orderBy: { createdAt: 'desc' },
      take: TETO,
      select: { id: true, name: true, phone: true, email: true, ficha: { select: { etapa: true, empresa: true, produto: true, partnerId: true } } },
    });
    const candidatos: CandidatoAParecido[] = linhas.map((l) => ({
      leadId: l.id,
      nome: l.name,
      empresa: l.ficha?.empresa ?? null,
      telefone: l.phone,
      email: l.email,
      etapa: (l.ficha?.etapa ?? 'novo_lead') as ComercialEtapa,
      produto: (l.ficha?.produto ?? null) as ComercialProduto | null,
      cadastroId: l.ficha?.partnerId ?? null,
    }));
    return { parecidos: acharLeadsParecidos(p, candidatos).map(({ candidato, motivos }) => paraLeadParecido(candidato, motivos)) };
  }

  async vendaNova(orgId: string, doLeadId: string, corpo: unknown, quem: QuemPede): Promise<{ id: string }> {
    const r = VendaNovaDoClienteSchema.safeParse(corpo);
    if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Pedido inválido.');
    const v = r.data;
    const origem = await this.prisma.lead.findFirst({
      where: { id: doLeadId, orgId },
      select: { name: true, ficha: { select: { etapa: true, empresa: true, partnerId: true } } },
    });
    if (!origem) throw new NotFoundException('Lead não encontrado.');
    const cadastroId = origem.ficha?.partnerId ?? null;
    if (!cadastroId) throw new ConflictException('Este lead ainda não é cliente (não tem cadastro): abra o card dele em vez de criar outro.');
    const cadastro = await this.prisma.partner.findFirst({ where: { id: cadastroId, orgId }, select: { razaoSocial: true, nomeFantasia: true } });
    if (!cadastro) throw new ConflictException('O cadastro deste cliente não foi encontrado.');
    const empresa = (origem.ficha?.empresa || cadastro.nomeFantasia || cadastro.razaoSocial).trim();
    const nome = v.contato?.trim() || empresa;

    const e = await this.leads.entrada(
      { sub: quem.id, orgId, permissions: quem.permissoes },
      {
        origem: { tipo: 'manual', ref: `venda-nova:${doLeadId}:${v.ref}` },
        nome,
        ...(v.telefone ? { telefone: v.telefone } : {}),
        ...(v.email ? { email: v.email } : {}),
      },
    );
    const por = { id: quem.id, nome: quem.nome };
    if (nome !== empresa) await this.fichas.editarIdentidade(orgId, e.id, { empresa }, por);
    const ficha = await this.fichas.garantir(orgId, e.id);
    if (ficha.partnerId !== cadastroId) {
      await this.prisma.$transaction(async (tx) => {
        await tx.comercialFicha.update({ where: { id: ficha.id }, data: { partnerId: cadastroId } });
        await tx.auditLog.create({
          data: {
            orgId, actorType: ActorType.user, actorId: quem.id, action: 'comercial.ficha.cliente', entityType: 'lead', entityId: e.id,
            before: { partnerId: ficha.partnerId ?? null } as Prisma.InputJsonValue,
            after: { partnerId: cadastroId, vendaNovaDe: doLeadId } as Prisma.InputJsonValue,
          },
        });
      });
    }
    if (e.criado) {
      const etapa = origem.ficha?.etapa ? COMERCIAL_ROTULO_DA_ETAPA[origem.ficha.etapa as ComercialEtapa] : null;
      await this.fichaGeral.nota(orgId, e.id, {
        texto: `Venda nova de quem já é cliente (${empresa}). O card anterior é "${origem.name}"${etapa ? `, em ${etapa}` : ''}.`,
      }, quem);
    }
    return { id: e.id };
  }
}
