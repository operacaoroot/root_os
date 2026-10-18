-- Vínculo explícito do índice onboarding. Sem adoção das linhas antigas.
BEGIN;
ALTER TABLE "KnowledgeNote"
  ADD COLUMN "mirrorOrigin" TEXT,
  ADD COLUMN "canonicalItemId" TEXT,
  ADD COLUMN "canonicalVersionId" TEXT,
  ADD COLUMN "canonicalVersion" INTEGER,
  ADD COLUMN "canonicalKey" TEXT,
  ADD COLUMN "canonicalSourceType" "ContextSource",
  ADD COLUMN "canonicalSourceRef" TEXT,
  ADD COLUMN "canonicalContentHash" TEXT;

CREATE UNIQUE INDEX "KnowledgeNote_orgId_canonicalItemId_key"
  ON "KnowledgeNote" ("orgId", "canonicalItemId");

ALTER TABLE "KnowledgeNote"
  ADD CONSTRAINT "KnowledgeNote_canonicalItem_fkey"
    FOREIGN KEY ("canonicalItemId", "orgId")
    REFERENCES "ContextItem" ("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeNote_canonicalVersion_fkey"
    FOREIGN KEY ("canonicalVersionId", "orgId", "canonicalItemId", "canonicalVersion")
    REFERENCES "ContextItemVersion" ("id", "orgId", "itemId", "versao")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeNote_mirror_package_check" CHECK (
    ("mirrorOrigin" IS NULL
      AND "canonicalItemId" IS NULL AND "canonicalVersionId" IS NULL
      AND "canonicalVersion" IS NULL AND "canonicalKey" IS NULL
      AND "canonicalSourceType" IS NULL AND "canonicalSourceRef" IS NULL
      AND "canonicalContentHash" IS NULL)
    OR
    ("mirrorOrigin" IS NOT NULL AND "mirrorOrigin" = 'onboarding'
      AND "canonicalItemId" IS NOT NULL
      AND "canonicalVersionId" IS NOT NULL
      AND "canonicalVersion" IS NOT NULL AND "canonicalVersion" > 0
      AND "canonicalKey" IS NOT NULL AND length("canonicalKey") > 0
      AND "canonicalSourceType" IS NOT NULL
      AND "canonicalSourceType" IN ('operador', 'promocao')
      AND "canonicalContentHash" IS NOT NULL
      AND "canonicalContentHash" ~ '^[a-f0-9]{64}$'
      AND "canonicalItemId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND "folder" IS NOT NULL AND "folder" = 'onboarding'
      AND "path" = 'onboarding/itens/' || "canonicalItemId" || '.md')
  );

CREATE FUNCTION app_onboarding_indice_binding_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."mirrorOrigin" IS NULL AND NEW."mirrorOrigin" IS NOT NULL THEN
    RAISE EXCEPTION 'Não associe uma linha antiga do índice por nome ou conteúdo.'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."mirrorOrigin" IS NOT NULL AND (
    NEW."mirrorOrigin" IS DISTINCT FROM OLD."mirrorOrigin"
    OR NEW."orgId" IS DISTINCT FROM OLD."orgId"
    OR NEW."canonicalItemId" IS DISTINCT FROM OLD."canonicalItemId"
    OR NEW."path" IS DISTINCT FROM OLD."path"
  ) THEN
    RAISE EXCEPTION 'A identidade da origem do índice não pode ser trocada.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_onboarding_indice_binding_guard() FROM PUBLIC;
CREATE TRIGGER "KnowledgeNote_mirror_identity_guard"
BEFORE UPDATE ON "KnowledgeNote"
FOR EACH ROW EXECUTE FUNCTION app_onboarding_indice_binding_guard();
COMMIT;
-- Sem backfill, UPDATE do legado, DELETE, GRANT ou política de plataforma.
-- FKs só provam associação. Versão corrente/arquivo/ACL/body/origem são gates do reader.
