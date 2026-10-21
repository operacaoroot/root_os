-- ============================================================================
-- TR-09 · O DELEGADOR: as subtarefas propostas (rodada dos agentes, 21/10/2026)
-- ============================================================================
--
-- ADITIVA: uma tabela nova, nenhuma coluna mexida em tabela existente.
--
-- Numa tarefa atribuída a um agente, o Delegador propõe subtarefas com dono
-- (pessoa ou agente do cadastro único) e prazo. Cada proposta mora aqui em
-- 'rascunho' até uma PESSOA aceitar (a subtarefa nasce na mesma transação que
-- toma a linha e o id vai para "subtarefaId") ou descartar. Nada é atribuído
-- sozinho. Mesmo desenho da "AtaSugestao".
--
-- Raiz da empresa: o "orgId" vem do insert, e a tarefa-mãe entra por chave
-- estrangeira COMPOSTA (taskId, orgId) -> "WorkTask"(id, orgId), então uma
-- proposta nunca pendura em tarefa de outra empresa. Isolamento por linha com
-- FORCE e o grupo padrão de policies.
--
-- Rollback só de imagem: a imagem anterior não conhece a tabela. Para desfazer
-- de vez (só se nada depender dela): DROP TABLE "DelegacaoSugestao";
-- ============================================================================

CREATE TABLE "DelegacaoSugestao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL DEFAULT '',
    "donoTipo" TEXT NOT NULL,
    "donoUsuarioId" TEXT,
    "donoFuncao" TEXT,
    "prazo" TIMESTAMP(3),
    "porque" TEXT NOT NULL DEFAULT '',
    "estado" TEXT NOT NULL DEFAULT 'rascunho',
    "subtarefaId" TEXT,
    "criadaPor" TEXT,
    "decididaPor" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decididaEm" TIMESTAMP(3),
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DelegacaoSugestao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DelegacaoSugestao_orgId_taskId_idx" ON "DelegacaoSugestao"("orgId", "taskId");
CREATE INDEX "DelegacaoSugestao_orgId_estado_idx" ON "DelegacaoSugestao"("orgId", "estado");

ALTER TABLE "DelegacaoSugestao" ADD CONSTRAINT "DelegacaoSugestao_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DelegacaoSugestao" ADD CONSTRAINT "DelegacaoSugestao_taskId_orgId_fkey"
  FOREIGN KEY ("taskId", "orgId") REFERENCES "WorkTask"("id", "orgId") ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "DelegacaoSugestao" ADD CONSTRAINT "DelegacaoSugestao_estado_check"
  CHECK ("estado" IN ('rascunho', 'aceita', 'descartada'));
ALTER TABLE "DelegacaoSugestao" ADD CONSTRAINT "DelegacaoSugestao_subtarefa_so_na_aceita_check"
  CHECK ("subtarefaId" IS NULL OR "estado" = 'aceita');
ALTER TABLE "DelegacaoSugestao" ADD CONSTRAINT "DelegacaoSugestao_dono_check"
  CHECK (
    ("donoTipo" = 'pessoa' AND "donoFuncao" IS NULL)
    OR ("donoTipo" = 'agente' AND "donoUsuarioId" IS NULL AND "donoFuncao" ~ '^[A-Z]{2}-[0-9]{2}$')
  );

SELECT app_rls_aplicar_policies(
  'DelegacaoSugestao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "DelegacaoSugestao" TO mktos_app';
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
   WHERE n.nspname = 'public' AND c.relname = 'DelegacaoSugestao';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'DelegacaoSugestao ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
