-- ===========================================================================
-- AGENDA V2 (rodada da Agenda v2, 29/10/2026). ADITIVA: sete tabelas novas e uma
-- coluna nova com padrão. A imagem anterior ignora tudo isto.
--
--   AgendaEvento       o ESPELHO só de leitura da agenda do Google (decisão 1)
--   AgendaSincronia    o syncToken e o estado de cada agenda lida
--   AgendaRegraPessoa  a régua de cada sócio
--   AgendaRito         os ritos da casa
--   Feriado            feriados nacionais, facultativos e municipais
--   AgendaRegraTexto   regras em frase (o vigia lê; a régua não interpreta)
--   AgendaConvite      o link de escolha (só o hash do token)
--   PolicyVersion.aprovacaoR2Ligada  a aprovação de R2 da empresa, lida pela porta
--                      SÓ para gente na tela (decisão 2); padrão true = a regra de sempre.
--
-- E a permissão nova `agenda.regras`, só no Admin Master (os sócios).
-- ===========================================================================

-- AlterTable
ALTER TABLE "PolicyVersion" ADD COLUMN     "aprovacaoR2Ligada" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AgendaEvento" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agenda" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'google',
    "googleId" TEXT NOT NULL,
    "titulo" TEXT,
    "descricao" TEXT,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "diaInteiro" BOOLEAN NOT NULL DEFAULT false,
    "local" TEXT,
    "meet" TEXT,
    "convidados" JSONB NOT NULL DEFAULT '[]',
    "organizador" TEXT,
    "organizadorEhAgenda" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'confirmado',
    "atualizadoNoGoogle" TIMESTAMP(3),
    "serieId" TEXT,
    "criadoPeloOs" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "leituraTipo" TEXT NOT NULL DEFAULT 'outro',
    "leituraCliente" TEXT,
    "leituraResponsaveis" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leituraModalidade" TEXT,
    "leituraMotivo" TEXT,
    "propriedades" JSONB NOT NULL DEFAULT '{}',
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendaSincronia" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agenda" TEXT NOT NULL,
    "syncToken" TEXT,
    "janelaDe" TIMESTAMP(3),
    "janelaAte" TIMESTAMP(3),
    "ultimaPassagem" TIMESTAMP(3),
    "ultimaCompleta" TIMESTAMP(3),
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaSincronia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendaRegraPessoa" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "area" TEXT,
    "userId" TEXT,
    "janelaInicio" TEXT NOT NULL DEFAULT '08:00',
    "janelaFim" TEXT NOT NULL DEFAULT '18:00',
    "intervaloMin" INTEGER NOT NULL DEFAULT 15,
    "trajetoMin" INTEGER NOT NULL DEFAULT 30,
    "tetoPorDia" INTEGER NOT NULL DEFAULT 5,
    "bloqueiosFixos" JSONB NOT NULL DEFAULT '[]',
    "emailPessoal" TEXT,
    "fechadoLigado" BOOLEAN NOT NULL DEFAULT false,
    "substituto" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaRegraPessoa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendaRito" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "diaDaSemana" INTEGER NOT NULL,
    "ordinalNoMes" INTEGER,
    "inicio" TEXT,
    "duracaoMin" INTEGER NOT NULL DEFAULT 60,
    "quem" TEXT NOT NULL DEFAULT 'Todos',
    "politica" TEXT NOT NULL DEFAULT 'pergunta',
    "ligado" BOOLEAN NOT NULL DEFAULT true,
    "aDecidir" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaRito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feriado" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cidade" TEXT,
    "ligado" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feriado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendaRegraTexto" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "frase" TEXT NOT NULL,
    "ligada" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaRegraTexto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendaConvite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "socio" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'cliente',
    "modalidade" TEXT NOT NULL DEFAULT 'online',
    "duracaoMin" INTEGER NOT NULL DEFAULT 60,
    "leadId" TEXT,
    "clienteId" TEXT,
    "nome" TEXT,
    "validoAte" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "escolhidoInicio" TIMESTAMP(3),
    "escolhidoFim" TIMESTAMP(3),
    "emailInformado" TEXT,
    "approvalId" TEXT,
    "eventoId" TEXT,
    "revogadoEm" TIMESTAMP(3),
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaConvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgendaEvento_orgId_inicio_idx" ON "AgendaEvento"("orgId", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "AgendaEvento_orgId_agenda_googleId_key" ON "AgendaEvento"("orgId", "agenda", "googleId");

-- CreateIndex
CREATE UNIQUE INDEX "AgendaSincronia_orgId_agenda_key" ON "AgendaSincronia"("orgId", "agenda");

-- CreateIndex
CREATE UNIQUE INDEX "AgendaRegraPessoa_orgId_nome_key" ON "AgendaRegraPessoa"("orgId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "AgendaRito_orgId_nome_key" ON "AgendaRito"("orgId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Feriado_orgId_data_nome_key" ON "Feriado"("orgId", "data", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "AgendaConvite_tokenHash_key" ON "AgendaConvite"("tokenHash");

-- CreateIndex
CREATE INDEX "AgendaConvite_orgId_criadoEm_idx" ON "AgendaConvite"("orgId", "criadoEm");

-- AddForeignKey
ALTER TABLE "AgendaEvento" ADD CONSTRAINT "AgendaEvento_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaSincronia" ADD CONSTRAINT "AgendaSincronia_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaRegraPessoa" ADD CONSTRAINT "AgendaRegraPessoa_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaRito" ADD CONSTRAINT "AgendaRito_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feriado" ADD CONSTRAINT "Feriado_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaRegraTexto" ADD CONSTRAINT "AgendaRegraTexto_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaConvite" ADD CONSTRAINT "AgendaConvite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECKs: o que o código escreve, e nada além.
ALTER TABLE "AgendaEvento" ADD CONSTRAINT "AgendaEvento_origem_check" CHECK ("origem" IN ('google', 'livre_ocupado'));
ALTER TABLE "AgendaEvento" ADD CONSTRAINT "AgendaEvento_status_check" CHECK ("status" IN ('confirmado', 'provisorio', 'cancelado'));
ALTER TABLE "AgendaEvento" ADD CONSTRAINT "AgendaEvento_leituraTipo_check"
  CHECK ("leituraTipo" IN ('cliente', 'interna', 'fechado', 'fora', 'pessoal', 'feriado', 'outro'));
ALTER TABLE "AgendaEvento" ADD CONSTRAINT "AgendaEvento_intervalo_check" CHECK ("fim" >= "inicio");
ALTER TABLE "AgendaEvento" ADD CONSTRAINT "AgendaEvento_livre_ocupado_sem_titulo_check"
  CHECK ("origem" <> 'livre_ocupado' OR ("titulo" IS NULL AND "descricao" IS NULL AND "local" IS NULL));
ALTER TABLE "AgendaRegraPessoa" ADD CONSTRAINT "AgendaRegraPessoa_numeros_check"
  CHECK ("intervaloMin" BETWEEN 0 AND 240 AND "trajetoMin" BETWEEN 0 AND 480 AND "tetoPorDia" BETWEEN 0 AND 30);
ALTER TABLE "AgendaRegraPessoa" ADD CONSTRAINT "AgendaRegraPessoa_janela_check"
  CHECK ("janelaInicio" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "janelaFim" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "janelaInicio" < "janelaFim");
ALTER TABLE "AgendaRito" ADD CONSTRAINT "AgendaRito_politica_check" CHECK ("politica" IN ('pergunta', 'bloqueia'));
ALTER TABLE "AgendaRito" ADD CONSTRAINT "AgendaRito_dia_check"
  CHECK ("diaDaSemana" BETWEEN 0 AND 6 AND ("ordinalNoMes" IS NULL OR "ordinalNoMes" BETWEEN 1 AND 5) AND "duracaoMin" BETWEEN 5 AND 1440);
ALTER TABLE "Feriado" ADD CONSTRAINT "Feriado_tipo_check" CHECK ("tipo" IN ('nacional', 'facultativo', 'municipal'));
ALTER TABLE "Feriado" ADD CONSTRAINT "Feriado_data_check" CHECK ("data" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
ALTER TABLE "AgendaConvite" ADD CONSTRAINT "AgendaConvite_tipo_check" CHECK ("tipo" IN ('cliente', 'interna') AND "modalidade" IN ('online', 'presencial'));
ALTER TABLE "AgendaConvite" ADD CONSTRAINT "AgendaConvite_duracao_check" CHECK ("duracaoMin" BETWEEN 5 AND 600);
ALTER TABLE "AgendaConvite" ADD CONSTRAINT "AgendaConvite_tokenHash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

-- Isolamento por linha: o grupo padrão, nas sete. O convite é lido pela rota
-- pública só depois de resolver a empresa pelo hash (como o link do onboarding),
-- então a policy é a mesma das outras.
SELECT app_rls_aplicar_policies(t,
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()')
FROM unnest(ARRAY['AgendaEvento', 'AgendaSincronia', 'AgendaRegraPessoa', 'AgendaRito', 'Feriado', 'AgendaRegraTexto', 'AgendaConvite']) AS t;

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    FOREACH t IN ARRAY ARRAY['AgendaEvento', 'AgendaSincronia', 'AgendaRegraPessoa', 'AgendaRito', 'Feriado', 'AgendaRegraTexto', 'AgendaConvite'] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO mktos_app', t);
    END LOOP;
  END IF;
END $$;

-- A permissão nova, só nos sócios (Admin Master).
INSERT INTO "Permission" ("id", "key")
VALUES (gen_random_uuid()::text, 'agenda.regras')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "_RolePermissions" ("A", "B")
SELECT p."id", r."id" FROM "Permission" p CROSS JOIN "Role" r
WHERE p."key" = 'agenda.regras' AND r."key" = 'admin_master'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA LOCAL: RLS, FORCE e as quatro policies nas sete. Falha ALTA: tabela
-- de empresa sem policy é vazamento, não pendência.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  ok boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['AgendaEvento', 'AgendaSincronia', 'AgendaRegraPessoa', 'AgendaRito', 'Feriado', 'AgendaRegraTexto', 'AgendaConvite'] LOOP
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
END $$;
