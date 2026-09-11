import { Injectable, Logger } from '@nestjs/common';
import type { ActorType, Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { EventLogService } from '../gateway/event-log.service';
import {
  comContexto,
  contextoAtual,
  novaCorrelacao,
  type OrigemDoContexto,
} from '../common/contexto-execucao';
import { PrismaService } from '../prisma/prisma.service';
import { ModulosService } from './modulos.service';
import {
  SLUG_DA_PLATAFORMA,
  provisionarTenant,
  type EntradaDeProvisionamento,
  type Provisionamento,
} from './provisionar';

/**
 * A casca injetável do provisionamento — RF-T-07.
 *
 * A operação mora em `provisionar.ts`, sem Nest, porque a suíte precisa
 * chamá-la (nada que dependa de injeção roda sob o vitest). Aqui entra só o que
 * o Nest sabe dar e a função pura não tem como saber sozinha:
 *
 *  1. o CONTEXTO DE EXECUÇÃO da empresa nova, aberto em volta das escritas, para
 *     que a sessão do banco declare a empresa à conexão (RF-T-02);
 *  2. o RASTRO, pelo `EventLogService`, que é o único lugar onde a cadeia por
 *     hash é montada direito — e a CORRELAÇÃO que o liga à requisição (RNF-09);
 *  3. a AUDITORIA, pelo `AuditService`, que recebe UMA linha por chamada,
 *     inclusive as recusadas e as que não mudaram nada;
 *  4. a EMPRESA ORDENANTE, que é onde o evento de intenção pode ser gravado
 *     (ver `OpcoesDeProvisionamento.ordenante`);
 *  5. o esquecimento do cache de módulos, sem o qual ligar um módulo agora
 *     levaria até 30s para valer e quem clicou acharia que não funcionou.
 */
@Injectable()
export class ProvisionamentoService {
  private readonly log = new Logger('Provisionamento');

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventLogService,
    private readonly auditoria: AuditService,
    private readonly modulos: ModulosService,
  ) {}

  async provisionar(
    entrada: EntradaDeProvisionamento,
    quem: { tipo: ActorType; id?: string | null; origem?: OrigemDoContexto } = { tipo: 'system' },
  ): Promise<Provisionamento> {
    const fora = contextoAtual();
    const ator = { tipo: quem.tipo, id: quem.id ?? fora?.actorId ?? null };
    const correlacao = fora?.correlationId ?? novaCorrelacao('prov');
    const ordenante = await this.ordenante(fora?.orgId ?? null);

    /*
     * Contexto NOVO, e não o de fora: quem provisiona age a partir da empresa
     * dele (a plataforma), mas tudo que este trabalho escreve é da empresa que
     * está nascendo. Manter o contexto de fora mandaria `app.org_id` da
     * plataforma para a conexão, e sob isolamento por linha nenhuma das escritas
     * pertenceria a quem deveria — inclusive a linha do RASTRO, que é da empresa
     * nova e por isso também entra por aqui.
     *
     * A correlação, ao contrário, é herdada: é ela que liga a requisição HTTP ao
     * que aconteceu no banco (RNF-09). `comContexto` deduz o pai sozinho.
     */
    const naEmpresa = <T>(orgId: string, fn: () => Promise<T>): Promise<T> =>
      comContexto(
        {
          orgId,
          actorType: ator.tipo,
          actorId: ator.id,
          correlationId: correlacao,
          origem: quem.origem ?? fora?.origem ?? 'script',
        },
        fn,
      );

    const resultado = await provisionarTenant(this.prisma, entrada, {
      emContexto: naEmpresa,
      ordenante,
      correlacao,
      rastro: (evento) =>
        naEmpresa(evento.orgId, () =>
          this.eventos.registrar({
            ...evento,
            payload: evento.payload as Prisma.InputJsonValue,
          }),
        ),
      /*
       * A auditoria roda no contexto da empresa em que a linha é gravada, que é
       * a ORDENANTE quando existe uma: é a trilha de "quem mandou provisionar o
       * quê", e ela pertence a quem mandou. O RASTRO da empresa nova continua
       * contando o nascimento dela.
       */
      auditar: (linha) =>
        naEmpresa(linha.orgId, () =>
          this.auditoria.log({
            orgId: linha.orgId,
            actorType: ator.tipo,
            actorId: ator.id ?? undefined,
            action: linha.action,
            entityType: 'org',
            entityId: linha.entityId ?? undefined,
            metadata: {
              ...linha.metadata,
              correlationId: correlacao,
              origem: quem.origem ?? fora?.origem ?? 'script',
            } as Prisma.InputJsonValue,
          }),
        ),
      responsavel: ator,
    });

    if (resultado.modulosAlterados) this.modulos.esquecer(resultado.orgId);

    this.log.log(
      `empresa "${resultado.slug}" ${resultado.criada ? 'CRIADA' : 'já existia'} · ` +
        `modo: ${resultado.modo} · ` +
        `módulos: ${resultado.modulos.join(', ') || '(só a espinha)'} · ` +
        `papéis criados: ${resultado.papeis.criados.length} · ` +
        `mudou: ${resultado.mudou ? 'sim' : 'não'}`,
    );
    for (const aviso of resultado.avisos) this.log.warn(`[${aviso.codigo}] ${aviso.texto}`);

    return resultado;
  }

  /**
   * A empresa onde o evento de INTENÇÃO cabe.
   *
   * Primeiro a empresa de quem chamou (pela rota, é a plataforma — o
   * `JwtAuthGuard` já resolveu). Sem contexto (comando de terminal), a empresa
   * da casa pelo slug. Sem nenhuma das duas (banco recém-criado, primeira
   * empresa do mundo), `null` — e aí a operação AVISA que a intenção ficou sem
   * casa, em vez de fingir que registrou.
   */
  private async ordenante(doContexto: string | null): Promise<string | null> {
    if (doContexto) return doContexto;
    try {
      const plataforma = await this.prisma.org.findUnique({
        where: { slug: SLUG_DA_PLATAFORMA },
        select: { id: true },
      });
      return plataforma?.id ?? null;
    } catch (e) {
      /*
       * Consulta de plataforma sem empresa resolvida: sob `TENANT_MODO=impor` ela
       * é recusada. Não é motivo para derrubar o provisionamento aqui — quem
       * derruba com nome próprio é `acharOrg`, na operação. O que se perde é o
       * endereço do evento de intenção, e a operação AVISA.
       */
      this.log.warn(
        `não foi possível achar a empresa da plataforma ("${SLUG_DA_PLATAFORMA}") para registrar ` +
          `a intenção: ${(e as Error).message}`,
      );
      return null;
    }
  }
}
