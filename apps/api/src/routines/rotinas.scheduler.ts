import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ActorType, AgentEstado, type Rotina } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { combina, parseCron } from '../pauta/cron';
import { AssinaturaService } from '../billing/assinatura.service';
import { acessoBloqueado } from '../billing/assinatura';
import { RotinasService } from './rotinas.service';
import { ESTADOS_QUE_DISPARAM, LIVRE, TIPOS_DA_PAUTA, type EstadoDoAgendador } from './rotina.tipos';
import { anunciarAgendadorDeRotinas } from './sinal-do-agendador';

/** O tique. Um minuto, como o do agendador da pauta — é o mesmo relógio. */
const INTERVALO_MS = 60_000;

/** De quanto em quanto tempo vale reperguntar ao catálogo se a vista está cega. */
const VALIDADE_DO_DIAGNOSTICO_MS = 5 * 60_000;

/**
 * O AGENDADOR ÚNICO DAS ROTINAS — RF-N-04.
 *
 * ----------------------------------------------------------------------------
 * POR QUE CONTINUA SENDO CRON PRÓPRIO
 * ----------------------------------------------------------------------------
 * `02-CONSTRAINTS` manda manter o cron próprio, e o motivo prático continua o
 * mesmo que o agendador da pauta escreveu em 2026: as rotinas são EDITÁVEIS PELA
 * TELA, e registrar/desregistrar um `CronJob` a cada edição vira contabilidade de
 * estado entre o banco e a memória do processo. Aqui o agendador só pergunta a
 * cada minuto "quem bate agora?" — editar uma rotina passa a valer no minuto
 * seguinte, sem re-registro nenhum. Nada de fila, Redis, BullMQ ou
 * `@nestjs/schedule`: dependência nova é decisão humana.
 *
 * ----------------------------------------------------------------------------
 * A VARREDURA É EMPRESA POR EMPRESA, E ISSO NÃO É ESTILO
 * ----------------------------------------------------------------------------
 * O tique roda FORA de requisição, logo sem empresa na sessão — e o isolamento
 * por linha está ligado em modo forçado. É o mesmo problema que a onda 6
 * resolveu no expurgo do rastro e a onda 7 no agendador da pauta, e a solução é
 * a mesma: descobrir as empresas e depois abrir o contexto DE CADA UMA, uma de
 * cada vez.
 *
 * O que isso compra, em três frentes:
 *
 *  · BANCO — a empresa do contexto é a que viaja como `app.org_id`
 *    (`prisma/sessao-de-banco.ts`). Sem ela, sob o papel restrito, toda consulta
 *    da rotina volta vazia.
 *  · TETO DE CUSTO DE IA — a reserva é por empresa e por dia (RF-G-05). Sem
 *    contexto, a rodada da madrugada chamava o modelo com a empresa em branco e
 *    o teto não reservava, não contava e avisava uma vez por processo. Era
 *    justamente o gasto que roda sem ninguém olhando que ficava de fora.
 *  · RASTRO — ator, empresa e correlação (RNF-09) acompanham tudo que a rotina
 *    fizer, inclusive o que ela propuser à porta.
 *
 * E NÃO é contexto de plataforma: abrir a sentinela aqui daria alcance de
 * plataforma a um trabalho que sabe exatamente de quem é. A única consulta que
 * roda sem empresa é a DESCOBERTA — a pergunta que decide quais empresas varrer.
 *
 * ----------------------------------------------------------------------------
 * DUAS RÉPLICAS, E O QUE ACONTECE QUANDO UMA MORRE NO MEIO
 * ----------------------------------------------------------------------------
 * A API é container único hoje. O agendador antigo deixou anotado que duas
 * réplicas disparariam a mesma rodada e que a trava seria um advisory lock.
 * Aqui a trava é mais barata e já está: `RotinasService` reserva a rotina com um
 * `UPDATE` condicional antes de chamar o executor — o minuto, para o tique não
 * disparar duas vezes, e um PRAZO, para que morrer no meio não perca a
 * ocorrência. O tique também RETOMA arrendamento vencido, que é o que faz uma
 * rodada diária interrompida por um deploy voltar em minutos e não no dia
 * seguinte.
 */
@Injectable()
export class RotinasScheduler implements OnModuleInit {
  private readonly log = new Logger('AgendadorDeRotinas');
  private readonly ativo = (process.env.ROTINAS_CRON ?? 'on') !== 'off';

  /**
   * `PAUTA_CRON` VIROU APELIDO DE COMPATIBILIDADE.
   *
   * Ela desligava o `setInterval` do módulo de pauta — um interruptor que,
   * depois desta fatia, desligaria TODAS as rotinas, e não a da pauta. O efeito
   * colateral acabou: aqui ela pula as rotinas do executor da pauta e nada mais.
   * Quem quiser pausar a rotina da pauta tem dois lugares melhores (a tela de
   * Pauta e a tela de Rotinas); quem quiser desligar o agendador inteiro usa
   * `ROTINAS_CRON=off`. A variável continua respeitada para que subir esta
   * versão num ambiente que a tenha no `.env` não ligue sozinho o que estava
   * desligado.
   */
  private readonly pautaDesligada = (process.env.PAUTA_CRON ?? 'on') === 'off';

  /** O minuto já processado: um tique atrasado não dispara duas vezes. */
  private ultimoMinuto = '';
  /**
   * O aviso de "nenhuma empresa" sai uma vez, e não a cada minuto. Volta a
   * poder sair quando alguma batida enxergar empresa de novo — o que interessa
   * é a TRANSIÇÃO, não o estado repetido sessenta vezes por hora.
   */
  private jaAnunciouDescobertaVazia = false;
  /** O último diagnóstico da descoberta, e quando ele foi tirado. */
  private cega = false;
  private cegaConferidaEm = 0;
  /**
   * As empresas cujo bloqueio por assinatura já foi anunciado.
   *
   * O tique bate a cada minuto; sem esta memória, uma empresa suspensa encheria
   * o log com a mesma linha 1.440 vezes por dia e o aviso viraria ruído. Sair do
   * conjunto quando a empresa volta a ter acesso é o que faz a próxima suspensão
   * ser anunciada de novo — o que interessa é a TRANSIÇÃO, como no aviso da
   * descoberta vazia.
   */
  private readonly jaAnunciouBloqueio = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rotinas: RotinasService,
    /*
     * `@Optional()` PELO MESMO MOTIVO DO `ToolGateway`, e com a mesma
     * contrapartida: há suítes que montam esta classe à mão, e um parâmetro
     * obrigatório as quebraria em compilação sem nenhum ganho de segurança. O que
     * garante a presença dele em produção é a asserção de arranque abaixo, que
     * DERRUBA A API — não a assinatura do construtor.
     */
    @Optional() private readonly assinaturas?: AssinaturaService,
  ) {}

  onModuleInit(): void {
    /*
     * A ASSERÇÃO DE ARRANQUE, antes de qualquer outra coisa — inclusive antes do
     * interruptor `ROTINAS_CRON`.
     *
     * Sem `AssinaturaService`, o tique dispararia as rotinas de TODA empresa,
     * inclusive as que a plataforma acabou de suspender por falta de pagamento:
     * gastando o teto de modelo da ROOT e publicando para fora em nome delas. O
     * silêncio é o problema — nada no log diria que o gate de suspensão não
     * alcança o relógio. O serviço vem do `BillingModule`, importado pelo
     * `RoutinesModule`; se aquela linha sumir, esta API não sobe.
     */
    if (!this.assinaturas) {
      throw new Error(
        'RotinasScheduler subiu sem AssinaturaService: as rotinas de uma empresa SUSPENSA ' +
          'continuariam disparando, gastando o teto de IA da ROOT e publicando para fora em nome ' +
          'dela (RF-O-03). O serviço vem do BillingModule — se ele não estiver nos imports do ' +
          'RoutinesModule, o agendador não pode subir.',
      );
    }

    // O sinal é anunciado mesmo com o tique desligado: o agendador EXISTE neste
    // processo, e é isso que o que sobrou do agendador antigo precisa saber.
    // Desligado por variável é decisão de quem opera; ausente é defeito de
    // montagem, e as duas coisas não podem dar o mesmo aviso.
    anunciarAgendadorDeRotinas();

    if (!this.ativo) {
      this.log.warn('ROTINAS_CRON=off — nenhuma rotina dispara sozinha neste processo.');
      return;
    }
    if (this.pautaDesligada) {
      this.log.warn(
        'PAUTA_CRON=off — as rotinas da pauta ficam de fora do tique. A variável é apelido de ' +
          'compatibilidade: para desligar o agendador inteiro use ROTINAS_CRON=off; para pausar ' +
          'uma rotina, a tela /rotinas.',
      );
    }

    // Alinha o primeiro tique à virada do minuto e segue de 60 em 60s.
    const ate = INTERVALO_MS - (Date.now() % INTERVALO_MS);
    setTimeout(() => {
      void this.tick();
      setInterval(() => void this.tick(), INTERVALO_MS);
    }, ate);
    this.log.log(
      `Agendador de rotinas ativo (tique a cada minuto, primeiro em ${Math.round(ate / 1000)}s)`,
    );
  }

  /**
   * Uma batida.
   *
   * Público para a suíte poder exercitá-lo sem esperar um minuto de relógio — é
   * o mesmo arranjo do agendador da pauta, e é o único jeito de um teste provar
   * que o contexto da empresa abre.
   */
  async tick(agora = new Date()): Promise<void> {
    const marca = agora.toISOString().slice(0, 16); // até o minuto
    if (marca === this.ultimoMinuto) return;
    this.ultimoMinuto = marca;

    let empresas: string[];
    try {
      empresas = await this.empresasComRotina();
    } catch (e) {
      this.log.warn(`tique não conseguiu descobrir as empresas: ${(e as Error).message}`);
      return;
    }

    if (empresas.length === 0) {
      await this.conferirAlcanceDaDescoberta();
      if (!this.jaAnunciouDescobertaVazia) {
        this.jaAnunciouDescobertaVazia = true;
        if (this.cega) this.log.warn(this.textoDaDescobertaCega());
        else this.log.log('[rotinas] nenhuma empresa com rotina cadastrada.');
      }
      return;
    }

    // Achou empresa: a descoberta ENXERGA. Vale mais do que qualquer diagnóstico
    // de catálogo, e mantém a tela honesta sem perguntar nada ao banco.
    this.cega = false;
    this.cegaConferidaEm = Date.now();
    this.jaAnunciouDescobertaVazia = false;

    for (const orgId of empresas) {
      await this.varrerEmpresa(orgId, agora);
    }
  }

  /**
   * AS EMPRESAS QUE TÊM ROTINA — a única consulta sem empresa na sessão.
   *
   * A consulta é, literalmente, o `DISTINCT "orgId"` das duas tabelas de rotina,
   * SEM FILTRO. Quem a serve é o índice único de `(orgId, slug)`; não há (nem
   * precisa haver) índice de `(ativo, estado)` para ela.
   *
   * NÃO FILTRA POR "QUEM DISPARA", e isso é decisão, não esquecimento: a
   * varredura de cada empresa também RECONCILIA, e reconciliação alcança
   * justamente as linhas que não disparam — o espelho pausado que precisa ser
   * marcado como órfão, a rotina que voltou a existir na tela de Pauta, a que
   * ficou anunciando horário depois de perder a origem. Uma descoberta que só
   * enxergasse rotina ligada deixaria essas empresas fora da varredura e o
   * conserto nunca aconteceria.
   *
   * Pergunta às PRÓPRIAS tabelas de rotina em vez de varrer `Org`: varrer `Org`
   * exigiria o contexto de plataforma, que é uma sentinela com alcance muito
   * maior do que "quais empresas têm trabalho agendado". `PautaRotina` entra na
   * união porque uma empresa pode ter rotina de pauta e ainda não ter o espelho
   * — é a primeira reconciliação, e ela precisa de um primeiro tique que enxergue
   * a empresa.
   */
  private async empresasComRotina(): Promise<string[]> {
    const [deRotina, dePauta] = await Promise.all([
      this.prisma.rotina.findMany({ select: { orgId: true }, distinct: ['orgId'] }),
      this.prisma.pautaRotina.findMany({ select: { orgId: true }, distinct: ['orgId'] }),
    ]);
    return [...new Set([...deRotina, ...dePauta].map((r) => r.orgId))].sort();
  }

  /**
   * ZERO EMPRESA PODE SER VERDADE — OU PODE SER A POLICY.
   *
   * Sob o papel restrito e sem empresa na sessão, a consulta de descoberta volta
   * VAZIA e CALADA: é exatamente o que a policy manda fazer. O agendador ficaria
   * quieto para sempre com ar de "não há nada agendado". Aqui ele pergunta ao
   * catálogo se esta conexão atravessa o isolamento e guarda a resposta — que
   * vira aviso no log UMA vez e, principalmente, VIRA CAMPO NA TELA
   * (`RotinasList.descobertaCega`). Enquanto isso só saía no log, `/rotinas`
   * ficava inteiramente verde enquanto nada disparava em lugar nenhum.
   *
   * AVISA, NÃO DERRUBA. O expurgo do rastro RECUSA rodar na conexão errada
   * porque ele é um comando de manutenção com começo e fim; um agendador que
   * lançasse no arranque levaria a API junto.
   */
  private async conferirAlcanceDaDescoberta(): Promise<void> {
    if (Date.now() - this.cegaConferidaEm < VALIDADE_DO_DIAGNOSTICO_MS) return;
    this.cegaConferidaEm = Date.now();
    try {
      const [l] = await this.prisma.$queryRaw<
        { atravessa: boolean; papel: string; forcado: boolean }[]
      >`
        SELECT COALESCE((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS atravessa,
               current_user::text AS papel,
               COALESCE(c.relforcerowsecurity, false) AS forcado
          FROM (SELECT 1) _
          LEFT JOIN pg_class c ON c.relname = 'Rotina' AND c.relkind = 'r'`;
      this.cega = !!l && !l.atravessa && l.forcado;
    } catch (e) {
      this.log.warn(`[rotinas] não deu para conferir o alcance da descoberta: ${(e as Error).message}`);
    }
  }

  private textoDaDescobertaCega(): string {
    return (
      '[rotinas] nenhuma empresa com rotina — e a conexão desta API NÃO atravessa o isolamento por ' +
      'linha numa tabela com FORCE ROW LEVEL SECURITY. A descoberta do tique roda sem empresa na ' +
      'sessão, então ela volta vazia por policy, não por falta de rotina. Enquanto isto valer, ' +
      'NENHUMA rotina dispara. Conserto: dar BYPASSRLS ao papel da aplicação, ou mover a descoberta ' +
      'para um comando de manutenção com a conexão dona (é o desenho do expurgo do rastro).'
    );
  }

  /**
   * UMA EMPRESA, DENTRO DO CONTEXTO DELA.
   *
   * Uma empresa que falha NÃO derruba a varredura: o erro fica na linha dela e
   * as outras seguem — é o mesmo princípio do expurgo, e pelo mesmo motivo
   * (obrigação que roda sozinha não tem quem reclame dela).
   *
   * E DENTRO DA EMPRESA, UMA ROTINA QUE FALHA NÃO DERRUBA AS OUTRAS. A promessa
   * valia só para a chamada do executor, que já era protegida lá dentro; qualquer
   * outro tropeço (gravar histórico, contar, fechar a passagem) subia até aqui e
   * abandonava as rotinas seguintes da MESMA empresa naquele minuto. Agora cada
   * rotina tem o seu `try`, e a falha dela vale por ela.
   */
  private async varrerEmpresa(orgId: string, agora: Date): Promise<void> {
    try {
      await comContexto(
        {
          orgId,
          actorType: ActorType.system,
          actorId: null,
          agentSlug: null,
          correlationId: novaCorrelacao('tique'),
          origem: 'cron',
        },
        async () => {
          await this.rotinas.reconciliarPauta(orgId);

          /*
           * EMPRESA SUSPENSA NÃO DISPARA ROTINA — RF-O-03.
           *
           * O gate de suspensão (`billing/suspensao.interceptor.ts`) é um
           * interceptor de REQUISIÇÃO, e o tique não é requisição. Sem esta
           * pergunta, uma empresa que a plataforma acabou de cortar por
           * inadimplência continuava com os agentes dela rodando de hora em hora:
           * gastando o teto de modelo da ROOT (que é quem paga o provedor de IA)
           * e PUBLICANDO PARA FORA em nome dela — mensagem de WhatsApp, peça no
           * Instagram, arquivo no Drive do cliente. Cobrar o acesso e continuar
           * agindo é o pior dos dois lados.
           *
           * A RECONCILIAÇÃO CONTINUA ACONTECENDO, e é de propósito: ela não gasta
           * nada, não sai para fora e é o que mantém o espelho das rotinas da
           * pauta honesto. Uma empresa que volta a pagar encontra a lista dela em
           * ordem, em vez de um mês de deriva para consertar.
           *
           * FALHA ABERTA, como o gate: se a leitura do estado falhar (banco ruim,
           * timeout), a rotina RODA e o log grita. A escolha oposta pararia o
           * relógio de toda a carteira por causa de um soluço — e o relógio
           * parado não se anuncia, só deixa de acontecer.
           */
          if (await this.bloqueadaPorAssinatura(orgId)) return;

          const candidatas = await this.prisma.rotina.findMany({
            where: { orgId, ativo: true, estado: { in: [...ESTADOS_QUE_DISPARAM] as AgentEstado[] } },
          });
          for (const r of candidatas) {
            const retomada = this.arrendamentoVencido(r, agora);
            if (!retomada && !this.bate(r, agora)) continue;
            if (this.pautaDesligada && TIPOS_DA_PAUTA.includes(r.tipo)) continue;
            this.log.log(
              retomada
                ? `retomando rotina "${r.slug}" (${orgId}): a passagem anterior não terminou`
                : `disparando rotina "${r.slug}" (${orgId})`,
            );
            try {
              await this.rotinas.executar(r, 'cron', agora);
            } catch (e) {
              this.log.error(
                `[rotinas] ${orgId}/${r.slug}: a passagem falhou fora do executor ` +
                  `(${(e as Error).message}). As outras rotinas desta empresa seguem.`,
              );
            }
          }
        },
      );
    } catch (e) {
      this.log.error(
        `[rotinas] empresa ${orgId}: a varredura falhou (${(e as Error).message}). As outras seguem.`,
      );
    }
  }

  /**
   * O acesso desta empresa está bloqueado pela assinatura?
   *
   * Roda DENTRO do contexto da empresa (quem chama é `varrerEmpresa`), porque
   * `AssinaturaService.estadoDeAcesso` exige empresa resolvida e porque o
   * isolamento por linha está em modo forçado: sem o contexto, a consulta volta
   * vazia e calada, e "vazio" aqui significaria "não está suspensa" — o pior
   * desfecho possível para esta pergunta.
   *
   * `null` (empresa sem linha de assinatura) NÃO bloqueia, pela mesma razão
   * escrita em `acessoBloqueado`: hoje nenhuma empresa tem linha, e bloquear por
   * ausência pararia o relógio da carteira inteira no minuto em que isto subisse.
   */
  private async bloqueadaPorAssinatura(orgId: string): Promise<boolean> {
    /*
     * Só acontece em instância montada à mão por suíte: em produção o arranque
     * RECUSA subir sem o serviço (ver `onModuleInit`). Devolver `false` aqui é
     * deixar a rotina rodar, que é o comportamento de antes desta fatia.
     */
    if (!this.assinaturas) {
      this.log.error(
        `[rotinas] instância sem AssinaturaService: as rotinas da empresa ${orgId} RODAM sem ` +
          'conferir suspensão. Em produção isto não acontece — o arranque recusa subir assim.',
      );
      return false;
    }

    let estado: Awaited<ReturnType<AssinaturaService['estadoDeAcesso']>>;
    try {
      estado = await this.assinaturas.estadoDeAcesso(orgId);
    } catch (e) {
      this.log.error(
        `[rotinas] não consegui ler o estado da assinatura da empresa ${orgId} — as rotinas dela ` +
          `RODAM assim mesmo: ${(e as Error).message}`,
      );
      return false;
    }

    if (!acessoBloqueado(estado)) {
      this.jaAnunciouBloqueio.delete(orgId);
      return false;
    }

    if (!this.jaAnunciouBloqueio.has(orgId)) {
      this.jaAnunciouBloqueio.add(orgId);
      this.log.warn(
        `[rotinas] empresa ${orgId} com assinatura "${estado}": nenhuma rotina dela dispara ` +
          'enquanto o acesso estiver bloqueado. Nada foi apagado, nada foi desativado — as ' +
          'rotinas continuam como estão e voltam a disparar sozinhas quando o acesso voltar.',
      );
    }
    return true;
  }

  /**
   * A passagem anterior tomou a rotina e nunca a devolveu?
   *
   * `reservadoAte` só fica no futuro enquanto alguém está executando (e quem
   * executa RENOVA). Vencido, e diferente da época — que é o valor de "livre" —,
   * significa que a execução morreu entre reservar e terminar. A ocorrência é
   * retomada mesmo que o cron não bata agora: é o dia inteiro de uma rotina
   * diária que estava em jogo.
   */
  private arrendamentoVencido(r: Rotina, agora: Date): boolean {
    const ate = r.reservadoAte?.getTime() ?? 0;
    return ate > LIVRE.getTime() && ate < agora.getTime();
  }

  /** O cron bate agora, no fuso da rotina? Cron inválido é aviso, não queda. */
  private bate(r: Rotina, agora: Date): boolean {
    try {
      return combina(parseCron(r.cron), agora, r.tz);
    } catch (e) {
      this.log.warn(`rotina "${r.slug}" tem cron inválido (${r.cron}): ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * O que a tela precisa saber sobre o agendador.
   *
   * `descobertaCega` é reavaliada no máximo de cinco em cinco minutos: a resposta
   * vem do catálogo do PostgreSQL e não muda sozinha, e uma tela aberta não pode
   * virar uma consulta de catálogo por recarregamento.
   */
  async diagnostico(): Promise<EstadoDoAgendador> {
    await this.conferirAlcanceDaDescoberta();
    return { ativo: this.ativo, pautaDesligada: this.pautaDesligada, descobertaCega: this.cega };
  }

  /** O tique está de pé neste processo? A tela pergunta. */
  get tiqueAtivo(): boolean {
    return this.ativo;
  }

  /** `PAUTA_CRON=off` ainda está no ambiente? A tela pergunta. */
  get pautaDesligadaPorVariavel(): boolean {
    return this.pautaDesligada;
  }
}
