import { Injectable } from '@nestjs/common';
import {
  GOAL_CENARIOS, GOAL_ESCADA, GOAL_FASE, GOAL_INPUTS, GOAL_MARCOS, GOAL_TAXAS,
  type Farol, type GoalPanel, type GoalTaxaLive, type GoalWeekInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MetaService } from '../meta/meta.service';

type Week = Awaited<ReturnType<PrismaService['goalWeek']['findFirst']>>;

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly meta: MetaService,
  ) {}

  /**
   * O desafio da bio, quando existe, é a fonte da verdade do início e da meta —
   * ele já era a mesma coisa que o GoalConfig, só que com contagem automática.
   * O GoalConfig continua valendo como fallback (org sem página de bio).
   */
  private async challengeDoBio(orgId: string) {
    return this.prisma.bioChallenge.findFirst({
      where: { orgId },
      orderBy: { inicio: 'desc' },
      select: { inicio: true, metaPosts: true },
    });
  }

  private async ensureConfig(orgId: string) {
    const c = await this.prisma.goalConfig.findUnique({ where: { orgId } });
    const bio = await this.challengeDoBio(orgId);
    if (c) return bio ? { ...c, challengeStart: bio.inicio, targetPosts: bio.metaPosts } : c;
    return this.prisma.goalConfig.create({
      data: {
        orgId,
        challengeStart: bio?.inicio ?? new Date(),
        ...(bio ? { targetPosts: bio.metaPosts } : {}),
      },
    });
  }

  async setConfig(orgId: string, challengeStart?: string) {
    await this.ensureConfig(orgId);
    const bio = await this.challengeDoBio(orgId);
    if (bio) {
      // Quem manda no início do desafio é a tela do Link na bio; ignorar aqui
      // evita duas datas divergentes para a mesma coisa.
      return {
        ok: true,
        challengeStart: bio.inicio.toISOString(),
        managedBy: 'bio' as const,
      };
    }
    const c = await this.prisma.goalConfig.update({
      where: { orgId },
      data: challengeStart ? { challengeStart: new Date(challengeStart) } : {},
    });
    return { ok: true, challengeStart: c.challengeStart.toISOString() }; // evita BigInt na serialização
  }

  async weeks(orgId: string) {
    const items = await this.prisma.goalWeek.findMany({ where: { orgId }, orderBy: { weekNumber: 'asc' } });
    return { items, total: items.length, source: { tool: 'metas', generatedAt: new Date().toISOString() } };
  }

  async saveWeek(orgId: string, input: GoalWeekInput, actorId: string) {
    const { weekNumber, startDate, ...rest } = input;
    const data = { ...rest, startDate: startDate ? new Date(startDate) : undefined };
    const row = await this.prisma.goalWeek.upsert({
      where: { orgId_weekNumber: { orgId, weekNumber } },
      update: data,
      create: { orgId, weekNumber, ...data },
    });
    await this.audit.log({ orgId, actorId, action: 'goals.week_save', entityType: 'goal_week', entityId: String(weekNumber), after: { weekNumber } });
    return row;
  }

  /** Alinha a semana aos dados do Instagram (Meta): views(reach)/followers/comments/saves/posts. */
  async syncFromMeta(orgId: string, weekNumber: number, actorId: string) {
    const [overview, media] = await Promise.all([this.meta.overview(orgId), this.meta.media(orgId, 30)]);
    const weekAgo = Date.now() - 7 * 86400000;
    const recent = (media.items ?? []).filter((m: any) => m.timestamp && new Date(m.timestamp).getTime() >= weekAgo);
    const s = (k: string) => recent.reduce((a: number, m: any) => a + (Number(m[k]) || 0), 0);

    const patch = {
      posts: recent.length,
      views: s('reach'),
      comments: s('comments'),
      saves: s('saved'),
      totalFollowers: overview.followers ?? 0,
    };
    const row = await this.prisma.goalWeek.upsert({
      where: { orgId_weekNumber: { orgId, weekNumber } },
      update: { ...patch, source: 'mixed' },
      create: { orgId, weekNumber, ...patch, source: 'meta' },
    });
    await this.audit.log({ orgId, actorId, action: 'goals.sync_meta', entityType: 'goal_week', entityId: String(weekNumber), after: patch });
    return { ok: true, week: weekNumber, ...patch };
  }

  async panel(orgId: string): Promise<GoalPanel> {
    const cfg = await this.ensureConfig(orgId);
    const weeks = (await this.prisma.goalWeek.findMany({ where: { orgId }, orderBy: { weekNumber: 'asc' } })) as NonNullable<Week>[];
    const n = weeks.length;
    const last4 = weeks.slice(-4);
    const winLen = Math.max(1, last4.length);
    const sumAll = (k: keyof NonNullable<Week>) => weeks.reduce((a, w) => a + (w[k] as number), 0);
    const win = (k: keyof NonNullable<Week>) => last4.reduce((a, w) => a + (w[k] as number), 0);

    const accPosts = sumAll('posts');
    const accViews = sumAll('views');
    const accList = sumAll('listEntries');
    const followers = weeks[n - 1]?.totalFollowers ?? 0;

    const views4 = win('views');
    const posts4 = win('posts');
    const avgViewsPost = posts4 > 0 ? views4 / posts4 : 0;

    // --- fase (transição por sinal) ---
    let triggerIdx = -1;
    for (let i = 0; i < n; i++) {
      const w = weeks[i];
      const avg = w.posts > 0 ? w.views / w.posts : 0;
      if (avg >= GOAL_FASE.gatilhoMediaViews && w.nonFollowerPct >= GOAL_FASE.gatilhoNaoSeguidoresPct) { triggerIdx = i; break; }
    }
    let fase: 0 | 1 | 2 = 0;
    if (triggerIdx >= 0) fase = (n - 1 - triggerIdx) < GOAL_FASE.baselineSemanas ? 1 : 2;
    const farolLigado = fase === 2;
    const faseLabel = fase === 0 ? 'Fase 0 — Aquecimento' : fase === 1 ? 'Fase 1 — Baseline' : 'Fase 2 — Regime';

    // --- escada ---
    const faixa = GOAL_ESCADA.find((f) => accPosts >= f.de && accPosts <= f.ate) ?? GOAL_ESCADA[0];

    // --- taxas (janela 4 sem) ---
    const per1000 = (x: number): number | null => (views4 > 0 ? Math.round((x / views4) * 1000 * 100) / 100 : null);
    const storyViewersAvg = win('storyViewers') / winLen;
    const nonFollowerPctAvg = win('nonFollowerPct') / winLen;
    const nf4 = win('newFollowers');
    const pv4 = win('profileVisits');

    const rawVal: Record<string, { valor: number | null; abs: number }> = {
      distribuicao: { valor: per1000(win('shares')), abs: win('shares') },
      interesse: { valor: per1000(win('saves')), abs: win('saves') },
      conversa: { valor: per1000(win('comments')), abs: win('comments') },
      curiosidade: { valor: per1000(pv4), abs: pv4 },
      conversao_perfil: { valor: pv4 > 0 ? Math.round((nf4 / pv4) * 1000) / 10 : null, abs: nf4 },
      crescimento: { valor: per1000(nf4), abs: nf4 },
      descoberta: { valor: Math.round(nonFollowerPctAvg * 10) / 10, abs: nf4 },
      alcance: { valor: Math.round(avgViewsPost), abs: views4 },
      vinculo: { valor: followers > 0 ? Math.round((storyViewersAvg / followers) * 1000) / 10 : null, abs: Math.round(storyViewersAvg) },
      trafego_venda: { valor: per1000(win('bioClicks')), abs: win('bioClicks') },
      captura: { valor: per1000(win('listEntries')), abs: win('listEntries') },
    };

    const farol = (v: number | null, piso: number, meta: number, ativa: boolean): Farol => {
      if (!ativa) return 'na';
      if (!farolLigado) return 'off';
      if (v === null) return 'na';
      return v >= meta ? 'verde' : v >= piso ? 'amarelo' : 'vermelho';
    };
    const farolAlcance = (): Farol => {
      if (!farolLigado) return 'off';
      if (avgViewsPost >= faixa.metaMediaPost) return 'verde';
      if (avgViewsPost >= faixa.metaMediaPost * 0.5) return 'amarelo';
      return 'vermelho';
    };

    const taxas: GoalTaxaLive[] = GOAL_TAXAS.map((d) => {
      const rv = rawVal[d.id];
      return {
        id: d.id, label: d.label, descricao: d.descricao, formula: d.formula,
        valor: rv.valor, piso: d.piso, meta: d.meta, unidade: d.unidade, absoluto: rv.abs, ativa: d.ativa,
        farol: d.id === 'alcance' ? farolAlcance() : farol(rv.valor, d.piso, d.meta, d.ativa),
        ...(d.id === 'alcance' ? { refEscada: faixa.metaMediaPost } : {}),
      };
    });

    // --- dia do desafio + projeções ---
    const diaDesafio = Math.min(365, Math.max(0, Math.floor((Date.now() - cfg.challengeStart.getTime()) / 86400000)));
    const weeklyViews = views4 / winLen;
    const weeklyPosts = posts4 / winLen;
    const remainingWeeks = Math.max(0, (365 - diaDesafio) / 7);
    const viewsProj = Math.round(accViews + weeklyViews * remainingWeeks);
    const diaPost1000 = accPosts >= 1000 ? diaDesafio : weeklyPosts > 0 ? Math.round(diaDesafio + ((1000 - accPosts) / weeklyPosts) * 7) : null;

    return {
      fase, faseLabel, farolLigado, diaDesafio, semanasRegistradas: n,
      marcos: [
        { key: 'posts', label: 'Posts', atual: accPosts, meta: GOAL_MARCOS.posts, pct: pct(accPosts, GOAL_MARCOS.posts) },
        { key: 'views', label: 'Views acumuladas', atual: accViews, meta: GOAL_MARCOS.views, pct: pct(accViews, GOAL_MARCOS.views) },
        { key: 'lista', label: 'Lista própria', atual: accList, meta: GOAL_MARCOS.lista, pct: pct(accList, GOAL_MARCOS.lista), hint: 'motor real da venda' },
        { key: 'seguidores', label: 'Seguidores', atual: followers, meta: 0, pct: 0, hint: `+${nf4} nas últimas 4 semanas` },
      ],
      inputs: { postsUltimaSemana: weeks[n - 1]?.posts ?? 0, metaPostsSemana: GOAL_INPUTS.postsPorSemana, okUltimaSemana: (weeks[n - 1]?.posts ?? 0) >= GOAL_INPUTS.postsPorSemana },
      taxas,
      escada: { faixaDe: faixa.de, faixaAte: faixa.ate, metaMediaPost: faixa.metaMediaPost, mediaAtual: Math.round(avgViewsPost) },
      projecoes: {
        viewsDia365: viewsProj,
        pctMetaViews: pct(viewsProj, GOAL_MARCOS.views),
        diaPost1000,
        vendasMin: Math.round((viewsProj / 1_000_000) * GOAL_CENARIOS.pessimista),
        vendasMax: Math.round((viewsProj / 1_000_000) * GOAL_CENARIOS.mediano),
      },
      semanas: weeks.map((w) => ({
        weekNumber: w.weekNumber, posts: w.posts,
        viewsPerPost: w.posts > 0 ? Math.round(w.views / w.posts) : 0,
        status: w.posts >= 35 ? 'meta' : w.posts >= 25 ? 'abaixo' : 'recalibrar',
      })),
      janela: { semanas: winLen },
      source: { tool: 'metas', generatedAt: new Date().toISOString() },
    };
  }
}

function pct(a: number, meta: number): number {
  return meta > 0 ? Math.round((a / meta) * 1000) / 10 : 0;
}
