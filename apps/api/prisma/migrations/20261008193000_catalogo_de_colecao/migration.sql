CREATE UNIQUE INDEX "ContextItemVersion_id_orgId_itemId_versao_key" ON "ContextItemVersion"("id","orgId","itemId",versao);
CREATE TABLE "ContextCollectionSelection" (
 id TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "collectionId" TEXT NOT NULL,
 "sourceKind" TEXT NOT NULL DEFAULT 'vault_pasta' CHECK ("sourceKind"='vault_pasta'),
 generation BIGINT NOT NULL CHECK (generation>0), "marcaAntes" JSONB NOT NULL, "marcaDepois" JSONB,
 "membershipDigest" TEXT CHECK ("membershipDigest" ~ '^[a-f0-9]{64}$'),
 estado TEXT NOT NULL CHECK (estado IN ('classificado','projetado','falhou')),
 "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), "verificadaEm" TIMESTAMP(3),
 UNIQUE(id,"orgId"), UNIQUE("orgId","collectionId",generation),
 FOREIGN KEY("orgId") REFERENCES "Org"(id) ON DELETE RESTRICT,
 CHECK ((estado='falhou') OR (jsonb_typeof("marcaAntes")='object' AND "membershipDigest" IS NOT NULL)),
 CHECK ((estado='projetado')=("verificadaEm" IS NOT NULL)),
 CHECK (estado<>'projetado' OR "marcaDepois"="marcaAntes")
);
CREATE TABLE "ContextCollectionMember" (
 id TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "selectionId" TEXT NOT NULL, chave TEXT NOT NULL,
 "caminhoBytes" BYTEA NOT NULL CHECK (octet_length("caminhoBytes")>0),
 "blobGit" TEXT NOT NULL CHECK ("blobGit" ~ '^[a-f0-9]{40}$'),
 "hashArquivo" TEXT NOT NULL CHECK ("hashArquivo" ~ '^[a-f0-9]{64}$'),
 "contentHash" TEXT NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
 "metadataHash" TEXT NOT NULL CHECK ("metadataHash" ~ '^[a-f0-9]{64}$'),
 metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata)='object'),
 "itemId" TEXT, "versionId" TEXT, versao INTEGER,
 estado TEXT NOT NULL CHECK (estado IN ('classificado','projetado')),
 UNIQUE(id,"orgId"), UNIQUE("selectionId","caminhoBytes"), UNIQUE("selectionId",chave),
 FOREIGN KEY("orgId") REFERENCES "Org"(id) ON DELETE RESTRICT,
 FOREIGN KEY("selectionId","orgId") REFERENCES "ContextCollectionSelection"(id,"orgId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("itemId","orgId") REFERENCES "ContextItem"(id,"orgId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("versionId","orgId","itemId",versao) REFERENCES "ContextItemVersion"(id,"orgId","itemId",versao) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK ((estado='classificado' AND "itemId" IS NULL AND "versionId" IS NULL AND versao IS NULL)
   OR (estado='projetado' AND "itemId" IS NOT NULL AND "versionId" IS NOT NULL AND versao>0))
);
CREATE INDEX "ContextCollectionMember_orgId_itemId_idx" ON "ContextCollectionMember"("orgId","itemId");
CREATE FUNCTION catalogo_de_colecao_proteger() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE estado_selecao TEXT; BEGIN
 IF TG_OP='INSERT' THEN
   IF TG_TABLE_NAME='ContextCollectionSelection' THEN
     IF NEW.estado NOT IN ('classificado','falhou') OR NEW."marcaDepois" IS NOT NULL OR NEW."verificadaEm" IS NOT NULL THEN
       RAISE EXCEPTION 'Collection selection must start unverified';
     END IF;
   ELSE
     SELECT estado INTO estado_selecao FROM "ContextCollectionSelection"
       WHERE id=NEW."selectionId" AND "orgId"=NEW."orgId" FOR SHARE;
     IF estado_selecao IS DISTINCT FROM 'classificado' OR NEW.estado<>'classificado' THEN
       RAISE EXCEPTION 'Collection membership is closed after verification';
     END IF;
   END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Collection history is immutable'; END IF;
 IF TG_TABLE_NAME='ContextCollectionSelection' THEN
   IF OLD.estado<>'classificado' OR NEW.estado NOT IN ('projetado','falhou')
      OR (to_jsonb(OLD)-ARRAY['estado','marcaDepois','verificadaEm']) IS DISTINCT FROM
         (to_jsonb(NEW)-ARRAY['estado','marcaDepois','verificadaEm']) THEN
     RAISE EXCEPTION 'Collection selection identity is immutable';
   END IF;
   IF NEW.estado='projetado' AND EXISTS (SELECT 1 FROM "ContextCollectionMember"
      WHERE "selectionId"=OLD.id AND "orgId"=OLD."orgId" AND estado<>'projetado') THEN
     RAISE EXCEPTION 'Collection association is incomplete';
   END IF;
 ELSE
   IF OLD.estado<>'classificado' OR NEW.estado<>'projetado'
      OR (to_jsonb(OLD)-ARRAY['estado','itemId','versionId','versao']) IS DISTINCT FROM
         (to_jsonb(NEW)-ARRAY['estado','itemId','versionId','versao'])
      OR NOT EXISTS (SELECT 1 FROM "ContextCollectionSelection" s
         WHERE s.id=OLD."selectionId" AND s."orgId"=OLD."orgId" AND s.estado='classificado') THEN
     RAISE EXCEPTION 'Collection member identity is immutable';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ContextCollectionSelection_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "ContextCollectionSelection"
 FOR EACH ROW EXECUTE FUNCTION catalogo_de_colecao_proteger();
CREATE TRIGGER "ContextCollectionMember_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "ContextCollectionMember"
 FOR EACH ROW EXECUTE FUNCTION catalogo_de_colecao_proteger();
SELECT public.app_rls_aplicar_policies('ContextCollectionSelection','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,true,false);
SELECT public.app_rls_aplicar_policies('ContextCollectionMember','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,true,false);
ALTER TABLE "ContextCollectionSelection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContextCollectionSelection" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ContextCollectionMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContextCollectionMember" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN
 GRANT SELECT,INSERT,UPDATE ON "ContextCollectionSelection","ContextCollectionMember" TO mktos_app;
END IF; END $$;
