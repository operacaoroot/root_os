-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('R0', 'R1', 'R2', 'R3', 'R4', 'R5');

-- CreateEnum
CREATE TYPE "Alcada" AS ENUM ('operador', 'responsavel', 'titular');

-- CreateEnum
CREATE TYPE "ToolCallStatus" AS ENUM ('executado', 'aguardando_aprovacao', 'recusado', 'erro');

-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('pendente', 'confirmada', 'consumida', 'rejeitada', 'expirada');

-- CreateTable
CREATE TABLE "Capability" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "efeito" JSONB NOT NULL,
    "hashKeys" TEXT[],
    "argsSchema" JSONB,
    "ferramenta" TEXT,
    "rota" TEXT,
    "desfazer" TEXT,
    "moduloKey" TEXT,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "versao" INTEGER NOT NULL,
    "documento" JSONB NOT NULL,
    "delta" JSONB,
    "motivo" TEXT NOT NULL,
    "autorId" TEXT,
    "ativaDe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativaAte" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "capabilityId" TEXT,
    "policyVersionId" TEXT,
    "nivelBase" "RiskLevel" NOT NULL,
    "nivel" "RiskLevel" NOT NULL,
    "permitido" BOOLEAN NOT NULL,
    "exigeAprovacao" BOOLEAN NOT NULL,
    "sinais" TEXT[],
    "motivo" TEXT NOT NULL,
    "modo" TEXT NOT NULL DEFAULT 'impor',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "capabilityId" TEXT,
    "decisionId" TEXT,
    "sessionId" TEXT,
    "agentSlug" TEXT,
    "actorType" "ActorType" NOT NULL DEFAULT 'ai',
    "actorId" TEXT,
    "status" "ToolCallStatus" NOT NULL,
    "args" JSONB,
    "resultado" JSONB,
    "erro" TEXT,
    "nivel" "RiskLevel",
    "approvalId" TEXT,
    "duracaoMs" INTEGER NOT NULL DEFAULT 0,
    "correlationId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "decisionId" TEXT,
    "toolCallId" TEXT,
    "capabilityId" TEXT,
    "propostoPorId" TEXT NOT NULL,
    "propostoPorTipo" "ActorType" NOT NULL DEFAULT 'ai',
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "resumo" TEXT NOT NULL,
    "status" "ApprovalState" NOT NULL DEFAULT 'pendente',
    "nivelExigido" "RiskLevel" NOT NULL DEFAULT 'R3',
    "alcadaMinima" "Alcada" NOT NULL DEFAULT 'operador',
    "exigeReauth" BOOLEAN NOT NULL DEFAULT false,
    "motivo" TEXT,
    "canal" TEXT,
    "tokenHash" TEXT NOT NULL,
    "aprovadoPorId" TEXT,
    "aprovadoEm" TIMESTAMP(3),
    "reautenticadoEm" TIMESTAMP(3),
    "consumidoEm" TIMESTAMP(3),
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "tipo" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'ai',
    "actorId" TEXT,
    "agentSlug" TEXT,
    "capabilityId" TEXT,
    "toolCallId" TEXT,
    "decisionId" TEXT,
    "nivel" "RiskLevel",
    "correlationId" TEXT,
    "payload" JSONB,
    "contentHash" TEXT,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "retencaoAte" TIMESTAMP(3) NOT NULL,
    "ocorreuEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Capability_ferramenta_key" ON "Capability"("ferramenta");

-- CreateIndex
CREATE INDEX "Capability_moduloKey_idx" ON "Capability"("moduloKey");

-- CreateIndex
CREATE INDEX "Capability_level_idx" ON "Capability"("level");

-- CreateIndex
CREATE INDEX "PolicyVersion_orgId_ativaDe_idx" ON "PolicyVersion"("orgId", "ativaDe");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_orgId_versao_key" ON "PolicyVersion"("orgId", "versao");

-- CreateIndex
CREATE INDEX "PolicyDecision_orgId_criadoEm_idx" ON "PolicyDecision"("orgId", "criadoEm");

-- CreateIndex
CREATE INDEX "PolicyDecision_orgId_nivel_idx" ON "PolicyDecision"("orgId", "nivel");

-- CreateIndex
CREATE INDEX "ToolCall_orgId_criadoEm_idx" ON "ToolCall"("orgId", "criadoEm");

-- CreateIndex
CREATE INDEX "ToolCall_orgId_capabilityId_criadoEm_idx" ON "ToolCall"("orgId", "capabilityId", "criadoEm");

-- CreateIndex
CREATE INDEX "ToolCall_correlationId_idx" ON "ToolCall"("correlationId");

-- CreateIndex
CREATE INDEX "ToolCall_agentSlug_criadoEm_idx" ON "ToolCall"("agentSlug", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_tokenHash_key" ON "Approval"("tokenHash");

-- CreateIndex
CREATE INDEX "Approval_orgId_status_expiraEm_idx" ON "Approval"("orgId", "status", "expiraEm");

-- CreateIndex
CREATE INDEX "Approval_orgId_criadoEm_idx" ON "Approval"("orgId", "criadoEm");

-- CreateIndex
CREATE INDEX "EventLog_orgId_ocorreuEm_idx" ON "EventLog"("orgId", "ocorreuEm");

-- CreateIndex
CREATE INDEX "EventLog_orgId_tipo_idx" ON "EventLog"("orgId", "tipo");

-- CreateIndex
CREATE INDEX "EventLog_correlationId_idx" ON "EventLog"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "EventLog_orgId_seq_key" ON "EventLog"("orgId", "seq");

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- EventLog é append-only. Regra em serviço é comentário; aqui é o banco.
--
-- As RULEs derrotam um `prisma.eventLog.update()` acidental mesmo vindo do dono
-- das tabelas. A garantia DE VERDADE é o REVOKE abaixo, e ele só passa a valer
-- quando a aplicação parar de conectar como dona (role mktos_app, fatia 8).
-- Até lá isto é convenção — e a tela do Rastro diz exatamente isso.
-- ============================================================================
CREATE RULE "eventlog_sem_update" AS ON UPDATE TO "EventLog" DO INSTEAD NOTHING;
CREATE RULE "eventlog_sem_delete" AS ON DELETE TO "EventLog" DO INSTEAD NOTHING;

-- Quando o role existir, isto vira a defesa real. DO block para a migration
-- continuar aplicável antes de a fatia 8 criar o role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "EventLog" FROM mktos_app;
  END IF;
END $$;
