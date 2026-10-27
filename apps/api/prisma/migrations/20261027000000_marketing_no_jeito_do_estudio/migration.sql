-- Marketing no jeito do ROOT Estúdio (26/10/2026): Memória, Triagem de ideias e réguas por formato.
-- Só cria tabelas e acrescenta duas colunas com padrão no MarketingPost (tabela nova desta leva).
-- Nada existente é regravado.
ALTER TABLE "MarketingPost" ADD COLUMN "subtipo" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MarketingPost" ADD COLUMN "cardId" TEXT;

CREATE TABLE "MarketingNota" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "pasta" TEXT NOT NULL DEFAULT 'Conhecimento',
  "titulo" TEXT NOT NULL,
  "tipo" TEXT NOT NULL DEFAULT 'nota',
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "url" TEXT,
  "autor" TEXT,
  "resumo" TEXT NOT NULL DEFAULT '',
  "corpo" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'pronto',
  "erro" TEXT,
  "via" TEXT NOT NULL DEFAULT 'app',
  "enviadaPor" TEXT,
  "driveFileId" TEXT,
  "driveEm" TIMESTAMP(3),
  "custoUsd" DECIMAL(10,4),
  "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadaEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingNota_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MarketingNota_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "MarketingNota_pasta_check" CHECK ("pasta" IN ('Ideias', 'Links', 'Vídeos', 'Conhecimento', 'Diário')),
  CONSTRAINT "MarketingNota_tipo_check" CHECK ("tipo" IN ('ideia', 'link', 'video', 'nota')),
  CONSTRAINT "MarketingNota_status_check" CHECK ("status" IN ('pronto', 'fila', 'processando', 'erro')),
  CONSTRAINT "MarketingNota_via_check" CHECK ("via" IN ('app', 'whatsapp'))
);
CREATE INDEX "MarketingNota_orgId_pasta_atualizadaEm_idx" ON "MarketingNota"("orgId", "pasta", "atualizadaEm");
CREATE INDEX "MarketingNota_orgId_url_idx" ON "MarketingNota"("orgId", "url");
CREATE INDEX "MarketingNota_orgId_status_idx" ON "MarketingNota"("orgId", "status");

CREATE TABLE "MarketingIdeiaCard" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "capturaId" TEXT,
  "notaId" TEXT,
  "fonteId" TEXT,
  "fonteNome" TEXT NOT NULL DEFAULT '',
  "titulo" TEXT NOT NULL,
  "resumo" TEXT NOT NULL DEFAULT '',
  "porque" TEXT NOT NULL DEFAULT '',
  "como" JSONB NOT NULL DEFAULT '{}',
  "formatoSugerido" TEXT NOT NULL DEFAULT 'Carrossel',
  "url" TEXT,
  "imagemUrl" TEXT,
  "publicadoEm" TIMESTAMP(3),
  "relevancia" INTEGER NOT NULL DEFAULT 0,
  "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'nova',
  "motivo" TEXT,
  "decididaEm" TIMESTAMP(3),
  "decididaPor" TEXT,
  "postId" TEXT,
  "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingIdeiaCard_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MarketingIdeiaCard_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "MarketingIdeiaCard_status_check" CHECK ("status" IN ('nova', 'aprovada', 'recusada', 'descartada_ia'))
);
CREATE UNIQUE INDEX "MarketingIdeiaCard_orgId_capturaId_key" ON "MarketingIdeiaCard"("orgId", "capturaId");
CREATE UNIQUE INDEX "MarketingIdeiaCard_orgId_notaId_key" ON "MarketingIdeiaCard"("orgId", "notaId");
CREATE INDEX "MarketingIdeiaCard_orgId_status_score_idx" ON "MarketingIdeiaCard"("orgId", "status", "score");
CREATE INDEX "MarketingIdeiaCard_orgId_fonteId_idx" ON "MarketingIdeiaCard"("orgId", "fonteId");

CREATE TABLE "MarketingRegua" (
  "orgId" TEXT NOT NULL,
  "formato" TEXT NOT NULL,
  "regras" TEXT NOT NULL DEFAULT '',
  "params" JSONB NOT NULL DEFAULT '{}',
  "referencias" JSONB NOT NULL DEFAULT '[]',
  "atualizadaEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingRegua_pkey" PRIMARY KEY ("orgId", "formato"),
  CONSTRAINT "MarketingRegua_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MarketingNota', 'MarketingIdeiaCard', 'MarketingRegua'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    PERFORM public.app_rls_aplicar_policies(t,
      'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
      'public.app_org_resolvida() AND "orgId"=public.app_org_atual()', true, true, true);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO mktos_app', t);
    END IF;
  END LOOP;
END $$;
