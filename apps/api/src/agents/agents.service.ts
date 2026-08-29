import { Injectable } from '@nestjs/common';
import { AgentEstado, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async roster(orgId: string) {
    const agentes = await this.prisma.agent.findMany({
      where: { orgId },
      orderBy: [{ estado: 'asc' }, { nome: 'asc' }],
      include: { dono: { select: { id: true, name: true } }, sop: { select: { proposito: true } } },
    });

    return {
      items: agentes.map((a) => ({
        slug: a.slug,
        nome: a.nome,
        iniciais: a.iniciais,
        missao: a.missao,
        pilar: a.pilar,
        dono: a.dono ? { id: a.dono.id, nome: a.dono.name } : null,
        tipo: a.tipo,
        estado: a.estado,
        autonomiaAte: a.autonomiaAte,
        rebaixadoAte: a.rebaixadoAte?.toISOString() ?? null,
        capacidades: a.capacidades,
        cron: a.cron,
        ultimaExecucaoEm: a.ultimaExecucaoEm?.toISOString() ?? null,
        ultimoStatus: a.ultimoStatus,
        execucoes: a.execucoes,
        falhas: a.falhas,
        // "—" na tela até alguém declarar a linha de base. Nunca um número
        // inventado: a fórmula fica visível e a procedência também.
        horasDevolvidas:
          a.minutosPorExecucao > 0
            ? Number(((a.minutosPorExecucao * a.execucoes) / 60).toFixed(1))
            : null,
        linhaDeBase:
          a.minutosPorExecucao > 0
            ? {
                minutosPorExecucao: a.minutosPorExecucao,
                informadaEm: a.baselineEm?.toISOString() ?? null,
                informadaPor: a.baselinePorId,
              }
            : null,
        temProcedimento: !!a.sop,
      })),
      kpis: {
        rodando: agentes.filter((a) => a.estado === AgentEstado.rodando).length,
        // A soma só existe se ALGUÉM declarou base. Somar zeros e mostrar
        // "0 h devolvidas" é diferente de "ninguém mediu ainda".
        horasSemana: agentes.some((a) => a.minutosPorExecucao > 0)
          ? Number(
              agentes
                .reduce((t, a) => t + (a.minutosPorExecucao * a.execucoes) / 60, 0)
                .toFixed(1),
            )
          : null,
        semLinhaDeBase: agentes.filter((a) => a.minutosPorExecucao === 0).length,
      },
    };
  }

  async detalhe(orgId: string, slug: string) {
    return this.prisma.agent.findFirst({
      where: { orgId, slug },
      include: { sop: true, dono: { select: { id: true, name: true } } },
    });
  }

  /** A linha de base é DECLARADA por uma pessoa, com nome e data. */
  async declararLinhaDeBase(orgId: string, slug: string, minutos: number, userId: string) {
    if (minutos <= 0) throw new Error('a linha de base precisa ser maior que zero');
    const a = await this.prisma.agent.updateMany({
      where: { orgId, slug },
      data: { minutosPorExecucao: minutos, baselinePorId: userId, baselineEm: new Date() },
    });
    if (a.count === 0) throw new Error(`agente "${slug}" não existe`);
    return { ok: true as const };
  }

  async atualizar(orgId: string, slug: string, dados: Prisma.AgentUpdateInput) {
    const r = await this.prisma.agent.updateMany({ where: { orgId, slug }, data: dados });
    if (r.count === 0) throw new Error(`agente "${slug}" não existe`);
    return { ok: true as const };
  }
}
