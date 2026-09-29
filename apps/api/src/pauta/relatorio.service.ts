import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ActorType, ContextKind, ContextSource } from '@prisma/client';
import {
  chaveDaEstrategia,
  chaveDoRelatorio,
  mesDaChaveDoRelatorio,
  type PautaRelatorioPainel,
  type PautaRelatorioSalvarInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService } from '../memory/memoria.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { SAIDA_DA_GERACAO_LONGA } from './saida-da-geracao';
import { janelaDoMes } from './estrategia.service';
import {
  RelatorioInvalidoError,
  SYSTEM_RELATORIO,
  entradaDoRelatorio,
  lerRelatorioDaIa,
  montarRelatorio,
  type DadosDoRelatorio,
  type PecaDoMes,
} from './relatorio-da-pauta';
import { umaPorVez } from './uma-por-vez';

/**
 * Por que ainda não há número de desempenho. Sai daqui e não do modelo, e é
 * escrito no relatório em vez de omitido: seção que some esconde a pergunta.
 * A MK5 substitui isto pelo snapshot da conta.
 */
export const SEM_PERFORMANCE =
  'O OS ainda não mede o desempenho da conta: a fatia de performance não entrou e o Instagram não está conectado.';

/** O mês seguinte a `AAAA-MM`. */
export function mesSeguinte(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}

/*
 * O RELATÓRIO DO MÊS (MK6). Nota da memória por mês
 * (`pauta.relatorio.AAAA-MM`), como a estratégia. Número é do sistema,
 * narrativa é da IA.
 */
@Injectable()
export class RelatorioService {
  private readonly log = new Logger('RelatorioService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly memoria: MemoriaService,
  ) {}

  private async meses(orgId: string): Promise<string[]> {
    try {
      const { itens } = await this.memoria.listar(orgId, { kind: ContextKind.definicao });
      return itens
        .map((n) => mesDaChaveDoRelatorio(n.chave))
        .filter((m): m is string => Boolean(m))
        .sort()
        .reverse();
    } catch (e) {
      this.log.warn(`meses do relatório de ${orgId}: ${(e as Error).message}`);
      return [];
    }
  }

  private async pecasDoMes(orgId: string, mes: string): Promise<PecaDoMes[]> {
    const { de, ate } = janelaDoMes(mes);
    const pecas = await this.prisma.pautaPeca.findMany({
      where: { orgId, status: 'publicada', publicadaEm: { gte: de, lt: ate } },
      select: { titulo: true, canal: true, formato: true, publicadaEm: true, urlPublicada: true },
      orderBy: { publicadaEm: 'asc' },
      take: 200,
    });
    return pecas.map((p) => ({
      titulo: p.titulo,
      canal: String(p.canal),
      formato: p.formato,
      publicadaEm: p.publicadaEm ? p.publicadaEm.toISOString() : null,
      urlPublicada: p.urlPublicada,
    }));
  }

  private async documentoDaEstrategia(orgId: string, mes: string): Promise<string> {
    try {
      const n = await this.memoria.porChave(orgId, chaveDaEstrategia(mes));
      return n && !n.arquivadoEm ? n.body : '';
    } catch {
      return '';
    }
  }

  async painel(orgId: string, mes: string): Promise<PautaRelatorioPainel> {
    const [nota, meses, pecas, estrategia] = await Promise.all([
      this.memoria.porChave(orgId, chaveDoRelatorio(mes)),
      this.meses(orgId),
      this.pecasDoMes(orgId, mes),
      this.documentoDaEstrategia(orgId, mes),
    ]);
    const avisos = [SEM_PERFORMANCE];
    if (!estrategia) avisos.push(`Não há estratégia escrita para ${mes}: o relatório sai sem a seção do que valia.`);
    if (!pecas.length) avisos.push(`Nenhuma peça publicada em ${mes}.`);
    return {
      mes,
      documento: nota && !nota.arquivadoEm ? nota.body : '',
      versao: nota?.versao ?? null,
      atualizadoEm: nota ? new Date(nota.atualizadoEm).toISOString() : null,
      origem: nota?.sourceType ?? null,
      meses,
      publicadas: pecas.length,
      avisos,
      iaConfigurada: this.llm.configured,
    };
  }

  async salvar(
    orgId: string,
    actorId: string,
    mes: string,
    entrada: PautaRelatorioSalvarInput,
  ): Promise<PautaRelatorioPainel> {
    const documento = entrada.documento.replace(/\r\n?/g, '\n').trim();
    const nota = await this.gravar(orgId, mes, documento, ContextSource.operador, 'relatório do mês editado à mão (MK6)', entrada.versao);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.relatorio_salvo',
      entityType: 'context_item',
      entityId: nota.id,
      after: { mes, versao: nota.versao, caracteres: documento.length },
    });
    return this.painel(orgId, mes);
  }

  /**
   * `porRotina` só muda quem assina no RASTRO: a rotina mensal é o sistema
   * agindo sozinho, e confundi-la com a pessoa que clicou apagaria quem de fato
   * gastou a IA.
   */
  gerar(orgId: string, actorId: string, mes: string, porRotina = false): Promise<PautaRelatorioPainel> {
    return umaPorVez(`pauta-relatorio:${orgId}:${mes}`, 'O relatório deste mês', () =>
      this.gerarAgora(orgId, actorId, mes, porRotina),
    );
  }

  private async gerarAgora(
    orgId: string,
    actorId: string,
    mes: string,
    porRotina: boolean,
  ): Promise<PautaRelatorioPainel> {
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }
    const [pecas, estrategia, estrategiaSeguinte] = await Promise.all([
      this.pecasDoMes(orgId, mes),
      this.documentoDaEstrategia(orgId, mes),
      this.documentoDaEstrategia(orgId, mesSeguinte(mes)),
    ]);

    const dados: DadosDoRelatorio = {
      mes,
      pecas,
      estrategia,
      estrategiaSeguinte,
      motivoSemPerformance: SEM_PERFORMANCE,
    };

    const saida = await this.llm.complete({
      system: SYSTEM_RELATORIO,
      user: entradaDoRelatorio(dados),
      // De quem é o gasto (RF-G-05), como nas outras chamadas da pauta.
      orgId,
      maxTokens: SAIDA_DA_GERACAO_LONGA,
    });

    let documento: string;
    try {
      documento = montarRelatorio(dados, lerRelatorioDaIa(saida));
    } catch (err) {
      if (err instanceof RelatorioInvalidoError) {
        this.log.warn(`relatório de ${mes} em ${orgId}: ${err.message}`);
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }

    const nota = await this.gravar(orgId, mes, documento, ContextSource.promocao, 'relatório do mês gerado pela IA (MK6)');
    await this.audit.log({
      orgId,
      actorId,
      ...(porRotina ? { actorType: ActorType.system } : {}),
      action: 'pauta.relatorio_gerado',
      entityType: 'context_item',
      entityId: nota.id,
      after: {
        mes,
        versao: nota.versao,
        publicadas: pecas.length,
        comEstrategia: Boolean(estrategia),
        provider: this.llm.name,
        model: this.llm.model,
      },
    });
    return this.painel(orgId, mes);
  }

  private async gravar(
    orgId: string,
    mes: string,
    documento: string,
    sourceType: ContextSource,
    motivo: string,
    versaoEsperada?: number,
  ) {
    const chave = chaveDoRelatorio(mes);
    const dados = {
      kind: ContextKind.definicao,
      title: `Relatório de ${mes}`,
      body: documento,
      sourceType,
      sourceRef: `pauta.relatorio · ${mes}`,
      motivo,
    };
    const existente = await this.memoria.porChave(orgId, chave);
    if (!existente) return this.memoria.criar(orgId, { chave, tags: ['pauta', 'relatorio'], ...dados });
    let nota = await this.memoria.alterar(orgId, existente.id, { ...dados, versaoEsperada });
    if (nota.arquivadoEm) nota = await this.memoria.restaurar(orgId, nota.id, 'o relatório do mês voltou a valer');
    return nota;
  }
}
