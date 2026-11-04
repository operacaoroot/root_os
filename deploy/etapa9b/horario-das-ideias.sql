-- Etapa 9b (#3, pedido do Lucas em 04/11/2026): as ideias chegam de manhã cedo.
-- A coleta passa das 22h para as 5h e a IA das ideias das 23h para as 6h (horário de São Paulo).
-- Só muda o horário das duas rotinas; o antes vai para o diário. Rodar uma vez, numa transação.
BEGIN;
CREATE TABLE IF NOT EXISTS "_diario_etapa9b_20261104" (seq serial PRIMARY KEY, tabela text, linha text, coluna text, antes text, depois text, em timestamptz DEFAULT now());
INSERT INTO "_diario_etapa9b_20261104" (tabela, linha, coluna, antes, depois)
  SELECT 'Rotina', id, 'cron', cron, CASE tipo WHEN 'pauta.coleta' THEN '0 5 * * *' ELSE '0 6 * * *' END
  FROM "Rotina" WHERE slug IN ('coleta-semanal-da-pauta', 'marketing-ideias-ia') AND cron IN ('0 22 * * *', '0 23 * * *');
UPDATE "Rotina" r SET
  cron = d.depois,
  -- A próxima execução: o próximo 5h (ou 6h) de São Paulo a partir de agora.
  "proximaExecucaoEm" = (
    CASE WHEN (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + (split_part(d.depois, ' ', 2) || ' hours')::interval) > (now() AT TIME ZONE 'America/Sao_Paulo')
      THEN date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + (split_part(d.depois, ' ', 2) || ' hours')::interval
      ELSE date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day' + (split_part(d.depois, ' ', 2) || ' hours')::interval
    END
  ) AT TIME ZONE 'America/Sao_Paulo'
FROM "_diario_etapa9b_20261104" d
WHERE d.tabela = 'Rotina' AND d.coluna = 'cron' AND d.linha = r.id AND r.cron = d.antes;
SELECT slug, cron, "proximaExecucaoEm" FROM "Rotina" WHERE slug IN ('coleta-semanal-da-pauta', 'marketing-ideias-ia');
COMMIT;
