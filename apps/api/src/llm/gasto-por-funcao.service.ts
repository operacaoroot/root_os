import { Injectable, Logger } from '@nestjs/common';
import { funcaoPorId, funcaoPorSlug } from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';

/*
 * ============================================================================
 * O GASTO DE IA POR FUNÇÃO (rodada dos agentes, 21/10/2026, A1)
 * ============================================================================
 *
 * A pergunta da tela de Agentes: "quanto esta função me custou este mês?". O
 * teto do dia (`teto-diario.service.ts`) só escreve quando a empresa tem teto, e
 * não sabe de quem é o gasto; o orçamento por agente (`orcamento-de-agente.service.ts`)
 * soma o log de passos, que só existe para sessão de agente do laço. As funções
 * novas (vigia, arquivista, triagem, kit...) chamam o modelo direto, sem sessão.
 *
 * Por isso este livro: UMA linha por empresa, dia (São Paulo), função, agente,
 * modelo e tipo, somada em TODA chamada pelo envelope do modelo
 * (`provider-com-teto.ts`) e pelo medidor de gasto externo (vetorização e
 * transcrição). Escrever é MELHOR ESFORÇO: uma falha aqui nunca derruba nem
 * substitui o resultado da chamada (o dinheiro já foi gasto; o pior desfecho é
 * a tela mostrar menos do que houve, e o log diz).
 *
 * O QUE ELE NÃO É: controle. Quem corta é o teto do dia e o orçamento do agente.
 * Este livro só responde "quanto e de quem".
 */

/** O fuso do dia do livro. O teto da empresa tem fuso próprio; este é de leitura. */
const FUSO_DO_LIVRO = 'America/Sao_Paulo';

export type TipoDoGasto = 'conversa' | 'vetorizacao' | 'transcricao';

export interface LancamentoDeGasto {
  orgId: string;
  funcao?: string | null;
  agentSlug?: string | null;
  modelo: string;
  tipo?: TipoDoGasto;
  /** Custo REAL informado pelo provedor (0 quando não mediu). */
  gastoUsd?: number;
  /** Custo ESTIMADO de quem não devolve uso (o `complete()`). */
  estimadoUsd?: number;
  /** true quando o modelo servido não tem preço: não medido, não zero. */
  naoMedida?: boolean;
  agora?: Date;
}

/** Uma linha do mês, por função (e agente), como a tela de Agentes lê. */
export interface GastoDoMesPorFuncao {
  /** `CO-11`, ou `null` quando a chamada não disse a função. */
  funcao: string | null;
  /** O slug (do cadastro ou do `Agent`), ou `null`. */
  agentSlug: string | null;
  /** O nome no cadastro, quando a função (ou o slug) está lá. */
  nome: string | null;
  chamadas: number;
  /** Custo real somado. */
  gastoUsd: number;
  /** Custo estimado somado (chamadas sem uso devolvido). */
  estimadoUsd: number;
  /** `gastoUsd + estimadoUsd`, para a coluna única da tela. */
  totalUsd: number;
  naoMedidas: number;
  modelos: string[];
  porTipo: Partial<Record<TipoDoGasto, number>>;
  ultimoEm: string | null;
}

export interface GastoDoMes {
  /** `AAAA-MM` em São Paulo. */
  mes: string;
  itens: GastoDoMesPorFuncao[];
  totalUsd: number;
}

function arredondar(v: number): number {
  return Number((Number.isFinite(v) ? v : 0).toFixed(6));
}

/** `AAAA-MM-DD` no fuso do livro. */
export function diaDoLivro(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_DO_LIVRO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

const ID_DE_FUNCAO = /^[A-Z]{2}-\d{2}$/;

/**
 * A função e o slug normalizados: função fora do formato vira vazia (a coluna tem
 * CHECK), e o slug falta? vem da função, e a função falta? vem do slug.
 */
export function quemGastou(p: { funcao?: string | null; agentSlug?: string | null }): {
  funcao: string;
  agentSlug: string;
} {
  const bruta = (p.funcao ?? '').trim().toUpperCase();
  let funcao = ID_DE_FUNCAO.test(bruta) ? bruta : '';
  let agentSlug = (p.agentSlug ?? '').trim();
  if (!agentSlug && funcao) agentSlug = funcaoPorId(funcao)?.slug ?? '';
  if (!funcao && agentSlug) funcao = funcaoPorSlug(agentSlug)?.id ?? '';
  return { funcao, agentSlug };
}

@Injectable()
export class GastoPorFuncaoService {
  private readonly log = new Logger('GastoPorFuncao');
  private falhas = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Soma uma chamada. Melhor esforço: nunca lança (ver o cabeçalho). Uma linha
   * por (empresa, dia, função, agente, modelo, tipo), somada no próprio banco
   * (`ON CONFLICT ... DO UPDATE`), sem ler antes — duas chamadas simultâneas não
   * perdem soma.
   */
  async registrar(l: LancamentoDeGasto): Promise<void> {
    const orgId = l.orgId?.trim();
    if (!orgId) return;
    const { funcao, agentSlug } = quemGastou(l);
    const dia = diaDoLivro(l.agora ?? new Date());
    const tipo: TipoDoGasto = l.tipo ?? 'conversa';
    const gasto = Math.max(arredondar(l.gastoUsd ?? 0), 0);
    const estimado = Math.max(arredondar(l.estimadoUsd ?? 0), 0);
    const naoMedida = l.naoMedida ? 1 : 0;
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "GastoDeIaPorFuncao"
          ("id", "orgId", "dia", "funcao", "agentSlug", "modelo", "tipo",
           "chamadas", "gastoUsd", "estimadoUsd", "naoMedidas", "criadoEm", "atualizadoEm")
        VALUES
          (gen_random_uuid()::text, ${orgId}, ${dia}, ${funcao}, ${agentSlug}, ${l.modelo || 'desconhecido'}, ${tipo},
           1, ${gasto}, ${estimado}, ${naoMedida}, now(), now())
        ON CONFLICT ("orgId", "dia", "funcao", "agentSlug", "modelo", "tipo") DO UPDATE SET
          "chamadas" = "GastoDeIaPorFuncao"."chamadas" + 1,
          "gastoUsd" = "GastoDeIaPorFuncao"."gastoUsd" + EXCLUDED."gastoUsd",
          "estimadoUsd" = "GastoDeIaPorFuncao"."estimadoUsd" + EXCLUDED."estimadoUsd",
          "naoMedidas" = "GastoDeIaPorFuncao"."naoMedidas" + EXCLUDED."naoMedidas",
          "atualizadoEm" = now()
      `;
    } catch (e) {
      this.falhas += 1;
      if (this.falhas === 1 || this.falhas % 100 === 0) {
        this.log.error(
          `o gasto de IA por função não foi somado (${this.falhas}ª falha): ${(e as Error).message}. ` +
            'A chamada aconteceu; a tela de Agentes vai mostrar menos do que houve.',
        );
      }
    }
  }

  /**
   * O GASTO DO MÊS POR FUNÇÃO — a leitura que a tela de Agentes consome (A7).
   *
   * `mes` em `AAAA-MM` (padrão: o mês corrente em São Paulo). Uma consulta,
   * agrupada por função e agente; ordena pelo maior total. Só LÊ.
   */
  async doMes(orgId: string, mes?: string): Promise<GastoDoMes> {
    const alvo = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : diaDoLivro().slice(0, 7);
    const linhas = await this.prisma.$queryRaw<
      Array<{
        funcao: string;
        agentSlug: string;
        modelo: string;
        tipo: TipoDoGasto;
        chamadas: number;
        gastoUsd: number;
        estimadoUsd: number;
        naoMedidas: number;
        ultimoEm: Date | null;
      }>
    >`
      SELECT "funcao", "agentSlug", "modelo", "tipo",
             SUM("chamadas")::int AS "chamadas",
             SUM("gastoUsd")::float8 AS "gastoUsd",
             SUM("estimadoUsd")::float8 AS "estimadoUsd",
             SUM("naoMedidas")::int AS "naoMedidas",
             MAX("atualizadoEm") AS "ultimoEm"
        FROM "GastoDeIaPorFuncao"
       WHERE "orgId" = ${orgId} AND "dia" LIKE ${`${alvo}-%`}
       GROUP BY 1, 2, 3, 4
    `;

    const porChave = new Map<string, GastoDoMesPorFuncao>();
    for (const l of linhas) {
      const chave = `${l.funcao}|${l.agentSlug}`;
      const f = l.funcao ? funcaoPorId(l.funcao) : l.agentSlug ? funcaoPorSlug(l.agentSlug) : undefined;
      const item =
        porChave.get(chave) ??
        ({
          funcao: l.funcao || null,
          agentSlug: l.agentSlug || null,
          nome: f?.nome ?? null,
          chamadas: 0,
          gastoUsd: 0,
          estimadoUsd: 0,
          totalUsd: 0,
          naoMedidas: 0,
          modelos: [],
          porTipo: {},
          ultimoEm: null,
        } satisfies GastoDoMesPorFuncao);
      item.chamadas += Number(l.chamadas);
      item.gastoUsd = arredondar(item.gastoUsd + Number(l.gastoUsd));
      item.estimadoUsd = arredondar(item.estimadoUsd + Number(l.estimadoUsd));
      item.totalUsd = arredondar(item.gastoUsd + item.estimadoUsd);
      item.naoMedidas += Number(l.naoMedidas);
      if (!item.modelos.includes(l.modelo)) item.modelos.push(l.modelo);
      item.porTipo[l.tipo] = arredondar((item.porTipo[l.tipo] ?? 0) + Number(l.gastoUsd) + Number(l.estimadoUsd));
      const em = l.ultimoEm ? l.ultimoEm.toISOString() : null;
      if (em && (!item.ultimoEm || em > item.ultimoEm)) item.ultimoEm = em;
      porChave.set(chave, item);
    }
    const itens = [...porChave.values()].sort((a, b) => b.totalUsd - a.totalUsd);
    return { mes: alvo, itens, totalUsd: arredondar(itens.reduce((s, i) => s + i.totalUsd, 0)) };
  }

  /** Só o mapa `slug → total do mês`, para quem monta a lista de agentes. */
  async totalDoMesPorSlug(orgId: string, mes?: string): Promise<Map<string, number>> {
    const { itens } = await this.doMes(orgId, mes);
    const mapa = new Map<string, number>();
    for (const i of itens) {
      if (!i.agentSlug) continue;
      mapa.set(i.agentSlug, arredondar((mapa.get(i.agentSlug) ?? 0) + i.totalUsd));
    }
    return mapa;
  }
}
