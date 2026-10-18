-- Reuniões da ficha do cliente: transcrição (Granola, link ou texto) presa ao
-- cartão do Trabalho. Serve ao lead do comercial, ao onboarding e ao sucesso do
-- cliente. Apagar o cartão apaga as reuniões dele.
CREATE TABLE "ReuniaoDoCartao" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "titulo" TEXT NOT NULL,
  "em" TIMESTAMP(3) NOT NULL,
  "fonte" TEXT NOT NULL,
  "link" TEXT,
  "transcricao" TEXT NOT NULL,
  "autorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReuniaoDoCartao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReuniaoDoCartao_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReuniaoDoCartao_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkTask"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReuniaoDoCartao_fonte_check" CHECK ("fonte" IN ('granola', 'link', 'texto', 'arquivo')),
  CONSTRAINT "ReuniaoDoCartao_transcricao_check" CHECK (octet_length("transcricao") <= 2097152)
);
CREATE INDEX "ReuniaoDoCartao_orgId_taskId_em_idx" ON "ReuniaoDoCartao"("orgId", "taskId", "em");

-- A reunião é da mesma empresa do cartão: o banco confere, não só o serviço.
CREATE OR REPLACE FUNCTION "ReuniaoDoCartao_orgId_do_cartao"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "WorkTask" t WHERE t."id" = NEW."taskId" AND t."orgId" = NEW."orgId") THEN
    RAISE EXCEPTION 'ReuniaoDoCartao: cartão % não é da empresa %', NEW."taskId", NEW."orgId";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "ReuniaoDoCartao_orgId_do_cartao"
  BEFORE INSERT OR UPDATE OF "taskId", "orgId" ON "ReuniaoDoCartao"
  FOR EACH ROW EXECUTE FUNCTION "ReuniaoDoCartao_orgId_do_cartao"();

ALTER TABLE "ReuniaoDoCartao" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReuniaoDoCartao" FORCE ROW LEVEL SECURITY;
SELECT public.app_rls_aplicar_policies('ReuniaoDoCartao',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,true,true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON "ReuniaoDoCartao" TO mktos_app;
  END IF;
END $$;
