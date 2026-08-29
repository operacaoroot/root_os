-- CreateEnum
CREATE TYPE "AgentEstado" AS ENUM ('rodando', 'aprendendo', 'planejado', 'pausado');

-- CreateEnum
CREATE TYPE "AgentTipo" AS ENUM ('llm', 'conector');

-- CreateEnum
CREATE TYPE "SessionCanal" AS ENUM ('web', 'whatsapp', 'telegram', 'terminal', 'rotina', 'mcp');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('rodando', 'respondida', 'executada', 'retida', 'recusada', 'falhou');

-- CreateEnum
CREATE TYPE "SessionStepTipo" AS ENUM ('pedido', 'contexto', 'modelo', 'ferramenta', 'aprovacao', 'resultado', 'erro');

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "iniciais" TEXT NOT NULL DEFAULT '',
    "missao" TEXT NOT NULL,
    "pilar" TEXT,
    "donoId" TEXT,
    "tipo" "AgentTipo" NOT NULL DEFAULT 'llm',
    "estado" "AgentEstado" NOT NULL DEFAULT 'planejado',
    "capacidades" TEXT[],
    "autonomiaAte" "RiskLevel" NOT NULL DEFAULT 'R0',
    "rebaixadoAte" TIMESTAMP(3),
    "rebaixadoPor" TEXT,
    "modelo" TEXT,
    "effort" TEXT NOT NULL DEFAULT 'high',
    "maxPassos" INTEGER NOT NULL DEFAULT 8,
    "tetoCustoUsd" DECIMAL(10,4) NOT NULL DEFAULT 0.50,
    "tetoSegundos" INTEGER NOT NULL DEFAULT 180,
    "contextoFixo" TEXT[],
    "cron" TEXT,
    "tz" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "minutosPorExecucao" INTEGER NOT NULL DEFAULT 0,
    "baselinePorId" TEXT,
    "baselineEm" TIMESTAMP(3),
    "execucoes" INTEGER NOT NULL DEFAULT 0,
    "falhas" INTEGER NOT NULL DEFAULT 0,
    "ultimaExecucaoEm" TIMESTAMP(3),
    "ultimoStatus" TEXT,
    "proximaExecucaoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sop" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "proposito" TEXT NOT NULL,
    "gatilho" TEXT NOT NULL,
    "passos" TEXT[],
    "definicaoDePronto" TEXT NOT NULL,
    "observacoes" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "atualizadoPor" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "canal" "SessionCanal" NOT NULL,
    "canalRef" TEXT,
    "solicitanteId" TEXT,
    "solicitanteRotulo" TEXT NOT NULL,
    "pedido" TEXT NOT NULL,
    "resposta" TEXT NOT NULL DEFAULT '',
    "status" "SessionStatus" NOT NULL DEFAULT 'rodando',
    "nivelMax" "RiskLevel",
    "motivo" TEXT,
    "fontes" JSONB NOT NULL DEFAULT '[]',
    "semProcedencia" BOOLEAN NOT NULL DEFAULT false,
    "custoUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "custoEstimado" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT,
    "modelo" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "passos" INTEGER NOT NULL DEFAULT 0,
    "duracaoMs" INTEGER NOT NULL DEFAULT 0,
    "ultimaAtividadeEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerradaEm" TIMESTAMP(3),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionStep" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "tipo" "SessionStepTipo" NOT NULL,
    "capacidade" TEXT,
    "argsResumo" TEXT,
    "args" JSONB,
    "resultadoResumo" TEXT,
    "toolCallId" TEXT,
    "nivel" "RiskLevel",
    "decisao" TEXT,
    "motivo" TEXT,
    "gatilhos" TEXT[],
    "approvalId" TEXT,
    "provider" TEXT,
    "modelo" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "tokensCacheRead" INTEGER,
    "tokensCacheWrite" INTEGER,
    "custoUsd" DECIMAL(10,6),
    "custoEstimado" BOOLEAN NOT NULL DEFAULT true,
    "stopReason" TEXT,
    "fontes" JSONB NOT NULL DEFAULT '[]',
    "payload" JSONB,
    "texto" TEXT,
    "erro" TEXT,
    "duracaoMs" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelIdentity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "canal" "SessionCanal" NOT NULL,
    "externalId" TEXT NOT NULL,
    "userId" TEXT,
    "rotulo" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Agent_orgId_estado_idx" ON "Agent"("orgId", "estado");

-- CreateIndex
CREATE INDEX "Agent_ativo_cron_idx" ON "Agent"("ativo", "cron");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_orgId_slug_key" ON "Agent"("orgId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Sop_agentId_key" ON "Sop"("agentId");

-- CreateIndex
CREATE INDEX "Session_orgId_criadaEm_idx" ON "Session"("orgId", "criadaEm");

-- CreateIndex
CREATE INDEX "Session_orgId_canal_criadaEm_idx" ON "Session"("orgId", "canal", "criadaEm");

-- CreateIndex
CREATE INDEX "Session_orgId_agentId_criadaEm_idx" ON "Session"("orgId", "agentId", "criadaEm");

-- CreateIndex
CREATE INDEX "Session_orgId_status_idx" ON "Session"("orgId", "status");

-- CreateIndex
CREATE INDEX "Session_orgId_canal_canalRef_ultimaAtividadeEm_idx" ON "Session"("orgId", "canal", "canalRef", "ultimaAtividadeEm");

-- CreateIndex
CREATE INDEX "SessionStep_sessionId_ordem_idx" ON "SessionStep"("sessionId", "ordem");

-- CreateIndex
CREATE INDEX "SessionStep_orgId_criadoEm_idx" ON "SessionStep"("orgId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "SessionStep_sessionId_ordem_key" ON "SessionStep"("sessionId", "ordem");

-- CreateIndex
CREATE INDEX "ChannelIdentity_orgId_canal_idx" ON "ChannelIdentity"("orgId", "canal");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelIdentity_orgId_canal_externalId_key" ON "ChannelIdentity"("orgId", "canal", "externalId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_donoId_fkey" FOREIGN KEY ("donoId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sop" ADD CONSTRAINT "Sop_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionStep" ADD CONSTRAINT "SessionStep_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
