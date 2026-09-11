import { Injectable, Logger, NotFoundException, type OnModuleInit, Optional } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { contextoAtual, exigirTenant } from '../common/contexto-execucao';
import { cifrar, chaveDoPacote, decifrar, idDaChaveAtual } from '../common/crypto';
import { EventLogService } from '../gateway/event-log.service';
import {
  CredencialEmprestada,
  EscopoInsuficienteError,
  MARCA_REDIGIDA,
  PrazoDeEmprestimoExcessivoError,
  VALIDADE_MAXIMA_DE_EMPRESTIMO_MS,
  dadoAssociado,
  ehSegredoDoAplicativo,
  escopoAtendido,
} from './segredo';

/**
 * A empresa da pergunta não é a empresa da sessão do banco.
 *
 * Cópia deliberada do raciocínio de `ConectoresService.empresaDaConsulta`, e
 * aqui a conta é ainda mais dura: sob o isolamento por linha, `orgId` divergente
 * faz a consulta devolver ZERO LINHA — e zero linha, no desenho ingênuo, vira
 * "esta empresa não tem credencial", que é indistinguível de "revogada". Um
 * cofre que confunde "não consigo ver" com "não existe" convida quem chama a
 * gravar de novo por cima, na empresa errada.
 */
export class EmpresaDivergenteNoCofreError extends Error {
  constructor(onde: string, doArgumento: string, doContexto: string | null) {
    super(
      `${onde}: a empresa do argumento (${doArgumento}) não é a da execução em curso ` +
        `(${doContexto ?? 'nenhuma'}). O cofre FALHA FECHADO: sem poder provar que a leitura ` +
        'enxerga a linha certa, ele não responde (RF-T-04, RF-C-01).',
    );
    this.name = 'EmpresaDivergenteNoCofreError';
  }
}

/**
 * Não há segredo guardado — ou ele foi revogado.
 *
 * Para quem só quer usar a credencial, os dois casos dão no mesmo: não dá. Para
 * quem tem uma FONTE ANTIGA à mão (o consumidor da bio, que ainda cai para a
 * coluna de origem enquanto a migração não termina), eles são opostos: "não
 * existe" autoriza a queda, "revogado" a PROÍBE — cair para a coluna depois de
 * uma revogação é não ter revogado. Por isso a distinção é um campo, e não algo
 * a inferir da mensagem.
 */
export class SegredoIndisponivelError extends NotFoundException {
  readonly revogado: boolean;

  constructor(conector: string, nome: string, revogado: boolean) {
    super(
      revogado
        ? `A credencial "${nome}" de "${conector}" foi REVOGADA e não existe mais. ` +
            'Autorize o conector de novo em Conexões — religar não traz credencial revogada de volta.'
        : `Não há credencial "${nome}" guardada para "${conector}" nesta empresa.`,
    );
    this.name = 'SegredoIndisponivelError';
    this.revogado = revogado;
  }
}

export interface EntradaParaGuardar {
  orgId: string;
  conector: string;
  nome: string;
  /** O valor cru. Entra por aqui e não sai por lugar nenhum. */
  valor: string;
  escopo?: readonly string[];
  origem: string;
  expiraEm?: Date | null;
  actorId?: string | null;
}

export interface EntradaParaEmprestar {
  orgId: string;
  conector: string;
  nome: string;
  /** Quando informado, o cofre confere que o segredo declara este escopo. */
  escopoExigido?: string | null;
  /** Só para o registro: qual capacidade motivou o empréstimo. */
  capabilityId?: string | null;
  /**
   * Validade do EMPRÉSTIMO, em milissegundos. Ver o padrão e o TETO abaixo —
   * pedir mais que o teto é recusado, não cortado em silêncio.
   */
  validadeMs?: number;
}

export interface LinhaDoCofre {
  conector: string;
  nome: string;
  escopo: string[];
  origem: string;
  chaveId: string;
  versao: number;
  expiraEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
  usadoEm: string | null;
  revogadoEm: string | null;
  revogadoPor: string | null;
  motivoRevogacao: string | null;
  /** Nunca o valor. É sempre a marca. Ver `MARCA_REDIGIDA`. */
  valor: string;
}

/*
 * ============================================================================
 * O COFRE (RF-C-01..RF-C-04)
 * ============================================================================
 *
 * Guarda, empresta, revoga. Não manda mensagem, não chama API externa e não sabe
 * o que é uma capacidade da régua — quem executa é a porta, quem fala com o
 * conector é o conector.
 *
 * ----------------------------------------------------------------------------
 * O QUE ELE **NÃO** FAZ, e cada "não" tem dono
 * ----------------------------------------------------------------------------
 *  · NÃO devolve o segredo. Devolve `CredencialEmprestada` (ver `segredo.ts`).
 *    Não existe método público que retorne a string — nem `abrir`, nem `ler`.
 *    A única abertura mora em `#abrir`, privada de JavaScript, e o valor sai
 *    dela direto para dentro do objeto emprestado.
 *
 *  · NÃO pergunta se o conector está DESLIGADO. Essa pergunta é de
 *    `ConectoresService` (fatia 3.7), ela já está ligada na porta e no caminho
 *    pós-aprovação, e `ConectoresService.envolver` existe para o caminho HTTP
 *    direto. Repeti-la aqui criaria um segundo lugar para manter em sincronia e
 *    exigiria que o cofre soubesse qual capacidade está em curso — que ele não
 *    sabe. As duas se COMPÕEM no chamador, nesta ordem:
 *
 *      await conectores.envolver('gmail', orgId, () =>
 *        cofre.envolver({ orgId, conector: 'gmail', nome: 'access_token' }, (cred) =>
 *          cred.usar((token) => google.enviar(token, …))));
 *
 *    Primeiro o interruptor (decisão de quem administra), depois o cofre
 *    (existe credencial?), por último a chamada.
 *
 *  · NÃO guarda segredo de PLATAFORMA. `orgId` é obrigatório. A chave do
 *    chaveiro, a chave da Anthropic e o app global da Root continuam em variável
 *    de ambiente, que é onde o operador os administra.
 *
 *  · NÃO escreve evento a cada EMPRÉSTIMO, e isso é escolha. Empréstimo
 *    acontece uma vez por chamada externa; um evento por empréstimo dobraria o
 *    volume do RASTRO repetindo o que a porta já registra melhor (a linha do
 *    `ToolCall` tem capacidade, ator, correlação e decisão). O que fica aqui é
 *    `usadoEm`, uma coluna — barata, e suficiente para a pergunta que só o cofre
 *    responde: "esta credencial ainda é usada, ou está parada há meses?".
 *    O que VIRA evento é a DECISÃO: guardar, revogar, rotacionar.
 */
@Injectable()
export class CofreService implements OnModuleInit {
  private readonly log = new Logger('Cofre');

  /**
   * Validade padrão de um empréstimo: um minuto.
   *
   * Não é tempo de token, é tempo de USO. O empréstimo existe para atravessar
   * uma chamada HTTP, e uma chamada HTTP que passe de um minuto já morreu por
   * timeout do outro lado. Prazo curto é o que torna a frase "revogação com
   * efeito imediato" verdadeira também para o empréstimo que já estava na mão
   * quando alguém clicou em revogar — e o que sobra desse minuto é fechado à
   * força por `invalidar`.
   */
  static readonly VALIDADE_PADRAO_MS = 60_000;

  /**
   * O TETO do prazo de empréstimo. Definido em `segredo.ts` e repetido aqui só
   * como nome legível para quem lê o serviço.
   *
   * ELE É O QUE TORNA O PARÁGRAFO ACIMA VERDADEIRO. Sem teto, o argumento
   * inteiro da janela de um minuto depende de um PADRÃO — e padrão é o valor que
   * qualquer chamador anula escrevendo um número maior. A revisão provou: um
   * empréstimo de vinte e quatro horas era aceito sem uma palavra.
   */
  static readonly VALIDADE_MAXIMA_MS = VALIDADE_MAXIMA_DE_EMPRESTIMO_MS;

  /**
   * Os empréstimos vivos, por (empresa, conector). É o que faz a revogação
   * alcançar quem JÁ está com a credencial na mão.
   *
   * Fraqueza declarada, porque ela é real e tem tamanho conhecido: este mapa é
   * DESTE PROCESSO. Numa segunda instância da API, um empréstimo em voo não é
   * alcançado por esta revogação — ele morre pelo prazo, em até um minuto. O
   * que vale em toda instância imediatamente é o banco: a linha some, e o
   * próximo empréstimo já não acontece em lugar nenhum. Um registro
   * compartilhado (Redis) resolveria o minuto residual e traria um ponto de
   * falha novo para o caminho de TODA chamada externa; o minuto é mais barato.
   */
  private readonly emprestados = new Map<string, Set<CredencialEmprestada>>();

  constructor(
    private readonly prisma: PrismaService,
    /**
     * `@Optional()` porque a suíte constrói este serviço à mão e porque falha de
     * REGISTRO nunca pode virar falha de guarda: sem o RASTRO, o cofre continua
     * guardando e revogando, e o que se perde sai no log em nível de erro.
     */
    @Optional() private readonly eventos?: EventLogService,
  ) {}

  /**
   * O `@Optional()` acima tem um lado escuro, e ele é fechado aqui.
   *
   * Sem registro, o Nest injeta `undefined` em silêncio e o cofre segue
   * funcionando — guardando e revogando sem escrever UMA LINHA no RASTRO.
   * Ninguém notaria: a tela funciona, os segredos abrem, e só num incidente é
   * que a pergunta "quem revogou o Gmail da empresa X, e quando?" não teria
   * resposta. Como a verificação de boot desta fatia não pôde ser rodada (ela
   * exige o artefato compilado), o grito no arranque é o que resta.
   *
   * Não derruba a API de propósito: o mesmo princípio de `registrar` — falha de
   * REGISTRO não pode virar falha de GUARDA.
   */
  onModuleInit(): void {
    if (!this.eventos) {
      this.log.error(
        'CofreService subiu SEM o registro de eventos: guardar e revogar credencial NÃO vai ' +
          'deixar rastro. Confira se GatewayModule (que exporta EventLogService) está de pé — ' +
          'ele é @Global, então o sintoma é ele não ter sido registrado no AppModule.',
      );
    }
  }

  // ------------------------------------------------------------------ guarda

  /**
   * Guarda (ou substitui) um segredo. Cifra com a chave ATUAL do chaveiro.
   *
   * Substituir um segredo REVOGADO é permitido e é o caminho normal de
   * reautorizar um conector: os campos de revogação são limpos e o evento
   * registra que a linha voltou. O que não acontece é a revogação sumir sem
   * deixar linha no RASTRO.
   */
  async guardar(entrada: EntradaParaGuardar): Promise<{ id: string; versao: number }> {
    const orgId = this.empresaDaConsulta(entrada.orgId, 'CofreService.guardar');
    const { conector, nome } = entrada;
    if (!entrada.valor) {
      // String vazia é o que a REVOGAÇÃO grava. Deixar `guardar` escrever vazio
      // criaria uma linha viva e ilegível — pior que não ter.
      throw new Error(
        `CofreService.guardar: valor vazio para ${conector}/${nome}. ` +
          'Para tirar o segredo de circulação use `revogar`, que deixa registro.',
      );
    }

    const chaveId = idDaChaveAtual();
    const cifrado = cifrar(entrada.valor, { aad: dadoAssociado(orgId, conector, nome) });
    const escopo = [...(entrada.escopo ?? [])];

    const anterior = await this.prisma.segredoDeConector.findUnique({
      where: { orgId_conector_nome: { orgId, conector, nome } },
      select: { id: true, versao: true, revogadoEm: true, chaveId: true },
    });

    const linha = await this.prisma.segredoDeConector.upsert({
      where: { orgId_conector_nome: { orgId, conector, nome } },
      create: {
        orgId,
        conector,
        nome,
        valorCifrado: cifrado,
        chaveId,
        escopo,
        origem: entrada.origem,
        expiraEm: entrada.expiraEm ?? null,
      },
      update: {
        valorCifrado: cifrado,
        chaveId,
        escopo,
        origem: entrada.origem,
        expiraEm: entrada.expiraEm ?? null,
        versao: { increment: 1 },
        // Regravar apaga a revogação — ver o parágrafo do cabeçalho.
        revogadoEm: null,
        revogadoPor: null,
        motivoRevogacao: null,
      },
      select: { id: true, versao: true },
    });

    // Empréstimo com o valor VELHO na mão não pode continuar valendo depois de
    // uma troca de credencial: o token antigo pode já ter sido invalidado pelo
    // outro lado, e a falha sairia como erro do conector em vez de "peça outro".
    this.fecharEmprestimos(orgId, conector, nome, 'a credencial foi substituída');

    await this.registrar(orgId, 'cofre.segredo.guardado', {
      actorId: entrada.actorId ?? null,
      argumentos: { conector, nome, escopo, origem: entrada.origem },
      resultado: { versao: linha.versao, chaveId },
      estadoAnterior: anterior
        ? { existia: true, versao: anterior.versao, revogado: !!anterior.revogadoEm }
        : { existia: false },
      estadoNovo: { existia: true, versao: linha.versao, revogado: false },
      desfazer: 'cofre.segredo.revogar',
    });

    return linha;
  }

  // --------------------------------------------------------------- empréstimo

  /**
   * Empresta a credencial: devolve a CAPACIDADE COM ESCOPO, nunca o valor.
   *
   * Ver `segredo.ts` para o porquê do objeto. Aqui basta dizer o que ele custa:
   * um `findUnique` pelo índice único e uma abertura de GCM — sem cache. Cache
   * de credencial seria a mesma armadilha do desligamento de conector: guardar
   * por trinta segundos é continuar podendo agir trinta segundos depois de
   * alguém ter mandado parar.
   */
  async emprestar(entrada: EntradaParaEmprestar): Promise<CredencialEmprestada> {
    const orgId = this.empresaDaConsulta(entrada.orgId, 'CofreService.emprestar');
    const { conector, nome } = entrada;

    /*
     * O TETO ANTES DA CONSULTA. Recusar depois de ler e decifrar seria abrir o
     * segredo para então jogá-lo fora — e a recusa aqui não depende de nada do
     * banco. Recusa, e não corte silencioso: quem pediu uma hora precisa saber
     * que não vai ter uma hora, senão escreve o resto do código contando com ela.
     */
    const validadeMs = entrada.validadeMs ?? CofreService.VALIDADE_PADRAO_MS;
    if (validadeMs > CofreService.VALIDADE_MAXIMA_MS) {
      throw new PrazoDeEmprestimoExcessivoError(validadeMs);
    }

    const linha = await this.prisma.segredoDeConector.findUnique({
      where: { orgId_conector_nome: { orgId, conector, nome } },
      select: {
        id: true,
        valorCifrado: true,
        escopo: true,
        revogadoEm: true,
      },
    });

    if (!linha || linha.revogadoEm || !linha.valorCifrado) {
      throw new SegredoIndisponivelError(conector, nome, !!linha?.revogadoEm);
    }

    /*
     * ESCOPO: vocabulário normalizado dos DOIS lados, e lista vazia é NADA.
     *
     * A versão anterior tinha dois defeitos numa linha só. O primeiro, a
     * comparação crua: o Google grava `https://www.googleapis.com/auth/gmail.send`
     * e quem escreve a ação pede `gmail.send` — a credencial certa era recusada.
     * O segundo, e pior: `linha.escopo.length > 0` DESLIGAVA a conferência
     * inteira quando não havia escopo declarado, transformando "não sei o que
     * esta credencial permite" em "permite tudo". Toda credencial migrada de
     * antes do cofre está nesse estado. Ver `escopoAtendido` em `segredo.ts`.
     */
    if (entrada.escopoExigido && !escopoAtendido(linha.escopo, entrada.escopoExigido)) {
      throw new EscopoInsuficienteError(conector, entrada.escopoExigido, linha.escopo);
    }

    const segredo = this.#abrir(orgId, conector, nome, linha.valorCifrado);

    const credencial = new CredencialEmprestada(
      {
        orgId,
        conector,
        nome,
        referencia: linha.id,
        escopo: linha.escopo,
        expiraEm: new Date(Date.now() + validadeMs),
        capabilityId: entrada.capabilityId ?? null,
      },
      segredo,
    );
    this.anotarEmprestimo(orgId, conector, nome, credencial);

    /*
     * `usadoEm` é escrito SEM esperar (`void`) e com o erro engolido no log.
     *
     * É a única escrita no caminho quente de toda chamada externa, e ela é
     * ESTATÍSTICA, não decisão: fazer a chamada ao Gmail esperar por um UPDATE
     * de carimbo — ou falhar porque o carimbo falhou — seria trocar a função do
     * cofre pela sua contabilidade.
     */
    void this.prisma.segredoDeConector
      // `updateMany` e não `update`: a linha pode ter sido revogada e apagada
      // entre o empréstimo e o carimbo, e `update` transformaria isso em erro
      // barulhento sobre um carimbo que ninguém espera.
      .updateMany({ where: { id: linha.id }, data: { usadoEm: new Date() } })
      .catch((e: unknown) =>
        this.log.warn(`não consegui carimbar o uso de ${conector}/${nome}: ${(e as Error).message}`),
      );

    return credencial;
  }

  /**
   * Empresta, usa e DEVOLVE — o caminho que não deixa empréstimo pendurado.
   *
   * É a forma preferida. `emprestar` cru existe para quem precisa do objeto
   * atravessando camadas, e aí a devolução é responsabilidade de quem pediu.
   */
  async envolver<T>(
    entrada: EntradaParaEmprestar,
    fn: (credencial: CredencialEmprestada) => Promise<T>,
  ): Promise<T> {
    const credencial = await this.emprestar(entrada);
    try {
      return await fn(credencial);
    } finally {
      credencial.devolver();
    }
  }

  // --------------------------------------------------------------- revogação

  /**
   * REVOGA (RF-C-03): o valor some, a linha fica.
   *
   * `nome` ausente revoga os segredos daquele conector nesta empresa — é o caso
   * de "desconectar o Google": access e refresh token juntos, porque deixar o
   * refresh vivo seria deixar a porta destrancada com o aviso de fechada.
   *
   * ----------------------------------------------------------------------------
   * O QUE A REVOGAÇÃO EM MASSA **NÃO** QUEIMA, e por quê
   * ----------------------------------------------------------------------------
   * O SEGREDO DO APLICATIVO fica de fora por padrão. O argumento que sustenta
   * "revogar não tem volta, e está tudo bem" é: reautorizar traz o par de tokens
   * de volta. Esse argumento vale para `access_token` e `refresh_token`, que
   * NASCEM de uma autorização — e não vale para `app_secret`, que não nasce de
   * autorização nenhuma: ele é digitado na tela por quem administra o app na
   * consola da Meta/TikTok. Queimá-lo de tabela, junto com os tokens, apaga um
   * valor que nenhum fluxo de OAuth recupera.
   *
   * Quem quer mesmo queimá-lo pede com todas as letras: `nome: 'app_secret'`, ou
   * `incluirSegredoDoApp: true`. O retorno diz o que foi PRESERVADO, para a tela
   * não deixar a impressão de que desconectou tudo.
   *
   * INDIVIDUAL POR EMPRESA E POR CONECTOR, com todas as letras: o `where` leva
   * `orgId`, e o isolamento por linha recorta por ele de novo no banco. Revogar
   * o Gmail da empresa A não encosta no Gmail da empresa B nem no ClickUp da
   * própria A — e isso é provado por tentativa na suíte, não por leitura.
   */
  async revogar(entrada: {
    orgId: string;
    conector: string;
    nome?: string | null;
    /** Queima também o `app_secret`. Ver o parágrafo acima antes de ligar. */
    incluirSegredoDoApp?: boolean;
    motivo?: string | null;
    por?: string | null;
  }): Promise<{ revogados: string[]; jaRevogados: string[]; preservados: string[] }> {
    const orgId = this.empresaDaConsulta(entrada.orgId, 'CofreService.revogar');
    const { conector } = entrada;
    const motivo = entrada.motivo?.trim() ? entrada.motivo.trim().slice(0, 500) : null;

    /*
     * `nome` em BRANCO não é "todos".
     *
     * A versão anterior escrevia `entrada.nome ? { nome } : {}` — e string vazia
     * é falsa em JavaScript. Quem chegasse com `nome: ''` (um campo de
     * formulário não preenchido, um `?nome=` vazio na query) caía no ramo de
     * TODOS e revogava o conector inteiro achando que não tinha escolhido nada.
     * A distinção é entre "não informei" (undefined/null) e "informei vazio".
     */
    let nomeAlvo: string | undefined;
    if (entrada.nome !== undefined && entrada.nome !== null) {
      nomeAlvo = entrada.nome.trim();
      if (!nomeAlvo) {
        throw new Error(
          'CofreService.revogar: `nome` veio em branco. Branco NÃO é "todos" — para revogar o ' +
            'conector inteiro, omita o campo; para revogar um segredo, diga qual.',
        );
      }
    }

    const linhas = await this.prisma.segredoDeConector.findMany({
      where: { orgId, conector, ...(nomeAlvo ? { nome: nomeAlvo } : {}) },
      select: { id: true, nome: true, revogadoEm: true },
    });

    // Só protege no ramo de TODOS: quem nomeou o `app_secret` sabe o que pediu.
    const protegido = (nome: string) =>
      !nomeAlvo && !entrada.incluirSegredoDoApp && ehSegredoDoAplicativo(nome);

    const preservados = linhas.filter((l) => protegido(l.nome)).map((l) => l.nome).sort();
    const emJogo = linhas.filter((l) => !protegido(l.nome));

    const aRevogar = emJogo.filter((l) => !l.revogadoEm);
    const jaRevogados = emJogo.filter((l) => l.revogadoEm).map((l) => l.nome).sort();

    if (aRevogar.length) {
      await this.prisma.segredoDeConector.updateMany({
        where: { id: { in: aRevogar.map((l) => l.id) } },
        data: {
          /*
           * O VALOR VAI EMBORA. É a diferença entre revogação e uma flag.
           *
           * Uma flag dependeria de todo leitor lembrar de conferi-la; o leitor
           * que esquecesse continuaria mandando mensagem com a credencial
           * revogada, e o esquecimento só apareceria num incidente. Sem valor
           * não há o que ler, em nenhum caminho, nem no que ainda não foi
           * escrito. O preço é que revogar NÃO TEM VOLTA — é o preço certo:
           * revogação que se desfaz não é revogação.
           */
          valorCifrado: '',
          revogadoEm: new Date(),
          revogadoPor: entrada.por ?? null,
          motivoRevogacao: motivo,
        },
      });
    }

    for (const l of aRevogar) {
      this.fecharEmprestimos(orgId, conector, l.nome, 'a credencial foi revogada');
    }

    const revogados = aRevogar.map((l) => l.nome).sort();

    /*
     * O ANTES E O DEPOIS, ditos com honestidade.
     *
     * A versão anterior gravava sempre `estadoAnterior: { revogados: [] }` —
     * isto é, afirmava que nada estava revogado antes, MESMO quando havia linha
     * já revogada (`jaRevogados` não vazio). Num registro de auditoria, afirmar
     * um estado anterior que não existiu é pior do que não registrar: quem lê
     * depois reconstrói uma história errada e não tem como desconfiar.
     *
     * `preservados` entra porque o segredo do aplicativo continua VIVO depois de
     * uma revogação de conector, e um rastro que não dissesse isso descreveria
     * um desconectar completo que não aconteceu.
     */
    const vivosDepois = [...preservados].sort();
    await this.registrar(orgId, 'cofre.segredo.revogado', {
      actorType: ActorType.user,
      actorId: entrada.por ?? null,
      argumentos: {
        conector,
        nome: nomeAlvo ?? '(todos)',
        incluirSegredoDoApp: !!entrada.incluirSegredoDoApp,
      },
      motivo,
      estadoAnterior: { revogados: jaRevogados, vivos: [...revogados, ...preservados].sort() },
      estadoNovo: { revogados: [...jaRevogados, ...revogados].sort(), vivos: vivosDepois },
      resultado: { revogados, jaRevogados, preservados },
    });

    this.log.warn(
      `credencial revogada (empresa ${orgId}, conector ${conector}): ` +
        `${revogados.length ? revogados.join(', ') : 'nada a revogar'}` +
        (preservados.length ? ` — PRESERVADO(S): ${preservados.join(', ')}` : '') +
        (motivo ? ` — ${motivo}` : ''),
    );

    return { revogados, jaRevogados, preservados };
  }

  // -------------------------------------------------------------------- tela

  /**
   * O que a empresa tem guardado — SEM segredo nenhum.
   *
   * `valor` vem sempre como a marca redigida, e vem PREENCHIDO de propósito, em
   * vez de o campo não existir: uma tela que recebesse `valor: undefined`
   * facilmente mostraria um espaço em branco onde deveria estar dito, com todas
   * as letras, que o valor não sai do cofre.
   */
  async estado(orgId: string): Promise<{
    items: LinhaDoCofre[];
    total: number;
    source: { tool: string; generatedAt: string };
  }> {
    const id = this.empresaDaConsulta(orgId, 'CofreService.estado');
    const linhas = await this.prisma.segredoDeConector.findMany({
      where: { orgId: id },
      /*
       * `select` explícito, sem `valorCifrado`. Não é paranoia: `findMany` sem
       * select traz a coluna, e o objeto inteiro costuma acabar num
       * `JSON.stringify` de resposta HTTP. O valor é cifrado, então não seria
       * vazamento de segredo — mas seria entregar o criptograma de graça a quem
       * só tem a tela, e é gratuito não fazer isso.
       */
      select: {
        conector: true,
        nome: true,
        escopo: true,
        origem: true,
        chaveId: true,
        versao: true,
        expiraEm: true,
        criadoEm: true,
        atualizadoEm: true,
        usadoEm: true,
        revogadoEm: true,
        revogadoPor: true,
        motivoRevogacao: true,
      },
      orderBy: [{ conector: 'asc' }, { nome: 'asc' }],
    });

    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      items: linhas.map((l) => ({
        conector: l.conector,
        nome: l.nome,
        escopo: l.escopo,
        origem: l.origem,
        chaveId: l.chaveId,
        versao: l.versao,
        expiraEm: iso(l.expiraEm),
        criadoEm: l.criadoEm.toISOString(),
        atualizadoEm: l.atualizadoEm.toISOString(),
        usadoEm: iso(l.usadoEm),
        revogadoEm: iso(l.revogadoEm),
        revogadoPor: l.revogadoPor,
        motivoRevogacao: l.motivoRevogacao,
        valor: MARCA_REDIGIDA,
      })),
      total: linhas.length,
      source: { tool: 'cofre', generatedAt: new Date().toISOString() },
    };
  }

  // ---------------------------------------------------------------- internos

  /**
   * A ÚNICA abertura. Privada de JavaScript (`#`), não `private` de TypeScript:
   * `private` some na compilação e `servico['abrir'](…)` funcionaria.
   */
  #abrir(orgId: string, conector: string, nome: string, pacote: string): string {
    try {
      return decifrar(pacote, { aad: dadoAssociado(orgId, conector, nome) });
    } catch (e) {
      /*
       * A mensagem do erro do Node aqui é "Unsupported state or unable to
       * authenticate data", que manda quem investiga procurar corrupção de
       * banco. As três causas reais são outras, e nomeá-las economiza horas.
       */
      throw new Error(
        `não consegui abrir a credencial ${conector}/${nome} desta empresa. ` +
          `A chave que a cifrou é "${chaveDoPacote(pacote)}". Três causas, nesta ordem de ` +
          'probabilidade: (1) essa chave saiu do chaveiro antes de a rotação terminar — ' +
          'recoloque-a em COFRE_CHAVES; (2) a linha foi copiada de outra empresa (o dado ' +
          'associado não bate, e é de propósito); (3) o valor foi adulterado no banco. ' +
          `Detalhe técnico: ${(e as Error).message}`,
      );
    }
  }

  private chaveDoMapa(orgId: string, conector: string, nome: string): string {
    return `${orgId}\u0000${conector}\u0000${nome}`;
  }

  /**
   * Anota o empréstimo no mapa de vivos e — o que importa — combina COM ELE como
   * sair de lá.
   *
   * A versão anterior limpava de forma "oportunista": ao emprestar, varria o
   * conjunto tirando o que já não valia. Isso tem uma consequência que a revisão
   * derrubou executando: se ninguém pedir OUTRO empréstimo daquela mesma chave,
   * a limpeza nunca acontece — e o objeto vencido fica no mapa, VIVO, com o
   * valor em claro na memória, pelo tempo de vida do processo. É o despejo de
   * memória que o comentário do próprio `usar` dizia estar evitando.
   *
   * Agora quem avisa é o empréstimo: ele tem um despertador no vencimento
   * (`segredo.ts`), zera o valor e chama de volta aqui para sair do conjunto.
   * Devolver e revogar passam pelo mesmo caminho. O mapa deixa de crescer, e não
   * sobra texto claro esperando.
   */
  private anotarEmprestimo(
    orgId: string,
    conector: string,
    nome: string,
    credencial: CredencialEmprestada,
  ): void {
    const k = this.chaveDoMapa(orgId, conector, nome);
    const atual = this.emprestados.get(k) ?? new Set<CredencialEmprestada>();
    atual.add(credencial);
    this.emprestados.set(k, atual);

    credencial.quandoEncerrar((c) => {
      const vivos = this.emprestados.get(k);
      if (!vivos) return;
      vivos.delete(c);
      if (vivos.size === 0) this.emprestados.delete(k);
    });
  }

  private fecharEmprestimos(orgId: string, conector: string, nome: string, motivo: string): void {
    const k = this.chaveDoMapa(orgId, conector, nome);
    const vivos = this.emprestados.get(k);
    if (!vivos) return;
    for (const c of vivos) c.invalidar(motivo);
    this.emprestados.delete(k);
  }

  private empresaDaConsulta(orgId: string | null | undefined, onde: string): string {
    const doArgumento = exigirTenant(orgId, onde);
    const doContexto = contextoAtual()?.orgId ?? null;
    if (doContexto !== doArgumento) {
      throw new EmpresaDivergenteNoCofreError(onde, doArgumento, doContexto);
    }
    return doArgumento;
  }

  /**
   * O evento da DECISÃO no RASTRO.
   *
   * `sensibilidade: 'interna'` e não `'confidencial'`, e vale dizer por quê num
   * arquivo que trata de segredo: `confidencial` faz `EventLogService` trocar o
   * conteúdo por resumo criptográfico — e o conteúdo daqui não tem segredo
   * nenhum. São conector, nome, escopo, versão e chave. Marcar confidencial
   * apagaria justamente os campos de que a auditoria precisa ("quem revogou o
   * Gmail da empresa X, quando e por quê") para proteger um valor que não está
   * ali. O valor nunca entra: não há caminho neste arquivo que o coloque num
   * payload.
   *
   * Falha de registro NÃO desfaz a decisão — o mesmo princípio de
   * `ConectoresService.registrarMudanca`: o estado real é o que vale, e o que se
   * perde sai no log em nível de erro com o bastante para reconstruir à mão.
   */
  private async registrar(
    orgId: string,
    tipo: string,
    dados: {
      actorType?: ActorType;
      actorId?: string | null;
      argumentos?: unknown;
      resultado?: unknown;
      motivo?: string | null;
      estadoAnterior?: unknown;
      estadoNovo?: unknown;
      desfazer?: string;
    },
  ): Promise<void> {
    if (!this.eventos) return;
    const herdado = contextoAtual();
    try {
      await this.eventos.registrar({
        orgId,
        tipo,
        actorType: dados.actorType ?? herdado?.actorType ?? ActorType.user,
        actorId: dados.actorId ?? herdado?.actorId ?? null,
        agentSlug: herdado?.agentSlug ?? null,
        correlationId: herdado?.correlationId ?? null,
        conteudo: {
          argumentos: dados.argumentos,
          resultado: dados.resultado,
          motivo: dados.motivo ?? null,
          estadoAnterior: dados.estadoAnterior,
          estadoNovo: dados.estadoNovo,
          ...(dados.desfazer ? { desfazer: dados.desfazer } : {}),
        },
        sensibilidade: 'interna',
      });
    } catch (e) {
      this.log.error(
        `${tipo} (empresa ${orgId}) NÃO foi registrado no rastro: ${(e as Error).message} — ` +
          'a mudança JÁ VALE no banco.',
      );
    }
  }
}
