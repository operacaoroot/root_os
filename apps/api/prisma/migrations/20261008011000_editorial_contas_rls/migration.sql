-- Correção das seis tabelas introduzidas na rodada local anterior.
-- Conserva a expressão de empresa e os escritores existentes no serviço.
SELECT public.app_rls_aplicar_policies('EditorialMaterial',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()', true, true, false);
SELECT public.app_rls_aplicar_policies('EditorialVersion',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()', true, false, false);
SELECT public.app_rls_aplicar_policies('EditorialDecision',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()', true, true, false);
SELECT public.app_rls_aplicar_policies('EditorialProduction',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()', true, false, false);
SELECT public.app_rls_aplicar_policies('MarketingAccountConfig',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()', true, true, false);
SELECT public.app_rls_aplicar_policies('MarketingPreparation',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()', true, false, false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN
    GRANT SELECT, INSERT ON "EditorialMaterial", "EditorialVersion", "EditorialDecision",
      "EditorialProduction", "MarketingAccountConfig", "MarketingPreparation" TO mktos_app;
    GRANT UPDATE ON "EditorialMaterial", "EditorialDecision", "MarketingAccountConfig" TO mktos_app;
  END IF;
END $$;
