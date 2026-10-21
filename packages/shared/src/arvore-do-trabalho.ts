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
