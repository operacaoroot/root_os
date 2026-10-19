-- CreateTable
CREATE TABLE "LeadReacao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "secao" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "texto" TEXT,
    "segundos" INTEGER,
    "acesso" INTEGER NOT NULL,
    "respondidaEm" TIMESTAMP(3),
    "tarefaId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadReacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadReacao_orgId_criadoEm_idx" ON "LeadReacao"("orgId", "criadoEm");

-- CreateIndex
CREATE INDEX "LeadReacao_leadId_criadoEm_idx" ON "LeadReacao"("leadId", "criadoEm");

-- AddForeignKey
ALTER TABLE "LeadReacao" ADD CONSTRAINT "LeadReacao_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadReacao" ADD CONSTRAINT "LeadReacao_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ============================================================================
-- A PROPOSTA MEDE LEITURA E COLHE IDEIAS — rodada da implantação I4 (18/10/2026)
--
-- O que o Prisma gerou acima: a tabela `LeadReacao`, filha de `Lead`. O que ele
-- NÃO modela, no mesmo desenho das filhas de `20261013000000_cockpit_comercial`:
--
--   1. A EMPRESA CONFERIDA PELO BANCO — `orgId` com a sentinela `''` e o gatilho
--      `mktos_orgid_do_pai('Lead', 'leadId')` (função de
--      `20260910120000_orgid_em_todo_filho`, não redefinida aqui): a empresa é a
--      do lead, e filho pendurado em lead de outra é recusado.
--
--   2. ISOLAMENTO POR LINHA com leitura e escrita separadas, no grupo PADRÃO. A
--      rota anônima da sala acha a empresa pelo hash do token em
--      `SalaDoCliente` (sentinela pública) e só DEPOIS escreve aqui, já dentro de
--      `comTenantPublico`: esta tabela nunca é lida sob a sentinela e por isso
--      não ganha a cláusula `app_resolucao_publica()`.
--
--   3. AS REGRAS DO DADO DO CLIENTE em CHECK, para valerem também fora do
--      serviço: os quatro tipos e as três seções conhecidos; texto só em dúvida
--      e ideia, nunca vazio e com no máximo 1.000 caracteres (regra dura da
--      rodada); segundos só na leitura, de 0 a 3.600 (o teto por visita e seção:
--      uma aba esquecida aberta não vira "leu oito horas").
--
--   4. A AGREGAÇÃO NÃO PRECISA DE ÍNDICE PARCIAL: a linha de leitura e a de
--      "faz sentido" têm o id DERIVADO de (lead, versão, seção, visita, tipo),
--      e a chave primária é o que impede a segunda linha. O `prisma migrate diff`
--      não enxerga índice parcial e acusaria diferença a cada conferência.
--
-- CAMINHO DE VOLTA (perde as reações; exporte antes):
--   DROP TABLE "LeadReacao";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261018230000_lead_reacao';
-- ============================================================================

ALTER TABLE "LeadReacao" ADD CONSTRAINT "LeadReacao_tipo_check"
  CHECK ("tipo" IN ('leitura', 'faz_sentido', 'duvida', 'ideia'));
ALTER TABLE "LeadReacao" ADD CONSTRAINT "LeadReacao_secao_check"
  CHECK ("secao" IN ('montar', 'funciona', 'investimento'));
ALTER TABLE "LeadReacao" ADD CONSTRAINT "LeadReacao_texto_check"
  CHECK (
    ("tipo" IN ('duvida', 'ideia') AND "texto" IS NOT NULL AND char_length("texto") BETWEEN 1 AND 1000)
    OR ("tipo" IN ('leitura', 'faz_sentido') AND "texto" IS NULL)
  );
ALTER TABLE "LeadReacao" ADD CONSTRAINT "LeadReacao_segundos_check"
  CHECK (
    ("tipo" = 'leitura' AND "segundos" IS NOT NULL AND "segundos" BETWEEN 0 AND 3600)
    OR ("tipo" <> 'leitura' AND "segundos" IS NULL)
  );
ALTER TABLE "LeadReacao" ADD CONSTRAINT "LeadReacao_versao_acesso_check"
  CHECK ("versao" >= 1 AND "acesso" >= 0);

-- CreateTrigger: a empresa da reação é a do lead
CREATE TRIGGER "LeadReacao_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "LeadReacao"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Lead', 'leadId');

-- Isolamento por linha: o grupo padrão.
SELECT app_rls_aplicar_policies(
  'LeadReacao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "LeadReacao" TO mktos_app';
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
   WHERE n.nspname = 'public' AND c.relname = 'LeadReacao';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'LeadReacao ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'LeadReacao_orgId_do_pai' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'LeadReacao sem o gatilho que confere a empresa do lead.';
  END IF;
END $$;
