import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { MarketingPost, Prisma } from '@prisma/client';
import {
  MAQUINA_ETAPAS,
  MAQUINA_PERFIS,
  etapaPrecisaDeData,
  metaDoMes,
  type MaquinaComentario,
  type MaquinaEtapa,
  type MaquinaEtapaInput,
  type MaquinaArquivo,
  type MaquinaHist,
  type MaquinaPainel,
  type MaquinaPerfil,
  type MaquinaPlanejamentoInput,
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

/** Os arquivos guardados em `recursos` (objetos { tipo: 'arquivo', nome, conteudo }). */
function arquivosDe(v: Prisma.JsonValue): MaquinaArquivo[] {
  return lista<Record<string, unknown>>(v)
    .filter((r) => r && typeof r === 'object' && r.tipo === 'arquivo' && typeof r.nome === 'string')
    .map((r) => ({ nome: String(r.nome), conteudo: String(r.conteudo ?? '') }));
}

/** `recursos` no banco: as linhas de texto e os arquivos juntos. */
function recursosParaGravar(textos: string[], arquivos: MaquinaArquivo[]): Prisma.InputJsonValue {
  return [...textos, ...arquivos.map((a) => ({ tipo: 'arquivo', nome: a.nome, conteudo: a.conteudo }))] as unknown as Prisma.InputJsonValue;
}

type ComentarioDaIdeia = MaquinaPost['comentarioDaIdeia'];
const comentarioDe = (c: { comentario: string | null; decididaPor: string | null; decididaEm: Date | null }): ComentarioDaIdeia =>
  c.comentario ? { texto: c.comentario, por: c.decididaPor, em: c.decididaEm?.toISOString() ?? null } : null;
const perfisDe = (v: Prisma.JsonValue): MaquinaPerfil[] => lista<string>(v).filter((x): x is MaquinaPerfil => (MAQUINA_PERFIS as readonly string[]).includes(x));

function paraTela(p: MarketingPost, comentarioDaIdeia: ComentarioDaIdeia = null): MaquinaPost {
  return {
    id: p.id,
    numero: p.numero,
    ordem: p.ordem,
    titulo: p.titulo,
    pilar: p.pilar,
    formato: p.formato,
    subtipo: p.subtipo,
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
    recursos: lista<unknown>(p.recursos).filter((r): r is string => typeof r === 'string'),
    arquivos: arquivosDe(p.recursos),
    etapa: ((MAQUINA_ETAPAS as readonly string[]).includes(p.etapa) ? p.etapa : 'ideia') as MaquinaEtapa,
    data: dia(p.data),
    dataExecucao: dia(p.dataExecucao),
    perfis: perfisDe(p.perfis),
    comentarioDaIdeia,
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
    const cardIds = posts.map((p) => p.cardId).filter((id): id is string => !!id);
    const cards = cardIds.length
      ? await this.prisma.marketingIdeiaCard.findMany({ where: { orgId, id: { in: cardIds }, comentario: { not: null } }, select: { id: true, comentario: true, decididaPor: true, decididaEm: true } })
      : [];
    const doCard = new Map(cards.map((c) => [c.id, comentarioDe(c)]));
    return {
      posts: posts.map((p) => paraTela(p, (p.cardId && doCard.get(p.cardId)) || null)),
      pilares: pilares.map((p) => ({ chave: p.chave, nome: p.nome, cor: p.cor })),
      cadencia,
      metaDoMes: metaDoMes(cadencia, mes),
    };
  }

  /** O post para a tela, com o comentário de quando a ideia foi aprovada (mora no card da ideia). */
  private async tela(p: MarketingPost): Promise<MaquinaPost> {
    if (!p.cardId) return paraTela(p);
    const c = await this.prisma.marketingIdeiaCard.findFirst({ where: { id: p.cardId, orgId: p.orgId }, select: { comentario: true, decididaPor: true, decididaEm: true } });
    return paraTela(p, c ? comentarioDe(c) : null);
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
    const { etapa: _e, data, dataExecucao, perfis, arquivos, ...campos } = input;
    const hist: MaquinaHist[] = [{ em: new Date().toISOString(), de: null, para: etapa, por: por.nome }];
    const p = await this.prisma.marketingPost.create({
      data: {
        ...campos,
        recursos: recursosParaGravar(campos.recursos, arquivos ?? []),
        orgId,
        etapa,
        data: paraDia(data),
        dataExecucao: paraDia(dataExecucao),
        perfis: [...new Set(perfis ?? [])],
        ordem: (ultimo._max.ordem ?? 0) + 1,
        hist: hist as unknown as Prisma.InputJsonValue,
        criadoPor: por.id,
      },
    });
    return this.tela(p);
  }

  async salvar(orgId: string, id: string, input: MaquinaPostSalvarInput): Promise<MaquinaPost> {
    const atual = await this.achar(orgId, id);
    // Editar o conteúdo não muda a etapa: isso é só pelo PATCH de etapa, que grava o histórico.
    // Sem `arquivos` no corpo, os arquivos que a peça já tem ficam (o editor antigo não os conhece).
    // Datas e perfis mudam pelo planejamento (PATCH), não pelo editor.
    const { etapa: _e, data: _d, dataExecucao: _x, perfis: _p, arquivos, ...campos } = input;
    const p = await this.prisma.marketingPost.update({
      where: { id },
      data: { ...campos, recursos: recursosParaGravar(campos.recursos, arquivos ?? arquivosDe(atual.recursos)) },
    });
    return this.tela(p);
  }

  async mudarEtapa(orgId: string, id: string, por: string, input: MaquinaEtapaInput): Promise<MaquinaPost> {
    const atual = await this.achar(orgId, id);
    const hist = lista<MaquinaHist>(atual.hist);
    // Desde 02/11 o dia de postar pode ser marcado antes (planejamento) e fica ao mudar de etapa;
    // `data: null` explícito tira (soltar fora do calendário). Ir para o calendário exige data
    // (o schema já conferiu). "Pronto → Agendar" de um post que já tem dia vai direto para Agendado.
    const data = input.data !== undefined ? paraDia(input.data) : atual.data;
    const etapa: MaquinaEtapa = input.etapa === 'a_agendar' && data ? 'agendado' : input.etapa;
    if (atual.etapa !== etapa) hist.push({ em: new Date().toISOString(), de: atual.etapa as MaquinaEtapa, para: etapa, por });
    const p = await this.prisma.marketingPost.update({
      where: { id },
      data: {
        etapa,
        data,
        hist: hist as unknown as Prisma.InputJsonValue,
        ...(input.linkPublicado !== undefined ? { linkPublicado: input.linkPublicado } : {}),
      },
    });
    return this.tela(p);
  }

  /** Arrastar no calendário: muda só o dia. Post da esteira que ganha dia vira agendado. */
  async mudarData(orgId: string, id: string, por: string, data: string | null): Promise<MaquinaPost> {
    const atual = await this.achar(orgId, id);
    if (!data) {
      if (atual.etapa === 'publicado') throw new BadRequestException('Post postado precisa de data.');
      return this.mudarEtapa(orgId, id, por, { etapa: 'a_agendar', data: null });
    }
    if (atual.etapa === 'agendado' || atual.etapa === 'publicado') {
      return this.tela(await this.prisma.marketingPost.update({ where: { id }, data: { data: paraDia(data) } }));
    }
    return this.mudarEtapa(orgId, id, por, { etapa: 'agendado', data });
  }

  /**
   * PLANEJAMENTO (02/11/2026, pedido do Lucas): dia de executar, dia de postar e para quem,
   * em qualquer etapa e sem tirar o post do lugar. Só duas exceções, para o quadro não mentir:
   * "A agendar" que ganha dia de postar vira Agendado, e Agendado sem dia volta para A agendar.
   */
  async planejar(orgId: string, id: string, por: string, input: MaquinaPlanejamentoInput): Promise<MaquinaPost> {
    const atual = await this.achar(orgId, id);
    const campos: Prisma.MarketingPostUpdateInput = {};
    if (input.dataExecucao !== undefined) campos.dataExecucao = paraDia(input.dataExecucao);
    if (input.perfis !== undefined) campos.perfis = [...new Set(input.perfis)];
    if (input.data !== undefined) {
      if (!input.data && atual.etapa === 'publicado') throw new BadRequestException('Post postado precisa de data.');
      campos.data = paraDia(input.data);
      const para: MaquinaEtapa | null = atual.etapa === 'a_agendar' && input.data ? 'agendado' : atual.etapa === 'agendado' && !input.data ? 'a_agendar' : null;
      if (para) {
        const hist = [...lista<MaquinaHist>(atual.hist), { em: new Date().toISOString(), de: atual.etapa as MaquinaEtapa, para, por }];
        Object.assign(campos, { etapa: para, hist: hist as unknown as Prisma.InputJsonValue });
      }
    }
    return this.tela(await this.prisma.marketingPost.update({ where: { id }, data: campos }));
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
    return this.tela(p);
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
    return this.tela(p);
  }

  async salvarCadencia(orgId: string, dias: number[]) {
    const cadencia = [...new Set(dias)].sort();
    await this.prisma.marketingMaquinaAjuste.upsert({ where: { orgId }, create: { orgId, cadencia }, update: { cadencia } });
    return { cadencia };
  }
}
