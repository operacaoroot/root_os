-- Análise: acordos comerciais (pagante/permuta/repasse/parceria) e a leitura
-- diária da IA. Mesmo padrão de isolamento por empresa das tabelas novas.
CREATE TABLE "AcordoComercial" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "cliente" TEXT NOT NULL,
  "produto" TEXT NOT NULL,
  "valor" DECIMAL(14,2) NOT NULL,
  "tipo" TEXT NOT NULL,
  "observacao" TEXT,
  "apelidos" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcordoComercial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AcordoComercial_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AcordoComercial_tipo_check" CHECK ("tipo" IN ('pagante','permuta','repasse','parceria')),
  CONSTRAINT "AcordoComercial_valor_check" CHECK ("valor" >= 0)
);
CREATE INDEX "AcordoComercial_orgId_idx" ON "AcordoComercial"("orgId");

CREATE TABLE "AnaliseLeitura" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "dia" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "texto" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnaliseLeitura_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnaliseLeitura_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "AnaliseLeitura_orgId_dia_hash_key" ON "AnaliseLeitura"("orgId","dia","hash");

ALTER TABLE "AcordoComercial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcordoComercial" FORCE ROW LEVEL SECURITY;
SELECT public.app_rls_aplicar_policies('AcordoComercial',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,true,true);
ALTER TABLE "AnaliseLeitura" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnaliseLeitura" FORCE ROW LEVEL SECURITY;
SELECT public.app_rls_aplicar_policies('AnaliseLeitura',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,true,false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON "AcordoComercial" TO mktos_app;
    GRANT SELECT,INSERT ON "AnaliseLeitura" TO mktos_app;
  END IF;
END $$;
