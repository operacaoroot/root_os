import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  PAUTA_STATUS_QUE_GERAM_NEWSLETTER,
  motivoParaNaoGerarNewsletter,
  type PautaChecagemAntiSlop,
  type PautaEpisodioDetalhe,
  type PautaNewsletterDoEpisodio,
  type PautaNewsletterPainel,
  type PautaPecaStatus,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { EpisodioService } from './episodio.service';
import { VozService } from './voz.service';
import { lerTranscricao } from './episodio';
import {
  NewsletterInvalidaError,
  checagemDaNewsletter,
  comOsMarcadores,
  ehNewsletterDaTranscricao,
  entradaDaNewsletter,
  frasesDitas,
  lerMetaDaNewsletter,
  montarNewsletter,
  newsletterEmHtml,
  pedidoDeReescrita,
  shaDaTranscricao,
  systemDaNewsletter,
  type MetaDaNewsletter,
  type NewsletterMontada,
} from './newsletter-do-episodio';

const MSG_CORRIDA = 'O episódio mudou enquanto isso (outra aba, outra geração ou a mídia refeita) — recarregue e tente de novo.';

interface PecaDaNewsletter {
  id: string;
  titulo: string;
  corpo: string;
  status: PautaPecaStatus;
  meta: unknown;
  criadaEm: Date;
}

const DA_PECA = { id: true, titulo: true, corpo: true, status: true, meta: true, criadaEm: true } as const;

function contarPorRegra(c: PautaChecagemAntiSlop): Record<string, number> {
  const conta: Record<string, number> = {};
  for (const a of c.apontamentos) conta[a.regra] = (conta[a.regra] ?? 0) + 1;
  return conta;
}

/*
 * A NEWSLETTER DO EPISÓDIO (MC13): sai da transcrição, na voz do autor (MC10),
 * e é uma PautaPeca da rodada do episódio (canal newsletter, formato email).
 * Não publica — o destino é a D-MC7; até lá, markdown e HTML para copiar. Tudo
 * aqui é escrita DENTRO do OS.
 */
@Injectable()
export class NewsletterService {
  private readonly log = new Logger('NewsletterService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly vozes: VozService,
    private readonly episodios: EpisodioService,
  ) {}

  /** As newsletters da transcrição ainda valendo (não descartadas), da mais nova para a mais velha. */
  private async vigentes(orgId: string, e: Pick<PautaEpisodioDetalhe, 'id' | 'rodadaId'>, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<PecaDaNewsletter[]> {
    const pecas = (await db.pautaPeca.findMany({
      where: { orgId, rodadaId: e.rodadaId, canal: 'newsletter', status: { not: 'descartada' } },
      orderBy: { criadaEm: 'desc' },
      select: DA_PECA,
    })) as PecaDaNewsletter[];
    return pecas.filter((p) => ehNewsletterDaTranscricao(p.meta, e.id));
  }

  /**
   * As newsletters feitas do miolo pela derivação antiga, ainda valendo na
   * rodada. A da transcrição toma o lugar delas nos dois sentidos: a derivação
   * não cria a do miolo com a da transcrição valendo, e gerar esta descarta
   * aquela.
   */
  private async doMiolo(orgId: string, rodadaId: string, db: Prisma.TransactionClient): Promise<string[]> {
    const pecas = await db.pautaPeca.findMany({
      where: { orgId, rodadaId, canal: 'newsletter', status: { in: ['rascunho', 'aprovada'] } },
      select: { id: true, meta: true },
    });
    return pecas.filter((p) => !ehNewsletterDaTranscricao(p.meta)).map((p) => p.id);
  }

  private paraATela(e: PautaEpisodioDetalhe, p: PecaDaNewsletter): PautaNewsletterDoEpisodio {
    const meta = lerMetaDaNewsletter(p.meta);
    const pagina = e.paginaDeLinks?.publicada ? e.paginaDeLinks.url : null;
    const { markdown, pendentes } = comOsMarcadores(p.corpo, { paginaNoAr: pagina, urlDoVideo: meta.urlDoVideo });
    return {
      pecaId: p.id,
      titulo: p.titulo,
      status: p.status,
      criadaEm: p.criadaEm.toISOString(),
      markdown,
      // No texto de agora: a peça se edita pela aba Rodadas (PATCH /pauta/pecas/:id).
      checagem: checagemDaNewsletter(p.corpo),
      tentativas: meta.tentativas,
      frases: frasesDitas(p.corpo, e.transcricao),
      secoes: meta.secoes,
      links: meta.links,
      urlDoVideo: meta.urlDoVideo,
      pendentes,
      transcricaoMudou: meta.transcricaoSha !== shaDaTranscricao(e.transcricao),
      avisos: meta.avisos,
    };
  }

  async painel(orgId: string, id: string): Promise<PautaNewsletterPainel> {
    const e = await this.episodios.obter(orgId, id);
    const [atual] = await this.vigentes(orgId, e);
    return { newsletter: atual ? this.paraATela(e, atual) : null };
  }

  /**
   * Gera da transcrição. A checagem anti-slop reprovando, pede uma reescrita
   * com os apontamentos; persistindo, grava a que teve menos apontamentos, e a
   * tela os mostra. A escrita é condicionada à transcrição e às newsletters
   * lidas antes da IA: mídia refeita ou outra geração no meio = 409.
   */
  async gerar(
    orgId: string,
    id: string,
    actorId: string,
    opts: { substituir: boolean; urlDoVideo?: string | null },
  ): Promise<PautaNewsletterPainel> {
    const e = await this.episodios.obter(orgId, id);
    const motivo = motivoParaNaoGerarNewsletter(e.status, e.transcricao.length);
    if (motivo) throw new BadRequestException(motivo);
    const antes = await this.vigentes(orgId, e);
    if (antes.length && !opts.substituir) {
      throw new ConflictException('O episódio já tem newsletter — confirme para substituir (a anterior fica como descartada).');
    }
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }

    const ctx = { tituloDoEpisodio: e.titulo, itens: e.itens, segmentos: e.transcricao };
    const system = systemDaNewsletter(await this.vozes.bloco(orgId));
    const user = entradaDaNewsletter({ apelido: e.apelido, titulo: e.titulo, itens: e.itens, segmentos: e.transcricao });
    // De quem é o gasto (RF-G-05), como nas outras chamadas da pauta.
    const primeira = await this.llm.complete({ system, user, orgId });
    let escolhida: NewsletterMontada;
    try {
      escolhida = montarNewsletter(primeira, ctx);
    } catch (err) {
      if (err instanceof NewsletterInvalidaError) {
        this.log.warn(`newsletter ${e.apelido} de ${orgId}: ${err.message}`);
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }
    let checagem = checagemDaNewsletter(escolhida.markdown);
    const reprovadaAntes = checagem.aprovada ? null : checagem;
    let tentativas = 1;
    if (!checagem.aprovada) {
      tentativas = 2;
      const segunda = await this.llm.complete({ system, user: user + pedidoDeReescrita(checagem), orgId });
      try {
        const refeita = montarNewsletter(segunda, ctx);
        const checagemRefeita = checagemDaNewsletter(refeita.markdown);
        if (checagemRefeita.apontamentos.length <= checagem.apontamentos.length) {
          escolhida = refeita;
          checagem = checagemRefeita;
        }
      } catch (err) {
        if (!(err instanceof NewsletterInvalidaError)) throw err;
        escolhida = { ...escolhida, avisos: [...escolhida.avisos, 'A reescrita pedida pela checagem não voltou utilizável: ficou a primeira versão.'] };
      }
    }

    const sha = shaDaTranscricao(e.transcricao);
    const idsAntes = antes.map((p) => p.id).sort();

    const { criada, miolo } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pauta-newsletter:${id}`}))`;
      const agora = await tx.pautaEpisodio.findFirst({ where: { id, orgId }, select: { status: true, transcricao: true } });
      if (
        !agora ||
        !(PAUTA_STATUS_QUE_GERAM_NEWSLETTER as readonly string[]).includes(agora.status) ||
        shaDaTranscricao(lerTranscricao(agora.transcricao)) !== sha
      ) {
        throw new ConflictException(MSG_CORRIDA);
      }
      const vigentesAgora = await this.vigentes(orgId, e, tx);
      const idsAgora = vigentesAgora.map((p) => p.id).sort();
      if (idsAgora.join('|') !== idsAntes.join('|')) throw new ConflictException(MSG_CORRIDA);
      const miolo = await this.doMiolo(orgId, e.rodadaId, tx);
      const descartar = [...idsAgora, ...miolo];
      if (descartar.length) {
        await tx.pautaPeca.updateMany({ where: { orgId, id: { in: descartar } }, data: { status: 'descartada' } });
      }
      const meta: MetaDaNewsletter = {
        episodioId: e.id,
        origem: 'transcricao',
        tentativas,
        secoes: escolhida.secoes,
        links: escolhida.links,
        avisos: miolo.length
          ? [...escolhida.avisos, 'A newsletter feita do miolo da rodada ficou descartada: esta toma o lugar dela.']
          : escolhida.avisos,
        // Sem o campo, o link que a anterior tem AGORA segue (lido sob o cadeado:
        // outra aba pode tê-lo salvo enquanto a IA escrevia); nulo tira.
        urlDoVideo: opts.urlDoVideo !== undefined ? opts.urlDoVideo : lerMetaDaNewsletter(vigentesAgora[0]?.meta).urlDoVideo,
        transcricaoSha: sha,
      };
      const peca = await tx.pautaPeca.create({
        data: {
          orgId,
          rodadaId: e.rodadaId,
          canal: 'newsletter',
          formato: 'email',
          titulo: escolhida.titulo.slice(0, 200),
          corpo: escolhida.markdown,
          meta: meta as unknown as Prisma.InputJsonValue,
        },
        select: DA_PECA,
      });
      return { criada: peca, miolo };
    });

    const frases = frasesDitas(escolhida.markdown, e.transcricao);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.newsletter_gerada',
      entityType: 'pauta_episodio',
      entityId: id,
      before: { substituidas: idsAntes, doMiolo: miolo },
      after: {
        pecaId: criada.id,
        tentativas,
        aprovada: checagem.aprovada,
        apontamentos: contarPorRegra(checagem),
        reprovadaNaPrimeira: reprovadaAntes ? contarPorRegra(reprovadaAntes) : null,
        secoes: escolhida.secoes,
        links: escolhida.links,
        frases,
        caracteres: escolhida.markdown.length,
        provider: this.llm.name,
        model: this.llm.model,
      },
    });
    return { newsletter: this.paraATela(e, criada as PecaDaNewsletter) };
  }

  /** O link do vídeo publicado (manual, D-MC6): entra no lugar do marcador. Nulo tira. */
  async definirVideo(orgId: string, id: string, actorId: string, urlDoVideo: string | null): Promise<PautaNewsletterPainel> {
    const e = await this.episodios.obter(orgId, id);
    const [atual] = await this.vigentes(orgId, e);
    if (!atual) throw new BadRequestException('O episódio ainda não tem newsletter — gere primeiro.');
    const meta = lerMetaDaNewsletter(atual.meta);
    const novo = { ...(atual.meta as Record<string, unknown>), urlDoVideo };
    const r = await this.prisma.pautaPeca.updateMany({
      where: { id: atual.id, orgId, status: { not: 'descartada' } },
      data: { meta: novo as Prisma.InputJsonValue },
    });
    if (r.count === 0) throw new ConflictException(MSG_CORRIDA);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.newsletter_video',
      entityType: 'pauta_peca',
      entityId: atual.id,
      before: { urlDoVideo: meta.urlDoVideo },
      after: { urlDoVideo },
    });
    return { newsletter: this.paraATela(e, { ...atual, meta: novo }) };
  }

  /** O arquivo para copiar ou baixar: markdown ou HTML simples, com os marcadores já trocados. */
  async exportar(orgId: string, id: string, formato: 'md' | 'html'): Promise<{ nome: string; conteudo: string }> {
    const e = await this.episodios.obter(orgId, id);
    const [atual] = await this.vigentes(orgId, e);
    if (!atual) throw new NotFoundException('O episódio ainda não tem newsletter.');
    const { markdown } = this.paraATela(e, atual);
    const nome = `${e.apelido}-newsletter.${formato}`;
    return { nome, conteudo: formato === 'md' ? `${markdown}\n` : newsletterEmHtml(markdown, atual.titulo) };
  }
}
