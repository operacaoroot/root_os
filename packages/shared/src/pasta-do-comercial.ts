/*
 * A PASTA CLIENTES SAI DO TRABALHO (produção 22B, I3, 22/10/2026).
 *
 * "A pasta cliente sai sim" (o Rodrigo, 21/10). A pasta Clientes e as listas
 * dela (Esteira de clientes, Onboarding de cliente, Execução) continuam
 * existindo, com as mesmas tarefas, e continuam sendo a fonte de Comercial ›
 * Implantação. Elas só deixam de aparecer no Trabalho: árvore, Todas,
 * contadores e Dia a dia. É o mesmo desenho da lista do comercial
 * (`comercial:tarefas`): existe, mas é do Comercial.
 *
 * A marca é a coluna `doComercial` da pasta e da lista (migration
 * `20261022205000_trabalho_pasta_do_comercial`). Na estrutura do Trabalho
 * (`GET /trabalho/estrutura`) elas saem de `folders` e vêm à parte, em
 * `pastasDoComercial`: tudo o que DESENHA a árvore, os seletores e os chips lê
 * `folders` e deixa de vê-las sem mudar nada; quem só precisa ACHAR uma lista
 * pelo id (o quadro da Implantação, o painel da tarefa, a ficha do cliente)
 * usa as duas funções abaixo.
 */

interface ListaComId { id: string }
interface PastaComListas<L extends ListaComId> { lists: L[] }
interface EstruturaComComercial<P extends PastaComListas<L>, L extends ListaComId> {
  folders: P[];
  listasSoltas: L[];
  pastasDoComercial?: P[];
  listasDoComercial?: L[];
}

/** As pastas do Trabalho e as do Comercial juntas (para achar, nunca para desenhar a árvore). */
export function pastasComAsDoComercial<P extends PastaComListas<L>, L extends ListaComId>(e: EstruturaComComercial<P, L>): P[] {
  return [...e.folders, ...(e.pastasDoComercial ?? [])];
}

/** Todas as listas, do Trabalho e do Comercial (para achar uma lista pelo id). */
export function listasComAsDoComercial<P extends PastaComListas<L>, L extends ListaComId>(e: EstruturaComComercial<P, L>): L[] {
  // Layout 26/10: e a lista "Tarefas do comercial" (sem pasta), que agora entra em "Todas" do Trabalho.
  return [...pastasComAsDoComercial<P, L>(e).flatMap((f) => f.lists), ...e.listasSoltas, ...(e.listasDoComercial ?? [])];
}

/*
 * Layout 26/10: A LISTA "TAREFAS DO COMERCIAL" NA ÁRVORE (decisão do Lucas, 26/10).
 * A lista de chave `comercial:tarefas` (a mesma de `apps/api/src/work/lista-do-comercial.ts`)
 * aparece na árvore dentro da pasta de topo "Comercial", para ver, abrir e criar tarefa.
 * Ela continua sendo a do Funil vivo e do painel do lead: não se renomeia, não sai da
 * pasta, não se apaga nem se arquiva pelo Trabalho. A tarefa nova nela pede o LEAD
 * (opcional) em vez do cliente; o cliente é sempre o da casa ("Root (interno)").
 */
export const LISTA_DO_COMERCIAL = 'comercial:tarefas';

/** A lista é a "Tarefas do comercial"? (pela chave, nunca pelo nome) */
export function ehAListaDoComercial(l: { externalId?: string | null } | null | undefined): boolean {
  return l?.externalId === LISTA_DO_COMERCIAL;
}

export const TRAB_LISTA_DO_COMERCIAL_PROTEGIDA =
  'A lista Tarefas do comercial é a mesma do Funil vivo e do painel do lead: ela fica na pasta Comercial, com este nome, e não se apaga nem se arquiva.';
export const TRAB_LISTA_DO_COMERCIAL_SO_TAREFA_NOVA =
  'A lista Tarefas do comercial (a do Funil vivo) só recebe tarefa criada nela: mover tarefa de outra lista para ela não vale.';
export const TRAB_PASTA_COM_A_LISTA_DO_COMERCIAL =
  'Esta pasta guarda a lista Tarefas do comercial, a do Funil vivo: a lista não sai dela, então a pasta não se apaga.';

/** A frase de quem tenta mexer pelo Trabalho numa pasta ou lista do Comercial. */
export const TRAB_DO_COMERCIAL =
  'Esta pasta e as listas dela são do Comercial: aparecem em Comercial › Implantação, não na árvore do Trabalho.';
