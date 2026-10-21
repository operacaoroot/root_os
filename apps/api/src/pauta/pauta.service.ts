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
import {
  DIAS_DA_JANELA_DA_BUSCA,
  capturaDoResultado,
  comProcedenciaDaBusca,
  custoPorCaptura,
  lerConsulta,
  resultadosDaBusca,
  resultadosPedidos,
} from './busca-da-pauta';
import {
  brutoDoPost,
  comProcedenciaDoPerfil,
  lerHandleDoPerfil,
  plataformaDoPerfil,
  postsDoPerfil,
  procedenciaDoPerfil,
  textoDoPost,
} from './perfil-da-pauta';
import { env } from '../llm/env';
import {
  FalhaDeEmbedding,
  PRAZO_DA_BUSCA_MS,
  PRAZO_DO_LOTE_MS,
  cortarParaEmbedding,
  descreverVetorizacao,
  mesclarComTextuais,
  vetoresDaResposta,
  vetorizarEmLotes,
} from '../obsidian/embeddings-lotes';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { umaPorVez } from './uma-por-vez';
import { buscarPaginaPublica } from './pagina-publica';

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

/** O @perfil e a etiqueta cabem nisso; só a consulta da busca usa o teto maior do schema. */
const TETO_DO_HANDLE_FORA_DA_BUSCA = 60;

@Injectable()
export class PautaService implements OnModuleInit {
  private readonly log = new Logger('PautaService');
  private readonly openaiKey = process.env.OPENAI_API_KEY ?? '';
  private readonly openaiBase = env('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, '');

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
    // A busca também roda no Apify: mesma razão para morar aqui.
    this.coleta.registrar('busca', (f, ator, opcoes) => this.coletarBusca(f, ator, opcoes.limite), 'PautaService');
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
    // O post do X e do YouTube já foi lido na coleta do perfil (MC4): abrir o link
    // daria a tela de login do X ou o HTML inteiro do YouTube.
    const doPerfil = procedenciaDoPerfil(c.bruto);
    if (doPerfil && (doPerfil.plataforma === 'x' || doPerfil.plataforma === 'youtube')) {
      return { texto: textoDoPost(c.bruto), runId: null, custoUsd: null, bruto: c.bruto };
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
    const res = await buscarPaginaPublica(c.url, {
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
    // Instagram, TikTok, X e YouTube, nesta ordem, em cada linha.
    const curtidas = n('likesCount') ?? n('diggCount') ?? n('likeCount') ?? n('likes');
    const comentarios = n('commentsCount') ?? n('commentCount') ?? n('replyCount');
    const views = n('videoPlayCount') ?? n('playCount') ?? n('viewCount');
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
        funcao: 'CT-02',
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
      const quando = typeof bruto.timestamp === 'string' ? bruto.timestamp : bruto.publicadoEm;
      const publicado = typeof quando === 'string' ? new Date(quando) : null;
      const doPerfil = procedenciaDoPerfil(c.bruto);

      const ref = await this.prisma.pautaReferencia.create({
        data: {
          orgId,
          capturaId: c.id,
          titulo: this.campo(f.titulo, c.titulo ?? 'Sem título'),
          plataforma: c.url ? ApifyService.plataformaDaUrl(c.url) : 'texto',
          autor: bruto.ownerUsername ? `@${String(bruto.ownerUsername)}` : doPerfil ? `@${doPerfil.handle}` : null,
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
          // A captura do grupo chega sem título, e o título da captura é o que
          // a curadoria leva para fora (botão, descrição, newsletter).
          ...(!c.titulo?.trim() && typeof f.titulo === 'string' && f.titulo.trim()
            ? { titulo: f.titulo.trim().slice(0, 300) }
            : {}),
          bruto: comProcedenciaDoPerfil(
            c.bruto,
            comProcedenciaDaBusca(c.bruto, comProcedencia(c.bruto, bruto)),
          ) as Prisma.InputJsonValue,
          // A leitura do link pela web não tem run: o custo e o run da coleta
          // que trouxe a captura (a busca do MC3) continuam valendo.
          apifyRunId: coleta.runId ?? c.apifyRunId,
          custoUsd: coleta.custoUsd ?? c.custoUsd,
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

  /** Um pedido ao fornecedor, com o mesmo corte, prazo e conferência do `embed` da vault. */
  private async embed(textos: string[], prazoMs = PRAZO_DO_LOTE_MS): Promise<number[][]> {
    if (!textos.length) return [];
    const input = textos.map((t) => cortarParaEmbedding(t));
    try {
      const res = await fetch(`${this.openaiBase}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.openaiKey}` },
        body: JSON.stringify({ model: EMBED_MODEL, input }),
        signal: AbortSignal.timeout(prazoMs),
      });
      if (!res.ok) throw new FalhaDeEmbedding(`OpenAI embeddings HTTP ${res.status}`, res.status);
      return vetoresDaResposta(await res.json(), input.length);
    } catch (e) {
      if (e instanceof FalhaDeEmbedding) throw e;
      throw new FalhaDeEmbedding(`OpenAI embeddings sem resposta utilizável (${(e as Error).message})`);
    }
  }

  /** O texto que vira o vetor da ficha: o mesmo em `indexar` e em `reindexar`. */
  private textoDaFicha(r: {
    titulo: string;
    materiaPrima: string;
    tensaoCentral: string;
    emocaoAlvo: string;
    motorPsicologico: string;
    formulaHeadline: string;
    estruturaCorpo: string;
    prova: string;
    teoriaImplicita: string | null;
  }): string {
    return [
      r.titulo, r.materiaPrima, r.tensaoCentral, r.emocaoAlvo,
      r.motorPsicologico, r.formulaHeadline, r.estruturaCorpo, r.prova, r.teoriaImplicita ?? '',
    ].join('\n');
  }

  /** Gera o embedding da ficha (busca semântica). Silencioso se não há chave. */
  async indexar(referenciaId: string): Promise<void> {
    if (!this.openaiKey) return;
    const r = await this.prisma.pautaReferencia.findUnique({ where: { id: referenciaId } });
    if (!r) return;
    const texto = this.textoDaFicha(r);
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

    // Busca semântica quando há pergunta em linguagem natural e chave de embedding.
    if (filtro.q && this.openaiKey) {
      try {
        const [qv] = await this.embed([filtro.q], PRAZO_DA_BUSCA_MS);
        /*
         * Só `id` e similaridade. O `SELECT *` de antes trazia a coluna
         * `embedding`, que o Prisma não lê ("Failed to deserialize column of
         * type 'vector'"): com qualquer ficha vetorizada a consulta lançava e
         * a busca caía para texto. E os filtros da tela agora valem também
         * nesta metade, que os ignorava.
         */
        const parametros: unknown[] = [`[${qv.join(',')}]`, orgId];
        const filtros: string[] = [];
        if (filtro.familia) filtros.push(`AND familia::text = $${parametros.push(filtro.familia)}`);
        if (filtro.objetivo) filtros.push(`AND objetivo::text = $${parametros.push(filtro.objetivo)}`);
        if (filtro.campea !== undefined) filtros.push(`AND campea = $${parametros.push(filtro.campea)}`);
        const achadas = await this.prisma.$queryRawUnsafe<Array<{ id: string; similaridade: number }>>(
          `SELECT id, 1 - (embedding <=> $1::vector) AS similaridade
             FROM "PautaReferencia"
            WHERE "orgId" = $2 AND embedding IS NOT NULL ${filtros.join(' ')}
            ORDER BY embedding <=> $1::vector
            LIMIT ${BUSCA_LIMITE}`,
          ...parametros,
        );
        /*
         * Sem nenhuma achada (cobertura zero, ou nenhuma vetorizada dentro do
         * filtro) cai para o texto abaixo. Com achadas, a ficha SEM vetor que
         * tem o texto entra pela mescla, como nas buscas da vault e da memória.
         */
        if (achadas.length) {
          const semVetor = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
            'SELECT id FROM "PautaReferencia" WHERE "orgId" = $1 AND embedding IS NULL',
            orgId,
          );
          const [linhas, textuais, facetas] = await Promise.all([
            this.prisma.pautaReferencia.findMany({ where: { orgId, id: { in: achadas.map((a) => a.id) } } }),
            semVetor.length
              ? this.prisma.pautaReferencia.findMany({
                  where: { ...where, id: { in: semVetor.map((s) => s.id) } },
                  orderBy: { criadaEm: 'desc' },
                  take: BUSCA_LIMITE,
                })
              : Promise.resolve([]),
            this.facetas(orgId),
          ]);
          const porId = new Map(linhas.map((l) => [l.id, l]));
          const semanticas = achadas.flatMap((a) => {
            const l = porId.get(a.id);
            return l ? [{ ...this.mapRef(l), similaridade: Number(a.similaridade) }] : [];
          });
          const items = mesclarComTextuais(semanticas, textuais.map((r) => this.mapRef(r)), BUSCA_LIMITE);
          return {
            // aqui total = o que a busca trouxe (é um ranking por similaridade, não uma página)
            items,
            total: items.length,
            ...facetas,
            source: { tool: 'busca-semantica', generatedAt: new Date().toISOString() },
          };
        }
      } catch (e) {
        this.log.warn(`busca semântica falhou (${(e as Error).message}); caindo para texto`);
      }
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

  /**
   * Reindexa tudo que está sem embedding (usar depois de importar acervo).
   *
   * `indexadas` é o que foi GRAVADO. Antes era um pedido por ficha, com a falha
   * engolida por `indexar`, e a resposta devolvia quantas foram tentadas: com o
   * fornecedor fora do ar, 500 pedidos falhavam e a resposta dizia "500
   * indexadas". Agora vai em lotes com teto, a primeira falha do fornecedor
   * para a reposição, e `falhas`/`motivo` dizem quantas ficaram sem vetor e por quê.
   */
  async reindexar(orgId: string): Promise<{ indexadas: number; falhas: number; motivo: string | null }> {
    if (!this.openaiKey) throw new ServiceUnavailableException('OPENAI_API_KEY ausente.');
    const pend = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT id FROM "PautaReferencia" WHERE "orgId" = $1 AND embedding IS NULL LIMIT 500',
      orgId,
    );
    const fichas = pend.length
      ? await this.prisma.pautaReferencia.findMany({ where: { orgId, id: { in: pend.map((p) => p.id) } } })
      : [];
    const r = await vetorizarEmLotes(
      fichas.map((f) => this.textoDaFicha(f)),
      (lote) => this.embed(lote),
      {
        gravar: async (indices, vetores) => {
          for (let k = 0; k < indices.length; k++) {
            await this.prisma.$executeRawUnsafe(
              'UPDATE "PautaReferencia" SET embedding = $1::vector WHERE id = $2 AND "orgId" = $3',
              `[${vetores[k].join(',')}]`,
              fichas[indices[k]].id,
              orgId,
            );
          }
        },
      },
    );
    if (r.semVetor) this.log.warn(`reposição do acervo da empresa ${orgId}: ${descreverVetorizacao(r)}.`);
    return { indexadas: r.vetorizados, falhas: r.semVetor, motivo: r.motivo };
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
    } else if (input.tipo === 'busca') {
      handle = this.consultaValida(input.handle);
      url = null;
      plataforma = 'google';
    } else if (input.tipo === 'perfil') {
      // O teto vale para o @ já tirado da URL colada, e a regra de cada rede é mais curta que ele.
      ({ handle, plataforma } = this.perfilValido(input.plataforma, handle));
    } else {
      this.exigirHandleCurto(handle);
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
      after: {
        tipo: f.tipo,
        nome: f.nome,
        ...(f.tipo === 'gmail' ? { etiqueta: f.handle } : {}),
        ...(f.tipo === 'busca' ? { consulta: f.handle } : {}),
      },
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

  private consultaValida(bruta: string | null | undefined): string {
    const lida = lerConsulta(bruta);
    if ('erro' in lida) throw new BadRequestException(lida.erro);
    return lida.consulta;
  }

  private exigirHandleCurto(handle: string | null | undefined): void {
    if (handle && handle.length > TETO_DO_HANDLE_FORA_DA_BUSCA) {
      throw new BadRequestException(`O handle tem no máximo ${TETO_DO_HANDLE_FORA_DA_BUSCA} caracteres.`);
    }
  }

  /** Plataforma entre as quatro do MC4 e o @ que o actor dela aceita, tirado da URL se vier colada. */
  private perfilValido(
    plataformaBruta: string | null | undefined,
    handleBruto: string | null | undefined,
  ): { plataforma: string; handle: string } {
    const plataforma = plataformaDoPerfil(plataformaBruta);
    if (!plataforma) {
      throw new BadRequestException(
        `Perfil do "${plataformaBruta}" não é coletado. Plataformas aceitas: instagram, tiktok, x e youtube.`,
      );
    }
    const lido = lerHandleDoPerfil(plataforma, handleBruto);
    if ('erro' in lido) throw new BadRequestException(lido.erro);
    return { plataforma, handle: lido.handle };
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
    } else if (tipo === 'busca' && (f.tipo !== 'busca' || patch.handle !== undefined)) {
      data.handle = this.consultaValida(patch.handle !== undefined ? patch.handle : f.handle);
      data.url = null;
      data.plataforma = 'google';
    } else if (tipo !== 'busca') {
      // Quem sai da busca leva a consulta junto se o corpo não trouxer outro handle.
      const handle = patch.handle !== undefined ? patch.handle : f.handle;
      if (f.tipo === 'busca' && patch.plataforma === undefined) data.plataforma = null;
      const mexeuNoPerfil = f.tipo !== 'perfil' || patch.handle !== undefined || patch.plataforma !== undefined;
      if (tipo !== 'perfil' || !mexeuNoPerfil) this.exigirHandleCurto(handle);
      if (tipo === 'perfil' && mexeuNoPerfil) {
        // Sem plataforma no corpo vale a gravada; vinda de outro tipo, a dele não é de perfil.
        const plataforma = patch.plataforma !== undefined ? patch.plataforma : f.tipo === 'perfil' ? f.plataforma : null;
        const valido = this.perfilValido(plataforma, handle);
        data.handle = valido.handle;
        if (patch.plataforma !== undefined) data.plataforma = valido.plataforma;
        else if (f.tipo !== 'perfil') data.plataforma = null;
      }
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
  coletarFonte(orgId: string, id: string, actorId: string, limite = 12) {
    return umaPorVez(`pauta-coleta:${orgId}:${id}`, 'A coleta desta fonte', () => this.coletarFonteAgora(orgId, id, actorId, limite));
  }

  private async coletarFonteAgora(orgId: string, id: string, actorId: string, limite = 12) {
    const f = await this.prisma.pautaFonte.findFirst({ where: { id, orgId } });
    if (!f) throw new NotFoundException('Fonte não encontrada');
    const r = await this.coleta.coletar(f, actorId, { limite });
    return { ok: true, novas: r.novas, repetidas: r.repetidas, ...(r.aviso ? { aviso: r.aviso } : {}) };
  }

  /**
   * Os últimos posts de um creator (MC4: Instagram, TikTok, X ou YouTube), cada
   * um como captura com a chave da tela. Como a busca, o perfil entra na coleta
   * da rodada, e por isso o teto do mês é o freio e não erro: reserva o run
   * antes de chamar o Apify e, estourado, pula com aviso na fonte.
   */
  private async coletarPerfil(f: PautaFonte, ator: AtorDaColeta, limite: number): Promise<ResultadoDaColeta> {
    const plataforma = plataformaDoPerfil(f.plataforma);
    if (!plataforma) {
      throw new BadRequestException(
        `"${f.nome}" está gravada com a plataforma "${f.plataforma}", que não é coletada. ` +
          'Plataformas aceitas: instagram, tiktok, x e youtube.',
      );
    }
    const lido = lerHandleDoPerfil(plataforma, f.handle);
    if ('erro' in lido) throw new BadRequestException(lido.erro);
    const { handle } = lido;
    // Antes de reservar: sem token não há run, e o teto não pode gastar o que não rodou.
    if (!this.apify.configured) {
      throw new ServiceUnavailableException(
        'O perfil vigiado roda no Apify. Defina APIFY_TOKEN no .env (ver .env.example) e reinicie a API.',
      );
    }

    const mes = new Date().toISOString().slice(0, 7);
    if (!(await this.reservarRun(f, mes))) {
      return {
        novas: 0,
        repetidas: 0,
        pulada: true,
        aviso:
          `Teto de ${f.tetoRunsMes} execuções/mês atingido para "${f.nome}": o perfil foi pulado. ` +
          'Aumente o teto ou espere virar o mês.',
      };
    }

    // O run já está contado: se o Apify falhar daqui em diante, cobrou do mesmo jeito.
    const r = await this.apify.scrapePerfil(handle, limite, plataforma);
    const novas: string[] = [];
    let repetidas = 0;
    try {
      // Grava direto, como a busca: `capturar` registraria cada post no RASTRO
      // como se uma pessoa o tivesse colado, e a rotina não é pessoa. O RASTRO
      // da coleta é o `pauta.coleta_perfil` abaixo, com o ator de verdade.
      for (const { post, item } of postsDoPerfil(plataforma, r.items)) {
        const url = this.normalizarUrl(post.url);
        const urlHash = this.hash(url);
        const existe = await this.prisma.pautaCaptura.findUnique({
          where: { orgId_urlHash: { orgId: f.orgId, urlHash } },
          select: { id: true },
        });
        if (existe) {
          repetidas++;
          continue;
        }
        try {
          const criada = await this.prisma.pautaCaptura.create({
            data: {
              orgId: f.orgId,
              fonteId: f.id,
              tipo: 'link',
              url,
              urlHash,
              titulo: post.titulo,
              nota: null,
              // já guarda o post: o processamento do X e do YouTube lê daqui, sem outro run
              bruto: brutoDoPost(post, item, plataforma, handle) as Prisma.InputJsonValue,
              apifyRunId: r.runId,
              capturadoPor: ator.id,
            },
            select: { id: true },
          });
          novas.push(criada.id);
        } catch (e) {
          // A rotina e o "Coletar agora" (ou o grupo de links) gravaram o mesmo post ao mesmo tempo.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') repetidas++;
          else throw e;
        }
      }
      const rateio = custoPorCaptura(r.custoUsd, novas.length);
      if (rateio !== null) {
        await this.prisma.pautaCaptura.updateMany({ where: { id: { in: novas } }, data: { custoUsd: rateio } });
      }
    } finally {
      await this.audit.log({
        orgId: f.orgId,
        actorType: ator.tipo,
        actorId: ator.id,
        action: 'pauta.coleta_perfil',
        entityType: 'pauta_fonte',
        entityId: f.id,
        after: { plataforma, handle, runId: r.runId, custoUsd: r.custoUsd, capturas: novas, repetidas },
      });
    }
    return { novas: novas.length, repetidas };
  }

  /**
   * A busca salva (MC3): uma consulta no Google do Brasil, última semana, e cada
   * resultado orgânico vira captura com a chave da tela. O teto do mês NÃO é
   * erro aqui, como no perfil desde o MC4: a rodada coleta a busca sozinha, e teto
   * atingido é o freio funcionando — pula com aviso na fonte e a rodada segue.
   */
  private async coletarBusca(f: PautaFonte, ator: AtorDaColeta, limite?: number): Promise<ResultadoDaColeta> {
    // Antes do MC3 o Radar cadastrava "Busca salva" sem consulta. O Radar não
    // edita a consulta: aviso na fonte, e não erro que suja a conta da rodada.
    if (!f.handle?.trim()) {
      return {
        novas: 0,
        repetidas: 0,
        pulada: true,
        aviso: `"${f.nome}" foi cadastrada sem consulta: remova e cadastre de novo com os termos da busca.`,
      };
    }
    const lida = lerConsulta(f.handle);
    if ('erro' in lida) throw new BadRequestException(lida.erro);
    const { consulta } = lida;
    // Antes de reservar: sem token não há run, e o teto não pode gastar o que não rodou.
    if (!this.apify.configured) {
      throw new ServiceUnavailableException(
        'A busca web roda no Apify. Defina APIFY_TOKEN no .env (ver .env.example) e reinicie a API.',
      );
    }

    const agora = new Date();
    const mes = agora.toISOString().slice(0, 7);
    if (!(await this.reservarRun(f, mes))) {
      return {
        novas: 0,
        repetidas: 0,
        pulada: true,
        aviso:
          `Teto de ${f.tetoRunsMes} execuções/mês atingido para "${f.nome}": a busca foi pulada. ` +
          'Aumente o teto ou espere virar o mês.',
      };
    }

    // O run já está contado: se o Apify falhar daqui em diante, cobrou do mesmo jeito.
    const r = await this.apify.buscarNoGoogle(consulta, {
      resultados: resultadosPedidos(limite),
      dias: DIAS_DA_JANELA_DA_BUSCA,
    });
    const { resultados, foraDaJanela } = resultadosDaBusca(r.items, agora);

    const novas: string[] = [];
    let repetidas = 0;
    try {
      for (const resultado of resultados) {
        const c = capturaDoResultado(resultado, consulta);
        const existe = await this.prisma.pautaCaptura.findUnique({
          where: { orgId_urlHash: { orgId: f.orgId, urlHash: c.urlHash } },
          select: { id: true },
        });
        if (existe) {
          repetidas++;
          continue;
        }
        try {
          const criada = await this.prisma.pautaCaptura.create({
            data: {
              orgId: f.orgId,
              fonteId: f.id,
              tipo: 'link',
              url: c.url,
              urlHash: c.urlHash,
              titulo: c.titulo,
              nota: c.nota,
              bruto: c.bruto as Prisma.InputJsonValue,
              apifyRunId: r.runId,
              capturadoPor: ator.id,
            },
            select: { id: true },
          });
          novas.push(criada.id);
        } catch (e) {
          // A rotina e o botão do Radar gravaram o mesmo link ao mesmo tempo.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') repetidas++;
          else throw e;
        }
      }

      const rateio = custoPorCaptura(r.custoUsd, novas.length);
      if (rateio !== null) {
        await this.prisma.pautaCaptura.updateMany({ where: { id: { in: novas } }, data: { custoUsd: rateio } });
      }
    } finally {
      // O gasto do run fica no RASTRO mesmo quando nada novo entrou ou a gravação caiu no meio.
      await this.audit.log({
        orgId: f.orgId,
        actorType: ator.tipo,
        actorId: ator.id,
        action: 'pauta.coleta_busca',
        entityType: 'pauta_fonte',
        entityId: f.id,
        after: { consulta, runId: r.runId, custoUsd: r.custoUsd, capturas: novas, repetidas, foraDaJanela },
      });
    }
    return { novas: novas.length, repetidas };
  }

  /**
   * Reserva o run ANTES de chamar o Apify, numa escrita condicional: a rotina e
   * o botão do Radar ao mesmo tempo não passam os dois pelo último run do teto,
   * como passariam lendo `runsNoMes` e somando depois.
   */
  private async reservarRun(f: PautaFonte, mes: string): Promise<boolean> {
    if (f.tetoRunsMes <= 0) return false;
    const virou = await this.prisma.pautaFonte.updateMany({
      where: { id: f.id, OR: [{ mesReferente: null }, { mesReferente: { not: mes } }] },
      data: { runsNoMes: 1, mesReferente: mes },
    });
    if (virou.count > 0) return true;
    const somou = await this.prisma.pautaFonte.updateMany({
      where: { id: f.id, mesReferente: mes, runsNoMes: { lt: f.tetoRunsMes } },
      data: { runsNoMes: { increment: 1 } },
    });
    return somou.count > 0;
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
