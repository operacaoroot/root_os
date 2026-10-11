-- V3: busca literal na versão local escolhida; migração ainda não aplicada.
-- Compõe o namespace existente de Agenda. Aplicação depende do handoff N5/schema.
BEGIN;
LOCK TABLE "Sop", "Session", "SessionStep", "AgentLocalOperation" IN SHARE ROW EXCLUSIVE MODE;
-- Não adotar, unir ou apagar Session legada duplicada.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Session" WHERE canal='web' AND "canalRef" LIKE 'procedimento-local:%'
   GROUP BY "orgId","canalRef" HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Namespace local duplicado; instalação recusada' USING ERRCODE='P0001';
 END IF;
END $$;
ALTER TABLE "Sop" ADD COLUMN "ferramentaLocal" JSONB;
ALTER TABLE "Sop" ADD CONSTRAINT "Sop_tool_profile_shape" CHECK (
 "ferramentaLocal" IS NULL OR COALESCE(jsonb_typeof("ferramentaLocal")='object'
  AND "ferramentaLocal"->'schemaVersion'='1'::jsonb AND "ferramentaLocal"->>'capacidade'='contexto.memoria.buscar'
  AND "ferramentaLocal"->>'modo'='literal_versao_escolhida_v1' AND "ferramentaLocal"->>'consulta'='pedido.q'
  AND "ferramentaLocal"->'maxFonteBytes'='262144'::jsonb AND "ferramentaLocal"->'maxTrechoPontos'='300'::jsonb
  AND "ferramentaLocal"->'limit' IN ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb,'7'::jsonb,'8'::jsonb,'9'::jsonb,'10'::jsonb)
  AND "ferramentaLocal"-ARRAY['schemaVersion','capacidade','modo','consulta','limit','maxFonteBytes','maxTrechoPontos']='{}'::jsonb,false));
CREATE UNIQUE INDEX "Session_local_request_unique" ON "Session"("orgId","canalRef")
 WHERE canal='web' AND "canalRef" LIKE 'procedimento-local:%';
CREATE UNIQUE INDEX "SessionStep_id_org_session_unique" ON "SessionStep"(id,"orgId","sessionId");
CREATE FUNCTION public.tool_local_config_text(c JSONB) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF c IS NULL OR NOT COALESCE(c->'schemaVersion'='1'::jsonb AND c->>'capacidade'='contexto.memoria.buscar'
  AND c->>'modo'='literal_versao_escolhida_v1' AND c->>'consulta'='pedido.q'
  AND c->'maxFonteBytes'='262144'::jsonb AND c->'maxTrechoPontos'='300'::jsonb
  AND c->'limit' IN ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb,'7'::jsonb,'8'::jsonb,'9'::jsonb,'10'::jsonb)
  AND c-ARRAY['schemaVersion','capacidade','modo','consulta','limit','maxFonteBytes','maxTrechoPontos']='{}'::jsonb,false) THEN
  RAISE EXCEPTION 'Perfil local inválido' USING ERRCODE='P0001'; END IF;
 RETURN '{"schemaVersion":1,"capacidade":"contexto.memoria.buscar","modo":"literal_versao_escolhida_v1","consulta":"pedido.q","limit":'
  ||(c->>'limit')||',"maxFonteBytes":262144,"maxTrechoPontos":300}';
END $$;
CREATE TABLE "AgentLocalToolReceipt" (
 id TEXT NOT NULL PRIMARY KEY, "orgId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "agentId" TEXT NOT NULL,
 "agentSlug" TEXT NOT NULL, "requestId" TEXT NOT NULL, "sessionId" TEXT NOT NULL,
 "entradaContrato" INTEGER NOT NULL DEFAULT 3, capacidade TEXT NOT NULL, modo TEXT NOT NULL, status TEXT NOT NULL,
 "inputCanonico" TEXT NOT NULL, entrada JSONB NOT NULL, "inputFingerprint" TEXT NOT NULL,
 "sopId" TEXT NOT NULL, "sopVersion" INTEGER NOT NULL, "sopSnapshot" JSONB NOT NULL, "toolConfigHash" TEXT NOT NULL,
 "itemId" TEXT NOT NULL, "versionId" TEXT NOT NULL, "versionNo" INTEGER NOT NULL, "contentHash" TEXT NOT NULL,
 "sourceSnapshot" JSONB NOT NULL, "passoPedidoId" TEXT NOT NULL, "passoFinalId" TEXT NOT NULL, "auditIds" TEXT[] NOT NULL,
 "resultadoCanonico" TEXT, resultado JSONB, "resultHash" TEXT,
 "receiptCanonico" TEXT NOT NULL, receipt JSONB NOT NULL, "receiptHash" TEXT NOT NULL,
 "criadaEm" TIMESTAMP(3) NOT NULL, "encerradaEm" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ToolReceipt_org_request_unique" UNIQUE("orgId","requestId"),
 CONSTRAINT "ToolReceipt_org_session_unique" UNIQUE("orgId","sessionId"),
 CONSTRAINT "ToolReceipt_id_org_unique" UNIQUE(id,"orgId"),
 CONSTRAINT "ToolReceipt_cause" CHECK ("entradaContrato"=3 AND capacidade='contexto.memoria.buscar'
   AND modo='literal_versao_escolhida_v1' AND status IN ('executada','recusada') AND "sopVersion">0 AND "versionNo">0
   AND "passoPedidoId"<>"passoFinalId" AND "criadaEm"<="encerradaEm"),
 CONSTRAINT "ToolReceipt_hashes" CHECK ("inputFingerprint" ~ '^[a-f0-9]{64}$' AND "toolConfigHash" ~ '^[a-f0-9]{64}$'
   AND "contentHash" ~ '^[a-f0-9]{64}$' AND "receiptHash" ~ '^[a-f0-9]{64}$'
   AND ("resultHash" IS NULL OR "resultHash" ~ '^[a-f0-9]{64}$')),
 CONSTRAINT "ToolReceipt_input_shape" CHECK (COALESCE(jsonb_typeof(entrada)='object'
   AND entrada->>'requestId'="requestId" AND entrada->>'itemId'="itemId" AND entrada->>'versionId'="versionId"
   AND entrada->>'contentHash'="contentHash" AND entrada->'expectedSopVersion'=to_jsonb("sopVersion")
   AND entrada->>'expectedToolConfigHash'="toolConfigHash" AND jsonb_typeof(entrada->'q')='string'
   AND char_length(entrada->>'q') BETWEEN 2 AND 200 AND strpos(entrada->>'q',E'\r')=0 AND strpos(entrada->>'q',E'\n')=0
   AND jsonb_typeof(entrada->'pedido')='string' AND char_length(entrada->>'pedido') BETWEEN 1 AND 2000
   AND entrada->'limit'="sopSnapshot"->'ferramentaLocal'->'limit'
   AND (entrada->>'expectedItemVersion')::integer>0
   AND entrada-ARRAY['requestId','pedido','q','limit','itemId','versionId','contentHash','expectedItemVersion','expectedSopVersion','expectedToolConfigHash']='{}'::jsonb,false)),
 CONSTRAINT "ToolReceipt_input_text" CHECK (COALESCE("inputCanonico"::jsonb=jsonb_build_object('contrato',3,'orgId',"orgId",
   'actorId',"actorId",'agentId',"agentId",'slug',"agentSlug",'capacidade',capacidade,'modo',modo,'input',entrada)
   AND "inputFingerprint"=encode(sha256(convert_to("inputCanonico",'UTF8')),'hex'),false)),
 CONSTRAINT "ToolReceipt_receipt_text" CHECK (COALESCE("receiptCanonico"::jsonb=receipt
   AND "receiptHash"=encode(sha256(convert_to("receiptCanonico",'UTF8')),'hex'),false)),
 CONSTRAINT "ToolReceipt_result_text" CHECK ((status='executada' AND "resultadoCanonico" IS NOT NULL AND resultado IS NOT NULL
   AND "resultHash" IS NOT NULL AND "resultadoCanonico"::jsonb=resultado
   AND "resultHash"=encode(sha256(convert_to("resultadoCanonico",'UTF8')),'hex'))
   OR (status='recusada' AND "resultadoCanonico" IS NULL AND resultado IS NULL AND "resultHash" IS NULL)),
 CONSTRAINT "ToolReceipt_size" CHECK (octet_length("inputCanonico")<=65536 AND octet_length("receiptCanonico")<=65536
   AND octet_length(receipt::text)<=65536 AND ("resultadoCanonico" IS NULL OR octet_length("resultadoCanonico")<=65536)
   AND (resultado IS NULL OR octet_length(resultado::text)<=65536)),
 CONSTRAINT "ToolReceipt_audits" CHECK (cardinality("auditIds")>0),
 CONSTRAINT "ToolReceipt_receipt_scope" CHECK (COALESCE(receipt->'schemaVersion'='1'::jsonb
   AND receipt->>'tipo'='procedimento_ferramenta_local' AND receipt->'entradaContrato'='3'::jsonb
   AND receipt->>'id'=id AND receipt->'escopo'=jsonb_build_object('orgId',"orgId",'actorId',"actorId",'agentId',"agentId",'agentSlug',"agentSlug")
   AND receipt->>'requestId'="requestId" AND receipt->>'sessionId'="sessionId" AND receipt->>'status'=status
   AND receipt->'entrada'=entrada AND receipt->>'inputCanonico'="inputCanonico" AND receipt->>'inputFingerprint'="inputFingerprint"
   AND receipt->'sop'="sopSnapshot" AND receipt->'fonteEscolhida'="sourceSnapshot"
   AND receipt->>'passoPedidoId'="passoPedidoId" AND receipt->>'passoFinalId'="passoFinalId"
   AND receipt->'auditIds'=to_jsonb("auditIds") AND receipt->'resultado' IS NOT DISTINCT FROM COALESCE(resultado,'null'::jsonb)
   AND receipt->>'resultHash' IS NOT DISTINCT FROM "resultHash",false)),
 CONSTRAINT "ToolReceipt_real_source" CHECK (COALESCE("sourceSnapshot"->>'itemId'="itemId" AND "sourceSnapshot"->>'versionId'="versionId"
   AND "sourceSnapshot"->'versao'=to_jsonb("versionNo") AND "sourceSnapshot"->>'contentHash'="contentHash",false)),
 CONSTRAINT "ToolReceipt_real_sop" CHECK (COALESCE("sopSnapshot"->>'id'="sopId" AND "sopSnapshot"->'versao'=to_jsonb("sopVersion")
   AND "sopSnapshot"->>'configHash'="toolConfigHash",false)),
 CONSTRAINT "ToolReceipt_no_model" CHECK (COALESCE(receipt->'consumoModelo'=jsonb_build_object('origem','nenhuma_chamada_de_modelo',
   'provider',NULL,'modeloUsado',NULL,'tokensIn',NULL,'tokensOut',NULL,'custoExternoUsd',0,'custoMaquinaMedido',false),false)),
 CONSTRAINT "ToolReceipt_status_payload" CHECK (COALESCE(
   (status='executada' AND receipt->'ferramentaChamada'='true'::jsonb AND receipt->'motivoCode'='null'::jsonb
    AND receipt->'fonteConsumida'="sourceSnapshot") OR
   (status='recusada' AND receipt->'ferramentaChamada'='false'::jsonb AND receipt->'fonteConsumida'='null'::jsonb
    AND receipt->>'motivoCode' IN ('agente_nao_ativo','responsavel_indisponivel','capacidade_nao_declarada')),false))
);
ALTER TABLE "AgentLocalToolReceipt" ADD CONSTRAINT "ToolReceipt_org_fk" FOREIGN KEY("orgId") REFERENCES "Org"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AgentLocalToolReceipt" ADD CONSTRAINT "ToolReceipt_actor_fk" FOREIGN KEY("actorId","orgId") REFERENCES "User"(id,"orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AgentLocalToolReceipt" ADD CONSTRAINT "ToolReceipt_agent_fk" FOREIGN KEY("agentId","orgId") REFERENCES "Agent"(id,"orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AgentLocalToolReceipt" ADD CONSTRAINT "ToolReceipt_sop_fk" FOREIGN KEY("sopId","orgId","agentId") REFERENCES "Sop"(id,"orgId","agentId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AgentLocalToolReceipt" ADD CONSTRAINT "ToolReceipt_session_fk" FOREIGN KEY("sessionId","orgId","agentId") REFERENCES "Session"(id,"orgId","agentId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AgentLocalToolReceipt" ADD CONSTRAINT "ToolReceipt_item_fk" FOREIGN KEY("itemId","orgId") REFERENCES "ContextItem"(id,"orgId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AgentLocalToolReceipt" ADD CONSTRAINT "ToolReceipt_version_fk" FOREIGN KEY("versionId","orgId","itemId","versionNo") REFERENCES "ContextItemVersion"(id,"orgId","itemId",versao) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AgentLocalToolReceipt" ADD CONSTRAINT "ToolReceipt_step1_fk" FOREIGN KEY("passoPedidoId","orgId","sessionId") REFERENCES "SessionStep"(id,"orgId","sessionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AgentLocalToolReceipt" ADD CONSTRAINT "ToolReceipt_step2_fk" FOREIGN KEY("passoFinalId","orgId","sessionId") REFERENCES "SessionStep"(id,"orgId","sessionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- Audit/EventLog são conferidos no INSERT, sem FK durável que impeça expurgo posterior.
CREATE FUNCTION public.tool_local_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Recibo local imutável' USING ERRCODE='P0001'; END $$;
CREATE FUNCTION public.tool_local_namespace_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE req TEXT;
BEGIN
 IF TG_TABLE_NAME='Session' THEN
  IF NEW.canal::text<>'web' OR NEW."canalRef" IS NULL OR NEW."canalRef" NOT LIKE 'procedimento-local:%' THEN RETURN NEW; END IF;
  req=substring(NEW."canalRef" FROM length('procedimento-local:')+1);
 ELSE req=NEW."requestId"; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('procedimento:'||NEW."orgId"||':'||req));
 IF TG_TABLE_NAME='AgentLocalToolReceipt' THEN
  IF EXISTS (SELECT 1 FROM "AgentLocalOperation" WHERE "orgId"=NEW."orgId" AND "requestId"=req) THEN
   RAISE EXCEPTION 'Pedido pertence a outra causa' USING ERRCODE='P0001'; END IF;
 ELSIF TG_TABLE_NAME='AgentLocalOperation' THEN
  IF EXISTS (SELECT 1 FROM "AgentLocalToolReceipt" WHERE "orgId"=NEW."orgId" AND "requestId"=req) THEN
   RAISE EXCEPTION 'Pedido pertence a outra causa' USING ERRCODE='P0001'; END IF;
 ELSE
  IF EXISTS (SELECT 1 FROM "AgentLocalToolReceipt" WHERE "orgId"=NEW."orgId" AND "requestId"=req AND "sessionId"<>NEW.id) THEN
   RAISE EXCEPTION 'Pedido pertence a outra causa' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.tool_local_receipt_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s RECORD; p RECORD; f RECORD; sop RECORD; v RECORD; item RECORD; n BIGINT; payload JSONB;
BEGIN
 IF EXISTS (SELECT 1 FROM "AgentLocalOperation" WHERE "orgId"=NEW."orgId" AND "requestId"=NEW."requestId") THEN
  RAISE EXCEPTION 'Colisão de causa local' USING ERRCODE='P0001'; END IF;
 SELECT * INTO s FROM "Session" WHERE id=NEW."sessionId" AND "orgId"=NEW."orgId" AND "agentId"=NEW."agentId";
 SELECT * INTO p FROM "SessionStep" WHERE id=NEW."passoPedidoId" AND "orgId"=NEW."orgId" AND "sessionId"=NEW."sessionId";
 SELECT * INTO f FROM "SessionStep" WHERE id=NEW."passoFinalId" AND "orgId"=NEW."orgId" AND "sessionId"=NEW."sessionId";
 SELECT * INTO sop FROM "Sop" WHERE id=NEW."sopId" AND "orgId"=NEW."orgId" AND "agentId"=NEW."agentId";
 SELECT * INTO v FROM "ContextItemVersion" WHERE id=NEW."versionId" AND "orgId"=NEW."orgId" AND "itemId"=NEW."itemId" AND versao=NEW."versionNo";
 SELECT * INTO item FROM "ContextItem" WHERE id=NEW."itemId" AND "orgId"=NEW."orgId";
 IF s.id IS NULL OR p.id IS NULL OR f.id IS NULL OR sop.id IS NULL OR v.id IS NULL OR item.id IS NULL THEN
  RAISE EXCEPTION 'Vínculos locais incompletos' USING ERRCODE='P0001'; END IF;
 payload=jsonb_build_object('tipo','procedimento_ferramenta_local','entradaContrato',3,'receiptId',NEW.id,
   'requestId',NEW."requestId",'inputFingerprint',NEW."inputFingerprint");
 IF s.canal::text IS DISTINCT FROM 'web' OR s."canalRef" IS DISTINCT FROM 'procedimento-local:'||NEW."requestId"
  OR s."solicitanteId" IS DISTINCT FROM NEW."actorId" OR s.status::text IS DISTINCT FROM NEW.status
  OR s.pedido IS DISTINCT FROM 'Busca local literal em versão escolhida'
  OR s.resposta IS DISTINCT FROM 'Resultado disponível no procedimento de ferramenta local.' OR s.fontes IS DISTINCT FROM '[]'::jsonb
  OR s.provider IS NOT NULL OR s.modelo IS NOT NULL OR s."tokensIn"<>0 OR s."tokensOut"<>0 OR s.passos<>2 OR s."custoUsd"<>0
  OR p.ordem<>1 OR p.tipo::text<>'pedido' OR p.payload IS DISTINCT FROM payload OR p.args IS NOT NULL
  OR p.fontes IS DISTINCT FROM '[]'::jsonb OR p.texto IS NOT NULL
  OR f.ordem<>2 OR f.tipo::text IS DISTINCT FROM (CASE WHEN NEW.status='executada' THEN 'ferramenta' ELSE 'resultado' END)
  OR f.capacidade IS DISTINCT FROM (CASE WHEN NEW.status='executada' THEN 'contexto.memoria.buscar' ELSE NULL END)
  OR f."argsResumo" IS DISTINCT FROM 'Consulta literal local' OR f."resultadoResumo" IS DISTINCT FROM 'Recibo disponível no procedimento de ferramenta local.'
  OR f.payload IS DISTINCT FROM jsonb_build_object('receiptId',NEW.id,'resultado',COALESCE(NEW.resultado,'null'::jsonb))
  OR f.args IS DISTINCT FROM NEW.entrada OR f.fontes IS DISTINCT FROM '[]'::jsonb
  OR f.texto IS NOT NULL OR f."toolCallId" IS NOT NULL OR f.nivel IS NOT NULL OR f.decisao IS NOT NULL
  OR f."approvalId" IS NOT NULL OR f.provider IS NOT NULL OR f.modelo IS NOT NULL OR f."tokensIn" IS NOT NULL OR f."tokensOut" IS NOT NULL
  OR (SELECT count(*) FROM "SessionStep" WHERE "orgId"=NEW."orgId" AND "sessionId"=NEW."sessionId")<>2 THEN
  RAISE EXCEPTION 'Session/Steps não correspondem ao recibo local' USING ERRCODE='P0001'; END IF;
 IF item.versao IS DISTINCT FROM (NEW.entrada->>'expectedItemVersion')::integer OR item."arquivadoEm" IS NOT NULL
  OR item."sourceType" IS DISTINCT FROM v."sourceType" OR item."sourceRef" IS DISTINCT FROM v."sourceRef"
  OR octet_length(v.body)>262144
  OR NEW."sourceSnapshot"->>'chave' IS DISTINCT FROM item.chave
  OR NEW."sourceSnapshot"->>'colecao' IS DISTINCT FROM (CASE WHEN v."sourceType"::text='vault' THEN 'vault_canonica' ELSE 'manual_local' END)
  OR NEW."toolConfigHash" IS DISTINCT FROM encode(sha256(convert_to(public.tool_local_config_text(sop."ferramentaLocal"),'UTF8')),'hex')
  OR sop.versao IS DISTINCT FROM NEW."sopVersion" OR NEW."sopSnapshot" IS DISTINCT FROM jsonb_build_object('id',sop.id,
  'versao',sop.versao,'proposito',sop.proposito,'gatilho',sop.gatilho,'passos',to_jsonb(sop.passos),
  'definicaoDePronto',sop."definicaoDePronto",'observacoes',sop.observacoes,'ferramentaLocal',sop."ferramentaLocal",'configHash',NEW."toolConfigHash")
  OR v."contentHash" IS DISTINCT FROM NEW."contentHash" OR v.title IS DISTINCT FROM NEW."sourceSnapshot"->>'title'
  OR v."sourceType"::text IS DISTINCT FROM NEW."sourceSnapshot"->>'sourceType'
  OR v."sourceRef" IS DISTINCT FROM NEW."sourceSnapshot"->>'sourceRef'
  OR NEW.receipt->>'criadaEm' IS DISTINCT FROM to_char(NEW."criadaEm",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR NEW.receipt->>'encerradaEm' IS DISTINCT FROM to_char(NEW."encerradaEm",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN
  RAISE EXCEPTION 'Snapshot local divergente' USING ERRCODE='P0001'; END IF;
 SELECT count(*) INTO n FROM unnest(NEW."auditIds") a(id) LEFT JOIN "AuditLog" l ON l.id=a.id
  AND l."orgId"=NEW."orgId" AND l."actorId"=NEW."actorId"
  AND l.action='agent.procedimento_ferramenta_local' AND l."entityType"='session' AND l."entityId"=NEW."sessionId"
  WHERE l.id IS NULL;
 IF n<>0 OR cardinality(NEW."auditIds")<>(SELECT count(DISTINCT a) FROM unnest(NEW."auditIds") a) THEN
  RAISE EXCEPTION 'Auditorias locais reais ausentes' USING ERRCODE='P0001'; END IF;
 IF NEW.status='executada' AND NOT COALESCE(NEW.resultado->>'modo'=NEW.modo
  AND NEW.resultado->>'itemId'=NEW."itemId" AND NEW.resultado->>'versionId'=NEW."versionId"
  AND NEW.resultado->'versao'=to_jsonb(NEW."versionNo") AND NEW.resultado->>'contentHash'=NEW."contentHash"
  AND NEW.resultado->'q'=NEW.entrada->'q' AND NEW.resultado->'limit'=NEW.entrada->'limit',false) THEN
  RAISE EXCEPTION 'Resultado não pertence à fonte/pedido' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ToolReceipt_append_only" BEFORE UPDATE OR DELETE ON "AgentLocalToolReceipt" FOR EACH ROW EXECUTE FUNCTION public.tool_local_append_only();
CREATE TRIGGER "ToolReceipt_namespace" BEFORE INSERT ON "AgentLocalToolReceipt" FOR EACH ROW EXECUTE FUNCTION public.tool_local_namespace_guard();
CREATE TRIGGER "Operation_tool_namespace" BEFORE INSERT ON "AgentLocalOperation" FOR EACH ROW EXECUTE FUNCTION public.tool_local_namespace_guard();
CREATE TRIGGER "Session_tool_namespace" BEFORE INSERT OR UPDATE OF "orgId",canal,"canalRef" ON "Session" FOR EACH ROW EXECUTE FUNCTION public.tool_local_namespace_guard();
CREATE CONSTRAINT TRIGGER "ToolReceipt_commit" AFTER INSERT ON "AgentLocalToolReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.tool_local_receipt_commit();
ALTER TABLE "AgentLocalToolReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentLocalToolReceipt" FORCE ROW LEVEL SECURITY;
SELECT public.app_rls_aplicar_policies('AgentLocalToolReceipt','public.app_org_resolvida() AND "orgId"=public.app_org_atual()',
 'public.app_org_resolvida() AND "orgId"=public.app_org_atual()',true,false,false);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mktos_app') THEN
 GRANT SELECT,INSERT ON "AgentLocalToolReceipt" TO mktos_app;
END IF; END $$;
-- Adendo documental02b. Em uma aplicação futura, compõe a mesma migração02 antes do COMMIT.
-- Substitui somente o guard de namespace proposto; não é SQL aplicado.
CREATE OR REPLACE FUNCTION public.tool_local_namespace_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE req TEXT; r RECORD;
BEGIN
 IF TG_TABLE_NAME='Session' THEN
  SELECT * INTO r FROM "AgentLocalToolReceipt" WHERE "sessionId"=NEW.id;
  IF r.id IS NOT NULL AND (NEW.canal::text IS DISTINCT FROM 'web'
   OR NEW."canalRef" IS DISTINCT FROM 'procedimento-local:'||r."requestId"
   OR NEW."agentId" IS DISTINCT FROM r."agentId" OR NEW."solicitanteId" IS DISTINCT FROM r."actorId") THEN
   RAISE EXCEPTION 'Identidade da causa local imutável' USING ERRCODE='P0001'; END IF;
  IF NEW.canal::text<>'web' OR NEW."canalRef" IS NULL OR NEW."canalRef" NOT LIKE 'procedimento-local:%' THEN RETURN NEW; END IF;
  req=substring(NEW."canalRef" FROM length('procedimento-local:')+1);
 ELSE req=NEW."requestId"; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('procedimento:'||NEW."orgId"||':'||req));
 IF TG_TABLE_NAME='AgentLocalToolReceipt' THEN
  IF EXISTS (SELECT 1 FROM "AgentLocalOperation" WHERE "orgId"=NEW."orgId" AND "requestId"=req) THEN
   RAISE EXCEPTION 'Pedido pertence a outra causa' USING ERRCODE='P0001'; END IF;
 ELSIF TG_TABLE_NAME='AgentLocalOperation' THEN
  IF EXISTS (SELECT 1 FROM "AgentLocalToolReceipt" WHERE "orgId"=NEW."orgId" AND "requestId"=req) THEN
   RAISE EXCEPTION 'Pedido pertence a outra causa' USING ERRCODE='P0001'; END IF;
 ELSE
  IF EXISTS (SELECT 1 FROM "AgentLocalToolReceipt" WHERE "orgId"=NEW."orgId" AND "requestId"=req AND "sessionId"<>NEW.id) THEN
   RAISE EXCEPTION 'Pedido pertence a outra causa' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NEW;
END $$;
-- Ampliar somente a lista de colunas do trigger proposto para os campos da identidade da causa.
DROP TRIGGER "Session_tool_namespace" ON "Session";
CREATE TRIGGER "Session_tool_namespace" BEFORE INSERT OR UPDATE OF "orgId",canal,"canalRef","agentId","solicitanteId"
 ON "Session" FOR EACH ROW EXECUTE FUNCTION public.tool_local_namespace_guard();

-- Elegibilidade nominativa; um rótulo manual_local não autoriza o scanner.
CREATE FUNCTION public.tool_local_origin_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v RECORD; c RECORD; ultima RECORD; membro RECORD;
BEGIN
 SELECT * INTO v FROM "ContextItemVersion" WHERE id=NEW."versionId" AND "orgId"=NEW."orgId" AND "itemId"=NEW."itemId" AND versao=NEW."versionNo";
 SELECT * INTO c FROM "ContextItem" WHERE id=NEW."itemId" AND "orgId"=NEW."orgId";
 IF v.id IS NULL OR c.id IS NULL OR v."sourceType" IS DISTINCT FROM c."sourceType" OR v."sourceRef" IS DISTINCT FROM c."sourceRef"
  OR c.versao IS DISTINCT FROM (SELECT max(versao) FROM "ContextItemVersion" WHERE "orgId"=NEW."orgId" AND "itemId"=c.id)
  OR c.versao IS DISTINCT FROM (SELECT count(*)::int FROM "ContextItemVersion" WHERE "orgId"=NEW."orgId" AND "itemId"=c.id)
  OR EXISTS (SELECT 1 FROM "ContextMovementIntent" i WHERE i."orgId"=NEW."orgId" AND i.estado='pendente'
   AND (i."itemId"=c.id OR i."collectionId"='vault:root-base' AND (c."sourceType"::text='vault' OR c.chave LIKE 'vault:%'))) THEN
  RAISE EXCEPTION 'Fonte local indisponível' USING ERRCODE='23514'; END IF;
 IF v."sourceType"::text='operador' THEN
  IF v."autorTipo" IS DISTINCT FROM 'user' OR v."autorId" IS NULL
   OR NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id=v."autorId" AND u."orgId"=NEW."orgId")
   OR lower(btrim(c.chave)) ~ '^(vault:|drive:|clickup:|conector:)'
   OR NOT (v."sourceRef" IS NULL OR EXISTS (SELECT 1 FROM unnest(ARRAY['negocio','cliente-ideal','oferta-e-preco','numeros-que-importam','vocabulario','regras-da-casa','canais','decisao-recente']) t(id)
    WHERE c.chave='onboarding:'||t.id AND v."sourceRef"='carregador-de-contexto:'||t.id)) THEN
   RAISE EXCEPTION 'Origem manual local não comprovada' USING ERRCODE='23514'; END IF;
 ELSIF v."sourceType"::text='vault' THEN
  IF NOT EXISTS (SELECT 1 FROM "Org" o WHERE o.id=NEW."orgId" AND o.slug='root') OR v."sourceRef" IS NULL
   OR c.chave IS DISTINCT FROM 'vault:'||normalize(v."sourceRef",NFC) THEN
   RAISE EXCEPTION 'Coleção local não comprovada' USING ERRCODE='23514'; END IF;
  SELECT * INTO ultima FROM "ContextCollectionSelection" WHERE "orgId"=NEW."orgId" AND "collectionId"='vault:root-base' ORDER BY generation DESC LIMIT 1;
  IF ultima.id IS NULL OR ultima.estado IS DISTINCT FROM 'projetado' OR ultima."sourceKind" IS DISTINCT FROM 'vault_pasta'
   OR ultima."marcaAntes" IS DISTINCT FROM ultima."marcaDepois" OR ultima."membershipDigest" IS NULL
   OR ultima."membershipDigest" !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Captura local corrente indisponível' USING ERRCODE='23514'; END IF;
  SELECT m.* INTO membro FROM "ContextCollectionMember" m JOIN "ContextItemVersion" cv ON cv.id=m."versionId"
   AND cv."orgId"=m."orgId" AND cv."itemId"=m."itemId" AND cv.versao=m.versao
   WHERE m."selectionId"=ultima.id AND m."orgId"=NEW."orgId" AND m."itemId"=c.id AND m.versao=c.versao AND m.estado='projetado'
    AND m.chave=c.chave AND m."contentHash"=c."contentHash" AND cv."contentHash"=c."contentHash"
    AND cv."sourceType"=c."sourceType" AND cv."sourceRef" IS NOT DISTINCT FROM c."sourceRef"
    AND cv.title=c.title AND cv.kind=c.kind;
  IF membro.id IS NULL OR membro.metadata->>'sourceRef' IS DISTINCT FROM c."sourceRef" OR membro.metadata->>'title' IS DISTINCT FROM c.title
   OR membro.metadata->>'kind' IS DISTINCT FROM c.kind::text OR membro.metadata->'tags' IS DISTINCT FROM to_jsonb(c.tags)
   OR membro.metadata->>'validFrom' IS DISTINCT FROM (CASE WHEN c."validFrom" IS NULL THEN NULL ELSE to_char(c."validFrom",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END)
   OR membro.metadata->>'validUntil' IS DISTINCT FROM (CASE WHEN c."validUntil" IS NULL THEN NULL ELSE to_char(c."validUntil",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END) THEN
   RAISE EXCEPTION 'Captura local corrente divergente' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "ContextCollectionMember" m JOIN "ContextCollectionSelection" s ON s.id=m."selectionId" AND s."orgId"=m."orgId"
   WHERE m."orgId"=NEW."orgId" AND m."itemId"=v."itemId" AND m."versionId"=v.id AND m.versao=v.versao AND m.estado='projetado'
    AND s."collectionId"='vault:root-base' AND s."sourceKind"='vault_pasta' AND s.estado='projetado' AND s."marcaAntes"=s."marcaDepois"
    AND s."membershipDigest" ~ '^[a-f0-9]{64}$' AND m.chave='vault:'||normalize(v."sourceRef",NFC)
    AND convert_from(m."caminhoBytes",'UTF8')=v."sourceRef" AND convert_to(convert_from(m."caminhoBytes",'UTF8'),'UTF8')=m."caminhoBytes"
    AND convert_from(m."caminhoBytes",'UTF8')=normalize(convert_from(m."caminhoBytes",'UTF8'),NFC)
    AND m."blobGit" ~ '^[a-f0-9]{40}$' AND m."hashArquivo" ~ '^[a-f0-9]{64}$' AND m."metadataHash" ~ '^[a-f0-9]{64}$'
    AND m."contentHash"=v."contentHash" AND m.metadata->>'sourceRef'=v."sourceRef" AND m.metadata->>'title'=v.title AND m.metadata->>'kind'=v.kind::text) THEN
   RAISE EXCEPTION 'Versão local sem vínculo físico' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Origem não elegível à ferramenta local' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "ToolReceipt_local_origin" AFTER INSERT ON "AgentLocalToolReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.tool_local_origin_commit();
COMMIT;
