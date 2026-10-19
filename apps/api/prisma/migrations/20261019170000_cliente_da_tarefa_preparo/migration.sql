-- ============================================================================
-- PREPARO DA CONCILIAÇÃO DO CLIENTE DA TAREFA · Versão final (19/10/2026)
--
-- Só age num ponto de partida: a homologação que já aplicou a versão antiga de
-- `20261019100000_tarefa_do_cliente` (coluna `WorkTask.clienteId` com FK para
-- `Partner`). Ali, a migration do Lucas que vem a seguir
-- (`20261019180000_tarefas_area_e_cliente`, aplicada em produção e por isso
-- intocável) faria `ADD COLUMN "clienteId"` e quebraria. O preparo põe a coluna
-- nossa de lado, com outro nome, e a conciliação
-- (`20261019230000_conciliacao_cliente_da_tarefa`) a traz de volta como a verdade.
--
-- Na produção a coluna já é a do Lucas (FK para WorkTask) e num banco novo ela
-- ainda não existe: nos dois casos esta migration não faz nada.
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_class r ON r.oid = c.confrelid
     WHERE c.contype = 'f' AND t.relname = 'WorkTask' AND r.relname = 'Partner'
       AND c.conname = 'WorkTask_clienteId_fkey'
  ) THEN
    DROP TRIGGER IF EXISTS "WorkTask_orgId_confere_cliente" ON "WorkTask";
    ALTER TABLE "WorkTask" DROP CONSTRAINT "WorkTask_clienteId_fkey";
    DROP INDEX IF EXISTS "WorkTask_orgId_clienteId_idx";
    ALTER TABLE "WorkTask" RENAME COLUMN "clienteId" TO "clienteIdParceiro";
  END IF;
END $$;
