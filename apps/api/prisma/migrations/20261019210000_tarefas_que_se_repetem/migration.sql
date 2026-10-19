-- Tarefas que se repetem (19/10/2026), no molde do ClickUp: a regra mora na
-- tarefa; ao concluir, nasce a próxima ocorrência com o prazo seguinte. A série
-- (id da primeira) liga as ocorrências e impede duas abertas ao mesmo tempo.
ALTER TABLE "WorkTask" ADD COLUMN "recorrencia" JSONB, ADD COLUMN "serieId" TEXT;
CREATE INDEX "WorkTask_orgId_serieId_idx" ON "WorkTask"("orgId", "serieId");
