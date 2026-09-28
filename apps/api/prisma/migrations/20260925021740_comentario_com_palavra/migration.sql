-- ============================================================================
-- MD9 — A FILA DA DM À MÃO: QUEM COMENTOU A PALAVRA-CHAVE (25/09/2026)
--
-- Uma linha por comentário que casou a palavra-chave da matéria num post da
-- semana (carrossel ou corte), lida pela rotina `pauta.coletar-comentarios` na
-- Graph, pela porta. A DM sai à mão, por isso o @ (`usuario`) é guardado — e só
-- até `expiraEm` (comentário + 7 dias, a janela da Meta): a rotina o anula
-- depois. O TEXTO do comentário nunca é gravado. `pessoaHmac` é o HMAC-SHA256
-- do id da pessoa no Instagram (META_WEBHOOK_PESSOA_HMAC_KEY), e é só ele que
-- o RASTRO leva quando alguém marca "respondido".
--
-- `commentId` é único por empresa: a coleta de 10 em 10 min relê os mesmos
-- comentários, e a reentrega cai na mesma linha.
--
-- Filha de `PautaPeca`, com a regra de filho de hoje: sentinela `''` e o
-- gatilho `mktos_orgid_do_pai('PautaPeca', 'pecaId')`, que deriva a empresa da
-- peça e RECUSA comentário pendurado em peça de outra empresa. Isolamento por
-- linha com leitura e escrita separadas, como toda tabela de empresa.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   DROP TABLE "ComentarioComPalavra";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260925021740_comentario_com_palavra';
--
-- A volta perde a fila (quem comentou e se já foi respondido). O RASTRO
-- `pauta.dm_manual_respondida` continua no banco, só com o HMAC.
-- ============================================================================

-- CreateTable
CREATE TABLE "ComentarioComPalavra" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "pecaId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "midiaId" TEXT NOT NULL,
    "palavra" TEXT NOT NULL,
    "pessoaHmac" TEXT NOT NULL,
    "usuario" TEXT,
    "comentadoEm" TIMESTAMP(3) NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "respondidoEm" TIMESTAMP(3),
    "respondidoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComentarioComPalavra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComentarioComPalavra_pecaId_idx" ON "ComentarioComPalavra"("pecaId");

-- CreateIndex
CREATE INDEX "ComentarioComPalavra_orgId_expiraEm_idx" ON "ComentarioComPalavra"("orgId", "expiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "ComentarioComPalavra_orgId_commentId_key" ON "ComentarioComPalavra"("orgId", "commentId");

-- AddForeignKey
ALTER TABLE "ComentarioComPalavra" ADD CONSTRAINT "ComentarioComPalavra_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComentarioComPalavra" ADD CONSTRAINT "ComentarioComPalavra_pecaId_fkey" FOREIGN KEY ("pecaId") REFERENCES "PautaPeca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTrigger: a empresa do comentário é a da peça.
CREATE TRIGGER "ComentarioComPalavra_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ComentarioComPalavra"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('PautaPeca', 'pecaId');

-- Isolamento por linha: o grupo padrão, leitura e escrita separadas.
SELECT app_rls_aplicar_policies(
  'ComentarioComPalavra',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "ComentarioComPalavra" TO mktos_app';
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
   WHERE n.nspname = 'public' AND c.relname = 'ComentarioComPalavra';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'ComentarioComPalavra ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ComentarioComPalavra_orgId_do_pai' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ComentarioComPalavra sem o gatilho que confere a empresa da peca.';
  END IF;
END $$;
