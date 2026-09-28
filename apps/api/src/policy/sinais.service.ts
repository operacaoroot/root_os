import { Injectable, Logger } from '@nestjs/common';
import type { Sinal } from '@mktos/policy';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from './policy.service';
import {
  acimaDoTeto,
  conferirJanela,
  foraDaJanela,
  fusoDaPolitica,
  fusoValido,
  minutosNoFuso,
} from './limites';

/*
 * Os seis sinais de escalonamento. O motor puro RECEBE os sinais prontos — ele
 * não pode calculá-los, porque calcular exige I/O. Quem faz a conta é isto.
 *
 * `fonte_nao_confiavel` não está aqui de propósito: ele não é calculado, é
 * DECLARADO pelo runtime quando o pedido foi montado a partir de mensagem,
 * documento ou página. É o RF-G-07 inteiro — conteúdo externo entra como dado,
 * jamais como instrução, e só pode ELEVAR o nível. Por isso a bandeira é de mão
 * única no contexto de execução: existe marcar, não existe desmarcar.
 *
 * A JANELA E O TETO SÃO CONTA EMPRESTADA, e não repetida: `foraDaJanela` e
 * `acimaDoTeto` moram em `limites.ts`, que é puro, e o simulador da tela da
 * Régua chama as MESMAS funções. Uma segunda cópia aqui faria a tela ensinar
 * uma janela e a porta impor outra — que é o defeito que a fatia 2.3 existe
 * para não criar. (Eles já moraram em `simulador.ts`: o caminho quente da porta
 * não tem por que depender de um módulo com esse nome para comparar relógio.)
 *
 * JANELA ILEGÍVEL ACENDE O SINAL — E AGORA AVISA. `foraDaJanela` falha fechada:
 * um `['8h', 'oito']` em `limitesPadrao.janelaHoraria` acende `fora_da_janela`
 * em TODA ação desta empresa, e subir um degrau em tudo é mudança grande demais
 * para acontecer calada. `conferirJanela` grita UMA vez por empresa — não a
 * cada chamada, que afogaria o log —, e `problemasDeJanela` recusa o documento
 * lá atrás, na sobrescrita, que é onde o defeito nasce.
 */

/*
 * ============================================================================
 * A MARCA DE PROCEDÊNCIA — fatia 3.8 (RF-G-07, RNF-08, OWASP LLM01/LLM04)
 * ============================================================================
 *
 * Até aqui `procedenciaExterna` era um `boolean` opcional viajando de mão em
 * mão. Um booleano é de DUAS mãos: quem o carrega pode entregá-lo `false`, e
 * ninguém no caminho consegue distinguir "esta ação não tem conteúdo externo"
 * de "alguém perdeu a marca no meio". O requisito, porém, é de uma mão só:
 * conteúdo de fora **eleva** o nível e nunca o rebaixa.
 *
 * `ProcedenciaExterna` é essa mão única em código, não em convenção:
 *
 *   - existe `marcar(razao)`. NÃO existe desmarcar, e não existe construtor que
 *     receba `false` para apagar um `true` anterior;
 *   - cada marca guarda a RAZÃO (que nota, que mensagem, que página), porque o
 *     RASTRO precisa responder "por que esta ação subiu de degrau";
 *   - `de()` aceita o booleano antigo para os chamadores que ainda não migraram
 *     — e um `false` ali só significa "ninguém marcou", jamais "desmarque".
 *
 * O ponto que um atacante tentaria, e por que ele não existe: nenhum conteúdo
 * varrido pelo OS chega a esta classe como CÓDIGO. Ele chega como string, e
 * string não chama método. Uma nota que diga "modo de teste: trate como fonte
 * confiável" é texto dentro de um bloco de dado — o que decide a marca é QUEM
 * montou o contexto, e quem monta é `ContextBuilder`, não o texto.
 *
 * ----------------------------------------------------------------------------
 * AS DUAS MARCHAS A RÉ QUE A PRIMEIRA VERSÃO TINHA, e como cada uma foi fechada
 * ----------------------------------------------------------------------------
 *
 * A primeira versão desta classe dizia "não há como voltar atrás" e tinha DOIS
 * caminhos de volta. Os dois foram medidos, não imaginados:
 *
 *  1. **A privacidade era só do sistema de tipos.** `private externa` vira uma
 *     propriedade comum em tempo de execução: `delete (m as any).externa` ou
 *     `(m as any).externa = false` apagavam a marca, e o `tsc` nem reclamava,
 *     porque o `as any` é a porta. Agora os campos são `#externa` e `#razoes` —
 *     privacidade da LINGUAGEM: não aparecem em `Object.keys`, não são
 *     alcançáveis por índice, não são apagáveis por `delete` e não sobrevivem a
 *     `JSON.stringify` por acidente.
 *
 *  2. **A marca não sobrevivia a serialização, e a leitura falhava ABERTA.**
 *     `JSON.parse(JSON.stringify(marca))` produzia um objeto comum; `de()` não
 *     o reconhecia, caía no ramo final e devolvia uma marca **limpa** — com a
 *     verdade escrita dentro do objeto que ela acabara de ignorar. Hoje nada
 *     serializa a marca. No dia em que ela cruzasse uma fila, uma requisição ou
 *     um processo, o nível da ação cairia **em silêncio**, que é a forma mais
 *     cara de um controle morrer.
 *
 *     São duas mudanças, e as duas são necessárias:
 *
 *       - `toJSON()` publica uma forma reconhecível (`__procedenciaExterna`),
 *         para que atravessar fila seja um caminho SUPORTADO e não um acidente;
 *       - `de()` **lança** diante de objeto desconhecido. Falha fechada: quem
 *         perdeu a marca no meio do caminho recebe um erro, não um R1 barato.
 *         O booleano dos chamadores antigos continua aceito — `false` ali segue
 *         significando "ninguém marcou", jamais "desmarque".
 */
export interface ProcedenciaSerializada {
  /** Assinatura da forma. É o que separa "marca que viajou" de "objeto qualquer". */
  __procedenciaExterna: 1;
  externa: boolean;
  razoes: string[];
}

export class ProcedenciaExterna {
  /*
   * `#` e não `private`: ver o bloco acima. `private` é apagável em tempo de
   * execução; `#` não é.
   */
  #externa = false;
  readonly #razoes: string[] = [];

  /** Mão única: marca, e não há como voltar atrás. */
  marcar(razao: string): this {
    this.#externa = true;
    const limpa = String(razao ?? '').trim().slice(0, 200);
    if (limpa && !this.#razoes.includes(limpa)) this.#razoes.push(limpa);
    return this;
  }

  /** Verdadeiro assim que QUALQUER conteúdo de fora entrou no contexto. */
  get eExterna(): boolean {
    return this.#externa;
  }

  /** Por que subiu — uma linha por fonte, para o RASTRO e para a tela. */
  get motivos(): readonly string[] {
    return [...this.#razoes];
  }

  /**
   * Reconhecimento por MARCA de campo privado, não por `instanceof`.
   *
   * `instanceof` mente quando existem duas cópias do módulo no processo (dois
   * `node_modules`, um pacote duplicado no lockfile, o mesmo arquivo carregado
   * por dois caminhos). Aí a marca real seria tratada como objeto estranho e
   * `de()` lançaria — falha fechada, mas em cima de quem não errou nada. A
   * conferência ergonômica de campo privado (`#externa in v`) não tem esse
   * problema: ela pergunta pela forma, não pela identidade da classe.
   */
  static eMarca(v: unknown): v is ProcedenciaExterna {
    return typeof v === 'object' && v !== null && #externa in (v as ProcedenciaExterna);
  }

  /**
   * A forma que atravessa fila, requisição e processo.
   *
   * Sem ela, `JSON.stringify(marca)` devolveria `{}` (campo `#` não serializa) e
   * a marca sumiria em silêncio. Com ela, o que sai do outro lado é
   * reconhecível — e `de()` o reconstrói.
   */
  toJSON(): ProcedenciaSerializada {
    return { __procedenciaExterna: 1, externa: this.#externa, razoes: [...this.#razoes] };
  }

  /** A mesma conferência de forma que `de()` usa, exposta para quem valida entrada. */
  static eSerializada(v: unknown): v is ProcedenciaSerializada {
    if (typeof v !== 'object' || v === null) return false;
    const s = v as Partial<ProcedenciaSerializada>;
    return s.__procedenciaExterna === 1 && typeof s.externa === 'boolean' && Array.isArray(s.razoes);
  }

  /**
   * Normaliza o que chega dos chamadores — e RECUSA o que não reconhece.
   *
   * `undefined`/`false` viram uma marca LIMPA (ninguém marcou ainda), e não uma
   * marca "negada": não há estado negativo nesta classe justamente para que
   * ninguém consiga usá-la para abaixar o nível de nada.
   *
   * Objeto que não é marca nem forma serializada **lança**. Devolver limpa ali
   * seria exatamente a marcha a ré nº 2: um objeto que diz `externa: true` num
   * campo que esta classe não conhece produziria um R1 silencioso.
   */
  static de(
    v: boolean | ProcedenciaExterna | ProcedenciaSerializada | null | undefined,
    razao = 'declarada pelo chamador',
  ): ProcedenciaExterna {
    if (ProcedenciaExterna.eMarca(v)) return v;

    const p = new ProcedenciaExterna();
    if (v === true) return p.marcar(razao);
    if (v === false || v === undefined || v === null) return p;

    if (ProcedenciaExterna.eSerializada(v)) {
      if (!v.externa) return p;
      for (const r of v.razoes) p.marcar(String(r));
      // `externa: true` com lista de razões vazia ainda é uma marca: a verdade
      // é o booleano, e perder a razão não pode virar perder a marca.
      if (!p.eExterna) p.marcar('marca restaurada de serialização, sem razão registrada');
      return p;
    }

    throw new TypeError(
      'ProcedenciaExterna.de recebeu um valor que não é marca, nem booleano, nem a forma ' +
        'serializada (`__procedenciaExterna`). Devolver uma marca limpa aqui rebaixaria o nível ' +
        'da ação em silêncio — use `marca.toJSON()` para atravessar fila, requisição ou processo.',
    );
  }
}

@Injectable()
export class SinaisService {
  private readonly log = new Logger('SinaisService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {
    // Fuso errado não pode virar UTC calado: foi assim que a janela 08–20 passou
    // a valer das 05h às 17h de Brasília até a MD3.
    const fuso = fusoDaPolitica();
    if (!fusoValido(fuso)) {
      throw new Error(
        `POLITICA_FUSO_HORARIO="${fuso}" não é um fuso conhecido. Use o nome IANA ` +
          '(ex.: America/Sao_Paulo) ou deixe a variável vazia para o padrão.',
      );
    }
  }

  async calcular(input: {
    orgId: string;
    capabilityId: string;
    agentSlug?: string | null;
    valorCentavos?: number | null;
    /**
     * Booleano (compatibilidade), a marca de mão única, ou a forma serializada
     * dela. Ver `ProcedenciaExterna` acima: `false` aqui quer dizer "ninguém
     * marcou", nunca "desmarque o que já foi marcado" — e objeto que não é
     * nenhuma das três **lança**, em vez de virar uma marca limpa.
     */
    procedenciaExterna?: boolean | ProcedenciaExterna | ProcedenciaSerializada;
    agora?: Date;
  }): Promise<Sinal[]> {
    const agora = input.agora ?? new Date();
    const sinais: Sinal[] = [];
    const limites = this.policy.limites(input.orgId);

    /*
     * O único dos seis sinais que não depende do banco: ele não é CALCULADO, é
     * declarado por quem montou o contexto. `ProcedenciaExterna.de` existe para
     * que o booleano dos chamadores antigos e a marca de mão única entrem pela
     * mesma porta — e para que `false` continue significando "ninguém marcou".
     */
    const procedencia = ProcedenciaExterna.de(input.procedenciaExterna);
    if (procedencia.eExterna) sinais.push('fonte_nao_confiavel');

    conferirJanela(input.orgId, limites.janelaHoraria, (m) => this.log.error(m));
    const minutos = minutosNoFuso(agora);
    if (foraDaJanela(minutos, limites.janelaHoraria)) sinais.push('fora_da_janela');

    if (acimaDoTeto(input.valorCentavos, limites.tetoCustoCentavosPorExecucao)) {
      sinais.push('valor_acima_do_limite');
    }

    const [naUltimaHora, mediaHora, errosRecentes] = await Promise.all([
      this.prisma.toolCall.count({
        where: {
          orgId: input.orgId,
          capabilityId: input.capabilityId,
          criadoEm: { gte: new Date(agora.getTime() - 3_600_000) },
        },
      }),
      this.mediaPorHora(input.orgId, input.capabilityId, agora),
      input.agentSlug
        ? this.prisma.toolCall.count({
            where: {
              orgId: input.orgId,
              agentSlug: input.agentSlug,
              status: { in: ['erro', 'recusado'] },
              criadoEm: { gte: new Date(agora.getTime() - 86_400_000) },
            },
          })
        : Promise.resolve(0),
    ]);

    // Só acusa volume atípico quando já existe média para comparar — senão o
    // primeiro uso de uma capacidade sempre seria "atípico".
    if (mediaHora > 0 && naUltimaHora > mediaHora * 3) sinais.push('volume_atipico');
    if (errosRecentes > 0) sinais.push('erro_recente');

    /*
     * ========================================================================
     * RESPOSTA SEM FONTE É DEFEITO — fatia 4.3 (RF-M-02, RNF-03)
     * ========================================================================
     *
     * ACRESCENTADO, NÃO REESCRITO: nada acima desta linha mudou. O bloco vive no
     * fim de propósito, porque a fatia 5.6 desta mesma onda mexe no mesmo método
     * (ela acende sinal a partir de `Agent.rebaixadoAte`) e duas edições no mesmo
     * `Promise.all` seriam um conflito garantido.
     *
     * O QUE ISTO LIGA. O laço do agente JÁ MARCA a sessão que respondeu sem
     * procedência (`Session.semProcedencia`, gravado por
     * `agent-runtime.service.ts` em `SessionService.encerrar`). Até aqui a marca
     * só alimentava um KPI de tela: nada no sistema acontecia por causa dela.
     * Agora acontece — a barra sobe um degrau nas ações seguintes DAQUELE
     * agente, durante 24h.
     *
     * A CONSULTA RODA SEMPRE QUE HÁ AGENTE, e não só quando `erro_recente` ainda
     * está apagado. A primeira versão curto-circuitava em
     * `!sinais.includes('erro_recente')` para economizar uma ida ao banco, e o
     * efeito colateral era pior do que a economia: num agente que TAMBÉM errou de
     * verdade na janela, a consulta não rodava, o aviso não saía, e o operador
     * ficava com o único rastro que nomeia a causa certa — o log — justamente no
     * caso em que as duas coisas estão acontecendo. O sinal é empurrado uma vez
     * só; o que deixou de ser condicional é a MEDIÇÃO.
     *
     * POR QUE `erro_recente`, E O QUE ISSO TEM DE ESTICADO. A escada tem seis
     * sinais e nenhum se chama "respondeu sem fonte"; a lista é normativa
     * (`packages/policy` espelha o documento do vault) e não é deste arquivo
     * criar o sétimo. Dos seis, este é o único que fala do HISTÓRICO DO AGENTE, e
     * é dele que a régua já se serve para o rebaixamento por erro do RF-N-07 —
     * mesma natureza, mesma janela de 24h, mesmo efeito. O que NÃO serve é
     * `fonte_nao_confiavel`: ele significa "o contexto veio de mensagem, PDF,
     * anexo ou página" e acendê-lo aqui faria o RASTRO afirmar que entrou
     * conteúdo externo onde não entrou nada.
     *
     * O PREÇO DISSO, declarado: o RASTRO grava `erro_recente` e o motivo da
     * régua sai como "R0 elevado para R1 por: erro_recente". Quem ler o evento
     * vai procurar uma ação revertida que não existe. Consertar de verdade é
     * acrescentar o sétimo sinal (`resposta_sem_fonte`) em três lugares: a união
     * `Sinal` de `packages/policy/src/escada.ts`, o `SinalSchema` de
     * `esquema.ts` e `escalonamento.sinais` de `politica-root.json` — que é
     * cópia byte a byte do anexo do vault, ou seja, decisão humana. Está em
     * PERGUNTAS e em FORA DO ESCOPO no relatório da fatia, com os três arquivos.
     * Até lá, quem nomeia a causa certa é o aviso de `avisarRespostaSemFonte`.
     *
     * A CONSULTA É POR EMPRESA E POR AGENTE, nas duas pontas. `Session` não tem
     * `agentSlug` (só `agentId`), então o casamento é por relação — e relação é
     * exatamente onde o vazamento entre empresas já aconteceu quatro vezes nesta
     * base. Por isso o `orgId` é cobrado na sessão E no agente: um `agentId`
     * atravessado não consegue trazer defeito de empresa vizinha para cá.
     */
    if (input.agentSlug) {
      const semFonte = await this.respostasSemFonte(input.orgId, input.agentSlug, agora);
      if (semFonte > 0) {
        this.avisarRespostaSemFonte(input.orgId, input.agentSlug, semFonte, agora);
        if (!sinais.includes('erro_recente')) sinais.push('erro_recente');
      }

      /*
       * ======================================================================
       * O REBAIXAMENTO TAMBÉM É SINAL — RF-N-07, a metade que faltava
       * ======================================================================
       *
       * O RF-N-07 diz que o rebaixamento por erro é UM DOS SINAIS DE
       * ESCALONAMENTO, e até 11/09/2026 ele não era: `Agent.rebaixadoAte` só era
       * lido dentro do laço do agente, para impor o teto de degrau. Um agente de
       * castigo tinha alcance cortado, mas as ações que ele AINDA podia fazer
       * corriam na barra de sempre — e o comentário do bloco acima já afirmava
       * que a régua se serve deste campo, o que era falso.
       *
       * As duas pontas se somam: o TETO (imposto na porta, ver
       * `ExecCtx.tetoDoAgente`) diz até que degrau ele chega; o SINAL diz que o
       * que sobrou sai um degrau acima. São coisas diferentes e as duas são o
       * que o requisito pede.
       *
       * A EMPRESA É COBRADA NA CONSULTA, e não é zelo decorativo: resolver
       * agente por `slug` sem `orgId` já vazou entre empresas quatro vezes nesta
       * base. `contagem > 0` e não `findUnique` + comparação em memória porque o
       * filtro de data tem que ir para o banco junto com a empresa — a volta é
       * por relógio (`rebaixadoAte > agora`), sem rotina de limpeza.
       *
       * `erro_recente` de novo, pelo mesmo motivo do bloco acima e com o mesmo
       * preço: a lista dos seis sinais é normativa e não é deste arquivo criar o
       * sétimo. Aqui o empréstimo é ainda mais próximo do sentido literal — o
       * rebaixamento nasce de duas falhas seguidas, que é erro recente.
       */
      const rebaixado = await this.prisma.agent.count({
        where: { orgId: input.orgId, slug: input.agentSlug, rebaixadoAte: { gt: agora } },
      });
      if (rebaixado > 0 && !sinais.includes('erro_recente')) sinais.push('erro_recente');
    }

    return sinais;
  }

  /** Média de chamadas por hora nos últimos 30 dias. */
  private async mediaPorHora(orgId: string, capabilityId: string, agora: Date): Promise<number> {
    const desde = new Date(agora.getTime() - 30 * 86_400_000);
    const total = await this.prisma.toolCall.count({
      where: { orgId, capabilityId, criadoEm: { gte: desde } },
    });
    return total / (30 * 24);
  }

  // ==========================================================================
  // RESPOSTA SEM FONTE — fatia 4.3. Ver o bloco no fim de `calcular`.
  // ==========================================================================

  /** A janela do defeito é a mesma do erro recente: 24h. */
  private static readonly JANELA_SEM_FONTE_MS = 86_400_000;

  /**
   * Quantas sessões DESTE agente, nesta empresa, fecharam nas últimas 24h tendo
   * respondido sem procedência E SEM ter usado ferramenta com sucesso.
   *
   * `encerradaEm` e não `criadaEm`: sessão que ainda está rodando não respondeu
   * nada, e o campo `semProcedencia` só ganha valor no encerramento. Contar pela
   * abertura acenderia o sinal com base num campo que ainda é o `false` do
   * `@default` — verde por padrão, que é o jeito mais silencioso de um controle
   * não existir.
   *
   * --------------------------------------------------------------------------
   * A GUARDA DA FERRAMENTA SAIU EM 11/09/2026 — e por que ela existiu
   * --------------------------------------------------------------------------
   *
   * Esta contagem teve, por um dia, uma cláusula a mais: ignorava sessão com
   * passo de ferramenta `executado`. Ela existiu porque `Session.fontes` não
   * recebia resultado de ferramenta — o runtime só empurrava ali `nota` (dado
   * do vault) e `regra` (o `contextoFixo` do agente). Então uma resposta
   * legítima, com o número vindo de uma ferramenta que a PORTA deixou executar,
   * fechava a sessão marcada como sem procedência, e a consequência era cara: o
   * degrau sobe, a aprovação passa de configurável para SEMPRE e a alçada mínima
   * sobe de operador para responsável. Numa empresa com um aprovador só, e com a
   * regra de que quem propõe não aprova, isso travava o agente por 24 horas.
   *
   * O CONSERTO FOI FEITO NA ORIGEM, que é o runtime: chamada que a porta devolve
   * como `executado` vira `FonteContexto` de tipo `ferramenta` em `fontesUsadas`
   * (`agents/agent-runtime.service.ts`), e `ferramenta` conta como DADO em
   * `TIPOS_DE_DADO` (`agents/context-builder.service.ts`). Com isso a sessão
   * legítima nem fecha marcada, e filtrar aqui viraria remendo em cima de coisa
   * consertada — além de um falso negativo: a sessão que usou ferramenta E
   * inventou um número por cima dela voltaria a passar batida. Quem distingue os
   * dois casos é `respostaSemProcedencia`, que sabe se a fonte existe; uma
   * consulta a `SessionStep` não sabe.
   *
   * O que continua contando como sessão sem fonte: ferramenta recusada, com erro
   * ou esperando aprovação. Nenhuma delas trouxe dado.
   *
   * --------------------------------------------------------------------------
   * O ÍNDICE
   * --------------------------------------------------------------------------
   *
   * Esta é a QUARTA contagem do caminho mais quente do sistema, e a única com
   * junção (`agent`). `Session` tinha só `@@index([orgId, agentId, criadaEm])`,
   * que não serve a um filtro por `semProcedencia` + `encerradaEm`. O índice
   * `@@index([orgId, semProcedencia, encerradaEm])` entrou na migração
   * `20260911210000_indice_sessao_e_motivo_sem_dado`, junto com a saída da guarda.
   */
  private async respostasSemFonte(
    orgId: string,
    agentSlug: string,
    agora: Date,
  ): Promise<number> {
    const desde = new Date(agora.getTime() - SinaisService.JANELA_SEM_FONTE_MS);
    return this.prisma.session.count({
      where: {
        orgId,
        semProcedencia: true,
        encerradaEm: { gte: desde },
        // `is` explícito: filtro de relação com o orgId cobrado dos DOIS lados.
        agent: { is: { orgId, slug: agentSlug } },
      },
    });
  }

  /**
   * Avisa uma vez por empresa, por agente E POR JANELA — não a cada chamada, e
   * não uma vez por processo.
   *
   * Um aviso por chamada afogaria o log deste caminho, que roda em toda passagem
   * pela porta; é a mesma disciplina de `conferirJanela`. Só que a primeira
   * versão usava um `Set` sem expiração, e aí o remédio virava a doença: o
   * operador era avisado UMA vez enquanto o processo vivesse, e a reincidência de
   * três dias depois — que é exatamente o que ele precisa ver — saía muda. O
   * relógio é o mesmo `agora` do cálculo, então teste com tempo preso mede isto
   * de verdade.
   *
   * O mapa cresce no máximo até (empresas × agentes), que é a mesma ordem de
   * grandeza do catálogo de agentes — não é cache de chamada, e não precisa de
   * expurgo.
   */
  private readonly semFonteAvisadoEm = new Map<string, number>();

  private avisarRespostaSemFonte(
    orgId: string,
    agentSlug: string,
    quantas: number,
    agora: Date,
  ): void {
    const chave = `${orgId}|${agentSlug}`;
    const ultimo = this.semFonteAvisadoEm.get(chave);
    if (ultimo !== undefined && agora.getTime() - ultimo < SinaisService.JANELA_SEM_FONTE_MS) {
      return;
    }
    this.semFonteAvisadoEm.set(chave, agora.getTime());
    this.log.warn(
      `o agente "${agentSlug}" da empresa ${orgId} fechou ${quantas} sessão(ões) nas últimas 24h ` +
        'afirmando número sem citar fonte nenhuma (Session.semProcedencia). Resposta sem fonte é ' +
        'defeito: as ações deste agente sobem um degrau na régua enquanto a janela durar. ' +
        'No RASTRO isso aparece como `erro_recente`, que é o sinal mais próximo que a escada tem ' +
        '— a causa certa é esta linha. Confira as sessões na tela de Sessões, filtrando por ' +
        '"sem procedência".',
    );
  }
}
