import { ROLES, type RoleKey } from '@mktos/shared';
import type { Alcada, Nivel } from '@mktos/policy';

/*
 * ALÇADA — a tradução entre o RBAC que já existe e a escada de risco.
 *
 * A escada guarda, em cada aprovação, a `alcadaMinima` que o nível exige
 * (`APROVACAO_POR_NIVEL`: operador em R2, responsavel em R3, titular em R4/R5).
 * Até 11/09/2026 esse campo era GRAVADO e nunca comparado com nada: R4 dizia
 * "exige alçada suficiente" e qualquer pessoa que alcançasse a rota aprovava.
 * O que faltava não era a régua — era esta tabela, que diz que autoridade cada
 * PAPEL carrega.
 *
 * O TIPO É O DA POLÍTICA, e isso é a trava que sustenta o resto. `Alcada` vem
 * de `@mktos/policy`, o mesmo tipo que `APROVACAO_POR_NIVEL` usa. `FORCA` é um
 * `Record<Alcada, number>` EXAUSTIVO: degrau novo na escada não compila aqui
 * antes de alguém decidir onde ele entra na ordem. A versão anterior comparava
 * por `indexOf` numa lista solta, e `indexOf` de valor desconhecido devolve -1:
 * QUALQUER alçada real satisfazia uma exigência desconhecida. Era inerte só
 * porque a escada tem três degraus; o quarto abriria a porta em silêncio, e o
 * `as` que convertia o valor do banco era justamente o que impedia o compilador
 * de avisar.
 *
 * OS MESMOS TRÊS VALORES VIVEM EM QUATRO LUGARES (anotado no relatório):
 * `packages/policy/src/escada.ts` (o tipo), `packages/policy/src/sobrescrita.ts`
 * (uma cópia local em `ORDEM_DA_ALCADA`), o `enum Alcada` do
 * `apps/api/prisma/schema.prisma` e — até esta fatia — mais uma aqui. Esta
 * sumiu: agora só existe a FORÇA de cada degrau, derivada do tipo da política.
 *
 * POR QUE AQUI E NÃO EM `packages/shared`, ao lado de `ROLES`
 * É lá que ela deveria morar: `ROLES` é a fonte do RBAC e a alçada é um atributo
 * do papel. Não foi para lá porque `packages/shared` não é desta fatia e outro
 * agente escreve nele agora; mover é uma linha e está anotado no relatório. O
 * acoplamento que importa já está preso: o `Record<RoleKey, …>` abaixo é
 * EXAUSTIVO, então papel novo em `ROLES` sem decisão de alçada não compila.
 *
 * QUEM APROVA É GENTE (invariante 7 da escada)
 * `ia_servico` e `ia_acao` são contas de máquina — e as duas têm `mcp.executar`,
 * que é justamente a permissão que a rota de confirmação exige. Sem esta tabela,
 * o agente que propôs não podia aprovar (a porta compara proponente e aprovador),
 * mas o OUTRO agente podia: bastava um segundo token de serviço.
 *
 * "NÃO É GENTE" E "É GENTE SEM AUTORIDADE" SÃO COISAS DIFERENTES, e é por isso
 * que a tabela devolve um objeto e não um valor anulável. `consulta_limitada` é
 * uma pessoa — só não é uma pessoa que responde por decisão nenhuma: o perfil
 * só lê. Com um `null` só, ela cairia na mensagem "conta de serviço (IA) não
 * confirma aprovação", que é falsa, ou ganharia o piso da escada, que é pior.
 */

/**
 * A força de cada degrau. É O ÚNICO lugar que sabe que titular > responsavel >
 * operador, e é exaustivo sobre o tipo da política de propósito.
 */
const FORCA_DA_ALCADA: Record<Alcada, number> = {
  operador: 1,
  responsavel: 2,
  titular: 3,
};

/**
 * O valor veio do banco (`Approval.alcadaMinima`), de um JSON de política ou de
 * um corpo de requisição: pergunte antes de comparar. O que a tabela não conhece
 * não é comparável, e não comparável é RECUSA — nunca "passa porque não sei".
 */
export function alcadaConhecida(v: unknown): v is Alcada {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(FORCA_DA_ALCADA, v);
}

/** A autoridade de um papel: ou é gente (com ou sem alçada), ou é máquina. */
type AutoridadeDoPapel =
  | { readonly gente: true; readonly alcada: Alcada | null }
  | { readonly gente: false };

/**
 * Papel → autoridade para aprovar.
 *
 * O critério é AUTORIDADE, não conjunto de permissões: `diretor` quase não
 * escreve no produto e ainda assim é titular; `analista` edita lead e campanha e
 * continua operador. Aprovar não é fazer — é responder pelo que foi feito. Pelo
 * mesmo critério, `consulta_limitada` não aprova nada: um perfil que só lê não
 * responde por ação nenhuma.
 */
const AUTORIDADE_POR_PAPEL: Record<RoleKey, AutoridadeDoPapel> = {
  admin_master: { gente: true, alcada: 'titular' },
  diretor: { gente: true, alcada: 'titular' },
  financeiro: { gente: true, alcada: 'responsavel' },
  gestor_marketing: { gente: true, alcada: 'responsavel' },
  analista: { gente: true, alcada: 'operador' },
  social_media: { gente: true, alcada: 'operador' },
  // Gente, sem autoridade: o perfil só lê (ver o cabeçalho).
  consulta_limitada: { gente: true, alcada: null },
  // Os papéis do módulo Totem são gente que opera loja e não aprova ação de
  // agente: nenhuma chave deles toca a fila de aprovação.
  totem_rede: { gente: true, alcada: null },
  totem_cd: { gente: true, alcada: null },
  totem_gerente: { gente: true, alcada: null },
  totem_operador: { gente: true, alcada: null },
  // Contas de máquina. Não é "alçada baixa", é "não é gente".
  ia_servico: { gente: false },
  ia_acao: { gente: false },
};

/** Os papéis que o catálogo conhece — o que não está aqui não concede nada. */
const PAPEL_CONHECIDO = (p: string): p is RoleKey => p in ROLES;

/**
 * Há conta de máquina no conjunto? Basta UMA para o ator inteiro deixar de ser
 * gente — um usuário que acumula `admin_master` e `ia_acao` é um caminho de
 * automação com cara de pessoa, e falha fechada é recusar.
 */
export function temPapelDeMaquina(papeis: readonly string[]): boolean {
  return papeis.some((p) => PAPEL_CONHECIDO(p) && !AUTORIDADE_POR_PAPEL[p].gente);
}

/**
 * A MAIOR alçada entre os papéis do ator, ou `null` quando nenhum papel
 * conhecido concede alguma.
 *
 * Papel desconhecido não concede nada — nem o piso. Papel some do catálogo,
 * papel escrito à mão no banco, papel de uma versão futura: todos caem em
 * `null`. É estrito de propósito: o erro caro aqui é conceder autoridade a quem
 * não se sabe quem é.
 */
export function alcadaDe(papeis: readonly string[]): Alcada | null {
  if (temPapelDeMaquina(papeis)) return null;

  let melhor: Alcada | null = null;
  for (const papel of papeis) {
    if (!PAPEL_CONHECIDO(papel)) continue;
    const autoridade = AUTORIDADE_POR_PAPEL[papel];
    if (!autoridade.gente || !autoridade.alcada) continue;
    if (!melhor || FORCA_DA_ALCADA[autoridade.alcada] > FORCA_DA_ALCADA[melhor]) {
      melhor = autoridade.alcada;
    }
  }
  return melhor;
}

/**
 * A alçada `tem` alcança a `minima` exigida?
 *
 * Sem alçada nunca alcança nada — e exigência DESCONHECIDA também não é
 * alcançada por ninguém. As duas recusas existem: a primeira é o caso comum, a
 * segunda é a que impede um degrau novo de virar porta aberta.
 */
export function atendeAlcada(minima: unknown, tem: Alcada | null): boolean {
  if (!alcadaConhecida(minima)) return false;
  if (!tem) return false;
  return FORCA_DA_ALCADA[tem] >= FORCA_DA_ALCADA[minima];
}

/** Para a mensagem de recusa: "é operador, e esta ação pede titular". */
export function descreverAlcada(a: Alcada | null): string {
  return a ?? 'nenhuma';
}

/**
 * TODAS as exigências que esta alçada alcança — para quem precisa PERGUNTAR AO
 * BANCO, e não conferir linha por linha.
 *
 * Nasceu na fatia A7 (a caixa pessoal): a caixa quer só as aprovações que a
 * pessoa pode assinar, e isso é um `WHERE alcadaMinima IN (...)`, não uma
 * varredura da fila inteira seguida de filtro em memória. Sem esta função a
 * caixa escreveria a ordem dos degraus por conta própria — a QUINTA cópia dos
 * mesmos três valores, exatamente a que o cabeçalho deste arquivo conta ter
 * apagado.
 *
 * DERIVA DE `atendeAlcada`, não de uma lista escrita à mão: o conjunto devolvido
 * é, por construção, o conjunto dos degraus que `atendeAlcada` aprova. É isso
 * que impede a consulta de trazer uma linha que a confirmação depois recusa — ou
 * de esconder uma que ela aceitaria. Sem alçada devolve vazio, e `IN ()` não
 * casa com nada, que é a recusa certa.
 */
export function alcadasAtendidasPor(tem: Alcada | null): Alcada[] {
  if (!tem) return [];
  return (Object.keys(FORCA_DA_ALCADA) as Alcada[]).filter((minima) =>
    atendeAlcada(minima, tem),
  );
}

/*
 * MOTIVO ESCRITO — a terceira perna de RF-A-03, ao lado da reautenticação e da
 * alçada. `avaliar()` já decide isto (`Decisao.exigeMotivo`), mas a decisão não
 * sobrevive à proposta: a linha da aprovação guarda o NÍVEL, não a decisão
 * inteira, e é do nível que a confirmação precisa derivar a exigência.
 *
 * A tabela é exaustiva sobre `Nivel` (degrau novo não compila) e o teste
 * `alcada-reautenticacao.test.ts` a prende a `avaliar()`, degrau por degrau —
 * se alguém mudar a régua e não mudar isto, fica vermelho.
 */
export const EXIGE_MOTIVO_POR_NIVEL: Record<Nivel, boolean> = {
  R0: false,
  R1: false,
  R2: false,
  R3: false,
  R4: true,
  R5: true,
};

/** O nível gravado na aprovação exige motivo escrito? Desconhecido exige. */
export function exigeMotivo(nivel: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXIGE_MOTIVO_POR_NIVEL, nivel)
    ? EXIGE_MOTIVO_POR_NIVEL[nivel as Nivel]
    : true;
}
