-- Cockpit do lead (revisão A-4, 13/10/2026): a data de volta da geladeira decidida pela fila.
--
-- ADITIVA: uma coluna anulável na `ComercialConfig`, que já tem isolamento por
-- linha (migration 20261013000000_cockpit_comercial). Nulo é [a decidir]: a
-- geladeira decidida pela fila nasce sem data e a próxima ação pede a data a
-- uma pessoa. Nenhum número entra por padrão.
--
-- Rollback: ALTER TABLE "ComercialConfig" DROP COLUMN "geladeiraVoltaDias";

ALTER TABLE "ComercialConfig" ADD COLUMN "geladeiraVoltaDias" INTEGER;
