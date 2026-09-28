-- ============================================================================
-- MC7 — O EPISÓDIO VIRA ENTIDADE DO OS (23/09/2026)
--
-- A rodada curada (MC6) vira episódio: número sequencial por empresa, status
-- próprio do roteiro ao concluído, e o lugar onde roteiro, mídia, transcrição,
-- títulos, thumbs, descrição e a página de links vão morar nas fatias MC8–MC12.
-- A coleta e a curadoria continuam sendo estados da RODADA.
--
-- ----------------------------------------------------------------------------
-- 1. FILHO 1:1 DA RODADA, COM A EMPRESA CONFERIDA PELO BANCO
-- ----------------------------------------------------------------------------
-- `PautaPeca`, a outra filha da rodada, é de antes da migration
-- `20260910120000_orgid_em_todo_filho` e grava o `orgId` pela aplicação, sem
-- conferência. Filho novo segue a regra de hoje (mesmo desenho de
-- `WorkApontamento` e dos filhos do onboarding): sentinela `''` e o gatilho
-- `mktos_orgid_do_pai('PautaRodada', 'rodadaId')`, que deriva a empresa da
-- rodada e RECUSA episódio pendurado em rodada de outra empresa. Um segundo
-- gatilho confere `bioPageId` contra `BioPage` (a FK é anulável; nulo passa):
-- sem ele, a página de links de outra empresa entrava no episódio com a FK
-- satisfeita. A função é a de `orgid_em_todo_filho` e não é redefinida aqui.
--
-- `rodadaId` é ÚNICO (uma rodada, um episódio) e a FK é RESTRICT: apagar a
-- rodada não pode levar roteiro e mídia junto — a API recusa antes, com 409.
-- `(orgId, numero)` é único: a numeração sai sob cadeado por empresa na API,
-- e o índice é a segunda tranca.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   DROP TABLE "PautaEpisodio"; DROP TYPE "PautaEpisodioStatus";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260924060000_pauta_episodio';
--
-- A volta PERDE os episódios. Exporte antes.
-- ============================================================================

-- CreateEnum
CREATE TYPE "PautaEpisodioStatus" AS ENUM ('roteiro', 'gravacao', 'edicao', 'pacote', 'derivacao', 'agendado', 'concluido');

-- CreateTable
CREATE TABLE "PautaEpisodio" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "rodadaId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "status" "PautaEpisodioStatus" NOT NULL DEFAULT 'roteiro',
    "roteiro" TEXT NOT NULL DEFAULT '',
    "midia" JSONB NOT NULL DEFAULT '{}',
    "transcricao" JSONB NOT NULL DEFAULT '[]',
    "transcricaoTexto" TEXT NOT NULL DEFAULT '',
    "titulos" JSONB NOT NULL DEFAULT '[]',
    "thumbs" JSONB NOT NULL DEFAULT '[]',
    "descricao" TEXT NOT NULL DEFAULT '',
    "bioPageId" TEXT,
    "criadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PautaEpisodio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PautaEpisodio_rodadaId_key" ON "PautaEpisodio"("rodadaId");

-- CreateIndex
CREATE INDEX "PautaEpisodio_orgId_status_idx" ON "PautaEpisodio"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PautaEpisodio_orgId_numero_key" ON "PautaEpisodio"("orgId", "numero");

-- AddForeignKey
ALTER TABLE "PautaEpisodio" ADD CONSTRAINT "PautaEpisodio_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaEpisodio" ADD CONSTRAINT "PautaEpisodio_rodadaId_fkey" FOREIGN KEY ("rodadaId") REFERENCES "PautaRodada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PautaEpisodio" ADD CONSTRAINT "PautaEpisodio_bioPageId_fkey" FOREIGN KEY ("bioPageId") REFERENCES "BioPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTrigger: a empresa do episódio é a da rodada; a página, se houver, também.
CREATE TRIGGER "PautaEpisodio_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "PautaEpisodio"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('PautaRodada', 'rodadaId');

CREATE TRIGGER "PautaEpisodio_orgId_da_pagina"
  BEFORE INSERT OR UPDATE ON "PautaEpisodio"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('BioPage', 'bioPageId');

-- Isolamento por linha: o grupo padrão, leitura e escrita separadas.
SELECT app_rls_aplicar_policies(
  'PautaEpisodio',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "PautaEpisodio" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE, as quatro policies e os dois gatilhos. Falha
-- ALTA de propósito — `migrate deploy` roda no arranque do container, e abortar
-- aqui é a API não subir com tabela vazada.
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
   WHERE n.nspname = 'public' AND c.relname = 'PautaEpisodio';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'PautaEpisodio ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'PautaEpisodio_orgId_do_pai' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'PautaEpisodio_orgId_da_pagina' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'PautaEpisodio sem os gatilhos que conferem a empresa da rodada e da pagina.';
  END IF;
END $$;
