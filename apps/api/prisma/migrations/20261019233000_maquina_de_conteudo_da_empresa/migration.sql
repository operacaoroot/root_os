-- Máquina de Conteúdo da empresa (Marketing): só cria tabelas novas.
-- Nada existente é alterado nem regravado.
CREATE TABLE "MarketingPost" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "numero" TEXT NOT NULL DEFAULT '',
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "titulo" TEXT NOT NULL,
  "pilar" TEXT NOT NULL DEFAULT '',
  "formato" TEXT NOT NULL DEFAULT 'Reel',
  "tipoCard" TEXT NOT NULL DEFAULT 'video',
  "prioridade" TEXT NOT NULL DEFAULT 'media',
  "headline" TEXT NOT NULL DEFAULT '',
  "subHeadline" TEXT NOT NULL DEFAULT '',
  "roteiro" TEXT NOT NULL DEFAULT '',
  "slides" JSONB NOT NULL DEFAULT '[]',
  "design" TEXT NOT NULL DEFAULT '',
  "legenda" TEXT NOT NULL DEFAULT '',
  "cta" TEXT NOT NULL DEFAULT '',
  "porque" TEXT NOT NULL DEFAULT '',
  "fontes" JSONB NOT NULL DEFAULT '[]',
  "recursos" JSONB NOT NULL DEFAULT '[]',
  "etapa" TEXT NOT NULL DEFAULT 'ideia',
  "data" DATE,
  "linkPublicado" TEXT NOT NULL DEFAULT '',
  "metricas" JSONB NOT NULL DEFAULT '{}',
  "hist" JSONB NOT NULL DEFAULT '[]',
  "comentarios" JSONB NOT NULL DEFAULT '[]',
  "criadoPor" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingPost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MarketingPost_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "MarketingPost_etapa_check" CHECK ("etapa" IN ('ideia', 'producao', 'a_agendar', 'agendado', 'publicado', 'arquivado'))
);
CREATE INDEX "MarketingPost_orgId_etapa_idx" ON "MarketingPost"("orgId", "etapa");
CREATE INDEX "MarketingPost_orgId_data_idx" ON "MarketingPost"("orgId", "data");

CREATE TABLE "MarketingMaquinaAjuste" (
  "orgId" TEXT NOT NULL,
  "cadencia" INTEGER[] NOT NULL DEFAULT ARRAY[2, 4]::INTEGER[],
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingMaquinaAjuste_pkey" PRIMARY KEY ("orgId"),
  CONSTRAINT "MarketingMaquinaAjuste_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MarketingPost', 'MarketingMaquinaAjuste'] LOOP
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
