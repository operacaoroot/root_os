import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ContextKind, ContextSource } from '@prisma/client';
import {
  GOAL_CENARIOS, GOAL_ESCADA, GOAL_FASE, GOAL_INPUTS, GOAL_MARCOS, GOAL_TAXAS,
  METAS_CATALOGO, MetasDoMesSalvarSchema, chaveDaEstrategia, chaveDaPerformance, chaveDasMetasDoMes,
  diaNoFuso, indicadorDeMeta, lerOrigemDaEstrategia, mesDaChaveDasMetas,
  type Farol, type GoalPanel, type GoalTaxaLive, type GoalWeekInput,
  type IndicadorDeMeta, type MetaDoMes, type MetaMedida, type MetasDoMesPainel,
  type MetasDoMesSalvarInput, type MetasMedidaDaSemana,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MetaService } from '../meta/meta.service';
import { MemoriaService } from '../memory/memoria.service';
import {
  coletadoEmDaFoto, corpoDaNotaDeMetas, ehNomeDeCampanhaDeSemente, estadoDaSemana, janelasDoMes,
  lerFotoDePerformance, lerMetasDaNota, linhasDeMetaDaEstrategia, linhasParaATela, medirSemanas,
  ondeLeadNaoESemente, percentualDoAlvo, resumirSemanas, temPermissoesDaFonte, visualizacoesPorSemana,
  type JanelaDaSemana,
} from './metas-do-mes';

/** Os eventos da bio que contam como clique. Mesma lista do `BioBridgeService`, que a guarda privada. */
const BIO_NOMES_DE_CLIQUE = ['link_click', 'whatsapp_click'];

type Week = Awaited<ReturnType<PrismaService['goalWeek']['findFirst']>>;

@Injectable()
export class GoalsService {
  private readonly log = new Logger('Metas');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly meta: MetaService,
    private readonly memoria: MemoriaService,
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

  // ==========================================================================
  // METAS DO MÊS (ROOT-53a, C-12) — alvo por indicador e medição semanal
  // ==========================================================================
  //
  // O alvo mora numa nota da memória por mês (`metas.mes.AAAA-MM`), escrita só
  // pelo `MemoriaService`. O número NUNCA é digitado: sai das tabelas de cada
  // fonte, semana a semana, e a permissão da fonte vale para o número (sem ela,
  // "sem acesso" e nenhuma consulta é feita). `GoalConfig`/`GoalWeek` e o painel
  // do desafio não são tocados.

  async metasDoMes(
    orgId: string,
    mes: string,
    permissoes: readonly string[],
    agora: Date = new Date(),
  ): Promise<MetasDoMesPainel> {
    const nota = await this.memoria.porChave(orgId, chaveDasMetasDoMes(mes));
    const lida = nota && !nota.arquivadoEm ? lerMetasDaNota(nota.body) : { metas: [], avisos: [] };
    const janelas = janelasDoMes(mes);

    // N2: a campanha só é resolvida para quem pode ler a fonte da meta — sem a
    // permissão, nem consulta nem nome de campanha no cartão.
    const campanhas = await this.campanhasDasMetas(
      orgId,
      lida.metas.filter((m) => temPermissoesDaFonte(indicadorDeMeta(m.indicador) as IndicadorDeMeta, permissoes)),
    );
    const leitor = new LeitorDeFontes(this.prisma, this.memoria, orgId, mes);
    const metas: MetaMedida[] = [];
    for (const m of lida.metas) {
      metas.push(await this.medirMeta(m, janelas, permissoes, agora, campanhas, leitor));
    }

    const origensUsadas = new Set(lida.metas.map((m) => m.origem).filter((o): o is string => Boolean(o)));
    return {
      mes,
      nota: nota && !nota.arquivadoEm ? { id: nota.id, versao: nota.versao, atualizadoEm: new Date(nota.atualizadoEm).toISOString() } : null,
      metas,
      semanas: janelas.map(({ de: _de, ate: _ate, ...semana }) => semana),
      avisos: lida.avisos,
      catalogo: METAS_CATALOGO.map((i) => ({ ...i, permitido: temPermissoesDaFonte(i, permissoes) })),
      estrategia: await this.estrategiaDoMes(orgId, mes, permissoes, origensUsadas),
      meses: await this.mesesComMetas(orgId),
      geradoEm: agora.toISOString(),
    };
  }

  /**
   * A revisão do mês: a lista inteira substitui a anterior e vira VERSÃO NOVA da
   * mesma nota (nunca uma segunda nota). `versao` velha é outra aba mexendo
   * junto (409). Campanha e origem são resolvidas na empresa antes de gravar.
   */
  async salvarMetasDoMes(
    orgId: string,
    actorId: string,
    mes: string,
    entrada: MetasDoMesSalvarInput,
    permissoes: readonly string[],
  ): Promise<MetasDoMesPainel> {
    const input = MetasDoMesSalvarSchema.parse(entrada);
    await this.conferirCampanhas(orgId, input.metas.map((m) => m.campanhaId).filter((c): c is string => Boolean(c)));
    await this.conferirOrigens(orgId, mes, input.metas.map((m) => m.origem).filter((o): o is string => Boolean(o)), permissoes);

    const metas: MetaDoMes[] = input.metas.map((m) => {
      const ind = indicadorDeMeta(m.indicador) as IndicadorDeMeta;
      return {
        indicador: ind.chave,
        alvo: m.alvo,
        unidade: ind.unidade,
        campanhaId: m.campanhaId ?? null,
        origem: m.origem ?? null,
        observacao: m.observacao || null,
      };
    });

    const chave = chaveDasMetasDoMes(mes);
    const dados = {
      kind: ContextKind.definicao,
      title: `Metas de ${mes}`,
      body: corpoDaNotaDeMetas(metas),
      sourceType: ContextSource.operador,
      sourceRef: `metas.mes · ${mes}`,
      motivo: input.motivo || 'metas do mês revisadas (ROOT-53a)',
    };
    const existente = await this.memoria.porChave(orgId, chave);
    let nota = existente
      ? await this.memoria.alterar(orgId, existente.id, { ...dados, versaoEsperada: input.versao })
      : await this.memoria.criar(orgId, { chave, tags: ['metas', 'mes'], ...dados });
    if (nota.arquivadoEm) nota = await this.memoria.restaurar(orgId, nota.id, 'as metas do mês voltaram a valer');

    await this.audit.log({
      orgId,
      actorId,
      action: 'goals.month_save',
      entityType: 'context_item',
      entityId: nota.id,
      after: { mes, versao: nota.versao, metas: metas.length },
    });
    return this.metasDoMes(orgId, mes, permissoes);
  }

  // ---- as campanhas da meta --------------------------------------------------

  private async campanhasDasMetas(
    orgId: string,
    metas: MetaDoMes[],
  ): Promise<Map<string, { nome: string; semente: boolean }>> {
    const ids = [...new Set(metas.map((m) => m.campanhaId).filter((c): c is string => Boolean(c)))];
    const out = new Map<string, { nome: string; semente: boolean }>();
    if (!ids.length) return out;
    const linhas = await this.prisma.campaign.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } });
    for (const c of linhas) {
      out.set(c.id, { nome: c.name, semente: await this.campanhaEDeSemente(orgId, c.id, c.name) });
    }
    return out;
  }

  /**
   * C-14: a campanha da semente (um dos 3 nomes e SEM lead que não seja de
   * semente) não entra em meta nem em métrica. Uma campanha real que por acaso
   * tem o mesmo nome continua valendo, porque tem lead real ligado a ela.
   */
  private async campanhaEDeSemente(orgId: string, id: string, nome: string): Promise<boolean> {
    if (!ehNomeDeCampanhaDeSemente(nome)) return false;
    const reais = await this.prisma.lead.count({ where: { orgId, campaignId: id, AND: [ondeLeadNaoESemente()] } });
    return reais === 0;
  }

  /** Campanha de outra empresa e campanha que não existe respondem igual (404). */
  private async conferirCampanhas(orgId: string, ids: string[]): Promise<void> {
    const unicos = [...new Set(ids)];
    if (!unicos.length) return;
    const achadas = await this.prisma.campaign.findMany({ where: { orgId, id: { in: unicos } }, select: { id: true, name: true } });
    if (achadas.length !== unicos.length) throw new NotFoundException('Campanha não encontrada.');
    for (const c of achadas) {
      if (await this.campanhaEDeSemente(orgId, c.id, c.name)) {
        throw new BadRequestException(`A campanha "${c.name}" é de demonstração e não entra em meta nem em métrica.`);
      }
    }
  }

  // ---- a origem "veio da estratégia" ----------------------------------------

  /**
   * Confere que a linha existe de verdade: a nota é a estratégia DESTE mês na
   * empresa, a versão existe e a linha (pelo hash do texto) estava na seção
   * "Metas" daquela versão. A origem só registra de onde a ideia veio — o
   * indicador e o alvo continuam sendo escolha de quem revisa.
   */
  private async conferirOrigens(orgId: string, mes: string, origens: string[], permissoes: readonly string[]): Promise<void> {
    if (!origens.length) return;
    if (!permissoes.includes('pauta.ver')) {
      throw new ForbiddenException('Para ligar uma meta a uma linha da estratégia é preciso poder ver a Pauta.');
    }
    const versoes = new Map<string, Map<number, string>>();
    for (const origem of new Set(origens)) {
      const o = lerOrigemDaEstrategia(origem);
      if (!o) throw new BadRequestException('A origem só pode ser uma linha da estratégia do mês.');
      let porVersao = versoes.get(o.notaId);
      if (!porVersao) {
        const nota = await this.memoria.obter(orgId, o.notaId);
        if (!nota || nota.chave !== chaveDaEstrategia(mes)) {
          throw new BadRequestException(`A origem não aponta a estratégia de ${mes} desta empresa.`);
        }
        const historico = await this.memoria.historico(orgId, o.notaId);
        porVersao = new Map(historico.map((h) => [h.versao, h.body]));
        versoes.set(o.notaId, porVersao);
      }
      const corpo = porVersao.get(o.versao);
      if (corpo === undefined) throw new BadRequestException(`A estratégia de ${mes} não tem a versão ${o.versao}.`);
      if (!linhasDeMetaDaEstrategia(corpo).some((l) => l.hash === o.hash)) {
        throw new BadRequestException(`A linha apontada não está na seção Metas da versão ${o.versao} da estratégia.`);
      }
    }
  }

  private async estrategiaDoMes(
    orgId: string,
    mes: string,
    permissoes: readonly string[],
    origensUsadas: ReadonlySet<string>,
  ): Promise<MetasDoMesPainel['estrategia']> {
    if (!permissoes.includes('pauta.ver')) return null;
    try {
      const nota = await this.memoria.porChave(orgId, chaveDaEstrategia(mes));
      if (!nota || nota.arquivadoEm) return null;
      return { notaId: nota.id, versao: nota.versao, linhas: linhasParaATela(nota.id, nota.versao, nota.body, origensUsadas) };
    } catch (e) {
      this.log.warn(`estratégia de ${mes} (${orgId}) ilegível para as metas: ${(e as Error).message}`);
      return null;
    }
  }

  private async mesesComMetas(orgId: string): Promise<string[]> {
    try {
      const { itens } = await this.memoria.listar(orgId, { kind: ContextKind.definicao });
      return itens
        .map((n) => mesDaChaveDasMetas(n.chave))
        .filter((m): m is string => Boolean(m))
        .sort()
        .reverse();
    } catch (e) {
      this.log.warn(`meses das metas de ${orgId}: ${(e as Error).message}`);
      return [];
    }
  }

  // ---- a medição --------------------------------------------------------------

  private async medirMeta(
    m: MetaDoMes,
    janelas: JanelaDaSemana[],
    permissoes: readonly string[],
    agora: Date,
    campanhas: Map<string, { nome: string; semente: boolean }>,
    leitor: LeitorDeFontes,
  ): Promise<MetaMedida> {
    const ind = indicadorDeMeta(m.indicador) as IndicadorDeMeta;
    const campanha = m.campanhaId ? campanhas.get(m.campanhaId) : undefined;
    const base = {
      indicador: ind.chave,
      rotulo: ind.rotulo,
      unidade: ind.unidade,
      calculo: ind.calculo,
      alvo: m.alvo,
      campanhaId: m.campanhaId,
      campanhaNome: campanha?.nome ?? null,
      origem: m.origem,
      observacao: m.observacao,
    };
    const semNumero = (estado: 'bloqueada' | 'sem_acesso', motivo: string): MetaMedida => ({
      ...base,
      estado,
      motivo,
      valor: null,
      pct: null,
      semanas: medirSemanas(janelas, [], null, agora),
    });

    // A permissão vem ANTES de qualquer consulta: sem ela, a fonte nem é aberta.
    if (!temPermissoesDaFonte(ind, permissoes)) {
      return semNumero('sem_acesso', `O número vem de ${ind.fonte} e exige a permissão ${ind.permissoes.join(' + ')}.`);
    }
    if (ind.exigeCampanha) {
      if (!campanha) return semNumero('bloqueada', 'A campanha desta meta não existe mais nesta empresa.');
      if (campanha.semente) return semNumero('bloqueada', 'A campanha é de demonstração e não entra em métrica.');
    }

    let semanas: MetasMedidaDaSemana[];
    if (ind.fonte === 'instagram') {
      const foto = await leitor.fotoDePerformance();
      if (!foto) {
        return semNumero(
          'bloqueada',
          'Sem a foto de performance do mês. Conecte o Instagram e colete os números em Marketing › Performance.',
        );
      }
      semanas = medirSemanas(janelas, visualizacoesPorSemana(foto, janelas), janelas[0].de, agora);
      const { estado: estadoIg, valor: valorIg } = resumirSemanas(semanas);
      // A leitura é de uma FOTO: a tela precisa dizer de quando, porque o que foi
      // publicado depois da coleta não está nela (B1).
      const coleta = coletadoEmDaFoto(foto);
      const quando = coleta ? diaNoFuso(coleta).split('-').reverse().join('/') : 'data ilegível';
      return {
        ...base,
        estado: estadoIg,
        motivo:
          estadoIg === 'sem_dado'
            ? `A foto de performance (coletada em ${quando}) não traz número para as semanas deste mês.`
            : estadoIg === 'parcial'
              ? `Leitura da foto de performance coletada em ${quando}: as semanas que ela ainda não enxergava ficam sem dado até uma nova coleta (Marketing › Performance).`
              : `Leitura da foto de performance coletada em ${quando}.`,
        valor: valorIg,
        pct: percentualDoAlvo(valorIg, m.alvo),
        semanas,
      };
    } else {
      const primeiro = await leitor.primeiroRegistro(ind.fonte);
      const valores: Array<number | null> = [];
      for (const j of janelas) {
        valores.push(
          estadoDaSemana(j, primeiro, agora) === 'com_dado' ? await leitor.contar(ind, j, m.campanhaId) : null,
        );
      }
      semanas = medirSemanas(janelas, valores, primeiro, agora);
    }

    const { estado, valor } = resumirSemanas(semanas);
    return {
      ...base,
      estado,
      motivo:
        estado === 'sem_dado'
          ? 'A fonte ainda não tem registro que cubra este mês: nenhum número foi contado.'
          : estado === 'parcial'
            ? 'A fonte só tem registro de parte do mês; as semanas sem registro ficam de fora da soma.'
            : null,
      valor,
      pct: percentualDoAlvo(valor, m.alvo),
      semanas,
    };
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

/**
 * Lê as fontes de número de UMA empresa, para UM mês. O que repete entre
 * indicadores (o primeiro registro de uma fonte, a foto do mês) é lido uma vez.
 * Toda consulta leva `orgId` no filtro: a conexão dona atravessa o RLS, então o
 * isolamento por empresa mora aqui, na cláusula.
 */
class LeitorDeFontes {
  private readonly primeiros = new Map<string, Date | null>();
  private foto: ReturnType<typeof lerFotoDePerformance> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoria: MemoriaService,
    private readonly orgId: string,
    private readonly mes: string,
  ) {}

  async fotoDePerformance() {
    if (this.foto === undefined) {
      const nota = await this.memoria.porChave(this.orgId, chaveDaPerformance(this.mes));
      this.foto = nota && !nota.arquivadoEm ? lerFotoDePerformance(nota.body) : null;
    }
    return this.foto;
  }

  /** O instante do registro mais antigo da fonte: antes dele, a fonte não existia. */
  async primeiroRegistro(fonte: IndicadorDeMeta['fonte']): Promise<Date | null> {
    if (this.primeiros.has(fonte)) return this.primeiros.get(fonte) ?? null;
    const orgId = this.orgId;
    let primeiro: Date | null = null;
    if (fonte === 'leads') {
      const r = await this.prisma.lead.findFirst({
        where: { orgId, AND: [ondeLeadNaoESemente()] },
        orderBy: { enteredAt: 'asc' },
        select: { enteredAt: true },
      });
      primeiro = r?.enteredAt ?? null;
    } else if (fonte === 'bio') {
      const r = await this.prisma.bioEvent.findFirst({
        where: { orgId, nome: { in: BIO_NOMES_DE_CLIQUE } },
        orderBy: { ocorridoEm: 'asc' },
        select: { ocorridoEm: true },
      });
      primeiro = r?.ocorridoEm ?? null;
    } else if (fonte === 'pauta') {
      const r = await this.prisma.pautaPeca.findFirst({
        where: { orgId, status: 'publicada', publicadaEm: { not: null } },
        orderBy: { publicadaEm: 'asc' },
        select: { publicadaEm: true },
      });
      primeiro = r?.publicadaEm ?? null;
    }
    this.primeiros.set(fonte, primeiro);
    return primeiro;
  }

  async contar(ind: IndicadorDeMeta, j: JanelaDaSemana, campanhaId: string | null): Promise<number> {
    const orgId = this.orgId;
    const janela = { gte: j.de, lt: j.ate };
    switch (ind.fonte) {
      case 'leads':
        return this.prisma.lead.count({
          where: { orgId, enteredAt: janela, ...(campanhaId ? { campaignId: campanhaId } : {}), AND: [ondeLeadNaoESemente()] },
        });
      case 'bio':
        return this.prisma.bioEvent.count({ where: { orgId, nome: { in: BIO_NOMES_DE_CLIQUE }, ocorridoEm: janela } });
      case 'pauta':
        return this.prisma.pautaPeca.count({ where: { orgId, status: 'publicada', publicadaEm: janela } });
      default:
        throw new Error(`fonte sem contagem: ${ind.fonte}`);
    }
  }
}
