import { BadRequestException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ActorType, ContextKind, ContextSource } from '@prisma/client';
import {
  chaveDaPerformance,
  mesDaChaveDaPerformance,
  type PautaNumerosDoPost,
  type PautaPerformancePainel,
  type PautaSnapshotDaPerformance,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService } from '../memory/memoria.service';
import { EfeitosRegistry } from '../gateway/efeitos.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { decifrar } from '../common/crypto';
import { GRAPH_DE_INSIGHTS, type GraphDeInsights } from './graph-de-insights';
import { contaDePublicacao } from './publicacao-instagram.service';
import { janelaDoMes } from './estrategia.service';
import { comoConectar, montarSnapshot, type PostParaMedir } from './performance-da-pauta';
import { umaPorVez } from './uma-por-vez';

/** A capacidade de LEITURA do catálogo. Ler mídia da conta é R0: não muda nada fora. */
const CAPACIDADE = 'social.instagram.midia';

function ehRetida(r: unknown): boolean {
  return !!r && typeof r === 'object' && (r as { status?: unknown }).status === 'aguardando_aprovacao';
}

interface LeituraDaConta {
  seguidores: number | null;
  numeros: Array<PautaNumerosDoPost & { externalId: string; erro: string | null }>;
}

/*
 * A PERFORMANCE DA CASA (MK5).
 *
 * A leitura dos números vai PELA PORTA, como a dos comentários (MD9): o serviço
 * inscreve o efeito de `social.instagram.midia` e nunca o dispara direto, e a
 * Graph só é chamada dentro do efeito. O snapshot do mês é nota da memória,
 * como a estratégia (MK4) e o relatório (MK6).
 *
 * SEM INSTAGRAM CONECTADO NÃO HÁ ERRO, HÁ INSTRUÇÃO: o painel volta com
 * `conectado: false` e a frase de como conectar. O Instagram da Root não está
 * ligado hoje, e uma tela que estoura em vermelho ensinaria que o módulo está
 * quebrado quando ele só está esperando uma conexão.
 */
@Injectable()
export class PerformanceService implements OnModuleInit {
  private readonly log = new Logger('PerformanceService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly memoria: MemoriaService,
    private readonly efeitos: EfeitosRegistry,
    private readonly porta: PortaDoOperador,
    @Inject(GRAPH_DE_INSIGHTS) private readonly graph: GraphDeInsights,
  ) {}

  onModuleInit(): void {
    this.efeitos.registrar({ [CAPACIDADE]: (a, org) => this.efeito(a, org) }, 'PerformanceService');
  }

  // ------------------------------------------------------------------ o efeito

  /**
   * A leitura, disparada pela porta. Um post que falha NÃO derruba os outros —
   * o motivo dele volta na linha, e o mês continua medido pelo resto. Um mês
   * inteiro sem número por causa de um post seria pior do que o post sem número.
   */
  private async efeito(a: Record<string, unknown>, orgId: string): Promise<LeituraDaConta> {
    const ids = Array.isArray(a.midiaIds) ? a.midiaIds.filter((x): x is string => typeof x === 'string') : null;
    if (!ids) throw new BadRequestException('Pedido de leitura de números fora da forma do catálogo.');

    const conta = await contaDePublicacao(this.prisma, orgId);
    if (!conta) throw new BadRequestException('A conta do Instagram não está conectada: nada foi lido.');
    const token = decifrar(conta.tokenCifrado);

    let seguidores: number | null = null;
    try {
      seguidores = await this.graph.seguidores(token);
    } catch (e) {
      // O número da conta é linha de base, não o miolo: sem ele o mês ainda se
      // mede post a post.
      this.log.warn(`seguidores de ${orgId}: ${(e as Error).message}`);
    }

    const numeros: LeituraDaConta['numeros'] = [];
    for (const id of ids) {
      try {
        const n = await this.graph.numerosDo(token, id);
        numeros.push({ ...n, erro: null });
      } catch (e) {
        numeros.push({
          externalId: id,
          visualizacoes: null,
          curtidas: null,
          comentarios: null,
          salvamentos: null,
          compartilhamentos: null,
          erro: `A Graph recusou este post: ${(e as Error).message}`.slice(0, 300),
        });
      }
    }
    return { seguidores, numeros };
  }

  // ------------------------------------------------------------------ a tela

  private async meses(orgId: string): Promise<string[]> {
    try {
      const { itens } = await this.memoria.listar(orgId, { kind: ContextKind.definicao });
      return itens
        .map((n) => mesDaChaveDaPerformance(n.chave))
        .filter((m): m is string => Boolean(m))
        .sort()
        .reverse();
    } catch (e) {
      this.log.warn(`meses da performance de ${orgId}: ${(e as Error).message}`);
      return [];
    }
  }

  async painel(orgId: string, mes: string): Promise<PautaPerformancePainel> {
    const [nota, meses, conta] = await Promise.all([
      this.memoria.porChave(orgId, chaveDaPerformance(mes)),
      this.meses(orgId),
      contaDePublicacao(this.prisma, orgId).catch(() => null),
    ]);
    let snapshot: PautaSnapshotDaPerformance | null = null;
    if (nota && !nota.arquivadoEm && nota.body.trim()) {
      try {
        snapshot = JSON.parse(nota.body) as PautaSnapshotDaPerformance;
      } catch {
        snapshot = null;
      }
    }
    return {
      mes,
      snapshot,
      meses,
      conectado: Boolean(conta),
      comoConectar: comoConectar(conta ? { externalId: conta.externalId, escopos: [...conta.escopos] } : null),
    };
  }

  coletar(orgId: string, actorId: string, mes: string): Promise<PautaPerformancePainel> {
    return umaPorVez(`pauta-performance:${orgId}:${mes}`, 'A coleta dos números', () =>
      this.coletarAgora(orgId, actorId, mes),
    );
  }

  private async coletarAgora(orgId: string, actorId: string, mes: string): Promise<PautaPerformancePainel> {
    const conta = await contaDePublicacao(this.prisma, orgId);
    const falta = comoConectar(conta ? { externalId: conta.externalId, escopos: [...conta.escopos] } : null);
    if (falta) throw new BadRequestException(falta);

    const { de, ate } = janelaDoMes(mes);
    const pecas = await this.prisma.pautaPeca.findMany({
      where: { orgId, status: 'publicada', publicadaEm: { gte: de, lt: ate } },
      select: { id: true, titulo: true, formato: true, publicadaEm: true, urlPublicada: true, externalId: true },
      orderBy: { publicadaEm: 'asc' },
      take: 200,
    });

    const comId = pecas.filter((p) => p.externalId);
    let leitura: LeituraDaConta = { seguidores: null, numeros: [] };
    if (comId.length) {
      const r = await this.porta.executar({
        orgId,
        actorId,
        actorType: ActorType.user,
        capabilityId: CAPACIDADE,
        args: { midiaIds: comId.map((p) => p.externalId as string) } as unknown as Record<string, unknown>,
        resource: { type: CAPACIDADE, id: conta!.externalId },
      });
      if (ehRetida(r)) {
        throw new BadRequestException(
          `A porta reteve a leitura dos números para aprovação: nada foi lido. Confira o nível de ${CAPACIDADE}.`,
        );
      }
      leitura = r as LeituraDaConta;
    }

    const porId = new Map(leitura.numeros.map((n) => [n.externalId, n]));
    const posts: PostParaMedir[] = pecas.map((p) => {
      const lido = p.externalId ? porId.get(p.externalId) : undefined;
      return {
        pecaId: p.id,
        titulo: p.titulo,
        formato: p.formato,
        publicadaEm: p.publicadaEm ? p.publicadaEm.toISOString() : null,
        urlPublicada: p.urlPublicada,
        externalId: p.externalId,
        numeros: lido && !lido.erro ? lido : null,
        erro: lido?.erro ?? null,
      };
    });

    const snapshot = montarSnapshot({ mes, coletadoEm: new Date(), seguidores: leitura.seguidores, posts });
    await this.gravar(orgId, mes, snapshot);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.performance_coletada',
      entityType: 'context_item',
      entityId: chaveDaPerformance(mes),
      after: {
        mes,
        publicados: snapshot.publicados,
        medidos: snapshot.medidos,
        seguidores: snapshot.seguidores,
        metricaDeReferencia: snapshot.metricaDeReferencia,
      },
    });
    return this.painel(orgId, mes);
  }

  private async gravar(orgId: string, mes: string, snapshot: PautaSnapshotDaPerformance) {
    const chave = chaveDaPerformance(mes);
    const dados = {
      kind: ContextKind.definicao,
      title: `Performance de ${mes}`,
      body: JSON.stringify(snapshot, null, 2),
      sourceType: ContextSource.promocao,
      sourceRef: `pauta.performance · ${mes} · ${snapshot.medidos}/${snapshot.publicados} medidos`,
      // Recoletar SUBSTITUI a fotografia inteira: os números da Graph não param,
      // e mesclar duas leituras de dias diferentes daria um mês que nunca existiu.
      motivo: 'snapshot de performance coletado (MK5)',
    };
    const existente = await this.memoria.porChave(orgId, chave);
    if (!existente) return this.memoria.criar(orgId, { chave, tags: ['pauta', 'performance'], ...dados });
    let nota = await this.memoria.alterar(orgId, existente.id, dados);
    if (nota.arquivadoEm) nota = await this.memoria.restaurar(orgId, nota.id, 'a performance do mês voltou a valer');
    return nota;
  }
}
