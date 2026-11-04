-- ============================================================================
-- O DINHEIRO APARECE SOZINHO (etapa 4, 03/11/2026)
-- ============================================================================
--
-- ADITIVA: duas colunas opcionais, um índice único parcial, um índice e dois
-- gatilhos. Nenhuma linha existente é tocada; quem liga os dados que já existem
-- é o script `ligar-dinheiro-dos-contratos` (ensaio primeiro, aplicar depois de
-- o dono conferir).
--
-- 1. "AcordoComercial"."comercialContratoId": o contrato do registro comercial
--    cujo dinheiro o acordo guarda. Um acordo por contrato (índice único parcial:
--    acordo à mão, com NULL, não conta).
-- 2. "Contract"."comercialContratoId": o contrato do Financeiro que o fechamento
--    escreveu aponta para o mesmo registro. Com ele, o dinheiro mora nas parcelas
--    do acordo e o contrato do Financeiro não é projetado (fluxo, Análise, rotina).
--
-- As duas são raiz de empresa ("orgId" vem do insert): o gatilho
-- `mktos_orgid_do_pai` confere que o registro apontado é da mesma empresa
-- (empresa cruzada é recusada; NULL passa). As tabelas já têm RLS FORCE.
--
-- CAMINHO DE VOLTA (a imagem anterior não lê estas colunas; só se preciso):
--   DROP TRIGGER "AcordoComercial_orgId_do_pai_contrato" ON "AcordoComercial";
--   DROP TRIGGER "Contract_orgId_do_pai_contrato_comercial" ON "Contract";
--   ALTER TABLE "AcordoComercial" DROP COLUMN "comercialContratoId";
--   ALTER TABLE "Contract" DROP COLUMN "comercialContratoId";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261103230000_dinheiro_do_contrato';
-- Os acordos e parcelas que o fechamento criou ficam (são dinheiro de verdade);
-- sem a ligação, o contrato do Financeiro volta a ser projetado.
-- ============================================================================

ALTER TABLE "AcordoComercial" ADD COLUMN "comercialContratoId" TEXT;
ALTER TABLE "AcordoComercial" ADD CONSTRAINT "AcordoComercial_comercialContratoId_fkey"
  FOREIGN KEY ("comercialContratoId") REFERENCES "ComercialContrato"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "AcordoComercial_comercialContratoId_unico"
  ON "AcordoComercial" ("comercialContratoId")
  WHERE "comercialContratoId" IS NOT NULL;

ALTER TABLE "Contract" ADD COLUMN "comercialContratoId" TEXT;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_comercialContratoId_fkey"
  FOREIGN KEY ("comercialContratoId") REFERENCES "ComercialContrato"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Contract_comercialContratoId_idx" ON "Contract"("comercialContratoId");

-- A empresa do registro apontado tem de ser a da linha.
CREATE TRIGGER "AcordoComercial_orgId_do_pai_contrato"
  BEFORE INSERT OR UPDATE ON "AcordoComercial"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('ComercialContrato', 'comercialContratoId');
CREATE TRIGGER "Contract_orgId_do_pai_contrato_comercial"
  BEFORE INSERT OR UPDATE ON "Contract"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('ComercialContrato', 'comercialContratoId');

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: os dois gatilhos e os dois índices. Falha ALTA de
-- propósito: `migrate deploy` roda no arranque do container, e abortar aqui é a
-- API não subir com acordo de outra empresa ligável ou dois acordos no mesmo contrato.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  par text[];
BEGIN
  FOREACH par SLICE 1 IN ARRAY ARRAY[
    ARRAY['AcordoComercial', 'AcordoComercial_orgId_do_pai_contrato'],
    ARRAY['Contract', 'Contract_orgId_do_pai_contrato_comercial']
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relname = par[1] AND t.tgname = par[2] AND NOT t.tgisinternal
    ) THEN
      RAISE EXCEPTION '% sem o gatilho % que confere a empresa do contrato comercial.', par[1], par[2];
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'AcordoComercial' AND indexname = 'AcordoComercial_comercialContratoId_unico'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%WHERE%'
  ) THEN
    RAISE EXCEPTION 'AcordoComercial sem o índice único parcial de um acordo por contrato.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'Contract' AND indexname = 'Contract_comercialContratoId_idx'
  ) THEN
    RAISE EXCEPTION 'Contract sem o índice do contrato comercial.';
  END IF;
END $$;
