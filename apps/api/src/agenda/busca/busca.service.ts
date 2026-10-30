import { BadRequestException, Injectable } from '@nestjs/common';
import {
  rotuloCurtoDaEtapa,
  sociosDoResponsavel,
  type ClienteDaBuscaDaAgenda,
  type ComercialEtapa,
  type SocioDaAgenda,
} from '@mktos/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { BUSCA_MINIMO, chaveDoNome, ordenarBusca, type CandidatoDaBusca } from './busca';

/** Quantas linhas de cada cadastro a busca lê, no máximo (as mais recentes). */
const TETO_DE_LEITURA = 3000;

interface Candidato extends CandidatoDaBusca {
  etapa: string | null;
  contato: ClienteDaBuscaDaAgenda['contato'];
}

/*
 * A BUSCA DO CLIENTE NO PAINEL DE MARCAR (agenda v2, 29/10/2026, lane G3).
 *
 * `GET /agenda/clientes?q=` procura em `Lead` (com a etapa da `ComercialFicha` e
 * o contato) e em `Partner` cliente, por nome ou empresa, sem diferença de acento
 * e de caixa, SEMPRE com `orgId` na consulta (a busca nunca atravessa empresa).
 * Depois conta, no espelho (`AgendaEvento.leituraCliente`), quantas vezes cada
 * nome achado já esteve na agenda, a última data e com quem.
 *
 * Por que a comparação é feita aqui e não no banco: o Postgres da casa não tem a
 * extensão `unaccent`, e `contains insensitive` não acha "João" por "joao". A
 * leitura tem teto (`TETO_DE_LEITURA` por cadastro, os mais recentes), o que para
 * o tamanho do Funil da casa é tudo.
 */
@Injectable()
export class BuscaDaAgendaService {
  constructor(private readonly prisma: PrismaService) {}

  async buscar(orgId: string, q: string | undefined, agora: Date = new Date()): Promise<ClienteDaBuscaDaAgenda[]> {
    const busca = String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (busca.replace(/[^\p{L}\p{N}]/gu, '').length < BUSCA_MINIMO) {
      throw new BadRequestException(`Escreva ao menos ${BUSCA_MINIMO} letras para buscar o cliente.`);
    }

    const [leads, clientes] = await Promise.all([
      this.prisma.lead.findMany({
        where: { orgId },
        orderBy: { updatedAt: 'desc' },
        take: TETO_DE_LEITURA,
        select: { id: true, orgId: true, name: true, email: true, ficha: { select: { empresa: true, etapa: true } } },
      }),
      this.prisma.partner.findMany({
        where: { orgId, isCliente: true, ativo: true, interno: false, principalId: null },
        orderBy: { updatedAt: 'desc' },
        take: TETO_DE_LEITURA,
        select: { id: true, orgId: true, razaoSocial: true, nomeFantasia: true, email: true },
      }),
    ]);

    const candidatos: Candidato[] = [
      ...leads
        .filter((l) => l.orgId === orgId)
        .map((l): Candidato => {
          const empresa = l.ficha?.empresa?.trim() || null;
          return {
            id: l.id,
            tipo: 'lead',
            nome: empresa ?? l.name,
            outros: empresa ? [l.name] : [],
            etapa: l.ficha?.etapa ? rotuloCurtoDaEtapa(l.ficha.etapa as ComercialEtapa) : null,
            contato: (empresa && l.name) || l.email ? { nome: empresa ? l.name : null, email: l.email ?? null } : null,
          };
        }),
      ...clientes
        .filter((p) => p.orgId === orgId)
        .map((p): Candidato => ({
          id: p.id,
          tipo: 'cliente',
          nome: p.nomeFantasia?.trim() || p.razaoSocial,
          outros: p.nomeFantasia?.trim() ? [p.razaoSocial] : [],
          etapa: null,
          contato: p.email ? { nome: null, email: p.email } : null,
        })),
    ];

    const achados = ordenarBusca(busca, candidatos);
    if (!achados.length) return [];
    const naAgenda = await this.naAgenda(orgId, achados.map((a) => a.nome), agora);
    return achados.map((a) => ({
      id: a.id,
      tipo: a.tipo,
      nome: a.nome,
      etapa: a.etapa,
      contato: a.contato,
      naAgenda: naAgenda.get(chaveDoNome(a.nome)) ?? { vezes: 0, ultima: null, com: [] },
    }));
  }

  /** Quantas vezes cada nome já esteve na agenda (compromisso que já começou, não cancelado), a última e com quem. */
  private async naAgenda(orgId: string, nomes: string[], agora: Date): Promise<Map<string, ClienteDaBuscaDaAgenda['naAgenda']>> {
    const chaves = new Set(nomes.map(chaveDoNome).filter(Boolean));
    const saida = new Map<string, ClienteDaBuscaDaAgenda['naAgenda']>();
    if (!chaves.size) return saida;
    // O espelho guarda o nome como o título o escreveu; a comparação é pela chave sem acento.
    const grupos = await this.prisma.agendaEvento.groupBy({
      by: ['leituraCliente'],
      where: { orgId, leituraCliente: { not: null }, status: { not: 'cancelado' }, inicio: { lte: agora } },
      _count: { _all: true },
      _max: { inicio: true },
    });
    const escritos = new Map<string, string[]>();
    for (const g of grupos) {
      const chave = chaveDoNome(g.leituraCliente);
      if (!chaves.has(chave) || !g.leituraCliente) continue;
      const atual = saida.get(chave) ?? { vezes: 0, ultima: null, com: [] };
      const max = g._max.inicio?.toISOString() ?? null;
      saida.set(chave, { vezes: atual.vezes + g._count._all, ultima: max && (!atual.ultima || max > atual.ultima) ? max : atual.ultima, com: [] });
      escritos.set(chave, [...(escritos.get(chave) ?? []), g.leituraCliente]);
    }
    for (const [chave, info] of saida) {
      if (!info.ultima) continue;
      const ultimo = await this.prisma.agendaEvento.findFirst({
        where: { orgId, leituraCliente: { in: escritos.get(chave) ?? [] }, inicio: new Date(info.ultima), status: { not: 'cancelado' } },
        select: { leituraResponsaveis: true },
      });
      const com = new Set<SocioDaAgenda>();
      for (const r of ultimo?.leituraResponsaveis ?? []) for (const s of sociosDoResponsavel(r)) com.add(s);
      info.com = [...com];
    }
    return saida;
  }
}
