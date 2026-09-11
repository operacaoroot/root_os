import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

/*
 * ============================================================================
 * QUEM RESPONDE SE UM CONECTOR ESTÁ CONFIGURADO — a frente 4, fatia 3.3
 * ============================================================================
 *
 * A PERGUNTA QUE ISTO RESOLVE. A tela de Conexões precisa dizer, linha a linha,
 * se aquele conector tem credencial. Até 11/09/2026 ela descobria isso LENDO A
 * CREDENCIAL DO AMBIENTE por conta própria:
 *
 *     clickup: !!process.env.CLICKUP_API_TOKEN,
 *     pluggy:  !!(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET),
 *
 * ----------------------------------------------------------------------------
 * A DECISÃO: ler credencial só para testar presença NÃO é legítimo
 * ----------------------------------------------------------------------------
 * O argumento a favor é honesto — `!!process.env.X` não vaza segredo nenhum, não
 * chama ninguém, e o custo de um registro novo é real. Ainda assim a resposta é
 * não, por três motivos que não são de gosto:
 *
 *  1. MENTE SEM ERRO DE COMPILAÇÃO. O nome da variável é um contrato duplicado
 *     entre a tela e o conector. Renomear `CLICKUP_API_TOKEN` dentro do
 *     `ClickupService` — ou passar a aceitar um segundo nome, ou a ler do cofre
 *     por tenant (fatia 5.3) — faz a tela afirmar "desconectado" sobre um
 *     conector que está funcionando. Nada quebra, nada avisa: só a tela passa a
 *     mentir. Quem opera confia na tela para decidir se religa, se refaz OAuth,
 *     se abre chamado.
 *  2. "PRESENÇA" NÃO É A MESMA PERGUNTA EM DOIS CONECTORES. A Pluggy precisa de
 *     DUAS variáveis; o Asaas tem uma, mas o `AsaasService` a lê com `.trim()` —
 *     uma chave só com espaços está "presente" para a tela e ausente para o
 *     conector. O critério de "configurado" pertence a quem usa a credencial.
 *  3. A CATRACA NÃO CONSEGUE DISTINGUIR. A varredura da frente 4 vê o
 *     identificador da variável fora do conector e não tem como saber se ele
 *     está sendo TESTADO ou USADO para montar uma chamada. Abrir a exceção para
 *     "só testar presença" abriria a porta para `fetch(process.env.EVOLUTION_URL
 *     ? ... : ...)`, que é uso.
 *
 * A saída é a que a própria lista de exceções já apontava: **cada conector de
 * CHAVE DE API responde se está configurado**. Os serviços já têm o getter
 * (`ClickupService.configured`, `PluggyService.configured`,
 * `AsaasService.configured`, `EvolutionService.configured`) — o que faltava era
 * um lugar onde a tela pudesse perguntar sem IMPORTAR o conector, porque
 * importar é a frente 1 da mesma catraca.
 *
 * ----------------------------------------------------------------------------
 * POR QUE UM REGISTRO, E POR QUE ELE MORA AQUI
 * ----------------------------------------------------------------------------
 * Mesmo desenho e mesmo motivo do `InterruptoresRegistry`, ao lado: quem PERGUNTA
 * (a tela de Conexões, em `integrations/`) não pode importar quem RESPONDE (os
 * conectores, espalhados por `google/`, `finance/`, `integrations/`, `pauta/`),
 * senão a catraca acusa e o grafo de módulos fecha ciclo. Então a dependência se
 * inverte: cada conector se INSCREVE no arranque, e o registro é consultado por
 * chave.
 *
 * Mora em `gateway/` porque o `GatewayModule` é `@Global`: assim nenhum módulo
 * precisa importar nada para se inscrever nem para perguntar. É a mesma razão
 * pela qual o registro de interruptores está aqui e não em `integrations/`.
 *
 * ----------------------------------------------------------------------------
 * O QUE SIGNIFICA NÃO ESTAR INSCRITO
 * ----------------------------------------------------------------------------
 * `null`, e não `false`. As duas coisas são diferentes e a tela precisa das
 * duas: `false` é "o conector existe e diz que não tem credencial"; `null` é
 * "ninguém respondeu por esta chave" — conector builtin (OFX), conector que
 * ainda não se inscreveu, ou chave do catálogo sem serviço nenhum atrás. Devolver
 * `false` nos dois casos faria a tela afirmar "desconectado" sobre coisas que
 * nunca precisaram de credencial.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE REGISTRO NÃO RESPONDE: conector de OAUTH POR EMPRESA
 * ----------------------------------------------------------------------------
 * A assinatura é `() => boolean`, SEM empresa. Isso não é descuido, é o limite
 * da pergunta: ele responde "o PROCESSO tem credencial para falar com este
 * fornecedor?", que é uma propriedade do ambiente, não do cliente.
 *
 * Para as quatro superfícies do Google (`gmail`, `gcal`, `gdocs`, `drive`) essa
 * NÃO é a pergunta da tela. Elas são de autorização: o estado verdadeiro é "esta
 * EMPRESA autorizou a conta dela?", e quem responde isso é a linha que o retorno
 * do OAuth cria (`IntegrationAccount`, escrita por `GoogleService.handleCallback`).
 * A primeira versão desta fatia inscreveu as quatro com `() => this.configured`,
 * que é `GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET` — verdadeiro em produção para
 * TODO mundo. Resultado: empresa que nunca autorizou nada passou a ver o Google
 * como "conectado" na tela de Conexões. A tela ficou MENOS honesta do que antes
 * da fatia, que é o contrário do que a fatia queria.
 *
 * AS DUAS SAÍDAS, e por que esta: (a) não inscrever chave de OAuth aqui, porque
 * o estado dela é a linha do banco; (b) dar empresa à assinatura. Escolhida a
 * (a), por três motivos:
 *   1. (b) não resolve sozinha. Com empresa, `configured` do Google teria de ir
 *      ao banco por linha do catálogo — e o dado que ele leria é o MESMO
 *      `IntegrationAccount` que `IntegrationsService.catalog` já carregou de uma
 *      vez, antes de perguntar. Seria uma segunda leitura do mesmo fato, por uma
 *      via que pode divergir.
 *   2. `null` já significa exatamente o que queremos aqui: "ninguém respondeu
 *      por esta chave, use o registro do banco". A tela já trata esse caso, e o
 *      trata bem — é o comportamento que ela tinha ANTES da fatia.
 *   3. A pergunta que este registro resolve continua valendo para quem é de
 *      chave de API (ClickUp, Pluggy, Asaas, Evolution): ali não existe linha no
 *      banco, e o dono do segredo é mesmo quem sabe responder.
 *
 * O que a decisão custa: numa empresa que nunca autorizou, a tela diz
 * "desconectado" sem distinguir "o app não tem credencial" de "esta empresa não
 * autorizou". Quem precisa dessa distinção tem a tela do Google (`/google`),
 * cujo `GET /google/status` devolve `configured` e `connected` separados.
 */
/**
 * As chaves de conector que TÊM dono neste repositório e cujo estado é "o
 * processo tem a credencial". São as cobradas no arranque.
 *
 * Fica fora, e de propósito:
 *   · `gmail`, `gcal`, `gdocs`, `drive`, `instagram` — OAuth por empresa. O
 *     estado é a linha de `IntegrationAccount`, não a credencial do app (ver o
 *     cabeçalho da classe). Inscrevê-las faria a tela dizer "conectado" para
 *     empresa que nunca autorizou.
 *   · `ofx` — builtin: importar extrato não depende de credencial nenhuma.
 *   · `openai`, `telegram`, `asana`, `zapier`, `apify` — sem serviço de conector
 *     neste repositório; não há a quem perguntar.
 *
 * `obsidian` ENTROU na estabilização da onda 7, junto com a linha de inscrição
 * no `onModuleInit` do `ObsidianService` — a dívida que este comentário
 * descrevia. A inscrição dele fica ANTES do retorno antecipado daquele método,
 * de propósito: sem vault montada ele responde `false`, que é uma resposta, e
 * não deixa de responder.
 */
const DEVEM_RESPONDER: ReadonlyArray<{ chave: string; servico: string }> = [
  { chave: 'clickup', servico: 'ClickupService' },
  { chave: 'pluggy', servico: 'PluggyService' },
  { chave: 'asaas', servico: 'AsaasService' },
  { chave: 'whatsapp', servico: 'EvolutionService' },
  { chave: 'obsidian', servico: 'ObsidianService' },
];

/** A lista cobrada no arranque, para a suíte poder afirmar sobre ela. */
export const CONECTORES_QUE_DEVEM_RESPONDER: readonly string[] = DEVEM_RESPONDER.map((c) => c.chave);

@Injectable()
export class ConectoresConfiguradosRegistry implements OnApplicationBootstrap {
  private readonly log = new Logger('ConectoresConfigurados');
  private readonly respostas = new Map<string, () => boolean>();

  /**
   * Um conector se apresenta. `chave` é a do catálogo (`CONNECTORS`), e a função
   * é lida na hora da pergunta — nunca no arranque — porque `configured` de
   * alguns conectores pode passar a depender do tenant quando o COFRE entrar
   * (fatia 5.3), e congelar o valor aqui transformaria este registro na mesma
   * mentira que ele existe para consertar.
   */
  registrar(chave: string, configurado: () => boolean): void {
    if (this.respostas.has(chave)) {
      this.log.warn(
        `[conectores] "${chave}" foi inscrito duas vezes: a segunda inscrição vence. ` +
          'Dois serviços respondendo pela mesma chave é sinal de conector duplicado.',
      );
    }
    this.respostas.set(chave, configurado);
  }

  /**
   * A ASSERÇÃO DE ARRANQUE — quem tem dono de segredo TEM de se inscrever.
   *
   * Mesmo desenho e mesmo motivo do `InterruptoresRegistry` ao lado, que recusa
   * subir se ninguém se inscrever nele. Aqui a versão inicial não tinha nada, e
   * o preço era silencioso na direção oposta à do registro irmão: um conector
   * que esquecesse a linha de inscrição no `onModuleInit` dele voltaria a
   * aparecer como DESCONECTADO na tela — com credencial no lugar, funcionando —
   * e ninguém saberia por quê. É a mesma mentira que este registro existe para
   * consertar, só que chegando por omissão.
   *
   * A lista abaixo é das chaves cujo estado é "o processo tem a credencial", e
   * portanto só o conector sabe responder. Conector de OAuth não entra (ver o
   * cabeçalho da classe), builtin não entra, e chave do catálogo sem serviço
   * neste repositório também não.
   *
   * `onApplicationBootstrap` e não `onModuleInit`: o módulo da porta é `@Global`
   * e inicializa ANTES dos módulos que se inscrevem. Conferir cedo demais daria
   * falso positivo.
   */
  onApplicationBootstrap(): void {
    const faltando = DEVEM_RESPONDER.filter((c) => !this.respostas.has(c.chave));
    if (!faltando.length) return;
    throw new Error(
      'A aplicação subiu com conector(es) sem dono no ConectoresConfiguradosRegistry: ' +
        faltando.map((c) => `"${c.chave}" (${c.servico})`).join(', ') +
        '. A tela de Conexões passaria a mostrar esses conectores como DESCONECTADOS mesmo com ' +
        'a credencial no lugar, sem nada no log — que é exatamente a mentira que este registro ' +
        'existe para consertar. Conserto: uma linha ' +
        '`this.conectoresConfigurados.registrar("<chave>", () => this.configured)` no ' +
        'onModuleInit do conector. Conector de OAuth NÃO entra nesta lista: o estado dele é a ' +
        'linha de IntegrationAccount, não a credencial do processo.',
    );
  }

  /**
   * `true`/`false` quando alguém respondeu por essa chave; `null` quando
   * ninguém se inscreveu — ver o cabeçalho.
   *
   * Um conector que estoure ao responder não pode derrubar a tela de Conexões:
   * a exceção vira `null` (não sabemos) e uma linha de log, e não um 500 numa
   * tela cujo propósito é justamente diagnosticar conector quebrado.
   */
  configurado(chave: string): boolean | null {
    const fn = this.respostas.get(chave);
    if (!fn) return null;
    try {
      return fn();
    } catch (e) {
      this.log.error(`[conectores] "${chave}" falhou ao dizer se está configurado: ${(e as Error).message}`);
      return null;
    }
  }

  /** As chaves inscritas. Serve à suíte, que cobra inscrição de conector novo. */
  get inscritos(): string[] {
    return [...this.respostas.keys()].sort();
  }
}
