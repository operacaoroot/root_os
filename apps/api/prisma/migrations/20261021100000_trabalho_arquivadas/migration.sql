-- Rodada de produção 1 (21/10/2026): pasta e lista podem sair do Trabalho sem sair do banco.
-- Aditiva: uma coluna nula em cada tabela. As duas já têm RLS FORCE (migration do isolamento
-- por linha) e as políticas delas valem para a coluna nova. Arquivada = fora da árvore, de
-- Todas e dos contadores; os dados (e as tarefas arquivadas da lista) ficam.
ALTER TABLE "WorkFolder" ADD COLUMN IF NOT EXISTS "arquivadaEm" TIMESTAMP(3);
ALTER TABLE "WorkList" ADD COLUMN IF NOT EXISTS "arquivadaEm" TIMESTAMP(3);
