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
