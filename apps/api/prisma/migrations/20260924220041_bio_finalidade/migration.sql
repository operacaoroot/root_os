-- ============================================================================
-- MD5 — A CONEXÃO DE PUBLICAÇÃO DO INSTAGRAM
--
-- `finalidade` separa a conta que o criador liga à bio (leitura, pedida a todo
-- mundo) da conta da própria empresa que o OS usará para publicar (MD6). O
-- `state` do OAuth carrega a finalidade pedida; a conexão só fica
-- `publicacao` quando a Meta concedeu `instagram_business_content_publish`.
--
-- Colunas novas em duas tabelas que já têm RLS com FORCE e policies
-- (20260911050000_isolamento_por_linha): o isolamento vale para elas sem mudar
-- nada. O padrão `bio` mantém cada linha existente exatamente como era.
--
-- CAMINHO DE VOLTA
--   DROP INDEX "BioConexao_publicacao_unica";
--   ALTER TABLE "BioOauthState" DROP COLUMN "finalidade";
--   ALTER TABLE "BioConexao" DROP COLUMN "finalidade";
--   DROP TYPE "BioFinalidade";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260924220041_bio_finalidade';
-- ============================================================================

-- CreateEnum
CREATE TYPE "BioFinalidade" AS ENUM ('bio', 'publicacao');

-- AlterTable
ALTER TABLE "BioConexao" ADD COLUMN     "finalidade" "BioFinalidade" NOT NULL DEFAULT 'bio';

-- AlterTable
ALTER TABLE "BioOauthState" ADD COLUMN     "finalidade" "BioFinalidade" NOT NULL DEFAULT 'bio';

-- Uma conta de publicação por empresa e plataforma. Duas deixariam o
-- publicador (MD6) escolher em silêncio em nome de qual @ o post sai. Parcial
-- porque conexões da bio continuam podendo ser várias. O Prisma não declara
-- índice parcial; o callback rebaixa a antiga na mesma transação em que grava
-- a nova, e este índice é o que segura duas autorizações simultâneas.
CREATE UNIQUE INDEX "BioConexao_publicacao_unica"
  ON "BioConexao"("orgId", "plataforma")
  WHERE "finalidade" = 'publicacao';
