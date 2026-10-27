import { BadRequestException } from '@nestjs/common';
import { TRAB_DO_COMERCIAL } from '@mktos/shared';
import type { Prisma } from '@prisma/client';

/*
 * A PASTA CLIENTES SAI DO TRABALHO (produção 22B, I3, 22/10/2026). Ver o
 * cabeçalho de `packages/shared/src/pasta-do-comercial.ts`.
 *
 * A marca é a coluna `doComercial` (pasta e lista). Tudo o que é ÁRVORE do
 * Trabalho (desenhar, ordenar, mover, renomear, apagar, desarquivar, nome
 * repetido) passa a não ver a pasta do Comercial nem o que mora nela, como já
 * não via a lista do comercial; tudo o que é LISTAGEM de tarefa do Trabalho
 * (Todas, a pessoa em todas as listas, o Dia a dia) tira as tarefas dela. O
 * que é do Comercial continua lendo pelo nome, sem filtro nenhum: o quadro da
 * Implantação, o card do fechamento, "Iniciar onboarding" e a tarefa pelo id.
 *
 * As regras moram aqui, em funções próprias, para quem lê `work.service.ts`
 * achar uma linha só em cada lugar que muda.
 *
 * LEVA 5, L3 (27/10/2026): a pasta Clientes voltou a APARECER na árvore, recolhida,
 * só para abrir as listas (a Implantação saiu do menu). Isso é da TELA
 * (`ArvoreDoTrabalho.tsx` desenha `pastasDoComercial`): nada aqui mudou. Renomear,
 * mover, apagar e receber lista pelo Trabalho continuam recusados por estas regras,
 * e as tarefas dela continuam fora de Todas e do Dia a dia.
 */

/** A pasta é do Trabalho (não do Comercial). Vai no `where` das pastas da árvore. */
export const PASTA_DO_TRABALHO = { doComercial: false } as const satisfies Prisma.WorkFolderWhereInput;

/** A lista é do Trabalho: nem ela nem a pasta dela são do Comercial. */
export function listaForaDoComercial(): Prisma.WorkListWhereInput {
  return { doComercial: false, OR: [{ folderId: null }, { folder: { doComercial: false } }] };
}

/** O recorte da tarefa: a lista dela é do Trabalho. Vai num `AND`. */
export function tarefaForaDoComercial(): Prisma.WorkTaskWhereInput {
  return { list: listaForaDoComercial() };
}

/** Uma lista lida do banco é do Comercial? (a marca dela ou a da pasta dela) */
export function ehDoComercial(l: { doComercial: boolean; folderId: string | null }, pastasDoComercial: ReadonlySet<string>): boolean {
  return l.doComercial || (!!l.folderId && pastasDoComercial.has(l.folderId));
}

/**
 * As pastas do Comercial e as que estão dentro delas, em qualquer nível. Hoje é só
 * a Clientes, sem pasta dentro; a descida existe para uma pasta criada dentro dela
 * por fora não reaparecer sozinha na árvore.
 */
export function idsDasPastasDoComercial(pastas: readonly { id: string; parentId: string | null; doComercial: boolean }[]): Set<string> {
  const ids = new Set(pastas.filter((p) => p.doComercial).map((p) => p.id));
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const p of pastas) {
      if (p.parentId && ids.has(p.parentId) && !ids.has(p.id)) { ids.add(p.id); mudou = true; }
    }
  }
  return ids;
}

type Db = Pick<Prisma.TransactionClient, 'workFolder'>;

/**
 * Criar ou pôr pasta ou lista DENTRO de uma pasta do Comercial pelo Trabalho é
 * recusado com a frase de por quê (a pasta não aparece na árvore; o que nascesse
 * ali sumiria junto). Sobe pelas mães: dentro de uma pasta dentro dela também vale.
 */
export async function recusarPastaDoComercial(db: Db, orgId: string, folderId: string | null | undefined): Promise<void> {
  if (!folderId) return;
  const vistas = new Set<string>();
  for (let atual: string | null = folderId; atual && !vistas.has(atual);) {
    vistas.add(atual);
    const p: { parentId: string | null; doComercial: boolean } | null = await db.workFolder.findFirst({
      where: { id: atual, orgId }, select: { parentId: true, doComercial: true },
    });
    if (!p) return;
    if (p.doComercial) throw new BadRequestException(TRAB_DO_COMERCIAL);
    atual = p.parentId;
  }
}
