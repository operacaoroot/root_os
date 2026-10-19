-- CreateTable
CREATE TABLE "SalaVersao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "estado" TEXT NOT NULL,
    "conteudo" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "approvalId" TEXT,
    "criadoPor" TEXT,
    "publicadaEm" TIMESTAMP(3),
    "publicadaPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaVersao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaVersao_orgId_estado_idx" ON "SalaVersao"("orgId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "SalaVersao_leadId_numero_key" ON "SalaVersao"("leadId", "numero");

-- AddForeignKey
ALTER TABLE "SalaVersao" ADD CONSTRAINT "SalaVersao_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaVersao" ADD CONSTRAINT "SalaVersao_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ============================================================================
-- A SALA PUBLICADA POR VERSÃO — rodada da implantação I3 (18/10/2026)
--
-- Filha de `Lead`, no desenho das filhas de `20261013000000_cockpit_comercial`
-- e da `LeadReacao` (I4):
--
--   1. A EMPRESA CONFERIDA PELO BANCO — sentinela `''` e o gatilho
--      `mktos_orgid_do_pai('Lead', 'leadId')`.
--
--   2. ISOLAMENTO POR LINHA com leitura e escrita separadas, no grupo PADRÃO. A
--      rota anônima da sala acha a empresa pelo hash do token em
--      `SalaDoCliente` (sentinela pública) e só DEPOIS lê aqui, dentro de
--      `comTenantPublico`: esta tabela nunca é lida sob a sentinela.
--
--   3. O ESTADO em CHECK, e UMA VERSÃO ABERTA (rascunho ou na porta) POR LEAD
--      num índice único parcial: dois cliques em "publicar" ao mesmo tempo não
--      abrem duas versões (o serviço também toma o cadeado `sala-versao:<lead>`).
--
-- CAMINHO DE VOLTA (perde o histórico de versões; exporte antes):
--   DROP TABLE "SalaVersao";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261018240000_sala_versao';
-- ============================================================================

ALTER TABLE "SalaVersao" ADD CONSTRAINT "SalaVersao_estado_check"
  CHECK ("estado" IN ('rascunho', 'na_porta', 'publicada', 'substituida'));
ALTER TABLE "SalaVersao" ADD CONSTRAINT "SalaVersao_numero_check"
  CHECK ("numero" >= 1);
ALTER TABLE "SalaVersao" ADD CONSTRAINT "SalaVersao_hash_check"
  CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "SalaVersao" ADD CONSTRAINT "SalaVersao_publicada_check"
  CHECK ("estado" NOT IN ('publicada', 'substituida') OR "publicadaEm" IS NOT NULL);

CREATE UNIQUE INDEX "SalaVersao_uma_aberta_por_lead"
  ON "SalaVersao" ("leadId") WHERE "estado" IN ('rascunho', 'na_porta');

-- CreateTrigger: a empresa da versão é a do lead
CREATE TRIGGER "SalaVersao_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "SalaVersao"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Lead', 'leadId');

-- Isolamento por linha: o grupo padrão.
SELECT app_rls_aplicar_policies(
  'SalaVersao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "SalaVersao" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE, as quatro policies e o gatilho. Falha ALTA de
-- propósito — como `migrate deploy` roda no arranque do container, abortar aqui
-- é a API não subir com tabela vazada.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  ok boolean;
BEGIN
  SELECT c.relrowsecurity
     AND c.relforcerowsecurity
     AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
    INTO ok
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'SalaVersao';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'SalaVersao ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'SalaVersao_orgId_do_pai' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SalaVersao sem o gatilho que confere a empresa do lead.';
  END IF;
END $$;
