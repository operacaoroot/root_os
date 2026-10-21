import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MemoriaDeResolucao } from '../common/tenant-publico';
import {
  type ConectorDoContrato,
  type ContextoDoVerbo,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  type VerboDoContrato,
  carimbarMedicao,
  erroDeConector,
  frasedoErro,
  naoVerificado,
  normalizarSaude,
} from './contrato-de-conector';

/**
 * Os conectores que TÊM de implementar o contrato — a lista cobrada no arranque.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ESTA LISTA É CURTA, E POR QUE O CONECTOR FICTÍCIO NÃO ESTÁ NELA
 * ----------------------------------------------------------------------------
 * A lista existe pelo mesmo motivo da do registro irmão
 * (`gateway/conectores-configurados.registry.ts`): um conector que esqueça a
 * linha de inscrição some do contrato EM SILÊNCIO — a tela volta a derivar
 * estado de variável de ambiente, que é a mentira que esta fatia veio matar, e
 * nada no log avisa.
 *
 * E ela é a razão de o conector fictício da suíte morar em `test/` e NUNCA
 * aparecer aqui. Um conector de teste inscrito na lista cobrada passa a ser
 * OBRIGATÓRIO em produção: o dia em que o artefato de teste não for empacotado
 * (que é todo dia, porque `test/` fica fora do `tsconfig.json` de build), a API
 * não sobe. A prova de que "conector novo entra sem tocar no núcleo" é ele se
 * registrar em tempo de teste e aparecer no catálogo — não estar nesta lista.
 *
 * Seis chaves desde a MD10, e elas são UNIDADES DE CREDENCIAL, não superfícies: `google`
 * cobre gmail/gcal/gdocs/drive, `meta` cobre instagram.
 */
const DEVEM_IMPLEMENTAR: ReadonlyArray<{ chave: string; servico: string }> = [
  { chave: 'google', servico: 'GoogleService' },
  { chave: 'meta', servico: 'MetaService' },
  { chave: 'obsidian', servico: 'ObsidianService' },
  { chave: 'clickup', servico: 'ClickupService' },
  { chave: 'whatsapp', servico: 'EvolutionService' },
  // MD10: o canal do YouTube, credencial por empresa num projeto próprio do Google Cloud.
  { chave: 'youtube', servico: 'YoutubeService' },
  // 19/10/2026: reuniões do Granola pelo Zap; senha por empresa no cofre.
  { chave: 'granola', servico: 'GranolaService' },
  // Produção 21 (P8): o WhatsApp do comercial pela Evolution; endereço, chave e instância por empresa no cofre.
  { chave: 'evolution', servico: 'EvolutionDaEmpresaService' },
];

/** A lista cobrada, para a suíte poder afirmar sobre ela. */
export const CONECTORES_DO_CONTRATO: readonly string[] = DEVEM_IMPLEMENTAR.map((c) => c.chave);

/**
 * Quanto tempo uma sonda de saúde pode demorar antes de o registro desistir.
 *
 * Seis segundos, e o número tem uma conta atrás: a tela de Conexões sonda TODOS
 * os conectores de uma vez, em paralelo, e quem abre essa tela costuma estar
 * diagnosticando um conector que caiu — isto é, esperando justamente o que vai
 * estourar o prazo. Prazo longo transforma a tela de diagnóstico na vítima do
 * problema que ela deveria mostrar.
 *
 * O corte acontece em DOIS lugares de propósito: cada conector põe um limite no
 * `AbortSignal` do `fetch` dele (para a conexão de fato morrer) e o registro
 * corre contra o relógio por fora (para um conector que ignore o sinal, ou que
 * trave antes do `fetch`, não segurar a tela mesmo assim). Sem o segundo, um
 * `while(true)` num conector derrubaria a página inteira — que é exatamente o
 * contrário da degradação que a fatia promete.
 */
export const TEMPO_LIMITE_DE_SONDA_MS = 6_000;

/**
 * O prazo de DENTRO: o que cada conector põe no `AbortSignal` do `fetch` dele.
 *
 * ----------------------------------------------------------------------------
 * ELE É MENOR QUE O DE FORA, E A MARGEM É O PONTO
 * ----------------------------------------------------------------------------
 * A primeira versão desta fatia usou o MESMO número nos dois lados, e com isso
 * inverteu o corte que pretendia fazer. O relógio de fora começa a contar quando
 * o registro chama `conector.saude(...)`; o de dentro só é armado quando o
 * `fetch` sai — e, no Google e na Meta, entre uma coisa e outra há uma CONSULTA
 * AO BANCO (a linha de autorização desta empresa). Com os dois no mesmo prazo,
 * quem vence é sempre o de fora, e a tela mostra "a sonda de saúde de 'google'
 * passou de 6000 ms sem resposta" — genérico — em vez da frase do conector, que
 * é a que diz o que fazer ("a autorização desta empresa foi revogada do lado do
 * Google… é preciso conectar de novo").
 *
 * Mil e quinhentos milissegundos de folga: sobra para a consulta ao banco e para
 * a montagem da resposta, e ainda mantém a tela de diagnóstico dentro dos seis
 * segundos.
 */
export const PRAZO_DA_CHAMADA_DE_SONDA_MS = TEMPO_LIMITE_DE_SONDA_MS - 1_500;

/**
 * Quanto tempo uma sonda vale antes de ser refeita.
 *
 * ----------------------------------------------------------------------------
 * POR QUE GUARDAR, DEPOIS DE ESTA FATIA TER PROMETIDO "SONDA DE VERDADE"
 * ----------------------------------------------------------------------------
 * Porque as duas coisas não se contradizem: a resposta CARREGA quando foi
 * apurada (`verificadoEm`) e a tela IMPRIME esse horário. Guardar por pouco
 * tempo é honesto por construção — a desonestidade seria esconder a idade, e
 * ninguém aqui esconde.
 *
 * E o custo sem memória é real, medido na própria tela: ela recarrega o catálogo
 * inteiro DEPOIS DE CADA AÇÃO (autorizar, sincronizar, desligar, religar,
 * revogar), e cada recarga paga cinco chamadas externas. Pior: a rota de sonda
 * sob demanda exige `dashboard.ver` — a permissão mais fraca que existe — então
 * qualquer usuário de qualquer empresa conseguia disparar, sem limite nenhum,
 * chamadas contra credenciais DO PROCESSO (ClickUp, Evolution), que são
 * compartilhadas por todas as empresas e têm cota de verdade do outro lado.
 *
 * Trinta segundos: menos que o tempo de alguém ler a tela e clicar de novo, e
 * mais que o suficiente para que um F5 nervoso não vire uma rajada. O que muda o
 * estado (os quatro verbos, o desligamento e o retorno do OAuth) ESQUECE a linha
 * na hora — ver `esquecer` —, então nunca se vê o estado de antes de uma ação
 * que acabou de acontecer.
 */
export const VALIDADE_DA_SONDA_MS = 30_000;

/** Quantas (empresa × conector) cabem na memória antes de ela ser esvaziada. */
const TETO_DA_MEMORIA_DE_SAUDE = 500;

/** Quanto tempo um verbo de ação (autorizar/sincronizar/revogar) pode demorar. */
export const TEMPO_LIMITE_DE_VERBO_MS = 60_000;

/** Conector que não existe no contrato. 400, não 500: quase sempre é erro de chave. */
export class ConectorForaDoContratoError extends BadRequestException {
  constructor(chave: string, conhecidos: string[]) {
    super(
      `Nenhum conector do contrato responde por "${chave}". ` +
        `Conectores inscritos: ${conhecidos.length ? conhecidos.join(', ') : '(nenhum)'}.`,
    );
    this.name = 'ConectorForaDoContratoError';
  }
}

/**
 * ============================================================================
 * O REGISTRO DO CONTRATO DE CONECTOR — RF-X-01, RF-X-06
 * ============================================================================
 *
 * POR QUE UM REGISTRO, e não a tela importar os conectores. Exatamente o mesmo
 * motivo dos dois registros da pasta da porta: a catraca de arquitetura
 * (`test/arquitetura.test.ts`, frente 1) proíbe qualquer arquivo fora de
 * `src/gateway/` de importar um serviço de conector — e proíbe re-exportar,
 * para a proibição não ter atalho. Se `integrations.service.ts` importasse
 * `GoogleService` e `MetaService` para perguntar da saúde deles, o contrato
 * único nasceria violando a regra que ele existe para servir.
 *
 * A dependência se inverte: cada conector se INSCREVE no arranque, dentro do
 * `onModuleInit` dele, e o registro é consultado por chave. É a mesma direção do
 * `EfeitosRegistry` — conector conhece o registro, registro não conhece conector.
 *
 * ----------------------------------------------------------------------------
 * DEGRADAÇÃO: UM CONECTOR FORA DO AR DEGRADA SÓ O QUE DEPENDE DELE
 * ----------------------------------------------------------------------------
 * É aqui que essa promessa é cumprida, e ela tem quatro camadas:
 *
 *  1. cada sonda roda ISOLADA (`try/catch` próprio). Exceção de um conector vira
 *     `erro` com a mensagem real DELE, e não uma resposta 500 da tela;
 *  2. cada sonda corre contra o relógio. Conector pendurado vira `erro` de
 *     tempo esgotado, não uma página que nunca carrega;
 *  3. as sondas rodam em PARALELO. Sequencial, um conector lento somaria o prazo
 *     dele ao de todos os outros — a degradação "só do que depende dele" viraria
 *     "de todo mundo que veio depois na fila";
 *  4. o resultado é REUNIDO com `Promise.allSettled`. `all` rejeita no primeiro
 *     problema e derrubaria as outras linhas junto — a tela de diagnóstico
 *     inteira viraria erro no dia em que uma sonda rejeitasse. As sondas de hoje
 *     não rejeitam (o `catch` é interno), mas contar com isso é pendurar a
 *     degradação num detalhe de implementação de outra função. A primeira versão
 *     desta fatia escreveu este parágrafo e usou `all` mesmo assim.
 */
@Injectable()
export class RegistroDeConectores implements OnApplicationBootstrap {
  private readonly log = new Logger('ContratoDeConector');
  private readonly conectores = new Map<string, ConectorDoContrato>();
  /** Quem inscreveu cada chave. Só existe para a mensagem da catraca. */
  private readonly dono = new Map<string, string>();

  /**
   * A MEMÓRIA CURTA DAS SONDAS — por (empresa × conector). Ver
   * `VALIDADE_DA_SONDA_MS`.
   *
   * A classe vem de `common/tenant-publico.ts` e é a MESMA que as resoluções
   * públicas usam: prazo, teto e esvaziamento já estavam escritos e testados
   * lá, e uma segunda implementação da mesma ideia é como uma delas envelhece
   * sem ninguém notar. Aqui não há resposta "negativa" para durar menos que a
   * positiva — erro de conector é justamente o que se quer parar de repetir a
   * cada F5 —, então os dois prazos são iguais.
   */
  private readonly memoria = new MemoriaDeResolucao<SaudeDeConector>({
    validadeMs: VALIDADE_DA_SONDA_MS,
    validadeNegativaMs: VALIDADE_DA_SONDA_MS,
    teto: TETO_DA_MEMORIA_DE_SAUDE,
  });

  /**
   * Um conector declara que implementa o contrato.
   *
   * ------------------------------------------------------------------------
   * A CATRACA DE DONO — reinscrição é ERRO, não "a última vence"
   * ------------------------------------------------------------------------
   * Cópia deliberada do `EfeitosRegistry`, pelo mesmo raciocínio: dois serviços
   * respondendo pela mesma chave de conector quer dizer que a tela mostra a
   * saúde de um e o botão "revogar" queima a credencial do outro. Silenciosa,
   * essa colisão só apareceria no dia em que alguém clicasse.
   *
   * LANÇA no arranque, e derrubar a API é o comportamento desejado: colisão de
   * chave é sempre erro de programação, e o lugar de descobrir isso é o boot.
   */
  registrar(conector: ConectorDoContrato, quem = 'serviço não identificado'): void {
    const chave = conector.chave;
    const jaTem = this.dono.get(chave);
    if (jaTem) {
      throw new Error(
        `Dois serviços se inscreveram como o conector "${chave}" no contrato: ` +
          `"${jaTem}" e "${quem}". A tela mostraria a saúde de um e o botão de revogar ` +
          'queimaria a credencial do outro. Uma chave, um dono.',
      );
    }
    /*
     * A SEGUNDA METADE DA MESMA CATRACA: duas chaves diferentes reivindicando a
     * MESMA LINHA do catálogo.
     *
     * A primeira metade (acima) pega a colisão óbvia — dois serviços com a mesma
     * chave. Esta pega a colisão que passa despercebida: o conector `meta`
     * declarando `instagram`, e um conector novo declarando `instagram` também.
     * Nenhum dos dois erra a própria chave, `donoDaLinha` devolve o primeiro que
     * achar, e a tela passa a mostrar a saúde de um enquanto o botão de revogar
     * queima a credencial do outro — exatamente o estrago da outra catraca,
     * chegando por outro caminho.
     */
    for (const linha of conector.linhasDoCatalogo ?? []) {
      const outro = this.donoDaLinha(linha);
      if (outro) {
        throw new Error(
          `O conector "${chave}" (${quem}) declara a linha de catálogo "${linha}", que já é ` +
            `respondida por "${outro.chave}". Uma linha da tela de Conexões tem um dono só: ` +
            'com dois, a saúde mostrada é a de um e o botão de revogar queima a credencial do ' +
            'outro.',
        );
      }
    }

    this.conectores.set(chave, conector);
    this.dono.set(chave, quem);
    this.log.log(`conector "${chave}" implementa o contrato (por ${quem})`);
  }

  /**
   * A ASSERÇÃO DE ARRANQUE — quem está na lista cobrada TEM de se inscrever.
   *
   * `onApplicationBootstrap` e não `onModuleInit`: este registro mora num módulo
   * `@Global`, que inicializa ANTES dos módulos que se inscrevem. Conferir cedo
   * demais daria falso positivo — é a mesma pegadinha que os dois registros da
   * porta já documentam.
   */
  onApplicationBootstrap(): void {
    const faltando = DEVEM_IMPLEMENTAR.filter((c) => !this.conectores.has(c.chave));
    if (!faltando.length) return;
    throw new Error(
      'A aplicação subiu com conector(es) sem contrato no RegistroDeConectores: ' +
        faltando.map((c) => `"${c.chave}" (${c.servico})`).join(', ') +
        '. A tela de Conexões perderia a saúde POR EMPRESA desses conectores e voltaria a ' +
        'derivar estado de variável de ambiente — que é verdadeira em produção para todo ' +
        'mundo e faria a tela dizer "conectado" para empresa que nunca autorizou nada ' +
        '(RF-X-02). Conserto: uma linha `this.conectores.registrar({...}, "<Servico>")` no ' +
        'onModuleInit do conector.',
    );
  }

  /** As chaves inscritas, ordenadas. Serve à suíte e ao log. */
  get inscritos(): string[] {
    return [...this.conectores.keys()].sort();
  }

  listar(): ConectorDoContrato[] {
    return [...this.conectores.values()].sort((a, b) => a.chave.localeCompare(b.chave));
  }

  obter(chave: string): ConectorDoContrato | null {
    return this.conectores.get(chave) ?? null;
  }

  exigir(chave: string): ConectorDoContrato {
    const c = this.obter(chave);
    if (!c) throw new ConectorForaDoContratoError(chave, this.inscritos);
    return c;
  }

  /**
   * Qual conector do contrato responde por uma LINHA do catálogo de conexões.
   *
   * `gmail` → o conector `google`; `instagram` → o conector `meta`. A tradução
   * mora aqui, e não numa tabela paralela, porque quem sabe quais superfícies
   * cobre é o próprio conector (`linhasDoCatalogo`). Uma tabela ao lado
   * envelheceria em silêncio no dia em que um conector ganhasse superfície nova.
   */
  donoDaLinha(chaveDaLinha: string): ConectorDoContrato | null {
    for (const c of this.conectores.values()) {
      if (c.chave === chaveDaLinha) return c;
      if ((c.linhasDoCatalogo ?? []).includes(chaveDaLinha)) return c;
    }
    return null;
  }

  /**
   * As linhas do catálogo que este registro cobre — para a tela saber quais
   * chaves já têm dono e quais precisam de linha montada.
   */
  linhasCobertas(): Set<string> {
    const saida = new Set<string>();
    for (const c of this.conectores.values()) {
      const linhas = c.linhasDoCatalogo?.length ? c.linhasDoCatalogo : [c.chave];
      for (const l of linhas) saida.add(l);
    }
    return saida;
  }

  /**
   * Esquece a sonda guardada. `chave` ausente esquece a empresa inteira.
   *
   * Chamado por tudo o que MUDA o estado da ligação — os quatro verbos, o
   * desligamento, o religamento e o retorno do OAuth. É o que mantém a memória
   * curta honesta: ela só devolve estado velho enquanto nada aconteceu; assim
   * que algo acontece, a próxima leitura mede de novo.
   *
   * A memória é um `Map` sem varredura por prefixo, então esquecer "a empresa
   * inteira" é percorrer os conectores inscritos e apagar um por um — são cinco,
   * e o custo é irrelevante perto de uma chamada externa.
   */
  esquecer(orgId: string, chave?: string): void {
    if (chave) {
      this.memoria.guardar(this.chaveDaMemoria(orgId, chave), null, 0);
      return;
    }
    for (const c of this.conectores.keys()) {
      this.memoria.guardar(this.chaveDaMemoria(orgId, c), null, 0);
    }
  }

  private chaveDaMemoria(orgId: string, chave: string): string {
    return `${orgId} ${chave}`;
  }

  /**
   * SONDA a saúde de um conector. NUNCA lança e NUNCA demora mais que o prazo.
   *
   * `desligadoPorque`, quando presente, IMPEDE a sonda. E a decisão tem nome:
   * desligar um conector é mandar o OS parar de usá-lo AGORA — sondar a saúde é
   * sair da casa, e sair da casa depois de alguém ter mandado parar é
   * exatamente o que o botão de emergência existe para impedir. O preço é a tela
   * não saber a saúde de um conector desligado, e é o preço certo: a resposta
   * vira `nao_verificado`, com o motivo escrito, e não um verde inventado.
   *
   * `motivoDeNaoSondar` é OUTRA COISA e por isso é outro campo: ele é o "não
   * perguntei porque não me pediram" (a lista pedida com `sondar=0`). Enquanto
   * os dois compartilhavam o mesmo campo, quem só queria a lista recebia, numa
   * tela de diagnóstico, a instrução de RELIGAR um conector que ninguém tinha
   * desligado.
   */
  async sondar(entrada: {
    orgId: string;
    chave: string;
    desligadoPorque?: string | null;
    /** Ver acima: dispensa de sonda que NÃO é desligamento. */
    motivoDeNaoSondar?: string | null;
    /**
     * O prazo desta sonda. Padrão: `TEMPO_LIMITE_DE_SONDA_MS`.
     *
     * Existe porque a prova de que "um conector pendurado não segura os outros"
     * é, por definição, um conector que nunca responde — e esperar seis segundos
     * por ele em cada execução da suíte é o tipo de custo que faz alguém apagar
     * o teste. Com o prazo como parâmetro, a mesma lógica é exercitada em
     * milissegundos. Nenhum chamador de produção o informa.
     */
    prazoMs?: number;
    /** Ignora a memória curta e mede agora. Ver `VALIDADE_DA_SONDA_MS`. */
    semMemoria?: boolean;
  }): Promise<SaudeDeConector> {
    const conector = this.obter(entrada.chave);
    if (!conector) {
      return erroDeConector(
        `Nenhum conector do contrato responde por "${entrada.chave}" — não há o que sondar.`,
      );
    }

    if (entrada.desligadoPorque) {
      return naoVerificado(
        `${entrada.desligadoPorque} Nada foi chamado: sondar a saúde sairia da casa, e o ` +
          'desligamento existe justamente para isso não acontecer. Religue em Conexões para ' +
          'voltar a medir.',
      );
    }

    if (entrada.motivoDeNaoSondar) {
      return naoVerificado(entrada.motivoDeNaoSondar);
    }

    /*
     * A MEMÓRIA CURTA. Devolve a sonda de até trinta segundos atrás TAL E QUAL —
     * inclusive o `verificadoEm` dela, que é o que faz a tela mostrar a idade
     * verdadeira do verde em vez de fingir que ele acabou de ser medido.
     */
    const naMemoria = entrada.semMemoria
      ? { lembrada: false as const }
      : this.memoria.lembrar(this.chaveDaMemoria(entrada.orgId, entrada.chave));
    if (naMemoria.lembrada && naMemoria.valor) return naMemoria.valor;

    const prazo = entrada.prazoMs ?? TEMPO_LIMITE_DE_SONDA_MS;
    const comecou = Date.now();
    try {
      const saude = await this.comPrazo(
        conector.saude({ orgId: entrada.orgId }),
        prazo,
        `a sonda de saúde de "${entrada.chave}" passou de ${prazo} ms sem resposta.`,
      );
      /*
       * CARIMBA A MEDIÇÃO ANTES DE NORMALIZAR, e a ordem importa: o carimbo põe
       * o tempo REAL da sonda (o relógio é deste registro, não do conector) e a
       * catraca então julga um número que ninguém pôde escolher. Invertido, a
       * catraca julgaria a latência declarada e o carimbo consertaria o número
       * de um verde que já tinha passado.
       */
      const medida = carimbarMedicao(saude, Date.now() - comecou);
      const normalizada = normalizarSaude(medida);
      this.memoria.guardar(this.chaveDaMemoria(entrada.orgId, entrada.chave), normalizada);
      if (normalizada.estado === 'erro' && saude.estado === 'conectado') {
        // Rebaixamento por luz verde sem sonda. Grita: é defeito de programação
        // do conector, não um fornecedor fora do ar.
        this.log.error(
          `[contrato] "${entrada.chave}" devolveu "conectado" sem tentativa. ` +
            'Verde só nasce de sonda contra a dependência real (RF-X-02).',
        );
      }
      return normalizada;
    } catch (e) {
      /*
       * O conector estourou (ou passou do prazo). Isto é `erro` com a MENSAGEM
       * REAL — nunca um rótulo genérico, e nunca um 500 da tela. A latência
       * entra porque houve tentativa: é o que distingue "tentei e falhou" de
       * "nem tentei", e é a diferença que a tela precisa mostrar.
       */
      const mensagem = frasedoErro(e);
      this.log.warn(`[contrato] saúde de "${entrada.chave}" falhou: ${mensagem}`);
      const falha = erroDeConector(mensagem, Date.now() - comecou);
      /*
       * FALHA TAMBÉM É GUARDADA, e de propósito. É o caso em que a memória curta
       * mais rende: conector fora do ar é o que a tela fica recarregando, e
       * repetir a chamada que já falhou cinco vezes por minuto só empilha
       * espera. Trinta segundos depois ela é refeita sozinha.
       */
      this.memoria.guardar(this.chaveDaMemoria(entrada.orgId, entrada.chave), falha);
      return falha;
    }
  }

  /**
   * Sonda VÁRIOS conectores de uma vez, em paralelo e isolados.
   *
   * É a função que faz a promessa de degradação valer na tela: um conector fora
   * do ar marca só a linha dele, e as outras respondem normalmente.
   *
   * `allSettled` E NÃO `all` — o cabeçalho desta classe promete isto em três
   * linhas, e a primeira versão usava `all` mesmo assim. `all` REJEITA no
   * primeiro problema: no dia em que uma sonda rejeitasse (um `throw` antes do
   * `try` interno, um conector que devolvesse algo que não é promessa), a tela
   * de diagnóstico inteira viraria erro — justamente a tela que existe para
   * mostrar QUAL conector caiu. Que hoje nenhuma sonda rejeite não é argumento:
   * é pendurar a degradação num detalhe de implementação de outra função.
   */
  async sondarVarios(
    entradas: ReadonlyArray<{
      orgId: string;
      chave: string;
      desligadoPorque?: string | null;
      motivoDeNaoSondar?: string | null;
      prazoMs?: number;
      semMemoria?: boolean;
    }>,
  ): Promise<Map<string, SaudeDeConector>> {
    const acertos = await Promise.allSettled(entradas.map((e) => this.sondar(e)));
    const saida = new Map<string, SaudeDeConector>();
    acertos.forEach((r, i) => {
      const chave = entradas[i].chave;
      if (r.status === 'fulfilled') {
        saida.set(chave, r.value);
        return;
      }
      // Chegar aqui é defeito de programação — `sondar` não deveria rejeitar.
      // Vira a cor daquela linha, com a mensagem real, e as outras seguem.
      const mensagem = frasedoErro(r.reason);
      this.log.error(
        `[contrato] a sonda de "${chave}" REJEITOU em vez de devolver erro: ${mensagem}. ` +
          'As outras linhas não foram afetadas.',
      );
      saida.set(chave, erroDeConector(mensagem));
    });
    return saida;
  }

  // ------------------------------------------------------------------- verbos

  /*
   * OS TRÊS VERBOS DE AÇÃO ESQUECEM A SONDA GUARDADA, sempre — inclusive quando
   * falham. Um `revogar` que estoure no meio pode já ter queimado metade do que
   * ia queimar, e devolver o verde de antes seria mostrar um estado que não
   * existe mais. Esquecer custa uma sonda; não esquecer custa uma mentira.
   */

  async autorizar(chave: string, ctx: ContextoDoVerbo): Promise<ResultadoDeAutorizacao> {
    const c = this.exigir(chave);
    try {
      return await this.comPrazoDoVerbo('autorizar', chave, c.autorizar({ ...ctx }));
    } finally {
      this.esquecer(ctx.orgId, chave);
    }
  }

  async sincronizar(chave: string, ctx: ContextoDoVerbo): Promise<ResultadoDeSincronizacao> {
    const c = this.exigir(chave);
    try {
      return await this.comPrazoDoVerbo('sincronizar', chave, c.sincronizar({ ...ctx }));
    } finally {
      this.esquecer(ctx.orgId, chave);
    }
  }

  async revogar(
    chave: string,
    ctx: ContextoDoVerbo & { motivo?: string | null },
  ): Promise<ResultadoDeRevogacao> {
    const c = this.exigir(chave);
    try {
      return await this.comPrazoDoVerbo('revogar', chave, c.revogar({ ...ctx }));
    } finally {
      this.esquecer(ctx.orgId, chave);
    }
  }

  /**
   * Os verbos de AÇÃO deixam o erro subir, ao contrário da sonda.
   *
   * A assimetria é deliberada. A sonda é uma pergunta feita sobre dezesseis
   * linhas ao mesmo tempo: lá, exceção tem de virar cor de uma linha. O verbo é
   * um clique numa linha só: quem clicou precisa ver a falha com a mensagem do
   * fornecedor, no lugar onde clicou, e não um "ok" com a ação não realizada.
   *
   * O prazo, esse, vale nos dois: um conector pendurado num `sincronizar`
   * prenderia a requisição HTTP até o proxy desistir, sem nada dizer por quê.
   */
  private async comPrazoDoVerbo<T>(
    verbo: VerboDoContrato,
    chave: string,
    promessa: Promise<T>,
  ): Promise<T> {
    return this.comPrazo(
      promessa,
      TEMPO_LIMITE_DE_VERBO_MS,
      `"${verbo}" de "${chave}" passou de ${Math.round(TEMPO_LIMITE_DE_VERBO_MS / 1000)}s ` +
        'sem resposta do fornecedor.',
    );
  }

  /**
   * Corre contra o relógio.
   *
   * O temporizador é LIMPO nos dois desfechos, e `unref()` para não segurar o
   * processo de pé no encerramento. Sem o `clearTimeout`, um catálogo com cinco
   * conectores deixaria cinco timers de seis segundos pendurados a cada abertura
   * da tela — invisível, e suficiente para atrasar o desligamento do processo.
   */
  private comPrazo<T>(promessa: Promise<T>, ms: number, mensagem: string): Promise<T> {
    let relogio: ReturnType<typeof setTimeout> | null = null;
    const estouro = new Promise<never>((_, rejeitar) => {
      relogio = setTimeout(() => rejeitar(new ServiceUnavailableException(mensagem)), ms);
      relogio.unref?.();
    });
    return Promise.race([promessa, estouro]).finally(() => {
      if (relogio) clearTimeout(relogio);
    }) as Promise<T>;
  }
}
