import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, ContextKind, ContextSource, type PautaFonte, type PautaCaptura } from '@prisma/client';
import {
  PAUTA_TETO_DE_POSTS_DO_DOSSIE,
  type PautaAnaliseDoConcorrente,
  type PautaDossieDoConcorrente,
  type PautaPerfilPlataforma,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService, type IdentidadeDaDerivacao, type PlanoInternoDeFontesDaDerivacao } from '../memory/memoria.service';
import { contextoAtual } from '../common/contexto-execucao';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { SAIDA_DA_GERACAO_LONGA } from './saida-da-geracao';
import { DossieInvalidoError, analiseDoPerfil, entradaDoDossie, lerDossieDaIa, SYSTEM_DOSSIE } from './concorrentes-da-pauta';
import { plataformaDoPerfil, procedenciaDoPerfil } from './perfil-da-pauta';
import { umaPorVez } from './uma-por-vez';

interface MaterialDoDossie {
  analise: PautaAnaliseDoConcorrente;
  texto: string;
  achados: string[];
  provider: string;
  model: string;
}
interface SelecaoDoDossie { capturaIds: string[] }

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
    const identidade = this.identidadeHumana(orgId, actorId);
    const observada = await this.prisma.$transaction(async (tx) => {
      const observacao = await this.memoria.observarDestinoDaDerivacaoNoTx(tx, orgId, identidade,
        { tipo: 'A4-DOSSIE', fonteId }, this.planoDoDossie(orgId, fonteId));
      const destino = await tx.contextItem.findFirst({ where: { orgId, chave: chaveDoDossie(fonteId) }, select: { id: true } });
      return { ...observacao, criarComTags: !destino };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    const { analise, texto, achados, provider, model } = observada.material;
    if (!analise.postsContados) {
      throw new ServiceUnavailableException('Este perfil ainda não tem post capturado: rode a coleta da fonte antes.');
    }
    const saida = await this.llm.complete({
      system: SYSTEM_DOSSIE,
      user: texto,
      orgId,
      maxTokens: SAIDA_DA_GERACAO_LONGA,
    });

    let dossie: PautaDossieDoConcorrente;
    try {
      dossie = lerDossieDaIa(saida, `${provider}/${model}`);
    } catch (err) {
      if (err instanceof DossieInvalidoError) {
        this.log.warn(`dossiê de ${fonteId}: ${err.message}`);
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }

    const corpo = JSON.stringify(dossie, null, 2);
    const compromisso = await this.prisma.$transaction((tx) =>
      this.memoria.aplicarDerivacaoCondicionadaNoTx(tx, observada.capsula, {
        kind: ContextKind.definicao,
        title: `Concorrente @${analise.handle} (${analise.plataforma})`,
        body: corpo,
        ...(observada.criarComTags ? { tags: ['pauta', 'concorrente'] } : {}),
        sourceType: ContextSource.promocao,
        sourceRef: `pauta.concorrente · ${analise.postsContados} posts · modelo ${provider}/${model}`,
        motivo: 'dossiê de concorrente gerado pela IA (MK2)',
      }), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.dossie_gerado',
      entityType: 'context_item',
      entityId: compromisso.aplicada.itemId,
      after: {
        fonteId,
        versionId: compromisso.aplicada.versionId,
        versao: compromisso.aplicada.versao,
        contentHash: compromisso.aplicada.contentHash,
        handle: analise.handle,
        posts: Math.min(analise.postsContados, PAUTA_TETO_DE_POSTS_DO_DOSSIE),
        metricaDeReferencia: analise.metricaDeReferencia,
        // O que a neutralização tirou das legendas: fica no RASTRO porque é
        // sinal de perfil que tenta escrever no nosso prompt.
        achados: achados.length,
        provider,
        model,
      },
    });
    const entregue = await this.memoria.concluirEntregaDaDerivacao(compromisso);
    if (entregue.aplicada.body !== corpo) throw new ConflictException('O dossiê aplicado não corresponde à geração.');
    // O corpo já foi validado por lerDossieDaIa e conferido como a versão aplicada.
    return JSON.parse(entregue.aplicada.body) as PautaDossieDoConcorrente;
  }

  private identidadeHumana(orgId: string, actorId: string): Extract<IdentidadeDaDerivacao, { tipo: 'humano' }> {
    const c = contextoAtual();
    if (!actorId || c?.orgId !== orgId || c.actorType !== 'user' || c.actorId !== actorId || !c.correlationId) {
      throw new ForbiddenException('Acesso insuficiente.');
    }
    return { tipo: 'humano', actorId, correlationId: c.correlationId };
  }

  private planoDoDossie(orgId: string, fonteId: string): PlanoInternoDeFontesDaDerivacao<MaterialDoDossie, SelecaoDoDossie> {
    return {
      observar: async (tx) => {
        await this.fonteDoDossieNoTx(tx, orgId, fonteId);
        const escolhidas = await tx.pautaCaptura.findMany({ where: { orgId, fonteId },
          select: { id: true }, orderBy: { capturadoEm: 'desc' }, take: 200 });
        const selecao = { capturaIds: escolhidas.map((c) => c.id) };
        return { ...await this.relerDossieNoTx(tx, orgId, fonteId, selecao), selecao };
      },
      reconferir: (tx, _lerFonte, selecao) => this.relerDossieNoTx(tx, orgId, fonteId, selecao),
    };
  }

  private async fonteDoDossieNoTx(tx: Prisma.TransactionClient, orgId: string, fonteId: string): Promise<PautaFonte> {
    await tx.$queryRaw`SELECT id FROM "PautaFonte" WHERE id=${fonteId} AND "orgId"=${orgId} AND tipo='perfil' FOR SHARE`;
    const fonte = await tx.pautaFonte.findFirst({ where: { id: fonteId, orgId, tipo: 'perfil' } });
    if (!fonte) throw new NotFoundException('Perfil não encontrado');
    return fonte;
  }

  private async relerDossieNoTx(tx: Prisma.TransactionClient, orgId: string, fonteId: string, selecao: Readonly<SelecaoDoDossie>) {
    const fonte = await this.fonteDoDossieNoTx(tx, orgId, fonteId);
    const ids = [...selecao.capturaIds];
    if (ids.length) await tx.$queryRaw`SELECT id FROM "PautaCaptura" WHERE "orgId"=${orgId} AND "fonteId"=${fonteId}
      AND id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR SHARE`;
    const rows = ids.length ? await tx.pautaCaptura.findMany({ where: { orgId, fonteId, id: { in: ids } } }) : [];
    if (rows.length !== ids.length) throw new ConflictException('As capturas escolhidas mudaram durante a geração.');
    const porId = new Map(rows.map((c) => [c.id, c]));
    const capturas: PautaCaptura[] = ids.map((id) => {
      const c = porId.get(id);
      if (!c) throw new ConflictException('As capturas escolhidas mudaram durante a geração.');
      return c;
    });
    const plataforma: PautaPerfilPlataforma = plataformaDoPerfil(fonte.plataforma ?? 'instagram') ?? 'instagram';
    const brutos = capturas.flatMap((c) => {
      if (!c.url) return [];
      const bruto = (c.bruto ?? {}) as Record<string, unknown>;
      const proc = procedenciaDoPerfil(bruto);
      return [{ capturaId: c.id, url: c.url, titulo: c.titulo ?? '',
        legenda: proc?.texto ?? String(bruto.resumo ?? ''),
        publicadoEm: typeof bruto.publicadoEm === 'string' ? bruto.publicadoEm : c.capturadoEm,
        item: bruto }];
    });
    const analise = analiseDoPerfil(fonte.id, plataforma, (fonte.handle ?? '').replace(/^@/, ''), brutos);
    const { texto, achados } = entradaDoDossie(analise);
    return {
      material: { analise, texto, achados, provider: this.llm.name, model: this.llm.model },
      descritores: {
        fonte: { ...fonte, ultimaLeitura: fonte.ultimaLeitura?.toISOString() ?? null, criadaEm: fonte.criadaEm.toISOString() },
        capturas: capturas.map((c) => ({ ...c, capturadoEm: c.capturadoEm.toISOString(), custoUsd: c.custoUsd?.toString() ?? null })),
      },
    };
  }
}
