import { randomBytes } from 'node:crypto';

import type { ResumoDoRoster } from '../agents/roster';
import {
  ProvisionamentoInvalidoError,
  SLUG_DA_PLATAFORMA,
  type EntradaDeProvisionamento,
  type Provisionamento,
} from '../tenants/provisionar';

/* ==========================================================================
 * O CADASTRO — a empresa nasce sem ninguém da ROOT no caminho (RF-O-01)
 * ==========================================================================
 *
 * NÃO REESCREVE O PROVISIONAMENTO. `tenants/provisionar.ts` já é idempotente,
 * já registra intenção e nascimento no RASTRO, já audita a chamada recusada e
 * já cria papéis, permissões e o primeiro administrador numa transação só.
 * Este arquivo faz as três coisas que faltavam para aquilo virar porta de
 * entrada de quem a ROOT nunca viu:
 *
 *   1. ESCOLHE O IDENTIFICADOR. Quem chega não sabe o que é um slug e não
 *      deveria precisar saber. Ele é derivado do nome da empresa;
 *   2. RESOLVE A COLISÃO SEM CONTAR NADA A QUEM PERGUNTOU (ver abaixo);
 *   3. SEMEIA O ROSTER, para que a empresa nasça com o carregador de contexto
 *      e o assistente já de pé — ninguém vai rodar comando por ela.
 *
 * ----------------------------------------------------------------------------
 * TODO IDENTIFICADOR NASCE COM SUFIXO ALEATÓRIO — SEMPRE, NÃO SÓ NA COLISÃO
 * ----------------------------------------------------------------------------
 * O caminho óbvio seria `acme`, `acme-2`, `acme-3`. Ele transforma uma rota
 * anônima num oráculo: quem quiser saber se a empresa X já é cliente da ROOT
 * manda o nome dela e lê o sufixo da resposta. É o mesmo defeito que
 * `events.controller.ts` documenta na rota do pixel ("a rota anônima responde
 * sempre a mesma coisa"), e foi pago lá pelo mesmo motivo.
 *
 * A PRIMEIRA ENTREGA DESTA FATIA PAROU NA METADE DO CONSERTO: trocou o contador
 * por sufixo aleatório, mas só NA COLISÃO — então `acme` limpo continuava
 * querendo dizer "ninguém tinha esse nome" e `acme-7f3k` continuava querendo
 * dizer "alguém tinha". A resposta HTTP não conta nada, é verdade; só que quem
 * se cadastra ENTRA, e a leitura de estado devolve `empresa.slug`. O oráculo
 * sobrevivia com um salto, ao preço de uma conta descartável.
 *
 * Com sufixo em TODO identificador, a presença dele deixa de ser informação: um
 * nome livre e um nome ocupado produzem slugs indistinguíveis. O que sobra de
 * canal lateral é o TEMPO da chamada (criar escreve mais do que não criar), e
 * quem contém isso é o teto de taxa (`teto-de-taxa.ts`), não este arquivo.
 *
 * O CUSTO, dito: identificador de empresa deixa de ser bonito (`acme-7f3k`).
 * Ele não aparece em URL pública nenhuma do produto — a bio usa `@handle`, a
 * Central usa caminho fixo — e o nome que a pessoa vê na tela é `Org.name`,
 * que é exatamente o que ela digitou.
 *
 * ----------------------------------------------------------------------------
 * ORDEM DE DEPLOY: ESTA ROTA DEPENDE DE UMA DÍVIDA QUE AINDA NÃO FOI PAGA
 * ----------------------------------------------------------------------------
 * Não é dívida desta fatia, mas esta fatia é o primeiro consumidor NOVO dela, e
 * por isso o fato fica escrito aqui, com precisão:
 *
 * `src/prisma/contexto-de-plataforma.ts` mantém duas listas. `CHAMADORES_DE_PLATAFORMA`
 * é o que JÁ declara o contexto de plataforma (hoje: só `obsidian.service.ts`).
 * `CAMINHOS_DE_PLATAFORMA_EXIGIDOS` é o que TEM de declarar antes de a aplicação
 * poder conectar como papel restrito — e três entradas dela seguem sem par:
 * `auth/auth.service.ts`, `auth/google-login.service.ts` e **`tenants/provisionar.ts`**,
 * que é exatamente o que esta rota chama.
 *
 * O QUE ACONTECE NO DIA DA VIRADA, medido em `sessao-de-banco.ts`: com conexão
 * restrita e `caminhosDePlataformaFaltando()` não vazio, `anunciarPapel` LANÇA e
 * **a API RECUSA SUBIR**. Não é login quebrado em silêncio — é arranque
 * interrompido, de propósito, porque cada um daqueles caminhos passaria a
 * devolver ZERO LINHA sem erro.
 *
 * A consequência para esta rota, se alguém contornasse a recusa: `acharOrg`
 * procura a empresa pelo slug ANTES de decidir criar; sem a sentinela ele
 * concluiria que nenhuma existe e tentaria criar DUPLICATA a cada cadastro.
 *
 * Nada a fazer aqui — `src/prisma/` e `src/auth/` não são arquivos desta fatia.
 * Está no relatório, em FORA DO ESCOPO, com os três caminhos nomeados.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE CAMINHO NÃO FAZ, e é decisão e não esquecimento: NÃO MANDA E-MAIL.
 * ----------------------------------------------------------------------------
 * Mandar e-mail é ação sobre sistema de terceiro, classificada R3 no catálogo
 * (`email.enviar`). Numa empresa recém-criada existe UM usuário com alçada, e
 * quem propõe não pode aprovar (`approvals/aprovador.ts`): uma confirmação por
 * e-mail no caminho de entrada ficaria presa na fila de aprovação da própria
 * empresa que ela deveria abrir, para sempre. A confirmação de identidade
 * acontece onde ela já existe e não custa aprovação nenhuma: no login com a
 * conta Google, que exige e-mail verificado pelo próprio Google
 * (`auth/google-login.service.ts`).
 */

/** O que quem chega preenche. Duas linhas: o nome da empresa e quem é ele. */
export interface EntradaDoCadastro {
  empresa: string;
  responsavel: { nome: string; email: string };
}

export interface OpcoesDoCadastro {
  /**
   * Quem provisiona. É callback porque a operação de verdade
   * (`provisionarTenant`) precisa do cliente do banco e das cascas do Nest
   * (RASTRO, auditoria, contexto de execução) que só existem em tempo de
   * aplicação — e porque a suíte precisa chamá-la sem levantar o Nest. É o
   * mesmo desenho de `OpcoesDeProvisionamento`.
   */
  provisionar: (entrada: EntradaDeProvisionamento) => Promise<Provisionamento>;
  /** Semeia o roster da empresa nova. Ausente = a empresa nasce sem agente. */
  semear?: (orgId: string, donoId: string | null) => Promise<ResumoDoRoster>;
  /** O sufixo da colisão. Existe para o teste poder prendê-lo. */
  sufixo?: () => string;
  /** Quantas vezes tentar antes de desistir. Ver `CadastroSemSlugError`. */
  tentativas?: number;
}

export interface Cadastro {
  orgId: string;
  slug: string;
  nome: string;
  /** `false` quando a empresa já existia — só acontece em reenvio do formulário. */
  criada: boolean;
  adminUserId: string | null;
  /** Quantas vezes o slug colidiu antes de achar um livre. */
  colisoes: number;
  roster: ResumoDoRoster | null;
  /** O que o provisionamento denunciou. Vazio é o desfecho saudável. */
  avisos: string[];
}

/** O nome da empresa não sobrou nada depois de virar identificador. */
export class CadastroInvalidoError extends Error {
  constructor(readonly campo: 'empresa' | 'email' | 'nome', mensagem: string) {
    super(mensagem);
    this.name = 'CadastroInvalidoError';
  }
}

/** O e-mail já pertence a outra empresa — quem chegou já tem conta. */
export class EmailJaTemCasaError extends Error {
  constructor(readonly email: string) {
    super(
      `o e-mail ${email} já pertence a outra empresa no sistema. Nada foi criado: quem já tem ` +
        'conta entra pelo login, não pelo cadastro.',
    );
    this.name = 'EmailJaTemCasaError';
  }
}

/** Nem o nome nem os sufixos acharam identificador livre. */
export class CadastroSemSlugError extends Error {
  constructor(readonly base: string, readonly tentativas: number) {
    super(
      `não foi possível achar um identificador livre a partir de "${base}" em ${tentativas} ` +
        'tentativa(s). Isso é colisão de sufixo aleatório repetida, o que na prática significa ' +
        'outro problema — investigue antes de aumentar o número de tentativas.',
    );
    this.name = 'CadastroSemSlugError';
  }
}

/**
 * Identificadores que o cadastro nunca entrega, aconteça o que acontecer.
 *
 * `root` é a empresa da PLATAFORMA (`SLUG_DA_PLATAFORMA`). Uma empresa chamada
 * "Root" derivaria exatamente aquele slug e a rodada cairia no modo `criar`
 * sobre a empresa da casa — que não escreve configuração (`ModoDeProvisionamento`
 * cuida disso), mas devolveria `criada: false` e o cadastro seguiria adiante com
 * uma rodada desperdiçada em cima da empresa mais sensível do banco.
 *
 * DEPOIS DO SUFIXO OBRIGATÓRIO isto é CINTO, não a única trava: `root` + sufixo
 * nunca é `root`. Continua aqui porque a conferência custa uma busca em
 * conjunto e porque o dia em que alguém mexer na montagem do slug ela é o que
 * segura o estrago. `ehReservado` é exportada para a suíte poder medir o
 * resultado de `abrirEmpresa` contra ela, em vez de reimplementar a lista.
 */
const RESERVADOS: ReadonlySet<string> = new Set([
  SLUG_DA_PLATAFORMA,
  'api',
  'admin',
  'app',
  'www',
  'bio',
  'central',
  'login',
  'entrar',
]);

/** Este identificador é dos que o cadastro nunca entrega? */
export function ehReservado(slug: string): boolean {
  return RESERVADOS.has(slug);
}

/** Quando o nome não sobra nada utilizável. */
const BASE_DE_ULTIMO_RECURSO = 'empresa';

/**
 * O nome da empresa vira a BASE do identificador — nunca o identificador.
 *
 * **Não use o retorno desta função como slug.** Ele é a metade legível; a outra
 * metade é o sufixo aleatório que `abrirEmpresa` cola em TODA empresa, e é ele
 * que impede a rota anônima de virar oráculo (ver o cabeçalho). Uma base pode
 * ser `root`, e é por isso que `abrirEmpresa` confere `ehReservado` no
 * identificador MONTADO, não aqui.
 *
 * O formato é o que `exigirSlug` cobra em `tenants/provisionar.ts`:
 * `^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`. A derivação acontece AQUI e a
 * validação continua LÁ — de propósito: se as duas divergirem um dia, quem
 * recusa é a operação, e o cadastro falha alto em vez de gravar um
 * identificador que o resto do sistema não reconhece.
 */
export function slugDaEmpresa(nome: string): string {
  const base = String(nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // "Ação" e "Acao" são o mesmo identificador
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, ''); // o corte em 40 pode ter deixado um hífen no fim

  return base.length >= 2 ? base : BASE_DE_ULTIMO_RECURSO;
}

/** Quatro letras e dígitos. Não é segredo; é só "outro identificador". */
function aleatorio(n: number): string {
  return randomBytes(16).toString('hex').replace(/[^a-z0-9]/g, '').slice(0, n) || 'a1b2';
}

/**
 * O identificador da próxima tentativa, com o sufixo colado sem estourar 40.
 *
 * Corta a BASE, nunca o sufixo: cortar o sufixo faria duas colisões diferentes
 * produzirem o mesmo identificador, que é o oposto do que ele existe para
 * fazer.
 */
export function comSufixo(base: string, sufixo: string): string {
  const teto = 40 - sufixo.length - 1;
  const cortada = base.slice(0, Math.max(1, teto)).replace(/-+$/g, '') || BASE_DE_ULTIMO_RECURSO;
  return `${cortada}-${sufixo}`;
}

/**
 * Abre a empresa. Idempotente no que importa: o mesmo e-mail não vira duas
 * empresas, porque `User.email` é único global e o provisionamento recusa
 * e-mail que já é de outra empresa.
 */
export async function abrirEmpresa(
  entrada: EntradaDoCadastro,
  opcoes: OpcoesDoCadastro,
): Promise<Cadastro> {
  const nome = String(entrada.empresa ?? '').trim();
  if (nome.length < 2) {
    throw new CadastroInvalidoError('empresa', 'o nome da empresa precisa ter ao menos 2 letras.');
  }
  const email = String(entrada.responsavel?.email ?? '').trim().toLowerCase();
  if (!email) throw new CadastroInvalidoError('email', 'informe o e-mail de quem vai administrar.');
  const nomeDoResponsavel = String(entrada.responsavel?.nome ?? '').trim();

  const base = slugDaEmpresa(nome);
  const sufixo = opcoes.sufixo ?? (() => aleatorio(4));
  const tentativas = Math.max(1, opcoes.tentativas ?? 3);

  let colisoes = 0;
  for (let i = 0; i < tentativas; i++) {
    /*
     * SUFIXO EM TODA TENTATIVA, inclusive na primeira — ver o cabeçalho. Até a
     * revisão desta fatia a primeira rodada usava a base limpa, e a presença do
     * sufixo virava resposta à pergunta "esse nome já existe?".
     */
    const slug = comSufixo(base, sufixo());
    // CINTO: não pode acontecer com sufixo, e é por isso que ele é barato.
    if (ehReservado(slug)) continue;

    let provisionamento: Provisionamento;
    try {
      provisionamento = await opcoes.provisionar({
        slug,
        nome,
        // `modo: 'criar'` é o único modo aceitável aqui, e o motivo é o mesmo
        // que trava a rota de plataforma: em empresa que já existe, `criar` não
        // escreve configuração nenhuma. Sem isso, um cadastro com o nome de uma
        // empresa cliente plantaria um administrador dentro dela.
        modo: 'criar',
        admin: { email, nome: nomeDoResponsavel || undefined },
      });
    } catch (e) {
      if (
        e instanceof ProvisionamentoInvalidoError &&
        e.motivo === 'email-de-outra-empresa'
      ) {
        throw new EmailJaTemCasaError(email);
      }
      throw e;
    }

    if (!provisionamento.criada) {
      // O identificador estava ocupado. Nada foi escrito na empresa alheia
      // além do conserto de catálogo que o provisionamento faz em qualquer
      // rodada (papéis e permissões do produto, que não concedem acesso a
      // ninguém). Tenta outro.
      colisoes++;
      continue;
    }

    const adminUserId = provisionamento.admin?.userId ?? null;

    /*
     * A SEMENTE NÃO DERRUBA O CADASTRO — e a assimetria é a correção de um
     * defeito real, não zelo.
     *
     * São DUAS escritas sem transação comum (a empresa nasce no
     * provisionamento; os agentes, aqui). Quando a segunda falhava, a exceção
     * subia até o controlador, que devolve a MESMA resposta para todo desfecho:
     * a pessoa lia "conta criada", entrava, e encontrava uma empresa sem agente
     * nenhum — sem nada que re-semeasse, porque a semente só rodava no cadastro.
     *
     * Agora a falha vira AVISO (o cadastro segue e a empresa existe) e o
     * conserto é `garantirRoster`, que roda em TODA leitura de estado da
     * entrada: a primeira abertura da tela repara o que faltou. Ver
     * `onboarding.service.ts` e `agents/roster/semear.ts`.
     */
    let roster: ResumoDoRoster | null = null;
    let falhaDaSemente: string | null = null;
    if (opcoes.semear) {
      try {
        roster = await opcoes.semear(provisionamento.orgId, adminUserId);
      } catch (e) {
        falhaDaSemente =
          `[roster-nao-semeado] a empresa nasceu mas os agentes do roster NÃO foram criados ` +
          `(${(e as Error).message}). A primeira abertura de /entrar repara isso ` +
          '(`garantirRoster`); até lá a empresa não tem assistente.';
      }
    }

    return {
      orgId: provisionamento.orgId,
      slug: provisionamento.slug,
      nome: provisionamento.nome,
      criada: true,
      adminUserId,
      colisoes,
      roster,
      avisos: [
        ...provisionamento.avisos.map((a) => `[${a.codigo}] ${a.texto}`),
        ...(roster?.avisos ?? []).map((a) => `[${a.codigo}] ${a.texto}`),
        ...(falhaDaSemente ? [falhaDaSemente] : []),
      ],
    };
  }

  throw new CadastroSemSlugError(base, tentativas);
}
