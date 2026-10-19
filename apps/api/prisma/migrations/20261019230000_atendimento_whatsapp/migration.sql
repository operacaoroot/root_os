-- ============================================================================
-- ATENDIMENTO POR WHATSAPP — Dia a dia › Conversas (19/10/2026)
--
-- Caixa de conversas adaptada do inbox do FinOps (ver docs/ATENDIMENTO-FINOPS.md).
-- Quatro tabelas novas, todas da empresa, e nenhuma coluna existente alterada.
-- Escrita à mão a partir de `prisma migrate diff` (schema de 4b9085c → este),
-- mais o isolamento por linha e as permissões, como no cofre (20261019150000).
--
-- TRAVAS NO BANCO, e não só na tela:
--   · `AtendimentoMensagem (orgId, evolutionId)` único: o mesmo evento da
--     Evolution entregue duas vezes não vira duas mensagens.
--   · `AtendimentoMensagem (orgId, clienteMensagemId)` único: o mesmo envio
--     clicado duas vezes não vira duas respostas.
--   · `AtendimentoTarefa` tem a MENSAGEM como chave: uma tarefa por mensagem.
--   · Chaves compostas com `orgId` em toda ligação: conversa de uma empresa não
--     aponta para cliente, pessoa ou tarefa de outra.
--
-- CAMINHO DE VOLTA (nada existente é tocado, então voltar não perde dado antigo):
--   DROP TABLE "AtendimentoTarefa", "AtendimentoMensagem", "AtendimentoContato", "AtendimentoAjuste";
--   DROP TYPE "AtendimentoStatusEnvio", "AtendimentoDirecao";
--   DELETE FROM "_RolePermissions" WHERE "A" IN (SELECT "id" FROM "Permission" WHERE "key" LIKE 'atendimento.%');
--   DELETE FROM "Permission" WHERE "key" LIKE 'atendimento.%';
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261019230000_atendimento_whatsapp';
-- Os anexos guardados ficam no MinIO sob `atendimento/<orgId>/`; apagar à parte.
-- ============================================================================

-- CreateEnum
CREATE TYPE "AtendimentoDirecao" AS ENUM ('entrada', 'saida');

-- CreateEnum
CREATE TYPE "AtendimentoStatusEnvio" AS ENUM ('aguardando_assinatura', 'enviando', 'aceita', 'entregue', 'lida', 'erro');

-- CreateTable
CREATE TABLE "AtendimentoAjuste" (
    "orgId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "alteradoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtendimentoAjuste_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "AtendimentoContato" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "telefone" TEXT,
    "grupo" BOOLEAN NOT NULL DEFAULT false,
    "nome" TEXT,
    "clienteId" TEXT,
    "responsavelId" TEXT,
    "ultimaMensagemEm" TIMESTAMP(3),
    "encerradaEm" TIMESTAMP(3),
    "encerradaPor" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtendimentoContato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtendimentoMensagem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contatoId" TEXT NOT NULL,
    "direcao" "AtendimentoDirecao" NOT NULL,
    "evolutionId" TEXT,
    "clienteMensagemId" TEXT,
    "tipo" TEXT NOT NULL,
    "texto" TEXT,
    "remetenteJid" TEXT,
    "remetenteNome" TEXT,
    "autorId" TEXT,
    "anexoChave" TEXT,
    "anexoTipo" TEXT,
    "anexoNome" TEXT,
    "anexoTamanho" INTEGER,
    "anexoSituacao" TEXT,
    "statusEnvio" "AtendimentoStatusEnvio",
    "erroEnvio" TEXT,
    "approvalId" TEXT,
    "aceitaEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),
    "lidaPeloClienteEm" TIMESTAMP(3),
    "lidaEm" TIMESTAMP(3),
    "apagadaEm" TIMESTAMP(3),
    "momento" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtendimentoMensagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtendimentoTarefa" (
    "mensagemId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tarefaId" TEXT,
    "criadoPor" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtendimentoTarefa_pkey" PRIMARY KEY ("mensagemId")
);

-- CreateIndex
CREATE INDEX "AtendimentoContato_orgId_ultimaMensagemEm_idx" ON "AtendimentoContato"("orgId", "ultimaMensagemEm");

-- CreateIndex
CREATE UNIQUE INDEX "AtendimentoContato_orgId_jid_key" ON "AtendimentoContato"("orgId", "jid");

-- CreateIndex
CREATE UNIQUE INDEX "AtendimentoContato_id_orgId_key" ON "AtendimentoContato"("id", "orgId");

-- CreateIndex
CREATE INDEX "AtendimentoMensagem_orgId_contatoId_momento_idx" ON "AtendimentoMensagem"("orgId", "contatoId", "momento");

-- CreateIndex
CREATE UNIQUE INDEX "AtendimentoMensagem_orgId_evolutionId_key" ON "AtendimentoMensagem"("orgId", "evolutionId");

-- CreateIndex
CREATE UNIQUE INDEX "AtendimentoMensagem_orgId_clienteMensagemId_key" ON "AtendimentoMensagem"("orgId", "clienteMensagemId");

-- CreateIndex
CREATE UNIQUE INDEX "AtendimentoMensagem_id_orgId_key" ON "AtendimentoMensagem"("id", "orgId");

-- CreateIndex
CREATE INDEX "AtendimentoTarefa_orgId_idx" ON "AtendimentoTarefa"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AtendimentoTarefa_mensagemId_orgId_key" ON "AtendimentoTarefa"("mensagemId", "orgId");

-- AddForeignKey
ALTER TABLE "AtendimentoAjuste" ADD CONSTRAINT "AtendimentoAjuste_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AtendimentoContato" ADD CONSTRAINT "AtendimentoContato_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AtendimentoContato" ADD CONSTRAINT "AtendimentoContato_clienteId_orgId_fkey" FOREIGN KEY ("clienteId", "orgId") REFERENCES "WorkTask"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AtendimentoContato" ADD CONSTRAINT "AtendimentoContato_responsavelId_orgId_fkey" FOREIGN KEY ("responsavelId", "orgId") REFERENCES "User"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AtendimentoMensagem" ADD CONSTRAINT "AtendimentoMensagem_contatoId_orgId_fkey" FOREIGN KEY ("contatoId", "orgId") REFERENCES "AtendimentoContato"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AtendimentoTarefa" ADD CONSTRAINT "AtendimentoTarefa_mensagemId_orgId_fkey" FOREIGN KEY ("mensagemId", "orgId") REFERENCES "AtendimentoMensagem"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AtendimentoTarefa" ADD CONSTRAINT "AtendimentoTarefa_tarefaId_orgId_fkey" FOREIGN KEY ("tarefaId", "orgId") REFERENCES "WorkTask"("id", "orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ---------------------------------------------------------------------------
-- ISOLAMENTO POR LINHA — nasce forçado, como toda tabela de empresa
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['AtendimentoAjuste', 'AtendimentoContato', 'AtendimentoMensagem', 'AtendimentoTarefa'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    PERFORM public.app_rls_aplicar_policies(t,
      'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
      'public.app_org_resolvida() AND "orgId"=public.app_org_atual()', true, true, true);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO mktos_app', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- PERMISSÕES — só no Admin Master (os sócios). Somadas aqui, e não pelo
-- db:sync-permissions, que realinha todos os vínculos e revogaria concessões
-- feitas à mão. Outro perfil recebe pela tela de perfis.
--   atendimento.ver        ver conversas, anexos, marcar lida
--   atendimento.responder  propor resposta (sai só com assinatura de outra pessoa),
--                          responsável, cliente, encerrar, virar tarefa
--   atendimento.configurar ligar e desligar a caixa da empresa
-- ---------------------------------------------------------------------------
INSERT INTO "Permission" ("id", "key")
SELECT gen_random_uuid()::text, k
FROM unnest(ARRAY['atendimento.ver', 'atendimento.responder', 'atendimento.configurar']) AS k
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "_RolePermissions" ("A", "B")
SELECT p."id", r."id" FROM "Permission" p CROSS JOIN "Role" r
WHERE p."key" IN ('atendimento.ver', 'atendimento.responder', 'atendimento.configurar')
  AND r."key" = 'admin_master'
ON CONFLICT DO NOTHING;
