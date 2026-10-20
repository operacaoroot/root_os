import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FonteDaReuniao, NovaReuniao, ReuniaoCompleta, ReuniaoResumo } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { buscarLinkDeFora, FonteIndisponivelError, htmlParaTexto } from '../onboarding/trilho/leitura-da-ata.service';

const TRECHO = 280;

/** O Granola publica a nota em notes.granola.ai (ou granola.ai/…); o resto é "link". */
const ehGranola = (url: string) => /(^|\.)granola\.(ai|so)$/i.test(new URL(url).hostname);

type Linha = {
  id: string; titulo: string; em: Date; fonte: string; link: string | null;
  transcricao: string; autorId: string | null; createdAt: Date;
};

@Injectable()
export class FichaService {
  constructor(private readonly prisma: PrismaService) {}

  private async exigirCartao(orgId: string, taskId: string) {
    const t = await this.prisma.workTask.findFirst({ where: { id: taskId, orgId }, select: { id: true } });
    if (!t) throw new NotFoundException('Ficha não encontrada');
  }

  /** Nome dos autores, só das pessoas desta empresa (revisão final, item 7: o filtro por empresa não depende de quem chama). */
  private async nomes(orgId: string, ids: (string | null)[]) {
    const uns = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uns.length) return new Map<string, string>();
    const us = await this.prisma.user.findMany({ where: { orgId, id: { in: uns } }, select: { id: true, name: true } });
    return new Map(us.map((u) => [u.id, u.name]));
  }

  private resumo(r: Linha, nomes: Map<string, string>): ReuniaoResumo {
    const limpo = r.transcricao.replace(/\s+/g, ' ').trim();
    return {
      id: r.id,
      titulo: r.titulo,
      em: r.em.toISOString(),
      fonte: r.fonte as FonteDaReuniao,
      link: r.link,
      caracteres: r.transcricao.length,
      trecho: limpo.length > TRECHO ? `${limpo.slice(0, TRECHO)}…` : limpo,
      autorNome: r.autorId ? nomes.get(r.autorId) ?? null : null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async listar(orgId: string, taskId: string): Promise<ReuniaoResumo[]> {
    await this.exigirCartao(orgId, taskId);
    const rs = await this.prisma.reuniaoDoCartao.findMany({ where: { orgId, taskId }, orderBy: { em: 'desc' } });
    const n = await this.nomes(orgId, rs.map((r) => r.autorId));
    return rs.map((r) => this.resumo(r, n));
  }

  async ler(orgId: string, id: string): Promise<ReuniaoCompleta> {
    const r = await this.prisma.reuniaoDoCartao.findFirst({ where: { id, orgId } });
    if (!r) throw new NotFoundException('Reunião não encontrada');
    const n = await this.nomes(orgId, [r.autorId]);
    return { ...this.resumo(r, n), transcricao: r.transcricao };
  }

  async criar(orgId: string, autorId: string, taskId: string, body: NovaReuniao): Promise<ReuniaoResumo> {
    await this.exigirCartao(orgId, taskId);
    let texto = body.texto?.trim() ?? '';
    let fonte: FonteDaReuniao = body.fonte;
    if (body.fonte !== 'texto') {
      try {
        const { corpo, tipo } = await buscarLinkDeFora(body.link!);
        texto = /html/i.test(tipo) || /^\s*</.test(corpo) ? htmlParaTexto(corpo) : corpo.trim();
      } catch (e) {
        if (e instanceof FonteIndisponivelError) throw new BadRequestException(e.message);
        throw e;
      }
      fonte = ehGranola(body.link!) ? 'granola' : 'link';
      if (texto.length < 200) {
        throw new BadRequestException(
          'O link abriu, mas não trouxe a transcrição (a nota pode estar privada). No Granola, compartilhe a nota como pública ou cole o texto.',
        );
      }
    }
    const em = new Date(body.em.length === 10 ? `${body.em}T12:00:00-03:00` : body.em);
    if (Number.isNaN(em.getTime())) throw new BadRequestException('Data da reunião inválida.');
    const r = await this.prisma.reuniaoDoCartao.create({
      data: { orgId, taskId, titulo: body.titulo.trim(), em, fonte, link: body.link ?? null, transcricao: texto, autorId },
    });
    return this.resumo(r, await this.nomes(orgId, [autorId]));
  }

  async apagar(orgId: string, id: string): Promise<{ ok: true }> {
    const r = await this.prisma.reuniaoDoCartao.deleteMany({ where: { id, orgId } });
    if (!r.count) throw new NotFoundException('Reunião não encontrada');
    return { ok: true };
  }
}
