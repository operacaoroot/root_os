CREATE UNIQUE INDEX "Partner_id_orgId_key" ON "Partner"("id", "orgId");
CREATE TABLE "ClienteAcessoPerfil" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "userId" TEXT NOT NULL,
  "modo" TEXT NOT NULL CHECK ("modo" IN ('ALL','SELECTED')),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("userId", "orgId"),
  FOREIGN KEY ("userId", "orgId") REFERENCES "User"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "ClienteAcessoPerfil_orgId_idx" ON "ClienteAcessoPerfil"("orgId");
CREATE TABLE "ClienteAcessoVinculo" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "userId" TEXT NOT NULL,
  "clienteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("orgId", "userId", "clienteId"),
  FOREIGN KEY ("userId", "orgId") REFERENCES "ClienteAcessoPerfil"("userId", "orgId") ON DELETE CASCADE ON UPDATE RESTRICT,
  FOREIGN KEY ("clienteId", "orgId") REFERENCES "Partner"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "ClienteAcessoVinculo_orgId_clienteId_idx" ON "ClienteAcessoVinculo"("orgId", "clienteId");
-- Preserva somente o acesso organizacional dos usuários já ativos; não há default amplo.
INSERT INTO "ClienteAcessoPerfil" ("id","orgId","userId","modo")
SELECT gen_random_uuid()::text, "orgId", "id", 'ALL' FROM "User" WHERE "isActive";
ALTER TABLE "CofreItem" ADD COLUMN "clienteId" TEXT;
ALTER TABLE "CofreItem" ADD CONSTRAINT "CofreItem_clienteId_orgId_fkey" FOREIGN KEY ("clienteId","orgId") REFERENCES "Partner"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "CofreItem_orgId_clienteId_idx" ON "CofreItem"("orgId","clienteId");
ALTER TABLE "CofreDeposito" ADD COLUMN "clienteId" TEXT;
ALTER TABLE "CofreDeposito" ADD CONSTRAINT "CofreDeposito_clienteId_orgId_fkey" FOREIGN KEY ("clienteId","orgId") REFERENCES "Partner"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "CofreDeposito_orgId_clienteId_idx" ON "CofreDeposito"("orgId","clienteId");
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ClienteAcessoPerfil','ClienteAcessoVinculo'] LOOP
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
