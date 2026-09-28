-- ============================================================================
-- MD7 — A APROVAÇÃO DE LOTE COM USO CONTADO (24/09/2026)
--
-- A segunda forma da invariante 4: "aprovação é de uso único — ou de uso
-- contado, item a item, quando a capacidade declara lote —, presa ao conteúdo
-- exato e com prazo".
--
-- `AprovacaoDeLote` é a lista assinada: a capacidade `modo: lote` que a assina
-- (hoje `pauta.semana.aprovar`, R4), o hash canônico da lista ordenada, o
-- prazo, a aprovação R4 do pedido e quem assinou. `ItemDoLote` é cada uso
-- contado: a capacidade `sob_lote` do item, o recurso, o hash do conteúdo
-- exato, a janela, os usos e — para a DM do MD11 — o teto por dia com a virada
-- em São Paulo. O consumo é UMA instrução (`LotesService.consumirItem`).
--
-- `AprovacaoDeLote` tem empresa própria; `ItemDoLote` é filho com a regra de
-- sempre: sentinela `''` e o gatilho `mktos_orgid_do_pai('AprovacaoDeLote',
-- 'loteId')`, que deriva a empresa do lote e RECUSA item pendurado em lote de
-- outra empresa. As duas com isolamento por linha, leitura e escrita separadas.
--
-- `approvalId` fica sem chave estrangeira, como em `PautaPublicacao`: é a
-- referência para o RASTRO, e nenhuma aprovação é apagada em cascata.
--
-- ----------------------------------------------------------------------------
-- CAMINHO DE VOLTA
-- ----------------------------------------------------------------------------
--   DROP TABLE "ItemDoLote"; DROP TABLE "AprovacaoDeLote";
--   DROP TYPE "ItemDoLoteEstado"; DROP TYPE "LoteEstado";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260924235614_aprovacao_de_lote';
--
-- A volta perde os lotes (as aprovações R4 continuam em "Approval" e o RASTRO
-- dos consumos continua no banco). Sem as tabelas, a porta recusa todo
-- `loteItemId` (falha fechada) e a publicação segue item a item.
-- ============================================================================

-- CreateEnum
CREATE TYPE "LoteEstado" AS ENUM ('proposta', 'aguardando', 'ativo', 'encerrado', 'vencido', 'revogado');

-- CreateEnum
CREATE TYPE "ItemDoLoteEstado" AS ENUM ('ativo', 'consumido', 'revogado');

-- CreateTable
CREATE TABLE "AprovacaoDeLote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "recursoTipo" TEXT NOT NULL,
    "recursoId" TEXT NOT NULL,
    "hashConteudo" TEXT NOT NULL,
    "estado" "LoteEstado" NOT NULL DEFAULT 'proposta',
    "validaAte" TIMESTAMP(3) NOT NULL,
    "approvalId" TEXT,
    "propostoPorId" TEXT NOT NULL,
    "aprovadoPorId" TEXT,
    "aprovadoEm" TIMESTAMP(3),
    "motivo" TEXT,
    "resumo" TEXT NOT NULL DEFAULT '',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AprovacaoDeLote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemDoLote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT '',
    "loteId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "recursoId" TEXT NOT NULL,
    "hashItem" TEXT NOT NULL,
    "janelaDe" TIMESTAMP(3) NOT NULL,
    "janelaAte" TIMESTAMP(3) NOT NULL,
    "usoMaximo" INTEGER NOT NULL DEFAULT 1,
    "tetoPorDia" INTEGER,
    "usosNoDia" INTEGER NOT NULL DEFAULT 0,
    "diaDoContador" TEXT,
    "usos" INTEGER NOT NULL DEFAULT 0,
    "consumidoEm" TIMESTAMP(3),
    "estado" "ItemDoLoteEstado" NOT NULL DEFAULT 'ativo',
    "revogadoEm" TIMESTAMP(3),
    "motivoDaRevogacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemDoLote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AprovacaoDeLote_orgId_estado_validaAte_idx" ON "AprovacaoDeLote"("orgId", "estado", "validaAte");

-- CreateIndex
CREATE INDEX "AprovacaoDeLote_orgId_recursoTipo_recursoId_idx" ON "AprovacaoDeLote"("orgId", "recursoTipo", "recursoId");

-- CreateIndex
CREATE INDEX "ItemDoLote_orgId_capabilityId_recursoId_estado_idx" ON "ItemDoLote"("orgId", "capabilityId", "recursoId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "ItemDoLote_loteId_capabilityId_recursoId_key" ON "ItemDoLote"("loteId", "capabilityId", "recursoId");

-- AddForeignKey
ALTER TABLE "AprovacaoDeLote" ADD CONSTRAINT "AprovacaoDeLote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDoLote" ADD CONSTRAINT "ItemDoLote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDoLote" ADD CONSTRAINT "ItemDoLote_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "AprovacaoDeLote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTrigger: a empresa do item é a do lote.
CREATE TRIGGER "ItemDoLote_orgId_do_pai"
  BEFORE INSERT OR UPDATE ON "ItemDoLote"
  FOR EACH ROW EXECUTE FUNCTION mktos_orgid_do_pai('AprovacaoDeLote', 'loteId');

-- Isolamento por linha: o grupo padrão, leitura e escrita separadas.
SELECT app_rls_aplicar_policies(
  'AprovacaoDeLote',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
SELECT app_rls_aplicar_policies(
  'ItemDoLote',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "AprovacaoDeLote" TO mktos_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "ItemDoLote" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE, as quatro policies e o gatilho. Falha ALTA de
-- propósito — `migrate deploy` roda no arranque do container, e abortar aqui é
-- a API não subir com tabela vazada.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  ok boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['AprovacaoDeLote', 'ItemDoLote'] LOOP
    SELECT c.relrowsecurity
       AND c.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
      INTO ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;

    IF NOT COALESCE(ok, false) THEN
      RAISE EXCEPTION
        '% ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ItemDoLote_orgId_do_pai' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ItemDoLote sem o gatilho que confere a empresa do lote.';
  END IF;
END $$;
