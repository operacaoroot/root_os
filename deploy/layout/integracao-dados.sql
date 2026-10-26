-- INTEGRAÇÃO DO CLIENTE (26/10/2026): os dados que ligam os acordos da Análise aos cadastros do Financeiro.
-- Só ACRESCENTA: preenche colunas novas que estavam vazias e cria o que falta. Nada que já tem valor é regravado.
-- Cada mudança fica no diário "_diario_integracao_20261026" (antes/depois), e desfazer-integracao-dados.sql
-- volta linha por linha. Rodar com: psql -v ON_ERROR_STOP=1 -1 -f integracao-dados.sql
-- Pode rodar de novo: o que já foi feito não é refeito.

CREATE TABLE IF NOT EXISTS "_diario_integracao_20261026" (
  seq      serial PRIMARY KEY,
  em       timestamptz NOT NULL DEFAULT now(),
  acao     text NOT NULL,          -- 'insert' | 'update'
  tabela   text NOT NULL,
  registro text NOT NULL,
  coluna   text,
  antes    text,
  depois   text
);

DO $$
DECLARE
  org text;
  p   text;
  a   text;
  r   record;
BEGIN
  SELECT "orgId" INTO org FROM "AcordoComercial" LIMIT 1;
  IF org IS NULL THEN RAISE EXCEPTION 'sem acordos: banco errado?'; END IF;
  IF (SELECT count(DISTINCT "orgId") FROM "AcordoComercial") > 1 THEN RAISE EXCEPTION 'mais de uma empresa: pare e confira'; END IF;

  -- 1. Clientes que existem nos acordos mas não têm cadastro: cria o cadastro (cliente, ativo).
  FOR r IN SELECT * FROM (VALUES ('Dispropan'), ('Lucas da Guiando'), ('Lucas Rezende')) AS t(nome) LOOP
    IF NOT EXISTS (SELECT 1 FROM "Partner" WHERE "orgId" = org AND lower("razaoSocial") = lower(r.nome)) THEN
      INSERT INTO "Partner" (id, "orgId", "isCliente", "razaoSocial", "updatedAt")
      VALUES (gen_random_uuid()::text, org, true, r.nome, now()) RETURNING id INTO p;
      INSERT INTO "_diario_integracao_20261026" (acao, tabela, registro, depois) VALUES ('insert', 'Partner', p, r.nome);
    END IF;
  END LOOP;

  -- 2. Lucas Rezende: o acordo de parceria (Imersão ROOT, R$ 12 mil), como o Lucas informou em 26/10.
  IF NOT EXISTS (SELECT 1 FROM "AcordoComercial" WHERE "orgId" = org AND lower(cliente) = 'lucas rezende') THEN
    INSERT INTO "AcordoComercial" (id, "orgId", cliente, produto, valor, tipo, "updatedAt")
    VALUES (gen_random_uuid()::text, org, 'Lucas Rezende', 'Imersão ROOT', 12000, 'parceria', now()) RETURNING id INTO a;
    INSERT INTO "_diario_integracao_20261026" (acao, tabela, registro, depois) VALUES ('insert', 'AcordoComercial', a, 'Lucas Rezende · parceria · Imersão ROOT · 12000');
  END IF;

  -- 3. Cadastros repetidos: o segundo aponta para o principal (não apaga nem junta nada).
  FOR r IN SELECT * FROM (VALUES
    ('Curral (Marcelo Alves Meroto)', 'Curral'),
    ('Promedical Equipamentos Médicos', 'ProMedical'),
    ('Lucas Martins da Costa Moreira', 'Custeio')
  ) AS t(dup, principal) LOOP
    SELECT id INTO p FROM "Partner" WHERE "orgId" = org AND "razaoSocial" = r.principal;
    IF p IS NULL THEN RAISE NOTICE 'principal % não encontrado: pulei', r.principal; CONTINUE; END IF;
    UPDATE "Partner" SET "principalId" = p
      WHERE "orgId" = org AND "razaoSocial" = r.dup AND "principalId" IS NULL AND id <> p
      RETURNING id INTO a;
    IF a IS NOT NULL THEN
      INSERT INTO "_diario_integracao_20261026" (acao, tabela, registro, coluna, antes, depois) VALUES ('update', 'Partner', a, 'principalId', NULL, p);
    END IF;
    a := NULL;
  END LOOP;

  -- 4. Cada acordo ligado ao seu cadastro (pelo nome do acordo → nome do cadastro).
  FOR r IN SELECT * FROM (VALUES
    ('Affari', 'Affari'),
    ('Campo Bom', 'Campo Bom'),
    ('Cartório de Descoberto', 'Cartório de Descoberto'),
    ('Cultural', 'Cultural (permuta da sala)'),
    ('Curral', 'Curral'),
    ('Custeio', 'Custeio'),
    ('Custeio (Lucas Moreira)', 'Custeio'),
    ('Dispropan', 'Dispropan'),
    ('Lucas da Guiando', 'Lucas da Guiando'),
    ('Lucas Rezende', 'Lucas Rezende'),
    ('Mais Q Contabilidade', 'Mais Q Contabilidade'),
    ('ProMedical', 'ProMedical')
  ) AS t(acordo, cadastro) LOOP
    SELECT id INTO p FROM "Partner" WHERE "orgId" = org AND "razaoSocial" = r.cadastro;
    IF p IS NULL THEN RAISE NOTICE 'cadastro % não encontrado: pulei', r.cadastro; CONTINUE; END IF;
    FOR a IN UPDATE "AcordoComercial" SET "partnerId" = p
      WHERE "orgId" = org AND cliente = r.acordo AND "partnerId" IS NULL RETURNING id LOOP
      INSERT INTO "_diario_integracao_20261026" (acao, tabela, registro, coluna, antes, depois) VALUES ('update', 'AcordoComercial', a, 'partnerId', NULL, p);
    END LOOP;
  END LOOP;
END $$;

SELECT acao, tabela, coalesce(coluna, '-') AS coluna, count(*) FROM "_diario_integracao_20261026" GROUP BY 1, 2, 3 ORDER BY 2, 1;
SELECT cliente, tipo, coalesce(p."razaoSocial", '(não ligado)') AS cadastro
  FROM "AcordoComercial" ac LEFT JOIN "Partner" p ON p.id = ac."partnerId" ORDER BY cliente;
