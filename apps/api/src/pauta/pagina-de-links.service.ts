import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PAUTA_CHAVES_DOS_LINKS_DA_CASA,
  PAUTA_RESERVA_DA_PAGINA_DE_LINKS,
  apelidoDoEpisodio,
  type PautaEpisodioDetalhe,
  type PautaPaginaDeLinksMontada,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService } from '../memory/memoria.service';
import { BioService } from '../bio/bio.service';
import { EpisodioService } from './episodio.service';
import { itensMantidos } from './episodio';
import {
  cabeNaDescricao,
  handlesDaPagina,
  linksDaCasaDaNota,
  planoDaPagina,
  sincronia,
  urlDaPagina,
  type LinkDaCasa,
} from './pagina-de-links-do-episodio';

/** Quem pede: o id e as permissões do token — mexer numa página no ar pede `bio.editar`. */
export interface QuemMonta {
  sub: string;
  permissions: readonly string[];
}

const SEM_O_QUE_POR =
  'Nenhuma matéria mantida tem link público e a casa não tem links de chamada — não há o que pôr na página.';

function repetido(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** Quanto do que mudou vai ao RASTRO: a página tem poucos botões, mas o registro tem teto. */
const TETO_DE_BOTOES_NO_REGISTRO = 50;

type Botao = { rotulo: string; destino: string; ativo: boolean };

/*
 * A PÁGINA DE LINKS DO EPISÓDIO (MC12). Montar é escrita DENTRO do OS (uma
 * BioPage em rascunho e os botões dela), com `pauta.editar`. Pôr no ar é a mesma
 * coisa que o painel da bio faz ao publicar: `BioService.publicar`, com
 * `bio.editar` e o mesmo registro `bio.page_publish` — não existe atalho por aqui.
 * Pela mesma razão, montar de novo uma página que JÁ está no ar muda o que o
 * público vê, e pede `bio.editar` como qualquer edição de botão no /bio.
 *
 * E o módulo: as rotas moram em `/pauta`, então o gate de módulos só confere a
 * pauta. Página na bio é produto do módulo `bio` — empresa que não o contratou
 * recebe 404 em `/api/bio/*`, e não pode criar nem publicar página por aqui.
 */
@Injectable()
export class PaginaDeLinksService {
  private readonly log = new Logger('PaginaDeLinksService');
  private readonly origem = process.env.PUBLIC_BIO_ORIGIN;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly memoria: MemoriaService,
    private readonly bio: BioService,
    private readonly episodios: EpisodioService,
  ) {}

  /** Sem o módulo bio contratado, nada de página: recusa antes de qualquer escrita. */
  private async exigirModuloBio(orgId: string): Promise<void> {
    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { modulos: true } });
    if (!org?.modulos.includes('bio')) {
      throw new ForbiddenException('A página de links mora na bio, e esta empresa não contrata o módulo bio.');
    }
  }

  /** Os links de chamada da casa: a primeira nota da memória que existir (só lida). */
  private async linksDaCasa(orgId: string): Promise<{ links: LinkDaCasa[]; avisos: string[] }> {
    try {
      for (const chave of PAUTA_CHAVES_DOS_LINKS_DA_CASA) {
        const nota = await this.memoria.porChave(orgId, chave);
        if (nota && !nota.arquivadoEm) return linksDaCasaDaNota(nota);
      }
      return { links: [], avisos: [] };
    } catch (e) {
      // Memória fora do ar não impede a página: sai sem as chamadas, e a tela diz.
      this.log.warn(`links da casa de ${orgId}: memória indisponível (${(e as Error).message})`);
      return { links: [], avisos: ['A memória não respondeu: a página saiu sem os links da casa.'] };
    }
  }

  /**
   * Cria a página (handle com o slug da empresa, único na bio inteira) ou
   * devolve a que o episódio já tem. O handle de outra empresa é invisível
   * daqui (RLS), então quem acusa o conflito é o índice único — e aí tenta o
   * próximo candidato.
   */
  private async garantirPagina(
    orgId: string,
    e: { id: string; numero: number; titulo: string; bioPageId: string | null },
    actorId: string,
    podeCriar: boolean,
  ): Promise<{ id: string; handle: string; publicada: boolean; criada: boolean }> {
    if (e.bioPageId) {
      const atual = await this.prisma.bioPage.findFirst({
        where: { id: e.bioPageId, orgId },
        select: { id: true, handle: true, publicada: true },
      });
      if (atual) return { ...atual, criada: false };
    }
    if (!podeCriar) throw new BadRequestException(SEM_O_QUE_POR);

    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { slug: true } });
    const titulo = e.titulo.slice(0, 80);
    let criada: { id: string; handle: string; publicada: boolean } | null = null;
    for (const handle of handlesDaPagina(org?.slug ?? '', e.numero, e.id)) {
      if (!cabeNaDescricao(urlDaPagina(this.origem ?? '', handle))) {
        throw new BadRequestException(
          `O endereço da página passaria de ${PAUTA_RESERVA_DA_PAGINA_DE_LINKS} bytes e não caberia na descrição — confira PUBLIC_BIO_ORIGIN.`,
        );
      }
      try {
        criada = await this.prisma.bioPage.create({
          data: { orgId, handle, titulo, subtitulo: `Os links citados no ${apelidoDoEpisodio(e.numero)}` },
          select: { id: true, handle: true, publicada: true },
        });
        break;
      } catch (err) {
        if (repetido(err)) continue;
        throw err;
      }
    }
    if (!criada) throw new ConflictException('Os endereços desta página já estão em uso na bio — renomeie a página antiga no /bio.');

    // Liga ao episódio só se ninguém ligou outra no meio (duas abas montando).
    const r = await this.prisma.pautaEpisodio.updateMany({
      where: { id: e.id, orgId, bioPageId: null },
      data: { bioPageId: criada.id },
    });
    if (r.count === 0) {
      await this.prisma.bioPage.deleteMany({ where: { id: criada.id, orgId } });
      throw new ConflictException('Outra aba montou a página deste episódio agora — recarregue.');
    }
    await this.audit.log({
      orgId,
      actorId,
      action: 'bio.page_create',
      entityType: 'BioPage',
      entityId: criada.id,
      after: { handle: criada.handle, titulo, episodioId: e.id },
    });
    return { ...criada, criada: true };
  }

  /**
   * Monta (ou remonta) a página: um botão por matéria mantida com link público,
   * mais as chamadas da casa. Idempotente — os botões são achados pela chave, e
   * o que a montagem anterior pôs e esta não põe mais é desativado (o histórico
   * de cliques fica). Botão do painel não é tocado, só vai para depois.
   */
  async montar(orgId: string, id: string, quem: QuemMonta): Promise<PautaPaginaDeLinksMontada> {
    const e = await this.prisma.pautaEpisodio.findFirst({
      where: { id, orgId },
      select: {
        id: true,
        numero: true,
        titulo: true,
        bioPageId: true,
        rodada: { select: { itens: true } },
        bioPage: { select: { publicada: true } },
      },
    });
    if (!e) throw new NotFoundException('Episódio não encontrado');
    await this.exigirModuloBio(orgId);
    if (e.bioPage?.publicada && !quem.permissions.includes('bio.editar')) {
      throw new ForbiddenException('A página já está no ar: mudar os botões dela pede bio.editar, como no /bio.');
    }

    const casa = await this.linksDaCasa(orgId);
    const plano = planoDaPagina(itensMantidos(e.rodada.itens), casa.links);
    // Plano vazio só é recusado sem página: com ela, montar de novo é o jeito de
    // tirar os botões que o episódio não cita mais.
    const vazio = plano.links.length === 0;
    if (vazio && !e.bioPageId) throw new BadRequestException(SEM_O_QUE_POR);
    const avisos = [...plano.avisos, ...casa.avisos];
    if (vazio) {
      avisos.push(
        e.bioPage?.publicada
          ? 'Nada mais a pôr: os botões da montagem saíram e a página ficou sem eles — tire do ar se não houver botão do /bio.'
          : 'Nada mais a pôr: os botões da montagem saíram da página.',
      );
    } else if (plano.materias === 0) {
      avisos.push('Nenhuma matéria tem link público: a página saiu só com os links da casa.');
    }

    const pagina = await this.garantirPagina(orgId, e, quem.sub, !vazio);
    const titulo = e.titulo.slice(0, 80);

    const feito = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pauta-pagina-de-links:${pagina.id}`}))`;
      const agora = await tx.bioPage.findFirst({ where: { id: pagina.id, orgId }, select: { publicada: true, titulo: true } });
      if (!agora) throw new ConflictException('A página foi apagada no /bio enquanto isso — monte de novo.');
      if (agora.publicada && !quem.permissions.includes('bio.editar')) {
        throw new ForbiddenException('A página foi posta no ar enquanto isso: mudar os botões dela pede bio.editar.');
      }
      if (agora.titulo !== titulo) await tx.bioPage.update({ where: { id: pagina.id }, data: { titulo } });

      const existentes = await tx.bioLink.findMany({
        where: { pageId: pagina.id },
        select: { id: true, chave: true, ordem: true, ativo: true, rotulo: true, destino: true, destaque: true },
      });
      const s = sincronia(existentes, plano.links);
      const porId = new Map(existentes.map((l) => [l.id, l]));
      const antes = (id: string): Botao => {
        const l = porId.get(id)!;
        return { rotulo: l.rotulo, destino: l.destino, ativo: l.ativo };
      };
      // O antes/depois de cada botão, como o /bio registra no bio.link_*: sem
      // isso o RASTRO não diria para onde um botão público apontava.
      const botoes: Array<{ id: string; mudanca: 'criado' | 'atualizado' | 'desativado'; antes?: Botao; depois?: Botao }> = [];
      for (const c of s.criar) {
        const novo = await tx.bioLink.create({
          data: { pageId: pagina.id, chave: c.chave, ordem: c.ordem, tipo: 'url', rotulo: c.rotulo, destino: c.destino, destaque: c.destaque, ativo: true },
          select: { id: true },
        });
        botoes.push({ id: novo.id, mudanca: 'criado', depois: { rotulo: c.rotulo, destino: c.destino, ativo: true } });
      }
      for (const a of s.atualizar) {
        const { id: linkId, ...dados } = a;
        await tx.bioLink.update({ where: { id: linkId }, data: dados });
        const era = antes(linkId);
        if (era.rotulo !== a.rotulo || era.destino !== a.destino || !era.ativo) {
          botoes.push({ id: linkId, mudanca: 'atualizado', antes: era, depois: { rotulo: a.rotulo, destino: a.destino, ativo: true } });
        }
      }
      if (s.desativar.length) await tx.bioLink.updateMany({ where: { id: { in: s.desativar }, pageId: pagina.id }, data: { ativo: false } });
      for (const id of s.desativar) botoes.push({ id, mudanca: 'desativado', antes: antes(id) });
      for (const r of s.reordenar) await tx.bioLink.update({ where: { id: r.id }, data: { ordem: r.ordem } });
      return {
        conta: { criados: s.criar.length, atualizados: s.atualizados, desativados: s.desativar.length },
        botoes,
        noAr: agora.publicada,
      };
    });

    await this.audit.log({
      orgId,
      actorId: quem.sub,
      action: 'pauta.episodio_pagina_de_links',
      entityType: 'pauta_episodio',
      entityId: id,
      after: {
        pageId: pagina.id,
        handle: pagina.handle,
        paginaCriada: pagina.criada,
        noAr: feito.noAr,
        materias: plano.materias,
        casa: plano.links.length - plano.materias,
        ...feito.conta,
        botoes: feito.botoes.slice(0, TETO_DE_BOTOES_NO_REGISTRO),
        avisos,
      },
    });
    return { episodio: await this.episodios.obter(orgId, id), ...feito.conta, avisos };
  }

  /**
   * Põe no ar ou tira do ar — pelo MESMO método do painel da bio, com o mesmo
   * registro. Publicar exige pelo menos um botão ativo: página vazia no ar é
   * endereço na descrição que não leva a nada.
   */
  async publicar(orgId: string, id: string, actorId: string, publicada: boolean): Promise<PautaEpisodioDetalhe> {
    const e = await this.prisma.pautaEpisodio.findFirst({ where: { id, orgId }, select: { bioPageId: true } });
    if (!e) throw new NotFoundException('Episódio não encontrado');
    await this.exigirModuloBio(orgId);
    if (!e.bioPageId) throw new BadRequestException('O episódio ainda não tem página de links — monte a página primeiro.');
    if (publicada) {
      const ativos = await this.prisma.bioLink.count({ where: { pageId: e.bioPageId, ativo: true } });
      if (ativos === 0) throw new BadRequestException('A página não tem nenhum botão ativo — monte a página de novo antes de publicar.');
    }
    await this.bio.publicar(orgId, e.bioPageId, publicada, actorId);
    return this.episodios.obter(orgId, id);
  }
}
