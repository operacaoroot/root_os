-- ============================================================================
-- A ESTEIRA DE CLIENTES — o quadro de Trabalho vira kanban de verdade
--
-- Três coisas que faltavam para acompanhar clientes numa esteira
-- (Qualificação → Diagnóstico → Contrato → Onboarding → Implantação → Operação)
-- sem abrir um módulo paralelo ao de Trabalho:
--
--   1. `WorkStatus.limite`     — o limite de trabalho em andamento por etapa;
--   2. `WorkTask.statusDesde`  — desde quando a tarefa está na etapa atual;
--   3. `WorkApontamento`       — as horas de gente gastas em cada tarefa, com a
--                                etapa em que foram gastas.
--
-- ----------------------------------------------------------------------------
-- POR QUE ESTENDER O TRABALHO, E NÃO CRIAR UM MÓDULO `clientes`
-- ----------------------------------------------------------------------------
-- O Trabalho já tem etapas configuráveis por lista, campos personalizados,
-- comentários, auditoria, checkout de agente e isolamento por linha. Um módulo
-- de clientes à parte repetiria tudo isso numa segunda tabela de "cartões" — e
-- a empresa passaria a ter duas verdades sobre o que está em andamento. A
-- esteira é uma LISTA do Trabalho criada a partir de um modelo; o que ela
-- precisava e não existia é genérico o bastante para servir a qualquer lista.
--
-- ----------------------------------------------------------------------------
-- 1. O LIMITE AVISA, NÃO TRAVA
-- ----------------------------------------------------------------------------
-- Coluna anulável, sem valor padrão: toda etapa que já existe continua sem
-- limite. O CHECK só recusa o que não faz sentido (zero ou negativo). Passar do
-- limite é permitido e aparece marcado no quadro — ver o comentário do campo em
-- `schema.prisma`.
--
-- ----------------------------------------------------------------------------
-- 2. QUEM CARIMBA A ETAPA É O BANCO
-- ----------------------------------------------------------------------------
-- Três caminhos mudam `statusId` hoje: o PATCH do quadro (`work.service.ts`), o
-- checkout atômico (`checkout-de-tarefa.service.ts`, um `updateMany` que não
-- passa pelo serviço do quadro) e a semente (`seed-trabalho.ts`). Uma regra no
-- serviço seria esquecida no primeiro que não passa por ele; um gatilho não.
--
-- A coluna NÃO ganha `DEFAULT now()`, e é de propósito: `ADD COLUMN ... DEFAULT
-- now()` preencheria todas as tarefas existentes com o instante desta
-- migration, e o quadro abriria dizendo que tudo entrou na etapa hoje. Tarefa
-- antiga fica nula, e nulo quer dizer "não sabemos" — a tela não inventa.
--
-- Na inserção, valor informado é respeitado (uma importação pode trazer a data
-- real); ausente vira `now()`. Na alteração, só a TROCA de etapa carimba:
-- editar título, prazo ou responsável não reinicia a idade do cartão.
--
-- ----------------------------------------------------------------------------
-- 3. AS HORAS SÃO FILHAS DA TAREFA, COM EMPRESA CONFERIDA NO BANCO
-- ----------------------------------------------------------------------------
-- Mesmo desenho de `WorkComment`: `orgId` com a sentinela `''` e o gatilho
-- `WorkApontamento_orgId_do_pai`, que deriva a empresa da tarefa e RECUSA
-- apontamento de uma empresa pendurado em tarefa de outra. A função é a de
-- `20260910120000_orgid_em_todo_filho` e não é redefinida aqui.
--
-- `etapa` é texto (o nome da etapa no lançamento), não chave estrangeira: a
-- soma por etapa tem de sobreviver a etapa renomeada ou apagada. Por isso não
-- há segundo pai a conferir.
--
-- Isolamento por linha: `app_rls_aplicar_policies` com as expressões do grupo
-- padrão, GRANT condicional para `mktos_app` e conferência local no fim. A
-- tabela entra também em `FILHOS_COM_ORGID_REDUNDANTE`
-- (`src/common/modelos-globais.ts`) e no registro da suíte de isolamento.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   DROP TABLE "WorkApontamento";
--   DROP TRIGGER "WorkTask_statusDesde" ON "WorkTask";
--   DROP FUNCTION mktos_carimba_etapa();
--   ALTER TABLE "WorkTask" DROP COLUMN "statusDesde";
--   ALTER TABLE "WorkStatus" DROP COLUMN "limite";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260917010000_esteira_de_clientes';
--
-- A volta PERDE as horas apontadas. Exporte `WorkApontamento` antes.
-- ============================================================================

-- AlterTable: o limite de trabalho em andamento por etapa
ALTER TABLE "WorkStatus" ADD COLUMN "limite" INTEGER;
ALTER TABLE "WorkStatus"
  ADD CONSTRAINT "WorkStatus_limite_positivo" CHECK ("limite" IS NULL OR "limite" > 0);

-- AlterTable: desde quando a tarefa está na etapa atual (nulo nas existentes)
ALTER TABLE "WorkTask" ADD COLUMN "statusDesde" TIMESTAMP(3);

-- CreateFunction + CreateTrigger: o banco carimba a entrada na etapa
CREATE OR REPLACE FUNCTION mktos_carimba_etapa() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."statusDesde" IS NULL THEN
      NEW."statusDesde" := now();
    END IF;
  ELSIF NEW."statusId" IS DISTINCT FROM OLD."statusId" THEN
    NEW."statusDesde" := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp;

COMMENT ON FUNCTION mktos_carimba_etapa() IS
  'Carimba WorkTask.statusDesde na inserção e em toda troca de statusId (migration 20260917010000_esteira_de_clientes).';

CREATE TRIGGER "WorkTask_statusDesde"
  BEFORE INSERT OR UPDATE ON "WorkTask"
  FOR EACH ROW EXECUTE FUNCTION mktos_carimba_etapa();

-- CreateTable: as horas apontadas
CREATE TABLE "WorkApontamento" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "taskId" TEXT NOT NULL,
    "autorId" TEXT,
    "autorNome" TEXT NOT NULL,
    "minutos" INTEGER NOT NULL,
    "dia" DATE NOT NULL,
    "etapa" TEXT NOT NULL,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkApontamento_pkey" PRIMARY KEY ("id"),
    -- Um dia tem 1440 minutos. Lançamento maior que isso é erro de digitação
    -- (horas digitadas como minutos, ou o contrário), não trabalho.
    CONSTRAINT "WorkApontamento_minutos_no_dia" CHECK ("minutos" BETWEEN 1 AND 1440)
);

-- CreateIndex
CREATE INDEX "WorkApontamento_taskId_dia_idx" ON "WorkApontamento"("taskId", "dia");
CREATE INDEX "WorkApontamento_orgId_dia_idx" ON "WorkApontamento"("orgId", "dia");

-- AddForeignKey
ALTER TABLE "WorkApontamento" ADD CONSTRAINT "WorkApontamento_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkApontamento" ADD CONSTRAINT "WorkApontamento_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTrigger: a empresa do apontamento é a da tarefa
CREATE TRIGGER "WorkApontamento_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "WorkApontamento"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('WorkTask', 'taskId');

-- Isolamento por linha: o grupo padrão
SELECT app_rls_aplicar_policies(
  'WorkApontamento',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "WorkApontamento" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL
--
-- (a) a tabela nova tem RLS, FORCE e as quatro policies; (b) `WorkTask` e
-- `WorkStatus` continuam isoladas — um rebase mal resolvido que tivesse
-- desfeito o isolamento delas apareceria aqui, e não em produção; (c) os dois
-- gatilhos existem. Falha ALTA de propósito.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alvo text;
  ok   boolean;
BEGIN
  FOREACH alvo IN ARRAY ARRAY['WorkApontamento', 'WorkTask', 'WorkStatus'] LOOP
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

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'WorkApontamento_orgId_do_pai' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'WorkApontamento sem o gatilho que confere a empresa da tarefa.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'WorkTask_statusDesde' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'WorkTask sem o gatilho que carimba a entrada na etapa.';
  END IF;
END $$;
