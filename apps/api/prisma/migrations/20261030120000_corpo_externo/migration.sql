-- ============================================================================
-- O CORPO DE UM AGENTE EXTERNO (30/10/2026, A4): o token do Hermes da Rootinha
-- ============================================================================
--
-- ADITIVA: uma tabela nova, nenhuma coluna mexida em tabela existente, nenhum
-- dado reescrito.
--
-- "CorpoExterno" é o processo de fora (o Hermes Agent, na mesma VPS) que fala com
-- o OS por um agente do cadastro. O token dele é vinculado a empresa + agente +
-- pessoa padrão, e só o sha256 fica aqui (como "FrotaCasa"). O token abre só as
-- rotas daquele agente (`/agents/:slug/...`) e as leituras GET que ele declarou.
-- Revogar é marcar "revogadoEm": a linha fica, com quem revogou e por quê.
--
-- Raiz da empresa, NÃO filha: o "orgId" vem do insert. Isolamento por linha com
-- FORCE, o grupo padrão de policies, como a "FrotaCasa".
--
-- Rollback (só se nada depender dela; derruba todo token de corpo emitido):
--   DROP TABLE "CorpoExterno";
-- ============================================================================

CREATE TABLE "CorpoExterno" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "solicitanteId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoEm" TIMESTAMP(3),
    "revogadoEm" TIMESTAMP(3),
    "revogadoPorId" TEXT,
    "motivoRevogacao" TEXT,

    CONSTRAINT "CorpoExterno_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CorpoExterno_tokenHash_key" ON "CorpoExterno"("tokenHash");
CREATE INDEX "CorpoExterno_orgId_agentSlug_idx" ON "CorpoExterno"("orgId", "agentSlug");

ALTER TABLE "CorpoExterno" ADD CONSTRAINT "CorpoExterno_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorpoExterno" ADD CONSTRAINT "CorpoExterno_corpo_check"
  CHECK ("corpo" ~ '^[a-z0-9][a-z0-9-]{0,39}$');
ALTER TABLE "CorpoExterno" ADD CONSTRAINT "CorpoExterno_tokenHash_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

-- Isolamento por linha: o grupo padrão.
SELECT app_rls_aplicar_policies(
  'CorpoExterno',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "CorpoExterno" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE e as quatro policies. Falha ALTA de propósito:
-- tabela de empresa sem policy é vazamento, não pendência.
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
   WHERE n.nspname = 'public' AND c.relname = 'CorpoExterno';
  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION 'CorpoExterno ficou sem isolamento por linha (rls/force/policies).';
  END IF;
END $$;
