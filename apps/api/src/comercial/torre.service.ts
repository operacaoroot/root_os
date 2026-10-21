import { Inject, Injectable, Optional } from '@nestjs/common';
import { COMERCIAL_AUTOMACOES, COMERCIAL_ROTULO_DA_AUTOMACAO, type ComercialAutomacao, type TorreDasAutomacoes } from '@mktos/shared';

import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { TetoDeCustoIaService } from '../llm/teto-diario.service';
import { PrismaService } from '../prisma/prisma.service';
import { AUTONOMIA_VIGENTE, TETO_DA_REGUA, degrauSugerido, nivelDe, tarefasDaAutomacao } from './autonomia';
import { ConfigComercialService } from './config.service';
import { RelatorioDaSemanaService } from './relatorio-da-semana.service';
import { PREMISSA_DA_AUTOMACAO, VigiaService } from './vigia.service';

/*
 * A TORRE DAS AUTOMAÇÕES (lane E, fase 2, 13/10/2026). Tela 12.
 *
 * Só lê. Cada linha é uma automação de `COMERCIAL_AUTOMACOES`, com:
 *   · autonomia: a gravada na config, senão a vigente pela régua;
 *   · última vez: o fato mais recente que a automação produziu (os tipos em
 *     `FATOS_DA_AUTOMACAO`) ou a última reação dela que rodou (pulo de A0 não
 *     conta); o relator e o vigia, pela nota que gravaram;
 *   · acerto em 30 dias: das reações da automação nos últimos 30 dias, as que
 *     terminaram sem erro sobre as que terminaram (as puladas por A0 e as em
 *     curso ficam fora). Automação sem reação no período = `null`: sem dado não
 *     há taxa. É uma medida de "rodou sem falhar", a única que o fio sustenta
 *     hoje; o acerto de conteúdo (diagnóstico aprovado sem refazer, proposta
 *     aceita sem ajuste) é [a decidir] pela mesa;
 *   · premissa: a da tela 12, com o resultado da última passagem do vigia;
 *   · próximo degrau: a sugestão de subir um degrau depois de um mês sem erro,
 *     até o teto da régua (`degrauSugerido`). Só sugere: quem sobe é gente.
 *
 * O custo de IA do dia vem do livro-caixa do teto (`TetoDeCustoIaService`), em
 * dólar; sem câmbio decidido, o valor em reais fica nulo quando há gasto. Com o
 * provedor stub ou ponte da homologação o custo é zero e DESCONHECIDO (a ponte
 * chama o `claude -p` da máquina, cujo gasto o OS não vê).
 */

const DIA_MS = 86_400_000;

/** Os fatos que cada automação produz no fio (para "última vez"). */
export const FATOS_DA_AUTOMACAO: Record<ComercialAutomacao, string[]> = {
  qualificador: ['lead.pontuado', 'dono.atribuido'],
  agendador: ['agenda.confirmada'],
  leitor_de_ata: ['diagnostico.pronto'],
  construtor_de_proposta: ['proposta.publicada'],
  revisor_de_proposta: ['proposta.publicada'],
  // Responder na sala não grava fato no fio: a última vez vem da reação.
  assistente_da_proposta: [],
  fupeiro: ['followup.enviado'],
  assinador: ['contrato.gerado'],
  cobrador: ['cobranca.criada', 'parcela.vence'],
  fechador: ['fechamento.escrita', 'cliente.ativo'],
  relator: [],
  vigia: ['vigia.premissa'],
};

const max = (...ds: (Date | null | undefined)[]): Date | null =>
  ds.reduce<Date | null>((m, d) => (d && (!m || d.getTime() > m.getTime()) ? d : m), null);

@Injectable()
export class TorreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigComercialService,
    private readonly vigia: VigiaService,
    @Optional() private readonly teto?: TetoDeCustoIaService,
    @Optional() @Inject(LLM_PROVIDER) private readonly llm?: LlmProvider,
    @Optional() private readonly relatorios?: RelatorioDaSemanaService,
  ) {}

  async torre(orgId: string, agora: Date = new Date()): Promise<TorreDasAutomacoes> {
    const cfg = await this.config.ler(orgId);
    const passagem = await this.vigia.ultimaPassagem(orgId);
    const desde = new Date(agora.getTime() - 30 * DIA_MS);

    const reacoes = await this.prisma.comercialReacao.findMany({
      where: { orgId, criadoEm: { gte: desde } },
      select: { reacao: true, estado: true, resultado: true, criadoEm: true },
    });

    const automacoes = [];
    for (const chave of COMERCIAL_AUTOMACOES) {
      const tarefas = new Set(tarefasDaAutomacao(chave));
      const minhas = reacoes.filter((r) => tarefas.has(r.reacao) && !(r.resultado && typeof r.resultado === 'object' && (r.resultado as { pulada?: unknown }).pulada));
      const terminadas = minhas.filter((r) => r.estado === 'ok' || r.estado === 'erro');
      const boas = terminadas.filter((r) => r.estado === 'ok');
      const acerto = terminadas.length ? Math.round((boas.length / terminadas.length) * 100) / 100 : null;

      const tipos = FATOS_DA_AUTOMACAO[chave];
      const ultimoFato = tipos.length
        ? await this.prisma.leadEvent.findFirst({ where: { lead: { orgId }, type: { in: tipos } }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } })
        : null;
      const ultimaReacao = boas.reduce<Date | null>((m, r) => max(m, r.criadoEm), null);
      let ultima = max(ultimoFato?.occurredAt, ultimaReacao);
      if (chave === 'vigia' && passagem) ultima = max(ultima, new Date(passagem.em));
      if (chave === 'relator' && this.relatorios) ultima = max(ultima, await this.relatorios.ultimaGeracaoEm(orgId, agora));

      const daPassagem = passagem?.premissas.find((p) => p.automacao === chave) ?? null;
      const primeira = tarefas.size
        ? await this.prisma.comercialReacao.findFirst({ where: { orgId, reacao: { in: [...tarefas] }, estado: 'ok' }, orderBy: { criadoEm: 'asc' }, select: { criadoEm: true } })
        : null;
      const nivel = nivelDe(cfg.autonomia, chave);
      automacoes.push({
        chave,
        rotulo: COMERCIAL_ROTULO_DA_AUTOMACAO[chave],
        autonomia: nivel,
        autonomiaVigente: AUTONOMIA_VIGENTE[chave],
        autonomiaGravada: cfg.autonomia[chave] !== undefined,
        ultimaVezEm: ultima?.toISOString() ?? null,
        acerto30Dias: acerto,
        passagens30Dias: terminadas.length,
        tetoDaRegua: TETO_DA_REGUA[chave],
        proximoDegrau: degrauSugerido(nivel, TETO_DA_REGUA[chave], {
          passagens30Dias: terminadas.length,
          erros30Dias: terminadas.length - boas.length,
          primeiraPassagemEm: primeira?.criadoEm ?? null,
          agora,
        }),
        premissa: PREMISSA_DA_AUTOMACAO[chave],
        premissaOk: daPassagem ? daPassagem.ok : null,
      });
    }

    const custo = await this.custoDoDia(orgId);
    return {
      vigia: {
        ultimaPassagemEm: passagem?.em ?? null,
        premissasConferidas: passagem?.conferidas ?? 0,
        premissasQuebradas: passagem?.quebradas ?? 0,
        premissas: passagem?.premissas ?? [],
        // CO-11 (rodada dos agentes): as três linhas do topo da última passagem.
        resumo: passagem?.resumo ?? null,
      },
      ...custo,
      automacoes,
    };
  }

  private async custoDoDia(orgId: string): Promise<Pick<TorreDasAutomacoes, 'custoDeIaHojeCentavos' | 'custoDesconhecido' | 'custoDeIaHojeUsd' | 'provedorDeIa'>> {
    const provedor = this.llm?.name ?? 'desconhecido';
    if (provedor === 'stub' || provedor === 'ponte') {
      return { custoDeIaHojeCentavos: 0, custoDesconhecido: true, custoDeIaHojeUsd: 0, provedorDeIa: provedor };
    }
    const consumo = this.teto ? await this.teto.consumo(orgId).catch(() => null) : null;
    if (!consumo) {
      // Empresa sem teto configurado: o livro-caixa não é escrito e o custo do dia não é medido.
      return { custoDeIaHojeCentavos: null, custoDesconhecido: true, custoDeIaHojeUsd: null, provedorDeIa: provedor };
    }
    const usd = Math.round((consumo.gastoUsd + consumo.gastoEstimadoUsd) * 10_000) / 10_000;
    return {
      // Sem câmbio decidido não há reais: zero é zero, o resto fica nulo com o dólar ao lado.
      custoDeIaHojeCentavos: usd === 0 ? 0 : null,
      custoDesconhecido: consumo.gastoEstimadoUsd > 0 || consumo.chamadasSemPreco > 0,
      custoDeIaHojeUsd: usd,
      provedorDeIa: provedor,
    };
  }
}
