import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BioAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private desde(dias: number) {
    return new Date(Date.now() - dias * 86_400_000);
  }

  /** Visão geral de todas as páginas da org. Uma consulta por métrica, não uma por página. */
  async resumo(orgId: string, dias = 30) {
    const inicio = this.desde(dias);

    const [pages, porNome, unicos] = await Promise.all([
      this.prisma.bioPage.findMany({ where: { orgId }, orderBy: { criadaEm: 'asc' } }),
      this.prisma.bioEvent.groupBy({
        by: ['pageId', 'nome'],
        where: { orgId, ocorridoEm: { gte: inicio } },
        _count: { _all: true },
      }),
      this.prisma.bioEvent.findMany({
        where: { orgId, ocorridoEm: { gte: inicio }, nome: 'pageview' },
        select: { pageId: true, visitorId: true },
        distinct: ['pageId', 'visitorId'],
      }),
    ]);

    const contagem = new Map<string, { views: number; cliques: number }>();
    for (const linha of porNome) {
      const atual = contagem.get(linha.pageId) ?? { views: 0, cliques: 0 };
      if (linha.nome === 'pageview') atual.views += linha._count._all;
      else atual.cliques += linha._count._all;
      contagem.set(linha.pageId, atual);
    }

    const visitantes = new Map<string, number>();
    for (const u of unicos) visitantes.set(u.pageId, (visitantes.get(u.pageId) ?? 0) + 1);

    const items = pages.map((p) => {
      const c = contagem.get(p.id) ?? { views: 0, cliques: 0 };
      return {
        pageId: p.id,
        handle: p.handle,
        titulo: p.titulo,
        publicada: p.publicada,
        views: c.views,
        visitantes: visitantes.get(p.id) ?? 0,
        cliques: c.cliques,
        ctr: c.views > 0 ? Math.round((c.cliques / c.views) * 1000) / 10 : 0,
      };
    });

    return {
      items,
      total: items.length,
      janela: { dias },
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  /** Detalhe de uma página: desempenho por botão, origem do tráfego e dispositivo. */
  async detalhe(orgId: string, pageId: string, dias = 30) {
    const inicio = this.desde(dias);

    const [page, porLink, eventos, visitas, unicos] = await Promise.all([
      this.prisma.bioPage.findFirst({
        where: { id: pageId, orgId },
        include: { links: { orderBy: { ordem: 'asc' } } },
      }),
      this.prisma.bioEvent.groupBy({
        by: ['linkId'],
        where: { pageId, ocorridoEm: { gte: inicio }, linkId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.bioEvent.findMany({
        where: { pageId, ocorridoEm: { gte: inicio } },
        select: { nome: true, ocorridoEm: true },
      }),
      this.prisma.bioVisit.findMany({
        where: { pageId, iniciadaEm: { gte: inicio } },
        select: { referrer: true, utmSource: true, device: true, fbclid: true, ttclid: true },
      }),
      this.prisma.bioEvent.findMany({
        where: { pageId, ocorridoEm: { gte: inicio }, nome: 'pageview' },
        select: { visitorId: true },
        distinct: ['visitorId'],
      }),
    ]);

    if (!page) throw new NotFoundException('página não encontrada');

    const cliquesPorLink = new Map(porLink.map((l) => [l.linkId!, l._count._all]));
    const views = eventos.filter((e) => e.nome === 'pageview').length;
    const cliques = eventos.length - views;

    // Origem: UTM manda; senão o clid da plataforma; senão o domínio do referrer.
    const origens = new Map<string, number>();
    const dispositivos = new Map<string, number>();
    for (const v of visitas) {
      let origem = v.utmSource ?? null;
      if (!origem && v.fbclid) origem = 'meta (fbclid)';
      if (!origem && v.ttclid) origem = 'tiktok (ttclid)';
      if (!origem && v.referrer) {
        try {
          origem = new URL(v.referrer).hostname.replace(/^www\./, '');
        } catch {
          origem = 'desconhecida';
        }
      }
      origem = origem ?? 'direto';
      origens.set(origem, (origens.get(origem) ?? 0) + 1);
      const d = v.device ?? 'desconhecido';
      dispositivos.set(d, (dispositivos.get(d) ?? 0) + 1);
    }

    // Série diária para o gráfico.
    const serie = new Map<string, { views: number; cliques: number }>();
    for (let i = dias - 1; i >= 0; i--) {
      const dia = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      serie.set(dia, { views: 0, cliques: 0 });
    }
    for (const e of eventos) {
      const dia = e.ocorridoEm.toISOString().slice(0, 10);
      const atual = serie.get(dia);
      if (!atual) continue;
      if (e.nome === 'pageview') atual.views++;
      else atual.cliques++;
    }

    const ordenar = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([nome, total]) => ({ nome, total }));

    return {
      page: { id: page.id, handle: page.handle, titulo: page.titulo, publicada: page.publicada },
      views,
      cliques,
      visitantes: unicos.length,
      ctr: views > 0 ? Math.round((cliques / views) * 1000) / 10 : 0,
      links: page.links.map((l) => ({
        id: l.id,
        rotulo: l.rotulo,
        tipo: l.tipo,
        ativo: l.ativo,
        cliques: cliquesPorLink.get(l.id) ?? 0,
        taxa: views > 0 ? Math.round(((cliquesPorLink.get(l.id) ?? 0) / views) * 1000) / 10 : 0,
      })),
      origens: ordenar(origens).slice(0, 8),
      dispositivos: ordenar(dispositivos),
      serie: [...serie.entries()].map(([dia, v]) => ({ dia, ...v })),
      janela: { dias },
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }
}
