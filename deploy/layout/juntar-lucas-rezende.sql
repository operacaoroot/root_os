-- JUNTA "Lucas da Guiando" em "Lucas Rezende" (mesma pessoa, pedido do Lucas em 26/10/2026).
-- Move toda referência ao cadastro duplicado para o principal e DESLIGA o duplicado (ativo = false,
-- principalId = Lucas Rezende). Nada é apagado. Cada mudança vai ao diário; desfazer-lucas-rezende.sql volta.
-- O texto dos acordos (que casa o extrato) não muda: só o vínculo.
-- Rodar com: psql -v ON_ERROR_STOP=1 -1 -f juntar-lucas-rezende.sql

CREATE TABLE IF NOT EXISTS "_diario_lucas_rezende_20261026" (
  seq serial PRIMARY KEY, em timestamptz NOT NULL DEFAULT now(),
  tabela text NOT NULL, coluna text NOT NULL, registro text NOT NULL, antes text, depois text
);

DO $$
DECLARE
  dup text; principal text; org text; r record; t text; c text;
BEGIN
  SELECT id, "orgId" INTO dup, org FROM "Partner" WHERE "razaoSocial" = 'Lucas da Guiando' AND ativo LIMIT 1;
  IF dup IS NULL THEN RAISE NOTICE 'Lucas da Guiando já junto (ou não existe): nada a fazer'; RETURN; END IF;
  SELECT id INTO principal FROM "Partner" WHERE "orgId" = org AND "razaoSocial" = 'Lucas Rezende' AND ativo LIMIT 1;
  IF principal IS NULL THEN RAISE EXCEPTION 'cadastro Lucas Rezende não encontrado'; END IF;

  -- toda coluna que aponta para um cadastro de cliente
  FOR t, c IN SELECT * FROM (VALUES
    ('AcordoComercial', 'partnerId'), ('ArquivoDoCliente', 'partnerId'), ('ComercialFicha', 'partnerId'),
    ('Contract', 'partnerId'), ('FinanceTransaction', 'partnerId'),
    ('WhatsAppConversa', 'clienteId'), ('WhatsAppMensagem', 'clienteId'), ('WorkTask', 'clienteId')
  ) AS v(t, c) LOOP
    FOR r IN EXECUTE format('SELECT id FROM %I WHERE %I = $1', t, c) USING dup LOOP
      EXECUTE format('UPDATE %I SET %I = $1 WHERE id = $2', t, c) USING principal, r.id;
      INSERT INTO "_diario_lucas_rezende_20261026" (tabela, coluna, registro, antes, depois) VALUES (t, c, r.id, dup, principal);
    END LOOP;
  END LOOP;

  UPDATE "Partner" SET ativo = false, "principalId" = principal WHERE id = dup;
  INSERT INTO "_diario_lucas_rezende_20261026" (tabela, coluna, registro, antes, depois) VALUES ('Partner', 'ativo+principalId', dup, 'true|', 'false|' || principal);
END $$;

SELECT tabela, coluna, count(*) FROM "_diario_lucas_rezende_20261026" GROUP BY 1, 2 ORDER BY 1;
