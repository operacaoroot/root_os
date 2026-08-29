import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SessionCanal,
  SessionStatus,
  SessionStepTipo,
  RiskLevel,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PassoInput {
  tipo: SessionStepTipo;
  capacidade?: string | null;
  argsResumo?: string | null;
  args?: Prisma.InputJsonValue;
  resultadoResumo?: string | null;
  toolCallId?: string | null;
  nivel?: RiskLevel | null;
  decisao?: string | null;
  motivo?: string | null;
  gatilhos?: string[];
  approvalId?: string | null;
  provider?: string | null;
  modelo?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  tokensCacheRead?: number | null;
  tokensCacheWrite?: number | null;
  custoUsd?: number | null;
  custoEstimado?: boolean;
  stopReason?: string | null;
  fontes?: Prisma.InputJsonValue;
  payload?: Prisma.InputJsonValue;
  texto?: string | null;
  erro?: string | null;
  duracaoMs?: number;
}

/** Persistência da sessão e do traço. O runtime não fala com o Prisma direto. */
@Injectable()
export class SessionService {
  private static readonly TTL_MIN = Number(process.env.SESSION_TTL_MIN ?? 120);

  constructor(private readonly prisma: PrismaService) {}

  async abrir(input: {
    orgId: string;
    agentId: string;
    canal: SessionCanal;
    canalRef?: string | null;
    solicitanteId?: string | null;
    solicitanteRotulo: string;
    pedido: string;
  }) {
    return this.prisma.session.create({
      data: {
        orgId: input.orgId,
        agentId: input.agentId,
        canal: input.canal,
        canalRef: input.canalRef ?? null,
        solicitanteId: input.solicitanteId ?? null,
        solicitanteRotulo: input.solicitanteRotulo,
        pedido: input.pedido,
      },
      select: { id: true, criadaEm: true },
    });
  }

  /**
   * A sessão viva daquele canal e daquele contato. É isto que resolve "o bot
   * não tem memória entre turnos": o problema nunca foi o modelo, foi não
   * existir onde guardar.
   */
  async retomar(orgId: string, canal: SessionCanal, canalRef: string) {
    const limite = new Date(Date.now() - SessionService.TTL_MIN * 60_000);
    return this.prisma.session.findFirst({
      where: { orgId, canal, canalRef, ultimaAtividadeEm: { gt: limite } },
      orderBy: { ultimaAtividadeEm: 'desc' },
      select: { id: true },
    });
  }

  async passo(orgId: string, sessionId: string, p: PassoInput): Promise<void> {
    // A ordem sai do banco, não de um contador em memória: dois passos
    // concorrentes na mesma sessão não podem colidir na chave única.
    const ultimo = await this.prisma.sessionStep.findFirst({
      where: { sessionId },
      orderBy: { ordem: 'desc' },
      select: { ordem: true },
    });
    await this.prisma.sessionStep.create({
      data: {
        orgId,
        sessionId,
        ordem: (ultimo?.ordem ?? 0) + 1,
        tipo: p.tipo,
        capacidade: p.capacidade ?? null,
        argsResumo: p.argsResumo ?? null,
        args: p.args,
        resultadoResumo: p.resultadoResumo ?? null,
        toolCallId: p.toolCallId ?? null,
        nivel: p.nivel ?? null,
        decisao: p.decisao ?? null,
        motivo: p.motivo ?? null,
        gatilhos: p.gatilhos ?? [],
        approvalId: p.approvalId ?? null,
        provider: p.provider ?? null,
        modelo: p.modelo ?? null,
        tokensIn: p.tokensIn ?? null,
        tokensOut: p.tokensOut ?? null,
        tokensCacheRead: p.tokensCacheRead ?? null,
        tokensCacheWrite: p.tokensCacheWrite ?? null,
        custoUsd: p.custoUsd ?? null,
        custoEstimado: p.custoEstimado ?? true,
        stopReason: p.stopReason ?? null,
        fontes: p.fontes ?? [],
        payload: p.payload,
        texto: p.texto ?? null,
        erro: p.erro ?? null,
        duracaoMs: p.duracaoMs ?? 0,
      },
    });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { ultimaAtividadeEm: new Date() },
    });
  }

  async encerrar(
    sessionId: string,
    dados: {
      status: SessionStatus;
      resposta?: string;
      nivelMax?: RiskLevel | null;
      motivo?: string | null;
      fontes?: Prisma.InputJsonValue;
      semProcedencia?: boolean;
      custoUsd?: number;
      custoEstimado?: boolean;
      provider?: string | null;
      modelo?: string | null;
      tokensIn?: number;
      tokensOut?: number;
      passos?: number;
      duracaoMs?: number;
    },
  ): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { ...dados, encerradaEm: new Date() },
    });
  }

  /** O traço, para a tela. Os 6 blocos são reconstruídos dos passos. */
  async traco(orgId: string, sessionId: string) {
    const s = await this.prisma.session.findFirst({
      where: { id: sessionId, orgId },
      include: {
        agent: { select: { slug: true, nome: true, iniciais: true } },
        steps: { orderBy: { ordem: 'asc' } },
      },
    });
    if (!s) return null;

    const ferramentas = s.steps.filter((p) => p.tipo === 'ferramenta');
    const contexto = s.steps.find((p) => p.tipo === 'contexto');

    return {
      id: s.id,
      agente: s.agent,
      canal: s.canal,
      solicitante: s.solicitanteRotulo,
      status: s.status,
      custoUsd: Number(s.custoUsd),
      custoEstimado: s.custoEstimado,
      duracaoMs: s.duracaoMs,
      criadaEm: s.criadaEm.toISOString(),
      blocos: {
        // 01 o pedido
        pedido: s.pedido,
        // 02 o contexto que entrou junto
        contexto: {
          fontes: contexto?.fontes ?? [],
          texto: contexto?.texto ?? null,
        },
        // 03 as ferramentas chamadas
        ferramentas: ferramentas.map((f) => ({
          capacidade: f.capacidade,
          args: f.argsResumo,
          resultado: f.resultadoResumo,
          nivel: f.nivel,
          decisao: f.decisao,
          duracaoMs: f.duracaoMs,
        })),
        // 04 a régua decidiu
        regua: {
          nivelMax: s.nivelMax,
          motivo: s.motivo,
          decisoes: ferramentas
            .filter((f) => f.decisao)
            .map((f) => ({
              capacidade: f.capacidade,
              nivel: f.nivel,
              decisao: f.decisao,
              motivo: f.motivo,
              gatilhos: f.gatilhos,
              approvalId: f.approvalId,
            })),
        },
        // 05 o que saiu
        resposta: { texto: s.resposta, semProcedencia: s.semProcedencia, fontes: s.fontes },
        // 06 o que ficou registrado — ponteiro para o rastro, não uma cópia
        registro: {
          correlationId: s.id,
          toolCalls: ferramentas.map((f) => f.toolCallId).filter(Boolean),
          passos: s.steps.length,
        },
      },
    };
  }

  async listar(
    orgId: string,
    filtro: { canal?: SessionCanal; agentSlug?: string; limit?: number } = {},
  ) {
    const take = Math.min(Math.max(filtro.limit ?? 50, 1), 200);
    const where: Prisma.SessionWhereInput = { orgId };
    if (filtro.canal) where.canal = filtro.canal;
    if (filtro.agentSlug) where.agent = { slug: filtro.agentSlug };

    const [linhas, total, somas, semFonte] = await Promise.all([
      this.prisma.session.findMany({
        where,
        orderBy: { criadaEm: 'desc' },
        take,
        include: { agent: { select: { slug: true, nome: true, iniciais: true } } },
      }),
      this.prisma.session.count({ where }),
      this.prisma.session.aggregate({ where, _sum: { custoUsd: true } }),
      this.prisma.session.count({ where: { ...where, semProcedencia: true } }),
    ]);

    // Se QUALQUER sessão do filtro tem custo não medido, a soma inteira é
    // "parcial" — somar o que se sabe e apresentar como total seria mentira.
    const algumNaoMedido = linhas.some((l) => !l.custoEstimado);

    return {
      items: linhas.map((s) => ({
        id: s.id,
        agente: s.agent,
        canal: s.canal,
        solicitante: s.solicitanteRotulo,
        pedido: s.pedido.slice(0, 200),
        status: s.status,
        nivelMax: s.nivelMax,
        passos: s.passos,
        custoUsd: Number(s.custoUsd),
        custoEstimado: s.custoEstimado,
        duracaoMs: s.duracaoMs,
        semProcedencia: s.semProcedencia,
        criadaEm: s.criadaEm.toISOString(),
      })),
      total,
      kpis: {
        sessoes: total,
        custoUsd: Number(somas._sum.custoUsd ?? 0),
        custoParcial: algumNaoMedido,
        semProcedencia: semFonte,
      },
    };
  }
}
