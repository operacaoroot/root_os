-- ============================================================================
-- O PAPEL COM QUE A APLICAÇÃO CONECTA (RF-T-02, RF-R-01)
--
-- Hoje a aplicação conecta como DONA das tabelas. Dono ignora policy de
-- isolamento por linha — o Postgres só a aplica a ele com FORCE ROW LEVEL
-- SECURITY. Enquanto for assim, ligar RLS não protege nada e a suíte de
-- isolamento mede o vazio.
--
-- Esta migration cria o papel restrito `mktos_app`, e só isso. NÃO liga RLS,
-- NÃO cria policy, NÃO muda o comportamento de nenhuma consulta: quem conecta
-- continua sendo o dono até alguém provisionar a senha do papel novo
-- (deploy/papel-app.sh) e preencher DB_APP_USER/DB_APP_PASSWORD. É de propósito
-- — a virada do isolamento é outra fatia, e um deploy que muda as duas coisas
-- de uma vez não tem como ser revertido em pedaços.
--
-- POR QUE `NOLOGIN`
-- O papel nasce sem poder conectar. Senha é segredo de operação e não entra em
-- arquivo versionado; enquanto ela não for definida fora daqui, este papel não
-- é uma porta aberta a mais no banco — é só um conjunto de permissões esperando
-- dono.
--
-- POR QUE `NOBYPASSRLS` IMPORTA MAIS DO QUE PARECE
-- Um papel com BYPASSRLS atravessa qualquer policy, em silêncio, sem erro e sem
-- log. Seria o isolamento inteiro desfeito por um atributo de papel que ninguém
-- olha. Fica explícito aqui, é reafirmado quando o papel já existe, e o teste de
-- diagnóstico (`apps/api/test/tenant-isolation.test.ts`) reprova se mudar.
--
-- POR QUE NÃO DERRUBA O DEPLOY QUANDO NÃO DÁ PARA CRIAR
-- `prisma migrate deploy` roda no `command` do container da api: migration que
-- falha derruba a API. Criar papel exige SUPERUSER ou CREATEROLE — o que a
-- imagem do Postgres dá ao POSTGRES_USER, mas que um banco gerenciado pode não
-- dar. Num banco assim, esta migration AVISA e segue, em vez de deixar a API
-- fora do ar por causa de uma infraestrutura que ainda não está ligada. O buraco
-- não fica escondido: o boot da API anuncia "ISOLAMENTO POR LINHA INERTE" e o
-- teste de diagnóstico reprova.
-- ============================================================================

DO $$
DECLARE
  eu_posso_criar boolean;
  eu_sou_super   boolean;
  ja_existe      boolean;
  bypassa        boolean;
BEGIN
  SELECT COALESCE(rolsuper, false), COALESCE(rolsuper OR rolcreaterole, false)
    INTO eu_sou_super, eu_posso_criar
    FROM pg_roles WHERE rolname = current_user;

  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') INTO ja_existe;

  IF NOT ja_existe THEN
    IF NOT eu_posso_criar THEN
      RAISE WARNING
        'papel mktos_app NAO criado: "%" nao tem SUPERUSER nem CREATEROLE. A aplicacao segue conectando como dona das tabelas e o isolamento por linha continua inerte. Crie o papel a mao e rode esta migration de novo.',
        current_user;
      RETURN;
    END IF;
    CREATE ROLE mktos_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

  ELSIF eu_sou_super THEN
    -- Reafirma os atributos de quem já existia. `ALTER ROLE ... NOBYPASSRLS`
    -- exige superusuário mesmo para DESLIGAR o atributo — por isso a condição.
    ALTER ROLE mktos_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  -- ------------------------------------------------------------------
  -- Permissões mínimas: ler e escrever dado, nada de estrutura.
  --
  -- Sem CREATE no schema: a aplicação não cria tabela, não cria índice e não
  -- instala extensão. Quem faz isso é a migration, com o papel dono.
  -- ------------------------------------------------------------------
  EXECUTE 'GRANT USAGE ON SCHEMA public TO mktos_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mktos_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mktos_app';
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO mktos_app';

  -- Tabela nova criada por migration futura já nasce com as mesmas permissões.
  -- Sem isto, a primeira migration que criar tabela derruba a aplicação em
  -- produção com "permission denied" — e o erro apareceria longe da causa.
  --
  -- Vale para objeto criado por ESTE papel (o que roda as migrations). Se um dia
  -- as migrations passarem a rodar com outro usuário, esta linha precisa ser
  -- repetida para ele.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mktos_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mktos_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO mktos_app';

  -- ------------------------------------------------------------------
  -- O RASTRO é append-only — e agora isso deixa de ser convenção.
  --
  -- A migration 20260829161052_regua_porta_rastro já trazia este REVOKE dentro
  -- de um `IF EXISTS (role mktos_app)`, escrito para valer "quando a fatia 8
  -- criar o role". Em banco novo aquele bloco roda ANTES deste arquivo, com o
  -- papel ainda inexistente, e não faz nada. Por isso o REVOKE é repetido aqui:
  -- é este que vale em banco novo, e o de lá continua valendo em banco que já
  -- tinha o papel.
  --
  -- As RULEs `eventlog_sem_update` / `eventlog_sem_delete` continuam sendo a
  -- segunda barreira, inclusive contra o dono.
  -- ------------------------------------------------------------------
  EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON "EventLog" FROM mktos_app';

  -- O histórico de migration não é dado de aplicação. Quem conseguisse apagar
  -- linha daqui faria uma migration já aplicada rodar de novo no próximo deploy.
  --
  -- O `IF` não é paranoia: `_prisma_migrations` NÃO existe em todo banco onde
  -- este SQL roda. `prisma migrate diff --from-migrations` (o passo "As
  -- migrations correspondem ao schema" da CI, e o `db:diff` local) REPETE o
  -- histórico inteiro num banco sombra SEM criar a tabela de histórico — ela é
  -- do `migrate deploy`, não do replay. Sem esta guarda o REVOKE aborta com
  -- P1014 ("The underlying table for model `_prisma_migrations` does not
  -- exist"), o `migrate diff` sai com código 1 e o job inteiro reprova sem nunca
  -- ter chegado a comparar nada. Medido no Postgres descartável, 10/09/2026.
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE "_prisma_migrations" FROM mktos_app';
  END IF;

  -- ------------------------------------------------------------------
  -- Conferência ruidosa: papel que atravessa policy não serve para nada aqui.
  -- ------------------------------------------------------------------
  SELECT COALESCE(rolbypassrls OR rolsuper, false) INTO bypassa
    FROM pg_roles WHERE rolname = 'mktos_app';
  IF bypassa THEN
    RAISE WARNING
      'papel mktos_app tem BYPASSRLS ou SUPERUSER: nenhuma policy de linha vale para ele. Corrija com ALTER ROLE mktos_app NOBYPASSRLS NOSUPERUSER (exige superusuario).';
  END IF;

  -- Comentário de papel exige ser superusuário ou ter ADMIN sobre ele. É
  -- documentação: se não der, avisa e segue — não vale derrubar um deploy.
  BEGIN
    EXECUTE 'COMMENT ON ROLE mktos_app IS ' || quote_literal(
      'Papel da APLICACAO (nao dono das tabelas, NOBYPASSRLS). Le e escreve dado; nao cria ' ||
      'estrutura; nao altera nem apaga EventLog. A empresa da sessao viaja em app.org_id via ' ||
      'SET LOCAL (apps/api/src/prisma/sessao-de-banco.ts). Senha: deploy/papel-app.sh.');
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'sem permissao para comentar o papel mktos_app; segue sem o comentario.';
  END;
END $$;
