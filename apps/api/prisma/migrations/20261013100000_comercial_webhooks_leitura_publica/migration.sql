-- Cockpit do lead (lane D, 13/10/2026): os webhooks do dinheiro acham a empresa
-- pela linha.
--
-- O webhook do Asaas (`/api/comercial/webhooks/asaas`) e o da ZapSign
-- (`/api/comercial/webhooks/zapsign`) são anônimos: chegam sem empresa, só com o
-- id da cobrança ou do documento no provedor. Como a sala (`SalaDoCliente`) e o
-- convite do onboarding, a empresa é achada por UMA consulta mínima sob a
-- sentinela pública (`resolverTenantDaCobranca` / `resolverTenantDoDocumento`,
-- em `common/tenant-publico.ts`); o resto do pedido roda em `comTenantPublico`.
--
-- ADITIVA: só a policy de LEITURA das duas tabelas ganha a cláusula da
-- sentinela pública; a escrita continua presa à empresa resolvida. Nenhuma
-- coluna, nenhum índice: o `prisma migrate diff` não muda.
--
-- Rollback: reaplicar as duas linhas sem o `OR public.app_resolucao_publica()`.

SELECT app_rls_aplicar_policies(
  'ComercialCobranca',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual() OR public.app_resolucao_publica()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ComercialDocumento',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual() OR public.app_resolucao_publica()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
