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

/** A frase de quem tenta mexer pelo Trabalho numa pasta ou lista do Comercial. */
export const TRAB_DO_COMERCIAL =
  'Esta pasta e as listas dela são do Comercial: aparecem em Comercial › Implantação, não na árvore do Trabalho.';
