-- ============================================================================
-- A RESERVA DA ROTINA VIRA ARRENDAMENTO COM PRAZO (RF-N-04) — correção da 5.1
--
-- Duas colunas novas em `Rotina` e um índice a menos. Nenhuma tabela nasce
-- aqui, então não há isolamento por linha a aplicar: `Rotina` já nasceu com
-- ENABLE + FORCE e as quatro policies na migration que a criou
-- (`20260911180000_rotinas_por_empresa`), e coluna nova não muda policy.
--
-- ----------------------------------------------------------------------------
-- 1. POR QUE AS DUAS COLUNAS
-- ----------------------------------------------------------------------------
-- A reserva do minuto era um `UPDATE` condicional sobre `ultimaExecucaoEm`.
-- Barata, e errada em duas frentes:
--
--  · CARIMBO INDEVIDO. Ela escrevia `ultimaExecucaoEm` ANTES de chamar o
--    executor. Quando o desfecho era `pulada` — o executor acordou e não havia o
--    que fazer —, o carimbo ficava e o contador não subia. Para a rotina que
--    `pulada` existe para servir, a tela dizia "última execução há um minuto,
--    zero execuções" para sempre.
--  · SEM PRAZO. Carimbo não vence. Morrer entre reservar e executar (deploy,
--    OOM, queda do container) perdia a ocorrência em silêncio, e ninguém
--    retomava: numa rotina diária, o prejuízo era o dia inteiro.
--
-- `reservadoEm` guarda o MINUTO já tomado pelo tique — é o que impede tique
-- atrasado e segunda réplica de disparar a mesma ocorrência. `reservadoAte` é o
-- PRAZO: enquanto está no futuro a rotina está em curso; vencido sem devolução,
-- a execução morreu no meio e o tique seguinte retoma.
--
-- NOT NULL COM A ÉPOCA NO LUGAR DE NULO. "Livre" vira `< agora`, uma comparação
-- só, em vez de `IS NULL OR <`. Condição de reserva é justamente onde a
-- semântica de NULL faz um `UPDATE` não casar linha nenhuma sem ninguém
-- perceber — e onde não casar linha significa "a rotina não roda".
--
-- ----------------------------------------------------------------------------
-- 2. POR QUE O ÍNDICE SAI
-- ----------------------------------------------------------------------------
-- `Rotina_ativo_estado_idx` nasceu anunciado como "a consulta do tique" e não
-- serve consulta nenhuma: a DESCOBERTA (quais empresas varrer) é um
-- `SELECT DISTINCT "orgId" FROM "Rotina"` sem filtro, servido pelo índice único
-- de `(orgId, slug)`; e a consulta de candidatas dentro da empresa começa por
-- `orgId`, servida por `(orgId, estado)`. Índice que ninguém usa custa escrita
-- em toda gravação e mente para quem lê o schema.
--
-- ----------------------------------------------------------------------------
-- 3. ERRATA DA MIGRATION ANTERIOR — LEIA ANTES DE DESFAZER QUALQUER COISA
-- ----------------------------------------------------------------------------
-- A receita de volta escrita no cabeçalho de
-- `20260911180000_rotinas_por_empresa` cita o NÚMERO ERRADO na última linha
-- (`20260911170000_rotinas_por_empresa`, que não existe: `20260911170000` é a
-- migration da memória). Seguir aquela receita ao pé da letra DERRUBA as duas
-- tabelas e NÃO apaga o registro em `_prisma_migrations` — a aplicação seguinte
-- considera tudo aplicado e a API sobe sem `Rotina` e sem `RotinaExecucao`.
-- Migration aplicada é imutável, então a errata mora aqui e em `docs/DEPLOY.md`.
--
-- A receita CORRETA, das duas juntas, na ordem:
--
--   ALTER TABLE "Rotina" DROP COLUMN "reservadoEm", DROP COLUMN "reservadoAte";
--   CREATE INDEX "Rotina_ativo_estado_idx" ON "Rotina"("ativo", "estado");
--   DELETE FROM "_prisma_migrations"
--    WHERE migration_name = '20260911200000_reserva_de_rotina_com_prazo';
--
--   -- e, para desfazer também a criação das tabelas:
--   DROP TABLE "RotinaExecucao";
--   DROP TABLE "Rotina";
--   DELETE FROM "_prisma_migrations"
--    WHERE migration_name = '20260911180000_rotinas_por_empresa';
--
-- ----------------------------------------------------------------------------
-- 4. A OUTRA ERRATA: A SEMENTE DA MIGRATION ANTERIOR PODE NÃO VER NADA
-- ----------------------------------------------------------------------------
-- O `INSERT ... SELECT FROM "PautaRotina"` que faz a primeira reconciliação roda
-- SEM EMPRESA NA SESSÃO. Hoje funciona porque o usuário que aplica migration é
-- superusuário e atravessa o isolamento; num banco em que ele não atravessar, o
-- SELECT volta vazio e o INSERT insere zero linhas — CALADO, porque zero linhas
-- não é erro.
--
-- Isso NÃO deixa a rotina da pauta parada: a reconciliação de verdade é a do
-- código (`RotinasService.reconciliarPauta`), que roda a cada tique JÁ DENTRO do
-- contexto de cada empresa e cria o espelho que faltar. A semente só existia
-- para a tela não nascer vazia. O sintoma, se acontecer, é `/rotinas` vazia até
-- o primeiro tique — e está escrito em `docs/DEPLOY.md`.
--
-- PROVADA EM BANCO PRÓPRIO (`prova_51` no container `mktos-shadow`), do zero,
-- com o histórico inteiro aplicado antes, e apagado depois.
-- ============================================================================

-- AlterTable
ALTER TABLE "Rotina"
  ADD COLUMN "reservadoEm"  TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00',
  ADD COLUMN "reservadoAte" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00';

-- DropIndex
DROP INDEX IF EXISTS "Rotina_ativo_estado_idx";

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — as colunas existem e são NOT NULL.
--
-- Falha ALTA de propósito: sem elas o agendador reserva contra coluna que não
-- existe e NENHUMA rotina dispara. Abortar aqui é a API não subir, que é o
-- barulho certo — melhor do que subir com o relógio mudo.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  faltando int;
BEGIN
  SELECT count(*) INTO faltando
    FROM (VALUES ('reservadoEm'), ('reservadoAte')) AS esperado(coluna)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'Rotina'
        AND c.column_name = esperado.coluna
        AND c.is_nullable = 'NO'
   );

  IF faltando > 0 THEN
    RAISE EXCEPTION
      'Rotina ficou sem as colunas de reserva com prazo. Sem elas o agendador nao reserva e nenhuma rotina dispara.';
  END IF;
END $$;
