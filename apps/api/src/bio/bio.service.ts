import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BioPlataforma } from '@prisma/client';
import type {
  BioLinkInput,
  BioLinkUpdateInput,
  BioPageInput,
  BioPublicPage,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BioChallengeService } from './bio-challenge.service';
import { BioCredenciaisService } from './bio-credenciais.service';
import * as instagram from './plataformas/instagram';
import * as tiktok from './plataformas/tiktok';

const STATE_VALIDO_MIN = 10;

@Injectable()
export class BioService {
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

  /** Resolve a página (com orgId) para o rastreio do pageview. */
  async pageParaTrack(handle: string) {
    return this.prisma.bioPage.findFirst({
      where: { handle: handle.toLowerCase(), publicada: true },
      select: { id: true, orgId: true },
    });
  }

  /** Link + destino final do redirect de saída. */
  async destinoDoLink(linkId: string) {
    const link = await this.prisma.bioLink.findUnique({
      where: { id: linkId },
      include: { page: { select: { id: true, orgId: true, handle: true, publicada: true } } },
    });
    if (!link || !link.ativo || !link.page.publicada) return null;

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

  /** Cria o state anti-CSRF (uso único, 10 min) e devolve a URL de autorização. */
  async iniciarConexao(orgId: string, plataforma: BioPlataforma) {
    const cred = await this.credenciais.resolver(plataforma, orgId);
    if (!cred) {
      throw new BadRequestException(
        `credencial do app ${plataforma} não configurada — cadastre em Conexões`,
      );
    }

    const estado = randomBytes(24).toString('base64url');
    const verifier = plataforma === 'tiktok' ? tiktok.novoVerifier() : null;

    await this.prisma.bioOauthState.create({
      data: {
        estado,
        orgId,
        plataforma,
        verifier,
        expiraEm: new Date(Date.now() + STATE_VALIDO_MIN * 60_000),
      },
    });

    const url =
      plataforma === 'instagram'
        ? instagram.urlDeAutorizacao(estado, cred)
        : tiktok.urlDeAutorizacao(estado, verifier!, cred);

    return { url };
  }

  async desconectar(orgId: string, conexaoId: string, actorId: string) {
    const conexao = await this.prisma.bioConexao.findFirst({ where: { id: conexaoId, orgId } });
    if (!conexao) throw new NotFoundException('conexão não encontrada');

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
      before: { plataforma: conexao.plataforma, handle: conexao.handle },
    });
    return { ok: true };
  }
}
