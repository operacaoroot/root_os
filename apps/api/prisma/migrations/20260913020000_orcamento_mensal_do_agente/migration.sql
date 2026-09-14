-- ============================================================================
-- ORÇAMENTO MENSAL DE IA POR AGENTE — fatia A3
--
-- Cinco colunas em `Agent`. NENHUMA TABELA NOVA, e essa é a decisão que este
-- cabeçalho existe para justificar.
--
-- ----------------------------------------------------------------------------
-- POR QUE NÃO HÁ LIVRO-CAIXA POR AGENTE
-- ----------------------------------------------------------------------------
-- O teto por empresa e por dia tem tabela própria (`GastoDeIaNoDia`) por três
-- razões, escritas no cabeçalho de `src/llm/teto-diario.service.ts`: ALCANCE
-- (nem toda chamada de modelo nasce de sessão de agente — relatório, curadoria
-- e pauta chamam `complete()` e não deixam passo nenhum), MOMENTO (reservar
-- corta antes; somar o passado corta tarde) e CONCORRÊNCIA.
--
-- A primeira razão NÃO VALE para o eixo do agente, e é ela que sustentava a
-- tabela: uma chamada DE UM AGENTE é, por definição, uma chamada dentro de uma
-- sessão de agente — e toda uma delas grava `SessionStep.custoUsd` com o custo
-- REAL que o provedor informou. O log de passos já é o livro-caixa por agente:
-- é dele que a tela de Custos (`GET /dashboard/custo-ia`) tira `porAgente`
-- desde a fatia 6.4. Uma segunda tabela contando o mesmo dinheiro seria uma
-- segunda resposta para a mesma pergunta — que é exatamente a doença que a
-- outra metade desta fatia foi consertar nas horas devolvidas.
--
-- O QUE SE PERDE, DECLARADO: sem reserva, o corte é "o mês já estourou" em vez
-- de "esta chamada vai estourar", e chamadas simultâneas podem passar juntas.
-- Contra um orçamento MENSAL, cujo valor é três ou quatro ordens de grandeza
-- maior que o de uma chamada, o excesso possível é irrelevante — e o teto da
-- empresa, que é por DIA e tem reserva, continua valendo por cima. O
-- `src/llm/orcamento-de-agente.service.ts` diz isso na cara de quem lê.
--
-- ----------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA
-- ----------------------------------------------------------------------------
-- Nada a ligar: `Agent` já tem `ENABLE` + `FORCE ROW LEVEL SECURITY` e as
-- quatro políticas (leitura e escrita separadas) desde
-- `20260911050000_isolamento_por_linha`. Acrescentar coluna não mexe em policy
-- — policy é por tabela. A conferência no fim deste arquivo prova em vez de
-- supor, e aborta se um rebase mal resolvido tiver desfeito o isolamento.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   ALTER TABLE "Agent"
--     DROP COLUMN "orcamentoMotivo",
--     DROP COLUMN "orcamentoEm",
--     DROP COLUMN "orcamentoPorId",
--     DROP COLUMN "orcamentoAtivo",
--     DROP COLUMN "orcamentoMensalUsd";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260913020000_orcamento_mensal_do_agente';
--
-- A volta é limpa: nenhum orçamento estava sendo imposto antes desta migração,
-- então reverter devolve o sistema ao estado em que só a empresa/dia e a
-- execução cortavam. O que se perde é o valor que alguém definiu.
-- ============================================================================

-- AlterTable
--
-- `DEFAULT 0` + `orcamentoAtivo DEFAULT false` é o estado "ninguém definiu": o
-- serviço lê isso como ausência de orçamento e a chamada passa como sempre
-- passou. Nascer com um valor qualquer imposto cortaria, no primeiro deploy,
-- agentes que hoje rodam — mudança de comportamento entrando escondida numa
-- migração.
ALTER TABLE "Agent" ADD COLUMN "orcamentoMensalUsd" DECIMAL(10,4) NOT NULL DEFAULT 0;
ALTER TABLE "Agent" ADD COLUMN "orcamentoAtivo" BOOLEAN NOT NULL DEFAULT false;

-- A procedência da decisão. Nulos para as linhas que já existem, e nulo aqui
-- quer dizer exatamente "ninguém definiu orçamento para este agente" — o mesmo
-- raciocínio de `estadoPorId` na migração da A2. Preenchê-los com a data desta
-- migração faria o rastro afirmar que alguém decidiu um valor hoje.
ALTER TABLE "Agent" ADD COLUMN "orcamentoPorId" TEXT;
ALTER TABLE "Agent" ADD COLUMN "orcamentoEm" TIMESTAMP(3);
ALTER TABLE "Agent" ADD COLUMN "orcamentoMotivo" TEXT;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — o isolamento continua de pé em `Agent`
--
-- Falha ALTA de propósito: `Agent` carrega a declaração de capacidade, o teto de
-- autonomia e agora o orçamento de cada agente. Ficar gravável por outra
-- empresa é uma empresa mexendo no orçamento — e no alcance — do agente alheio.
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
      'Agent esta sem isolamento por linha (rls/force/policies). Tabela que declara orcamento e capacidade de agente sem policy e vazamento, nao pendencia.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — ninguém saiu desta migração com orçamento imposto
--
-- Aborta, e não avisa: um agente que amanheça com `orcamentoAtivo = true` sem
-- que ninguém tenha decidido isso passa a ter as chamadas dele recusadas por um
-- orçamento de zero dólar. Seria o produto parando sozinho, por migração.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  impostos integer;
BEGIN
  SELECT count(*) INTO impostos FROM "Agent" WHERE "orcamentoAtivo";
  IF impostos > 0 THEN
    RAISE EXCEPTION
      '% agente(s) sairam desta migracao com orcamento VALENDO. O default e false: alguem mexeu no DDL.',
      impostos;
  END IF;
END $$;
