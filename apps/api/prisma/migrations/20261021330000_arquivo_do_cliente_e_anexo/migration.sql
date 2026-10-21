-- ============================================================================
-- O ARQUIVO DO CLIENTE (TR-05) E O ANEXO NA TAREFA (TR-06)
-- (rodada dos agentes, 21/10/2026, lane A4)
-- ============================================================================
--
-- ADITIVA: duas tabelas novas, nenhuma coluna mexida em tabela existente. A
-- imagem anterior não lê nenhuma das duas: voltar só a imagem não quebra nada.
--
-- 1. "ArquivoDoCliente": o que o arquivista fez com cada arquivo que chegou
--    para um cliente (o binário no storage do OS, a subpasta, o nome padrão, a
--    aprovação da porta, o link no Drive). É também a FILA dos arquivos que
--    esperam a pasta do cliente nascer. Raiz da empresa: o "orgId" vem do
--    insert (o arquivo pode chegar antes do cliente, só com o lead, e "refId"
--    aponta para tabelas diferentes, sem FK).
--
-- 2. "WorkAnexo": o anexo da tarefa. Filho de "WorkTask" no desenho de
--    "WorkApontamento": "orgId" com a sentinela '' e o gatilho
--    "WorkAnexo_orgId_do_pai", que deriva a empresa da tarefa e RECUSA anexo de
--    uma empresa pendurado em tarefa de outra. A função é a de
--    `20260910120000_orgid_em_todo_filho` e não é redefinida aqui. A tabela
--    entra em FILHOS_COM_ORGID_REDUNDANTE (src/common/modelos-globais.ts).
--
-- Isolamento por linha nas duas: o grupo padrão, GRANT condicional para
-- mktos_app e conferência local no fim (falha alta de propósito).
--
-- CAMINHO DE VOLTA (perde os registros de anexo e de arquivo; os binários
-- continuam no storage, com a chave "trabalho/anexos/..." e "clientes/arquivos/..."):
--   DROP TABLE "WorkAnexo";
--   DROP TABLE "ArquivoDoCliente";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021330000_arquivo_do_cliente_e_anexo';
-- ============================================================================

CREATE TABLE "ArquivoDoCliente" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "partnerId" TEXT,
    "leadId" TEXT,
    "origem" TEXT NOT NULL,
    "nomeOriginal" TEXT NOT NULL,
    "tipoMime" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "subpasta" TEXT,
    "nome" TEXT,
    "tipo" TEXT,
    "titulo" TEXT,
    "confianca" DOUBLE PRECISION,
    "estado" TEXT NOT NULL DEFAULT 'na_fila',
    "motivo" TEXT,
    "approvalId" TEXT,
    "pendenciaId" TEXT,
    "driveArquivoId" TEXT,
    "driveUrl" TEXT,
    "atorId" TEXT,
    "refTipo" TEXT,
    "refId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArquivoDoCliente_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ArquivoDoCliente_estado_check"
      CHECK ("estado" IN ('na_fila', 'aguardando_aprovacao', 'enviado', 'classificar_a_mao', 'so_no_os', 'erro')),
    CONSTRAINT "ArquivoDoCliente_sha256_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "ArquivoDoCliente_bytes_check" CHECK ("bytes" > 0),
    CONSTRAINT "ArquivoDoCliente_subpasta_check" CHECK (
      "subpasta" IS NULL OR "subpasta" IN (
        '01-comercial', '02-contrato', '03-kickoff', '04-entrega', '05-acompanhamento',
        '06-financeiro', '07-evidencias', '99-arquivo', '_fonte'
      )
    ),
    -- Arquivo sem cliente e sem lead não entra na fila: fica só no OS e não é registrado aqui.
    CONSTRAINT "ArquivoDoCliente_dono_check" CHECK ("partnerId" IS NOT NULL OR "leadId" IS NOT NULL)
);

CREATE INDEX "ArquivoDoCliente_orgId_partnerId_estado_idx" ON "ArquivoDoCliente"("orgId", "partnerId", "estado");
CREATE INDEX "ArquivoDoCliente_orgId_leadId_estado_idx" ON "ArquivoDoCliente"("orgId", "leadId", "estado");
CREATE INDEX "ArquivoDoCliente_orgId_refTipo_refId_idx" ON "ArquivoDoCliente"("orgId", "refTipo", "refId");
CREATE INDEX "ArquivoDoCliente_orgId_approvalId_idx" ON "ArquivoDoCliente"("orgId", "approvalId");

ALTER TABLE "ArquivoDoCliente" ADD CONSTRAINT "ArquivoDoCliente_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

SELECT app_rls_aplicar_policies(
  'ArquivoDoCliente',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "ArquivoDoCliente" TO mktos_app';
  END IF;
END $$;

CREATE TABLE "WorkAnexo" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "taskId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipoMime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "autorId" TEXT,
    "autorNome" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkAnexo_pkey" PRIMARY KEY ("id"),
    -- O teto do anexo (10 MB, o corte do proxy do Next) também no banco.
    CONSTRAINT "WorkAnexo_bytes_check" CHECK ("bytes" BETWEEN 1 AND 10485760),
    CONSTRAINT "WorkAnexo_sha256_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "WorkAnexo_taskId_criadoEm_idx" ON "WorkAnexo"("taskId", "criadoEm");
CREATE INDEX "WorkAnexo_orgId_criadoEm_idx" ON "WorkAnexo"("orgId", "criadoEm");

ALTER TABLE "WorkAnexo" ADD CONSTRAINT "WorkAnexo_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkAnexo" ADD CONSTRAINT "WorkAnexo_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A empresa do anexo é a da tarefa.
CREATE TRIGGER "WorkAnexo_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "WorkAnexo"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('WorkTask', 'taskId');

SELECT app_rls_aplicar_policies(
  'WorkAnexo',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "WorkAnexo" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: as duas tabelas com RLS, FORCE e as quatro policies, e o
-- gatilho do filho. Falha ALTA de propósito.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alvo text;
  ok   boolean;
BEGIN
  FOREACH alvo IN ARRAY ARRAY['ArquivoDoCliente', 'WorkAnexo', 'WorkTask'] LOOP
    SELECT c.relrowsecurity
       AND c.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
      INTO ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = alvo;

    IF NOT COALESCE(ok, false) THEN
      RAISE EXCEPTION
        '% ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.', alvo;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'WorkAnexo_orgId_do_pai' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'WorkAnexo sem o gatilho que confere a empresa da tarefa.';
  END IF;
END $$;
