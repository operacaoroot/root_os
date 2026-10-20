-- ============================================================================
-- CONCILIAÇÃO DO CLIENTE DA TAREFA · Versão final (19/10/2026)
--
-- Duas verdades para o mesmo campo chegaram ao merge:
--   * a da produção (Lucas, `20261019180000_tarefas_area_e_cliente`):
--     `WorkTask.clienteId` aponta para OUTRA WorkTask, o card de uma lista de
--     natureza `cadastro`, com FK composta ("clienteId", "orgId") e o CHECK
--     `WorkTask_cliente_nao_e_ela_mesma`;
--   * a nossa (rodada do trabalho T4): `WorkTask.clienteId` aponta para o
--     `Partner` que o fechamento comercial e o Financeiro já usam, com o gatilho
--     `WorkTask_orgId_confere_cliente` e o cliente da casa (`Partner.interno`).
-- Fica a nossa. Esta migration converte a da produção sem perder vínculo.
--
-- OS TRÊS PONTOS DE PARTIDA (todos idempotentes; rodar de novo não muda nada):
--   1. PRODUÇÃO (e banco novo): a coluna é a do Lucas. Para cada card citado
--      como cliente, acha o `Partner` da mesma empresa pelo CNPJ (um campo do
--      card cujo nome tem "CNPJ" ou "CPF") ou, sem ele, pelo nome normalizado
--      (campo "Empresa" do card, senão o título) contra razão social e nome
--      fantasia; não achando, CRIA o `Partner` (isCliente). A tarefa passa a
--      apontar para ele. O card de origem não é tocado (o organizador decide o
--      destino dele). Regras da revisão adversarial (1.1 a 1.3):
--        * o Financeiro não muda por engano: pelo nome só casa `Partner` que já é
--          cliente; só o casamento pelo CNPJ promove um `Partner` a cliente;
--        * card em fase de LEAD (etapa fora de fechado, implantação e sucesso, a
--          mesma regra de `faseDaEtapa`) não vira `Partner`: a tarefa fica sem
--          cliente e o organizador, com os mapas revisados, decide;
--        * card sem nome e sem CNPJ vira "Cliente sem nome", um por card;
--        * antes do DROP, a conta fecha: toda tarefa com cliente foi convertida ou
--          ficou sem cliente por citar lead. Quem roda precisa atravessar o
--          isolamento por linha (superusuário ou BYPASSRLS); sem isso a conversão
--          leria a tabela vazia e apagaria os vínculos em silêncio.
--   2. HOMOLOGAÇÃO que já aplicou a versão antiga da nossa: o preparo
--      (`20261019170000`) guardou a nossa coluna em "clienteIdParceiro"; ela
--      volta a ser `clienteId` e é a verdade. O que a migration do Lucas
--      preencheu ali (o pai de cadastro) é descartado sem criar `Partner`: a
--      regra nossa é "nenhum backfill por nome" e a homologação já tem o seu.
--   3. JÁ CONCILIADO: a FK `WorkTask_clienteId_fkey` aponta para `Partner` e não
--      sobra coluna de lado: nada a fazer além de garantir índice, gatilho e o
--      cliente da casa.
--
-- CAMINHO DE VOLTA: não há volta automática para a forma do Lucas (o vínculo
-- passa a ser com o cadastro de clientes). O backup anterior à virada é o caminho
-- (docs/comercial/VIRADA-PRODUCAO.md, rollback).
-- ============================================================================

ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "interno" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "Partner_orgId_interno_unico" ON "Partner"("orgId") WHERE "interno";

CREATE OR REPLACE FUNCTION pg_temp.mktos_nome_normalizado(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(btrim(regexp_replace(lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '[^a-z0-9]+', ' ', 'g')), '')
$$;

DO $$
DECLARE
  forma_lucas  boolean;
  tem_parceiro boolean;
  criados      integer := 0;
  convertidas  integer := 0;
  de_lead      integer := 0;
  esperadas    integer := 0;
  atravessa    boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_class r ON r.oid = c.confrelid
     WHERE c.contype = 'f' AND t.relname = 'WorkTask' AND r.relname = 'WorkTask'
       AND c.conname = 'WorkTask_clienteId_orgId_fkey'
  ) INTO forma_lucas;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'WorkTask' AND column_name = 'clienteIdParceiro'
  ) INTO tem_parceiro;

  IF forma_lucas AND NOT tem_parceiro THEN
    -- Ponto de partida 1: converter card → Partner.
    SELECT r.rolsuper OR r.rolbypassrls INTO atravessa FROM pg_roles r WHERE r.rolname = current_user;
    IF NOT coalesce(atravessa, false) THEN
      RAISE EXCEPTION 'conciliacao do cliente da tarefa: % nao atravessa o isolamento por linha (precisa de superusuario ou BYPASSRLS); nada foi alterado', current_user;
    END IF;
    SELECT count(*) INTO esperadas FROM "WorkTask" WHERE "clienteId" IS NOT NULL;

    CREATE TEMP TABLE conc_card ON COMMIT DROP AS
    SELECT DISTINCT c."id" AS card_id, c."orgId" AS org_id,
           coalesce(pg_temp.mktos_nome_normalizado(s."name") IN (
             'negocio fechado', 'kickoff', 'diagnostico', 'implantacao', 'treinamento',
             'pos entrega', 'acompanhamento 30 dias', 'depoimento e indicacao',
             'proposta de continuidade', 'recorrente', 'cancelado', 'encerrado'), false) AS e_cliente,
           left(coalesce(
             nullif(btrim((SELECT v."value" FROM "WorkFieldValue" v JOIN "WorkField" f ON f."id" = v."fieldId"
                            WHERE v."taskId" = c."id" AND pg_temp.mktos_nome_normalizado(f."name") = 'empresa'
                            LIMIT 1)), ''),
             btrim(c."title")), 160) AS nome,
           nullif(regexp_replace(coalesce((SELECT v."value" FROM "WorkFieldValue" v JOIN "WorkField" f ON f."id" = v."fieldId"
                            WHERE v."taskId" = c."id"
                              AND (pg_temp.mktos_nome_normalizado(f."name") LIKE '%cnpj%'
                                OR pg_temp.mktos_nome_normalizado(f."name") LIKE '%cpf%')
                            LIMIT 1), ''), '[^0-9]', '', 'g'), '') AS cnpj,
           NULL::text AS partner_id
      FROM "WorkTask" t
      JOIN "WorkTask" c ON c."id" = t."clienteId" AND c."orgId" = t."orgId"
      LEFT JOIN "WorkStatus" s ON s."id" = c."statusId"
     WHERE t."clienteId" IS NOT NULL;
    -- Card em fase de lead não vira Partner: a tarefa fica sem cliente.
    DELETE FROM conc_card WHERE NOT e_cliente;

    -- 1º pelo CNPJ.
    UPDATE conc_card k SET partner_id = (
      SELECT p."id" FROM "Partner" p
       WHERE p."orgId" = k.org_id AND k.cnpj IS NOT NULL
         AND regexp_replace(coalesce(p."cnpjCpf", ''), '[^0-9]', '', 'g') = k.cnpj
       ORDER BY p."isCliente" DESC, p."createdAt" LIMIT 1)
     WHERE k.partner_id IS NULL;
    -- 2º pelo nome normalizado (razão social ou nome fantasia), só entre quem já é cliente.
    UPDATE conc_card k SET partner_id = (
      SELECT p."id" FROM "Partner" p
       WHERE p."orgId" = k.org_id AND NOT p."interno" AND p."isCliente"
         AND pg_temp.mktos_nome_normalizado(k.nome) IS NOT NULL
         AND (pg_temp.mktos_nome_normalizado(p."razaoSocial") = pg_temp.mktos_nome_normalizado(k.nome)
           OR pg_temp.mktos_nome_normalizado(p."nomeFantasia") = pg_temp.mktos_nome_normalizado(k.nome))
       ORDER BY p."isCliente" DESC, p."createdAt" LIMIT 1)
     WHERE k.partner_id IS NULL;
    -- Dois cards do mesmo cliente (mesmo nome normalizado ou CNPJ) viram UM Partner.
    UPDATE conc_card k SET partner_id = d.partner_id
      FROM (SELECT org_id, coalesce(cnpj, pg_temp.mktos_nome_normalizado(nome), 'card:' || card_id) AS chave,
                   gen_random_uuid()::text AS partner_id
              FROM conc_card WHERE partner_id IS NULL
             GROUP BY 1, 2) d
     WHERE k.partner_id IS NULL AND k.org_id = d.org_id
       AND coalesce(k.cnpj, pg_temp.mktos_nome_normalizado(k.nome), 'card:' || k.card_id) = d.chave;
    -- Criar os que faltam, já como cliente.
    INSERT INTO "Partner" ("id", "orgId", "isCliente", "isFornecedor", "razaoSocial", "cnpjCpf", "ativo", "interno", "createdAt", "updatedAt")
    SELECT DISTINCT ON (k.partner_id) k.partner_id, k.org_id, true, false, coalesce(nullif(btrim(k.nome), ''), 'Cliente sem nome'), k.cnpj, true, false, now(), now()
      FROM conc_card k
     WHERE NOT EXISTS (SELECT 1 FROM "Partner" p WHERE p."id" = k.partner_id)
     ORDER BY k.partner_id, k.card_id;
    GET DIAGNOSTICS criados = ROW_COUNT;
    -- Quem já existia e não era cliente só passa a ser quando o CNPJ bateu
    -- (pelo nome o casamento já se limitou a clientes).
    UPDATE "Partner" p SET "isCliente" = true, "updatedAt" = now()
      FROM conc_card k
     WHERE p."id" = k.partner_id AND NOT p."isCliente" AND k.cnpj IS NOT NULL
       AND regexp_replace(coalesce(p."cnpjCpf", ''), '[^0-9]', '', 'g') = k.cnpj;

    ALTER TABLE "WorkTask" ADD COLUMN "clienteIdNovo" TEXT;
    UPDATE "WorkTask" t SET "clienteIdNovo" = k.partner_id
      FROM conc_card k WHERE k.card_id = t."clienteId" AND k.org_id = t."orgId";
    GET DIAGNOSTICS convertidas = ROW_COUNT;
    SELECT count(*) INTO de_lead FROM "WorkTask" t
     WHERE t."clienteId" IS NOT NULL AND t."clienteIdNovo" IS NULL;
    IF convertidas + de_lead <> esperadas OR EXISTS (
      SELECT 1 FROM "WorkTask" t
        JOIN conc_card k ON k.card_id = t."clienteId" AND k.org_id = t."orgId"
       WHERE t."clienteIdNovo" IS NULL) THEN
      RAISE EXCEPTION 'conciliacao do cliente da tarefa: % com cliente, % convertidas, % de lead; a conta nao fecha e nada foi alterado', esperadas, convertidas, de_lead;
    END IF;

    ALTER TABLE "WorkTask" DROP CONSTRAINT "WorkTask_clienteId_orgId_fkey";
    ALTER TABLE "WorkTask" DROP CONSTRAINT IF EXISTS "WorkTask_cliente_nao_e_ela_mesma";
    DROP INDEX IF EXISTS "WorkTask_orgId_clienteId_idx";
    ALTER TABLE "WorkTask" DROP COLUMN "clienteId";
    ALTER TABLE "WorkTask" RENAME COLUMN "clienteIdNovo" TO "clienteId";
    RAISE NOTICE 'conciliacao do cliente da tarefa: % tarefas convertidas, % sem cliente por citarem lead, % Partner criados', convertidas, de_lead, criados;

  ELSIF tem_parceiro THEN
    -- Ponto de partida 2: a nossa coluna volta a ser a verdade.
    IF forma_lucas THEN
      ALTER TABLE "WorkTask" DROP CONSTRAINT "WorkTask_clienteId_orgId_fkey";
    END IF;
    ALTER TABLE "WorkTask" DROP CONSTRAINT IF EXISTS "WorkTask_cliente_nao_e_ela_mesma";
    DROP INDEX IF EXISTS "WorkTask_orgId_clienteId_idx";
    ALTER TABLE "WorkTask" DROP COLUMN IF EXISTS "clienteId";
    ALTER TABLE "WorkTask" RENAME COLUMN "clienteIdParceiro" TO "clienteId";
    RAISE NOTICE 'conciliacao do cliente da tarefa: a coluna da homologacao voltou a ser clienteId';

  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'WorkTask' AND column_name = 'clienteId'
  ) THEN
    ALTER TABLE "WorkTask" ADD COLUMN "clienteId" TEXT;
  END IF;

  -- Daqui para baixo vale para os três: a forma nossa, garantida.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkTask_clienteId_fkey') THEN
    ALTER TABLE "WorkTask"
      ADD CONSTRAINT "WorkTask_clienteId_fkey"
      FOREIGN KEY ("clienteId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "WorkTask_orgId_clienteId_idx" ON "WorkTask"("orgId", "clienteId");

DROP TRIGGER IF EXISTS "WorkTask_orgId_confere_cliente" ON "WorkTask";
CREATE TRIGGER "WorkTask_orgId_confere_cliente"
  BEFORE INSERT OR UPDATE ON "WorkTask"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Partner', 'clienteId');

-- CONFERÊNCIA LOCAL: o isolamento continua de pé nas duas tabelas do par, e as
-- tabelas que a produção trouxe também (WorkArea, cofre, acordos, leituras).
DO $$
DECLARE
  t  text;
  ok boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['WorkTask', 'Partner'] LOOP
    SELECT c.relrowsecurity
       AND c.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
      INTO ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;
    IF NOT COALESCE(ok, false) THEN
      RAISE EXCEPTION
        '% esta sem isolamento por linha (rls/force/4 policies). A coluna clienteId liga a tarefa ao cadastro de clientes; sem policy isso e vazamento.', t;
    END IF;
  END LOOP;
END $$;
