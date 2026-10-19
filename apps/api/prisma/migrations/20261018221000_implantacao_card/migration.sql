-- Rodada da implantação I1 (18/10/2026): o card nasce do fechamento.
-- Aditiva: uma coluna nula na ficha do comercial. A tabela já tem RLS FORCE
-- (migration do isolamento por linha) e a política dela vale para a coluna nova.
--
-- Versão final (19/10/2026): renomeada de 20261018220000_implantacao_card, que dividia o
-- carimbo com a 20261018220000_conta_custo_fixo da produção (ordem de aplicação indefinida).
-- Nunca foi aplicada em produção; nas homologações que já a aplicaram com o nome antigo,
-- o IF NOT EXISTS a torna inócua.
ALTER TABLE "ComercialFicha" ADD COLUMN IF NOT EXISTS "cardId" TEXT;
