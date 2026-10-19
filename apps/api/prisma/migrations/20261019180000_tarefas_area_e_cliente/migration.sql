-- Tarefas de todas as áreas num lugar só, sem card repetido (19/10/2026).
--
-- Três marcas resolvem a duplicação que o Trabalho tinha:
--   1. WorkList.natureza: a lista guarda TAREFAS ou CADASTRO (lead, cliente,
--      contrato, peça de conteúdo, esteira). Cadastro nunca aparece como tarefa.
--   2. WorkTask.areaId: cada tarefa tem UMA área. Cliente não é área.
--   3. WorkTask.clienteId: a tarefa aponta para o card do cliente, não o copia.
-- As chaves estrangeiras são compostas com orgId: área ou cliente de outra
-- empresa não pendura (mesmo padrão das relações do Trabalho).

CREATE TYPE "WorkListaNatureza" AS ENUM ('tarefas', 'cadastro');

CREATE TABLE "WorkArea" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "cor" TEXT NOT NULL DEFAULT '#8b8d98',
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkArea_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkArea_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkArea_nome_check" CHECK (length(btrim("nome")) BETWEEN 1 AND 60)
);
CREATE UNIQUE INDEX "WorkArea_orgId_nome_key" ON "WorkArea"("orgId", "nome");
CREATE UNIQUE INDEX "WorkArea_id_orgId_key" ON "WorkArea"("id", "orgId");

ALTER TABLE "WorkList"
  ADD COLUMN "natureza" "WorkListaNatureza" NOT NULL DEFAULT 'tarefas',
  ADD COLUMN "areaPadraoId" TEXT;
CREATE UNIQUE INDEX "WorkList_id_orgId_key" ON "WorkList"("id", "orgId");
ALTER TABLE "WorkList" ADD CONSTRAINT "WorkList_areaPadraoId_orgId_fkey"
  FOREIGN KEY ("areaPadraoId", "orgId") REFERENCES "WorkArea"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "WorkTask"
  ADD COLUMN "areaId" TEXT,
  ADD COLUMN "clienteId" TEXT;
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_areaId_orgId_fkey"
  FOREIGN KEY ("areaId", "orgId") REFERENCES "WorkArea"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_clienteId_orgId_fkey"
  FOREIGN KEY ("clienteId", "orgId") REFERENCES "WorkTask"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_cliente_nao_e_ela_mesma" CHECK ("clienteId" IS NULL OR "clienteId" <> "id");
CREATE INDEX "WorkTask_orgId_areaId_archived_idx" ON "WorkTask"("orgId", "areaId", "archived");
CREATE INDEX "WorkTask_orgId_clienteId_idx" ON "WorkTask"("orgId", "clienteId");

ALTER TABLE "WorkArea" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkArea" FORCE ROW LEVEL SECURITY;
SELECT public.app_rls_aplicar_policies('WorkArea',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,true,true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON "WorkArea" TO mktos_app;
  END IF;
END $$;

-- O que já existe e é cadastro, pela chave (não pelo nome, que muda):
--   crm-root-lista      cards de lead/cliente (Comercial)
--   crm-root-contratos  contratos dos clientes
--   901327640001        Gestão de Temas do Lucas Creator (ClickUp)
--   901328341442        Gestão de Temas da ROOT (ClickUp)
-- e, sem chave, as listas criadas pelo modelo "Esteira de clientes" e as
-- etapas de conteúdo importadas do ClickUp (cada card é uma peça).
UPDATE "WorkList" SET "natureza" = 'cadastro'
 WHERE "externalId" IN ('crm-root-lista', 'crm-root-contratos', '901327640001', '901328341442',
                        '901328341443', '901328341445', '901328341450', '901328341456', '901328341455',
                        '901327689453', '901328200144', '901327689465', '901327689469', '901327689476')
    OR btrim("name") IN ('Esteira de clientes', 'Gestão de Temas', 'Copy', 'Design & Gravação',
                         'Calendário de conteúdo', 'Rotina de stories', 'Análise');

-- Tarefa feita pela ficha do cliente já aponta para ele como subtarefa
-- (parentId). Passa a apontar também por clienteId, que é o que a visão de
-- todas as tarefas lê. A ficha continua funcionando como antes.
UPDATE "WorkTask" t
   SET "clienteId" = t."parentId"
  FROM "WorkTask" p, "WorkList" lp, "WorkList" lt
 WHERE p."id" = t."parentId" AND p."orgId" = t."orgId"
   AND lp."id" = p."listId" AND lp."natureza" = 'cadastro'
   AND lt."id" = t."listId" AND lt."natureza" = 'tarefas'
   AND t."clienteId" IS NULL;
