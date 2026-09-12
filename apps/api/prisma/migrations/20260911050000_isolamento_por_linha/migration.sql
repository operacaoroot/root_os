-- ============================================================================
-- ISOLAMENTO POR LINHA, TABELA A TABELA (RF-T-02, RF-T-03)
--
-- Esta é a migration que faz o PostgreSQL — e não a disciplina de quem escreve
-- `where: { orgId }` — ser o guarda do multiempresa. Ela liga
-- `ROW LEVEL SECURITY` com `FORCE` nas 72 tabelas do schema `public` e escreve
-- as políticas de cada uma, separadas em LEITURA e ESCRITA.
--
-- O QUE JÁ ESTAVA NO LUGAR, e sem o que isto aqui não seria nada:
--   · a empresa da requisição viaja até a CONEXÃO como `app.org_id`, via
--     `SET LOCAL`, em toda consulta (`src/prisma/sessao-de-banco.ts`, fatia 1.3);
--   · existe um papel restrito `mktos_app`, NOBYPASSRLS e não dono das tabelas
--     (migration `20260911020000_papel_de_aplicacao`, fatia 1.3);
--   · toda linha filha carrega `orgId` próprio, mantido por gatilho
--     (`20260910120000_orgid_em_todo_filho`, fatia 1.1);
--   · a rota pública RESOLVE a empresa antes de fazer qualquer outra coisa, sob
--     um estado declarado — a sentinela (`src/common/tenant-publico.ts`, 1.4).
--
-- ----------------------------------------------------------------------------
-- POR QUE ISTO NÃO DERRUBA A PRODUÇÃO NO DEPLOY SEGUINTE — leia antes de mexer
-- ----------------------------------------------------------------------------
-- `prisma migrate deploy` roda no `command` do container da api. Uma migration
-- que ligasse o isolamento para a conexão que a API usa HOJE tiraria o login do
-- ar no primeiro arranque, e consertar exigiria acesso ao banco com a API caída.
--
-- Não é o caso, e o motivo é verificável em vez de otimista: a API conecta com
-- `DB_USER` (padrão `mkt`), que é o `POSTGRES_USER` da imagem
-- `pgvector/pgvector:pg16` — e o entrypoint dessa imagem cria esse usuário como
-- SUPERUSUÁRIO. **Superusuário atravessa policy de linha mesmo com FORCE.**
-- Conferido em 11/09/2026: `SELECT rolsuper FROM pg_roles WHERE rolname='mkt'`
-- devolve `t`. Então, no dia em que esta migration aplicar:
--
--   · a API segue funcionando exatamente como antes (conexão superusuária);
--   · `prisma migrate deploy`, `db:seed`, `db:seed:politica` e os scripts de
--     `src/scripts/` seguem funcionando (mesma conexão);
--   · o papel `mktos_app` — que ninguém usa ainda, porque `DB_APP_PASSWORD` não
--     está preenchida — passa a ser COMPLETAMENTE isolado.
--
-- E o estado inerte não fica escondido: o arranque da API já anuncia
-- "ISOLAMENTO POR LINHA INERTE" com o motivo (`anunciarPapel` em
-- `src/prisma/sessao-de-banco.ts`), e a suíte de isolamento REPROVA se a conexão
-- de leitura dela for a dona das tabelas.
--
-- SE O SEU POSTGRES NÃO DER SUPERUSUÁRIO AO DONO (banco gerenciado), o FORCE
-- passa a valer para ele e a virada acontece no deploy, não na hora que você
-- escolher. Nesse caso: `SELECT app_rls_desligar();` imediatamente depois do
-- deploy, e ligue de novo quando os caminhos de plataforma estiverem declarados
-- (lista logo abaixo).
--
-- ----------------------------------------------------------------------------
-- A VIRADA DE VERDADE É OUTRO DIA, E TEM PRÉ-REQUISITOS
-- ----------------------------------------------------------------------------
-- O isolamento só passa a valer para a aplicação quando ela deixar de conectar
-- como dona — `deploy/papel-app.sh`, `DB_APP_USER`/`DB_APP_PASSWORD` no `.env` e
-- container recriado. ANTES disso, três coisas precisam estar prontas, e nenhuma
-- delas é desta migration:
--
--   1. OS CAMINHOS DE PLATAFORMA precisam declarar o contexto de plataforma
--      (`src/prisma/contexto-de-plataforma.ts`). São consultas que rodam antes de
--      haver empresa porque é ELAS que descobrem a empresa. Hoje só a
--      reindexação do Obsidian declara. Faltam:
--        · `src/auth/auth.service.ts`            — login por e-mail
--        · `src/auth/google-login.service.ts`    — login com Google
--        · `src/tenants/provisionar.ts`          — `acharOrg` pelo slug
--        · `src/integrations/clickup.service.ts` — empresa da casa por slug
--        · `src/finance/finance.service.ts`      — empresa da casa por slug
--        · `src/policy/policy.service.ts`        — `PolicyVersion` base no arranque
--        · `src/health/health.controller.ts`     — a sonda `SELECT 1`
--      Sem isso, sob `mktos_app`: o login não acha usuário, o provisionamento
--      acha que a empresa não existe e tenta criar duplicata, a política por
--      empresa deixa de valer (cai na base empacotada) e a rota de saúde reporta
--      banco fora do ar para sempre.
--
--      ISSO DEIXOU DE SER SÓ UMA LISTA EM COMENTÁRIO (correção de 11/09/2026).
--      Os sete caminhos acima estão versionados em
--      `CAMINHOS_DE_PLATAFORMA_EXIGIDOS` (`src/prisma/contexto-de-plataforma.ts`)
--      e são COMPARADOS NO ARRANQUE com os que de fato declaram
--      (`CHAMADORES_DE_PLATAFORMA`). Conexão restrita com a lista incompleta
--      **derruba o arranque** com o erro `CoberturaDePlataformaIncompletaError`,
--      que nomeia o que falta e diz como voltar. Conexão dona (o estado de hoje)
--      só registra o aviso e segue.
--
--      O motivo de a trava existir: a virada é DUAS VARIÁVEIS DE AMBIENTE. Sem
--      ela, quem preenchesse `DB_APP_USER`/`DB_APP_PASSWORD` achando que estava
--      fazendo a coisa segura derrubaria o login de todo mundo — e não veria
--      erro nenhum, porque policy de linha não recusa, ela recorta.
--   2. A FILA DE CONEXÕES precisa ser dimensionada. Cada consulta vira transação
--      com o `set_config` na frente e segura a conexão ~4x mais tempo; a vazão
--      medida caiu ~50% (ver o cabeçalho de `src/prisma/sessao-de-banco.ts`).
--   3. `TENANT_MODO=impor` deve ligar JUNTO. Sob RLS, consulta sem empresa
--      resolvida não lança: ela devolve ZERO LINHA, em silêncio — que é pior de
--      diagnosticar. O modo `impor` transforma isso em erro alto.
--
-- ----------------------------------------------------------------------------
-- COMO É A POLÍTICA DE CADA TABELA: DUAS, NUNCA UMA
-- ----------------------------------------------------------------------------
-- Uma policy por tabela, sem `FOR`, é `FOR ALL` — e numa policy `FOR ALL` sem
-- `WITH CHECK` **o Postgres reusa a cláusula de leitura como verificação de
-- escrita**. Com uma sentinela dentro dessa cláusula, qualquer código que
-- rodasse sob ela ganhava UPDATE, INSERT e DELETE em qualquer linha de qualquer
-- empresa — inclusive `Org.modulos`, que é o gate de módulos inteiro (RF-T-06).
-- Foi o furo que reprovou a primeira versão da fatia 1.4, medido e reproduzido
-- em `apps/api/test/rotas-publicas-tenant.test.ts`.
--
-- Aqui, então: LEITURA com as cláusulas de sentinela onde elas valem; ESCRITA
-- com `WITH CHECK` explícito, amarrada à empresa da sessão e SEM sentinela
-- nenhuma.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   SELECT app_rls_desligar();   -- tira ENABLE e FORCE de todas; policies ficam
--   SELECT app_rls_ligar();      -- põe de volta
--   SELECT * FROM app_rls_estado();  -- tabela, rls, force, nº de policies
--
-- Desligar NÃO apaga policy: policy sem RLS ligada é texto parado no catálogo, e
-- religar vira um comando só. Para desfazer de verdade (e aí sim perder as
-- expressões), `DROP POLICY tenant_leitura ON "<Tabela>"` etc.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. TEMPO LIMITE PARA PEGAR O BLOQUEIO — antes de qualquer DDL
--
-- `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY` pede ACCESS EXCLUSIVE, o
-- bloqueio mais forte: ele espera TODA consulta em curso na tabela terminar, e
-- enquanto espera ele mesmo enfileira as novas. São 72 tabelas. Num banco com
-- tráfego, a tabela mais movimentada do sistema fica atrás do `SELECT` mais
-- longo que estiver rodando — e como esta migration roda no `command` do
-- container da api, o resultado é um deploy PENDURADO, sem sintoma, segurando a
-- aplicação inteira junto.
--
-- Com tempo limite o mesmo cenário vira "a migration falha em 5 s com
-- `lock_not_available` (55P03), o container reinicia e tenta de novo". Falhar e
-- repetir é recuperável sozinho; pendurar não é. E o que se perde é nada: a
-- migration é idempotente do começo ao fim (o aplicador dá `DROP POLICY IF
-- EXISTS` antes de criar), então uma tentativa interrompida não deixa estado
-- meio aplicado.
--
-- 5 s é chute calibrado pelo tempo da própria migration (~1 s em banco vazio),
-- não por medição sob carga. Se um deploy começar a falhar por 55P03 de forma
-- repetida, o conserto NÃO é subir este número às cegas: é olhar a consulta
-- longa (`pg_stat_activity`) e rodar a migration numa janela calma.
--
-- `SET` de sessão e não `SET LOCAL`: se um dia o Prisma deixar de embrulhar o
-- arquivo numa transação, `SET LOCAL` viraria um WARNING sem efeito e o tempo
-- limite sumiria em silêncio. O `RESET` no fim devolve o padrão à conexão.
-- ---------------------------------------------------------------------------

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. O ESTADO DA SESSÃO, LIDO EM UM LUGAR SÓ
--
-- Funções SQL simples e STABLE: o planejador as INLINE dentro da policy, então
-- `"orgId" = public.app_org_atual()` vira `"orgId" = current_setting(...)` e continua
-- usando o índice de `orgId`. Custo de execução: nenhum a mais do que escrever
-- `current_setting` à mão em 200 policies — e um lugar só para corrigir.
--
-- `current_setting(..., true)` (o `true` é "missing_ok") devolve NULL quando o
-- parâmetro nunca foi definido na sessão. Vira string vazia aqui, porque vazio é
-- o que `sessao-de-banco.ts` escreve para "sem empresa": as duas formas de
-- ausência passam a ser a mesma, e nenhuma delas casa com `orgId` de ninguém.
--
-- POR QUE TUDO VAI QUALIFICADO COM `public.` — e não é estilo.
--
-- CORREÇÃO (11/09/2026): a primeira versão deste bloco dizia que "expressão de
-- policy é resolvida com o `search_path` de quem consulta". **É FALSO**, e vale
-- deixar escrito para ninguém reconstruir o raciocínio errado: a expressão de
-- uma policy é ANALISADA NA CRIAÇÃO e guarda a referência resolvida (o OID),
-- exatamente como a de um índice ou de um DEFAULT. Medido no Postgres
-- descartável: policy criada com `orgid = f()` NÃO qualificada continuou
-- chamando `public.f()` mesmo consultada com `SET search_path = sombra, public`
-- e uma `sombra.f()` de mesma assinatura no caminho.
--
-- O PERIGO É REAL, mas fica um andar abaixo: no CORPO das funções SQL. Corpo de
-- função SQL sem `SET search_path` próprio é resolvido TARDE — na primeira
-- execução/inclusão em linha, com o `search_path` de quem chama. As duas coisas
-- foram medidas no mesmo banco:
--
--  1. SEGURANÇA (o corpo, não a policy). Uma função cujo corpo é
--     `SELECT f()` devolveu o resultado de `sombra.f()` para uma sessão com
--     `SET search_path = sombra, public`; a versão com `SELECT public.f()`
--     devolveu o certo. Traduzindo para cá: se `app_org_resolvida()` chamasse
--     `app_org_atual()` sem prefixo, quem controla o `search_path` da sessão
--     escolheria qual `app_org_atual()` a POLICY acaba executando — e com isso
--     o `orgId` alheio. É a mesma armadilha que a migration
--     `20260910120000_orgid_em_todo_filho` fechou nos gatilhos (ver "POR QUE
--     `SET search_path`" lá). Por isso o prefixo está no CORPO das funções, e
--     não só nas expressões.
--  2. OS GATILHOS DA 1.1 QUEBRAVAM SEM ISSO, pelo mesmo mecanismo de resolução
--     tardia. Aquelas funções rodam com `SET search_path = pg_catalog, pg_temp`
--     — sem `public`. Quando o gatilho lê o pai, a policy daquela tabela executa
--     dentro desse `search_path`, o corpo não qualificado é resolvido ali, e
--     estoura com "function app_org_atual() does not exist ... during inlining".
--     Medido em 11/09/2026, e reproduzido de novo na revisão: dois casos da
--     suíte de isolamento ficaram vermelhos exatamente assim.
--
-- Nas EXPRESSÕES das policies o prefixo continua, agora por um motivo menor e
-- honesto: legibilidade e simetria com os corpos. Não é ele que segura o furo.
--
-- Qualificar NÃO impede a inclusão em linha (inlining) da função na policy —
-- o que impediria seria um `SET search_path` na PRÓPRIA função, e é por isso
-- que estas quatro não têm um. `pg_catalog` é procurado primeiro sempre, então
-- `current_setting` continua sendo o do catálogo mesmo sem prefixo.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_org_atual() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.org_id', true), '') $$;

COMMENT ON FUNCTION app_org_atual() IS
  'A empresa declarada a esta sessao (SET LOCAL app.org_id). Vazio = ninguem resolveu.';

-- "A sessão tem empresa DE VERDADE": nem vazia, nem uma das duas sentinelas.
-- É a condição de toda escrita e a primeira metade de toda leitura.
CREATE OR REPLACE FUNCTION app_org_resolvida() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT public.app_org_atual() NOT IN ('', '__resolucao_publica__', '__plataforma__') $$;

-- A sentinela da fatia 1.4: uma rota pública está DESCOBRINDO de quem é o
-- pedido. Ver `src/common/tenant-publico.ts` — o valor é `ORG_RESOLUCAO_PUBLICA`.
CREATE OR REPLACE FUNCTION app_resolucao_publica() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT public.app_org_atual() = '__resolucao_publica__' $$;

-- A sentinela desta fatia: um caminho de PLATAFORMA está descobrindo a empresa
-- (login, provisionamento, cron da casa). Ver `src/prisma/contexto-de-plataforma.ts`
-- — o valor é `ORG_PLATAFORMA`.
CREATE OR REPLACE FUNCTION app_plataforma() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT public.app_org_atual() = '__plataforma__' $$;

-- ---------------------------------------------------------------------------
-- 2. O APLICADOR
--
-- Fica no banco (não é função de uso da aplicação) porque é o que a PRÓXIMA
-- migration que criar tabela de tenant precisa chamar. Tabela nova sem policy
-- não é protegida por nada, e a catraca que pega isso é um teste — melhor ter
-- o caminho curto à mão.
--
--   SELECT app_rls_aplicar_policies('MinhaTabela', 'leitura', 'escrita');
--
-- `p_leitura` / `p_escrita` são expressões SQL, exatamente como iriam no USING.
-- NULL em `p_escrita` = tabela só de leitura para a aplicação.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_rls_aplicar_policies(
  p_tabela  text,
  p_leitura text,
  p_escrita text,
  p_insere  boolean DEFAULT true,
  p_altera  boolean DEFAULT true,
  p_apaga   boolean DEFAULT true
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass(format('public.%I', p_tabela)) IS NULL THEN
    RAISE EXCEPTION 'app_rls_aplicar_policies: tabela "%" nao existe', p_tabela;
  END IF;

  -- Idempotente: a migration precisa poder ser reaplicada num banco que já
  -- rodou uma versão anterior dela sem deixar policy órfã com a expressão velha.
  EXECUTE format('DROP POLICY IF EXISTS tenant_leitura   ON %I', p_tabela);
  EXECUTE format('DROP POLICY IF EXISTS tenant_insercao  ON %I', p_tabela);
  EXECUTE format('DROP POLICY IF EXISTS tenant_alteracao ON %I', p_tabela);
  EXECUTE format('DROP POLICY IF EXISTS tenant_exclusao  ON %I', p_tabela);

  IF p_leitura IS NOT NULL THEN
    EXECUTE format('CREATE POLICY tenant_leitura ON %I FOR SELECT USING (%s)', p_tabela, p_leitura);
  END IF;

  IF p_escrita IS NOT NULL THEN
    IF p_insere THEN
      EXECUTE format('CREATE POLICY tenant_insercao ON %I FOR INSERT WITH CHECK (%s)',
                     p_tabela, p_escrita);
    END IF;
    IF p_altera THEN
      -- USING e WITH CHECK: um decide QUAIS linhas podem ser alcançadas, o outro
      -- decide em que estado elas podem FICAR. Só o primeiro deixaria uma
      -- empresa mover a própria linha para dentro de outra.
      EXECUTE format('CREATE POLICY tenant_alteracao ON %I FOR UPDATE USING (%s) WITH CHECK (%s)',
                     p_tabela, p_escrita, p_escrita);
    END IF;
    IF p_apaga THEN
      EXECUTE format('CREATE POLICY tenant_exclusao ON %I FOR DELETE USING (%s)', p_tabela, p_escrita);
    END IF;
  END IF;

  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p_tabela);
  -- FORCE porque sem ele o DONO das tabelas ignora policy — e é o dono que roda
  -- migration, seed e (hoje) a própria API. Sem FORCE, "RLS ligada" seria uma
  -- linha no catálogo que não guarda nada do lado que importa.
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', p_tabela);
END $$;

-- ---------------------------------------------------------------------------
-- 3. AS POLÍTICAS, GRUPO A GRUPO
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  -- As expressões, nomeadas uma vez. `ATUAL` é sempre `public.app_org_atual()`.
  padrao_leitura  CONSTANT text := 'public.app_org_resolvida() AND "orgId" = public.app_org_atual()';
  padrao_escrita  CONSTANT text := 'public.app_org_resolvida() AND "orgId" = public.app_org_atual()';

  -- 57 tabelas de tenant com `orgId` obrigatório e nenhuma exceção: a empresa da
  -- sessão lê, escreve, altera e apaga o que é dela; não alcança mais nada.
  -- (São 59 as tabelas com `orgId` sem tratamento especial; `User` e `Role` saem
  -- daqui e vão para 3.3, porque o login precisa lê-las antes de haver empresa.)
  -- Geradas do catálogo do banco em 11/09/2026 e conferidas no fim deste bloco.
  padrao CONSTANT text[] := ARRAY[
    'Agent', 'Approval', 'BankConnection', 'BioChallenge', 'BioChallengeAccount',
    'BioChallengePost', 'BioChallengeSnapshot', 'BioConexao', 'BioEvent', 'BioOauthState',
    'BioVisit', 'Campaign', 'ChannelIdentity', 'ChartAccount', 'ContentItem',
    'Contract', 'Departamento', 'DreLine', 'FinanceAccount', 'FinanceCategory',
    'FinanceTransaction', 'GoalConfig', 'GoalWeek', 'GoogleAccount', 'IntegrationAccount',
    'IntegrationHealth', 'KnowledgeNote', 'Lead', 'LeadEvent', 'LeadSource',
    'MetaAccount', 'Partner', 'PautaCaptura', 'PautaFonte', 'PautaPeca',
    'PautaReferencia', 'PautaRodada', 'PautaRotina', 'PixelEvent', 'PolicyDecision',
    'Projeto', 'Report', 'Session', 'SessionStep', 'Sop',
    'Task', 'ToolCall', 'TransactionSplit', 'WorkComment', 'WorkField',
    'WorkFieldOption', 'WorkFieldValue', 'WorkFolder', 'WorkList', 'WorkStatus',
    'WorkTag', 'WorkTask'
  ];

  tab        text;
  descoberto text;
  faltando   text[] := ARRAY[]::text[];
BEGIN
  -- ======================================================================
  -- 3.1 O grupo padrão
  -- ======================================================================
  FOREACH tab IN ARRAY padrao LOOP
    PERFORM app_rls_aplicar_policies(tab, padrao_leitura, padrao_escrita);
  END LOOP;

  -- ======================================================================
  -- 3.2 `Org` — a raiz, que se escopa pela chave primária
  --
  -- LEITURA: a própria linha; mais as duas sentinelas, que precisam resolver a
  -- empresa de um pedido público (chave de pixel) ou de plataforma (slug fixo).
  --
  -- INSERÇÃO: existe, e não é contradição. `provisionarTenant` gera o `orgId`
  -- em código (`randomUUID()`) e abre o contexto NA EMPRESA NOVA antes de
  -- escrever (`src/tenants/provisionar.service.ts`) — então a linha que nasce
  -- É a empresa da sessão e o `WITH CHECK` aprova. É o que mantém a rota de
  -- provisionamento funcionando depois da virada para `mktos_app`. Empresa
  -- nenhuma consegue criar OUTRA empresa: o id teria de ser o dela.
  --
  -- EXCLUSÃO: nenhuma. Apagar empresa é operação de dono, e a cascata leva
  -- junto todo o dado do cliente. Se um dia existir "encerrar empresa", ela
  -- desativa (`isActive`), não apaga.
  --
  -- O QUE A POLICY DE LINHA NÃO RESOLVE, dito em voz alta: ela não distingue
  -- COLUNA. A empresa pode atualizar a própria linha, `modulos` inclusive —
  -- que é o gate de módulos (RF-T-06). Quem tem de separar "ligar módulo" de
  -- "renomear a empresa" é a rota, não o banco.
  -- ======================================================================
  PERFORM app_rls_aplicar_policies(
    'Org',
    'public.app_org_resolvida() AND "id" = public.app_org_atual()'
      || ' OR public.app_resolucao_publica() OR public.app_plataforma()',
    'public.app_org_resolvida() AND "id" = public.app_org_atual()',
    true,   -- insere: a empresa nasce dentro do próprio contexto
    true,   -- altera
    false   -- apaga: nunca pela aplicação
  );

  -- ======================================================================
  -- 3.3 `User` e `Role` — o que o LOGIN precisa ler antes de haver empresa
  --
  -- A sentinela de plataforma lê; escrita continua exigindo empresa resolvida.
  -- É por isso que o login vai precisar de DUAS coisas quando a virada vier:
  -- a sentinela em volta do `findUnique` por e-mail, e o contexto da empresa
  -- encontrada em volta do `user.update({ lastLoginAt })` e da auditoria — que
  -- são escritas e não passam pela sentinela (`src/auth/auth.service.ts`).
  -- ======================================================================
  PERFORM app_rls_aplicar_policies(
    'User',
    padrao_leitura || ' OR public.app_plataforma()',
    padrao_escrita
  );
  PERFORM app_rls_aplicar_policies(
    'Role',
    padrao_leitura || ' OR public.app_plataforma()',
    padrao_escrita
  );

  -- ======================================================================
  -- 3.4 `BioPage` e `BioLink` — o contrato com a fatia 1.4
  --
  -- A sentinela pública LÊ as duas: é o handle e o id do link que dizem de qual
  -- empresa é o pedido. Escrever, nunca.
  --
  -- Declarado porque policy de LINHA não resolve: sob a sentinela a leitura é
  -- da tabela INTEIRA — todas as linhas, todas as colunas, rascunho de outra
  -- empresa inclusive. `USING` filtra linha, não coluna, e as resoluções
  -- precisam alcançar qualquer linha (o avatar resolve rascunho). O que contém
  -- isso não é a policy: é o invólucro da sentinela não ser exportado, de modo
  -- que só as quatro resoluções de `src/common/tenant-publico.ts` rodam ali.
  --
  -- A alternativa mais apertada — três funções `SECURITY DEFINER` devolvendo só
  -- o `orgId`, e nenhum acesso de tabela para a sentinela — está descrita
  -- naquele arquivo e continua sendo o passo seguinte. Ela troca a policy larga
  -- por uma função por resolução, e o preço é que cada rota pública nova precisa
  -- de DDL. Não entrou agora porque mudaria o caminho de produção das quatro
  -- superfícies públicas no mesmo commit que liga o isolamento, e uma coisa de
  -- cada vez é o que permite reverter em pedaços.
  -- ======================================================================
  PERFORM app_rls_aplicar_policies(
    'BioPage',
    padrao_leitura || ' OR public.app_resolucao_publica()',
    padrao_escrita
  );
  PERFORM app_rls_aplicar_policies(
    'BioLink',
    padrao_leitura || ' OR public.app_resolucao_publica()',
    padrao_escrita
  );

  -- ======================================================================
  -- 3.5 `orgId` ANULÁVEL — o nulo é um valor com significado
  --
  -- `src/common/modelos-globais.ts` declara as duas e o que o nulo quer dizer.
  -- A regra é a mesma nas duas, e tem de ser assimétrica:
  --   LEITURA: `orgId = atual OR orgId IS NULL`  — a linha global serve a todas;
  --   ESCRITA: só `orgId = atual`                — senão UMA empresa sobrescreve
  --                                                a linha que serve a TODAS.
  -- O caso "um tenant não sobrescreve a credencial GLOBAL" da suíte de
  -- isolamento existe exatamente para cobrar essa assimetria.
  --
  -- `PolicyVersion` ganha a sentinela de plataforma na leitura por causa do
  -- arranque: `PolicyService.onModuleInit` carrega a versão base (a de `orgId`
  -- nulo) antes de existir requisição. Sem isso a política POR EMPRESA deixa de
  -- valer e o serviço cai na base empacotada — em silêncio, porque ele trata a
  -- falha e segue.
  -- ======================================================================
  PERFORM app_rls_aplicar_policies(
    'BioCredencialApp',
    'public.app_org_resolvida() AND ("orgId" = public.app_org_atual() OR "orgId" IS NULL)',
    padrao_escrita
  );
  PERFORM app_rls_aplicar_policies(
    'PolicyVersion',
    'public.app_org_resolvida() AND ("orgId" = public.app_org_atual() OR "orgId" IS NULL)'
      || ' OR public.app_plataforma()',
    padrao_escrita
  );

  -- ======================================================================
  -- 3.6 APPEND-ONLY — `EventLog` (o RASTRO) e `AuditLog`
  --
  -- Leem e inserem o que é da empresa. Não alteram e não apagam: a ausência de
  -- policy de UPDATE e de DELETE é a terceira barreira do RASTRO, depois do
  -- REVOKE da migration do papel e das RULEs `eventlog_sem_update` /
  -- `eventlog_sem_delete` (que valem inclusive para o dono).
  --
  -- "Nunca apagar evento do RASTRO" é 02-CONSTRAINTS; aqui isso deixa de
  -- depender de ninguém lembrar.
  -- ======================================================================
  PERFORM app_rls_aplicar_policies('EventLog', padrao_leitura, padrao_escrita, true, false, false);
  PERFORM app_rls_aplicar_policies('AuditLog', padrao_leitura, padrao_escrita, true, false, false);

  -- ======================================================================
  -- 3.7 AS TABELAS GLOBAIS POR DESENHO
  --
  -- `src/common/modelos-globais.ts` declara as três e o que quebra se alguém
  -- as escopar. Global NÃO quer dizer "sem policy": quer dizer que a policy é
  -- outra. Deixá-las sem RLS seria deixar a aplicação apagar catálogo alheio —
  -- e `BioVisitor` é escrita pela rota pública, então seria a porta por onde o
  -- `impor` passaria em branco.
  --
  --  · `Permission` e `Capability` — catálogos. Qualquer sessão LÊ (o guarda de
  --    permissões e a porta precisam deles a todo momento, inclusive sob a
  --    sentinela de plataforma, durante o login). `Permission` aceita INSERÇÃO
  --    de empresa resolvida porque o provisionamento completa o catálogo quando
  --    entra permissão nova no código (`tx.permission.createMany`); inserir
  --    chave no catálogo não concede nada a ninguém — quem concede é o
  --    `_RolePermissions`, que é escopado. ALTERAR e APAGAR, nunca: são
  --    operações de semente, e semente roda com a conexão dona.
  --
  --    CORREÇÃO (11/09/2026): "não concede nada a ninguém" continua verdade e
  --    continua sendo o argumento errado sozinho. O que a primeira versão desta
  --    policy ignorou é que `Permission` é ESTADO GLOBAL DURÁVEL e legível por
  --    todo mundo: a leitura é `true`, então uma linha plantada por uma empresa
  --    aparece na tela de permissões das OUTRAS, e sob as duas sentinelas
  --    também. E, sem policy de UPDATE nem de DELETE, a aplicação não consegue
  --    limpar — só o dono, à mão, no banco. Medido na revisão: uma chave com
  --    `<script>...</script>` inserida por um tenant ficou legível para todos e
  --    imune ao `DELETE` do próprio autor.
  --
  --    A escrita agora exige o FORMATO da chave (`area.acao`, minúsculas,
  --    dígitos e sublinhado), que é a gramática de `packages/shared/src/
  --    permissions.ts`. O que dá para plantar passa a ser, no máximo, uma chave
  --    de permissão plausível que não concede nada — e não texto arbitrário.
  --
  --    POR QUE NÃO ABRIR O DELETE junto, que resolveria "a aplicação não limpa":
  --    apagar chave de catálogo cascateia em `_RolePermissions` e REVOGA a
  --    permissão correspondente em TODAS as empresas. Trocar "uma empresa suja o
  --    catálogo" por "uma empresa desliga uma permissão de todas" é piorar. A
  --    limpeza do que já foi plantado é operação de dono, e o formato acima é o
  --    que impede a fila de crescer.
  --
  --    A alternativa mais apertada continua sendo tirar a inserção da aplicação
  --    e deixar o catálogo só para a semente (conexão dona). Ela quebra o
  --    provisionamento de empresa depois da virada para `mktos_app`, que hoje
  --    completa o catálogo sozinho — e é por isso que não foi esta a escolha.
  --    Está registrado em PERGUNTAS.
  --  · `BioVisitor` — identidade de cookie, compartilhada entre empresas de
  --    propósito (o mesmo navegador visita a bio de clientes diferentes). Quem
  --    tem empresa RESOLVIDA lê e escreve; sentinela e sessão sem empresa, não.
  --    Sem DELETE: nenhum caminho da aplicação apaga visitante, e tabela global
  --    apagável por qualquer tenant é um botão de estrago geral.
  --
  --    PENDÊNCIA DECLARADA (seção 3n do relatório do orquestrador): a implicação
  --    de proteção de dados de um identificador de navegador que atravessa
  --    clientes continua sem dono. A policy escrita aqui NÃO decide isso — se a
  --    decisão for escopar por empresa, é migração nova, e ela também quebra a
  --    deduplicação de sessão da bio.
  -- ======================================================================
  -- `~` e não `LIKE`: o formato é `area.acao`, e o ponto precisa ser ponto. Os
  -- tetos de tamanho estão lá para a chave não virar carga útil comprida.
  PERFORM app_rls_aplicar_policies(
    'Permission',
    'true',
    'public.app_org_resolvida() AND "key" ~ ''^[a-z][a-z0-9_]{0,39}\.[a-z][a-z0-9_]{0,39}$''',
    true, false, false
  );
  PERFORM app_rls_aplicar_policies('Capability', 'true', NULL);
  PERFORM app_rls_aplicar_policies(
    'BioVisitor', 'public.app_org_resolvida()', 'public.app_org_resolvida()', true, true, false
  );

  -- ======================================================================
  -- 3.8 AS JUNÇÕES IMPLÍCITAS DO PRISMA
  --
  -- Não têm `orgId` e não podem ter: o Prisma não aceita coluna extra em
  -- relação implícita. A empresa delas está nos PAIS, e é por `EXISTS` que a
  -- policy chega lá. Sem isto, `_UserRoles` é escalada de privilégio entre
  -- empresas — conceder a um usuário próprio um papel da outra empresa.
  --
  -- `A` e `B` seguem a ordem alfabética do Prisma:
  --   `_UserRoles`       A = Role.id      B = User.id       (os DOIS são tenant)
  --   `_RolePermissions` A = Permission.id B = Role.id      (A é catálogo global)
  --   `_WorkTaskTags`    A = WorkTag.id   B = WorkTask.id   (os DOIS são tenant)
  --
  -- O `EXISTS` não recursa: a policy de `Role` e a de `User` não olham para
  -- junção nenhuma. E ele é duplamente filtrado de propósito — a policy do pai
  -- já recorta por empresa, e a comparação explícita aqui é o que mantém a
  -- intenção legível quando alguém for ler só esta linha.
  --
  -- Sem UPDATE: junção de dois identificadores não se altera; o Prisma troca
  -- vínculo apagando e inserindo.
  -- ======================================================================
  PERFORM app_rls_aplicar_policies(
    '_UserRoles',
    'public.app_org_resolvida()'
      || ' AND EXISTS (SELECT 1 FROM public."Role" r WHERE r.id = "A" AND r."orgId" = public.app_org_atual())'
      || ' AND EXISTS (SELECT 1 FROM public."User" u WHERE u.id = "B" AND u."orgId" = public.app_org_atual())'
      || ' OR public.app_plataforma()',
    'public.app_org_resolvida()'
      || ' AND EXISTS (SELECT 1 FROM public."Role" r WHERE r.id = "A" AND r."orgId" = public.app_org_atual())'
      || ' AND EXISTS (SELECT 1 FROM public."User" u WHERE u.id = "B" AND u."orgId" = public.app_org_atual())',
    true, false, true
  );

  PERFORM app_rls_aplicar_policies(
    '_RolePermissions',
    'public.app_org_resolvida()'
      || ' AND EXISTS (SELECT 1 FROM public."Role" r WHERE r.id = "B" AND r."orgId" = public.app_org_atual())'
      || ' OR public.app_plataforma()',
    'public.app_org_resolvida()'
      || ' AND EXISTS (SELECT 1 FROM public."Role" r WHERE r.id = "B" AND r."orgId" = public.app_org_atual())',
    true, false, true
  );

  PERFORM app_rls_aplicar_policies(
    '_WorkTaskTags',
    'public.app_org_resolvida()'
      || ' AND EXISTS (SELECT 1 FROM public."WorkTag" t WHERE t.id = "A" AND t."orgId" = public.app_org_atual())'
      || ' AND EXISTS (SELECT 1 FROM public."WorkTask" k WHERE k.id = "B" AND k."orgId" = public.app_org_atual())',
    'public.app_org_resolvida()'
      || ' AND EXISTS (SELECT 1 FROM public."WorkTag" t WHERE t.id = "A" AND t."orgId" = public.app_org_atual())'
      || ' AND EXISTS (SELECT 1 FROM public."WorkTask" k WHERE k.id = "B" AND k."orgId" = public.app_org_atual())',
    true, false, true
  );

  -- ======================================================================
  -- 3.9 A CONFERÊNCIA — "lista de exceções com motivo, nunca silêncio"
  --
  -- Percorre o catálogo do banco e exige que TODA tabela de `public` tenha
  -- saído daqui com RLS, FORCE e policy. A única fora é `_prisma_migrations`:
  -- é controle do Migrate, não dado de aplicação, o papel restrito já não tem
  -- permissão nenhuma nela (migration do papel), e ligar RLS ali quebra o
  -- arranque do próprio Prisma.
  --
  -- Isto pega o esquecimento de HOJE, não o de amanhã: uma migration futura que
  -- criar tabela roda DEPOIS desta, e nesse momento aqui a tabela dela ainda não
  -- existe. A catraca permanente é o caso "toda tabela do banco está sob
  -- isolamento" em `apps/api/test/tenant-isolation.test.ts`.
  --
  -- Falha ALTA de propósito: uma tabela de tenant sem policy é vazamento, e
  -- migration que aplica pela metade em silêncio é pior do que migration que
  -- não aplica (09-PADRÕES §3.4).
  --
  -- O PREÇO DISSO NO DIA DO DEPLOY, dito em voz alta porque quem vai encontrar
  -- é o operador, não quem escreveu: esta conferência não distingue "tabela de
  -- empresa esquecida" de "tabela auxiliar que alguém criou à mão no servidor"
  -- — uma `backup_leads_2026`, um `temp_conciliacao`. As duas abortam a
  -- migration, e como `prisma migrate deploy` roda no `command` do container,
  -- abortar é a API não subir.
  --
  -- Para a primeira é o comportamento certo. Para a segunda é desproporcional, e
  -- o conserto no calor do momento é um destes dois, nesta ordem:
  --   · se a tabela é lixo: `DROP TABLE "<nome>"` e suba de novo;
  --   · se a tabela precisa ficar e não tem `orgId`:
  --       ALTER TABLE "<nome>" ENABLE ROW LEVEL SECURITY;
  --       ALTER TABLE "<nome>" FORCE  ROW LEVEL SECURITY;
  --       CREATE POLICY tenant_leitura ON "<nome>" FOR SELECT USING (false);
  --     (nega tudo para a aplicação, que é o que uma tabela fora do schema já
  --     deveria ser para ela) e depois acrescente a tabela em `SEM_ISOLAMENTO`,
  --     em `apps/api/test/tenant-isolation.test.ts`, com o motivo escrito.
  --
  -- Está citado no relatório de deploy de propósito: é a única falha desta
  -- migration que pode aparecer num banco de verdade e não ser vazamento.
  -- ======================================================================
  FOR descoberto IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname <> '_prisma_migrations'
       AND NOT (c.relrowsecurity AND c.relforcerowsecurity
                AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
     ORDER BY 1
  LOOP
    faltando := array_append(faltando, descoberto);
  END LOOP;

  IF array_length(faltando, 1) > 0 THEN
    RAISE EXCEPTION
      'isolamento por linha incompleto: % tabela(s) ficaram sem RLS/FORCE/policy (%). Nenhuma tabela de tenant pode sair desta migration sem politica; se alguma nao pode receber, ela precisa de uma linha propria aqui com o motivo escrito.',
      array_length(faltando, 1), array_to_string(faltando, ', ');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3.10 O QUE A POLICY DE LINHA NÃO ALCANÇA: CHAVE ESTRANGEIRA CRUZADA
--
-- Isolamento por linha decide QUAIS LINHAS a sessão enxerga e escreve. Ele não
-- decide com que linha uma linha pode se AMARRAR — e a chave estrangeira confere
-- só o identificador, nunca a empresa. Então isto passa por RLS sem arranhão:
--
--   -- sessão na empresa A, conta da empresa A, conexão bancária da empresa B
--   UPDATE "FinanceAccount" SET "connectionId" = '<conexao_da_B>' WHERE id = '<conta_da_A>';
--
-- `USING` aprova (a linha é da A), `WITH CHECK` aprova (o `orgId` não mudou), e
-- a FK aprova (o id existe). A conta da empresa A passa a apontar para a conexão
-- Open Finance de OUTRO cliente — e a sincronização seguinte traz extrato alheio
-- para dentro dela. É o caso "A não conecta a própria conta financeira a uma
-- conexão bancária de B" da suíte de isolamento, que estava vermelho e não era
-- RLS que ia consertar.
--
-- O conserto é o gatilho que a fatia 1.1 já escreveu: `mktos_orgid_do_pai`
-- compara o `orgId` da linha com o do pai apontado e recusa o cruzamento
-- (ERRCODE 23514). `connectionId` é anulável e a função já trata FK nula.
--
-- ESTA É UMA FK, E EXISTEM OUTRAS — a pendência, com número e com ordem.
--
-- Contado no catálogo em 11/09/2026 (banco descartável, schema inteiro):
-- **52 chaves estrangeiras entre tabelas que têm `orgId`** (fora as que apontam
-- para `Org`). **13** já recusam o cruzamento, porque têm o gatilho
-- `mktos_orgid_do_pai` da fatia 1.1. **As outras 39 aceitam.**
--
-- O QUE ISSO É E O QUE NÃO É, medido na revisão:
--   · NÃO é leitura cruzada sob `mktos_app`. O ponteiro passa a existir, mas a
--     policy do PAI continua valendo: quem aponta não lê a linha apontada.
--   · É NEGAÇÃO DE SERVIÇO entre empresas. Depois do ponteiro, o dono da linha
--     apontada não consegue mais apagá-la (`ON DELETE RESTRICT`) — e ele não
--     enxerga o filho que a prende, porque o filho é da outra empresa.
--   · E HOJE, com a aplicação conectando como DONA, é pior: uma consulta com
--     `include` seguindo esse ponteiro devolve a linha da outra empresa.
--
-- A ORDEM DE FECHAMENTO — as que carregam dado de TERCEIRO vêm primeiro. Não é
-- ordem de esforço, é ordem de estrago:
--
--   1. `BioChallengeAccount.conexaoId -> BioConexao` — `BioConexao` guarda
--      `tokenCifrado`/`refreshCifrado` de conta de rede social. Amarrar um
--      desafio à conexão de outro cliente faz a COLETA seguinte rodar com o
--      token dele. É a mesma forma do caso bancário fechado acima, com
--      credencial de rede social no lugar do extrato.
--   2. `FinanceTransaction.partnerId` e `Contract.partnerId -> Partner` —
--      `Partner` tem `cnpjCpf`, e-mail e telefone de terceiro. Lançamento e
--      contrato de uma empresa passam a apontar para o cliente da outra.
--   3. `ChannelIdentity.userId -> User` — amarra um identificador de canal
--      (WhatsApp, Telegram) a usuário de outra empresa. É caminho de
--      AUTENTICAÇÃO, não só de dado: quem entra por aquele canal é resolvido
--      por esta linha.
--   4. `Lead.ownerId -> User` e `Agent.donoId -> User` — dono de outra empresa
--      em cima de PII de lead e de agente que executa ação.
--   5. `FinanceTransaction.accountId -> FinanceAccount` — lançamento na conta
--      bancária de outro cliente. (`FinanceAccount.connectionId` já está
--      fechada, logo abaixo.)
--   6. `BioVisit.pageId`, `BioEvent.pageId` e `BioEvent.visitId` — as três são
--      escritas por ROTA PÚBLICA, sob a sentinela, que é o caminho com menos
--      guarda-costas do sistema.
--
-- As 30 restantes são ponteiros estruturais dentro do mesmo módulo (hierarquia
-- de trabalho, plano de contas, pauta): mesmo estrago de negação de serviço,
-- nenhum dado de terceiro.
--
-- FECHAR TODAS É FATIA PRÓPRIA, e está registrado em PERGUNTAS: um gatilho por
-- chave significa uma leitura do pai a cada INSERT e a cada UPDATE do filho —
-- em `FinanceTransaction`, que tem 7 delas, é dobrar o custo de escrita da
-- tabela mais movimentada do financeiro. A decisão (gatilho em todas, gatilho
-- só nas seis acima, ou constraint composta `(id, orgId)` referenciada por
-- `FOREIGN KEY (paiId, orgId)`, que é mais barata e exige coluna e índice
-- novos em 39 tabelas) é de arquitetura, não desta migration.
--
-- MUDANÇA DE COMPORTAMENTO SOB RLS, dita em voz alta: o gatilho NÃO é
-- `SECURITY DEFINER` — ele lê o pai com o papel de quem escreveu, e a policy do
-- pai vale para essa leitura. Quando o pai é de outra empresa a leitura devolve
-- nada, e a recusa sai como "orgId não derivável" (23503) em vez de "empresa
-- cruzada" (23514). Recusa do mesmo jeito; muda a mensagem. Está assim de
-- propósito: transformar o gatilho em `SECURITY DEFINER` o faria rodar como
-- superusuário em toda escrita de filho do sistema, o que é um poder bem maior
-- do que uma mensagem de erro mais bonita.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS "FinanceAccount_orgId_confere_conexao" ON "FinanceAccount";
CREATE TRIGGER "FinanceAccount_orgId_confere_conexao"
  BEFORE INSERT OR UPDATE ON "FinanceAccount"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('BankConnection', 'connectionId');

-- ---------------------------------------------------------------------------
-- 4. O INTERRUPTOR — o caminho de rollback, em um comando
--
-- A fonte da lista não é uma cópia: são as tabelas que têm policy `tenant_%`.
-- Assim o interruptor nunca fica dessincronizado do que a migration ligou, e
-- tabela nova entra sozinha no dia em que ganhar policy.
--
-- SEM `SECURITY DEFINER`, de propósito. `ALTER TABLE` exige ser dono da tabela;
-- com `SECURITY DEFINER` estas funções rodariam COMO o dono e o papel restrito
-- poderia desligar o próprio isolamento com uma chamada de função. Do jeito que
-- estão, `mktos_app` chamando recebe "must be owner of table". **Essa é a
-- proteção, e ela funciona** — é ela que o caso "o papel restrito NÃO consegue
-- desligar o próprio isolamento" mede.
--
-- CORREÇÃO (11/09/2026): a primeira versão desta nota dizia que o REVOKE abaixo
-- "tira até a tentativa". Não tirava. `CREATE FUNCTION` concede EXECUTE a
-- PUBLIC por padrão, e `REVOKE ... FROM mktos_app` não mexe numa concessão
-- feita a PUBLIC — não havia concessão NOMINAL para revogar. Medido na revisão:
-- depois do REVOKE, `has_function_privilege('mktos_app', 'app_rls_desligar()',
-- 'EXECUTE')` continuava `true`, e a ACL da função era `{=X/mkt,mkt=X/mkt}` (o
-- `=X` é justamente o PUBLIC).
--
-- Argumento de segurança falso num arquivo que alguém vai ler para decidir é
-- pior do que nenhum argumento, então a revogação foi CONSERTADA em vez de a
-- frase ser apagada: agora é `FROM PUBLIC`, que é de onde a permissão vinha. O
-- dono mantém a dele (revogar de PUBLIC não mexe no dono), e o `REVOKE ... FROM
-- mktos_app` continua junto por causa do `ALTER DEFAULT PRIVILEGES ... GRANT
-- EXECUTE ON FUNCTIONS` que a migration do papel deixou — esse SIM é nominal, e
-- sem o segundo REVOKE ele reconcederia.
--
-- `app_rls_estado()` fica de fora da revogação: é diagnóstico de leitura pura
-- sobre `pg_class`, e tirar dela não protege nada que `pg_policy` já não conte.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_rls_desligar() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE t text; n integer := 0;
BEGIN
  FOR t IN SELECT DISTINCT c.relname
             FROM pg_policy p
             JOIN pg_class c ON c.oid = p.polrelid
             JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND p.polname LIKE 'tenant\_%'
            ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'isolamento por linha DESLIGADO em % tabela(s). As policies continuam no catalogo; app_rls_ligar() religa.', n;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION app_rls_ligar() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE t text; n integer := 0;
BEGIN
  FOR t IN SELECT DISTINCT c.relname
             FROM pg_policy p
             JOIN pg_class c ON c.oid = p.polrelid
             JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND p.polname LIKE 'tenant\_%'
            ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Diagnóstico: o que está ligado, onde, e com quantas policies.
CREATE OR REPLACE FUNCTION app_rls_estado()
RETURNS TABLE (tabela text, rls boolean, force boolean, policies bigint)
LANGUAGE sql STABLE AS $$
  SELECT c.relname::text,
         c.relrowsecurity,
         c.relforcerowsecurity,
         (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
   ORDER BY 1
$$;

-- De PUBLIC primeiro (é de lá que a permissão vem, por padrão do
-- `CREATE FUNCTION`), e do papel depois (por causa do `ALTER DEFAULT
-- PRIVILEGES` da migration do papel, que é concessão nominal).
REVOKE EXECUTE ON FUNCTION app_rls_ligar()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_rls_desligar() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_rls_aplicar_policies(text, text, text, boolean, boolean, boolean) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION app_rls_ligar()    FROM mktos_app';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION app_rls_desligar() FROM mktos_app';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION app_rls_aplicar_policies(text, text, text, boolean, boolean, boolean) FROM mktos_app';
  END IF;
END $$;

-- Devolve o padrão de espera pelo bloqueio à conexão (ver a seção 0). Fica no
-- fim de propósito: uma migration que falhe antes daqui é descartada junto com
-- a transação, e a conexão do `migrate deploy` morre com o processo.
RESET lock_timeout;
