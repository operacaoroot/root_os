-- Cadastro sintético e recibo serão escritos numa única transação do preparador.
CREATE TABLE "DemoInstallation" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "inputFingerprint" TEXT NOT NULL,
  "destinationSignatureHash" TEXT NOT NULL,
  "selectionId" TEXT NOT NULL,
  "receipt" JSONB NOT NULL,
  "receiptHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DemoInstallation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DemoInstallation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "DemoInstallation_actor_tenant_fkey" FOREIGN KEY ("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "DemoInstallation_selection_tenant_fkey" FOREIGN KEY ("selectionId","orgId") REFERENCES "ContextCollectionSelection"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "DemoInstallation_identity_check" CHECK (
    "dataset"='rootos-v2-demo-2026-10-v1'
    AND "id" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    AND "requestId" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    AND "manifestHash" ~ '^[a-f0-9]{64}$' AND "sourceHash" ~ '^[a-f0-9]{64}$'
    AND "inputFingerprint" ~ '^[a-f0-9]{64}$' AND "destinationSignatureHash" ~ '^[a-f0-9]{64}$'
    AND "receiptHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "DemoInstallation_receipt_check" CHECK (COALESCE(
    jsonb_typeof("receipt")='object'
    AND octet_length("receipt"::text)<=65536
    AND "receipt"->'schemaVersion'='1'::jsonb
    AND "receipt"->>'tipo'='demo_installation_v1' AND "receipt"->'sintetico'='true'::jsonb
    AND "receipt"->>'installationId'="id" AND "receipt"->>'orgId'="orgId"
    AND "receipt"->>'actorId'="actorId" AND "receipt"->>'dataset'="dataset"
    AND "receipt"->>'requestId'="requestId" AND "receipt"->>'manifestHash'="manifestHash"
    AND "receipt"->>'sourceHash'="sourceHash" AND "receipt"->>'inputFingerprint'="inputFingerprint"
    AND "receipt"->>'destinationSignatureHashDaCriacao'="destinationSignatureHash"
    AND "receipt"->>'selectionId'="selectionId"
    AND jsonb_typeof("receipt"->'objects')='array' AND jsonb_array_length("receipt"->'objects')=13
    AND jsonb_typeof("receipt"->'auditIds')='array'
    AND jsonb_typeof("receipt"->'sourceBindings')='object'
    AND "receipt"->'sourceBindings'->>'orgId'="orgId"
    AND "receipt"->'sourceBindings'->>'dataset'="dataset"
    AND "receipt"->'sourceBindings'->>'selectionId'="selectionId"
    AND "receipt"->'effects'='{"modelo":false,"cron":false,"provider":false,"publicacao":false,"cobranca":false,"aprovacao":false,"F08gerado":false}'::jsonb,
    false
  ))
);
CREATE UNIQUE INDEX "DemoInstallation_id_orgId_key" ON "DemoInstallation"("id","orgId");
CREATE UNIQUE INDEX "DemoInstallation_orgId_dataset_key" ON "DemoInstallation"("orgId","dataset");
CREATE UNIQUE INDEX "DemoInstallation_orgId_requestId_key" ON "DemoInstallation"("orgId","requestId");

CREATE FUNCTION public.demo_installation_immutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DemoInstallation é um recibo imutável' USING ERRCODE='P0001';
END $$;
CREATE TRIGGER "DemoInstallation_immutable" BEFORE UPDATE OR DELETE ON "DemoInstallation"
FOR EACH ROW EXECUTE FUNCTION public.demo_installation_immutavel();

ALTER TABLE "DemoInstallation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DemoInstallation" FORCE ROW LEVEL SECURITY;
SELECT public.app_rls_aplicar_policies('DemoInstallation',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);
-- O ACL abaixo se limita à tabela nova e ao papel de aplicação já existente.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN
    GRANT SELECT,INSERT ON "DemoInstallation" TO mktos_app;
  END IF;
END $$;
