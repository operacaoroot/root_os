-- ============================================================================
-- DESLIGAR UM CONECTOR, POR EMPRESA (RF-G-06) — fatia 3.7
--
-- Cria `ConectorDesligado` e a deixa nascer JÁ ISOLADA: `ENABLE` + `FORCE ROW
-- LEVEL SECURITY` e as duas políticas (leitura e escrita), na mesma migration
-- que cria a tabela.
--
-- POR QUE ISSO NÃO É ZELO, É PRÉ-REQUISITO DE ARRANQUE. A migration
-- `20260911050000_isolamento_por_linha` termina com uma conferência que percorre
-- o catálogo e ABORTA se achar tabela de `public` sem RLS/FORCE/policy. Ela já
-- rodou e não vê esta tabela (que nasce depois) — mas a catraca permanente vê:
-- `apps/api/test/tenant-isolation.test.ts` pergunta ao catálogo a mesma coisa, e
-- num banco recriado do zero a conferência da 1.5 volta a rodar antes desta.
-- Tabela de empresa sem policy é vazamento, não pendência.
--
-- ESCRITO À MÃO, e não por `prisma migrate dev`. Três fatias desta onda criam
-- tabela no mesmo arquivo de schema; a geração automática compara o schema
-- INTEIRO com o banco e engoliria os modelos das outras duas aqui dentro.
--
-- PROVADA EM BANCO PRÓPRIO (`prova_37` no container `mktos-shadow`), do zero e
-- sobre banco povoado, com o papel restrito `mktos_app` — não com o dono, que
-- atravessa policy e não exercita nada.
-- ============================================================================

-- CreateTable
CREATE TABLE "ConectorDesligado" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "conector" TEXT NOT NULL,
    "motivo" TEXT,
    "desligadoPor" TEXT,
    "desligadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConectorDesligado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConectorDesligado_orgId_idx" ON "ConectorDesligado"("orgId");

-- CreateIndex
--
-- É ele que sustenta a promessa de "segundos": a consulta do desligamento é
-- `WHERE "orgId" = $1` numa tabela com no máximo uma linha por conector por
-- empresa (16 conectores hoje). Índice presente = leitura por empresa sem
-- varredura, e é por isso que esta fatia NÃO guarda a resposta em memória.
CREATE UNIQUE INDEX "ConectorDesligado_orgId_conector_key" ON "ConectorDesligado"("orgId", "conector");

-- AddForeignKey
ALTER TABLE "ConectorDesligado" ADD CONSTRAINT "ConectorDesligado_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA — modo forçado, duas políticas
--
-- `app_rls_aplicar_policies` veio da migration do isolamento e faz o pacote
-- inteiro: DROP POLICY IF EXISTS (idempotente), CREATE POLICY de SELECT, INSERT,
-- UPDATE e DELETE, ENABLE e FORCE. Os argumentos são as mesmas expressões do
-- grupo padrão de lá: a empresa da sessão alcança o que é dela, e nada mais.
--
-- NENHUMA SENTINELA AQUI, nem a pública nem a de plataforma. Desligamento de
-- conector não é lido por rota pública e não é consultado antes de haver
-- empresa: quem pergunta é a porta, que já resolveu o tenant. Sentinela em
-- policy de leitura abre a tabela INTEIRA para quem rodar sob ela — foi o furo
-- que reprovou a primeira versão da fatia 1.4, e não há motivo para repetir o
-- risco por uma tabela que ninguém lê sem empresa.
--
-- LEITURA e ESCRITA são iguais em texto e diferentes em papel: a de escrita vira
-- `WITH CHECK` no INSERT e no UPDATE, que é o que impede uma empresa de mover a
-- própria linha para dentro de outra.
-- ---------------------------------------------------------------------------
SELECT app_rls_aplicar_policies(
  'ConectorDesligado',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

-- ---------------------------------------------------------------------------
-- PERMISSÃO DO PAPEL RESTRITO
--
-- `20260911020000_papel_de_aplicacao` deixou `ALTER DEFAULT PRIVILEGES` ligado
-- para `mktos_app`, então uma tabela criada por `mkt` já nasce com os GRANTs.
-- O GRANT explícito abaixo existe para o caso em que ela NÃO nasceu assim — um
-- banco restaurado de dump, um ambiente em que a migration do papel foi aplicada
-- por outro usuário. É idempotente e não custa nada.
--
-- Guardado por `has_role`: em banco onde o papel não existe (o Mac de quem só
-- roda a suíte padrão), GRANT para papel inexistente aborta a migration — e
-- migration que aborta no `command` do container é a API não subir.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "ConectorDesligado" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — a mesma pergunta da 1.5, só que sobre esta tabela
--
-- Falha ALTA de propósito: se a chamada acima deixar de existir num rebase mal
-- resolvido, é melhor a migration abortar aqui do que a tabela entrar em
-- produção legível por qualquer empresa.
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
   WHERE n.nspname = 'public' AND c.relname = 'ConectorDesligado';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'ConectorDesligado ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
