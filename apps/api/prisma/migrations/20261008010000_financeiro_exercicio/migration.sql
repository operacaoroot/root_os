CREATE UNIQUE INDEX "FinanceTransaction_id_orgId_key" ON "FinanceTransaction"("id","orgId");
CREATE UNIQUE INDEX "Contract_id_orgId_key" ON "Contract"("id","orgId");

CREATE TABLE "FinanceExerciseObligation" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
  "snapshot" JSONB NOT NULL CHECK (jsonb_typeof("snapshot") = 'object'),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("id","orgId"),
  UNIQUE("orgId","transactionId"),
  UNIQUE("orgId","versionId"),
  UNIQUE("id","orgId","versionId","contentHash"),
  FOREIGN KEY("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT,
  FOREIGN KEY("transactionId","orgId") REFERENCES "FinanceTransaction"("id","orgId") ON DELETE RESTRICT,
  FOREIGN KEY("contractId","orgId") REFERENCES "Contract"("id","orgId") ON DELETE RESTRICT,
  FOREIGN KEY("createdById","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT
);

CREATE TABLE "FinanceExerciseDecision" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "obligationId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL CHECK ("fingerprint" ~ '^[a-f0-9]{64}$'),
  "versionId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
  "aprovar" BOOLEAN NOT NULL,
  "motivo" TEXT NOT NULL CHECK (length(btrim("motivo")) BETWEEN 1 AND 2000),
  "alcada" TEXT NOT NULL CHECK ("alcada" IN ('responsavel','titular')),
  "expectedUpdatedAt" TIMESTAMP(3) NOT NULL,
  "response" JSONB NOT NULL CHECK (jsonb_typeof("response") = 'object'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("id","orgId"),
  UNIQUE("orgId","requestId"),
  UNIQUE("orgId","obligationId"),
  FOREIGN KEY("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT,
  FOREIGN KEY("obligationId","orgId","versionId","contentHash") REFERENCES "FinanceExerciseObligation"("id","orgId","versionId","contentHash") ON DELETE RESTRICT,
  FOREIGN KEY("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT
);

CREATE FUNCTION financeiro_exercicio_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Financial exercise history is immutable';
END $$;
CREATE TRIGGER "FinanceExerciseObligation_immutable" BEFORE UPDATE OR DELETE ON "FinanceExerciseObligation"
  FOR EACH ROW EXECUTE FUNCTION financeiro_exercicio_immutable();
CREATE TRIGGER "FinanceExerciseDecision_immutable" BEFORE UPDATE OR DELETE ON "FinanceExerciseDecision"
  FOR EACH ROW EXECUTE FUNCTION financeiro_exercicio_immutable();

CREATE FUNCTION financeiro_exercicio_binding() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "FinanceTransaction" t
    JOIN "Contract" c ON c."id"=t."contractId" AND c."orgId"=t."orgId"
    WHERE t."id"=NEW."transactionId" AND t."orgId"=NEW."orgId"
      AND c."id"=NEW."contractId" AND t."status"='previsto'
      AND t."approvalStatus"='aguardando' AND t."paidAt" IS NULL AND t."reconciledAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Financial exercise requires its own contract and pending predicted transaction';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FinanceExerciseObligation_binding" BEFORE INSERT ON "FinanceExerciseObligation"
  FOR EACH ROW EXECUTE FUNCTION financeiro_exercicio_binding();

SELECT public.app_rls_aplicar_policies('FinanceExerciseObligation',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()', true, false, false);
SELECT public.app_rls_aplicar_policies('FinanceExerciseDecision',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()', true, false, false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN
    GRANT SELECT, INSERT ON "FinanceExerciseObligation", "FinanceExerciseDecision" TO mktos_app;
  END IF;
END $$;
