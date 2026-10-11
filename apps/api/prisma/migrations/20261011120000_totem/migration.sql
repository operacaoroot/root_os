-- ============================================================================
-- O MÓDULO TOTEM — consulta de produto, lote e cupom na loja (11/10/2026)
--
-- Desenho em `docs/totem/CONTRATO.md`. Quinze tabelas da empresa dona da rede
-- de lojas (o primeiro cliente é o Sr. aGranel): configuração, lojas, vínculo
-- de usuário com loja, aparelhos, produtos, lotes, remessas e seus itens,
-- reposições, etiquetas, campanhas, clientes, consentimentos, cupons e eventos.
--
-- ----------------------------------------------------------------------------
-- 1. TODA TABELA TEM `orgId` PRÓPRIO, SEM SENTINELA E SEM GATILHO
-- ----------------------------------------------------------------------------
-- É o padrão das tabelas de empresa do schema: `orgId` obrigatório, sem
-- default, FK para `Org`, gravado pelo serviço. Nenhuma usa a sentinela `''`
-- nem `mktos_orgid_do_pai`, e nenhuma entra em `FILHOS_COM_ORGID_REDUNDANTE`.
-- O que a FK sozinha não cobre (um lote de A pendurado em produto de B) é
-- barrado no serviço, que lê o pai pelo id com a RLS ligada antes de gravar o
-- filho. A limitação está na `nota` de cada entrada de `ALVOS` no teste de
-- isolamento.
--
-- ----------------------------------------------------------------------------
-- 2. O APARELHO E A ETIQUETA SÃO ACHADOS PELA SENTINELA, E SÓ ELES
-- ----------------------------------------------------------------------------
-- As rotas públicas do totem não têm empresa até achar o aparelho (pelo hash
-- do código de ativação ou do token) ou a etiqueta (pelo código). É o mesmo
-- contrato de `OnboardingConvite`: a LEITURA de `TotemDispositivo` e de
-- `TotemEtiqueta` aceita `app_resolucao_publica()`, a escrita não. As outras
-- treze ficam na policy padrão, e o resto do pedido roda dentro da empresa
-- achada (`comTenantPublico`).
--
-- ----------------------------------------------------------------------------
-- 3. O QUE NÃO ESTÁ AQUI, DE PROPÓSITO
-- ----------------------------------------------------------------------------
-- O CPF em claro e o token do aparelho em claro. `TotemCliente` guarda o HMAC
-- do CPF e a máscara; `TotemDispositivo` guarda o SHA-256 do código e do
-- token. Nenhum `ON DELETE CASCADE` além dos itens da remessa: loja e produto
-- se desativam, e o histórico de lote fica.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   DROP TABLE "TotemEvento"; DROP TABLE "TotemCupom";
--   DROP TABLE "TotemConsentimento"; DROP TABLE "TotemCliente";
--   DROP TABLE "TotemCampanha"; DROP TABLE "TotemEtiqueta";
--   DROP TABLE "TotemReposicao"; DROP TABLE "TotemRemessaItem";
--   DROP TABLE "TotemRemessa"; DROP TABLE "TotemLote";
--   DROP TABLE "TotemProduto"; DROP TABLE "TotemDispositivo";
--   DROP TABLE "TotemUsuarioLoja"; DROP TABLE "TotemLoja";
--   DROP TABLE "TotemConfig";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261011120000_totem';
--   e tirar 'totem' de "Org"."modulos" nas empresas que o tinham ligado.
--
-- A volta PERDE lotes, cupons e consentimentos. Exporte antes: o
-- consentimento é a prova exigida pela LGPD e precisa sobreviver à volta.
-- ============================================================================

-- CreateTable
CREATE TABLE "TotemConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "nomeExibicao" TEXT NOT NULL,
    "corPrimaria" TEXT NOT NULL,
    "corFundo" TEXT NOT NULL,
    "logoUrl" TEXT,
    "precoLigado" BOOLEAN NOT NULL DEFAULT false,
    "cadastroLigado" BOOLEAN NOT NULL DEFAULT true,
    "tempoOciosoSeg" INTEGER NOT NULL DEFAULT 60,
    "controladorNome" TEXT NOT NULL,
    "controladorDocumento" TEXT,
    "controladorEndereco" TEXT,
    "encarregadoNome" TEXT,
    "encarregadoContato" TEXT,
    "politicaVersao" TEXT NOT NULL,
    "mensagemBoasVindas" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemLoja" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cidade" TEXT,
    "endereco" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "exemplo" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotemLoja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemUsuarioLoja" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotemUsuarioLoja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemDispositivo" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "codigoAtivacaoHash" TEXT,
    "ativacaoExpiraEm" TIMESTAMP(3),
    "tokenHash" TEXT,
    "ativadoEm" TIMESTAMP(3),
    "revogadoEm" TIMESTAMP(3),
    "vistoEm" TIMESTAMP(3),
    "versaoApp" TEXT,
    "catalogoVersao" TEXT,
    "userAgent" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotemDispositivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemProduto" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "codigoDirector" TEXT,
    "nome" TEXT NOT NULL,
    "nomeBusca" TEXT NOT NULL,
    "categoria" TEXT,
    "composicao" TEXT,
    "beneficios" TEXT,
    "alergenicos" TEXT,
    "porcaoG" DECIMAL(10,2),
    "porcaoDescricao" TEXT,
    "nutricional" JSONB NOT NULL DEFAULT '[]',
    "selos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validadeDiasPadrao" INTEGER,
    "precoCentavos" INTEGER,
    "unidadePreco" TEXT,
    "imagemUrl" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "exemplo" BOOLEAN NOT NULL DEFAULT false,
    "fonteNutricional" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotemProduto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemLote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "fabricadoEm" TIMESTAMP(3),
    "validadeEm" TIMESTAMP(3) NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'producao_central',
    "lojaOrigemId" TEXT,
    "observacao" TEXT,
    "criadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotemLote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemRemessa" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enviada',
    "enviadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recebidaEm" TIMESTAMP(3),
    "recebidaPor" TEXT,
    "observacao" TEXT,
    "criadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotemRemessa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemRemessaItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "remessaId" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" DECIMAL(12,3),
    "unidade" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotemRemessaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemReposicao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "repostoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origem" TEXT NOT NULL,
    "registradoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotemReposicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemEtiqueta" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "loteId" TEXT,
    "codigo" TEXT NOT NULL,
    "impressaEm" TIMESTAMP(3),
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "revogadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotemEtiqueta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemCampanha" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "chamada" TEXT NOT NULL,
    "tipoBeneficio" TEXT NOT NULL,
    "valorBeneficio" DECIMAL(12,2),
    "descricaoBeneficio" TEXT,
    "validadeDias" INTEGER NOT NULL,
    "inicioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fimEm" TIMESTAMP(3),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "lojaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotemCampanha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemCliente" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "cpfHash" TEXT NOT NULL,
    "cpfMascarado" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "nome" TEXT,
    "lojaOrigemId" TEXT,
    "canalOrigem" TEXT NOT NULL,
    "aceitaCampanhas" BOOLEAN NOT NULL DEFAULT false,
    "anonimizadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotemCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemConsentimento" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "politicaVersao" TEXT NOT NULL,
    "finalidades" TEXT[],
    "canal" TEXT NOT NULL,
    "lojaId" TEXT,
    "dispositivoId" TEXT,
    "aceitoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotemConsentimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemCupom" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campanhaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'emitido',
    "emitidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validoAte" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "usadoLojaId" TEXT,
    "usadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotemCupom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemEvento" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "lojaId" TEXT,
    "dispositivoId" TEXT,
    "tipo" TEXT NOT NULL,
    "produtoId" TEXT,
    "termo" TEXT,
    "ocorridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotemEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TotemConfig_orgId_key" ON "TotemConfig"("orgId");

-- CreateIndex
CREATE INDEX "TotemConfig_orgId_idx" ON "TotemConfig"("orgId");

-- CreateIndex
CREATE INDEX "TotemLoja_orgId_idx" ON "TotemLoja"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TotemLoja_orgId_codigo_key" ON "TotemLoja"("orgId", "codigo");

-- CreateIndex
CREATE INDEX "TotemUsuarioLoja_orgId_idx" ON "TotemUsuarioLoja"("orgId");

-- CreateIndex
CREATE INDEX "TotemUsuarioLoja_orgId_userId_idx" ON "TotemUsuarioLoja"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TotemUsuarioLoja_orgId_userId_lojaId_key" ON "TotemUsuarioLoja"("orgId", "userId", "lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "TotemDispositivo_codigoAtivacaoHash_key" ON "TotemDispositivo"("codigoAtivacaoHash");

-- CreateIndex
CREATE UNIQUE INDEX "TotemDispositivo_tokenHash_key" ON "TotemDispositivo"("tokenHash");

-- CreateIndex
CREATE INDEX "TotemDispositivo_orgId_idx" ON "TotemDispositivo"("orgId");

-- CreateIndex
CREATE INDEX "TotemDispositivo_orgId_lojaId_idx" ON "TotemDispositivo"("orgId", "lojaId");

-- CreateIndex
CREATE INDEX "TotemProduto_orgId_idx" ON "TotemProduto"("orgId");

-- CreateIndex
CREATE INDEX "TotemProduto_orgId_nomeBusca_idx" ON "TotemProduto"("orgId", "nomeBusca");

-- CreateIndex
CREATE UNIQUE INDEX "TotemProduto_orgId_codigo_key" ON "TotemProduto"("orgId", "codigo");

-- CreateIndex
CREATE INDEX "TotemLote_orgId_idx" ON "TotemLote"("orgId");

-- CreateIndex
CREATE INDEX "TotemLote_orgId_validadeEm_idx" ON "TotemLote"("orgId", "validadeEm");

-- CreateIndex
CREATE UNIQUE INDEX "TotemLote_orgId_produtoId_codigo_key" ON "TotemLote"("orgId", "produtoId", "codigo");

-- CreateIndex
CREATE INDEX "TotemRemessa_orgId_idx" ON "TotemRemessa"("orgId");

-- CreateIndex
CREATE INDEX "TotemRemessa_orgId_lojaId_status_idx" ON "TotemRemessa"("orgId", "lojaId", "status");

-- CreateIndex
CREATE INDEX "TotemRemessaItem_orgId_idx" ON "TotemRemessaItem"("orgId");

-- CreateIndex
CREATE INDEX "TotemRemessaItem_orgId_remessaId_idx" ON "TotemRemessaItem"("orgId", "remessaId");

-- CreateIndex
CREATE INDEX "TotemRemessaItem_orgId_produtoId_idx" ON "TotemRemessaItem"("orgId", "produtoId");

-- CreateIndex
CREATE INDEX "TotemReposicao_orgId_idx" ON "TotemReposicao"("orgId");

-- CreateIndex
CREATE INDEX "TotemReposicao_orgId_lojaId_produtoId_repostoEm_idx" ON "TotemReposicao"("orgId", "lojaId", "produtoId", "repostoEm");

-- CreateIndex
CREATE UNIQUE INDEX "TotemEtiqueta_codigo_key" ON "TotemEtiqueta"("codigo");

-- CreateIndex
CREATE INDEX "TotemEtiqueta_orgId_idx" ON "TotemEtiqueta"("orgId");

-- CreateIndex
CREATE INDEX "TotemEtiqueta_orgId_lojaId_idx" ON "TotemEtiqueta"("orgId", "lojaId");

-- CreateIndex
CREATE INDEX "TotemCampanha_orgId_idx" ON "TotemCampanha"("orgId");

-- CreateIndex
CREATE INDEX "TotemCliente_orgId_idx" ON "TotemCliente"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TotemCliente_orgId_cpfHash_key" ON "TotemCliente"("orgId", "cpfHash");

-- CreateIndex
CREATE INDEX "TotemConsentimento_orgId_idx" ON "TotemConsentimento"("orgId");

-- CreateIndex
CREATE INDEX "TotemConsentimento_orgId_clienteId_idx" ON "TotemConsentimento"("orgId", "clienteId");

-- CreateIndex
CREATE INDEX "TotemCupom_orgId_idx" ON "TotemCupom"("orgId");

-- CreateIndex
CREATE INDEX "TotemCupom_orgId_clienteId_idx" ON "TotemCupom"("orgId", "clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "TotemCupom_orgId_codigo_key" ON "TotemCupom"("orgId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "TotemCupom_orgId_campanhaId_clienteId_key" ON "TotemCupom"("orgId", "campanhaId", "clienteId");

-- CreateIndex
CREATE INDEX "TotemEvento_orgId_idx" ON "TotemEvento"("orgId");

-- CreateIndex
CREATE INDEX "TotemEvento_orgId_ocorridoEm_idx" ON "TotemEvento"("orgId", "ocorridoEm");

-- AddForeignKey
ALTER TABLE "TotemConfig" ADD CONSTRAINT "TotemConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemLoja" ADD CONSTRAINT "TotemLoja_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemUsuarioLoja" ADD CONSTRAINT "TotemUsuarioLoja_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemUsuarioLoja" ADD CONSTRAINT "TotemUsuarioLoja_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemUsuarioLoja" ADD CONSTRAINT "TotemUsuarioLoja_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "TotemLoja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemDispositivo" ADD CONSTRAINT "TotemDispositivo_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemDispositivo" ADD CONSTRAINT "TotemDispositivo_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "TotemLoja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemProduto" ADD CONSTRAINT "TotemProduto_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemLote" ADD CONSTRAINT "TotemLote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemLote" ADD CONSTRAINT "TotemLote_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "TotemProduto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemRemessa" ADD CONSTRAINT "TotemRemessa_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemRemessa" ADD CONSTRAINT "TotemRemessa_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "TotemLoja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemRemessaItem" ADD CONSTRAINT "TotemRemessaItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemRemessaItem" ADD CONSTRAINT "TotemRemessaItem_remessaId_fkey" FOREIGN KEY ("remessaId") REFERENCES "TotemRemessa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemRemessaItem" ADD CONSTRAINT "TotemRemessaItem_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "TotemLote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemRemessaItem" ADD CONSTRAINT "TotemRemessaItem_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "TotemProduto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemReposicao" ADD CONSTRAINT "TotemReposicao_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemReposicao" ADD CONSTRAINT "TotemReposicao_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "TotemLoja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemReposicao" ADD CONSTRAINT "TotemReposicao_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "TotemProduto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemReposicao" ADD CONSTRAINT "TotemReposicao_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "TotemLote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemEtiqueta" ADD CONSTRAINT "TotemEtiqueta_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemEtiqueta" ADD CONSTRAINT "TotemEtiqueta_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "TotemLoja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemEtiqueta" ADD CONSTRAINT "TotemEtiqueta_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "TotemProduto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemEtiqueta" ADD CONSTRAINT "TotemEtiqueta_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "TotemLote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemCampanha" ADD CONSTRAINT "TotemCampanha_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemCliente" ADD CONSTRAINT "TotemCliente_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemConsentimento" ADD CONSTRAINT "TotemConsentimento_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemConsentimento" ADD CONSTRAINT "TotemConsentimento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "TotemCliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemCupom" ADD CONSTRAINT "TotemCupom_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemCupom" ADD CONSTRAINT "TotemCupom_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "TotemCampanha"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemCupom" ADD CONSTRAINT "TotemCupom_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "TotemCliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemEvento" ADD CONSTRAINT "TotemEvento_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Isolamento por linha: o grupo padrão nas quinze, e a leitura pela sentinela
-- pública no aparelho e na etiqueta (é por eles que as rotas públicas acham
-- a empresa).
SELECT app_rls_aplicar_policies(
  'TotemConfig',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemLoja',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemUsuarioLoja',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemDispositivo',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual() OR public.app_resolucao_publica()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemProduto',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemLote',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemRemessa',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemRemessaItem',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemReposicao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemEtiqueta',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual() OR public.app_resolucao_publica()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemCampanha',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemCliente',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemConsentimento',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemCupom',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'TotemEvento',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "TotemConfig", "TotemLoja", "TotemUsuarioLoja", "TotemDispositivo", "TotemProduto", "TotemLote", "TotemRemessa", "TotemRemessaItem", "TotemReposicao", "TotemEtiqueta", "TotemCampanha", "TotemCliente", "TotemConsentimento", "TotemCupom", "TotemEvento" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: as quinze têm RLS, FORCE e as quatro policies. Falha
-- ALTA de propósito: como `migrate deploy` roda no arranque do container,
-- abortar aqui é a API não subir com tabela vazada.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alvo text;
  ok   boolean;
BEGIN
  FOREACH alvo IN ARRAY ARRAY['TotemConfig', 'TotemLoja', 'TotemUsuarioLoja', 'TotemDispositivo', 'TotemProduto', 'TotemLote', 'TotemRemessa', 'TotemRemessaItem', 'TotemReposicao', 'TotemEtiqueta', 'TotemCampanha', 'TotemCliente', 'TotemConsentimento', 'TotemCupom', 'TotemEvento'] LOOP
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
