import type { Prisma } from '@prisma/client';
import type {
  CaixaAtividade,
  CaixaFiltroDeVencimento,
  CaixaMudanca,
  CaixaOrigemDaAtividade,
  CaixaTipoDaAtividade,
} from '@mktos/shared';

/**
 * ============================================================================
 * A ATIVIDADE DA CAIXA DE ENTRADA — as regras (rodada do painel P1, 18/10/2026)
 * ============================================================================
 *
 * O pedido do Rodrigo: "uma caixa de entrada semelhante à do ClickUp: tudo que
 * tem ele como responsável, o que foi alterado em cada task, os últimos passos,
 * e a condição de limpar a atividade".
 *
 * Este arquivo é a DECISÃO, e mora fora do serviço pelo mesmo motivo de
 * `o-que-espera.ts`: regra escrita dentro do componente que a desenha é regra
 * que a segunda tela contradiz. O serviço ao lado só executa.
 *
 * ----------------------------------------------------------------------------
 * DE ONDE SAI O EVENTO — e por que nenhuma tabela de atividade nasceu
 * ----------------------------------------------------------------------------
 * O histórico JÁ ESTAVA GRAVADO, pela tela dona. `WorkService.editarTarefa`
 * escreve em `AuditLog` (`action = 'work.task.update'`, `entityType =
 * 'work_task'`, `entityId = <tarefa>`) o ANTES e o DEPOIS de status, título,
 * responsável e prioridade; `criarTarefa` escreve `work.task.create`; e o
 * comentário é a própria linha de `WorkComment` (que também cobre o comentário
 * que veio da importação do ClickUp, sem auditoria nenhuma). É exatamente o que
 * o detalhe da tarefa no quadro já lê como "atividade".
 *
 * Faltava UMA coisa: o vencimento não entrava no antes/depois. Ele passou a
 * entrar (`dueDate`, em ISO), na mesma linha de auditoria que já existia — é a
 * tela dona gravando um campo a mais, não um segundo caminho de escrita. Linha
 * antiga, sem a chave, simplesmente não mostra mudança de vencimento: a regra
 * compara só o que os DOIS lados registraram, para não inventar "vencimento
 * mudou de nada para 20/10" a partir de um registro que nunca o guardou.
 *
 * Uma tabela `WorkAtividade` própria seria a segunda verdade sobre o mesmo fato
 * (a auditoria continuaria sendo escrita, e as duas divergiriam no primeiro
 * caminho que escrevesse só numa). A caixa LÊ; quem grava é a tela dona.
 *
 * O comentário da auditoria (`work.comment.create`) NÃO entra: ele é cópia
 * cortada em 200 caracteres da linha de `WorkComment`, e os dois apareceriam
 * como dois eventos do mesmo comentário.
 *
 * ----------------------------------------------------------------------------
 * "EU SOU RESPONSÁVEL" — a regra de `o-que-espera.ts`, sem uma segunda
 * ----------------------------------------------------------------------------
 * `WorkTask.assignee` é texto livre herdado do ClickUp. A caixa casa a tarefa
 * com a pessoa por `identidadesDe` + `condicoesDeResponsavel`, a MESMA regra das
 * tarefas paradas, e publica por quais nomes procurou. O responsável que vale é
 * o de AGORA: tarefa que saiu de você leva junto a atividade dela.
 *
 * ----------------------------------------------------------------------------
 * O QUE EU MESMO FIZ NÃO É NOVIDADE PARA MIM
 * ----------------------------------------------------------------------------
 * Como na caixa do ClickUp, por padrão a atividade é a dos OUTROS: mudança que
 * você fez não chega como recado. `incluirMeus` mostra também as suas (e o item
 * vem marcado `porMim`). O critério é o de `ehDeOutraPessoa`: por id quando há
 * id, pelo nome quando não há (comentário importado).
 */

/* ========================================================================== *
 * AS ORIGENS E O ID DO ITEM
 * ========================================================================== */

export const ORIGEM = {
  auditoria: 'auditoria',
  comentario: 'comentario',
} as const satisfies Record<string, CaixaOrigemDaAtividade>;

/** A origem e a chave da linha do "limpar tudo" em `CaixaVisto`. */
export const ORIGEM_DO_TUDO = 'tudo';
export const EVENTO_DO_TUDO = 'tudo';

/** As ações de auditoria que viram atividade. O comentário vem de `WorkComment`. */
export const ACOES_DA_ATIVIDADE = ['work.task.update', 'work.task.create'] as const;

/** A entidade gravada pela tela dona. */
export const ENTIDADE_DA_TAREFA = 'work_task';

/** O id do item na tela e no `POST /caixa/limpar`. */
export function chaveDoItem(origem: CaixaOrigemDaAtividade, eventoId: string): string {
  return `${origem}:${eventoId}`;
}

/** O contrário de `chaveDoItem`. Origem desconhecida devolve `null`. */
export function lerChaveDoItem(
  chave: string,
): { origem: CaixaOrigemDaAtividade; eventoId: string } | null {
  const i = chave.indexOf(':');
  if (i <= 0) return null;
  const origem = chave.slice(0, i);
  const eventoId = chave.slice(i + 1);
  if (!eventoId) return null;
  if (origem !== ORIGEM.auditoria && origem !== ORIGEM.comentario) return null;
  return { origem, eventoId };
}

/* ========================================================================== *
 * OS TETOS
 * ========================================================================== */

/**
 * Quantas tarefas minhas a atividade lê. O `AuditLog` não tem relação com
 * `WorkTask` (o `entityId` é texto), então a atividade parte da lista de ids —
 * e a lista tem teto. Ordenada pela última mexida: a tarefa que ficou de fora é
 * a mais parada, que é a que menos tem atividade nova. Bateu no teto, a
 * resposta diz (`tarefasTruncadas`).
 */
export const TETO_TAREFAS_DA_ATIVIDADE = 1000;

/** Quantas linhas cada fonte traz por pedido, antes de filtrar e juntar. */
export const LOTE_POR_FONTE = 100;

/** Itens por página: padrão e máximo. */
export const PAGINA_PADRAO = 30;
export const PAGINA_MAXIMA = 100;

/** Linhas da aba Minhas tarefas. Acima disso a tela pede filtro. */
export const TETO_MINHAS_TAREFAS = 200;

/** Listas oferecidas no filtro. */
export const TETO_LISTAS_DO_FILTRO = 500;

/* ========================================================================== *
 * O QUE MUDOU — do antes/depois da auditoria para a tela
 * ========================================================================== */

/** Os campos que a caixa mostra, na ordem em que o tipo principal é escolhido. */
const CAMPOS: { chave: string; campo: CaixaMudanca['campo']; tipo: CaixaTipoDaAtividade }[] = [
  { chave: 'status', campo: 'status', tipo: 'status' },
  { chave: 'assignee', campo: 'responsavel', tipo: 'atribuicao' },
  { chave: 'dueDate', campo: 'vencimento', tipo: 'vencimento' },
  { chave: 'title', campo: 'titulo', tipo: 'edicao' },
  { chave: 'priority', campo: 'prioridade', tipo: 'edicao' },
];

function comoTexto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function comoObjeto(v: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/**
 * As mudanças de uma linha `work.task.update`.
 *
 * Só compara o campo que os DOIS lados registraram (`chave in antes` e `chave in
 * depois`): a auditoria anterior a esta rodada não guardava `dueDate`, e
 * comparar ausente com presente inventaria uma mudança. Vencimento compara pelo
 * DIA quando os dois são datas: trocar só a hora de meia-noite para meia-noite
 * em outro fuso não é mudança que alguém pediu para ver.
 */
export function mudancasDaAuditoria(
  antes: Prisma.JsonValue | null | undefined,
  depois: Prisma.JsonValue | null | undefined,
): CaixaMudanca[] {
  const a = comoObjeto(antes);
  const d = comoObjeto(depois);
  if (!a || !d) return [];
  const saida: CaixaMudanca[] = [];
  for (const { chave, campo } of CAMPOS) {
    if (!(chave in a) || !(chave in d)) continue;
    const de = comoTexto(a[chave]);
    const para = comoTexto(d[chave]);
    if (de === para) continue;
    saida.push({ campo, de, para });
  }
  return saida;
}

/** O tipo principal de um evento: o primeiro campo na ordem de `CAMPOS`. */
export function tipoDasMudancas(mudancas: CaixaMudanca[]): CaixaTipoDaAtividade {
  for (const { campo, tipo } of CAMPOS) {
    if (mudancas.some((m) => m.campo === campo)) return tipo;
  }
  return 'edicao';
}

/* ========================================================================== *
 * O CURSOR — data e chave, as duas fontes na MESMA ordem
 * ========================================================================== */

/**
 * A ordem da caixa: do mais novo para o mais velho; no mesmo milissegundo, pela
 * chave do item (decrescente). A chave desempata as DUAS fontes com uma ordem
 * só — `comentario:` vem antes de `auditoria:` no mesmo instante — e é isso que
 * deixa o cursor ser um ponto exato, sem pular nem repetir item na virada da
 * página.
 */
export interface PontoDaOrdem {
  quando: Date;
  chave: string;
}

export function compararNaOrdem(a: PontoDaOrdem, b: PontoDaOrdem): number {
  const t = b.quando.getTime() - a.quando.getTime();
  if (t !== 0) return t;
  if (a.chave === b.chave) return 0;
  return a.chave < b.chave ? 1 : -1;
}

const SEPARADOR_DO_CURSOR = '~';

export function codificarCursor(p: PontoDaOrdem): string {
  return `${p.quando.toISOString()}${SEPARADOR_DO_CURSOR}${p.chave}`;
}

/** Cursor ilegível devolve `null` — e a página recomeça do topo, sem erro. */
export function lerCursor(texto: string | null | undefined): PontoDaOrdem | null {
  if (!texto) return null;
  const i = texto.indexOf(SEPARADOR_DO_CURSOR);
  if (i <= 0) return null;
  const quando = new Date(texto.slice(0, i));
  const chave = texto.slice(i + 1);
  if (Number.isNaN(quando.getTime()) || !lerChaveDoItem(chave)) return null;
  return { quando, chave };
}

/**
 * A condição "vem DEPOIS do cursor na ordem da caixa", escrita para UMA fonte.
 *
 * Mesmo instante do cursor: fica a linha cuja chave é menor que a do cursor. Se
 * o cursor é desta fonte, isso é `id < idDoCursor`; se é da outra, ou a fonte
 * inteira daquele instante já passou (`comentario:` > `auditoria:`, então
 * cursor em comentário deixa TODA a auditoria do instante), ou nenhuma linha
 * dela passou ainda.
 */
export function condicaoDepoisDoCursor(
  origem: CaixaOrigemDaAtividade,
  cursor: PontoDaOrdem | null,
): { OR: Record<string, unknown>[] } | Record<string, never> {
  if (!cursor) return {};
  const lida = lerChaveDoItem(cursor.chave);
  const antes = { createdAt: { lt: cursor.quando } };
  if (!lida) return { OR: [antes] };
  if (lida.origem === origem) {
    return { OR: [antes, { createdAt: cursor.quando, id: { lt: lida.eventoId } }] };
  }
  // A outra fonte no mesmo instante: a minha chave é maior ou menor que a dela?
  const minhaVemDepois = `${origem}:` < `${lida.origem}:`;
  return minhaVemDepois ? { OR: [antes, { createdAt: cursor.quando }] } : { OR: [antes] };
}

/**
 * Junta as fontes numa página sem pular evento.
 *
 * Cada fonte trouxe até `LOTE_POR_FONTE` linhas. Fonte que veio CHEIA pode ter
 * mais linhas depois da última que trouxe; item de outra fonte mais velho que
 * essa última pode ter linha não lida desta no meio. Então só é seguro publicar
 * o que está até a última linha lida da fonte cheia mais restritiva — e o
 * cursor da próxima página para ali, mesmo que a página saia mais curta.
 *
 * `ultimaLida` é a última linha que a fonte TROUXE (antes de filtrar o que não
 * vira item): é ela, e não o último item válido, que diz até onde a fonte foi.
 */
export function juntarPagina<T extends PontoDaOrdem>(
  fontes: { itens: T[]; cheia: boolean; ultimaLida: PontoDaOrdem | null }[],
  limite: number,
): { itens: T[]; proximo: string | null } {
  const todos = fontes.flatMap((f) => f.itens).sort(compararNaOrdem);
  let fronteira: PontoDaOrdem | null = null;
  for (const f of fontes) {
    if (!f.cheia || !f.ultimaLida) continue;
    if (!fronteira || compararNaOrdem(f.ultimaLida, fronteira) < 0) fronteira = f.ultimaLida;
  }
  const seguros = fronteira
    ? todos.filter((i) => compararNaOrdem(i, fronteira as PontoDaOrdem) <= 0)
    : todos;
  if (seguros.length > limite) {
    const itens = seguros.slice(0, limite);
    return { itens, proximo: codificarCursor(itens[itens.length - 1]) };
  }
  if (fronteira) return { itens: seguros, proximo: codificarCursor(fronteira) };
  return { itens: seguros, proximo: null };
}

/** O limite pedido, dentro do intervalo que a rota aceita. */
export function limiteDaPagina(pedido: unknown): number {
  const n = typeof pedido === 'string' ? Number.parseInt(pedido, 10) : Number(pedido);
  if (!Number.isFinite(n) || n < 1) return PAGINA_PADRAO;
  return Math.min(Math.floor(n), PAGINA_MAXIMA);
}

/** `?x=1`, `?x=true`, `?x=sim` ligam. Qualquer outra coisa desliga. */
export function ligado(v: unknown): boolean {
  return v === '1' || v === 'true' || v === 'sim' || v === true;
}

/* ========================================================================== *
 * O LIMPO
 * ========================================================================== */

/**
 * O item está limpo para esta pessoa? Pela marca dele, ou pelo "limpar tudo"
 * que alcança o instante dele.
 */
export function estaLimpo(
  item: { quando: Date; chave: string },
  limpoAte: Date | null,
  marcados: ReadonlySet<string>,
): boolean {
  if (marcados.has(item.chave)) return true;
  return !!limpoAte && item.quando.getTime() <= limpoAte.getTime();
}

/**
 * Até quando o "limpar tudo" vale: o instante pedido, nunca o futuro (limpar o
 * que ainda não aconteceu esconderia o evento que chega daqui a um minuto), e
 * nunca para trás do que já estava limpo (dois cliques fora de ordem não
 * devolvem à caixa o que a pessoa já tinha limpado).
 */
export function novoLimpoAte(pedido: Date | null, anterior: Date | null, agora: Date): Date {
  const alvo = pedido && pedido.getTime() < agora.getTime() ? pedido : agora;
  if (anterior && anterior.getTime() > alvo.getTime()) return anterior;
  return alvo;
}

/* ========================================================================== *
 * O VENCIMENTO — vencidas, hoje, semana, no dia de Brasília
 * ========================================================================== */

/** O dia de hoje em Brasília (AAAA-MM-DD). Mesma conta de `hojeEmBrasilia` do quadro. */
export function diaEmBrasilia(agora: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

/**
 * O começo do dia em Brasília. O Brasil não tem horário de verão desde 2019, e
 * por isso o deslocamento é fixo; empresa fora do fuso entra quando houver.
 */
export function inicioDoDiaEmBrasilia(agora: Date, diasDepois = 0): Date {
  const base = new Date(`${diaEmBrasilia(agora)}T00:00:00.000-03:00`);
  return new Date(base.getTime() + diasDepois * 24 * 60 * 60 * 1000);
}

/**
 * O filtro de prazo de cada opção:
 *  · `vencidas` — prazo antes de agora;
 *  · `hoje`     — prazo dentro do dia de hoje (Brasília);
 *  · `semana`   — prazo de hoje até o fim do sétimo dia (hoje + 6).
 */
export function filtroDoVencimento(
  filtro: CaixaFiltroDeVencimento | undefined,
  agora: Date,
): Prisma.DateTimeNullableFilter | undefined {
  if (!filtro) return undefined;
  if (filtro === 'vencidas') return { lt: agora };
  if (filtro === 'hoje') {
    return { gte: inicioDoDiaEmBrasilia(agora), lt: inicioDoDiaEmBrasilia(agora, 1) };
  }
  return { gte: inicioDoDiaEmBrasilia(agora), lt: inicioDoDiaEmBrasilia(agora, 7) };
}

/** O item já montado, com o ponto da ordem ao lado (a tela recebe só `item`). */
export interface ItemNaOrdem extends PontoDaOrdem {
  item: CaixaAtividade;
}
