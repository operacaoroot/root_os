-- CreateTable
CREATE TABLE "EditorialArtifact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workTaskId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "originSystem" TEXT,
    "originRef" TEXT,
    "createKey" TEXT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorialArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "workTaskId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "baseVersionId" TEXT,
    "body" TEXT NOT NULL,
    "sourceRefs" JSONB NOT NULL DEFAULT '[]',
    "contentHash" CHAR(64) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "authorType" "ActorType" NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorialVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialFile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workTaskId" TEXT NOT NULL,
    "uploadKey" TEXT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "displayName" TEXT NOT NULL,
    "mimeDeclared" TEXT,
    "mimeDetected" TEXT,
    "sizeBytes" BIGINT,
    "sha256" CHAR(64),
    "storageKey" TEXT NOT NULL,
    "originSystem" TEXT,
    "originRef" TEXT,
    "authorType" "ActorType" NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "EditorialFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialVersionFile" (
    "orgId" TEXT NOT NULL,
    "workTaskId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sha256AtLink" CHAR(64) NOT NULL,
    "sizeAtLink" BIGINT NOT NULL,
    "mimeAtLink" TEXT NOT NULL,

    CONSTRAINT "EditorialVersionFile_pkey" PRIMARY KEY ("versionId","fileId")
);

-- CreateIndex
CREATE INDEX "EditorialArtifact_orgId_workTaskId_idx" ON "EditorialArtifact"("orgId", "workTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialArtifact_id_workTaskId_orgId_key" ON "EditorialArtifact"("id", "workTaskId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialArtifact_orgId_createKey_key" ON "EditorialArtifact"("orgId", "createKey");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialArtifact_orgId_originSystem_originRef_key" ON "EditorialArtifact"("orgId", "originSystem", "originRef");

-- CreateIndex
CREATE INDEX "EditorialVersion_orgId_artifactId_createdAt_idx" ON "EditorialVersion"("orgId", "artifactId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialVersion_id_artifactId_workTaskId_orgId_key" ON "EditorialVersion"("id", "artifactId", "workTaskId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialVersion_id_workTaskId_orgId_key" ON "EditorialVersion"("id", "workTaskId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialVersion_artifactId_numero_key" ON "EditorialVersion"("artifactId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialVersion_orgId_idempotencyKey_key" ON "EditorialVersion"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "EditorialFile_orgId_workTaskId_state_idx" ON "EditorialFile"("orgId", "workTaskId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialFile_id_workTaskId_orgId_key" ON "EditorialFile"("id", "workTaskId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialFile_orgId_uploadKey_key" ON "EditorialFile"("orgId", "uploadKey");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialFile_orgId_storageKey_key" ON "EditorialFile"("orgId", "storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialFile_orgId_originSystem_originRef_key" ON "EditorialFile"("orgId", "originSystem", "originRef");

-- CreateIndex
CREATE INDEX "EditorialVersionFile_orgId_fileId_idx" ON "EditorialVersionFile"("orgId", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialVersionFile_versionId_position_key" ON "EditorialVersionFile"("versionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WorkTask_id_orgId_key" ON "WorkTask"("id", "orgId");

-- AddForeignKey
ALTER TABLE "EditorialArtifact" ADD CONSTRAINT "EditorialArtifact_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey

-- AddForeignKey
ALTER TABLE "EditorialVersion" ADD CONSTRAINT "EditorialVersion_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey

-- AddForeignKey
ALTER TABLE "EditorialFile" ADD CONSTRAINT "EditorialFile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey

-- P09: tenant/card/artefato são uma identidade composta, também no banco.
ALTER TABLE "EditorialArtifact" ADD CONSTRAINT "EditorialArtifact_workTaskId_orgId_fkey"
  FOREIGN KEY ("workTaskId", "orgId") REFERENCES "WorkTask"("id", "orgId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "EditorialVersion" ADD CONSTRAINT "EditorialVersion_artifactId_workTaskId_orgId_fkey"
  FOREIGN KEY ("artifactId", "workTaskId", "orgId")
  REFERENCES "EditorialArtifact"("id", "workTaskId", "orgId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "EditorialFile" ADD CONSTRAINT "EditorialFile_workTaskId_orgId_fkey"
  FOREIGN KEY ("workTaskId", "orgId") REFERENCES "WorkTask"("id", "orgId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "EditorialVersionFile" ADD CONSTRAINT "EditorialVersionFile_versionId_workTaskId_orgId_fkey"
  FOREIGN KEY ("versionId", "workTaskId", "orgId")
  REFERENCES "EditorialVersion"("id", "workTaskId", "orgId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "EditorialVersionFile" ADD CONSTRAINT "EditorialVersionFile_fileId_workTaskId_orgId_fkey"
  FOREIGN KEY ("fileId", "workTaskId", "orgId")
  REFERENCES "EditorialFile"("id", "workTaskId", "orgId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "EditorialArtifact" ADD CONSTRAINT "EditorialArtifact_currentVersionId_id_workTaskId_orgId_fkey"
  FOREIGN KEY ("currentVersionId", "id", "workTaskId", "orgId")
  REFERENCES "EditorialVersion"("id", "artifactId", "workTaskId", "orgId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "EditorialVersion" ADD CONSTRAINT "EditorialVersion_baseVersionId_artifactId_workTaskId_orgId_fkey"
  FOREIGN KEY ("baseVersionId", "artifactId", "workTaskId", "orgId")
  REFERENCES "EditorialVersion"("id", "artifactId", "workTaskId", "orgId") ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE "EditorialArtifact" ADD CONSTRAINT "EditorialArtifact_tipo_valido" CHECK ("tipo" IN ('roteiro', 'copy', 'pacote')),
  ADD CONSTRAINT "EditorialArtifact_origin_par" CHECK (("originSystem" IS NULL) = ("originRef" IS NULL)),
  ADD CONSTRAINT "EditorialArtifact_request_hash" CHECK ("requestHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "EditorialVersion" ADD CONSTRAINT "EditorialVersion_numero_pos" CHECK ("numero" > 0),
  ADD CONSTRAINT "EditorialVersion_body_size" CHECK (octet_length("body") BETWEEN 1 AND 524288),
  ADD CONSTRAINT "EditorialVersion_source_refs_array" CHECK (jsonb_typeof("sourceRefs") = 'array'),
  ADD CONSTRAINT "EditorialVersion_base_nao_self" CHECK ("baseVersionId" IS NULL OR "baseVersionId" <> "id"),
  ADD CONSTRAINT "EditorialVersion_content_hash" CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "EditorialVersion_request_hash" CHECK ("requestHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "EditorialFile" ADD CONSTRAINT "EditorialFile_origin_par" CHECK (("originSystem" IS NULL) = ("originRef" IS NULL)),
  ADD CONSTRAINT "EditorialFile_state_valido" CHECK ("state" IN ('pending', 'verified', 'failed')),
  ADD CONSTRAINT "EditorialFile_size_pos" CHECK ("sizeBytes" IS NULL OR "sizeBytes" >= 0),
  ADD CONSTRAINT "EditorialFile_sha256_formato" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "EditorialFile_verified_completo" CHECK
    ("state" <> 'verified' OR ("sha256" IS NOT NULL AND "sizeBytes" IS NOT NULL
      AND "mimeDetected" IS NOT NULL AND "verifiedAt" IS NOT NULL));
ALTER TABLE "EditorialVersionFile" ADD CONSTRAINT "EditorialVersionFile_posicao_pos" CHECK ("position" > 0),
  ADD CONSTRAINT "EditorialVersionFile_size_pos" CHECK ("sizeAtLink" >= 0),
  ADD CONSTRAINT "EditorialVersionFile_hash" CHECK ("sha256AtLink" ~ '^[0-9a-f]{64}$');

-- A versão só nasce sobre o ponteiro corrente. O lock impede dois escritores
-- de abrirem ao mesmo tempo ramos válidos em leituras anteriores ao INSERT.
CREATE FUNCTION editorial_version_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_id text; current_number integer;
BEGIN
  SELECT "currentVersionId" INTO current_id FROM "EditorialArtifact"
    WHERE id = NEW."artifactId" AND "orgId" = NEW."orgId" AND "workTaskId" = NEW."workTaskId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'editorial artifact missing'; END IF;
  IF NEW."baseVersionId" IS DISTINCT FROM current_id THEN RAISE EXCEPTION 'editorial base is not current'; END IF;
  IF current_id IS NULL THEN
    IF NEW."numero" <> 1 THEN RAISE EXCEPTION 'editorial first version must be 1'; END IF;
  ELSE
    SELECT "numero" INTO current_number FROM "EditorialVersion" WHERE id = current_id;
    IF NEW."numero" <> current_number + 1 THEN RAISE EXCEPTION 'editorial version must advance by one'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EditorialVersion_before_insert" BEFORE INSERT ON "EditorialVersion"
  FOR EACH ROW EXECUTE FUNCTION editorial_version_before_insert();

CREATE FUNCTION editorial_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'editorial version is immutable';
END $$;
CREATE TRIGGER "EditorialVersion_immutable" BEFORE UPDATE OR DELETE ON "EditorialVersion"
  FOR EACH ROW EXECUTE FUNCTION editorial_version_immutable();
CREATE TRIGGER "EditorialVersionFile_immutable" BEFORE UPDATE OR DELETE ON "EditorialVersionFile"
  FOR EACH ROW EXECUTE FUNCTION editorial_version_immutable();

CREATE FUNCTION editorial_artifact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_number integer; next_base text; old_number integer;
BEGIN
  IF (NEW.id, NEW."orgId", NEW."workTaskId", NEW.tipo, NEW."originSystem", NEW."originRef",
      NEW."createKey", NEW."requestHash", NEW."createdAt") IS DISTINCT FROM
     (OLD.id, OLD."orgId", OLD."workTaskId", OLD.tipo, OLD."originSystem", OLD."originRef",
      OLD."createKey", OLD."requestHash", OLD."createdAt") THEN
    RAISE EXCEPTION 'editorial artifact identity is immutable';
  END IF;
  IF NEW."currentVersionId" IS NOT DISTINCT FROM OLD."currentVersionId" THEN RETURN NEW; END IF;
  IF NEW."currentVersionId" IS NULL THEN RAISE EXCEPTION 'editorial pointer cannot return to null'; END IF;
  SELECT "numero", "baseVersionId" INTO next_number, next_base FROM "EditorialVersion"
    WHERE id = NEW."currentVersionId" AND "artifactId" = OLD.id
      AND "workTaskId" = OLD."workTaskId" AND "orgId" = OLD."orgId";
  IF NOT FOUND OR next_base IS DISTINCT FROM OLD."currentVersionId" THEN
    RAISE EXCEPTION 'editorial pointer has wrong base';
  END IF;
  IF OLD."currentVersionId" IS NULL THEN
    IF next_number <> 1 THEN RAISE EXCEPTION 'editorial pointer must start at 1'; END IF;
  ELSE
    SELECT "numero" INTO old_number FROM "EditorialVersion" WHERE id = OLD."currentVersionId";
    IF next_number <> old_number + 1 THEN RAISE EXCEPTION 'editorial pointer must advance by one'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EditorialArtifact_guard" BEFORE UPDATE ON "EditorialArtifact"
  FOR EACH ROW EXECUTE FUNCTION editorial_artifact_guard();

CREATE FUNCTION editorial_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state = 'verified' THEN RAISE EXCEPTION 'verified editorial file cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.state = 'verified' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'verified editorial file is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EditorialFile_guard" BEFORE UPDATE OR DELETE ON "EditorialFile"
  FOR EACH ROW EXECUTE FUNCTION editorial_file_guard();

-- O manifesto pode ser montado apenas enquanto a versão ainda não foi
-- promovida. Depois do ponteiro, nem INSERT tardio muda o material histórico.
CREATE FUNCTION editorial_version_file_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_row "EditorialVersion"%ROWTYPE; artifact_current text; file_row "EditorialFile"%ROWTYPE;
BEGIN
  SELECT * INTO version_row FROM "EditorialVersion" WHERE id = NEW."versionId";
  IF NOT FOUND THEN RAISE EXCEPTION 'editorial version missing'; END IF;
  SELECT "currentVersionId" INTO artifact_current FROM "EditorialArtifact"
    WHERE id = version_row."artifactId" FOR UPDATE;
  IF artifact_current IS DISTINCT FROM version_row."baseVersionId" THEN
    RAISE EXCEPTION 'editorial manifest is sealed';
  END IF;
  SELECT * INTO file_row FROM "EditorialFile" WHERE id = NEW."fileId" FOR UPDATE;
  IF NOT FOUND OR file_row.state <> 'verified' OR
     file_row."orgId" <> NEW."orgId" OR file_row."workTaskId" <> NEW."workTaskId" OR
     file_row.sha256 IS DISTINCT FROM NEW."sha256AtLink" OR
     file_row."sizeBytes" IS DISTINCT FROM NEW."sizeAtLink" OR
     file_row."mimeDetected" IS DISTINCT FROM NEW."mimeAtLink" THEN
    RAISE EXCEPTION 'editorial file metadata differs or file is unverified';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EditorialVersionFile_before_insert" BEFORE INSERT ON "EditorialVersionFile"
  FOR EACH ROW EXECUTE FUNCTION editorial_version_file_before_insert();

-- RLS entra na mesma migration; nenhuma sentinela de plataforma lê conteúdo.
SELECT app_rls_aplicar_policies('EditorialArtifact',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()');
SELECT app_rls_aplicar_policies('EditorialVersion',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()');
SELECT app_rls_aplicar_policies('EditorialFile',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()');
SELECT app_rls_aplicar_policies('EditorialVersionFile',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "EditorialArtifact", "EditorialVersion",
      "EditorialFile", "EditorialVersionFile" TO mktos_app;
  END IF;
END $$;
