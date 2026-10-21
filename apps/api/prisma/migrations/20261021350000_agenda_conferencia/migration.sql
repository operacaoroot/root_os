-- ============================================================================
-- O VIGIA DA AGENDA (AG-01) — o que ele concluiu de cada reunião fora do padrão
-- (rodada dos agentes, 21/10/2026, lane A5)
-- ============================================================================
--
-- ADITIVA: uma tabela nova, nenhuma coluna mexida em tabela existente. A imagem
-- anterior ignora a tabela; voltar só a imagem não exige desfazer nada.
--
-- NÃO É CÓPIA DA AGENDA. A agenda da Root é o Google (decisão de 24/09/2026,
-- docs/AGENDA.md). Aqui fica só o que o VIGIA decidiu de um evento: o título
-- lido, a assinatura do evento (sha256 do que ele leu, para saber se o evento
-- mudou), a proposta de título no padrão e onde ela está (a aprovação na fila
-- ou a pendência). É esta tabela que impede o vigia, que passa a cada 15
-- minutos, de propor de novo o mesmo título para o mesmo evento, de pagar o
-- modelo de novo pelo que já leu e de perguntar de novo o que uma pessoa já
-- respondeu ("não é reunião").
--
-- Raiz da empresa, NÃO filha: o "orgId" vem do insert. "approvalId" e
-- "pendenciaId" apontam para tabelas de outro dono, sem FK de propósito (a
-- aprovação vence e é limpa por rotina própria; a pendência é decidida na caixa).
--
-- Rollback (só se nada depender dela): DROP TABLE "AgendaConferencia";
-- ============================================================================

CREATE TABLE "AgendaConferencia" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "tituloLido" TEXT NOT NULL,
    "assinatura" TEXT NOT NULL,
    "inicio" TIMESTAMP(3),
    "estado" TEXT NOT NULL,
    "problemas" JSONB NOT NULL DEFAULT '[]',
    "tituloProposto" TEXT,
    "adicionarMeet" BOOLEAN NOT NULL DEFAULT false,
    "origem" TEXT,
    "approvalId" TEXT,
    "pendenciaId" TEXT,
    "motivo" TEXT,
    "propostoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaConferencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgendaConferencia_orgId_eventoId_key" ON "AgendaConferencia"("orgId", "eventoId");
CREATE INDEX "AgendaConferencia_orgId_estado_idx" ON "AgendaConferencia"("orgId", "estado");

ALTER TABLE "AgendaConferencia" ADD CONSTRAINT "AgendaConferencia_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgendaConferencia" ADD CONSTRAINT "AgendaConferencia_estado_check"
  CHECK ("estado" IN ('proposta', 'pendencia', 'nao_e_reuniao', 'resolvido'));
ALTER TABLE "AgendaConferencia" ADD CONSTRAINT "AgendaConferencia_origem_check"
  CHECK ("origem" IS NULL OR "origem" IN ('gramatica', 'modelo', 'pessoa'));
-- Proposta sem título é estado impossível: a tela mostraria um botão que não manda nada.
ALTER TABLE "AgendaConferencia" ADD CONSTRAINT "AgendaConferencia_proposta_com_titulo_check"
  CHECK ("estado" <> 'proposta' OR "tituloProposto" IS NOT NULL);

SELECT app_rls_aplicar_policies(
  'AgendaConferencia',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "AgendaConferencia" TO mktos_app';
  END IF;
END $$;

DO $$
DECLARE
  ok boolean;
BEGIN
  SELECT c.relrowsecurity
     AND c.relforcerowsecurity
     AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
    INTO ok
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'AgendaConferencia';

  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION
      'AgendaConferencia ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
