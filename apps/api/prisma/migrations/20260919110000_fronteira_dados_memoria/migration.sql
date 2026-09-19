-- ============================================================================
-- ADR-015: concessão explícita de fonte/campo para memória de agente (E2b)
--
-- A fonte é selecionada por sourceType + sourceRef exatos. Não existe
-- wildcard. A concessão de leitura nunca autoriza vetorização: essa coluna
-- nasce false e só um futuro fluxo de consentimento específico poderá ligá-la.
-- ============================================================================

CREATE TABLE "AgentDataGrant" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "sourceType" "ContextSource" NOT NULL,
  "sourceRef" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'agente_externo',
  "consentVersion" TEXT NOT NULL,
  "consentText" TEXT NOT NULL,
  "grantedByUserId" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  "allowVectorization" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentDataGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentDataGrant_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentDataGrant_orgId_sourceType_sourceRef_field_key"
  ON "AgentDataGrant"("orgId", "sourceType", "sourceRef", "field");
CREATE INDEX "AgentDataGrant_orgId_revokedAt_idx"
  ON "AgentDataGrant"("orgId", "revokedAt");
CREATE INDEX "AgentDataGrant_source_idx"
  ON "AgentDataGrant"("orgId", "sourceType", "sourceRef", "field");

-- A policy é deliberadamente apenas de tenant. O serviço ainda relê o ator e
-- sua permissão atual antes de qualquer concessão/revogação.
SELECT app_rls_aplicar_policies(
  'AgentDataGrant',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
