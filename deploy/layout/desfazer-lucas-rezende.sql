-- DESFAZ a junção de "Lucas da Guiando" em "Lucas Rezende" (26/10/2026), pelo diário, de trás para frente.
-- Só volta o que ainda está como o script deixou. Rodar com: psql -v ON_ERROR_STOP=1 -1 -f desfazer-lucas-rezende.sql
DO $$
DECLARE d record;
BEGIN
  IF to_regclass('"_diario_lucas_rezende_20261026"') IS NULL THEN RAISE NOTICE 'sem diário: nada a desfazer'; RETURN; END IF;
  FOR d IN SELECT * FROM "_diario_lucas_rezende_20261026" ORDER BY seq DESC LOOP
    IF d.tabela = 'Partner' THEN
      UPDATE "Partner" SET ativo = true, "principalId" = NULL WHERE id = d.registro AND NOT ativo;
    ELSE
      EXECUTE format('UPDATE %I SET %I = $1 WHERE id = $2 AND %I = $3', d.tabela, d.coluna, d.coluna) USING d.antes, d.registro, d.depois;
    END IF;
  END LOOP;
  EXECUTE format('ALTER TABLE "_diario_lucas_rezende_20261026" RENAME TO %I', '_diario_lucas_rezende_20261026_desfeito_' || to_char(now(), 'YYYYMMDDHH24MISS'));
END $$;
