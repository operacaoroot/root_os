-- Apenas recibos novos; inscrições anteriores permanecem sem pedido de geração.
ALTER TABLE "FinanceExerciseObligation"
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "creationFingerprint" TEXT,
  ADD COLUMN "generationResponse" JSONB;
CREATE UNIQUE INDEX "FinanceExerciseObligation_orgId_requestId_key"
  ON "FinanceExerciseObligation"("orgId", "requestId");
ALTER TABLE "FinanceExerciseObligation" ADD CONSTRAINT "FinanceExerciseObligation_generation_receipt_check"
CHECK (
  ("requestId" IS NULL AND "creationFingerprint" IS NULL AND "generationResponse" IS NULL)
  OR (
    "requestId" IS NOT NULL AND "creationFingerprint" IS NOT NULL AND "generationResponse" IS NOT NULL
    AND "requestId" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    AND "creationFingerprint" ~ '^[a-f0-9]{64}$'
    AND COALESCE(
      jsonb_typeof("generationResponse") = 'object'
      AND "generationResponse"->>'modo' = 'exercicio'
      AND "generationResponse"->>'orgId' = "orgId"
      AND "generationResponse"->>'actorId' = "createdById"
      AND "generationResponse"->>'requestId' = "requestId"
      AND "generationResponse"->>'obligationId' = "id"
      AND "generationResponse"->>'transactionId' = "transactionId"
      AND "generationResponse"->>'contractId' = "contractId"
      AND "generationResponse"->>'versionId' = "versionId"
      AND "generationResponse"->>'contentHash' = "contentHash"
      AND "generationResponse"->'replayed' = 'false'::jsonb,
      false
    )
  )
);
-- As FKs tenant, a RLS e o gatilho de imutabilidade da tabela não mudam.
