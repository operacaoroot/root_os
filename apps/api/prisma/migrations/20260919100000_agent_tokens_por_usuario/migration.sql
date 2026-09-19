-- ============================================================================
-- CREDENCIAL INDIVIDUAL DE AGENTE (E2a)
--
-- O bearer é individual, tem escopo/expiração/revogação e nunca é persistido
-- em claro. `orgId` é redundante de propósito: o gatilho deriva e confere a
-- empresa pelo User pai. A policy é a mesma de todo dado de tenant e FORCE é
-- obrigatório para que também valha quando a conexão for dona das tabelas.
-- ============================================================================

CREATE TABLE "AgentToken" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL DEFAULT '',
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),

  CONSTRAINT "AgentToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentToken_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentToken_tokenHash_key" ON "AgentToken"("tokenHash");
CREATE INDEX "AgentToken_orgId_userId_idx" ON "AgentToken"("orgId", "userId");
CREATE INDEX "AgentToken_orgId_revokedAt_idx" ON "AgentToken"("orgId", "revokedAt");
CREATE INDEX "AgentToken_orgId_expiresAt_idx" ON "AgentToken"("orgId", "expiresAt");

-- A linha não pode costurar usuário de uma empresa com orgId de outra.
DROP TRIGGER IF EXISTS "AgentToken_orgId_do_pai" ON "AgentToken";
CREATE TRIGGER "AgentToken_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "AgentToken"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('User', 'userId');

-- Descoberta do token não usa a sentinela de plataforma: o orgId apresentado
-- pelo bearer apenas escolhe a consulta. A policy e o hash/id conferem a linha.
SELECT app_rls_aplicar_policies(
  'AgentToken',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
