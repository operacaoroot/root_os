-- ============================================================================
-- AS PENDÊNCIAS QUE UM AGENTE OU UMA ROTINA DEIXA PARA UMA PESSOA
-- (rodada dos agentes, 21/10/2026, Lane 0)
-- ============================================================================
--
-- ADITIVA: uma tabela nova, nenhuma coluna mexida em tabela existente.
--
-- O arquivista que não sabe a subpasta, o cobrador de tarefas, a triagem do
-- WhatsApp com confiança baixa e o vigia da agenda sem proposta segura deixam
-- aqui UMA decisão para uma pessoa, com as opções. A caixa (Pendências) LÊ esta
-- tabela, como lê a ComercialDecisao: a caixa continua sem fonte própria.
-- Responder chama o tratador inscrito pelo tipo (PendenciasRegistry), e quem
-- escreve fora do OS continua passando pela porta.
--
-- Raiz da empresa, NÃO filha: o "orgId" vem do insert ("refId" aponta para
-- tabelas diferentes, sem FK de propósito). "chave" dá a idempotência: a mesma
-- pendência aberta duas vezes cai na mesma linha.
--
-- Rollback (só se nada depender dela): DROP TABLE "Pendencia";
-- ============================================================================

CREATE TABLE "Pendencia" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "funcao" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "contexto" TEXT NOT NULL DEFAULT '',
    "opcoes" JSONB NOT NULL DEFAULT '[]',
    "paraUsuarioId" TEXT,
    "refTipo" TEXT,
    "refId" TEXT,
    "dados" JSONB,
    "estado" TEXT NOT NULL DEFAULT 'aberta',
    "escolha" TEXT,
    "decididaPor" TEXT,
    "decididaEm" TIMESTAMP(3),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pendencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Pendencia_orgId_chave_key" ON "Pendencia"("orgId", "chave");
CREATE INDEX "Pendencia_orgId_estado_idx" ON "Pendencia"("orgId", "estado");
CREATE INDEX "Pendencia_orgId_paraUsuarioId_estado_idx" ON "Pendencia"("orgId", "paraUsuarioId", "estado");

ALTER TABLE "Pendencia" ADD CONSTRAINT "Pendencia_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Pendencia" ADD CONSTRAINT "Pendencia_estado_check"
  CHECK ("estado" IN ('aberta', 'resolvida', 'descartada'));
ALTER TABLE "Pendencia" ADD CONSTRAINT "Pendencia_escolha_so_na_resolvida_check"
  CHECK ("escolha" IS NULL OR "estado" = 'resolvida');
-- A função é um id do cadastro único (packages/shared/src/agentes.ts).
ALTER TABLE "Pendencia" ADD CONSTRAINT "Pendencia_funcao_check"
  CHECK ("funcao" ~ '^[A-Z]{2}-[0-9]{2}$');

SELECT app_rls_aplicar_policies(
  'Pendencia',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "Pendencia" TO mktos_app';
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
   WHERE n.nspname = 'public' AND c.relname = 'Pendencia';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'Pendencia ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
