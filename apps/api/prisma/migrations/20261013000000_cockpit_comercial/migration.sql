-- CreateEnum
CREATE TYPE "ComercialEtapa" AS ENUM ('novo_lead', 'qualificacao', 'reuniao_agendada', 'sessao', 'diagnostico', 'proposta', 'follow_up', 'contrato', 'fechado', 'desqualificado', 'geladeira', 'perdido', 'parceiro');

-- CreateTable
CREATE TABLE "ComercialFicha" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "etapa" "ComercialEtapa" NOT NULL DEFAULT 'novo_lead',
    "etapaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "etapaAntesDaSaida" "ComercialEtapa",
    "empresa" TEXT,
    "cnpj" TEXT,
    "canal" TEXT,
    "origemIndicacao" TEXT,
    "perfil" TEXT,
    "pontuacao" INTEGER,
    "sistemaErp" TEXT,
    "baseDados" BOOLEAN,
    "donoId" TEXT,
    "socioDaConta" TEXT,
    "rota" TEXT,
    "produto" TEXT,
    "valorCentavos" INTEGER,
    "parcelas" INTEGER,
    "parcelaCentavos" INTEGER,
    "forma" TEXT,
    "descontoPct" DECIMAL(5,2),
    "validade" TIMESTAMP(3),
    "propostaVersao" INTEGER NOT NULL DEFAULT 0,
    "propostaHash" TEXT,
    "quadroDeCustos" JSONB,
    "reuniaoEm" TIMESTAMP(3),
    "ataHash" TEXT,
    "diagnostico" JSONB,
    "diagnosticoAprovadoEm" TIMESTAMP(3),
    "cadastro" JSONB,
    "motivoSaida" TEXT,
    "motivoDetalhe" TEXT,
    "voltaEm" TIMESTAMP(3),
    "parceiro" TEXT,
    "saude" INTEGER,
    "proximaAcaoTipo" TEXT,
    "proximaAcaoQuando" TIMESTAMP(3),
    "proximaAcaoTexto" TEXT,
    "confirmacaoEnviadaEm" TIMESTAMP(3),
    "propostaPublicadaEm" TIMESTAMP(3),
    "propostaLidaPelaPrimeiraVezEm" TIMESTAMP(3),
    "propostaAceitaEm" TIMESTAMP(3),
    "cobrancaCriadaEm" TIMESTAMP(3),
    "contratoAssinadoClienteEm" TIMESTAMP(3),
    "contratoAssinadoRootEm" TIMESTAMP(3),
    "pixPagoEm" TIMESTAMP(3),
    "clienteAtivoEm" TIMESTAMP(3),
    "kickoffEm" TIMESTAMP(3),
    "partnerId" TEXT,
    "contractId" TEXT,
    "trilhoId" TEXT,
    "grupoJid" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComercialFicha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComercialConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "envioAutomatico" BOOLEAN NOT NULL DEFAULT false,
    "fechamentoAutomatico" BOOLEAN NOT NULL DEFAULT false,
    "silencioAprova" BOOLEAN NOT NULL DEFAULT false,
    "janelaDeVetoMinutos" INTEGER,
    "fupLeuDias" INTEGER,
    "fupSilencioDias" INTEGER,
    "prazoDiagnosticoDiasUteis" INTEGER,
    "validadePropostaDias" INTEGER,
    "leadParadoDias" INTEGER,
    "decisaoExpiraHoras" INTEGER,
    "horaPublicacaoProposta" INTEGER,
    "autonomia" JSONB NOT NULL DEFAULT '{}',
    "valoresDeHomologacao" BOOLEAN NOT NULL DEFAULT false,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComercialConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComercialDecisao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "contexto" TEXT NOT NULL,
    "opcoes" JSONB NOT NULL,
    "padrao" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'aberta',
    "escolha" TEXT,
    "decididoPor" TEXT,
    "decididoEm" TIMESTAMP(3),
    "canal" TEXT,
    "eventoAberturaId" TEXT,
    "eventoDecisaoId" TEXT,
    "dados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComercialDecisao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaDoCliente" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCifrado" TEXT,
    "validoAte" TIMESTAMP(3) NOT NULL,
    "revogadoEm" TIMESTAMP(3),
    "acessos" INTEGER NOT NULL DEFAULT 0,
    "ultimoAcessoEm" TIMESTAMP(3),
    "dados" JSONB NOT NULL DEFAULT '{}',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaDoCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComercialMensagem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "direcao" TEXT NOT NULL,
    "provedor" TEXT NOT NULL,
    "destino" TEXT NOT NULL DEFAULT 'lead',
    "template" TEXT,
    "texto" TEXT NOT NULL,
    "interativo" JSONB,
    "estado" TEXT NOT NULL DEFAULT 'rascunho',
    "approvalId" TEXT,
    "vetoAte" TIMESTAMP(3),
    "mensagemExternaId" TEXT,
    "eventoId" TEXT,
    "enviadaEm" TIMESTAMP(3),
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComercialMensagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComercialReacao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "reacao" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ok',
    "resultado" JSONB,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComercialReacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComercialFechamento" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "estado" TEXT NOT NULL DEFAULT 'pendente',
    "escritas" JSONB NOT NULL DEFAULT '[]',
    "agendadoPara" TIMESTAMP(3),
    "vetadoEm" TIMESTAMP(3),
    "iniciadoEm" TIMESTAMP(3),
    "concluidoEm" TIMESTAMP(3),
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComercialFechamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComercialCobranca" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "provedor" TEXT NOT NULL,
    "externoId" TEXT NOT NULL,
    "clienteExternoId" TEXT,
    "parcela" INTEGER NOT NULL,
    "parcelas" INTEGER NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "forma" TEXT NOT NULL,
    "vence" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendente',
    "pagaEm" TIMESTAMP(3),
    "linkPagamento" TEXT,
    "pixCopiaECola" TEXT,
    "ultimoAviso" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComercialCobranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComercialDocumento" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "leadId" TEXT NOT NULL,
    "provedor" TEXT NOT NULL,
    "externoId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'criado',
    "hashConteudo" TEXT NOT NULL,
    "linkCliente" TEXT,
    "linkRoot" TEXT,
    "assinadoClienteEm" TIMESTAMP(3),
    "assinadoRootEm" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComercialDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComercialFicha_leadId_key" ON "ComercialFicha"("leadId");

-- CreateIndex
CREATE INDEX "ComercialFicha_orgId_etapa_idx" ON "ComercialFicha"("orgId", "etapa");

-- CreateIndex
CREATE INDEX "ComercialFicha_orgId_etapaDesde_idx" ON "ComercialFicha"("orgId", "etapaDesde");

-- CreateIndex
CREATE INDEX "ComercialFicha_orgId_cnpj_idx" ON "ComercialFicha"("orgId", "cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "ComercialConfig_orgId_key" ON "ComercialConfig"("orgId");

-- CreateIndex
CREATE INDEX "ComercialDecisao_orgId_estado_expiraEm_idx" ON "ComercialDecisao"("orgId", "estado", "expiraEm");

-- CreateIndex
CREATE INDEX "ComercialDecisao_orgId_leadId_idx" ON "ComercialDecisao"("orgId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaDoCliente_leadId_key" ON "SalaDoCliente"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaDoCliente_tokenHash_key" ON "SalaDoCliente"("tokenHash");

-- CreateIndex
CREATE INDEX "SalaDoCliente_orgId_slug_idx" ON "SalaDoCliente"("orgId", "slug");

-- CreateIndex
CREATE INDEX "ComercialMensagem_orgId_leadId_criadoEm_idx" ON "ComercialMensagem"("orgId", "leadId", "criadoEm");

-- CreateIndex
CREATE INDEX "ComercialMensagem_orgId_estado_idx" ON "ComercialMensagem"("orgId", "estado");

-- CreateIndex
CREATE INDEX "ComercialMensagem_orgId_mensagemExternaId_idx" ON "ComercialMensagem"("orgId", "mensagemExternaId");

-- CreateIndex
CREATE INDEX "ComercialReacao_orgId_leadId_idx" ON "ComercialReacao"("orgId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "ComercialReacao_eventoId_reacao_key" ON "ComercialReacao"("eventoId", "reacao");

-- CreateIndex
CREATE UNIQUE INDEX "ComercialFechamento_chave_key" ON "ComercialFechamento"("chave");

-- CreateIndex
CREATE INDEX "ComercialFechamento_orgId_leadId_idx" ON "ComercialFechamento"("orgId", "leadId");

-- CreateIndex
CREATE INDEX "ComercialCobranca_orgId_vence_idx" ON "ComercialCobranca"("orgId", "vence");

-- CreateIndex
CREATE INDEX "ComercialCobranca_orgId_leadId_idx" ON "ComercialCobranca"("orgId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "ComercialCobranca_provedor_externoId_key" ON "ComercialCobranca"("provedor", "externoId");

-- CreateIndex
CREATE INDEX "ComercialDocumento_orgId_leadId_idx" ON "ComercialDocumento"("orgId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "ComercialDocumento_provedor_externoId_key" ON "ComercialDocumento"("provedor", "externoId");

-- AddForeignKey
ALTER TABLE "ComercialFicha" ADD CONSTRAINT "ComercialFicha_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialFicha" ADD CONSTRAINT "ComercialFicha_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialConfig" ADD CONSTRAINT "ComercialConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialDecisao" ADD CONSTRAINT "ComercialDecisao_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialDecisao" ADD CONSTRAINT "ComercialDecisao_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaDoCliente" ADD CONSTRAINT "SalaDoCliente_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaDoCliente" ADD CONSTRAINT "SalaDoCliente_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialMensagem" ADD CONSTRAINT "ComercialMensagem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialMensagem" ADD CONSTRAINT "ComercialMensagem_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialReacao" ADD CONSTRAINT "ComercialReacao_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialReacao" ADD CONSTRAINT "ComercialReacao_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialFechamento" ADD CONSTRAINT "ComercialFechamento_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialFechamento" ADD CONSTRAINT "ComercialFechamento_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialCobranca" ADD CONSTRAINT "ComercialCobranca_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialCobranca" ADD CONSTRAINT "ComercialCobranca_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialDocumento" ADD CONSTRAINT "ComercialDocumento_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComercialDocumento" ADD CONSTRAINT "ComercialDocumento_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ============================================================================
-- O COCKPIT DO LEAD — módulo comercial (13/10/2026)
--
-- O que o Prisma gerou acima: o enum `ComercialEtapa` e nove tabelas — a ficha
-- 1:1 do lead, a configuração por empresa, a fila de decisões, a sala do
-- cliente, as mensagens do WhatsApp por porta, as reações idempotentes, o
-- fechamento com chave e os espelhos de cobrança e documento. Desenho em
-- docs/comercial/mapa-da-operacao.html e no roteiro da passagem.
--
-- O que o Prisma NÃO modela e está abaixo, no mesmo desenho de
-- `20260924010000_onboarding_do_cliente`:
--
--   1. OITO FILHOS DE LEAD COM A EMPRESA CONFERIDA PELO BANCO — `orgId` com a
--      sentinela `''` e o gatilho `mktos_orgid_do_pai('Lead', 'leadId')`
--      (função de `20260910120000_orgid_em_todo_filho`, não redefinida aqui),
--      que deriva a empresa do lead e RECUSA filho pendurado em lead de outra.
--      `ComercialConfig` não tem pai: a empresa vem do insert.
--
--   2. ISOLAMENTO POR LINHA nas nove, com leitura e escrita separadas. A sala do
--      cliente é achada pela SENTINELA pública (`app_resolucao_publica()`): a
--      rota anônima `/api/sala/:token` não tem empresa até achar a sala pelo
--      hash do token — o mesmo contrato de `OnboardingConvite`. As outras oito
--      ficam na policy padrão.
--
--   3. O QUE NÃO ESTÁ AQUI, DE PROPÓSITO: o token da sala (só o hash), a
--      transcrição da ata (`ComercialFicha.ataHash` guarda o hash; o texto não
--      entra na base), e qualquer segredo de provedor.
--
-- CAMINHO DE VOLTA (perde o cockpit; exporte antes):
--   DROP TABLE "ComercialDocumento"; DROP TABLE "ComercialCobranca";
--   DROP TABLE "ComercialFechamento"; DROP TABLE "ComercialReacao";
--   DROP TABLE "ComercialMensagem"; DROP TABLE "SalaDoCliente";
--   DROP TABLE "ComercialDecisao"; DROP TABLE "ComercialConfig";
--   DROP TABLE "ComercialFicha"; DROP TYPE "ComercialEtapa";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261013000000_cockpit_comercial';
-- ============================================================================

-- CreateTrigger: a empresa de cada filho é a do lead
CREATE TRIGGER "ComercialFicha_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ComercialFicha"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Lead', 'leadId');

CREATE TRIGGER "ComercialDecisao_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ComercialDecisao"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Lead', 'leadId');

CREATE TRIGGER "SalaDoCliente_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "SalaDoCliente"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Lead', 'leadId');

CREATE TRIGGER "ComercialMensagem_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ComercialMensagem"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Lead', 'leadId');

CREATE TRIGGER "ComercialReacao_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ComercialReacao"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Lead', 'leadId');

CREATE TRIGGER "ComercialFechamento_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ComercialFechamento"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Lead', 'leadId');

CREATE TRIGGER "ComercialCobranca_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ComercialCobranca"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Lead', 'leadId');

CREATE TRIGGER "ComercialDocumento_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ComercialDocumento"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('Lead', 'leadId');

-- Isolamento por linha: o grupo padrão nas nove, e a leitura pela sentinela
-- pública na sala (é por ela que o link anônimo acha a empresa).
SELECT app_rls_aplicar_policies(
  'ComercialFicha',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ComercialConfig',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ComercialDecisao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'SalaDoCliente',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual() OR public.app_resolucao_publica()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ComercialMensagem',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ComercialReacao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ComercialFechamento',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ComercialCobranca',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ComercialDocumento',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "ComercialFicha", "ComercialConfig", "ComercialDecisao", "SalaDoCliente", "ComercialMensagem", "ComercialReacao", "ComercialFechamento", "ComercialCobranca", "ComercialDocumento" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: as nove têm RLS, FORCE e as quatro policies; os oito
-- gatilhos existem. Falha ALTA de propósito — como `migrate deploy` roda no
-- arranque do container, abortar aqui é a API não subir com tabela vazada.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alvo text;
  ok   boolean;
BEGIN
  FOREACH alvo IN ARRAY ARRAY['ComercialFicha', 'ComercialConfig', 'ComercialDecisao', 'SalaDoCliente', 'ComercialMensagem', 'ComercialReacao', 'ComercialFechamento', 'ComercialCobranca', 'ComercialDocumento'] LOOP
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

  FOREACH alvo IN ARRAY ARRAY['ComercialFicha', 'ComercialDecisao', 'SalaDoCliente', 'ComercialMensagem', 'ComercialReacao', 'ComercialFechamento', 'ComercialCobranca', 'ComercialDocumento'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = alvo || '_orgId_do_pai' AND NOT tgisinternal) THEN
      RAISE EXCEPTION '% sem o gatilho que confere a empresa do lead.', alvo;
    END IF;
  END LOOP;
END $$;
