-- ============================================================================
-- O AGENTE GANHA ESTADO DECLARADO — fatia A2
--
-- Um enum novo (`EstadoDeAgente`), a coluna `Agent.estado` trocada de tipo e
-- três colunas de procedência (`estadoPorId`, `estadoEm`, `estadoMotivo`).
-- Nenhuma tabela nova.
--
-- ----------------------------------------------------------------------------
-- POR QUE UM ENUM NOVO E NÃO DOIS VALORES A MAIS NO `AgentEstado`
-- ----------------------------------------------------------------------------
-- `AgentEstado` é de DUAS tabelas: `Agent.estado` e `Rotina.estado`. E a tela
-- de Rotinas oferece como opção TODOS os valores do enum (é o que
-- `test/rotinas.test.ts` cobra: os estados oferecidos são `Object.values`).
-- Acrescentar `encerrado` ali teria posto na tela de Rotinas uma opção que o
-- serviço de rotinas não sabe o que é — e, pior, de onde ele deixaria a rotina
-- voltar, porque a regra de "encerrado não volta" mora no agente.
--
-- Então o agente passa a ter vocabulário próprio e a rotina fica com o dela,
-- intacta. NENHUMA linha de `Rotina` é tocada por esta migração.
--
-- ----------------------------------------------------------------------------
-- O MAPA DOS VALORES ANTIGOS — leia antes de reverter
-- ----------------------------------------------------------------------------
--   rodando    → ativo       (era o "em operação" do agente; o `rodando` novo é
--                            OBSERVADO, derivado de sessão viva, e não se grava)
--   aprendendo → ativo       (só a rotina usa; nenhum agente semeado está nele.
--                            Se algum estiver, ele continua trabalhando — que é
--                            o que `aprendendo` queria dizer no laço, já que
--                            `impedimento()` nunca barrou esse valor)
--   planejado  → planejado
--   pausado    → pausado
--
-- A conversão é POR NOME, com `CASE` sobre o texto, e o `ELSE` cai em
-- `planejado`: valor que ninguém previu vira o estado que NÃO roda. Falha
-- fechada — o contrário faria um agente desconhecido nascer com autonomia.
--
-- ----------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA
-- ----------------------------------------------------------------------------
-- Nada a ligar: `Agent` já tem `ENABLE` + `FORCE ROW LEVEL SECURITY` e as
-- quatro políticas desde `20260911050000_isolamento_por_linha`. Trocar o TIPO
-- de uma coluna e acrescentar colunas não mexe em policy — policy é por tabela.
-- A conferência no fim deste arquivo prova isso em vez de supor, e aborta se um
-- rebase mal resolvido tiver desfeito o isolamento no caminho.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   ALTER TABLE "Agent" ALTER COLUMN "estado" DROP DEFAULT;
--   ALTER TABLE "Agent" ALTER COLUMN "estado" TYPE "AgentEstado"
--     USING (CASE "estado"::text
--              WHEN 'ativo' THEN 'rodando'
--              WHEN 'encerrado' THEN 'pausado'   -- ATENÇÃO: encerrado VOLTA a poder voltar
--              ELSE "estado"::text END)::"AgentEstado";
--   ALTER TABLE "Agent" ALTER COLUMN "estado" SET DEFAULT 'planejado';
--   ALTER TABLE "Agent" DROP COLUMN "estadoMotivo", DROP COLUMN "estadoEm", DROP COLUMN "estadoPorId";
--   DROP TYPE "EstadoDeAgente";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260913010000_estado_declarado_do_agente';
--
-- A volta PERDE informação de propósito declarado: agente encerrado vira
-- pausado, e pausado pode ser retomado. Quem reverter está reabrindo agentes que
-- alguém tirou de circulação para sempre.
-- ============================================================================

-- CreateEnum
CREATE TYPE "EstadoDeAgente" AS ENUM ('planejado', 'ativo', 'pausado', 'encerrado');

-- AlterTable: o tipo da coluna de estado
--
-- O `DROP DEFAULT` vem primeiro porque o default é do tipo antigo e o
-- `ALTER TYPE` não sabe convertê-lo — sem isso o Postgres recusa com
-- "default for column cannot be cast automatically".
ALTER TABLE "Agent" ALTER COLUMN "estado" DROP DEFAULT;

ALTER TABLE "Agent"
  ALTER COLUMN "estado" TYPE "EstadoDeAgente"
  USING (
    CASE "estado"::text
      WHEN 'rodando' THEN 'ativo'
      WHEN 'aprendendo' THEN 'ativo'
      WHEN 'pausado' THEN 'pausado'
      WHEN 'planejado' THEN 'planejado'
      ELSE 'planejado'
    END
  )::"EstadoDeAgente";

ALTER TABLE "Agent" ALTER COLUMN "estado" SET DEFAULT 'planejado';

-- AlterTable: a procedência da decisão
--
-- Os três são NULOS para as linhas que já existem, e nulo aqui quer dizer
-- exatamente "o estado desta linha nunca foi declarado por gente" — foi semente
-- ou conversão. Preenchê-los com a data desta migração faria o rastro afirmar
-- que alguém decidiu algo hoje, que é o único desfecho pior do que campo vazio.
ALTER TABLE "Agent" ADD COLUMN "estadoPorId" TEXT;
ALTER TABLE "Agent" ADD COLUMN "estadoEm" TIMESTAMP(3);
ALTER TABLE "Agent" ADD COLUMN "estadoMotivo" TEXT;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — o isolamento continua de pé em `Agent`
--
-- Falha ALTA de propósito: `Agent` carrega a declaração de capacidade e o teto
-- de autonomia de cada agente. Ficar legível e gravável por qualquer empresa é
-- uma empresa ampliando o alcance do agente de outra.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  ok boolean;
BEGIN
  SELECT c.relrowsecurity
     AND c.relforcerowsecurity
     AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
    INTO ok
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'Agent';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'Agent esta sem isolamento por linha (rls/force/policies). Tabela que declara capacidade de agente sem policy e vazamento, nao pendencia.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — nenhum agente sobrou fora do vocabulário novo
--
-- O `CASE` acima cobre os quatro valores antigos, mas o `ELSE` engole em
-- silêncio qualquer valor que uma migração futura tenha acrescentado ao
-- `AgentEstado` e que ninguém mapeou aqui. Esta contagem não pega isso (o tipo
-- já mudou), então o que ela mede é o que RESTA: agente em estado que não roda.
-- Não aborta — é aviso, porque estado que não roda é legítimo.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  paradas integer;
BEGIN
  SELECT count(*) INTO paradas FROM "Agent" WHERE "estado" <> 'ativo';
  IF paradas > 0 THEN
    RAISE NOTICE
      '[A2] % agente(s) em estado que nao roda (planejado/pausado/encerrado). Confira em /agentes antes de cobrar passagem de ninguem.',
      paradas;
  END IF;
END $$;
