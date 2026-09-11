-- ============================================================================
-- orgId em todo filho de tenant — RF-T-01
--
-- Dez tabelas só alcançavam a empresa pelo pai. Sem coluna própria, consulta que
-- esquece o join sai sem tenant e isolamento por linha não tem em que se apoiar.
--
-- POR QUE ESTA MIGRATION É ESCRITA À MÃO
-- O que o `prisma migrate diff` gera para esta mudança é uma linha por tabela:
--     ALTER TABLE "BioLink" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT '';
-- Num banco vazio funciona. Num banco POVOADO carimba '' em toda linha
-- existente, e aí ou a chave estrangeira contra Org derruba a migration (e,
-- porque `prisma migrate deploy` roda no `command` do container, derruba a API),
-- ou — se ninguém tivesse posto a FK — o sistema ficaria com um tenant fantasma
-- chamado string vazia. Por isso os três passos abaixo, nesta ordem:
--
--   Fase 1  coluna ANULÁVEL, sem default. Nada quebra: o código que ainda não
--           informa orgId continua inserindo, agora com NULL.
--   Fase 2  BACKFILL a partir do pai, e DUAS conferências antes de exigir:
--           linha sem pai alcançável (orgId ficou NULL) e linha JÁ cruzada
--           (empresa do filho diferente da do pai, coisa que hoje é legal
--           porque a coluna não existia).
--   Fase 3  a trava: default sentinela, NOT NULL, índice, FK e os gatilhos.
--
-- A SENTINELA E O GATILHO
-- O default é '' e não um orgId qualquer: é sentinela, não valor. O gatilho
-- `<Tabela>_orgId_do_pai` roda BEFORE INSERT OR UPDATE, troca a sentinela pelo
-- orgId do pai e RECUSA a linha cujo orgId não bate com o do pai. São duas
-- garantias em uma:
--   1. as ~20 chamadas que hoje criam esses filhos sem informar orgId seguem
--      funcionando e passam a gravar o tenant certo;
--   2. no momento da ESCRITA DO FILHO, pendurar filho de uma empresa em pai de
--      outra é recusado — é a brecha que a FK simples não enxerga (ela confere o
--      id, não a empresa) e que o próprio teste de isolamento aponta como "FK
--      CRUZADA ENTRE ORGS".
-- Se um dia o gatilho for removido, a sentinela vira violação de FK contra Org:
-- falha fechada e barulhenta, nunca linha órfã de tenant.
--
-- O QUE O GATILHO **NÃO** COBRE — PAI QUE MUDA DE EMPRESA DEPOIS
-- A garantia 2 vale na escrita do FILHO. Se alguém mudar o `orgId` do PAI
-- depois, o filho fica parado na empresa antiga e o par volta a estar cruzado:
--
--     UPDATE "Lead" SET "orgId" = 'org_B' WHERE id = 'lead_da_A';
--     -- o LeadEvent daquele lead continua com 'org_A'
--
-- Foi reproduzido no Postgres descartável e é limitação CONHECIDA E ACEITA, não
-- descuido. Por que não existe gatilho de propagação:
--   * nenhum caminho de código muda o orgId de um pai hoje — o campo é escrito
--     na criação e nunca mais;
--   * propagar exigiria gatilho em NOVE tabelas-pai, e em WorkFieldValue (três
--     pais) mover só um deles passaria a derrubar o UPDATE do pai com uma
--     mensagem que ninguém projetou;
--   * provisionamento e fusão de tenant vão precisar decidir a ORDEM em que pai
--     e filhos se movem. Um gatilho de propagação escondido faria essa migração
--     parecer segura enquanto reordena o trabalho por baixo.
-- A postura é: PREVENIR na escrita do filho, DETECTAR na auditoria. O teste
-- "o orgId de X bate com o do pai em TODAS as linhas da tabela"
-- (apps/api/test/tenant-isolation.test.ts) é justamente o detector desse desvio,
-- e percorre todos os pais conferidos. Quem for implementar movimentação de
-- tenant trata disso explicitamente — e não confia neste gatilho para isso.
--
-- ÍNDICES COMPOSTOS QUE NÃO COMEÇAM POR orgId — DECISÃO REGISTRADA
-- `HANDOFF-DEV/07-MODELO-DE-DADOS.md` manda `orgId` ser a primeira coluna de
-- todo índice composto de tabela de tenant. Os índices CRIADOS aqui obedecem.
-- Os índices ANTIGOS destas dez tabelas não, e ficam como estão de propósito:
--   * os não-únicos — BioLink(pageId, ordem), BioChallengePost(contaId,
--     publicadoEm), BioChallengeSnapshot(contaId, coletadoEm),
--     WorkComment(taskId, createdAt) — começam pela FK do pai. Um `contaId` só
--     pertence a UMA empresa, então a entrada do índice já está escopada pelo
--     pai: são caminhos secundários ("os posts DESTA conta"), não varredura de
--     tabela inteira. O caminho amplo ("tudo desta empresa") é o índice novo.
--   * os ÚNICOS — BioChallengeAccount(challengeId, plataforma, handle),
--     BioChallengePost(contaId, externalId), WorkStatus(listId, name),
--     WorkFieldOption(fieldId, name), WorkFieldValue(taskId, fieldId) — não
--     podem ser reordenados: prefixar `orgId` num índice único AFROUXA a
--     unicidade (passariam a caber duas linhas iguais em empresas diferentes).
--     Como a primeira coluna já é a FK de um pai de uma única empresa, o efeito
--     prático seria nenhum e o risco, real.
-- Se um dia o EXPLAIN mostrar varredura ampla por algum desses caminhos, a
-- correção é índice NOVO com orgId à frente — nunca reordenar um único.
--
-- Ver `apps/api/src/common/modelos-globais.ts` (quem é global por desenho e de
-- que pai cada filho deriva) e `apps/api/test/tenant-isolation.test.ts`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Fase 1 — coluna anulável. Compatível para trás: o código de antes desta
-- migration continua inserindo sem informar orgId.
-- ----------------------------------------------------------------------------
ALTER TABLE "IntegrationHealth"    ADD COLUMN "orgId" TEXT;
ALTER TABLE "LeadEvent"            ADD COLUMN "orgId" TEXT;
ALTER TABLE "BioLink"              ADD COLUMN "orgId" TEXT;
ALTER TABLE "BioChallengeAccount"  ADD COLUMN "orgId" TEXT;
ALTER TABLE "BioChallengePost"     ADD COLUMN "orgId" TEXT;
ALTER TABLE "BioChallengeSnapshot" ADD COLUMN "orgId" TEXT;
ALTER TABLE "WorkStatus"           ADD COLUMN "orgId" TEXT;
ALTER TABLE "WorkFieldOption"      ADD COLUMN "orgId" TEXT;
ALTER TABLE "WorkFieldValue"       ADD COLUMN "orgId" TEXT;
ALTER TABLE "WorkComment"          ADD COLUMN "orgId" TEXT;

-- ----------------------------------------------------------------------------
-- Fase 2 — backfill a partir do pai.
--
-- BioChallengePost e BioChallengeSnapshot têm como pai a BioChallengeAccount,
-- que só ganhou orgId nesta mesma migration. Em vez de depender da ordem dos
-- comandos aqui, os dois sobem DOIS saltos até a BioChallenge, que já tinha a
-- coluna — assim o resultado não muda se alguém reordenar este bloco.
-- ----------------------------------------------------------------------------
UPDATE "IntegrationHealth" f
   SET "orgId" = p."orgId"
  FROM "IntegrationAccount" p
 WHERE p."id" = f."accountId" AND f."orgId" IS NULL;

UPDATE "LeadEvent" f
   SET "orgId" = p."orgId"
  FROM "Lead" p
 WHERE p."id" = f."leadId" AND f."orgId" IS NULL;

UPDATE "BioLink" f
   SET "orgId" = p."orgId"
  FROM "BioPage" p
 WHERE p."id" = f."pageId" AND f."orgId" IS NULL;

UPDATE "BioChallengeAccount" f
   SET "orgId" = p."orgId"
  FROM "BioChallenge" p
 WHERE p."id" = f."challengeId" AND f."orgId" IS NULL;

UPDATE "BioChallengePost" f
   SET "orgId" = d."orgId"
  FROM "BioChallengeAccount" c
  JOIN "BioChallenge" d ON d."id" = c."challengeId"
 WHERE c."id" = f."contaId" AND f."orgId" IS NULL;

UPDATE "BioChallengeSnapshot" f
   SET "orgId" = d."orgId"
  FROM "BioChallengeAccount" c
  JOIN "BioChallenge" d ON d."id" = c."challengeId"
 WHERE c."id" = f."contaId" AND f."orgId" IS NULL;

UPDATE "WorkStatus" f
   SET "orgId" = p."orgId"
  FROM "WorkList" p
 WHERE p."id" = f."listId" AND f."orgId" IS NULL;

UPDATE "WorkFieldOption" f
   SET "orgId" = p."orgId"
  FROM "WorkField" p
 WHERE p."id" = f."fieldId" AND f."orgId" IS NULL;

UPDATE "WorkFieldValue" f
   SET "orgId" = p."orgId"
  FROM "WorkTask" p
 WHERE p."id" = f."taskId" AND f."orgId" IS NULL;

UPDATE "WorkComment" f
   SET "orgId" = p."orgId"
  FROM "WorkTask" p
 WHERE p."id" = f."taskId" AND f."orgId" IS NULL;

-- Conferência antes de exigir. `SET NOT NULL` sozinho falharia com uma mensagem
-- que não diz quantas linhas nem por quê — e esta migration roda no boot da API.
DO $$
DECLARE
  t         text;
  faltando  bigint;
  relatorio text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'IntegrationHealth', 'LeadEvent', 'BioLink', 'BioChallengeAccount',
    'BioChallengePost', 'BioChallengeSnapshot', 'WorkStatus',
    'WorkFieldOption', 'WorkFieldValue', 'WorkComment'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE "orgId" IS NULL', t) INTO faltando;
    IF faltando > 0 THEN
      relatorio := relatorio || format('  %s: %s linha(s) sem pai alcançável%s', t, faltando, chr(10));
    END IF;
  END LOOP;

  IF relatorio <> '' THEN
    RAISE EXCEPTION E'backfill de orgId incompleto — linhas cujo pai não resolve:\n%\nInvestigue antes de exigir NOT NULL: linha filha sem pai é dado corrompido, não caso de borda.', relatorio;
  END IF;
END $$;

-- Segunda conferência: SUJEIRA QUE JÁ EXISTE.
--
-- A primeira só cobra linha sem empresa. Mas num banco povoado existe um estado
-- pior e perfeitamente legal até hoje: o filho pendurado em pai de OUTRA
-- empresa. Sem coluna própria nada impedia — e WorkFieldValue tem três pais, dos
-- quais o backfill usa só um, então um valor com tarefa da empresa A e campo da
-- empresa B sai daqui com `orgId` da A e o cruzamento intacto.
--
-- Se essa conferência não existisse, o roteiro seria: a migration aplica em
-- silêncio, a API sobe, e o teste de isolamento fica vermelho DEPOIS do deploy,
-- sem nada ter avisado antes. Aqui a migration para — e `prisma migrate deploy`
-- roda no `command` do container, então parar é barulhento de propósito.
--
-- Se isto disparar: NÃO apague a conferência. A linha apontada é dado cruzado
-- entre empresas; decida caso a caso (corrigir o pai, corrigir o filho ou
-- apagar a linha) e só então rode a migration de novo.
DO $$
DECLARE
  r         record;
  cruzadas  bigint;
  exemplo   text;
  relatorio text := '';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('IntegrationHealth',    'IntegrationAccount',  'accountId'),
      ('LeadEvent',            'Lead',                'leadId'),
      ('BioLink',              'BioPage',             'pageId'),
      ('BioChallengeAccount',  'BioChallenge',        'challengeId'),
      ('BioChallengePost',     'BioChallengeAccount', 'contaId'),
      ('BioChallengeSnapshot', 'BioChallengeAccount', 'contaId'),
      ('WorkStatus',           'WorkList',            'listId'),
      ('WorkFieldOption',      'WorkField',           'fieldId'),
      ('WorkFieldValue',       'WorkTask',            'taskId'),
      ('WorkFieldValue',       'WorkField',           'fieldId'),
      ('WorkFieldValue',       'WorkFieldOption',     'optionId'),
      ('WorkComment',          'WorkTask',            'taskId')
    ) AS t(filho, pai, fk)
  LOOP
    -- IS DISTINCT FROM e não <>: com <>, empresa nula de um lado devolveria NULL
    -- e a linha sairia da contagem justamente no caso mais suspeito.
    EXECUTE format(
      'SELECT count(*), min(f."id") FROM %I f JOIN %I p ON p."id" = f.%I'
      || ' WHERE f."orgId" IS DISTINCT FROM p."orgId"',
      r.filho, r.pai, r.fk)
      INTO cruzadas, exemplo;

    IF cruzadas > 0 THEN
      relatorio := relatorio || format(
        '  %s x %s (por "%s"): %s linha(s) cruzada(s), ex.: id = %L%s',
        r.filho, r.pai, r.fk, cruzadas, exemplo, chr(10));
    END IF;
  END LOOP;

  IF relatorio <> '' THEN
    RAISE EXCEPTION E'empresa cruzada em dado JÁ EXISTENTE — o backfill não inventa a empresa certa:\n%\nCada linha acima tem filho de uma empresa pendurado em pai de outra. Era legal enquanto o filho não tinha coluna de empresa; a partir desta migration deixa de ser, e os gatilhos passariam a recusar qualquer escrita nessas linhas. Resolva o cruzamento e rode de novo.', relatorio;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Fase 3 — a trava: sentinela, NOT NULL, índice e FK.
--
-- O DEFAULT '' precisa existir para o campo continuar opcional no `create` do
-- Prisma (é o que mantém as chamadas atuais compilando). Quem o transforma em
-- valor de verdade é o gatilho do bloco seguinte.
-- ----------------------------------------------------------------------------
ALTER TABLE "IntegrationHealth"    ALTER COLUMN "orgId" SET DEFAULT '', ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "LeadEvent"            ALTER COLUMN "orgId" SET DEFAULT '', ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "BioLink"              ALTER COLUMN "orgId" SET DEFAULT '', ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "BioChallengeAccount"  ALTER COLUMN "orgId" SET DEFAULT '', ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "BioChallengePost"     ALTER COLUMN "orgId" SET DEFAULT '', ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "BioChallengeSnapshot" ALTER COLUMN "orgId" SET DEFAULT '', ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "WorkStatus"           ALTER COLUMN "orgId" SET DEFAULT '', ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "WorkFieldOption"      ALTER COLUMN "orgId" SET DEFAULT '', ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "WorkFieldValue"       ALTER COLUMN "orgId" SET DEFAULT '', ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "WorkComment"          ALTER COLUMN "orgId" SET DEFAULT '', ALTER COLUMN "orgId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "BioChallengeAccount_orgId_idx" ON "BioChallengeAccount"("orgId");

-- CreateIndex
CREATE INDEX "BioChallengePost_orgId_publicadoEm_idx" ON "BioChallengePost"("orgId", "publicadoEm");

-- CreateIndex
CREATE INDEX "BioChallengeSnapshot_orgId_coletadoEm_idx" ON "BioChallengeSnapshot"("orgId", "coletadoEm");

-- CreateIndex
CREATE INDEX "BioLink_orgId_idx" ON "BioLink"("orgId");

-- CreateIndex
CREATE INDEX "IntegrationHealth_orgId_idx" ON "IntegrationHealth"("orgId");

-- CreateIndex
CREATE INDEX "LeadEvent_orgId_occurredAt_idx" ON "LeadEvent"("orgId", "occurredAt");

-- CreateIndex
CREATE INDEX "WorkComment_orgId_createdAt_idx" ON "WorkComment"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkFieldOption_orgId_idx" ON "WorkFieldOption"("orgId");

-- CreateIndex
CREATE INDEX "WorkFieldValue_orgId_idx" ON "WorkFieldValue"("orgId");

-- CreateIndex
CREATE INDEX "WorkStatus_orgId_idx" ON "WorkStatus"("orgId");

-- AddForeignKey
ALTER TABLE "IntegrationHealth" ADD CONSTRAINT "IntegrationHealth_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioLink" ADD CONSTRAINT "BioLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioChallengeAccount" ADD CONSTRAINT "BioChallengeAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioChallengePost" ADD CONSTRAINT "BioChallengePost_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioChallengeSnapshot" ADD CONSTRAINT "BioChallengeSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkStatus" ADD CONSTRAINT "WorkStatus_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkFieldOption" ADD CONSTRAINT "WorkFieldOption_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkFieldValue" ADD CONSTRAINT "WorkFieldValue_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkComment" ADD CONSTRAINT "WorkComment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Fase 3b — o gatilho que faz a coluna valer alguma coisa.
--
-- Uma função só, parametrizada por gatilho: TG_ARGV[0] = tabela do pai,
-- TG_ARGV[1] = coluna da chave estrangeira que leva até ele. `NEW."orgId"` é
-- resolvido em tempo de execução, que é o que permite a mesma função servir aos
-- doze gatilhos das dez tabelas (WorkFieldValue tem três pais, logo três).
--
-- Sem SECURITY DEFINER de propósito: quando a aplicação deixar de conectar como
-- dona das tabelas (role mktos_app) e o isolamento por linha entrar, o gatilho
-- deve enxergar o mesmo banco que o chamador enxerga — um gatilho que lê o pai
-- ignorando a política de linha seria um canal de leitura cruzada.
--
-- POR QUE `SET search_path` E POR QUE O PAI VAI QUALIFICADO
-- O nome do pai chega como texto e é interpolado num EXECUTE. Se o identificador
-- for escrito SEM schema e a função não fixar o `search_path`, quem controla o
-- `search_path` da sessão controla QUAL tabela o gatilho lê. O ataque cabe em
-- quatro linhas e foi reproduzido no Postgres descartável:
--
--     CREATE SCHEMA falso;
--     CREATE TABLE falso."Lead" (id text primary key, "orgId" text);
--     INSERT INTO falso."Lead" VALUES ('<lead real da empresa A>', '<empresa B>');
--     SET search_path TO falso, public;
--     INSERT INTO public."LeadEvent" (id,"leadId",type) VALUES (...,'<lead da A>','x');
--     -- o evento nasce carimbado com a empresa B: exatamente o cruzamento que
--     -- este gatilho existe para recusar.
--
-- As FKs não veem nada de errado (o id do lead é real, a empresa é real). Hoje o
-- ataque exige SQL arbitrário e a aplicação conecta como dona do banco — já se
-- perderia por outro caminho. Depois da fatia 1.3, com papel restrito e RLS, o
-- gatilho passa a ser a ÚNICA barreira e isto vira escalada de verdade.
--
-- Duas travas, porque uma só não basta:
--   1. `SET search_path = pg_catalog, pg_temp` na função: o `search_path` da
--      sessão deixa de valer aqui dentro, e `pg_temp` por último impede tabela
--      temporária de sombrear função do catálogo. Não é SECURITY DEFINER: o
--      papel continua sendo o do chamador, muda só a resolução de nome.
--   2. o pai vai QUALIFICADO por `TG_TABLE_SCHEMA` — o schema real da tabela que
--      disparou o gatilho, informado pelo servidor e fora do alcance de quem
--      chama. Pai e filho moram no mesmo schema; usar uma constante 'public'
--      prenderia a migration a um schema só.
-- ============================================================================
CREATE OR REPLACE FUNCTION mktos_orgid_do_pai() RETURNS trigger AS $$
DECLARE
  tabela_pai text := TG_ARGV[0];
  coluna_fk  text := TG_ARGV[1];
  valor_fk   text;
  org_pai    text;
BEGIN
  valor_fk := to_jsonb(NEW) ->> coluna_fk;

  -- UPDATE que não mexeu nem no pai nem na empresa: nada a conferir.
  IF TG_OP = 'UPDATE'
     AND NEW."orgId" IS NOT DISTINCT FROM OLD."orgId"
     AND valor_fk IS NOT DISTINCT FROM (to_jsonb(OLD) ->> coluna_fk) THEN
    RETURN NEW;
  END IF;

  -- Chave estrangeira opcional e nula: não há pai de quem herdar.
  IF valor_fk IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT "orgId" FROM %I.%I WHERE "id" = $1', TG_TABLE_SCHEMA, tabela_pai)
     INTO org_pai
    USING valor_fk;

  IF org_pai IS NULL THEN
    RAISE EXCEPTION
      'orgId não derivável: %.% = % não encontra pai em % (ou o pai está sem empresa)',
      TG_TABLE_NAME, coluna_fk, valor_fk, tabela_pai
      USING ERRCODE = '23503';
  END IF;

  IF NEW."orgId" IS NULL OR NEW."orgId" = '' THEN
    NEW."orgId" := org_pai;
  ELSIF NEW."orgId" <> org_pai THEN
    RAISE EXCEPTION
      'empresa cruzada: %."orgId" = % mas o pai % % pertence a %',
      TG_TABLE_NAME, NEW."orgId", tabela_pai, valor_fk, org_pai
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp;

COMMENT ON FUNCTION mktos_orgid_do_pai() IS
  'Deriva e confere o orgId de um filho a partir do pai. search_path fixo e pai qualificado por TG_TABLE_SCHEMA de propósito: sem isso o search_path da sessão escolhe qual tabela vale como pai. Ver a migration 20260910120000_orgid_em_todo_filho.';

CREATE TRIGGER "IntegrationHealth_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "IntegrationHealth"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('IntegrationAccount', 'accountId');

CREATE TRIGGER "LeadEvent_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "LeadEvent"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Lead', 'leadId');

CREATE TRIGGER "BioLink_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "BioLink"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('BioPage', 'pageId');

CREATE TRIGGER "BioChallengeAccount_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "BioChallengeAccount"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('BioChallenge', 'challengeId');

CREATE TRIGGER "BioChallengePost_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "BioChallengePost"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('BioChallengeAccount', 'contaId');

CREATE TRIGGER "BioChallengeSnapshot_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "BioChallengeSnapshot"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('BioChallengeAccount', 'contaId');

CREATE TRIGGER "WorkStatus_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "WorkStatus"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('WorkList', 'listId');

CREATE TRIGGER "WorkFieldOption_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "WorkFieldOption"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('WorkField', 'fieldId');

CREATE TRIGGER "WorkComment_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "WorkComment"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('WorkTask', 'taskId');

-- WorkFieldValue tem TRÊS pais, não dois: a tarefa (taskId), o campo (fieldId) e
-- a OPÇÃO escolhida (optionId) — esta última uma FK anulável para
-- WorkFieldOption, que ganhou empresa nesta mesma migration.
--
-- Gatilho de linha dispara em ordem alfabética de nome: o "_1_" deriva da
-- tarefa, o "_2_" confere contra o campo e o "_3_" contra a opção. Sem o
-- terceiro, um valor com tarefa e campo da empresa A e opção da empresa B é
-- ACEITO — reproduzido no Postgres descartável — e a consulta que junta
-- WorkFieldValue com WorkFieldOption devolve o rótulo da outra empresa.
-- O ramo de FK nula já é tratado na função: valor sem opção escolhida não tem
-- pai de quem herdar e passa direto.
CREATE TRIGGER "WorkFieldValue_orgId_1_da_tarefa"
  BEFORE INSERT OR UPDATE ON "WorkFieldValue"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('WorkTask', 'taskId');

CREATE TRIGGER "WorkFieldValue_orgId_2_confere_campo"
  BEFORE INSERT OR UPDATE ON "WorkFieldValue"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('WorkField', 'fieldId');

CREATE TRIGGER "WorkFieldValue_orgId_3_confere_opcao"
  BEFORE INSERT OR UPDATE ON "WorkFieldValue"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('WorkFieldOption', 'optionId');
