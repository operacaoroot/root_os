-- A tarefa do lead (adendo da rodada de produção 1, 21/10/2026).
--
-- A lista "Comercial" do Trabalho vai para o Comercial: a tarefa que cita um lead
-- passa a APONTAR para ele (painel do lead e cartão do funil), e a que não cita
-- fica como tarefa do comercial sem lead. A tarefa continua sendo WorkTask (mesma
-- tela de edição, mesmo Dia a dia); só ganha o ponteiro.
--
-- Chave composta com orgId, como área e cliente: lead de outra empresa não pendura.
-- RESTRICT: lead com tarefa não se apaga por baixo (o lead já não se apaga com fio).
-- WorkTask já tem RLS FORCE; coluna nula, nenhuma linha muda.

ALTER TABLE "WorkTask" ADD COLUMN "leadId" TEXT;
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_leadId_orgId_fkey"
  FOREIGN KEY ("leadId", "orgId") REFERENCES "Lead"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "WorkTask_orgId_leadId_idx" ON "WorkTask"("orgId", "leadId");
