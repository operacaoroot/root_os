-- Rodada da implantação I1 (18/10/2026): o card nasce do fechamento.
-- Aditiva: uma coluna nula na ficha do comercial. A tabela já tem RLS FORCE
-- (migration do isolamento por linha) e a política dela vale para a coluna nova.
ALTER TABLE "ComercialFicha" ADD COLUMN "cardId" TEXT;
