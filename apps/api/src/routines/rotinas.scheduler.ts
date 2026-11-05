import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ActorType, AgentEstado, type Rotina } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { novaCorrelacao } from '../common/contexto-execucao';
import { comContextoDePlataforma, comContextoDaEmpresaResolvida } from '../prisma/contexto-de-plataforma';
import { combina, parseCron } from '../pauta/cron';
import { AssinaturaService } from '../billing/assinatura.service';
import { LimpezaDasVencidasService } from '../approvals/limpeza-das-vencidas';
import { acessoBloqueado } from '../billing/assinatura';
import { RotinasService } from './rotinas.service';
import { ESTADOS_QUE_DISPARAM, LIVRE, TIPOS_DA_PAUTA, type EstadoDoAgendador } from './rotina.tipos';
import { ehTipoDaCasa } from './rotinas-da-casa';
import { anunciarAgendadorDeRotinas } from './sinal-do-agendador';

/** O tique. Um minuto, como o do agendador da pauta — é o mesmo relógio. */
const INTERVALO_MS = 60_000;


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
 * A sentinela de plataforma só enumera ids de `Org`. A descoberta de rotinas e
 * a execução acontecem no contexto de cada empresa.
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
    /*
     * T7 (rodada do trabalho): a limpeza diária das aprovações vencidas é semeada
     * por aqui, em toda empresa que o tique varre. Opcional como o de cima: as
     * suítes que montam o agendador à mão não semeiam (e as empresas de teste
     * que elas apagam não ganham uma rotina presa a elas).
     */
    @Optional() private readonly limpezaDasVencidas?: LimpezaDasVencidasService,
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
      this.cega = true;
      this.log.warn(`tique não conseguiu descobrir as empresas: ${(e as Error).message}`);
      return;
    }

    if (empresas.length === 0) {
      this.cega = this.falhaNaDescoberta;
      if (!this.jaAnunciouDescobertaVazia) {
        this.jaAnunciouDescobertaVazia = true;
        if (this.cega) this.log.warn(this.textoDaDescobertaCega());
        else this.log.log('[rotinas] nenhuma empresa com rotina cadastrada.');
      }
      return;
    }

    // Uma falha parcial permanece visível mesmo quando outra empresa foi encontrada.
    this.cega = this.falhaNaDescoberta;
    this.jaAnunciouDescobertaVazia = false;

    for (const orgId of empresas) {
      await this.varrerEmpresa(orgId, agora);
    }
  }

  /** Descobre apenas ids na plataforma; rotinas e pauta são lidas em cada empresa. */
  private falhaNaDescoberta = false;
  private async empresasComRotina(): Promise<string[]> {
    const orgs=await comContextoDePlataforma(()=>this.prisma.org.findMany({select:{id:true}}));
    const empresas:string[]=[];
    this.falhaNaDescoberta=false;
    for(const org of orgs) {
      try {
        const tem=await comContextoDaEmpresaResolvida(org.id,async()=>{
          const [rotinas,pautas]=await Promise.all([
            this.prisma.rotina.findMany({where:{orgId:org.id},select:{orgId:true},take:1}),
            this.prisma.pautaRotina.findMany({where:{orgId:org.id},select:{orgId:true},take:1}),
          ]);
          return rotinas.length>0 || pautas.length>0;
        });
        if(tem) empresas.push(org.id);
      } catch(e) { this.falhaNaDescoberta=true; this.log.warn(`[rotinas] descoberta falhou na empresa ${org.id}: ${(e as Error).message}`); }
    }
    return empresas.sort();
  }

  private textoDaDescobertaCega(): string {
    return (
      '[rotinas] a descoberta de pelo menos uma empresa falhou; consulte os avisos do agendador.'
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
      await comContextoDaEmpresaResolvida(orgId,
        async () => {
          await this.rotinas.reconciliarPauta(orgId);
          await this.limpezaDasVencidas?.garantir(orgId);

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
            // As rotinas da casa têm o relógio do próprio serviço (`rotinas-da-casa.ts`):
            // dispará-las aqui também faria a passagem em dobro.
            if (ehTipoDaCasa(r.tipo)) continue;
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
        },{actorType:ActorType.system,actorId:null,correlationId:novaCorrelacao('tique'),origem:'cron'},
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

  /** O diagnóstico reflete a última descoberta executada. */
  async diagnostico(): Promise<EstadoDoAgendador> {
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
