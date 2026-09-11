-- ============================================================================
-- A MEMÓRIA VERSIONADA, COM PROCEDÊNCIA (RF-M-01, RF-M-06) — fatia 4.1+4.2
--
-- Cria `ContextItem` (o estado corrente de uma nota de contexto) e
-- `ContextItemVersion` (uma linha por mudança), e as deixa nascer JÁ ISOLADAS:
-- `ENABLE` + `FORCE ROW LEVEL SECURITY` e as duas políticas, na mesma migration
-- que cria as tabelas.
--
-- O DESENHO está em `docs/adr/ADR-011-memoria.md`: a mudança da memória é um
-- EVENTO no RASTRO que já existe (`EventLog`), e estas duas tabelas são
-- PROJEÇÃO dele.
--
-- POR QUE O ISOLAMENTO ENTRA AQUI E NÃO DEPOIS. A migration
-- `20260911050000_isolamento_por_linha` termina com uma conferência que percorre
-- o catálogo e ABORTA se achar tabela de `public` sem RLS/FORCE/policy. Ela já
-- rodou e não vê estas tabelas (que nascem depois) — mas a catraca permanente
-- vê: `apps/api/test/tenant-isolation.test.ts` pergunta ao catálogo a mesma
-- coisa, e num banco recriado do zero a conferência da 1.5 volta a rodar antes
-- desta. Tabela de empresa sem policy é vazamento, não pendência. E migration
-- que aborta roda no `command` do container: abortar é a API não subir.
--
-- E AQUI O VAZAMENTO TEM UM AGRAVANTE PRÓPRIO: `ContextItem.embedding` é
-- `vector(1536)`. Uma consulta KNN sem filtro de empresa não precisa nem LER a
-- linha da outra para entregar o conteúdo dela — basta ordenar por distância e
-- devolver o texto do vizinho mais próximo. É a mesma razão pela qual
-- `KnowledgeNote` tem caso dedicado na suíte de isolamento.
--
-- ESCRITA À MÃO, e não por `prisma migrate dev`. Duas fatias desta onda criam
-- modelo no mesmo arquivo de schema; a geração automática compara o schema
-- INTEIRO com o banco e engoliria os modelos da outra aqui dentro.
--
-- PROVADA EM BANCO PRÓPRIO (`prova_41` no container `mktos-shadow`), do zero,
-- com o histórico inteiro aplicado antes, e o isolamento exercitado com o papel
-- RESTRITO `mktos_app` — não com o dono, que é superusuário, atravessa policy e
-- não exercita nada.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTAS TABELAS NÃO FAZEM: migrar dado
-- ----------------------------------------------------------------------------
-- `KnowledgeNote` continua intacta. Nenhuma linha é lida, copiada ou apagada
-- aqui. Quem traz o acervo da vault para a memória — PRESERVANDO os vetores, que
-- são a coisa cara — é um SCRIPT DE DADOS, separado e reversível:
--
--     node dist/memory/memoria.cli.js migrar --simular
--     node dist/memory/memoria.cli.js migrar
--     node dist/memory/memoria.cli.js conferir
--     node dist/memory/memoria.cli.js desfazer-migracao
--
-- É o mesmo precedente da fatia 5.3 (`src/cofre/migrar-credenciais.ts`), e pelo
-- mesmo motivo: este arquivo roda no `command` do container da api. Uma cópia de
-- 400 notas com vetor que falhe no meio derrubaria a API — e a API não sobe até
-- alguém entender por quê.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
-- O Prisma não tem migration de descida, e migration aplicada é IMUTÁVEL (o
-- banco guarda o resumo; editar o arquivo depois faz o banco continuar com o SQL
-- antigo enquanto o arquivo mostra o novo). Então o caminho de volta é escrito:
--
--  1. DADO: `memoria.cli.js desfazer-migracao` apaga o que a cópia trouxe (as
--     linhas com `sourceType = 'vault'` cuja `chave` começa em `vault:`). A
--     origem — `KnowledgeNote` — nunca foi tocada, então desfazer não perde
--     nada e os vetores continuam lá.
--  2. ESTRUTURA:
--
--       DROP TABLE "ContextItemVersion";
--       DROP TABLE "ContextItem";
--       DROP TYPE "ContextChange"; DROP TYPE "ContextSource"; DROP TYPE "ContextKind";
--       DELETE FROM "_prisma_migrations" WHERE migration_name = '20260911170000_memoria_versionada';
--
--     As policies somem junto com as tabelas. A ordem é sempre: desfazer o dado
--     primeiro (1), a estrutura depois (2).
-- ============================================================================

-- CreateEnum
CREATE TYPE "ContextKind" AS ENUM ('regra', 'definicao', 'dicionario', 'decisao', 'fato', 'nota');

-- CreateEnum
--
-- PROCEDÊNCIA É ENUM, e não texto livre, de propósito: RF-M-02 promete
-- procedência em TODA resposta, e um campo de texto livre aceita string vazia —
-- que é como "sem procedência" entra sem ninguém decidir que entrou.
CREATE TYPE "ContextSource" AS ENUM ('vault', 'upload', 'promocao', 'operador', 'conector');

-- CreateEnum
CREATE TYPE "ContextChange" AS ENUM ('criacao', 'alteracao', 'arquivamento', 'restauracao');

-- CreateTable
CREATE TABLE "ContextItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    -- A chave estável dentro da empresa (`vault:<caminho>` para o que veio do
    -- disco). É ela que faz a reindexação ser idempotente em vez de duplicar a
    -- memória a cada meia hora.
    "chave" TEXT NOT NULL,
    "kind" "ContextKind" NOT NULL DEFAULT 'nota',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceType" "ContextSource" NOT NULL,
    "sourceRef" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "supersedesId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    -- O vetor da nota CORRENTE. Versão antiga não tem vetor: guardar um por
    -- versão multiplicaria o custo mais caro do sistema sem ninguém consultar.
    "embedding" vector(1536),
    "contentHash" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "arquivadoEm" TIMESTAMP(3),
    "arquivadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPor" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPor" TEXT,

    CONSTRAINT "ContextItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextItemVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "mudanca" "ContextChange" NOT NULL,
    "kind" "ContextKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceType" "ContextSource" NOT NULL,
    "sourceRef" TEXT,
    "contentHash" TEXT NOT NULL,
    -- POR QUE mudou. É o campo que separa esta decisão da alternativa recusada
    -- no ADR-011: histórico de documento guarda o estado e perde a intenção.
    "motivo" TEXT,
    "autorTipo" TEXT NOT NULL DEFAULT 'user',
    "autorId" TEXT,
    -- O elo com o RASTRO. Nulo quando o registro do evento falhou — e o rastro
    -- nunca derruba a operação, então a ausência é o próprio sinal.
    "eventoId" TEXT,
    "eventoSeq" BIGINT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContextItemVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContextItem_supersedesId_key" ON "ContextItem"("supersedesId");

-- CreateIndex
--
-- UMA nota por (empresa, chave). Sem isto, cada reindexação da vault criaria uma
-- nota nova para o mesmo arquivo e o "histórico de versões" viraria um monte de
-- notas com uma versão cada — que é o oposto do que RF-M-01 pede.
CREATE UNIQUE INDEX "ContextItem_orgId_chave_key" ON "ContextItem"("orgId", "chave");

-- CreateIndex
CREATE INDEX "ContextItem_orgId_kind_idx" ON "ContextItem"("orgId", "kind");

-- CreateIndex
--
-- A consulta da tela e a do agente: "as notas VIVAS desta empresa"
-- (`"arquivadoEm" IS NULL`). Arquivamento é o estado normal de uma memória
-- antiga, então sem este índice a leitura mais quente varre tudo.
CREATE INDEX "ContextItem_orgId_arquivadoEm_idx" ON "ContextItem"("orgId", "arquivadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "ContextItemVersion_itemId_versao_key" ON "ContextItemVersion"("itemId", "versao");

-- CreateIndex
CREATE INDEX "ContextItemVersion_orgId_itemId_idx" ON "ContextItemVersion"("orgId", "itemId");

-- CreateIndex
CREATE INDEX "ContextItemVersion_orgId_criadoEm_idx" ON "ContextItemVersion"("orgId", "criadoEm");

-- AddForeignKey
ALTER TABLE "ContextItem" ADD CONSTRAINT "ContextItem_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextItem" ADD CONSTRAINT "ContextItem_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "ContextItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextItemVersion" ADD CONSTRAINT "ContextItemVersion_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
--
-- CASCADE, e é a única cascata desta migration: item apagado leva as versões
-- junto porque versão órfã não é histórico de nada. Apagar item, porém, não é o
-- caminho normal — o normal é ARQUIVAR (ver ADR-011).
ALTER TABLE "ContextItemVersion" ADD CONSTRAINT "ContextItemVersion_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "ContextItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA — modo forçado, duas políticas, nas DUAS tabelas
--
-- `app_rls_aplicar_policies` veio da migration do isolamento e faz o pacote
-- inteiro: DROP POLICY IF EXISTS (idempotente), CREATE POLICY de SELECT, INSERT,
-- UPDATE e DELETE, ENABLE e FORCE. Os argumentos são as mesmas expressões do
-- grupo padrão de lá: a empresa da sessão alcança o que é dela, e nada mais.
--
-- NENHUMA SENTINELA AQUI — nem a pública, nem a de plataforma. A memória é o
-- contexto do negócio do cliente: as regras da casa, o dicionário, as decisões.
-- Uma cláusula de sentinela na policy de LEITURA abriria a tabela inteira para
-- qualquer código que rodasse sob ela. O caminho de plataforma que precisa
-- atravessar empresas (a migração de dados, pela linha de comando) NÃO passa por
-- sentinela: roda com a conexão DONA das tabelas, fora do alcance de qualquer
-- requisição HTTP — o mesmo desenho do cofre.
--
-- `ContextItemVersion` recebe a MESMA expressão e não a derivada do pai. Ela
-- carrega `orgId` próprio (fatia 1.1 pôs `orgId` nas dez filhas por este motivo),
-- e derivar da mãe custaria um subselect em toda leitura de histórico.
-- ---------------------------------------------------------------------------
SELECT app_rls_aplicar_policies(
  'ContextItem',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

SELECT app_rls_aplicar_policies(
  'ContextItemVersion',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

-- ---------------------------------------------------------------------------
-- PERMISSÃO DO PAPEL RESTRITO
--
-- `20260911020000_papel_de_aplicacao` deixou `ALTER DEFAULT PRIVILEGES` ligado
-- para `mktos_app`, então tabela criada por `mkt` já nasce com os GRANTs. O
-- GRANT explícito existe para o caso em que ela NÃO nasceu assim — banco
-- restaurado de dump, ambiente em que a migration do papel rodou com outro
-- usuário. É idempotente e não custa nada.
--
-- Guardado por `pg_roles`: em banco onde o papel não existe (o Mac de quem só
-- roda a suíte padrão), GRANT para papel inexistente aborta a migration — e
-- migration que aborta no `command` do container é a API não subir.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "ContextItem" TO mktos_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "ContextItemVersion" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — a mesma pergunta da 1.5, sobre estas duas tabelas
--
-- Falha ALTA de propósito: se a chamada acima deixar de existir num rebase mal
-- resolvido, é melhor a migration abortar aqui do que o contexto do negócio de
-- uma empresa entrar em produção legível — e pesquisável por vetor — pelas
-- outras.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tab text;
  ok  boolean;
BEGIN
  FOREACH tab IN ARRAY ARRAY['ContextItem', 'ContextItemVersion'] LOOP
    SELECT c.relrowsecurity
       AND c.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
      INTO ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = tab;

    IF NOT COALESCE(ok, false) THEN
      RAISE EXCEPTION
        '% ficou sem isolamento por linha (rls/force/policies). A MEMORIA guarda o contexto do negocio do cliente: sem policy e vazamento, nao pendencia.', tab;
    END IF;
  END LOOP;
END $$;
