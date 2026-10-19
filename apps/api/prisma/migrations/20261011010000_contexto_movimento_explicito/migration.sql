-- PROPOSTA DOCUMENTAL. Não aplicada; não é migration validada/compilada.
-- Base para o handoff: 08cbb39; schema anterior usado na proposta permanece sem aplicação.
-- Candidate é vínculo da seleção real, não novo coletor ou captura fictícia.
-- Instalação inteira é uma transação explícita; não depende de envelope implícito do migrador.
BEGIN;


CREATE TABLE "ContextMovementIntent" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "inputFingerprint" TEXT NOT NULL,
  "serverMarkHash" TEXT NOT NULL,
  "intentMarkHash" TEXT NOT NULL,
  "currentVersionId" TEXT NOT NULL,
  "currentVersionNo" INTEGER NOT NULL,
  "expectedItemVersion" INTEGER NOT NULL,
  "currentContentHash" TEXT NOT NULL,
  "selectedVersionId" TEXT NOT NULL,
  "selectedVersionNo" INTEGER NOT NULL,
  "selectedContentHash" TEXT NOT NULL,
  "oldSelectionId" TEXT NOT NULL,
  "oldMemberId" TEXT NOT NULL,
  "oldGeneration" BIGINT NOT NULL,
  "oldMembershipDigest" TEXT NOT NULL,
  "oldMarca" JSONB NOT NULL,
  "originKey" TEXT NOT NULL,
  "originPathBytes" BYTEA NOT NULL,
  "originSourceRef" TEXT NOT NULL,
  "destinationKey" TEXT NOT NULL,
  "destinationPathBytes" BYTEA NOT NULL,
  "destinationSourceRef" TEXT NOT NULL,
  "motivo" TEXT NOT NULL,
  "creationAuditIds" TEXT[] NOT NULL,
  "estado" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "terminalReceiptId" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "encerradoEm" TIMESTAMP(3)
);

CREATE UNIQUE INDEX "ContextMovementIntent_u0" ON "ContextMovementIntent"("id","orgId");

CREATE UNIQUE INDEX "ContextMovementIntent_u1" ON "ContextMovementIntent"("orgId","requestId");

CREATE UNIQUE INDEX "ContextMovementIntent_u2" ON "ContextMovementIntent"("id","orgId","actorId","itemId","collectionId");

CREATE UNIQUE INDEX "ContextMovementIntent_u3" ON "ContextMovementIntent"("id","orgId","actorId","itemId","requestId");

CREATE TABLE "ContextKeyClaim" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "intentId" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);

CREATE UNIQUE INDEX "ContextKeyClaim_u0" ON "ContextKeyClaim"("id","orgId");

CREATE UNIQUE INDEX "ContextKeyClaim_u1" ON "ContextKeyClaim"("orgId","key");

CREATE UNIQUE INDEX "ContextKeyClaim_u2" ON "ContextKeyClaim"("id","orgId","key","itemId");

CREATE TABLE "ContextMovementCandidate" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "selectionId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "captureFingerprint" TEXT NOT NULL,
  "captureMarkHash" TEXT NOT NULL,
  "membershipDigest" TEXT NOT NULL,
  "marca" JSONB NOT NULL,
  "auditIds" TEXT[] NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);

CREATE UNIQUE INDEX "ContextMovementCandidate_u0" ON "ContextMovementCandidate"("id","orgId");

CREATE UNIQUE INDEX "ContextMovementCandidate_u1" ON "ContextMovementCandidate"("id","orgId","intentId","selectionId");

CREATE UNIQUE INDEX "ContextMovementCandidate_u2" ON "ContextMovementCandidate"("selectionId","orgId");

CREATE UNIQUE INDEX "ContextMovementCandidate_u3" ON "ContextMovementCandidate"("orgId","intentId","purpose","captureFingerprint");

CREATE TABLE "ContextAlias" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "aliasKey" TEXT NOT NULL,
  "aliasPathBytes" BYTEA NOT NULL,
  "itemId" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);

CREATE UNIQUE INDEX "ContextAlias_u0" ON "ContextAlias"("id","orgId");

CREATE UNIQUE INDEX "ContextAlias_u1" ON "ContextAlias"("orgId","collectionId","aliasKey");

CREATE UNIQUE INDEX "ContextAlias_u2" ON "ContextAlias"("orgId","claimId");

CREATE UNIQUE INDEX "ContextAlias_u3" ON "ContextAlias"("orgId","intentId");

CREATE TABLE "ContextMovementReceipt" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "inputFingerprint" TEXT NOT NULL,
  "commitFingerprint" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "newSelectionId" TEXT,
  "newMemberId" TEXT,
  "newVersionId" TEXT,
  "newVersionNo" INTEGER,
  "aliasId" TEXT,
  "cancelSelectionId" TEXT,
  "cancelMemberId" TEXT,
  "cancelVersionId" TEXT,
  "cancelVersionNo" INTEGER,
  "cancelContentHash" TEXT,
  "eventSnapshot" JSONB,
  "auditIds" TEXT[] NOT NULL,
  "receipt" JSONB NOT NULL,
  "receiptHash" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);

CREATE UNIQUE INDEX "ContextMovementReceipt_u0" ON "ContextMovementReceipt"("id","orgId");

CREATE UNIQUE INDEX "ContextMovementReceipt_u1" ON "ContextMovementReceipt"("orgId","requestId");

CREATE UNIQUE INDEX "ContextMovementReceipt_u2" ON "ContextMovementReceipt"("orgId","intentId");

CREATE UNIQUE INDEX "ContextMovementReceipt_u3" ON "ContextMovementReceipt"("id","orgId","intentId","actorId","itemId","requestId","tipo");

ALTER TABLE "ContextCollectionSelection" ADD COLUMN "movementIntentId" TEXT;

CREATE UNIQUE INDEX "Selection_movement_identity_u" ON "ContextCollectionSelection"(id,"orgId","collectionId","movementIntentId");

CREATE UNIQUE INDEX "Member_selection_identity_u" ON "ContextCollectionMember"(id,"orgId","selectionId");

CREATE UNIQUE INDEX "Member_version_identity_u" ON "ContextCollectionMember"(id,"orgId","selectionId","itemId","versionId",versao);

CREATE UNIQUE INDEX "Intent_one_pending_collection_u" ON "ContextMovementIntent"("orgId","collectionId") WHERE estado='pendente';

CREATE UNIQUE INDEX "Intent_one_pending_item_u" ON "ContextMovementIntent"("orgId","itemId") WHERE estado='pendente';

CREATE UNIQUE INDEX "Claim_one_canonical_u" ON "ContextKeyClaim"("orgId","itemId") WHERE tipo='canonical';

ALTER TABLE "ContextMovementIntent" ADD CONSTRAINT "ContextMovementIntent_org_fk" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextKeyClaim" ADD CONSTRAINT "ContextKeyClaim_org_fk" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementCandidate" ADD CONSTRAINT "ContextMovementCandidate_org_fk" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextAlias" ADD CONSTRAINT "ContextAlias_org_fk" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementReceipt" ADD CONSTRAINT "ContextMovementReceipt_org_fk" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementIntent" ADD CONSTRAINT "Intent_actor_fk" FOREIGN KEY ("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementIntent" ADD CONSTRAINT "Intent_item_fk" FOREIGN KEY ("itemId","orgId") REFERENCES "ContextItem"("id","orgId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementIntent" ADD CONSTRAINT "Intent_current_version_fk" FOREIGN KEY ("currentVersionId","orgId","itemId","currentVersionNo") REFERENCES "ContextItemVersion"("id","orgId","itemId","versao") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementIntent" ADD CONSTRAINT "Intent_selected_version_fk" FOREIGN KEY ("selectedVersionId","orgId","itemId","selectedVersionNo") REFERENCES "ContextItemVersion"("id","orgId","itemId","versao") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementIntent" ADD CONSTRAINT "Intent_old_selection_fk" FOREIGN KEY ("oldSelectionId","orgId") REFERENCES "ContextCollectionSelection"("id","orgId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementIntent" ADD CONSTRAINT "Intent_old_member_version_fk" FOREIGN KEY ("oldMemberId","orgId","oldSelectionId","itemId","currentVersionId","currentVersionNo") REFERENCES "ContextCollectionMember"("id","orgId","selectionId","itemId","versionId","versao") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextCollectionSelection" ADD CONSTRAINT "Selection_intent_fk" FOREIGN KEY ("movementIntentId","orgId") REFERENCES "ContextMovementIntent"("id","orgId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextKeyClaim" ADD CONSTRAINT "Claim_item_fk" FOREIGN KEY ("itemId","orgId") REFERENCES "ContextItem"("id","orgId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextKeyClaim" ADD CONSTRAINT "Claim_intent_fk" FOREIGN KEY ("intentId","orgId") REFERENCES "ContextMovementIntent"("id","orgId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementCandidate" ADD CONSTRAINT "Candidate_scope_fk" FOREIGN KEY ("intentId","orgId","actorId","itemId","collectionId") REFERENCES "ContextMovementIntent"("id","orgId","actorId","itemId","collectionId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementCandidate" ADD CONSTRAINT "Candidate_selection_fk" FOREIGN KEY ("selectionId","orgId","collectionId","intentId") REFERENCES "ContextCollectionSelection"("id","orgId","collectionId","movementIntentId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextAlias" ADD CONSTRAINT "Alias_item_fk" FOREIGN KEY ("itemId","orgId") REFERENCES "ContextItem"("id","orgId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextAlias" ADD CONSTRAINT "Alias_intent_fk" FOREIGN KEY ("intentId","orgId") REFERENCES "ContextMovementIntent"("id","orgId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextAlias" ADD CONSTRAINT "Alias_claim_fk" FOREIGN KEY ("claimId","orgId","aliasKey","itemId") REFERENCES "ContextKeyClaim"("id","orgId","key","itemId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementReceipt" ADD CONSTRAINT "Receipt_intent_scope_fk" FOREIGN KEY ("intentId","orgId","actorId","itemId","requestId") REFERENCES "ContextMovementIntent"("id","orgId","actorId","itemId","requestId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementReceipt" ADD CONSTRAINT "Receipt_candidate_fk" FOREIGN KEY ("candidateId","orgId","intentId","newSelectionId") REFERENCES "ContextMovementCandidate"("id","orgId","intentId","selectionId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementReceipt" ADD CONSTRAINT "Receipt_cancel_candidate_fk" FOREIGN KEY ("candidateId","orgId","intentId","cancelSelectionId") REFERENCES "ContextMovementCandidate"("id","orgId","intentId","selectionId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementReceipt" ADD CONSTRAINT "Receipt_new_version_fk" FOREIGN KEY ("newVersionId","orgId","itemId","newVersionNo") REFERENCES "ContextItemVersion"("id","orgId","itemId","versao") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementReceipt" ADD CONSTRAINT "Receipt_new_member_version_fk" FOREIGN KEY ("newMemberId","orgId","newSelectionId","itemId","newVersionId","newVersionNo") REFERENCES "ContextCollectionMember"("id","orgId","selectionId","itemId","versionId","versao") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementReceipt" ADD CONSTRAINT "Receipt_cancel_member_fk" FOREIGN KEY ("cancelMemberId","orgId","cancelSelectionId","itemId","cancelVersionId","cancelVersionNo") REFERENCES "ContextCollectionMember"("id","orgId","selectionId","itemId","versionId","versao") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementReceipt" ADD CONSTRAINT "Receipt_cancel_version_fk" FOREIGN KEY ("cancelVersionId","orgId","itemId","cancelVersionNo") REFERENCES "ContextItemVersion"("id","orgId","itemId","versao") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementReceipt" ADD CONSTRAINT "Receipt_alias_fk" FOREIGN KEY ("aliasId","orgId") REFERENCES "ContextAlias"("id","orgId") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "ContextMovementIntent" ADD CONSTRAINT "Intent_terminal_receipt_fk" FOREIGN KEY ("terminalReceiptId","orgId","id","actorId","itemId","requestId","estado") REFERENCES "ContextMovementReceipt"("id","orgId","intentId","actorId","itemId","requestId","tipo") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "ContextMovementIntent" ADD CONSTRAINT "Intent_shape_check" CHECK (
 revision IN (1,2) AND "currentVersionNo">0 AND "expectedItemVersion"="currentVersionNo"
 AND "selectedVersionNo">0 AND "selectedVersionNo"<="currentVersionNo" AND "oldGeneration">0
 AND "originKey"='vault:'||"originSourceRef" AND "destinationKey"='vault:'||"destinationSourceRef"
 AND "originKey"<>"destinationKey" AND octet_length("originPathBytes") BETWEEN 1 AND 4096
 AND octet_length("destinationPathBytes") BETWEEN 1 AND 4096
 AND char_length(motivo) BETWEEN 1 AND 1000 AND cardinality("creationAuditIds")>0
 AND ((estado='pendente' AND revision=1 AND "terminalReceiptId" IS NULL AND "encerradoEm" IS NULL)
   OR (estado IN ('confirmado','cancelado') AND revision=2 AND "terminalReceiptId" IS NOT NULL AND "encerradoEm" IS NOT NULL))
 AND "inputFingerprint" ~ '^[a-f0-9]{64}$' AND "serverMarkHash" ~ '^[a-f0-9]{64}$'
 AND "intentMarkHash" ~ '^[a-f0-9]{64}$' AND "currentContentHash" ~ '^[a-f0-9]{64}$'
 AND "selectedContentHash" ~ '^[a-f0-9]{64}$' AND "oldMembershipDigest" ~ '^[a-f0-9]{64}$'
 AND COALESCE(jsonb_typeof("oldMarca")='object',false));
ALTER TABLE "ContextKeyClaim" ADD CONSTRAINT "Claim_shape_check" CHECK (
 key LIKE 'vault:%' AND char_length(key)>6 AND tipo IN ('canonical','alias','reserved_target')
 AND ((tipo='canonical' AND "intentId" IS NULL) OR (tipo IN ('alias','reserved_target') AND "intentId" IS NOT NULL)));
ALTER TABLE "ContextMovementCandidate" ADD CONSTRAINT "Candidate_shape_check" CHECK (
 purpose IN ('movimento','retorno') AND "captureFingerprint" ~ '^[a-f0-9]{64}$'
 AND "captureMarkHash" ~ '^[a-f0-9]{64}$' AND "membershipDigest" ~ '^[a-f0-9]{64}$'
 AND cardinality("auditIds")>0 AND COALESCE(jsonb_typeof(marca)='object',false));
ALTER TABLE "ContextAlias" ADD CONSTRAINT "Alias_shape_check" CHECK (
 "aliasKey" LIKE 'vault:%' AND octet_length("aliasPathBytes") BETWEEN 1 AND 4096);
ALTER TABLE "ContextMovementReceipt" ADD CONSTRAINT "Receipt_shape_check" CHECK (
 "inputFingerprint" ~ '^[a-f0-9]{64}$' AND "commitFingerprint" ~ '^[a-f0-9]{64}$' AND "receiptHash" ~ '^[a-f0-9]{64}$'
 AND cardinality("auditIds")>0 AND (
 (tipo='confirmado' AND "newSelectionId" IS NOT NULL AND "newMemberId" IS NOT NULL AND "newVersionId" IS NOT NULL
  AND "newVersionNo" IS NOT NULL AND "newVersionNo">0 AND "aliasId" IS NOT NULL AND "eventSnapshot" IS NOT NULL AND "cancelSelectionId" IS NULL AND "cancelMemberId" IS NULL AND "cancelVersionId" IS NULL AND "cancelVersionNo" IS NULL AND "cancelContentHash" IS NULL)
 OR (tipo='cancelado' AND "newSelectionId" IS NULL AND "newMemberId" IS NULL AND "newVersionId" IS NULL AND "newVersionNo" IS NULL
  AND "aliasId" IS NULL AND "eventSnapshot" IS NULL AND "cancelSelectionId" IS NOT NULL AND "cancelMemberId" IS NOT NULL
  AND "cancelVersionId" IS NOT NULL AND "cancelVersionNo" IS NOT NULL AND "cancelVersionNo">0 AND "cancelContentHash" IS NOT NULL AND "cancelContentHash" ~ '^[a-f0-9]{64}$'))
 AND COALESCE(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=65536
  AND receipt->'schemaVersion'='1'::jsonb AND receipt->>'id'=id AND receipt->>'orgId'="orgId"
  AND receipt->>'actorId'="actorId" AND receipt->>'itemId'="itemId" AND receipt->>'intentId'="intentId"
  AND receipt->>'requestId'="requestId" AND receipt->>'tipo'=tipo,false)
 AND ("eventSnapshot" IS NULL OR COALESCE(jsonb_typeof("eventSnapshot")='object'
  AND "eventSnapshot"->>'id' IS NOT NULL AND "eventSnapshot"->>'seq' ~ '^[1-9][0-9]*$'
  AND "eventSnapshot"->>'hash' ~ '^[a-f0-9]{64}$',false)));

CREATE FUNCTION public.context_movement_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Context movement history is immutable' USING ERRCODE='P0001'; END $$;
CREATE FUNCTION public.context_movement_intent_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.estado<>'pendente' OR NEW.revision<>1 THEN RAISE EXCEPTION 'Intent must start pending'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Intent cannot be deleted'; END IF;
 IF OLD.estado<>'pendente' OR OLD.revision<>1 OR NEW.revision<>2
  OR NEW.estado NOT IN ('confirmado','cancelado') OR
  (to_jsonb(OLD)-ARRAY['estado','revision','terminalReceiptId','encerradoEm']) IS DISTINCT FROM
  (to_jsonb(NEW)-ARRAY['estado','revision','terminalReceiptId','encerradoEm']) THEN
   RAISE EXCEPTION 'Intent transition refused' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Intent_transition" BEFORE INSERT OR UPDATE OR DELETE ON "ContextMovementIntent"
 FOR EACH ROW EXECUTE FUNCTION public.context_movement_intent_transition();

CREATE TRIGGER "ContextMovementCandidate_append_only" BEFORE UPDATE OR DELETE ON "ContextMovementCandidate" FOR EACH ROW EXECUTE FUNCTION public.context_movement_append_only();

CREATE TRIGGER "ContextAlias_append_only" BEFORE UPDATE OR DELETE ON "ContextAlias" FOR EACH ROW EXECUTE FUNCTION public.context_movement_append_only();

CREATE TRIGGER "ContextMovementReceipt_append_only" BEFORE UPDATE OR DELETE ON "ContextMovementReceipt" FOR EACH ROW EXECUTE FUNCTION public.context_movement_append_only();

CREATE FUNCTION public.context_movement_item_namespace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i "ContextMovementIntent"; c "ContextKeyClaim";
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.chave LIKE 'vault:%' THEN RAISE EXCEPTION 'Vault identity cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW."orgId"<>OLD."orgId") THEN
  RAISE EXCEPTION 'Context identity cannot be reassigned';
 END IF;
 IF TG_OP='UPDATE' AND OLD.chave LIKE 'vault:%' AND NEW.chave<>OLD.chave THEN
  SELECT * INTO i FROM "ContextMovementIntent" WHERE "orgId"=OLD."orgId" AND "itemId"=OLD.id
   AND estado='pendente' AND "originKey"=OLD.chave AND "destinationKey"=NEW.chave;
  IF NOT FOUND OR OLD.versao<>i."expectedItemVersion" OR NEW.versao<>OLD.versao+1
   OR NEW."sourceRef" IS DISTINCT FROM i."destinationSourceRef" OR NEW."sourceType"::text<>'vault'
   OR NOT EXISTS(SELECT 1 FROM "ContextKeyClaim" k JOIN "ContextAlias" a ON a."claimId"=k.id AND a."orgId"=k."orgId"
     WHERE k."orgId"=OLD."orgId" AND k.key=OLD.chave AND k."itemId"=OLD.id AND k.tipo='alias' AND k."intentId"=i.id AND a."intentId"=i.id)
   OR NOT EXISTS(SELECT 1 FROM "ContextKeyClaim" k WHERE k."orgId"=NEW."orgId" AND k.key=NEW.chave AND k."itemId"=NEW.id AND k.tipo='canonical')
   OR (to_jsonb(OLD)-ARRAY['chave','sourceRef','versao','atualizadoEm','atualizadoPor']) IS DISTINCT FROM
      (to_jsonb(NEW)-ARRAY['chave','sourceRef','versao','atualizadoEm','atualizadoPor']) THEN
    RAISE EXCEPTION 'Vault key rewrite requires verified explicit movement' USING ERRCODE='P0001';
  END IF;
 ELSE
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM "ContextMovementIntent" WHERE "orgId"=OLD."orgId" AND "itemId"=OLD.id AND estado='pendente')
   AND (to_jsonb(OLD)-ARRAY['acessoRestrito','leitores','versao','atualizadoEm','atualizadoPor']) IS DISTINCT FROM
       (to_jsonb(NEW)-ARRAY['acessoRestrito','leitores','versao','atualizadoEm','atualizadoPor']) THEN
    RAISE EXCEPTION 'Pending movement preserves essential source fields';
  END IF;
 END IF;
 IF NEW.chave LIKE 'vault:%' THEN
  SELECT * INTO c FROM "ContextKeyClaim" WHERE "orgId"=NEW."orgId" AND key=NEW.chave FOR UPDATE;
  IF FOUND AND (c.tipo<>'canonical' OR c."itemId"<>NEW.id) THEN
   RAISE EXCEPTION 'Context key is reserved or an alias' USING ERRCODE='P0001';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.context_movement_item_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.chave LIKE 'vault:%' THEN
  INSERT INTO "ContextKeyClaim"(id,"orgId",key,"itemId",tipo,"intentId")
   VALUES(gen_random_uuid()::text,NEW."orgId",NEW.chave,NEW.id,'canonical',NULL)
   ON CONFLICT ("orgId",key) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
-- Backfill literal ANTES de habilitar RLS/triggers novos. Não normaliza ou funde chaves.
LOCK TABLE "ContextItem" IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO "ContextKeyClaim"(id,"orgId",key,"itemId",tipo,"intentId")
 SELECT gen_random_uuid()::text,"orgId",chave,id,'canonical',NULL FROM "ContextItem" WHERE chave LIKE 'vault:%';
CREATE TRIGGER "ContextItem_movement_namespace" BEFORE INSERT OR UPDATE OR DELETE ON "ContextItem"
 FOR EACH ROW EXECUTE FUNCTION public.context_movement_item_namespace();
CREATE TRIGGER "ContextItem_canonical_claim" AFTER INSERT OR UPDATE OF chave ON "ContextItem"
 FOR EACH ROW EXECUTE FUNCTION public.context_movement_item_claim();

CREATE FUNCTION public.context_movement_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant TEXT;
BEGIN
 IF TG_OP='DELETE' THEN tenant:=OLD."orgId"; ELSE tenant:=NEW."orgId"; END IF;
 IF EXISTS (SELECT 1 FROM "ContextKeyClaim" k LEFT JOIN "ContextItem" c ON c.id=k."itemId" AND c."orgId"=k."orgId"
   WHERE k."orgId"=tenant AND k.tipo='canonical' AND (c.id IS NULL OR c.chave<>k.key))
  OR EXISTS(SELECT 1 FROM "ContextItem" c WHERE c."orgId"=tenant AND c.chave LIKE 'vault:%'
   AND NOT EXISTS(SELECT 1 FROM "ContextKeyClaim" k WHERE k."orgId"=c."orgId" AND k."itemId"=c.id AND k.key=c.chave AND k.tipo='canonical'))
  OR EXISTS(SELECT 1 FROM "ContextKeyClaim" k WHERE k."orgId"=tenant AND k.tipo='reserved_target'
   AND NOT EXISTS(SELECT 1 FROM "ContextMovementIntent" i WHERE i.id=k."intentId" AND i."orgId"=k."orgId"
    AND i."itemId"=k."itemId" AND i."destinationKey"=k.key AND i.estado='pendente'))
  OR EXISTS(SELECT 1 FROM "ContextKeyClaim" k WHERE k."orgId"=tenant AND k.tipo='alias'
   AND NOT EXISTS(SELECT 1 FROM "ContextAlias" a JOIN "ContextMovementIntent" i ON i.id=a."intentId" AND i."orgId"=a."orgId"
    WHERE a."claimId"=k.id AND a."orgId"=k."orgId" AND a."itemId"=k."itemId" AND a."aliasKey"=k.key
    AND a."intentId"=k."intentId" AND i.estado='confirmado' AND i."originKey"=a."aliasKey" AND i."collectionId"=a."collectionId"))
  OR EXISTS(SELECT 1 FROM "ContextMovementIntent" i WHERE i."orgId"=tenant AND i.estado='pendente'
   AND NOT EXISTS(SELECT 1 FROM "ContextKeyClaim" k WHERE k."orgId"=i."orgId" AND k."itemId"=i."itemId" AND k.key=i."destinationKey" AND k.tipo='reserved_target' AND k."intentId"=i.id))
  OR EXISTS(SELECT 1 FROM "ContextAlias" a WHERE a."orgId"=tenant
   AND NOT EXISTS(SELECT 1 FROM "ContextKeyClaim" k WHERE k.id=a."claimId" AND k."orgId"=a."orgId" AND k.tipo='alias' AND k."intentId"=a."intentId"))
  OR EXISTS(SELECT 1 FROM "ContextMovementReceipt" r JOIN "ContextMovementIntent" i ON i.id=r."intentId" AND i."orgId"=r."orgId"
   JOIN "ContextMovementCandidate" p ON p.id=r."candidateId" AND p."orgId"=r."orgId"
   WHERE r."orgId"=tenant AND (i.estado<>r.tipo OR i."terminalReceiptId" IS DISTINCT FROM r.id
    OR p.purpose<>CASE r.tipo WHEN 'confirmado' THEN 'movimento' ELSE 'retorno' END
    OR (r.tipo='confirmado' AND NOT EXISTS(SELECT 1 FROM "ContextAlias" a WHERE a.id=r."aliasId" AND a."orgId"=r."orgId"
      AND a."intentId"=i.id AND a."itemId"=i."itemId" AND a."collectionId"=i."collectionId"
      AND a."aliasKey"=i."originKey" AND a."aliasPathBytes"=i."originPathBytes"))
    OR (r.tipo='cancelado' AND NOT EXISTS(SELECT 1 FROM "ContextCollectionMember" m WHERE m.id=r."cancelMemberId" AND m."orgId"=r."orgId"
      AND m."selectionId"=r."cancelSelectionId" AND m.chave=i."originKey" AND m."caminhoBytes"=i."originPathBytes"
      AND m."itemId"=r."itemId" AND m."versionId"=r."cancelVersionId" AND m.versao=r."cancelVersionNo" AND m.estado='projetado'
      AND m."contentHash"=r."cancelContentHash"
      AND EXISTS(SELECT 1 FROM "ContextCollectionSelection" s WHERE s.id=m."selectionId" AND s."orgId"=m."orgId" AND s.estado='projetado')
      AND EXISTS(SELECT 1 FROM "ContextItemVersion" v WHERE v.id=r."cancelVersionId" AND v."orgId"=r."orgId" AND v."itemId"=r."itemId"
        AND v.versao=r."cancelVersionNo" AND v."contentHash"=r."cancelContentHash")))))
  OR EXISTS(SELECT 1 FROM "ContextCollectionSelection" s WHERE s."orgId"=tenant AND s."movementIntentId" IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM "ContextMovementCandidate" p WHERE p."selectionId"=s.id AND p."orgId"=s."orgId" AND p."intentId"=s."movementIntentId")) THEN
   RAISE EXCEPTION 'Context namespace or movement final links inconsistent' USING ERRCODE='P0001';
 END IF;
 RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "ContextMovementIntent_movement_consistency" AFTER INSERT OR UPDATE OR DELETE ON "ContextMovementIntent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.context_movement_consistency();

CREATE CONSTRAINT TRIGGER "ContextKeyClaim_movement_consistency" AFTER INSERT OR UPDATE OR DELETE ON "ContextKeyClaim" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.context_movement_consistency();

CREATE CONSTRAINT TRIGGER "ContextMovementCandidate_movement_consistency" AFTER INSERT OR UPDATE OR DELETE ON "ContextMovementCandidate" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.context_movement_consistency();

CREATE CONSTRAINT TRIGGER "ContextAlias_movement_consistency" AFTER INSERT OR UPDATE OR DELETE ON "ContextAlias" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.context_movement_consistency();

CREATE CONSTRAINT TRIGGER "ContextMovementReceipt_movement_consistency" AFTER INSERT OR UPDATE OR DELETE ON "ContextMovementReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.context_movement_consistency();

CREATE CONSTRAINT TRIGGER "ContextItem_movement_consistency" AFTER INSERT OR UPDATE OR DELETE ON "ContextItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.context_movement_consistency();

CREATE CONSTRAINT TRIGGER "ContextCollectionSelection_movement_consistency" AFTER INSERT OR UPDATE OR DELETE ON "ContextCollectionSelection" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.context_movement_consistency();

CREATE FUNCTION public.context_movement_claim_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.tipo<>'reserved_target' OR NOT EXISTS(SELECT 1 FROM "ContextMovementIntent" i WHERE i.id=OLD."intentId" AND i."orgId"=OLD."orgId" AND i.estado='cancelado') THEN
    RAISE EXCEPTION 'Only a cancelled destination reservation can be removed';
  END IF; RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(OLD)-ARRAY['tipo','intentId']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['tipo','intentId'])
  OR NOT ((OLD.tipo='canonical' AND NEW.tipo='alias') OR (OLD.tipo='reserved_target' AND NEW.tipo='canonical'))) THEN
   RAISE EXCEPTION 'Claim conversion refused';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Claim_transition" BEFORE UPDATE OR DELETE ON "ContextKeyClaim"
 FOR EACH ROW EXECUTE FUNCTION public.context_movement_claim_transition();

ALTER TABLE "ContextMovementIntent" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "ContextMovementIntent" FORCE ROW LEVEL SECURITY;

SELECT public.app_rls_aplicar_policies('ContextMovementIntent','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,true,false);

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN GRANT SELECT,INSERT,UPDATE ON "ContextMovementIntent" TO mktos_app; END IF; END $$;

ALTER TABLE "ContextKeyClaim" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "ContextKeyClaim" FORCE ROW LEVEL SECURITY;

SELECT public.app_rls_aplicar_policies('ContextKeyClaim','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,true,true);

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON "ContextKeyClaim" TO mktos_app; END IF; END $$;

ALTER TABLE "ContextMovementCandidate" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "ContextMovementCandidate" FORCE ROW LEVEL SECURITY;

SELECT public.app_rls_aplicar_policies('ContextMovementCandidate','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN GRANT SELECT,INSERT ON "ContextMovementCandidate" TO mktos_app; END IF; END $$;

ALTER TABLE "ContextAlias" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "ContextAlias" FORCE ROW LEVEL SECURITY;

SELECT public.app_rls_aplicar_policies('ContextAlias','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN GRANT SELECT,INSERT ON "ContextAlias" TO mktos_app; END IF; END $$;

ALTER TABLE "ContextMovementReceipt" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "ContextMovementReceipt" FORCE ROW LEVEL SECURITY;

SELECT public.app_rls_aplicar_policies('ContextMovementReceipt','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN GRANT SELECT,INSERT ON "ContextMovementReceipt" TO mktos_app; END IF; END $$;


-- Borda de INSERT nominativa: serviço toma obsidian-index:org -> memoria:org antes dela.
CREATE FUNCTION public.context_movement_intent_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "ContextItem"; v "ContextItemVersion"; chosen "ContextItemVersion"; s "ContextCollectionSelection"; m "ContextCollectionMember";
BEGIN
 SELECT * INTO c FROM "ContextItem" WHERE id=NEW."itemId" AND "orgId"=NEW."orgId";
 IF NOT FOUND OR c."sourceType"::text<>'vault' OR c."sourceRef" IS DISTINCT FROM NEW."originSourceRef"
  OR c.chave<>NEW."originKey" OR c.versao<>NEW."expectedItemVersion" OR c."contentHash"<>NEW."currentContentHash" OR c."arquivadoEm" IS NOT NULL THEN
  RAISE EXCEPTION 'Current movement origin changed'; END IF;
 SELECT * INTO v FROM "ContextItemVersion" WHERE id=NEW."currentVersionId" AND "orgId"=NEW."orgId" AND "itemId"=NEW."itemId";
 SELECT * INTO chosen FROM "ContextItemVersion" WHERE id=NEW."selectedVersionId" AND "orgId"=NEW."orgId" AND "itemId"=NEW."itemId";
 IF v.versao IS DISTINCT FROM c.versao OR v."contentHash" IS DISTINCT FROM NEW."currentContentHash"
  OR chosen."contentHash" IS DISTINCT FROM NEW."selectedContentHash"
  OR (SELECT MAX(versao) FROM "ContextItemVersion" WHERE "orgId"=NEW."orgId" AND "itemId"=NEW."itemId") IS DISTINCT FROM c.versao THEN
  RAISE EXCEPTION 'Movement version association refused'; END IF;
 SELECT * INTO s FROM "ContextCollectionSelection" WHERE id=NEW."oldSelectionId" AND "orgId"=NEW."orgId";
 SELECT * INTO m FROM "ContextCollectionMember" WHERE id=NEW."oldMemberId" AND "orgId"=NEW."orgId";
 IF s.estado IS DISTINCT FROM 'projetado' OR s."collectionId" IS DISTINCT FROM NEW."collectionId"
  OR s.generation IS DISTINCT FROM NEW."oldGeneration" OR s."membershipDigest" IS DISTINCT FROM NEW."oldMembershipDigest" OR s."marcaDepois" IS DISTINCT FROM NEW."oldMarca"
  OR s.id IS DISTINCT FROM (SELECT id FROM "ContextCollectionSelection" WHERE "orgId"=NEW."orgId" AND "collectionId"=NEW."collectionId" ORDER BY generation DESC LIMIT 1)
  OR m."selectionId" IS DISTINCT FROM s.id OR m.chave IS DISTINCT FROM NEW."originKey" OR m."caminhoBytes" IS DISTINCT FROM NEW."originPathBytes"
  OR m."versionId" IS DISTINCT FROM NEW."currentVersionId" OR m."itemId" IS DISTINCT FROM NEW."itemId" OR m.versao IS DISTINCT FROM NEW."currentVersionNo" THEN
  RAISE EXCEPTION 'Latest projected selection or member refused'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Intent_origin_insert" BEFORE INSERT ON "ContextMovementIntent" FOR EACH ROW EXECUTE FUNCTION public.context_movement_intent_origin();
CREATE FUNCTION public.context_movement_candidate_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i "ContextMovementIntent"; s "ContextCollectionSelection";
BEGIN
 SELECT * INTO i FROM "ContextMovementIntent" WHERE id=NEW."intentId" AND "orgId"=NEW."orgId";
 SELECT * INTO s FROM "ContextCollectionSelection" WHERE id=NEW."selectionId" AND "orgId"=NEW."orgId";
 IF i.estado IS DISTINCT FROM 'pendente' OR i.revision IS DISTINCT FROM 1 OR s.estado IS DISTINCT FROM 'classificado'
  OR s."membershipDigest" IS DISTINCT FROM NEW."membershipDigest" OR s."marcaAntes" IS DISTINCT FROM NEW.marca OR s."movementIntentId" IS DISTINCT FROM i.id
  OR s.id IS DISTINCT FROM (SELECT id FROM "ContextCollectionSelection" WHERE "orgId"=NEW."orgId" AND "collectionId"=NEW."collectionId" ORDER BY generation DESC LIMIT 1) THEN
  RAISE EXCEPTION 'Candidate must bind the current human-classified selection'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Candidate_insert" BEFORE INSERT ON "ContextMovementCandidate" FOR EACH ROW EXECUTE FUNCTION public.context_movement_candidate_insert();

CREATE FUNCTION public.context_movement_cancel_receipt_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "ContextItem"; v "ContextItemVersion"; i "ContextMovementIntent";
BEGIN
 IF NEW.tipo<>'cancelado' THEN RETURN NEW; END IF;
 SELECT * INTO i FROM "ContextMovementIntent" WHERE id=NEW."intentId" AND "orgId"=NEW."orgId";
 SELECT * INTO c FROM "ContextItem" WHERE id=NEW."itemId" AND "orgId"=NEW."orgId";
 SELECT * INTO v FROM "ContextItemVersion" WHERE id=NEW."cancelVersionId" AND "orgId"=NEW."orgId" AND "itemId"=NEW."itemId";
 IF i.estado IS DISTINCT FROM 'pendente' OR c.chave IS DISTINCT FROM i."originKey"
  OR c."sourceRef" IS DISTINCT FROM i."originSourceRef" OR c."sourceType"::text IS DISTINCT FROM 'vault'
  OR c."arquivadoEm" IS NOT NULL OR c.versao IS DISTINCT FROM NEW."cancelVersionNo"
  OR c."contentHash" IS DISTINCT FROM NEW."cancelContentHash" OR v.versao IS DISTINCT FROM c.versao
  OR v."contentHash" IS DISTINCT FROM c."contentHash" OR v.body IS DISTINCT FROM c.body OR v.title IS DISTINCT FROM c.title
  OR v."sourceType" IS DISTINCT FROM c."sourceType" OR v."sourceRef" IS DISTINCT FROM c."sourceRef"
  OR (SELECT MAX(versao) FROM "ContextItemVersion" WHERE "orgId"=NEW."orgId" AND "itemId"=NEW."itemId") IS DISTINCT FROM c.versao THEN
   RAISE EXCEPTION 'Cancellation must bind the current real return version' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Receipt_cancel_current_insert" BEFORE INSERT ON "ContextMovementReceipt" FOR EACH ROW EXECUTE FUNCTION public.context_movement_cancel_receipt_insert();
COMMIT;
