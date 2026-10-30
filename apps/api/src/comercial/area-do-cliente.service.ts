import { Injectable, NotFoundException } from '@nestjs/common';
import type { AreaDoClienteNaBancada } from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { bancadaDaArea } from './area-do-cliente-bancada';
import { modoDaSala } from './area-do-cliente-projecao';
import { SalaService } from './sala.service';
import type { EventoDaSala } from './sala-projecao';

/*
 * A BANCADA DA ÁREA DO CLIENTE (leva A, 30/10/2026): `GET /comercial/lead/:id/area`.
 *
 * Só lê. A área como o cliente a vê vem da MESMA projeção do link
 * (`SalaService.estadoDoLead`, que devolve `modo` e `area`), para a bancada
 * nunca dizer uma coisa e o link outra; por cima dela entram as versões por
 * item (rascunho, na porta, histórico) e as leituras (o "lido em"), que o
 * cliente não vê. A junção é pura (`area-do-cliente-bancada.ts`).
 */

@Injectable()
export class AreaDoClienteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sala: SalaService,
  ) {}

  async bancada(orgId: string, leadId: string, agora: Date = new Date()): Promise<AreaDoClienteNaBancada> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado nesta empresa.');
    const salaRow = await this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId }, select: { id: true } });
    const estado = salaRow ? await this.sala.estadoDoLead(orgId, leadId, agora) : null;
    const [versoes, leituras, modo] = await Promise.all([
      this.prisma.salaVersao.findMany({
        where: { leadId, orgId, item: { not: null } },
        select: { item: true, numero: true, estado: true, approvalId: true, publicadaEm: true, atualizadoEm: true, publicadaPor: true, hash: true },
      }),
      salaRow ? this.prisma.salaLeitura.findMany({ where: { salaId: salaRow.id, orgId }, select: { item: true, versao: true, em: true } }) : Promise.resolve([]),
      estado ? Promise.resolve(estado.modo) : this.modoSemSala(orgId, leadId),
    ]);
    return bancadaDaArea({ leadId, temSala: !!salaRow, modo, area: estado?.area ?? null, versoes, leituras });
  }

  /** Lead sem sala: o modo sai da ficha e do fio, pela mesma regra do link. */
  private async modoSemSala(orgId: string, leadId: string): Promise<'sala' | 'area'> {
    const [ficha, eventos] = await Promise.all([
      this.prisma.comercialFicha.findFirst({ where: { leadId, orgId }, select: { clienteAtivoEm: true, cardId: true } }),
      this.prisma.leadEvent.findMany({ where: { leadId, orgId, type: 'cliente.ativo' }, select: { type: true, payload: true, occurredAt: true }, take: 1 }),
    ]);
    return modoDaSala({ ficha, eventos: eventos as EventoDaSala[] });
  }
}
