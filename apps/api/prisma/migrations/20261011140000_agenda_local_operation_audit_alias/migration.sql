-- Evita colisão entre o registro PL/pgSQL a (Agent) e o alias da auditoria.
-- A função mantém todas as verificações e os triggers existentes.
CREATE OR REPLACE FUNCTION public.agenda_local_operation_commit() RETURNS trigger LANGUAGE plpgsql AS $$
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
    LEFT JOIN "AuditLog" audit_row ON audit_row."id"=n.id AND audit_row."orgId"=NEW."orgId" AND audit_row."actorId"=NEW."actorId" WHERE audit_row."id" IS NULL;
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
