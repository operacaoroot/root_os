-- ============================================================================
-- TETO DE CUSTO DE IA POR EMPRESA E POR DIA (RF-G-05, RNF-05) — fatia 3.6
--
-- Duas tabelas:
--   · `TetoDeCustoIa`  — a CONFIGURAÇÃO da empresa: quanto pode gastar por dia,
--                        em que fuso o dia vira, e se o teto está valendo.
--   · `GastoDeIaNoDia` — o LIVRO-CAIXA de um dia: o que já foi gasto, o que
--                        está reservado por chamadas em voo, e os contadores.
--
-- ESCRITA À MÃO, e não gerada. Três fatias desta onda criam tabela no mesmo
-- worktree; `prisma migrate dev` compara o schema INTEIRO com o banco e traria
-- os modelos das outras duas para dentro desta migration (protocolo da onda 6,
-- seção 4). Conferida contra o banco descartável `prova_36`, criado para isto e
-- apagado depois.
--
-- ----------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA — LIGADO AQUI, NA MESMA MIGRATION QUE CRIA AS TABELAS
-- ----------------------------------------------------------------------------
-- A migration `20260911050000_isolamento_por_linha` termina com uma conferência
-- que percorre o catálogo e RECUSA aplicar se achar tabela sem RLS/FORCE/policy.
-- Ela só pega o esquecimento do dia dela — quem pega o de hoje é o caso "toda
-- tabela está sob isolamento por linha" de `apps/api/test/tenant-isolation.test.ts`.
-- As duas tabelas abaixo têm coluna de empresa, então entram pelo caminho
-- padrão: `app_rls_aplicar_policies`, com leitura e escrita SEPARADAS e presas à
-- empresa da sessão. Nenhuma sentinela: nada aqui precisa ser lido antes de
-- existir empresa resolvida — o teto só é consultado dentro de uma execução que
-- já sabe de quem é.
--
-- O QUE A POLICY NÃO RESOLVE, dito em voz alta: ela não distingue COLUNA. A
-- empresa alcança a própria linha de `TetoDeCustoIa`, e portanto o próprio teto.
-- Quem tem de separar "ler o teto" de "aumentar o teto" é a rota, não o banco —
-- e rota ainda não existe (está em PERGUNTAS do relatório da fatia). Hoje o
-- valor entra por script/semente, com a conexão dona.
-- ============================================================================

-- CreateTable
CREATE TABLE "TetoDeCustoIa" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tetoDiarioUsd" DECIMAL(12,6) NOT NULL,
    "fusoHorario" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "definidoPorId" TEXT,
    "definidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motivo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TetoDeCustoIa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GastoDeIaNoDia" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dia" TEXT NOT NULL,
    "gastoUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "gastoEstimadoUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "reservadoUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "chamadas" INTEGER NOT NULL DEFAULT 0,
    "chamadasSemPreco" INTEGER NOT NULL DEFAULT 0,
    "cortes" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GastoDeIaNoDia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TetoDeCustoIa_orgId_key" ON "TetoDeCustoIa"("orgId");

-- CreateIndex
-- É a chave da reserva: o `INSERT ... ON CONFLICT ("orgId","dia") DO UPDATE`
-- que soma a estimativa depende DELA para ser uma operação atômica. Sem o
-- índice único, duas chamadas simultâneas criam duas linhas do mesmo dia e o
-- teto passa a valer o dobro sem ninguém perceber.
CREATE UNIQUE INDEX "GastoDeIaNoDia_orgId_dia_key" ON "GastoDeIaNoDia"("orgId", "dia");

-- AddForeignKey
ALTER TABLE "TetoDeCustoIa" ADD CONSTRAINT "TetoDeCustoIa_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoDeIaNoDia" ADD CONSTRAINT "GastoDeIaNoDia_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA
--
-- As expressões são, palavra por palavra, as `padrao_leitura` / `padrao_escrita`
-- da migration do isolamento. Escritas por extenso e não copiadas de variável
-- porque migration não compartilha escopo com outra migration — e porque o caso
-- "toda expressão de policy está no conjunto declarado" da suíte de isolamento
-- compara exatamente este texto (normalizado pelo Postgres) com a lista dele.
-- Divergir aqui reprova lá, que é o comportamento desejado.
--
-- `app_rls_aplicar_policies` já faz, por dentro: DROP das policies antigas (é
-- idempotente), CREATE de `tenant_leitura` (SELECT), `tenant_insercao` (INSERT
-- com WITH CHECK), `tenant_alteracao` (UPDATE com USING **e** WITH CHECK) e
-- `tenant_exclusao` (DELETE), e depois ENABLE + FORCE ROW LEVEL SECURITY.
--
-- As duas tabelas recebem os quatro verbos. `GastoDeIaNoDia` precisa de UPDATE
-- (é o livro-caixa, que soma e liquida) e de DELETE — o expurgo por retenção da
-- fatia 3.5 e a limpeza de dia velho passam por ele. `TetoDeCustoIa` também: o
-- teto é configuração, e configuração se troca e se apaga.
-- ----------------------------------------------------------------------------

SELECT app_rls_aplicar_policies(
  'TetoDeCustoIa',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

SELECT app_rls_aplicar_policies(
  'GastoDeIaNoDia',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

-- ----------------------------------------------------------------------------
-- CONFERÊNCIA — falhar aqui é melhor do que descobrir vazando
--
-- Mesma forma da conferência da migration do isolamento, recortada às duas
-- tabelas desta. Se `app_rls_aplicar_policies` não existir (banco que nunca
-- recebeu a 20260911050000) o SELECT acima já teria estourado; isto aqui pega o
-- caso mais sorrateiro: a função existir, rodar, e a tabela mesmo assim ficar
-- sem FORCE — que é o estado em que o DONO das tabelas atravessa a policy.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  alvo     text;
  faltando text[] := ARRAY[]::text[];
BEGIN
  FOREACH alvo IN ARRAY ARRAY['TetoDeCustoIa', 'GastoDeIaNoDia'] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = alvo
         AND c.relrowsecurity
         AND c.relforcerowsecurity
         AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) = 4
    ) THEN
      faltando := array_append(faltando, alvo);
    END IF;
  END LOOP;

  IF array_length(faltando, 1) > 0 THEN
    RAISE EXCEPTION
      'teto de custo: tabela(s) sem isolamento por linha completo (%). Tabela de empresa sem RLS, sem FORCE ou sem as quatro policies e vazamento sao a mesma coisa.',
      array_to_string(faltando, ', ');
  END IF;
END $$;
