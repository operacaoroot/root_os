import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  COMERCIAL_ETAPAS,
  COMERCIAL_TIPOS_DE_DECISAO,
  type ComercialCanalDeDecisao,
  type ComercialEstadoDeDecisao,
  type ComercialTipoDeDecisao,
  type DecisaoNaFila,
  type FilaDeDecisoes,
  type OpcaoDeDecisao,
} from '@mktos/shared';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ConfigComercialService } from './config.service';
import { resumoDoEvento, uuidDe } from './eventos';
import { FioService } from './fio.service';

/*
 * A FILA DE DECISÕES (lane A, 13/10/2026) — K01 "a tela principal é a das exceções".
 *
 * Uma decisão é o que saiu da regra e precisa de alguém: proposta fora da
 * tabela, ponto zero, lead parado, pedido de ajuste, veto de fechamento,
 * exceção do vigia. Ela nasce com as opções, o PADRÃO escrito e o prazo; quem
 * responde escolhe uma opção em um toque (tela 03, tela 09, canal de aprovação).
 *
 * TRÊS REGRAS
 *
 * 1. VENCER APLICA O PADRÃO ESCRITO. `expirarVencidas` (chamada pelo relógio)
 *    troca `aberta` por `expirada`, grava a escolha = padrão e o evento
 *    `decisao.expirada`, e roda as mesmas reações de quem decidiu. O padrão é
 *    sempre uma das opções (recusado na abertura se não for).
 *
 * 2. O PRAZO É CONFIGURAÇÃO. Sem `expiraEm` explícito, vale
 *    `decisaoExpiraHoras` da `ComercialConfig`; com ela nula ([a decidir]), a
 *    decisão NÃO VENCE SOZINHA — fica aberta até alguém responder. A coluna é
 *    NOT NULL, então "sem prazo" é a data-sentinela `SEM_PRAZO` (31/12/9999),
 *    que nenhum relógio alcança; a tela a reconhece por `decisaoSemPrazo`.
 *    Escolha documentada: vencer com padrão sem ninguém ter decidido o prazo
 *    seria arbitrar um número que a mesa não deu.
 *
 * 3. QUEM PROPÔS NÃO DECIDE. Quando a decisão nasce de um pedido humano
 *    (`propostoPor`, guardado em `dados`), essa pessoa não a responde (403) —
 *    a mesma invariante 7 das aprovações. Decisão aberta por regra (relógio,
 *    reação) não tem proponente humano.
 *
 * A resposta é ESCRITA CONDICIONADA ao estado `aberta`: dois toques ao mesmo
 * tempo (tela e WhatsApp) — só um vence; o outro recebe 409. As outras lanes
 * reagem ao resultado pelo `DecisoesRegistry.aoDecidir(tipo, fn)`, chamado UMA
 * vez por decisão (a transição de estado é a trava).
 */

/** "Sem prazo": a data que nenhum relógio alcança. */
export const SEM_PRAZO = new Date('9999-12-31T23:59:59.000Z');

export function decisaoSemPrazo(expiraEm: Date | string): boolean {
  return new Date(expiraEm).getTime() >= SEM_PRAZO.getTime();
}

export interface DecisaoResolvida {
  id: string;
  orgId: string;
  leadId: string;
  tipo: ComercialTipoDeDecisao;
  escolha: string;
  /** `tomada` (alguém respondeu) ou `expirada` (o padrão foi aplicado). */
  como: 'tomada' | 'expirada';
  por: { id: string | null; nome: string | null } | null;
  canal: ComercialCanalDeDecisao;
  dados: Record<string, unknown>;
  motivo: string | null;
}

export type ReacaoADecisao = (d: DecisaoResolvida) => Promise<unknown>;

@Injectable()
export class DecisoesRegistry {
  private readonly porTipo = new Map<string, { nome: string; fn: ReacaoADecisao }[]>();

  /** Inscreve uma reação ao resultado de um tipo de decisão. Nome repetido no mesmo tipo é erro de fiação. */
  aoDecidir(tipo: ComercialTipoDeDecisao, fn: ReacaoADecisao, nome = fn.name || 'anonima'): void {
    const lista = this.porTipo.get(tipo) ?? [];
    if (lista.some((i) => i.nome === nome)) throw new Error(`Reação à decisão "${tipo}" com o nome "${nome}" já inscrita.`);
    lista.push({ nome, fn });
    this.porTipo.set(tipo, lista);
  }

  doTipo(tipo: string): readonly { nome: string; fn: ReacaoADecisao }[] {
    return this.porTipo.get(tipo) ?? [];
  }
}

export interface AbrirDecisao {
  orgId: string;
  leadId: string;
  tipo: ComercialTipoDeDecisao;
  titulo: string;
  contexto: string;
  opcoes: OpcaoDeDecisao[];
  padrao: string;
  expiraEm?: Date | null;
  dados?: Record<string, unknown>;
  /**
   * A identidade da decisão: com ela, abrir de novo devolve a mesma (o relógio
   * repassa, a reação reexecuta). Sem ela, cada chamada abre uma decisão nova.
   */
  chave?: string;
  /** Quem pediu, quando foi uma pessoa: essa pessoa não decide (invariante 7). */
  propostoPor?: string | null;
  /** Instante de referência (o relógio passa o da passagem). */
  agora?: Date;
}

export interface QuemDecide {
  id: string | null;
  nome: string | null;
}

@Injectable()
export class DecisoesService {
  private readonly log = new Logger('ComercialDecisoes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly config: ConfigComercialService,
    private readonly registro: DecisoesRegistry,
  ) {}

  async abrir(a: AbrirDecisao): Promise<{ id: string; nova: boolean; expiraEm: Date }> {
    if (!(COMERCIAL_TIPOS_DE_DECISAO as readonly string[]).includes(a.tipo)) throw new BadRequestException(`Tipo de decisão desconhecido: ${a.tipo}.`);
    if (!a.opcoes.length) throw new BadRequestException('Decisão sem opções.');
    const chaves = a.opcoes.map((o) => o.chave);
    if (new Set(chaves).size !== chaves.length) throw new BadRequestException('Decisão com opção repetida.');
    if (!chaves.includes(a.padrao)) throw new BadRequestException(`O padrão "${a.padrao}" não está entre as opções (${chaves.join(', ')}).`);

    const lead = await this.prisma.lead.findFirst({ where: { id: a.leadId, orgId: a.orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const agora = a.agora ?? new Date();
    const expiraEm = a.expiraEm ?? (await this.prazoPadrao(a.orgId, agora));
    const id = a.chave ? uuidDe([a.orgId, 'comercial-decisao', a.leadId, a.tipo, a.chave]) : randomUUID();
    const dados: Record<string, unknown> = { ...(a.dados ?? {}), ...(a.propostoPor ? { propostoPor: a.propostoPor } : {}) };

    const r = await this.prisma.comercialDecisao.createMany({
      data: [
        {
          id,
          leadId: a.leadId,
          tipo: a.tipo,
          titulo: a.titulo,
          contexto: a.contexto,
          opcoes: a.opcoes as unknown as Prisma.InputJsonValue,
          padrao: a.padrao,
          expiraEm,
          estado: 'aberta',
          dados: dados as Prisma.InputJsonValue,
          criadoEm: agora,
        },
      ],
      skipDuplicates: true,
    });
    if (r.count === 0) {
      const existente = await this.prisma.comercialDecisao.findFirst({ where: { id, orgId: a.orgId }, select: { expiraEm: true } });
      return { id, nova: false, expiraEm: existente?.expiraEm ?? expiraEm };
    }
    const ev = await this.fio.registrar(a.orgId, a.leadId, 'decisao.aberta', id, { decisaoId: id, tipo: a.tipo, padrao: a.padrao, expiraEm: expiraEm.toISOString() }, { em: agora });
    await this.prisma.comercialDecisao.updateMany({ where: { id }, data: { eventoAberturaId: ev.eventoId } });
    return { id, nova: true, expiraEm };
  }

  /** Um toque: responde a decisão. 409 se ela já não está aberta; 403 se quem responde a propôs. */
  async responder(orgId: string, id: string, escolha: string, por: QuemDecide | null, canal: ComercialCanalDeDecisao, motivo?: string | null): Promise<DecisaoResolvida & { resultados: unknown[] }> {
    const d = await this.prisma.comercialDecisao.findFirst({ where: { id, orgId } });
    if (!d) throw new NotFoundException('Decisão não encontrada.');
    if (d.estado !== 'aberta') throw new ConflictException(`A decisão já está ${d.estado}${d.escolha ? ` (escolha: ${d.escolha})` : ''}.`);
    const opcoes = (d.opcoes as unknown as OpcaoDeDecisao[]) ?? [];
    if (!opcoes.some((o) => o.chave === escolha)) {
      throw new BadRequestException(`Escolha "${escolha}" fora das opções (${opcoes.map((o) => o.chave).join(', ')}).`);
    }
    const dados = (d.dados ?? {}) as Record<string, unknown>;
    if (por?.id && typeof dados.propostoPor === 'string' && dados.propostoPor === por.id) {
      throw new ForbiddenException('Quem propôs não decide: a decisão precisa de outra pessoa.');
    }

    const agora = new Date();
    const tomada = await this.prisma.comercialDecisao.updateMany({
      where: { id, orgId, estado: 'aberta' },
      data: { estado: 'tomada', escolha, decididoPor: por?.nome ?? por?.id ?? null, decididoEm: agora, canal },
    });
    if (tomada.count === 0) throw new ConflictException('A decisão acabou de ser respondida por outro caminho.');

    const ev = await this.fio.registrar(orgId, d.leadId, 'decisao.tomada', id, { decisaoId: id, tipo: d.tipo, escolha, por: por?.nome ?? por?.id ?? null, canal }, { em: agora });
    await this.prisma.comercialDecisao.updateMany({ where: { id }, data: { eventoDecisaoId: ev.eventoId } });

    const resolvida: DecisaoResolvida = {
      id,
      orgId,
      leadId: d.leadId,
      tipo: d.tipo as ComercialTipoDeDecisao,
      escolha,
      como: 'tomada',
      por: por ? { id: por.id, nome: por.nome } : null,
      canal,
      dados,
      motivo: motivo ?? null,
    };
    return { ...resolvida, resultados: await this.reagir(resolvida) };
  }

  /** O relógio: toda decisão aberta com prazo vencido vira `expirada` com o padrão aplicado. */
  async expirarVencidas(orgId: string, agora: Date): Promise<number> {
    const vencidas = await this.prisma.comercialDecisao.findMany({
      where: { orgId, estado: 'aberta', expiraEm: { lte: agora } },
      orderBy: { expiraEm: 'asc' },
      take: 100,
    });
    let n = 0;
    for (const d of vencidas) {
      const r = await this.prisma.comercialDecisao.updateMany({
        where: { id: d.id, orgId, estado: 'aberta' },
        data: { estado: 'expirada', escolha: d.padrao, decididoPor: null, decididoEm: agora, canal: 'relogio' },
      });
      if (r.count === 0) continue;
      n++;
      const ev = await this.fio.registrar(orgId, d.leadId, 'decisao.expirada', d.id, { decisaoId: d.id, tipo: d.tipo, padraoAplicado: d.padrao }, { em: agora });
      await this.prisma.comercialDecisao.updateMany({ where: { id: d.id }, data: { eventoDecisaoId: ev.eventoId } });
      await this.reagir({
        id: d.id,
        orgId,
        leadId: d.leadId,
        tipo: d.tipo as ComercialTipoDeDecisao,
        escolha: d.padrao,
        como: 'expirada',
        por: null,
        canal: 'relogio',
        dados: (d.dados ?? {}) as Record<string, unknown>,
        motivo: 'prazo vencido: padrão aplicado',
      });
    }
    return n;
  }

  async listar(orgId: string, estado?: ComercialEstadoDeDecisao): Promise<DecisaoNaFila[]> {
    const linhas = await this.prisma.comercialDecisao.findMany({
      where: { orgId, ...(estado ? { estado } : {}) },
      orderBy: [{ estado: 'asc' }, { expiraEm: 'asc' }],
      include: { lead: { select: { name: true } } },
      take: 200,
    });
    return linhas.map((d) => ({
      id: d.id,
      leadId: d.leadId,
      leadNome: d.lead.name,
      tipo: d.tipo as ComercialTipoDeDecisao,
      titulo: d.titulo,
      contexto: d.contexto,
      opcoes: (d.opcoes as unknown as OpcaoDeDecisao[]) ?? [],
      padrao: d.padrao,
      expiraEm: d.expiraEm.toISOString(),
      criadaEm: d.criadoEm.toISOString(),
      estado: d.estado as ComercialEstadoDeDecisao,
      escolha: d.escolha,
      decididoPor: d.decididoPor,
      canal: (d.canal as ComercialCanalDeDecisao | null) ?? null,
    }));
  }

  /** Tela 03: as decisões abertas, o que rodou sozinho hoje e os contadores. */
  async fila(orgId: string, agora = new Date()): Promise<FilaDeDecisoes> {
    const inicioDoDia = inicioDoDiaEmSaoPaulo(agora);
    const [decisoes, acoes, vivos, erros, eventos] = await Promise.all([
      this.listar(orgId, 'aberta'),
      this.prisma.comercialReacao.count({ where: { orgId, estado: 'ok', criadoEm: { gte: inicioDoDia } } }),
      this.prisma.comercialFicha.count({ where: { orgId, etapa: { in: COMERCIAL_ETAPAS.filter((e) => e !== 'fechado') } } }),
      this.prisma.comercialReacao.findMany({ where: { orgId, estado: 'erro' }, distinct: ['reacao'], select: { reacao: true } }),
      this.prisma.leadEvent.findMany({
        where: { orgId, occurredAt: { gte: inicioDoDia }, type: { notIn: ['decisao.tomada', 'saida.registrada', 'veto.registrado'] } },
        orderBy: { occurredAt: 'desc' },
        take: 30,
        select: { leadId: true, type: true, payload: true, occurredAt: true },
      }),
    ]);
    const rodouSozinhoHoje = eventos
      .map((e) => ({ e, r: resumoDoEvento(e.type, e.payload) }))
      .filter(({ r }) => r.fonte !== 'pessoa')
      .map(({ e, r }) => ({ em: e.occurredAt.toISOString(), fonte: r.fonte, resumo: r.resumo, leadId: e.leadId }));
    return {
      resumo: { decisoes: decisoes.length, acoesAutomaticasHoje: acoes, leadsVivos: vivos, automacoesComErro: erros.length },
      decisoes,
      rodouSozinhoHoje,
    };
  }

  private async prazoPadrao(orgId: string, agora: Date): Promise<Date> {
    const cfg = await this.config.ler(orgId);
    if (cfg.decisaoExpiraHoras == null) return SEM_PRAZO;
    return new Date(agora.getTime() + cfg.decisaoExpiraHoras * 3_600_000);
  }

  private async reagir(d: DecisaoResolvida): Promise<unknown[]> {
    const resultados: unknown[] = [];
    for (const { nome, fn } of this.registro.doTipo(d.tipo)) {
      try {
        resultados.push(await fn(d));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log.warn(`reação "${nome}" à decisão ${d.tipo} (${d.id}) falhou: ${msg}`);
        resultados.push({ reacao: nome, erro: msg });
      }
    }
    return resultados;
  }
}

/** Meia-noite de São Paulo (UTC-3, sem horário de verão desde 2019) do dia de `agora`. */
export function inicioDoDiaEmSaoPaulo(agora: Date): Date {
  const sp = new Date(agora.getTime() - 3 * 3_600_000);
  return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate()) + 3 * 3_600_000);
}
