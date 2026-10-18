-- ============================================================================
-- A CAIXA DE ENTRADA: o "limpei isto" de cada pessoa (rodada do painel P1, 18/10/2026)
-- ============================================================================
--
-- ADITIVA: uma tabela nova, nenhuma coluna mexida em tabela existente.
--
-- A caixa LÊ a atividade das tarefas (a auditoria de "WorkTask" em "AuditLog",
-- com o antes e o depois, e os comentários em "WorkComment"). Ela não copia
-- evento nenhum para cá: a única coisa gravada é a marca pessoal de leitura,
-- "esta pessoa limpou este evento" — e, na linha de origem 'tudo', até quando
-- ela limpou tudo de uma vez ("ate").
--
-- Raiz da empresa, NÃO filha: o "orgId" vem do insert, sem sentinela e sem
-- gatilho (não há pai de onde derivar a empresa: o evento vive em duas tabelas).
-- Isolamento por linha com FORCE, o grupo padrão de policies, como as tabelas
-- do cockpit comercial (20261013000000).
--
-- Rollback (só se nada depender dela): DROP TABLE "CaixaVisto";
-- ============================================================================

-- CreateTable
CREATE TABLE "CaixaVisto" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "ate" TIMESTAMP(3),
    "vistoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaixaVisto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaixaVisto_orgId_userId_origem_eventoId_key" ON "CaixaVisto"("orgId", "userId", "origem", "eventoId");

-- CreateIndex
CREATE INDEX "CaixaVisto_orgId_userId_vistoEm_idx" ON "CaixaVisto"("orgId", "userId", "vistoEm");

-- AddForeignKey
ALTER TABLE "CaixaVisto" ADD CONSTRAINT "CaixaVisto_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A origem é uma das três que o serviço conhece. O banco recusa a quarta, para
-- uma marca escrita por outro caminho não virar um "limpo" que nenhuma tela lê.
ALTER TABLE "CaixaVisto" ADD CONSTRAINT "CaixaVisto_origem_check"
  CHECK ("origem" IN ('auditoria', 'comentario', 'tudo'));

-- Isolamento por linha: o grupo padrão.
SELECT app_rls_aplicar_policies(
  'CaixaVisto',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "CaixaVisto" TO mktos_app';
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
   WHERE n.nspname = 'public' AND c.relname = 'CaixaVisto';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'CaixaVisto ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
