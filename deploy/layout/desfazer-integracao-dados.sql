-- DESFAZ os dados da integração do cliente (26/10/2026), lendo o diário de trás para frente.
-- Só volta o que ainda está como o script deixou: se alguém mudou depois, aquela linha fica e aparece no aviso.
-- Rodar com: psql -v ON_ERROR_STOP=1 -1 -f desfazer-integracao-dados.sql

DO $$
DECLARE
  d record;
  n int;
BEGIN
  IF to_regclass('"_diario_integracao_20261026"') IS NULL THEN RAISE NOTICE 'sem diário: nada a desfazer'; RETURN; END IF;
  FOR d IN SELECT * FROM "_diario_integracao_20261026" ORDER BY seq DESC LOOP
    IF d.acao = 'update' AND d.tabela = 'AcordoComercial' AND d.coluna = 'partnerId' THEN
      UPDATE "AcordoComercial" SET "partnerId" = d.antes WHERE id = d.registro AND "partnerId" IS NOT DISTINCT FROM d.depois;
    ELSIF d.acao = 'update' AND d.tabela = 'Partner' AND d.coluna = 'principalId' THEN
      UPDATE "Partner" SET "principalId" = d.antes WHERE id = d.registro AND "principalId" IS NOT DISTINCT FROM d.depois;
    ELSIF d.acao = 'update' AND d.tabela = 'WorkTask' AND d.coluna = 'lixeira' THEN
      -- volta da Lixeira só se ainda está lá desde o script (ninguém restaurou nem mexeu depois)
      UPDATE "WorkTask" SET archived = d.antes::boolean, "excluidaEm" = NULL, "excluidaPor" = NULL
        WHERE id = d.registro AND to_char("excluidaEm", 'YYYY-MM-DD"T"HH24:MI:SS') = d.depois;
    ELSIF d.acao = 'insert' AND d.tabela = 'AcordoComercial' THEN
      DELETE FROM "AcordoComercial" WHERE id = d.registro;
    ELSIF d.acao = 'insert' AND d.tabela = 'Partner' THEN
      -- cadastro criado pelo script: só sai se nada novo passou a depender dele (título, conversa, acordo de outra pessoa)
      IF EXISTS (SELECT 1 FROM "AcordoComercial" WHERE "partnerId" = d.registro)
         OR EXISTS (SELECT 1 FROM "WhatsAppConversa" WHERE "clienteId" = d.registro) THEN
        RAISE NOTICE 'cadastro % (%) ficou: algo novo está ligado a ele', d.depois, d.registro;
        CONTINUE;
      END IF;
      BEGIN
        DELETE FROM "Partner" WHERE id = d.registro;
      EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'cadastro % (%) ficou: já tem lançamentos ligados', d.depois, d.registro;
        CONTINUE;
      END;
    ELSE
      RAISE EXCEPTION 'linha do diário que não sei desfazer: %', d.seq;
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN RAISE NOTICE 'diário %: % % mudou depois, ficou como está', d.seq, d.tabela, d.registro; END IF;
  END LOOP;
  EXECUTE format('ALTER TABLE "_diario_integracao_20261026" RENAME TO %I', '_diario_integracao_20261026_desfeito_' || to_char(now(), 'YYYYMMDDHH24MISS'));
END $$;
