import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EvolutionService } from './evolution.service';
import { ClickupService } from '../integrations/clickup.service';
import { destinoDosItens } from './curadoria-da-rodada';
import { semLinksDeCaixaDeEntrada } from './link-publico';
import { chaveDeCampanha } from '../bio/link-de-campanha';

/** Para onde foi o link da peça — vai ao RASTRO, para "não foi medido" nunca ser silêncio. */
export type RastreioDaPeca =
  | 'pagina_do_episodio'
  | 'sem_pagina_do_episodio'
  | 'pagina_do_episodio_fora_do_ar'
  | 'sem_origem_da_bio'
  | 'sem_link';

// Publicação das peças (onda 3). O que cada canal faz e o que NÃO faz:
//
//   whatsapp   → Evolution, grupo, automático (atrás de aprovação humana)
//   clickup    → cria o tema de verdade na lista de pauta
//   instagram  → NÃO publica. Publicar carrossel exige `content_publish` +
//                App Review, e o app da Meta está em troca. A peça sai pronta
//                aqui e o post é manual (máquina de carrossel).
//   newsletter → idem: o corpo fica pronto, o envio é do canal de e-mail.
//
// O link publicado vira link de campanha na página do episódio da rodada (MC12),
// quando ela está no ar: o `/r/` dele redireciona para a matéria e o clique no
// grupo volta como BioEvent/PixelEvent, alimentando GoalWeek.bioClicks sem
// ninguém digitar nada. Sem ela, sai cru.
@Injectable()
export class PublicacaoService {
  private readonly log = new Logger('PublicacaoService');
  private readonly baseBio = (process.env.PUBLIC_BIO_ORIGIN ?? '').replace(/\/$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly evolution: EvolutionService,
    private readonly clickup: ClickupService,
  ) {}

  /**
   * O link rastreado da peça, na página de links do EPISÓDIO da rodada (MC12).
   * Até o MC12 ele caía na primeira BioPage da empresa — qualquer uma, até a
   * página pessoal de alguém — e nascia inativo sem chave, e o `/r/` de link
   * inativo manda para a home da bio sem medir nada. Agora é um link de
   * CAMPANHA (`campanha:peca:<id>`): invisível na página, mas o `/r/` segue e
   * grava o clique, com a página no ar (rascunho perderia o clique). Sem ela, a
   * peça sai com o destino cru e o motivo vai para o RASTRO — medir é
   * desejável, publicar é obrigatório.
   */
  private async linkRastreado(
    orgId: string,
    pecaId: string,
    pageId: string | null,
    rotulo: string,
    destino: string,
  ): Promise<{ url: string; bioLinkId: string | null; rastreio: RastreioDaPeca }> {
    if (!this.baseBio) return { url: destino, bioLinkId: null, rastreio: 'sem_origem_da_bio' };
    if (!pageId) return { url: destino, bioLinkId: null, rastreio: 'sem_pagina_do_episodio' };
    const page = await this.prisma.bioPage.findFirst({
      where: { id: pageId, orgId },
      select: { id: true, publicada: true },
    });
    if (!page) return { url: destino, bioLinkId: null, rastreio: 'sem_pagina_do_episodio' };
    if (!page.publicada) return { url: destino, bioLinkId: null, rastreio: 'pagina_do_episodio_fora_do_ar' };

    const ultimo = await this.prisma.bioLink.findFirst({
      where: { pageId: page.id },
      orderBy: { ordem: 'desc' },
      select: { ordem: true },
    });
    // Upsert pela chave: se a tentativa anterior de enviar falhou e o link não
    // foi apagado, a nova reaproveita o mesmo em vez de bater no índice único.
    const chave = chaveDeCampanha('peca', pecaId);
    const dados = { rotulo: rotulo.slice(0, 80), destino, ativo: false };
    const link = await this.prisma.bioLink.upsert({
      where: { pageId_chave: { pageId: page.id, chave } },
      create: { pageId: page.id, chave, ordem: (ultimo?.ordem ?? 0) + 1, tipo: 'url', ...dados },
      update: dados,
    });
    return { url: `${this.baseBio}/r/${link.id}`, bioLinkId: link.id, rastreio: 'pagina_do_episodio' };
  }

  /** Destino do link da peça: o primeiro item curado com link público, pela regra da página e da descrição (MC12). */
  private destinoDaRodada(itens: unknown): string | null {
    return destinoDosItens(itens);
  }

  async publicar(orgId: string, pecaId: string, actorId: string) {
    const peca = await this.prisma.pautaPeca.findFirst({
      where: { id: pecaId, orgId },
      include: { rodada: { select: { titulo: true, itens: true, episodio: { select: { bioPageId: true } } } } },
    });
    if (!peca) throw new NotFoundException('Peça não encontrada');
    if (peca.status === 'publicada') throw new BadRequestException('Esta peça já foi publicada.');
    if (peca.status === 'descartada') throw new BadRequestException('Peça descartada.');

    switch (peca.canal) {
      case 'whatsapp':
        return this.publicarWhatsapp(orgId, peca, actorId);
      case 'clickup':
        return this.publicarClickup(orgId, peca, actorId);
      case 'instagram':
      case 'newsletter':
      default:
        throw new BadRequestException(
          peca.canal === 'instagram'
            ? 'Instagram não publica pelo OS: exige content_publish com App Review (o app da Meta está em troca). ' +
              'Use o export para a máquina de carrossel e poste manualmente.'
            : 'Newsletter não tem canal de envio ligado — copie o corpo e envie pela ferramenta de e-mail.',
        );
    }
  }

  private async publicarWhatsapp(
    orgId: string,
    peca: {
      id: string;
      corpo: string;
      titulo: string;
      rodada: { titulo: string; itens: unknown; episodio: { bioPageId: string | null } | null };
    },
    actorId: string,
  ) {
    const estado = await this.evolution.estado();
    if (!estado.conectada) {
      throw new ServiceUnavailableException(estado.motivo ?? 'Evolution indisponível.');
    }
    const jid = this.evolution.grupo;
    if (!jid) {
      throw new ServiceUnavailableException(
        'Falta EVOLUTION_GRUPO_JID (o JID do grupo, terminado em @g.us — não é o número).',
      );
    }

    const destino = this.destinoDaRodada(peca.rodada.itens);
    // O corpo foi escrito pelo modelo (e pode ter sido editado à mão): o link
    // de caixa de entrada não sai para o grupo nem que alguém o tenha colado.
    let texto = semLinksDeCaixaDeEntrada(peca.corpo);
    let bioLinkId: string | null = null;
    let rastreio: RastreioDaPeca = 'sem_link';
    if (destino) {
      const l = await this.linkRastreado(orgId, peca.id, peca.rodada.episodio?.bioPageId ?? null, peca.rodada.titulo, destino);
      bioLinkId = l.bioLinkId;
      rastreio = l.rastreio;
      texto = `${texto}\n\n${l.url}`;
    }

    let r: { id: string | null };
    try {
      r = await this.evolution.enviarTexto(jid, texto);
    } catch (e) {
      // O link só existe para ser clicado nesta mensagem: se ela não saiu,
      // apaga em vez de deixar BioLink órfão acumulando na página.
      if (bioLinkId) {
        await this.prisma.bioLink.delete({ where: { id: bioLinkId } }).catch(() => undefined);
      }
      await this.prisma.pautaPeca.update({
        where: { id: peca.id },
        data: { erro: (e as Error).message.slice(0, 300) },
      });
      throw e;
    }

    const atualizada = await this.prisma.pautaPeca.update({
      where: { id: peca.id },
      data: {
        status: 'publicada',
        externalId: r.id,
        bioLinkId,
        publicadaEm: new Date(),
        publicadaPor: actorId,
        erro: null,
      },
    });

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.peca_publicada',
      entityType: 'pauta_peca',
      entityId: peca.id,
      after: { canal: 'whatsapp', jid, mensagemId: r.id, bioLinkId, rastreio },
    });
    return { ok: true, canal: 'whatsapp', externalId: atualizada.externalId };
  }

  private async publicarClickup(
    orgId: string,
    peca: { id: string; titulo: string; corpo: string },
    actorId: string,
  ) {
    const t = await this.clickup.criarTarefa({ nome: peca.titulo, descricao: semLinksDeCaixaDeEntrada(peca.corpo) });
    await this.prisma.pautaPeca.update({
      where: { id: peca.id },
      data: {
        status: 'publicada',
        externalId: t.id,
        meta: { url: t.url },
        publicadaEm: new Date(),
        publicadaPor: actorId,
        erro: null,
      },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.peca_publicada',
      entityType: 'pauta_peca',
      entityId: peca.id,
      after: { canal: 'clickup', taskId: t.id },
    });
    return { ok: true, canal: 'clickup', externalId: t.id, url: t.url };
  }

  /**
   * Pacote da peça de Instagram para a máquina de carrossel (marca `root`):
   * capa + slides + legenda no formato que o gerador consome. A legenda e os
   * slides vão para o Instagram, que é público: passam pela mesma barreira do
   * grupo, porque a peça derivada antes do MC-R pode ter o permalink no texto.
   */
  async exportarCarrossel(orgId: string, pecaId: string) {
    const peca = await this.prisma.pautaPeca.findFirst({ where: { id: pecaId, orgId } });
    if (!peca) throw new NotFoundException('Peça não encontrada');
    if (peca.canal !== 'instagram') throw new BadRequestException('Só peças de Instagram têm carrossel.');
    // O story e o corte da semana (MC15) também são do canal instagram, e não têm slides.
    if (peca.formato && peca.formato !== 'carrossel') throw new BadRequestException(`Esta peça é ${peca.formato}, não carrossel.`);

    const meta = (peca.meta ?? {}) as {
      slides?: Array<{ titulo?: string; texto?: string }>;
      cta?: { instrucao?: string; palavra?: string; beneficio?: string };
      palavraChave?: string;
    };
    return {
      marca: 'root',
      titulo: peca.titulo,
      legenda: semLinksDeCaixaDeEntrada(peca.corpo),
      slides: (meta.slides ?? []).map((s, i) => ({
        ordem: i + 1,
        titulo: semLinksDeCaixaDeEntrada(s.titulo ?? ''),
        texto: semLinksDeCaixaDeEntrada(s.texto ?? ''),
      })),
      // O fechamento da máquina de carrossel (MC15): a palavra do comentário no último slide.
      ...(meta.cta?.palavra ? { cta: meta.cta, palavraChave: meta.palavraChave ?? meta.cta.palavra } : {}),
    };
  }
}
