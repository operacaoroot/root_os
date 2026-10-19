-- Vários responsáveis por tarefa (19/10/2026), como no ClickUp. O primeiro
-- continua em "assigneeUserId" (caixa, agenda e checkout leem ele); os demais
-- ficam aqui. A tarefa continua UMA: no quadro por pessoa ela aparece na coluna
-- do primeiro, com os outros nomes no card.
ALTER TABLE "WorkTask" ADD COLUMN "outrosResponsaveisIds" TEXT[] NOT NULL DEFAULT '{}';
