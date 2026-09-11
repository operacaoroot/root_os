-- ============================================================================
-- O EXPURGO REGISTRA A SI MESMO, DE DENTRO DA TRANSAÇÃO QUE APAGA (RF-R-06)
--
-- MIGRAÇÃO NOVA, E NÃO EDIÇÃO DA ANTERIOR. A migration
-- `20260911060000_rastro_retencao_e_expurgo` já foi APLICADA (em
-- `marketing_os`, `marketing_os_test` e `marketing_os_test_rls`), e o banco
-- guarda o resumo do arquivo: editá-la faria o banco continuar com o SQL velho
-- enquanto o arquivo mostraria o novo. Isso já custou uma investigação inteira
-- na onda 5. Migration aplicada é imutável; erro se conserta assim, com
-- substituição declarada.
--
-- ----------------------------------------------------------------------------
-- O QUE MUDA, E POR QUÊ
-- ----------------------------------------------------------------------------
--
-- 1. O EVENTO DO EXPURGO PASSA A NASCER AQUI DENTRO.
--    Antes: a função apagava, devolvia a faixa, e o serviço em Node escrevia o
--    evento `rastro.expurgo` DEPOIS, em outra transação e SEM proteção contra
--    erro. Qualquer soluço entre uma coisa e outra — conexão caída, processo
--    morto, o `registrar()` estourando — deixava a lacuna de `seq` SEM
--    EXPLICAÇÃO, e uma lacuna sem explicação é indistinguível de adulteração
--    para quem verificar a cadeia depois. Pior: o erro abortava a varredura
--    inteira, e a varredura seguinte NÃO conserta (ela é idempotente — não acha
--    mais o que apagar, então não tem o que registrar).
--
--    "Aceitar o risco porque a janela é pequena" não era mitigação, era
--    aceitação. O conserto barato é este: a função já conhece a faixa e já
--    segura o ACCESS EXCLUSIVE da tabela. O DELETE e o INSERT do evento passam a
--    ser a MESMA transação — ou os dois acontecem, ou nenhum dos dois.
--
-- 2. O CORTE GANHA PISO DENTRO DA FUNÇÃO.
--    A versão anterior confiava na policy `tenant_expurgo_retencao` para o piso
--    (`retencaoAte < now()`). Só que na implantação de hoje o dono das tabelas
--    (`mkt`) é SUPERUSUÁRIO e atravessa policy: a policy fica inerte, e o único
--    filtro que sobra é o da própria função, que usa a data que o chamador
--    mandar. Com uma data no FUTURO, a função apagava linha NÃO VENCIDA.
--    Agora o piso é `LEAST(p_corte, now())`, dentro da função, e não depende de
--    política nenhuma estar valendo.
--
-- 3. A FUNÇÃO PASSA A RECEBER O PRAZO (`p_dias`).
--    O evento precisa dizer sob qual retenção ele apagou, e esse número é
--    herança (a política) ou linha própria (`RastroRetencao`) — regra que mora
--    no serviço. Em vez de reimplementar a herança em plpgsql, ele entra como
--    parâmetro. É por isso que a assinatura muda e a antiga é DERRUBADA: deixar
--    as duas vivas convidaria alguém a chamar a de dois argumentos, que não
--    registra nada.
--
-- O QUE NÃO MUDA: a policy `tenant_expurgo_retencao` continua exatamente como
-- foi criada (ela está declarada, com a expressão literal, em
-- `apps/api/test/tenant-isolation.test.ts`, que é arquivo de outra fatia). As
-- RULEs de append-only, os REVOKE do papel e a exigência de ser DONO também
-- continuam iguais.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. JSON CANÔNICO — o mesmo que `canonizar()` em event-log.service.ts
--
-- A cadeia do RASTRO é sha256 sobre um corpo que termina no payload
-- SERIALIZADO DE FORMA ESTÁVEL. Para o evento nascer aqui dentro e ainda fechar
-- a cadeia quando o Node for verificá-la, os dois lados precisam produzir
-- exatamente o mesmo texto.
--
-- POR QUE NÃO `jsonb::text`: o jsonb do PostgreSQL ordena as chaves por
-- TAMANHO primeiro e só depois por bytes. O `Object.keys().sort()` do
-- JavaScript ordena só por código. `{"b":1,"aa":2}` sai `{"b": 1, "aa": 2}` no
-- jsonb e `{"aa":2,"b":1}` no JS — e o jsonb ainda põe espaço depois dos dois
-- pontos. Daí a recursão explícita.
--
-- LIMITE CONHECIDO: a igualdade entre `ORDER BY ... COLLATE "C"` (bytes) e o
-- `sort()` do JavaScript (unidades UTF-16) vale para chave ASCII, que é o caso
-- de todo payload que este banco escreve. Chave com acento poderia divergir.
-- Quem prova que os dois lados concordam NÃO é este comentário: é o caso "a
-- cadeia continua íntegra depois do expurgo" de `rastro-retencao.test.ts`, que
-- manda o verificador do Node conferir a linha escrita por esta função.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_json_canonico(v jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  chave  text;
  item   jsonb;
  partes text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(v) = 'null' THEN
    RETURN 'null';
  END IF;

  IF jsonb_typeof(v) = 'object' THEN
    FOR chave IN SELECT k FROM jsonb_object_keys(v) AS t(k) ORDER BY k COLLATE "C" LOOP
      partes := array_append(partes, to_jsonb(chave)::text || ':' || app_json_canonico(v -> chave));
    END LOOP;
    RETURN '{' || array_to_string(partes, ',') || '}';
  END IF;

  IF jsonb_typeof(v) = 'array' THEN
    FOR item IN SELECT e FROM jsonb_array_elements(v) AS t(e) LOOP
      partes := array_append(partes, app_json_canonico(item));
    END LOOP;
    RETURN '[' || array_to_string(partes, ',') || ']';
  END IF;

  -- string, número, booleano: o próprio texto do jsonb já é JSON válido e
  -- idêntico ao que `JSON.stringify` produz para os valores que escrevemos.
  RETURN v::text;
END $$;

COMMENT ON FUNCTION app_json_canonico(jsonb) IS
  'JSON canonico (chaves ordenadas em TODOS os niveis, sem espacos) — o par em SQL de canonizar() em gateway/event-log.service.ts. Serve a cadeia de hash do RASTRO.';

-- ---------------------------------------------------------------------------
-- 2. FORA A ASSINATURA ANTIGA
--
-- Ela não registrava o evento e aceitava corte no futuro. Mantê-la viva ao lado
-- da nova seria deixar o caminho errado à mão de quem não leu isto aqui.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS app_rastro_expurgar(text, timestamptz);

-- ---------------------------------------------------------------------------
-- 3. O EXPURGO, QUE AGORA APAGA E REGISTRA NA MESMA TRANSAÇÃO
--
-- Continua valendo tudo o que a migration anterior estabeleceu:
--   · `ALTER TABLE ... DISABLE RULE` exige ser DONO — o papel da aplicação
--     recebe "must be owner of table EventLog";
--   · o EXECUTE é revogado de PUBLIC e do papel;
--   · a empresa pedida TEM de ser a da sessão, e sessão sem empresa recusa;
--   · o evento `rastro.expurgo` nunca é apagado (está no DELETE e na policy).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_rastro_expurgar(p_org text, p_corte timestamptz, p_dias int)
RETURNS TABLE (apagados bigint, seq_de bigint, seq_ate bigint, evento_id text)
LANGUAGE plpgsql AS $$
DECLARE
  v_corte   timestamptz;
  v_de      bigint;
  v_ate     bigint;
  n         bigint := 0;
  v_seq     bigint;
  v_prev    text;
  v_agora   timestamp(3);
  v_payload jsonb;
  v_corpo   text;
  v_hash    text;
  v_id      text;
BEGIN
  IF NOT public.app_org_resolvida() THEN
    RAISE EXCEPTION
      'app_rastro_expurgar: sessao sem empresa resolvida. O expurgo varre empresa por empresa, dentro do contexto de cada uma (RF-T-04).';
  END IF;

  IF p_org IS DISTINCT FROM public.app_org_atual() THEN
    RAISE EXCEPTION
      'app_rastro_expurgar: pediram a empresa "%" com a sessao em "%". Uma empresa nao expurga o rastro de outra.',
      p_org, public.app_org_atual();
  END IF;

  IF p_dias IS NULL OR p_dias < 1 THEN
    RAISE EXCEPTION
      'app_rastro_expurgar: p_dias invalido (%). O evento do expurgo precisa dizer sob qual retencao ele apagou.', p_dias;
  END IF;

  -- O PISO, DENTRO DA FUNÇÃO. Onde a aplicacao roda hoje o dono das tabelas e
  -- superusuario e atravessa a policy `tenant_expurgo_retencao`: confiar nela
  -- para barrar corte no futuro seria confiar em algo inerte. Um corte adiantado
  -- nao apaga linha que ainda nao venceu — ele so encolhe a janela.
  v_corte := LEAST(p_corte, now());

  -- O `ALTER TABLE` abaixo pega ACCESS EXCLUSIVE em `EventLog` e o segura até o
  -- commit: ele espera toda escrita em curso terminar. Sem tempo limite, um
  -- expurgo agendado penduraria o RASTRO da instância inteira atrás da consulta
  -- mais longa. Com ele, o pior caso é o expurgo falhar com 55P03 e ser
  -- repetido — e repetir é barato, porque o corte é idempotente.
  PERFORM set_config('lock_timeout', '5s', true);

  -- Serializa a cauda desta empresa, como faz `EventLogService.registrar`. O
  -- ACCESS EXCLUSIVE ja bloqueia qualquer escritor; o lock aqui e a mesma
  -- disciplina escrita duas vezes, e custa nada.
  PERFORM pg_advisory_xact_lock(hashtext(p_org));

  -- A faixa apagada, ANTES de apagar: é ela que explica o buraco de `seq` para
  -- quem for verificar a cadeia depois.
  SELECT min("seq"), max("seq") INTO v_de, v_ate
    FROM "EventLog"
   WHERE "orgId" = p_org AND "retencaoAte" < v_corte AND "tipo" <> 'rastro.expurgo';

  IF v_de IS NULL THEN
    RETURN QUERY SELECT 0::bigint, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;

  ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete;

  DELETE FROM "EventLog"
   WHERE "orgId" = p_org AND "retencaoAte" < v_corte AND "tipo" <> 'rastro.expurgo';
  GET DIAGNOSTICS n = ROW_COUNT;

  ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete;

  -- ------------------------------------------------------------------------
  -- O EVENTO, na mesma transação. A partir daqui nada pode "dar errado depois":
  -- se o INSERT falhar, o DELETE volta atrás junto e o rastro fica como estava.
  -- ------------------------------------------------------------------------

  -- `greatest(..., v_ate)` para o `seq` NUNCA SER REUSADO. Quando o expurgo leva
  -- a cabeca inteira, o maior `seq` que sobrou pode ser menor do que o maior que
  -- saiu; comecar de novo por cima de numero ja usado faria a faixa declarada no
  -- evento se sobrepor a linhas vivas, e a explicacao do buraco deixaria de
  -- fazer sentido.
  SELECT greatest(coalesce(max("seq"), 0), v_ate) + 1 INTO v_seq
    FROM "EventLog" WHERE "orgId" = p_org;

  SELECT "hash" INTO v_prev
    FROM "EventLog" WHERE "orgId" = p_org ORDER BY "seq" DESC LIMIT 1;

  v_agora := (now() AT TIME ZONE 'UTC')::timestamp(3);
  v_id := gen_random_uuid()::text;

  -- O MESMO VOCABULÁRIO do `ConteudoDoEvento` do Node, campo por campo. `rastro`
  -- com `conferido: false` porque a politica nao tem capacidade para "expurgar
  -- rastro por retencao" e inventar um degrau aqui seria escrever regua no lugar
  -- errado (esta registrado como pergunta no relatorio da fatia).
  v_payload := jsonb_build_object(
    'motivo', format('retenção de %s dias configurada para esta empresa', p_dias),
    'argumentos', jsonb_build_object(
      'corte', to_char(v_corte AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'diasDeRetencao', p_dias
    ),
    'resultado', jsonb_build_object(
      'apagados', n,
      'seqDe', v_de::text,
      'seqAte', v_ate::text
    ),
    'estadoAnterior', jsonb_build_object('primeiroSeqAntes', v_de::text),
    'estadoNovo', jsonb_build_object('primeiroSeqAgora', (v_ate + 1)::text),
    'fontes', jsonb_build_array(
      jsonb_build_object('tipo', 'retencao', 'origem', 'RastroRetencao ou politica.retencao.rastroDias')
    ),
    'custo', jsonb_build_object('centavos', 0),
    'rastro', jsonb_build_object('nivel', NULL, 'conferido', false)
  );

  -- O corpo da cadeia, na MESMA ordem e com o MESMO separador de
  -- `EventLogService.corpoDaCadeia`. `capabilityId` e `contentHash` sao vazios
  -- aqui porque o expurgo nao tem capacidade nem conteudo aprovado.
  v_corpo :=
    coalesce(v_prev, '') || '|' ||
    p_org || '|' ||
    v_seq::text || '|' ||
    'rastro.expurgo' || '|' ||
    '' || '|' ||
    '' || '|' ||
    to_char(v_agora, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
    app_json_canonico(v_payload);

  v_hash := encode(sha256(convert_to(v_corpo, 'UTF8')), 'hex');

  INSERT INTO "EventLog" (
    "id", "orgId", "seq", "tipo", "actorType", "actorId", "agentSlug",
    "capabilityId", "toolCallId", "decisionId", "nivel", "correlationId",
    "payload", "contentHash", "prevHash", "hash", "retencaoAte", "ocorreuEm"
  ) VALUES (
    v_id, p_org, v_seq, 'rastro.expurgo', 'system', NULL, NULL,
    NULL, NULL, NULL, NULL, NULL,
    v_payload, NULL, v_prev, v_hash,
    -- Perene: o expurgo seguinte nao o alcanca. E a segunda garantia, a que nao
    -- depende desta, esta no `tipo <> 'rastro.expurgo'` do DELETE e da policy.
    '9999-12-31 23:59:59.000'::timestamp, v_agora
  );

  RETURN QUERY SELECT n, v_de, v_ate, v_id;
END $$;

COMMENT ON FUNCTION app_rastro_expurgar(text, timestamptz, int) IS
  'Unico caminho por onde linha do RASTRO sai do banco. Apaga E registra o evento rastro.expurgo na MESMA transacao. Exige ser DONO da tabela (ALTER TABLE ... DISABLE RULE). Uma empresa por vez, dentro do contexto dela, corte com piso em now(), e nunca o evento do proprio expurgo.';

-- De PUBLIC primeiro (é de lá que o `CREATE FUNCTION` concede por padrão), do
-- papel depois (por causa do `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON
-- FUNCTIONS`, que é concessão nominal e reconcederia sozinho).
REVOKE EXECUTE ON FUNCTION app_rastro_expurgar(text, timestamptz, int) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION app_rastro_expurgar(text, timestamptz, int) FROM mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. CONFERÊNCIA — falha alta, como a da migration anterior
--
-- Migration que aplica pela metade em silêncio é pior do que migration que não
-- aplica (09-PADRÕES §3.4).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  problemas text[] := ARRAY[]::text[];
  canonico  text;
BEGIN
  -- 4.1 A assinatura antiga sumiu e a nova está no lugar.
  --
  -- `to_regprocedure` e nao `pg_get_function_identity_arguments`: aquela funcao
  -- devolve os NOMES dos parametros junto ('p_org text, p_corte ...'), entao a
  -- comparacao por tipo nunca casava e esta conferencia reprovava a propria
  -- migration. Medido em `prova_35` em 11/09/2026.
  IF to_regprocedure('public.app_rastro_expurgar(text, timestamptz)') IS NOT NULL THEN
    problemas := array_append(problemas,
      'a assinatura antiga de app_rastro_expurgar(text, timestamptz) continua viva — ela apaga sem registrar');
  END IF;
  IF to_regprocedure('public.app_rastro_expurgar(text, timestamptz, int)') IS NULL THEN
    problemas := array_append(problemas, 'app_rastro_expurgar(text, timestamptz, int) nao foi criada');
  END IF;

  -- 4.2 O canonizador concorda com o do Node no caso que reprovou a fórmula
  --     antiga: chave fora de ordem, e um objeto ANINHADO que precisa entrar.
  canonico := app_json_canonico('{"b":{"y":2,"x":1},"a":"z"}'::jsonb);
  IF canonico IS DISTINCT FROM '{"a":"z","b":{"x":1,"y":2}}' THEN
    problemas := array_append(problemas,
      'app_json_canonico devolveu ' || coalesce(canonico, '<null>') ||
      ' — a cadeia escrita pelo banco nao fecharia com a verificacao do Node');
  END IF;

  -- 4.3 As RULEs de append-only continuam ligadas depois de tudo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class
     WHERE c.relname = 'EventLog' AND r.rulename = 'eventlog_sem_delete' AND r.ev_enabled = 'O'
  ) THEN
    problemas := array_append(problemas,
      'eventlog_sem_delete desligada ao fim da migration — o RASTRO ficaria apagavel por qualquer DELETE');
  END IF;

  -- 4.4 A policy do expurgo continua de pé, com a expressão que a suíte de
  --     isolamento declara. Esta migration NÃO a toca; a conferência existe para
  --     o caso de alguém "arrumar" uma coisa e derrubar a outra.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'EventLog' AND p.polname = 'tenant_expurgo_retencao'
  ) THEN
    problemas := array_append(problemas, 'a policy tenant_expurgo_retencao sumiu de EventLog');
  END IF;

  -- 4.5 O papel da aplicação continua SEM poder apagar o RASTRO nem chamar o
  --     expurgo — na assinatura nova, que é a que passou a existir.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    IF has_table_privilege('mktos_app', '"EventLog"', 'DELETE') THEN
      problemas := array_append(problemas,
        'mktos_app tem DELETE em EventLog — o REVOKE das migrations anteriores foi desfeito');
    END IF;
    IF has_function_privilege('mktos_app', 'app_rastro_expurgar(text, timestamptz, int)', 'EXECUTE') THEN
      problemas := array_append(problemas,
        'mktos_app pode EXECUTE em app_rastro_expurgar — o expurgo ficou ao alcance da aplicacao');
    END IF;
  END IF;

  IF array_length(problemas, 1) > 0 THEN
    RAISE EXCEPTION 'expurgo que se registra aplicado pela metade: %', array_to_string(problemas, '; ');
  END IF;
END $$;
