-- ============================================================================
-- A REATIVAÇÃO EXPLÍCITA DEIXA MARCA — RF-O-03 (correção da fatia 6.2)
--
-- Uma coluna, `Assinatura.perdoadasAte`, e nada mais.
--
-- ----------------------------------------------------------------------------
-- POR QUE ELA EXISTE, escrito para quem for tentar removê-la
-- ----------------------------------------------------------------------------
-- `AssinaturaService.reativar` é a saída declarada para três casos em que o
-- provedor de cobrança NÃO vai concordar com a decisão: pagamento por fora (PIX
-- direto, boleto de outra conta), acordo comercial e suspensão indevida que
-- precisa ser desfeita agora. Nos três, o dinheiro não passou pelo provedor — e
-- ele continua devolvendo a cobrança como `OVERDUE`.
--
-- Sem esta coluna, a conferência seguinte relia a mesma cobrança vencida e
-- suspendia de novo. Reproduzido contra o banco, em três passos e um segundo:
-- conferir suspende, reativar ativa, conferir volta a suspender. A reativação do
-- administrador não sobrevivia ao clique seguinte de qualquer usuário.
--
-- `decidirTransicao` (`src/billing/assinatura.ts`) passa a IGNORAR toda cobrança
-- cujo vencimento seja anterior ou igual a esta marca. O perdão é do que já
-- estava vencido, não do contrato: a fatura do mês seguinte vence depois da
-- marca, não é perdoada, e suspende normalmente.
--
-- ----------------------------------------------------------------------------
-- POR QUE É MIGRAÇÃO NOVA, EM PASTA NOVA
-- ----------------------------------------------------------------------------
-- `20260911233000_assinatura_e_cobranca` JÁ FOI APLICADA, e migração aplicada é
-- imutável: o banco guarda o resumo do arquivo, então editá-la faz o banco
-- continuar com o SQL antigo enquanto o arquivo mostra o novo — e a próxima
-- `prisma migrate deploy` recusa rodar, com um erro que não fala do assunto.
--
-- ESCRITA À MÃO, e não por `prisma migrate dev`: a geração automática compara o
-- schema INTEIRO com o banco, e outras fatias da mesma onda têm modelo no mesmo
-- arquivo. Ela engoliria os modelos delas aqui dentro.
--
-- ----------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA
-- ----------------------------------------------------------------------------
-- Nada a fazer: `Assinatura` JÁ nasceu com `ENABLE` + `FORCE ROW LEVEL SECURITY`
-- e as quatro políticas, na migração que a criou. Acrescentar coluna não mexe em
-- policy — elas são por TABELA, não por coluna. A conferência no fim deste
-- arquivo existe para provar isso em vez de supor, e para abortar se um rebase
-- mal resolvido tiver desfeito o isolamento no meio do caminho.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   ALTER TABLE "Assinatura" DROP COLUMN "perdoadasAte";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260912010000_reativacao_deixa_marca';
--
-- Desfazer devolve o defeito: a reativação à mão volta a ser desfeita pela
-- conferência seguinte.
-- ============================================================================

-- AlterTable
--
-- NULA por padrão, e sem `DEFAULT now()`: nulo significa "nunca houve reativação
-- explícita", e nada é perdoado. Um default de agora perdoaria, na hora em que
-- esta migração rodasse, toda cobrança vencida de toda empresa da carteira — que
-- é o oposto exato do que a coluna existe para fazer.
ALTER TABLE "Assinatura" ADD COLUMN "perdoadasAte" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — o isolamento continua de pé nesta tabela
--
-- Falha ALTA de propósito, como a da migração que criou a tabela: se o
-- isolamento tiver sumido, é melhor a migração abortar aqui do que a tabela que
-- diz QUEM ESTÁ SUSPENSO — e agora também QUEM FOI PERDOADO — ficar legível e
-- gravável por qualquer empresa. Uma empresa que alcançasse a linha de outra
-- poderia se perdoar sozinha.
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
   WHERE n.nspname = 'public' AND c.relname = 'Assinatura';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'Assinatura esta sem isolamento por linha (rls/force/policies). Tabela que decide acesso sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
