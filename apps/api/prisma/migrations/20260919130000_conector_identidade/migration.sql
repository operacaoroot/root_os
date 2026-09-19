-- ============================================================================
-- E3a.1 — identidade do conector local
--
-- Estas tabelas descrevem somente destinos lógicos. Nenhuma raiz do servidor,
-- credencial ou conteúdo de arquivo entra aqui. O dispositivo autentica por um
-- bearer opaco cujo hash é o único segredo persistido; o código de pareamento
-- é curto, descartável e consumido sob lock.
-- ============================================================================

CREATE TYPE "ConnectorSourceType" AS ENUM ('pasta', 'arquivo');
CREATE TYPE "ConnectorMode" AS ENUM ('importacao', 'sincronizacao');
CREATE TYPE "ConnectorDeletionRule" AS ENUM ('ignorar', 'arquivar');

CREATE TABLE "ConnectorSource" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "tipo" "ConnectorSourceType" NOT NULL,
  "raizLogica" TEXT NOT NULL,
  "incluir" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "excluir" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tiposPermitidos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "modo" "ConnectorMode" NOT NULL,
  "regraExclusao" "ConnectorDeletionRule" NOT NULL,
  "tamanhoMaximo" BIGINT NOT NULL,
  "escopoVersao" INTEGER NOT NULL DEFAULT 1,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorSource_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConnectorSource_orgId_revokedAt_idx" ON "ConnectorSource"("orgId", "revokedAt");
CREATE INDEX "ConnectorSource_orgId_nome_idx" ON "ConnectorSource"("orgId", "nome");

CREATE TABLE "ConnectorDevice" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  CONSTRAINT "ConnectorDevice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorDevice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConnectorDevice_tokenHash_key" ON "ConnectorDevice"("tokenHash");
CREATE INDEX "ConnectorDevice_orgId_revokedAt_idx" ON "ConnectorDevice"("orgId", "revokedAt");

CREATE TABLE "ConnectorDeviceSource" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL DEFAULT '',
  "deviceId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorDeviceSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorDeviceSource_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorDeviceSource_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ConnectorDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorDeviceSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ConnectorSource"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConnectorDeviceSource_deviceId_sourceId_key" ON "ConnectorDeviceSource"("deviceId", "sourceId");
CREATE INDEX "ConnectorDeviceSource_orgId_deviceId_idx" ON "ConnectorDeviceSource"("orgId", "deviceId");
CREATE INDEX "ConnectorDeviceSource_orgId_sourceId_idx" ON "ConnectorDeviceSource"("orgId", "sourceId");

CREATE TABLE "ConnectorPairingCode" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "sourceIds" TEXT[] NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorPairingCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorPairingCode_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorPairingCode_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConnectorPairingCode_codeHash_key" ON "ConnectorPairingCode"("codeHash");
CREATE INDEX "ConnectorPairingCode_orgId_expiresAt_idx" ON "ConnectorPairingCode"("orgId", "expiresAt");
CREATE INDEX "ConnectorPairingCode_orgId_usedAt_idx" ON "ConnectorPairingCode"("orgId", "usedAt");

DROP TRIGGER IF EXISTS "ConnectorPairingCode_orgId_do_pai" ON "ConnectorPairingCode";
CREATE TRIGGER "ConnectorPairingCode_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ConnectorPairingCode"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('User', 'createdByUserId');

CREATE OR REPLACE FUNCTION mktos_connector_device_source_org() RETURNS trigger AS $$
DECLARE
  device_org TEXT;
  source_org TEXT;
BEGIN
  SELECT "orgId" INTO device_org FROM public."ConnectorDevice" WHERE "id" = NEW."deviceId";
  SELECT "orgId" INTO source_org FROM public."ConnectorSource" WHERE "id" = NEW."sourceId";
  IF device_org IS NULL OR source_org IS NULL THEN
    RAISE EXCEPTION 'dispositivo ou fonte do conector não existe' USING ERRCODE = '23503';
  END IF;
  IF device_org <> source_org THEN
    RAISE EXCEPTION 'empresa cruzada: dispositivo e fonte do conector pertencem a empresas diferentes' USING ERRCODE = '23514';
  END IF;
  IF NEW."orgId" IS NULL OR NEW."orgId" = '' THEN
    NEW."orgId" := device_org;
  ELSIF NEW."orgId" <> device_org THEN
    RAISE EXCEPTION 'empresa cruzada na relação do conector' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp;

DROP TRIGGER IF EXISTS "ConnectorDeviceSource_orgId_do_pai" ON "ConnectorDeviceSource";
CREATE TRIGGER "ConnectorDeviceSource_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ConnectorDeviceSource"
  FOR EACH ROW EXECUTE FUNCTION mktos_connector_device_source_org();

-- A convenção do catálogo de filhos também é materializada para cada pai:
-- além da conferência conjunta acima, estes dois gatilhos fazem a coluna
-- sentinela herdar do dispositivo e recusam a fonte de outra empresa.
DROP TRIGGER IF EXISTS "ConnectorDeviceSource_orgId_do_pai_device" ON "ConnectorDeviceSource";
CREATE TRIGGER "ConnectorDeviceSource_orgId_do_pai_device"
  BEFORE INSERT OR UPDATE ON "ConnectorDeviceSource"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('ConnectorDevice', 'deviceId');
DROP TRIGGER IF EXISTS "ConnectorDeviceSource_orgId_do_pai_source" ON "ConnectorDeviceSource";
CREATE TRIGGER "ConnectorDeviceSource_orgId_do_pai_source"
  BEFORE INSERT OR UPDATE ON "ConnectorDeviceSource"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('ConnectorSource', 'sourceId');

SELECT app_rls_aplicar_policies(
  'ConnectorSource',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ConnectorDevice',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ConnectorDeviceSource',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ConnectorPairingCode',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

COMMENT ON TABLE "ConnectorSource" IS 'Destino lógico do conector; não contém raiz absoluta nem conteúdo.';
COMMENT ON TABLE "ConnectorDevice" IS 'Identidade opaca do conector local; somente hash do bearer.';
COMMENT ON TABLE "ConnectorPairingCode" IS 'Código de pareamento de 15 minutos e uso único; somente hash persistido.';
