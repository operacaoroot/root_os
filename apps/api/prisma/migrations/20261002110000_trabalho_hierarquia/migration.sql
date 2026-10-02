-- ============================================================================
-- ROOT-16 — ESPAÇO E PASTA ANINHADA NO TRABALHO (contrato C-15)
--
-- A árvore passa a ser espaço → pastas aninhadas → listas → etapas → tarefas.
-- Tabela nova `WorkSpace`; colunas novas `WorkFolder.spaceId`, `.parentId` e
-- `.externalId` e `WorkList.spaceId`. Nenhum ID muda e nenhuma linha é
-- reescrita: o que existia fica com as colunas novas nulas, fora de espaço.
--
-- Cada nó guarda só o pai imediato (ver o comentário de `WorkSpace` no
-- `schema.prisma`): pasta de topo aponta o espaço, pasta aninhada aponta a mãe,
-- lista aponta a pasta ou o espaço. Os três CHECK do fim recusam dois pais.
--
-- ----------------------------------------------------------------------------
-- O QUE PODE ABORTAR ESTA MIGRATION (e deixa o banco como estava)
-- ----------------------------------------------------------------------------
-- O script roda numa transação só. As duas conferências abaixo vêm antes de
-- qualquer mudança e abortam com a lista do que precisa ser resolvido à mão:
--   1. `WorkList.externalId` repetido na mesma empresa: o índice único novo não
--      nasceria. A contagem de produção não foi medida (C-15).
--   2. Lista pendurada em pasta de OUTRA empresa (a lacuna da ROOT-12a-REV,
--      item 5): a chave estrangeira composta não nasceria.
-- Como `migrate deploy` roda no `command` do container, abortar aqui é a API
-- não subir. Resolva o dado, `prisma migrate resolve --rolled-back
-- 20261002110000_trabalho_hierarquia` e rode o deploy de novo.
--
-- ----------------------------------------------------------------------------
-- O LOTE DO CLICKUP DE 30/09 (decisão F-a do C-15)
-- ----------------------------------------------------------------------------
-- `capturar()` do importador lê uma lista FIXA de colunas, as de `1194a49`, e
-- por isso as colunas novas não mudam o fingerprint: o rollback automático do
-- lote continua valendo depois desta migration enquanto as colunas antigas das
-- linhas do lote não mudarem. Mudar nome de pasta, `folderId` de lista ou
-- qualquer coluna antiga dessas linhas aposenta o rollback (F-b: backup novo,
-- restauração ensaiada e registro no manifesto). Isso é da ROOT-17.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA (ensaiado na ROOT-16; sem perda só enquanto ninguém usou a
-- hierarquia). Recusa sozinho se houver espaço, pasta aninhada, nó com
-- externalId novo ou lista solta em espaço, porque voltar apagaria isso.
--
--   BEGIN;
--   DO $$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM "WorkSpace")
--        OR EXISTS (SELECT 1 FROM "WorkFolder" WHERE "spaceId" IS NOT NULL OR "parentId" IS NOT NULL OR "externalId" IS NOT NULL)
--        OR EXISTS (SELECT 1 FROM "WorkList" WHERE "spaceId" IS NOT NULL) THEN
--       RAISE EXCEPTION 'a hierarquia já está em uso; voltar apagaria espaços e pastas aninhadas';
--     END IF;
--   END $$;
--   ALTER TABLE "WorkList" DROP CONSTRAINT "WorkList_um_pai_so";
--   ALTER TABLE "WorkFolder" DROP CONSTRAINT "WorkFolder_um_pai_so";
--   ALTER TABLE "WorkFolder" DROP CONSTRAINT "WorkFolder_nao_e_mae_de_si";
--   ALTER TABLE "WorkList" DROP CONSTRAINT "WorkList_spaceId_orgId_fkey";
--   ALTER TABLE "WorkList" DROP CONSTRAINT "WorkList_folderId_orgId_fkey";
--   ALTER TABLE "WorkFolder" DROP CONSTRAINT "WorkFolder_parentId_orgId_fkey";
--   ALTER TABLE "WorkFolder" DROP CONSTRAINT "WorkFolder_spaceId_orgId_fkey";
--   DROP INDEX "WorkList_orgId_externalId_key";
--   DROP INDEX "WorkFolder_id_orgId_key";
--   DROP INDEX "WorkFolder_orgId_externalId_key";
--   DROP INDEX "WorkFolder_orgId_spaceId_parentId_name_key";
--   ALTER TABLE "WorkList" DROP COLUMN "spaceId";
--   ALTER TABLE "WorkFolder" DROP COLUMN "spaceId", DROP COLUMN "parentId", DROP COLUMN "externalId";
--   DROP TABLE "WorkSpace";
--   CREATE UNIQUE INDEX "WorkFolder_orgId_name_key" ON "WorkFolder"("orgId", "name");
--   ALTER TABLE "WorkList" ADD CONSTRAINT "WorkList_folderId_fkey" FOREIGN KEY ("folderId")
--     REFERENCES "WorkFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261002110000_trabalho_hierarquia';
--   COMMIT;
-- ============================================================================

-- 1. Conferências antes de qualquer mudança.
DO $$
DECLARE
  relatorio text;
BEGIN
  SELECT string_agg(format('empresa %s, externalId %s: listas %s', "orgId", "externalId", ids), E'\n')
    INTO relatorio
    FROM (
      SELECT "orgId", "externalId", string_agg("id", ', ' ORDER BY "id") AS ids
        FROM "WorkList"
       WHERE "externalId" IS NOT NULL
       GROUP BY "orgId", "externalId"
      HAVING count(*) > 1
    ) repetidas;
  IF relatorio IS NOT NULL THEN
    RAISE EXCEPTION E'WorkList.externalId repetido na mesma empresa; o índice único não nasce:\n%\nDecida qual lista guarda o id do ClickUp, anule o das outras e rode de novo.', relatorio;
  END IF;

  SELECT string_agg(format('lista %s (empresa %s) na pasta %s (empresa %s)', l."id", l."orgId", f."id", f."orgId"), E'\n')
    INTO relatorio
    FROM "WorkList" l
    JOIN "WorkFolder" f ON f."id" = l."folderId"
   WHERE f."orgId" <> l."orgId";
  IF relatorio IS NOT NULL THEN
    RAISE EXCEPTION E'lista pendurada em pasta de outra empresa; a chave composta não nasce:\n%\nMova cada lista para uma pasta da própria empresa (ou anule folderId) e rode de novo.', relatorio;
  END IF;
END $$;

-- 2. Espaço.
CREATE TABLE "WorkSpace" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSpace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkSpace_orgId_name_key" ON "WorkSpace"("orgId", "name");
CREATE UNIQUE INDEX "WorkSpace_orgId_externalId_key" ON "WorkSpace"("orgId", "externalId");
CREATE UNIQUE INDEX "WorkSpace_id_orgId_key" ON "WorkSpace"("id", "orgId");

ALTER TABLE "WorkSpace" ADD CONSTRAINT "WorkSpace_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Colunas novas, todas anuláveis e sem valor padrão: linha existente não muda.
ALTER TABLE "WorkFolder" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "spaceId" TEXT;

ALTER TABLE "WorkList" ADD COLUMN     "spaceId" TEXT;

-- 4. Unicidade de pasta entre irmãs. NULLS NOT DISTINCT (Postgres 15+): sem ele,
-- duas pastas de topo fora de espaço com o mesmo nome passariam, porque NULL é
-- diferente de NULL num índice único comum. O Prisma declara só as colunas.
DROP INDEX "WorkFolder_orgId_name_key";
CREATE UNIQUE INDEX "WorkFolder_orgId_spaceId_parentId_name_key" ON "WorkFolder"("orgId", "spaceId", "parentId", "name") NULLS NOT DISTINCT;

CREATE UNIQUE INDEX "WorkFolder_orgId_externalId_key" ON "WorkFolder"("orgId", "externalId");
CREATE UNIQUE INDEX "WorkFolder_id_orgId_key" ON "WorkFolder"("id", "orgId");
CREATE UNIQUE INDEX "WorkList_orgId_externalId_key" ON "WorkList"("orgId", "externalId");

-- 5. Chaves compostas com a empresa. A pasta da lista troca SET NULL por
-- RESTRICT: com `orgId` na chave, SET NULL anularia a empresa junto.
ALTER TABLE "WorkList" DROP CONSTRAINT "WorkList_folderId_fkey";

ALTER TABLE "WorkFolder" ADD CONSTRAINT "WorkFolder_spaceId_orgId_fkey" FOREIGN KEY ("spaceId", "orgId") REFERENCES "WorkSpace"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "WorkFolder" ADD CONSTRAINT "WorkFolder_parentId_orgId_fkey" FOREIGN KEY ("parentId", "orgId") REFERENCES "WorkFolder"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "WorkList" ADD CONSTRAINT "WorkList_folderId_orgId_fkey" FOREIGN KEY ("folderId", "orgId") REFERENCES "WorkFolder"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "WorkList" ADD CONSTRAINT "WorkList_spaceId_orgId_fkey" FOREIGN KEY ("spaceId", "orgId") REFERENCES "WorkSpace"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 6. Um pai só, e pasta não é mãe de si mesma. Ciclo mais longo é recusado no
-- serviço, sob o cadeado da árvore da empresa.
ALTER TABLE "WorkFolder" ADD CONSTRAINT "WorkFolder_um_pai_so" CHECK ("spaceId" IS NULL OR "parentId" IS NULL);
ALTER TABLE "WorkFolder" ADD CONSTRAINT "WorkFolder_nao_e_mae_de_si" CHECK ("parentId" IS NULL OR "parentId" <> "id");
ALTER TABLE "WorkList" ADD CONSTRAINT "WorkList_um_pai_so" CHECK ("spaceId" IS NULL OR "folderId" IS NULL);

-- 7. Isolamento por linha da tabela nova: o grupo padrão, leitura e escrita
-- separadas, como `PautaIdeia`. O `orgId` do espaço vem do insert (não há pai).
SELECT app_rls_aplicar_policies(
  'WorkSpace',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "WorkSpace" TO mktos_app';
  END IF;
END $$;
