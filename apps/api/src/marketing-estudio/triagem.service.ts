import { ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { MarketingIdeiaCard, Prisma } from '@prisma/client';
import {
  FORMATOS_COM_REGUA,
  TRIAGEM_STATUS,
  duasFrases,
  pesoDaFonte,
  scoreDaIdeia,
  semTravessao,
  type TriagemCard,
  type TriagemDecisaoInput,
  type TriagemPainel,
  type TriagemStatus,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { MarcaService } from '../pauta/marca.service';
import { jsonDaIa } from './leitura-de-link';
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
 * Nada aqui mexe na captura nem na nota: o card só aponta para elas.
 */

const LOTE = 4;
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

function paraTela(c: MarketingIdeiaCard, peso: number | null): TriagemCard {
  const como = (c.como && typeof c.como === 'object' ? c.como : {}) as Record<string, unknown>;
  return {
    id: c.id,
    titulo: c.titulo,
    resumo: c.resumo,
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
  };
}

@Injectable()
export class TriagemService {
  private readonly log = new Logger('TriagemDoMarketing');
  /** Uma montagem por empresa de cada vez: dois cliques não fazem card repetido. */
  private readonly travas = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly marcas: MarcaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async painel(orgId: string): Promise<TriagemPainel> {
    const pesos = await this.pesos(orgId);
    const [cards, grupos, ultima] = await Promise.all([
      this.prisma.marketingIdeiaCard.findMany({ where: { orgId, status: 'nova' }, orderBy: [{ score: 'desc' }, { criadaEm: 'desc' }], take: 20 }),
      this.prisma.marketingIdeiaCard.groupBy({ by: ['status'], where: { orgId }, _count: { _all: true } }),
      this.ultimaDesfazivel(orgId),
    ]);
    const contagem = Object.fromEntries(TRIAGEM_STATUS.map((s) => [s, 0])) as Record<TriagemStatus, number>;
    for (const g of grupos) contagem[g.status as TriagemStatus] = g._count._all;
    return {
      cards: cards.map((c) => paraTela(c, pesos[c.fonteId ?? ''] ?? null)),
      contagem,
      pendentes: (await this.materia(orgId, 500)).length,
      ultima: ultima ? { id: ultima.id, titulo: ultima.titulo, status: ultima.status as TriagemStatus } : null,
      ia: simulada() || this.llm.configured,
    };
  }

  /** Lê até `quantas` itens ainda sem card e escreve os cards. */
  montar(orgId: string, quantas: number): Promise<{ lidos: number; cards: number; descartados: number; falharam: number }> {
    const anterior = this.travas.get(orgId) ?? Promise.resolve();
    const vez = anterior.catch(() => undefined).then(() => this.montarAgora(orgId, quantas));
    this.travas.set(orgId, vez);
    void vez.finally(() => {
      if (this.travas.get(orgId) === vez) this.travas.delete(orgId);
    }).catch(() => undefined);
    return vez;
  }

  async decidir(orgId: string, id: string, por: string, entrada: TriagemDecisaoInput): Promise<{ card: TriagemCard; postId: string | null }> {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.marketingIdeiaCard.findFirst({ where: { id, orgId } });
      if (!c) throw new NotFoundException('Card não encontrado.');
      if (c.status !== 'nova') throw new ConflictException('Esse card já foi decidido. Recarregue a página.');
      const data: Prisma.MarketingIdeiaCardUpdateInput = { status: entrada.decisao, decididaEm: new Date(), decididaPor: por };
      let postId: string | null = null;
      if (entrada.decisao === 'recusada') data.motivo = entrada.motivo || null;
      else {
        const como = (c.como ?? {}) as Record<string, unknown>;
        const titulo = entrada.titulo || c.titulo;
        const formato = entrada.formato && FORMATOS.includes(entrada.formato) ? entrada.formato : c.formatoSugerido;
        const gancho = entrada.gancho ?? String(como.gancho ?? '');
        const pontos = Array.isArray(como.pontos) ? (como.pontos as unknown[]).map(String) : [];
        const porque = [c.porque, c.resumo && `Resumo: ${c.resumo}`, pontos.length ? `Pontos:\n${pontos.map((p) => `- ${p}`).join('\n')}` : '', como.clipe ? `Clipe de abertura: ${como.clipe}` : '']
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
      await tx.marketingIdeiaCard.update({ where: { id }, data: { status: 'nova', motivo: null, decididaEm: null, decididaPor: null, postId: null } });
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

  /** O que ainda não virou card: capturas em rascunho da Pauta e notas prontas da Memória. */
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
        where: { orgId, status: 'pronto', tipo: { in: ['link', 'video', 'ideia'] } },
        orderBy: { criadaEm: 'desc' },
        take: teto,
        select: { id: true, titulo: true, resumo: true, corpo: true, url: true, criadaEm: true, autor: true },
      }),
    ]);
    const usadasC = new Set(comCard.map((c) => c.capturaId).filter(Boolean));
    const usadasN = new Set(comCard.map((c) => c.notaId).filter(Boolean));
    const bruto = (b: unknown, k: string) => (b && typeof b === 'object' ? String((b as Record<string, unknown>)[k] ?? '') : '');
    const deCapturas: Materia[] = capturas.filter((c) => !usadasC.has(c.id)).map((c) => ({
      capturaId: c.id,
      notaId: null,
      fonteId: c.fonteId ?? '',
      fonteNome: c.fonte?.nome ?? 'Captura',
      titulo: c.titulo ?? c.url ?? 'Sem título',
      texto: [c.nota, bruto(c.bruto, 'descricao'), bruto(c.bruto, 'description'), bruto(c.bruto, 'resumo'), bruto(c.bruto, 'texto')].filter(Boolean).join('\n').slice(0, 1200),
      url: c.url,
      imagemUrl: bruto(c.bruto, 'imagem') || bruto(c.bruto, 'image') || null,
      publicadoEm: (() => {
        const p = bruto(c.bruto, 'publicadoEm') || bruto(c.bruto, 'isoDate') || bruto(c.bruto, 'pubDate');
        const d = p ? new Date(p) : c.capturadoEm;
        return Number.isNaN(d.getTime()) ? c.capturadoEm : d;
      })(),
    }));
    const deNotas: Materia[] = notas.filter((n) => !usadasN.has(n.id)).map((n) => ({
      capturaId: null,
      notaId: n.id,
      fonteId: FONTE_DA_MEMORIA,
      fonteNome: 'Memória',
      titulo: n.titulo,
      texto: `${n.resumo}\n${n.corpo}`.slice(0, 1200),
      url: n.url,
      imagemUrl: null,
      publicadoEm: n.criadaEm,
    }));
    // O que a equipe guardou na Memória vem antes do que o robô coletou.
    return [...deNotas, ...deCapturas].slice(0, teto);
  }

  private async montarAgora(orgId: string, quantas: number) {
    if (!simulada() && !this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }
    const lista = await this.materia(orgId, quantas);
    const pesos = await this.pesos(orgId);
    const resultado = { lidos: lista.length, cards: 0, descartados: 0, falharam: 0 };
    if (!lista.length) return resultado;
    const [marca, reguas, aprovadas, recusadas] = await Promise.all([
      this.marcas.bloco(orgId).catch(() => ''),
      this.prisma.marketingRegua.findMany({ where: { orgId }, select: { formato: true, regras: true } }),
      this.prisma.marketingIdeiaCard.findMany({ where: { orgId, status: 'aprovada' }, orderBy: { decididaEm: 'desc' }, take: 20, select: { titulo: true, formatoSugerido: true } }),
      this.prisma.marketingIdeiaCard.findMany({ where: { orgId, status: 'recusada' }, orderBy: { decididaEm: 'desc' }, take: 20, select: { titulo: true, motivo: true } }),
    ]);
    const regras = FORMATOS.map((f) => `${f}: ${(reguas.find((r) => r.formato === f)?.regras || REGRAS_DE_PARTIDA[f] || '').slice(0, 700)}`).join('\n');
    for (let i = 0; i < lista.length; i += LOTE) {
      const lote = lista.slice(i, i + LOTE);
      let itens: SaidaDoCard[];
      try {
        itens = simulada() ? this.simular(lote) : await this.perguntar(orgId, marca, regras, aprovadas, recusadas, lote);
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
        const formato = FORMATOS.includes(String(o.how?.format)) ? String(o.how?.format) : 'Carrossel';
        const relevancia = Math.max(0, Math.min(100, Math.round(Number(o.relevance) || 0)));
        const manter = o.keep !== false && o.keep !== 'false';
        const clipe = formato === 'Reel' && o.how?.opening_clip ? lim(typeof o.how.opening_clip === 'string' ? o.how.opening_clip : JSON.stringify(o.how.opening_clip), 400) : null;
        try {
          await this.prisma.marketingIdeiaCard.create({
            data: {
              orgId,
              capturaId: m.capturaId,
              notaId: m.notaId,
              fonteId: m.fonteId || null,
              fonteNome: m.fonteNome,
              titulo: semTravessao(lim(o.title, 160) || lim(m.titulo, 160) || 'Sem título'),
              resumo: semTravessao(duasFrases(o.summary) || duasFrases(m.texto)),
              porque: semTravessao(lim(o.why, 400)),
              como: { formato, gancho: semTravessao(lim(o.how?.hook, 300)), clipe, pontos: (Array.isArray(o.key_points) ? o.key_points : []).map((p) => semTravessao(lim(p, 240))).filter(Boolean).slice(0, 5) },
              formatoSugerido: formato,
              url: m.url,
              imagemUrl: m.imagemUrl,
              publicadoEm: m.publicadoEm,
              relevancia,
              score: scoreDaIdeia(relevancia, pesos[m.fonteId] ?? 1, m.publicadoEm),
              status: manter ? 'nova' : 'descartada_ia',
            },
          });
          if (manter) resultado.cards++;
          else resultado.descartados++;
        } catch (e) {
          // Outro clique montou o mesmo card entre a leitura e a escrita.
          if ((e as { code?: string }).code === 'P2002') continue;
          throw e;
        }
      }
    }
    return resultado;
  }

  private async perguntar(
    orgId: string,
    marca: string,
    regras: string,
    aprovadas: { titulo: string; formatoSugerido: string }[],
    recusadas: { titulo: string; motivo: string | null }[],
    lote: Materia[],
  ): Promise<SaidaDoCard[]> {
    const user = [
      '## Marca', marca || '(marca ainda sem descrição)',
      '## Réguas dos formatos', regras,
      '## Últimas pautas aprovadas', aprovadas.length ? aprovadas.map((a) => `- ${a.titulo} (${a.formatoSugerido})`).join('\n') : '(nenhuma ainda)',
      '## Últimas pautas recusadas e o motivo', recusadas.length ? recusadas.map((r) => `- ${r.titulo} → motivo: ${r.motivo || 'sem motivo informado'}`).join('\n') : '(nenhuma ainda)',
      `## Itens para avaliar (${lote.length})`,
      lote.map((m, idx) => [`[${idx}] Fonte: ${m.fonteNome}${m.publicadoEm ? ` · ${m.publicadoEm.toISOString().slice(0, 10)}` : ''}`, `Título: ${lim(m.titulo, 300)}`, m.url && `Link: ${m.url}`, m.texto && `Texto: ${lim(m.texto, 900)}`].filter(Boolean).join('\n')).join('\n\n'),
    ].join('\n\n');
    const saida = await this.llm.complete({ funcao: 'CT-21', system: SYSTEM_TRIAGEM, user, orgId, maxTokens: 6000 });
    const j = jsonDaIa<{ items?: SaidaDoCard[] }>(saida);
    return Array.isArray(j.items) ? j.items : [];
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
