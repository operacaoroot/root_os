import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Prisma } from '@prisma/client';
import {
  PAUTA_DIMENSOES_DA_PECA,
  PAUTA_FORMATOS_DA_SEMANA,
  PAUTA_FORMATO_DA_SEMANA_ROTULO,
  PAUTA_PNG_DA_PECA_MAX_BYTES,
  PAUTA_STATUS_QUE_DERIVAM,
  conferirTrechoDoCorte,
  midiaDoEpisodio,
  motivoParaNaoDerivar,
  motivoParaNaoEditarASemana,
  type PautaEpisodioDetalhe,
  type PautaFormatoDaSemana,
  type PautaMateriaDaSemana,
  type PautaPecaDaSemana,
  type PautaPecaDaSemanaEditarInput,
  type PautaPecaStatus,
  type PautaSemanaDePosts,
  type PautaSemanaGerada,
  type PautaVideoDoCorteInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { RecusaDeCustoDeIaError } from '../llm/recusa-de-custo';
import { TetoIlegivelError } from '../llm/teto-diario.service';
import { SAIDA_DA_GERACAO_LONGA } from './saida-da-geracao';
import { EpisodioService } from './episodio.service';
import { VozService } from './voz.service';
import { lerTranscricao } from './episodio';
import { linkPublicoDoItem, semLinksDeCaixaDeEntrada } from './link-publico';
import { shaDaTranscricao } from './newsletter-do-episodio';
import type { Segmento } from './pacote-do-episodio';
import {
  carrosselComPalavra,
  chaveDaImagemDaPeca,
  chaveDoItem,
  conferirPngDaPeca,
  entradaDaDerivacao,
  ehPecaDaSemana,
  falaDoTrecho,
  legendaComCta,
  lerMetaDaSemana,
  montarDerivacao,
  numerosDoTrecho,
  palavraUnica,
  pecaQueVale,
  planoDaMateria,
  systemDaDerivacao,
  versaoDoTexto,
  type DerivacaoMontada,
  type MetaDaSemana,
} from './derivacao-do-episodio';

const MSG_CORRIDA = 'O episódio mudou enquanto isso (mídia refeita ou saiu da Derivação) — recarregue e tente de novo.';

interface LinhaDaPeca {
  id: string;
  rodadaId: string;
  canal: string;
  formato: string;
  titulo: string;
  corpo: string;
  meta: unknown;
  status: PautaPecaStatus;
  criadaEm: Date;
}

const DA_PECA = {
  id: true,
  rodadaId: true,
  canal: true,
  formato: true,
  titulo: true,
  corpo: true,
  meta: true,
  status: true,
  criadaEm: true,
} as const;

/** A duração do vídeo final: a da mídia (MC9); sem ela, o fim da transcrição. */
function duracaoDoEpisodio(e: Pick<PautaEpisodioDetalhe, 'midia' | 'transcricao'>): number {
  const midia = midiaDoEpisodio(e.midia);
  if (midia) return midia.duracaoSeg;
  return e.transcricao.length ? e.transcricao[e.transcricao.length - 1].fim : 0;
}

type Dados =
  | { formato: 'carrossel'; titulo: string; corpo: string; meta: Partial<MetaDaSemana> }
  | { formato: 'story'; titulo: string; corpo: string; meta: Partial<MetaDaSemana> }
  | { formato: 'corte'; titulo: string; corpo: string; meta: Partial<MetaDaSemana> };

/*
 * A SEMANA DE POSTS (MC15): cada matéria mantida do episódio vira um
 * carrossel, um story e um corte vertical para revisar, como PautaPeca do canal
 * instagram da rodada do episódio. Nada publica — o Instagram não publica pelo
 * OS até a D-MC8/MC17, e a peça sai pronta para postar. Os renders (PNG dos
 * slides e do story, mp4 do corte) são do Mac (`root-midia`).
 */
@Injectable()
export class DerivacaoService {
  private readonly log = new Logger('DerivacaoService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly vozes: VozService,
    private readonly storage: StorageService,
    private readonly episodios: EpisodioService,
  ) {}

  /** As peças da semana deste episódio, de qualquer status. A derivação antiga (sem `episodioId`) fica de fora. */
  private async pecasDoEpisodio(
    orgId: string,
    e: Pick<PautaEpisodioDetalhe, 'id' | 'rodadaId'>,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<LinhaDaPeca[]> {
    const pecas = (await db.pautaPeca.findMany({
      where: { orgId, rodadaId: e.rodadaId, canal: 'instagram', formato: { in: [...PAUTA_FORMATOS_DA_SEMANA] } },
      orderBy: { criadaEm: 'desc' },
      select: DA_PECA,
    })) as LinhaDaPeca[];
    return pecas.filter((p) => ehPecaDaSemana(p.meta, e.id));
  }

  private paraATela(p: LinhaDaPeca, shaAtual: string): PautaPecaDaSemana {
    const m = lerMetaDaSemana(p.meta);
    const formato = p.formato as PautaFormatoDaSemana;
    const base: PautaPecaDaSemana = {
      id: p.id,
      formato,
      status: p.status,
      titulo: p.titulo,
      corpo: p.corpo,
      criadaEm: p.criadaEm.toISOString(),
      imagens: m.imagens.map(({ n, largura, altura, bytes, enviadaEm }) => ({ n, largura, altura, bytes, enviadaEm })).sort((a, b) => a.n - b.n),
      avisos: m.avisos,
      transcricaoMudou: m.transcricaoSha !== shaAtual,
    };
    if (formato === 'carrossel') return { ...base, slides: m.slides ?? [], cta: m.cta, palavraChave: m.palavraChave };
    if (formato === 'story') return { ...base, chamada: m.chamada ?? '', tempoSeg: m.tempoSeg ?? null };
    return { ...base, inicio: m.inicio, fim: m.fim, trecho: m.trecho ?? '', video: m.video ?? null, palavraChave: m.palavraChave };
  }

  private montarSemana(e: PautaEpisodioDetalhe, pecas: LinhaDaPeca[]): PautaSemanaDePosts {
    const sha = shaDaTranscricao(e.transcricao);
    const materias: PautaMateriaDaSemana[] = e.itens.map((item, i) => {
      const itemId = chaveDoItem(item);
      const daMateria = pecas.filter((p) => lerMetaDaSemana(p.meta).itemId === itemId);
      const doFormato: PautaMateriaDaSemana['pecas'] = {};
      for (const f of PAUTA_FORMATOS_DA_SEMANA) {
        const p = pecaQueVale(daMateria, f);
        if (p) doFormato[f] = this.paraATela(p, sha);
      }
      return { n: i + 1, itemId, titulo: item.titulo, origem: item.origem ?? null, link: linkPublicoDoItem(item), pecas: doFormato };
    });
    const midia = midiaDoEpisodio(e.midia);
    return {
      episodioId: e.id,
      apelido: e.apelido,
      status: e.status,
      arquivoFinal: midia?.arquivoFinal ?? null,
      duracaoSeg: midia?.duracaoSeg ?? (e.transcricao.length ? duracaoDoEpisodio(e) : null),
      paginaDeLinks: e.paginaDeLinks?.publicada ? e.paginaDeLinks.url : null,
      motivo: motivoParaNaoDerivar(e.status, e.transcricao.length, e.itens.length),
      materias,
    };
  }

  async painel(orgId: string, id: string): Promise<PautaSemanaDePosts> {
    const e = await this.episodios.obter(orgId, id);
    return this.montarSemana(e, await this.pecasDoEpisodio(orgId, e));
  }

  /**
   * Gera a semana: uma chamada ao modelo por matéria (só as pedidas, e só as
   * que têm algum formato a refazer). Idempotente por (episódio, matéria,
   * formato): rascunho e descartada são substituídas no mesmo registro,
   * aprovada e publicada nunca são tocadas. Cada matéria grava na sua própria
   * transação, sob o cadeado do episódio e conferindo que a transcrição é a
   * mesma lida antes da IA: uma matéria que falha não leva as outras.
   */
  async gerar(
    orgId: string,
    id: string,
    actorId: string,
    opts: { substituir: boolean; itens?: number[] },
  ): Promise<PautaSemanaGerada> {
    const e = await this.episodios.obter(orgId, id);
    const motivo = motivoParaNaoDerivar(e.status, e.transcricao.length, e.itens.length);
    if (motivo) throw new BadRequestException(motivo);
    const fora = (opts.itens ?? []).filter((n) => n > e.itens.length);
    if (fora.length) throw new BadRequestException(`O episódio tem ${e.itens.length} matéria(s): não há a ${fora.join(', ')}.`);
    const alvos = [...new Set(opts.itens ?? e.itens.map((_, i) => i + 1))].sort((a, b) => a - b);

    const antes = await this.pecasDoEpisodio(orgId, e);
    const planos = new Map(
      alvos.map((n) => {
        const itemId = chaveDoItem(e.itens[n - 1]);
        return [n, planoDaMateria(antes.filter((p) => lerMetaDaSemana(p.meta).itemId === itemId))] as const;
      }),
    );
    const rascunhos = [...planos.values()].flatMap((pl) => Object.values(pl)).filter((a) => a.tipo === 'substituir' && a.status === 'rascunho');
    if (rascunhos.length && !opts.substituir) {
      throw new ConflictException(
        `Já há ${rascunhos.length} peça(s) em rascunho — confirme para substituir (as aprovadas e publicadas ficam como estão).`,
      );
    }
    const aFazer = alvos.filter((n) => Object.values(planos.get(n)!).some((a) => a.tipo !== 'manter'));
    const conta = { criadas: 0, substituidas: 0, mantidas: 0, falharam: 0 };
    const avisos: string[] = [];
    for (const n of alvos) {
      if (!aFazer.includes(n)) {
        conta.mantidas += PAUTA_FORMATOS_DA_SEMANA.length;
        avisos.push(`Matéria ${n}: as três peças já estão aprovadas ou publicadas — nada a gerar.`);
      }
    }
    if (aFazer.length && !this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }

    const sha = shaDaTranscricao(e.transcricao);
    const duracaoSeg = duracaoDoEpisodio(e);
    const system = aFazer.length ? systemDaDerivacao(await this.vozes.bloco(orgId)) : '';
    const porMateria: Array<Record<string, string | number | boolean>> = [];
    let corrida: ConflictException | null = null;

    for (const n of aFazer) {
      const item = e.itens[n - 1];
      const itemId = chaveDoItem(item);
      let montada: DerivacaoMontada;
      try {
        const saida = await this.llm.complete({
          system,
          user: entradaDaDerivacao({ apelido: e.apelido, titulo: e.titulo, item, n, total: e.itens.length, segmentos: e.transcricao, duracaoSeg }),
          // De quem é o gasto (RF-G-05), como nas outras chamadas da pauta.
          orgId,
          maxTokens: SAIDA_DA_GERACAO_LONGA,
        });
        montada = montarDerivacao(saida, { item, segmentos: e.transcricao, duracaoSeg });
      } catch (err) {
        // A IA fora do ar ou o JSON ruim numa matéria não derruba as outras. A
        // recusa por custo para o laço: as matérias seguintes bateriam nela do
        // mesmo jeito, e o que já foi gravado fica (com o status e o RASTRO).
        const msg = ((err as Error)?.message ?? 'falha desconhecida').slice(0, 300);
        const parar = err instanceof RecusaDeCustoDeIaError || err instanceof TetoIlegivelError;
        this.log.warn(`semana ${e.apelido} de ${orgId}, matéria ${n}: ${msg}`);
        const restantes = parar ? aFazer.filter((x) => x >= n) : [n];
        // O formato firme (aprovado/publicado) da matéria ficou como estava: é mantido, não falha.
        for (const acao of restantes.flatMap((x) => Object.values(planos.get(x)!))) {
          if (acao.tipo === 'manter') conta.mantidas++;
          else conta.falharam++;
        }
        avisos.push(parar ? `Matéria ${n} em diante: ${msg} — as seguintes não foram geradas.` : `Matéria ${n}: ${msg}`);
        porMateria.push({ n, itemId, falhou: msg, parou: parar });
        if (parar) break;
        continue;
      }

      let r: Awaited<ReturnType<DerivacaoService['gravarMateria']>>;
      try {
        r = await this.gravarMateria(orgId, e, { n, itemId, item, sha, montada });
      } catch (err) {
        // Mídia refeita ou episódio movido no meio: o que já foi gravado fica,
        // o RASTRO registra até onde foi, e a resposta é o 409.
        if (!(err instanceof ConflictException)) throw err;
        corrida = err;
        avisos.push(`Matéria ${n} em diante: ${err.message}`);
        porMateria.push({ n, itemId, corrida: true });
        break;
      }
      conta.criadas += r.criadas;
      conta.substituidas += r.substituidas;
      conta.mantidas += r.mantidas;
      conta.falharam += r.falharam;
      avisos.push(...montada.avisos.map((a) => `Matéria ${n} · ${a}`), ...r.avisos.map((a) => `Matéria ${n} · ${a}`));
      porMateria.push({ n, itemId, ...r.porFormato });
    }

    const escritas = conta.criadas + conta.substituidas;
    let statusDepois = e.status;
    if (escritas > 0 && e.status === 'pacote') {
      const r = await this.prisma.pautaEpisodio.updateMany({ where: { id, orgId, status: 'pacote' }, data: { status: 'derivacao' } });
      if (r.count > 0) statusDepois = 'derivacao';
    }

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.semana_gerada',
      entityType: 'pauta_episodio',
      entityId: id,
      before: { status: e.status, pecas: antes.map((p) => ({ id: p.id, formato: p.formato, status: p.status })) },
      after: {
        status: statusDepois,
        alvos,
        conta,
        materias: porMateria,
        provider: this.llm.name,
        model: this.llm.model,
      },
    });

    if (corrida) throw corrida;
    if (aFazer.length && escritas === 0 && conta.falharam > 0) {
      throw new ServiceUnavailableException(`Nenhuma peça foi gravada. ${avisos.join(' ')}`.slice(0, 1_500));
    }
    const semana = await this.painel(orgId, id);
    return { ...semana, conta, avisos };
  }

  /** Grava as peças de UMA matéria, sob o cadeado do episódio, com o plano relido lá dentro. */
  private async gravarMateria(
    orgId: string,
    e: PautaEpisodioDetalhe,
    m: { n: number; itemId: string; item: PautaEpisodioDetalhe['itens'][number]; sha: string; montada: DerivacaoMontada },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pauta-semana:${e.id}`}))`;
      const agora = await tx.pautaEpisodio.findFirst({ where: { id: e.id, orgId }, select: { status: true, transcricao: true } });
      if (
        !agora ||
        !(PAUTA_STATUS_QUE_DERIVAM as readonly string[]).includes(agora.status) ||
        shaDaTranscricao(lerTranscricao(agora.transcricao)) !== m.sha
      ) {
        throw new ConflictException(MSG_CORRIDA);
      }
      const todas = await this.pecasDoEpisodio(orgId, e, tx);
      const daMateria = todas.filter((p) => lerMetaDaSemana(p.meta).itemId === m.itemId);
      const plano = planoDaMateria(daMateria);
      const palavraDe = (id: string) => lerMetaDaSemana(daMateria.find((p) => p.id === id)?.meta).palavraChave;
      const usadas = todas
        .filter((p) => p.status !== 'descartada' && lerMetaDaSemana(p.meta).itemId !== m.itemId)
        .map((p) => lerMetaDaSemana(p.meta).palavraChave)
        .filter((w): w is string => !!w);
      // A palavra casa com a matéria (o DM do MC18): com um carrossel ou corte
      // firme, a matéria fica com a palavra dele; senão, a do modelo, única no episódio.
      const daFirme = [plano.carrossel, plano.corte]
        .map((a) => (a.tipo === 'manter' ? palavraDe(a.id) : undefined))
        .find((w): w is string => !!w);
      const palavra = daFirme ?? palavraUnica(m.montada.palavraChave, usadas, m.n);
      const avisoDaPalavra =
        palavra === m.montada.palavraChave
          ? []
          : daFirme
            ? [`A palavra ficou ${palavra}, a da peça já aprovada desta matéria.`]
            : [`A palavra ${m.montada.palavraChave} já era de outra matéria: ficou ${palavra}.`];

      const comum = {
        episodioId: e.id,
        itemId: m.itemId,
        itemN: m.n,
        transcricaoSha: m.sha,
        linkDaMateria: linkPublicoDoItem(m.item),
        imagens: [],
        provider: this.llm.name,
        model: this.llm.model,
      };
      const dados: Dados[] = [];
      const { carrossel, story, corte } = m.montada;
      if (carrossel) {
        const c = carrosselComPalavra(carrossel, palavra);
        dados.push({ formato: 'carrossel', titulo: c.titulo, corpo: c.corpo, meta: { slides: c.slides, cta: c.cta, palavraChave: c.palavraChave, avisos: avisoDaPalavra } });
      }
      if (story) dados.push({ formato: 'story', titulo: story.titulo, corpo: story.corpo, meta: { chamada: story.chamada, tempoSeg: story.tempoSeg, avisos: [] } });
      if (corte) {
        // A legenda do Reels/TikTok fecha com o mesmo CTA do carrossel: é a peça de maior alcance.
        dados.push({
          formato: 'corte',
          titulo: corte.titulo,
          corpo: legendaComCta(corte.corpo, palavra),
          meta: {
            inicio: corte.inicio,
            fim: corte.fim,
            de: corte.de,
            ate: corte.ate,
            trecho: corte.trecho,
            video: null,
            palavraChave: palavra,
            // O aviso da palavra vai no carrossel; se ele não for gravado agora, vai aqui.
            avisos: [...corte.avisos, ...(carrossel && plano.carrossel.tipo !== 'manter' ? [] : avisoDaPalavra)],
          },
        });
      }

      const r = { criadas: 0, substituidas: 0, mantidas: 0, falharam: 0, avisos: [] as string[], porFormato: {} as Record<string, string> };
      for (const formato of PAUTA_FORMATOS_DA_SEMANA) {
        const acao = plano[formato];
        const d = dados.find((x) => x.formato === formato);
        if (acao.tipo === 'manter') {
          r.mantidas++;
          r.porFormato[formato] = `mantida (${acao.status})`;
          continue;
        }
        if (!d) {
          r.falharam++;
          r.porFormato[formato] = 'falhou';
          if (acao.tipo === 'substituir') r.avisos.push(`${PAUTA_FORMATO_DA_SEMANA_ROTULO[formato]}: ficou a versão anterior.`);
          continue;
        }
        const meta = { ...comum, formato, ...d.meta } as unknown as Prisma.InputJsonValue;
        if (acao.tipo === 'substituir') {
          // Escrita condicionada ao status relido: aprovada no meio não é sobrescrita.
          const u = await tx.pautaPeca.updateMany({
            where: { id: acao.id, orgId, status: acao.status },
            data: { titulo: d.titulo.slice(0, 200), corpo: d.corpo, meta, status: 'rascunho', erro: null },
          });
          if (u.count === 0) throw new ConflictException(MSG_CORRIDA);
          r.substituidas++;
          r.porFormato[formato] = `substituiu ${acao.id}`;
        } else {
          const p = await tx.pautaPeca.create({
            data: { orgId, rodadaId: e.rodadaId, canal: 'instagram', formato, titulo: d.titulo.slice(0, 200), corpo: d.corpo, meta },
            select: { id: true },
          });
          r.criadas++;
          r.porFormato[formato] = `criou ${p.id}`;
        }
      }
      return r;
    });
  }

  private async pecaDaSemana(
    orgId: string,
    pecaId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<LinhaDaPeca & { m: MetaDaSemana }> {
    const p = (await db.pautaPeca.findFirst({ where: { id: pecaId, orgId }, select: DA_PECA })) as LinhaDaPeca | null;
    if (!p || !ehPecaDaSemana(p.meta)) throw new NotFoundException('Peça da semana não encontrada.');
    return { ...p, m: lerMetaDaSemana(p.meta) };
  }

  /**
   * Relê a peça sob o cadeado do episódio — o mesmo do `gerar` — e escreve na
   * mesma transação. As escritas aqui gravam a meta INTEIRA: montada de uma
   * leitura antiga, um `gerar` ou um `editar` no meio seria desfeito sem erro
   * (slides e palavra velhos por cima do texto novo).
   */
  private async comAPecaTravada<T>(
    orgId: string,
    pecaId: string,
    fn: (tx: Prisma.TransactionClient, p: LinhaDaPeca & { m: MetaDaSemana }) => Promise<T>,
  ): Promise<T> {
    const antes = await this.pecaDaSemana(orgId, pecaId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pauta-semana:${antes.m.episodioId}`}))`;
      return fn(tx, await this.pecaDaSemana(orgId, pecaId, tx));
    });
  }

  private exigirEditavel(p: { status: PautaPecaStatus }) {
    if (p.status === 'publicada') throw new BadRequestException('Peça já publicada — não dá para mexer.');
    if (p.status === 'descartada') throw new BadRequestException('Peça descartada — volte-a para rascunho antes de mexer.');
  }

  /**
   * Edita o texto de uma peça da semana. Cada formato aceita os seus campos. O
   * render que já subiu deixa de valer (é de outro texto) e a peça aprovada volta
   * ao rascunho: o que foi aprovado era o texto de antes. No corte, o mp4 só cai
   * quando o trecho muda — a legenda e o título não estão no vídeo.
   */
  async editar(orgId: string, pecaId: string, actorId: string, input: PautaPecaDaSemanaEditarInput): Promise<PautaSemanaDePosts> {
    const primeira = await this.pecaDaSemana(orgId, pecaId);
    const e = await this.episodios.obter(orgId, primeira.m.episodioId);
    const travado = motivoParaNaoEditarASemana(e.status);
    if (travado) throw new BadRequestException(travado);

    const feito = await this.comAPecaTravada(orgId, pecaId, async (tx, p) => {
      this.exigirEditavel(p);
      const formato = p.formato as PautaFormatoDaSemana;
      const permitidos: Record<PautaFormatoDaSemana, string[]> = {
        carrossel: ['titulo', 'legenda', 'slides', 'palavraChave'],
        story: ['titulo', 'texto', 'chamada'],
        corte: ['titulo', 'legenda', 'inicio', 'fim'],
      };
      const estranhos = Object.keys(input).filter((k) => !permitidos[formato].includes(k));
      if (estranhos.length) {
        throw new BadRequestException(`${PAUTA_FORMATO_DA_SEMANA_ROTULO[formato]} não tem ${estranhos.join(', ')}.`);
      }

      const limpo = (x: string) => semLinksDeCaixaDeEntrada(x).trim();
      let titulo = input.titulo !== undefined ? limpo(input.titulo) : p.titulo;
      let corpo = p.corpo;
      const meta: MetaDaSemana = { ...p.m };
      let trechoMudou = false;

      if (formato === 'carrossel') {
        let palavra = meta.palavraChave ?? 'LINK';
        if (input.palavraChave !== undefined && input.palavraChave !== palavra) {
          // A palavra é única entre as matérias (carrossel e corte): o DM casa a palavra com a matéria.
          const outras = (await this.pecasDoEpisodio(orgId, e, tx))
            .filter((x) => x.status !== 'descartada' && lerMetaDaSemana(x.meta).itemId !== meta.itemId)
            .map((x) => lerMetaDaSemana(x.meta).palavraChave);
          if (outras.includes(input.palavraChave)) throw new ConflictException(`A palavra ${input.palavraChave} já é de outra matéria deste episódio.`);
          palavra = input.palavraChave;
        }
        const conteudo = input.slides
          ? input.slides.map((x) => ({ titulo: limpo(x.titulo), texto: limpo(x.texto) }))
          : (meta.slides ?? []).slice(0, -1);
        if (conteudo.some((x) => !x.titulo && !x.texto)) throw new BadRequestException('Slide vazio: escreva o título ou o texto.');
        const c = carrosselComPalavra({ titulo, legenda: input.legenda !== undefined ? limpo(input.legenda) : corpo, slides: conteudo }, palavra);
        corpo = c.corpo;
        Object.assign(meta, { slides: c.slides, cta: c.cta, palavraChave: c.palavraChave, imagens: [] });
      } else if (formato === 'story') {
        if (input.texto !== undefined) corpo = limpo(input.texto);
        if (input.chamada !== undefined) meta.chamada = limpo(input.chamada);
        if (!corpo) throw new BadRequestException('O texto do story não pode ficar vazio.');
        meta.imagens = [];
      } else {
        if (input.legenda !== undefined) {
          const legenda = limpo(input.legenda);
          corpo = meta.palavraChave ? legendaComCta(legenda, meta.palavraChave) : legenda;
        }
        const igual = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) <= 0.01;
        if (input.inicio !== undefined && input.fim !== undefined && !(igual(meta.inicio, input.inicio) && igual(meta.fim, input.fim))) {
          const erro = conferirTrechoDoCorte(input.inicio, input.fim, duracaoDoEpisodio(e));
          if (erro) throw new BadRequestException(erro);
          const segs = e.transcricao as Segmento[];
          const numeros = numerosDoTrecho(segs, input.inicio, input.fim);
          trechoMudou = true;
          Object.assign(meta, {
            inicio: input.inicio,
            fim: input.fim,
            de: numeros.de,
            ate: numeros.ate,
            trecho: falaDoTrecho(segs, input.inicio, input.fim),
            // O trecho mudou: o mp4 renderizado é de outro trecho.
            video: null,
            transcricaoSha: shaDaTranscricao(e.transcricao),
          });
        }
      }
      if (!titulo) titulo = p.titulo;

      const r = await tx.pautaPeca.updateMany({
        where: { id: p.id, orgId, status: p.status },
        data: { titulo: titulo.slice(0, 200), corpo, meta: meta as unknown as Prisma.InputJsonValue, status: 'rascunho' },
      });
      if (r.count === 0) throw new ConflictException('A peça mudou enquanto isso — recarregue e tente de novo.');
      return {
        p,
        formato,
        renderDescartado: formato === 'corte' ? trechoMudou && !!p.m.video : p.m.imagens.length > 0,
      };
    });

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.semana_peca_editada',
      entityType: 'pauta_peca',
      entityId: feito.p.id,
      before: { status: feito.p.status, formato: feito.formato },
      after: { status: 'rascunho', campos: Object.keys(input), renderDescartado: feito.renderDescartado },
    });
    return this.montarSemana(e, await this.pecasDoEpisodio(orgId, e));
  }

  /**
   * O PNG que o Mac renderizou: um por slide do carrossel, um para o story. Vai
   * ao storage da casa (MinIO, não público) com o hash no nome; a peça guarda a
   * chave. Trocar grava outra chave em vez de sobrescrever. Se o texto da peça
   * mudou enquanto o PNG subia, o PNG é do texto velho: 409.
   */
  async enviarImagem(
    orgId: string,
    pecaId: string,
    actorId: string,
    n: number,
    arquivo: { buffer: Buffer; mimetype: string; size?: number } | undefined,
  ): Promise<PautaPecaDaSemana> {
    const antes = await this.pecaDaSemana(orgId, pecaId);
    this.exigirEditavel(antes);
    if (antes.formato !== 'carrossel' && antes.formato !== 'story') {
      throw new BadRequestException('O corte vertical não sobe imagem: o mp4 fica no Mac (registre por PUT …/video).');
    }
    const quantas = antes.formato === 'story' ? 1 : (antes.m.slides ?? []).length;
    if (n > quantas) throw new BadRequestException(`Esta peça tem ${quantas} imagem(ns): não há a ${n}.`);
    const conferido = conferirPngDaPeca(arquivo, PAUTA_DIMENSOES_DA_PECA[antes.formato], PAUTA_PNG_DA_PECA_MAX_BYTES);
    if (!conferido.ok) throw new BadRequestException(conferido.motivo);

    const buffer = arquivo!.buffer;
    const sha = createHash('sha256').update(buffer).digest('hex');
    const chave = chaveDaImagemDaPeca(antes.id, n, sha);
    await this.storage.put(chave, buffer, 'image/png');
    const imagem = { n, chave, sha: sha.slice(0, 12), largura: conferido.largura, altura: conferido.altura, bytes: buffer.length, enviadaEm: new Date().toISOString() };

    const { p, meta } = await this.comAPecaTravada(orgId, pecaId, async (tx, p) => {
      this.exigirEditavel(p);
      if (versaoDoTexto(p) !== versaoDoTexto(antes)) {
        throw new ConflictException('O texto da peça mudou enquanto o PNG subia — renderize de novo no Mac.');
      }
      const meta = { ...p.m, imagens: [...p.m.imagens.filter((i) => i.n !== n), imagem].sort((a, b) => a.n - b.n) };
      const r = await tx.pautaPeca.updateMany({
        where: { id: p.id, orgId, status: p.status },
        data: { meta: meta as unknown as Prisma.InputJsonValue },
      });
      if (r.count === 0) throw new ConflictException('A peça mudou enquanto isso — recarregue e tente de novo.');
      return { p, meta };
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.semana_imagem',
      entityType: 'pauta_peca',
      entityId: p.id,
      before: { n, tinha: p.m.imagens.some((i) => i.n === n) },
      after: { n, bytes: imagem.bytes, largura: imagem.largura, altura: imagem.altura, sha: imagem.sha },
    });
    return this.paraATela({ ...p, meta }, p.m.transcricaoSha);
  }

  async imagem(orgId: string, pecaId: string, n: number): Promise<{ stream: Readable; size: number }> {
    const p = await this.pecaDaSemana(orgId, pecaId);
    const alvo = p.m.imagens.find((i) => i.n === n);
    if (!alvo) throw new NotFoundException(`A imagem ${n} desta peça ainda não foi renderizada.`);
    try {
      const { stream, size } = await this.storage.get(alvo.chave);
      return { stream, size };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.log.warn(`imagem ${n} da peça ${pecaId} (${orgId}) sumiu do storage: ${(err as Error).message}`);
      throw new NotFoundException(`A imagem ${n} não está no storage — renderize de novo no Mac.`);
    }
  }

  /**
   * O corte renderizado no Mac: o mp4 FICA lá (como o vídeo do episódio, MC9),
   * e a peça guarda onde ele está e o que foi medido. A duração tem de bater com
   * o trecho da peça — senão o mp4 é de outro trecho.
   */
  async registrarVideo(orgId: string, pecaId: string, actorId: string, input: PautaVideoDoCorteInput): Promise<PautaPecaDaSemana> {
    const { p, meta } = await this.comAPecaTravada(orgId, pecaId, async (tx, p) => {
      this.exigirEditavel(p);
      if (p.formato !== 'corte') throw new BadRequestException('Só o corte vertical tem vídeo.');
      if (p.m.inicio === undefined || p.m.fim === undefined) throw new BadRequestException('A peça não tem o trecho do corte.');
      const esperado = p.m.fim - p.m.inicio;
      if (Math.abs(input.duracaoSeg - esperado) > 1) {
        throw new BadRequestException(
          `O vídeo tem ${input.duracaoSeg.toFixed(1)} s e o trecho da peça, ${esperado.toFixed(1)} s: renderize o corte de novo.`,
        );
      }
      const meta = { ...p.m, video: { ...input, registradoEm: new Date().toISOString() } };
      const r = await tx.pautaPeca.updateMany({
        where: { id: p.id, orgId, status: p.status },
        data: { meta: meta as unknown as Prisma.InputJsonValue },
      });
      if (r.count === 0) throw new ConflictException('A peça mudou enquanto isso — recarregue e tente de novo.');
      return { p, meta };
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.semana_video',
      entityType: 'pauta_peca',
      entityId: p.id,
      // O caminho do Mac fica fora do RASTRO: só o nome do arquivo, como na mídia do MC9.
      after: { arquivo: input.arquivo.split('/').pop(), duracaoSeg: input.duracaoSeg, bytes: input.bytes },
    });
    return this.paraATela({ ...p, meta }, p.m.transcricaoSha);
  }
}
