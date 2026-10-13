-- Cockpit do lead (lane E, fase 2, 13/10/2026): os dois números do vigia das 08:00.
--
-- ADITIVA: duas colunas anuláveis na `ComercialConfig`, que já tem isolamento por
-- linha (migration 20261013000000_cockpit_comercial). Nulo é [a decidir] e a
-- premissa fica desligada; a homologação os preenche no seed, marcados.
--
-- Rollback: ALTER TABLE "ComercialConfig" DROP COLUMN "cobrancaSemWebhookDias", DROP COLUMN "efeitoRetidoHoras";

ALTER TABLE "ComercialConfig" ADD COLUMN "cobrancaSemWebhookDias" INTEGER;
ALTER TABLE "ComercialConfig" ADD COLUMN "efeitoRetidoHoras" INTEGER;
