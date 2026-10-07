CREATE TABLE "EditorialMaterial" ("id" TEXT PRIMARY KEY,"orgId" TEXT NOT NULL,"taskId" TEXT NOT NULL,"title" TEXT NOT NULL,"releaseStatusId" TEXT NOT NULL,"selectedVersionId" TEXT,"revision" INTEGER NOT NULL DEFAULT 1,"requestId" TEXT NOT NULL,"actorId" TEXT NOT NULL,"fingerprint" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("id","orgId"),UNIQUE("orgId","taskId"),UNIQUE("orgId","requestId"),FOREIGN KEY("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT,FOREIGN KEY("taskId","orgId") REFERENCES "WorkTask"("id","orgId") ON DELETE RESTRICT,FOREIGN KEY("releaseStatusId") REFERENCES "WorkStatus"("id") ON DELETE RESTRICT,FOREIGN KEY("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT);
CREATE TABLE "EditorialVersion" ("id" TEXT PRIMARY KEY,"orgId" TEXT NOT NULL,"materialId" TEXT NOT NULL,"number" INTEGER NOT NULL,"title" TEXT NOT NULL,"body" TEXT NOT NULL,"files" JSONB NOT NULL DEFAULT '[]',"sourceRef" TEXT NOT NULL,"contentHash" TEXT NOT NULL,"requestId" TEXT NOT NULL,"actorId" TEXT NOT NULL,"fingerprint" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("id","orgId"),UNIQUE("orgId","materialId","number"),UNIQUE("orgId","requestId"),FOREIGN KEY("materialId","orgId") REFERENCES "EditorialMaterial"("id","orgId") ON DELETE RESTRICT,FOREIGN KEY("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT);
ALTER TABLE "EditorialMaterial" ADD CONSTRAINT "EditorialMaterial_selectedVersion_fkey" FOREIGN KEY("selectedVersionId","orgId") REFERENCES "EditorialVersion"("id","orgId") ON DELETE RESTRICT;
CREATE TABLE "EditorialDecision" ("id" TEXT PRIMARY KEY,"orgId" TEXT NOT NULL,"versionId" TEXT NOT NULL,"state" TEXT NOT NULL CHECK("state" IN ('approved','rejected')),"reason" TEXT NOT NULL,"minimumAuthority" TEXT NOT NULL DEFAULT 'responsavel',"authority" TEXT NOT NULL,"requestId" TEXT NOT NULL,"actorId" TEXT NOT NULL,"fingerprint" TEXT NOT NULL,"revokedAt" TIMESTAMP(3),"revokedBy" TEXT,"revokedReason" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("id","orgId"),UNIQUE("orgId","requestId"),FOREIGN KEY("versionId","orgId") REFERENCES "EditorialVersion"("id","orgId") ON DELETE RESTRICT,FOREIGN KEY("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT,FOREIGN KEY("revokedBy","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT);
CREATE UNIQUE INDEX "EditorialDecision_orgId_versionId_key" ON "EditorialDecision"("orgId","versionId");
CREATE TABLE "EditorialProduction" ("id" TEXT PRIMARY KEY,"orgId" TEXT NOT NULL,"taskId" TEXT NOT NULL,"materialId" TEXT NOT NULL,"versionId" TEXT NOT NULL,"decisionId" TEXT NOT NULL,"title" TEXT NOT NULL,"body" TEXT NOT NULL,"files" JSONB NOT NULL DEFAULT '[]',"sourceRef" TEXT NOT NULL,"contentHash" TEXT NOT NULL,"requestId" TEXT NOT NULL,"actorId" TEXT NOT NULL,"fingerprint" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("id","orgId"),UNIQUE("orgId","requestId"),FOREIGN KEY("taskId","orgId") REFERENCES "WorkTask"("id","orgId") ON DELETE RESTRICT,FOREIGN KEY("materialId","orgId") REFERENCES "EditorialMaterial"("id","orgId") ON DELETE RESTRICT,FOREIGN KEY("versionId","orgId") REFERENCES "EditorialVersion"("id","orgId") ON DELETE RESTRICT,FOREIGN KEY("decisionId","orgId") REFERENCES "EditorialDecision"("id","orgId") ON DELETE RESTRICT,FOREIGN KEY("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT);
CREATE INDEX "EditorialProduction_orgId_taskId_idx" ON "EditorialProduction"("orgId","taskId");
CREATE FUNCTION editorial_immutable() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Editorial history is immutable'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER "EditorialVersion_immutable" BEFORE UPDATE ON "EditorialVersion" FOR EACH ROW EXECUTE FUNCTION editorial_immutable();
CREATE TRIGGER "EditorialProduction_immutable" BEFORE UPDATE ON "EditorialProduction" FOR EACH ROW EXECUTE FUNCTION editorial_immutable();

CREATE FUNCTION editorial_material_binding() RETURNS trigger AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "WorkTask" t JOIN "WorkStatus" s ON s."listId"=t."listId" AND s."orgId"=t."orgId" WHERE t."id"=NEW."taskId" AND t."orgId"=NEW."orgId" AND s."id"=NEW."releaseStatusId") THEN RAISE EXCEPTION 'Editorial release status must belong to task list'; END IF;
  IF NEW."selectedVersionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "EditorialVersion" v WHERE v."id"=NEW."selectedVersionId" AND v."orgId"=NEW."orgId" AND v."materialId"=NEW."id") THEN RAISE EXCEPTION 'Editorial selected version must belong to material'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "EditorialMaterial_binding" BEFORE INSERT OR UPDATE ON "EditorialMaterial" FOR EACH ROW EXECUTE FUNCTION editorial_material_binding();
CREATE FUNCTION editorial_production_binding() RETURNS trigger AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EditorialMaterial" m JOIN "EditorialVersion" v ON v."materialId"=m."id" AND v."orgId"=m."orgId" JOIN "EditorialDecision" d ON d."versionId"=v."id" AND d."orgId"=v."orgId" WHERE m."id"=NEW."materialId" AND m."orgId"=NEW."orgId" AND m."taskId"=NEW."taskId" AND v."id"=NEW."versionId" AND d."id"=NEW."decisionId" AND v."title"=NEW."title" AND v."body"=NEW."body" AND v."files"=NEW."files" AND v."sourceRef"=NEW."sourceRef" AND v."contentHash"=NEW."contentHash") THEN RAISE EXCEPTION 'Editorial production must match its task, material, version and decision'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "EditorialProduction_binding" BEFORE INSERT ON "EditorialProduction" FOR EACH ROW EXECUTE FUNCTION editorial_production_binding();
CREATE FUNCTION editorial_decision_immutable() RETURNS trigger AS $$ BEGIN
  IF ROW(NEW."id",NEW."orgId",NEW."versionId",NEW."state",NEW."reason",NEW."minimumAuthority",NEW."authority",NEW."requestId",NEW."actorId",NEW."fingerprint",NEW."createdAt") IS DISTINCT FROM ROW(OLD."id",OLD."orgId",OLD."versionId",OLD."state",OLD."reason",OLD."minimumAuthority",OLD."authority",OLD."requestId",OLD."actorId",OLD."fingerprint",OLD."createdAt") OR OLD."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'Editorial decision history is immutable'; END IF;
  IF NEW."revokedAt" IS NULL OR NEW."revokedBy" IS NULL OR NEW."revokedReason" IS NULL THEN RAISE EXCEPTION 'Editorial revocation requires identity and reason'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "EditorialDecision_immutable" BEFORE UPDATE ON "EditorialDecision" FOR EACH ROW EXECUTE FUNCTION editorial_decision_immutable();

CREATE TABLE "MarketingAccountConfig" (
 "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "connectionId" TEXT NOT NULL,
 "externalId" TEXT NOT NULL, "handle" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
 "operators" TEXT[] NOT NULL DEFAULT '{}', "revision" INTEGER NOT NULL DEFAULT 1,
 "active" BOOLEAN NOT NULL DEFAULT true, "requestId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("id","orgId"), UNIQUE("orgId","connectionId"), UNIQUE("orgId","requestId"),
 FOREIGN KEY("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT,
 FOREIGN KEY("ownerId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT,
 FOREIGN KEY("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT
);
-- connectionId conserva a origem mesmo depois de desconexão pela Bio. O serviço
-- relê a conexão por empresa e recusa uso se ela não existe ou mudou de conta.
CREATE TABLE "MarketingPreparation" (
 "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
 "accountRevision" INTEGER NOT NULL, "connectionId" TEXT NOT NULL,
 "externalId" TEXT NOT NULL, "handle" TEXT NOT NULL, "taskId" TEXT NOT NULL,
 "versionId" TEXT NOT NULL, "decisionId" TEXT NOT NULL, "contentHash" TEXT NOT NULL,
 "scheduledAt" TIMESTAMP(3) NOT NULL, "timezone" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'prepared' CHECK("state"='prepared'),
 "requestId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("id","orgId"), UNIQUE("orgId","requestId"),
 FOREIGN KEY("accountId","orgId") REFERENCES "MarketingAccountConfig"("id","orgId") ON DELETE RESTRICT,
 FOREIGN KEY("taskId","orgId") REFERENCES "WorkTask"("id","orgId") ON DELETE RESTRICT,
 FOREIGN KEY("versionId","orgId") REFERENCES "EditorialVersion"("id","orgId") ON DELETE RESTRICT,
 FOREIGN KEY("decisionId","orgId") REFERENCES "EditorialDecision"("id","orgId") ON DELETE RESTRICT,
 FOREIGN KEY("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT
);
CREATE INDEX "MarketingPreparation_orgId_accountId_idx" ON "MarketingPreparation"("orgId","accountId");
CREATE FUNCTION marketing_preparation_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Preparation snapshot is immutable'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER "MarketingPreparation_immutable" BEFORE UPDATE ON "MarketingPreparation"
 FOR EACH ROW EXECUTE FUNCTION marketing_preparation_immutable();
