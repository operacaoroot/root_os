-- ============================================================================
-- ROTINAS POR EMPRESA, COM ESTADO EXPLÍCITO (RF-N-04) — fatia 5.1
--
-- Cria `Rotina` e `RotinaExecucao` e as deixa nascer JÁ ISOLADAS: `ENABLE` +
-- `FORCE ROW LEVEL SECURITY` e as duas políticas, na MESMA migration que cria a
-- tabela.
--
-- POR QUE ISSO NÃO É ZELO, É PRÉ-REQUISITO DE ARRANQUE. A migration
-- `20260911050000_isolamento_por_linha` termina com uma conferência que percorre
-- o catálogo e ABORTA se achar tabela de `public` com coluna de empresa e sem
-- RLS/FORCE/policy. Ela já rodou e não vê estas tabelas (que nascem depois) —
-- mas num banco recriado do zero ela volta a rodar ANTES desta, e a catraca
-- permanente (`apps/api/test/tenant-isolation.test.ts`) pergunta ao catálogo a
-- mesma coisa a cada suíte. Tabela de empresa sem policy é vazamento, não
-- pendência. E migration que aborta roda no `command` do container: abortar é a
-- API não subir.
--
-- ESCRITA À MÃO, e não por `prisma migrate dev`. Outra fatia desta onda cria
-- modelo no mesmo arquivo de schema; a geração automática compara o schema
-- INTEIRO com o banco e engoliria os modelos dela aqui dentro.
--
-- PROVADA EM BANCO PRÓPRIO (`prova_51` no container `mktos-shadow`), do zero,
-- com o histórico inteiro aplicado antes.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTAS DUAS TABELAS GUARDAM, EM UMA FRASE
-- ----------------------------------------------------------------------------
-- `Rotina`: o trabalho que acontece sozinho numa empresa — quando dispara
-- (cron + fuso), se está em produção ou em observação (`estado`), quem o
-- representa no organograma (`agenteSlug`) e quanto tempo de gente ele devolve
-- (`minutosPorExecucao`). `RotinaExecucao`: cada passagem dela, com início, fim,
-- desfecho e a correlação que amarra a passagem aos eventos que ela gerou.
--
-- A RELAÇÃO COM `PautaRotina`, que NÃO é tocada aqui: `PautaRotina` continua
-- sendo a fonte da CONFIGURAÇÃO da pauta (é ela que a tela de Pauta cria e
-- edita). A `Rotina` correspondente é um ESPELHO, reconciliado a cada tique pelo
-- agendador (`origem = 'pauta'`, `refExterna` = id da `PautaRotina`). O INSERT
-- do fim desta migration faz a primeira reconciliação — não porque o código
-- dependa dela, mas para que a tela `/rotinas` mostre a rotina da pauta já no
-- primeiro minuto depois do deploy, em vez de uma tela vazia com ar de defeito.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
-- O Prisma não tem migration de descida, e migration aplicada é IMUTÁVEL (o
-- banco guarda o resumo; editar o arquivo depois faz o banco continuar com o SQL
-- antigo enquanto o arquivo mostra o novo). Então o caminho de volta é escrito:
--
--   DROP TABLE "RotinaExecucao";
--   DROP TABLE "Rotina";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260911170000_rotinas_por_empresa';
--
-- As policies somem junto com as tabelas. NADA de `PautaRotina`, `PautaRodada`
-- ou `Agent` é alterado aqui, então desfazer não perde configuração nenhuma — só
-- o histórico de execução acumulado desde o deploy.
-- ============================================================================

-- CreateTable
CREATE TABLE "Rotina" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    -- A chave do executor no registro em código. Texto e não enum: executor novo
    -- é código novo, não migration de tipo.
    "tipo" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "cron" TEXT NOT NULL,
    "tz" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    -- Reusa o enum do roster de agentes: é o mesmo vocabulário (rodando ·
    -- aprendendo · planejado · pausado). `planejado` como default é deliberado —
    -- rotina nova não começa agindo.
    "estado" "AgentEstado" NOT NULL DEFAULT 'planejado',
    "origem" TEXT NOT NULL DEFAULT 'manual',
    "refExterna" TEXT,
    "agenteSlug" TEXT,
    "execucoes" INTEGER NOT NULL DEFAULT 0,
    "falhas" INTEGER NOT NULL DEFAULT 0,
    "ultimaExecucaoEm" TIMESTAMP(3),
    "ultimoStatus" TEXT,
    "proximaExecucaoEm" TIMESTAMP(3),
    "minutosPorExecucao" INTEGER NOT NULL DEFAULT 0,
    "baselinePorId" TEXT,
    "baselineEm" TIMESTAMP(3),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rotina_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotinaExecucao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rotinaId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'cron',
    "inicioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fimEm" TIMESTAMP(3),
    "duracaoMs" INTEGER,
    "resumo" TEXT,
    "erro" TEXT,
    "correlationId" TEXT,

    CONSTRAINT "RotinaExecucao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rotina_orgId_slug_key" ON "Rotina"("orgId", "slug");

-- CreateIndex
--
-- A chave da RECONCILIAÇÃO. `refExterna` é anulável e no PostgreSQL NULL não
-- colide com NULL, então rotinas `manual` (todas com `refExterna` nulo) convivem
-- à vontade — o que este índice impede é o caso que importa: dois tiques
-- concorrentes criando duas `Rotina` para a mesma `PautaRotina`.
CREATE UNIQUE INDEX "Rotina_orgId_origem_refExterna_key" ON "Rotina"("orgId", "origem", "refExterna");

-- CreateIndex
--
-- A consulta do TIQUE, que atravessa empresas: "quem pode disparar agora?". O
-- agendador roda fora de requisição e descobre as empresas pelas PRÓPRIAS
-- rotinas — não varre `Org`, que exigiria contexto de plataforma.
CREATE INDEX "Rotina_ativo_estado_idx" ON "Rotina"("ativo", "estado");

-- CreateIndex
CREATE INDEX "Rotina_orgId_estado_idx" ON "Rotina"("orgId", "estado");

-- CreateIndex
CREATE INDEX "RotinaExecucao_orgId_rotinaId_inicioEm_idx" ON "RotinaExecucao"("orgId", "rotinaId", "inicioEm");

-- CreateIndex
CREATE INDEX "RotinaExecucao_rotinaId_inicioEm_idx" ON "RotinaExecucao"("rotinaId", "inicioEm");

-- AddForeignKey
ALTER TABLE "Rotina" ADD CONSTRAINT "Rotina_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotinaExecucao" ADD CONSTRAINT "RotinaExecucao_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
--
-- CASCADE aqui, e RESTRICT na empresa: apagar uma rotina leva o diário de bordo
-- dela junto (é dela que ele fala e não sobrevive sozinho), enquanto apagar uma
-- EMPRESA com rotina continua sendo recusado, como em todo o resto do schema.
ALTER TABLE "RotinaExecucao" ADD CONSTRAINT "RotinaExecucao_rotinaId_fkey"
  FOREIGN KEY ("rotinaId") REFERENCES "Rotina"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA — modo forçado, duas políticas, nas DUAS tabelas
--
-- `app_rls_aplicar_policies` veio da migration do isolamento e faz o pacote
-- inteiro: DROP POLICY IF EXISTS (idempotente), CREATE POLICY de SELECT, INSERT,
-- UPDATE e DELETE, ENABLE e FORCE. Os argumentos são as mesmas expressões do
-- grupo padrão de lá: a empresa da sessão alcança o que é dela, e nada mais.
--
-- NENHUMA SENTINELA AQUI — nem a pública, nem a de plataforma. O agendador roda
-- fora de requisição e, por isso mesmo, abre o contexto DE CADA EMPRESA, uma de
-- cada vez, antes de tocar em qualquer linha (é o precedente do expurgo do
-- rastro e do agendador da pauta). Uma cláusula de sentinela na policy de
-- leitura seria o atalho que dispensaria essa disciplina — e dispensaria junto o
-- teto de custo de IA por empresa, que depende do mesmo contexto.
--
-- A ÚNICA consulta que roda sem empresa é a DESCOBERTA do tique
-- (`SELECT ... FROM "Rotina" WHERE ativo AND estado IN (...)`), e ela é a
-- pergunta que descobre quais empresas varrer. Sob o papel restrito ela volta
-- vazia — o agendador CONFERE isso e AVISA alto em vez de ficar quieto (ver
-- `src/routines/rotinas.scheduler.ts`), que é a diferença entre uma limitação
-- declarada e um agendador que não dispara nada em silêncio.
-- ---------------------------------------------------------------------------
SELECT app_rls_aplicar_policies(
  'Rotina',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

SELECT app_rls_aplicar_policies(
  'RotinaExecucao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

-- ---------------------------------------------------------------------------
-- PERMISSÃO DO PAPEL RESTRITO
--
-- `20260911020000_papel_de_aplicacao` deixou `ALTER DEFAULT PRIVILEGES` ligado
-- para `mktos_app`, então uma tabela criada por `mkt` já nasce com os GRANTs. O
-- GRANT explícito abaixo existe para o caso em que ela NÃO nasceu assim — um
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "Rotina" TO mktos_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "RotinaExecucao" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- A PRIMEIRA RECONCILIAÇÃO: A ROTINA DA PAUTA MIGRA
--
-- Toda `PautaRotina` que já existe ganha a `Rotina` espelho correspondente. É a
-- MESMA regra que o agendador aplica a cada tique — está aqui só para que a tela
-- não nasça vazia (ver o cabeçalho).
--
-- `estado` sai de `ativo` porque é a única coisa que a linha antiga sabia dizer:
-- rotina ligada estava em produção, rotina pausada estava pausada. `aprendendo`
-- e `planejado` são declaração de gente e ninguém pode declará-los por ela.
--
-- ON CONFLICT DO NOTHING: reaplicar num banco que já tem o espelho não duplica
-- nem sobrescreve o que uma pessoa configurou depois.
-- ---------------------------------------------------------------------------
INSERT INTO "Rotina" (
  "id", "orgId", "slug", "nome", "tipo", "config", "cron", "tz", "ativo",
  "estado", "origem", "refExterna", "agenteSlug",
  "ultimaExecucaoEm", "ultimoStatus", "proximaExecucaoEm",
  "criadaEm", "atualizadaEm"
)
SELECT
  gen_random_uuid()::text,
  r."orgId",
  'pauta-' || r."slug",
  r."nome",
  'pauta.rodada',
  COALESCE(r."config", '{}'::jsonb),
  r."cron",
  r."tz",
  r."ativo",
  (CASE WHEN r."ativo" THEN 'rodando' ELSE 'pausado' END)::"AgentEstado",
  'pauta',
  r."id",
  'editor-de-pauta',
  r."ultimoRun",
  r."ultimoStatus",
  r."proximoRun",
  COALESCE(r."criadaEm", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "PautaRotina" r
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — a mesma pergunta da 1.5, só que sobre estas tabelas
--
-- Falha ALTA de propósito: se a chamada acima deixar de existir num rebase mal
-- resolvido, é melhor a migration abortar aqui do que uma tabela de empresa
-- entrar em produção legível por qualquer outra.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alvo text;
  ok   boolean;
BEGIN
  FOREACH alvo IN ARRAY ARRAY['Rotina', 'RotinaExecucao'] LOOP
    SELECT c.relrowsecurity
       AND c.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
      INTO ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = alvo;

    IF NOT COALESCE(ok, false) THEN
      RAISE EXCEPTION
        '% ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.', alvo;
    END IF;
  END LOOP;
END $$;
