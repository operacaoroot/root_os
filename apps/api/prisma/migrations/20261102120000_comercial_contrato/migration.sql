-- ============================================================================
-- O CONTRATO COMO REGISTRO PRÓPRIO (módulo de contratos, 02/11/2026, fase F1)
-- ============================================================================
--
-- ADITIVA: duas tabelas novas. Nenhuma linha existente é tocada; o backfill só
-- INSERE em "ComercialContrato".
--
-- 1. "ComercialContrato": filha de "Lead" no molde de "ComercialDocumento"
--    (sentinela '' + gatilho `mktos_orgid_do_pai`, leitura e escrita separadas).
--    Além do lead, os gatilhos conferem o contrato pai (aditivo e distrato), o
--    documento na ZapSign e a minuta: empresa cruzada é recusada.
--    "Um contrato vivo por lead" NÃO é índice único: o backfill cria um registro
--    por documento e há lead com dois documentos de assinatura (o aceite mudou).
--    A regra é do serviço, sob o cadeado `comercial-contrato:<empresa>:<lead>`.
--
-- 2. "ComercialContratoSignatario": filha do contrato, no mesmo desenho.
--
-- 3. BACKFILL: um contrato para cada "ComercialDocumento" de assinatura
--    (provedor <> 'minuta'). O id é md5('comercial-contrato:' || documento) em
--    formato de uuid, sem depender de extensão (`uuid_generate_v5` não existe
--    nesta imagem), a mesma conta de `idDoContratoDoDocumento` no código: rodar o
--    efeito depois cai na mesma linha. Estado derivado do documento:
--      · "assinado" com `cliente.ativo` no fio → ativo; sem ele → assinado;
--      · qualquer outro estado do documento (criado, enviado, assinado_parcial) → em_assinatura;
--      · `contrato.concluido` no fio → encerrado, com o motivo e a data do fato.
--        `contrato.desativado` NÃO encerra: é a coluna "A encerrar" do quadro.
--    Valor e cliente vêm da ficha. Signatários não são copiados: o documento
--    antigo não guarda nome nem e-mail, e o quadro conta as assinaturas nele.
--    Contratos IMPORTADOS (`contrato.importado`) não são copiados: a leitura do
--    quadro os mostra derivados do fio, até alguém agir neles.
--
-- CAMINHO DE VOLTA (não apaga documento nem fato; perde signatários escolhidos,
-- vigências, números, CNPJ que fatura e aditivos e distratos em rascunho, que só
-- existem aqui: exporte antes). Os fatos `contrato.registrado` e demais ficam no
-- fio, sem efeito em nada:
--   DROP TABLE "ComercialContratoSignatario";
--   DROP TABLE "ComercialContrato";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261102120000_comercial_contrato';
-- ============================================================================

-- CreateTable
CREATE TABLE "ComercialContrato" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "partnerId" TEXT,
    "paiId" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'contrato',
    "modalidade" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'a_emitir',
    "numero" TEXT,
    "valorCentavos" INTEGER,
    "vigenciaInicio" DATE,
    "vigenciaFim" DATE,
    "faturaPor" TEXT,
    "dadosDoContrato" JSONB,
    "hashDoConteudo" TEXT,
    "documentoId" TEXT,
    "minutaId" TEXT,
    "origemImportada" TEXT,
    "motivoDoFim" TEXT,
    "encerradoEm" TIMESTAMP(3),
    "ultimaConferenciaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComercialContrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComercialContratoSignatario" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "contratoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "papel" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "assinadoEm" TIMESTAMP(3),
    "tokenNoProvedor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComercialContratoSignatario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComercialContrato_documentoId_key" ON "ComercialContrato"("documentoId");

-- CreateIndex
CREATE INDEX "ComercialContrato_orgId_leadId_idx" ON "ComercialContrato"("orgId", "leadId");

-- CreateIndex
CREATE INDEX "ComercialContrato_orgId_tipo_estado_idx" ON "ComercialContrato"("orgId", "tipo", "estado");

-- CreateIndex
CREATE INDEX "ComercialContrato_orgId_estado_ultimaConferenciaEm_idx" ON "ComercialContrato"("orgId", "estado", "ultimaConferenciaEm");

-- CreateIndex
CREATE INDEX "ComercialContrato_paiId_idx" ON "ComercialContrato"("paiId");

-- CreateIndex
CREATE INDEX "ComercialContrato_minutaId_idx" ON "ComercialContrato"("minutaId");

-- CreateIndex
CREATE UNIQUE INDEX "ComercialContrato_leadId_origemImportada_key" ON "ComercialContrato"("leadId", "origemImportada");

-- CreateIndex
CREATE INDEX "ComercialContratoSignatario_orgId_contratoId_idx" ON "ComercialContratoSignatario"("orgId", "contratoId");

-- CreateIndex
CREATE UNIQUE INDEX "ComercialContratoSignatario_contratoId_ordem_key" ON "ComercialContratoSignatario"("contratoId", "ordem");

-- AddForeignKey
ALTER TABLE "ComercialContrato" ADD CONSTRAINT "ComercialContrato_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialContrato" ADD CONSTRAINT "ComercialContrato_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialContrato" ADD CONSTRAINT "ComercialContrato_paiId_fkey" FOREIGN KEY ("paiId") REFERENCES "ComercialContrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialContrato" ADD CONSTRAINT "ComercialContrato_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "ComercialDocumento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialContrato" ADD CONSTRAINT "ComercialContrato_minutaId_fkey" FOREIGN KEY ("minutaId") REFERENCES "ComercialDocumento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialContratoSignatario" ADD CONSTRAINT "ComercialContratoSignatario_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialContratoSignatario" ADD CONSTRAINT "ComercialContratoSignatario_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "ComercialContrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Os valores fechados (espelham `comercial-contratos.ts` no shared)
-- ---------------------------------------------------------------------------
ALTER TABLE "ComercialContrato" ADD CONSTRAINT "ComercialContrato_tipo_check"
  CHECK ("tipo" IN ('contrato', 'aditivo', 'distrato'));
ALTER TABLE "ComercialContrato" ADD CONSTRAINT "ComercialContrato_estado_check"
  CHECK ("estado" IN ('rascunho', 'a_emitir', 'em_assinatura', 'assinado', 'ativo', 'encerrado', 'cancelado'));
ALTER TABLE "ComercialContrato" ADD CONSTRAINT "ComercialContrato_modalidade_check"
  CHECK ("modalidade" IS NULL OR "modalidade" IN ('implantacao', 'continuidade'));
ALTER TABLE "ComercialContrato" ADD CONSTRAINT "ComercialContrato_pai_check"
  CHECK (("tipo" = 'contrato') = ("paiId" IS NULL));
ALTER TABLE "ComercialContratoSignatario" ADD CONSTRAINT "ComercialContratoSignatario_papel_check"
  CHECK ("papel" IN ('cliente', 'root'));
ALTER TABLE "ComercialContratoSignatario" ADD CONSTRAINT "ComercialContratoSignatario_ordem_check"
  CHECK ("ordem" >= 1);

-- ---------------------------------------------------------------------------
-- Os gatilhos: a empresa é a do lead, e os outros pais têm de ser dela
-- ---------------------------------------------------------------------------
CREATE TRIGGER "ComercialContrato_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ComercialContrato"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Lead', 'leadId');
CREATE TRIGGER "ComercialContrato_orgId_do_pai_contrato"
  BEFORE INSERT OR UPDATE ON "ComercialContrato"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('ComercialContrato', 'paiId');
CREATE TRIGGER "ComercialContrato_orgId_do_pai_documento"
  BEFORE INSERT OR UPDATE ON "ComercialContrato"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('ComercialDocumento', 'documentoId');
CREATE TRIGGER "ComercialContrato_orgId_do_pai_minuta"
  BEFORE INSERT OR UPDATE ON "ComercialContrato"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('ComercialDocumento', 'minutaId');
CREATE TRIGGER "ComercialContratoSignatario_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ComercialContratoSignatario"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('ComercialContrato', 'contratoId');

-- ---------------------------------------------------------------------------
-- Isolamento por linha: o grupo padrão, leitura e escrita separadas
-- ---------------------------------------------------------------------------
SELECT app_rls_aplicar_policies(
  'ComercialContrato',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ComercialContratoSignatario',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "ComercialContrato", "ComercialContratoSignatario" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- BACKFILL: um contrato por documento de assinatura
-- ---------------------------------------------------------------------------
INSERT INTO "ComercialContrato" (
  "id", "orgId", "leadId", "partnerId", "tipo", "estado", "valorCentavos", "hashDoConteudo", "documentoId",
  "motivoDoFim", "encerradoEm", "criadoEm", "atualizadoEm"
)
SELECT
  substr(h.m, 1, 8) || '-' || substr(h.m, 9, 4) || '-' || substr(h.m, 13, 4) || '-' || substr(h.m, 17, 4) || '-' || substr(h.m, 21, 12),
  d."orgId",
  d."leadId",
  f."partnerId",
  'contrato',
  CASE
    WHEN fim."occurredAt" IS NOT NULL THEN 'encerrado'
    WHEN d."estado" <> 'assinado' THEN 'em_assinatura'
    WHEN EXISTS (SELECT 1 FROM "LeadEvent" e WHERE e."leadId" = d."leadId" AND e."type" = 'cliente.ativo') THEN 'ativo'
    ELSE 'assinado'
  END,
  COALESCE(f."valorNegociadoCentavos", f."valorCentavos"),
  d."hashConteudo",
  d."id",
  fim."motivo",
  fim."occurredAt",
  d."criadoEm",
  CURRENT_TIMESTAMP
FROM "ComercialDocumento" d
CROSS JOIN LATERAL (SELECT md5('comercial-contrato:' || d."id") AS m) h
LEFT JOIN "ComercialFicha" f ON f."leadId" = d."leadId"
LEFT JOIN LATERAL (
  SELECT e."occurredAt", e."payload" ->> 'motivo' AS "motivo"
    FROM "LeadEvent" e
   WHERE e."leadId" = d."leadId" AND e."type" = 'contrato.concluido'
   ORDER BY e."occurredAt" DESC
   LIMIT 1
) fim ON true
WHERE d."provedor" <> 'minuta';

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE, as quatro policies, os gatilhos e o backfill.
-- Falha ALTA de propósito: `migrate deploy` roda no arranque do container, e
-- abortar aqui é a API não subir com tabela vazada ou contrato faltando.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alvo text;
  ok boolean;
  faltando integer;
BEGIN
  FOREACH alvo IN ARRAY ARRAY['ComercialContrato', 'ComercialContratoSignatario'] LOOP
    SELECT c.relrowsecurity
       AND c.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
      INTO ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = alvo;

    IF NOT COALESCE(ok, false) THEN
      RAISE EXCEPTION '% ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.', alvo;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = alvo || '_orgId_do_pai' AND NOT t.tgisinternal) THEN
      RAISE EXCEPTION '% sem o gatilho que confere a empresa do pai.', alvo;
    END IF;
  END LOOP;

  SELECT count(*) INTO faltando
    FROM "ComercialDocumento" d
   WHERE d."provedor" <> 'minuta'
     AND NOT EXISTS (SELECT 1 FROM "ComercialContrato" c WHERE c."documentoId" = d."id");
  IF faltando > 0 THEN
    RAISE EXCEPTION 'backfill incompleto: % documento(s) de assinatura sem contrato.', faltando;
  END IF;
END $$;
