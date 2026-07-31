-- CreateEnum
CREATE TYPE "BioLinkTipo" AS ENUM ('url', 'whatsapp', 'email');

-- CreateEnum
CREATE TYPE "BioPlataforma" AS ENUM ('instagram', 'tiktok');

-- CreateEnum
CREATE TYPE "BioModoColeta" AS ENUM ('conectado', 'descoberta', 'manual');

-- CreateEnum
CREATE TYPE "BioContaStatus" AS ENUM ('ok', 'token_expirado', 'conta_pessoal', 'privada', 'erro');

-- CreateTable
CREATE TABLE "BioPage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "subtitulo" TEXT,
    "avatarUrl" TEXT,
    "tema" JSONB NOT NULL DEFAULT '{}',
    "publicada" BOOLEAN NOT NULL DEFAULT false,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BioPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioLink" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "tipo" "BioLinkTipo" NOT NULL DEFAULT 'url',
    "rotulo" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "icone" TEXT,
    "destaque" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BioLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioChallenge" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "metaPosts" INTEGER NOT NULL,
    "exibir" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BioChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioChallengeAccount" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "plataforma" "BioPlataforma" NOT NULL,
    "handle" TEXT NOT NULL,
    "modo" "BioModoColeta" NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "conexaoId" TEXT,
    "baselineCount" INTEGER NOT NULL DEFAULT 0,
    "baselineEm" TIMESTAMP(3),
    "status" "BioContaStatus" NOT NULL DEFAULT 'ok',
    "ultimaColeta" TIMESTAMP(3),
    "ultimoErro" TEXT,

    CONSTRAINT "BioChallengeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioChallengePost" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "publicadoEm" TIMESTAMP(3) NOT NULL,
    "permalink" TEXT,
    "tipo" TEXT,
    "vistoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sumiuEm" TIMESTAMP(3),

    CONSTRAINT "BioChallengePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioChallengeSnapshot" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "coletadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalCount" INTEGER,
    "countNaJanela" INTEGER,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "erro" TEXT,
    "bruto" JSONB,

    CONSTRAINT "BioChallengeSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioConexao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "plataforma" "BioPlataforma" NOT NULL,
    "externalId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "tokenCifrado" TEXT NOT NULL,
    "refreshCifrado" TEXT,
    "expiraEm" TIMESTAMP(3),
    "escopos" TEXT,
    "status" "BioContaStatus" NOT NULL DEFAULT 'ok',
    "ultimoErro" TEXT,
    "conectadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BioConexao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioCredencialApp" (
    "id" TEXT NOT NULL,
    "plataforma" "BioPlataforma" NOT NULL,
    "orgId" TEXT,
    "appId" TEXT NOT NULL,
    "segredoCifrado" TEXT NOT NULL,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,
    "atualizadaPor" TEXT,

    CONSTRAINT "BioCredencialApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioOauthState" (
    "id" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "plataforma" "BioPlataforma" NOT NULL,
    "verifier" TEXT,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BioOauthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioVisitor" (
    "id" TEXT NOT NULL,
    "primeiroVisto" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoVisto" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BioVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioVisit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "iniciadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "fbclid" TEXT,
    "ttclid" TEXT,
    "gclid" TEXT,
    "device" TEXT,
    "os" TEXT,
    "browser" TEXT,
    "pais" TEXT,
    "cidade" TEXT,

    CONSTRAINT "BioVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "visitId" TEXT,
    "visitorId" TEXT,
    "nome" TEXT NOT NULL,
    "linkId" TEXT,
    "url" TEXT,
    "metadata" JSONB,
    "ocorridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BioEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BioPage_handle_key" ON "BioPage"("handle");

-- CreateIndex
CREATE INDEX "BioPage_orgId_idx" ON "BioPage"("orgId");

-- CreateIndex
CREATE INDEX "BioLink_pageId_ordem_idx" ON "BioLink"("pageId", "ordem");

-- CreateIndex
CREATE INDEX "BioChallenge_pageId_idx" ON "BioChallenge"("pageId");

-- CreateIndex
CREATE INDEX "BioChallenge_orgId_inicio_idx" ON "BioChallenge"("orgId", "inicio");

-- CreateIndex
CREATE INDEX "BioChallengeAccount_conexaoId_idx" ON "BioChallengeAccount"("conexaoId");

-- CreateIndex
CREATE UNIQUE INDEX "BioChallengeAccount_challengeId_plataforma_handle_key" ON "BioChallengeAccount"("challengeId", "plataforma", "handle");

-- CreateIndex
CREATE INDEX "BioChallengePost_contaId_publicadoEm_idx" ON "BioChallengePost"("contaId", "publicadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "BioChallengePost_contaId_externalId_key" ON "BioChallengePost"("contaId", "externalId");

-- CreateIndex
CREATE INDEX "BioChallengeSnapshot_contaId_coletadoEm_idx" ON "BioChallengeSnapshot"("contaId", "coletadoEm");

-- CreateIndex
CREATE INDEX "BioConexao_orgId_idx" ON "BioConexao"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "BioConexao_orgId_plataforma_externalId_key" ON "BioConexao"("orgId", "plataforma", "externalId");

-- CreateIndex
CREATE INDEX "BioCredencialApp_plataforma_orgId_idx" ON "BioCredencialApp"("plataforma", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "BioOauthState_estado_key" ON "BioOauthState"("estado");

-- CreateIndex
CREATE INDEX "BioOauthState_expiraEm_idx" ON "BioOauthState"("expiraEm");

-- CreateIndex
CREATE INDEX "BioVisit_pageId_iniciadaEm_idx" ON "BioVisit"("pageId", "iniciadaEm");

-- CreateIndex
CREATE INDEX "BioVisit_visitorId_idx" ON "BioVisit"("visitorId");

-- CreateIndex
CREATE UNIQUE INDEX "BioEvent_eventId_key" ON "BioEvent"("eventId");

-- CreateIndex
CREATE INDEX "BioEvent_orgId_ocorridoEm_idx" ON "BioEvent"("orgId", "ocorridoEm");

-- CreateIndex
CREATE INDEX "BioEvent_pageId_ocorridoEm_idx" ON "BioEvent"("pageId", "ocorridoEm");

-- CreateIndex
CREATE INDEX "BioEvent_nome_ocorridoEm_idx" ON "BioEvent"("nome", "ocorridoEm");

-- AddForeignKey
ALTER TABLE "BioPage" ADD CONSTRAINT "BioPage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioLink" ADD CONSTRAINT "BioLink_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioChallenge" ADD CONSTRAINT "BioChallenge_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioChallenge" ADD CONSTRAINT "BioChallenge_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioChallengeAccount" ADD CONSTRAINT "BioChallengeAccount_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "BioChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioChallengeAccount" ADD CONSTRAINT "BioChallengeAccount_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "BioConexao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioChallengePost" ADD CONSTRAINT "BioChallengePost_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "BioChallengeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioChallengeSnapshot" ADD CONSTRAINT "BioChallengeSnapshot_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "BioChallengeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioConexao" ADD CONSTRAINT "BioConexao_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioCredencialApp" ADD CONSTRAINT "BioCredencialApp_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioOauthState" ADD CONSTRAINT "BioOauthState_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioVisit" ADD CONSTRAINT "BioVisit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioVisit" ADD CONSTRAINT "BioVisit_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "BioVisitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioVisit" ADD CONSTRAINT "BioVisit_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioEvent" ADD CONSTRAINT "BioEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioEvent" ADD CONSTRAINT "BioEvent_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioEvent" ADD CONSTRAINT "BioEvent_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "BioVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioEvent" ADD CONSTRAINT "BioEvent_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "BioVisitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
