-- PROPOSTA DOCUMENTAL: não foi validada por Prisma/PostgreSQL nem aplicada.
-- Instalar a nova estrutura vazia; não transformar Agent.cron/Session/AuditLog em agendas.
BEGIN;
LOCK TABLE "Agent", "Sop", "Session" IN SHARE ROW EXCLUSIVE MODE;
-- Identidades reais aditivas; não prender FK à versão/estado mutável de Agent/Sop/Session.
CREATE UNIQUE INDEX "Agent_id_orgId_key" ON "Agent"("id","orgId");
CREATE UNIQUE INDEX "Sop_id_orgId_agentId_key" ON "Sop"("id","orgId","agentId");
CREATE UNIQUE INDEX "Session_id_orgId_agentId_key" ON "Session"("id","orgId","agentId");

CREATE TABLE "AgentLocalAgenda" (
  "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "agentId" TEXT NOT NULL,
  "criadaPorId" TEXT NOT NULL, "criacaoRequestId" TEXT NOT NULL,
  "criacaoFingerprint" TEXT NOT NULL, "criacaoTipo" TEXT NOT NULL DEFAULT 'agenda_criar',
  "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Agenda_creation_type" CHECK ("criacaoTipo"='agenda_criar'),
  CONSTRAINT "Agenda_fingerprint" CHECK ("criacaoFingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "Agenda_id_org_unique" UNIQUE ("id","orgId"),
  CONSTRAINT "Agenda_id_org_agent_unique" UNIQUE ("id","orgId","agentId"),
  CONSTRAINT "Agenda_creation_request_unique" UNIQUE ("orgId","criacaoRequestId")
);
CREATE TABLE "AgentLocalAgendaRevision" (
  "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "agendaId" TEXT NOT NULL, "agentId" TEXT NOT NULL,
  "numero" INTEGER NOT NULL, "estado" TEXT NOT NULL, "tipo" TEXT NOT NULL,
  "nome" TEXT NOT NULL, "previstoPara" TIMESTAMP(3), "pedido" TEXT NOT NULL,
  "itemId" TEXT NOT NULL, "versionId" TEXT NOT NULL, "sourceVersionNumber" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL, "expectedItemVersion" INTEGER NOT NULL,
  "sopId" TEXT NOT NULL, "sopVersion" INTEGER NOT NULL, "responsavelId" TEXT NOT NULL,
  "modeloConfigurado" TEXT, "configuracaoSnapshot" JSONB NOT NULL, "snapshotHash" TEXT NOT NULL,
  "motivo" TEXT, "actorId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "inputFingerprint" TEXT NOT NULL,
  "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Revision_version_positive" CHECK ("numero">0 AND "sopVersion">0 AND "sourceVersionNumber">0 AND "expectedItemVersion">0),
  CONSTRAINT "Revision_state_type" CHECK ("estado" IN ('pausada','habilitada_manual','encerrada') AND
    "tipo" IN ('agenda_criar','agenda_editar','agenda_estado') AND
    (("numero"=1 AND "tipo"='agenda_criar' AND "estado"='pausada') OR ("numero">1 AND "tipo" IS DISTINCT FROM 'agenda_criar')) AND
    ("tipo" IS DISTINCT FROM 'agenda_editar' OR "estado"='pausada')),
  CONSTRAINT "Revision_text_bounds" CHECK (length(btrim("nome")) BETWEEN 1 AND 120 AND
    length("pedido") BETWEEN 1 AND 2000 AND ("motivo" IS NULL OR length("motivo")<=500) AND
    ("modeloConfigurado" IS NULL OR length("modeloConfigurado") BETWEEN 1 AND 200)),
  CONSTRAINT "Revision_hashes" CHECK ("sourceHash" ~ '^[a-f0-9]{64}$' AND "snapshotHash" ~ '^[a-f0-9]{64}$' AND "inputFingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "Revision_snapshot_shape" CHECK (COALESCE(jsonb_typeof("configuracaoSnapshot")='object'
    AND octet_length("configuracaoSnapshot"::text)<=65536 AND "configuracaoSnapshot"->'schemaVersion'='1'::jsonb
    AND "configuracaoSnapshot"->'automatico'='false'::jsonb AND "configuracaoSnapshot"->>'ferramenta'='contexto.memoria.buscar'
    AND "configuracaoSnapshot"->>'orgId'="orgId" AND "configuracaoSnapshot"->>'agentId'="agentId"
    AND "configuracaoSnapshot"->>'agendaId'="agendaId" AND "configuracaoSnapshot"->>'nome'="nome"
    AND "configuracaoSnapshot"->>'responsavelId'="responsavelId" AND "configuracaoSnapshot"->>'modeloConfigurado' IS NOT DISTINCT FROM "modeloConfigurado"
    AND "configuracaoSnapshot"->'pedido'->>'pedido'="pedido" AND "configuracaoSnapshot"->'pedido'->>'itemId'="itemId"
    AND "configuracaoSnapshot"->'pedido'->>'versionId'="versionId" AND "configuracaoSnapshot"->'pedido'->>'contentHash'="sourceHash"
    AND "configuracaoSnapshot"->'pedido'->'expectedItemVersion'=to_jsonb("expectedItemVersion")
    AND "configuracaoSnapshot"->'pedido'->'expectedSopVersion'=to_jsonb("sopVersion")
    AND "configuracaoSnapshot"->'procedimento'->>'id'="sopId" AND "configuracaoSnapshot"->'procedimento'->'versao'=to_jsonb("sopVersion")
    AND "configuracaoSnapshot"->'fonte'->>'itemId'="itemId" AND "configuracaoSnapshot"->'fonte'->>'versionId'="versionId"
    AND "configuracaoSnapshot"->'fonte'->'versao'=to_jsonb("sourceVersionNumber")
    AND "configuracaoSnapshot"->'fonte'->>'contentHash'="sourceHash"
    AND "configuracaoSnapshot"->'fonte'->'expectedItemVersion'=to_jsonb("expectedItemVersion"),false)),
  CONSTRAINT "Revision_snapshot_hash" CHECK ("snapshotHash"=encode(sha256(convert_to(public.app_json_canonico("configuracaoSnapshot"),'UTF8')),'hex')),
  CONSTRAINT "Revision_id_org_unique" UNIQUE ("id","orgId"),
  CONSTRAINT "Revision_agenda_number_unique" UNIQUE ("orgId","agendaId","numero"),
  CONSTRAINT "Revision_request_unique" UNIQUE ("orgId","requestId"),
  CONSTRAINT "Revision_full_identity_unique" UNIQUE ("id","orgId","agendaId","agentId")
);
CREATE TABLE "AgentLocalAgendaDispatch" (
  "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "agendaId" TEXT NOT NULL, "agentId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "inputFingerprint" TEXT NOT NULL, "tipo" TEXT NOT NULL DEFAULT 'agenda_disparar', "sessionId" TEXT NOT NULL,
  "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Dispatch_type" CHECK ("tipo"='agenda_disparar'),
  CONSTRAINT "Dispatch_fingerprint" CHECK ("inputFingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "Dispatch_id_org_unique" UNIQUE ("id","orgId"),
  CONSTRAINT "Dispatch_request_unique" UNIQUE ("orgId","requestId"),
  CONSTRAINT "Dispatch_session_unique" UNIQUE ("orgId","sessionId"),
  CONSTRAINT "Dispatch_operation_identity_unique" UNIQUE ("id","orgId","agendaId","agentId","revisionId","sessionId","requestId","actorId","inputFingerprint")
);
CREATE TABLE "AgentLocalOperation" (
  "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "agentId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL, "tipo" TEXT NOT NULL, "inputFingerprint" TEXT NOT NULL,
  "agendaId" TEXT, "revisionId" TEXT, "sessionId" TEXT, "dispatchId" TEXT,
  "receipt" JSONB NOT NULL, "receiptHash" TEXT NOT NULL, "auditIds" TEXT[] NOT NULL,
  "eventSnapshot" JSONB NOT NULL, "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Operation_id_org_unique" UNIQUE ("id","orgId"),
  CONSTRAINT "Operation_request_global_unique" UNIQUE ("orgId","requestId"),
  CONSTRAINT "Operation_cause_unique" UNIQUE ("orgId","requestId","actorId","agentId","tipo","inputFingerprint"),
  CONSTRAINT "Operation_reference_shape" CHECK (
    ("tipo" IN ('agenda_criar','agenda_editar','agenda_estado') AND "agendaId" IS NOT NULL AND "revisionId" IS NOT NULL AND "sessionId" IS NULL AND "dispatchId" IS NULL) OR
    ("tipo"='agenda_disparar' AND "agendaId" IS NOT NULL AND "revisionId" IS NOT NULL AND "sessionId" IS NOT NULL AND "dispatchId" IS NOT NULL) OR
    ("tipo"='agente_estado' AND "agendaId" IS NULL AND "revisionId" IS NULL AND "sessionId" IS NULL AND "dispatchId" IS NULL)),
  CONSTRAINT "Operation_hashes" CHECK ("inputFingerprint" ~ '^[a-f0-9]{64}$' AND "receiptHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "Operation_receipt_shape" CHECK (COALESCE(jsonb_typeof("receipt")='object' AND octet_length("receipt"::text)<=65536
    AND "receipt"->'schemaVersion'='1'::jsonb AND "receipt"->>'operationId'="id"
    AND "receipt"->>'requestId'="requestId" AND "receipt"->>'tipo'="tipo"
    AND "receipt"->'escopo'->>'orgId'="orgId" AND "receipt"->'escopo'->>'actorId'="actorId"
    AND "receipt"->'escopo'->>'agentId'="agentId"
    AND "receipt"->'auditIds'=to_jsonb("auditIds") AND "receipt"->'eventSnapshot'="eventSnapshot"
    AND "receipt"->>'confirmadoEm'=to_char("criadaEm",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),false)),
  CONSTRAINT "Operation_receipt_hash" CHECK ("receiptHash"=encode(sha256(convert_to(public.app_json_canonico("receipt"),'UTF8')),'hex')),
  CONSTRAINT "Operation_records_present" CHECK (cardinality("auditIds")>0 AND COALESCE(jsonb_typeof("eventSnapshot")='array' AND jsonb_array_length("eventSnapshot")>0,false))
);

-- Causas cíclicas são conferidas no commit; não há cabeçalho/revisão/disparo sem Operation.
ALTER TABLE "AgentLocalAgenda" ADD CONSTRAINT "Agenda_org_fk" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgenda" ADD CONSTRAINT "Agenda_agent_tenant_fk" FOREIGN KEY ("agentId","orgId") REFERENCES "Agent"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgenda" ADD CONSTRAINT "Agenda_actor_tenant_fk" FOREIGN KEY ("criadaPorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaRevision" ADD CONSTRAINT "Revision_org_fk" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaRevision" ADD CONSTRAINT "Revision_agent_tenant_fk" FOREIGN KEY ("agentId","orgId") REFERENCES "Agent"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaRevision" ADD CONSTRAINT "Revision_actor_tenant_fk" FOREIGN KEY ("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaDispatch" ADD CONSTRAINT "Dispatch_org_fk" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaDispatch" ADD CONSTRAINT "Dispatch_agent_tenant_fk" FOREIGN KEY ("agentId","orgId") REFERENCES "Agent"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaDispatch" ADD CONSTRAINT "Dispatch_actor_tenant_fk" FOREIGN KEY ("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalOperation" ADD CONSTRAINT "Operation_org_fk" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalOperation" ADD CONSTRAINT "Operation_agent_tenant_fk" FOREIGN KEY ("agentId","orgId") REFERENCES "Agent"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalOperation" ADD CONSTRAINT "Operation_actor_tenant_fk" FOREIGN KEY ("actorId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgenda" ADD CONSTRAINT "Agenda_creation_cause_fk" FOREIGN KEY ("orgId","criacaoRequestId","criadaPorId","agentId","criacaoTipo","criacaoFingerprint") REFERENCES "AgentLocalOperation"("orgId","requestId","actorId","agentId","tipo","inputFingerprint") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaRevision" ADD CONSTRAINT "Revision_agenda_agent_fk" FOREIGN KEY ("agendaId","orgId","agentId") REFERENCES "AgentLocalAgenda"("id","orgId","agentId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaRevision" ADD CONSTRAINT "Revision_responsible_tenant_fk" FOREIGN KEY ("responsavelId","orgId") REFERENCES "User"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaRevision" ADD CONSTRAINT "Revision_item_tenant_fk" FOREIGN KEY ("itemId","orgId") REFERENCES "ContextItem"("id","orgId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaRevision" ADD CONSTRAINT "Revision_version_full_fk" FOREIGN KEY ("versionId","orgId","itemId","sourceVersionNumber") REFERENCES "ContextItemVersion"("id","orgId","itemId","versao") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaRevision" ADD CONSTRAINT "Revision_sop_agent_fk" FOREIGN KEY ("sopId","orgId","agentId") REFERENCES "Sop"("id","orgId","agentId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaRevision" ADD CONSTRAINT "Revision_operation_cause_fk" FOREIGN KEY ("orgId","requestId","actorId","agentId","tipo","inputFingerprint") REFERENCES "AgentLocalOperation"("orgId","requestId","actorId","agentId","tipo","inputFingerprint") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaDispatch" ADD CONSTRAINT "Dispatch_agenda_agent_fk" FOREIGN KEY ("agendaId","orgId","agentId") REFERENCES "AgentLocalAgenda"("id","orgId","agentId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaDispatch" ADD CONSTRAINT "Dispatch_revision_full_fk" FOREIGN KEY ("revisionId","orgId","agendaId","agentId") REFERENCES "AgentLocalAgendaRevision"("id","orgId","agendaId","agentId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaDispatch" ADD CONSTRAINT "Dispatch_session_agent_fk" FOREIGN KEY ("sessionId","orgId","agentId") REFERENCES "Session"("id","orgId","agentId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalAgendaDispatch" ADD CONSTRAINT "Dispatch_operation_cause_fk" FOREIGN KEY ("orgId","requestId","actorId","agentId","tipo","inputFingerprint") REFERENCES "AgentLocalOperation"("orgId","requestId","actorId","agentId","tipo","inputFingerprint") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalOperation" ADD CONSTRAINT "Operation_agenda_agent_fk" FOREIGN KEY ("agendaId","orgId","agentId") REFERENCES "AgentLocalAgenda"("id","orgId","agentId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalOperation" ADD CONSTRAINT "Operation_revision_full_fk" FOREIGN KEY ("revisionId","orgId","agendaId","agentId") REFERENCES "AgentLocalAgendaRevision"("id","orgId","agendaId","agentId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalOperation" ADD CONSTRAINT "Operation_session_agent_fk" FOREIGN KEY ("sessionId","orgId","agentId") REFERENCES "Session"("id","orgId","agentId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AgentLocalOperation" ADD CONSTRAINT "Operation_dispatch_full_fk" FOREIGN KEY ("dispatchId","orgId","agendaId","agentId","revisionId","sessionId","requestId","actorId","inputFingerprint") REFERENCES "AgentLocalAgendaDispatch"("id","orgId","agendaId","agentId","revisionId","sessionId","requestId","actorId","inputFingerprint") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "Agenda_org_agent_created_idx" ON "AgentLocalAgenda"("orgId","agentId","criadaEm","id");
CREATE INDEX "Dispatch_org_agenda_idx" ON "AgentLocalAgendaDispatch"("orgId","agendaId","criadaEm");

CREATE FUNCTION public.agenda_local_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% é append-only', TG_TABLE_NAME USING ERRCODE='P0001'; END $$;

-- Só a linha recém-inserida e suas FKs nominais; não escanear todo o tenant por registro.
CREATE FUNCTION public.agenda_local_revision_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a RECORD; v RECORD; anterior RECORD;
BEGIN
  SELECT * INTO a FROM "AgentLocalAgenda" WHERE "id"=NEW."agendaId" AND "orgId"=NEW."orgId";
  SELECT * INTO v FROM "ContextItemVersion" WHERE "id"=NEW."versionId" AND "orgId"=NEW."orgId" AND "itemId"=NEW."itemId" AND "versao"=NEW."sourceVersionNumber";
  IF a."id" IS NULL OR v."id" IS NULL OR v."contentHash" IS DISTINCT FROM NEW."sourceHash"
    OR NEW."configuracaoSnapshot"->'fonte'->>'title' IS DISTINCT FROM v."title"
    OR NEW."configuracaoSnapshot"->'fonte'->>'sourceType' IS DISTINCT FROM v."sourceType"::text
    OR (NEW."configuracaoSnapshot"->'fonte'->>'sourceRef') IS DISTINCT FROM v."sourceRef" THEN
    RAISE EXCEPTION 'Agenda: vínculo da fonte inválido' USING ERRCODE='P0001';
  END IF;
  IF NEW."numero"=1 THEN
    IF NEW."requestId" IS DISTINCT FROM a."criacaoRequestId" OR NEW."actorId" IS DISTINCT FROM a."criadaPorId" OR NEW."inputFingerprint" IS DISTINCT FROM a."criacaoFingerprint" THEN
      RAISE EXCEPTION 'Agenda: causa de criação divergente' USING ERRCODE='P0001'; END IF;
  ELSE
    SELECT * INTO anterior FROM "AgentLocalAgendaRevision" WHERE "orgId"=NEW."orgId" AND "agendaId"=NEW."agendaId" AND "numero"=NEW."numero"-1;
    IF anterior."id" IS NULL OR anterior."estado"='encerrada' THEN
      RAISE EXCEPTION 'Agenda: predecessor ausente ou encerrado' USING ERRCODE='P0001'; END IF;
    IF NEW."tipo"='agenda_estado' AND (NEW."estado"=anterior."estado" OR NEW."configuracaoSnapshot" IS DISTINCT FROM anterior."configuracaoSnapshot") THEN
      RAISE EXCEPTION 'Agenda: estado repetido ou configuração rebaseada' USING ERRCODE='P0001'; END IF;
    IF NEW."estado"='encerrada' AND nullif(btrim(NEW."motivo"),'') IS NULL THEN
      RAISE EXCEPTION 'Agenda: encerramento exige motivo' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.agenda_local_operation_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a RECORD; r RECORD; d RECORD; s RECORD; anterior RECORD; faltantes BIGINT; x JSONB;
BEGIN
  IF NEW."tipo" IN ('agenda_criar','agenda_editar','agenda_estado') THEN
    SELECT * INTO r FROM "AgentLocalAgendaRevision" WHERE "id"=NEW."revisionId" AND "orgId"=NEW."orgId" AND "agendaId"=NEW."agendaId" AND "agentId"=NEW."agentId";
    IF r."id" IS NULL OR r."requestId" IS DISTINCT FROM NEW."requestId" OR r."actorId" IS DISTINCT FROM NEW."actorId" OR r."tipo" IS DISTINCT FROM NEW."tipo" OR r."inputFingerprint" IS DISTINCT FROM NEW."inputFingerprint"
      OR NEW."receipt"->'revisao'->>'agendaId' IS DISTINCT FROM r."agendaId" OR NEW."receipt"->'revisao'->>'revisionId' IS DISTINCT FROM r."id"
      OR NEW."receipt"->'revisao'->'numero' IS DISTINCT FROM to_jsonb(r."numero") OR NEW."receipt"->'revisao'->>'estado' IS DISTINCT FROM r."estado"
      OR NEW."receipt"->'revisao'->>'snapshotHash' IS DISTINCT FROM r."snapshotHash" OR NEW."receipt"->'revisao'->'configuracao' IS DISTINCT FROM r."configuracaoSnapshot"
      OR NEW."receipt"->'revisao'->>'motivo' IS DISTINCT FROM r."motivo"
      OR NEW."receipt"->'revisao'->>'criadaEm' IS DISTINCT FROM to_char(r."criadaEm",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN
      RAISE EXCEPTION 'Agenda: recibo de revisão divergente' USING ERRCODE='P0001'; END IF;
    IF r."numero"=1 THEN
      IF NEW."receipt"->'anterior' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Agenda: criação com predecessor' USING ERRCODE='P0001'; END IF;
    ELSE
      SELECT * INTO anterior FROM "AgentLocalAgendaRevision" WHERE "orgId"=r."orgId" AND "agendaId"=r."agendaId" AND "numero"=r."numero"-1;
      IF NEW."receipt"->'anterior' IS DISTINCT FROM jsonb_build_object('revisionId',anterior."id",'numero',anterior."numero",'estado',anterior."estado") THEN
        RAISE EXCEPTION 'Agenda: predecessor do recibo divergente' USING ERRCODE='P0001'; END IF;
    END IF;
  ELSIF NEW."tipo"='agenda_disparar' THEN
    SELECT * INTO r FROM "AgentLocalAgendaRevision" WHERE "id"=NEW."revisionId" AND "orgId"=NEW."orgId" AND "agendaId"=NEW."agendaId" AND "agentId"=NEW."agentId";
    SELECT * INTO d FROM "AgentLocalAgendaDispatch" WHERE "id"=NEW."dispatchId" AND "orgId"=NEW."orgId";
    SELECT * INTO s FROM "Session" WHERE "id"=NEW."sessionId" AND "orgId"=NEW."orgId" AND "agentId"=NEW."agentId";
    IF r."id" IS NULL OR d."id" IS NULL OR s."id" IS NULL OR r."estado" IS DISTINCT FROM 'habilitada_manual'
      OR s."solicitanteId" IS DISTINCT FROM NEW."actorId" OR s."canal"::text IS DISTINCT FROM 'web' OR s."canalRef" IS DISTINCT FROM 'procedimento-local:'||NEW."requestId"
      OR NEW."receipt"->>'agendaId' IS DISTINCT FROM r."agendaId" OR NEW."receipt"->>'revisionId' IS DISTINCT FROM r."id" OR NEW."receipt"->'agendaVersion' IS DISTINCT FROM to_jsonb(r."numero")
      OR NEW."receipt"->>'snapshotHash' IS DISTINCT FROM r."snapshotHash" OR NEW."receipt"->>'dispatchId' IS DISTINCT FROM d."id" OR NEW."receipt"->>'sessionId' IS DISTINCT FROM s."id"
      OR NEW."receipt"->'entradaConfirmada' IS DISTINCT FROM (r."configuracaoSnapshot"->'pedido'||jsonb_build_object('requestId',NEW."requestId"))
      OR NEW."receipt"->>'estadoNoCompromisso' IS DISTINCT FROM 'rodando' THEN
      RAISE EXCEPTION 'Agenda: recibo de disparo divergente' USING ERRCODE='P0001'; END IF;
  ELSE
    SELECT * INTO a FROM "Agent" WHERE "id"=NEW."agentId" AND "orgId"=NEW."orgId";
    x=NEW."receipt"->'anterior';
    IF x->'escopo'->>'orgId' IS DISTINCT FROM NEW."orgId" OR x->'escopo'->>'actorId' IS DISTINCT FROM NEW."actorId" OR x->'escopo'->>'agentId' IS DISTINCT FROM NEW."agentId"
      OR NEW."receipt"->>'marcaAnterior' IS DISTINCT FROM encode(sha256(convert_to(public.app_json_canonico(jsonb_build_object('escopo',x->'escopo','base',x->'base')),'UTF8')),'hex') THEN
      RAISE EXCEPTION 'Agente: marca anterior divergente' USING ERRCODE='P0001'; END IF;
    x=NEW."receipt"->'posterior';
    IF x->'escopo'->>'orgId' IS DISTINCT FROM NEW."orgId" OR x->'escopo'->>'actorId' IS DISTINCT FROM NEW."actorId" OR x->'escopo'->>'agentId' IS DISTINCT FROM NEW."agentId"
      OR NEW."receipt"->>'marcaNova' IS DISTINCT FROM encode(sha256(convert_to(public.app_json_canonico(jsonb_build_object('escopo',x->'escopo','base',x->'base')),'UTF8')),'hex') THEN
      RAISE EXCEPTION 'Agente: marca posterior divergente' USING ERRCODE='P0001'; END IF;
    IF a."id" IS NULL OR x->'escopo'->>'agentSlug' IS DISTINCT FROM a."slug"
      OR x->'base'->>'estado' IS DISTINCT FROM a."estado"::text OR x->'base'->'ativo' IS DISTINCT FROM to_jsonb(a."ativo")
      OR x->'base'->>'donoId' IS DISTINCT FROM a."donoId" OR x->'base'->>'estadoPorId' IS DISTINCT FROM a."estadoPorId"
      OR x->'base'->>'estadoMotivo' IS DISTINCT FROM a."estadoMotivo"
      OR x->'base'->>'estadoEm' IS DISTINCT FROM to_char(a."estadoEm",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      OR x->'base'->>'atualizadoEm' IS DISTINCT FROM to_char(a."atualizadoEm",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      OR x->>'marca' IS DISTINCT FROM NEW."receipt"->>'marcaNova'
      OR NEW."receipt"->'anterior'->>'marca' IS DISTINCT FROM NEW."receipt"->>'marcaAnterior' THEN
      RAISE EXCEPTION 'Agente: estado confirmado não corresponde à linha real' USING ERRCODE='P0001'; END IF;
    IF NOT COALESCE(jsonb_typeof(NEW."receipt"->'tarefasSoltas')='array',false) THEN
      RAISE EXCEPTION 'Agente: solturas não descritas' USING ERRCODE='P0001'; END IF;
    SELECT count(*) INTO faltantes FROM jsonb_array_elements(NEW."receipt"->'tarefasSoltas') t
      LEFT JOIN "WorkTask" w ON w."id"=t->>'id' AND w."orgId"=NEW."orgId"
      WHERE w."id" IS NULL OR w."agenteId" IS NOT NULL OR w."agenteEm" IS NOT NULL OR w."title" IS DISTINCT FROM t->>'titulo';
    IF faltantes IS DISTINCT FROM 0 OR jsonb_array_length(NEW."receipt"->'tarefasSoltas') IS DISTINCT FROM
      (SELECT count(DISTINCT t->>'id') FROM jsonb_array_elements(NEW."receipt"->'tarefasSoltas') t) THEN
      RAISE EXCEPTION 'Agente: solturas reais divergentes' USING ERRCODE='P0001'; END IF;
  END IF;
  SELECT count(*) INTO faltantes FROM unnest(NEW."auditIds") n(id)
    LEFT JOIN "AuditLog" a ON a."id"=n.id AND a."orgId"=NEW."orgId" AND a."actorId"=NEW."actorId" WHERE a."id" IS NULL;
  IF faltantes IS DISTINCT FROM 0 OR cardinality(NEW."auditIds") IS DISTINCT FROM (SELECT count(DISTINCT v) FROM unnest(NEW."auditIds") v) THEN
    RAISE EXCEPTION 'Agenda: auditorias reais divergentes' USING ERRCODE='P0001'; END IF;
  SELECT count(*) INTO faltantes FROM jsonb_array_elements(NEW."eventSnapshot") e
    LEFT JOIN "EventLog" l ON l."id"=e->>'id' AND l."orgId"=NEW."orgId" AND l."actorId"=NEW."actorId"
    WHERE l."id" IS NULL OR l."seq"::text IS DISTINCT FROM e->>'seq' OR l."hash" IS DISTINCT FROM e->>'hash' OR l."tipo" IS DISTINCT FROM e->>'tipo'
      OR l."ocorreuEm" IS DISTINCT FROM ((e->>'ocorreuEm')::timestamptz AT TIME ZONE 'UTC');
  IF faltantes IS DISTINCT FROM 0 OR jsonb_array_length(NEW."eventSnapshot") IS DISTINCT FROM (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(NEW."eventSnapshot") e) THEN
    RAISE EXCEPTION 'Agenda: eventos reais divergentes' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AgentLocalAgenda_append_only" BEFORE UPDATE OR DELETE ON "AgentLocalAgenda" FOR EACH ROW EXECUTE FUNCTION public.agenda_local_append_only();
ALTER TABLE "AgentLocalAgenda" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentLocalAgenda" FORCE ROW LEVEL SECURITY;
SELECT public.app_rls_aplicar_policies('AgentLocalAgenda','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);
CREATE TRIGGER "AgentLocalAgendaRevision_append_only" BEFORE UPDATE OR DELETE ON "AgentLocalAgendaRevision" FOR EACH ROW EXECUTE FUNCTION public.agenda_local_append_only();
ALTER TABLE "AgentLocalAgendaRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentLocalAgendaRevision" FORCE ROW LEVEL SECURITY;
SELECT public.app_rls_aplicar_policies('AgentLocalAgendaRevision','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);
CREATE TRIGGER "AgentLocalAgendaDispatch_append_only" BEFORE UPDATE OR DELETE ON "AgentLocalAgendaDispatch" FOR EACH ROW EXECUTE FUNCTION public.agenda_local_append_only();
ALTER TABLE "AgentLocalAgendaDispatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentLocalAgendaDispatch" FORCE ROW LEVEL SECURITY;
SELECT public.app_rls_aplicar_policies('AgentLocalAgendaDispatch','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);
CREATE TRIGGER "AgentLocalOperation_append_only" BEFORE UPDATE OR DELETE ON "AgentLocalOperation" FOR EACH ROW EXECUTE FUNCTION public.agenda_local_append_only();
ALTER TABLE "AgentLocalOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentLocalOperation" FORCE ROW LEVEL SECURITY;
SELECT public.app_rls_aplicar_policies('AgentLocalOperation','public.app_org_resolvida() AND "orgId"=public.app_org_atual()','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);
CREATE CONSTRAINT TRIGGER "Revision_commit_guard" AFTER INSERT ON "AgentLocalAgendaRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.agenda_local_revision_commit();
CREATE CONSTRAINT TRIGGER "Operation_commit_guard" AFTER INSERT ON "AgentLocalOperation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.agenda_local_operation_commit();
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN
  GRANT SELECT,INSERT ON "AgentLocalAgenda","AgentLocalAgendaRevision","AgentLocalAgendaDispatch","AgentLocalOperation" TO mktos_app;
END IF; END $$;
COMMIT;
