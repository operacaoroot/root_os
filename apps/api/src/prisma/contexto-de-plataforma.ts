import {
  ContextoExecucao,
  comContexto,
  contextoAtual,
  novaCorrelacao,
} from '../common/contexto-execucao';

/*
 * A SEGUNDA SENTINELA: O CONTEXTO DE PLATAFORMA — RF-T-02, RF-T-04
 * ================================================================
 *
 * O PROBLEMA, QUE É O MESMO DA FATIA 1.4 COM OUTRA ROUPA
 * A fatia 1.4 resolveu a rota pública com uma sentinela: "estou descobrindo de
 * qual empresa é este pedido" virou um estado DECLARADO
 * (`common/tenant-publico.ts`), e não a ausência de estado.
 *
 * Existe uma segunda família de consultas com exatamente a mesma forma, e ela
 * não é pública — é de PLATAFORMA. São as consultas que rodam antes de existir
 * empresa porque é justamente ELAS que descobrem a empresa:
 *
 *   · o LOGIN por senha procura o usuário pelo e-mail. Antes de haver sessão não
 *     há empresa; é o `User.orgId` encontrado que vira a empresa da sessão.
 *     (`src/auth/auth.service.ts`)
 *   · o LOGIN COM GOOGLE faz o mesmo e ainda procura a empresa da casa pelo slug
 *     fixo. (`src/auth/google-login.service.ts`)
 *   · o PROVISIONAMENTO procura a empresa pelo slug ANTES de decidir se cria ou
 *     reconfigura — a única consulta dele que roda sem empresa resolvida, e que
 *     já traduz a falta num erro com nome (`ProvisionamentoSemPlataformaError`,
 *     `src/tenants/provisionar.ts`).
 *   · o CONECTOR DO CLICKUP e o FINANCEIRO resolvem a empresa da casa por slug
 *     fixo (`src/integrations/clickup.service.ts`, `src/finance/finance.service.ts`).
 *   · a REINDEXAÇÃO DO OBSIDIAN, que roda no arranque e de meia em meia hora —
 *     fora de qualquer requisição (`src/obsidian/obsidian.service.ts`).
 *   · o CARREGAMENTO DA POLÍTICA no `onModuleInit`, que lê a `PolicyVersion`
 *     base (a de `orgId` nulo) antes de existir qualquer requisição
 *     (`src/policy/policy.service.ts`).
 *   · a SONDA DE SAÚDE, que faz `SELECT 1` e não toca tabela nenhuma
 *     (`src/health/health.controller.ts`).
 *
 * DESSES OITO, UM SÓ DECLARA HOJE (a reindexação do Obsidian). Os outros sete
 * são arquivos de outros módulos e ainda não foram ligados. Isso NÃO é uma nota
 * de rodapé: com o papel restrito e sem eles, o login devolve zero linha e vira
 * "credenciais inválidas" para todo mundo, calado. Por isso as duas listas
 * abaixo (`CHAMADORES_DE_PLATAFORMA`, o que já declara;
 * `CAMINHOS_DE_PLATAFORMA_EXIGIDOS`, o que precisa declarar) são COMPARADAS NO
 * ARRANQUE: conexão restrita com a lista incompleta **não sobe**
 * (`anunciarPapel`, em `sessao-de-banco.ts`). Preencher `DB_APP_USER` e
 * `DB_APP_PASSWORD` achando que está fazendo a coisa segura passou a ser um erro
 * alto, e não uma tela de login que recusa todo mundo.
 *
 * POR QUE NÃO SERVE RODAR "SEM EMPRESA"
 * O mesmo motivo da 1.4, e ele piora aqui: empresa vazia é o valor padrão de
 * TUDO que ninguém resolveu. Abrir a policy para o vazio seria abrir para toda
 * consulta distraída do sistema. Com a sentinela, "sou a plataforma procurando a
 * empresa" é uma declaração, escrita no código de quem declara e legível na
 * policy.
 *
 * O QUE A POLICY LIBERA PARA ESTA SENTINELA — o contrato, e só ele
 * (migration `20260911050000_isolamento_por_linha`):
 *
 *   LEITURA, e só leitura, em CINCO lugares:
 *     · `Org`             — a empresa por id ou por slug;
 *     · `User`            — o usuário por e-mail (é o que o login procura);
 *     · `Role`            — os papéis do usuário encontrado;
 *     · `_UserRoles` e `_RolePermissions` — as junções que o login percorre para
 *       montar a lista de permissões do token;
 *     · `PolicyVersion`   — a versão base da política, no arranque.
 *
 *   ESCRITA, NUNCA. Nem uma tabela, nem uma coluna. Quem escreve já sabe de que
 *   empresa é a linha — e por isso escreve DENTRO do contexto da empresa, não
 *   sob a sentinela. Foi assim que a primeira versão da 1.4 reprovou: uma policy
 *   `FOR ALL` sem `WITH CHECK` reusa a cláusula de leitura como verificação de
 *   escrita, e a sentinela virava chave de gravação em empresa alheia.
 *
 * A DIFERENÇA PARA A SENTINELA PÚBLICA, E O QUE ELA CUSTA
 * A da 1.4 NÃO é exportada: só as quatro resoluções daquele arquivo rodam sob
 * ela, e isso é metade da defesa. Esta É exportada, porque os caminhos que
 * precisam dela moram em seis módulos diferentes e nenhum deles pode ser trazido
 * para cá.
 *
 * O que contém o estrago, então, são três coisas, nesta ordem:
 *
 *  1. A POLICY SÓ DÁ LEITURA, nas cinco tabelas acima. Código arbitrário rodando
 *     aqui dentro não escreve nada em lugar nenhum, e não lê nada de lead, de
 *     financeiro, de bio, de conhecimento ou de RASTRO.
 *  2. O INVÓLUCRO RESPEITA A EMPRESA JÁ RESOLVIDA (ver `comContextoDePlataforma`):
 *     dentro de um tenant ele é passagem direta. Um caminho autenticado que
 *     chame isto por engano NÃO sai da própria empresa, então não existe a
 *     "reabertura" que o revisor da 1.4 mediu.
 *  3. A LISTA DE QUEM PODE CHAMAR É VERSIONADA E COBRADA POR TESTE:
 *     `CHAMADORES_DE_PLATAFORMA`, mais abaixo, e o caso "só os caminhos
 *     declarados abrem o contexto de plataforma" em
 *     `apps/api/test/tenant-isolation.test.ts`. Chamada nova sem entrada na
 *     lista REPROVA a suíte — a decisão de ampliar o alcance da sentinela passa
 *     a aparecer em diff.
 *
 * O QUE ESTA SENTINELA NÃO É
 * Não é "modo administrador". Não vê dado de tenant nenhum. Não escreve. Quem
 * precisa atravessar empresas de verdade — semear, provisionar pela linha de
 * comando, migrar — usa a conexão DONA das tabelas, que é onde essas operações
 * já moram, e que o isolamento por linha não alcança (ver o cabeçalho da
 * migration).
 */

/**
 * O valor que `app.org_id` carrega enquanto um caminho de PLATAFORMA está
 * descobrindo a empresa. Estado declarado, não falta de estado.
 *
 * Não colide com empresa de verdade: `Org.id` é uuid e `Org.slug` é
 * minúsculo-com-hífen; nenhum dos dois produz `__`. E se alguém gravar isto num
 * `orgId` por engano, a chave estrangeira de `Org` derruba o INSERT na hora
 * (09-PADRÕES §3.4).
 */
export const ORG_PLATAFORMA = '__plataforma__';

/** Esta empresa é a sentinela de plataforma? (para teste e para guarda) */
export function ehContextoDePlataforma(orgId: string | null | undefined): boolean {
  return orgId === ORG_PLATAFORMA;
}

/**
 * Os caminhos que podem abrir o contexto de plataforma, e por quê.
 *
 * Versionada de propósito: ampliar esta lista é ampliar o alcance de uma
 * sentinela, e isso precisa passar por revisão em vez de acontecer num commit
 * sobre outro assunto. O caminho é relativo a `apps/api/`.
 */
export interface ChamadorDePlataforma {
  arquivo: string;
  /** A consulta que roda antes de haver empresa, e por que ela não tem como ter. */
  porQue: string;
}

export const CHAMADORES_DE_PLATAFORMA: readonly ChamadorDePlataforma[] = [
  {
    arquivo: 'src/obsidian/obsidian.service.ts',
    porQue:
      'a reindexação roda no arranque e a cada 30 min, fora de requisição: procura a empresa da ' +
      'casa pelo slug para saber em que empresa indexar. Da empresa encontrada em diante o ' +
      'trabalho inteiro roda dentro dela.',
  },
] as const;

/**
 * OS CAMINHOS QUE **PRECISAM** DECLARAR O CONTEXTO ANTES DA VIRADA — a metade
 * que faltava.
 *
 * `CHAMADORES_DE_PLATAFORMA` é o que JÁ declara. Esta lista é o que TEM de
 * declarar para a aplicação poder conectar como papel restrito. As duas juntas
 * são a única forma de a pergunta "já dá para virar?" ter resposta em código em
 * vez de em comentário.
 *
 * Cada entrada aqui é uma consulta que roda antes de haver empresa. Sob
 * `mktos_app`, sem a sentinela, ela NÃO lança: devolve ZERO LINHA, calada. O
 * `porQue` de cada uma diz o que quebra, e nenhuma delas quebra com barulho —
 * é por isso que a conferência do arranque existe (`conferirCoberturaDePlataforma`
 * em `sessao-de-banco.ts`).
 *
 * POR QUE COMPARAR DUAS LISTAS DO MESMO ARQUIVO NÃO É TEATRO
 * Acrescentar uma entrada em `CHAMADORES_DE_PLATAFORMA` sem escrever a chamada
 * de verdade REPROVA a suíte: o caso "só os caminhos declarados abrem o contexto
 * de plataforma" (`test/tenant-isolation.test.ts`) lê o código-fonte e cobra que
 * o conjunto declarado seja EXATAMENTE o conjunto que importa este módulo. A
 * lista de baixo é o contrato; a de cima só cresce junto com o código; o
 * arranque compara as duas. Nenhum dos três elos sozinho bastaria.
 *
 * O arranque não pode fazer essa leitura de código por conta própria: no
 * container só existe `dist/`, e o `.ts` que a suíte varre não está lá.
 *
 * QUANDO TIRAR UMA ENTRADA DAQUI: quando o caminho deixar de existir, nunca
 * porque ele "ainda não foi feito". Encurtar esta lista é afrouxar a trava.
 */
export const CAMINHOS_DE_PLATAFORMA_EXIGIDOS: readonly ChamadorDePlataforma[] = [
  {
    arquivo: 'src/obsidian/obsidian.service.ts',
    porQue: 'a reindexação do arranque e do cron procura a empresa da casa pelo slug.',
  },
  {
    arquivo: 'src/auth/auth.service.ts',
    porQue:
      'o login por senha procura o usuário pelo e-mail antes de existir sessão. Sem a sentinela ' +
      'a busca devolve zero linha e TODO login vira "credenciais inválidas", sem erro no log.',
  },
  {
    arquivo: 'src/auth/google-login.service.ts',
    porQue:
      'o login com Google procura o usuário pelo e-mail e a empresa da casa pelo slug fixo. ' +
      'Mesmo sintoma do login por senha.',
  },
  {
    arquivo: 'src/tenants/provisionar.ts',
    porQue:
      '`acharOrg` procura a empresa pelo slug ANTES de decidir se cria ou reconfigura. Sem a ' +
      'sentinela ele conclui que a empresa não existe e tenta criar uma DUPLICATA.',
  },
  {
    arquivo: 'src/integrations/clickup.service.ts',
    porQue: 'resolve a empresa da casa por slug fixo antes de sincronizar.',
  },
  {
    arquivo: 'src/finance/finance.service.ts',
    porQue: 'resolve a empresa da casa por slug fixo antes de importar.',
  },
  {
    arquivo: 'src/policy/policy.service.ts',
    porQue:
      '`onModuleInit` carrega a `PolicyVersion` base (a de `orgId` nulo) antes de existir ' +
      'requisição. Sem a sentinela a política POR EMPRESA deixa de valer e o serviço cai na base ' +
      'empacotada — em silêncio, porque ele trata a falha e segue.',
  },
  {
    arquivo: 'src/health/health.controller.ts',
    porQue:
      'a sonda faz `SELECT 1` fora de requisição com empresa. Não toca tabela, mas passa pelo ' +
      'gancho da sessão: em `TENANT_MODO=impor` ela lança e a rota de saúde reporta banco fora ' +
      'do ar para sempre.',
  },
  {
    arquivo: 'src/bio/bio-sync.service.ts',
    porQue:
      'o cron da bio varre as conexões de TODAS as empresas: o sync dos desafios e a renovação ' +
      'do token de 60 dias da conta de publicação do Instagram (MD5). Sem empresa, em ' +
      '`TENANT_MODO=impor` a rodada lança e é engolida num aviso; sob `mktos_app` não acha conta ' +
      'nenhuma. Nos dois casos o token de publicação morre no dia 60 sem alarme. O conserto é ' +
      'listar as empresas sob a sentinela e renovar dentro de cada uma.',
  },
  {
    arquivo: 'src/bio/bio-oauth.controller.ts',
    porQue:
      'o callback público do OAuth lê o `BioOauthState` pelo state ANTES de saber a empresa, e ' +
      'depois grava a conexão e rebaixa a conta de publicação anterior. A sentinela sozinha não ' +
      'basta (a policy dela não abre `BioOauthState`): precisa de uma resolução declarada do ' +
      'state, como a das rotas públicas.',
  },
] as const;

/**
 * O que ainda falta declarar. Vazio = a virada para o papel restrito está
 * liberada no que diz respeito a esta trava.
 *
 * Compara por caminho de arquivo, que é a chave das duas listas.
 */
export function caminhosDePlataformaFaltando(
  declarados: readonly ChamadorDePlataforma[] = CHAMADORES_DE_PLATAFORMA,
  exigidos: readonly ChamadorDePlataforma[] = CAMINHOS_DE_PLATAFORMA_EXIGIDOS,
): ChamadorDePlataforma[] {
  const jaDeclarados = new Set(declarados.map((c) => c.arquivo));
  return exigidos.filter((e) => !jaDeclarados.has(e.arquivo));
}

/**
 * Monta o contexto de dentro a partir do de fora, trocando só a empresa.
 *
 * Correlação própria quando não há contexto de fora (arranque, cron, script):
 * linha de log sem correlação é linha que não se liga a nada (RNF-09).
 */
function comEmpresa(orgId: string): ContextoExecucao {
  const fora = contextoAtual();
  return {
    ...fora,
    orgId,
    correlationId: fora?.correlationId ?? novaCorrelacao('plataforma'),
    origem: fora?.origem ?? 'cron',
  };
}

/**
 * Roda a consulta que DESCOBRE a empresa, sob a sentinela de plataforma.
 *
 * Duas regras, as duas medidas na fatia 1.4 e repetidas aqui porque a armadilha
 * é a mesma:
 *
 *  · SÓ ABRE QUANDO NÃO HÁ EMPRESA. Dentro de um tenant é passagem direta, e o
 *    banco continua contendo aquele caminho como contém todos os outros dele.
 *  · `async () => await fn()`, nunca `fn` direto. A promessa do Prisma é
 *    PREGUIÇOSA: uma função que apenas DEVOLVE a promessa sai do escopo antes de
 *    a consulta começar, e o gancho da sessão de banco lê o contexto já fechado
 *    — empresa nula, e `SemTenantError` em modo `impor`.
 *
 * Use no MENOR trecho possível: só a consulta que descobre a empresa. O resto do
 * trabalho vai dentro da empresa encontrada, com `comContexto`.
 */
export async function comContextoDePlataforma<T>(fn: () => PromiseLike<T>): Promise<T> {
  const atual = contextoAtual()?.orgId;
  const jaResolvida = typeof atual === 'string' && atual.trim() !== '';
  if (jaResolvida) return await fn();
  return comContexto(comEmpresa(ORG_PLATAFORMA), async () => await fn());
}
