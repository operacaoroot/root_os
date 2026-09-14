-- ============================================================================
-- A TAREFA GANHA DONO ÚNICO — fatia A4
--
-- Duas colunas em `WorkTask` (`agenteId`, `agenteEm`), a chave estrangeira para
-- `Agent`, um índice e UM GATILHO. Nenhuma tabela nova.
--
-- ----------------------------------------------------------------------------
-- POR QUE COLUNA NA TAREFA, E NÃO UMA TABELA DE "RESERVA"
-- ----------------------------------------------------------------------------
-- A alternativa considerada era uma tabela `ReservaDeTarefa(taskId único,
-- agenteId, desde)`, com a unicidade garantindo o dono único. Ela foi recusada
-- por um motivo concreto: com tabela à parte, "assumir" passa a ser DOIS
-- comandos (inserir a reserva e mover a tarefa), e existe um instante em que a
-- tarefa está em andamento sem reserva, ou reservada sem estar em andamento. O
-- checkout atômico da fatia é exatamente a inexistência desse instante.
--
-- Com a coluna na própria linha, o checkout é UMA instrução:
--
--   UPDATE "WorkTask" SET "agenteId" = $1, "agenteEm" = now()
--    WHERE "id" = $2 AND "orgId" = $3 AND "agenteId" IS NULL;
--
-- Duas transações concorrentes chegam nessa linha; a segunda espera o bloqueio
-- de linha da primeira, RE-AVALIA o `WHERE` depois do commit dela (READ
-- COMMITTED faz isso) e afeta ZERO linhas. Quem afetou zero perdeu a corrida —
-- e é dessa contagem que sai o 409. Nenhum `SELECT ... FOR UPDATE`, nenhum
-- nível de isolamento especial, nenhum bloqueio consultivo.
--
-- ----------------------------------------------------------------------------
-- O GATILHO: EMPRESA CRUZADA NÃO É PROBLEMA DA CHAVE ESTRANGEIRA
-- ----------------------------------------------------------------------------
-- `WorkTask.agenteId` referencia `Agent(id)` e mais nada. A FK aceita
-- perfeitamente uma tarefa da empresa A travada por um agente da empresa B — o
-- banco não guarda o par (agente, empresa) nessa coluna. E o Prisma NÃO filtra
-- relação para um dentro do `include`: `include: { agente: true }` traria o
-- nome de quem estiver do outro lado, de qualquer empresa. É a mesma armadilha
-- que `src/agents/donos-da-casa.ts` documenta para o dono humano.
--
-- Então a conferência vai para o banco, reusando a função que já existe desde
-- `20260910120000_orgid_em_todo_filho`: `mktos_orgid_do_pai('Agent',
-- 'agenteId')`. Como `WorkTask."orgId"` é NOT NULL e nunca é a sentinela `''`,
-- a função cai direto no ramo de CONFERÊNCIA — ela não deriva nada aqui, ela
-- RECUSA (ERRCODE 23514) a linha cujo agente é de outra empresa. Chave
-- estrangeira nula passa direto pelo ramo de FK opcional, que é o caso de toda
-- tarefa livre.
--
-- Do lado do código, quem resolve o NOME do agente é `src/work/agentes-da-casa.ts`,
-- com consulta escopada por empresa. As duas defesas são de propósito: o gatilho
-- impede a escrita errada, o ajudante impede a LEITURA errada de uma linha que
-- alguma migração antiga tenha deixado atravessada.
--
-- ----------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA
-- ----------------------------------------------------------------------------
-- Nada a ligar: `WorkTask` já tem `ENABLE` + `FORCE ROW LEVEL SECURITY` e as
-- quatro políticas (leitura e escrita separadas) desde
-- `20260911050000_isolamento_por_linha`. Acrescentar coluna não mexe em policy
-- — policy é por tabela. A conferência no fim deste arquivo PROVA isso em vez
-- de supor, e aborta se um rebase mal resolvido tiver desfeito o isolamento no
-- caminho. Ela também confere `Agent`, porque a FK nova torna as duas tabelas
-- um par: `WorkTask` protegida e `Agent` aberta deixaria uma empresa descobrir
-- os agentes da outra pelo caminho da tarefa.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   DROP TRIGGER "WorkTask_orgId_confere_agente" ON "WorkTask";
--   DROP INDEX "WorkTask_orgId_agenteId_agenteEm_idx";
--   ALTER TABLE "WorkTask" DROP CONSTRAINT "WorkTask_agenteId_fkey";
--   ALTER TABLE "WorkTask" DROP COLUMN "agenteEm", DROP COLUMN "agenteId";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260913030000_tarefa_com_dono_unico';
--
-- A volta PERDE o registro de quem estava com cada tarefa no momento da
-- reversão. As tarefas ficam todas livres, que é o lado seguro: tarefa livre
-- alguém assume de novo, tarefa travada por um dono que o esquema não conhece
-- mais não sai de lá.
-- ============================================================================

-- AlterTable: o dono único e a hora do checkout
--
-- Anuláveis, e nulo aqui quer dizer LIVRE — o estado de toda tarefa que já
-- existe. Preencher com qualquer agente faria o quadro abrir com centenas de
-- tarefas travadas por quem nunca as assumiu.
ALTER TABLE "WorkTask" ADD COLUMN "agenteId" TEXT;
ALTER TABLE "WorkTask" ADD COLUMN "agenteEm" TIMESTAMP(3);

-- AddForeignKey
--
-- `ON DELETE SET NULL`: agente apagado à mão solta as tarefas dele. `RESTRICT`
-- foi considerado e recusado — travaria o `DELETE` do agente com uma mensagem
-- do Postgres sobre constraint, e o desfecho que interessa (a tarefa não pode
-- ficar presa a um dono inexistente) é justamente o que `SET NULL` garante.
ALTER TABLE "WorkTask"
  ADD CONSTRAINT "WorkTask_agenteId_fkey"
  FOREIGN KEY ("agenteId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "WorkTask_orgId_agenteId_agenteEm_idx" ON "WorkTask"("orgId", "agenteId", "agenteEm");

-- CreateTrigger: a empresa do agente é conferida contra a da tarefa
--
-- A função é a de `20260910120000_orgid_em_todo_filho` e não é redefinida aqui:
-- redefini-la seria criar uma segunda versão da mesma regra, e a que ficasse
-- para trás é a que deixaria passar. O nome diz CONFERE (não "do pai") porque
-- `WorkTask` não deriva empresa de agente nenhum — ela já tem a sua.
CREATE TRIGGER "WorkTask_orgId_confere_agente"
  BEFORE INSERT OR UPDATE ON "WorkTask"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Agent', 'agenteId');

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — a função do gatilho existe de verdade
--
-- `CREATE TRIGGER` com função inexistente já falha, mas a mensagem do Postgres
-- não diz de onde a função deveria ter vindo. Esta confere ANTES, com o nome da
-- migration que a cria, porque quem topar com isso vai estar com um histórico
-- de migrations incompleto e precisa saber qual.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'mktos_orgid_do_pai' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION
      'A funcao mktos_orgid_do_pai() nao existe. Ela vem da migration 20260910120000_orgid_em_todo_filho; sem ela a tarefa aceita agente de outra empresa e a FK nao enxerga.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — o isolamento continua de pé nas DUAS tabelas do par
--
-- Falha ALTA de propósito. A coluna nova liga o quadro de trabalho do cliente
-- ao catálogo de agentes: sem policy em uma das duas, uma empresa lê pela
-- tarefa o que não pode ler pelo agente, ou trava a tarefa da vizinha.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t  text;
  ok boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['WorkTask', 'Agent'] LOOP
    SELECT c.relrowsecurity
       AND c.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
      INTO ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;

    IF NOT COALESCE(ok, false) THEN
      RAISE EXCEPTION
        '% esta sem isolamento por linha (rls/force/4 policies). A fatia A4 liga esta tabela a outra empresa pela coluna agenteId; sem policy isso e vazamento, nao pendencia.', t;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — nenhuma tarefa nasceu travada
--
-- O `ADD COLUMN` não preenche nada, então o esperado é zero. Se não for zero,
-- alguém acrescentou um backfill neste arquivo depois — e tarefa travada por um
-- agente que ninguém escolheu é trabalho que nenhum outro agente pode pegar.
-- Aborta: é mais barato recusar o deploy do que descobrir o quadro inteiro
-- parado.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  travadas bigint;
BEGIN
  SELECT count(*) INTO travadas FROM "WorkTask" WHERE "agenteId" IS NOT NULL;
  IF travadas > 0 THEN
    RAISE EXCEPTION
      '[A4] % tarefa(s) nasceram com agenteId preenchido. Esta migration nao preenche ninguem; tarefa travada por agente que ninguem escolheu fica invisivel para todos os outros.',
      travadas;
  END IF;
END $$;
