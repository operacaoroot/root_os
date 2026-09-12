-- ============================================================================
-- O MAPA PÚBLICO, MARCADO POR REGISTRO — fatia 6.5 (degrau 0 da esteira)
--
-- Cria `MapaPublicoItem`, a ÚNICA tabela que a página pública da raiz lê, e a
-- deixa nascer já isolada: `ENABLE` + `FORCE ROW LEVEL SECURITY` e as duas
-- políticas, na MESMA migration que cria a tabela.
--
-- POR QUE ISSO NÃO É ZELO, É PRÉ-REQUISITO DE ARRANQUE. A migration
-- `20260911050000_isolamento_por_linha` termina com uma conferência que percorre
-- o catálogo e ABORTA se achar tabela de `public` com coluna de empresa e sem
-- RLS/FORCE/policy. Ela já rodou e não vê esta tabela (que nasce depois) — mas
-- num banco recriado do zero ela volta a rodar ANTES desta, e a catraca
-- permanente (`apps/api/test/tenant-isolation.test.ts`) pergunta ao catálogo a
-- mesma coisa a cada suíte. Tabela de empresa sem policy é vazamento, não
-- pendência. E migration que aborta roda no `command` do container: abortar é a
-- API não subir.
--
-- ESCRITA À MÃO, e não por `prisma migrate dev`. Outras três fatias desta onda
-- criam modelo no mesmo arquivo de schema; a geração automática compara o schema
-- INTEIRO com o banco e engoliria os modelos delas aqui dentro.
--
-- PROVADA EM BANCO PRÓPRIO (`prova_65` no container `mktos-shadow`), do zero,
-- com o histórico inteiro aplicado antes.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTA TABELA GUARDA, E POR QUE ELA EXISTE EM VEZ DE UMA COLUNA
-- ----------------------------------------------------------------------------
-- Um nó do mapa que aparece na entrada pública: o eixo a que ele pertence, o
-- rótulo escrito à mão, a segunda linha, a cor, a posição e — quando é um
-- número — a CHAVE de uma leitura agregada do registro em código.
--
-- A alternativa curta era um `publico BOOLEAN` espalhado pelas tabelas de
-- domínio (nota do contexto, agente, rotina). Ela foi recusada por duas razões
-- que não se resolvem com disciplina:
--
--   1. O TEXTO PASSARIA A SER O DO REGISTRO INTERNO. Renomear uma nota, colar o
--      nome de um cliente na missão de um agente, colar um número na descrição
--      de uma rotina — tudo isso publicaria na hora, sem ninguém marcar nada.
--      Aqui o texto que aparece é o texto que alguém escreveu PARA aparecer.
--   2. A PÁGINA PRECISARIA LER AS TABELAS DE DOMÍNIO. Ler três tabelas com um
--      filtro de "público" em cada é três lugares para esquecer o filtro; ler
--      UMA tabela cujo conteúdo inteiro foi escrito para ser público é um lugar
--      só, e o esquecimento vira rascunho aparecendo — que é o que o teste
--      cobra (`apps/api/test/mapa-publico.test.ts`).
--
-- A MARCA É `publicadoEm`, NÃO A EXISTÊNCIA DA LINHA. Linha sem `publicadoEm` é
-- RASCUNHO: existe, e não aparece em lugar nenhum público. É de propósito, e é
-- o que dá ao teste um controle negativo de verdade — um registro que ESTÁ no
-- caminho da consulta e mesmo assim não sai.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
-- O Prisma não tem migration de descida, e migration aplicada é IMUTÁVEL (o
-- banco guarda o resumo; editar o arquivo depois faz o banco continuar com o SQL
-- antigo enquanto o arquivo mostra o novo). Então o caminho de volta é escrito:
--
--   DROP TABLE "MapaPublicoItem";
--   DELETE FROM "_prisma_migrations"
--    WHERE migration_name = '20260911234500_mapa_publico_marcado_por_registro';
--
-- A policy some junto com a tabela. Nada de nenhuma outra tabela é alterado
-- aqui, então desfazer não perde nada além do mapa publicado.
-- ============================================================================

-- CreateTable
CREATE TABLE "MapaPublicoItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    -- O eixo do mapa. Texto e não enum: eixo novo é decisão editorial, não
    -- migration de tipo. `nucleo` é reservado — é o centro.
    "eixo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "rotulo" TEXT NOT NULL,
    "detalhe" TEXT,
    "tom" TEXT NOT NULL DEFAULT 'muted',
    -- A chave da leitura agregada (registro fechado em `src/public-map/fontes.ts`).
    -- Nulo = nó sem número. Chave fora do registro não mostra número e não
    -- derruba a página.
    "fonte" TEXT,
    -- A MARCA. Nulo = rascunho.
    "publicadoEm" TIMESTAMP(3),
    "publicadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapaPublicoItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MapaPublicoItem_orgId_chave_key" ON "MapaPublicoItem"("orgId", "chave");

-- CreateIndex
--
-- A consulta da página, inteira: empresa, publicados, na ordem do desenho. É a
-- única consulta que esta tabela serve em produção, e ela roda para qualquer
-- visitante da internet — por isso o índice cobre o filtro E a ordenação.
CREATE INDEX "MapaPublicoItem_orgId_publicadoEm_eixo_ordem_idx"
  ON "MapaPublicoItem"("orgId", "publicadoEm", "eixo", "ordem");

-- AddForeignKey
--
-- RESTRICT na empresa, como em todo o resto do schema: apagar uma empresa que
-- tem mapa publicado continua sendo recusado.
ALTER TABLE "MapaPublicoItem" ADD CONSTRAINT "MapaPublicoItem_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA — modo forçado, duas políticas
--
-- `app_rls_aplicar_policies` veio da migration do isolamento e faz o pacote
-- inteiro: DROP POLICY IF EXISTS (idempotente), CREATE POLICY de SELECT, INSERT,
-- UPDATE e DELETE, ENABLE e FORCE. Os argumentos são as expressões do grupo
-- PADRÃO de lá: a empresa da sessão alcança o que é dela, e nada mais.
--
-- NENHUMA SENTINELA AQUI — e essa é a decisão que mais importa deste arquivo.
--
-- A rota pública do mapa NÃO precisa da sentinela porque ela segue o desenho de
-- duas metades que `src/common/tenant-publico.ts` já estabeleceu na onda 4:
--
--   1. uma consulta de RESOLUÇÃO, curta, sob a sentinela — aqui é
--      `resolverOrgDoSlugInterno`, que a sentinela já libera (`Org` por `slug`)
--      e que devolve só o ENDEREÇO da empresa;
--   2. TODO o resto dentro de `comTenantPublico`, já com a empresa no contexto.
--
-- Do passo 2 em diante a rota é indistinguível de uma autenticada: o
-- `SET LOCAL app.org_id` sai com a empresa certa e a policy padrão basta.
-- Acrescentar `public.app_resolucao_publica()` à leitura desta tabela seria
-- alargar a sentinela — que hoje enxerga TODAS as linhas de TODAS as empresas
-- das três tabelas que alcança — por conveniência, e sem necessidade nenhuma.
-- ---------------------------------------------------------------------------
SELECT app_rls_aplicar_policies(
  'MapaPublicoItem',
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
-- Guardado por `pg_roles`: em banco onde o papel não existe (o Mac de quem só
-- roda a suíte padrão), GRANT para papel inexistente aborta a migration — e
-- migration que aborta no `command` do container é a API não subir.
--
-- SELECT, INSERT, UPDATE e DELETE, e não só SELECT: a API só LÊ esta tabela
-- hoje, mas a tela de publicar (autenticada) é o passo seguinte declarado, e
-- voltar aqui para acrescentar GRANT exigiria outra migration — enquanto a
-- policy acima já contém o que esse GRANT permite à empresa da sessão.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "MapaPublicoItem" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- O PRIMEIRO MAPA DA ROOT
--
-- Sem linha nenhuma a raiz do domínio mostra um mapa vazio — que é o
-- comportamento CERTO (nada aparece sem marca) e uma péssima porta de entrada.
-- Estas linhas são o mapa inicial, e nada aqui é dado de cliente: é texto
-- escrito para aparecer, mais quatro CHAVES de leitura agregada, cujos números
-- a página busca ao vivo.
--
-- SÓ PARA A EMPRESA DE `slug = 'root'`, e só se ela existir: é a empresa da
-- casa (a mesma constante que o pixel usa como padrão, `ORG_LEGADA_DO_PIXEL`).
-- Em banco de cliente, de teste ou recém-criado, o INSERT não escreve nada.
--
-- ON CONFLICT DO NOTHING: reaplicar num banco que já tem o mapa não sobrescreve
-- o que uma pessoa editou depois. A chave é `(orgId, chave)`.
-- ---------------------------------------------------------------------------
INSERT INTO "MapaPublicoItem" (
  "id", "orgId", "eixo", "chave", "ordem", "rotulo", "detalhe", "tom", "fonte",
  "publicadoEm", "publicadoPor", "criadoEm", "atualizadoEm"
)
SELECT
  gen_random_uuid()::text,
  o."id",
  v."eixo",
  v."chave",
  v."ordem",
  v."rotulo",
  v."detalhe",
  v."tom",
  v."fonte",
  CURRENT_TIMESTAMP,
  'migration:20260911234500_mapa_publico_marcado_por_registro',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
-- A CONVENÇÃO DAS CHAVES, que o desenho lê (ver `src/public-map/mapa-publico.ts`):
--   · `eixo='nucleo'` e `chave='nucleo'` → o CENTRO do mapa;
--   · `chave` IGUAL ao `eixo`            → a CABEÇA do eixo: ela dá o nome do
--     eixo e a `ordem` dela é a ordem do eixo em volta do centro. Não vira ponto.
--   · qualquer outra                     → um ponto daquele eixo.
FROM "Org" o
CROSS JOIN (
  VALUES
    ('nucleo',   'nucleo',           0, 'ROOT',
     'a operação que roda dentro do próprio sistema que vende', 'brand', NULL),

    ('agentes',  'agentes',          0, 'Agentes',
     'quem trabalha aqui', 'muted', NULL),
    ('agentes',  'agentes-rodando',  1, 'Em produção',
     'cada um com missão, dono e teto de autonomia declarados', 'good', 'agentes.rodando'),
    ('agentes',  'agentes-donos',    2, 'Todo agente tem dono',
     'nenhum roda sem uma pessoa responsável por ele', 'muted', NULL),

    ('rotinas',  'rotinas',          1, 'Rotinas',
     'o relógio da operação', 'muted', NULL),
    ('rotinas',  'rotinas-rodando',  1, 'No relógio',
     'trabalho que acontece sozinho, com histórico de cada passagem', 'good', 'rotinas.rodando'),

    ('contexto', 'contexto',         2, 'Contexto',
     'o que o sistema sabe da operação', 'muted', NULL),
    ('contexto', 'contexto-itens',   1, 'Itens versionados',
     'com procedência, autor e data — nunca um monte de texto solto', 'info', 'contexto.itens'),

    ('regua',    'regua',            3, 'Régua',
     'R0–R5, a escada de risco', 'muted', NULL),
    ('regua',    'regua-r0-r5',      1, 'Toda ação classificada',
     'o risco é decidido ANTES de a ação acontecer', 'brand', NULL),
    ('regua',    'aprovacao-humana', 2, 'R3+ pede gente',
     'escrita para fora do sistema não sai sem alguém confirmar', 'brand', NULL),

    ('rastro',   'rastro',           4, 'Rastro',
     'quem fez, quando, com que autonomia', 'muted', NULL),
    ('rastro',   'rastro-30d',       1, 'Eventos em 30 dias',
     'encadeados por hash — e não dá para apagar', 'info', 'rastro.eventos.30d')
) AS v("eixo", "chave", "ordem", "rotulo", "detalhe", "tom", "fonte")
WHERE o."slug" = 'root'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — a mesma pergunta da 1.5, só que sobre esta tabela
--
-- Falha ALTA de propósito: se a chamada acima deixar de existir num rebase mal
-- resolvido, é melhor a migration abortar aqui do que uma tabela de empresa
-- entrar em produção legível por qualquer outra.
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
   WHERE n.nspname = 'public' AND c.relname = 'MapaPublicoItem';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'MapaPublicoItem ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
