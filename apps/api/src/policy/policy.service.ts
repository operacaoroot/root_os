import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RiskLevel } from '@prisma/client';
import {
  avaliar,
  lerPolitica,
  lerDelta,
  resolverPolitica,
  type Capacidade,
  type Contexto,
  type Decisao,
  type Politica,
  type Sinal,
} from '@mktos/policy';
import politicaRoot from '@mktos/policy/politica-root.json';
import politicaMktos from '@mktos/policy/politica-marketing-os.json';
import { PrismaService } from '../prisma/prisma.service';

/*
 * A CASCA do motor de política. A decisão em si continua sendo avaliar(), do
 * pacote puro, intocado — aqui mora só o I/O: carregar, cachear e persistir.
 * É essa divisão que permite o mesmo código decidir no painel, no MCP e no
 * simulador da tela da Régua.
 */
@Injectable()
export class PolicyService implements OnModuleInit {
  private readonly log = new Logger('PolicyService');
  /** Política resolvida por org. A chave '' é a base ROOT herdada. */
  private readonly cache = new Map<string, Politica>();
  /** Índice id → capacidade, por org, para não varrer o array a cada chamada. */
  private readonly indice = new Map<string, Map<string, Capacidade>>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.recarregar();
  }

  /** A base empacotada no build. É o chão: nunca depende do banco estar bom. */
  private baseEmpacotada(): Politica {
    const base = lerPolitica(politicaRoot, 'politica-root.json');
    const delta = lerDelta(politicaMktos, 'politica-marketing-os.json');
    return resolverPolitica(base, delta);
  }

  async recarregar(orgId?: string): Promise<void> {
    const chave = orgId ?? '';
    try {
      const versao = await this.prisma.policyVersion.findFirst({
        where: { orgId: orgId ?? null, ativaAte: null },
        orderBy: { versao: 'desc' },
      });
      if (versao) {
        const doc = lerPolitica(versao.documento, `PolicyVersion ${versao.id}`);
        this.guardar(chave, doc);
        this.log.log(`política v${versao.versao} carregada (${doc.capacidades.length} capacidades)`);
        return;
      }
    } catch (e) {
      /*
       * Documento malformado no banco NÃO pode derrubar a API inteira. Se o
       * onModuleInit lançar, o boot morre e ninguém entende por quê — e a
       * política volta a existir só no papel. Cai na base empacotada e grita.
       */
      this.log.error(
        `FALHA ao carregar a política do banco (${(e as Error).message}). ` +
          'Usando a base empacotada — a política POR EMPRESA não está valendo.',
      );
    }
    this.guardar(chave, this.baseEmpacotada());
  }

  private guardar(chave: string, doc: Politica): void {
    this.cache.set(chave, doc);
    this.indice.set(chave, new Map(doc.capacidades.map((c) => [c.id, c as Capacidade])));
  }

  private politica(orgId: string): Politica {
    return this.cache.get(orgId) ?? this.cache.get('') ?? this.baseEmpacotada();
  }

  /** Nulo = capacidade sem classificação. avaliar(null) devolve R5 bloqueado. */
  resolverCapacidade(orgId: string, id: string): Capacidade | null {
    return this.indice.get(orgId)?.get(id) ?? this.indice.get('')?.get(id) ?? null;
  }

  capacidades(orgId: string): Capacidade[] {
    return this.politica(orgId).capacidades as Capacidade[];
  }

  limites(orgId: string) {
    return this.politica(orgId).limitesPadrao;
  }

  /** Decide SEM persistir. É o simulador da tela da Régua (RF-P-09). */
  simular(orgId: string, capabilityId: string, ctx: Contexto = {}): Decisao {
    return avaliar(this.resolverCapacidade(orgId, capabilityId), ctx);
  }

  /**
   * Decide e REGISTRA. A recusa também vira linha — é dela que sai o número
   * "N decisões em 30 dias" da tela da Régua, e sem ela não há como provar
   * que a régua barrou alguma coisa.
   */
  async avaliarERegistrar(input: {
    orgId: string;
    capabilityId: string | null;
    ctx?: Contexto;
    modo?: 'impor' | 'observar';
  }): Promise<{ decisao: Decisao; decisionId: string }> {
    const cap = input.capabilityId ? this.resolverCapacidade(input.orgId, input.capabilityId) : null;
    const decisao = avaliar(cap, input.ctx ?? {});

    const linha = await this.prisma.policyDecision.create({
      data: {
        orgId: input.orgId,
        capabilityId: cap?.id ?? null,
        nivelBase: decisao.nivelBase as RiskLevel,
        nivel: decisao.nivel as RiskLevel,
        permitido: decisao.permitido,
        exigeAprovacao: decisao.exigeAprovacao,
        sinais: decisao.sinaisAcionados as string[],
        motivo: decisao.motivo,
        modo: input.modo ?? 'impor',
      },
      select: { id: true },
    });

    return { decisao, decisionId: linha.id };
  }
}

export type { Decisao, Sinal, Capacidade };
