-- ============================================================================
-- PARCELAS DO ACORDO (29/10/2026): o Financeiro como dado ligado
-- ============================================================================
--
-- ADITIVA: uma tabela nova, nenhuma coluna mexida em tabela existente, nenhum
-- dado reescrito.
--
-- "AcordoParcela" é o que o contrato manda receber, parcela a parcela. A parcela
-- sem cobrança aparece no fluxo como um previsto; quando a cobrança do Asaas
-- chega, ela veste a parcela ("asaasPaymentId") em vez de virar outra linha, e o
-- recebimento do extrato com o mesmo id marca a parcela como paga.
--
-- Raiz da empresa: o "orgId" vem do insert, e o serviço confere que o acordo é
-- da mesma empresa. Isolamento por linha com FORCE, o grupo padrão de policies,
-- como a "FrotaCasa".
--
-- Rollback (só se nada depender dela):
--   DROP TABLE "AcordoParcela";
-- ============================================================================

CREATE TABLE "AcordoParcela" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "acordoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "vencimento" DATE NOT NULL,
    "asaasPaymentId" TEXT,
    "pagaEm" DATE,
    "recebimentoId" TEXT,
    "notaFiscal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcordoParcela_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AcordoParcela_acordoId_numero_key" ON "AcordoParcela"("acordoId", "numero");
CREATE UNIQUE INDEX "AcordoParcela_orgId_asaasPaymentId_key" ON "AcordoParcela"("orgId", "asaasPaymentId");
CREATE INDEX "AcordoParcela_orgId_vencimento_idx" ON "AcordoParcela"("orgId", "vencimento");

ALTER TABLE "AcordoParcela" ADD CONSTRAINT "AcordoParcela_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AcordoParcela" ADD CONSTRAINT "AcordoParcela_acordoId_fkey"
  FOREIGN KEY ("acordoId") REFERENCES "AcordoComercial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcordoParcela" ADD CONSTRAINT "AcordoParcela_numero_check" CHECK ("numero" >= 1);
ALTER TABLE "AcordoParcela" ADD CONSTRAINT "AcordoParcela_valor_check" CHECK ("valor" > 0);

-- Isolamento por linha: o grupo padrão.
SELECT app_rls_aplicar_policies(
  'AcordoParcela',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "AcordoParcela" TO mktos_app';
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
   WHERE n.nspname = 'public' AND c.relname = 'AcordoParcela';
  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION 'AcordoParcela ficou sem isolamento por linha (rls/force/policies).';
  END IF;
END $$;
