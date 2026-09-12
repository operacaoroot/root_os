import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { chaveDaVault, hashDoCorpo, PREFIXO_DA_VAULT, SEM_EVENTO } from './procedencia';

/**
 * O motivo que toda versão trazida pela migração carrega.
 *
 * CONSTANTE e não literal repetido: o mesmo texto aparece no `INSERT` daqui e no
 * `UPDATE` de retrocompatibilidade da migration
 * `20260911193000_memoria_elo_do_evento` (que marca `semEventoPorque` no que foi
 * copiado antes da coluna existir). Divergir em um dos dois deixaria linhas
 * antigas sem explicação — e "sem explicação" é justamente o diagnóstico que a
 * conferência de integridade trata como suspeita.
 */
export const MOTIVO_DA_MIGRACAO =
  'migração do acervo da vault para a MEMÓRIA (fatia 4.1+4.2, ADR-011)';

/*
 * ============================================================================
 * A MIGRAÇÃO DO ACERVO — `KnowledgeNote` → `ContextItem`, SEM PERDER OS VETORES
 * ============================================================================
 *
 * POR QUE ISTO É SCRIPT DE DADOS E NÃO MIGRATION DE BANCO
 * ------------------------------------------------------
 * `prisma migrate deploy` roda no `command` do container da api: migration que
 * falha no meio DERRUBA A API, e ela não volta até alguém entender por quê.
 * Copiar centenas de linhas com vetor de 1536 dimensões é exatamente o tipo de
 * operação que pode falhar no meio. O precedente da casa é a fatia 5.3
 * (`src/cofre/migrar-credenciais.ts`, chamado por `cofre.cli.js migrar`), e este
 * arquivo segue o mesmo desenho: comando separado, com simulação, conferência e
 * desfazer.
 *
 * O VETOR NUNCA PASSA POR DENTRO DO NODE
 * --------------------------------------
 * Cada nota é copiada por um `INSERT ... SELECT kn.embedding FROM "KnowledgeNote" kn`:
 * a coluna `vector` viaja de linha para linha DENTRO do banco. Ler 1536 números
 * por nota para Node e devolvê-los como texto seria três coisas ruins de uma vez
 * — memória, tempo, e a chance de perder precisão na ida e na volta. Aqui não há
 * conversão nenhuma, então não há o que perder.
 *
 * E EMBEDDING NÃO É RECALCULADO. Nem um. Recalcular custaria dinheiro no
 * fornecedor e produziria vetores DIFERENTES dos que já estão indexados (o
 * modelo muda de versão sem avisar), o que faria a busca semântica devolver
 * outra coisa depois da migração.
 *
 * O CRITÉRIO DE ACEITE É A CONTAGEM, NÃO A LEITURA DO CÓDIGO
 * ----------------------------------------------------------
 * `migrar` conta os vetores da origem ANTES, conta os do destino DEPOIS, e
 * ABORTA A TRANSAÇÃO se os dois números não baterem. Uma cópia que perdesse
 * vetor em silêncio só apareceria semanas depois, como "a busca piorou".
 *
 * A CONEXÃO PRECISA ATRAVESSAR O ISOLAMENTO POR LINHA. `ContextItem` nasce com
 * `FORCE ROW LEVEL SECURITY`, e FORCE vale para o DONO também: sob um papel que
 * não ignora policy, a varredura enxergaria zero linha e o script sairia
 * dizendo "nada a migrar" com ar de sucesso. `conferirQueAtravessaOIsolamento`
 * recusa antes — é a mesma conferência do cofre, pelo mesmo motivo.
 */

export interface OpcoesDaMigracao {
  /** Não grava nada: conta, confere e devolve o que FARIA. */
  simular?: boolean;
  /** Limita a uma empresa. Para conferir antes de rodar no acervo inteiro. */
  orgId?: string;
  actorId?: string | null;
}

export interface ContagemDeVetores {
  /** `KnowledgeNote` com `embedding IS NOT NULL`. */
  origem: number;
  /** `ContextItem` de origem `vault` com `embedding IS NOT NULL`. */
  destino: number;
}

export interface ResultadoDaMigracao {
  simulado: boolean;
  /** Notas na origem (com e sem vetor). */
  candidatas: number;
  copiadas: number;
  jaEstavam: number;
  antes: ContagemDeVetores;
  depois: ContagemDeVetores;
  duracaoMs: number;
}

export class MigracaoIndisponivelError extends Error {}

/**
 * Recusa rodar sob um papel que não atravessa o isolamento por linha.
 *
 * Cópia consciente de `RotacaoDeChaveService.conferirQueAtravessaOIsolamento`,
 * apontada para as tabelas desta fatia. Não é importada de lá porque aquele
 * serviço carrega o cofre inteiro junto (chaveiro, AES, inventário de
 * credenciais) para responder uma pergunta de três linhas ao catálogo.
 */
export async function conferirQueAtravessaOIsolamento(prisma: PrismaClient): Promise<void> {
  const r = await prisma.$queryRawUnsafe<
    Array<{ papel: string; ignora: boolean; ligado: boolean; forcado: boolean }>
  >(
    `SELECT current_user::text AS papel,
            (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS ignora,
            c.relrowsecurity AS ligado,
            c.relforcerowsecurity AS forcado
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'ContextItem'`,
  );
  const linha = r[0];
  if (!linha) {
    throw new MigracaoIndisponivelError(
      'a tabela ContextItem não existe neste banco — rode `prisma migrate deploy` antes.',
    );
  }
  if (!linha.ignora && linha.ligado && linha.forcado) {
    throw new MigracaoIndisponivelError(
      `conectado como "${linha.papel}", que NÃO ignora o isolamento por linha (não é ` +
        'superusuário nem tem BYPASSRLS) numa tabela com FORCE ROW LEVEL SECURITY. Ser DONO da ' +
        'tabela não basta: FORCE vale para o dono também. Sob este papel a varredura enxergaria ' +
        'só a empresa da sessão — que num script não existe — e a migração sairia dizendo "nada ' +
        'a migrar" com ar de sucesso. Use a MESMA conexão que roda migration (DATABASE_URL).',
    );
  }
}

/** As duas contagens que são o critério de aceite desta fatia. */
export async function contarVetores(
  prisma: PrismaClient,
  orgId?: string,
): Promise<ContagemDeVetores> {
  const filtro = orgId ? ' AND "orgId" = $1' : '';
  const args = orgId ? [orgId] : [];
  const origem = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "KnowledgeNote" WHERE embedding IS NOT NULL${filtro}`,
    ...args,
  );
  const destino = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "ContextItem"
      WHERE embedding IS NOT NULL AND "sourceType" = 'vault'${filtro}`,
    ...args,
  );
  return { origem: Number(origem[0]?.n ?? 0), destino: Number(destino[0]?.n ?? 0) };
}

interface NotaDaOrigem {
  id: string;
  orgId: string;
  path: string;
  title: string;
  content: string;
  tags: string[];
  fileTime: Date;
}

/**
 * Copia o acervo da vault para a MEMÓRIA, preservando os vetores.
 *
 * IDEMPOTENTE: `ON CONFLICT ("orgId", "chave") DO NOTHING`. Rodar duas vezes não
 * duplica nada e não regrava versão — o que já está lá já está lá.
 *
 * NADA É APAGADO DA ORIGEM. `KnowledgeNote` continua exatamente como estava, e é
 * isso que torna `desfazerMigracao` gratuito.
 */
export async function migrarConhecimentoParaAMemoria(
  prisma: PrismaClient,
  opcoes: OpcoesDaMigracao = {},
): Promise<ResultadoDaMigracao> {
  const comecou = Date.now();
  await conferirQueAtravessaOIsolamento(prisma);

  const antes = await contarVetores(prisma, opcoes.orgId);

  const notas = await prisma.$queryRawUnsafe<NotaDaOrigem[]>(
    `SELECT id, "orgId", path, title, content, tags, "fileTime"
       FROM "KnowledgeNote"
      ${opcoes.orgId ? 'WHERE "orgId" = $1' : ''}
      ORDER BY "orgId", path`,
    ...(opcoes.orgId ? [opcoes.orgId] : []),
  );

  if (opcoes.simular) {
    const jaEstavam = await contarJaMigradas(prisma, notas);
    return {
      simulado: true,
      candidatas: notas.length,
      copiadas: notas.length - jaEstavam,
      jaEstavam,
      antes,
      depois: { origem: antes.origem, destino: antes.origem },
      duracaoMs: Date.now() - comecou,
    };
  }

  let copiadas = 0;
  let jaEstavam = 0;

  /*
   * TUDO NUMA TRANSAÇÃO, e o `timeout` é generoso de propósito: a conferência
   * final só serve para alguma coisa se a rejeição DESFIZER a cópia. Uma
   * migração parcial que passasse pela conferência por acaso seria pior do que
   * nenhuma — o acervo ficaria metade aqui, metade lá, e ninguém saberia qual
   * metade.
   */
  const resultado = await prisma.$transaction(
    async (tx) => {
      for (const nota of notas) {
        const chave = chaveDaVault(nota.path);
        const itemId = randomUUID();
        const contentHash = hashDoCorpo(nota.content);

        /*
         * O `SELECT kn.embedding` é o coração desta fatia: o vetor sai de uma
         * linha e entra na outra sem sair do Postgres. `ON CONFLICT DO NOTHING`
         * torna a repetição inofensiva.
         */
        const inseriu = await tx.$executeRawUnsafe(
          `INSERT INTO "ContextItem"
             (id, "orgId", chave, kind, title, body, tags, "sourceType", "sourceRef",
              confidence, embedding, "contentHash", versao, "criadoEm", "criadoPor",
              "atualizadoEm", "atualizadoPor")
           SELECT $1, $2, $3, 'nota', $4, $5, $6, 'vault', $7,
                  1, kn.embedding, $8, 1, $9, $10, now(), $10
             FROM "KnowledgeNote" kn
            WHERE kn.id = $11
           ON CONFLICT ("orgId", chave) DO NOTHING`,
          itemId,
          nota.orgId,
          chave,
          nota.title,
          nota.content,
          nota.tags ?? [],
          nota.path,
          contentHash,
          nota.fileTime,
          opcoes.actorId ?? null,
          nota.id,
        );

        if (inseriu === 0) {
          jaEstavam++;
          continue;
        }
        copiadas++;

        /*
         * A VERSÃO 1 — a projeção do "nasceu aqui". Sem ela, o acervo migrado
         * apareceria na tela como notas sem história nenhuma, e o primeiro
         * histórico só existiria depois da primeira edição.
         *
         * `eventoId` fica nulo: não há evento para uma migração feita fora da
         * aplicação, e inventar um seria escrever no RASTRO de cada empresa uma
         * linha de operação que ninguém daquela empresa fez. Quem registra que
         * a migração aconteceu é o log do comando e este `motivo`.
         *
         * `semEventoPorque = 'migracao'` É O QUE SEPARA ISTO DE UM DEFEITO, e é
         * conserto de um defeito real: sem a coluna, a linha nascia EXATAMENTE
         * igual à versão cujo registro de evento FALHOU — o valor que o serviço
         * documenta como sinal de falha de rastro. Depois de migrar o acervo, o
         * histórico exibiria centenas de linhas com cara de erro, e um sinal com
         * dois significados não é sinal.
         */
        await tx.$executeRawUnsafe(
          `INSERT INTO "ContextItemVersion"
             (id, "orgId", "itemId", versao, mudanca, kind, title, body, "sourceType",
              "sourceRef", "contentHash", motivo, "autorTipo", "autorId", "semEventoPorque",
              "criadoEm")
           VALUES ($1, $2, $3, 1, 'criacao', 'nota', $4, $5, 'vault', $6, $7, $8, 'system', $9,
                   $10, now())`,
          randomUUID(),
          nota.orgId,
          itemId,
          nota.title,
          nota.content,
          nota.path,
          contentHash,
          MOTIVO_DA_MIGRACAO,
          opcoes.actorId ?? null,
          SEM_EVENTO.migracao,
        );
      }

      const depois = await contarVetoresNaTransacao(tx, opcoes.orgId);

      /*
       * A CONFERÊNCIA QUE É O CRITÉRIO DE ACEITE. Dentro da transação, de
       * propósito: lançar aqui DESFAZ a cópia inteira.
       *
       * A comparação é contra `antes.origem` e não contra `depois.origem`
       * porque as duas têm de ser iguais — se a origem mudou no meio da
       * migração, alguém reindexou a vault enquanto isto rodava, e o número que
       * vale já não é nenhum dos dois.
       */
      if (depois.origem !== antes.origem) {
        throw new Error(
          `a origem mudou durante a migração (${antes.origem} → ${depois.origem} vetores em ` +
            'KnowledgeNote): alguém reindexou a vault enquanto isto rodava. Nada foi gravado; ' +
            'rode de novo com a reindexação parada (OBSIDIAN_REINDEX_MIN=0).',
        );
      }
      if (depois.destino !== antes.origem) {
        throw new Error(
          `PERDA DE VETOR: a origem tinha ${antes.origem} nota(s) com embedding e o destino ` +
            `ficou com ${depois.destino}. A transação foi desfeita e NADA foi gravado — ` +
            'reconstruir embedding custa dinheiro no fornecedor e produz vetores diferentes ' +
            'dos que já estão indexados.',
        );
      }

      return { copiadas, jaEstavam, depois };
    },
    { timeout: 600_000, maxWait: 30_000 },
  );

  return {
    simulado: false,
    candidatas: notas.length,
    copiadas: resultado.copiadas,
    jaEstavam: resultado.jaEstavam,
    antes,
    depois: resultado.depois,
    duracaoMs: Date.now() - comecou,
  };
}

/**
 * DESFAZER — apaga SÓ O QUE A MIGRAÇÃO TROUXE E NINGUÉM ENCOSTOU DESDE ENTÃO.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE COMANDO FAZIA DE ERRADO, escrito porque é o tipo de erro que volta
 * ----------------------------------------------------------------------------
 * O critério era "origem `vault` E chave começando em `vault:`" — e isso NÃO é
 * "o que a migração trouxe". Nota da vault que ganhou versões novas depois
 * (alguém corrigiu o texto na tela, a reindexação registrou uma alteração), e
 * nota criada pela PROJEÇÃO da vault — que nunca passou por este comando — caem
 * as duas nesse critério. Apagá-las levava o histórico junto pela cascata, o que
 * é o contrário da regra do próprio ADR-011: não se apaga, arquiva-se.
 *
 * ----------------------------------------------------------------------------
 * O CRITÉRIO AGORA — quatro condições, e as quatro têm de valer
 * ----------------------------------------------------------------------------
 *  1. origem `vault` e chave com o prefixo (o de antes, que continua valendo);
 *  2. a nota está na VERSÃO 1: nada aconteceu com ela depois da cópia;
 *  3. o histórico dela tem UMA linha só, e essa linha está marcada
 *     `semEventoPorque = 'migracao'` — ou seja, ela nasceu aqui;
 *  4. nenhuma versão dela tem elo com o RASTRO (`eventoId`/`eventoSeq`). Se tem,
 *     a aplicação agiu sobre ela e há evento apontando para uma linha que este
 *     DELETE apagaria — o ponteiro pendurado que a fatia acabou de fechar.
 *
 * O que não passa nas quatro é PRESERVADO e CONTADO: quem roda o comando vê o
 * número e sabe que sobrou coisa, em vez de descobrir depois que sumiu coisa.
 *
 * `KnowledgeNote` nunca foi tocada, então desfazer não perde nada — inclusive
 * os vetores continuam lá, exatamente onde estavam.
 */
export async function desfazerMigracao(
  prisma: PrismaClient,
  opcoes: { simular?: boolean; orgId?: string } = {},
): Promise<{ simulado: boolean; apagados: number; preservados: number }> {
  await conferirQueAtravessaOIsolamento(prisma);
  const filtro = opcoes.orgId ? ' AND ci."orgId" = $1' : '';
  const args = opcoes.orgId ? [opcoes.orgId] : [];

  /*
   * A MESMA condição serve à simulação, à contagem do que fica e ao DELETE. Uma
   * cópia por caminho é como o "simular" passa a dizer um número e o comando a
   * apagar outro.
   */
  const nasceuNaMigracao = `
      ci."sourceType" = 'vault'
      AND ci.chave LIKE '${PREFIXO_DA_VAULT}%'
      AND ci.versao = 1
      AND (SELECT count(*) FROM "ContextItemVersion" v WHERE v."itemId" = ci.id) = 1
      AND EXISTS (
        SELECT 1 FROM "ContextItemVersion" v
         WHERE v."itemId" = ci.id
           AND v."semEventoPorque" = '${SEM_EVENTO.migracao}'
           AND v."eventoId" IS NULL
           AND v."eventoSeq" IS NULL
      )${filtro}`;

  const daVault = `ci."sourceType" = 'vault' AND ci.chave LIKE '${PREFIXO_DA_VAULT}%'${filtro}`;

  const [alvo, total] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "ContextItem" ci WHERE ${nasceuNaMigracao}`,
      ...args,
    ),
    prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "ContextItem" ci WHERE ${daVault}`,
      ...args,
    ),
  ]);
  const preservados = Number(total[0]?.n ?? 0) - Number(alvo[0]?.n ?? 0);

  if (opcoes.simular) {
    return { simulado: true, apagados: Number(alvo[0]?.n ?? 0), preservados };
  }

  const apagados = await prisma.$executeRawUnsafe(
    `DELETE FROM "ContextItem" ci WHERE ${nasceuNaMigracao}`,
    ...args,
  );
  return { simulado: false, apagados, preservados };
}

async function contarJaMigradas(prisma: PrismaClient, notas: NotaDaOrigem[]): Promise<number> {
  if (notas.length === 0) return 0;
  const r = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "ContextItem" WHERE ("orgId", chave) IN (${notas
      .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
      .join(', ')})`,
    ...notas.flatMap((n) => [n.orgId, chaveDaVault(n.path)]),
  );
  return Number(r[0]?.n ?? 0);
}

type Transacao = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;

async function contarVetoresNaTransacao(
  tx: Transacao,
  orgId?: string,
): Promise<ContagemDeVetores> {
  const filtro = orgId ? ' AND "orgId" = $1' : '';
  const args = orgId ? [orgId] : [];
  const origem = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "KnowledgeNote" WHERE embedding IS NOT NULL${filtro}`,
    ...args,
  );
  const destino = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "ContextItem"
      WHERE embedding IS NOT NULL AND "sourceType" = 'vault'${filtro}`,
    ...args,
  );
  return { origem: Number(origem[0]?.n ?? 0), destino: Number(destino[0]?.n ?? 0) };
}
