-- ============================================================================
-- MD1 — O ENCADEAMENTO DA TRANSCRIÇÃO À SEMANA EM RASCUNHO
--
-- `slotProposto`: o slot da grade que a rotina `pauta.encadear` propôs para a
-- peça da semana ainda em RASCUNHO. Não é agenda: `agendadaPara` continua só da
-- peça aprovada, e aprovar pelo PATCH de status não converte um no outro.
-- Refazer a mídia e derivar de novo zeram o slot (a API zera).
--
-- Coluna nova numa tabela que já tem RLS com FORCE e policies (migration
-- 20260911050000_isolamento_por_linha): a proteção por linha vale para ela
-- sem mudar nada.
-- ============================================================================

ALTER TABLE "PautaPeca" ADD COLUMN     "slotProposto" TIMESTAMP(3);

-- A colisão entre episódios e a semana da agenda leem por empresa e intervalo.
CREATE INDEX "PautaPeca_orgId_slotProposto_idx" ON "PautaPeca"("orgId", "slotProposto");
