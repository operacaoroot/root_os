import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ActorType } from '@prisma/client';
import type { RecusaDeConector } from '../integrations/conectores';

/**
 * A pergunta que a porta faz ao interruptor de conector — RF-G-06.
 *
 * É a assinatura de `ConectoresService.verificar`: decide e, quando recusa,
 * deixa a recusa registrada no RASTRO. Devolve `null` quando a capacidade não
 * usa conector externo, quando o conector está ligado, ou quando a capacidade é
 * desconhecida do mapa.
 */
export type ConsultaDeInterruptor = (entrada: {
  orgId: string;
  capabilityId?: string | null;
  conector?: string | null;
  correlationId?: string | null;
  actorType?: ActorType | null;
  actorId?: string | null;
  agentSlug?: string | null;
}) => Promise<RecusaDeConector | null>;

/**
 * O REGISTRO DE INTERRUPTORES DE CONECTOR — e por que ele existe em vez de um
 * import direto.
 *
 * A porta precisa perguntar "este conector está ligado para esta empresa?" antes
 * de deixar uma ação sair da casa. Quem sabe responder é
 * `integrations/conectores.service.ts` — e ele importa `EventLogService`, que
 * mora AQUI, na pasta da porta. Fazer a porta importar o serviço de integrações
 * fecha o ciclo (`GatewayModule` → `IntegrationsModule` → `GatewayModule`) e a
 * aplicação não sobe.
 *
 * A saída é a mesma que o repositório já usa para o registro de efeitos
 * (`efeitos.registry.ts`): um registro dentro da pasta da porta que RECEBE a
 * função depois, no arranque, de quem sabe respondê-la. A dependência passa a
 * ser do módulo de integrações para o da porta — a direção que já existe.
 *
 * SEM NINGUÉM REGISTRADO, `consultar` DEVOLVE `null` — e a APLICAÇÃO NÃO SOBE.
 *
 * As duas coisas juntas, e elas não se contradizem. O `null` é para quem
 * constrói a porta À MÃO: as cinco suítes que a montam sem Nest, onde o módulo
 * de integrações nem existe e a porta tem de se comportar exatamente como antes
 * do gancho. Um `null` que lançasse ali trocaria uma proteção ausente por uma
 * suíte que não roda.
 *
 * A recusa de subir é para a APLICAÇÃO, e é `onApplicationBootstrap` quem a faz.
 * Sem ela, o preço do `null` era este: se um dia `ConectoresService` saísse do
 * módulo, ou o módulo deixasse de ser importado, o botão de emergência voltaria
 * a só REGISTRAR a decisão — em silêncio, com a tela dizendo que recusa. O teto
 * de custo, que é freio do mesmo nível, já derruba o arranque quando falta
 * (`ToolGateway.onModuleInit`); duas posturas opostas para dois freios iguais
 * seria escolher qual dos dois pode falhar calado.
 *
 * POR QUE `onApplicationBootstrap` E NÃO `onModuleInit`: o módulo da porta é
 * `@Global` e inicializa ANTES do de integrações. Conferir no `onModuleInit`
 * desta classe daria falso positivo — a inscrição ainda não teria acontecido.
 * `onApplicationBootstrap` roda depois de TODOS os módulos terem inicializado,
 * que é exatamente a hora em que a pergunta "alguém assumiu?" tem resposta.
 */
@Injectable()
export class InterruptoresRegistry implements OnApplicationBootstrap {
  private readonly log = new Logger('Interruptores');
  private consulta?: ConsultaDeInterruptor;

  /** Quem sabe responder se inscreve no arranque. O último a registrar vence. */
  registrar(consulta: ConsultaDeInterruptor, quem = 'ConectoresService'): void {
    this.consulta = consulta;
    this.log.log(`interruptor de conector ligado à porta por ${quem} (RF-G-06)`);
  }

  /** Alguém respondeu por este interruptor? Só para log e para a suíte. */
  get ligado(): boolean {
    return this.consulta !== undefined;
  }

  /**
   * A asserção de arranque — ver o cabeçalho da classe.
   *
   * Roda só sob Nest (`app.init()` e `createApplicationContext`). Quem constrói
   * o registro à mão, nas suítes, nunca chega aqui.
   */
  onApplicationBootstrap(): void {
    if (this.consulta) return;
    throw new Error(
      'A aplicação subiu sem ninguém inscrito no InterruptoresRegistry: desligar um conector ' +
        'voltaria a apenas REGISTRAR a decisão, sem barrar chamada nenhuma, enquanto a tela de ' +
        'Conexões continuaria dizendo que recusa (RF-G-06). Quem se inscreve é ' +
        '`ConectoresService.onModuleInit`, do IntegrationsModule — se ele não estiver importado ' +
        'em AppModule, ou tiver deixado de se registrar, a porta não pode subir.',
    );
  }

  /**
   * A recusa desta chamada, ou `null`.
   *
   * `null` também quando NINGUÉM se registrou — ver o cabeçalho da classe.
   */
  async consultar(entrada: {
    orgId: string;
    capabilityId?: string | null;
    conector?: string | null;
    correlationId?: string | null;
    actorType?: ActorType | null;
    actorId?: string | null;
    agentSlug?: string | null;
  }): Promise<RecusaDeConector | null> {
    if (!this.consulta) return null;
    return this.consulta(entrada);
  }
}
