-- ============================================================================
-- RETENÇÃO DO RASTRO POR EMPRESA E O EXPURGO QUE SE REGISTRA (RF-R-06)
--
-- Duas coisas, e a segunda é uma contradição resolvida:
--
--   1. `RastroRetencao` — o prazo de guarda deixa de ser uma variável de
--      ambiente global (`RASTRO_RETENCAO_DIAS=1825` no docker-compose) e passa
--      a ser configuração DE CADA EMPRESA. Tabela de empresa, então nasce com
--      isolamento por linha ligado, modo forçado e as duas políticas.
--
--   2. `app_rastro_expurgar()` — o único caminho por onde uma linha do RASTRO
--      sai do banco.
--
-- ----------------------------------------------------------------------------
-- A CONTRADIÇÃO: "NUNCA APAGAR EVENTO DO RASTRO" × "RETENÇÃO TEM DE APAGAR"
-- ----------------------------------------------------------------------------
-- O RASTRO é append-only por três barreiras já existentes, e nenhuma delas é
-- comentário:
--
--   · `REVOKE UPDATE, DELETE, TRUNCATE ON "EventLog" FROM mktos_app`
--     (20260829161052 e de novo em 20260911020000) — o papel da APLICAÇÃO não
--     tem o privilégio. É a barreira de fora.
--   · as RULEs `eventlog_sem_update` / `eventlog_sem_delete`, que são
--     `DO INSTEAD NOTHING` e valem INCLUSIVE PARA O DONO: um DELETE chega ao
--     banco e é reescrito para nada. Medido em 11/09/2026 no banco `prova_35`:
--     `DELETE FROM "EventLog" WHERE id='e1'` devolveu `DELETE 0` e a linha
--     continuou lá.
--   · a ausência de policy de UPDATE e de DELETE (20260911050000, seção 3.6).
--
-- O expurgo por retenção precisa furar as três. A pergunta não é COMO furar —
-- é como furar sem deixar o buraco aberto para o dia a dia. A resposta tem
-- quatro partes:
--
--   a. O DELETE só existe DENTRO desta função, e a função começa com
--      `ALTER TABLE ... DISABLE RULE`, que **exige ser dono da tabela**. O papel
--      da aplicação (`mktos_app`) não é dono: chamá-la devolve "must be owner of
--      table". É exatamente a proteção que `app_rls_desligar()` já usa, e que a
--      suíte de isolamento já mede naquele caso ("o papel restrito NÃO consegue
--      desligar o próprio isolamento"). Nenhuma rota HTTP chama isto; quem chama
--      é um processo de manutenção com a conexão DONA.
--      Medido em `prova_35`: com o EXECUTE concedido À FORÇA a `mktos_app` e uma
--      linha vencida à espera, a chamada morre em
--      `ERROR: must be owner of table EventLog`, no `DISABLE RULE`, e a linha
--      continua lá. A barreira (a) não depende da barreira (b).
--   b. O EXECUTE é revogado de PUBLIC e do papel. Sem isso a função nasceria
--      chamável por qualquer um — `CREATE FUNCTION` concede EXECUTE a PUBLIC por
--      padrão, e a migration do papel ainda deixou um
--      `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO mktos_app`,
--      que é concessão NOMINAL e precisa de um REVOKE próprio.
--   c. A janela em que a RULE fica desligada é protegida pelo BLOQUEIO que o
--      próprio `ALTER TABLE` pega (ACCESS EXCLUSIVE, segurado até o commit):
--      enquanto ela existe, nenhuma outra sessão escreve nem lê `EventLog`. E
--      DDL no PostgreSQL é transacional — erro no meio desfaz o desligamento
--      junto com tudo. A RULE não tem como "ficar desligada" por acidente.
--   d. O que a função consegue apagar é limitado pela policy `tenant_expurgo_retencao`
--      abaixo, e ela não fala em "quem chamou": fala em PRAZO. Só linha da
--      empresa da sessão, só linha cujo `retencaoAte` já passou, e nunca o
--      evento do próprio expurgo.
--
-- POR QUE EXISTE UMA POLICY DE DELETE NUMA TABELA APPEND-ONLY — e por que ela
-- não afrouxa nada. Sem policy de DELETE, o expurgo funcionaria HOJE (o dono
-- `mkt` é superusuário na imagem `pgvector/pgvector:pg16` e atravessa policy) e
-- DEIXARIA DE FUNCIONAR, em silêncio, num Postgres gerenciado onde o dono não é
-- superusuário — `FORCE ROW LEVEL SECURITY` passaria a valer para ele, o DELETE
-- devolveria zero linha e a obrigação de retenção estaria quebrada sem nenhum
-- erro. Silêncio é o pior desfecho (09-PADRÕES §3.4).
--
-- NÃO É RACIOCÍNIO, É MEDIÇÃO (11/09/2026, banco `prova_35`): um papel
-- `NOSUPERUSER NOBYPASSRLS` feito dono de `EventLog` chamou esta função com uma
-- linha vencida à espera. COM a policy: `apagados = 1`. Sem ela, depois de um
-- `DROP POLICY`: `apagados = 0` — e a função ainda devolvia `seq_de = 9`,
-- provando que a linha estava lá e não saiu. Exatamente a falha muda que a
-- policy existe para impedir.
--
-- Com a policy, o mesmo comando se comporta igual nos dois ambientes, e o que
-- ela permite é MENOS do que o superusuário já podia: linha vencida, da própria
-- empresa, que não seja o registro do expurgo. Para a aplicação nada muda — ela
-- esbarra no REVOKE de privilégio antes de a policy ser sequer consultada.
--
-- ----------------------------------------------------------------------------
-- O EVENTO DO EXPURGO NÃO É EXPURGÁVEL
-- ----------------------------------------------------------------------------
-- Apagar por retenção é, ele mesmo, um evento (`rastro.expurgo`). Se o expurgo
-- seguinte pudesse apagá-lo, o RASTRO perderia a memória de ter esquecido — e
-- uma lacuna sem explicação na cadeia é indistinguível de adulteração.
--
-- Duas garantias independentes, de propósito:
--   · aqui, no banco: `tipo <> 'rastro.expurgo'` está na policy E no DELETE;
--   · no serviço: `EventLogService` grava esse evento com `retencaoAte` no ano
--     9999 (`RETENCAO_PERENE`), então ele nunca fica "vencido" para começo de
--     conversa.
-- Uma sozinha bastaria; as duas juntas é o que faz a regra sobreviver a alguém
-- mexer só de um lado.
--
-- ----------------------------------------------------------------------------
-- A CADEIA DE HASH DEPOIS DO EXPURGO
-- ----------------------------------------------------------------------------
-- `EventLogService.verificar()` percorre `seq` de 1 em diante e reprova quando a
-- sequência pula. Depois de um expurgo ela VAI pular — as linhas velhas não
-- existem mais. Isso não é um defeito a esconder: é o que o evento
-- `rastro.expurgo` documenta, com a faixa apagada (`seqDe`/`seqAte`) e a
-- quantidade. Quem verifica a cadeia lê o evento e sabe por que o buraco existe,
-- quem o abriu e quando. Sem o evento, o mesmo buraco seria inexplicável.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A TABELA
-- ---------------------------------------------------------------------------

CREATE TABLE "RastroRetencao" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dias" INTEGER NOT NULL,
    "motivo" TEXT,
    "definidoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RastroRetencao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RastroRetencao_orgId_key" ON "RastroRetencao"("orgId");

ALTER TABLE "RastroRetencao" ADD CONSTRAINT "RastroRetencao_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prazo é número de dias, e número de dias não é negativo nem zero. O teto de
-- 100 anos existe para um dedo escorregado não gravar um prazo que, na prática,
-- desliga a retenção sem ninguém decidir isso.
ALTER TABLE "RastroRetencao" ADD CONSTRAINT "RastroRetencao_dias_plausivel"
  CHECK ("dias" >= 1 AND "dias" <= 36500);

COMMENT ON TABLE "RastroRetencao" IS
  'Prazo de guarda do RASTRO por empresa (RF-R-06). Ausencia de linha = herda o padrao da politica (retencao.rastroDias), nao "sem retencao".';

-- ---------------------------------------------------------------------------
-- 2. ISOLAMENTO POR LINHA — obrigatório para tabela de empresa
--
-- Pela função da migration 20260911050000, que é o caminho declarado para toda
-- tabela nova: `ENABLE` + `FORCE` + policy de LEITURA e policy de ESCRITA
-- separadas, com as MESMAS expressões do grupo padrão (nenhuma sentinela: não
-- há caminho público nem de plataforma que precise ler a retenção de ninguém).
--
-- APAGAR é permitido e não é descuido: tirar a configuração da empresa faz ela
-- voltar a herdar o padrão, que é uma operação legítima da tela. O que some é a
-- configuração, nunca evento.
-- ---------------------------------------------------------------------------

SELECT app_rls_aplicar_policies(
  'RastroRetencao',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);

-- A tabela nasce com as permissões do papel pelo `ALTER DEFAULT PRIVILEGES` da
-- migration 20260911020000 — mas só quando o papel já existe no momento do
-- CREATE. Em banco que ganhou o papel depois, o GRANT explícito abaixo é o que
-- evita um "permission denied" longe da causa.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "RastroRetencao" TO mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. A POLICY DE EXPURGO NO RASTRO — o prazo virado regra do banco
--
-- Nome PRÓPRIO (`tenant_expurgo_retencao`), e não um dos quatro que
-- `app_rls_aplicar_policies` cria: se fosse `tenant_exclusao`, uma reaplicação
-- da migration do isolamento a derrubaria em silêncio (aquela função dá
-- `DROP POLICY IF EXISTS tenant_exclusao` antes de criar as dela, e `EventLog`
-- entra lá com `p_apaga => false`). O nome novo está declarado em
-- `NOMES_DE_POLICY` e a expressão em `EXPRESSOES_DECLARADAS`, ambos em
-- `apps/api/test/tenant-isolation.test.ts`, no mesmo commit — é a catraca que
-- existe justamente para uma policy nova não entrar sem alguém ver.
--
-- `now()` e não um parâmetro: a policy é o PISO, e o piso é o relógio do banco.
-- A função abaixo pode passar um corte mais conservador (nunca mais frouxo).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_expurgo_retencao ON "EventLog";
CREATE POLICY tenant_expurgo_retencao ON "EventLog" FOR DELETE USING (
  public.app_org_resolvida()
  AND "orgId" = public.app_org_atual()
  AND "retencaoAte" < now()
  AND "tipo" <> 'rastro.expurgo'
);

-- ---------------------------------------------------------------------------
-- 4. O EXPURGO
--
-- Uma empresa por chamada, e a empresa TEM de ser a da sessão. Não existe
-- "expurgar tudo": a varredura abre o contexto de cada empresa e chama aqui
-- dentro dele (`ExpurgoService.varrer`). Isso mantém o isolamento valendo
-- durante a operação e deixa o evento do expurgo com o dono certo.
--
-- `p_corte` é o instante a partir do qual uma linha conta como vencida. Quem
-- chama passa `now()`; o parâmetro existe para o teste poder ser determinístico
-- sem mexer no relógio do banco. Ele NÃO afrouxa nada: a policy acima continua
-- exigindo `retencaoAte < now()`, então um corte no futuro não apaga nada que o
-- prazo já não tivesse liberado.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_rastro_expurgar(p_org text, p_corte timestamptz)
RETURNS TABLE (apagados bigint, seq_de bigint, seq_ate bigint)
LANGUAGE plpgsql AS $$
DECLARE
  n bigint := 0;
  de bigint;
  ate bigint;
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

  -- O `ALTER TABLE` abaixo pega ACCESS EXCLUSIVE em `EventLog` e o segura até o
  -- commit: ele espera toda escrita em curso terminar. Sem tempo limite, um
  -- expurgo agendado penduraria o RASTRO da instância inteira atrás da consulta
  -- mais longa. Com ele, o pior caso é o expurgo falhar com 55P03 e ser
  -- repetido — e repetir é barato, porque o corte é idempotente.
  PERFORM set_config('lock_timeout', '5s', true);

  -- A faixa apagada, ANTES de apagar: é ela que explica o buraco de `seq` para
  -- quem for verificar a cadeia depois.
  SELECT min("seq"), max("seq") INTO de, ate
    FROM "EventLog"
   WHERE "orgId" = p_org AND "retencaoAte" < p_corte AND "tipo" <> 'rastro.expurgo';

  IF de IS NULL THEN
    RETURN QUERY SELECT 0::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete;

  DELETE FROM "EventLog"
   WHERE "orgId" = p_org AND "retencaoAte" < p_corte AND "tipo" <> 'rastro.expurgo';
  GET DIAGNOSTICS n = ROW_COUNT;

  ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete;

  RETURN QUERY SELECT n, de, ate;
END $$;

COMMENT ON FUNCTION app_rastro_expurgar(text, timestamptz) IS
  'Unico caminho por onde linha do RASTRO sai do banco. Exige ser DONO da tabela (ALTER TABLE ... DISABLE RULE): o papel da aplicacao nao consegue chamar. Uma empresa por vez, dentro do contexto dela, e nunca o evento rastro.expurgo.';

-- De PUBLIC primeiro (é de lá que o `CREATE FUNCTION` concede por padrão), do
-- papel depois (por causa do `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON
-- FUNCTIONS`, que é concessão nominal e reconcederia sozinho). Mesma ordem e
-- mesmo motivo de `app_rls_ligar()` / `app_rls_desligar()` na migration do
-- isolamento — lá isso já foi medido e corrigido uma vez.
REVOKE EXECUTE ON FUNCTION app_rastro_expurgar(text, timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION app_rastro_expurgar(text, timestamptz) FROM mktos_app';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. CONFERÊNCIA — falha alta, como a da migration do isolamento
--
-- Três coisas que, se não valerem, transformam esta migration em afrouxamento
-- do RASTRO em vez de retenção. Migration que aplica pela metade em silêncio é
-- pior do que migration que não aplica (09-PADRÕES §3.4).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  problemas text[] := ARRAY[]::text[];
BEGIN
  -- 5.1 A tabela nova saiu daqui isolada?
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'RastroRetencao'
       AND c.relrowsecurity AND c.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 2
  ) THEN
    problemas := array_append(problemas,
      'RastroRetencao sem RLS/FORCE/duas policies — tabela de empresa sem isolamento e vazamento');
  END IF;

  -- 5.2 As RULEs de append-only continuam ligadas depois de tudo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class
     WHERE c.relname = 'EventLog' AND r.rulename = 'eventlog_sem_delete' AND r.ev_enabled = 'O'
  ) THEN
    problemas := array_append(problemas,
      'eventlog_sem_delete desligada ao fim da migration — o RASTRO ficaria apagavel por qualquer DELETE');
  END IF;

  -- 5.3 O papel da aplicação continua SEM poder apagar o RASTRO nem chamar o
  --     expurgo. É a pergunta que resume a fatia inteira: o caminho que apaga
  --     não pode estar disponível para a aplicação em operação normal.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    IF has_table_privilege('mktos_app', '"EventLog"', 'DELETE') THEN
      problemas := array_append(problemas,
        'mktos_app tem DELETE em EventLog — o REVOKE das migrations anteriores foi desfeito');
    END IF;
    IF has_function_privilege('mktos_app', 'app_rastro_expurgar(text, timestamptz)', 'EXECUTE') THEN
      problemas := array_append(problemas,
        'mktos_app pode EXECUTE em app_rastro_expurgar — o expurgo ficou ao alcance da aplicacao');
    END IF;
  END IF;

  IF array_length(problemas, 1) > 0 THEN
    RAISE EXCEPTION 'retencao do rastro aplicada pela metade: %', array_to_string(problemas, '; ');
  END IF;
END $$;
