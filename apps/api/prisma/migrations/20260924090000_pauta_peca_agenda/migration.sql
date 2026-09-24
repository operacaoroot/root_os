-- ============================================================================
-- MC16 — O CALENDÁRIO DA SEMANA E A POSTAGEM COM UM TOQUE
--
-- `agendadaPara`: o slot da semana em que a peça aprovada vai ao ar (instante
-- em UTC; a grade da empresa é lida no fuso de São Paulo). Nulo = fora da
-- agenda. A peça que deixa de estar aprovada sai da agenda (a API zera).
--
-- `urlPublicada`: o endereço público do post. "Marcar como postada" é registro
-- INTERNO — reaproveita status `publicada`, `publicadaEm` e `publicadaPor`, com
-- `externalId` nulo; o id na rede fica para a publicação automática (MC17).
--
-- Colunas novas numa tabela que já tem RLS com FORCE e policies (migration
-- 20260911050000_isolamento_por_linha): a proteção por linha vale para elas
-- sem mudar nada.
-- ============================================================================

ALTER TABLE "PautaPeca" ADD COLUMN     "agendadaPara" TIMESTAMP(3),
ADD COLUMN     "urlPublicada" TEXT;

-- A semana da agenda lê por empresa e intervalo de datas.
CREATE INDEX "PautaPeca_orgId_agendadaPara_idx" ON "PautaPeca"("orgId", "agendadaPara");
