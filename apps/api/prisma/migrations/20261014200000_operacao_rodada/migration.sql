-- Painel da operação da Root: uma linha por rodada semanal, escrita pelo script
-- `importar-painel-operacao` e lida pela tela `/operacao`. Reimportar a mesma
-- rodada substitui o conteúdo (UPDATE); apagar não é caminho da aplicação.
CREATE TABLE "OperacaoRodada" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "rodadaEm" TEXT NOT NULL,
  "conteudo" JSONB NOT NULL,
  "origem" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperacaoRodada_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperacaoRodada_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "OperacaoRodada_rodadaEm_check" CHECK ("rodadaEm" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "OperacaoRodada_origem_check" CHECK ("origem" IN ('script')),
  CONSTRAINT "OperacaoRodada_conteudo_check" CHECK (COALESCE(
    jsonb_typeof("conteudo")='object'
    AND octet_length("conteudo"::text)<=256000
    AND "conteudo"->'versao'='1'::jsonb
    AND "conteudo"->>'rodadaEm'="rodadaEm",
    false
  ))
);
CREATE UNIQUE INDEX "OperacaoRodada_id_orgId_key" ON "OperacaoRodada"("id","orgId");
CREATE UNIQUE INDEX "OperacaoRodada_orgId_rodadaEm_key" ON "OperacaoRodada"("orgId","rodadaEm");

ALTER TABLE "OperacaoRodada" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperacaoRodada" FORCE ROW LEVEL SECURITY;
SELECT public.app_rls_aplicar_policies('OperacaoRodada',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,true,false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN
    GRANT SELECT,INSERT,UPDATE ON "OperacaoRodada" TO mktos_app;
  END IF;
END $$;
