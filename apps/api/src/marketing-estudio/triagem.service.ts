import { ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { MarketingIdeiaCard, MarketingNota, PautaCaptura, Prisma } from '@prisma/client';
import {
  FORMATOS_COM_REGUA,
  TRIAGEM_STATUS,
  cardDaNotaSemIa,
  duasFrases,
  pesoDaFonte,
  scoreDaIdeia,
  semTravessao,
  chaveDaEstrategia,
  type TriagemBase,
  type TriagemCard,
  type TriagemDecisaoInput,
  type TriagemPainel,
  type TriagemStatus,
  type TriagemTodas,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { MarcaService } from '../pauta/marca.service';
import { MemoriaService } from '../memory/memoria.service';
import { GoogleService } from '../google/google.service';
import { jsonDaIa, lerMetaDoLink, textoLimpo } from './leitura-de-link';
import { REGRAS_DE_PARTIDA, SYSTEM_TRIAGEM } from './prompts';

/*
 * IDEIAS › TRIAGEM, a do ROOT Estúdio (26/10/2026): um card por vez.
 *
 * A matéria-prima é o que o OS já junta: as capturas da Pauta (RSS, grupo de
 * links, tela de Referências) e as notas da Memória. A IA lê em lotes de 4 e
 * escreve o card (título, resumo, por que tem a ver, como fazer). O score é
 * relevância × peso da fonte + bônus de recência; o peso da fonte sobe quando a
 * equipe aprova e desce quando recusa (2 × (a+2)/(a+r+4), entre 0,3 e 2). É a
 * retroalimentação do Estúdio. Aprovar cria o post no Banco da Máquina.
 *
 * Da Memória só entra o que a equipe mandou para Ideias (29/10/2026): o card nasce
 * na hora em `cardDaNota`, e a IA não pode descartar o que foi escolhido à mão.
 *
 * Nada aqui mexe na captura nem na nota: o card só aponta para elas.
 *
 * Card que nasceu com a IA fora do ar (como.semIa, ou sem "por que" e sem gancho) é
 * relido sozinho quando a IA volta: a tela abre, o painel vê que falta ler e chama
 * `reler` em segundo plano (30/10/2026, as 77 notas do grupo Claudinho).
 */

const LOTE = 4;
/** Releitura automática no máximo a cada 5 min por empresa: se a IA falhar, não insiste a cada clique. */
const INTERVALO_DA_RELEITURA = 5 * 60_000;
const FONTE_DA_MEMORIA = 'memoria';
const simulada = () => process.env.MARKETING_IA_SIMULADA === '1';
const lim = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const FORMATOS = FORMATOS_COM_REGUA as readonly string[];

interface Materia {
  capturaId: string | null;
  notaId: string | null;
  fonteId: string;
  fonteNome: string;
  titulo: string;
  texto: string;
  url: string | null;
  imagemUrl: string | null;
  publicadoEm: Date | null;
}

interface SaidaDoCard {
  idx?: number;
  keep?: boolean | string;
  title?: string;
  summary?: string;
  why?: string;
  how?: { format?: string; hook?: string; opening_clip?: unknown };
  key_points?: unknown[];
  relevance?: number;
}

interface Contexto {
  marca: string;
  estrategia: string;
  regras: string;
  aprovadas: { titulo: string; formatoSugerido: string }[];
  recusadas: { titulo: string; motivo: string | null }[];
  algoritmo: { titulo: string; status: string; motivo: string | null; comentario: string | null }[];
}

function materiaDaNota(n: Pick<MarketingNota, 'id' | 'titulo' | 'resumo' | 'corpo' | 'url' | 'criadaEm'>): Materia {
  return {
    capturaId: null,
    notaId: n.id,
    fonteId: FONTE_DA_MEMORIA,
    fonteNome: 'Memória',
    titulo: n.titulo,
    texto: `${n.resumo}\n${n.corpo}`.slice(0, 1200),
    url: n.url,
    imagemUrl: null,
    publicadoEm: n.criadaEm,
  };
}

type CapturaLida = Pick<PautaCaptura, 'id' | 'titulo' | 'nota' | 'url' | 'capturadoEm' | 'fonteId' | 'bruto'> & { fonte: { nome: string } | null };

function materiaDaCaptura(c: CapturaLida): Materia {
  const bruto = (b: unknown, k: string) => (b && typeof b === 'object' ? String((b as Record<string, unknown>)[k] ?? '') : '');
  return {
    capturaId: c.id,
    notaId: null,
    fonteId: c.fonteId ?? '',
    fonteNome: c.fonte?.nome ?? 'Captura',
    titulo: textoLimpo(c.titulo ?? '') || c.url || 'Sem título',
    texto: [c.nota, bruto(c.bruto, 'descricao'), bruto(c.bruto, 'description'), bruto(c.bruto, 'resumo'), bruto(c.bruto, 'texto')].filter(Boolean).map((t) => textoLimpo(t as string)).join('\n').slice(0, 1200),
    url: c.url,
    imagemUrl: ['imagem', 'image', 'displayUrl', 'thumbnailUrl', 'imageUrl', 'coverUrl'].map((k) => bruto(c.bruto, k)).find((u) => /^https?:\/\//.test(u)) || null,
    publicadoEm: (() => {
      const p = bruto(c.bruto, 'publicadoEm') || bruto(c.bruto, 'isoDate') || bruto(c.bruto, 'pubDate');
      const d = p ? new Date(p) : c.capturadoEm;
      return Number.isNaN(d.getTime()) ? c.capturadoEm : d;
    })(),
  };
}

/** O card foi escrito sem a IA: marcado na criação (como.semIa) ou, nos antigos, sem "por que" e sem gancho. */
function semLeitura(c: Pick<MarketingIdeiaCard, 'porque' | 'como'>): boolean {
  const como = (c.como && typeof c.como === 'object' ? c.como : {}) as Record<string, unknown>;
  if (como.semIa === true) return true;
  return !String(c.porque ?? '').trim() && !String(como.gancho ?? '').trim();
}

function paraTela(c: MarketingIdeiaCard, peso: number | null): TriagemCard {
  const como = (c.como && typeof c.como === 'object' ? c.como : {}) as Record<string, unknown>;
  return {
    id: c.id,
    titulo: textoLimpo(c.titulo),
    resumo: textoLimpo(c.resumo),
    porque: c.porque,
    como: {
      formato: String(como.formato ?? c.formatoSugerido),
      gancho: String(como.gancho ?? ''),
      clipe: como.clipe ? String(como.clipe) : null,
      pontos: Array.isArray(como.pontos) ? como.pontos.map(String) : [],
    },
    formatoSugerido: c.formatoSugerido,
    url: c.url,
    imagemUrl: c.imagemUrl,
    score: c.score,
    status: c.status as TriagemStatus,
    fonte: c.fonteId || c.fonteNome ? { id: c.fonteId, nome: c.fonteNome || 'Fonte', peso: peso ?? 1 } : null,
    publicadoEm: c.publicadoEm?.toISOString() ?? null,
    postId: c.postId,
    origem: c.notaId ? 'salvo' : 'fonte',
    motivo: c.motivo,
    comentario: c.comentario,
    decididaEm: c.decididaEm?.toISOString() ?? null,
    lida: !semLeitura(c),
  };
}

@Injectable()
export class TriagemService {
  private readonly log = new Logger('TriagemDoMarketing');
  /** Uma montagem por empresa de cada vez: dois cliques não fazem card repetido. */
  private readonly travas = new Map<string, Promise<unknown>>();
  /** Quando a releitura automática começou pela última vez, por empresa. */
  private readonly relidaEm = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly marcas: MarcaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Optional() private readonly memoria?: MemoriaService,
    @Optional() private readonly google?: GoogleService,
  ) {}

  async painel(orgId: string): Promise<TriagemPainel> {
    const pesos = await this.pesos(orgId);
    const [cards, grupos, ultima] = await Promise.all([
      this.prisma.marketingIdeiaCard.findMany({ where: { orgId, status: 'nova' }, orderBy: [{ score: 'desc' }, { criadaEm: 'desc' }], take: 20 }),
      this.prisma.marketingIdeiaCard.groupBy({ by: ['status'], where: { orgId }, _count: { _all: true } }),
      this.ultimaDesfazivel(orgId),
    ]);
    const contagem = this.contar(grupos);
    const ia = simulada() || this.llm.configured;
    const faltaLer = (await this.cardsSemLeitura(orgId)).length;
    // A IA voltou e há card que nasceu sem ela: lê em segundo plano; a tela acompanha pelo `lendo`.
    if (ia && faltaLer && !this.travas.has(orgId) && Date.now() - (this.relidaEm.get(orgId) ?? 0) > INTERVALO_DA_RELEITURA) {
      this.relidaEm.set(orgId, Date.now());
      void this.reler(orgId).then(
        (r) => this.log.log(`releitura automática: ${r.relidos} de ${r.lidos} cards${r.falharam ? `, ${r.falharam} falharam` : ''}`),
        (e) => this.log.warn(`releitura automática: ${e instanceof Error ? e.message : e}`),
      );
    }
    return {
      cards: cards.map((c) => paraTela(c, pesos[c.fonteId ?? ''] ?? null)),
      contagem,
      pendentes: (await this.materia(orgId, 500)).length,
      ultima: ultima ? { id: ultima.id, titulo: ultima.titulo, status: ultima.status as TriagemStatus } : null,
      ia,
      semLeitura: faltaLer,
      lendo: this.travas.has(orgId),
    };
  }

  /** Ver todas: os cards de um status, do mais relevante para o menos (até 500). */
  async todas(orgId: string, status: string): Promise<TriagemTodas> {
    const st = (TRIAGEM_STATUS as readonly string[]).includes(status) ? (status as TriagemStatus) : 'nova';
    const pesos = await this.pesos(orgId);
    const [cards, grupos] = await Promise.all([
      this.prisma.marketingIdeiaCard.findMany({
        where: { orgId, status: st },
        orderBy: st === 'nova' || st === 'descartada_ia' ? [{ score: 'desc' }, { criadaEm: 'desc' }] : [{ decididaEm: 'desc' }],
        take: 500,
      }),
      this.prisma.marketingIdeiaCard.groupBy({ by: ['status'], where: { orgId }, _count: { _all: true } }),
    ]);
    return { cards: cards.map((c) => paraTela(c, pesos[c.fonteId ?? ''] ?? null)), contagem: this.contar(grupos) };
  }

  /** Lê até `quantas` itens ainda sem card e escreve os cards. */
  montar(orgId: string, quantas: number): Promise<{ lidos: number; cards: number; descartados: number; falharam: number }> {
    return this.naVez(orgId, () => this.montarAgora(orgId, quantas));
  }

  /**
   * Reler com a IA: reescreve os cards pedidos (ou todos os que nasceram sem leitura) no
   * lugar, com a marca, as réguas e o algoritmo. Não muda o status: o que está para avaliar
   * continua para avaliar, e nota da Memória continua com relevância de pelo menos 80.
   */
  reler(orgId: string, ids?: string[]): Promise<{ lidos: number; relidos: number; falharam: number }> {
    return this.naVez(orgId, () => this.relerAgora(orgId, ids));
  }

  /** Uma leitura da IA por empresa de cada vez (montar e reler entram na mesma fila). */
  private naVez<T>(orgId: string, fazer: () => Promise<T>): Promise<T> {
    const anterior = this.travas.get(orgId) ?? Promise.resolve();
    const vez = anterior.catch(() => undefined).then(fazer);
    this.travas.set(orgId, vez);
    void vez.finally(() => {
      if (this.travas.get(orgId) === vez) this.travas.delete(orgId);
    }).catch(() => undefined);
    return vez;
  }

  private contar(grupos: { status: string; _count: { _all: number } }[]): Record<TriagemStatus, number> {
    const contagem = Object.fromEntries(TRIAGEM_STATUS.map((s) => [s, 0])) as Record<TriagemStatus, number>;
    for (const g of grupos) contagem[g.status as TriagemStatus] = g._count._all;
    return contagem;
  }

  /**
   * A equipe mandou a nota da Memória para Ideias: o card nasce na hora. A IA escreve como
   * na triagem (marca, réguas, algoritmo), mas não descarta e o card entra com relevância
   * de pelo menos 80. Sem IA, ou se ela falhar, o card sai do que a nota já tem.
   */
  async cardDaNota(orgId: string, notaId: string): Promise<{ id: string; status: TriagemStatus; comIa: boolean | null }> {
    const ja = await this.prisma.marketingIdeiaCard.findFirst({ where: { orgId, notaId } });
    if (ja) {
      // A IA tinha descartado antes de a equipe escolher: a escolha vale. comIa null = o card já existia.
      if (ja.status === 'descartada_ia') await this.prisma.marketingIdeiaCard.update({ where: { id: ja.id }, data: { status: 'nova' } });
      return { id: ja.id, status: ja.status === 'descartada_ia' ? 'nova' : (ja.status as TriagemStatus), comIa: null };
    }
    const n = await this.prisma.marketingNota.findFirst({ where: { id: notaId, orgId } });
    if (!n) throw new NotFoundException('Nota não encontrada.');
    const m = materiaDaNota(n);
    let o: SaidaDoCard | undefined;
    if (simulada() || this.llm.configured) {
      try {
        await this.completarComAPagina(m);
        o = simulada() ? this.simular([m])[0] : (await this.perguntar(orgId, await this.contexto(orgId), [m]))[0];
      } catch (e) {
        this.log.warn(`card da nota ${notaId}: ${e instanceof Error ? e.message : e}`);
      }
    }
    const pesos = await this.pesos(orgId);
    const c = await this.gravarCard(orgId, m, o ?? { ...cardDaNotaSemIa(n), relevance: 80 }, pesos[FONTE_DA_MEMORIA] ?? 1, true, !o);
    const final = c ?? (await this.prisma.marketingIdeiaCard.findFirst({ where: { orgId, notaId } }));
    if (!final) throw new ConflictException('Não deu para criar o card em Ideias. Tente de novo.');
    return { id: final.id, status: final.status as TriagemStatus, comIa: !!o && !!c };
  }

  async decidir(orgId: string, id: string, por: string, entrada: TriagemDecisaoInput): Promise<{ card: TriagemCard; postId: string | null }> {
    const r = await this.prisma.$transaction(async (tx) => {
      const c = await tx.marketingIdeiaCard.findFirst({ where: { id, orgId } });
      if (!c) throw new NotFoundException('Card não encontrado.');
      if (c.status !== 'nova') throw new ConflictException('Esse card já foi decidido. Recarregue a página.');
      const data: Prisma.MarketingIdeiaCardUpdateInput = { status: entrada.decisao, decididaEm: new Date(), decididaPor: por, comentario: entrada.comentario || null };
      let postId: string | null = null;
      if (entrada.decisao === 'recusada') data.motivo = entrada.motivo || null;
      else {
        const como = (c.como ?? {}) as Record<string, unknown>;
        const titulo = entrada.titulo || c.titulo;
        const formato = entrada.formato && FORMATOS.includes(entrada.formato) ? entrada.formato : c.formatoSugerido;
        const gancho = entrada.gancho ?? String(como.gancho ?? '');
        const pontos = Array.isArray(como.pontos) ? (como.pontos as unknown[]).map(String) : [];
        const porque = [c.porque, (entrada.resumo ?? c.resumo) && `Resumo: ${entrada.resumo ?? c.resumo}`, pontos.length ? `Pontos:\n${pontos.map((p) => `- ${p}`).join('\n')}` : '', como.clipe ? `Clipe de abertura: ${como.clipe}` : '']
          .filter(Boolean).join('\n\n');
        const post = await tx.marketingPost.create({
          data: {
            orgId,
            titulo: titulo.slice(0, 200),
            formato,
            tipoCard: formato === 'Reel' ? 'video' : 'arte',
            headline: gancho.slice(0, 600),
            porque: porque.slice(0, 2000),
            fontes: [{ tipo: c.notaId ? 'referencia' : 'web', nome: (c.fonteNome || 'Triagem').slice(0, 200), ...(c.url ? { link: c.url.slice(0, 500) } : {}) }],
            etapa: 'ideia',
            cardId: c.id,
            criadoPor: por,
            hist: [{ em: new Date().toISOString(), de: null, para: 'ideia', por }],
          },
        });
        postId = post.id;
        Object.assign(data, { postId, titulo, formatoSugerido: formato, como: { ...como, gancho } });
      }
      const salvo = await tx.marketingIdeiaCard.update({ where: { id }, data });
      return { card: paraTela(salvo, null), postId };
    });
    // O algoritmo no Obsidian: regravado a cada decisão comentada (ou recusada com motivo).
    if (entrada.comentario || entrada.motivo) void this.gravarAlgoritmo(orgId);
    return r;
  }

  /** Base: o que foi aprovado (das fontes e o que você salvou na Memória), mais recente primeiro. */
  async base(orgId: string, q: string, origem: string): Promise<TriagemBase> {
    const where: Prisma.MarketingIdeiaCardWhereInput = { orgId, status: 'aprovada' };
    const busca = lim(q, 100);
    if (busca) where.OR = [{ titulo: { contains: busca, mode: 'insensitive' } }, { resumo: { contains: busca, mode: 'insensitive' } }, { url: { contains: busca, mode: 'insensitive' } }];
    const todos = await this.prisma.marketingIdeiaCard.findMany({ where, orderBy: { decididaEm: 'desc' }, take: 300 });
    const cards = todos.map((c) => paraTela(c, null));
    const contagem = { fonte: cards.filter((c) => c.origem === 'fonte').length, salvo: cards.filter((c) => c.origem === 'salvo').length };
    return { cards: origem === 'fonte' || origem === 'salvo' ? cards.filter((c) => c.origem === origem) : cards, contagem };
  }

  /** Desfaz a última decisão. O post criado vai para Arquivado (a Máquina não apaga post). */
  async desfazer(orgId: string, id: string, por: string): Promise<{ ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.marketingIdeiaCard.findFirst({ where: { id, orgId } });
      if (!c || !['aprovada', 'recusada'].includes(c.status)) throw new ConflictException('Não há decisão para desfazer nesse card.');
      if (c.postId) {
        const p = await tx.marketingPost.findFirst({ where: { id: c.postId, orgId } });
        if (p && p.etapa !== 'ideia') throw new ConflictException('O post desse card já saiu do Banco. Para desistir, arquive o post.');
        if (p) {
          const hist = Array.isArray(p.hist) ? [...(p.hist as unknown[])] : [];
          hist.push({ em: new Date().toISOString(), de: p.etapa, para: 'arquivado', por: `${por} (desfez a triagem)` });
          await tx.marketingPost.update({ where: { id: p.id }, data: { etapa: 'arquivado', hist: hist as Prisma.InputJsonValue } });
        }
      }
      await tx.marketingIdeiaCard.update({ where: { id }, data: { status: 'nova', motivo: null, comentario: null, decididaEm: null, decididaPor: null, postId: null } });
    });
    return { ok: true };
  }

  // ---------- por dentro ----------

  private async ultimaDesfazivel(orgId: string) {
    const c = await this.prisma.marketingIdeiaCard.findFirst({
      where: { orgId, status: { in: ['aprovada', 'recusada'] }, decididaEm: { not: null } },
      orderBy: { decididaEm: 'desc' },
    });
    if (!c) return null;
    if (c.postId) {
      const p = await this.prisma.marketingPost.findFirst({ where: { id: c.postId, orgId }, select: { etapa: true } });
      if (p && p.etapa !== 'ideia') return null;
    }
    return c;
  }

  /** O peso de cada fonte (sobe quando aprova, desce quando recusa), para a tela Fontes. */
  pesosDasFontes(orgId: string): Promise<Record<string, number>> {
    return this.pesos(orgId);
  }

  /** Peso de cada fonte pelas decisões dos cards dela. */
  private async pesos(orgId: string): Promise<Record<string, number>> {
    const linhas = await this.prisma.marketingIdeiaCard.groupBy({
      by: ['fonteId', 'status'],
      where: { orgId, status: { in: ['aprovada', 'recusada'] } },
      _count: { _all: true },
    });
    const conta: Record<string, { a: number; r: number }> = {};
    for (const l of linhas) {
      const k = l.fonteId ?? '';
      conta[k] ??= { a: 0, r: 0 };
      if (l.status === 'aprovada') conta[k].a += l._count._all;
      else conta[k].r += l._count._all;
    }
    return Object.fromEntries(Object.entries(conta).map(([k, v]) => [k, pesoDaFonte(v.a, v.r)]));
  }

  /**
   * O que ainda não virou card: capturas em rascunho da Pauta e notas da Memória que a
   * equipe mandou para Ideias (normalmente o card já nasceu em `cardDaNota`; aqui entra
   * a que ficou sem card porque a criação falhou).
   */
  private async materia(orgId: string, teto: number): Promise<Materia[]> {
    const [comCard, capturas, notas] = await Promise.all([
      this.prisma.marketingIdeiaCard.findMany({ where: { orgId }, select: { capturaId: true, notaId: true } }),
      this.prisma.pautaCaptura.findMany({
        where: { orgId, status: 'rascunho' },
        orderBy: { capturadoEm: 'desc' },
        take: teto,
        select: { id: true, titulo: true, nota: true, url: true, capturadoEm: true, fonteId: true, bruto: true, fonte: { select: { nome: true } } },
      }),
      this.prisma.marketingNota.findMany({
        where: { orgId, status: 'pronto', destino: { in: ['conteudo', 'conteudo_e_referencia'] } },
        orderBy: { criadaEm: 'desc' },
        take: teto,
        select: { id: true, titulo: true, resumo: true, corpo: true, url: true, criadaEm: true, autor: true },
      }),
    ]);
    const usadasC = new Set(comCard.map((c) => c.capturaId).filter(Boolean));
    const usadasN = new Set(comCard.map((c) => c.notaId).filter(Boolean));
    const deCapturas: Materia[] = capturas.filter((c) => !usadasC.has(c.id)).map(materiaDaCaptura);
    const deNotas: Materia[] = notas.filter((n) => !usadasN.has(n.id)).map(materiaDaNota);
    // O que a equipe guardou na Memória vem antes do que o robô coletou.
    return [...deNotas, ...deCapturas].slice(0, teto);
  }

  /** Cards para avaliar que nasceram sem a IA (até 200 por vez). */
  private async cardsSemLeitura(orgId: string): Promise<MarketingIdeiaCard[]> {
    const novas = await this.prisma.marketingIdeiaCard.findMany({ where: { orgId, status: 'nova' }, orderBy: [{ score: 'desc' }, { criadaEm: 'desc' }], take: 1000 });
    return novas.filter(semLeitura).slice(0, 200);
  }

  /** A matéria de um card que já existe: a nota ou a captura de onde ele veio; sem elas, o próprio card. */
  private async materiaDoCard(orgId: string, c: MarketingIdeiaCard): Promise<Materia> {
    if (c.notaId) {
      const n = await this.prisma.marketingNota.findFirst({ where: { id: c.notaId, orgId }, select: { id: true, titulo: true, resumo: true, corpo: true, url: true, criadaEm: true } });
      if (n) return { ...materiaDaNota(n), imagemUrl: c.imagemUrl };
    }
    if (c.capturaId) {
      const cap = await this.prisma.pautaCaptura.findFirst({
        where: { id: c.capturaId, orgId },
        select: { id: true, titulo: true, nota: true, url: true, capturadoEm: true, fonteId: true, bruto: true, fonte: { select: { nome: true } } },
      });
      if (cap) {
        const m = materiaDaCaptura(cap);
        return { ...m, imagemUrl: m.imagemUrl ?? c.imagemUrl };
      }
    }
    return { capturaId: c.capturaId, notaId: c.notaId, fonteId: c.fonteId ?? '', fonteNome: c.fonteNome || 'Fonte', titulo: c.titulo, texto: c.resumo, url: c.url, imagemUrl: c.imagemUrl, publicadoEm: c.publicadoEm };
  }

  private async relerAgora(orgId: string, ids?: string[]) {
    if (!simulada() && !this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }
    const lista = ids?.length
      ? await this.prisma.marketingIdeiaCard.findMany({ where: { orgId, id: { in: ids }, status: { in: ['nova', 'descartada_ia'] } } })
      : await this.cardsSemLeitura(orgId);
    const resultado = { lidos: lista.length, relidos: 0, falharam: 0 };
    if (!lista.length) return resultado;
    const pesos = await this.pesos(orgId);
    const ctx = await this.contexto(orgId);
    for (let i = 0; i < lista.length; i += LOTE) {
      const lote = lista.slice(i, i + LOTE);
      const materias = await Promise.all(lote.map((c) => this.materiaDoCard(orgId, c)));
      await Promise.all(materias.map((m) => this.completarComAPagina(m)));
      let itens: SaidaDoCard[];
      try {
        itens = simulada() ? this.simular(materias) : await this.perguntar(orgId, ctx, materias);
      } catch (e) {
        this.log.warn(`releitura: ${e instanceof Error ? e.message : e}`);
        resultado.falharam += lote.length;
        continue;
      }
      for (const [idx, c] of lote.entries()) {
        const o = itens.find((x) => Number(x?.idx) === idx) ?? itens[idx];
        if (!o) {
          resultado.falharam++;
          continue;
        }
        const dados = { ...this.dadosDoCard(materias[idx], o, pesos[materias[idx].fonteId] ?? 1, !!c.notaId, false), status: c.status };
        // O card pode ter sido decidido enquanto a IA lia: só reescreve o que segue sem decisão.
        const r = await this.prisma.marketingIdeiaCard.updateMany({ where: { id: c.id, orgId, status: c.status }, data: dados });
        if (r.count) resultado.relidos++;
      }
    }
    return resultado;
  }

  private async montarAgora(orgId: string, quantas: number) {
    if (!simulada() && !this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }
    const lista = await this.materia(orgId, quantas);
    const pesos = await this.pesos(orgId);
    const resultado = { lidos: lista.length, cards: 0, descartados: 0, falharam: 0 };
    if (!lista.length) return resultado;
    const ctx = await this.contexto(orgId);
    for (let i = 0; i < lista.length; i += LOTE) {
      const lote = lista.slice(i, i + LOTE);
      await Promise.all(lote.map((m) => this.completarComAPagina(m)));
      let itens: SaidaDoCard[];
      try {
        itens = simulada() ? this.simular(lote) : await this.perguntar(orgId, ctx, lote);
      } catch (e) {
        this.log.warn(`lote da triagem: ${e instanceof Error ? e.message : e}`);
        resultado.falharam += lote.length;
        continue;
      }
      for (const [idx, m] of lote.entries()) {
        const o = itens.find((x) => Number(x?.idx) === idx) ?? itens[idx];
        if (!o) {
          resultado.falharam++;
          continue;
        }
        // Nota da Memória só chega aqui se a equipe mandou para Ideias: a IA não descarta.
        const c = await this.gravarCard(orgId, m, o, pesos[m.fonteId] ?? 1, !!m.notaId);
        if (!c) continue;
        if (c.status === 'nova') resultado.cards++;
        else resultado.descartados++;
      }
    }
    return resultado;
  }

  /**
   * Os campos do card a partir da saída da IA. `escolhida` = a equipe mandou: não descarta e
   * relevância mínima 80. `semIa` = a saída veio do resumo da nota, não da IA (falta ler).
   */
  private dadosDoCard(m: Materia, o: SaidaDoCard, peso: number, escolhida: boolean, semIa: boolean) {
    const formato = FORMATOS.includes(String(o.how?.format)) ? String(o.how?.format) : 'Carrossel';
    const daIa = Math.max(0, Math.min(100, Math.round(Number(o.relevance) || 0)));
    const relevancia = escolhida ? Math.max(daIa, 80) : daIa;
    const manter = escolhida || (o.keep !== false && o.keep !== 'false');
    const clipe = formato === 'Reel' && o.how?.opening_clip ? lim(typeof o.how.opening_clip === 'string' ? o.how.opening_clip : JSON.stringify(o.how.opening_clip), 400) : null;
    return {
      titulo: semTravessao(lim(o.title, 160) || lim(m.titulo, 160) || 'Sem título'),
      resumo: semTravessao(duasFrases(o.summary) || duasFrases(m.texto)),
      porque: semTravessao(lim(o.why, 400)),
      como: {
        formato,
        gancho: semTravessao(lim(o.how?.hook, 300)),
        clipe,
        pontos: (Array.isArray(o.key_points) ? o.key_points : []).map((p) => semTravessao(lim(p, 240))).filter(Boolean).slice(0, 5),
        ...(semIa ? { semIa: true } : {}),
      },
      formatoSugerido: formato,
      imagemUrl: m.imagemUrl,
      relevancia,
      score: scoreDaIdeia(relevancia, peso, m.publicadoEm),
      status: manter ? 'nova' : 'descartada_ia',
    };
  }

  /** Grava o card da saída da IA (ver `dadosDoCard`). Null se já existia. */
  private async gravarCard(orgId: string, m: Materia, o: SaidaDoCard, peso: number, escolhida: boolean, semIa = false): Promise<MarketingIdeiaCard | null> {
    try {
      return await this.prisma.marketingIdeiaCard.create({
        data: {
          orgId,
          capturaId: m.capturaId,
          notaId: m.notaId,
          fonteId: m.fonteId || null,
          fonteNome: m.fonteNome,
          url: m.url,
          publicadoEm: m.publicadoEm,
          ...this.dadosDoCard(m, o, peso, escolhida, semIa),
        },
      });
    } catch (e) {
      // Outro clique montou o mesmo card entre a leitura e a escrita.
      if ((e as { code?: string }).code === 'P2002') return null;
      throw e;
    }
  }

  /** O que a IA lê antes de escrever cards: marca, estratégia do mês, réguas e o algoritmo do Lucas. */
  private async contexto(orgId: string): Promise<Contexto> {
    const [marca, estrategia, algoritmo, reguas, aprovadas, recusadas] = await Promise.all([
      this.marcas.bloco(orgId).catch(() => ''),
      this.estrategiaDoMes(orgId),
      this.prisma.marketingIdeiaCard.findMany({ where: { orgId, comentario: { not: null } }, orderBy: { decididaEm: 'desc' }, take: 40, select: { titulo: true, status: true, motivo: true, comentario: true } }),
      this.prisma.marketingRegua.findMany({ where: { orgId }, select: { formato: true, regras: true } }),
      this.prisma.marketingIdeiaCard.findMany({ where: { orgId, status: 'aprovada' }, orderBy: { decididaEm: 'desc' }, take: 20, select: { titulo: true, formatoSugerido: true } }),
      this.prisma.marketingIdeiaCard.findMany({ where: { orgId, status: 'recusada' }, orderBy: { decididaEm: 'desc' }, take: 20, select: { titulo: true, motivo: true } }),
    ]);
    const regras = FORMATOS.map((f) => `${f}: ${(reguas.find((r) => r.formato === f)?.regras || REGRAS_DE_PARTIDA[f] || '').slice(0, 700)}`).join('\n');
    return { marca, estrategia, regras, aprovadas, recusadas, algoritmo };
  }

  private async perguntar(orgId: string, ctx: Contexto, lote: Materia[]): Promise<SaidaDoCard[]> {
    const { marca, estrategia, regras, aprovadas, recusadas, algoritmo } = ctx;
    const user = [
      '## A ROOT (brandbook e pilares aprovados)', marca || '(marca ainda sem descrição)',
      estrategia ? '## Estratégia do mês' : '', estrategia ? estrategia.slice(0, 3000) : '',
      '## O algoritmo do Lucas: o que ele explicou ao aprovar ou recusar (siga isto acima de tudo)',
      algoritmo.length
        ? algoritmo.map((a) => `- ${a.status === 'aprovada' ? 'APROVOU' : 'RECUSOU'} "${a.titulo}"${a.motivo ? ` (${a.motivo})` : ''}: ${a.comentario}`).join('\n')
        : '(sem comentários ainda)',
      '## Réguas dos formatos', regras,
      '## Últimas pautas aprovadas', aprovadas.length ? aprovadas.map((a) => `- ${a.titulo} (${a.formatoSugerido})`).join('\n') : '(nenhuma ainda)',
      '## Últimas pautas recusadas e o motivo', recusadas.length ? recusadas.map((r) => `- ${r.titulo} → motivo: ${r.motivo || 'sem motivo informado'}`).join('\n') : '(nenhuma ainda)',
      `## Itens para avaliar (${lote.length})`,
      lote.map((m, idx) => [`[${idx}] Fonte: ${m.fonteNome}${m.publicadoEm ? ` · ${m.publicadoEm.toISOString().slice(0, 10)}` : ''}`, `Título: ${lim(m.titulo, 300)}`, m.url && `Link: ${m.url}`, m.texto && `Texto: ${lim(m.texto, 900)}`].filter(Boolean).join('\n')).join('\n\n'),
    ].filter(Boolean).join('\n\n');
    const saida = await this.llm.complete({ funcao: 'CT-21', system: SYSTEM_TRIAGEM, user, orgId, maxTokens: 6000 });
    const j = jsonDaIa<{ items?: SaidaDoCard[] }>(saida);
    return Array.isArray(j.items) ? j.items : [];
  }

  private async estrategiaDoMes(orgId: string): Promise<string> {
    if (!this.memoria) return '';
    try {
      const agora = new Date();
      const mes = `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}`;
      const n = await this.memoria.porChave(orgId, chaveDaEstrategia(mes));
      return n && !n.arquivadoEm ? n.body : '';
    } catch {
      return '';
    }
  }

  /** Item sem imagem ou com pouco texto: lê a página do link (og:image e descrição). Nunca falha. */
  private async completarComAPagina(m: Materia): Promise<void> {
    if (!m.url || (m.imagemUrl && m.texto.length > 120)) return;
    try {
      const meta = await lerMetaDoLink(m.url);
      if (!m.imagemUrl && meta.imagem) m.imagemUrl = meta.imagem;
      if (m.texto.length < 120 && meta.descricao) m.texto = `${m.texto}\n${textoLimpo(meta.descricao)}`.trim().slice(0, 1200);
    } catch {
      /* página fora do ar: segue com o que tem */
    }
  }

  /**
   * O ALGORITMO NO OBSIDIAN: cada decisão comentada (ou recusada com motivo) vira uma linha em
   * 40-marca-e-conteudo/Memória/Algoritmo/Decisões da triagem.md, no Drive Root. O arquivo é
   * regravado inteiro a partir do banco, mais recente primeiro. É o que a IA lê nas próximas
   * triagens e o que a equipe usa para ajustar os prompts e as réguas.
   */
  private async gravarAlgoritmo(orgId: string): Promise<void> {
    if (!this.google || process.env.MEMORIA_DRIVE_DESLIGADO === '1') return;
    try {
      const linhas = await this.prisma.marketingIdeiaCard.findMany({
        where: { orgId, OR: [{ comentario: { not: null } }, { motivo: { not: null } }] },
        orderBy: { decididaEm: 'desc' },
        take: 500,
        select: { titulo: true, status: true, motivo: true, comentario: true, decididaEm: true, fonteNome: true, url: true },
      });
      const corpo = [
        '---', 'titulo: "Decisões da triagem"', 'tipo: nota', 'pasta: Algoritmo', 'tags: ["algoritmo", "triagem"]', `atualizado_em: ${new Date().toISOString()}`, '---', '',
        '# Decisões da triagem', '',
        'O que foi aprovado ou recusado em Marketing › Ideias de conteúdo, e por quê. A IA lê esta lista antes de montar os próximos cards.', '',
        ...linhas.map((l) => [
          `- **${l.status === 'aprovada' ? 'Aprovou' : 'Recusou'}** · ${l.decididaEm?.toISOString().slice(0, 10) ?? ''} · ${l.titulo}${l.motivo ? ` · motivo: ${l.motivo}` : ''}`,
          l.comentario ? `  - ${l.comentario.replace(/\s*\n+\s*/g, ' ')}` : '',
          l.url ? `  - fonte: ${l.fonteNome} ${l.url}` : '',
        ].filter(Boolean).join('\n')),
      ].join('\n') + '\n';
      let pai = (process.env.MEMORIA_DRIVE_RAIZ_ID || '1WqCqI0gOxvVEhTPUQktATvj1lH1pOPSt').trim();
      for (const nome of ['40-marca-e-conteudo', 'Memória', 'Algoritmo']) {
        const achada = (await this.google.filhosDaPasta(orgId, pai, { nome, soPastas: true }))[0];
        pai = achada?.id ?? (await this.google.criarPasta(orgId, pai, nome)).id;
      }
      await this.google.gravarArquivoNoDrive(orgId, { folderId: pai, nome: 'Decisões da triagem.md', conteudo: corpo, mimeType: 'text/markdown' });
    } catch (e) {
      this.log.warn(`algoritmo no Drive: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Resposta simulada realista (MARKETING_IA_SIMULADA=1): descarta promoção, alterna formato. */
  private simular(lote: Materia[]): SaidaDoCard[] {
    return lote.map((m, idx) => {
      const promo = /cupom|sorteio|promo[cç][aã]o|desconto|black friday/i.test(`${m.titulo} ${m.texto}`);
      const formato = FORMATOS[(m.titulo.length + idx) % FORMATOS.length];
      return {
        idx,
        keep: !promo,
        title: `O que ${lim(m.titulo, 70).replace(/[.!?]$/, '')} ensina sobre operação`,
        summary: `${lim(m.texto || m.titulo, 160).replace(/[.!?]?$/, '.')} O caso mostra como a tecnologia muda o dia a dia de quem opera.`,
        why: 'Conversa com o pilar de IA aplicada à operação e com o dono de PME.',
        how: { format: formato, hook: `Ninguém está olhando para o detalhe que fez ${lim(m.titulo, 40).toLowerCase()} funcionar.`, opening_clip: formato === 'Reel' ? 'Tela do sistema rodando por 10 s, sem apresentador.' : null },
        key_points: ['O que aconteceu', 'Por que importa para a operação', 'O que dá para aplicar amanhã'],
        relevance: promo ? 10 : 55 + ((m.titulo.length * 7) % 40),
      };
    });
  }
}
