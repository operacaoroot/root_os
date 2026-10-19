-- ============================================================================
-- TODA TAREFA LIGADA A UM CLIENTE — rodada do trabalho T4 (19/10/2026)
--
-- O Rodrigo decidiu: toda tarefa é vinculada a um cliente, sempre; o cliente é
-- um CAMPO da tarefa e não entra no nome.
--
-- QUAL CLIENTE. Não nasce uma sexta "verdade" sobre cliente. O vínculo aponta
-- para `Partner` com `isCliente`, o cadastro que a transação de fechamento do
-- comercial JÁ escreve (escrita `cliente`, reaproveitada pelo CNPJ) e que o
-- Financeiro usa no contrato. `ComercialFicha.partnerId` liga o lead a ele.
--
-- O DA CASA. O que é trabalho da própria empresa (pastas Administrativa e
-- Gestão) vai para o cliente interno: um `Partner` marcado `interno`, um por
-- empresa (índice único parcial), criado sob demanda pela API. Assim a regra
-- vale sem exceção.
--
-- AS ANTIGAS. `clienteId` é anulável: tarefa anterior a esta migration fica sem
-- cliente, aparece com o selo "sem cliente" e um filtro para limpar. Nenhum
-- backfill: casar por nome inventaria vínculo.
--
-- EMPRESA CRUZADA. A FK não enxerga a empresa; o gatilho
-- `WorkTask_orgId_confere_cliente` reusa `mktos_orgid_do_pai('Partner',
-- 'clienteId')` e recusa cliente de outra empresa (o mesmo arranjo do agente,
-- fatia A4).
--
-- CAMINHO DE VOLTA
--   DROP TRIGGER "WorkTask_orgId_confere_cliente" ON "WorkTask";
--   DROP INDEX "WorkTask_orgId_clienteId_idx";
--   ALTER TABLE "WorkTask" DROP CONSTRAINT "WorkTask_clienteId_fkey";
--   ALTER TABLE "WorkTask" DROP COLUMN "clienteId";
--   DROP INDEX "Partner_orgId_interno_unico";
--   ALTER TABLE "Partner" DROP COLUMN "interno";
-- ============================================================================

-- ----------------------------------------------------------------------------
-- VERSÃO FINAL (19/10/2026): esta migration NUNCA foi aplicada em produção, e a
-- produção (Lucas, `20261019180000_tarefas_area_e_cliente`) criou a mesma coluna
-- `WorkTask.clienteId` apontando para OUTRA tarefa. Para o histórico aplicar nos
-- três pontos de partida (produção, homologações que já rodaram a versão antiga
-- desta migration, banco novo), a parte da tarefa saiu daqui: quem cria a FK para
-- `Partner`, o índice e o gatilho é a conciliação
-- `20261019230000_conciliacao_cliente_da_tarefa`, depois da última do Lucas.
-- Aqui fica só o cliente da casa, idempotente. Nas homologações que já rodaram a
-- versão antiga, a coluna nossa existe e o preparo
-- `20261019170000_cliente_da_tarefa_preparo` a põe de lado antes da do Lucas.
-- ----------------------------------------------------------------------------
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "interno" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "Partner_orgId_interno_unico" ON "Partner"("orgId") WHERE "interno";

-- CONFERÊNCIA LOCAL — o isolamento continua de pé nas duas tabelas do par.
DO $$
DECLARE
  t  text;
  ok boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['Partner'] LOOP
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
