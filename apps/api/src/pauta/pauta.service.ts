import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  PautaCapturaStatus,
  PautaFamilia,
  PautaObjetivo,
  type PautaFonte,
  type PautaFonteTipo,
} from '@prisma/client';
import {
  PAUTA_FAMILIAS,
  PAUTA_OBJETIVOS,
  type PautaCapturaInput,
  type PautaCapturaList,
  type PautaFonteInput,
  type PautaFonteList,
  type PautaFonteUpdateInput,
  type PautaReferenciaInput,
  type PautaReferenciaItem,
  type PautaReferenciaList,
  type PautaReferenciaUpdateInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApifyService } from './apify.service';
import { EspelhoService } from './espelho.service';
import { hashDaCaptura, normalizarUrlDaCaptura } from './url-da-captura';
import { comProcedencia } from './links-do-grupo';
import { ColetaService, type AtorDaColeta, type ResultadoDaColeta } from './coleta.service';
import { lerEtiqueta, veioDoGmail } from './gmail-da-pauta';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';

const EMBED_MODEL = 'text-embedding-3-small';
// Teto de itens por página. `total` na resposta é a contagem REAL do filtro (não o
// tamanho da página), senão a tela mostra "300 fichas" com 432 no acervo.
const PAGINA = 300;
const BUSCA_LIMITE = 30;

// A IA preenche a ficha no MESMO schema das fichas do vault Cerebro-Conteudo
// ("9 - Engenharia Reversa das Referências/fichas/"). O prompt cobra "não consta"
// em vez de invenção — ficha inventada contamina o repertório inteiro.
const SYSTEM_FICHA = `Você analisa peças de conteúdo (posts, carrosséis, reels, artigos) e produz
uma FICHA DE REFERÊNCIA em português do Brasil, no formato do método "Cérebro de Conteúdo".

Responda SOMENTE com um objeto JSON válido, sem cercas de código, com estas chaves:
{
  "titulo": string,
  "familia": "CUR" | "REA" | "STO" | "DEM" | "CON" | "INT" | "TRE" | "ENC" | "outra",
  "objetivo": "ALC" | "AUT" | "VIN" | "VEN" | "ENG" | "PRO" | "LEA",
  "materiaPrima": string,
  "tensaoCentral": string,
  "emocaoAlvo": string,
  "motorPsicologico": string,
  "formulaHeadline": string,
  "estruturaCorpo": string,
  "prova": string,
  "cta": string | null,
  "preRequisitos": string | null,
  "antiPadroes": string | null,
  "teoriaImplicita": string | null,
  "tags": string[]
}

Famílias: CUR curiosidade/revelação (abre lacuna de informação e fecha revelando) ·
REA react/análise de terceiro (comenta, corrige ou disseca peça alheia) ·
STO storytelling pessoal (experiência vivida, com erro real e consequência) ·
DEM demonstração prática (mostra o trabalho executado em vez de descrevê-lo) ·
CON contraste/comparação (antes×depois, barato×caro, expectativa×realidade) ·
INT interação com a audiência (pergunta, enquete, desafio) ·
TRE trend/meme (pega carona em áudio, formato ou assunto do momento) ·
ENC encenação/esquete (dramatiza uma situação em vez de narrá-la).
Objetivos: ALC alcance · AUT autoridade · VIN vínculo · VEN venda · ENG engajamento ·
PRO prova social · LEA leads.

Regras:
- Use SÓ o que está no material. Se um campo não aparece, escreva exatamente "não consta".
- "formulaHeadline" deve ser um molde reutilizável com colchetes, ex.: "Como o [famoso] hackeou [resultado] usando [meio]".
- "estruturaCorpo" descreve a sequência em uma linha, com setas.
- "emocaoAlvo" é a emoção do PRIMEIRO segundo, não a do fim.
- "tags" no máximo 5, minúsculas, sem "#".`;

interface FichaGerada {
  titulo?: string;
  familia?: string;
  objetivo?: string;
  [k: string]: unknown;
}

/**
 * Quem cadastra ou muda a etiqueta de uma fonte do Gmail decide o que da caixa
 * da empresa entra na pauta — e a pauta é lida por quem tem só `pauta.ver`.
 * Por isso a mesma permissão de ler o Gmail pela tela.
 */
const PERMISSAO_DA_FONTE_GMAIL = 'gmail.ver';

@Injectable()
export class PautaService implements OnModuleInit {
  private readonly log = new Logger('PautaService');
  private readonly openaiKey = process.env.OPENAI_API_KEY ?? '';
  private readonly openaiBase = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly apify: ApifyService,
    private readonly espelho: EspelhoService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly coleta: ColetaService,
  ) {}

  onModuleInit(): void {
    // O perfil se inscreve daqui porque o Apify só pode ser importado por este arquivo.
    this.coleta.registrar(
      'perfil',
      (f, ator, opcoes) => this.coletarPerfil(f, ator, opcoes.limite ?? 12),
      'PautaService',
    );
  }

  // ---------- utilidades ----------

  private normalizarUrl(url: string): string {
    return normalizarUrlDaCaptura(url);
  }

  private hash(v: string): string {
    return hashDaCaptura(v);
  }

  // ---------- captura ----------

  async capturar(orgId: string, actorId: string, input: PautaCapturaInput) {
    const chave = input.url ? this.normalizarUrl(input.url) : (input.texto ?? '').slice(0, 2000);
    if (!chave) throw new BadRequestException('Captura vazia: informe url ou texto.');
    const urlHash = this.hash(chave);

    const jaTem = await this.prisma.pautaCaptura.findUnique({
      where: { orgId_urlHash: { orgId, urlHash } },
      include: { referencia: { select: { id: true } } },
    });
    if (jaTem) {
      // Dedup é feature, não erro: devolve o que já existe em vez de duplicar o acervo.
      return { ok: true, duplicada: true, id: jaTem.id, referenciaId: jaTem.referencia?.id ?? null };
    }

    const c = await this.prisma.pautaCaptura.create({
      data: {
        orgId,
        fonteId: input.fonteId ?? null,
        tipo: input.tipo,
        url: input.url ? this.normalizarUrl(input.url) : null,
        urlHash,
        titulo: input.titulo ?? null,
        nota: input.nota ?? null,
        bruto: input.texto ? { texto: input.texto } : Prisma.DbNull,
        capturadoPor: actorId,
      },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.captura',
      entityType: 'pauta_captura',
      entityId: c.id,
      after: { tipo: c.tipo, url: c.url },
    });
    return { ok: true, duplicada: false, id: c.id, referenciaId: null };
  }

  async anexarImagem(orgId: string, id: string, chave: string) {
    const c = await this.prisma.pautaCaptura.findFirst({ where: { id, orgId } });
    if (!c) throw new NotFoundException('Captura não encontrada');
    await this.prisma.pautaCaptura.update({
      where: { id },
      data: { imagens: { push: chave } },
    });
    return { ok: true };
  }

  async listarCapturas(orgId: string, status?: string): Promise<PautaCapturaList> {
    const where: Prisma.PautaCapturaWhereInput = { orgId };
    if (status) where.status = status as PautaCapturaStatus;

    const [rows, todas, total] = await Promise.all([
      this.prisma.pautaCaptura.findMany({
        where,
        orderBy: { capturadoEm: 'desc' },
        take: PAGINA,
        include: { fonte: { select: { id: true, nome: true } }, referencia: { select: { id: true } } },
      }),
      this.prisma.pautaCaptura.groupBy({ by: ['status'], where: { orgId }, _count: true }),
      this.prisma.pautaCaptura.count({ where }),
    ]);

    return {
      items: rows.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        url: c.url,
        titulo: c.titulo,
        nota: c.nota,
        status: c.status,
        erro: c.erro,
        imagens: c.imagens,
        temFicha: !!c.referencia,
        referenciaId: c.referencia?.id ?? null,
        custoUsd: c.custoUsd ? Number(c.custoUsd) : null,
        fonte: c.fonte ? { id: c.fonte.id, nome: c.fonte.nome } : null,
        capturadoEm: c.capturadoEm.toISOString(),
      })),
      total,
      porStatus: todas.map((t) => ({ status: t.status, count: t._count })),
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  async descartar(orgId: string, id: string, actorId: string) {
    const c = await this.prisma.pautaCaptura.findFirst({ where: { id, orgId } });
    if (!c) throw new NotFoundException('Captura não encontrada');
    await this.prisma.pautaCaptura.update({ where: { id }, data: { status: 'descartada' } });
    await this.audit.log({
      orgId, actorId, action: 'pauta.captura_descartada', entityType: 'pauta_captura', entityId: id,
    });
    return { ok: true };
  }

  // ---------- processamento (Apify/fetch + IA) ----------

  /** Puxa o conteúdo bruto da captura. Instagram/TikTok via Apify; resto via fetch. */
  private async coletar(c: { id: string; url: string | null; bruto: unknown }) {
    // A URL do e-mail é o permalink da caixa de entrada: abrir daria a tela de login.
    if (!c.url || veioDoGmail(c.bruto)) {
      return { texto: this.textoDoBruto(c.bruto), runId: null, custoUsd: null, bruto: c.bruto };
    }

    const plataforma = ApifyService.plataformaDaUrl(c.url);
    const precisaApify = plataforma === 'instagram' || plataforma === 'tiktok';

    if (precisaApify) {
      if (!this.apify.configured) {
        throw new ServiceUnavailableException(
          'Este link é do Instagram/TikTok e precisa do Apify. Defina APIFY_TOKEN no .env — ' +
            'ou cole o texto do post na captura.',
        );
      }
      const r = await this.apify.scrapeUrl(c.url);
      const item = r.items[0] ?? {};
      return { texto: this.textoDoItemApify(item), runId: r.runId, custoUsd: r.custoUsd, bruto: item };
    }

    // web: fetch simples + limpeza de tags. Suficiente para artigo/newsletter.
    const res = await fetch(c.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketingOS/1.0)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new BadRequestException(`A página respondeu HTTP ${res.status}.`);
    const html = await res.text();
    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000);
    return { texto, runId: null, custoUsd: null, bruto: { html: html.slice(0, 2000) } };
  }

  private textoDoBruto(bruto: unknown): string {
    if (bruto && typeof bruto === 'object' && 'texto' in bruto) {
      return String((bruto as { texto: unknown }).texto ?? '');
    }
    return '';
  }

  /** Achata o item do Apify no que interessa para a ficha. */
  private textoDoItemApify(item: Record<string, unknown>): string {
    const s = (k: string) => (item[k] == null ? '' : String(item[k]));
    const filhos = Array.isArray(item.childPosts) ? (item.childPosts as Array<Record<string, unknown>>) : [];
    const linhas = [
      `Autor: ${s('ownerFullName')} (@${s('ownerUsername')})`,
      `Tipo: ${s('type')}`,
      `Publicado em: ${s('timestamp')}`,
      `Curtidas: ${s('likesCount')} · Comentários: ${s('commentsCount')}`,
      `URL: ${s('url')}`,
      '',
      'Legenda:',
      s('caption'),
    ];
    if (Array.isArray(item.hashtags) && item.hashtags.length) {
      linhas.push('', `Hashtags: ${(item.hashtags as string[]).join(' ')}`);
    }
    if (filhos.length) {
      linhas.push('', `Slides do carrossel: ${filhos.length}`);
      filhos.forEach((f, i) => {
        const alt = f.alt ? String(f.alt) : '';
        if (alt) linhas.push(`  ${i + 1}. ${alt}`);
      });
    }
    if (Array.isArray(item.latestComments) && item.latestComments.length) {
      const cs = (item.latestComments as Array<Record<string, unknown>>).slice(0, 5);
      linhas.push('', 'Comentários recentes:');
      cs.forEach((cm) => linhas.push(`  - ${String(cm.text ?? '').slice(0, 200)}`));
    }
    return linhas.join('\n').slice(0, 12000);
  }

  /** Métricas normalizadas do item do Apify (o formato varia por plataforma). */
  private metricasDoItem(item: Record<string, unknown>): Prisma.InputJsonValue | undefined {
    const n = (k: string) => (typeof item[k] === 'number' ? (item[k] as number) : undefined);
    const m: Record<string, number> = {};
    const curtidas = n('likesCount') ?? n('diggCount');
    const comentarios = n('commentsCount');
    const views = n('videoPlayCount') ?? n('playCount');
    if (curtidas !== undefined) m.curtidas = curtidas;
    if (comentarios !== undefined) m.comentarios = comentarios;
    if (views !== undefined) m.views = views;
    return Object.keys(m).length ? m : undefined;
  }

  private parseFicha(texto: string): FichaGerada {
    const limpo = texto.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(limpo) as FichaGerada;
    } catch {
      // Modelo às vezes embrulha o JSON em prosa — pega o maior bloco {...}.
      const i = limpo.indexOf('{');
      const j = limpo.lastIndexOf('}');
      if (i >= 0 && j > i) {
        try {
          return JSON.parse(limpo.slice(i, j + 1)) as FichaGerada;
        } catch {
          /* cai no erro abaixo */
        }
      }
      throw new ServiceUnavailableException('A IA não devolveu um JSON válido para a ficha.');
    }
  }

  private campo(v: unknown, fallback = 'não consta'): string {
    const s = typeof v === 'string' ? v.trim() : '';
    return s || fallback;
  }

  /** Processa a captura: coleta → IA monta a ficha → grava → espelha. */
  async processar(orgId: string, id: string, actorId: string) {
    const c = await this.prisma.pautaCaptura.findFirst({
      where: { id, orgId },
      include: { referencia: { select: { id: true } } },
    });
    if (!c) throw new NotFoundException('Captura não encontrada');
    if (c.referencia) throw new BadRequestException('Esta captura já virou ficha.');
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(
        `IA não configurada: falta a credencial do provider "${this.llm.name}".`,
      );
    }

    await this.prisma.pautaCaptura.update({
      where: { id },
      data: { status: 'processando', erro: null },
    });

    try {
      const coleta = await this.coletar(c);
      if (!coleta.texto.trim()) {
        throw new BadRequestException('Não veio conteúdo nenhum do link — cole o texto na captura.');
      }

      const bruto = (coleta.bruto ?? {}) as Record<string, unknown>;
      const saida = await this.llm.complete({
        system: SYSTEM_FICHA,
        // Na captura do Gmail a nota é o trecho automático do mesmo corpo, não a voz de alguém.
        user: `Material capturado${c.url ? ` (${c.url})` : ''}:\n\n${coleta.texto}${
          c.nota && !veioDoGmail(c.bruto) ? `\n\nNota de quem capturou: ${c.nota}` : ''
        }`,
      });
      const f = this.parseFicha(saida);

      const familia = (PAUTA_FAMILIAS.includes(String(f.familia) as never)
        ? f.familia
        : 'outra') as PautaFamilia;
      const objetivo = (PAUTA_OBJETIVOS.includes(String(f.objetivo) as never)
        ? f.objetivo
        : 'ALC') as PautaObjetivo;

      const metricas = this.metricasDoItem(bruto);
      const publicado = typeof bruto.timestamp === 'string' ? new Date(bruto.timestamp) : null;

      const ref = await this.prisma.pautaReferencia.create({
        data: {
          orgId,
          capturaId: c.id,
          titulo: this.campo(f.titulo, c.titulo ?? 'Sem título'),
          plataforma: c.url ? ApifyService.plataformaDaUrl(c.url) : 'texto',
          autor: bruto.ownerUsername ? `@${String(bruto.ownerUsername)}` : null,
          url: c.url,
          publicadoEm: publicado && !Number.isNaN(publicado.getTime()) ? publicado : null,
          familia,
          objetivo,
          materiaPrima: this.campo(f.materiaPrima),
          tensaoCentral: this.campo(f.tensaoCentral),
          emocaoAlvo: this.campo(f.emocaoAlvo),
          motorPsicologico: this.campo(f.motorPsicologico),
          formulaHeadline: this.campo(f.formulaHeadline),
          estruturaCorpo: this.campo(f.estruturaCorpo),
          prova: this.campo(f.prova),
          cta: typeof f.cta === 'string' ? f.cta : null,
          preRequisitos: typeof f.preRequisitos === 'string' ? f.preRequisitos : null,
          antiPadroes: typeof f.antiPadroes === 'string' ? f.antiPadroes : null,
          teoriaImplicita: typeof f.teoriaImplicita === 'string' ? f.teoriaImplicita : null,
          tags: Array.isArray(f.tags) ? (f.tags as string[]).slice(0, 5).map(String) : [],
          ...(metricas ? { metricas } : {}),
          origem: 'captura',
        },
      });

      await this.prisma.pautaCaptura.update({
        where: { id },
        data: {
          status: 'ficha',
          bruto: comProcedencia(c.bruto, bruto) as Prisma.InputJsonValue,
          apifyRunId: coleta.runId,
          custoUsd: coleta.custoUsd ?? null,
        },
      });

      await this.indexar(ref.id);
      await this.espelharSeguro(orgId, ref.id);

      await this.audit.log({
        orgId,
        actorId,
        action: 'pauta.ficha_gerada',
        entityType: 'pauta_referencia',
        entityId: ref.id,
        after: { familia, objetivo, provider: this.llm.name, model: this.llm.model, custoUsd: coleta.custoUsd },
      });

      return { ok: true, referenciaId: ref.id };
    } catch (e) {
      const msg = (e as Error).message ?? 'falha desconhecida';
      await this.prisma.pautaCaptura.update({
        where: { id },
        data: { status: 'erro', erro: msg.slice(0, 500) },
      });
      throw e;
    }
  }

  // ---------- acervo ----------

  private async embed(textos: string[]): Promise<number[][]> {
    const res = await fetch(`${this.openaiBase}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.openaiKey}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: textos.map((t) => t.slice(0, 8000)) }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings HTTP ${res.status}`);
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data.map((d) => d.embedding);
  }

  /** Gera o embedding da ficha (busca semântica). Silencioso se não há chave. */
  async indexar(referenciaId: string): Promise<void> {
    if (!this.openaiKey) return;
    const r = await this.prisma.pautaReferencia.findUnique({ where: { id: referenciaId } });
    if (!r) return;
    const texto = [
      r.titulo, r.materiaPrima, r.tensaoCentral, r.emocaoAlvo,
      r.motorPsicologico, r.formulaHeadline, r.estruturaCorpo, r.prova, r.teoriaImplicita ?? '',
    ].join('\n');
    try {
      const [v] = await this.embed([texto]);
      await this.prisma.$executeRawUnsafe(
        'UPDATE "PautaReferencia" SET embedding = $1::vector WHERE id = $2',
        `[${v.join(',')}]`,
        referenciaId,
      );
    } catch (e) {
      this.log.warn(`embedding da ficha ${referenciaId} falhou: ${(e as Error).message}`);
    }
  }

  /** Espelha sem derrubar o fluxo: destino indisponível não invalida a ficha. */
  private async espelharSeguro(orgId: string, referenciaId: string): Promise<void> {
    try {
      const r = await this.prisma.pautaReferencia.findUnique({ where: { id: referenciaId } });
      if (!r) return;
      const caminho = await this.espelho.espelhar(orgId, r);
      if (caminho) {
        await this.prisma.pautaReferencia.update({
          where: { id: referenciaId },
          data: { vaultPath: caminho },
        });
      }
    } catch (e) {
      this.log.warn(`espelho da ficha ${referenciaId} falhou: ${(e as Error).message}`);
    }
  }

  private mapRef(r: {
    [k: string]: any;
  }): PautaReferenciaItem {
    return {
      id: r.id,
      titulo: r.titulo,
      plataforma: r.plataforma,
      autor: r.autor,
      url: r.url,
      publicadoEm: r.publicadoEm ? new Date(r.publicadoEm).toISOString() : null,
      familia: r.familia,
      objetivo: r.objetivo,
      materiaPrima: r.materiaPrima,
      tensaoCentral: r.tensaoCentral,
      emocaoAlvo: r.emocaoAlvo,
      motorPsicologico: r.motorPsicologico,
      formulaHeadline: r.formulaHeadline,
      estruturaCorpo: r.estruturaCorpo,
      prova: r.prova,
      cta: r.cta,
      preRequisitos: r.preRequisitos,
      antiPadroes: r.antiPadroes,
      teoriaImplicita: r.teoriaImplicita,
      metricas: (r.metricas as Record<string, unknown> | null) ?? null,
      tags: r.tags ?? [],
      campea: r.campea,
      origem: r.origem ?? null,
      vaultPath: r.vaultPath ?? null,
      criadaEm: new Date(r.criadaEm).toISOString(),
      atualizadaEm: new Date(r.atualizadaEm).toISOString(),
    };
  }

  async listarReferencias(
    orgId: string,
    filtro: { familia?: string; objetivo?: string; campea?: boolean; q?: string },
  ): Promise<PautaReferenciaList> {
    // Busca semântica quando há pergunta em linguagem natural e chave de embedding.
    if (filtro.q && this.openaiKey) {
      try {
        const [qv] = await this.embed([filtro.q]);
        const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, any>>>(
          `SELECT *, 1 - (embedding <=> $1::vector) AS similaridade
             FROM "PautaReferencia"
            WHERE "orgId" = $2 AND embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT ${BUSCA_LIMITE}`,
          `[${qv.join(',')}]`,
          orgId,
        );
        const facetas = await this.facetas(orgId);
        return {
          // aqui total = o que a busca trouxe (é um ranking por similaridade, não uma página)
          items: rows.map((r) => ({ ...this.mapRef(r), similaridade: Number(r.similaridade) })),
          total: rows.length,
          ...facetas,
          source: { tool: 'busca-semantica', generatedAt: new Date().toISOString() },
        };
      } catch (e) {
        this.log.warn(`busca semântica falhou (${(e as Error).message}); caindo para texto`);
      }
    }

    const where: Prisma.PautaReferenciaWhereInput = { orgId };
    if (filtro.familia) where.familia = filtro.familia as PautaFamilia;
    if (filtro.objetivo) where.objetivo = filtro.objetivo as PautaObjetivo;
    if (filtro.campea !== undefined) where.campea = filtro.campea;
    if (filtro.q) {
      where.OR = [
        { titulo: { contains: filtro.q, mode: 'insensitive' } },
        { formulaHeadline: { contains: filtro.q, mode: 'insensitive' } },
        { materiaPrima: { contains: filtro.q, mode: 'insensitive' } },
        { autor: { contains: filtro.q, mode: 'insensitive' } },
      ];
    }

    const [rows, facetas, total] = await Promise.all([
      this.prisma.pautaReferencia.findMany({ where, orderBy: { criadaEm: 'desc' }, take: PAGINA }),
      this.facetas(orgId),
      this.prisma.pautaReferencia.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.mapRef(r)),
      total,
      ...facetas,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  private async facetas(orgId: string) {
    const [porFamilia, porObjetivo, campeas] = await Promise.all([
      this.prisma.pautaReferencia.groupBy({ by: ['familia'], where: { orgId }, _count: true }),
      this.prisma.pautaReferencia.groupBy({ by: ['objetivo'], where: { orgId }, _count: true }),
      this.prisma.pautaReferencia.count({ where: { orgId, campea: true } }),
    ]);
    return {
      porFamilia: porFamilia.map((f) => ({ key: f.familia, count: f._count })),
      porObjetivo: porObjetivo.map((o) => ({ key: o.objetivo, count: o._count })),
      campeas,
    };
  }

  async obterReferencia(orgId: string, id: string): Promise<PautaReferenciaItem> {
    const r = await this.prisma.pautaReferencia.findFirst({ where: { id, orgId } });
    if (!r) throw new NotFoundException('Ficha não encontrada');
    return this.mapRef(r);
  }

  async criarReferencia(orgId: string, actorId: string, input: PautaReferenciaInput) {
    const r = await this.prisma.pautaReferencia.create({
      data: {
        orgId,
        titulo: input.titulo,
        plataforma: input.plataforma ?? null,
        autor: input.autor ?? null,
        url: input.url ?? null,
        publicadoEm: input.publicadoEm ? new Date(input.publicadoEm) : null,
        familia: input.familia as PautaFamilia,
        objetivo: input.objetivo as PautaObjetivo,
        materiaPrima: input.materiaPrima,
        tensaoCentral: input.tensaoCentral,
        emocaoAlvo: input.emocaoAlvo,
        motorPsicologico: input.motorPsicologico,
        formulaHeadline: input.formulaHeadline,
        estruturaCorpo: input.estruturaCorpo,
        prova: input.prova,
        cta: input.cta ?? null,
        preRequisitos: input.preRequisitos ?? null,
        antiPadroes: input.antiPadroes ?? null,
        teoriaImplicita: input.teoriaImplicita ?? null,
        tags: input.tags ?? [],
        campea: input.campea ?? false,
        origem: 'manual',
      },
    });
    await this.indexar(r.id);
    await this.espelharSeguro(orgId, r.id);
    await this.audit.log({
      orgId, actorId, action: 'pauta.ficha_criada', entityType: 'pauta_referencia', entityId: r.id,
    });
    return this.mapRef(r);
  }

  async atualizarReferencia(
    orgId: string,
    id: string,
    actorId: string,
    patch: PautaReferenciaUpdateInput,
  ) {
    const atual = await this.prisma.pautaReferencia.findFirst({ where: { id, orgId } });
    if (!atual) throw new NotFoundException('Ficha não encontrada');

    const data: Prisma.PautaReferenciaUpdateInput = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (k === 'publicadoEm') {
        data.publicadoEm = v ? new Date(v as string) : null;
      } else {
        (data as Record<string, unknown>)[k] = v;
      }
    }

    const r = await this.prisma.pautaReferencia.update({ where: { id }, data });
    await this.indexar(r.id);
    await this.espelharSeguro(orgId, r.id);
    await this.audit.log({
      orgId, actorId, action: 'pauta.ficha_editada', entityType: 'pauta_referencia', entityId: id,
      before: { campea: atual.campea, familia: atual.familia },
      after: { campea: r.campea, familia: r.familia },
    });
    return this.mapRef(r);
  }

  // Não apaga o .md espelhado de propósito: deletar arquivo dentro da vault do
  // usuário é irreversível e o espelho é one-way. O órfão fica lá para ele decidir.
  async removerReferencia(orgId: string, id: string, actorId: string) {
    const r = await this.prisma.pautaReferencia.findFirst({ where: { id, orgId } });
    if (!r) throw new NotFoundException('Ficha não encontrada');
    await this.prisma.pautaReferencia.delete({ where: { id } });
    await this.audit.log({
      orgId, actorId, action: 'pauta.ficha_removida', entityType: 'pauta_referencia', entityId: id,
      before: { titulo: r.titulo },
    });
    return { ok: true };
  }

  /** Reindexa tudo que está sem embedding (usar depois de importar acervo). */
  async reindexar(orgId: string): Promise<{ indexadas: number }> {
    if (!this.openaiKey) throw new ServiceUnavailableException('OPENAI_API_KEY ausente.');
    const pend = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT id FROM "PautaReferencia" WHERE "orgId" = $1 AND embedding IS NULL LIMIT 500',
      orgId,
    );
    for (const p of pend) await this.indexar(p.id);
    return { indexadas: pend.length };
  }

  // ---------- fontes (Radar) ----------

  async listarFontes(orgId: string): Promise<PautaFonteList> {
    const rows = await this.prisma.pautaFonte.findMany({
      where: { orgId },
      orderBy: { criadaEm: 'desc' },
      include: { _count: { select: { capturas: true } } },
    });
    return {
      items: rows.map((f) => ({
        id: f.id,
        tipo: f.tipo,
        nome: f.nome,
        url: f.url,
        handle: f.handle,
        plataforma: f.plataforma,
        ativo: f.ativo,
        intervaloMin: f.intervaloMin,
        tetoRunsMes: f.tetoRunsMes,
        runsNoMes: f.runsNoMes,
        ultimaLeitura: f.ultimaLeitura?.toISOString() ?? null,
        ultimoErro: f.ultimoErro,
        capturas: f._count.capturas,
      })),
      apifyConfigurado: this.apify.configured,
      espelho: await this.espelho.estado(orgId),
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  /**
   * `permissoes` é o que o guard da rota já leu do token; `null` só para quem
   * não é pessoa. Fonte do Gmail pede `gmail.ver` (ver `PERMISSAO_DA_FONTE_GMAIL`).
   */
  async criarFonte(
    orgId: string,
    actorId: string,
    input: PautaFonteInput,
    permissoes: readonly string[] | null = null,
  ) {
    if (input.tipo === 'rss' && !input.url) throw new BadRequestException('Fonte RSS exige url.');
    if (input.tipo === 'perfil' && !input.handle) throw new BadRequestException('Fonte perfil exige handle.');
    let handle = input.handle ?? null;
    let url = input.url ?? null;
    let plataforma = input.plataforma ?? null;
    if (input.tipo === 'gmail') {
      this.exigirPermissaoDoGmail(permissoes);
      handle = this.etiquetaValida(input.handle);
      url = null;
      plataforma = 'gmail';
    }
    const f = await this.prisma.pautaFonte.create({
      data: {
        orgId,
        tipo: input.tipo,
        nome: input.nome,
        url,
        handle,
        plataforma,
        ativo: input.ativo ?? true,
        intervaloMin: input.intervaloMin ?? 720,
        tetoRunsMes: input.tetoRunsMes ?? 30,
      },
    });
    await this.audit.log({
      orgId, actorId, action: 'pauta.fonte_criada', entityType: 'pauta_fonte', entityId: f.id,
      after: { tipo: f.tipo, nome: f.nome, ...(f.tipo === 'gmail' ? { etiqueta: f.handle } : {}) },
    });
    return { ok: true, id: f.id };
  }

  private exigirPermissaoDoGmail(permissoes: readonly string[] | null): void {
    if (permissoes && !permissoes.includes(PERMISSAO_DA_FONTE_GMAIL)) {
      throw new ForbiddenException(
        `Fonte do Gmail escolhe o que da caixa da empresa entra na pauta: exige a permissão ${PERMISSAO_DA_FONTE_GMAIL}.`,
      );
    }
  }

  private etiquetaValida(bruta: string | null | undefined): string {
    const lida = lerEtiqueta(bruta);
    if ('erro' in lida) throw new BadRequestException(lida.erro);
    return lida.etiqueta;
  }

  async atualizarFonte(
    orgId: string,
    id: string,
    actorId: string,
    patch: PautaFonteUpdateInput,
    permissoes: readonly string[] | null = null,
  ) {
    const f = await this.prisma.pautaFonte.findFirst({ where: { id, orgId } });
    if (!f) throw new NotFoundException('Fonte não encontrada');
    const data: PautaFonteUpdateInput = { ...patch };
    const tipo: PautaFonteTipo = patch.tipo ?? f.tipo;
    // Virar Gmail, ou trocar a etiqueta de uma que já é, é o mesmo que criar uma.
    if (tipo === 'gmail' && (f.tipo !== 'gmail' || patch.handle !== undefined)) {
      this.exigirPermissaoDoGmail(permissoes);
      data.handle = this.etiquetaValida(patch.handle !== undefined ? patch.handle : f.handle);
      data.plataforma = 'gmail';
    }
    await this.prisma.pautaFonte.update({ where: { id }, data });
    await this.audit.log({
      orgId, actorId, action: 'pauta.fonte_editada', entityType: 'pauta_fonte', entityId: id,
    });
    return { ok: true };
  }

  async removerFonte(orgId: string, id: string, actorId: string) {
    const f = await this.prisma.pautaFonte.findFirst({ where: { id, orgId } });
    if (!f) throw new NotFoundException('Fonte não encontrada');
    await this.prisma.pautaFonte.delete({ where: { id } });
    await this.audit.log({
      orgId, actorId, action: 'pauta.fonte_removida', entityType: 'pauta_fonte', entityId: id,
    });
    return { ok: true };
  }

  /** "Coletar agora" do Radar: o despacho por tipo mora em `ColetaService`. */
  async coletarFonte(orgId: string, id: string, actorId: string, limite = 12) {
    const f = await this.prisma.pautaFonte.findFirst({ where: { id, orgId } });
    if (!f) throw new NotFoundException('Fonte não encontrada');
    const r = await this.coleta.coletar(f, actorId, { limite });
    return { ok: true, novas: r.novas, repetidas: r.repetidas };
  }

  /** Puxa os últimos posts de um perfil vigiado e joga na fila como captura. */
  private async coletarPerfil(f: PautaFonte, ator: AtorDaColeta, limite: number): Promise<ResultadoDaColeta> {
    if (!f.handle) throw new BadRequestException('Fonte perfil exige handle.');

    // Teto de gasto: o contador zera na virada do mês.
    const mes = new Date().toISOString().slice(0, 7);
    const runs = f.mesReferente === mes ? f.runsNoMes : 0;
    if (runs >= f.tetoRunsMes) {
      throw new BadRequestException(
        `Teto de ${f.tetoRunsMes} execuções/mês atingido para "${f.nome}". Aumente o teto ou espere virar o mês.`,
      );
    }

    let novas = 0;
    let repetidas = 0;
    try {
      const r = await this.apify.scrapePerfil(f.handle, limite);
      for (const item of r.items) {
        const url = typeof item.url === 'string' ? item.url : null;
        if (!url) continue;
        const res = await this.capturar(f.orgId, ator.id, {
          tipo: 'link',
          url,
          titulo: typeof item.caption === 'string' ? item.caption.slice(0, 120) : null,
          nota: null,
          texto: null,
          fonteId: f.id,
        });
        if (res.duplicada) {
          repetidas++;
          continue;
        }
        novas++;
        // já guarda o payload: evita um segundo run do Apify no processamento
        await this.prisma.pautaCaptura.update({
          where: { id: res.id },
          data: { bruto: item as Prisma.InputJsonValue, apifyRunId: r.runId },
        });
      }
    } finally {
      // O run conta mesmo quando falha: o Apify cobra do mesmo jeito.
      await this.prisma.pautaFonte.update({
        where: { id: f.id },
        data: { runsNoMes: runs + 1, mesReferente: mes },
      });
    }
    return { novas, repetidas };
  }

  // ---------- espelho ----------

  async espelhoEstado(orgId: string) {
    const cfg = await this.espelho.config(orgId);
    const st = await this.espelho.estado(orgId);
    return { ...cfg, ...st };
  }

  async espelhoConfigurar(
    orgId: string,
    actorId: string,
    patch: { destino?: 'off' | 'local' | 'drive'; dir?: string; folderId?: string | null },
  ) {
    const novo = await this.espelho.setConfig(orgId, patch);
    await this.audit.log({
      orgId, actorId, action: 'pauta.espelho_config', entityType: 'integracao', entityId: 'pauta-espelho',
      after: novo as unknown as Prisma.InputJsonValue,
    });
    return { ...novo, ...(await this.espelho.estado(orgId)) };
  }

  /** Reenvia todas as fichas para o destino atual (útil ao trocar local ↔ drive). */
  async espelhoSincronizar(orgId: string): Promise<{ espelhadas: number; falhas: number }> {
    const st = await this.espelho.estado(orgId);
    if (st.destino === 'off') throw new BadRequestException('Espelho desligado.');
    if (!st.disponivel) throw new BadRequestException(st.motivo ?? 'Destino indisponível.');

    const rows = await this.prisma.pautaReferencia.findMany({ where: { orgId }, take: 1000 });
    let espelhadas = 0;
    let falhas = 0;
    for (const r of rows) {
      try {
        const caminho = await this.espelho.espelhar(orgId, r);
        if (caminho) {
          await this.prisma.pautaReferencia.update({ where: { id: r.id }, data: { vaultPath: caminho } });
          espelhadas++;
        }
      } catch (e) {
        falhas++;
        this.log.warn(`espelho de ${r.id} falhou: ${(e as Error).message}`);
      }
    }
    return { espelhadas, falhas };
  }
}
