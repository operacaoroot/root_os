-- ============================================================================
-- A PROPOSTA É DO LEAD (rodada de produção 3, I5, 22/10/2026)
-- ============================================================================
--
-- ADITIVA: uma tabela nova, nenhuma coluna mexida em tabela existente.
--
-- A tela Propostas passa a ter o lead como identidade da linha. A proposta da
-- sala já nasce de um lead; a do serviço de propostas (as antigas da ROOT, que
-- moram fora do OS) não tinha vínculo gravado e era casada pelo nome. Aqui mora
-- o vínculo que a PESSOA grava: "Vincular a um lead" ou "Criar lead".
--
-- Uma linha por proposta e empresa (índice único): vincular de novo ao mesmo
-- lead não muda nada; a outro lead, o serviço responde 409. O lead pelo par
-- (id, orgId), como a tarefa do lead: lead de outra empresa não pendura.
-- RESTRICT: o lead com proposta vinculada não se apaga por baixo.
--
-- Raiz da empresa, NÃO filha: o "orgId" vem do insert. Isolamento por linha com
-- FORCE, o grupo padrão de policies, como a "AtaSugestao".
--
-- Rollback (só se nada depender dela): DROP TABLE "PropostaDoLead";
-- ============================================================================

CREATE TABLE "PropostaDoLead" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "proposta" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "como" TEXT NOT NULL,
    "vinculadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropostaDoLead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PropostaDoLead_orgId_proposta_key" ON "PropostaDoLead"("orgId", "proposta");
CREATE INDEX "PropostaDoLead_orgId_leadId_idx" ON "PropostaDoLead"("orgId", "leadId");

ALTER TABLE "PropostaDoLead" ADD CONSTRAINT "PropostaDoLead_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PropostaDoLead" ADD CONSTRAINT "PropostaDoLead_leadId_orgId_fkey"
  FOREIGN KEY ("leadId", "orgId") REFERENCES "Lead"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A referência é a da proposta do serviço (`servico:<cliente>/<chave>`), e o vínculo nasce de um dos dois jeitos.
ALTER TABLE "PropostaDoLead" ADD CONSTRAINT "PropostaDoLead_proposta_check"
  CHECK ("proposta" ~ '^servico:[A-Za-z0-9_-]{2,80}/[A-Za-z0-9_-]{2,80}$');
ALTER TABLE "PropostaDoLead" ADD CONSTRAINT "PropostaDoLead_como_check"
  CHECK ("como" IN ('vinculada', 'criada'));

-- Isolamento por linha: o grupo padrão.
SELECT app_rls_aplicar_policies(
  'PropostaDoLead',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "PropostaDoLead" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE e as quatro policies. Falha ALTA de propósito:
-- como `migrate deploy` roda no arranque do container, abortar aqui é a API não
-- subir com tabela vazada.
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
   WHERE n.nspname = 'public' AND c.relname = 'PropostaDoLead';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'PropostaDoLead ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
