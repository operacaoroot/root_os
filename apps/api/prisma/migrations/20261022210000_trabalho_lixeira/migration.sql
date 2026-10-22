-- Rodada de produção 3, I2 (22/10/2026): a Lixeira do Trabalho.
-- Aditiva: duas colunas nulas em "WorkTask" e um índice. A tabela já tem RLS FORCE
-- (migration do isolamento por linha) e as políticas dela valem para as colunas novas.
-- Excluída = fora de toda listagem (quadro, Todas, Dia a dia, contadores, Implantação,
-- busca, agenda, caixa); a tarefa fica no banco, na Lixeira, e pode ser restaurada.
-- "excluidaPor" guarda o id do usuário (da mesma empresa; não é chave estrangeira,
-- para que apagar uma conta nunca leve a tarefa junto nem seja barrado por ela).
ALTER TABLE "WorkTask" ADD COLUMN IF NOT EXISTS "excluidaEm" TIMESTAMP(3);
ALTER TABLE "WorkTask" ADD COLUMN IF NOT EXISTS "excluidaPor" TEXT;
CREATE INDEX IF NOT EXISTS "WorkTask_orgId_excluidaEm_idx" ON "WorkTask"("orgId", "excluidaEm");
