import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ContextKind, ContextSource } from '@prisma/client';
import {
  PAUTA_TETO_DE_POSTS_DO_DOSSIE,
  type PautaAnaliseDoConcorrente,
  type PautaDossieDoConcorrente,
  type PautaPerfilPlataforma,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService } from '../memory/memoria.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { SAIDA_DA_GERACAO_LONGA } from './saida-da-geracao';
import { DossieInvalidoError, analiseDoPerfil, entradaDoDossie, lerDossieDaIa, SYSTEM_DOSSIE } from './concorrentes-da-pauta';
import { plataformaDoPerfil, procedenciaDoPerfil } from './perfil-da-pauta';
import { umaPorVez } from './uma-por-vez';

/** A nota que guarda o dossiê de um perfil. Chave presa ao prefixo, como a voz. */
export function chaveDoDossie(fonteId: string): string {
  return `pauta.concorrente.${fonteId}`;
}

/*
 * CONCORRENTES COM NÚMEROS (MK2). A análise sai das capturas que a fonte
 * `perfil` já grava desde a MC4 — nenhuma tabela nova, nenhuma cópia do número
 * que envelheceria. O dossiê é nota da memória, escrita pelo `MemoriaService`
 * (ADR-011), como o perfil de voz: saída de IA com versão e histórico.
 */
@Injectable()
export class ConcorrentesService {
  private readonly log = new Logger('ConcorrentesService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly memoria: MemoriaService,
  ) {}

  /** As fontes de perfil da empresa, com o tamanho da amostra de cada uma. */
  async listar(orgId: string) {
    const fontes = await this.prisma.pautaFonte.findMany({
      where: { orgId, tipo: 'perfil' },
      select: { id: true, nome: true, handle: true, plataforma: true, ativo: true, ultimaLeitura: true },
      orderBy: { nome: 'asc' },
    });
    const contagem = await this.prisma.pautaCaptura.groupBy({
      by: ['fonteId'],
      where: { orgId, fonteId: { in: fontes.map((f) => f.id) } },
      _count: { _all: true },
    });
    const porFonte = new Map(contagem.map((c) => [c.fonteId, c._count._all]));
    return fontes.map((f) => ({
      id: f.id,
      nome: f.nome,
      handle: f.handle ?? '',
      plataforma: f.plataforma ?? 'instagram',
      ativo: f.ativo,
      ultimaLeitura: f.ultimaLeitura,
      posts: porFonte.get(f.id) ?? 0,
      temDossie: false,
    }));
  }

  /** A análise de um perfil: mediana do próprio perfil e índice de cada post. */
  async analise(orgId: string, fonteId: string): Promise<PautaAnaliseDoConcorrente> {
    const fonte = await this.prisma.pautaFonte.findFirst({
      where: { id: fonteId, orgId, tipo: 'perfil' },
      select: { id: true, handle: true, plataforma: true },
    });
    if (!fonte) throw new NotFoundException('Perfil não encontrado');

    const capturas = await this.prisma.pautaCaptura.findMany({
      where: { orgId, fonteId },
      select: { id: true, url: true, titulo: true, bruto: true, capturadoEm: true },
      orderBy: { capturadoEm: 'desc' },
      take: 200,
    });

    const plataforma: PautaPerfilPlataforma = plataformaDoPerfil(fonte.plataforma ?? 'instagram') ?? 'instagram';
    const brutos = capturas
      .filter((c) => c.url)
      .map((c) => {
        const bruto = (c.bruto ?? {}) as Record<string, unknown>;
        const proc = procedenciaDoPerfil(bruto);
        return {
          capturaId: c.id,
          url: c.url as string,
          titulo: c.titulo ?? '',
          // A legenda é a que a captura guardou do post, não o `resumo` do RSS.
          legenda: proc?.texto ?? String(bruto.resumo ?? ''),
          publicadoEm: typeof bruto.publicadoEm === 'string' ? bruto.publicadoEm : c.capturadoEm,
          item: bruto,
        };
      });

    return analiseDoPerfil(fonte.id, plataforma, (fonte.handle ?? '').replace(/^@/, ''), brutos);
  }

  /** O dossiê gravado, ou nulo. */
  async dossie(orgId: string, fonteId: string): Promise<PautaDossieDoConcorrente | null> {
    try {
      const nota = await this.memoria.porChave(orgId, chaveDoDossie(fonteId));
      if (!nota || nota.arquivadoEm || !nota.body.trim()) return null;
      return JSON.parse(nota.body) as PautaDossieDoConcorrente;
    } catch (e) {
      this.log.warn(`dossiê de ${fonteId}: ${(e as Error).message}`);
      return null;
    }
  }

  gerarDossie(orgId: string, actorId: string, fonteId: string): Promise<PautaDossieDoConcorrente> {
    return umaPorVez(`pauta-dossie:${orgId}:${fonteId}`, 'O dossiê deste perfil', () =>
      this.gerarDossieAgora(orgId, actorId, fonteId),
    );
  }

  private async gerarDossieAgora(orgId: string, actorId: string, fonteId: string): Promise<PautaDossieDoConcorrente> {
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }
    const analise = await this.analise(orgId, fonteId);
    if (!analise.postsContados) {
      throw new ServiceUnavailableException('Este perfil ainda não tem post capturado: rode a coleta da fonte antes.');
    }

    const { texto, achados } = entradaDoDossie(analise);
    const saida = await this.llm.complete({
      system: SYSTEM_DOSSIE,
      user: texto,
      // De quem é o gasto (RF-G-05), como nas outras chamadas da pauta.
      orgId,
      maxTokens: SAIDA_DA_GERACAO_LONGA,
    });

    let dossie: PautaDossieDoConcorrente;
    try {
      dossie = lerDossieDaIa(saida, `${this.llm.name}/${this.llm.model}`);
    } catch (err) {
      if (err instanceof DossieInvalidoError) {
        this.log.warn(`dossiê de ${fonteId}: ${err.message}`);
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }

    const chave = chaveDoDossie(fonteId);
    const corpo = JSON.stringify(dossie, null, 2);
    const existente = await this.memoria.porChave(orgId, chave);
    const dados = {
      kind: ContextKind.definicao,
      title: `Concorrente @${analise.handle} (${analise.plataforma})`,
      body: corpo,
      sourceType: ContextSource.promocao,
      sourceRef: `pauta.concorrente · ${analise.postsContados} posts · modelo ${this.llm.name}/${this.llm.model}`,
      motivo: 'dossiê de concorrente gerado pela IA (MK2)',
    };
    const nota = existente
      ? await this.memoria.alterar(orgId, existente.id, dados)
      : await this.memoria.criar(orgId, { chave, tags: ['pauta', 'concorrente'], ...dados });

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.dossie_gerado',
      entityType: 'context_item',
      entityId: nota.id,
      after: {
        fonteId,
        handle: analise.handle,
        posts: Math.min(analise.postsContados, PAUTA_TETO_DE_POSTS_DO_DOSSIE),
        metricaDeReferencia: analise.metricaDeReferencia,
        // O que a neutralização tirou das legendas: fica no RASTRO porque é
        // sinal de perfil que tenta escrever no nosso prompt.
        achados: achados.length,
        provider: this.llm.name,
        model: this.llm.model,
      },
    });
    return dossie;
  }
}
