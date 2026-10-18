CREATE UNIQUE INDEX IF NOT EXISTS "Lead_id_orgId_key" ON "Lead"("id","orgId");
CREATE UNIQUE INDEX IF NOT EXISTS "LeadEvent_id_orgId_key" ON "LeadEvent"("id","orgId");

CREATE TABLE "CommercialExerciseProject" (
 "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "leadId" TEXT NOT NULL,
 "aceiteId" TEXT NOT NULL, "propostaId" TEXT NOT NULL, "propostaVersao" INTEGER NOT NULL CHECK ("propostaVersao">0),
 "documentoHash" TEXT NOT NULL CHECK ("documentoHash" ~ '^[a-f0-9]{64}$'),
 "condicoesHash" TEXT NOT NULL CHECK ("condicoesHash" ~ '^[a-f0-9]{64}$'),
 "taskId" TEXT NOT NULL, "configuration" JSONB NOT NULL CHECK (jsonb_typeof("configuration")='object'),
 "creationFingerprint" TEXT NOT NULL CHECK ("creationFingerprint" ~ '^[a-f0-9]{64}$'),
 "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("id","orgId"), UNIQUE("orgId","aceiteId"), UNIQUE("orgId","taskId"),
 FOREIGN KEY("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT,
 FOREIGN KEY("leadId","orgId") REFERENCES "Lead"("id","orgId") ON DELETE RESTRICT,
 FOREIGN KEY("aceiteId","orgId") REFERENCES "LeadEvent"("id","orgId") ON DELETE RESTRICT,
 FOREIGN KEY("propostaId","orgId") REFERENCES "LeadEvent"("id","orgId") ON DELETE RESTRICT,
 FOREIGN KEY("taskId","orgId") REFERENCES "WorkTask"("id","orgId") ON DELETE RESTRICT,
 FOREIGN KEY("createdById","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT
);
CREATE TABLE "CommercialExerciseObligation" (
 "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "transactionId" TEXT NOT NULL,
 "versionId" TEXT NOT NULL, "contentHash" TEXT NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
 "snapshot" JSONB NOT NULL CHECK (jsonb_typeof("snapshot")='object'),
 "creationFingerprint" TEXT NOT NULL CHECK ("creationFingerprint" ~ '^[a-f0-9]{64}$'),
 "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("id","orgId"), UNIQUE("orgId","projectId"), UNIQUE("orgId","transactionId"),
 UNIQUE("orgId","versionId"), UNIQUE("id","orgId","versionId","contentHash"),
 FOREIGN KEY("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT,
 FOREIGN KEY("projectId","orgId") REFERENCES "CommercialExerciseProject"("id","orgId") ON DELETE RESTRICT,
 FOREIGN KEY("transactionId","orgId") REFERENCES "FinanceTransaction"("id","orgId") ON DELETE RESTRICT,
 FOREIGN KEY("createdById","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT
);
CREATE TABLE "CommercialExerciseRequest" (
 "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
 "action" TEXT NOT NULL CHECK ("action" IN ('projeto','obrigacao','decisao')), "entityId" TEXT NOT NULL,
 "fingerprint" TEXT NOT NULL CHECK ("fingerprint" ~ '^[a-f0-9]{64}$'),
 "response" JSONB NOT NULL CHECK (jsonb_typeof("response")='object'), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("id","orgId"), UNIQUE("orgId","requestId"),
 FOREIGN KEY("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT,
 FOREIGN KEY("entityId","orgId") REFERENCES "CommercialExerciseProject"("id","orgId") ON DELETE RESTRICT,
 FOREIGN KEY("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT
);
CREATE TABLE "CommercialExerciseDecision" (
 "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "obligationId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL CHECK ("fingerprint" ~ '^[a-f0-9]{64}$'),
 "versionId" TEXT NOT NULL, "contentHash" TEXT NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
 "expectedUpdatedAt" TIMESTAMP(3) NOT NULL, "aprovar" BOOLEAN NOT NULL,
 "motivo" TEXT NOT NULL CHECK (length(btrim("motivo")) BETWEEN 1 AND 2000),
 "alcada" TEXT NOT NULL CHECK ("alcada" IN ('responsavel','titular')),
 "response" JSONB NOT NULL CHECK (jsonb_typeof("response")='object'), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("id","orgId"), UNIQUE("orgId","requestId"), UNIQUE("orgId","obligationId"),
 FOREIGN KEY("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT,
 FOREIGN KEY("obligationId","orgId","versionId","contentHash") REFERENCES "CommercialExerciseObligation"("id","orgId","versionId","contentHash") ON DELETE RESTRICT,
 FOREIGN KEY("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT
);
CREATE FUNCTION comercial_ponte_exercicio_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Commercial exercise history is immutable';
END $$;
CREATE TRIGGER "CommercialExerciseProject_immutable" BEFORE UPDATE OR DELETE ON "CommercialExerciseProject" FOR EACH ROW EXECUTE FUNCTION comercial_ponte_exercicio_immutable();
CREATE TRIGGER "CommercialExerciseObligation_immutable" BEFORE UPDATE OR DELETE ON "CommercialExerciseObligation" FOR EACH ROW EXECUTE FUNCTION comercial_ponte_exercicio_immutable();
CREATE TRIGGER "CommercialExerciseRequest_immutable" BEFORE UPDATE OR DELETE ON "CommercialExerciseRequest" FOR EACH ROW EXECUTE FUNCTION comercial_ponte_exercicio_immutable();
CREATE TRIGGER "CommercialExerciseDecision_immutable" BEFORE UPDATE OR DELETE ON "CommercialExerciseDecision" FOR EACH ROW EXECUTE FUNCTION comercial_ponte_exercicio_immutable();
SELECT public.app_rls_aplicar_policies('CommercialExerciseProject','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);
SELECT public.app_rls_aplicar_policies('CommercialExerciseObligation','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);
SELECT public.app_rls_aplicar_policies('CommercialExerciseRequest','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);
SELECT public.app_rls_aplicar_policies('CommercialExerciseDecision','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN
 GRANT SELECT,INSERT ON "CommercialExerciseProject","CommercialExerciseObligation","CommercialExerciseRequest","CommercialExerciseDecision" TO mktos_app;
END IF; END $$;

ALTER TABLE "CommercialExerciseProject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommercialExerciseProject" FORCE ROW LEVEL SECURITY;

ALTER TABLE "CommercialExerciseObligation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommercialExerciseObligation" FORCE ROW LEVEL SECURITY;

ALTER TABLE "CommercialExerciseRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommercialExerciseRequest" FORCE ROW LEVEL SECURITY;

ALTER TABLE "CommercialExerciseDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommercialExerciseDecision" FORCE ROW LEVEL SECURITY;
