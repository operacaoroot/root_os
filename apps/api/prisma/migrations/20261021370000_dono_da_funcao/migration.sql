-- ============================================================================
-- O DONO TROCADO NA EQUIPE (rodada dos agentes, 21/10/2026, A7)
-- ============================================================================
--
-- ADITIVA: uma tabela nova, nenhuma coluna mexida em tabela existente. A imagem
-- anterior não a lê e continua funcionando com ela no banco (rollback só de
-- imagem serve).
--
-- O dono PADRÃO de cada função vem do cadastro único (packages/shared/src/agentes.ts).
-- Quando alguém troca o dono na Equipe, a troca vive aqui para as funções SEM
-- registro "Agent" (as que têm guardam em "Agent"."donoId"). "userId" nulo =
-- voltou ao padrão. A FK composta ("userId", "orgId") prende o dono à empresa.
--
-- Raiz da empresa, NÃO filha: o "orgId" vem do insert.
--
-- Rollback (só se nada depender dela): DROP TABLE "DonoDaFuncao";
-- ============================================================================

CREATE TABLE "DonoDaFuncao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "funcaoId" TEXT NOT NULL,
    "userId" TEXT,
    "definidoPorId" TEXT NOT NULL,
    "definidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonoDaFuncao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DonoDaFuncao_orgId_funcaoId_key" ON "DonoDaFuncao"("orgId", "funcaoId");

ALTER TABLE "DonoDaFuncao" ADD CONSTRAINT "DonoDaFuncao_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DonoDaFuncao" ADD CONSTRAINT "DonoDaFuncao_userId_orgId_fkey"
  FOREIGN KEY ("userId", "orgId") REFERENCES "User"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A função é um id do cadastro único.
ALTER TABLE "DonoDaFuncao" ADD CONSTRAINT "DonoDaFuncao_funcaoId_check"
  CHECK ("funcaoId" ~ '^[A-Z]{2}-[0-9]{2}$');

SELECT app_rls_aplicar_policies(
  'DonoDaFuncao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "DonoDaFuncao" TO mktos_app';
  END IF;
END $$;

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
   WHERE n.nspname = 'public' AND c.relname = 'DonoDaFuncao';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'DonoDaFuncao ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento.';
  END IF;
END $$;
