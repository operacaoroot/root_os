-- ============================================================================
-- O BANCO DE ATAS DO TRABALHO: as sugestões de tarefa (rodada do painel P3, 18/10/2026)
-- ============================================================================
--
-- ADITIVA: uma tabela nova, nenhuma coluna mexida em tabela existente.
--
-- O leitor de atas do Trabalho lê uma ata (nota do vault indexada ou ata colada,
-- que vira nota da memória) e PROPÕE tarefas. Cada proposta mora aqui, em
-- 'rascunho', com o trecho da ata de onde saiu. Aceitar cria a "WorkTask" pelo
-- serviço do Trabalho e guarda o id em "workTaskId"; descartar fica registrado
-- com quem e quando. Nada vira tarefa sozinho.
--
-- Raiz da empresa, NÃO filha: o "orgId" vem do insert, sem sentinela e sem
-- gatilho ("ataRef" aponta para duas tabelas diferentes, sem FK de propósito).
-- Isolamento por linha com FORCE, o grupo padrão de policies, como a
-- "CaixaVisto" da P1 (20261018100000).
--
-- Rollback (só se nada depender dela): DROP TABLE "AtaSugestao";
-- ============================================================================

-- CreateTable
CREATE TABLE "AtaSugestao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ataRef" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "listaId" TEXT,
    "donoSugerido" TEXT,
    "vencimento" TIMESTAMP(3),
    "trecho" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'rascunho',
    "workTaskId" TEXT,
    "criadaPor" TEXT,
    "decididaPor" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decididaEm" TIMESTAMP(3),
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtaSugestao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AtaSugestao_orgId_ataRef_idx" ON "AtaSugestao"("orgId", "ataRef");

-- CreateIndex
CREATE INDEX "AtaSugestao_orgId_estado_idx" ON "AtaSugestao"("orgId", "estado");

-- AddForeignKey
ALTER TABLE "AtaSugestao" ADD CONSTRAINT "AtaSugestao_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- O estado é um dos três que o serviço conhece, e a tarefa só existe na aceita.
ALTER TABLE "AtaSugestao" ADD CONSTRAINT "AtaSugestao_estado_check"
  CHECK ("estado" IN ('rascunho', 'aceita', 'descartada'));
ALTER TABLE "AtaSugestao" ADD CONSTRAINT "AtaSugestao_tarefa_so_na_aceita_check"
  CHECK ("workTaskId" IS NULL OR "estado" = 'aceita');
-- A referência é uma das duas formas (`vault:<id>` ou `memoria:<id>`).
ALTER TABLE "AtaSugestao" ADD CONSTRAINT "AtaSugestao_ataRef_check"
  CHECK ("ataRef" ~ '^(vault|memoria):[A-Za-z0-9_-]{1,80}$');

-- Isolamento por linha: o grupo padrão.
SELECT app_rls_aplicar_policies(
  'AtaSugestao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "AtaSugestao" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE e as quatro policies. Falha ALTA de propósito —
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
   WHERE n.nspname = 'public' AND c.relname = 'AtaSugestao';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'AtaSugestao ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
