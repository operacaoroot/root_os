import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RodadaService } from './rodada.service';
import {
  agendadorDeRotinasDePe,
  agendadorDeRotinasDesde,
} from '../routines/sinal-do-agendador';

/**
 * O QUE SOBROU DO AGENDADOR DA PAUTA — e por que ele ainda existe.
 *
 * ----------------------------------------------------------------------------
 * O QUE MUDOU (fatia 5.1, RF-N-04)
 * ----------------------------------------------------------------------------
 * Até aqui esta classe era o relógio do produto: um `setInterval` de um minuto
 * que lia `PautaRotina`, abria o contexto da empresa e mandava gerar a rodada.
 * Ele era o único agendamento que existia, e só sabia falar de pauta.
 *
 * O tique agora é do módulo de rotinas (`src/routines/rotinas.scheduler.ts`), e
 * a rotina da pauta virou uma rotina como as outras: mesmo cron, mesma abertura
 * de contexto por empresa, mesmo executor — só que com estado declarado
 * (rodando · aprendendo · planejado · pausado), histórico de execução e uma tela
 * (`/rotinas`) que mostra os dois.
 *
 * ----------------------------------------------------------------------------
 * `PAUTA_CRON` DEIXOU DE TER EFEITO COLATERAL
 * ----------------------------------------------------------------------------
 * A variável desligava ESTE `setInterval`. Depois da generalização, um
 * interruptor com esse nome desligaria TODAS as rotinas — a da pauta e as que
 * vierem. Ela continua respeitada, e só faz uma coisa: o agendador de rotinas
 * pula as rotinas do executor da pauta. Desligar o agendador inteiro é
 * `ROTINAS_CRON=off`; pausar UMA rotina é a tela.
 *
 * ----------------------------------------------------------------------------
 * POR QUE A CLASSE NÃO FOI APAGADA
 * ----------------------------------------------------------------------------
 * Duas razões, e a segunda é a que importa.
 *
 *  1. Ela é provider de `pauta.module.ts`, que não é desta fatia. Apagar a
 *     classe deixaria o módulo apontando para um símbolo que não existe, e a API
 *     não subiria.
 *
 *  2. O AGENDAMENTO DA PAUTA MUDOU DE DONO, e mudança de dono tem um modo de
 *     falhar que é pior do que quebrar: o dono antigo sai, o novo não entra, e
 *     nada acusa. Se o `RoutinesModule` não estiver registrado em
 *     `app.module.ts`, não há tique nenhum — e a rodada da pauta simplesmente
 *     pararia de acontecer, sem erro, sem log e sem tela mudando de cor. É isso
 *     que o `onApplicationBootstrap` abaixo existe para impedir.
 *
 * ----------------------------------------------------------------------------
 * ELE DERRUBA O ARRANQUE, E NÃO APENAS RECLAMA
 * ----------------------------------------------------------------------------
 * A primeira versão desta sentinela escrevia um `log.error` e deixava a API
 * subir. É a mesma coisa que não existir: quem não lê o arranque não nota, o
 * produto sobe com o relógio mudo, e o sintoma só aparece dias depois, na forma
 * de "a rodada parou sozinha". Aqui ela LANÇA.
 *
 * Isso é exatamente o que a casa já faz em sete outros lugares (a porta recusa
 * subir sem o provedor de teto; três registros recusam inscrição faltante ou
 * dobrada), e pelo mesmo motivo: montagem errada tem de doer no boot, não na
 * madrugada. Só existe UM jeito de cair aqui — esquecer o `RoutinesModule` na
 * lista de `imports` —, e a mensagem diz o arquivo, a lista e a consequência.
 *
 * NÃO HÁ VARIÁVEL PARA DESLIGAR ESTA TRAVA, de propósito: quem quer o produto
 * sem tique usa `ROTINAS_CRON=off`, que mantém o módulo montado e o sinal aceso.
 * Uma válvula para calar a sentinela seria a primeira coisa a ser ligada no dia
 * em que ela tocasse.
 *
 * `onApplicationBootstrap`, e não `onModuleInit`, de propósito: o Nest chama
 * todo `onModuleInit` antes de qualquer `onApplicationBootstrap`, então neste
 * ponto o agendador de rotinas já teve a chance de se anunciar. No
 * `onModuleInit` a resposta seria "ainda não" para todo mundo e a trava fecharia
 * sempre.
 *
 * As duas dependências continuam injetadas porque o módulo as declara e porque
 * elas são a assinatura que a suíte de custo de IA conhece; nenhuma das duas é
 * usada aqui, e é isso mesmo.
 */
@Injectable()
export class PautaSchedulerService implements OnApplicationBootstrap {
  private readonly log = new Logger('PautaScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly rodadas: RodadaService,
  ) {
    void this.prisma;
    void this.rodadas;
  }

  onApplicationBootstrap(): void {
    if (agendadorDeRotinasDePe()) {
      this.log.log(
        'o agendamento da pauta agora é do módulo de rotinas ' +
          `(de pé desde ${agendadorDeRotinasDesde()?.toISOString() ?? '?'}). Esta classe não ` +
          'tem mais relógio: ver src/routines/rotinas.scheduler.ts.',
      );
      return;
    }

    const recado =
      'O AGENDADOR DE ROTINAS NÃO ESTÁ DE PÉ NESTE PROCESSO — e o agendador antigo da pauta não ' +
      'existe mais. Nenhuma rotina dispararia: nem a da pauta, nem as outras, e nada acusaria. ' +
      'Falta registrar `RoutinesModule` (src/routines/routines.module.ts) na lista de `imports` de ' +
      '`src/app.module.ts`. Para subir sem tique de propósito, use ROTINAS_CRON=off — o módulo ' +
      'continua montado e esta trava fica satisfeita.';
    this.log.error(recado);
    throw new Error(recado);
  }
}
