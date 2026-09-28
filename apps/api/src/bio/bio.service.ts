import { randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BioFinalidade, BioPlataforma } from '@prisma/client';
import { INSTAGRAM_ESCOPO_DE_COMENTARIOS, INSTAGRAM_ESCOPO_DE_PUBLICAR } from '@mktos/shared';
import type {
  BioLinkInput,
  BioLinkUpdateInput,
  BioPageInput,
  BioPublicPage,
  PautaContaDePublicacao,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  MemoriaDeResolucao,
  resolverTenantDaPage,
  resolverTenantDoHandle,
  resolverTenantDoLink,
} from '../common/tenant-publico';
import { AuditService } from '../audit/audit.service';
import { BioChallengeService } from './bio-challenge.service';
import { BioCredenciaisService } from './bio-credenciais.service';
import { linkRedireciona } from './link-de-campanha';
import * as instagram from './plataformas/instagram';
import * as tiktok from './plataformas/tiktok';

const STATE_VALIDO_MIN = 10;

/*
 * A memória curta da resolução de avatar. Validade curta porque o dado é o
 * endereço da empresa de uma página, que muda quase nunca; o teto existe porque
 * o nome do arquivo vem de fora (ver `tenantDaPage`).
 */
const AVATAR_VALIDADE_MS = 60_000;
const AVATAR_VALIDADE_NEGATIVA_MS = 30_000;
const AVATAR_TETO = 1_000;

@Injectable()
export class BioService {
  private readonly log = new Logger('Bio');
  /** pageId -> orgId (ou `null` para "essa página não existe"). */
  private readonly avatares = new MemoriaDeResolucao<string>({
    validadeMs: AVATAR_VALIDADE_MS,
    validadeNegativaMs: AVATAR_VALIDADE_NEGATIVA_MS,
    teto: AVATAR_TETO,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly challenge: BioChallengeService,
    private readonly credenciais: BioCredenciaisService,
  ) {}

  // ---------- Páginas ----------

  async listarPages(orgId: string) {
    const items = await this.prisma.bioPage.findMany({
      where: { orgId },
      orderBy: { criadaEm: 'asc' },
      include: { _count: { select: { links: true } } },
    });
    return {
      items,
      total: items.length,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  /** Detalhe para o painel — inclui rascunho (a prévia usa este endpoint). */
  async detalhePage(orgId: string, pageId: string) {
    const page = await this.prisma.bioPage.findFirst({
      where: { id: pageId, orgId },
      include: { links: { orderBy: { ordem: 'asc' } } },
    });
    if (!page) throw new NotFoundException('página não encontrada');
    const desafio = await this.challenge.estado(page.id);
    return { page, desafio, source: { tool: 'banco-interno', generatedAt: new Date().toISOString() } };
  }

  async salvarPage(orgId: string, input: BioPageInput, actorId: string) {
    const handle = input.handle.toLowerCase();
    const dono = await this.prisma.bioPage.findUnique({ where: { handle } });
    if (dono && dono.id !== input.id) {
      throw new BadRequestException(`o handle "${handle}" já está em uso`);
    }
    if (input.id) {
      const atual = await this.prisma.bioPage.findFirst({ where: { id: input.id, orgId } });
      if (!atual) throw new NotFoundException('página não encontrada');
    }

    const dados = {
      handle,
      titulo: input.titulo,
      subtitulo: input.subtitulo ?? null,
      avatarUrl: input.avatarUrl ?? null,
    };

    const page = input.id
      ? await this.prisma.bioPage.update({ where: { id: input.id }, data: dados })
      : await this.prisma.bioPage.create({ data: { orgId, ...dados } });

    await this.audit.log({
      orgId,
      actorId,
      action: input.id ? 'bio.page_update' : 'bio.page_create',
      entityType: 'BioPage',
      entityId: page.id,
      after: dados,
    });
    return page;
  }

  /** Grava só o avatar — usado pelo upload, que não conhece o resto do formulário. */
  async definirAvatar(orgId: string, pageId: string, avatarUrl: string, actorId: string) {
    const atual = await this.prisma.bioPage.findFirst({ where: { id: pageId, orgId } });
    if (!atual) throw new NotFoundException('página não encontrada');

    const page = await this.prisma.bioPage.update({ where: { id: pageId }, data: { avatarUrl } });
    await this.audit.log({
      orgId,
      actorId,
      action: 'bio.page_avatar',
      entityType: 'BioPage',
      entityId: pageId,
      before: { avatarUrl: atual.avatarUrl },
      after: { avatarUrl },
    });
    return page;
  }

  async publicar(orgId: string, pageId: string, publicada: boolean, actorId: string) {
    const page = await this.prisma.bioPage.findFirst({ where: { id: pageId, orgId } });
    if (!page) throw new NotFoundException('página não encontrada');

    const atualizada = await this.prisma.bioPage.update({
      where: { id: pageId },
      data: { publicada },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: publicada ? 'bio.page_publish' : 'bio.page_unpublish',
      entityType: 'BioPage',
      entityId: pageId,
      before: { publicada: page.publicada },
      after: { publicada },
    });
    return atualizada;
  }

  // ---------- Links ----------

  private async linkDaOrg(orgId: string, linkId: string) {
    const link = await this.prisma.bioLink.findFirst({
      where: { id: linkId, page: { orgId } },
      include: { page: { select: { id: true, orgId: true } } },
    });
    if (!link) throw new NotFoundException('botão não encontrado');
    return link;
  }

  async criarLink(orgId: string, pageId: string, input: BioLinkInput, actorId: string) {
    const page = await this.prisma.bioPage.findFirst({ where: { id: pageId, orgId } });
    if (!page) throw new NotFoundException('página não encontrada');

    const ultimo = await this.prisma.bioLink.findFirst({
      where: { pageId },
      orderBy: { ordem: 'desc' },
      select: { ordem: true },
    });

    const link = await this.prisma.bioLink.create({
      data: { pageId, ordem: (ultimo?.ordem ?? 0) + 1, ...input },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'bio.link_create',
      entityType: 'BioLink',
      entityId: link.id,
      after: { rotulo: link.rotulo, tipo: link.tipo, destino: link.destino },
    });
    return link;
  }

  async atualizarLink(orgId: string, linkId: string, input: BioLinkUpdateInput, actorId: string) {
    const antes = await this.linkDaOrg(orgId, linkId);
    const link = await this.prisma.bioLink.update({ where: { id: linkId }, data: input });
    await this.audit.log({
      orgId,
      actorId,
      action: 'bio.link_update',
      entityType: 'BioLink',
      entityId: linkId,
      before: { rotulo: antes.rotulo, destino: antes.destino, ativo: antes.ativo },
      after: input as never,
    });
    return link;
  }

  async removerLink(orgId: string, linkId: string, actorId: string) {
    const link = await this.linkDaOrg(orgId, linkId);
    await this.prisma.bioLink.delete({ where: { id: linkId } });
    await this.audit.log({
      orgId,
      actorId,
      action: 'bio.link_delete',
      entityType: 'BioLink',
      entityId: linkId,
      before: { rotulo: link.rotulo, destino: link.destino },
    });
    return { ok: true };
  }

  /** Troca a ordem com o vizinho — mais simples de acertar que reindexar tudo. */
  async moverLink(orgId: string, linkId: string, direcao: 'cima' | 'baixo', actorId: string) {
    const link = await this.linkDaOrg(orgId, linkId);
    const vizinho = await this.prisma.bioLink.findFirst({
      where: {
        pageId: link.pageId,
        ordem: direcao === 'cima' ? { lt: link.ordem } : { gt: link.ordem },
      },
      orderBy: { ordem: direcao === 'cima' ? 'desc' : 'asc' },
    });
    if (!vizinho) return { ok: true, movido: false };

    await this.prisma.$transaction([
      this.prisma.bioLink.update({ where: { id: link.id }, data: { ordem: vizinho.ordem } }),
      this.prisma.bioLink.update({ where: { id: vizinho.id }, data: { ordem: link.ordem } }),
    ]);
    await this.audit.log({
      orgId,
      actorId,
      action: 'bio.link_move',
      entityType: 'BioLink',
      entityId: linkId,
      after: { direcao },
    });
    return { ok: true, movido: true };
  }

  // ---------- Página pública ----------

  /*
   * DE QUEM É A REQUISIÇÃO — as três consultas de resolução (RF-T-04)
   * ================================================================
   *
   * As rotas públicas da bio chegam sem token: o `ContextoInterceptor` abre o
   * contexto com `orgId: null` de propósito. Mas a página `@fulano` é de UMA
   * empresa, e o clique em `/r/:linkId` é de UMA empresa — o que falta é
   * resolvê-la a partir do único dado que o visitante trouxe (o handle, o id do
   * link, o nome do arquivo).
   *
   * A CONSULTA EM SI NÃO MORA AQUI: mora em `common/tenant-publico.ts`, junto da
   * sentinela que ela abre. O invólucro da sentinela não é exportado, e é por
   * isso que estas três são casca — se a consulta morasse neste arquivo, o
   * invólucro teria de sair de lá, e qualquer código a um import de distância
   * poderia rodar sob a sentinela. Os métodos continuam existindo porque o
   * controller público injeta este serviço, não o módulo `common`.
   *
   * As três devolvem o ENDEREÇO da empresa e quase nada mais. Conteúdo de tenant
   * é lido DEPOIS, já dentro de `comTenantPublico`, pelos métodos que já
   * existiam.
   *
   * Sim, isso custa uma consulta a mais por requisição pública — indexada e por
   * chave única. É o preço de a rota saber de quem ela é antes de ler qualquer
   * coisa, em vez de descobrir junto com o conteúdo.
   */

  /** A empresa dona do handle. `publicada` vem junto porque decide o 404. */
  async tenantDoHandle(
    handle: string,
  ): Promise<{ pageId: string; orgId: string; publicada: boolean } | null> {
    return resolverTenantDoHandle(this.prisma, handle);
  }

  /** A empresa dona do link de saída. */
  async tenantDoLink(linkId: string): Promise<{ orgId: string } | null> {
    return resolverTenantDoLink(this.prisma, linkId);
  }

  /**
   * A empresa dona da página cujo avatar está sendo pedido.
   *
   * Não exige `publicada`: a prévia do painel usa a MESMA URL pública de avatar,
   * e exigir publicação aqui deixaria o rascunho sem foto na própria tela de
   * quem o está escrevendo.
   *
   * COM MEMÓRIA CURTA, INCLUSIVE DA RESPOSTA NEGATIVA — e é conserto medido.
   * Antes da fatia 1.4 a entrega de avatar não tocava no banco. Depois dela,
   * qualquer pessoa na internet passava a disparar uma consulta por requisição
   * só escrevendo um nome DENTRO da convenção (`<uuid>-<hex>.png`) que não
   * resolve — e nenhum limite de taxa existe nesta API. Guardar o "não existe"
   * fecha a torneira: a partir da primeira, a resposta sai da memória.
   */
  async tenantDaPage(pageId: string): Promise<{ orgId: string } | null> {
    const agora = Date.now();
    const lembrada = this.avatares.lembrar(pageId, agora);
    if (lembrada.lembrada) {
      return lembrada.valor === null ? null : { orgId: lembrada.valor };
    }

    const achado = await resolverTenantDaPage(this.prisma, pageId);
    this.avatares.guardar(pageId, achado?.orgId ?? null, agora);
    if (!achado) {
      /*
       * `debug`, não `warn`: a linha é disparável por qualquer um, de fora, sem
       * credencial. Rebaixada, ela continua servindo para quem for procurar
       * órfão no bucket e não serve mais para encher o disco de quem hospeda. A
       * memória acima já limita a frequência ao intervalo de validade.
       */
      this.log.debug(`avatar de página inexistente (${pageId}) — servido sem empresa resolvida`);
    }
    return achado;
  }

  /** Só página publicada. Rascunho é 404 público — a prévia vive no painel. */
  async paginaPublica(handle: string): Promise<BioPublicPage | null> {
    const page = await this.prisma.bioPage.findUnique({
      where: { handle: handle.toLowerCase() },
      include: { links: { where: { ativo: true }, orderBy: { ordem: 'asc' } } },
    });
    if (!page || !page.publicada) return null;

    return {
      handle: page.handle,
      titulo: page.titulo,
      subtitulo: page.subtitulo,
      avatarUrl: page.avatarUrl,
      links: page.links.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        rotulo: l.rotulo,
        icone: l.icone,
        destaque: l.destaque,
      })),
      desafio: await this.challenge.estadoPublico(page.id),
    };
  }

  /*
   * `pageParaTrack` morava aqui e saiu na fatia 1.4: ela fazia exatamente a
   * consulta de `tenantDoHandle`, só que sem a sentinela da resolução pública.
   * Manter as duas seria manter dois caminhos para a mesma pergunta, e o
   * segundo é o que quebra quando a RLS ligar.
   */

  /** Link + destino final do redirect de saída. */
  async destinoDoLink(linkId: string) {
    const link = await this.prisma.bioLink.findUnique({
      where: { id: linkId },
      include: { page: { select: { id: true, orgId: true, handle: true, publicada: true } } },
    });
    if (!link || !linkRedireciona(link)) return null;

    const destino =
      link.tipo === 'whatsapp'
        ? `https://wa.me/${link.destino.replace(/\D/g, '')}`
        : link.tipo === 'email'
          ? `mailto:${link.destino}`
          : link.destino;

    return { link, destino };
  }

  // ---------- Conexões OAuth ----------

  async listarConexoes(orgId: string) {
    const rows = await this.prisma.bioConexao.findMany({
      where: { orgId },
      orderBy: { conectadaEm: 'desc' },
      select: {
        id: true,
        plataforma: true,
        handle: true,
        externalId: true,
        status: true,
        expiraEm: true,
        escopos: true,
        finalidade: true,
        ultimoErro: true,
        conectadaEm: true,
        atualizadaEm: true,
        _count: { select: { contas: true } },
      },
    });
    return {
      items: rows,
      total: rows.length,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  /**
   * Cria o state anti-CSRF (uso único, 10 min) e devolve a URL de autorização.
   * A `finalidade` vai no state, e o callback é o mesmo: com `publicacao` o
   * Instagram pede os escopos de publicar (MD5). Publicar pelo TikTok está em
   * espera (MD12) e é recusado aqui.
   */
  async iniciarConexao(orgId: string, plataforma: BioPlataforma, finalidade: BioFinalidade = 'bio') {
    if (finalidade === 'publicacao' && plataforma !== 'instagram') {
      throw new BadRequestException('a conta de publicação existe só para o Instagram');
    }
    const cred = await this.credenciais.resolver(plataforma, orgId);
    if (!cred) {
      throw new BadRequestException(
        `credencial do app ${plataforma} não configurada — cadastre em Conexões`,
      );
    }

    const estado = `${orgId}.${randomBytes(24).toString('base64url')}`;
    const verifier = plataforma === 'tiktok' ? tiktok.novoVerifier() : null;

    await this.prisma.bioOauthState.create({
      data: {
        estado,
        orgId,
        plataforma,
        finalidade,
        verifier,
        expiraEm: new Date(Date.now() + STATE_VALIDO_MIN * 60_000),
      },
    });

    const url =
      plataforma === 'instagram'
        ? instagram.urlDeAutorizacao(estado, cred, finalidade)
        : tiktok.urlDeAutorizacao(estado, verifier!, cred);

    return { url };
  }

  /**
   * A conta de publicação do Instagram da empresa, para a aba Semana (MD5).
   * Sem token: só o @, os escopos concedidos e a validade.
   */
  async contaDePublicacao(orgId: string): Promise<PautaContaDePublicacao> {
    const [c, cred] = await Promise.all([
      this.prisma.bioConexao.findFirst({
        where: { orgId, plataforma: 'instagram', finalidade: 'publicacao' },
        select: {
          id: true,
          handle: true,
          escopos: true,
          status: true,
          expiraEm: true,
          ultimoErro: true,
          conectadaEm: true,
          atualizadaEm: true,
        },
      }),
      // `estado`, e não `resolver`: abrir a aba não decifra o segredo nem o
      // pega emprestado do cofre, o que carimbaria `usadoEm` a cada leitura.
      this.credenciais.estado(orgId),
    ]);
    const escopos = c ? instagram.escoposConcedidos(c.escopos ?? '') ?? [] : [];
    return {
      credencialConfigurada: cred.items.some((i) => i.plataforma === 'instagram' && i.configurada),
      escoposPedidos: [...instagram.escoposDa('publicacao')],
      conexao: c
        ? {
            id: c.id,
            handle: c.handle,
            escopos,
            podePublicar: escopos.includes(INSTAGRAM_ESCOPO_DE_PUBLICAR),
            podeComentarios: escopos.includes(INSTAGRAM_ESCOPO_DE_COMENTARIOS),
            status: c.status,
            expiraEm: c.expiraEm?.toISOString() ?? null,
            ultimoErro: c.ultimoErro,
            conectadaEm: c.conectadaEm.toISOString(),
            atualizadaEm: c.atualizadaEm.toISOString(),
          }
        : null,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  /**
   * A conta de publicação só se conecta com `pauta.publicar`; a mesma permissão
   * vale para tirá-la, senão quem só edita a bio desligaria a publicação.
   */
  async desconectar(orgId: string, conexaoId: string, actorId: string, permissoes: readonly string[]) {
    const conexao = await this.prisma.bioConexao.findFirst({ where: { id: conexaoId, orgId } });
    if (!conexao) throw new NotFoundException('conexão não encontrada');
    if (conexao.finalidade === 'publicacao' && !permissoes.includes('pauta.publicar')) {
      throw new ForbiddenException('esta é a conta de publicação: desconectar exige pauta.publicar');
    }

    // As contas do desafio voltam pro modo manual em vez de sumir.
    await this.prisma.bioChallengeAccount.updateMany({
      where: { conexaoId },
      data: { conexaoId: null, modo: 'manual' },
    });
    await this.prisma.bioConexao.delete({ where: { id: conexaoId } });

    await this.audit.log({
      orgId,
      actorId,
      action: 'bio.conexao_delete',
      entityType: 'BioConexao',
      entityId: conexaoId,
      before: { plataforma: conexao.plataforma, handle: conexao.handle, finalidade: conexao.finalidade },
    });
    return { ok: true };
  }
}
