import { z } from 'zod';
import { LISTA_DA_IMPLANTACAO, PASTA_DA_IMPLANTACAO, chaveDoNomeDoTrabalho } from './implantacao.js';

/*
 * EDITAR A ÁRVORE DO TRABALHO ONDE A PESSOA ESTÁ OLHANDO (adendo da rodada de
 * produção 1, A3, 21/10/2026).
 *
 * Criar pasta, renomear pasta e lista, apagar pasta levando as listas para outro
 * lugar, apagar lista levando as tarefas para outra lista, arrastar lista entre
 * pastas e reordenar. A tela e a API leem daqui as MESMAS regras e frases:
 *  · nome repetido no mesmo nível é recusado. O nível da pasta é a mãe (ou o topo
 *    do mesmo espaço); o da lista é a pasta (ou as soltas do mesmo espaço). A
 *    comparação não vê maiúscula, acento nem espaço sobrando: "Gestão" e "gestao"
 *    são o mesmo nome para quem lê a árvore;
 *  · a ordem regrava os irmãos de UM nível, e a API confere que vieram todos e só
 *    eles (o que a tela viu é o que muda);
 *  · a lista da implantação e a pasta que a guarda continuam protegidas.
 */

/** O nome como o nível compara: sem acento, sem maiúscula, sem espaço sobrando. */
export function chaveDoNomeNoNivel(nome: string): string {
  return chaveDoNomeDoTrabalho(String(nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC'));
}

export const TRAB_NOME_DE_PASTA_REPETIDO = 'Já existe uma pasta com esse nome neste lugar.';
export const TRAB_NOME_DE_LISTA_REPETIDO = 'Já existe uma lista com esse nome neste lugar.';
export const TRAB_LISTA_DA_IMPLANTACAO_PROTEGIDA =
  `A lista ${LISTA_DA_IMPLANTACAO} é a porta da implantação de clientes: ela fica na pasta ${PASTA_DA_IMPLANTACAO}, com este nome, e não se apaga.`;
export const TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA =
  `A pasta ${PASTA_DA_IMPLANTACAO} guarda a lista ${LISTA_DA_IMPLANTACAO}, a porta da implantação de clientes: ela fica no primeiro nível, com este nome, e não se apaga.`;

/*
 * APAGAR PASTA COM DESTINO. Vazia, a pasta sai como no P3. Com listas ou pastas
 * dentro, `destino` diz para onde elas vão ANTES de a pasta sair: outra pasta ou
 * "Sem pasta". `esperadas` é o que a tela mostrou (listas e pastas que aparecem
 * dentro dela); se mudou no meio, nada muda (409).
 */
export const TrabPastaDestinoSchema = z.union([
  z.object({ folderId: z.string().uuid() }).strict(),
  z.object({ semPasta: z.literal(true) }).strict(),
]);
export type TrabPastaDestino = z.infer<typeof TrabPastaDestinoSchema>;

export const TrabPastaExcluirComDestinoSchema = z.object({
  destino: TrabPastaDestinoSchema.optional(),
  esperadas: z.object({
    listas: z.number().int().min(0).max(10_000),
    pastas: z.number().int().min(0).max(10_000),
  }).strict(),
}).strict();
export type TrabPastaExcluirComDestinoInput = z.infer<typeof TrabPastaExcluirComDestinoSchema>;

export interface TrabPastaExcluidaComDestino {
  id: string;
  modo: 'apagada' | 'arquivada';
  listasMovidas: number;
  pastasMovidas: number;
}

/*
 * MOVER AS TAREFAS DE UMA LISTA PARA OUTRA (o passo antes de apagar uma lista com
 * tarefa ativa). Mesmos ids; a etapa no destino é a de mesmo nome, senão a
 * primeira do mesmo tipo, senão a primeira. `esperadas` = quantas tarefas ativas a
 * tela mostrou.
 */
export const TrabListaMoverTarefasSchema = z.object({
  destinoId: z.string().uuid(),
  esperadas: z.number().int().min(0).max(100_000),
}).strict();
export type TrabListaMoverTarefasInput = z.infer<typeof TrabListaMoverTarefasSchema>;

export interface TrabListaTarefasMovidas {
  id: string;
  destinoId: string;
  movidas: number;
  /** Quantas caíram numa etapa de nome diferente da que tinham. */
  mudaramDeEtapa: number;
  /**
   * Valores de campos próprios da lista de origem que foram para o campo de mesmo
   * nome e tipo no destino (M3, 22/10/2026); os sem equivalente ficam guardados na
   * origem, e por isso ela é arquivada, não apagada, ao sair.
   */
  camposCopiados: number;
  camposGuardados: number;
}

/*
 * OS CAMPOS PRÓPRIOS AO MOVER AS TAREFAS (M3, 22/10/2026). O valor de um campo da
 * lista de origem vai para o campo do destino de MESMO nome (a regra do nível: sem
 * maiúscula, acento nem espaço sobrando) e MESMO tipo. Na seleção, só se o destino
 * tiver a opção de mesmo nome. O resto fica guardado na origem, como antes.
 */
export interface CampoParaMover { id: string; name: string; type: string; options: readonly { id: string; name: string }[] }
export interface ValorParaMover { fieldId: string; optionId: string | null; value: string | null }

/** Para onde vai o valor no destino, ou nulo quando ele fica guardado na origem. */
export function destinoDoValorDoCampo(
  valor: ValorParaMover, origem: CampoParaMover, destino: readonly CampoParaMover[],
): ValorParaMover | null {
  const campo = destino.find((c) => c.type === origem.type && chaveDoNomeNoNivel(c.name) === chaveDoNomeNoNivel(origem.name));
  if (!campo) return null;
  if (!valor.optionId) return { fieldId: campo.id, optionId: null, value: valor.value };
  const opcao = origem.options.find((o) => o.id === valor.optionId);
  const igual = opcao && campo.options.find((o) => chaveDoNomeNoNivel(o.name) === chaveDoNomeNoNivel(opcao.name));
  return igual ? { fieldId: campo.id, optionId: igual.id, value: valor.value } : null;
}

/** A etapa que a tarefa recebe no destino: mesmo nome, senão a primeira do mesmo tipo, senão a primeira. */
export function etapaNoDestino<T extends { id: string; name: string; type: string }>(
  origem: { name: string; type: string }, destino: readonly T[],
): T | null {
  return destino.find((s) => chaveDoNomeNoNivel(s.name) === chaveDoNomeNoNivel(origem.name))
    ?? destino.find((s) => s.type === origem.type)
    ?? destino[0]
    ?? null;
}

/*
 * A ORDEM DE UM NÍVEL. `paiId` nulo: as pastas de topo (tipo pasta) ou as listas
 * sem pasta (tipo lista). `ids` vem na ordem nova e precisa ser exatamente o
 * conjunto de irmãos que aparece naquele nível.
 */
export const TrabArvoreOrdemSchema = z.object({
  tipo: z.enum(['pasta', 'lista']),
  paiId: z.string().uuid().nullable(),
  ids: z.array(z.string().uuid()).min(1).max(1_000),
}).strict();
export type TrabArvoreOrdemInput = z.infer<typeof TrabArvoreOrdemSchema>;

export const TRAB_ORDEM_FORA_DO_NIVEL = 'A ordem precisa trazer exatamente os itens deste nível. Atualize a tela e tente de novo.';

/*
 * MOVER PASTA PARA DENTRO DE OUTRA (rodada de produção 2, M3, 22/10/2026).
 *
 * Arrastar uma pasta sobre outra põe a primeira dentro da segunda; soltar entre
 * duas reordena, como antes. A tela e a API perguntam a mesma coisa antes:
 *  · a pasta não vai para dentro dela mesma nem de uma pasta que está dentro dela;
 *  · a árvore não passa de `TRAB_NIVEIS_DE_PASTA` níveis de pasta. A conta é a
 *    profundidade do destino (topo = 1) mais a altura da pasta que se move (ela
 *    sozinha = 1, com uma filha = 2…). Ir para o primeiro nível nunca é recusado
 *    por nível.
 * `parentId` nulo = primeiro nível. Só de gente, como apagar.
 */
export const TRAB_NIVEIS_DE_PASTA = 4;
export const TRAB_PASTA_EM_CICLO = 'A pasta não pode ficar dentro dela mesma nem de uma pasta que está dentro dela.';
export const TRAB_PASTA_FUNDA_DEMAIS = `A pasta ficaria funda demais: o Trabalho guarda até ${TRAB_NIVEIS_DE_PASTA} níveis de pasta, uma dentro da outra.`;

export const TrabPastaMoverSchema = z.object({
  parentId: z.string().uuid().nullable(),
}).strict();
export type TrabPastaMoverInput = z.infer<typeof TrabPastaMoverSchema>;

type NoDePasta = { id: string; parentId: string | null };

/** O nível da pasta: a de topo é 1, a filha dela é 2. Ciclo no banco não trava a conta. */
export function profundidadeDaPasta(pastas: readonly NoDePasta[], id: string): number {
  const maeDe = new Map(pastas.map((p) => [p.id, p.parentId]));
  const vistas = new Set<string>();
  let n = 0;
  for (let atual: string | null = id; atual && !vistas.has(atual) && maeDe.has(atual); atual = maeDe.get(atual) ?? null) {
    vistas.add(atual);
    n += 1;
  }
  return n;
}

/** Quantos níveis a pasta ocupa com o que está dentro dela: sozinha é 1. */
export function alturaDaPasta(pastas: readonly NoDePasta[], id: string): number {
  const filhas = new Map<string, string[]>();
  for (const p of pastas) if (p.parentId) filhas.set(p.parentId, [...(filhas.get(p.parentId) ?? []), p.id]);
  const vistas = new Set<string>();
  const medir = (atual: string): number => {
    if (vistas.has(atual)) return 0;
    vistas.add(atual);
    return 1 + Math.max(0, ...(filhas.get(atual) ?? []).map(medir));
  };
  return medir(id);
}

/** A frase da recusa de pôr `id` dentro de `destinoId` (ciclo ou nível), ou nulo quando pode. */
export function motivoParaNaoMoverPasta(
  pastas: readonly NoDePasta[], id: string, destinoId: string | null, niveis: number = TRAB_NIVEIS_DE_PASTA,
): string | null {
  if (destinoId === null) return null;
  const maeDe = new Map(pastas.map((p) => [p.id, p.parentId]));
  const vistas = new Set<string>();
  for (let atual: string | null = destinoId; atual && !vistas.has(atual); atual = maeDe.get(atual) ?? null) {
    if (atual === id) return TRAB_PASTA_EM_CICLO;
    vistas.add(atual);
  }
  if (profundidadeDaPasta(pastas, destinoId) + alturaDaPasta(pastas, id) > niveis) return TRAB_PASTA_FUNDA_DEMAIS;
  return null;
}

/*
 * DESARQUIVAR (rodada de produção 2, M3, 22/10/2026).
 *
 * A seção "Arquivadas" da coluna da esquerda lista as pastas e listas arquivadas
 * (excluir uma lista com tarefas arquivadas, ou uma pasta que só guardava
 * arquivadas, ARQUIVA em vez de apagar; o importador do CRM também arquiva).
 * "Desarquivar" devolve:
 *  · a lista à pasta onde estava; se essa pasta continua arquivada, a lista vai
 *    para Sem pasta e a resposta diz isso;
 *  · a pasta ao lugar onde estava (ou ao primeiro nível, se a mãe continua
 *    arquivada), com as listas e pastas de dentro que foram arquivadas JUNTO com
 *    ela, no mesmo instante da mesma operação. As arquivadas antes continuam
 *    arquivadas e seguem na seção.
 * Nome repetido no destino é recusado com a frase de sempre. Só de gente, com a
 * permissão de apagar, auditado. A lista do comercial não aparece aqui.
 */
export interface TrabArquivadaPor { id: string; nome: string }

export interface TrabListaArquivada {
  id: string;
  name: string;
  arquivadaEm: string;
  /** Quem arquivou, pela auditoria da operação; nulo quando a auditoria não diz. */
  por: TrabArquivadaPor | null;
  /** A pasta onde ela estava (nula se estava sem pasta). */
  pasta: { id: string; name: string } | null;
  /** A pasta onde ela estava continua arquivada: desarquivar leva a lista para Sem pasta. */
  maeArquivada: boolean;
  tarefas: number;
}

export interface TrabPastaArquivada {
  id: string;
  name: string;
  arquivadaEm: string;
  por: TrabArquivadaPor | null;
  /** A mãe (nula se era de primeiro nível). */
  mae: { id: string; name: string } | null;
  /** A mãe continua arquivada: desarquivar leva a pasta para o primeiro nível. */
  maeArquivada: boolean;
  /** Listas guardadas dentro dela (qualquer estado) e as tarefas dessas listas. */
  listas: number;
  tarefas: number;
  /** Listas que voltam junto (arquivadas no mesmo instante que ela). */
  listasQueVoltam: number;
}

export interface TrabArquivadas {
  pastas: TrabPastaArquivada[];
  listas: TrabListaArquivada[];
}

export interface TrabDesarquivada {
  id: string;
  tipo: 'pasta' | 'lista';
  /** Onde voltou: o mesmo lugar, Sem pasta (lista com a pasta arquivada) ou o primeiro nível (pasta com a mãe arquivada). */
  destino: 'mesmo-lugar' | 'sem-pasta' | 'primeiro-nivel';
  /** Pastas e listas de dentro que voltaram junto (só na pasta). */
  pastasJunto: number;
  listasJunto: number;
  /** A frase para a tela quando o destino não é o mesmo lugar. */
  aviso: string | null;
}

export const TRAB_LISTA_VOLTA_SEM_PASTA = 'A pasta onde ela estava continua arquivada: a lista volta para Sem pasta.';
export const TRAB_LISTA_VOLTOU_SEM_PASTA = 'A pasta onde ela estava continua arquivada: a lista voltou para Sem pasta.';
export const TRAB_PASTA_VOLTA_AO_TOPO = 'A pasta-mãe continua arquivada: a pasta volta para o primeiro nível.';
export const TRAB_PASTA_VOLTOU_AO_TOPO = 'A pasta-mãe continua arquivada: a pasta voltou para o primeiro nível.';

/** "N valores de campos sem equivalente ficaram guardados na lista de origem." (mover tarefas para outra lista). */
export function fraseDosCamposGuardados(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? '1 valor de campo sem equivalente ficou guardado na lista de origem.'
    : `${n} valores de campos sem equivalente ficaram guardados na lista de origem.`;
}
