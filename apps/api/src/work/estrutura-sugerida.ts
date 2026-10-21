import {
  ESTRUTURA_SUGERIDA, MODELOS_DE_LISTA,
  type ModeloDeLista, type PastaSugerida, type TrabEstruturaSugeridaResultado,
} from '@mktos/shared';
import { Prisma, WorkFieldType, WorkStatusType } from '@prisma/client';

/*
 * A ESTRUTURA SUGERIDA DO TRABALHO (rodada do painel P2, 18/10/2026).
 *
 * PASTA É `WorkFolder`. O roteiro da rodada falava numa tabela `WorkPasta`
 * nova; ela não foi criada porque `WorkFolder` já é exatamente isso (nome,
 * ordem, empresa, pasta dentro de pasta) e `WorkList.folderId` já é opcional
 * (lista solta). Uma segunda tabela de pasta seria a segunda verdade sobre a
 * mesma árvore, e o importador do ClickUp já escreve em `WorkFolder`.
 *
 * SEM NEST, de propósito: o seed da homologação (`prisma/seed-comercial.ts`)
 * roda sob `tsx`, que não emite metadado de decorador, e chama a MESMA função
 * que a rota. Quem chama abre a transação; aqui dentro só há o cliente dela.
 *
 * IDEMPOTENTE PELO NOME: pasta de topo (sem mãe) com o mesmo nome, sem
 * diferença de maiúscula e espaço, é a mesma pasta — esteja ou não num espaço.
 * Lista com o mesmo nome dentro dessa pasta é a mesma lista. O que existe não é
 * renomeado nem reetapado. A ÚNICA mudança em coisa que já existe (rodada de
 * produção 1, 21/10/2026): lista SOLTA (sem pasta e sem espaço) com o nome de uma
 * lista sugerida é movida para a pasta sugerida em vez de ganhar uma gêmea; mover
 * preserva tarefas, etapas e ids. Pasta e lista arquivadas (`arquivadaEm`) não
 * contam: não são a pasta sugerida nem viram destino. O cadeado `work-arvore:<empresa>` (o mesmo de
 * mover pasta) faz dois cliques ao mesmo tempo virarem uma criação só.
 */

/** O pipeline mínimo de toda lista sem modelo (padrão ClickUp: open → custom → closed). */
export const ETAPAS_PADRAO_DA_LISTA: ReadonlyArray<{ name: string; type: WorkStatusType; color: string; order: number }> = [
  { name: 'A fazer', type: WorkStatusType.open, color: '#87909e', order: 0 },
  { name: 'Em andamento', type: WorkStatusType.custom, color: '#f9d900', order: 1 },
  { name: 'Concluída', type: WorkStatusType.closed, color: '#6bc950', order: 2 },
];

type Db = Prisma.TransactionClient;

const chaveDoNome = (nome: string) => nome.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/**
 * Cria a lista com as etapas e os campos do modelo. É o corpo de
 * `WorkService.criarListaDoModelo`, extraído para o seed poder usar sem Nest.
 */
export async function criarListaDoModeloNoBanco(
  db: Db, orgId: string, pai: { folderId: string | null; spaceId: string | null },
  modelo: ModeloDeLista, nome: string, order?: number,
) {
  const list = await db.workList.create({ data: { orgId, ...pai, name: nome, ...(order !== undefined ? { order } : {}) } });
  await db.workStatus.createMany({
    data: modelo.etapas.map((e, i) => ({
      orgId, listId: list.id, name: e.name, type: e.type as WorkStatusType,
      color: e.color, order: i, limite: e.limite,
    })),
  });
  for (const [i, c] of modelo.campos.entries()) {
    const campo = await db.workField.create({
      data: { orgId, listId: list.id, name: c.name, type: c.type as WorkFieldType, order: i },
    });
    if (c.opcoes && c.opcoes.length > 0) {
      await db.workFieldOption.createMany({
        data: c.opcoes.map((o, j) => ({ orgId, fieldId: campo.id, name: o.name, color: o.color, order: j })),
      });
    }
  }
  return list;
}

/** Lista com o pipeline mínimo. */
export async function criarListaPadraoNoBanco(
  db: Db, orgId: string, pai: { folderId: string | null; spaceId: string | null }, nome: string, order?: number,
) {
  const list = await db.workList.create({ data: { orgId, ...pai, name: nome, ...(order !== undefined ? { order } : {}) } });
  await db.workStatus.createMany({ data: ETAPAS_PADRAO_DA_LISTA.map((s) => ({ ...s, orgId, listId: list.id })) });
  return list;
}

/**
 * Cria o que falta da estrutura sugerida e diz o que criou e o que já existia.
 * Precisa rodar DENTRO de uma transação interativa (o cadeado é de transação).
 */
export async function criarEstruturaSugerida(
  db: Db, orgId: string, estrutura: readonly PastaSugerida[] = ESTRUTURA_SUGERIDA,
): Promise<TrabEstruturaSugeridaResultado> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-arvore:${orgId}`}))`;
  const r: TrabEstruturaSugeridaResultado = {
    criadas: { pastas: [], listas: [] }, jaExistiam: { pastas: [], listas: [] }, movidas: { listas: [] },
  };

  const deTopo = await db.workFolder.findMany({
    where: { orgId, parentId: null },
    select: { id: true, name: true, order: true, arquivadaEm: true },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  });
  let proximaOrdem = deTopo.reduce((m, p) => Math.max(m, p.order + 1), 0);

  for (const sugerida of estrutura) {
    let pasta = deTopo.find((p) => !p.arquivadaEm && chaveDoNome(p.name) === chaveDoNome(sugerida.nome));
    if (!pasta && deTopo.some((p) => p.arquivadaEm && chaveDoNome(p.name) === chaveDoNome(sugerida.nome))) {
      // Arquivada de propósito: não se recria ao lado (o nome é único entre irmãs) nem se desarquiva sozinha.
      r.jaExistiam.pastas.push(`${sugerida.nome} (arquivada)`);
      continue;
    }
    if (pasta) {
      r.jaExistiam.pastas.push(pasta.name);
    } else {
      const criada = await db.workFolder.create({ data: { orgId, name: sugerida.nome, order: proximaOrdem++ } });
      pasta = { id: criada.id, name: criada.name, order: criada.order, arquivadaEm: null };
      deTopo.push(pasta);
      r.criadas.pastas.push(criada.name);
    }

    const listas = await db.workList.findMany({ where: { orgId, folderId: pasta.id, arquivadaEm: null }, select: { name: true, order: true } });
    let ordemDaLista = listas.reduce((m, l) => Math.max(m, l.order + 1), 0);
    for (const l of sugerida.listas) {
      const existente = listas.find((x) => chaveDoNome(x.name) === chaveDoNome(l.nome));
      if (existente) {
        r.jaExistiam.listas.push(`${pasta.name} / ${existente.name}`);
        continue;
      }
      const solta = (await db.workList.findMany({
        where: { orgId, folderId: null, spaceId: null, arquivadaEm: null },
        select: { id: true, name: true },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      })).find((x) => chaveDoNome(x.name) === chaveDoNome(l.nome));
      if (solta) {
        await db.workList.update({ where: { id: solta.id }, data: { folderId: pasta.id, order: ordemDaLista++ } });
        listas.push({ name: solta.name, order: ordemDaLista - 1 });
        r.movidas!.listas.push(`${pasta.name} / ${solta.name}`);
        continue;
      }
      const pai = { folderId: pasta.id, spaceId: null };
      if (l.modelo) await criarListaDoModeloNoBanco(db, orgId, pai, MODELOS_DE_LISTA[l.modelo], l.nome, ordemDaLista++);
      else await criarListaPadraoNoBanco(db, orgId, pai, l.nome, ordemDaLista++);
      r.criadas.listas.push(`${pasta.name} / ${l.nome}`);
    }
  }
  return r;
}
