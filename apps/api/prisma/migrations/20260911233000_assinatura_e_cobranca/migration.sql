-- ============================================================================
-- ASSINATURA E COBRANÇA, SEM APAGAR DADO — RF-O-03 (fatia 6.2)
--
-- Cria `Assinatura` e `CobrancaDeAssinatura` e as deixa nascer JÁ ISOLADAS:
-- `ENABLE` + `FORCE ROW LEVEL SECURITY` e as duas políticas, na mesma migration
-- que cria as tabelas.
--
-- POR QUE ISSO NÃO É ZELO, É PRÉ-REQUISITO DE ARRANQUE. A migration
-- `20260911050000_isolamento_por_linha` termina com uma conferência que percorre
-- o catálogo e ABORTA se achar tabela de `public` sem RLS/FORCE/policy. Ela já
-- rodou e não vê estas tabelas (que nascem depois) — mas num banco recriado do
-- zero ela roda ANTES desta, e `apps/api/test/tenant-isolation.test.ts` faz a
-- mesma pergunta ao catálogo em toda rodada. Migration que aborta roda no
-- `command` do container: abortar é a API não subir.
--
-- ESCRITO À MÃO, e não por `prisma migrate dev`. Três fatias desta onda criam
-- modelo no mesmo arquivo de schema; a geração automática compara o schema
-- INTEIRO com o banco e engoliria os modelos das outras aqui dentro.
--
-- PROVADA EM BANCO PRÓPRIO (`prova_62` no container `mktos-shadow`), do zero, e
-- exercitada com o papel restrito `mktos_app` — não com o dono, que é
-- superusuário, atravessa policy e não exercita nada.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTA MIGRATION **NÃO** FAZ, e cada "não" é a fatia inteira
-- ----------------------------------------------------------------------------
-- Ela não apaga, não trunca, não desliga e não zera NADA de tenant nenhum.
-- Suspender uma empresa inadimplente é escrever `'suspensa'` numa coluna desta
-- tabela nova; nenhum dado do cliente é tocado, nem aqui nem no código. As três
-- suspensões destrutivas recusadas estão escritas no `schema.prisma`, no
-- cabeçalho do bloco — esvaziar `Org.modulos`, derrubar `Org.isActive` e revogar
-- as credenciais do cofre.
--
-- E não há `ON DELETE CASCADE` em lugar nenhum: as duas chaves estrangeiras são
-- `RESTRICT`. Apagar a `Org` de um cliente com assinatura passa a FALHAR em vez
-- de levar a cobrança junto — que é o comportamento certo para uma tabela cuja
-- razão de existir é não perder o histórico de quem pagou o quê.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
-- O Prisma não tem migration de descida, e migration aplicada é IMUTÁVEL (o
-- banco guarda o resumo; editar o arquivo depois faz o banco continuar com o SQL
-- antigo enquanto o arquivo mostra o novo). Então o caminho de volta é escrito:
--
--   DROP TABLE "CobrancaDeAssinatura";
--   DROP TABLE "Assinatura";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260911233000_assinatura_e_cobranca';
--
-- As policies somem junto com as tabelas. Nenhuma tabela preexistente é alterada
-- por esta migration, então desfazer não encosta em dado de ninguém.
-- ============================================================================

-- CreateTable
CREATE TABLE "Assinatura" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "plano" TEXT NOT NULL,
    -- Dinheiro em INTEIRO, em centavos. Ponto flutuante é como R$ 0,01 vira
    -- 0,009999 e a conferência contra o provedor passa a falhar por
    -- arredondamento, num lugar onde falhar significa suspender quem pagou.
    "valorCentavos" INTEGER NOT NULL,
    "ciclo" TEXT NOT NULL DEFAULT 'mensal',
    "status" TEXT NOT NULL DEFAULT 'ativa',
    "diasDeCarencia" INTEGER NOT NULL DEFAULT 7,
    "provedor" TEXT NOT NULL DEFAULT 'asaas',
    -- ENDEREÇOS no provedor, nunca credencial. A chave de API mora no cofre
    -- (`SegredoDeConector`, conector `asaas`), cifrada e por empresa.
    "provedorClienteId" TEXT,
    "provedorAssinaturaId" TEXT,
    -- NULA de propósito enquanto ninguém conseguiu perguntar ao provedor. Ver a
    -- nota no schema: um DEFAULT aqui mentiria "já foi conferida".
    "conferidaEm" TIMESTAMP(3),
    "suspensaEm" TIMESTAMP(3),
    "suspensaPorCobrancaId" TEXT,
    "motivoDaSuspensao" TEXT,
    "reativadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- UMA assinatura por empresa. Duas seriam duas respostas para "esta empresa
-- está suspensa?", e o gate leria a primeira que o banco devolvesse.
CREATE UNIQUE INDEX "Assinatura_orgId_key" ON "Assinatura"("orgId");

-- CreateIndex
CREATE INDEX "Assinatura_orgId_status_idx" ON "Assinatura"("orgId", "status");

-- CreateTable
CREATE TABLE "CobrancaDeAssinatura" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assinaturaId" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "pagoEm" TIMESTAMP(3),
    "sincronizadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CobrancaDeAssinatura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- É ESTE ÍNDICE QUE TORNA A SINCRONIZAÇÃO IDEMPOTENTE. O espelho grava por
-- `upsert` em (empresa, referência): conferir duas vezes, ou duas conferências
-- simultâneas, atualizam a MESMA linha em vez de criar duas cobranças iguais —
-- e duas cobranças iguais, uma paga e outra em aberto, suspenderiam quem pagou.
CREATE UNIQUE INDEX "CobrancaDeAssinatura_orgId_referencia_key"
  ON "CobrancaDeAssinatura"("orgId", "referencia");

-- CreateIndex
CREATE INDEX "CobrancaDeAssinatura_orgId_status_vencimento_idx"
  ON "CobrancaDeAssinatura"("orgId", "status", "vencimento");

-- CreateIndex
CREATE INDEX "CobrancaDeAssinatura_assinaturaId_vencimento_idx"
  ON "CobrancaDeAssinatura"("assinaturaId", "vencimento");

-- AddForeignKey
ALTER TABLE "Assinatura" ADD CONSTRAINT "Assinatura_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CobrancaDeAssinatura" ADD CONSTRAINT "CobrancaDeAssinatura_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CobrancaDeAssinatura" ADD CONSTRAINT "CobrancaDeAssinatura_assinaturaId_fkey"
  FOREIGN KEY ("assinaturaId") REFERENCES "Assinatura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- O VOCABULÁRIO DE ESTADO, NO BANCO
--
-- Texto com CHECK, e não `enum` do Prisma. O CHECK dá a mesma garantia (estado
-- fora do vocabulário não entra) sem criar um tipo do Postgres: acrescentar
-- valor a um `enum` exige `ALTER TYPE ... ADD VALUE`, que **não roda dentro de
-- transação** — e migration do Prisma roda dentro de uma. O precedente está em
-- `20260911060000_rastro_retencao_e_expurgo`, que trava `dias` do mesmo jeito.
--
-- POR QUE ISTO NÃO É ZELO. `status` é o que o gate de suspensão lê. Um valor
-- escrito errado — `'Suspensa'`, `'suspenso'`, `'SUSPENSA'` — não casaria com a
-- comparação do código e a empresa suspensa continuaria com acesso total, em
-- silêncio. O CHECK transforma isso num erro de escrita, no ato.
--
-- `diasDeCarencia` não aceita negativo: carência negativa é suspender ANTES de
-- vencer, que não é uma política de cobrança, é um defeito. O teto de 365 é
-- arbitrário e serve só para que um `36500` digitado por engano não vire
-- "nunca suspende" sem ninguém perceber.
-- ---------------------------------------------------------------------------
ALTER TABLE "Assinatura" ADD CONSTRAINT "Assinatura_status_check"
  CHECK ("status" IN ('ativa', 'inadimplente', 'suspensa', 'cancelada'));

ALTER TABLE "Assinatura" ADD CONSTRAINT "Assinatura_ciclo_check"
  CHECK ("ciclo" IN ('mensal', 'anual'));

ALTER TABLE "Assinatura" ADD CONSTRAINT "Assinatura_carencia_check"
  CHECK ("diasDeCarencia" >= 0 AND "diasDeCarencia" <= 365);

ALTER TABLE "Assinatura" ADD CONSTRAINT "Assinatura_valor_check"
  CHECK ("valorCentavos" >= 0);

ALTER TABLE "CobrancaDeAssinatura" ADD CONSTRAINT "CobrancaDeAssinatura_status_check"
  CHECK ("status" IN ('aberta', 'paga', 'vencida', 'cancelada'));

ALTER TABLE "CobrancaDeAssinatura" ADD CONSTRAINT "CobrancaDeAssinatura_valor_check"
  CHECK ("valorCentavos" >= 0);

-- ---------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA — modo forçado, duas políticas, nas DUAS tabelas
--
-- `app_rls_aplicar_policies` veio da migration do isolamento e faz o pacote
-- inteiro: DROP POLICY IF EXISTS (idempotente), CREATE POLICY de SELECT, INSERT,
-- UPDATE e DELETE, ENABLE e FORCE. Os argumentos são as mesmas expressões do
-- grupo padrão de lá: a empresa da sessão alcança o que é dela, e nada mais.
--
-- NENHUMA SENTINELA AQUI — nem a pública, nem a de plataforma.
--
--  · A PÚBLICA (`__resolucao_publica__`) libera três tabelas em colunas mínimas
--    para DESCOBRIR de quem é uma requisição anônima. Nada nesta fatia é
--    anônimo: quem pergunta pela própria assinatura já entrou no sistema, e a
--    empresa dele já está resolvida no contexto. Abrir a sentinela aqui daria a
--    qualquer rota pública a lista de quem paga quanto, e quem está suspenso —
--    que é informação comercial de todos os clientes de uma vez.
--  · A DE PLATAFORMA tem lista fechada de chamadores e abre o contexto INTEIRO.
--    Entrar nela por causa de cobrança seria pagar com o isolamento de tudo por
--    uma conveniência de uma tabela.
--
-- E o caminho que de fato precisaria atravessar empresas — "quais assinaturas
-- vencem hoje?", se um dia existir varredura de plataforma — não passa por
-- sentinela nenhuma: roda com a conexão DONA, fora do alcance de requisição
-- HTTP, como já faz a rotação de chave do cofre.
--
-- LEITURA e ESCRITA são iguais em texto e diferentes em papel: a de escrita vira
-- `WITH CHECK` no INSERT e no UPDATE, que é o que impede uma empresa de mover a
-- própria cobrança para dentro de outra.
-- ---------------------------------------------------------------------------
SELECT app_rls_aplicar_policies(
  'Assinatura',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

SELECT app_rls_aplicar_policies(
  'CobrancaDeAssinatura',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

-- ---------------------------------------------------------------------------
-- PERMISSÃO DO PAPEL RESTRITO
--
-- `20260911020000_papel_de_aplicacao` deixou `ALTER DEFAULT PRIVILEGES` ligado
-- para `mktos_app`, então tabela criada por `mkt` já nasce com os GRANTs. O
-- GRANT explícito existe para o caso em que ela NÃO nasceu assim — banco
-- restaurado de dump, ou migration do papel aplicada por outro usuário. É
-- idempotente e não custa nada.
--
-- Guardado por `pg_roles`: em banco onde o papel não existe (o Mac de quem só
-- roda a suíte padrão), GRANT para papel inexistente aborta a migration — e
-- migration que aborta no `command` do container é a API não subir.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "Assinatura" TO mktos_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "CobrancaDeAssinatura" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — a mesma pergunta da 1.5, sobre estas duas tabelas
--
-- Falha ALTA de propósito: se a chamada acima deixar de existir num rebase mal
-- resolvido, é melhor a migration abortar aqui do que a tabela que diz QUEM ESTÁ
-- SUSPENSO entrar em produção legível e GRAVÁVEL por qualquer empresa — uma
-- empresa que alcançasse a linha de outra poderia reativar a si mesma.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tab text;
  ok  boolean;
BEGIN
  FOREACH tab IN ARRAY ARRAY['Assinatura', 'CobrancaDeAssinatura'] LOOP
    SELECT c.relrowsecurity
       AND c.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
      INTO ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = tab;

    IF NOT COALESCE(ok, false) THEN
      RAISE EXCEPTION
        '% ficou sem isolamento por linha (rls/force/policies). Tabela que decide acesso sem policy e vazamento, nao pendencia.', tab;
    END IF;
  END LOOP;
END $$;
