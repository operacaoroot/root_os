import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, ActorType, ContextKind, ContextSource, type BioConexao, type PautaPeca } from '@prisma/client';
import {
  chaveDaPerformance,
  mesDaChaveDaPerformance,
  type PautaNumerosDoPost,
  type PautaPerformancePainel,
  type PautaSnapshotDaPerformance,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService, type IdentidadeDaDerivacao, type PlanoInternoDeFontesDaDerivacao, type CompromissoDaDerivacao } from '../memory/memoria.service';
import { AsyncLocalStorage } from 'node:async_hooks';
import { contextoAtual } from '../common/contexto-execucao';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
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

type ContaSemSegredos = Omit<BioConexao, 'tokenCifrado' | 'refreshCifrado' | 'expiraEm' | 'conectadaEm' | 'atualizadaEm'> & {
  expiraEm: string | null; conectadaEm: string; atualizadaEm: string;
};
interface MaterialDaPerformance { conta: ContaSemSegredos; pecas: PautaPeca[] }
interface SelecaoDaPerformance { contaId: string; pecaIds: string[] }
interface CredenciaisPrivadas { valor: { tokenCifrado: string; refreshCifrado: string | null } | null }
interface PinDaPerformance {
  ativo: boolean; orgId: string; actorId: string; correlationId: string; mes: string;
  selecao: SelecaoDaPerformance; material: Readonly<MaterialDaPerformance>; midiaIds: string[];
  segredos: CredenciaisPrivadas | null;
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
  private readonly leituraPinada = new AsyncLocalStorage<PinDaPerformance>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly memoria: MemoriaService,
    private readonly efeitos: EfeitosRegistry,
    private readonly porta: PortaDoOperador,
    @Inject(GRAPH_DE_INSIGHTS) private readonly graph: GraphDeInsights,
  ) {}

  onModuleInit(): void {
    this.efeitos.registrar({ [CAPACIDADE]: (a, org, ctx) => this.efeito(a, org, ctx) }, 'PerformanceService');
  }

  // ------------------------------------------------------------------ o efeito

  /**
   * A leitura, disparada pela porta. Um post que falha NÃO derruba os outros —
   * o motivo dele volta na linha, e o mês continua medido pelo resto. Um mês
   * inteiro sem número por causa de um post seria pior do que o post sem número.
   */
  private async efeito(a: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito): Promise<LeituraDaConta> {
    const ids = Array.isArray(a.midiaIds) ? a.midiaIds.filter((x): x is string => typeof x === 'string') : null;
    if (!ids) throw new BadRequestException('Pedido de leitura de números fora da forma do catálogo.');

    const pin = this.leituraPinada.getStore();
    let token: string;
    if (pin) {
      this.conferirContextoDoPin(pin, ctx, orgId, ids);
      token = await this.conferirPinAntesDaGraph(pin, ctx, ids);
    } else {
      // Esta porta genérica apenas lê números; não conclui nem grava uma coleta.
      const conta = await contaDePublicacao(this.prisma, orgId);
      if (!conta) throw new BadRequestException('A conta do Instagram não está conectada: nada foi lido.');
      token = decifrar(conta.tokenCifrado);
    }

    let seguidores: number | null = null;
    try {
      seguidores = await this.graph.seguidores(token);
    } catch (e) {
      // O número da conta é linha de base, não o miolo: sem ele o mês ainda se
      // mede post a post.
      if (pin) this.log.warn('A Graph não devolveu os seguidores da conta escolhida.');
      else this.log.warn(`seguidores de ${orgId}: ${(e as Error).message}`);
    }

    const numeros: LeituraDaConta['numeros'] = [];
    for (const id of ids) {
      // Recusa de pin/ACL/fonte fica fora do catch recuperável do post.
      if (pin) token = await this.conferirPinAntesDaGraph(pin, ctx, ids);
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
          erro: pin ? 'A Graph recusou este post.' : `A Graph recusou este post: ${(e as Error).message}`.slice(0, 300),
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
    const identidade = this.identidadeHumana(orgId, actorId);
    const segredos: CredenciaisPrivadas = { valor: null };
    try {
      const observada = await this.prisma.$transaction(async (tx) => {
        const observacao = await this.memoria.observarDestinoDaDerivacaoNoTx(tx, orgId, identidade,
          { tipo: 'A4-PERF', mes }, this.planoDaPerformance(orgId, mes, segredos));
        const destino = await tx.contextItem.findFirst({ where: { orgId, chave: chaveDaPerformance(mes) }, select: { id: true } });
        return { ...observacao, criarComTags: !destino };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      const { conta, pecas } = observada.material;
      const comId = pecas.flatMap((p) => p.externalId ? [p.externalId] : []);
      let leitura: LeituraDaConta = { seguidores: null, numeros: [] };
      if (comId.length) {
        const pin: PinDaPerformance = { ativo: true, orgId, actorId, correlationId: identidade.correlationId, mes,
          selecao: { contaId: conta.id, pecaIds: pecas.map((p) => p.id) }, material: observada.material,
          midiaIds: [...comId], segredos };
        try {
          const r = await this.leituraPinada.run(pin, () => this.porta.executar({
            orgId, actorId, actorType: ActorType.user, capabilityId: CAPACIDADE,
            args: { midiaIds: [...comId] }, resource: { type: CAPACIDADE, id: conta.externalId },
          }));
          if (ehRetida(r)) throw new BadRequestException(
            `A porta reteve a leitura dos números para aprovação: nada foi lido. Confira o nível de ${CAPACIDADE}.`,
          );
          leitura = r as LeituraDaConta;
        } finally {
          // run restaura o store anterior. Referências tardias não podem iniciar outra chamada.
          pin.ativo = false;
          pin.segredos = null;
        }
      }
      const porId = new Map(leitura.numeros.map((n) => [n.externalId, n]));
      const posts: PostParaMedir[] = pecas.map((p) => {
        const lido = p.externalId ? porId.get(p.externalId) : undefined;
        return { pecaId: p.id, titulo: p.titulo, formato: p.formato,
          publicadaEm: p.publicadaEm ? p.publicadaEm.toISOString() : null,
          urlPublicada: p.urlPublicada, externalId: p.externalId,
          numeros: lido && !lido.erro ? lido : null, erro: lido?.erro ?? null };
      });
      const snapshot = montarSnapshot({ mes, coletadoEm: new Date(), seguidores: leitura.seguidores, posts });
      const corpo = JSON.stringify(snapshot, null, 2);
      const compromisso = await this.prisma.$transaction((tx) =>
        this.memoria.aplicarDerivacaoCondicionadaNoTx(tx, observada.capsula, {
          kind: ContextKind.definicao, title: `Performance de ${mes}`, body: corpo,
          ...(observada.criarComTags ? { tags: ['pauta', 'performance'] } : {}),
          sourceType: ContextSource.promocao,
          sourceRef: `pauta.performance · ${mes} · ${snapshot.medidos}/${snapshot.publicados} medidos`,
          motivo: 'snapshot de performance coletado (MK5)',
        }), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      await this.audit.log({ orgId, actorId, action: 'pauta.performance_coletada', entityType: 'context_item',
        entityId: compromisso.aplicada.itemId, after: { mes, publicados: snapshot.publicados, medidos: snapshot.medidos,
          seguidores: snapshot.seguidores, metricaDeReferencia: snapshot.metricaDeReferencia,
          versionId: compromisso.aplicada.versionId, versao: compromisso.aplicada.versao, contentHash: compromisso.aplicada.contentHash } });
      return await this.painelDaColetaConfirmada(orgId, mes, corpo, compromisso);
    } finally {
      // O snapshot privado sobrevive ao store até apply/recusa; não é persistido ou enviado à Porta.
      segredos.valor = null;
    }
  }

  private identidadeHumana(orgId: string, actorId: string): Extract<IdentidadeDaDerivacao, { tipo: 'humano' }> {
    const c = contextoAtual();
    if (!actorId || c?.orgId !== orgId || c.actorType !== 'user' || c.actorId !== actorId || !c.correlationId) {
      throw new ForbiddenException('Acesso insuficiente.');
    }
    return { tipo: 'humano', actorId, correlationId: c.correlationId };
  }

  private retratoDaConta(c: BioConexao): ContaSemSegredos {
    const { tokenCifrado: _token, refreshCifrado: _refresh, expiraEm, conectadaEm, atualizadaEm, ...publico } = c;
    return { ...publico, expiraEm: expiraEm?.toISOString() ?? null,
      conectadaEm: conectadaEm.toISOString(), atualizadaEm: atualizadaEm.toISOString() };
  }

  private async contaDaPerformanceNoTx(tx: Prisma.TransactionClient, orgId: string, contaId?: string): Promise<BioConexao> {
    if (contaId) await tx.$queryRaw`SELECT id FROM "BioConexao" WHERE "orgId"=${orgId} AND id=${contaId}
      AND plataforma='instagram' AND finalidade='publicacao' FOR SHARE`;
    else await tx.$queryRaw`SELECT id FROM "BioConexao" WHERE "orgId"=${orgId}
      AND plataforma='instagram' AND finalidade='publicacao' ORDER BY id FOR SHARE`;
    const c = await tx.bioConexao.findFirst({ where: { orgId, plataforma: 'instagram', finalidade: 'publicacao',
      ...(contaId ? { id: contaId } : {}) } });
    if (!c) {
      if (contaId) throw new ConflictException('A conta escolhida mudou durante a coleta.');
      throw new BadRequestException('A conta do Instagram não está conectada: nada foi lido.');
    }
    const falta = comoConectar({ externalId: c.externalId, escopos: (c.escopos ?? '').split(',').map((e) => e.trim()).filter(Boolean) });
    if (falta) throw new BadRequestException(falta);
    return c;
  }

  private planoDaPerformance(orgId: string, mes: string, segredos: CredenciaisPrivadas): PlanoInternoDeFontesDaDerivacao<MaterialDaPerformance, SelecaoDaPerformance> {
    return {
      observar: async (tx) => {
        const conta = await this.contaDaPerformanceNoTx(tx, orgId);
        segredos.valor = { tokenCifrado: conta.tokenCifrado, refreshCifrado: conta.refreshCifrado };
        const { de, ate } = janelaDoMes(mes);
        const pecas = await tx.pautaPeca.findMany({ where: { orgId, status: 'publicada', publicadaEm: { gte: de, lt: ate } },
          select: { id: true }, orderBy: { publicadaEm: 'asc' }, take: 200 });
        const selecao = { contaId: conta.id, pecaIds: pecas.map((p) => p.id) };
        return { ...await this.relerPerformanceNoTx(tx, orgId, mes, selecao, segredos), selecao };
      },
      reconferir: (tx, _lerFonte, selecao) => this.relerPerformanceNoTx(tx, orgId, mes, selecao, segredos),
    };
  }

  private async relerPerformanceNoTx(tx: Prisma.TransactionClient, orgId: string, mes: string,
    selecao: Readonly<SelecaoDaPerformance>, segredos: CredenciaisPrivadas) {
    const conta = await this.contaDaPerformanceNoTx(tx, orgId, selecao.contaId);
    const esperado = segredos.valor;
    if (!esperado || conta.tokenCifrado !== esperado.tokenCifrado || conta.refreshCifrado !== esperado.refreshCifrado) {
      throw new ConflictException('A conta escolhida mudou durante a coleta.');
    }
    const ids = [...selecao.pecaIds];
    if (ids.length) await tx.$queryRaw`SELECT id FROM "PautaPeca" WHERE "orgId"=${orgId} AND id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR SHARE`;
    const rows = ids.length ? await tx.pautaPeca.findMany({ where: { orgId, id: { in: ids } } }) : [];
    if (rows.length !== ids.length) throw new ConflictException('As peças escolhidas mudaram durante a coleta.');
    const porId = new Map(rows.map((p) => [p.id, p])); const { de, ate } = janelaDoMes(mes);
    const pecas: PautaPeca[] = ids.map((id) => {
      const p = porId.get(id);
      if (!p || p.status !== 'publicada' || !p.publicadaEm || p.publicadaEm < de || p.publicadaEm >= ate) {
        throw new ConflictException('As peças escolhidas mudaram durante a coleta.');
      }
      return p;
    });
    const publico = this.retratoDaConta(conta);
    return { material: { conta: publico, pecas }, descritores: { conta: publico, credenciaisConferidas: true,
      pecas: pecas.map((p) => ({ ...p, publicadaEm: p.publicadaEm?.toISOString() ?? null,
        agendadaPara: p.agendadaPara?.toISOString() ?? null, slotProposto: p.slotProposto?.toISOString() ?? null,
        criadaEm: p.criadaEm.toISOString() })) } };
  }

  private conferirContextoDoPin(pin: PinDaPerformance, ctx: ContextoDoEfeito, orgId: string, ids: string[]) {
    if (!pin.ativo || pin.orgId !== orgId || ctx.orgId !== pin.orgId || ctx.actorType !== ActorType.user
      || ctx.actorId !== pin.actorId || ctx.correlationId !== pin.correlationId
      || ids.length !== pin.midiaIds.length || ids.some((id, i) => id !== pin.midiaIds[i])) {
      throw new ForbiddenException('A leitura não corresponde à conta e ao pedido escolhidos.');
    }
  }

  private async conferirPinAntesDaGraph(pin: PinDaPerformance, ctx: ContextoDoEfeito, ids: string[]): Promise<string> {
    this.conferirContextoDoPin(pin, ctx, ctx.orgId, ids);
    const segredos = pin.segredos;
    if (!segredos) throw new ForbiddenException('A leitura escolhida foi encerrada.');
    return this.prisma.$transaction(async (tx) => {
      await exigirAcessoAtual(tx, pin.orgId, pin.actorId, ['obsidian.ver', 'pauta.editar', 'automacoes.executar']);
      const atual = await this.relerPerformanceNoTx(tx, pin.orgId, pin.mes, pin.selecao, segredos);
      if (JSON.stringify(atual.material) !== JSON.stringify(pin.material)) {
        throw new ConflictException('A conta ou as peças escolhidas mudaram durante a coleta.');
      }
      await exigirAcessoAtual(tx, pin.orgId, pin.actorId, ['obsidian.ver', 'pauta.editar', 'automacoes.executar']);
      this.conferirContextoDoPin(pin, ctx, ctx.orgId, ids);
      const segredo = segredos.valor;
      if (!segredo) throw new ForbiddenException('A leitura escolhida foi encerrada.');
      return decifrar(segredo.tokenCifrado);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private async painelDaColetaConfirmada(orgId: string, mes: string, corpo: string, compromisso: CompromissoDaDerivacao): Promise<PautaPerformancePainel> {
    await this.memoria.concluirEntregaDaDerivacao(compromisso);
    const [meses, conta] = await Promise.all([this.meses(orgId), contaDePublicacao(this.prisma, orgId)]);
    const entrega = await this.memoria.concluirEntregaDaDerivacao(compromisso);
    if (entrega.aplicada.body !== corpo) throw new ConflictException('O snapshot aplicado não corresponde à coleta.');
    return { mes, snapshot: JSON.parse(entrega.aplicada.body) as PautaSnapshotDaPerformance, meses,
      conectado: Boolean(conta), comoConectar: comoConectar(conta ? { externalId: conta.externalId, escopos: [...conta.escopos] } : null) };
  }
}
