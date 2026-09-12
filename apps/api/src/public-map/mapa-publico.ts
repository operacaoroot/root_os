/*
 * O MAPA PÚBLICO — o núcleo PURO — fatia 6.5
 * ==========================================
 *
 * Nada aqui sabe de Nest, de HTTP nem de banco: entram as LINHAS PUBLICADAS e os
 * números lidos, sai o mapa que a página desenha. É o que permite ao teste
 * provar a montagem inteira sem subir aplicação nenhuma — e é onde mora, escrita
 * uma vez só, a cláusula que decide o que é público.
 *
 * A REGRA, E ONDE ELA VIVE
 * `SOMENTE_PUBLICADOS` é o filtro, e ele é UM: `orgId` da empresa resolvida e
 * `publicadoEm` não nulo. Está aqui, e não escrito à mão dentro do serviço, para
 * que exista um lugar único a apontar quando alguém perguntar "o que garante que
 * rascunho não vaza?".
 *
 * `PROJECAO` é o `select` — colunas nomeadas uma a uma. Nunca `select *`, nem
 * objeto inteiro do Prisma: `id`, `publicadoPor`, `criadoEm` e `atualizadoEm`
 * não têm o que fazer na resposta de uma rota anônima, e o jeito de não mandar
 * um campo é não o buscar.
 */

/** As cores do vocabulário de estado do painel. Desconhecida vira `muted`. */
export const TONS = ['brand', 'good', 'warn', 'bad', 'info', 'muted'] as const;
export type Tom = (typeof TONS)[number];

/** O eixo reservado do centro do mapa. */
export const EIXO_DO_NUCLEO = 'nucleo';

/**
 * Quantos nós a página aceita.
 *
 * Existe porque a consulta é anônima e o mapa é desenhado: mil linhas
 * publicadas por engano viram mil pontos num SVG e uma resposta que ninguém
 * pediu. O corte é pela MESMA ordem do desenho, então ele é estável — o que cai
 * fora é sempre o fim da lista, não uma amostra diferente a cada carregamento.
 */
export const TETO_DE_NOS = 60;

/** Uma linha publicada, já projetada. É o que o serviço busca e nada além. */
export interface LinhaPublicada {
  eixo: string;
  chave: string;
  ordem: number;
  rotulo: string;
  detalhe: string | null;
  tom: string;
  fonte: string | null;
}

export interface NoPublico {
  chave: string;
  rotulo: string;
  detalhe: string | null;
  tom: Tom;
  /** O número da fonte, quando a linha pediu uma e ela foi lida. */
  numero: number | null;
}

export interface EixoPublico {
  chave: string;
  rotulo: string;
  itens: NoPublico[];
}

export interface MapaPublico {
  geradoEm: string;
  nucleo: NoPublico | null;
  eixos: EixoPublico[];
}

/** O mapa de quem não publicou nada — e o de quem não existe. São o mesmo. */
export function mapaVazio(geradoEm: Date = new Date()): MapaPublico {
  return { geradoEm: geradoEm.toISOString(), nucleo: null, eixos: [] };
}

/**
 * O FILTRO. Empresa resolvida E marca explícita.
 *
 * `orgId` escrito à mão além do contexto de propósito: enquanto a aplicação
 * conectar como DONA das tabelas o isolamento por linha é inerte para ela, e uma
 * consulta sem `where` devolveria o mapa publicado de TODAS as empresas na
 * página da ROOT. A proteção tem de estar no código; a policy é a segunda
 * camada, não a primeira.
 */
export function SOMENTE_PUBLICADOS(orgId: string) {
  return { orgId, publicadoEm: { not: null } } as const;
}

/** As colunas que saem do banco — e, portanto, as únicas que podem sair na resposta. */
export const PROJECAO = {
  eixo: true,
  chave: true,
  ordem: true,
  rotulo: true,
  detalhe: true,
  tom: true,
  fonte: true,
} as const;

/** A ordem do desenho. Determinística: numa tela de venda o ponto não anda. */
export const ORDENACAO = [
  { eixo: 'asc' },
  { ordem: 'asc' },
  { chave: 'asc' },
] as const;

function tomValido(bruto: string): Tom {
  return (TONS as readonly string[]).includes(bruto) ? (bruto as Tom) : 'muted';
}

/** Esta linha é a CABEÇA do eixo (dá o nome dele e não vira ponto)? */
export function ehCabecaDeEixo(linha: { eixo: string; chave: string }): boolean {
  return linha.chave === linha.eixo;
}

/** Esta linha é o CENTRO do mapa? */
export function ehNucleo(linha: { eixo: string; chave: string }): boolean {
  return linha.eixo === EIXO_DO_NUCLEO && linha.chave === EIXO_DO_NUCLEO;
}

function no(linha: LinhaPublicada, numeros: ReadonlyMap<string, number>): NoPublico {
  return {
    chave: linha.chave,
    rotulo: linha.rotulo,
    detalhe: linha.detalhe,
    tom: tomValido(linha.tom),
    numero: linha.fonte != null && numeros.has(linha.fonte) ? numeros.get(linha.fonte)! : null,
  };
}

/**
 * Monta o mapa a partir das linhas publicadas.
 *
 * A CONVENÇÃO DAS CHAVES, inteira:
 *   · `eixo='nucleo'` e `chave='nucleo'` → o centro;
 *   · `chave` igual ao `eixo`            → cabeça do eixo: dá o nome e a POSIÇÃO
 *     do eixo em volta do centro (pela `ordem` dela). Não vira ponto;
 *   · qualquer outra                     → um ponto daquele eixo.
 *
 * Eixo sem cabeça publicada continua aparecendo, com a própria chave como nome e
 * posição no fim. É a escolha barulhenta de propósito: sumir com os pontos
 * porque falta a linha do título seria esconder o que alguém publicou.
 *
 * Nada aqui inventa nó: se a lista chega vazia, o mapa é vazio.
 */
export function montarMapa(
  linhas: readonly LinhaPublicada[],
  numeros: ReadonlyMap<string, number>,
  geradoEm: Date = new Date(),
): MapaPublico {
  const cortadas = linhas.slice(0, TETO_DE_NOS);

  const linhaDoNucleo = cortadas.find(ehNucleo) ?? null;

  /** eixo -> { cabeca, itens } */
  const porEixo = new Map<string, { cabeca: LinhaPublicada | null; itens: LinhaPublicada[] }>();

  for (const linha of cortadas) {
    if (ehNucleo(linha)) continue;
    // O eixo `nucleo` guarda o centro e nada mais: linha solta ali seria um
    // ponto sem lugar no desenho, e desenhá-la em cima do centro é pior que
    // ignorá-la. Fica de fora, e o teste cobra que fique.
    if (linha.eixo === EIXO_DO_NUCLEO) continue;

    const grupo = porEixo.get(linha.eixo) ?? { cabeca: null, itens: [] };
    if (ehCabecaDeEixo(linha)) grupo.cabeca = linha;
    else grupo.itens.push(linha);
    porEixo.set(linha.eixo, grupo);
  }

  const eixos: EixoPublico[] = [...porEixo.entries()]
    .map(([chave, grupo]) => ({
      chave,
      rotulo: grupo.cabeca?.rotulo ?? chave,
      // Eixo sem cabeça vai para o fim, e lá ordena pela chave.
      posicao: grupo.cabeca?.ordem ?? Number.MAX_SAFE_INTEGER,
      itens: grupo.itens.map((l) => no(l, numeros)),
    }))
    // `localeCompare` não: ele depende do locale do processo, e a ordem dos
    // eixos é desenho — dois servidores com locale diferente desenhariam o mesmo
    // mapa de dois jeitos.
    .sort((a, b) => a.posicao - b.posicao || (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0))
    .map(({ chave, rotulo, itens }) => ({ chave, rotulo, itens }));

  return {
    geradoEm: geradoEm.toISOString(),
    nucleo: linhaDoNucleo ? no(linhaDoNucleo, numeros) : null,
    eixos,
  };
}
