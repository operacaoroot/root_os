CREATE TABLE "CofreDeposito" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "cliente" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "criadoPor" TEXT NOT NULL,
  "expiraEm" TIMESTAMP(3) NOT NULL,
  "revogadoEm" TIMESTAMP(3),
  "recebidos" INTEGER NOT NULL DEFAULT 0 CHECK ("recebidos" BETWEEN 0 AND 100),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CofreDeposito_orgId_idx" ON "CofreDeposito"("orgId");
CREATE UNIQUE INDEX "CofreDeposito_id_orgId_key" ON "CofreDeposito"("id", "orgId");
CREATE TABLE "CofreDepositoRecibo" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "depositoId" TEXT NOT NULL,
  "envioId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CofreDepositoRecibo_depositoId_orgId_fkey" FOREIGN KEY ("depositoId", "orgId") REFERENCES "CofreDeposito"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CofreDepositoRecibo_depositoId_envioId_key" ON "CofreDepositoRecibo"("depositoId", "envioId");
CREATE INDEX "CofreDepositoRecibo_orgId_idx" ON "CofreDepositoRecibo"("orgId");
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CofreDeposito', 'CofreDepositoRecibo'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    PERFORM public.app_rls_aplicar_policies(t,
      'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
      'public.app_org_resolvida() AND "orgId"=public.app_org_atual()', true, true, true);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO mktos_app', t);
    END IF;
  END LOOP;
END $$;
