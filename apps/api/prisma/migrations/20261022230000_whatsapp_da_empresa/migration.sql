-- ============================================================================
-- O WHATSAPP DA EMPRESA POR DENTRO DO OS (rodada de produção 4, W1, 22/10/2026)
-- ============================================================================
--
-- ADITIVA: duas tabelas novas e uma permissão nova; nenhuma coluna mexida em
-- tabela existente.
--
-- Tudo o que chega pela Evolution (1:1 e grupo, inclusive o que a casa mandou
-- pelo celular) é gravado ANTES dos leitores de sempre (canal de aprovação,
-- entrada do lead, triagem), e a caixa de WhatsApp (/whatsapp) lê daqui.
--
--   · "WhatsAppConversa": raiz da empresa (o "orgId" vem do insert), uma por
--     (empresa, instância, chatJid). O vínculo é com um lead OU um cliente.
--   · "WhatsAppMensagem": filha da conversa, com a sentinela '' e o gatilho
--     "WhatsAppMensagem_orgId_do_pai" (o "orgId" é sempre o da conversa).
--     Idempotente por (empresa, instância, mensagemExternaId).
--
-- O lead e o cliente entram por FK simples com SET NULL: apagar um lead ou um
-- cliente não apaga a conversa, só desfaz o vínculo. O serviço confere a
-- empresa do lead/cliente sob o isolamento por linha antes de gravar.
--
-- A permissão "whatsapp.conversar" (responder pela caixa, arquivar) nasce por
-- aqui, e não pelo db:sync-permissions (que não é aditivo): Admin Master,
-- Gestor de Marketing e Analista, os papéis de GENTE que já têm "leads.editar".
-- A conta "ia_acao" tem "leads.editar" e fica de fora de propósito: responder
-- pela caixa é ato de gente.
--
-- Rollback (só se nada depender delas): DROP TABLE "WhatsAppMensagem";
-- DROP TABLE "WhatsAppConversa"; e a permissão pode ficar (sem rota, não faz nada).
-- ============================================================================

CREATE TABLE "WhatsAppConversa" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "instancia" TEXT NOT NULL,
    "chatJid" TEXT NOT NULL,
    "lidJid" TEXT,
    "grupo" BOOLEAN NOT NULL DEFAULT false,
    "nome" TEXT,
    "fotoUrl" TEXT,
    "participantes" INTEGER,
    "participantesLista" JSONB,
    "equipe" BOOLEAN NOT NULL DEFAULT false,
    "ultimaMensagemEm" TIMESTAMP(3),
    "naoLidas" INTEGER NOT NULL DEFAULT 0,
    "leadId" TEXT,
    "clienteId" TEXT,
    "vinculoSugerido" JSONB,
    "vinculadoPorId" TEXT,
    "vinculadoEm" TIMESTAMP(3),
    "arquivadaEm" TIMESTAMP(3),
    "sincronizadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppMensagem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "conversaId" TEXT NOT NULL,
    "instancia" TEXT NOT NULL,
    "chatJid" TEXT NOT NULL,
    "grupo" BOOLEAN NOT NULL DEFAULT false,
    "remetenteJid" TEXT,
    "remetenteNumero" TEXT,
    "remetenteNome" TEXT,
    "deMim" BOOLEAN NOT NULL DEFAULT false,
    "direcao" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "texto" TEXT,
    "midia" JSONB,
    "mensagemExternaId" TEXT NOT NULL,
    "citaMensagemExternaId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "leadId" TEXT,
    "clienteId" TEXT,
    "lidaEm" TIMESTAMP(3),
    "lidaPorId" TEXT,
    "enviadaPorId" TEXT,
    "origem" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMensagem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsAppConversa_orgId_ultimaMensagemEm_idx" ON "WhatsAppConversa"("orgId", "ultimaMensagemEm");
CREATE INDEX "WhatsAppConversa_orgId_leadId_idx" ON "WhatsAppConversa"("orgId", "leadId");
CREATE INDEX "WhatsAppConversa_orgId_clienteId_idx" ON "WhatsAppConversa"("orgId", "clienteId");
CREATE UNIQUE INDEX "WhatsAppConversa_orgId_instancia_chatJid_key" ON "WhatsAppConversa"("orgId", "instancia", "chatJid");
CREATE UNIQUE INDEX "WhatsAppConversa_id_orgId_key" ON "WhatsAppConversa"("id", "orgId");
CREATE INDEX "WhatsAppMensagem_conversaId_timestamp_idx" ON "WhatsAppMensagem"("conversaId", "timestamp");
CREATE INDEX "WhatsAppMensagem_orgId_timestamp_idx" ON "WhatsAppMensagem"("orgId", "timestamp");
CREATE INDEX "WhatsAppMensagem_orgId_leadId_timestamp_idx" ON "WhatsAppMensagem"("orgId", "leadId", "timestamp");
CREATE INDEX "WhatsAppMensagem_orgId_clienteId_timestamp_idx" ON "WhatsAppMensagem"("orgId", "clienteId", "timestamp");
CREATE UNIQUE INDEX "WhatsAppMensagem_orgId_instancia_mensagemExternaId_key" ON "WhatsAppMensagem"("orgId", "instancia", "mensagemExternaId");

ALTER TABLE "WhatsAppConversa" ADD CONSTRAINT "WhatsAppConversa_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhatsAppConversa" ADD CONSTRAINT "WhatsAppConversa_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhatsAppConversa" ADD CONSTRAINT "WhatsAppConversa_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhatsAppMensagem" ADD CONSTRAINT "WhatsAppMensagem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhatsAppMensagem" ADD CONSTRAINT "WhatsAppMensagem_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "WhatsAppConversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppMensagem" ADD CONSTRAINT "WhatsAppMensagem_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhatsAppMensagem" ADD CONSTRAINT "WhatsAppMensagem_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WhatsAppConversa" ADD CONSTRAINT "WhatsAppConversa_vinculo_check"
  CHECK ("leadId" IS NULL OR "clienteId" IS NULL);
ALTER TABLE "WhatsAppConversa" ADD CONSTRAINT "WhatsAppConversa_chatJid_check"
  CHECK ("chatJid" ~ '^[0-9A-Za-z._:-]{1,80}@(s\.whatsapp\.net|g\.us|lid|c\.us|broadcast|newsletter)$');
ALTER TABLE "WhatsAppConversa" ADD CONSTRAINT "WhatsAppConversa_naoLidas_check"
  CHECK ("naoLidas" >= 0);

ALTER TABLE "WhatsAppMensagem" ADD CONSTRAINT "WhatsAppMensagem_vinculo_check"
  CHECK ("leadId" IS NULL OR "clienteId" IS NULL);
ALTER TABLE "WhatsAppMensagem" ADD CONSTRAINT "WhatsAppMensagem_direcao_check"
  CHECK ("direcao" IN ('entrada', 'saida') AND (("direcao" = 'saida') = "deMim"));
ALTER TABLE "WhatsAppMensagem" ADD CONSTRAINT "WhatsAppMensagem_origem_check"
  CHECK ("origem" IN ('webhook', 'sincronizacao', 'caixa'));
ALTER TABLE "WhatsAppMensagem" ADD CONSTRAINT "WhatsAppMensagem_externo_check"
  CHECK (char_length("mensagemExternaId") BETWEEN 1 AND 200);

-- A empresa da mensagem é sempre a da conversa.
CREATE TRIGGER "WhatsAppMensagem_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "WhatsAppMensagem"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('WhatsAppConversa', 'conversaId');

-- Isolamento por linha: o grupo padrão, nas duas.
SELECT app_rls_aplicar_policies(
  'WhatsAppConversa',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'WhatsAppMensagem',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "WhatsAppConversa" TO mktos_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "WhatsAppMensagem" TO mktos_app';
  END IF;
END $$;

-- A permissão nova, nos papéis de gente que já têm "leads.editar" (fora "ia_acao").
INSERT INTO "Permission" ("id", "key")
VALUES (gen_random_uuid()::text, 'whatsapp.conversar')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "_RolePermissions" ("A", "B")
SELECT p."id", r."id" FROM "Permission" p CROSS JOIN "Role" r
WHERE p."key" = 'whatsapp.conversar' AND r."key" IN ('admin_master', 'gestor_marketing', 'analista')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE e as quatro policies nas duas, e o gatilho.
-- Falha ALTA de propósito: `migrate deploy` roda no arranque do container, e
-- abortar aqui é a API não subir com tabela vazada.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  ok boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['WhatsAppConversa', 'WhatsAppMensagem'] LOOP
    SELECT c.relrowsecurity
       AND c.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
      INTO ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;
    IF NOT COALESCE(ok, false) THEN
      RAISE EXCEPTION '% ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'WhatsAppMensagem_orgId_do_pai' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'WhatsAppMensagem sem o gatilho que confere a empresa da conversa.';
  END IF;
END $$;
