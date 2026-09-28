-- ============================================================================
-- MD6 — O PUBLICADOR DO INSTAGRAM (24/09/2026)
--
-- A publicação de uma peça da semana numa rede, pelo OS: o estado da máquina
-- (pendente → container_criado/processando → publicada, ou erro/recusada), os
-- containers criados na Meta, o id e o permalink do post, as tentativas e
-- quando a rotina volta a olhar. Uma por peça e rede (índice único).
--
-- Filha de `PautaPeca`, com a regra de filho de hoje: sentinela `''` e o
-- gatilho `mktos_orgid_do_pai('PautaPeca', 'pecaId')`, que deriva a empresa da
-- peça e RECUSA publicação pendurada em peça de outra empresa. Isolamento por
-- linha com leitura e escrita separadas, como toda tabela de empresa.
--
-- `loteItemId` fica sem chave estrangeira de propósito: a tabela do lote é da
-- MD7/MD8 e ainda não existe. `approvalId` idem (é só a referência para o
-- RASTRO, sem apagar em cascata aprovação nenhuma).
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   DROP TABLE "PautaPublicacao"; DROP TYPE "PautaPublicacaoEstado"; DROP TYPE "PautaRede";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260924224733_pauta_publicacao';
--
-- A volta perde o registro das publicações (o post continua no Instagram, e o
-- RASTRO `pauta.publicacao_passo` continua no banco).
-- ============================================================================

-- CreateEnum
CREATE TYPE "PautaRede" AS ENUM ('instagram', 'youtube', 'tiktok');

-- CreateEnum
CREATE TYPE "PautaPublicacaoEstado" AS ENUM ('pendente', 'container_criado', 'processando', 'publicada', 'erro', 'recusada');

-- CreateTable
CREATE TABLE "PautaPublicacao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "pecaId" TEXT NOT NULL,
    "rede" "PautaRede" NOT NULL,
    "estado" "PautaPublicacaoEstado" NOT NULL DEFAULT 'pendente',
    "containers" JSONB NOT NULL DEFAULT '{}',
    "externalId" TEXT,
    "permalink" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaEm" TIMESTAMP(3),
    "erro" TEXT,
    "loteItemId" TEXT,
    "approvalId" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PautaPublicacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PautaPublicacao_orgId_estado_proximaEm_idx" ON "PautaPublicacao"("orgId", "estado", "proximaEm");

-- CreateIndex
CREATE UNIQUE INDEX "PautaPublicacao_pecaId_rede_key" ON "PautaPublicacao"("pecaId", "rede");

-- AddForeignKey
ALTER TABLE "PautaPublicacao" ADD CONSTRAINT "PautaPublicacao_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaPublicacao" ADD CONSTRAINT "PautaPublicacao_pecaId_fkey" FOREIGN KEY ("pecaId") REFERENCES "PautaPeca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTrigger: a empresa da publicação é a da peça.
CREATE TRIGGER "PautaPublicacao_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "PautaPublicacao"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('PautaPeca', 'pecaId');

-- Isolamento por linha: o grupo padrão, leitura e escrita separadas.
SELECT app_rls_aplicar_policies(
  'PautaPublicacao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "PautaPublicacao" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE, as quatro policies e o gatilho. Falha ALTA de
-- propósito — `migrate deploy` roda no arranque do container, e abortar aqui é
-- a API não subir com tabela vazada.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  ok boolean;
BEGIN
  SELECT c.relrowsecurity
     AND c.relforcerowsecurity
     AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
    INTO ok
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'PautaPublicacao';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'PautaPublicacao ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'PautaPublicacao_orgId_do_pai' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'PautaPublicacao sem o gatilho que confere a empresa da peca.';
  END IF;
END $$;
