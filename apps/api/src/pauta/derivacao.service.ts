import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { pipeline, type Readable } from 'node:stream';
import type { Prisma } from '@prisma/client';
import {
  PAUTA_DIMENSOES_DA_PECA,
  PAUTA_DIMENSOES_DO_CORTE,
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
  type PautaVideoDaPeca,
  type PautaVideoDoCorteInput,
} from '@mktos/shared';
import { conferirJpegDaPeca } from './imagem-jpeg';
import { ConferenciaDoMp4, ErroDoEnvio, chaveDoVideoDaPeca, type CabecalhoDoEnvio } from './video-do-corte';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { RecusaDeCustoDeIaError } from '../llm/recusa-de-custo';
import { TetoIlegivelError } from '../llm/teto-diario.service';
import { SAIDA_DA_GERACAO_LONGA } from './saida-da-geracao';
import { EpisodioService } from './episodio.service';
import { VozService } from './voz.service';
import { MarcaService } from './marca.service';
import { lerTranscricao } from './episodio';
import { linkPublicoDoItem, semLinksDeCaixaDeEntrada } from './link-publico';
import { shaDaTranscricao } from './newsletter-do-episodio';
import { postagemDaPeca } from './agenda-da-semana';
import type { Segmento } from './pacote-do-episodio';
import {
  candidatoGravado,
  candidatosParaATela,
  carrosselComPalavra,
  chaveDaImagemDaPeca,
  chaveDoItem,
  conferirPngDaPeca,
  entradaDaDerivacao,
  tipoDaImagem,
  ehPecaDaSemana,
  falaDoTrecho,
  legendaComCta,
  lerMetaDaSemana,
  mesmoTrecho,
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
import { umaPorVez } from './uma-por-vez';
import { LotesService } from '../approvals/lotes.service';
import { filtroDoItemAssinado, revogarItemDaPeca } from './lote-da-semana';

const MSG_CORRIDA = 'O episódio mudou enquanto isso (mídia refeita ou saiu da Derivação) — recarregue e tente de novo.';
const MSG_TRANSCRICAO_MUDOU =
  'A transcrição mudou depois desta peça (a mídia foi refeita): edite o trecho ou gere a semana de novo antes de renderizar.';

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
  agendadaPara?: Date | null;
  publicadaEm?: Date | null;
  externalId?: string | null;
  urlPublicada?: string | null;
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
  agendadaPara: true,
  publicadaEm: true,
  externalId: true,
  urlPublicada: true,
} as const;

/** As imagens de um tipo, como a tela e o Mac as leem (sem a chave do storage). */
function imagensDoTipo(imagens: MetaDaSemana['imagens'], tipo: 'png' | 'jpeg') {
  return imagens
    .filter((i) => tipoDaImagem(i) === tipo)
    .map(({ n, largura, altura, bytes, enviadaEm, sha256 }) => ({ n, largura, altura, bytes, enviadaEm, ...(sha256 ? { sha256 } : {}) }))
    .sort((a, b) => a.n - b.n);
}

/** O corte: o mp4 subiu ao storage, com a chave e o sha256 (MD4). */
const videoNoStorage = (v: MetaDaSemana['video']): v is PautaVideoDaPeca & { chave: string; sha256: string } =>
  !!v?.chave && !!v.sha256;

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
    /** MK1: a marca e os pilares, ao lado da voz no mesmo prompt. */
    private readonly marcas: MarcaService,
    /** MD8: mexer na peça depois do lote da semana revoga o item dela. Global; opcional nas suítes. */
    @Optional() private readonly lotes?: LotesService,
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
      imagens: imagensDoTipo(m.imagens, 'png'),
      jpegs: imagensDoTipo(m.imagens, 'jpeg'),
      avisos: m.avisos,
      transcricaoMudou: m.transcricaoSha !== shaAtual,
      agendadaPara: p.agendadaPara?.toISOString() ?? null,
      postada: postagemDaPeca({
        status: p.status,
        publicadaEm: p.publicadaEm ?? null,
        externalId: p.externalId ?? null,
        urlPublicada: p.urlPublicada ?? null,
      }),
    };
    if (formato === 'carrossel') return { ...base, slides: m.slides ?? [], cta: m.cta, palavraChave: m.palavraChave };
    if (formato === 'story') return { ...base, chamada: m.chamada ?? '', tempoSeg: m.tempoSeg ?? null };
    return {
      ...base,
      inicio: m.inicio,
      fim: m.fim,
      trecho: m.trecho ?? '',
      video: m.video ?? null,
      palavraChave: m.palavraChave,
      candidatos: candidatosParaATela(m),
    };
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
  gerar(orgId: string, id: string, actorId: string, opts: { substituir: boolean; itens?: number[] }): Promise<PautaSemanaGerada> {
    return umaPorVez(`pauta-semana:${orgId}:${id}`, 'A geração da semana deste episódio', () => this.gerarAgora(orgId, id, actorId, opts));
  }

  private async gerarAgora(
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
    const system = aFazer.length
      ? systemDaDerivacao(await this.vozes.bloco(orgId), await this.marcas.bloco(orgId))
      : '';
    const porMateria: Array<Record<string, string | number | boolean>> = [];
    let corrida: ConflictException | null = null;

    for (const n of aFazer) {
      const item = e.itens[n - 1];
      const itemId = chaveDoItem(item);
      let montada: DerivacaoMontada;
      try {
        const saida = await this.llm.complete({
          funcao: 'CT-08',
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
            cortesCandidatos: m.montada.cortesCandidatos.map(candidatoGravado),
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
            // O slot proposto (MD1) era do texto anterior: a peça nova volta a esperar proposta.
            data: { titulo: d.titulo.slice(0, 200), corpo: d.corpo, meta, status: 'rascunho', erro: null, slotProposto: null },
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

  /**
   * O corte e o story são tempos do vídeo: gerados de outra transcrição, o mp4
   * e o frame que o Mac manda saem de outro trecho do vídeo novo, e a duração
   * pode bater por acaso. Só a peça da transcrição atual recebe render.
   */
  private async exigirATranscricaoDaPeca(tx: Prisma.TransactionClient, orgId: string, p: { m: MetaDaSemana }) {
    const e = await tx.pautaEpisodio.findFirst({ where: { id: p.m.episodioId, orgId }, select: { transcricao: true } });
    if (!e || shaDaTranscricao(lerTranscricao(e.transcricao)) !== p.m.transcricaoSha) {
      throw new ConflictException(MSG_TRANSCRICAO_MUDOU);
    }
  }

  /**
   * A peça tem item num lote da semana ASSINADO e válido (MD8)? Leitura na
   * transação de quem vai mexer. O lote só montado, ou na fila, não conta: nele
   * a troca de mídia só revoga o item.
   */
  private async temItemAssinado(tx: Prisma.TransactionClient, orgId: string, pecaId: string): Promise<boolean> {
    if (!this.lotes) return false;
    return !!(await tx.itemDoLote.findFirst({ where: filtroDoItemAssinado(orgId, pecaId, new Date()), select: { id: true } }));
  }

  /**
   * A mídia do lote trocada depois da assinatura: a peça aprovada volta a
   * rascunho, fora da agenda, como no refazer mídia (MD8 item 5). Sem lote
   * assinado, a aprovada segue aprovada — o manual (MC16) não muda.
   */
  private foraDaAgendaSeSaiDoLote(status: PautaPecaStatus, saiDoLote: boolean) {
    return saiDoLote && status === 'aprovada' ? { status: 'rascunho' as const, agendadaPara: null } : {};
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
        corte: ['titulo', 'legenda', 'inicio', 'fim', 'candidato'],
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
      let candidato: { n: number; nota: number | null } | null = null;

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
        const shaAtual = shaDaTranscricao(e.transcricao);
        if (input.candidato !== undefined) {
          const lista = meta.cortesCandidatos ?? [];
          const c = lista[input.candidato - 1];
          if (!c) throw new BadRequestException(`Este corte tem ${lista.length} candidato(s): não há o ${input.candidato}.`);
          // Os candidatos são tempos do vídeo de quando a semana foi gerada.
          if (meta.transcricaoSha !== shaAtual) {
            throw new ConflictException('A transcrição mudou depois destes candidatos (a mídia foi refeita): gere a semana de novo.');
          }
          const erro = conferirTrechoDoCorte(c.inicio, c.fim, duracaoDoEpisodio(e));
          if (erro) throw new BadRequestException(`O candidato ${input.candidato} não serve mais: ${erro}`);
          candidato = { n: input.candidato, nota: c.nota };
          if (input.titulo === undefined) titulo = c.titulo || titulo;
          // Os ajustes do sistema ao trecho (encurtou, cresceu) são do candidato em uso.
          const dosCandidatos = new Set(lista.flatMap((x) => x.avisos ?? []));
          meta.avisos = [...(c.avisos ?? []), ...meta.avisos.filter((a) => !dosCandidatos.has(a))];
          if (!mesmoTrecho(meta, c)) {
            trechoMudou = true;
            // O mp4 renderizado é de outro trecho: sai da peça (o objeto no storage fica) e o vigia renderiza de novo.
            Object.assign(meta, { inicio: c.inicio, fim: c.fim, de: c.de, ate: c.ate, trecho: c.trecho, video: null });
          }
        } else if (input.inicio !== undefined && input.fim !== undefined && !mesmoTrecho(meta, { inicio: input.inicio, fim: input.fim })) {
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
            transcricaoSha: shaAtual,
            // Os candidatos de outra transcrição apontariam outra fala do vídeo novo.
            ...(meta.transcricaoSha !== shaAtual ? { cortesCandidatos: [] } : {}),
          });
        }
      }
      if (!titulo) titulo = p.titulo;
      // Voltar a um trecho já renderizado repetiria a assinatura do vigia (MD2), que a pula por 24 h.
      if (trechoMudou) meta.renderPedidoEm = new Date().toISOString();

      const r = await tx.pautaPeca.updateMany({
        where: { id: p.id, orgId, status: p.status },
        // Volta ao rascunho, então sai da agenda (MC16): o slot é da peça aprovada.
        data: { titulo: titulo.slice(0, 200), corpo, meta: meta as unknown as Prisma.InputJsonValue, status: 'rascunho', agendadaPara: null },
      });
      if (r.count === 0) throw new ConflictException('A peça mudou enquanto isso — recarregue e tente de novo.');
      return {
        p,
        formato,
        candidato,
        trecho: trechoMudou ? { antes: { inicio: p.m.inicio, fim: p.m.fim }, depois: { inicio: meta.inicio, fim: meta.fim } } : null,
        tituloMudou: titulo.slice(0, 200) !== p.titulo,
        renderDescartado: formato === 'corte' ? trechoMudou && !!p.m.video : p.m.imagens.length > 0,
      };
    });
    const itemDoLoteRevogado = await revogarItemDaPeca(this.lotes, this.log, orgId, feito.p.id, 'o texto da peça foi editado', actorId);

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.semana_peca_editada',
      entityType: 'pauta_peca',
      entityId: feito.p.id,
      before: { status: feito.p.status, formato: feito.formato, ...(feito.trecho ? { trecho: feito.trecho.antes } : {}) },
      after: {
        status: 'rascunho',
        // O candidato traz o gancho dele como título: a troca muda o título sem o campo vir no pedido.
        campos: [...Object.keys(input), ...(feito.tituloMudou && input.titulo === undefined ? ['titulo'] : [])],
        ...(feito.trecho ? { trecho: feito.trecho.depois } : {}),
        renderDescartado: feito.renderDescartado,
        ...(feito.candidato ? { candidato: feito.candidato } : {}),
        saiuDaAgenda: !!feito.p.agendadaPara,
        ...(itemDoLoteRevogado ? { itemDoLoteRevogado } : {}),
      },
    });
    return this.montarSemana(e, await this.pecasDoEpisodio(orgId, e));
  }

  /**
   * A imagem que o Mac renderizou: um PNG por slide do carrossel, um para o
   * story — e, desde a MD4, o JPEG de cada uma, que é o que a Graph da Meta
   * baixa. Vai ao storage da casa (MinIO, não público) com o hash no nome; a
   * peça guarda a chave, no máximo uma por número e tipo. Trocar grava outra
   * chave em vez de sobrescrever. Se o texto da peça mudou enquanto a imagem
   * subia, ela é do texto velho: 409.
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
      throw new BadRequestException('O corte vertical não sobe imagem: o mp4 sobe por POST …/video/arquivo.');
    }
    const quantas = antes.formato === 'story' ? 1 : (antes.m.slides ?? []).length;
    if (n > quantas) throw new BadRequestException(`Esta peça tem ${quantas} imagem(ns): não há a ${n}.`);
    const tipo: 'png' | 'jpeg' = arquivo?.mimetype === 'image/jpeg' ? 'jpeg' : 'png';
    const conferido =
      tipo === 'jpeg'
        ? conferirJpegDaPeca(arquivo, PAUTA_DIMENSOES_DA_PECA[antes.formato])
        : conferirPngDaPeca(arquivo, PAUTA_DIMENSOES_DA_PECA[antes.formato], PAUTA_PNG_DA_PECA_MAX_BYTES);
    if (!conferido.ok) throw new BadRequestException(conferido.motivo);

    const buffer = arquivo!.buffer;
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const chave = chaveDaImagemDaPeca(antes.id, n, sha256, tipo);
    await this.storage.put(chave, buffer, tipo === 'jpeg' ? 'image/jpeg' : 'image/png');
    const imagem = {
      n,
      chave,
      sha: sha256.slice(0, 12),
      sha256,
      tipo,
      largura: conferido.largura,
      altura: conferido.altura,
      bytes: buffer.length,
      enviadaEm: new Date().toISOString(),
    };

    const { p, meta, trocou, saiDoLote, status } = await this.comAPecaTravada(orgId, pecaId, async (tx, p) => {
      this.exigirEditavel(p);
      if (p.formato === 'story') await this.exigirATranscricaoDaPeca(tx, orgId, p);
      if (versaoDoTexto(p) !== versaoDoTexto(antes)) {
        throw new ConflictException('O texto da peça mudou enquanto a imagem subia — renderize de novo no Mac.');
      }
      const outras = p.m.imagens.filter((i) => i.n !== n || tipoDaImagem(i) !== tipo);
      const meta = { ...p.m, imagens: [...outras, imagem].sort((a, b) => a.n - b.n || tipoDaImagem(a).localeCompare(tipoDaImagem(b))) };
      // O JPEG é o que a Meta baixa e entra no hash do item do lote (MD8): trocado, a peça sai do lote.
      const antigo = p.m.imagens.find((i) => i.n === n && tipoDaImagem(i) === 'jpeg');
      const trocou = tipo === 'jpeg' && antigo?.sha256 !== sha256;
      const saiDoLote = trocou && (await this.temItemAssinado(tx, orgId, p.id));
      const r = await tx.pautaPeca.updateMany({
        where: { id: p.id, orgId, status: p.status },
        data: { meta: meta as unknown as Prisma.InputJsonValue, ...this.foraDaAgendaSeSaiDoLote(p.status, saiDoLote) },
      });
      if (r.count === 0) throw new ConflictException('A peça mudou enquanto isso — recarregue e tente de novo.');
      return { p, meta, trocou, saiDoLote, status: saiDoLote && p.status === 'aprovada' ? ('rascunho' as const) : p.status };
    });
    if (trocou) await revogarItemDaPeca(this.lotes, this.log, orgId, p.id, `o JPEG ${n} da peça foi trocado`, actorId);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.semana_imagem',
      entityType: 'pauta_peca',
      entityId: p.id,
      before: { n, tipo, tinha: p.m.imagens.some((i) => i.n === n && tipoDaImagem(i) === tipo) },
      after: { n, tipo, bytes: imagem.bytes, largura: imagem.largura, altura: imagem.altura, sha: imagem.sha, ...(saiDoLote ? { saiuDoLote: true, status } : {}) },
    });
    return this.paraATela({ ...p, meta, status, ...(status !== p.status ? { agendadaPara: null } : {}) }, p.m.transcricaoSha);
  }

  /** A imagem n da peça: o PNG (a prévia), ou o JPEG com `tipo`. */
  async imagem(
    orgId: string,
    pecaId: string,
    n: number,
    tipo: 'png' | 'jpeg' = 'png',
  ): Promise<{ stream: Readable; size: number; contentType: string }> {
    const p = await this.pecaDaSemana(orgId, pecaId);
    const alvo = p.m.imagens.find((i) => i.n === n && tipoDaImagem(i) === tipo);
    const rotulo = tipo === 'jpeg' ? 'O JPEG' : 'A imagem';
    if (!alvo) throw new NotFoundException(`${rotulo} ${n} desta peça ainda não foi renderizad${tipo === 'jpeg' ? 'o' : 'a'}.`);
    const { stream, size } = await this.lerDoStorage(alvo.chave, `${tipo} ${n} da peça ${pecaId} (${orgId})`, `${rotulo} ${n} não está no storage — renderize de novo no Mac.`);
    return { stream, size, contentType: tipo === 'jpeg' ? 'image/jpeg' : 'image/png' };
  }

  private async lerDoStorage(chave: string, oQue: string, msg404: string): Promise<{ stream: Readable; size: number }> {
    try {
      const { stream, size } = await this.storage.get(chave);
      return { stream, size };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.log.warn(`${oQue} sumiu do storage: ${(err as Error).message}`);
      throw new NotFoundException(msg404);
    }
  }

  /**
   * O corte renderizado no Mac (MC15): a peça guarda onde o mp4 está e o que foi
   * medido. A duração tem de bater com o trecho da peça — senão o mp4 é de outro
   * trecho. Registrar de novo é outro render: o envio anterior ao storage (MD4)
   * deixa de valer, e o Mac sobe o arquivo novo em seguida.
   */
  async registrarVideo(orgId: string, pecaId: string, actorId: string, input: PautaVideoDoCorteInput): Promise<PautaPecaDaSemana> {
    const feitoVideo = await this.comAPecaTravada(orgId, pecaId, async (tx, p) => {
      this.exigirEditavel(p);
      this.exigirTrechoDoCorte(p);
      await this.exigirATranscricaoDaPeca(tx, orgId, p);
      this.exigirORenderDoTrecho(p, input);
      this.exigirDuracaoDoTrecho(p, input.duracaoSeg);
      const registro = { arquivo: input.arquivo, duracaoSeg: input.duracaoSeg, largura: input.largura, altura: input.altura, bytes: input.bytes };
      const meta = { ...p.m, video: { ...registro, registradoEm: new Date().toISOString() } };
      // Render novo tira o mp4 do storage da peça: o item do lote (MD8) cobria o de antes.
      const trocou = videoNoStorage(p.m.video);
      const saiDoLote = trocou && (await this.temItemAssinado(tx, orgId, p.id));
      const r = await tx.pautaPeca.updateMany({
        where: { id: p.id, orgId, status: p.status },
        data: { meta: meta as unknown as Prisma.InputJsonValue, ...this.foraDaAgendaSeSaiDoLote(p.status, saiDoLote) },
      });
      if (r.count === 0) throw new ConflictException('A peça mudou enquanto isso — recarregue e tente de novo.');
      return { p, meta, trocou, saiDoLote };
    });
    if (feitoVideo.trocou) await revogarItemDaPeca(this.lotes, this.log, orgId, feitoVideo.p.id, 'o corte foi renderizado de novo', actorId);
    const { p, meta } = feitoVideo;
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

  private exigirTrechoDoCorte(p: { formato: string; m: MetaDaSemana }): asserts p is { formato: 'corte'; m: MetaDaSemana & { inicio: number; fim: number } } {
    if (p.formato !== 'corte') throw new BadRequestException('Só o corte vertical tem vídeo.');
    if (p.m.inicio === undefined || p.m.fim === undefined) throw new BadRequestException('A peça não tem o trecho do corte.');
  }

  /**
   * O Mac diz de que trecho renderizou (MD13): a troca de candidato no meio de
   * um render deixaria um mp4 de outra fala com a mesma duração passar pela
   * conferência da duração. O Mac antigo não manda, e fica só a duração.
   */
  private exigirORenderDoTrecho(p: { m: MetaDaSemana }, render: { inicio?: number; fim?: number }): void {
    if (render.inicio === undefined || render.fim === undefined) return;
    if (!mesmoTrecho(p.m, { inicio: render.inicio, fim: render.fim })) {
      throw new ConflictException(
        `O mp4 é do trecho ${render.inicio.toFixed(1)}–${render.fim.toFixed(1)} s e a peça agora usa ${(p.m.inicio ?? 0).toFixed(1)}–${(p.m.fim ?? 0).toFixed(1)} s: renderize o corte de novo.`,
      );
    }
  }

  private exigirDuracaoDoTrecho(p: { m: MetaDaSemana }, duracaoSeg: number): void {
    const esperado = (p.m.fim ?? 0) - (p.m.inicio ?? 0);
    if (Math.abs(duracaoSeg - esperado) > 1) {
      throw new BadRequestException(
        `O vídeo tem ${duracaoSeg.toFixed(1)} s e o trecho da peça, ${esperado.toFixed(1)} s: renderize o corte de novo.`,
      );
    }
  }

  /**
   * O mp4 do corte sobe ao storage (MD4), por stream, para a Meta poder baixar
   * por URL assinada. Tudo o que dá para recusar sem ler o corpo é recusado
   * antes (peça, formato, status, transcrição); lido o `moov`, a duração tem de
   * bater com o trecho, e o vídeo, ser 1080×1920 — senão o envio aborta ali. O
   * arquivo vai à chave `pauta/pecas/<id>/corte-<sha256>.mp4`: o mesmo arquivo
   * reenviado cai na mesma chave, e nada é apagado. O caminho no Mac, se
   * registrado, fica.
   */
  async enviarVideo(
    orgId: string,
    pecaId: string,
    actorId: string,
    envio: CabecalhoDoEnvio & { corpo: Readable },
  ): Promise<PautaPecaDaSemana> {
    const antes = await this.pecaDaSemana(orgId, pecaId);
    this.exigirEditavel(antes);
    this.exigirTrechoDoCorte(antes);
    // Conferido contra `antes`; o trecho que mudar durante o envio cai na comparação com a peça travada, lá embaixo.
    this.exigirORenderDoTrecho(antes, envio.trecho ?? {});
    await this.exigirATranscricaoDaPeca(this.prisma as unknown as Prisma.TransactionClient, orgId, antes);

    const conferencia = new ConferenciaDoMp4(envio, (moov) => {
      if (moov.duracaoSeg === null) throw new ErroDoEnvio(400, 'O mp4 não diz a duração (mvhd).');
      this.exigirDuracaoDoTrecho(antes, moov.duracaoSeg);
      if (moov.largura !== PAUTA_DIMENSOES_DO_CORTE.largura || moov.altura !== PAUTA_DIMENSOES_DO_CORTE.altura) {
        throw new ErroDoEnvio(
          400,
          `O corte tem ${moov.largura ?? '?'}×${moov.altura ?? '?'}; é ${PAUTA_DIMENSOES_DO_CORTE.largura}×${PAUTA_DIMENSOES_DO_CORTE.altura}.`,
        );
      }
    });
    const chave = chaveDoVideoDaPeca(antes.id, envio.sha256);
    // `pipeline` leva o erro de um lado ao outro: a conexão caída destrói a
    // conferência (e o storage aborta), e a recusa da conferência para de ler.
    pipeline(envio.corpo, conferencia, () => undefined);
    try {
      await this.storage.putStream(chave, conferencia, envio.bytes, 'video/mp4');
    } catch (e) {
      conferencia.destroy();
      throw this.erroDoEnvio(e);
    }
    const lido = conferencia.resultado;
    if (!lido || lido.duracaoSeg === null) throw new BadRequestException('O mp4 não foi conferido até o fim.');
    const video = {
      bytes: lido.bytes,
      duracaoSeg: lido.duracaoSeg,
      largura: PAUTA_DIMENSOES_DO_CORTE.largura,
      altura: PAUTA_DIMENSOES_DO_CORTE.altura,
      chave,
      sha256: lido.sha256,
      enviadoEm: new Date().toISOString(),
    };

    const { p, meta, trocou } = await this.comAPecaTravada(orgId, pecaId, async (tx, p) => {
      this.exigirEditavel(p);
      await this.exigirATranscricaoDaPeca(tx, orgId, p);
      // Só o que está no vídeo: editar o título ou a legenda durante o envio não derruba o mp4.
      const trecho = (x: { m: MetaDaSemana }) => JSON.stringify([x.m.inicio ?? null, x.m.fim ?? null, x.m.transcricaoSha ?? null]);
      if (trecho(p) !== trecho(antes)) {
        throw new ConflictException('O trecho da peça mudou enquanto o mp4 subia — renderize o corte de novo no Mac.');
      }
      const meta = {
        ...p.m,
        video: { arquivo: p.m.video?.arquivo ?? null, ...(p.m.video?.registradoEm ? { registradoEm: p.m.video.registradoEm } : {}), ...video },
      };
      const trocou = p.m.video?.sha256 !== video.sha256;
      const saiDoLote = trocou && (await this.temItemAssinado(tx, orgId, p.id));
      const r = await tx.pautaPeca.updateMany({
        where: { id: p.id, orgId, status: p.status },
        data: { meta: meta as unknown as Prisma.InputJsonValue, ...this.foraDaAgendaSeSaiDoLote(p.status, saiDoLote) },
      });
      if (r.count === 0) throw new ConflictException('A peça mudou enquanto isso — recarregue e tente de novo.');
      return { p, meta, trocou };
    });
    if (trocou) await revogarItemDaPeca(this.lotes, this.log, orgId, p.id, 'o mp4 do corte foi trocado', actorId);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.semana_video_enviado',
      entityType: 'pauta_peca',
      entityId: p.id,
      before: { tinha: videoNoStorage(p.m.video) ? p.m.video.sha256.slice(0, 12) : null },
      after: { bytes: video.bytes, duracaoSeg: video.duracaoSeg, sha: video.sha256.slice(0, 12) },
    });
    return this.paraATela({ ...p, meta }, p.m.transcricaoSha);
  }

  /** O erro do envio como resposta HTTP; o que não é do envio (storage fora, banco) segue como veio. */
  private erroDoEnvio(e: unknown): Error {
    if (e instanceof ErroDoEnvio) return new HttpException(e.message, e.status);
    if (e instanceof HttpException) return e;
    const codigo = (e as { code?: string }).code;
    if (codigo === 'ECONNRESET' || codigo === 'ERR_STREAM_PREMATURE_CLOSE' || (e as Error).message === 'aborted') {
      return new BadRequestException('O envio do mp4 foi interrompido antes do fim.');
    }
    return e as Error;
  }

  /** O mp4 do corte que está no storage, para baixar pela tela (MD4). */
  async video(orgId: string, pecaId: string): Promise<{ stream: Readable; size: number; nome: string }> {
    const p = await this.pecaDaSemana(orgId, pecaId);
    if (!videoNoStorage(p.m.video)) throw new NotFoundException('O mp4 deste corte ainda não subiu ao OS — rode /root-midia cortes no Mac.');
    const { stream, size } = await this.lerDoStorage(p.m.video.chave, `mp4 da peça ${pecaId} (${orgId})`, 'O mp4 não está no storage — suba o corte de novo pelo Mac.');
    return { stream, size, nome: `corte-${p.m.itemN || 'x'}-${p.m.video.sha256.slice(0, 8)}.mp4` };
  }
}
