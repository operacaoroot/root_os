import { Injectable, Logger, Optional } from '@nestjs/common';

import { estimarCustoUsd, tamanhoDeTexto } from './estimativa';
import { GastoPorFuncaoService } from './gasto-por-funcao.service';
import { custoUsd } from './preco';
import { TetoDeCustoIaService, type ReservaDeCusto } from './teto-diario.service';

/*
 * ============================================================================
 * O GASTO QUE NÃO É CONVERSA, DENTRO DO TETO (rodada dos agentes, 21/10/2026, A1)
 * ============================================================================
 *
 * A vetorização (vault e acervo da pauta) e a transcrição de áudio chamam a
 * OpenAI por fora do `LlmProvider`, porque ele só sabe conversar. Até aqui esse
 * gasto era invisível: não passava pelo teto por empresa e por dia, não entrava
 * no livro de custo e não tinha dono. Medido pelo revisor da onda 10, só a
 * reindexação do vault custava na ordem de US$ 50 a 60 por mês.
 *
 * Este medidor dá a esse gasto a MESMA regra da conversa (`provider-com-teto.ts`):
 *   1. reservar ANTES (a recusa do teto acontece aqui, e a chamada não sai);
 *   2. chamar;
 *   3. liquidar pelo custo que o fornecedor contou, ou soltar se falhou;
 *   4. somar no livro por função (`GastoPorFuncaoService`).
 *
 * O preço vem de `preco.ts` (`text-embedding-3-small`, `gpt-4o-transcribe`).
 * Quem fala com o fornecedor continua sendo quem falava (`obsidian.service.ts`,
 * `pauta.service.ts`, `transcricao.provider.ts`): o medidor só envolve.
 *
 * SEM EMPRESA, passa sem teto e avisa no log (a mesma rede de proteção do
 * envelope da conversa): não dá para cobrar de quem não se sabe quem é.
 */

/**
 * Os tokens que o fornecedor de embedding contou (`usage.prompt_tokens`, ou
 * `total_tokens`), ou `null` quando a resposta não diz. É o número da liquidação.
 */
export function tokensDaRespostaDeEmbedding(corpo: unknown): number | null {
  const u = (corpo as { usage?: { prompt_tokens?: unknown; total_tokens?: unknown } } | null)?.usage;
  const bruto = u?.prompt_tokens ?? u?.total_tokens;
  if (bruto === undefined || bruto === null) return null;
  const n = Number(bruto);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

@Injectable()
export class MedidorDeGastoExterno {
  private readonly log = new Logger('MedidorDeGastoExterno');
  private semEmpresa = 0;

  constructor(
    private readonly teto: TetoDeCustoIaService,
    @Optional() private readonly gasto?: GastoPorFuncaoService,
  ) {}

  /**
   * Uma chamada de VETORIZAÇÃO. A reserva é pelo tamanho dos textos (só entrada:
   * embedding não tem saída); a liquidação é pelos tokens que o fornecedor contou
   * (`usage.prompt_tokens`), ou pela estimativa quando ele não contou.
   *
   * @throws TetoDiarioEstouradoError quando o dia não comporta: a chamada não sai.
   */
  async vetorizacao<T>(
    p: { orgId?: string | null; funcao: string; modelo: string; textos: readonly string[] },
    chamar: () => Promise<{ resultado: T; tokens: number | null }>,
  ): Promise<T> {
    const orgId = this.empresa(p.orgId, 'vetorização');
    const entrada = tamanhoDeTexto(...p.textos);
    const reserva = orgId ? await this.teto.reservar({ orgId, modelo: p.modelo, entrada, tokensSaida: 0 }) : null;

    let r: { resultado: T; tokens: number | null } | null = null;
    try {
      r = await chamar();
      return r.resultado;
    } finally {
      const medido =
        r && typeof r.tokens === 'number' && Number.isFinite(r.tokens) && r.tokens >= 0
          ? custoUsd(p.modelo, { entrada: r.tokens, saida: 0 })
          : null;
      const estimado = r && !medido ? estimarCustoUsd(p.modelo, { entrada, tokensSaida: 0 }).usd : 0;
      await this.encerrar(reserva, r === null ? { falhou: true } : medido ? { real: medido } : { observado: estimado });
      if (orgId && r) {
        await this.gasto?.registrar({
          orgId,
          funcao: p.funcao,
          modelo: p.modelo,
          tipo: 'vetorizacao',
          gastoUsd: medido?.custoUsd ?? 0,
          estimadoUsd: estimado,
          naoMedida: medido ? !medido.custoEstimado : false,
        });
      }
    }
  }

  /**
   * Uma TRANSCRIÇÃO, cobrada por minuto de áudio. A reserva é pelo valor estimado
   * do minuto; a liquidação, pelo que a chamada devolver (`custoUsd`, medido
   * quando o fornecedor contou tokens ou segundos, estimado quando não).
   *
   * @throws TetoDiarioEstouradoError quando o dia não comporta: a chamada não sai.
   */
  async transcricao<T>(
    p: { orgId?: string | null; funcao: string; modelo: string; usdEstimado: number },
    chamar: () => Promise<{ resultado: T; custoUsd: number; medido: boolean }>,
  ): Promise<T> {
    const orgId = this.empresa(p.orgId, 'transcrição');
    const reserva = orgId ? await this.teto.reservarValor({ orgId, modelo: p.modelo, usd: p.usdEstimado }) : null;

    let r: { resultado: T; custoUsd: number; medido: boolean } | null = null;
    try {
      r = await chamar();
      return r.resultado;
    } finally {
      await this.encerrar(
        reserva,
        r === null
          ? { falhou: true }
          : r.medido
            ? { real: { custoUsd: r.custoUsd, custoEstimado: true } }
            : { observado: r.custoUsd },
      );
      if (orgId && r) {
        await this.gasto?.registrar({
          orgId,
          funcao: p.funcao,
          modelo: p.modelo,
          tipo: 'transcricao',
          gastoUsd: r.medido ? r.custoUsd : 0,
          estimadoUsd: r.medido ? 0 : r.custoUsd,
        });
      }
    }
  }

  private empresa(orgId: string | null | undefined, onde: string): string | null {
    const id = orgId?.trim();
    if (id) return id;
    this.semEmpresa += 1;
    if (this.semEmpresa === 1 || this.semEmpresa % 100 === 0) {
      this.log.error(
        `${onde} SEM empresa (${this.semEmpresa}ª vez): o teto de custo por empresa e por dia não se ` +
          'aplica e o gasto não entra em conta nenhuma. Informe a empresa na chamada.',
      );
    }
    return null;
  }

  /** Fecha a reserva sem nunca lançar (mesma regra do envelope da conversa). */
  private async encerrar(
    reserva: ReservaDeCusto | null,
    desfecho: { falhou: true } | { observado: number } | { real: { custoUsd: number; custoEstimado: boolean } },
  ): Promise<void> {
    if (!reserva) return;
    try {
      if ('falhou' in desfecho) await this.teto.soltar(reserva);
      else if ('observado' in desfecho) await this.teto.liquidarPeloObservado(reserva, desfecho.observado);
      else await this.teto.liquidar(reserva, desfecho.real);
    } catch (e) {
      this.log.error(
        `reserva de ${reserva.valorUsd} USD não liquidou em ${reserva.orgId}/${reserva.dia}: ` +
          `${(e as Error).message}. O coletor de reserva presa a solta em até 30 min.`,
      );
    }
  }
}
