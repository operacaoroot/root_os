import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ContextKind, ContextSource } from '@prisma/client';
import {
  chaveDaEstrategia,
  mesDaChaveDaEstrategia,
  type PautaEstrategiaPainel,
  type PautaEstrategiaSalvarInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService } from '../memory/memoria.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { SAIDA_DA_GERACAO_LONGA } from './saida-da-geracao';
import { MarcaService } from './marca.service';
import { ConcorrentesService } from './concorrentes.service';
import {
  EstrategiaInvalidaError,
  SYSTEM_ESTRATEGIA,
  avisosDaEstrategia,
  entradaDaEstrategia,
  lerEstrategiaDaIa,
  montarEstrategia,
} from './estrategia-da-pauta';
import { umaPorVez } from './uma-por-vez';

/** O mês anterior a `AAAA-MM`. */
export function mesAnterior(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

/** O intervalo [início, fim) de um mês, em UTC. */
export function janelaDoMes(mes: string): { de: Date; ate: Date } {
  const [a, m] = mes.split('-').map(Number);
  return { de: new Date(Date.UTC(a, m - 1, 1)), ate: new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 1)) };
}

/*
 * A ESTRATÉGIA DO MÊS (MK4). Um documento por mês, nota da memória
 * (`pauta.estrategia.AAAA-MM`), escrita só pelo `MemoriaService` — caminho da
 * ADR-011, com versão e RASTRO. A IA propõe; a pessoa edita e é dela a última
 * palavra.
 */
@Injectable()
export class EstrategiaService {
  private readonly log = new Logger('EstrategiaService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly memoria: MemoriaService,
    private readonly marcas: MarcaService,
    private readonly concorrentes: ConcorrentesService,
  ) {}

  /** Os meses que já têm documento, do mais novo para o mais velho. */
  private async meses(orgId: string): Promise<string[]> {
    try {
      const { itens } = await this.memoria.listar(orgId, { kind: ContextKind.definicao });
      return itens
        .map((n) => mesDaChaveDaEstrategia(n.chave))
        .filter((m): m is string => Boolean(m))
        .sort()
        .reverse();
    } catch (e) {
      this.log.warn(`meses da estratégia de ${orgId}: ${(e as Error).message}`);
      return [];
    }
  }

  async painel(orgId: string, mes: string): Promise<PautaEstrategiaPainel> {
    const [nota, meses, pilares] = await Promise.all([
      this.memoria.porChave(orgId, chaveDaEstrategia(mes)),
      this.meses(orgId),
      this.marcas.pilares(orgId),
    ]);
    const documento = nota && !nota.arquivadoEm ? nota.body : '';
    const avisos = documento ? avisosDaEstrategia(documento) : [];
    if (!pilares.length) {
      avisos.push('Sem pilar cadastrado, a IA não tem o que priorizar: escreva os pilares na tela de Marca.');
    }
    return {
      mes,
      documento,
      versao: nota?.versao ?? null,
      atualizadoEm: nota ? new Date(nota.atualizadoEm).toISOString() : null,
      origem: nota?.sourceType ?? null,
      meses,
      avisos,
      iaConfigurada: this.llm.configured,
    };
  }

  /** A edição à mão. `versao` velha é outra aba mexendo junto (409). */
  async salvar(
    orgId: string,
    actorId: string,
    mes: string,
    entrada: PautaEstrategiaSalvarInput,
  ): Promise<PautaEstrategiaPainel> {
    const documento = entrada.documento.replace(/\r\n?/g, '\n').trim();
    const nota = await this.gravar(orgId, mes, documento, ContextSource.operador, 'estratégia do mês editada à mão (MK4)', entrada.versao);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.estrategia_salva',
      entityType: 'context_item',
      entityId: nota.id,
      after: { mes, versao: nota.versao, caracteres: documento.length },
    });
    return this.painel(orgId, mes);
  }

  gerar(orgId: string, actorId: string, mes: string): Promise<PautaEstrategiaPainel> {
    return umaPorVez(`pauta-estrategia:${orgId}:${mes}`, 'A estratégia deste mês', () =>
      this.gerarAgora(orgId, actorId, mes),
    );
  }

  private async gerarAgora(orgId: string, actorId: string, mes: string): Promise<PautaEstrategiaPainel> {
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }
    const pilares = await this.marcas.pilares(orgId);
    if (!pilares.length) {
      // Priorizar é escolher entre pilares. Sem lista, o modelo inventaria a
      // lista e a estratégia deixaria de casar com qualquer peça.
      throw new BadRequestException(
        'Sem pilar cadastrado não há o que priorizar: escreva os pilares na tela de Marca antes.',
      );
    }

    const [marca, dossies, publicado] = await Promise.all([
      this.marcas.bloco(orgId),
      this.dossies(orgId),
      this.publicadoNoMes(orgId, mesAnterior(mes)),
    ]);

    const saida = await this.llm.complete({
      system: SYSTEM_ESTRATEGIA,
      user: entradaDaEstrategia({ mes, marca, pilares, dossies, publicado }),
      // De quem é o gasto (RF-G-05), como nas outras chamadas da pauta.
      orgId,
      maxTokens: SAIDA_DA_GERACAO_LONGA,
    });

    let documento: string;
    try {
      documento = montarEstrategia(mes, lerEstrategiaDaIa(saida, pilares));
    } catch (err) {
      if (err instanceof EstrategiaInvalidaError) {
        this.log.warn(`estratégia de ${mes} em ${orgId}: ${err.message}`);
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }

    const nota = await this.gravar(
      orgId,
      mes,
      documento,
      ContextSource.promocao,
      'estratégia do mês proposta pela IA (MK4)',
    );
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.estrategia_gerada',
      entityType: 'context_item',
      entityId: nota.id,
      after: {
        mes,
        versao: nota.versao,
        pilares: pilares.length,
        dossies: dossies.length,
        publicadoNoMesAnterior: publicado.length,
        provider: this.llm.name,
        model: this.llm.model,
      },
    });
    return this.painel(orgId, mes);
  }

  /** O que rende em cada perfil observado que já tem dossiê. */
  private async dossies(orgId: string) {
    const perfis = await this.concorrentes.listar(orgId);
    const lidos = await Promise.all(
      perfis.map(async (p) => {
        const d = await this.concorrentes.dossie(orgId, p.id);
        return d ? { handle: p.handle, oQueRende: d.oQueRende, oQueAproveitar: d.oQueAproveitar } : null;
      }),
    );
    return lidos.filter((d): d is NonNullable<typeof d> => Boolean(d));
  }

  private async publicadoNoMes(orgId: string, mes: string) {
    const { de, ate } = janelaDoMes(mes);
    const pecas = await this.prisma.pautaPeca.findMany({
      where: { orgId, status: 'publicada', publicadaEm: { gte: de, lt: ate } },
      select: { titulo: true, formato: true, publicadaEm: true },
      orderBy: { publicadaEm: 'asc' },
      take: 60,
    });
    return pecas.map((p) => ({
      titulo: p.titulo,
      formato: p.formato,
      em: p.publicadaEm ? p.publicadaEm.toISOString() : null,
    }));
  }

  private async gravar(
    orgId: string,
    mes: string,
    documento: string,
    sourceType: ContextSource,
    motivo: string,
    versaoEsperada?: number,
  ) {
    const chave = chaveDaEstrategia(mes);
    const dados = {
      kind: ContextKind.definicao,
      title: `Estratégia de ${mes}`,
      body: documento,
      sourceType,
      sourceRef: `pauta.estrategia · ${mes}`,
      motivo,
    };
    const existente = await this.memoria.porChave(orgId, chave);
    if (!existente) return this.memoria.criar(orgId, { chave, tags: ['pauta', 'estrategia'], ...dados });
    let nota = await this.memoria.alterar(orgId, existente.id, { ...dados, versaoEsperada });
    if (nota.arquivadoEm) nota = await this.memoria.restaurar(orgId, nota.id, 'a estratégia do mês voltou a valer');
    return nota;
  }
}
