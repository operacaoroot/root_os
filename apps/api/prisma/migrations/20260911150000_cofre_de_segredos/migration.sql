-- ============================================================================
-- O COFRE: SEGREDO POR EMPRESA E POR CONECTOR (RF-C-01..RF-C-04) — fatia 5.3
--
-- Cria `SegredoDeConector` e a deixa nascer JÁ ISOLADA: `ENABLE` + `FORCE ROW
-- LEVEL SECURITY` e as duas políticas, na mesma migration que cria a tabela.
--
-- POR QUE ISSO NÃO É ZELO, É PRÉ-REQUISITO DE ARRANQUE. A migration
-- `20260911050000_isolamento_por_linha` termina com uma conferência que percorre
-- o catálogo e ABORTA se achar tabela de `public` sem RLS/FORCE/policy. Ela já
-- rodou e não vê esta tabela (que nasce depois) — mas a catraca permanente vê:
-- `apps/api/test/tenant-isolation.test.ts` pergunta ao catálogo a mesma coisa, e
-- num banco recriado do zero a conferência da 1.5 volta a rodar antes desta.
-- Tabela de empresa sem policy é vazamento, não pendência. E migration que
-- aborta roda no `command` do container: abortar é a API não subir.
--
-- ESCRITO À MÃO, e não por `prisma migrate dev`. Duas fatias desta onda criam
-- modelo no mesmo arquivo de schema; a geração automática compara o schema
-- INTEIRO com o banco e engoliria os modelos da outra aqui dentro.
--
-- PROVADA EM BANCO PRÓPRIO (`prova_53` no container `mktos-shadow`), do zero,
-- e com o papel restrito `mktos_app` — não com o dono, que é superusuário,
-- atravessa policy e não exercita nada.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTA TABELA GUARDA, EM UMA FRASE
-- ----------------------------------------------------------------------------
-- O segredo de UMA empresa para UM conector, cifrado em repouso com AES-256-GCM,
-- carregando o ID DA CHAVE que o cifrou. O id da chave é o que separa "rotação"
-- de "perder tudo de uma vez": o cofre carrega um CHAVEIRO com várias chaves ao
-- mesmo tempo, e a linha que a rotação ainda não tocou continua abrindo pela
-- chave velha, que segue no chaveiro.
--
-- Antes desta migration havia UMA chave de ambiente (`ENCRYPTION_KEY`) para
-- tudo — e ela nem alcançava tudo: `GoogleAccount.accessToken`/`refreshToken` e
-- `MetaAccount.userToken`/`pageToken` estavam em TEXTO PURO no banco. Esta
-- migration NÃO apaga nem mexe nessas colunas (ver "caminho de volta", abaixo):
-- quem copia o conteúdo delas para cá é um script de dados, separado e
-- reversível.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
-- O Prisma não tem migration de descida, e migration aplicada é IMUTÁVEL (o
-- banco guarda o resumo; editar o arquivo depois faz o banco continuar com o SQL
-- antigo enquanto o arquivo mostra o novo). Então o caminho de volta é escrito,
-- e é este — em duas camadas, porque são dois riscos diferentes:
--
--  1. DADO. Nenhuma coluna de origem é lida, alterada ou apagada aqui. O script
--     `src/cofre/migrar-credenciais.ts` COPIA para cá e deixa a origem intacta,
--     e `--desfazer` apaga o que ele copiou (as linhas com `origem` começando em
--     `migracao:`). Enquanto a fatia que remove as colunas de origem não chegar,
--     desfazer é grátis e não perde nada.
--
--  2. ESTRUTURA. Para remover a tabela inteira:
--
--       DROP TABLE "SegredoDeConector";
--       DELETE FROM "_prisma_migrations" WHERE migration_name = '20260911150000_cofre_de_segredos';
--
--     As policies somem junto com a tabela. Rodar isso com o cofre EM USO perde
--     todo segredo que só existia aqui — por isso a ordem é sempre: desfazer o
--     dado primeiro (1), a estrutura depois (2).
-- ============================================================================

-- CreateTable
CREATE TABLE "SegredoDeConector" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "conector" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    -- O pacote inteiro numa coluna: `c2.<chaveId>.<iv>.<tag>.<dados>`, tudo em
    -- base64 separado por ponto (base64 não contém ponto, então a separação é
    -- inequívoca). Coluna separada por pedaço obrigaria a ler quatro campos para
    -- abrir um valor, e a manter os quatro em sincronia na rotação.
    "valorCifrado" TEXT NOT NULL,
    "chaveId" TEXT NOT NULL,
    -- Lista de texto, com DEFAULT de lista vazia. A coluna é anulável no banco
    -- porque é assim que o Prisma modela lista escalar (e a conferência
    -- `migrate diff` contra o schema tem de dar vazio) — mas o DEFAULT garante
    -- que nada nasça NULL, e o cliente entrega `[]`. Importa porque "sem escopo"
    -- não pode virar uma decisão de quem lê: a metade que interpretasse NULL
    -- como "tudo" abriria o cofre.
    "escopo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "origem" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "rotacionadoEm" TIMESTAMP(3),
    "usadoEm" TIMESTAMP(3),
    "revogadoEm" TIMESTAMP(3),
    "revogadoPor" TEXT,
    "motivoRevogacao" TEXT,

    CONSTRAINT "SegredoDeConector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- UM segredo por (empresa, conector, nome). Guardar dois seria guardar um que
-- ninguém sabe qual é — e a revogação deixaria o outro vivo, que é exatamente o
-- defeito que o cofre existe para não ter.
CREATE UNIQUE INDEX "SegredoDeConector_orgId_conector_nome_key"
  ON "SegredoDeConector"("orgId", "conector", "nome");

-- CreateIndex
--
-- A consulta da ROTAÇÃO: "o que ainda está na chave velha?" (`WHERE "chaveId"
-- <> $1`). Ela atravessa EMPRESAS de propósito — rotação é manutenção de
-- plataforma, roda com a conexão dona e não sob policy de empresa nenhuma. Sem
-- este índice, toda volta da rotação varre a tabela inteira para descobrir o que
-- já migrou, e a retomada depois de uma interrupção fica quadrática.
CREATE INDEX "SegredoDeConector_chaveId_idx" ON "SegredoDeConector"("chaveId");

-- AddForeignKey
ALTER TABLE "SegredoDeConector" ADD CONSTRAINT "SegredoDeConector_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA — modo forçado, duas políticas
--
-- `app_rls_aplicar_policies` veio da migration do isolamento e faz o pacote
-- inteiro: DROP POLICY IF EXISTS (idempotente), CREATE POLICY de SELECT, INSERT,
-- UPDATE e DELETE, ENABLE e FORCE. Os argumentos são as mesmas expressões do
-- grupo padrão de lá: a empresa da sessão alcança o que é dela, e nada mais.
--
-- NENHUMA SENTINELA AQUI — nem a pública, nem a de plataforma, e numa tabela de
-- segredo isso importa mais do que em qualquer outra. Uma cláusula de sentinela
-- dentro da policy de LEITURA abre a tabela INTEIRA para qualquer código que
-- rode sob ela; aqui a tabela inteira é a credencial de todos os clientes. O
-- caminho de plataforma que precisa atravessar (a rotação de chave) NÃO passa
-- por sentinela: ele roda com a conexão DONA, que é superusuária, fora do
-- alcance de qualquer requisição HTTP. Ver o cabeçalho de
-- `src/cofre/rotacionar-chave.cli.ts`.
--
-- LEITURA e ESCRITA são iguais em texto e diferentes em papel: a de escrita vira
-- `WITH CHECK` no INSERT e no UPDATE, que é o que impede uma empresa de mover o
-- próprio segredo para dentro de outra.
--
-- E A POLICY NÃO É A ÚNICA TRANCA. O valor é cifrado com `orgId|conector|nome`
-- como dado associado do GCM: uma linha copiada para outra empresa — por dump,
-- por restauração, por SQL de quem tem o banco na mão — NÃO ABRE, mesmo com a
-- chave certa. A policy protege a consulta; o dado associado protege o dado.
-- ---------------------------------------------------------------------------
SELECT app_rls_aplicar_policies(
  'SegredoDeConector',
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "SegredoDeConector" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL — a mesma pergunta da 1.5, só que sobre esta tabela
--
-- Falha ALTA de propósito: se a chamada acima deixar de existir num rebase mal
-- resolvido, é melhor a migration abortar aqui do que a tabela de CREDENCIAIS
-- entrar em produção legível por qualquer empresa.
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
   WHERE n.nspname = 'public' AND c.relname = 'SegredoDeConector';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'SegredoDeConector ficou sem isolamento por linha (rls/force/policies). Tabela de credencial sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
