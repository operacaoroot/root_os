import type { Prisma } from '@prisma/client';

/*
 * PASTA E LISTA ARQUIVADAS (rodada de produção 1, 21/10/2026).
 *
 * `WorkFolder.arquivadaEm` e `WorkList.arquivadaEm` tiram a pasta e a lista do
 * Trabalho sem tirá-las do banco: fora da árvore, de Todas, dos contadores, do
 * Dia a dia, da agenda e das minhas tarefas. A leitura direta por id
 * (`GET /trabalho/tarefas/:id`, o quadro de uma lista pelo id) continua valendo,
 * porque os dados ficam.
 *
 * A regra mora aqui, num lugar só, para toda listagem perguntar a mesma coisa.
 * A pasta arquivada esconde também o que está dentro dela, em qualquer nível que
 * caiba em `NIVEIS_DE_PASTA`: a árvore real tem dois ou três níveis, e o filtro
 * é uma subconsulta por nível. Uma pasta mais funda do que isso, dentro de uma
 * arquivada, ainda apareceria (o erro é para o lado de mostrar, nunca de sumir
 * com trabalho vivo).
 */
export const NIVEIS_DE_PASTA = 4;

function pastaVisivel(nivel: number): Prisma.WorkFolderWhereInput {
  if (nivel <= 0) return { arquivadaEm: null };
  return { arquivadaEm: null, OR: [{ parentId: null }, { parent: pastaVisivel(nivel - 1) }] };
}

/** A lista aparece: não está arquivada e nenhuma pasta acima dela está. */
export function listaVisivel(): Prisma.WorkListWhereInput {
  return { arquivadaEm: null, OR: [{ folderId: null }, { folder: pastaVisivel(NIVEIS_DE_PASTA) }] };
}

/** O recorte da tarefa: a lista dela aparece. Vai num `AND` para não colidir com outro filtro de `list`. */
export function tarefaDeListaVisivel(): Prisma.WorkTaskWhereInput {
  return { list: listaVisivel() };
}

/**
 * A TAREFA NÃO ESTÁ NA LIXEIRA (rodada de produção 3, I2, 22/10/2026).
 *
 * Excluir grava `excluidaEm` e também arquiva, então a listagem que já pede
 * `archived: false` a tira sozinha. Esta função é para as que MOSTRAM arquivada
 * (o filtro "arquivadas" do quadro, a Implantação, a contagem por lista) e para
 * deixar o recorte escrito onde a listagem não passa pelo `archived`. Vai num
 * `AND`, como `tarefaDeListaVisivel`. A leitura por id não usa: os dados ficam.
 */
export function tarefaViva(): Prisma.WorkTaskWhereInput {
  return { excluidaEm: null };
}

/** As pastas que somem da árvore: as arquivadas e tudo o que está dentro delas. */
export function pastasEscondidas(pastas: readonly { id: string; parentId: string | null; arquivadaEm: Date | null }[]): Set<string> {
  const escondidas = new Set(pastas.filter((p) => p.arquivadaEm).map((p) => p.id));
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const p of pastas) {
      if (p.parentId && escondidas.has(p.parentId) && !escondidas.has(p.id)) { escondidas.add(p.id); mudou = true; }
    }
  }
  return escondidas;
}

/*
 * O ARQUIVO DO CLICKUP (leva 5, L1, 27/10/2026).
 *
 * "O ClickUp não vai mais ser usado." As listas importadas dele (Gestão de Temas, Copy,
 * Rotina de stories, Design & Gravação) ficam na pasta "Arquivo do ClickUp", dentro de
 * Marketing, com a marca `arquivoDoClickUp` na pasta e nas listas (migration
 * `20261027010000_arquivo_do_clickup`; quem marca é `deploy/layout/arquivo-do-clickup.js`).
 * Diferente da arquivada e da pasta do Comercial, a pasta CONTINUA NA ÁRVORE (recolhida):
 * a pessoa abre a lista pelo id, vê e edita as tarefas; a Produção do Marketing segue
 * lendo o status. O que sai é a LISTAGEM que junta tudo: "Todas", a pessoa em todas as
 * listas, o Dia a dia (painel, contadores e criação). A regra de banco mora aqui; a de
 * tela (os status herdados não viram coluna vazia em "Todas"), no shared
 * (`listasForaDoArquivoDoClickUp`). Nada é apagado nem arquivado.
 */

/** A lista é de fora do Arquivo: nem ela nem a pasta dela têm a marca. */
export function listaForaDoArquivoDoClickUp(): Prisma.WorkListWhereInput {
  return { arquivoDoClickUp: false, OR: [{ folderId: null }, { folder: { arquivoDoClickUp: false } }] };
}

/** O recorte da tarefa: a lista dela está fora do Arquivo do ClickUp. Vai num `AND`. */
export function tarefaForaDoArquivoDoClickUp(): Prisma.WorkTaskWhereInput {
  return { list: listaForaDoArquivoDoClickUp() };
}

/** As pastas do Arquivo e as que estão dentro delas (uma pasta criada dentro por fora herda a regra). */
export function idsDasPastasDoArquivoDoClickUp(pastas: readonly { id: string; parentId: string | null; arquivoDoClickUp: boolean }[]): Set<string> {
  const ids = new Set(pastas.filter((p) => p.arquivoDoClickUp).map((p) => p.id));
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const p of pastas) {
      if (p.parentId && ids.has(p.parentId) && !ids.has(p.id)) { ids.add(p.id); mudou = true; }
    }
  }
  return ids;
}

/** Uma lista lida do banco é do Arquivo? (a marca dela ou a da pasta dela) */
export function ehDoArquivoDoClickUp(l: { arquivoDoClickUp: boolean; folderId: string | null }, pastasDoArquivo: ReadonlySet<string>): boolean {
  return l.arquivoDoClickUp || (!!l.folderId && pastasDoArquivo.has(l.folderId));
}
