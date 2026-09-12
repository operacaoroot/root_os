-- ============================================================================
-- O ELO DA MEMÓRIA COM O RASTRO VIRA CHAVE ESTRANGEIRA — e o gancho de RF-M-08
-- passa a ser MUITOS-PARA-UM (fatia 4.1+4.2, correção da revisão)
--
-- MIGRATION NOVA, E NÃO EDIÇÃO DA ANTERIOR. `20260911170000_memoria_versionada`
-- já foi aplicada em banco: migration aplicada é IMUTÁVEL (o banco guarda o
-- resumo do arquivo; editá-lo depois faz o banco continuar com o SQL antigo
-- enquanto o arquivo mostra o novo, e `migrate deploy` recusa rodar com um erro
-- que não tem nada a ver com o assunto). Erro se conserta com migration nova.
--
-- TRÊS CONSERTOS, os três apontados na revisão adversarial:
--
--  1. `ContextItemVersion.eventoId` era um TEXT solto apontando para `EventLog`.
--     `RastroRetencao` apaga evento vencido (`app_rastro_expurgar`), e no dia do
--     primeiro expurgo aquele campo viraria PONTEIRO PENDURADO: a tela de
--     histórico exibiria um identificador que não resolve, e quem audita não
--     teria como separar "o evento venceu" de "alguém apagou a prova". Prova
--     aparente é pior do que prova ausente. Com `ON DELETE SET NULL`, o expurgo
--     LIMPA o id e a `eventoSeq` FICA — e é a sequência sobrevivente que diz
--     "houve evento aqui, e ele venceu".
--
--  2. `semEventoPorque` separa dois sinais que eram o mesmo. Antes, a versão
--     nascida da MIGRAÇÃO do acervo (que de propósito não escreve evento no
--     RASTRO de ninguém) ficava idêntica à versão cujo registro de evento
--     FALHOU — e o acervo migrado enchia o histórico de centenas de linhas com
--     cara de falha. Sinal com dois significados não é sinal.
--
--  3. `ContextItem.supersedesId` nascia com índice ÚNICO, o que fazia o gancho
--     de RF-M-08 ser um-para-um: duas afirmações novas contradizendo a MESMA
--     regra antiga não caberiam, e a segunda seria recusada pelo banco no meio
--     da detecção. Apontar em vez de sobrescrever é muitos-para-um.
--
-- ESCRITA À MÃO, como a anterior e pelo mesmo motivo: outra fatia desta onda
-- cria modelo no mesmo `schema.prisma`, e `prisma migrate dev` compara o schema
-- INTEIRO com o banco — engoliria os modelos dela aqui dentro.
--
-- PROVADA em banco próprio (`prova_41_test` no container `mktos-shadow`), do
-- zero, com o histórico inteiro aplicado antes, e apagada depois.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   ALTER TABLE "ContextItemVersion" DROP CONSTRAINT "ContextItemVersion_eventoId_fkey";
--   DROP INDEX "ContextItemVersion_eventoId_idx";
--   ALTER TABLE "ContextItemVersion" DROP COLUMN "semEventoPorque";
--   DROP INDEX "ContextItem_supersedesId_idx";
--   CREATE UNIQUE INDEX "ContextItem_supersedesId_key" ON "ContextItem"("supersedesId");
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260911193000_memoria_elo_do_evento';
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. POR QUE ESTA VERSÃO NÃO TEM EVENTO
-- ---------------------------------------------------------------------------
ALTER TABLE "ContextItemVersion" ADD COLUMN "semEventoPorque" TEXT;

-- O acervo já migrado (se houver) assume o próprio motivo. O texto é o mesmo
-- que `src/memory/migrar-conhecimento.ts` grava em `motivo`; o comando novo já
-- preenche a coluna direto e este UPDATE só alcança o que foi copiado ANTES
-- desta migration.
UPDATE "ContextItemVersion"
   SET "semEventoPorque" = 'migracao'
 WHERE "eventoId" IS NULL
   AND "eventoSeq" IS NULL
   AND motivo LIKE 'migração do acervo da vault%';

-- ---------------------------------------------------------------------------
-- 2. O ELO VIRA CHAVE ESTRANGEIRA
--
-- A limpeza vem ANTES da constraint de propósito: um `eventoId` que já não
-- resolve (evento expurgado antes desta migration existir) faria o ALTER TABLE
-- ABORTAR — e migration que aborta roda no `command` do container, ou seja, a
-- API não sobe. Limpar é justamente o que a chave estrangeira passará a fazer
-- sozinha daqui em diante; a `eventoSeq` fica, e é ela que conta a história.
-- ---------------------------------------------------------------------------
UPDATE "ContextItemVersion" v
   SET "eventoId" = NULL
 WHERE v."eventoId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "EventLog" e WHERE e.id = v."eventoId");

-- O índice existe para o `SET NULL` do expurgo: sem ele, apagar uma faixa de
-- rastro varre a tabela de versões inteira uma vez por linha apagada.
CREATE INDEX "ContextItemVersion_eventoId_idx" ON "ContextItemVersion"("eventoId");

ALTER TABLE "ContextItemVersion" ADD CONSTRAINT "ContextItemVersion_eventoId_fkey"
  FOREIGN KEY ("eventoId") REFERENCES "EventLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. O GANCHO DE RF-M-08 DEIXA DE SER UM-PARA-UM
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "ContextItem_supersedesId_key";
CREATE INDEX "ContextItem_supersedesId_idx" ON "ContextItem"("supersedesId");

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — as três, sobre o catálogo, não sobre a intenção
--
-- Falha ALTA de propósito: as três coisas acima são silenciosas quando somem num
-- rebase mal resolvido. Um `SET NULL` que virasse `NO ACTION` transformaria o
-- primeiro expurgo por retenção num erro de chave estrangeira no meio da
-- transação que apaga o rastro — e o expurgo é justamente o caminho que não pode
-- falhar pela metade.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  acao char;
  unico int;
  coluna int;
BEGIN
  SELECT confdeltype INTO acao
    FROM pg_constraint
   WHERE conname = 'ContextItemVersion_eventoId_fkey';

  IF acao IS NULL THEN
    RAISE EXCEPTION 'ContextItemVersion.eventoId ficou SEM chave estrangeira para EventLog: o expurgo por retencao voltaria a deixar ponteiro pendurado, que e prova aparente.';
  END IF;
  IF acao <> 'n' THEN
    RAISE EXCEPTION 'ContextItemVersion_eventoId_fkey nao esta como ON DELETE SET NULL (confdeltype=%): o expurgo por retencao falharia no meio da transacao que apaga o rastro.', acao;
  END IF;

  SELECT count(*) INTO unico
    FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'ContextItem_supersedesId_key';
  IF unico > 0 THEN
    RAISE EXCEPTION 'ContextItem.supersedesId continua UNICO: duas afirmacoes novas contra a mesma regra antiga nao caberiam, e RF-M-08 promete apontar, nao sobrescrever.';
  END IF;

  SELECT count(*) INTO coluna
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'ContextItemVersion'
     AND column_name = 'semEventoPorque';
  IF coluna = 0 THEN
    RAISE EXCEPTION 'ContextItemVersion.semEventoPorque nao existe: versao migrada e versao com falha de rastro voltariam a ser o mesmo sinal.';
  END IF;
END $$;
