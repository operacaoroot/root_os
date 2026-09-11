import { Injectable, Logger } from '@nestjs/common';
import type { Sinal } from '@mktos/policy';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from './policy.service';
import { acimaDoTeto, conferirJanela, foraDaJanela } from './limites';

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
  ) {}

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
    const minutos = agora.getHours() * 60 + agora.getMinutes();
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
}
