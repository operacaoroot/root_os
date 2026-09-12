import type { PrismaClient } from '@prisma/client';

/* ==========================================================================
 * O ESPELHO NO ÍNDICE — por que a nota é gravada em DOIS lugares
 * ==========================================================================
 *
 * A memória canônica da empresa é `ContextItem`: versionada, com procedência
 * obrigatória na entrada e com cada mudança registrada no RASTRO (ADR-011).
 * É lá que o contexto carregado mora, e é de lá que ele não se perde.
 *
 * SÓ QUE NADA DO CAMINHO DE LEITURA OLHA PARA LÁ AINDA. Os dois caminhos por
 * onde o contexto chega ao modelo passam por `KnowledgeNote`:
 *
 *   · `ContextBuilder.montar` chama `ObsidianService.search`, que consulta
 *     `KnowledgeNote` (`obsidian/obsidian.service.ts`);
 *   · a capacidade `contexto.memoria.buscar`, que o assistente declara, tem por
 *     efeito a MESMA `ObsidianService.search` (`agents/efeitos.service.ts`).
 *
 * Uma empresa que carregasse o contexto só na memória canônica teria a primeira
 * resposta saindo sem fonte nenhuma — e resposta sem fonte, desde a onda 10,
 * acende sinal e sobe a barra da régua para 24h. Numa empresa recém-criada,
 * com um usuário só e sem quem aprove o que ele mesmo propôs, isso trava tudo.
 *
 * Então a carga grava nos dois: a memória é a verdade, o índice é o que a
 * busca alcança. `migrar-conhecimento.ts` faz a viagem no sentido contrário
 * (índice → memória) para o acervo antigo; este arquivo faz a de ida para o
 * contexto novo. **As duas somem no dia em que o `ContextBuilder` ler a
 * memória** — está no relatório da fatia, em FORA DO ESCOPO.
 *
 * ----------------------------------------------------------------------------
 * QUEM APAGA ESTE ESPELHO — a parte que faltava, e que custou a reprovação
 * ----------------------------------------------------------------------------
 * `ObsidianService.reindex`. Ele faz, nesta ordem:
 *
 *   1. `prisma.knowledgeNote.deleteMany({ where: { orgId } })` — o índice
 *      INTEIRO da empresa, incluindo estas notas, que não vieram de vault
 *      nenhuma;
 *   2. recria a partir de `OBSIDIAN_VAULT_PATH`, que é UMA pasta do ambiente,
 *      a mesma para todas as empresas. Numa empresa cliente, isso enche o
 *      índice dela com as notas da CASA;
 *   3. `projetarNaMemoria`, que leva aquelas notas para a `ContextItem` da
 *      empresa como `sourceType: vault`.
 *
 * E A PERMISSÃO QUE LIBERA AQUILO É A MESMA QUE A CARGA USA: `obsidian.editar`,
 * em `POST /api/knowledge/reindex`. Quem carrega o contexto pode disparar a
 * reindexação sem passar por ninguém — não é um administrador da ROOT que
 * precisa errar, é o próprio cliente clicando em "reindexar" na tela de
 * Conexões.
 *
 * O QUE SOBREVIVE: a memória canônica da carga (`ContextItem` com
 * `sourceType: operador` e chave `onboarding:*`). `reindex` não a apaga — ele
 * arquiva o que veio de `vault` — e o estado da entrada é derivado dela, então
 * a carga não volta à estaca zero e o retrato continua existindo.
 *
 * O QUE SE PERDE: o ALCANCE da busca. Até a próxima passagem pelo fecho da
 * carga, o agente não acha as notas do onboarding.
 *
 * O REMENDO QUE ESTA FATIA TEM: `OnboardingService.fechar` REESPELHA todas as
 * notas dos temas, não só o retrato. "Ler de volta" passou a ser também o
 * conserto — uma volta pelo fecho devolve as notas ao índice. O conserto de
 * verdade é o `reindex` respeitar origem (apagar só o que veio da vault) e está
 * em FORA DO ESCOPO no relatório: `src/obsidian/` não é arquivo desta fatia.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE ESPELHO NÃO RESOLVE, e está escrito para ninguém supor que sim
 * ----------------------------------------------------------------------------
 * O VETOR. `ObsidianService.search` roda em modo semântico sempre que
 * `OPENAI_API_KEY` existe, e aquele SQL filtra `embedding IS NOT NULL`. O
 * embedding de `KnowledgeNote` só é gerado dentro de `reindex`, que roda para a
 * empresa da CASA e mais nenhuma. Logo: com a chave presente, a busca não acha
 * estas notas, por mais bem escritas que estejam.
 *
 * Gerar o vetor aqui não é opção — ler `OPENAI_API_KEY` fora de `src/llm/`
 * reprova a catraca de arquitetura, e seria a quarta cópia da mesma chamada. É
 * por isso que a PRIMEIRA RESPOSTA do produto é construída (`retrato.ts`) e não
 * pedida ao modelo, e é por isso que a pergunta livre ao assistente RELATA a
 * procedência medida em vez de prometê-la. O conserto de verdade é o provedor
 * de embeddings em `src/llm/`, que a própria catraca já declara como dívida
 * desta onda.
 *
 * A MEMÓRIA CANÔNICA, essa, é vetorizada sozinha: `vetorizarPendentesDaMemoria`
 * roda para TODA empresa a cada 30 minutos. É mais uma razão para o
 * `ContextBuilder` passar a ler de lá.
 */

/** A pasta virtual onde as notas da carga vivem dentro do índice. */
export const PASTA_DO_ONBOARDING = 'onboarding';

/**
 * O caminho da nota no índice, derivado da CHAVE ESTÁVEL da memória.
 *
 * Derivado, e não inventado: é a chave que faz responder de novo corrigir em
 * vez de duplicar, e o índice tem de herdar essa propriedade — `@@unique
 * ([orgId, path])` é o que a garante do lado de cá.
 */
export function caminhoDaNota(chave: string): string {
  const limpo = chave
    .replace(/^onboarding:/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${PASTA_DO_ONBOARDING}/${limpo || 'nota'}.md`;
}

export interface NotaParaIndice {
  chave: string;
  titulo: string;
  corpo: string;
  tags: readonly string[];
}

/**
 * Põe (ou atualiza) a nota no índice de conhecimento desta empresa.
 *
 * NÃO DERRUBA A CARGA quando falha — e a assimetria é deliberada: a memória
 * canônica já foi gravada quando esta função é chamada, então uma falha aqui
 * custa alcance da busca, não o contexto. Quem chama registra o aviso.
 */
export async function espelharNoIndice(
  prisma: PrismaClient,
  orgId: string,
  nota: NotaParaIndice,
): Promise<{ path: string; criada: boolean }> {
  const path = caminhoDaNota(nota.chave);
  const agora = new Date();
  const dados = {
    folder: PASTA_DO_ONBOARDING,
    title: nota.titulo,
    content: nota.corpo,
    tags: [...nota.tags],
    links: [] as string[],
    wordCount: nota.corpo.split(/\s+/).filter(Boolean).length,
    fileTime: agora,
    indexedAt: agora,
  };

  const existente = await prisma.knowledgeNote.findUnique({
    where: { orgId_path: { orgId, path } },
    select: { id: true },
  });

  if (existente) {
    await prisma.knowledgeNote.update({ where: { id: existente.id }, data: dados });
    return { path, criada: false };
  }

  await prisma.knowledgeNote.create({ data: { orgId, path, ...dados } });
  return { path, criada: true };
}
