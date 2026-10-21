-- ============================================================================
-- O GASTO DE IA POR FUNÇÃO DO CADASTRO ÚNICO (rodada dos agentes, 21/10/2026, A1)
-- ============================================================================
--
-- ADITIVA: uma tabela nova, nenhuma coluna mexida em tabela existente. A imagem
-- anterior não a conhece e segue funcionando (rollback só de imagem é seguro).
--
-- Toda chamada de modelo (conversa, vetorização, transcrição) soma aqui uma
-- linha por empresa, dia (São Paulo), função, agente, modelo e tipo, com ou sem
-- teto configurado. É de onde a tela de Agentes lê o gasto do mês por função
-- (`GastoPorFuncaoService.doMes`). Raiz da empresa, NÃO filha.
--
-- Rollback (só se nada depender dela): DROP TABLE "GastoDeIaPorFuncao";
-- ============================================================================

CREATE TABLE "GastoDeIaPorFuncao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dia" TEXT NOT NULL,
    "funcao" TEXT NOT NULL DEFAULT '',
    "agentSlug" TEXT NOT NULL DEFAULT '',
    "modelo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'conversa',
    "chamadas" INTEGER NOT NULL DEFAULT 0,
    "gastoUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "estimadoUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "naoMedidas" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GastoDeIaPorFuncao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GastoDeIaPorFuncao_orgId_dia_funcao_agentSlug_modelo_tipo_key"
  ON "GastoDeIaPorFuncao"("orgId", "dia", "funcao", "agentSlug", "modelo", "tipo");
CREATE INDEX "GastoDeIaPorFuncao_orgId_dia_idx" ON "GastoDeIaPorFuncao"("orgId", "dia");

ALTER TABLE "GastoDeIaPorFuncao" ADD CONSTRAINT "GastoDeIaPorFuncao_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GastoDeIaPorFuncao" ADD CONSTRAINT "GastoDeIaPorFuncao_tipo_check"
  CHECK ("tipo" IN ('conversa', 'vetorizacao', 'transcricao'));
-- A função é um id do cadastro único, ou vazia (a chamada não disse).
ALTER TABLE "GastoDeIaPorFuncao" ADD CONSTRAINT "GastoDeIaPorFuncao_funcao_check"
  CHECK ("funcao" = '' OR "funcao" ~ '^[A-Z]{2}-[0-9]{2}$');
ALTER TABLE "GastoDeIaPorFuncao" ADD CONSTRAINT "GastoDeIaPorFuncao_dia_check"
  CHECK ("dia" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
ALTER TABLE "GastoDeIaPorFuncao" ADD CONSTRAINT "GastoDeIaPorFuncao_numeros_check"
  CHECK ("chamadas" >= 0 AND "naoMedidas" >= 0 AND "gastoUsd" >= 0 AND "estimadoUsd" >= 0);

SELECT app_rls_aplicar_policies(
  'GastoDeIaPorFuncao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "GastoDeIaPorFuncao" TO mktos_app';
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
   WHERE n.nspname = 'public' AND c.relname = 'GastoDeIaPorFuncao';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'GastoDeIaPorFuncao ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
