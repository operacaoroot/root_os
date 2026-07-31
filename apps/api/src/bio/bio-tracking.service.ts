import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const JANELA_VISITA_MIN = 30;

export interface ContextoVisita {
  rid: string;
  pageId: string;
  orgId: string;
  url: string;
  referrer?: string | null;
  userAgent?: string | null;
  params: Record<string, string | undefined>;
}

@Injectable()
export class BioTrackingService {
  private readonly log = new Logger('BioTracking');

  constructor(private readonly prisma: PrismaService) {}

  private lerDispositivo(ua: string | null | undefined) {
    if (!ua) return {};
    const u = ua.toLowerCase();
    const device = /ipad|tablet/.test(u)
      ? 'tablet'
      : /mobi|android|iphone/.test(u)
        ? 'mobile'
        : 'desktop';
    const os = /iphone|ipad|ios/.test(u)
      ? 'iOS'
      : /android/.test(u)
        ? 'Android'
        : /mac os/.test(u)
          ? 'macOS'
          : /windows/.test(u)
            ? 'Windows'
            : /linux/.test(u)
              ? 'Linux'
              : undefined;
    // Ordem importa: Edge e Chrome se declaram Safari no UA.
    const browser = /edg\//.test(u)
      ? 'Edge'
      : /chrome|crios/.test(u)
        ? 'Chrome'
        : /firefox|fxios/.test(u)
          ? 'Firefox'
          : /safari/.test(u)
            ? 'Safari'
            : undefined;
    return { device, os, browser };
  }

  /** Reaproveita a visita recente do mesmo visitante na mesma página (janela de sessão). */
  private async visitaAtual(ctx: ContextoVisita) {
    const desde = new Date(Date.now() - JANELA_VISITA_MIN * 60_000);
    const recente = await this.prisma.bioVisit.findFirst({
      where: { visitorId: ctx.rid, pageId: ctx.pageId, iniciadaEm: { gte: desde } },
      orderBy: { iniciadaEm: 'desc' },
    });
    if (recente) return recente;

    await this.prisma.bioVisitor.upsert({
      where: { id: ctx.rid },
      update: { ultimoVisto: new Date() },
      create: { id: ctx.rid },
    });

    const { device, os, browser } = this.lerDispositivo(ctx.userAgent);
    return this.prisma.bioVisit.create({
      data: {
        orgId: ctx.orgId,
        visitorId: ctx.rid,
        pageId: ctx.pageId,
        referrer: ctx.referrer?.slice(0, 500) ?? null,
        utmSource: ctx.params.utm_source ?? null,
        utmMedium: ctx.params.utm_medium ?? null,
        utmCampaign: ctx.params.utm_campaign ?? null,
        utmContent: ctx.params.utm_content ?? null,
        utmTerm: ctx.params.utm_term ?? null,
        fbclid: ctx.params.fbclid ?? null,
        ttclid: ctx.params.ttclid ?? null,
        gclid: ctx.params.gclid ?? null,
        device,
        os,
        browser,
      },
    });
  }

  /**
   * Nunca lançar: rastreio quebrado não pode derrubar a bio de ninguém.
   * O chamador não espera por isto — a página responde antes.
   */
  async registrar(
    ctx: ContextoVisita,
    nome: string,
    extra?: { linkId?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    try {
      const visita = await this.visitaAtual(ctx);
      const eventId = randomUUID();
      const url = ctx.url.slice(0, 500);
      const metadata = extra?.metadata as Prisma.InputJsonValue | undefined;

      await this.prisma.bioEvent.create({
        data: {
          eventId,
          orgId: ctx.orgId,
          pageId: ctx.pageId,
          visitId: visita.id,
          visitorId: ctx.rid,
          nome,
          linkId: extra?.linkId ?? null,
          url,
          metadata,
        },
      });

      // Mesmo eventId no PixelEvent: o @unique de lá faz o dedup, então o funil
      // genérico da plataforma enxerga o tráfego da bio sem tabela paralela.
      await this.prisma.pixelEvent.upsert({
        where: { eventId },
        update: {},
        create: {
          orgId: ctx.orgId,
          eventId,
          sessionId: visita.id,
          anonymousId: ctx.rid,
          eventName: nome,
          url,
          referrer: visita.referrer,
          utmSource: visita.utmSource,
          utmMedium: visita.utmMedium,
          utmCampaign: visita.utmCampaign,
          utmContent: visita.utmContent,
          utmTerm: visita.utmTerm,
          device: visita.device,
          metadata: {
            fonte: 'bio',
            pageId: ctx.pageId,
            ...(extra?.linkId ? { linkId: extra.linkId } : {}),
            ...(extra?.metadata ?? {}),
          } as Prisma.InputJsonValue,
        },
      });
    } catch (erro) {
      this.log.warn(`registro de "${nome}" falhou: ${(erro as Error).message}`);
    }
  }
}
