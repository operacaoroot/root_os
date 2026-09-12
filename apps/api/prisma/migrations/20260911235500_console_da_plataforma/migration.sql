-- ============================================================================
-- O CONSOLE DA PLATAFORMA (RF-B-02) — fatia 6.3
--
-- Cria `EmpresaNaPlataforma` e `AcessoDeSuporte` e as deixa nascer JÁ ISOLADAS:
-- `ENABLE` + `FORCE ROW LEVEL SECURITY` e as duas políticas, na MESMA migration
-- que cria a tabela.
--
-- Isso não é zelo, é pré-requisito de arranque: a migration
-- `20260911050000_isolamento_por_linha` termina percorrendo o catálogo e ABORTA
-- se achar tabela de `public` sem RLS/FORCE/policy. Ela já rodou e não vê estas
-- (que nascem depois) — mas num banco recriado do zero ela volta a rodar ANTES
-- desta, e a catraca permanente (`apps/api/test/tenant-isolation.test.ts`)
-- pergunta a mesma coisa ao catálogo a cada suíte. E migration que aborta roda
-- no `command` do container: abortar é a API não subir.
--
-- ESCRITA À MÃO, e não por `prisma migrate dev`: outras fatias desta onda criam
-- modelo no mesmo `schema.prisma`, e a geração automática compara o schema
-- INTEIRO com o banco — engoliria os modelos delas aqui dentro.
--
-- PROVADA no banco `prova_63` (container `mktos-shadow`), do zero, com o
-- histórico inteiro aplicado antes.
--
-- ----------------------------------------------------------------------------
-- AS DUAS TABELAS SÃO DE EMPRESAS DIFERENTES — é o desenho da fatia
-- ----------------------------------------------------------------------------
-- `EmpresaNaPlataforma`.orgId  = a empresa DA PLATAFORMA (slug `plataforma`).
--   A linha FALA de um cliente (`empresaId`), mas PERTENCE à plataforma. É o
--   registro comercial e operacional: plano, estado, saúde, uso, cobrança.
--   Porque a linha é da plataforma, o console a lê pela policy COMUM — sem
--   sentinela, sem exceção, sem entrar em `CHAMADORES_DE_PLATAFORMA`.
--
-- `AcessoDeSuporte`.orgId      = a empresa DO CLIENTE.
--   É o cliente quem autoriza, quem vê a lista e quem revoga. A policy comum já
--   diz tudo: só ele alcança. A plataforma só encontra a linha quando o serviço
--   abre o contexto DAQUELA empresa para conferir a autorização — o único
--   momento em que a plataforma entra na casa do cliente, e ele fica registrado
--   no RASTRO dela.
--
-- NENHUMA SENTINELA NAS POLICIES ABAIXO. Nem a pública, nem a de plataforma. A
-- fatia poderia ter pedido uma cláusula `OR public.app_plataforma()` na leitura
-- de `EmpresaNaPlataforma` e economizado a coluna `orgId`; não pediu, porque
-- cláusula de sentinela em policy é a exceção que a próxima tabela copia sem
-- pensar. Aqui a empresa da plataforma é uma empresa como as outras, e é isso
-- que faz o console caber na regra em vez de abrir uma porta ao lado dela.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTA MIGRATION **NÃO** CRIA: a empresa da plataforma
-- ----------------------------------------------------------------------------
-- Provisionamento idempotente de empresa JÁ EXISTE (`src/tenants/provisionar.ts`,
-- rota `POST /tenants/provisionar` e `src/scripts/provisionar-tenant.ts`) e faz
-- o que um `INSERT` daqui não faria: cria o admin com senha (que nunca pode
-- entrar em arquivo versionado), semeia papéis e registra o nascimento no
-- RASTRO. Duplicar isso em SQL seria uma segunda forma de nascer empresa, com
-- metade das garantias.
--
-- A empresa da plataforma é provisionada com:
--     slug    = 'plataforma'
--     modulos = []            <- e é ISTO que fecha as rotas de negócio
--
-- `modulos = []` não é detalhe de configuração: é o gate de módulos por empresa
-- (RF-T-06, `src/tenants/modulos.ts`) respondendo 404 em TODA rota de módulo —
-- leads, financeiro, bio, pauta, conteúdo, campanhas, metas, instagram, pixels,
-- relatórios e trabalho — para a sessão de quem opera a plataforma. Sem lista
-- nova, sem `if` novo, e sem depender de alguém ter lembrado.
--
-- O SEED ABAIXO é CONDICIONAL por causa disso: se a empresa da plataforma ainda
-- não existe, ele não tem onde pendurar as linhas e se cala com um NOTICE. O
-- console continua funcionando — quem registra empresa é
-- `PUT /api/tenants/plataforma/empresas/:empresaId`.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
-- O Prisma não tem migration de descida, e migration aplicada é IMUTÁVEL (o
-- banco guarda o resumo; editar o arquivo depois faz o banco continuar com o SQL
-- antigo enquanto o arquivo mostra o novo). Então o caminho de volta é escrito:
--
--   DROP TABLE "AcessoDeSuporte";
--   DROP TABLE "EmpresaNaPlataforma";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260911235500_console_da_plataforma';
--
-- As policies somem com as tabelas. Nada de `Org`, `User` ou `Role` é alterado
-- aqui, então desfazer não perde nada além do registro comercial acumulado e do
-- histórico de acessos de suporte — este último também está no RASTRO, que não
-- é tocado.
-- ============================================================================

-- CreateTable
CREATE TABLE "EmpresaNaPlataforma" (
    "id" TEXT NOT NULL,
    -- A empresa DONA do registro: a plataforma.
    "orgId" TEXT NOT NULL,
    -- A empresa DESCRITA. Sem chave estrangeira de propósito: é um ponteiro de
    -- uma empresa para OUTRA, que é a forma que o gatilho `mktos_orgid_do_pai`
    -- recusa no resto do schema. Aqui o cruzamento é o assunto da tabela, e uma
    -- FK faria um leitor futuro (ou uma catraca futura) lê-lo como violação.
    "empresaId" TEXT NOT NULL,
    -- Cópias, não join: o console não alcança `Org` de outra empresa.
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plano" TEXT NOT NULL DEFAULT 'piloto',
    "estado" TEXT NOT NULL DEFAULT 'ativa',
    "saude" TEXT NOT NULL DEFAULT 'ok',
    "usuarios" INTEGER NOT NULL DEFAULT 0,
    "agentesAtivos" INTEGER NOT NULL DEFAULT 0,
    -- Dólar: é a moeda em que o provedor de modelo cobra.
    "gastoIaUsdMes" DECIMAL(12,6) NOT NULL DEFAULT 0,
    -- Real: é a moeda do contrato.
    "mensalidadeBrl" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cobrancaEmDia" BOOLEAN NOT NULL DEFAULT true,
    "proximaCobranca" TIMESTAMP(3),
    "medidoEm" TIMESTAMP(3),
    "ultimaAtividadeEm" TIMESTAMP(3),
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmpresaNaPlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcessoDeSuporte" (
    "id" TEXT NOT NULL,
    -- A empresa CLIENTE, que autorizou. A linha é dela.
    "orgId" TEXT NOT NULL,
    -- E-mail e não `userId`: o operador é usuário de OUTRA empresa, e a policy
    -- de `User` recorta por empresa — o join seria inútil justamente dentro do
    -- contexto do cliente, que é onde a conferência acontece.
    "operadorEmail" TEXT NOT NULL,
    "operadorNome" TEXT,
    "escopo" TEXT NOT NULL,
    -- Campo de R4 (`exigeMotivo`). Conferido no serviço; a coluna é NOT NULL
    -- para que nem um caminho futuro consiga gravar concessão sem explicação.
    "motivo" TEXT NOT NULL,
    "autorizadoPorId" TEXT NOT NULL,
    "autorizadoPorNome" TEXT NOT NULL,
    "autorizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- A hora em que o acesso acaba SOZINHO. NOT NULL e sem default: acesso de
    -- suporte sem prazo é acesso permanente, e um default aqui seria a forma de
    -- ele aparecer sem ninguém ter decidido.
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "revogadoEm" TIMESTAMP(3),
    "revogadoPorId" TEXT,
    "usos" INTEGER NOT NULL DEFAULT 0,
    "ultimoUsoEm" TIMESTAMP(3),
    -- O evento do RASTRO que registrou a autorização. A linha pode ser
    -- alterada; o evento encadeado, não.
    "eventoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcessoDeSuporte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Uma linha por (plataforma, empresa descrita): o registro é único, e é este
-- índice que sustenta o `upsert` do console.
CREATE UNIQUE INDEX "EmpresaNaPlataforma_orgId_empresaId_key"
  ON "EmpresaNaPlataforma"("orgId", "empresaId");

-- CreateIndex
CREATE INDEX "EmpresaNaPlataforma_orgId_estado_idx" ON "EmpresaNaPlataforma"("orgId", "estado");

-- CreateIndex
-- O caminho QUENTE: "esta empresa autorizou este operador, e ainda vale?".
-- Começa por `orgId` porque é por ele que a policy de linha recorta.
CREATE INDEX "AcessoDeSuporte_orgId_operadorEmail_expiraEm_idx"
  ON "AcessoDeSuporte"("orgId", "operadorEmail", "expiraEm");

-- CreateIndex
CREATE INDEX "AcessoDeSuporte_orgId_expiraEm_idx" ON "AcessoDeSuporte"("orgId", "expiraEm");

-- AddForeignKey
ALTER TABLE "EmpresaNaPlataforma" ADD CONSTRAINT "EmpresaNaPlataforma_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcessoDeSuporte" ADD CONSTRAINT "AcessoDeSuporte_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA — modo forçado, as duas políticas, nas DUAS tabelas
--
-- `app_rls_aplicar_policies` veio da migration do isolamento e faz o pacote
-- inteiro: DROP POLICY IF EXISTS (idempotente), CREATE POLICY de SELECT, INSERT,
-- UPDATE e DELETE, ENABLE e FORCE. As expressões são as do grupo padrão de lá: a
-- empresa da sessão alcança o que é dela, e nada mais.
--
-- `EmpresaNaPlataforma` NÃO se apaga pela aplicação (o último argumento é
-- `false`). Registro comercial que some não deixa rastro de ter existido, e o
-- console já tem `estado = 'encerrada'` para dizer que a relação acabou. Quem
-- precisar apagar de verdade usa a conexão dona, com uma decisão por trás.
--
-- `AcessoDeSuporte` também NÃO se apaga: revogar é `revogadoEm`, não DELETE.
-- Uma autorização apagada é uma autorização que não aconteceu — e o que a LGPD
-- pede aqui é exatamente o contrário: que tenha acontecido e esteja registrado.
-- ---------------------------------------------------------------------------
SELECT app_rls_aplicar_policies(
  'EmpresaNaPlataforma',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  true,   -- insere
  true,   -- altera
  false   -- apaga: nunca pela aplicação
);

SELECT app_rls_aplicar_policies(
  'AcessoDeSuporte',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  true,   -- insere: o cliente autoriza
  true,   -- altera: revogar, e carimbar o uso
  false   -- apaga: revogar não é apagar
);

-- ---------------------------------------------------------------------------
-- PERMISSÃO DO PAPEL RESTRITO
--
-- `20260911020000_papel_de_aplicacao` deixou `ALTER DEFAULT PRIVILEGES` ligado
-- para `mktos_app`, então tabela criada por `mkt` já nasce com os GRANTs. O
-- GRANT explícito existe para o caso em que ela NÃO nasceu assim (banco
-- restaurado de dump, migration do papel aplicada por outro usuário). É
-- idempotente e não custa nada.
--
-- Guardado por `has_role`: em banco onde o papel não existe (o Mac de quem só
-- roda a suíte padrão), GRANT para papel inexistente ABORTA a migration — e
-- migration que aborta no `command` do container é a API não subir.
--
-- SEM DELETE nos dois, para casar com as policies acima: permissão que o banco
-- concede e a policy nega é ruído; permissão que a policy concederia e o GRANT
-- nega é uma recusa com a mensagem errada.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON "EmpresaNaPlataforma" TO mktos_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON "AcessoDeSuporte" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- SEED CONDICIONAL: se a empresa da plataforma já existe, o console nasce cheio
--
-- Só roda quando existe uma `Org` de slug `plataforma`. Quando não existe — que
-- é o caso do primeiro deploy — ele se cala com um NOTICE e não há nada a
-- consertar: o console registra empresa por `PUT /tenants/plataforma/empresas/:id`.
--
-- O `set_config` PARA LER `Org` usa a sentinela de plataforma, que a policy de
-- `Org` já libera para LEITURA (bloco 3.2 da migration do isolamento). É o
-- caminho sancionado para a consulta que atravessa empresas, e ele fica AQUI, em
-- SQL de migration — não no código do console, que continua sem importar a
-- sentinela (ver o cabeçalho de `src/platform/plataforma.ts`).
--
-- A ESCRITA muda o `app.org_id` para a empresa da plataforma, porque a policy de
-- `EmpresaNaPlataforma` exige empresa RESOLVIDA no `WITH CHECK` — sob a
-- sentinela, `app_org_resolvida()` é falso e o INSERT seria recusado. Ler e
-- escrever com valores diferentes é o motivo de existir a tabela temporária no
-- meio: uma instrução só não consegue estar em dois contextos ao mesmo tempo.
--
-- `SET LOCAL` (o terceiro argumento `true` de `set_config`) morre no COMMIT
-- desta migration. Nenhuma sessão da aplicação herda nada daqui.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_plataforma text;
  v_qtd        integer := 0;
BEGIN
  PERFORM set_config('app.org_id', '__plataforma__', true);
  SELECT id INTO v_plataforma FROM "Org" WHERE slug = 'plataforma' LIMIT 1;

  IF v_plataforma IS NULL THEN
    RAISE NOTICE 'console da plataforma: nao existe Org de slug "plataforma" — seed pulado. Provisione-a com modulos = [] (POST /tenants/provisionar) e registre as empresas pelo console.';
    RETURN;
  END IF;

  CREATE TEMP TABLE _empresas_do_console_63 ON COMMIT DROP AS
    SELECT id, name, slug FROM "Org" WHERE slug <> 'plataforma';

  PERFORM set_config('app.org_id', v_plataforma, true);

  INSERT INTO "EmpresaNaPlataforma"
    ("id", "orgId", "empresaId", "nome", "slug", "criadoEm", "atualizadoEm")
  SELECT gen_random_uuid()::text, v_plataforma, e.id, e.name, e.slug, now(), now()
    FROM _empresas_do_console_63 e
   ON CONFLICT ("orgId", "empresaId") DO NOTHING;

  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RAISE NOTICE 'console da plataforma: % empresa(s) registrada(s).', v_qtd;
END $$;
