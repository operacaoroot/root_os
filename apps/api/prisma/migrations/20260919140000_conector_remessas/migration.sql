-- E3a.2 — remessas locais. Conteúdo somente em ContextItem/Version.
CREATE TYPE "ConnectorDeliveryStatus" AS ENUM ('aberta', 'concluida', 'falha', 'revogada');

ALTER TABLE "ConnectorSource"
  ADD COLUMN "ultimaRemessaTentativaEm" TIMESTAMP(3),
  ADD COLUMN "ultimaRemessaSucessoEm" TIMESTAMP(3),
  ADD COLUMN "ultimaRemessaStatus" TEXT,
  ADD COLUMN "ultimaRemessaItens" INTEGER,
  ADD COLUMN "ultimaRemessaErros" INTEGER;

CREATE TABLE "ConnectorDelivery" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "chaveRequisicao" TEXT NOT NULL,
  "ordem" INTEGER NOT NULL,
  "modo" "ConnectorMode" NOT NULL,
  "escopoVersao" INTEGER NOT NULL,
  "status" "ConnectorDeliveryStatus" NOT NULL DEFAULT 'aberta',
  "snapshotCompleto" BOOLEAN NOT NULL DEFAULT false,
  "itensVistos" INTEGER NOT NULL DEFAULT 0,
  "itensEnviados" INTEGER NOT NULL DEFAULT 0,
  "erros" INTEGER NOT NULL DEFAULT 0,
  "ultimaRevisao" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorDelivery_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ConnectorDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorDelivery_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ConnectorSource"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConnectorDelivery_orgId_deviceId_chaveRequisicao_key" ON "ConnectorDelivery"("orgId", "deviceId", "chaveRequisicao");
CREATE UNIQUE INDEX "ConnectorDelivery_orgId_sourceId_ordem_key" ON "ConnectorDelivery"("orgId", "sourceId", "ordem");
CREATE INDEX "ConnectorDelivery_orgId_sourceId_createdAt_idx" ON "ConnectorDelivery"("orgId", "sourceId", "createdAt");
CREATE INDEX "ConnectorDelivery_orgId_deviceId_status_idx" ON "ConnectorDelivery"("orgId", "deviceId", "status");

CREATE TABLE "ConnectorDeliveryItem" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "contextItemId" TEXT,
  "caminhoRelativo" TEXT NOT NULL,
  "hashConteudo" TEXT NOT NULL,
  "tamanho" INTEGER NOT NULL,
  "revisao" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorDeliveryItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorDeliveryItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorDeliveryItem_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "ConnectorDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorDeliveryItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ConnectorSource"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorDeliveryItem_contextItemId_fkey" FOREIGN KEY ("contextItemId") REFERENCES "ContextItem"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConnectorDeliveryItem_deliveryId_sourceId_caminhoRelativo_hashConteudo_key" ON "ConnectorDeliveryItem"("deliveryId", "sourceId", "caminhoRelativo", "hashConteudo");
CREATE INDEX "ConnectorDeliveryItem_orgId_sourceId_caminhoRelativo_idx" ON "ConnectorDeliveryItem"("orgId", "sourceId", "caminhoRelativo");
CREATE INDEX "ConnectorDeliveryItem_orgId_deliveryId_idx" ON "ConnectorDeliveryItem"("orgId", "deliveryId");

CREATE TABLE "ConnectorItemState" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "caminhoRelativo" TEXT NOT NULL,
  "hashConteudo" TEXT NOT NULL,
  "contextItemId" TEXT NOT NULL,
  "revisao" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorItemState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorItemState_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorItemState_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ConnectorSource"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorItemState_contextItemId_fkey" FOREIGN KEY ("contextItemId") REFERENCES "ContextItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConnectorItemState_orgId_sourceId_caminhoRelativo_key" ON "ConnectorItemState"("orgId", "sourceId", "caminhoRelativo");
CREATE INDEX "ConnectorItemState_orgId_sourceId_revisao_idx" ON "ConnectorItemState"("orgId", "sourceId", "revisao");

CREATE OR REPLACE FUNCTION mktos_connector_delivery_org() RETURNS trigger AS $$
DECLARE device_org TEXT; source_org TEXT;
BEGIN
  SELECT "orgId" INTO device_org FROM public."ConnectorDevice" WHERE "id" = NEW."deviceId";
  SELECT "orgId" INTO source_org FROM public."ConnectorSource" WHERE "id" = NEW."sourceId";
  IF device_org IS NULL OR source_org IS NULL OR device_org <> source_org OR NEW."orgId" <> device_org THEN
    RAISE EXCEPTION 'empresa cruzada na remessa do conector' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp;
CREATE TRIGGER "ConnectorDelivery_orgId_do_pai" BEFORE INSERT OR UPDATE ON "ConnectorDelivery"
  FOR EACH ROW EXECUTE FUNCTION mktos_connector_delivery_org();

CREATE OR REPLACE FUNCTION mktos_connector_delivery_item_org() RETURNS trigger AS $$
DECLARE delivery_org TEXT; source_org TEXT;
BEGIN
  SELECT "orgId" INTO delivery_org FROM public."ConnectorDelivery" WHERE "id" = NEW."deliveryId";
  SELECT "orgId" INTO source_org FROM public."ConnectorSource" WHERE "id" = NEW."sourceId";
  IF delivery_org IS NULL OR source_org IS NULL OR delivery_org <> source_org OR NEW."orgId" <> delivery_org THEN
    RAISE EXCEPTION 'empresa cruzada no item da remessa' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp;
CREATE TRIGGER "ConnectorDeliveryItem_orgId_do_pai" BEFORE INSERT OR UPDATE ON "ConnectorDeliveryItem"
  FOR EACH ROW EXECUTE FUNCTION mktos_connector_delivery_item_org();

CREATE OR REPLACE FUNCTION mktos_connector_delivery_item_context() RETURNS trigger AS $$
DECLARE delivery_source TEXT; context_org TEXT; context_ref TEXT; context_type TEXT;
BEGIN
  SELECT "sourceId" INTO delivery_source FROM public."ConnectorDelivery" WHERE "id" = NEW."deliveryId";
  IF delivery_source IS NULL OR delivery_source <> NEW."sourceId" THEN
    RAISE EXCEPTION 'fonte cruzada no item da remessa' USING ERRCODE = '23514';
  END IF;
  IF NEW."contextItemId" IS NOT NULL THEN
    SELECT "orgId", "sourceRef", "sourceType"::text INTO context_org, context_ref, context_type FROM public."ContextItem" WHERE "id" = NEW."contextItemId";
    IF context_org IS NULL OR context_org <> NEW."orgId" OR context_ref IS NULL OR context_ref <> NEW."sourceId" || '/' || NEW."caminhoRelativo" OR context_type <> 'conector' THEN
      RAISE EXCEPTION 'memória cruzada no item da remessa' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp;
CREATE TRIGGER "ConnectorDeliveryItem_context_do_pai" BEFORE INSERT OR UPDATE ON "ConnectorDeliveryItem"
  FOR EACH ROW EXECUTE FUNCTION mktos_connector_delivery_item_context();

CREATE OR REPLACE FUNCTION mktos_connector_item_state_org() RETURNS trigger AS $$
DECLARE source_org TEXT;
BEGIN
  SELECT "orgId" INTO source_org FROM public."ConnectorSource" WHERE "id" = NEW."sourceId";
  IF source_org IS NULL OR NEW."orgId" <> source_org THEN
    RAISE EXCEPTION 'empresa cruzada no estado da remessa' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp;
CREATE TRIGGER "ConnectorItemState_orgId_do_pai" BEFORE INSERT OR UPDATE ON "ConnectorItemState"
  FOR EACH ROW EXECUTE FUNCTION mktos_connector_item_state_org();

CREATE OR REPLACE FUNCTION mktos_connector_item_state_context() RETURNS trigger AS $$
DECLARE context_org TEXT; context_ref TEXT; context_type TEXT;
BEGIN
  SELECT "orgId", "sourceRef", "sourceType"::text INTO context_org, context_ref, context_type FROM public."ContextItem" WHERE "id" = NEW."contextItemId";
  IF context_org IS NULL OR context_org <> NEW."orgId" OR context_ref IS NULL OR context_ref <> NEW."sourceId" || '/' || NEW."caminhoRelativo" OR context_type <> 'conector' THEN
    RAISE EXCEPTION 'memória cruzada no estado da remessa' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp;
CREATE TRIGGER "ConnectorItemState_context_do_pai" BEFORE INSERT OR UPDATE ON "ConnectorItemState"
  FOR EACH ROW EXECUTE FUNCTION mktos_connector_item_state_context();

SELECT app_rls_aplicar_policies('ConnectorDelivery', 'public.app_org_resolvida() AND "orgId" = public.app_org_atual()', 'public.app_org_resolvida() AND "orgId" = public.app_org_atual()');
SELECT app_rls_aplicar_policies('ConnectorDeliveryItem', 'public.app_org_resolvida() AND "orgId" = public.app_org_atual()', 'public.app_org_resolvida() AND "orgId" = public.app_org_atual()');
SELECT app_rls_aplicar_policies('ConnectorItemState', 'public.app_org_resolvida() AND "orgId" = public.app_org_atual()', 'public.app_org_resolvida() AND "orgId" = public.app_org_atual()');

COMMENT ON TABLE "ConnectorDelivery" IS 'Tentativa de remessa: escopo, idempotência, revisão e frescor; não contém conteúdo.';
COMMENT ON TABLE "ConnectorDeliveryItem" IS 'Recibo de item remetido: hash e chave, nunca segunda verdade do conteúdo.';
COMMENT ON TABLE "ConnectorItemState" IS 'Última revisão aceita por caminho lógico de uma fonte.';
