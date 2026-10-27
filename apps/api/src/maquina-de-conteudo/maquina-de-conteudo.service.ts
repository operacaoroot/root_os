import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { MarketingPost, Prisma } from '@prisma/client';
import {
  MAQUINA_ETAPAS,
  etapaPrecisaDeData,
  metaDoMes,
  type MaquinaComentario,
  type MaquinaEtapa,
  type MaquinaEtapaInput,
  type MaquinaHist,
  type MaquinaPainel,
  type MaquinaPost,
  type MaquinaPostSalvarInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MarcaService } from '../pauta/marca.service';

/*
 * MÁQUINA DE CONTEÚDO DA EMPRESA (Marketing). Regras de etapa em
 * packages/shared/src/maquina-de-conteudo.ts.
 *
 * Nada aqui apaga post: arquivar é uma etapa. Toda mudança de etapa grava uma
 * linha em `hist` com quem e quando, como na Máquina dos clientes.
 */

const CADENCIA_PADRAO = [2, 4];

const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const paraDia = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);
const lista = <T>(v: Prisma.JsonValue): T[] => (Array.isArray(v) ? (v as unknown as T[]) : []);
const objeto = (v: Prisma.JsonValue) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {});

function paraTela(p: MarketingPost): MaquinaPost {
  return {
    id: p.id,
    numero: p.numero,
    ordem: p.ordem,
    titulo: p.titulo,
    pilar: p.pilar,
    formato: p.formato,
    tipoCard: p.tipoCard === 'arte' ? 'arte' : 'video',
    prioridade: (['alta', 'media', 'baixa'].includes(p.prioridade) ? p.prioridade : 'media') as MaquinaPost['prioridade'],
    headline: p.headline,
    subHeadline: p.subHeadline,
    roteiro: p.roteiro,
    slides: lista<string>(p.slides),
    design: p.design,
    legenda: p.legenda,
    cta: p.cta,
    porque: p.porque,
    fontes: lista(p.fontes),
    recursos: lista<string>(p.recursos),
    etapa: ((MAQUINA_ETAPAS as readonly string[]).includes(p.etapa) ? p.etapa : 'ideia') as MaquinaEtapa,
    data: dia(p.data),
    linkPublicado: p.linkPublicado,
    metricas: objeto(p.metricas),
    hist: lista<MaquinaHist>(p.hist),
    comentarios: lista<MaquinaComentario>(p.comentarios),
    criadoEm: p.criadoEm.toISOString(),
    atualizadoEm: p.atualizadoEm.toISOString(),
  };
}

@Injectable()
export class MaquinaDeConteudoService {
  constructor(private readonly prisma: PrismaService, private readonly marca: MarcaService) {}

  private async cadencia(orgId: string): Promise<number[]> {
    const a = await this.prisma.marketingMaquinaAjuste.findUnique({ where: { orgId } });
    return a?.cadencia ?? CADENCIA_PADRAO;
  }

  async painel(orgId: string): Promise<MaquinaPainel> {
    const [posts, cadencia, pilares] = await Promise.all([
      this.prisma.marketingPost.findMany({ where: { orgId }, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] }),
      this.cadencia(orgId),
      this.marca.pilares(orgId).catch(() => []),
    ]);
    const mes = new Date().toISOString().slice(0, 7);
    return {
      posts: posts.map(paraTela),
      pilares: pilares.map((p) => ({ chave: p.chave, nome: p.nome, cor: p.cor })),
      cadencia,
      metaDoMes: metaDoMes(cadencia, mes),
    };
  }

  private async achar(orgId: string, id: string) {
    const p = await this.prisma.marketingPost.findFirst({ where: { id, orgId } });
    if (!p) throw new NotFoundException('Post não encontrado.');
    return p;
  }

  async criar(orgId: string, por: { id: string; nome: string }, input: MaquinaPostSalvarInput): Promise<MaquinaPost> {
    const etapa: MaquinaEtapa = input.etapa ?? 'ideia';
    if (etapaPrecisaDeData(etapa) && !input.data) throw new BadRequestException('Escolha a data.');
    const ultimo = await this.prisma.marketingPost.aggregate({ where: { orgId }, _max: { ordem: true } });
    const { etapa: _e, data, ...campos } = input;
    const hist: MaquinaHist[] = [{ em: new Date().toISOString(), de: null, para: etapa, por: por.nome }];
    const p = await this.prisma.marketingPost.create({
      data: {
        ...campos,
        orgId,
        etapa,
        data: paraDia(data),
        ordem: (ultimo._max.ordem ?? 0) + 1,
        hist: hist as unknown as Prisma.InputJsonValue,
        criadoPor: por.id,
      },
    });
    return paraTela(p);
  }

  async salvar(orgId: string, id: string, input: MaquinaPostSalvarInput): Promise<MaquinaPost> {
    await this.achar(orgId, id);
    // Editar o conteúdo não muda a etapa: isso é só pelo PATCH de etapa, que grava o histórico.
    const { etapa: _e, data: _d, ...campos } = input;
    const p = await this.prisma.marketingPost.update({ where: { id }, data: campos });
    return paraTela(p);
  }

  async mudarEtapa(orgId: string, id: string, por: string, input: MaquinaEtapaInput): Promise<MaquinaPost> {
    const atual = await this.achar(orgId, id);
    const hist = lista<MaquinaHist>(atual.hist);
    if (atual.etapa !== input.etapa) hist.push({ em: new Date().toISOString(), de: atual.etapa as MaquinaEtapa, para: input.etapa, por });
    // Voltar para antes do calendário tira a data; ir para o calendário exige data (o schema já conferiu).
    const data = etapaPrecisaDeData(input.etapa) ? paraDia(input.data) : input.etapa === 'arquivado' ? atual.data : null;
    const p = await this.prisma.marketingPost.update({
      where: { id },
      data: {
        etapa: input.etapa,
        data,
        hist: hist as unknown as Prisma.InputJsonValue,
        ...(input.linkPublicado !== undefined ? { linkPublicado: input.linkPublicado } : {}),
      },
    });
    return paraTela(p);
  }

  /** Arrastar no calendário: muda só o dia. Post da esteira que ganha dia vira agendado. */
  async mudarData(orgId: string, id: string, por: string, data: string | null): Promise<MaquinaPost> {
    const atual = await this.achar(orgId, id);
    if (!data) {
      if (atual.etapa === 'publicado') throw new BadRequestException('Post postado precisa de data.');
      return this.mudarEtapa(orgId, id, por, { etapa: 'a_agendar', data: null });
    }
    if (atual.etapa === 'agendado' || atual.etapa === 'publicado') {
      return paraTela(await this.prisma.marketingPost.update({ where: { id }, data: { data: paraDia(data) } }));
    }
    return this.mudarEtapa(orgId, id, por, { etapa: 'agendado', data });
  }

  async ordenar(orgId: string, ids: string[]): Promise<{ ok: true }> {
    const meus = await this.prisma.marketingPost.findMany({ where: { orgId, id: { in: ids } }, select: { id: true } });
    const validos = new Set(meus.map((m) => m.id));
    await this.prisma.$transaction(
      ids.filter((id) => validos.has(id)).map((id, i) => this.prisma.marketingPost.update({ where: { id }, data: { ordem: i + 1 } })),
    );
    return { ok: true };
  }

  async comentar(orgId: string, id: string, autor: string, texto: string): Promise<MaquinaPost> {
    const atual = await this.achar(orgId, id);
    const comentarios = [...lista<MaquinaComentario>(atual.comentarios), { autor, texto, em: new Date().toISOString() }];
    const p = await this.prisma.marketingPost.update({
      where: { id },
      data: { comentarios: comentarios as unknown as Prisma.InputJsonValue },
    });
    return paraTela(p);
  }

  async metricas(orgId: string, id: string, input: { linkPublicado?: string; metricas: Record<string, number> }) {
    const atual = await this.achar(orgId, id);
    const p = await this.prisma.marketingPost.update({
      where: { id },
      data: {
        metricas: { ...objeto(atual.metricas), ...input.metricas },
        ...(input.linkPublicado !== undefined ? { linkPublicado: input.linkPublicado } : {}),
      },
    });
    return paraTela(p);
  }

  async salvarCadencia(orgId: string, dias: number[]) {
    const cadencia = [...new Set(dias)].sort();
    await this.prisma.marketingMaquinaAjuste.upsert({ where: { orgId }, create: { orgId, cadencia }, update: { cadencia } });
    return { cadencia };
  }
}
