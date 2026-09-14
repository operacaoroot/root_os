# A6 — Heartbeat por evento (fila `BatidaDeAgente`: atribuição, menção, manual e resolução de aprovação)

> Especificação gerada em 13/09/2026 pelo workflow `controle-de-agentes-fatias`, na branch
> `root-os/controle-agentes`. **Não é código, e as decisões marcadas abaixo são do Pedro** —
> nenhuma delas foi tomada por agente. Plano: `docs/PLANO-CONTROLE-DE-AGENTES.md`.


## O caminho recomendado

Hoje o único gatilho é o relógio: `RotinasScheduler` bate de minuto em minuto, descobre as empresas pelas próprias tabelas de rotina, abre `comContexto` de CADA uma, pergunta à assinatura se a empresa está suspensa, reserva a rotina com arrendamento de prazo e chama o executor. Esse desenho já resolveu, na prática, os quatro problemas que qualquer gatilho novo vai reencontrar — isolamento por linha fora de requisição, teto de custo de IA por empresa, rastro com correlação, e "morreu no meio e volta em minutos". A A6 NÃO inventa um segundo mecanismo: ela acrescenta uma FILA DURÁVEL de fatos e um drenador com exatamente a mesma disciplina.

Uma BATIDA é um fato do mundo que merece uma passagem de agente: "esta tarefa passou a ser sua", "você foi mencionado aqui", "alguém clicou em Invocar", "a ação que você propôs foi decidida". Ela nasce no código que causou o fato (produtor), vira linha em `BatidaDeAgente` (estado `pendente`), e é consumida por `BatidasDrenador` — um tique de 15s que descobre as empresas com fila pendente, abre o contexto de cada uma, pergunta à assinatura, reserva a batida por prazo e roda a PASSAGEM. A passagem não é caminho novo: ela relê o alvo no banco, monta um pedido com `batidas/pedido.ts` (função pura) e chama `AgentRuntime.executar`. Régua, porta, rebaixamento, teto de custo, rastro e sessão continuam sendo os mesmos — gatilho novo não é régua nova.

FILA É TABELA NOVA, e não reuso de `RotinaExecucao`. Três motivos que não se contornam: (1) `RotinaExecucao.rotinaId` é chave estrangeira NOT NULL com `ON DELETE CASCADE` — batida não tem rotina, e um `rotinaId` anulável transformaria o diário de bordo das rotinas em duas coisas; (2) `RotinaExecucao` é HISTÓRICO (só desfecho, sem estado de espera, sem reserva, sem coalescência) — fila precisa de `pendente`/`em_curso`/`adiada`; (3) contaminaria o número que a onda 10 deixou anotado como mentira: `Rotina.execucoes` alimenta "horas devolvidas por semana" em `/rotinas`, e somar batidas ali faria a tela publicar economia de tempo que ninguém declarou. A fila guarda o FATO e a procedência; o registro do que aconteceu continua sendo `Session` + `EventLog`, ligados por `BatidaDeAgente.sessionId` e pela correlação.

TEMPESTADE DE HEARTBEAT — quatro travas, em ordem de quem corta primeiro:
1. COALESCÊNCIA NO BANCO. Coluna `chaveAberta` = `orgId|agenteId|motivo|alvoTipo|alvoId` enquanto a batida está `pendente`, e `NULL` no instante em que ela sai de `pendente`. `@unique` simples resolve (NULL não colide com NULL no PostgreSQL), então o produtor é um `upsert` do Prisma: dez comentários na mesma tarefa em um minuto viram UMA linha com `vezes = 10`. Sem `chaveAberta` seria índice único parcial (`WHERE estado = 'pendente'`), que o Prisma não sabe expressar e obrigaria a enfileirar por `$executeRaw`.
2. JANELA DE AGRUPAMENTO. `naoAntesDe = agora + espera(motivo)` — 60s para `mencao` e `atribuicao`, 0 para `manual`, 60s para `aprovacao_resolvida` (dá tempo do efeito da aprovação terminar). A rajada colapsa dentro da janela; o drenador só enxerga `naoAntesDe <= agora`.
3. TETO DE BATIDAS POR AGENTE E POR HORA. Contado no banco (`count` por `agenteId` e `criadaEm > agora-1h` com estado terminal). Estourado, a batida vira `adiada` com motivo escrito e o log grita UMA vez por agente. Isto é teto de VOLUME, e existe porque o teto de dinheiro (`TetoDeCustoIa`) só corta quando o dinheiro acaba — uma fila entupida gastaria o orçamento do dia inteiro numa hora e as rotinas da madrugada morreriam de fome sem ninguém entender por quê.
4. SERIALIZAÇÃO POR AGENTE. Antes de reservar, o drenador recusa a batida se aquele agente tem `Session.status = rodando`. Dois motivos: passagens paralelas do mesmo agente colidem com o checkout atômico da A4, e `Agent.ultimoStatus` (que é o que decide o rebaixamento por duas falhas seguidas) é uma coluna só — duas sessões em paralelo já são a corrida que `atualizarAgente` resolveu com `updateMany` condicional, e não vale piorá-la.
E uma quinta, de segunda ordem: BATIDA CAUSADA POR AGENTE NÃO ENFILEIRA. Se `atorTipo = ai`, o produtor não escreve nada. Sem isso, o agente A comenta, acorda o agente B, que comenta de volta, e o pingue-pongue gasta orçamento a noite inteira. Abrir isso é trabalho da A8 (delegação), com decisão de quem manda.

REBAIXAMENTO E TETO DE CUSTO, COM GATILHO QUE NÃO É O RELÓGIO — a regra é: o que a fila barra ANTES do modelo nunca conta como falha do agente. `ExecCtx.tetoDoAgente` continua sendo carregado pelo laço e imposto pela PORTA (bloco 6-bis), com causa `agente_rebaixado`: agente rebaixado ACORDA e responde (R0/R1), e a porta recusa o que passa disso, com `ToolCall`, `PolicyDecision` e `tool.recusado` inteiros. Barrar a batida por rebaixamento seria transformar 24h de observação em 24h de agente mudo, que é exatamente o que `impedimento()` recusa fazer. Já o teto de custo da empresa é diferente: `TetoDiarioEstouradoError` hoje chega ao laço, encerra a sessão como `recusada` e — aqui está o perigo novo — `atualizarAgente` NÃO é chamado nesse caminho (o `break` cai no encerramento normal e chama, sim: `status = recusada`, que não é `falhou`, então não conta falha). Ainda assim, a batida deve ser `adiada` com `naoAntesDe` = virada do dia no fuso da empresa e `tentativas+1`, com teto de 3 tentativas; contá-la como falha faria uma empresa sem orçamento rebaixar os agentes dela por uma questão de caixa. Agente `pausado`/`encerrado` (A2) NÃO recebe passagem: o drenador confere o estado ANTES de abrir sessão e descarta com motivo — se deixasse o runtime recusar, `impedimento()` abriria uma `Session` `recusada` por batida, e a tela de Sessões de um agente pausado encheria de lixo.

MENÇÃO VEM DE FORA, E QUEM CERCA JÁ EXISTE. A fila guarda só PROCEDÊNCIA (`atorRotulo`, `alvoTipo`, `alvoId`, `externo`, e um `resumo` escrito pelo OS); o corpo do comentário NUNCA é copiado para ela — primeiro porque seria conteúdo de cliente numa segunda tabela sem a redação que a porta aplica, segundo porque o texto pode ter sido editado ou apagado entre o fato e a passagem. A passagem RELÊ o `WorkComment` (comentário que sumiu = batida `descartada`, não pedido velho) e chama o runtime com `procedenciaExterna: true`. Daí para frente nada é novo: o runtime já cerca com `blocoExterno`, neutraliza com `neutralizarEstrutura`, avisa no log o que veio escondido e ELEVA a marca `ProcedenciaExterna`, que é de mão única e faz a ação derivada subir um degrau na régua. Quem cerca é o runtime; a A6 só tem de acender a marca — e é isso que dois casos de teste travam, porque o jeito errado (passar o comentário como `pedido` normal) compila, roda e parece funcionar.

RESOLUÇÃO DE APROVAÇÃO FECHA UM BURACO QUE JÁ EXISTE HOJE. Quando a porta retém uma chamada, o laço grava o passo, empurra a aprovação em `aprovacoes[]` e a sessão termina `retida`. O agente morre ali. Uma pessoa confirma em `/atendimento`, `AcoesService.executarAprovada` roda o efeito — e o agente NUNCA fica sabendo. O agente a acordar não é `Approval.propostoPorId` (que é o humano solicitante, `ctx.actorId ?? 'agente'`): é `ToolCall.agentSlug`, achado por `where: { id: ap.toolCallId, orgId }` — com o `orgId` na consulta, nunca por relação do Prisma. A batida é escrita na MESMA escrita que muda o estado da aprovação (em `confirm` e em `reject`), com `naoAntesDe = +60s`, e a passagem relê a aprovação: confirmada-com-efeito-que-falhou acorda o agente com a verdade, não com "deu certo". O pedido diz explicitamente que a ação JÁ foi decidida e não deve ser proposta de novo; o token é de uso único e a porta classifica tudo outra vez, então o agente não consegue reexecutar — o que ele pode é propor de novo, e é o teto por hora que segura o pingue-pongue.

"INVOCAR" (o botão da A2) CONTINUA SÍNCRONO. Ele já existe (`POST /agents/:slug/executar` e `/stream`) e é o único gatilho com alguém olhando a tela — mandá-lo para a fila trocaria streaming por 15 segundos de espera. A A6 só REGISTRA a batida `manual` já `concluida`, apontando para a sessão, para que a linha do tempo (A9) tenha os cinco motivos e não quatro.

E DUAS COISAS QUE O DRENADOR HERDA DO AGENDADOR DE ROTINAS, de propósito: a descoberta que roda sem empresa na sessão volta VAZIA E CALADA sob o papel restrito — então o diagnóstico "a descoberta está cega" sai de `rotinas.scheduler.ts` para `common/descoberta-sem-empresa.ts` e passa a ter UMA resposta para os dois tiques, que vira CAMPO NA TELA; e o "estou de pé neste processo" segue o molde de `sinal-do-agendador.ts`, para que fila crescendo com drenador ausente apareça na tela em vez de virar silêncio.


## Modelo de dados

- ENUMS (dois, novos): `CREATE TYPE "BatidaMotivo" AS ENUM ('agenda','atribuicao','mencao','manual','aprovacao_resolvida');` e `CREATE TYPE "BatidaEstado" AS ENUM ('pendente','em_curso','concluida','falhou','descartada','adiada');`. `agenda` entra no enum já agora, mesmo sem produtor, porque é o gatilho que o cron JÁ exerce e a linha do tempo da A9 vai querer os cinco motivos num vocabulário só — acrescentar valor a enum depois é migration; deixar o quinto de fora é a tela contando quatro.
- TABELA `BatidaDeAgente` (única tabela nova da fatia):
CREATE TABLE "BatidaDeAgente" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "agenteId" TEXT NOT NULL,
  "motivo" "BatidaMotivo" NOT NULL,
  "estado" "BatidaEstado" NOT NULL DEFAULT 'pendente',
  -- Alvo POLIMÓRFICO e SEM chave estrangeira, pelo mesmo motivo de `Rotina.refExterna`:
  -- 'work_task' | 'work_comment' | 'approval' | 'agent'. O alvo pode ser apagado, e
  -- uma FK transformaria "o comentário sumiu" em erro de gravação no meio do tique.
  "alvoTipo" TEXT NOT NULL,
  "alvoId" TEXT NOT NULL,
  -- Quantos fatos iguais colapsaram nesta linha. A tela mostra: "7 comentários, 1 passagem".
  "vezes" INTEGER NOT NULL DEFAULT 1,
  "atorTipo" "ActorType" NOT NULL DEFAULT 'user',
  "atorId" TEXT,
  "atorRotulo" TEXT NOT NULL,
  -- O texto que vai virar pedido foi escrito FORA do OS? Mão única, como a marca do runtime.
  "externo" BOOLEAN NOT NULL DEFAULT true,
  -- Frase escrita pelo OS. NUNCA corpo de comentário, título de cliente ou conteúdo de alvo.
  "resumo" TEXT NOT NULL,
  -- A CHAVE DE COALESCÊNCIA. Preenchida enquanto `estado='pendente'`, NULL depois.
  "chaveAberta" TEXT,
  "naoAntesDe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- O arrendamento, no MESMO desenho de `Rotina`: a época é o valor de "livre".
  "reservadoAte" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00',
  "tentativas" INTEGER NOT NULL DEFAULT 0,
  "sessionId" TEXT,
  "desfecho" TEXT,
  "correlationId" TEXT,
  "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadaEm" TIMESTAMP(3) NOT NULL,
  "concluidaEm" TIMESTAMP(3),
  CONSTRAINT "BatidaDeAgente_pkey" PRIMARY KEY ("id")
);
- CHAVES ESTRANGEIRAS — empresa RESTRICT (como em todo o schema) e agente RESTRICT, não CASCADE:
ALTER TABLE "BatidaDeAgente" ADD CONSTRAINT "BatidaDeAgente_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BatidaDeAgente" ADD CONSTRAINT "BatidaDeAgente_agenteId_fkey"
  FOREIGN KEY ("agenteId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- RESTRICT no agente é a mesma decisão que `Session` já tomou ("agente sai de circulação
-- com estado 'pausado', nunca com DELETE"): CASCADE aqui apagaria a prova de por que o
-- agente acordou junto com o agente.
- ÍNDICES:
-- A COALESCÊNCIA. `NULL` não colide com `NULL`, então batida terminal sai do caminho
-- sozinha e o mesmo fato pode enfileirar de novo depois.
CREATE UNIQUE INDEX "BatidaDeAgente_chaveAberta_key" ON "BatidaDeAgente"("chaveAberta");
-- A DESCOBERTA DO DRENADOR, que atravessa empresas (a única consulta sem empresa na sessão).
CREATE INDEX "BatidaDeAgente_estado_naoAntesDe_idx" ON "BatidaDeAgente"("estado", "naoAntesDe");
-- A varredura DENTRO da empresa, e a gaveta por agente na tela.
CREATE INDEX "BatidaDeAgente_orgId_estado_naoAntesDe_idx" ON "BatidaDeAgente"("orgId", "estado", "naoAntesDe");
CREATE INDEX "BatidaDeAgente_orgId_agenteId_criadaEm_idx" ON "BatidaDeAgente"("orgId", "agenteId", "criadaEm");
- ISOLAMENTO POR LINHA — na MESMA migration que cria a tabela, com leitura e escrita SEPARADAS (policy `FOR ALL` sem `WITH CHECK` reusa a leitura como verificação de escrita; foi o furo que reprovou a 1.4):
SELECT app_rls_aplicar_policies(
  'BatidaDeAgente',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',
  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'
);
-- NENHUMA sentinela (nem pública, nem de plataforma): o drenador roda fora de requisição
-- e abre o contexto DE CADA EMPRESA antes de tocar em linha, exatamente como o agendador
-- de rotinas e o expurgo do rastro. Uma cláusula de sentinela aqui dispensaria essa
-- disciplina — e dispensaria junto o teto de custo de IA, que depende do mesmo contexto.
- GRANT AO PAPEL RESTRITO, guardado por `has_role` (GRANT para papel inexistente ABORTA a migration, e `migrate deploy` roda no `command` do container):
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mktos_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "BatidaDeAgente" TO mktos_app';
  END IF;
END $$;
- CONFERÊNCIA LOCAL no fim da migration — a mesma pergunta da 1.5, sobre esta tabela. Falha ALTA de propósito: se a chamada de policies desaparecer num rebase, é melhor abortar aqui do que uma tabela de empresa entrar em produção legível por outra.
DO $$
DECLARE ok boolean;
BEGIN
  SELECT c.relrowsecurity AND c.relforcerowsecurity
     AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 4
    INTO ok FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'BatidaDeAgente';
  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION 'BatidaDeAgente ficou sem isolamento por linha (rls/force/policies). Tabela de empresa sem policy e vazamento, nao pendencia.';
  END IF;
END $$;
- SEM COLUNA NOVA EM TABELA EXISTENTE. `WorkComment`, `WorkTask`, `Approval`, `ToolCall`, `Session` e `Agent` ficam intactos: a ligação de volta é `BatidaDeAgente.sessionId` + `correlationId`, e a ida é `alvoTipo`/`alvoId`. Em particular NÃO se acrescenta `batidaId` em `Session` — a fila é que aponta para a sessão, e não o contrário, senão a tabela de sessões passaria a conhecer um mecanismo que pode ser desligado.
- O QUE A A6 NÃO CRIA, e depende da A4: `WorkTask.agenteId`. Hoje `assignee` é `String?` de texto livre e não sabe dizer "este é um agente" — derivar agente por casamento de `assignee` com `Agent.slug` seria adivinhação sobre a coluna que a A4 vai substituir. O produtor de `atribuicao` são ~20 linhas e entra no commit da A4.
- RETENÇÃO — declarada e NÃO resolvida nesta fatia: a fila cresce para sempre. `RotinaExecucao` tem o mesmo problema e o rastro tem retenção por empresa (`RastroRetencao.dias`, expurgo por `expurgo:rastro`). Ver a pergunta 6.


## Arquivos

- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/prisma/schema.prisma — modelo `BatidaDeAgente` + enums `BatidaMotivo`/`BatidaEstado`, e a relação inversa em `Org` e `Agent`
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/prisma/migrations/20260913xxxxxx_batidas_de_agente/migration.sql — escrita À MÃO (o `migrate dev` compara o schema inteiro e engoliria modelo de outra fatia), provada num Postgres descartável com o histórico aplicado do zero, com caminho de volta escrito no cabeçalho
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/batidas/batida.tipos.ts — motivos, `ESPERA_POR_MOTIVO`, `ARRENDAMENTO_MS`, `LIVRE` (a época), teto por agente/hora, e o contrato que a tela lê (espelhado em `apps/web/src/app/rotinas/tipos.ts`, com teste de contrato)
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/batidas/batidas.service.ts — `enfileirar` (upsert por `chaveAberta`, com o retry do P2002 concorrente), `descartar`, `antecipar`, `listar`. Nenhum método abre contexto de empresa: quem chama já está dentro do da requisição ou do que o drenador abriu
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/batidas/batidas.drenador.ts — o tique de 15s: descoberta sem empresa, `comContexto` por empresa, gate de assinatura, reserva por prazo, retomada de arrendamento vencido, e `anunciarDrenadorDeBatidas()` no molde de `sinal-do-agendador.ts`
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/batidas/batidas.passagem.ts — uma batida do começo ao fim: confere estado do agente, confere serialização, relê o alvo, monta o pedido, chama `AgentRuntime.executar`, fecha a linha (o molde é `RotinasService.executar`, inclusive o "nada depois da chamada derruba o chamador")
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/batidas/pedido.ts — PURO, sem I/O: o texto do pedido por motivo, recebendo o alvo já relido. É o que os testes fixam palavra por palavra, porque é ele que diz ao agente "a ação já foi executada, não a proponha de novo"
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/batidas/mencoes.ts — PURO: acha `@slug` num texto, casando SÓ contra a lista de slugs recebida (que o chamador leu com `orgId` na consulta). Conservador: sem prefixo parcial, sem fuzzy
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/batidas/batidas.controller.ts — as quatro rotas
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/batidas/batidas.module.ts — `@Global` (como `GatewayModule`) para que os produtores injetem `BatidasService` sem importar nada e sem ciclo de módulo; importa `AgentsModule` (que já exporta `AgentRuntime`) e `BillingModule` (o gate de suspensão) para o drenador. `AgentsModule` NÃO pode importar este — seria ciclo
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/common/descoberta-sem-empresa.ts — EXTRAÍDO de `rotinas.scheduler.ts`: a pergunta ao catálogo (`rolsuper OR rolbypassrls` × `relforcerowsecurity`) com validade de 5 min. Uma só resposta para "a descoberta está cega"; duas cópias divergiriam e a segunda envelheceria calada
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/routines/rotinas.scheduler.ts — passa a usar o helper extraído (mudança de forma, não de comportamento: os casos de `rotinas.test.ts` sobre descoberta cega continuam verdes sem edição)
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/work/work.service.ts — produtores em `comentar` (linha ~433) e em `criarTarefa`/`editarTarefa`
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/approvals/approvals.service.ts — produtor em `confirm` (depois do `updateMany` condicional que garante "1 e só 1") e em `reject`
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/agents/agents.controller.ts — registra a batida `manual` já concluída, nas duas rotas de execução
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/tenants/modulos.ts — `'batidas'` na espinha
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/src/app.module.ts — `BatidasModule` nos `imports`. Sem ele, os produtores não resolvem a injeção e a API NÃO SOBE — é a sentinela de graça, e é de propósito que `BatidasService` não é `@Optional()` em produtor nenhum
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/web/src/app/rotinas/page.tsx e .../rotinas/tipos.ts — o bloco novo e o contrato
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/web/src/app/agentes/page.tsx — "por que ele acordou" e o aviso de pausado
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/web/src/lib/api.ts — os fetchers de `/batidas`
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/docker-compose.yml — `BATIDAS_CRON` no bloco `environment:` do serviço `api` (o container NÃO lê arquivo `.env`; preencher só o `.env` não faz nada)
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/docs/DEPLOY.md — a variável nos dois lugares, a receita de "subir só enfileirando" (`BATIDAS_CRON=off`) para medir a fila antes de ligar o drenador, e o lembrete de que trocar a variável exige `up -d --no-build api` (ela é lida no arranque; `docker restart` não serve)
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/docs/PLANO-CONTROLE-DE-AGENTES.md — marcar A6 e registrar as decisões respondidas
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/test/batidas.test.ts — a suíte da fatia
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/test/prisma-de-rotinas.ts — o dublê de Prisma cresce para cobrir `batidaDeAgente` (DUAS suítes vão usá-lo; duas cópias de dublê é como duas suítes passam a testar coisas diferentes achando que testam a mesma)
- /private/tmp/claude-501/-Users-pedro-Library-Projetos-marketing-os/d2f4a220-29fa-4686-866f-abda9cce3b82/scratchpad/wt-agentes/apps/api/test/tenant-isolation.test.ts — piso de casos sobe (a catraca já varre o catálogo sozinha; o que muda é o piso em `.github/workflows/ci.yml`, que vive só na branch)


## Rotas

- `GET /batidas` — a fila e o histórico recente da empresa, mais o diagnóstico do drenador (`drenadorDePe`, `tiqueAtivo`, `descobertaCega`). Permissão `mcp.ver` (a mesma de `/agents` e `/sessions`; duas permissões para a mesma tela é o defeito que a fila de aprovação já pagou). Não passa pela porta: não é capacidade do catálogo, é leitura de painel — logo não tem nível R. Query: `estado`, `agente`, `limite` (teto 200).
- `GET /batidas/agente/:slug` — as batidas de um agente, para a gaveta de `/agentes`. `mcp.ver`. O agente é resolvido por `findFirst({ where: { orgId, slug } })`, nunca por relação.
- `POST /batidas/:id/descartar` — corpo `{ motivo: string }` obrigatório (mínimo 3 caracteres): gente descartando trabalho de agente tem de dizer por quê. Permissões `automacoes.executar` + `admin.usuarios` (o par `CONFIGURAR_AGENTE` que `agents.controller.ts` já usa — nenhuma chave nova, logo sem o ritual de três passos). Recusa batida que não está `pendente` nem `adiada`. Grava `AuditLog` `batida.descartada`.
- `POST /batidas/:id/agora` — antecipa: zera `naoAntesDe` e limpa o adiamento. Mesmo par de permissões. Recusa se o agente estiver pausado/encerrado, com a frase que manda a pessoa para `/agentes` (é o molde de `conector_desligado`, que leva a `/conexoes`). `AuditLog` `batida.antecipada`.
- NÃO EXISTE `POST /batidas`. Quem enfileira é código do OS, dentro do processo. Uma rota de criação (ou webhook) seria superfície nova de escrita sem segredo declarado, sem lista de capacidades e sem identidade de canal — a fatia 5.5 já mostrou o preço disso (`CANAL_APROVACAO_SEGREDO`, `..._CODIGO_SEGREDO`, `..._CAPACIDADES`, e os dois segredos com 32+ caracteres e diferentes entre si). Um caso de teste trava a ausência.
- PREFIXO NOVO = DECLARAR: `'batidas'` entra em `PREFIXOS_DA_ESPINHA` em `apps/api/src/tenants/modulos.ts`. Espinha e não módulo, pela mesma razão de `rotinas`/`organograma`: um cliente que desligasse isto ficaria com agentes acordando e nenhuma tela para vê-los. Prefixo não declarado LANÇA em execução — as famílias `memoria` e `rotinas` já quebraram inteiras por isso, e `modulos-por-tenant.test.ts` varre as rotas do código e reprova sozinho.
- GATILHOS QUE NÃO SÃO ROTA (os produtores, todos só ENFILEIRAM): `WorkService.comentar` (menção), `WorkService.criarTarefa`/`editarTarefa` (atribuição, quando `agenteId` passa a apontar para agente desta empresa — e só quando ELE muda, não quando o título muda), `ApprovalsService.confirm` e `.reject` (resolução, na mesma escrita que muda o estado), e `AgentsController.executar`/`stream` (registra a batida `manual` já concluída).
- `POST /agents/:slug/executar` e `/agents/:slug/stream` continuam como estão, síncronos e com `EXECUTAR_AGENTE` (`mcp.executar` + `admin.usuarios`). A A6 não mexe no comportamento deles — só acrescenta o registro da batida `manual`.


## Telas

- `/rotinas` ganha um bloco: "O que acordou os agentes". Pendentes com motivo, alvo, `vezes` e QUANDO a passagem vai acontecer (`naoAntesDe`); adiadas com o motivo do adiamento por escrito ("teto de custo de IA da empresa estourou hoje", "teto de 6 batidas por hora deste agente"); concluídas recentes com link para a sessão. É aqui e não em página nova porque `/rotinas` já é o relógio do produto — e porque o diagnóstico de descoberta cega passa a valer para os dois tiques.
- A tela DIZ O AGRUPAMENTO, em vez de esconder: "7 comentários viraram 1 passagem". Sem isso alguém conta os comentários, conta as sessões, e conclui que o OS perdeu trabalho.
- A tela DIZ QUANDO, não "em breve": menção acordada com janela de 60s e tique de 15s reage em até ~75s. Quem espera reação instantânea vai achar que não funcionou.
- `/agentes`, na gaveta do agente: "por que ele acordou" (as últimas batidas dele) e, quando ele está pausado ou encerrado, a linha "N batidas descartadas enquanto ele esteve pausado" — com a lista. Agente retomado não recebe fato velho de graça e sem aviso.
- `/sessoes`: a sessão de batida precisa ser reconhecível. `canalRef = 'batida:<motivo>:<8 primeiros do id>'` e `solicitanteRotulo = 'menção de Lucas Fernandes'` / `'aprovação decidida por Rodrigo Saggioro'`. Nada de "sistema" genérico: o traço é onde se descobre por que o agente gastou dinheiro.
- AVISO DE DRENADOR AUSENTE, no mesmo molde de `descobertaCega`: fila com N pendentes e `drenadorDePe = false` é tela vermelha, não tela verde. `BATIDAS_CRON=off` é decisão de quem opera e aparece como aviso amarelo com a frase certa; drenador que não subiu é defeito de montagem, e as duas coisas não podem dar o mesmo aviso (é a lição de `sinal-do-agendador.ts`).
- NENHUMA PÁGINA NOVA, e nenhum item novo de menu. A A1 é que dá profundidade ao menu; a A6 não disputa espaço com ela.


## Os testes que travam a fatia

- 'dez comentários no mesmo minuto viram UMA passagem, e a fila diz que foram dez' — trava a coalescência por `chaveAberta`
- 'comentário em tarefas DIFERENTES não coalesce: são dois fatos' — trava o conteúdo da chave (tirar `alvoId` dela passaria o caso de cima e afogaria dois fatos em um)
- 'batida que sai de pendente SOLTA a chave: o mesmo fato depois dela enfileira de novo' — trava o `chaveAberta = null`, sem o qual um agente nunca mais acorda por aquele alvo
- 'duas enfileiradas concorrentes do mesmo fato não estouram: a segunda soma em vezes' — trava o retry do P2002
- 'menção entra como DADO: o pedido chega cercado, neutralizado, e a marca de procedência SOBE' — o caso que fica vermelho no dia em que alguém passar o comentário como pedido normal
- 'o corpo do comentário NÃO está em BatidaDeAgente: só procedência e resumo escrito pelo OS'
- 'comentário apagado antes da passagem DESCARTA a batida, em vez de acordar com texto velho'
- 'menção a slug que não é agente DESTA empresa não enfileira nada' — o casamento é contra a lista lida com orgId, nunca por relação do Prisma
- 'a passagem roda DENTRO do contexto da empresa — sem isso o teto de custo de IA não reserva nem conta'
- 'empresa com assinatura suspensa não recebe batida' — o gate de suspensão é interceptor de REQUISIÇÃO e o tique não é requisição
- 'agente pausado não acorda: a batida é descartada com motivo e NENHUMA Session é aberta' — sem isso a tela de Sessões de um agente pausado enche de recusa
- 'agente REBAIXADO acorda e responde; quem recusa o que passa de R1 é a porta, com causa agente_rebaixado' — gatilho novo não afrouxa nem aperta o RF-N-07
- 'teto de custo de IA estourado ADIA a batida (com tentativas+1) e NÃO conta como falha do agente'
- 'batida barrada antes do modelo não mexe em Agent.ultimoStatus' — não existe rebaixamento por fila entupida
- 'três tentativas e a batida vira falhou com motivo escrito, em vez de girar para sempre'
- 'duas batidas do mesmo agente não rodam em paralelo: a segunda espera a sessão em curso terminar'
- 'morrer no meio da passagem NÃO perde a batida: o tique seguinte retoma o arrendamento vencido'
- 'DOIS drenadores no mesmo instante executam a batida UMA vez' — a reserva condicional no PostgreSQL, como em Rotina
- 'o teto de batidas por agente e por hora corta, adia, registra o motivo e avisa uma vez só'
- 'batida com atorTipo=ai NÃO é enfileirada' — o pingue-pongue entre agentes não nasce nesta fatia
- 'aprovação CONFIRMADA acorda o agente que propôs, achado por ToolCall.agentSlug com orgId na consulta'
- 'aprovação REJEITADA também acorda, e o pedido diz que foi rejeitada e por quem'
- 'aprovação confirmada cujo EFEITO falhou acorda o agente com a verdade: a passagem relê o estado atual'
- 'o agente acordado não reexecuta a ação aprovada: o token é de uso único e a porta classifica de novo'
- 'aprovação proposta por gente, sem agente na chamada retida, não gera batida nenhuma'
- 'a batida de atribuição nasce quando agenteId muda, e NÃO quando o título ou o prazo mudam'
- 'Invocar continua síncrono e registra a batida manual já concluída, apontando para a sessão'
- 'não existe rota de criação de batida por HTTP' — varre o controller e reprova um @Post sem :id
- 'a descoberta cega do drenador VIRA CAMPO NA TELA' — fila cheia com policy escondendo tudo não pode ficar verde
- 'BATIDAS_CRON=off cala o tique, mantém o módulo montado e a tela DIZ por quê'
- 'sem BatidasModule no app.module a API não sobe' — a injeção não resolve, e é isso que separa "desligado por quem opera" de "sumiu"
- 'o prefixo batidas está declarado na espinha' — e `modulos-por-tenant.test.ts` reprova sozinho se não estiver
- 'BatidaDeAgente tem RLS, FORCE e as quatro policies' — dentro de `tenant-isolation.test.ts`, que já pergunta ao catálogo; e a seção de isolamento prova que uma empresa não alcança a batida de outra


## DECISÕES PENDENTES — do Pedro, não de agente


### 1. Qual a latência do heartbeat — tique dedicado, carona no tique de 1 minuto das rotinas, ou acordar imediato dentro do processo?

- Tique dedicado de 15s no `BatidasDrenador`, com janela de agrupamento por motivo (60s para menção e atribuição, 0 para manual)
- Carona: o drenador é um executor de rotina (`tipo: 'batidas.drenar'`) e roda no tique de 1 min que já existe
- Acordar imediato: o produtor agenda a drenagem daquela empresa em ~1s, com o tique só como rede de segurança

**Recomendação:** Tique dedicado de 15s + janela por motivo. A carona sai de graça em contexto, gate de assinatura e tela, mas custa uma rotina semeada POR EMPRESA (mais um problema de reconciliação, que é justamente o que mais deu trabalho na 5.1) e trava a latência em 1 minuto. O acordar imediato é por processo e não sobrevive a duas réplicas — vale como otimização depois, nunca como o mecanismo.

**Por quê:** É a troca entre dinheiro e sensação de vida. Tique mais rápido não gasta nada por si (uma consulta indexada a cada 15s); o que gasta é a passagem, e quem a segura é a janela de agrupamento, não o tique.


### 2. Agente pausado ou encerrado (A2): as batidas dele são descartadas ou seguradas até alguém retomá-lo?

- Descartar, com motivo escrito e contagem visível na tela do agente
- Segurar todas em `adiada` e liberar no momento da retomada
- Segurar só `atribuicao` e `aprovacao_resolvida` (que falam de trabalho com dono) e descartar `mencao`

**Recomendação:** Descartar, dizendo na tela quantas foram e por quê. Um agente retomado depois de uma semana acordando com quarenta fatos velhos gasta dinheiro para responder ao passado — e a pessoa que o retomou não pediu isso. Quem quiser recuperar um fato específico tem o botão de antecipar em cima da linha descartada.

**Por quê:** Muda o que "pausar" significa: freio de mão ou gravador. Pausar é botão de emergência (é o vocabulário do interruptor de conector), e botão de emergência que acumula trabalho para soltar depois não é emergência.


### 3. Quanto é o teto de volume — batidas por agente por hora, e por empresa por dia?

- Constante no código: 6/hora por agente, 40/dia por empresa
- Coluna configurável em `Agent` e `Org`, com tela
- Sem teto de volume: o teto de dinheiro por empresa/dia já corta

**Recomendação:** Constante no código (6/hora, 40/dia), e só virar coluna quando alguém reclamar do número. Sem teto de volume é a opção perigosa: o teto de dinheiro corta DEPOIS de a fila ter consumido o orçamento do dia, e quem paga a conta é a rotina da madrugada, que fica sem saldo sem ninguém entender por quê.

**Por quê:** É o único número desta fatia que não sai de medição nenhuma — não há histórico de heartbeat para olhar. Errar para baixo é seguro (a batida fica adiada e a tela diz); errar para cima é uma conta de modelo no fim do mês.


### 4. Menção sempre entra cercada como conteúdo externo, ou só quando o autor não é usuário autenticado da empresa?

- Sempre `externo = true`
- Só quando `WorkComment.authorId` não resolve para usuário desta empresa
- Só quando a tarefa veio de conector (`externalId != null`)

**Recomendação:** Sempre. O comentário de um usuário legítimo é rotineiramente colagem de e-mail de cliente, print de WhatsApp ou trecho de documento — o autor ser de confiança não diz nada sobre o TEXTO. Custa uma linha de prompt e o degrau de uma ação; o contrário custa a primeira injeção bem-sucedida do produto.

**Por quê:** É a mesma pergunta que `CANAIS_EXTERNOS` já respondeu para os canais, com uma diferença: ali o `web` fica de fora porque a pessoa DIGITOU a ordem no painel, autenticada, para o agente. Aqui ninguém deu ordem a ninguém — o agente se convidou a ler o que estava escrito na parede.


### 5. A sessão de batida usa um `SessionCanal` novo, ou reaproveita `rotina` com `canalRef` legível?

- Reaproveitar `rotina` + `canalRef = 'batida:<motivo>:<id>'`
- Enum novo `batida` (migration de tipo + revisão de `CANAIS_EXTERNOS` + toda tela que lista canal)

**Recomendação:** Reaproveitar `rotina` nesta fatia. O enum novo obriga a reabrir `CANAIS_EXTERNOS` — e a decisão que está escrita lá para `rotina` ("o texto é montado pelo próprio OS; conteúdo coletado entra pelo CONTEXTO, já cercado") deixa de ser verdade para menção, o que exigiria decidir a cerca no lugar errado. Com `procedenciaExterna: true` por batida a marca é explícita e por FATO, não por canal. Abrir o enum só quando a tela de Sessões precisar filtrar batida de rotina.

**Por quê:** Enum de canal governa a regra de cerca do runtime. Mexer nele para ganhar um filtro de tela é pagar em segurança por conveniência de listagem.


### 6. Qual a retenção da fila — quanto tempo batida concluída, descartada ou falhada fica no banco, e quem a expurga?

- 90 dias fixos, num passo novo do comando `expurgo:rastro`
- Entra em `RastroRetencao` e passa a ser por empresa, como o rastro
- Não expurgar nesta fatia e declarar a dívida (é o que `RotinaExecucao` e `SessionStep` já fazem)

**Recomendação:** 90 dias fixos dentro do comando de expurgo que já existe, rodando empresa por empresa no contexto de cada uma, como o rastro faz. Fazer virar retenção por empresa agora significa mexer em `RastroRetencao`, que é o campo que sustenta uma obrigação contratual — e misturar fila operacional com prova de auditoria na mesma régua confunde as duas.

**Por quê:** É a terceira tabela sem expurgo. Deixar a quarta para depois é como esta base ganha um problema de disco que ninguém escolheu.


### 7. A6 espera a A4 (`WorkTask.agenteId`) para entrar, ou entra com três gatilhos e a atribuição vem no commit da A4?

- Esperar a A4 e entregar os quatro juntos
- Entrar com menção, manual e resolução de aprovação; a atribuição no commit da A4

**Recomendação:** Entrar com três. A fila, o drenador, as travas de tempestade e a tela são 90% do trabalho e do risco; o produtor de atribuição são ~20 linhas em `WorkService.editarTarefa`. E o gatilho de resolução de aprovação fecha, sozinho, o buraco que existe HOJE em produção — o agente que propõe uma escrita R3 do Google e nunca fica sabendo se ela saiu.

**Por quê:** Amarrar A6 a A4 atrasa o único gatilho que corrige um defeito atual por causa do único que depende de coluna que ainda não existe.


### 8. Quem pode descartar ou antecipar uma batida?

- O par que já existe: `automacoes.executar` + `admin.usuarios` (na prática, hoje, só `admin_master`)
- Permissão nova `agentes.operar`, com os três passos (construir `@mktos/shared` → `db:sync-permissions`, que não é aditivo → todo mundo sai e entra)

**Recomendação:** O par existente. Permissão nova custa os três passos, uma revogação de vínculo feito à mão e o login de todo mundo — e a A2 (que traz pausar/retomar/encerrar) é quem tem de decidir se existe um papel "operador de agentes", porque é ela que cria os botões que ele usaria. Duas fatias criando a mesma chave é como a fila de aprovação ganhou o desencontro de 403.

**Por quê:** Se a A2 criar `agentes.operar`, a A6 herda de graça. Se a A6 criar antes, a A2 herda uma chave desenhada sem as telas dela na frente.


### 9. O botão "Invocar" (A2) passa pela fila ou continua síncrono?

- Continua síncrono (SSE) e a A6 só registra a batida `manual` já concluída
- Passa pela fila, para que os cinco gatilhos tenham um caminho só

**Recomendação:** Continua síncrono e registra. É o único gatilho com uma pessoa olhando a tela, e com `effort` alto o primeiro token leva dezenas de segundos — jogá-lo na fila somaria o tique e a espera a isso, e a tela ficaria muda por mais de um minuto depois do clique. O registro dá à linha do tempo (A9) os cinco motivos sem custo nenhum.

**Por quê:** "Um caminho só" é bonito e aqui cobra em experiência: a uniformidade seria comprada com o único caso em que latência é visível.


## Riscos

- CUSTO. Cada batida é uma passagem de modelo PAGA. As quatro travas reduzem, não eliminam: um quadro movimentado com cinco agentes mencionados pode multiplicar o gasto diário sem nenhum defeito acontecer. Antes de ligar o drenador em produção, subir com `BATIDAS_CRON=off` por alguns dias e LER a fila — é o mesmo truque do `GATEWAY_MODO=observar`, e é a única medição honesta disponível.
- REBAIXAMENTO EM CASCATA. A fila protege o agente do que ela barra antes do modelo, mas não do que o modelo faz: um `pedido.ts` malformado, ou um alvo cujo conteúdo confunde o agente, produz duas falhas seguidas e 24h de autonomia em R1. Numa tempestade de menções isso atinge VÁRIOS agentes ao mesmo tempo, e a volta é só relógio — não existe rotina que reative nada.
- INJEÇÃO POR MENÇÃO é a superfície mais acessível que o produto vai ter: qualquer pessoa com acesso ao quadro escreve um comentário e acorda um agente. A defesa existe e é boa (cerca, neutralização, marca de procedência que eleva o degrau), mas ela mora no runtime e depende de UMA linha do produtor (`procedenciaExterna: true`). O caminho errado compila, roda e parece funcionar — por isso os dois casos de teste, e por isso o corpo do comentário não entra na fila.
- PINGUE-PONGUE DE APROVAÇÃO. Agente acorda, reentende a tarefa, propõe a MESMA ação R3 outra vez, uma pessoa aprova, ele acorda de novo. O pedido diz que a ação já foi decidida e o teto por hora segura, mas o desenho não IMPEDE: só encarece. Fechar de verdade exigiria a fila saber que aquele `toolCallId` já foi consumido por aquele agente para aquele alvo — é a memória de curto prazo que a A8 vai precisar de qualquer jeito.
- LATÊNCIA VISÍVEL. Tique de 15s + janela de 60s = a menção acorda em até ~75 segundos. Se a tela não disser quando, a primeira impressão é de que não funcionou.
- DUAS RÉPLICAS. O arrendamento condicional resolve a execução em dobro (é a prova que `Rotina` já tem). O que NÃO é resolvido é o "acordar imediato" em memória, se ele existir: ele é por processo, e a outra réplica só vê a batida no tique seguinte.
- MÓDULO DESLIGÁVEL POR BAIXO. `trabalho` é módulo contratável (`MODULO_POR_PREFIXO`): com ele desligado, dois dos quatro gatilhos simplesmente não existem. A tela de batidas não pode sugerir que existem — e a de Conexões já ensinou que estado derivado de configuração é estado que mente.
- A6 SEM A4 ENTREGA TRÊS GATILHOS, não quatro. `WorkTask.assignee` é texto livre e não sabe dizer "agente".
- A FILA CRESCE PARA SEMPRE. Sem expurgo, `BatidaDeAgente` acumula indefinidamente — e é a terceira tabela nesta situação (`RotinaExecucao` e `SessionStep` são as outras). O rastro resolveu isso com retenção por empresa; esta fatia não resolve, e é a pergunta 6.
- EXTRAIR A DESCOBERTA CEGA mexe em `rotinas.scheduler.ts`, que é arquivo de outra fatia e tem 20+ casos apontando para ele. É refatoração de forma e os casos devem continuar verdes sem edição; se algum precisar mudar, é sinal de que a extração mudou comportamento e deve ser desfeita.
- SESSÕES DE BATIDA POLUEM O KPI DE SESSÕES. `/sessoes` e os contadores de `Agent.execucoes` passam a somar passagens que ninguém pediu. É a MESMA família da mentira já declarada em `/agentes` (horas "por semana" que são acumulado de vida inteira): consertar o denominador é fatia A3, e a A6 aumenta o numerador antes de a A3 acontecer.


## Depende de

- A2 (estado do agente e o botão) — o drenador precisa perguntar `pausado`/`encerrado` antes de abrir sessão. Hoje `AgentEstado` tem quatro valores (`rodando`, `aprendendo`, `planejado`, `pausado`) e NÃO tem `encerrado`: quem acrescenta o valor ao enum é a A2, e a A6 só o consome.
- A4 (`WorkTask.agenteId` + checkout atômico) — para o gatilho de atribuição, e também para a serialização por agente fazer sentido: se dois agentes puderem pegar a mesma tarefa, acordar os dois é sintoma, não defeito da fila.
- `AgentsModule` continuar exportando `AgentRuntime` (exporta hoje) e `BillingModule` continuar exportando `AssinaturaService` (exporta hoje, e é o que impede rotina de empresa suspensa de disparar).
- `RoutinesModule` segue dono do relógio das ROTINAS. O drenador é outro tique e não entra no mesmo laço: misturar os dois faria uma fila entupida atrasar a rodada da pauta, e uma rodada longa atrasar toda menção.
- Nada disso entra na `main` antes do merge da fatia 0.1 do `PLANO-CONTINUIDADE.md`: a base é `root-os/frente-0`, e a `main` roda em produção cinco semanas atrás.
- A conferência de convergência com a segunda base do ROOT OS (o repo do Rodrigo) é pré-requisito declarado da A5, não da A6 — mas a fila de heartbeat é exatamente o tipo de mecanismo que duas bases inventam de formas incompatíveis. Vale um olhar antes de escrever a migration.


## Esforço

Alto — risco alto, como o plano já classifica. Em blocos: migration + modelo + RLS + conferência local, provada num Postgres descartável do zero (~0,5 dia); `batida.tipos.ts` + `batidas.service.ts` com coalescência e os retries (~0,5 dia); `batidas.drenador.ts` + `batidas.passagem.ts`, que é onde mora a dificuldade real (contexto por empresa, gate de assinatura, arrendamento, serialização por agente, adiamento por teto de custo sem contar falha) (~1 dia); os três produtores + `mencoes.ts` + `pedido.ts`, puros e com texto fixado em teste (~0,5 dia); extração de `descoberta-sem-empresa.ts` sem mexer no comportamento de `/rotinas` (~0,25 dia); tela (bloco em `/rotinas`, gaveta em `/agentes`, contrato espelhado) (~0,5 dia); suíte de ~33 casos, mais o piso novo na CI da branch (~1 dia). Total ~4,5 dias de trabalho, com uma revisão de verdade em cima do drenador — é a peça que gasta dinheiro sozinha, e a única defesa contra erro nela é caso de teste que fica vermelho quando a trava sai. Antes da primeira subida em produção: uma semana com `BATIDAS_CRON=off`, só enfileirando, para ler a fila real antes de pagar a primeira passagem.
