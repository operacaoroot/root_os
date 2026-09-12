import { Logger } from '@nestjs/common';
import { ActorType, Prisma, type PrismaClient } from '@prisma/client';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import {
  ID_DA_CHAVE_DE_AMBIENTE,
  chaveDoPacote,
  cifrar,
  decifrar,
  idDaChaveAtual,
  idsDoChaveiro,
} from '../common/crypto';
import { EventLogService } from '../gateway/event-log.service';
import { dadoAssociado } from './segredo';

/*
 * ============================================================================
 * ROTAÇÃO DE CHAVE COM RE-CIFRAGEM (RF-C-04) — a entrega que todo mundo finge
 * ============================================================================
 *
 * O QUE ELA TEM DE PROVAR, e o que a separa de um `UPDATE` esperançoso:
 *
 *   1. depois de rotacionar, TODOS os segredos continuam legíveis — inclusive
 *      um que a rotação NÃO TOCOU. É o caso que reprova a implementação ingênua:
 *      quem "rotaciona" trocando a variável de ambiente deixa ilegível tudo o
 *      que não conseguiu re-cifrar, e "não conseguiu" é o estado normal de uma
 *      rotação interrompida no meio;
 *   2. existe caminho de VOLTA. Enquanto as duas chaves estiverem no chaveiro,
 *      voltar é rotacionar no sentido contrário — nenhuma restauração de backup.
 *
 * As duas saem da mesma decisão de desenho: o pacote cifrado CARREGA o id da
 * chave (`src/common/crypto.ts`) e o processo carrega várias chaves ao mesmo
 * tempo. A rotação então não é um evento atômico e arriscado; é uma varredura
 * retomável em que cada linha é independente das outras.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ESTA CLASSE NÃO É PROVIDER DE MÓDULO NENHUM
 * ----------------------------------------------------------------------------
 * Mesmo motivo de `ExpurgoService` (`audit/audit.module.ts` não o registra de
 * propósito): ela não pode ser alcançável por requisição HTTP. Rotação lê o
 * segredo de TODAS as empresas — é a única operação do produto que atravessa o
 * multiempresa inteiro —, e uma rota que a exponha é uma rota que, com um
 * defeito de permissão, vira leitura de todo o cofre. Ela é construída à mão
 * pelo comando de manutenção (`cofre.cli.ts`) e pela suíte.
 *
 * ----------------------------------------------------------------------------
 * COMANDO, NÃO ROTINA — e o argumento inteiro
 * ----------------------------------------------------------------------------
 * A fatia do expurgo decidiu, na onda passada, que "manutenção que apaga prova é
 * comando que alguém dá — e que fica no log de quem deu". Aqui vale o mesmo, com
 * dois motivos a mais que são só desta operação:
 *
 *  · ROTAÇÃO NÃO TEM QUANDO. Expurgo tem: o prazo de retenção venceu, e o
 *    critério é uma data. Uma rotação automática precisaria de um gatilho
 *    inventado ("a cada 90 dias"), e um gatilho inventado roda no dia em que
 *    ninguém está olhando. O que de fato dispara rotação é uma DECISÃO — chave
 *    possivelmente vazada, pessoa que tinha acesso saiu, exigência de auditoria
 *    — e decisão tem autor.
 *
 *  · A METADE HUMANA É INDISPENSÁVEL. Rotacionar exige antes: gerar a chave
 *    nova, acrescentá-la a `COFRE_CHAVES` **nos dois lugares** (o bloco
 *    `environment:` do compose e o `.env` — variável que não está no bloco não
 *    chega no container), recriar o container para o processo enxergá-la, e só
 *    então rodar. Uma rotina dentro da API não pode fazer nenhum desses passos:
 *    ela acordaria, não acharia a chave nova e não teria para onde rotacionar —
 *    ou, pior, alguém a "consertaria" fazendo-a GERAR a chave sozinha, e aí o
 *    material da chave passaria a nascer dentro do processo que ela protege.
 *
 * Então: comando. E ele é retomável de propósito, porque comando que só funciona
 * se rodar inteiro de uma vez é comando que ninguém dá em produção.
 */

export interface FalhaDeRotacao {
  id: string;
  orgId: string;
  conector: string;
  nome: string;
  chaveId: string;
  erro: string;
}

/**
 * Quantas linhas dependem de uma chave — as DUAS espécies, separadas.
 *
 * A separação é o conserto do defeito mais grave desta fatia (ver o bloco
 * "O QUE O INVENTÁRIO CEGO CUSTAVA", abaixo). `cofre` é o que a rotação
 * re-cifra; `herdadas` é o que ela NÃO ALCANÇA e que morreria se a chave saísse.
 */
export interface ContagemPorChave {
  /** Linhas vivas de `SegredoDeConector`. A rotação re-cifra estas. */
  cofre: number;
  /**
   * Colunas cifradas de ANTES do cofre, que a rotação não toca:
   * `BioConexao.tokenCifrado`/`.refreshCifrado` e `BioCredencialApp.segredoCifrado`.
   * Enquanto houver uma delas numa chave, essa chave NÃO PODE sair do ambiente.
   */
  herdadas: number;
  total: number;
}

/** Onde uma linha herdada mora — para a mensagem poder apontar o dedo. */
export interface DetalheHerdado {
  tabela: string;
  coluna: string;
  chaveId: string;
  quantas: number;
}

export interface RelatorioDeRotacao {
  paraChaveId: string;
  simulado: boolean;
  /** Linhas que estavam fora da chave de destino quando a varredura começou. */
  candidatas: number;
  recifradas: number;
  /** Revogadas: não têm valor, e não há o que re-cifrar. */
  puladasPorRevogacao: number;
  /** Alguém regravou a linha durante a varredura — ela já está na chave nova. */
  puladasPorConcorrencia: number;
  falhas: FalhaDeRotacao[];
  /** chaveId -> contagem, antes e depois. É a prova de que terminou. */
  inventarioAntes: Record<string, ContagemPorChave>;
  inventarioDepois: Record<string, ContagemPorChave>;
  /** As colunas de origem que ficaram para trás, por tabela e chave. */
  herdadas: DetalheHerdado[];
  duracaoMs: number;
}

/** A rotação não pode nem começar. Sempre alta — nunca "rotacionou 0 linhas". */
export class RotacaoIndisponivelError extends Error {
  constructor(motivo: string) {
    super(`Rotação de chave do cofre indisponível: ${motivo}`);
    this.name = 'RotacaoIndisponivelError';
  }
}

/*
 * ============================================================================
 * O QUE O INVENTÁRIO CEGO CUSTAVA — leia antes de mexer em qualquer coisa aqui
 * ============================================================================
 *
 * O roteiro de rotação termina assim: "rode `inventario` até a chave antiga
 * aparecer com ZERO linhas; só ENTÃO tire-a do ambiente". É um roteiro correto
 * sobre um inventário que MENTIA.
 *
 * A versão anterior contava só `SegredoDeConector`. As credenciais que o produto
 * de fato lê hoje não estão lá: estão nas colunas de origem da bio
 * (`BioConexao.tokenCifrado`, `BioConexao.refreshCifrado`,
 * `BioCredencialApp.segredoCifrado`), cifradas com a chave de ambiente, e a
 * rotação nunca as tocou. Logo depois de rotacionar, o inventário dizia zero na
 * chave de ambiente — e quem seguisse o passo seguinte tornaria ILEGÍVEL toda
 * credencial viva da bio, em todo cliente. Reautorizar tudo, na mão, cliente a
 * cliente. Não é hipótese: foi reproduzido.
 *
 * Três coisas passaram a existir por causa disso, e as três são interdependentes:
 *
 *   1. o inventário conta TAMBÉM as colunas herdadas, por chave, e as mostra
 *      numa coluna própria — a chave de ambiente não chega a zero enquanto
 *      houver bio cifrada com ela, que é a verdade;
 *   2. `rotacionar` RECUSA sair da chave de ambiente enquanto restar linha
 *      herdada nela. O roteiro pressupõe que rotacionar leva a poder aposentar a
 *      chave de origem; enquanto isso for falso, a operação para e diz por quê;
 *   3. o roteiro (em `cofre.cli.ts`) nomeia a variável certa: a chave `env` mora
 *      em `ENCRYPTION_KEY`, NÃO em `COFRE_CHAVES`. O passo que mandava editar
 *      `COFRE_CHAVES` para aposentá-la nunca teria efeito nenhum — até o dia em
 *      que alguém "consertasse" apagando a variável certa.
 *
 * E a linha herdada que NUNCA sai: `BioCredencialApp` com `orgId` nulo é o app
 * global da Root, e o cofre é por empresa. Ela não é migrável, então
 * `ENCRYPTION_KEY` não é aposentável enquanto ela existir. Isso é uma decisão de
 * produto que precisa ser tomada por alguém, não um detalhe a descobrir num
 * incidente. Ver PERGUNTAS no relatório da fatia.
 */

/** As colunas cifradas que existiam ANTES do cofre e que ele não governa. */
const COLUNAS_HERDADAS: ReadonlyArray<{ tabela: string; coluna: string }> = [
  { tabela: 'BioConexao', coluna: 'tokenCifrado' },
  { tabela: 'BioConexao', coluna: 'refreshCifrado' },
  { tabela: 'BioCredencialApp', coluna: 'segredoCifrado' },
];

export class RotacaoDeChaveService {
  private readonly log = new Logger('CofreRotacao');

  constructor(
    private readonly prisma: PrismaClient,
    private readonly eventos?: EventLogService,
  ) {}

  /**
   * Quantas linhas dependem de cada chave — cofre E colunas herdadas.
   *
   * É a pergunta "a rotação terminou?" e a pergunta "posso tirar a chave velha
   * do ambiente?" — que NÃO são a mesma, e era justamente confundi-las que
   * tornava esta função perigosa. A primeira se responde com a coluna `cofre`; a
   * segunda só com `total`.
   *
   * Atravessa empresas: roda com a conexão que ignora o isolamento (ver
   * `conferirQueAtravessaOIsolamento`).
   */
  async inventario(): Promise<Record<string, ContagemPorChave>> {
    const r: Record<string, ContagemPorChave> = {};
    const somar = (chaveId: string, onde: 'cofre' | 'herdadas', quantas: number) => {
      const atual = (r[chaveId] ??= { cofre: 0, herdadas: 0, total: 0 });
      atual[onde] += quantas;
      atual.total += quantas;
    };

    const doCofre = await this.prisma.$queryRaw<{ chaveId: string; quantas: bigint }[]>`
      SELECT "chaveId", count(*) AS quantas
        FROM "SegredoDeConector"
       WHERE "revogadoEm" IS NULL AND "valorCifrado" <> ''
       GROUP BY "chaveId"
       ORDER BY "chaveId"`;
    for (const l of doCofre) somar(l.chaveId, 'cofre', Number(l.quantas));

    for (const h of await this.herdadas()) somar(h.chaveId, 'herdadas', h.quantas);
    return r;
  }

  /**
   * As colunas cifradas de ANTES do cofre, contadas por chave.
   *
   * O id da chave não está em coluna nenhuma dessas tabelas — ele vive DENTRO do
   * pacote (`chaveDoPacote`), e o formato antigo, de três partes, nem o carrega:
   * é implicitamente `env`. Por isso a contagem é feita em memória, lendo só a
   * coluna cifrada. São tabelas pequenas (uma conexão por perfil de rede social,
   * uma credencial de app por plataforma) e isto roda num comando de manutenção,
   * não no caminho quente de nada.
   *
   * NADA É DECIFRADO AQUI. Só se lê o prefixo do pacote.
   */
  async herdadas(): Promise<DetalheHerdado[]> {
    const saida: DetalheHerdado[] = [];
    for (const { tabela, coluna } of COLUNAS_HERDADAS) {
      let linhas: Array<{ pacote: string | null }>;
      try {
        linhas = await this.prisma.$queryRaw<Array<{ pacote: string | null }>>(
          Prisma.sql`SELECT ${Prisma.raw(`"${coluna}"`)} AS pacote FROM ${Prisma.raw(`"${tabela}"`)}`,
        );
      } catch (e) {
        /*
         * Tabela ausente não é motivo para o inventário calar-se: um banco de
         * teste pode não ter o módulo da bio. Mas também não é motivo para dizer
         * "zero herdadas", que é a mentira que este conserto veio tirar do
         * caminho — então vira uma linha visível, com chave `?`.
         */
        saida.push({ tabela, coluna, chaveId: '?', quantas: 0 });
        this.log.warn(`não consegui inventariar ${tabela}.${coluna}: ${(e as Error).message}`);
        continue;
      }

      const porChave = new Map<string, number>();
      for (const l of linhas) {
        if (!l.pacote) continue;
        let id: string;
        try {
          id = chaveDoPacote(l.pacote);
        } catch {
          // Pacote malformado: conta como desconhecido, jamais some da soma.
          id = '?';
        }
        porChave.set(id, (porChave.get(id) ?? 0) + 1);
      }
      for (const [chaveId, quantas] of porChave) saida.push({ tabela, coluna, chaveId, quantas });
    }
    return saida.filter((h) => h.quantas > 0 || h.chaveId === '?');
  }

  /**
   * Recusa rodar de uma conexão que NÃO ATRAVESSA o isolamento por linha.
   *
   * A pergunta certa não é "sou o dono da tabela" — a tabela nasce com FORCE ROW
   * LEVEL SECURITY, e FORCE vale PARA O DONO também. Quem atravessa é quem tem
   * o atributo de ignorar policy: superusuário ou `BYPASSRLS`. A revisão provou
   * a diferença executando: com um papel dono e sem bypass, a varredura via as
   * linhas de UMA empresa (a da sessão, que não existe num script) e a rotação
   * reportava "nada a rotacionar" com ar de sucesso — exatamente o desfecho que
   * o comentário desta função dizia estar evitando.
   *
   * O atributo de papel NÃO é herdado por pertencimento a grupo em PostgreSQL,
   * então perguntar por `current_user` em `pg_roles` é a pergunta exata.
   *
   * A segunda metade da condição existe para não dar alarme falso: onde o
   * isolamento não está ligado nem forçado nesta tabela (um banco descartável em
   * que `app_rls_ligar()` nunca rodou), qualquer papel enxerga tudo e a varredura
   * é completa de qualquer jeito.
   */
  async conferirQueAtravessaOIsolamento(): Promise<void> {
    const r = await this.prisma.$queryRaw<
      { papel: string; ignora: boolean; ligado: boolean; forcado: boolean }[]
    >`
      SELECT current_user::text AS papel,
             (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS ignora,
             c.relrowsecurity AS ligado,
             c.relforcerowsecurity AS forcado
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'SegredoDeConector'`;
    const linha = r[0];
    if (!linha) throw new RotacaoIndisponivelError('a tabela SegredoDeConector não existe neste banco');

    if (!linha.ignora && linha.ligado && linha.forcado) {
      throw new RotacaoIndisponivelError(
        `conectado como "${linha.papel}", que NÃO ignora o isolamento por linha ` +
          '(não é superusuário nem tem BYPASSRLS) numa tabela com FORCE ROW LEVEL SECURITY. ' +
          'Ser DONO da tabela não basta: FORCE vale para o dono também. Sob este papel a ' +
          'varredura enxergaria só a empresa da sessão — que num script não existe — e a rotação ' +
          'sairia dizendo "nada a rotacionar" com ar de sucesso. Use a MESMA conexão que roda ' +
          'migration (DATABASE_URL).',
      );
    }
  }

  /**
   * Re-cifra o que está fora da chave de destino.
   *
   * `paraChaveId` padrão é a chave ATUAL do chaveiro — que é a que `guardar` já
   * usa para tudo que entra. Passar outra explicitamente é o CAMINHO DE VOLTA:
   * `--para env` desfaz uma rotação para `k2`, desde que `env` continue no
   * chaveiro. É por isso que tirar a chave velha é sempre o ÚLTIMO passo.
   */
  async rotacionar(
    opcoes: {
      paraChaveId?: string;
      /** Limita a uma empresa. Para conferir antes de rodar no cofre inteiro. */
      orgId?: string;
      /** Tamanho do lote lido por volta. Retomável: cada linha é independente. */
      lote?: number;
      simular?: boolean;
      actorId?: string | null;
      /**
       * Rotacionar para FORA da chave de ambiente mesmo havendo colunas herdadas
       * cifradas com ela. Ver a recusa logo abaixo antes de ligar isto.
       */
      aceitarHerdadas?: boolean;
    } = {},
  ): Promise<RelatorioDeRotacao> {
    const inicio = Date.now();
    const paraChaveId = opcoes.paraChaveId ?? idDaChaveAtual();
    const disponiveis = idsDoChaveiro();
    if (!disponiveis.includes(paraChaveId)) {
      throw new RotacaoIndisponivelError(
        `a chave de destino "${paraChaveId}" não está no chaveiro (disponíveis: ${disponiveis.join(', ')}). ` +
          'Acrescente-a a COFRE_CHAVES nos DOIS lugares (bloco `environment:` do compose e .env) ' +
          'e recrie o container — variável de ambiente é fixada na criação, `docker restart` não serve.',
      );
    }

    const herdadas = await this.herdadas();

    /*
     * A RECUSA QUE IMPEDE O ROTEIRO DE DESTRUIR O QUE ESTÁ VIVO.
     *
     * Rotacionar para longe da chave de ambiente é o primeiro passo de uma
     * sequência cujo último passo é aposentá-la. Enquanto houver credencial VIVA
     * cifrada com ela fora do cofre — e há: a bio inteira —, esse último passo é
     * uma perda total, e o inventário zerado do cofre daria a impressão contrária.
     *
     * Então a operação para AQUI, com o número na mão, em vez de deixar que a
     * conclusão errada apareça três passos depois. O que destravar é um trabalho
     * de verdade, não um argumento: `cofre.cli.js migrar` traz a bio para o
     * cofre, e o consumidor da bio (`BioCredenciaisService`) já lê de lá primeiro.
     *
     * `--aceitar-herdadas` existe para quem quer só levar o COFRE para uma chave
     * nova sabendo que `ENCRYPTION_KEY` continua indispensável. É uma decisão
     * legítima; ela só não pode ser tomada por omissão.
     */
    if (paraChaveId !== ID_DA_CHAVE_DE_AMBIENTE && !opcoes.aceitarHerdadas) {
      const presas = herdadas.filter((h) => h.chaveId === ID_DA_CHAVE_DE_AMBIENTE);
      const quantas = presas.reduce((s, h) => s + h.quantas, 0);
      if (quantas > 0) {
        throw new RotacaoIndisponivelError(
          `há ${quantas} credencial(is) VIVA(S) cifrada(s) com a chave de ambiente FORA do cofre ` +
            `(${presas.map((h) => `${h.tabela}.${h.coluna}: ${h.quantas}`).join('; ')}), e a ` +
            'rotação não as alcança. Rotacionar agora faria o inventário do cofre zerar a chave ' +
            '"env" — e o passo seguinte do roteiro (aposentar a chave antiga, que mora em ' +
            'ENCRYPTION_KEY) tornaria ILEGÍVEL cada uma dessas credenciais, sem volta: ' +
            'reautorizar tudo, cliente a cliente. Traga-as para o cofre primeiro ' +
            '(`cofre.cli.js migrar`). Se a intenção é só levar o COFRE para outra chave, ' +
            'sabendo que ENCRYPTION_KEY continua indispensável, diga isso com todas as letras: ' +
            '--aceitar-herdadas.',
        );
      }
    }

    const lote = Math.max(1, Math.min(opcoes.lote ?? 200, 1000));
    const simulado = opcoes.simular === true;
    const inventarioAntes = await this.inventario();

    const relatorio: RelatorioDeRotacao = {
      paraChaveId,
      simulado,
      candidatas: 0,
      recifradas: 0,
      puladasPorRevogacao: 0,
      puladasPorConcorrencia: 0,
      falhas: [],
      inventarioAntes,
      inventarioDepois: inventarioAntes,
      herdadas,
      duracaoMs: 0,
    };

    const porEmpresa = new Map<string, number>();
    /*
     * Paginação por `id` crescente, e não por `skip`: a varredura ESCREVE nas
     * linhas que lê (o `chaveId` muda), então um `skip` andaria por cima de
     * linhas ainda não visitadas a cada volta. Com cursor por id, uma linha que
     * sai do conjunto (porque acabou de ser rotacionada) não desloca as outras.
     */
    let cursor: string | null = null;

    for (;;) {
      const pagina: Array<{
        id: string;
        orgId: string;
        conector: string;
        nome: string;
        chaveId: string;
        valorCifrado: string;
      }> = await this.prisma.segredoDeConector.findMany({
        where: {
          chaveId: { not: paraChaveId },
          ...(opcoes.orgId ? { orgId: opcoes.orgId } : {}),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, orgId: true, conector: true, nome: true, chaveId: true, valorCifrado: true },
        orderBy: { id: 'asc' },
        take: lote,
      });

      if (pagina.length === 0) break;
      cursor = pagina[pagina.length - 1].id;

      for (const linha of pagina) {
        relatorio.candidatas += 1;

        if (!linha.valorCifrado) {
          // Revogada: o valor foi apagado de propósito. Re-cifrar string vazia
          // deixaria a linha com `chaveId` novo e nada dentro, e o inventário
          // passaria a contar como migrada uma linha que não tem segredo.
          relatorio.puladasPorRevogacao += 1;
          continue;
        }
        if (simulado) continue;

        try {
          const aad = dadoAssociado(linha.orgId, linha.conector, linha.nome);
          const cru = decifrar(linha.valorCifrado, { aad });
          const novo = cifrar(cru, { chaveId: paraChaveId, aad });

          /*
           * O `where` leva o valor ANTIGO. É o que impede a rotação de pisar em
           * cima de uma renovação de token que aconteceu entre a leitura e a
           * escrita — e essa corrida é real: conector que renova access token
           * sozinho grava no meio de qualquer varredura longa. Perdendo a
           * corrida, a linha já está na chave atual (foi `guardar` quem
           * escreveu) e não há nada a fazer.
           *
           * SQL CRU, E NÃO `updateMany`, POR UM MOTIVO SÓ: `atualizadoEm` é
           * `@updatedAt`, e o Prisma o reescreve em TODA escrita que passa por
           * ele. O schema diz, com todas as letras, que `rotacionadoEm` existe
           * porque "rotação não muda o segredo, só a chave que o embrulha" — e a
           * versão anterior mexia nos dois carimbos, apagando justamente a
           * distinção que os dois campos existem para guardar. Depois dela,
           * ninguém mais conseguiria responder "quando este segredo mudou pela
           * última vez?", que é a pergunta de auditoria.
           */
          const r = { count: 0 };
          r.count = await this.prisma.$executeRaw`
            UPDATE "SegredoDeConector"
               SET "valorCifrado" = ${novo},
                   "chaveId" = ${paraChaveId},
                   "rotacionadoEm" = now()
             WHERE "id" = ${linha.id}
               AND "valorCifrado" = ${linha.valorCifrado}`;

          if (r.count === 0) {
            relatorio.puladasPorConcorrencia += 1;
            continue;
          }
          relatorio.recifradas += 1;
          porEmpresa.set(linha.orgId, (porEmpresa.get(linha.orgId) ?? 0) + 1);
        } catch (e) {
          /*
           * UMA LINHA QUE FALHA NÃO PARA A ROTAÇÃO, e ela também não some: vai
           * para o relatório com empresa, conector, nome e a chave em que ficou.
           * Parar na primeira falha deixaria o cofre metade numa chave e metade
           * noutra sem ninguém saber qual metade; seguir sem registrar seria pior.
           * O comando sai com código 1 quando esta lista não está vazia.
           */
          relatorio.falhas.push({
            id: linha.id,
            orgId: linha.orgId,
            conector: linha.conector,
            nome: linha.nome,
            chaveId: linha.chaveId,
            erro: (e as Error).message,
          });
        }
      }
    }

    if (!simulado && porEmpresa.size > 0) {
      for (const [orgId, quantas] of porEmpresa) {
        await this.registrar(orgId, paraChaveId, quantas, opcoes.actorId ?? null);
      }
    }

    relatorio.inventarioDepois = await this.inventario();
    relatorio.herdadas = await this.herdadas();
    relatorio.duracaoMs = Date.now() - inicio;

    this.log.log(
      `rotação para "${paraChaveId}"${simulado ? ' (simulada)' : ''}: ` +
        `${relatorio.recifradas} re-cifrada(s), ${relatorio.puladasPorRevogacao} revogada(s), ` +
        `${relatorio.puladasPorConcorrencia} regravada(s) no meio, ${relatorio.falhas.length} falha(s)`,
    );
    return relatorio;
  }

  /**
   * O evento por empresa, no RASTRO da própria empresa.
   *
   * Por empresa e não um evento global porque o RASTRO é por empresa: um evento
   * de plataforma não teria onde morar, e quem audita a empresa X precisa ver,
   * no rastro DELA, que as credenciais dela foram re-cifradas naquele dia.
   *
   * O contexto é aberto na empresa (`comContexto`) pelo mesmo motivo do expurgo:
   * o isolamento por linha continua valendo durante a operação e o evento nasce
   * com o dono certo, mesmo que um dia isto deixe de rodar como superusuário.
   */
  private async registrar(
    orgId: string,
    paraChaveId: string,
    quantas: number,
    actorId: string | null,
  ): Promise<void> {
    if (!this.eventos) return;
    try {
      await comContexto(
        {
          orgId,
          actorType: ActorType.user,
          actorId,
          correlationId: novaCorrelacao('rotacao'),
          origem: 'script',
        },
        () =>
          this.eventos!.registrar({
            orgId,
            tipo: 'cofre.chave.rotacionada',
            actorType: ActorType.user,
            actorId,
            conteudo: {
              argumentos: { paraChaveId },
              resultado: { recifradas: quantas },
              motivo: 'rotação de chave do cofre (RF-C-04)',
              /*
               * O NÚMERO, nunca os ids das chaves de cada linha. O antes e o
               * depois aqui são de CHAVE, e chave é o que protege o segredo —
               * escrever "estas 12 linhas estavam em k1" num registro que a
               * empresa lê entrega o mapa de qual material abre o quê.
               */
              estadoAnterior: { recifradas: 0 },
              estadoNovo: { recifradas: quantas, chaveId: paraChaveId },
            },
            sensibilidade: 'interna',
          }),
      );
    } catch (e) {
      this.log.error(
        `rotação da empresa ${orgId} NÃO foi registrada no rastro: ${(e as Error).message} — ` +
          `as ${quantas} linha(s) JÁ estão re-cifradas.`,
      );
    }
  }
}
