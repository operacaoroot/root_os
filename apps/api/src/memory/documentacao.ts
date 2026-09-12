/*
 * ============================================================================
 * O GERADOR DE DOCUMENTAÇÃO (RF-M-07) — o estado da empresa vira markdown
 * ============================================================================
 *
 * Um comando transforma o que a empresa DECLAROU — regras da casa, dicionário e
 * definições, decisões, fatos, agentes com o procedimento deles, rotinas e
 * conexões — numa base de conhecimento .md dentro da vault, com MARCADOR DE
 * GERAÇÃO. Quem chama é `src/scripts/gerar-documentacao.ts`.
 *
 * A escrita reaproveita o espelho da pauta (`src/pauta/espelho.service.ts`):
 * ele já sabe onde a vault está montada, já confere escape de pasta e já tem a
 * escolha entre os três destinos (off/local/drive). Não existe um segundo
 * escritor de arquivo neste repositório.
 *
 * ----------------------------------------------------------------------------
 * O SELO É UMA PROMESSA, E ELE AMARRA QUATRO COISAS, NÃO UMA
 * ----------------------------------------------------------------------------
 * Escrever `gerado_por: root-os` no frontmatter é a parte fácil. O que decide o
 * comportamento é o SELO (`gerado_selo`), e o que ele cobre foi a correção mais
 * importante desta fatia. A primeira versão resumia **só o corpo** — e isso
 * quebrava a promessa em quatro lugares de uma vez:
 *
 *   · EDIÇÃO SÓ NO CABEÇALHO ERA INVISÍVEL. O painel de propriedades do Obsidian
 *     edita exatamente isso: pôr uma etiqueta ou um apelido numa nota gerada é o
 *     jeito mais comum de uma pessoa anotar. Com o resumo cobrindo só o corpo, a
 *     propriedade sobrevivia enquanto o registro não mudasse e era DESTRUÍDA na
 *     primeira volta em que o corpo mudasse junto. Silencioso, e exatamente o
 *     caso que RF-M-07 promete impedir.
 *   · PÁGINA COPIADA OU RENOMEADA por cima do caminho de outra era lida como
 *     nossa e intocada, e reescrita: o conteúdo movido morria.
 *   · A MARCA ERA FORJÁVEL de acidente: qualquer arquivo com a estrutura certa
 *     (uma cópia de uma página gerada, um modelo) passava a ser sobrescrito.
 *   · O CAMPO QUE DIZ PARA QUAL EMPRESA a página foi gerada era escrito e nunca
 *     comparado. Chamar esta biblioteca com a mesma pasta para duas empresas
 *     reescrevia as páginas de uma com o conteúdo da outra. O comando se protege
 *     acrescentando o apelido da empresa ao caminho; a biblioteca, não — e é a
 *     biblioteca que promete.
 *
 * Hoje o selo resume, junto: a VERSÃO do formato, o `orgId` da empresa, o
 * CAMINHO relativo da página, TODAS as linhas do frontmatter (menos a dele
 * mesmo) e o CORPO. Mexer em qualquer um dos cinco muda o selo.
 *
 * O `orgId` entra no selo e NÃO é escrito no arquivo. É o que separa "acidente"
 * de "alguém quis": quem tem escrita na vault sempre pôde produzir um arquivo
 * com a nossa cara, e um selo não é assinatura; o que se compra aqui é que a
 * cara não se produz por acaso — cópia, modelo e renomeação deixam de passar,
 * porque o valor que fecha a conta não está em lugar nenhum da vault.
 *
 * `gerado_em` fica DENTRO do selo (é uma linha do cabeçalho como outra
 * qualquer), e mesmo assim não força reescrita: quem responde "o conteúdo
 * mudou?" é a comparação do corpo novo com o corpo que está no disco, não o
 * selo. O selo responde outra pergunta — "isto continua sendo exatamente o que
 * nós escrevemos, aqui, para esta empresa?".
 *
 * Os estados possíveis, e o que se faz com cada um:
 *
 *   1. NOSSA E INTOCADA — o selo confere. Pode reescrever. E se o corpo novo for
 *      igual ao que está lá, NÃO REESCREVE: mexer no arquivo só para trocar
 *      `gerado_em` mudaria o mtime, e mtime é o que faz o Obsidian reindexar e a
 *      memória gastar um vetor para registrar que nada mudou.
 *   2. NOSSA E EDITADA (corpo, cabeçalho, ou os dois) — o selo não confere.
 *      PRESERVA, sempre, sem exceção e sem opção de forçar. Uma opção `--forçar`
 *      transformaria a promessa em configuração, que é como toda promessa deste
 *      tipo morre. Para aceitar a versão nova, a pessoa apaga o arquivo e roda de
 *      novo; o resumo diz exatamente quais arquivos estão nesse estado.
 *   3. NUNCA FOI NOSSA — existe um .md com o nome que usaríamos e sem marcador.
 *      PRESERVA: colisão de nome com anotação de alguém é o caso mais provável.
 *   4. NOSSA DE OUTRO LUGAR — diz `gerado_caminho` diferente de onde está
 *      (cópia, renomeação, arquivo movido). PRESERVA, e o resumo diz de onde ela
 *      veio, que é o que permite desfazer o engano.
 *   5. NOSSA DE OUTRA EMPRESA — diz `gerado_para` diferente da empresa desta
 *      volta. PRESERVA: é a pasta compartilhada entre duas empresas.
 *   6. MARCADOR ILEGÍVEL — carrega o nosso nome e não traz selo, empresa ou
 *      caminho. PRESERVA: não prova nada, e o lado seguro é o mesmo.
 *
 * ----------------------------------------------------------------------------
 * AS TRÊS GUARDAS, NA LINHA DA ONDA 9
 * ----------------------------------------------------------------------------
 * A onda 9 descobriu, caro, que "o caminho existe" não é conferência: uma vault
 * vazia — ponto de montagem caído — devolvia lista vazia e a projeção arquivava
 * a memória inteira. O conserto foi RECUSA (lista vazia com notas vivas derruba
 * a volta antes de gravar) e TETO (arquivamento em massa não acontece sozinho).
 * Aqui a armadilha tem a mesma forma, com os papéis trocados: quem pode vir
 * vazio é o BANCO, e quem pode estar no lugar errado é a PASTA.
 *
 *   · RECUSA POR PASTA NÃO PROVADA — `conferirVaultDeVerdade` exige a marca de
 *     IDENTIDADE da vault (a pasta `.obsidian`), e não um sinal de vida
 *     qualquer: um `.md` na árvore é prova que o próprio sistema fabrica na volta
 *     anterior. Mora no espelho; ver o cabeçalho de lá.
 *
 *   · RECUSA POR ESTADO VAZIO OU COLAPSADO — zero de TUDO com páginas nossas já
 *     no disco (`EstadoVazioError`), ou uma FAMÍLIA inteira que existe no disco e
 *     voltou vazia do banco (`ColapsoParcialError`). A conferência não é
 *     conjuntiva de propósito: papel de banco sem BYPASSRLS enxerga ZERO linha
 *     na tabela que ele não alcança, não um pedaço — então "as regras sumiram
 *     todas e o resto veio" é a assinatura exata da leitura parcial, e nela o
 *     índice seria reescrito dizendo que a empresa não tem regra nenhuma.
 *
 *   · TETO DE REESCRITA — uma volta que reescreveria mais de
 *     `TETO_DE_REESCRITA` das páginas nossas já existentes E AINDA VIVAS (com
 *     piso de `PISO_DE_REESCRITA`) faz as CRIAÇÕES, que são aditivas, e segura as
 *     reescritas para uma decisão humana, DIZENDO QUAIS. Igual à onda 9,
 *     inclusive na parte de deixar a metade reversível passar. Órfã não entra no
 *     denominador: página que não corresponde mais a nada vivo não é candidata a
 *     reescrita, e contá-la afrouxaria o teto na exata proporção do lixo
 *     acumulado.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE GERADOR NÃO FAZ, E POR QUÊ
 * ----------------------------------------------------------------------------
 * NÃO APAGA. Página que deixou de corresponder a alguma coisa viva (a regra foi
 * arquivada, o agente sumiu) fica onde está, deixa de ser ligada pelo índice e é
 * listada no resumo como órfã. Apagar é decisão de gente: o espelho escreve numa
 * direção só, e do lado da vault pode haver edição que o banco nunca viu.
 *
 * NÃO EMITE `kind: nota`. Isso não é arbitrário — é o que fecha o laço de
 * realimentação: a vault é reindexada para `KnowledgeNote` e projetada para a
 * memória como `ContextSource.vault` + `ContextKind.nota`. Se a documentação
 * gerada saísse como `nota` e fosse reindexada, cada volta traria a memória de
 * volta para dentro de si mesma. Excluindo `nota` da geração, o eco morre num
 * salto e nunca cresce.
 *
 * O QUE O LAÇO FECHADO **NÃO** RESOLVE, E QUE ESTA FATIA NÃO PODE CONSERTAR
 * SOZINHA. O eco não cresce, mas o primeiro salto tem preço, e ele é recorrente:
 * as páginas geradas SÃO `.md` dentro da vault, então `ObsidianService.reindex`
 * as varre a cada 30 minutos e `embed()` revetoriza TODAS as notas a cada volta
 * — não só as que mudaram. Uma página por regra, definição, entrada de
 * dicionário, decisão, fato, agente e rotina quase dobra a conta de vetorização
 * da empresa, para sempre. Pior: essas páginas viram `ContextItem` de origem
 * `vault` e entram no DENOMINADOR do `TETO_DE_ARQUIVAMENTO` da onda 9, que é uma
 * fração das notas vivas — 400 páginas geradas sobem aquele teto de 20 para 100
 * e afrouxam, na mesma proporção, a guarda que protege as notas de verdade.
 * O conserto mora em `src/obsidian/obsidian.service.ts` e em
 * `src/memory/memoria.service.ts`, que não são desta fatia; está descrito em
 * FORA DO ESCOPO no relatório, com as duas saídas.
 *
 * NÃO ESCREVE NO RASTRO e NÃO PASSA PELA PORTA — pela mesma razão declarada em
 * `GoogleService.gravarArquivoNoDrive` e na exceção de `espelho.service.ts` na
 * catraca de arquitetura: é escrita do OS na vault DELE, disparada à mão por um
 * comando de manutenção, e não ação proposta por agente. Virar capacidade exige
 * entrada nova no catálogo, e capacidade nova em produção só entra por semente
 * assinada. Está anotado no relatório da fatia como decisão consciente.
 */
import { ContextKind, type PrismaClient } from '@prisma/client';
import { donosDaCasa } from '../agents/donos-da-casa';
import { hashDoCorpo } from './procedencia';
import {
  conferirVaultDeVerdade,
  lerDocumentoLocal,
  gravarDocumentoLocal,
  resolverPastaNaVault,
  slugDeArquivo,
} from '../pauta/espelho.service';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ============================================================================
// O MARCADOR
// ============================================================================

/** A chave e o valor que dizem "esta página é gerada". */
export const CHAVE_DA_MARCA = 'gerado_por';
export const VALOR_DA_MARCA = 'root-os';

/** Para qual empresa a página foi gerada (apelido). Escrito E comparado. */
export const CHAVE_DA_EMPRESA = 'gerado_para';

/** Em que caminho relativo a página foi gerada. Escrito E comparado. */
export const CHAVE_DO_CAMINHO = 'gerado_caminho';

/** O selo: resume versão + empresa + caminho + cabeçalho + corpo. */
export const CHAVE_DO_SELO = 'gerado_selo';

/**
 * A versão do formato do selo, DENTRO do próprio selo.
 *
 * Trocar o que o selo cobre sem trocar isto faria páginas antigas parecerem
 * "editadas à mão" pelo motivo errado. Com a versão dentro, a mudança é
 * explícita — e o lado seguro continua sendo o mesmo (preservar).
 */
export const VERSAO_DO_SELO = 'selo-v2';

export interface Marcador {
  /** O frontmatter traz `gerado_por: root-os`. */
  nosso: boolean;
  /** O `gerado_selo` declarado, ou `null` quando falta/é ilegível. */
  selo: string | null;
  /** O `gerado_para` declarado, ou `null`. */
  empresa: string | null;
  /** O `gerado_caminho` declarado, ou `null`. */
  caminho: string | null;
  /** As linhas do frontmatter, na ordem, MENOS a do selo. É o que o selo cobre. */
  cabecalhoSemSelo: string[];
}

/**
 * Quebra de linha e marca de ordem de bytes, normalizadas antes de qualquer
 * conferência.
 *
 * NÃO É ZELO: um arquivo nosso re-salvo por um editor de outro sistema vira
 * `---\r\n...`, e a conferência que perguntava `startsWith('---\n')` respondia
 * "não é frontmatter". A página deixava de ser reconhecida como nossa, virava
 * "alheia", era preservada para sempre e nunca mais recebia atualização — em
 * silêncio, que é o pior jeito de uma página parar de ser mantida. O mesmo vale
 * para o BOM que o Bloco de Notas e o Excel deixam no começo do arquivo.
 */
function normalizarTexto(texto: string): string {
  return String(texto ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
}

/**
 * O corpo de uma página: tudo depois do bloco de frontmatter da PRIMEIRA linha.
 *
 * Só o bloco inicial conta. Um `---` no meio do texto é régua horizontal em
 * markdown e não abre frontmatter nenhum — tratá-lo como abertura faria o corpo
 * de qualquer página com régua ser lido pela metade, e o selo nunca casaria.
 */
export function corpoDaPagina(texto: string): string {
  const t = normalizarTexto(texto);
  if (!t.startsWith('---\n')) return t;
  const linhas = t.split('\n');
  for (let i = 1; i < linhas.length; i++) {
    if (linhas[i].trim() === '---') return linhas.slice(i + 1).join('\n');
  }
  return t; // frontmatter aberto e nunca fechado: não é frontmatter
}

/** Desfaz o escape de `valorYaml`. Valor sem aspas volta como está. */
function lerValorYaml(bruto: string): string {
  if (!bruto.startsWith('"')) return bruto;
  try {
    const v: unknown = JSON.parse(bruto);
    return typeof v === 'string' ? v : bruto;
  } catch {
    return bruto;
  }
}

/** Lê o marcador do frontmatter inicial. */
export function lerMarcador(texto: string): Marcador {
  const vazio: Marcador = {
    nosso: false,
    selo: null,
    empresa: null,
    caminho: null,
    cabecalhoSemSelo: [],
  };
  const t = normalizarTexto(texto);
  if (!t.startsWith('---\n')) return vazio;

  const linhas = t.split('\n');
  const m: Marcador = { ...vazio, cabecalhoSemSelo: [] };
  let fechou = false;
  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (linha.trim() === '---') {
      fechou = true;
      break;
    }
    const corte = linha.indexOf(':');
    const chave = corte < 0 ? '' : linha.slice(0, corte).trim();
    const valor = corte < 0 ? '' : linha.slice(corte + 1).trim();

    if (chave === CHAVE_DO_SELO) {
      // 64 hexadecimais: sha256. Qualquer outra coisa é ilegível, e ilegível
      // recai no lado seguro (preserva) em vez de virar "não casou".
      if (/^[0-9a-f]{64}$/.test(valor)) m.selo = valor;
      // A linha do selo é a ÚNICA que fica fora do que o selo cobre — senão ele
      // teria de resumir a si mesmo.
      continue;
    }

    m.cabecalhoSemSelo.push(linha);
    if (chave === CHAVE_DA_MARCA && valor === VALOR_DA_MARCA) m.nosso = true;
    if (chave === CHAVE_DA_EMPRESA) m.empresa = lerValorYaml(valor);
    if (chave === CHAVE_DO_CAMINHO) m.caminho = lerValorYaml(valor);
  }
  // Frontmatter aberto e nunca fechado não é frontmatter: `corpoDaPagina`
  // devolve o texto inteiro, e aqui a leitura tem de dizer o mesmo.
  return fechou ? m : vazio;
}

/** Escapa um valor de frontmatter. Título com dois-pontos ou quebra quebraria o YAML. */
function valorYaml(v: string): string {
  return JSON.stringify(String(v ?? '').replace(/\r?\n/g, ' '));
}

/** O que amarra uma página ao lugar e à empresa dela. */
export interface ContextoDaPagina {
  /** O id interno da empresa. Entra no selo e NUNCA é escrito no arquivo. */
  orgId: string;
  /** O apelido da empresa. Vai escrito em `gerado_para`. */
  empresa: string;
  /** O caminho relativo da página dentro da pasta da empresa. */
  caminho: string;
}

/**
 * O SELO de uma página.
 *
 * Cobre, junto e na ordem: a versão do formato, o `orgId`, o caminho relativo,
 * todas as linhas do frontmatter menos a dele mesmo, e o corpo. Ver o cabeçalho
 * do arquivo para o porquê de cada um dos cinco.
 *
 * `hashDoCorpo` (e não um `createHash` local) porque ele já normaliza quebra de
 * linha e espaço nas pontas — as mesmas regras que decidem "o corpo mudou?".
 * Duas normalizações diferentes para o mesmo texto produziriam decisões que se
 * contradizem.
 *
 * O CORPO ENTRA PELO HASH DELE, e não em texto: a montagem separa o cabeçalho do
 * corpo com uma linha em branco, e a releitura devolve essa linha grudada no
 * começo do corpo. Concatenar os dois textos faria o selo de uma página recém-
 * escrita não fechar com o dela mesma relida — toda página nasceria "editada à
 * mão". Passando pelo hash, que apara as pontas, os dois lados dizem o mesmo.
 */
export function selarPagina(entrada: {
  cabecalhoSemSelo: string[];
  corpo: string;
  ctx: ContextoDaPagina;
}): string {
  return hashDoCorpo(
    [
      VERSAO_DO_SELO,
      entrada.ctx.orgId,
      entrada.ctx.caminho,
      ...entrada.cabecalhoSemSelo.map((l) => normalizarTexto(l)),
      hashDoCorpo(entrada.corpo),
    ].join('\n'),
  );
}

/**
 * Monta a página inteira: frontmatter com marcador + corpo.
 *
 * `gerado_em` é uma linha do cabeçalho como outra qualquer e entra no selo. Isso
 * NÃO faz toda volta reescrever: quem responde "mudou?" é a comparação do corpo
 * novo com o corpo do disco (ver `decidirEscrita`), e quando nada mudou a página
 * não é reescrita — então o `gerado_em` que está lá continua sendo o que selou.
 */
export function montarPagina(entrada: {
  corpo: string;
  ctx: ContextoDaPagina;
  tipo: string;
  geradoEm: Date;
  extras?: Record<string, string>;
}): string {
  const cabecalhoSemSelo = [
    `${CHAVE_DA_MARCA}: ${VALOR_DA_MARCA}`,
    `gerado_em: ${entrada.geradoEm.toISOString()}`,
    `${CHAVE_DA_EMPRESA}: ${valorYaml(entrada.ctx.empresa)}`,
    `${CHAVE_DO_CAMINHO}: ${valorYaml(entrada.ctx.caminho)}`,
    `tipo: ${entrada.tipo}`,
  ];
  for (const [k, v] of Object.entries(entrada.extras ?? {})) {
    cabecalhoSemSelo.push(`${k}: ${valorYaml(v)}`);
  }

  const selo = selarPagina({ cabecalhoSemSelo, corpo: entrada.corpo, ctx: entrada.ctx });
  return `${['---', ...cabecalhoSemSelo, `${CHAVE_DO_SELO}: ${selo}`, '---', ''].join('\n')}\n${
    entrada.corpo
  }`;
}

// ============================================================================
// A DECISÃO DE ESCRITA — os seis estados do cabeçalho
// ============================================================================

export type MotivoDePreservar =
  | 'alheia'
  | 'editada'
  | 'marcador-ilegivel'
  | 'de-outra-empresa'
  | 'de-outro-lugar';

export type Decisao =
  | { acao: 'criar' }
  | { acao: 'reescrever' }
  | { acao: 'inalterada' }
  | { acao: 'preservar'; motivo: MotivoDePreservar; declarado?: string };

/**
 * O que fazer com uma página, dado o que já está no disco.
 *
 * `atual` é o arquivo inteiro (frontmatter + corpo) ou `null` se não existe.
 * `corpoNovo` é só o corpo da página que acabamos de montar. `ctx` é a amarra:
 * para qual empresa e em que caminho esta página está sendo gerada AGORA.
 *
 * A ORDEM DAS PERGUNTAS É O DESENHO. Empresa e caminho são comparados em texto
 * claro ANTES do selo, e não porque o selo não pegaria (ele pega: os dois campos
 * estão no cabeçalho que ele resume) — é para o resumo da execução conseguir
 * dizer "esta página é de outra empresa" em vez de "alguém editou esta página".
 * Um diagnóstico errado manda a pessoa procurar no lugar errado.
 */
export function decidirEscrita(
  atual: string | null,
  corpoNovo: string,
  ctx: ContextoDaPagina,
): Decisao {
  if (atual === null) return { acao: 'criar' };

  const marcador = lerMarcador(atual);
  if (!marcador.nosso) return { acao: 'preservar', motivo: 'alheia' };
  if (!marcador.selo || marcador.empresa === null || marcador.caminho === null) {
    return { acao: 'preservar', motivo: 'marcador-ilegivel' };
  }
  if (marcador.empresa !== ctx.empresa) {
    return { acao: 'preservar', motivo: 'de-outra-empresa', declarado: marcador.empresa };
  }
  if (marcador.caminho !== ctx.caminho) {
    return { acao: 'preservar', motivo: 'de-outro-lugar', declarado: marcador.caminho };
  }

  const corpoDoDisco = corpoDaPagina(atual);
  const seloDoQueEstaLa = selarPagina({
    cabecalhoSemSelo: marcador.cabecalhoSemSelo,
    corpo: corpoDoDisco,
    ctx,
  });
  if (seloDoQueEstaLa !== marcador.selo) return { acao: 'preservar', motivo: 'editada' };

  // Daqui para baixo o arquivo é nosso, deste lugar, desta empresa, e está
  // intocado — cabeçalho e corpo — desde a última geração.
  if (hashDoCorpo(corpoDoDisco) === hashDoCorpo(corpoNovo)) return { acao: 'inalterada' };
  return { acao: 'reescrever' };
}

// ============================================================================
// O ESTADO DA EMPRESA
// ============================================================================

/** Os tipos de nota que viram documentação. `nota` fica de fora — ver o cabeçalho. */
export const TIPOS_DOCUMENTAVEIS = [
  ContextKind.regra,
  ContextKind.definicao,
  ContextKind.dicionario,
  ContextKind.decisao,
  ContextKind.fato,
] as const;
export type TipoDocumentavel = (typeof TIPOS_DOCUMENTAVEIS)[number];

/** A pasta de cada tipo de nota dentro da documentação da empresa. */
const PASTA_DO_TIPO: Record<TipoDocumentavel, string> = {
  regra: 'regras-da-casa',
  definicao: 'definicoes',
  dicionario: 'dicionario',
  decisao: 'decisoes',
  fato: 'fatos',
};

const ROTULO_DO_TIPO: Record<TipoDocumentavel, string> = {
  regra: 'Regra da casa',
  definicao: 'Definição',
  dicionario: 'Dicionário de dados',
  decisao: 'Decisão',
  fato: 'Fato do negócio',
};

export interface NotaDocumentavel {
  chave: string;
  kind: TipoDocumentavel;
  title: string;
  body: string;
  tags: string[];
  sourceType: string;
  sourceRef: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  versao: number;
  atualizadoEm: Date;
}

export interface AgenteDocumentavel {
  slug: string;
  nome: string;
  missao: string;
  pilar: string | null;
  tipo: string;
  estado: string;
  dono: string | null;
  capacidades: string[];
  autonomiaAte: string;
  modelo: string | null;
  cron: string | null;
  tz: string;
  ativo: boolean;
  minutosPorExecucao: number;
  tetoCustoUsd: string;
  sop: {
    proposito: string;
    gatilho: string;
    passos: string[];
    definicaoDePronto: string;
    observacoes: string | null;
    versao: number;
  } | null;
}

export interface RotinaDocumentavel {
  slug: string;
  nome: string;
  tipo: string;
  cron: string;
  tz: string;
  estado: string;
  ativo: boolean;
  origem: string;
  agenteSlug: string | null;
  minutosPorExecucao: number;
}

export interface ConexaoDocumentavel {
  key: string;
  label: string;
  status: string;
  conectadaEm: string | null;
}

export interface EstadoDoTenant {
  orgId: string;
  nome: string;
  slug: string;
  modulos: string[];
  notas: NotaDocumentavel[];
  agentes: AgenteDocumentavel[];
  rotinas: RotinaDocumentavel[];
  conexoes: ConexaoDocumentavel[];
}

/*
 * ----------------------------------------------------------------------------
 * O CLIENTE CRU ONDE SE ESPERA O SERVIÇO DO NEST — conferido, não desligado
 * ----------------------------------------------------------------------------
 * `donosDaCasa` declara `PrismaService`, e este comando tem um `PrismaClient`
 * cru, porque ele não sobe o Nest (ver o cabeçalho de `gerar-documentacao.ts`).
 * A conversão é segura porque `PrismaService extends PrismaClient {}` — sem
 * acrescentar um único membro — e a função só usa `user.findMany`.
 *
 * A primeira versão escrevia `as never`, que é o mesmo que desligar a
 * conferência: no dia em que `donosDaCasa` passasse a pedir algo que só o
 * serviço tem, nada avisaria. `SoNoServicoDeDonos` é a diferença entre as duas
 * superfícies; enquanto ela for vazia, a conversão é verdade. O teste de tipo em
 * `test/documentacao.test.ts` afirma isso, e é lá que a mudança fica vermelha.
 */

/** O que `donosDaCasa` pede. Nomeado para a conversão não ser um `as never`. */
export type ClienteDeDonos = Parameters<typeof donosDaCasa>[0];

/** O que `donosDaCasa` pede e o `PrismaClient` cru não tem. Vazio hoje. */
export type SoNoServicoDeDonos = Exclude<keyof ClienteDeDonos, keyof PrismaClient>;

/** Verdadeiro quando o banco não devolveu NADA de nada para esta empresa. */
export function estadoVazio(e: EstadoDoTenant): boolean {
  return (
    e.notas.length === 0 &&
    e.agentes.length === 0 &&
    e.rotinas.length === 0 &&
    e.conexoes.length === 0
  );
}

/**
 * Lê o estado documentável da empresa.
 *
 * Só o que está VIVO: nota arquivada não entra, porque documentação é o que
 * vale hoje. O histórico de quem arquivou o quê mora no RASTRO e nas versões.
 */
export async function coletarEstado(
  prisma: PrismaClient,
  orgId: string,
): Promise<EstadoDoTenant> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true, modulos: true },
  });
  if (!org) throw new Error(`empresa "${orgId}" não existe neste banco.`);

  const notas = await prisma.contextItem.findMany({
    where: {
      orgId,
      arquivadoEm: null,
      kind: { in: [...TIPOS_DOCUMENTAVEIS] },
    },
    select: {
      chave: true,
      kind: true,
      title: true,
      body: true,
      tags: true,
      sourceType: true,
      sourceRef: true,
      validFrom: true,
      validUntil: true,
      versao: true,
      atualizadoEm: true,
    },
    orderBy: [{ kind: 'asc' }, { title: 'asc' }],
  });

  const agentes = await prisma.agent.findMany({
    where: { orgId },
    include: { sop: true },
    orderBy: [{ nome: 'asc' }],
  });

  /*
   * O DONO SAI DE `donosDaCasa`, e não de um `include: { dono: true }`.
   *
   * `Agent.donoId` aponta para `User` sem par (usuário, empresa), e o Prisma não
   * filtra relação-para-um dentro do include: um ponteiro atravessado traria o
   * nome de gente da empresa vizinha para dentro de um arquivo .md que alguém lê
   * como sendo desta empresa. Já aconteceu em quatro lugares; ver o cabeçalho de
   * `src/agents/donos-da-casa.ts`.
   */
  const donos = await donosDaCasa(
    prisma as unknown as ClienteDeDonos,
    orgId,
    agentes.map((a) => a.donoId),
  );

  const rotinas = await prisma.rotina.findMany({
    where: { orgId },
    orderBy: [{ nome: 'asc' }],
  });

  const conexoes = await prisma.integrationAccount.findMany({
    where: { orgId },
    select: { key: true, label: true, status: true, connectedAt: true },
    orderBy: [{ key: 'asc' }],
  });

  return {
    orgId: org.id,
    nome: org.name,
    slug: org.slug,
    modulos: [...org.modulos].sort(),
    notas: notas.map((n) => ({
      chave: n.chave,
      kind: n.kind as TipoDocumentavel,
      title: n.title,
      body: n.body,
      tags: n.tags,
      sourceType: String(n.sourceType),
      sourceRef: n.sourceRef,
      validFrom: n.validFrom,
      validUntil: n.validUntil,
      versao: n.versao,
      atualizadoEm: n.atualizadoEm,
    })),
    agentes: agentes.map((a) => ({
      slug: a.slug,
      nome: a.nome,
      missao: a.missao,
      pilar: a.pilar,
      tipo: String(a.tipo),
      estado: String(a.estado),
      dono: donos.get(a.donoId ?? '')?.nome ?? null,
      capacidades: [...a.capacidades].sort(),
      autonomiaAte: String(a.autonomiaAte),
      modelo: a.modelo,
      cron: a.cron,
      tz: a.tz,
      ativo: a.ativo,
      minutosPorExecucao: a.minutosPorExecucao,
      tetoCustoUsd: String(a.tetoCustoUsd),
      sop: a.sop
        ? {
            proposito: a.sop.proposito,
            gatilho: a.sop.gatilho,
            passos: a.sop.passos,
            definicaoDePronto: a.sop.definicaoDePronto,
            observacoes: a.sop.observacoes,
            versao: a.sop.versao,
          }
        : null,
    })),
    rotinas: rotinas.map((r) => ({
      slug: r.slug,
      nome: r.nome,
      tipo: r.tipo,
      cron: r.cron,
      tz: r.tz,
      estado: String(r.estado),
      ativo: r.ativo,
      origem: r.origem,
      agenteSlug: r.agenteSlug,
      minutosPorExecucao: r.minutosPorExecucao,
    })),
    conexoes: conexoes.map((c) => ({
      key: c.key,
      label: c.label,
      status: String(c.status),
      conectadaEm: c.connectedAt ? c.connectedAt.toISOString().slice(0, 10) : null,
    })),
  };
}

// ============================================================================
// O MARKDOWN
// ============================================================================

export interface PaginaDeDocumentacao {
  /** Caminho relativo à pasta da empresa. Pode ter subpasta. */
  nome: string;
  /** Só o corpo — o frontmatter é acrescentado por `montarPagina`. */
  corpo: string;
  tipo: string;
  titulo: string;
}

/**
 * Texto de cliente dentro de um .md.
 *
 * NÃO é a neutralização de `context-builder` e não tenta ser: aquilo protege o
 * MODELO, e aqui nada vai para modelo nenhum. O que se protege é a leitura do
 * arquivo — um corpo que comece com `---` na primeira linha viraria frontmatter
 * de mentira na releitura, e o marcador deixaria de casar. Uma linha em branco
 * antes basta, e é o que a montagem já garante; o recuo aqui cobre o caso do
 * corpo colado logo abaixo de um cabeçalho.
 */
function corpoSeguro(texto: string): string {
  const limpo = String(texto ?? '').replace(/\r\n/g, '\n').trim();
  return limpo.length > 0 ? limpo : '_não consta_';
}

function campo(rotulo: string, valor: string | null | undefined): string {
  const v = valor === null || valor === undefined || String(valor).trim() === '';
  return `- **${rotulo}:** ${v ? '_não consta_' : String(valor).trim()}`;
}

function data(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** O nome do arquivo de uma nota. Sai da CHAVE, que é estável, não do título. */
export function nomeDaNota(n: { kind: TipoDocumentavel; chave: string }): string {
  return `${PASTA_DO_TIPO[n.kind]}/${slugDeArquivo(n.chave) || 'sem-chave'}.md`;
}

function paginaDeNota(n: NotaDocumentavel): PaginaDeDocumentacao {
  const vencida = n.validUntil !== null && n.validUntil.getTime() < Date.now();
  const corpo = [
    `# ${n.title}`,
    '',
    `> ${ROTULO_DO_TIPO[n.kind]} · versão ${n.versao} · procedência: ${n.sourceType}` +
      `${n.sourceRef ? ` (${n.sourceRef})` : ''}`,
    '',
    ...(vencida
      ? [
          `> **NÃO VALE MAIS DESDE ${data(n.validUntil)}.** Fica aqui porque explica decisão`,
          '> passada — validade vencida é diferente de nota arquivada.',
          '',
        ]
      : []),
    corpoSeguro(n.body),
    '',
    '## Procedência',
    '',
    campo('Chave', n.chave),
    campo('Origem', n.sourceType),
    campo('Referência', n.sourceRef),
    campo('Vale de', data(n.validFrom)),
    campo('Vale até', data(n.validUntil)),
    campo('Etiquetas', n.tags.length ? n.tags.join(', ') : null),
    campo('Atualizada em', data(n.atualizadoEm)),
    '',
  ].join('\n');

  return { nome: nomeDaNota(n), corpo, tipo: n.kind, titulo: n.title };
}

function paginaDeAgente(a: AgenteDocumentavel): PaginaDeDocumentacao {
  const corpo = [
    `# ${a.nome}`,
    '',
    `> Agente ${a.tipo} · ${a.estado}${a.ativo ? '' : ' · interruptor desligado'}`,
    '',
    corpoSeguro(a.missao),
    '',
    '## Como ele está configurado',
    '',
    campo('Apelido', a.slug),
    campo('Pilar', a.pilar),
    campo('Dono humano', a.dono),
    campo('Autonomia declarada até', a.autonomiaAte),
    campo('Capacidades', a.capacidades.length ? a.capacidades.join(', ') : null),
    campo('Modelo', a.modelo),
    campo('Agenda', a.cron ? `${a.cron} (${a.tz})` : null),
    campo('Teto de custo por execução (USD)', a.tetoCustoUsd),
    campo(
      'Minutos que uma pessoa gastava nisso',
      a.minutosPorExecucao > 0 ? String(a.minutosPorExecucao) : null,
    ),
    '',
    '## Procedimento',
    '',
    ...(a.sop
      ? [
          `_Versão ${a.sop.versao} do procedimento._`,
          '',
          campo('Propósito', a.sop.proposito),
          campo('Gatilho', a.sop.gatilho),
          '',
          '**Passos**',
          '',
          ...(a.sop.passos.length
            ? a.sop.passos.map((p, i) => `${i + 1}. ${String(p).replace(/\r?\n/g, ' ').trim()}`)
            : ['_não consta_']),
          '',
          campo('Definição de pronto', a.sop.definicaoDePronto),
          campo('Observações', a.sop.observacoes),
        ]
      : ['_Este agente ainda não tem procedimento escrito._']),
    '',
  ].join('\n');

  return { nome: `agentes/${slugDeArquivo(a.slug) || 'sem-apelido'}.md`, corpo, tipo: 'agente', titulo: a.nome };
}

function paginaDeRotina(r: RotinaDocumentavel): PaginaDeDocumentacao {
  const corpo = [
    `# ${r.nome}`,
    '',
    `> Rotina ${r.estado}${r.ativo ? '' : ' · interruptor desligado'} · origem ${r.origem}`,
    '',
    campo('Apelido', r.slug),
    campo('Executor', r.tipo),
    campo('Agenda', `${r.cron} (${r.tz})`),
    campo('Agente que a representa', r.agenteSlug),
    campo(
      'Minutos que uma pessoa gastava nisso',
      r.minutosPorExecucao > 0 ? String(r.minutosPorExecucao) : null,
    ),
    '',
    '> Só `rodando` e `aprendendo` disparam. `planejado` e `pausado` aparecem e não executam.',
    '',
  ].join('\n');

  return { nome: `rotinas/${slugDeArquivo(r.slug) || 'sem-apelido'}.md`, corpo, tipo: 'rotina', titulo: r.nome };
}

function paginaDeConexoes(e: EstadoDoTenant): PaginaDeDocumentacao {
  const corpo = [
    '# Conexões',
    '',
    'O que esta empresa ligou ao sistema, e em que estado cada ligação está.',
    '',
    ...(e.conexoes.length === 0
      ? ['_Nenhuma conexão configurada._']
      : [
          '| Conector | Nome | Estado | Conectado desde |',
          '| --- | --- | --- | --- |',
          ...e.conexoes.map(
            (c) =>
              `| ${c.key} | ${c.label.replace(/\|/g, '\\|')} | ${c.status} | ${c.conectadaEm ?? '—'} |`,
          ),
        ]),
    '',
    '> `disconnected` é estado honesto, não defeito: quer dizer que ninguém autorizou ainda.',
    '',
  ].join('\n');

  return { nome: 'conexoes.md', corpo, tipo: 'conexoes', titulo: 'Conexões' };
}

function paginaDeIndice(e: EstadoDoTenant, paginas: PaginaDeDocumentacao[]): PaginaDeDocumentacao {
  const porTipo = (tipo: string) => paginas.filter((p) => p.tipo === tipo);
  const secao = (rotulo: string, tipo: string): string[] => {
    const itens = porTipo(tipo);
    if (itens.length === 0) return [`### ${rotulo}`, '', '_nada declarado ainda_', ''];
    return [
      `### ${rotulo} (${itens.length})`,
      '',
      ...itens.map((p) => `- [[${p.nome.replace(/\.md$/, '')}|${p.titulo}]]`),
      '',
    ];
  };

  const corpo = [
    `# ${e.nome}`,
    '',
    'Base de conhecimento gerada a partir do que esta empresa declarou no ROOT OS.',
    '',
    campo('Apelido da empresa', e.slug),
    campo('Módulos contratados', e.modulos.length ? e.modulos.join(', ') : 'só a espinha do OS'),
    '',
    '## Como ler isto',
    '',
    'Toda página aqui tem `gerado_por: root-os` no cabeçalho. O sistema **reescreve**',
    'a página enquanto ninguém mexer nela e **nunca** reescreve uma página editada à mão —',
    'é o hash do corpo no cabeçalho que distingue os dois casos. Para voltar a receber',
    'atualização automática numa página que você editou, apague o arquivo e rode o comando',
    'de novo. Página sem esse cabeçalho o sistema não toca.',
    '',
    'O que vale é o sistema: isto é cópia, numa direção só. Editar aqui não volta pro banco.',
    '',
    '## O que existe',
    '',
    ...secao('Regras da casa', 'regra'),
    ...secao('Definições', 'definicao'),
    ...secao('Dicionário de dados', 'dicionario'),
    ...secao('Decisões', 'decisao'),
    ...secao('Fatos do negócio', 'fato'),
    ...secao('Agentes', 'agente'),
    ...secao('Rotinas', 'rotina'),
    '### Conexões',
    '',
    '- [[conexoes|Conexões]]',
    '',
  ].join('\n');

  return { nome: 'indice.md', corpo, tipo: 'indice', titulo: e.nome };
}

/**
 * Estado → páginas. Função PURA: não toca disco nem banco.
 *
 * É por ela ser pura que a suíte consegue provar os três casos do marcador sem
 * precisar de Postgres.
 */
export function montarPaginas(e: EstadoDoTenant): PaginaDeDocumentacao[] {
  const paginas: PaginaDeDocumentacao[] = [
    ...e.notas.map(paginaDeNota),
    ...e.agentes.map(paginaDeAgente),
    ...e.rotinas.map(paginaDeRotina),
    paginaDeConexoes(e),
  ];
  return [paginaDeIndice(e, paginas), ...paginas];
}

// ============================================================================
// A APLICAÇÃO NA VAULT
// ============================================================================

/**
 * ABAIXO DISTO, PROPORÇÃO NÃO DIZ NADA. Com quatro páginas, reescrever duas é
 * metade e é só alguém tendo mudado duas regras.
 */
export const PISO_DE_REESCRITA = 5;

/**
 * A fração das páginas nossas já existentes E AINDA VIVAS que UMA volta pode
 * reescrever.
 *
 * Meio, e não um quinto como o teto de arquivamento da onda 9, porque aqui o
 * conteúdo é DERIVADO: reescrever uma página é reprodutível na volta seguinte,
 * enquanto arquivar uma nota custa versão e evento nos dois sentidos. O que o
 * teto pega é a volta em que TODAS as páginas mudam ao mesmo tempo — assinatura
 * de estado lido pela metade (papel de banco sem BYPASSRLS, empresa errada), não
 * de trabalho humano.
 *
 * "VIVAS" É PARTE DA REGRA, não detalhe da implementação: órfã não é candidata a
 * reescrita, e contá-la no denominador afrouxa o teto na exata proporção do lixo
 * acumulado — a proteção ficaria mais fraca justamente na pasta mais bagunçada.
 */
export const TETO_DE_REESCRITA = 0.5;

/**
 * O banco não devolveu nada e já existe documentação nossa na pasta.
 *
 * `ColapsoParcialError` herda daqui de propósito: quem trata "o banco respondeu
 * menos do que devia" trata os dois casos com a mesma frase.
 */
export class EstadoVazioError extends Error {}

/** Uma família inteira existe no disco e voltou vazia do banco. */
export class ColapsoParcialError extends EstadoVazioError {}

/** A pasta de destino não se provou uma vault. */
export class DestinoNaoProvadoError extends Error {}

/** A pasta já guarda documentação gerada para OUTRA empresa. */
export class PastaDeOutraEmpresaError extends Error {}

/** Uma página preservada porque diz ter sido gerada para outro lugar/empresa. */
export interface PaginaForasteira {
  /** Onde ela está. */
  nome: string;
  /** O que ela DIZ ser — a outra empresa, ou o outro caminho. */
  declarado: string;
}

export interface ResumoDaGeracao {
  simulado: boolean;
  pasta: string;
  criadas: string[];
  reescritas: string[];
  inalteradas: string[];
  /** Existe, é nossa, e alguém editou corpo ou cabeçalho. Nunca sobrescrita. */
  editadasAMao: string[];
  /** Existe com o nome que usaríamos e não é nossa. Nunca sobrescrita. */
  alheias: string[];
  /** Marcador nosso sem selo, empresa ou caminho legíveis. Nunca sobrescrita. */
  marcadorIlegivel: string[];
  /** Nossa, mas gerada para OUTRA empresa. Nunca sobrescrita. */
  deOutraEmpresa: PaginaForasteira[];
  /** Nossa, mas gerada para OUTRO caminho — cópia, renomeação, arquivo movido. */
  deOutroLugar: PaginaForasteira[];
  /** Mudou no disco ENTRE a decisão e a gravação. Não foi escrita. */
  mudouDuranteAVolta: string[];
  /** Páginas nossas na pasta que não correspondem mais a nada vivo. Não apagadas. */
  orfas: string[];
  /** As reescritas que o teto segurou, NOMEADAS. Vazio quando o teto não atuou. */
  reescritasSeguradas: string[];
}

/** Todo .md sob a pasta da empresa, em caminho relativo a ela. */
function listarMarkdown(raiz: string): string[] {
  const saida: string[] = [];
  const andar = (dir: string) => {
    let entradas;
    try {
      entradas = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      if (e.name.startsWith('.')) continue;
      const completo = join(dir, e.name);
      if (e.isDirectory()) andar(completo);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        saida.push(relative(raiz, completo).split(sep).join('/'));
      }
    }
  };
  try {
    if (!statSync(raiz).isDirectory()) return [];
  } catch {
    return [];
  }
  andar(raiz);
  return saida.sort();
}

export interface OpcoesDaGeracao {
  /** Não grava nada: decide tudo e devolve o que FARIA. */
  simular?: boolean;
  /**
   * Aceita conscientemente uma pasta que não se provou vault (vault nova, que
   * nunca foi aberta no Obsidian). É o equivalente ao "arquive na tela" da onda
   * 9: a recusa continua sendo o padrão, e destravá-la é um ato de alguém.
   */
  aceitarPastaNaoProvada?: boolean;
  /** Aceita conscientemente uma volta que reescreve acima do teto. */
  aceitarReescritaEmMassa?: boolean;
  /** Aceita conscientemente uma volta em que uma família inteira voltou vazia. */
  aceitarColapsoParcial?: boolean;
  geradoEm?: Date;
  /**
   * Roda logo antes de cada gravação, com o nome da página.
   *
   * É uma costura de TESTE — é por ela que a suíte consegue mexer no arquivo
   * entre a decisão e a escrita e provar que a releitura pega. Fora do teste ela
   * serve de gancho de progresso; nenhum caminho de produção a usa.
   */
  antesDeGravar?: (nome: string) => void;
}

/** A família de uma página: a primeira pasta do caminho, ou a raiz. */
function familiaDaPagina(nome: string): string {
  const corte = nome.indexOf('/');
  return corte < 0 ? '(raiz)' : nome.slice(0, corte);
}

/**
 * Escreve as páginas na vault, honrando o marcador.
 *
 * `dir` é relativo à vault e JÁ inclui a pasta da empresa — quem compõe é o
 * comando, porque a vault é uma só e documentação de duas empresas na mesma
 * pasta é exatamente o "alguém lê achando que é outra coisa".
 */
export function aplicarNaVault(
  vault: string,
  dir: string,
  estado: EstadoDoTenant,
  paginas: PaginaDeDocumentacao[],
  opcoes: OpcoesDaGeracao = {},
): ResumoDaGeracao {
  const simulado = opcoes.simular === true;
  const geradoEm = opcoes.geradoEm ?? new Date();

  const prova = conferirVaultDeVerdade(vault);
  if (!prova.ok && !opcoes.aceitarPastaNaoProvada) {
    throw new DestinoNaoProvadoError(
      `${prova.motivo} Nada foi escrito. Se a vault é nova mesmo, repita com ` +
        '`--aceitar-pasta-nao-provada`; se não for, o destino Drive não depende de bind mount.',
    );
  }

  const pastaAbsoluta = resolverPastaNaVault(vault, dir);
  const jaEscritas = listarMarkdown(pastaAbsoluta);

  // Quais das que estão lá são NOSSAS **desta empresa**. É sobre elas que o teto,
  // o colapso e as órfãs falam. Página que diz ser de outra empresa não conta:
  // ela não é candidata a nada nesta volta, e contá-la mexeria nos três números.
  const nossasNoDisco: string[] = [];
  const reivindicadasPorOutra: PaginaForasteira[] = [];
  for (const nome of jaEscritas) {
    const texto = lerDocumentoLocal(vault, dir, nome);
    if (texto === null) continue;
    const m = lerMarcador(texto);
    if (!m.nosso) continue;
    if (m.empresa !== null && m.empresa !== estado.slug) {
      /*
       * REIVINDICAR ESTA PASTA É DIZER ESTE CAMINHO, e não só estar debaixo
       * dela. A pasta de uma empresa pode conter a de outra (`root/vizinha/`,
       * que é o que o comando produz quando alguém passa a pasta da primeira
       * como raiz), e ali a segunda tem a árvore dela, coerente, sem disputar
       * caminho nenhum com a primeira — as páginas de lá declaram um
       * `gerado_caminho` relativo à pasta DELAS, que não bate com a posição
       * aqui. Recusar por causa disso travaria a geração da primeira empresa
       * por um vizinho que não encosta nela.
       */
      if (m.caminho === nome) reivindicadasPorOutra.push({ nome, declarado: m.empresa });
      continue;
    }
    nossasNoDisco.push(nome);
  }

  /*
   * A PASTA É DE UMA EMPRESA SÓ, E ISSO SE RECUSA NA ENTRADA.
   *
   * Amarrar o selo à empresa já impede a REESCRITA de uma página com o conteúdo
   * da outra — que era o estrago. Sobrava a metade aditiva: as páginas que a
   * segunda empresa tem e a primeira não teriam sido CRIADAS ali, e o índice da
   * primeira (preservado) não as ligaria. O resultado é uma pasta em que alguém
   * lê a documentação da empresa A achando que é da B, que é exatamente o engano
   * que este módulo existe para evitar.
   *
   * Não há opção de destravar: a resposta certa é uma pasta por empresa, e o
   * comando já compõe o apelido no caminho. Quem chega aqui apontou duas
   * empresas para o mesmo lugar.
   */
  if (reivindicadasPorOutra.length > 0) {
    const quais = reivindicadasPorOutra
      .slice(0, 10)
      .map((f) => `${f.nome} (de "${f.declarado}")`)
      .join(', ');
    throw new PastaDeOutraEmpresaError(
      `a pasta "${dir}" já guarda ${reivindicadasPorOutra.length} página(s) geradas para OUTRA ` +
        `empresa — ${quais}${reivindicadasPorOutra.length > 10 ? ', …' : ''}. Nada foi escrito. ` +
        `Gerar a documentação de "${estado.slug}" aqui misturaria as duas na mesma árvore, e ` +
        'quem lesse não teria como saber de quem é cada página. Use uma pasta por empresa (o ' +
        'comando já põe o apelido no caminho) ou mova o que está aqui.',
    );
  }

  /*
   * A RECUSA POR ESTADO VAZIO, ANTES DE QUALQUER ESCRITA.
   *
   * Mesma forma da guarda de `MemoriaService.projetarDaVault`: resposta VÁLIDA e
   * suspeita. Zero de tudo com documentação nossa já no disco é papel de banco
   * que não atravessa o isolamento, ou empresa errada — não empresa que apagou o
   * negócio inteiro.
   */
  if (estadoVazio(estado) && nossasNoDisco.length > 0) {
    throw new EstadoVazioError(
      `o banco não devolveu NENHUMA regra, definição, entrada de dicionário, decisão, fato, ` +
        `agente, rotina ou conexão para a empresa "${estado.slug}", e já existem ` +
        `${nossasNoDisco.length} página(s) geradas em "${dir}". Nada foi escrito: regenerar ` +
        'agora esvaziaria todas de uma vez. Isso tem cara de conexão que não atravessa o ' +
        'isolamento por linha (use a mesma DATABASE_URL que roda migration) ou de empresa ' +
        'errada na linha de comando. Para documentar uma empresa realmente vazia, apague a ' +
        'pasta à mão.',
    );
  }

  /*
   * A RECUSA POR COLAPSO PARCIAL — e por que a conferência acima não bastava.
   *
   * `estadoVazio` é CONJUNTIVA: ela só recusa quando tudo veio vazio ao mesmo
   * tempo. Mas leitura parcial não é um pouco de cada tabela — é ZERO na tabela
   * que a conexão não alcança e tudo nas outras. Um papel sem BYPASSRLS que
   * enxerga `Agent` e não enxerga `ContextItem` passa liso pela conferência
   * conjuntiva, e o índice é reescrito afirmando que a empresa não tem regra
   * nenhuma — que é uma mentira publicada na vault com a nossa assinatura.
   *
   * A conferência aqui é por FAMÍLIA: uma pasta que tem página nossa no disco e
   * não tem nenhuma página gerada nesta volta derruba a volta inteira. Na
   * primeira volta nada dispara (não há página no disco). Quando o sumiço é
   * real, as páginas viram órfãs e a saída é apagá-las — que já é a regra deste
   * gerador para órfã, e é o que impede a recusa de virar chateação eterna.
   */
  const familiasGeradas = new Set(paginas.map((p) => familiaDaPagina(p.nome)));
  const colapsadas = new Map<string, string[]>();
  for (const nome of nossasNoDisco) {
    const familia = familiaDaPagina(nome);
    if (familiasGeradas.has(familia)) continue;
    colapsadas.set(familia, [...(colapsadas.get(familia) ?? []), nome]);
  }
  if (colapsadas.size > 0 && !opcoes.aceitarColapsoParcial) {
    const detalhe = [...colapsadas.entries()]
      .map(([familia, nomes]) => `${familia} (${nomes.length}): ${nomes.join(', ')}`)
      .join(' · ');
    throw new ColapsoParcialError(
      `o banco devolveu ZERO item para ${colapsadas.size} família(s) que têm página nossa em ` +
        `"${dir}" — ${detalhe}. Nada foi escrito. Uma família inteira que some de uma vez é a ` +
        'assinatura de leitura parcial (papel de banco que não atravessa o isolamento numa ' +
        'tabela só), e nesta volta o índice seria reescrito dizendo que a empresa não tem nada ' +
        'disso. Confira a empresa e a DATABASE_URL. Se o sumiço for real, apague as páginas ' +
        'dessas famílias (órfã é decisão de gente) ou repita com `--aceitar-colapso-parcial`.',
    );
  }

  const resumo: ResumoDaGeracao = {
    simulado,
    pasta: dir,
    criadas: [],
    reescritas: [],
    inalteradas: [],
    editadasAMao: [],
    alheias: [],
    marcadorIlegivel: [],
    deOutraEmpresa: [],
    deOutroLugar: [],
    mudouDuranteAVolta: [],
    orfas: [],
    reescritasSeguradas: [],
  };

  const contexto = (nome: string): ContextoDaPagina => ({
    orgId: estado.orgId,
    empresa: estado.slug,
    caminho: nome,
  });

  const decisoes = paginas.map((p) => ({
    pagina: p,
    decisao: decidirEscrita(lerDocumentoLocal(vault, dir, p.nome), p.corpo, contexto(p.nome)),
  }));

  /*
   * O DENOMINADOR DO TETO SÃO AS PÁGINAS VIVAS, NÃO TUDO QUE É NOSSO NO DISCO.
   *
   * Órfã não é candidata a reescrita: contá-la afrouxa o teto na exata proporção
   * do lixo acumulado, e a proteção fica mais fraca justamente na pasta mais
   * bagunçada — o oposto do que ela existe para fazer.
   */
  const esperadas = new Set(paginas.map((p) => p.nome));
  const vivasNoDisco = nossasNoDisco.filter((nome) => esperadas.has(nome));
  const aReescrever = decisoes.filter((d) => d.decisao.acao === 'reescrever');
  const teto = Math.max(PISO_DE_REESCRITA, Math.ceil(vivasNoDisco.length * TETO_DE_REESCRITA));
  const tetoEstourado =
    aReescrever.length > teto && !opcoes.aceitarReescritaEmMassa && vivasNoDisco.length > 0;

  for (const { pagina, decisao } of decisoes) {
    if (decisao.acao === 'preservar') {
      const declarado = decisao.declarado ?? '';
      if (decisao.motivo === 'editada') resumo.editadasAMao.push(pagina.nome);
      else if (decisao.motivo === 'alheia') resumo.alheias.push(pagina.nome);
      else if (decisao.motivo === 'de-outra-empresa') {
        // A recusa lá em cima já varreu a pasta, então este caso só sobra para
        // o arquivo que NASCEU entre aquela varredura e esta decisão. É pouco
        // provável e é exatamente por isso que ele tem de estar aqui.
        resumo.deOutraEmpresa.push({ nome: pagina.nome, declarado });
      } else if (decisao.motivo === 'de-outro-lugar') {
        resumo.deOutroLugar.push({ nome: pagina.nome, declarado });
      } else resumo.marcadorIlegivel.push(pagina.nome);
      continue;
    }
    if (decisao.acao === 'inalterada') {
      resumo.inalteradas.push(pagina.nome);
      continue;
    }
    if (decisao.acao === 'reescrever' && tetoEstourado) {
      // As criações passam (aditivas); as reescritas ficam para uma pessoa.
      resumo.reescritasSeguradas.push(pagina.nome);
      continue;
    }

    if (!simulado) {
      opcoes.antesDeGravar?.(pagina.nome);
      /*
       * A DECISÃO É RELIDA AQUI, ENCOSTADA NA ESCRITA.
       *
       * Entre o `map` acima e esta linha passa a volta inteira — coleta, teto,
       * dezenas de gravações —, e a pessoa que está com o Obsidian aberto pode
       * ter editado justo esta página nesse intervalo. Sem reler, a promessa de
       * RF-M-07 valeria para o estado do disco no COMEÇO do comando, não para o
       * arquivo que vai ser sobrescrito. Não é trava (não há trava entre dois
       * processos aqui), mas encolhe a janela de segundos para microssegundos, e
       * a gravação em si é atômica (ver `gravarDocumentoLocal`).
       */
      const agora = decidirEscrita(
        lerDocumentoLocal(vault, dir, pagina.nome),
        pagina.corpo,
        contexto(pagina.nome),
      );
      if (agora.acao !== decisao.acao) {
        resumo.mudouDuranteAVolta.push(pagina.nome);
        continue;
      }

      gravarDocumentoLocal(
        vault,
        dir,
        pagina.nome,
        montarPagina({
          corpo: pagina.corpo,
          ctx: contexto(pagina.nome),
          tipo: pagina.tipo,
          geradoEm,
        }),
      );
    }
    if (decisao.acao === 'criar') resumo.criadas.push(pagina.nome);
    else resumo.reescritas.push(pagina.nome);
  }

  resumo.orfas = nossasNoDisco.filter((nome) => !esperadas.has(nome));

  return resumo;
}
