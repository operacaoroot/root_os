-- Aditiva. Sem backfill: documento legado sem origem continua recusado para cópia automática.
ALTER TABLE "ComercialDocumento" ADD COLUMN "origemApprovalId" TEXT;
CREATE TABLE "OrigemArquivoCliente" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orgId" TEXT NOT NULL REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tipo" TEXT NOT NULL CHECK ("tipo" IN ('sala','whatsapp','contrato-assinado')),
  "fonteId" TEXT NOT NULL,
  "chaveDedupe" TEXT NOT NULL,
  "leadId" TEXT,
  "partnerId" TEXT,
  "atorId" TEXT,
  "prova" JSONB NOT NULL CHECK (jsonb_typeof("prova") = 'object' AND "prova"->>'v' = '1'),
  "chave" TEXT NOT NULL,
  "sha256" TEXT NOT NULL CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
  "bytes" INTEGER NOT NULL CHECK ("bytes" BETWEEN 1 AND 104857600),
  "tipoMime" TEXT NOT NULL,
  "revogadoEm" TIMESTAMP(3),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("leadId" IS NOT NULL OR "partnerId" IS NOT NULL)
);
CREATE UNIQUE INDEX "OrigemArquivoCliente_orgId_tipo_chaveDedupe_key" ON "OrigemArquivoCliente"("orgId","tipo","chaveDedupe");
CREATE INDEX "OrigemArquivoCliente_orgId_fonteId_idx" ON "OrigemArquivoCliente"("orgId","fonteId");
CREATE FUNCTION origem_arquivo_prova_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'revogadoEm') IS DISTINCT FROM (to_jsonb(OLD) - 'revogadoEm')
    OR (OLD."revogadoEm" IS NOT NULL AND NEW."revogadoEm" IS DISTINCT FROM OLD."revogadoEm") THEN
    RAISE EXCEPTION 'A prova de origem não pode ser substituída ou reativada';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "OrigemArquivoCliente_prova_imutavel" BEFORE UPDATE ON "OrigemArquivoCliente"
FOR EACH ROW EXECUTE FUNCTION origem_arquivo_prova_imutavel();
CREATE FUNCTION documento_origem_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."origemApprovalId" IS DISTINCT FROM OLD."origemApprovalId" THEN
    RAISE EXCEPTION 'A origem da emissão não pode ser substituída';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ComercialDocumento_origem_imutavel" BEFORE UPDATE ON "ComercialDocumento"
FOR EACH ROW EXECUTE FUNCTION documento_origem_imutavel();
SELECT app_rls_aplicar_policies('OrigemArquivoCliente',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "OrigemArquivoCliente" TO mktos_app;
  END IF;
END $$;
