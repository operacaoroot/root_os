import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, AgentEstado, Prisma, type Rotina } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { proximaOcorrencia } from '../pauta/cron';
import {
  comContexto,
  contextoAtual,
  exigirTenant,
  novaCorrelacao,
  type ContextoExecucao,
} from '../common/contexto-execucao';
import { ExecutoresDeRotinaRegistry } from './executores.registry';
import { lerNovaRotina } from './nova-rotina';
import {
  AGENTE_DA_PAUTA,
  AGENTE_DO_TIPO,
  ARRENDAMENTO_MS,
  LIVRE,
  MODULO_DO_TIPO,
  ORIGEM_MANUAL,
  ORIGEM_PAUTA,
  RENOVACAO_MS,
  TIPO_PAUTA_RODADA,
  estadoDispara,
  type ContextoDaRotina,
  type EstadoDoAgendador,
  type ExecucaoResumo,
  type OrigemDaExecucao,
  type ResultadoDaRotina,
  type RotinaResumo,
  type RotinasList,
} from './rotina.tipos';
import { ehTipoDaCasa } from './rotinas-da-casa';

/** Quanto do histórico a tela pede de uma vez. */
const HISTORICO_PADRAO = 30;
const HISTORICO_MAXIMO = 200;

/** O texto que marca um espelho cuja origem sumiu. A tela mostra isto. */
const MARCA_ORFA = 'a rotina de origem foi removida na tela de Pauta';

/** O sufixo que solta o nome de um espelho órfão para quem vier depois. */
const SUFIXO_ORFA = '--sem-origem-';

/**
 * Dois JSON com o MESMO conteúdo, independentemente da ordem das chaves.
 *
 * `JSON.stringify` cru compararia a ordem em que o PostgreSQL devolveu as
 * chaves do `jsonb`, e uma diferença de ordem faria a reconciliação regravar a
 * mesma configuração a cada minuto — escrita eterna sem nada mudando.
 */
function mesmoJson(a: unknown, b: unknown): boolean {
  const estavel = (v: unknown): string =>
    JSON.stringify(v ?? {}, (_k, valor) =>
      valor && typeof valor === 'object' && !Array.isArray(valor)
        ? Object.fromEntries(Object.entries(valor as object).sort(([x], [y]) => (x < y ? -1 : 1)))
        : valor,
    );
  return estavel(a) === estavel(b);
}

/**
 * O erro é uma colisão do índice único `(orgId, slug)`?
 *
 * Separar isto da colisão de `(orgId, origem, refExterna)` não é preciosismo: a
 * segunda é BENIGNA (dois tiques correndo para criar o MESMO espelho — o índice
 * fez o trabalho dele e o perdedor não tem nada a fazer), e a primeira é o
 * defeito que derrubou esta fatia na revisão — duas rotinas disputando o mesmo
 * nome, com a perdedora nunca disparando.
 */
function colisaoDeNome(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err?.code !== 'P2002') return false;
  const alvo = JSON.stringify(err.meta?.target ?? '');
  // Sem alvo declarado, o seguro é tratar como colisão de nome: o caminho de
  // conserto (tentar um nome único) é inofensivo, e engolir seria o defeito.
  return alvo === '""' || alvo.includes('slug');
}

/** O erro é a colisão benigna de `(orgId, origem, refExterna)`? */
function colisaoDeOrigem(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } };
  return err?.code === 'P2002' && JSON.stringify(err.meta?.target ?? '').includes('refExterna');
}

/**
 * O ESTADO E O HISTÓRICO DAS ROTINAS — RF-N-04.
 *
 * Este serviço é a UNIDADE DE TRABALHO: ele reconcilia o espelho da pauta,
 * executa uma rotina do começo ao fim (reserva, executor, histórico,
 * contadores) e responde o que a tela `/rotinas` mostra. O agendador
 * (`rotinas.scheduler.ts`) decide QUANDO; quem decide O QUE ACONTECE é este
 * arquivo, e é por isso que "rodar agora" pela tela e o tique da madrugada
 * passam exatamente pelo mesmo código.
 *
 * TODO MÉTODO AQUI EXIGE EMPRESA RESOLVIDA. Nenhum deles abre contexto DE
 * EMPRESA: quem chama já está dentro do da requisição (a tela) ou dentro do que
 * o agendador abriu para aquela empresa (o tique). Abrir contexto de empresa
 * aqui esconderia de quem lê a decisão mais importante desta fatia — que a
 * varredura é empresa por empresa. O ÚNICO contexto que este arquivo abre é o
 * aninhado da correlação da execução, que não troca de empresa nem de ator.
 */
@Injectable()
export class RotinasService {
  private readonly log = new Logger('Rotinas');

  /**
   * O que a última reconciliação de cada empresa não conseguiu fazer.
   *
   * Mora na memória DESTE processo porque quem reconcilia (o tique) e quem
   * pergunta (a tela) são o mesmo processo e o mesmo singleton do Nest. Com mais
   * de uma réplica, a tela pode cair na que não reconciliou e ver a lista vazia
   * — por isso a cópia que vale para auditar é sempre o log, e não isto aqui.
   */
  private readonly problemas = new Map<string, string[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly executores: ExecutoresDeRotinaRegistry,
  ) {}

  // -------------------------------------------------------------------------
  // RECONCILIAÇÃO — a rotina da pauta vira Rotina
  // -------------------------------------------------------------------------

  /**
   * Traz para `Rotina` o que a tela de Pauta criou ou editou em `PautaRotina`.
   *
   * `PautaRotina` continua sendo a fonte da CONFIGURAÇÃO (cron, janela, coletar
   * antes) porque é ela que a tela de Pauta escreve — e essa tela não é desta
   * fatia. `Rotina` é dona do ESTADO declarado, dos contadores e do histórico.
   * A cada tique as duas se encontram aqui, o que preserva a promessa antiga:
   * rotina editada na tela passa a valer no minuto seguinte.
   *
   * O QUE A RECONCILIAÇÃO NÃO SOBRESCREVE: `estado`, `minutosPorExecucao` e a
   * linha de base. São decisão de gente, pela mesma razão que o seed do roster
   * não mexe em dono nem em estado — reconciliação que desfaz configuração
   * humana é reconciliação que ninguém pode usar.
   *
   * ---------------------------------------------------------------------------
   * O NOME DO ESPELHO, E O DEFEITO QUE ELE CAUSOU
   * ---------------------------------------------------------------------------
   * O espelho quer o nome legível `pauta-<slug da origem>`, porque é o que
   * aparece na tela. Só que o nome é único por empresa, e a órfã (a que perdeu a
   * origem) FICAVA COM ELE. Apagar e recriar a mesma rotina na tela de Pauta
   * fazia a criação seguinte colidir, o erro saía como um aviso no log, e a
   * rotina nova NUNCA disparava: a tela antiga mostrava ativa, esta mostrava a
   * velha pausada, e ninguém via erro nenhum. Três costuras fecham isso:
   *
   *  1. marcar a órfã SOLTA O NOME dela (sufixo `--sem-origem-<id da origem>`);
   *  2. se mesmo assim o nome estiver tomado, o espelho nasce com um nome único
   *     derivado do id da origem — feio e funcionando, em vez de bonito e mudo;
   *  3. o que sobrar de colisão vira `log.error` E aviso na tela (`avisos`),
   *     nunca mais um `warn` no meio do arranque.
   *
   * ROTINA DE ORIGEM APAGADA NÃO APAGA O HISTÓRICO. Ela é pausada e anunciada,
   * e quem quiser some com ela some pela tela. Varredura periódica que apaga
   * registro por conta própria é a forma mais fácil de perder prova sem ninguém
   * decidir nada.
   */
  async reconciliarPauta(
    orgIdBruto: string,
  ): Promise<{ criadas: number; atualizadas: number; orfas: number; problemas: string[] }> {
    const orgId = exigirTenant(orgIdBruto, 'RotinasService.reconciliarPauta');

    const [origens, espelhos] = await Promise.all([
      this.prisma.pautaRotina.findMany({ where: { orgId } }),
      this.prisma.rotina.findMany({ where: { orgId, origem: ORIGEM_PAUTA } }),
    ]);

    const porRef = new Map(espelhos.map((e) => [e.refExterna ?? '', e]));
    const problemas: string[] = [];
    let criadas = 0;
    let atualizadas = 0;

    /*
     * A ORDEM IMPORTA: as órfãs são marcadas ANTES das origens vivas serem
     * criadas. É assim que "apaguei e recriei com o mesmo nome" funciona — a
     * órfã solta o nome na mesma passagem em que a nova o pede.
     */
    const orfas = espelhos.filter((e) => e.refExterna && !origens.some((o) => o.id === e.refExterna));
    let marcadas = 0;
    for (const e of orfas) {
      if (!this.precisaMarcarOrfa(e)) continue;
      try {
        await this.prisma.rotina.update({
          where: { id: e.id },
          data: {
            slug: this.slugDeOrfa(e),
            ativo: false,
            estado: AgentEstado.pausado,
            ultimoStatus: MARCA_ORFA,
            proximaExecucaoEm: null,
          },
        });
        marcadas += 1;
      } catch (err) {
        const msg =
          `não deu para marcar como órfã a rotina "${e.slug}": ${(err as Error).message}. ` +
          'Ela continua aparecendo como se tivesse origem.';
        problemas.push(msg);
        this.log.error(`[${orgId}] ${msg}`);
      }
    }

    for (const o of origens) {
      const espelho = porRef.get(o.id);
      const config = (o.config ?? {}) as Prisma.InputJsonValue;
      const base = `pauta-${o.slug}`;

      try {
        if (!espelho) {
          await this.criarEspelho(orgId, o, base, config, problemas);
          criadas += 1;
          continue;
        }

        /*
         * O NOME ENTRA NA COMPARAÇÃO. Sem ele, renomear na tela de Pauta não era
         * percebido: o `update` até escrevia o slug novo, mas só era chamado
         * quando OUTRA coisa mudava junto.
         *
         * "Aceitável" é o nome bonito OU o nome único de fallback DESTA origem:
         * assim um espelho que precisou do fallback não volta a tentar o bonito
         * a cada minuto, o que seria uma tentativa de escrita por minuto, para
         * sempre.
         */
        const aceitaveis = [base, this.slugUnico(base, o.id)];
        const slug = aceitaveis.includes(espelho.slug) ? espelho.slug : base;

        const mudou =
          espelho.nome !== o.nome ||
          espelho.slug !== slug ||
          espelho.cron !== o.cron ||
          espelho.tz !== o.tz ||
          espelho.ativo !== o.ativo ||
          !mesmoJson(espelho.config, o.config);
        if (!mudou) continue;

        try {
          await this.prisma.rotina.update({
            where: { id: espelho.id },
            data: {
              nome: o.nome,
              slug,
              cron: o.cron,
              tz: o.tz,
              ativo: o.ativo,
              config,
              proximaExecucaoEm:
                o.ativo && estadoDispara(espelho.estado) ? this.calcularProxima(o, new Date()) : null,
            },
          });
        } catch (err) {
          if (!colisaoDeNome(err)) throw err;
          // O nome bonito está tomado por outra linha. Fica com o único, que
          // sempre existe e é derivado do id da origem.
          await this.prisma.rotina.update({
            where: { id: espelho.id },
            data: {
              nome: o.nome,
              slug: this.slugUnico(base, o.id),
              cron: o.cron,
              tz: o.tz,
              ativo: o.ativo,
              config,
              proximaExecucaoEm:
                o.ativo && estadoDispara(espelho.estado) ? this.calcularProxima(o, new Date()) : null,
            },
          });
          const msg =
            `o nome "${base}" já pertence a outra rotina desta empresa; o espelho de "${o.slug}" ` +
            `ficou com "${this.slugUnico(base, o.id)}".`;
          problemas.push(msg);
          this.log.error(`[${orgId}] ${msg}`);
        }
        atualizadas += 1;
      } catch (e) {
        if (colisaoDeOrigem(e)) {
          // Outro tique criou o mesmo espelho no mesmo instante. O índice único
          // fez o trabalho dele; não há nada a consertar nem a anunciar.
          this.log.debug?.(`espelho de "${o.slug}" já foi criado por outra batida`);
          continue;
        }
        const msg =
          `a rotina de pauta "${o.slug}" (${o.id}) NÃO está espelhada e não vai disparar: ` +
          `${(e as Error).message}`;
        problemas.push(msg);
        this.log.error(`[${orgId}] ${msg}`);
      }
    }

    this.problemas.set(orgId, problemas);
    return { criadas, atualizadas, orfas: marcadas, problemas };
  }

  /** Cria o espelho, caindo para um nome único quando o bonito está tomado. */
  private async criarEspelho(
    orgId: string,
    o: {
      id: string;
      slug: string;
      nome: string;
      cron: string;
      tz: string;
      ativo: boolean;
      ultimoRun: Date | null;
      ultimoStatus: string | null;
      proximoRun: Date | null;
    },
    base: string,
    config: Prisma.InputJsonValue,
    problemas: string[],
  ): Promise<void> {
    const dados = (slug: string) => ({
      orgId,
      slug,
      nome: o.nome,
      tipo: TIPO_PAUTA_RODADA,
      config,
      cron: o.cron,
      tz: o.tz,
      ativo: o.ativo,
      // Nasce no estado que a linha antiga sabia dizer. `aprendendo` e
      // `planejado` são declaração de gente e ninguém declara por ela.
      estado: o.ativo ? AgentEstado.rodando : AgentEstado.pausado,
      origem: ORIGEM_PAUTA,
      refExterna: o.id,
      agenteSlug: AGENTE_DA_PAUTA,
      // A RESERVA NASCE LIVRE, dita e não herdada do default da coluna: é a
      // peça de que depende TODO disparo, e quem cria a linha é quem tem de
      // dizer em que estado ela nasce. Um default de coluna que sumisse numa
      // migration futura deixaria rotinas novas eternamente "em curso".
      reservadoEm: LIVRE,
      reservadoAte: LIVRE,
      ultimaExecucaoEm: o.ultimoRun,
      ultimoStatus: o.ultimoStatus,
      // Nasce `pausado` quando a origem está desligada, e rotina que não dispara
      // não anuncia próxima execução — a tela não pode prometer horário para o
      // que não vai acontecer.
      proximaExecucaoEm: o.ativo ? (o.proximoRun ?? this.calcularProxima(o, new Date())) : null,
    });

    try {
      await this.prisma.rotina.create({ data: dados(base) });
      return;
    } catch (e) {
      if (!colisaoDeNome(e)) throw e;
    }

    const unico = this.slugUnico(base, o.id);
    await this.prisma.rotina.create({ data: dados(unico) });
    const msg =
      `o nome "${base}" já pertence a outra rotina desta empresa; o espelho de "${o.slug}" ` +
      `nasceu como "${unico}". A rotina dispara normalmente — o que confunde é o nome.`;
    problemas.push(msg);
    this.log.error(`[${orgId}] ${msg}`);
  }

  /** O nome único de um espelho, derivado do id IMUTÁVEL da origem. */
  private slugUnico(base: string, origemId: string): string {
    return `${base}-${origemId.slice(0, 8)}`;
  }

  /** O nome que uma órfã passa a ter — soltando o que tinha para quem vier. */
  private slugDeOrfa(e: { slug: string; refExterna: string | null }): string {
    if (e.slug.includes(SUFIXO_ORFA)) return e.slug;
    return `${e.slug}${SUFIXO_ORFA}${(e.refExterna ?? 'x').slice(0, 8)}`;
  }

  /**
   * A órfã já está na forma marcada?
   *
   * Não basta perguntar "está ativa?": uma execução que estava EM CURSO quando a
   * origem sumiu termina depois da marcação e reescreve `ultimoStatus` e
   * `proximaExecucaoEm` — e o aviso de origem removida sumia sem nunca voltar,
   * deixando uma rotina pausada, sem origem, anunciando próxima execução. Aqui a
   * marcação é IDEMPOTENTE e se refaz sozinha na batida seguinte.
   */
  private precisaMarcarOrfa(e: {
    slug: string;
    ativo: boolean;
    estado: AgentEstado;
    ultimoStatus: string | null;
    proximaExecucaoEm: Date | null;
    refExterna: string | null;
  }): boolean {
    return (
      e.ativo ||
      e.estado !== AgentEstado.pausado ||
      e.ultimoStatus !== MARCA_ORFA ||
      e.proximaExecucaoEm !== null ||
      e.slug !== this.slugDeOrfa(e)
    );
  }

  // -------------------------------------------------------------------------
  // A RESERVA — arrendamento com prazo, não carimbo
  // -------------------------------------------------------------------------

  /**
   * Toma a rotina para esta passagem. Devolve `false` quando já é de outro.
   *
   * DUAS CONDIÇÕES, DUAS COLUNAS (ver o schema e a migration
   * `20260911200000_reserva_de_rotina_com_prazo`):
   *
   *  · `reservadoAte < agora` — ninguém está com ela AGORA. Um arrendamento
   *    vencido sem devolução é execução que morreu no meio, e retomá-la é o
   *    ponto: a ocorrência volta em minutos, e não no dia seguinte.
   *  · `reservadoEm < início do minuto` — este MINUTO ainda não foi disparado.
   *    É o que segura tique atrasado e segunda réplica. Vale só para o tique:
   *    "rodar agora" pela tela NÃO carimba o minuto, senão um clique consumiria
   *    a ocorrência agendada e a cancelaria em silêncio.
   *
   * O `UPDATE` condicional é resolvido pelo PostgreSQL, que é o único ponto que
   * duas réplicas compartilham — e dispensa o advisory lock que o agendador
   * antigo deixou anotado como pendência.
   */
  private async reservar(rotinaId: string, agora: Date, origem: OrigemDaExecucao): Promise<boolean> {
    const ate = new Date(agora.getTime() + ARRENDAMENTO_MS);

    if (origem === 'manual') {
      const r = await this.prisma.rotina.updateMany({
        where: { id: rotinaId, reservadoAte: { lt: agora } },
        data: { reservadoAte: ate },
      });
      return r.count > 0;
    }

    const inicioDoMinuto = new Date(agora);
    inicioDoMinuto.setSeconds(0, 0);
    const r = await this.prisma.rotina.updateMany({
      where: {
        id: rotinaId,
        reservadoAte: { lt: agora },
        reservadoEm: { lt: inicioDoMinuto },
      },
      data: { reservadoEm: inicioDoMinuto, reservadoAte: ate },
    });
    return r.count > 0;
  }

  /**
   * Estende o prazo enquanto a execução está em curso.
   *
   * Sem isto, o arrendamento seria uma aposta na duração: execução mais longa
   * que o prazo viraria alvo de retomada, e duas passagens da mesma rotina
   * rodariam ao mesmo tempo. Com isto, o prazo só vence quando ninguém está mais
   * renovando — que é precisamente a definição de "o processo morreu".
   */
  private renovarEnquantoRoda(rotinaId: string): () => void {
    const timer = setInterval(() => {
      const agora = new Date();
      void this.prisma.rotina
        .updateMany({
          // Só renova o que AINDA está no prazo. Se o arrendamento já venceu, ele
          // não é mais nosso — outra batida pode tê-lo retomado, e ressuscitar um
          // prazo perdido seria estender a reserva de quem está rodando agora.
          where: { id: rotinaId, reservadoAte: { gt: agora } },
          data: { reservadoAte: new Date(agora.getTime() + ARRENDAMENTO_MS) },
        })
        .catch((e: Error) =>
          this.log.warn(`não deu para renovar o arrendamento de ${rotinaId}: ${e.message}`),
        );
    }, RENOVACAO_MS);
    // `unref` para o timer não segurar o processo de pé sozinho — importa no
    // desligamento e importa no teste, que não pode ficar pendurado por 5min.
    timer.unref?.();
    return () => clearInterval(timer);
  }

  // -------------------------------------------------------------------------
  // EXECUÇÃO
  // -------------------------------------------------------------------------

  /**
   * Roda UMA rotina do começo ao fim, dentro da empresa já resolvida.
   *
   * A ordem importa e é esta: reserva → executor → histórico → contadores →
   * próxima ocorrência → devolução do arrendamento. O histórico é escrito ANTES
   * dos contadores porque é ele o registro; os contadores são projeção. Se o
   * processo morrer entre os dois, o que sobra é uma linha de histórico sem
   * contador — perda visível — e não um contador sem linha, que seria um número
   * sem procedência.
   *
   * NADA DEPOIS DO EXECUTOR PODE DERRUBAR O CHAMADOR. Gravar o histórico e
   * atualizar os contadores são duas escritas que podem falhar sozinhas (banco
   * fora do ar, policy, `deadlock`), e enquanto elas subiam a exceção, a falha de
   * UMA rotina abandonava a varredura da empresa inteira: as outras rotinas
   * daquela empresa não rodavam naquele minuto. Cada uma tem o seu `try`, e as
   * duas anunciam alto.
   */
  async executar(
    rotina: Rotina,
    origem: OrigemDaExecucao,
    agora: Date,
  ): Promise<{ status: string; resumo: string } | null> {
    const orgId = exigirTenant(rotina.orgId, 'RotinasService.executar');

    if (!(await this.reservar(rotina.id, agora, origem))) {
      this.log.debug?.(`rotina "${rotina.slug}" já está reservada — nada a fazer`);
      return null;
    }

    /*
     * A CORRELAÇÃO DESTA PASSAGEM (RNF-09).
     *
     * O contexto aninhado existe para que o identificador que vai para o
     * histórico seja O MESMO que o executor carrega — e portanto o mesmo que
     * aparece no RASTRO do que a rodada fizer. Sem ele, a correlação gravada
     * aqui não casava com evento nenhum, e a do tique era a mesma para todas as
     * rotinas da empresa naquele minuto: um fio que não separava nada.
     *
     * Não troca de empresa nem de ator: `comContexto` põe a correlação de fora
     * como `correlacaoPai` sozinho, então a batida continua ligando as rotinas
     * dela.
     */
    const correlationId = novaCorrelacao('rotina');
    const fora = contextoAtual();
    const aninhado: ContextoExecucao = {
      orgId,
      actorType: fora?.actorType ?? ActorType.system,
      actorId: fora?.actorId ?? null,
      agentSlug: fora?.agentSlug ?? null,
      correlationId,
      origem: fora?.origem ?? 'cron',
    };

    const ctx: ContextoDaRotina = {
      orgId,
      rotinaId: rotina.id,
      slug: rotina.slug,
      config: (rotina.config ?? {}) as Record<string, unknown>,
      refExterna: rotina.refExterna,
      origem,
      correlationId,
      agora,
    };

    const t0 = Date.now();
    let resultado: ResultadoDaRotina | null = null;
    let erro: string | null = null;
    const pararRenovacao = this.renovarEnquantoRoda(rotina.id);
    try {
      resultado = await comContexto(aninhado, () => this.executores.executar(rotina.tipo, ctx));
    } catch (e) {
      erro = (e as Error).message.slice(0, 500);
      this.log.warn(`rotina "${rotina.slug}" falhou: ${erro}`);
    } finally {
      pararRenovacao();
    }
    const duracaoMs = Date.now() - t0;

    const status = erro ? 'erro' : (resultado?.status ?? 'ok');
    const resumo = erro ?? resultado?.resumo ?? '';

    // "pulada" não vira linha de histórico nem mexe em contador: o executor
    // acordou e não havia o que fazer. Ver `ResultadoDaRotina`.
    if (status !== 'pulada') {
      try {
        await this.prisma.rotinaExecucao.create({
          data: {
            orgId,
            rotinaId: rotina.id,
            status,
            origem,
            inicioEm: new Date(t0),
            fimEm: new Date(),
            duracaoMs,
            resumo: erro ? null : resumo.slice(0, 500),
            erro,
            correlationId,
          },
        });
      } catch (e) {
        this.log.error(
          `rotina "${rotina.slug}" RODOU (${status}) e o histórico não foi gravado: ` +
            `${(e as Error).message}. A passagem aconteceu e não está no diário de bordo.`,
        );
      }
    }

    try {
      await this.fecharPassagem(rotina, { status, resumo, erro, origem, agora });
    } catch (e) {
      this.log.error(
        `rotina "${rotina.slug}": não deu para fechar a passagem (${(e as Error).message}). ` +
          'Os contadores ficaram atrás, e o arrendamento só vai vencer pelo prazo.',
      );
    }

    return { status, resumo };
  }

  /**
   * Contadores, `ultimoStatus`, próxima ocorrência e a devolução do
   * arrendamento — numa escrita só.
   *
   * A LINHA É RELIDA ANTES. A que veio do agendador é de antes do executor, e
   * durante uma execução longa a rotina pode ter sido pausada na tela, ou ter
   * perdido a origem. Recalcular `proximaExecucaoEm` a partir da linha velha era
   * como uma rotina recém-marcada como órfã voltava a anunciar próxima execução.
   */
  private async fecharPassagem(
    rotina: Rotina,
    p: {
      status: string;
      resumo: string;
      erro: string | null;
      origem: OrigemDaExecucao;
      agora: Date;
    },
  ): Promise<void> {
    const atual = (await this.prisma.rotina.findUnique({ where: { id: rotina.id } })) ?? rotina;
    const dispara = atual.ativo && estadoDispara(atual.estado);
    const proxima = dispara ? this.calcularProxima(atual, p.agora) : null;

    await this.prisma.rotina.update({
      where: { id: rotina.id },
      data: {
        ...(p.status === 'pulada'
          ? {}
          : {
              execucoes: { increment: 1 },
              ...(p.erro ? { falhas: { increment: 1 } } : {}),
              ultimaExecucaoEm: p.agora,
              ultimoStatus:
                `${p.erro ? 'erro' : p.origem === 'manual' ? 'manual' : 'ok'}: ${p.resumo}`.slice(
                  0,
                  300,
                ),
            }),
        proximaExecucaoEm: proxima,
        // A devolução do arrendamento anda junto com o desfecho: enquanto esta
        // escrita não acontecer, a rotina segue "em curso" para todo mundo.
        reservadoAte: LIVRE,
      },
    });
  }

  /**
   * A próxima ocorrência, ou `null` quando o cron é inválido.
   *
   * Cron inválido NÃO derruba o tique: a rotina fica sem próxima execução, o que
   * a tela mostra, e a validação de verdade acontece na hora de salvar.
   */
  private calcularProxima(rotina: { cron: string; tz: string }, agora: Date): Date | null {
    try {
      return proximaOcorrencia(rotina.cron, rotina.tz, agora);
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // LEITURA — o que a tela mostra
  // -------------------------------------------------------------------------

  async listar(orgIdBruto: string, agendador: EstadoDoAgendador): Promise<RotinasList> {
    const orgId = exigirTenant(orgIdBruto, 'RotinasService.listar');
    const [rotinas, execucoes] = await Promise.all([
      this.prisma.rotina.findMany({ where: { orgId }, orderBy: [{ estado: 'asc' }, { nome: 'asc' }] }),
      this.prisma.rotinaExecucao.findMany({
        where: { orgId },
        orderBy: { inicioEm: 'desc' },
        take: HISTORICO_PADRAO,
      }),
    ]);

    return {
      items: rotinas.map((r) => this.resumo(r)),
      execucoes: execucoes.map((e) => this.resumoExecucao(e)),
      agendadorAtivo: agendador.ativo,
      pautaDesligadaPorVariavel: agendador.pautaDesligada,
      descobertaCega: agendador.descobertaCega,
      tiposDisponiveis: await this.tiposDaEmpresa(orgId),
      avisos: this.problemas.get(orgId) ?? [],
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  /**
   * Os tipos que esta empresa pode criar: com executor inscrito no processo e,
   * quando o tipo pede módulo, com o módulo contratado. Lê `Org.modulos` direto,
   * como `entrada-de-links.service.ts`: o `ModulosService` não é deste módulo e
   * a pergunta aqui é uma só por chamada.
   */
  private async tiposDaEmpresa(orgId: string): Promise<string[]> {
    // As rotinas da casa (`casa.*`) nascem sozinhas por empresa: não se criam pela tela.
    const inscritos = this.executores.inscritos.filter((t) => !ehTipoDaCasa(t));
    if (!inscritos.some((t) => MODULO_DO_TIPO[t])) return inscritos;
    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { modulos: true } });
    const ligados = org?.modulos ?? [];
    return inscritos.filter((t) => !MODULO_DO_TIPO[t] || ligados.includes(MODULO_DO_TIPO[t]));
  }

  async historico(orgIdBruto: string, rotinaId: string, limite = HISTORICO_PADRAO): Promise<ExecucaoResumo[]> {
    const orgId = exigirTenant(orgIdBruto, 'RotinasService.historico');
    const rotina = await this.prisma.rotina.findFirst({ where: { id: rotinaId, orgId } });
    if (!rotina) throw new NotFoundException('Rotina não encontrada');
    const linhas = await this.prisma.rotinaExecucao.findMany({
      where: { orgId, rotinaId },
      orderBy: { inicioEm: 'desc' },
      take: Math.min(Math.max(limite, 1), HISTORICO_MAXIMO),
    });
    return linhas.map((e) => this.resumoExecucao(e));
  }

  private resumo(r: Rotina): RotinaResumo {
    const temExecutor = this.executores.tem(r.tipo);
    const base = r.minutosPorExecucao > 0 ? r.minutosPorExecucao : null;
    return {
      id: r.id,
      slug: r.slug,
      nome: r.nome,
      tipo: r.tipo,
      temExecutor,
      cron: r.cron,
      tz: r.tz,
      ativo: r.ativo,
      estado: r.estado,
      dispara: r.ativo && estadoDispara(r.estado) && temExecutor,
      origem: r.origem,
      agenteSlug: r.agenteSlug,
      execucoes: r.execucoes,
      falhas: r.falhas,
      ultimaExecucaoEm: r.ultimaExecucaoEm?.toISOString() ?? null,
      ultimoStatus: r.ultimoStatus,
      proximaExecucaoEm: r.proximaExecucaoEm?.toISOString() ?? null,
      minutosPorExecucao: base,
      minutosDevolvidos: base === null ? null : base * r.execucoes,
    };
  }

  private resumoExecucao(e: {
    id: string;
    rotinaId: string;
    status: string;
    origem: string;
    inicioEm: Date;
    fimEm: Date | null;
    duracaoMs: number | null;
    resumo: string | null;
    erro: string | null;
    correlationId: string | null;
  }): ExecucaoResumo {
    return {
      id: e.id,
      rotinaId: e.rotinaId,
      status: e.status as ExecucaoResumo['status'],
      origem: e.origem,
      inicioEm: e.inicioEm.toISOString(),
      fimEm: e.fimEm?.toISOString() ?? null,
      duracaoMs: e.duracaoMs,
      resumo: e.resumo,
      erro: e.erro,
      correlationId: e.correlationId,
    };
  }

  // -------------------------------------------------------------------------
  // AÇÕES DA TELA
  // -------------------------------------------------------------------------

  /**
   * Cria uma rotina sem linha de origem (`origem: manual`) — MC5.
   *
   * Só tipo com executor inscrito e, se o tipo pede módulo, com o módulo
   * contratado — esta rota é espinha e o gate de módulos não a cobre. Nasce `planejado` quando o corpo não diz o
   * estado (ver o schema); `ativo` nasce ligado, porque o que decide se dispara
   * é o estado declarado, e as duas coisas separadas é o que a tela mostra.
   */
  async criar(orgIdBruto: string, corpo: unknown, actorId: string): Promise<RotinaResumo> {
    const orgId = exigirTenant(orgIdBruto, 'RotinasService.criar');
    const lida = lerNovaRotina(corpo, this.executores.inscritos.filter((t) => !ehTipoDaCasa(t)));
    if ('erro' in lida) throw new BadRequestException(lida.erro);
    const d = lida.dados;
    const modulo = MODULO_DO_TIPO[d.tipo];
    if (modulo && !(await this.tiposDaEmpresa(orgId)).includes(d.tipo)) {
      throw new BadRequestException(
        `A rotina "${d.tipo}" é do módulo "${modulo}", que esta empresa não contrata.`,
      );
    }
    const dispara = estadoDispara(d.estado);

    let nova: Rotina;
    try {
      nova = await this.prisma.rotina.create({
        data: {
          orgId,
          slug: d.slug,
          nome: d.nome,
          tipo: d.tipo,
          config: d.config as Prisma.InputJsonValue,
          cron: d.cron,
          tz: d.tz,
          ativo: true,
          estado: d.estado,
          origem: ORIGEM_MANUAL,
          refExterna: null,
          agenteSlug: AGENTE_DO_TIPO[d.tipo] ?? null,
          reservadoEm: LIVRE,
          reservadoAte: LIVRE,
          proximaExecucaoEm: dispara ? this.calcularProxima(d, new Date()) : null,
        },
      });
    } catch (e) {
      if (colisaoDeNome(e)) {
        throw new ConflictException(`Já existe uma rotina "${d.slug}" nesta empresa. Escolha outro slug.`);
      }
      throw e;
    }

    await this.audit.log({
      orgId,
      actorId,
      actorType: ActorType.user,
      action: 'rotina.criada',
      entityType: 'rotina',
      entityId: nova.id,
      after: {
        slug: nova.slug,
        tipo: nova.tipo,
        cron: nova.cron,
        tz: nova.tz,
        estado: nova.estado,
        config: d.config as Prisma.InputJsonValue,
      },
    });
    return this.resumo(nova);
  }

  /** Dispara a rotina agora, sem esperar o cron. Mesmo caminho do tique. */
  async rodarAgora(orgIdBruto: string, id: string, actorId: string) {
    const orgId = exigirTenant(orgIdBruto, 'RotinasService.rodarAgora');
    const rotina = await this.prisma.rotina.findFirst({ where: { id, orgId } });
    if (!rotina) throw new NotFoundException('Rotina não encontrada');
    if (!this.executores.tem(rotina.tipo)) {
      throw new BadRequestException(
        `Esta rotina pede o executor "${rotina.tipo}", que não está inscrito nesta instalação.`,
      );
    }
    await this.exigirOrigemViva(orgId, rotina, 'rodar');

    await this.audit.log({
      orgId,
      actorId,
      action: 'rotina.rodada_manual',
      entityType: 'rotina',
      entityId: id,
      after: { slug: rotina.slug, tipo: rotina.tipo },
    });

    const r = await this.executar(rotina, 'manual', new Date());
    if (r === null) {
      // Reserva negada: alguém (o tique ou outro clique) está com ela agora.
      // Dizer isto é melhor do que devolver "pulada", que faria a tela anunciar
      // um desfecho que não houve.
      throw new ConflictException(
        'Esta rotina já está em execução neste momento. Espere terminar — o histórico vai mostrar o desfecho.',
      );
    }
    return { ok: r.status !== 'erro', status: r.status, resumo: r.resumo };
  }

  /**
   * Muda o estado declarado.
   *
   * É a única forma de uma rotina sair de `planejado`.
   *
   * NO ESPELHO DA PAUTA, O ESTADO DESCE PARA A ORIGEM. A tela de Pauta tem UM
   * interruptor e é por ele que ela diz se aquilo está de pé; declarar `pausado`
   * aqui e deixar lá "ativa" faz a tela antiga mentir — e foi o que aconteceu:
   * nada disparava e a tela de Pauta seguia verde. Então, para rotina espelhada,
   * o estado e o interruptor andam juntos NOS DOIS LADOS. Para rotina `manual`
   * eles continuam separados, que é a distinção que a fatia foi pedir: pausar
   * hoje não apaga "isto está em produção".
   */
  async definirEstado(orgIdBruto: string, id: string, estado: AgentEstado, actorId: string) {
    const orgId = exigirTenant(orgIdBruto, 'RotinasService.definirEstado');
    const rotina = await this.prisma.rotina.findFirst({ where: { id, orgId } });
    if (!rotina) throw new NotFoundException('Rotina não encontrada');
    if (estadoDispara(estado)) await this.exigirOrigemViva(orgId, rotina, 'reativar');

    const espelhada = rotina.origem === ORIGEM_PAUTA && !!rotina.refExterna;
    const dispara = estadoDispara(estado);

    if (espelhada) {
      await this.prisma.pautaRotina.updateMany({
        where: { id: rotina.refExterna as string, orgId },
        data: { ativo: dispara },
      });
    }

    const ativo = espelhada ? dispara : rotina.ativo;
    const nova = await this.prisma.rotina.update({
      where: { id },
      data: {
        estado,
        ativo,
        proximaExecucaoEm: dispara && ativo ? this.calcularProxima(rotina, new Date()) : null,
      },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'rotina.estado_alterado',
      entityType: 'rotina',
      entityId: id,
      before: { estado: rotina.estado, ativo: rotina.ativo },
      after: { estado: nova.estado, ativo: nova.ativo },
    });
    return { ok: true, estado: nova.estado };
  }

  /** Liga e desliga o interruptor operacional. */
  async definirAtivo(orgIdBruto: string, id: string, ativo: boolean, actorId: string) {
    const orgId = exigirTenant(orgIdBruto, 'RotinasService.definirAtivo');
    const rotina = await this.prisma.rotina.findFirst({ where: { id, orgId } });
    if (!rotina) throw new NotFoundException('Rotina não encontrada');
    if (ativo) await this.exigirOrigemViva(orgId, rotina, 'religar');

    // Espelho da pauta: o interruptor de verdade é o da linha de origem, senão a
    // próxima reconciliação desfaria o que a pessoa acabou de fazer, em silêncio.
    if (rotina.origem === ORIGEM_PAUTA && rotina.refExterna) {
      await this.prisma.pautaRotina.updateMany({
        where: { id: rotina.refExterna, orgId },
        data: { ativo },
      });
    }

    const nova = await this.prisma.rotina.update({
      where: { id },
      data: {
        ativo,
        proximaExecucaoEm:
          ativo && estadoDispara(rotina.estado) ? this.calcularProxima(rotina, new Date()) : null,
      },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'rotina.ativo_alterado',
      entityType: 'rotina',
      entityId: id,
      before: { ativo: rotina.ativo },
      after: { ativo: nova.ativo },
    });
    return { ok: true, ativo: nova.ativo };
  }

  /**
   * RECUSA MEXER NUMA ROTINA CUJA ORIGEM SUMIU.
   *
   * Religar um espelho órfão não é inofensivo: `refExterna` vira um ponteiro
   * pendurado, e o executor da pauta manda esse id para a rodada, que o grava
   * como chave estrangeira. O resultado era uma rotina que voltava a "rodar" e
   * falhava por integridade a cada passagem, enchendo o histórico de erro sem
   * nunca produzir nada. Recusar na porta, com o conserto escrito, é a diferença
   * entre um "não" e um mistério.
   */
  private async exigirOrigemViva(
    orgId: string,
    rotina: { origem: string; refExterna: string | null; slug: string },
    verbo: string,
  ): Promise<void> {
    if (rotina.origem !== ORIGEM_PAUTA || !rotina.refExterna) return;
    const origem = await this.prisma.pautaRotina.findFirst({
      where: { id: rotina.refExterna, orgId },
    });
    if (origem) return;
    throw new BadRequestException(
      `Não dá para ${verbo} "${rotina.slug}": a rotina de origem foi removida na tela de Pauta. ` +
        'Recrie a rotina lá (ela volta a aparecer aqui no minuto seguinte) — esta linha só guarda o histórico.',
    );
  }

  /**
   * A LINHA DE BASE (RF-N-05): quantos minutos uma pessoa gastava nisto por
   * execução. Declarada por gente, nunca deduzida — é o que separa "horas
   * devolvidas" de número inventado.
   */
  async definirLinhaDeBase(orgIdBruto: string, id: string, minutos: number, actorId: string) {
    const orgId = exigirTenant(orgIdBruto, 'RotinasService.definirLinhaDeBase');
    if (!Number.isInteger(minutos) || minutos < 0 || minutos > 60 * 24) {
      throw new BadRequestException('Informe um número inteiro de minutos entre 0 e 1440.');
    }
    const rotina = await this.prisma.rotina.findFirst({ where: { id, orgId } });
    if (!rotina) throw new NotFoundException('Rotina não encontrada');

    await this.prisma.rotina.update({
      where: { id },
      data: { minutosPorExecucao: minutos, baselinePorId: actorId, baselineEm: new Date() },
    });
    await this.audit.log({
      orgId,
      actorId,
      actorType: ActorType.user,
      action: 'rotina.linha_de_base',
      entityType: 'rotina',
      entityId: id,
      before: { minutosPorExecucao: rotina.minutosPorExecucao },
      after: { minutosPorExecucao: minutos },
    });
    return { ok: true, minutosPorExecucao: minutos };
  }
}
