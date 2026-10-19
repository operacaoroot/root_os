
ALTER TABLE "ContextItem" ADD COLUMN "acessoRestrito" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ContextItem" ADD COLUMN "leitores" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE UNIQUE INDEX "ContextItem_id_orgId_key" ON "ContextItem"("id","orgId");
CREATE UNIQUE INDEX "ContextItemVersion_id_orgId_itemId_key" ON "ContextItemVersion"("id","orgId","itemId");
CREATE UNIQUE INDEX "WorkTask_id_orgId_key" ON "WorkTask"("id","orgId");
CREATE TABLE "WorkContextSource" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "chave" TEXT NOT NULL,
  "versao" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "sourceType" "ContextSource" NOT NULL,
  "sourceRef" TEXT,
  "title" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkContextSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkContextSource_task_fkey" FOREIGN KEY ("taskId","orgId") REFERENCES "WorkTask"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WorkContextSource_item_fkey" FOREIGN KEY ("itemId","orgId") REFERENCES "ContextItem"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WorkContextSource_version_fkey" FOREIGN KEY ("versionId","orgId","itemId") REFERENCES "ContextItemVersion"("id","orgId","itemId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "WorkContextSource_taskId_key" ON "WorkContextSource"("taskId");
CREATE UNIQUE INDEX "WorkContextSource_orgId_requestId_key" ON "WorkContextSource"("orgId","requestId");
CREATE INDEX "WorkContextSource_orgId_taskId_idx" ON "WorkContextSource"("orgId","taskId");
CREATE INDEX "WorkContextSource_orgId_itemId_idx" ON "WorkContextSource"("orgId","itemId");
SELECT app_rls_aplicar_policies('WorkContextSource', 'public.app_org_resolvida() AND "orgId" = public.app_org_atual()', 'public.app_org_resolvida() AND "orgId" = public.app_org_atual()');
CREATE FUNCTION work_context_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WorkContextSource is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "WorkContextSource_immutable" BEFORE UPDATE ON "WorkContextSource"
  FOR EACH ROW EXECUTE FUNCTION work_context_source_immutable();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "WorkContextSource" TO mktos_app;
  END IF;
END $$;
CREATE FUNCTION context_item_readers_same_org() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF cardinality(NEW."leitores") <> (
    SELECT count(*) FROM "User" WHERE "orgId" = NEW."orgId" AND id = ANY(NEW."leitores")
  ) THEN
    RAISE EXCEPTION 'ContextItem readers must belong to its organization and be distinct' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ContextItem_leitores_confere_org" BEFORE INSERT OR UPDATE OF "leitores", "orgId" ON "ContextItem"
  FOR EACH ROW EXECUTE FUNCTION context_item_readers_same_org();
