# Estado da execução do plano de continuidade — 11/09/2026

> Para quem volta na segunda-feira e precisa saber onde as coisas estão.
>
> **Branch:** `root-os/frente-0`. **Nada foi empurrado, nada foi mesclado, nada foi para produção.**
> Produção continua rodando a `main` de 03/08. Os commits abaixo existem só no clone local e no
> worktree da execução.
>
> Este documento conta **o que aconteceu**. O que falta fazer está em `docs/BACKLOG-CLICKUP.md`, um
> item por linha, ordenado por quem bloqueia mais. A referência de fatias é sempre a numeração do
> `docs/PLANO-CONTINUIDADE.md`.
>
> **Procedência:** cada número aqui diz onde foi medido. Onde a medição é do Mac, de banco
> descartável ou da semente, está escrito — nenhum número deste documento foi medido no banco de
> produção, que ficou fora do alcance da execução por decisão de escopo.

---

## 1. O que foi entregue, por onda

Onze ondas foram planejadas. **As onze estão commitadas** — a 11ª foi estabilizada e commitada em
12/09/2026 pelo orquestrador, depois de três agentes estabilizadores pararem por travamento de
ambiente. O texto original desta linha dizia que a onda 11 estava no working tree, sem commit,
quando este documento foi escrito (11/09, ~17h), com cinco agentes ainda trabalhando.

### Onda 1 — base, trava e docs · `887adcc` (10/09 20:13)

Sete fatias num commit só porque se sustentam juntas.

| Fatia | O que entrou | Parcial? |
|---|---|---|
| 0.3a | Em `GATEWAY_MODO=observar` a porta **para de executar** R3+: observar afrouxa o registro, nunca o efeito. R5 deixou de ser executado em modo nenhum. A recusa da própria porta passou a gravar decisão de política. Superfície de agentes atrás de permissão | **Sim, e para além do enunciado:** o bypass do modo observar foi removido *de vez*, não só para R5 — qualquer motivo futuro de "não permitido" agora falha fechado. Diverge da letra da fatia, de propósito (§4) |
| 0.2 | CI com três jobs (tipos e testes; isolamento em job próprio; migrations aplicam do zero), trava de cobertura fail-closed que reprova com caso pulado | **Sim.** O workflow sozinho não reprova merge nenhum: falta marcar os jobs como verificação obrigatória na proteção da `main`, e **só o Pedro pode** |
| 0.4 | README, CLAUDE.md, MCP_TOOLS, DEPLOY descrevendo o código real; ADR-001..008 trazidas do vault; `.env.example` completo; `.stignore` parou de mandar o `.env` de produção para o Mac | Sim — o `.stignore` corta o tráfego **futuro**; cópia que já chegou ao Mac continua no disco |
| 2.2 | Quatro capacidades R2 que prometiam desfazer inexistente viraram R3 com reversibilidade manual; a verificação passou a reprovar promessa de desfazer sem capacidade | **Sim.** `politica-root.json` saiu na frente do anexo do vault; a cópia de volta é manual e está pendente, anotada em `packages/policy/src` |
| 3.2 | Catraca de arquitetura com quatro frentes e **31 violações declaradas** como dívida, cada uma com a fatia que a remove; o teste falha com violação nova **e** com exceção que já não existe | Sim, por desenho: declarar não é consertar |
| 3.1 | `relatorio-observar.ts`, que mede a própria lacuna: as recusas da porta não entravam em `PolicyDecision` e ficavam invisíveis ao relatório | Sim — a ferramenta existe; o relatório precisa de semanas de produção (§2) |
| I.2 | `deploy/backup-db.sh` com dump diário, promoção semanal ISO, verificação do dump e `--restore-test` que restaura de verdade num banco criado e marcado por ele | **Sim: falta cópia off-site.** Backup no mesmo disco do banco não sobrevive a perder a VPS |

**Medido na estabilização:** typecheck verde, 189 casos (37 policy, 76 web, 76 api), contra o Postgres
descartável. Nenhuma dependência nova.

### Onda 2 — `orgId` nos filhos e contexto de execução · `eda83b4` (10/09 21:35)

- **1.1** — dez tabelas que só alcançavam a empresa pelo pai ganharam `orgId` próprio, com gatilho no
  banco que **recusa** filho de uma empresa pendurado em pai de outra. Migração em três fases (coluna
  anulável → backfill com duas conferências → trava) porque `migrate deploy` roda no `command` do
  container. Globais por desenho (`Org`, `Permission`, `BioVisitor`, `Capability`) em lista
  versionada, e o teste reprova modelo novo fora dela.
  **Limitação registrada de propósito:** mudar o `orgId` do **pai** deixa o filho na empresa antiga.
  Não há gatilho de propagação — a postura escolhida é prevenir na escrita do filho e **detectar na
  auditoria**.
- **1.2** — tenant, ator e correlação viajam num contexto de execução. O efeito, que era chamado com
  `(args, orgId)` e mais nada, passou a receber quem aprovou e a que história a ação pertence.
- **F.1** — faxina do que a onda 1 achou e não podia consertar: senha por extenso saiu do README do
  MCP e do `QUICKSTART.md`, `deploy/up.sh` ganhou `--no-build`, flag fora de lugar virou erro.

**Medido:** policy 37, web 76, api 146 em 9 arquivos. A suíte de isolamento seguia vermelha por
desenho (linha de base do RLS): 128 falhas, o **mesmo conjunto** de antes da onda, nome por nome.

### Onda 3 — módulos por empresa e sessão de banco com tenant · `5dda664` (10/09 23:13)

- **1.6** — `Org.modulos` e um interceptor global decidem se a rota existe para aquele tenant. Menu
  que esconde sem a API recusar é esconderijo com fachada: agora some do menu **e** devolve 404.
  Migração preenche quem já existia; empresa nova nasce só com a espinha do OS.
- **1.3** — migração cria `mktos_app` (papel restrito) e uma extensão do Prisma declara a empresa
  como primeira instrução de toda transação, inclusive na consulta crua da busca vetorial.
  **Continua inerte:** o papel nasce NOLOGIN e sem senha, a aplicação segue conectando como dona.
  `TENANT_MODO` escolhe entre inventariar (`observar`, padrão) e recusar (`impor`).

**O custo está medido e escrito no código** — implementador e revisor, no Mac, contra o Postgres
descartável:

| Medida | Antes | Depois |
|---|---|---|
| Consulta de modelo | 1,24 ms | 3,08 ms |
| Consulta crua | 0,77 ms | 3,60 ms |
| Vazão, 40 chamadas em paralelo | 1.739 ops/s | 880 ops/s |

Os milissegundos serão menores na VPS, onde API e banco estão na mesma rede. **A queda de vazão é
estrutural** e acompanha: cada consulta segura a conexão quatro vezes mais tempo.

### Onda 4 — rotas públicas, provisionamento e política por tenant · `5586211` (11/09 01:35)

- **1.4** — bio, redirecionamento, avatar e pixel resolvem a empresa explicitamente. O pixel gravava
  tudo com `slug: 'root'` fixo: no primeiro cliente de verdade os eventos dele cairiam na ROOT. A
  chave do pixel é o `id` da empresa (uuid), **nunca** o slug — slug é adivinhável, e quem adivinha
  grava evento com `value`, que vira receita no painel. A rota anônima responde sempre a mesma coisa,
  para não virar oráculo de "esta empresa existe".
- **1.7** — `pnpm --filter @mktos/api provisionar`, compilado e idempotente. A **rota** roda fixa em
  `modo: 'criar'`; reconfigurar e reativar só pela linha de comando.
- **2.1** — sobrescrita de política por empresa com data, responsável e **dois** diffs nomeados
  (`diffDaBase` e `diffDaVersaoAnterior`), porque a mesma coluna tinha três escritores com três
  referências diferentes.

**Parcial declarado:** a chave de pixel é pública por natureza — quem lê o código da página a enxerga.
O desenho que fecha de vez (registro por site, com domínio declarado, conferência de origem e teto de
taxa) exige tabela nova e não coube.

### Onda 5 — RLS ligado e aprovação de verdade · `7ea733b` (11/09 03:31)

- **1.5** — `ROW LEVEL SECURITY` com `FORCE` em **72 tabelas**, com políticas de leitura e escrita
  **separadas**: uma policy sem `FOR` é `FOR ALL`, e numa `FOR ALL` sem `WITH CHECK` o Postgres reusa
  a cláusula de leitura como verificação de escrita — qualquer código rodando sob a sentinela ganhava
  UPDATE, INSERT e DELETE em linha de qualquer empresa, `Org.modulos` inclusive.
  **Continua INERTE em produção, e isso é deliberado:** a aplicação conecta como dona das tabelas, e
  dono atravessa policy. A virada é operacional e hoje **derruba a API de propósito** (§3).
- **3.4** — `Approval.alcadaMinima` era gravada e nunca comparada. Agora `confirm` relê o aprovador
  no banco em todo nível; R4/R5 exigem motivo escrito e **reautenticação de verdade** (senha conferida
  contra o hash, com fila por aprovação e teto de recusas). Antes o código apenas **escrevia**
  `reautenticadoEm` sem ter perguntado nada a ninguém — uma afirmação falsa do sistema sobre si
  mesmo, indo para o RASTRO. Conta de máquina não confirma nem rejeita.
  No caminho, dois furos de autenticação fecharam: todo token passou a declarar `typ` (o `state` do
  login com Google era assinado com a mesma chave e **passava como sessão** — medido com a API de pé,
  `GET /api/auth/me` respondia 200 para ele), e a rota de administração deixou de redefinir a senha do
  próprio dono da sessão, que era por onde uma sessão roubada fabricava a senha que a reautenticação
  de R4 ia conferir em seguida.

**Provado:** do zero em banco limpo (72 de 72 tabelas, 274 policies), sobre banco povoado, e no
caminho de volta (`app_rls_desligar()` / `app_rls_ligar()`).

**Parcial declarado, e é grave:** de 52 ligações entre tabelas que têm empresa, **39 aceitam apontar
para linha de outra empresa** — contagem do estabilizador da onda 5. Com o papel restrito, isso é
negação de serviço entre clientes (uma empresa prende registro de outra); **enquanto a aplicação
entrar como dona, é leitura cruzada de verdade** ao seguir o relacionamento. A migração fechou a
ligação mais perigosa (Open Finance) e deixou as seis seguintes listadas por ordem de estrago.

### Onda 6 — rastro, limites e a tela da régua · `9e12256` (11/09 06:52)

- **3.5** — cada evento passa a carregar os campos que a política cobra do nível dele. Linha
  incompleta é gravada assim mesmo e **declara a lacuna** em `payload.rastro.faltando`. Retenção
  virou por empresa; o expurgo é comando próprio que grava o evento **dentro da mesma transação** que
  apaga.
  No caminho, um defeito na corrente de resumos criptográficos: a fórmula antiga usava a lista de
  chaves como filtro em **todos** os níveis, e tudo aninhado sumia do cálculo — a corrente protegia a
  casca do evento e ignorava o miolo, que é justamente onde mora quem aprovou, por qual canal e
  quanto custou. A conferência aceita as duas fórmulas e relata qual fechou.
- **3.6** — teto de custo por empresa e por dia, com corte **antes** da chamada ao modelo. Com o teto
  ligado, **modelo fora da tabela de preço é recusado** — atinge o provider `openrouter`, cujo modelo
  padrão não está em `preco.ts`.
- **3.7 + o gancho** — desligar um conector passou a **barrar**: a porta pergunta ao interruptor, e
  `AcoesService.executarAprovada` pergunta de novo antes de soltar ação já aprovada (sem isso, uma
  aprovação criada antes do desligamento ainda sairia depois dele).
- **2.3** — tela `/regua` com níveis, sinais, catálogo filtrado pelos módulos da empresa e simulador
  lendo a política real. A janela horária ilegível passou a **acender** o sinal em vez de ficar calada.

**Medido:** 540 casos em 19 arquivos na API, 265 no isolamento com o papel restrito, 53 em rotas
públicas, 74 no pacote de política, 142 no web. Catálogo resolvido: **62 capacidades** (16 da base +
53 do delta, 7 repetidas).

**Parcial declarado:** 8 das 16 chaves de conector não têm **nenhuma** capacidade apontando para
elas — para essas, "o desligamento recusa" é verdade por vacuidade no caminho do agente.

### Onda 7 — escritas pela porta e o COFRE · `9696745` (11/09 08:52)

- **3.3** — as quatro escritas do Google (enviar e-mail, criar evento, criar e anexar documento)
  estavam vivas em produção protegidas **só** por JWT e permissão de papel: sem classificação, sem
  retenção, sem RASTRO e fora do alcance do interruptor de conector. Agora o controlador é tradutor e
  quem fala com o Google é o efeito registrado. As quatro são R3.
  A tela `/google` mostrava **"E-mail enviado" em cima de uma ação retida** — sucesso falso numa ação
  que não saiu. Foi consertado no mesmo commit.
- **5.3** — cofre por empresa e por conector, cifrado com a empresa no dado associado (linha copiada
  para outra empresa não abre, nem com a chave certa), cada linha carregando o id da chave que a
  cifrou.
  **O roteiro de rotação anterior destruía toda credencial viva da bio de quem o seguisse até o fim**
  — o inventário só enxergava a tabela nova, e as credenciais em uso continuavam nas colunas antigas.
  Reproduzido pelo revisor; consertado na mesma onda: o inventário conta as colunas antigas e a
  rotação **recusa** sair da chave de ambiente enquanto restar linha nela.

**Parcial por decisão, com motivo:**
- **A publicação da pauta não migrou** — ela cria o link rastreado, envia e só então marca a peça como
  publicada; com a retenção, o envio acontece na confirmação, minutos depois, e **não existe gancho
  para fechar a escrituração naquele momento**. Migrar pela metade deixaria peça publicada de verdade
  e marcada como não publicada na tela.
- **A bio não migrou** (outra fatia estava nos mesmos arquivos) e **o financeiro não coube**.
- **A chave antiga do cofre não pode ser aposentada**, e não é por código: a migração **copia** e não
  apaga, de propósito, e a credencial do aplicativo global da ROOT **não é migrável**, porque o cofre
  é por empresa por construção.

**Medido:** policy 74/2, web 142/13, api 668/21, isolamento 267, rotas públicas 53, cofre 97.

### Onda 8 — adversariais, fila de aprovação e contrato de conector · `4a4aaa4` (11/09 11:16)

- **5.4** — Google, Meta, Obsidian, ClickUp e Evolution implementam os mesmos quatro verbos e se
  inscrevem num registro. O estado na tela de Conexões passou a ser **sondado**: nunca mais luz verde
  derivada de variável de ambiente, que em produção é verdadeira para todo mundo e dizia "conectado"
  a empresa que nunca autorizou nada.
- **3.10** — `/atendimento` virou a fila de trabalho. O desencontro que dava 403 (menu pedindo
  `whatsapp.enviar`, API pedindo `mcp.executar`) foi resolvido com **duas chaves novas**,
  `aprovacoes.ver` e `aprovacoes.decidir`.
- **3.8 + a ligação** — o sinal de procedência externa existia, era testado e **não acendia em lugar
  nenhum de produção**: o runtime descartava o campo e o tipo do contexto só aceitava booleano. Agora
  a marca nasce no começo da sessão e é elevada pelas **três portas** por onde conteúdo de terceiro
  entra: o pedido de canal externo, o contexto montado e **o resultado de cada ferramenta** — a
  segunda porta de injeção, e a mais perigosa, porque quem a abre é o próprio modelo. Pedido digitado
  no painel entra cru, de propósito.
  Dois defeitos adjacentes: neutralizar conteúdo **já serializado** não funciona (a serialização
  escapa as aspas e a carga chega inteira ao modelo); e o corte do resumo de resultado partia
  caractere em unidades de 16 bits, o Postgres recusava o `jsonb` e **uma execução bem-sucedida virava
  erro**, com o efeito já acontecido e o rastro dizendo o contrário — alcançável de propósito, porque
  quem escreve o documento escolhe onde cai o corte.

**Medido:** api 822 em 25 arquivos, web 196 em 16, policy 74, isolamento 267, rotas públicas 53,
cofre 97, rastro com papel restrito 33. Sete travas de arranque exercitadas uma a uma patchando o
`dist`.

**Não consertado, de propósito:** a regressão da publicação de peça (§4, §5).

### Onda 9 — memória, rotinas e SOP · `30f1f4b` (11/09 13:19)

- **4.1+4.2** — memória por empresa, versionada, com procedência e origem. Toda mudança é evento do
  RASTRO e as tabelas são projeção dele (`docs/adr/ADR-011-memoria.md`). O acervo com embeddings
  migrou sem perder vetor. `GET /audit/verificar` responde pelas duas metades da mesma prova.
- **5.1** — o cron que era da pauta virou o relógio do produto: rotina por empresa, estado declarado,
  histórico e a tela `/rotinas`. A reserva é UPDATE condicional com prazo, então morrer no meio da
  rodada devolve a ocorrência. **Sem `RoutinesModule` nos imports a API não sobe** — é trava, não
  aviso, porque mudança de dono falha de um jeito pior do que quebrar.
- **5.2** — os sete campos da SOP validados antes de tocar no banco, escalação imutável, telas de
  Agentes e Organograma escrevendo e lendo dado real.
- **O quarto lugar que resolvia dono por relação** — `include: { dono: ... }` traz o nome de quem
  estiver do outro lado, de qualquer empresa, e esse nome ia **direto para o prompt de sistema** no
  caminho real de execução. Três leituras já tinham sido corrigidas; a quarta era o laço.

**Risco que nasceu nesta onda, e não é hipotético:** a projeção do vault arquiva toda nota da origem
que ela não viu na volta, e a conferência de configuração exige apenas que **o caminho exista**. Uma
pasta existente e vazia arquiva tudo. O caminho configurado na VPS aponta para uma pasta que a
documentação do próprio projeto diz **não ser o vault real**. Antes da memória, o estrago era um
índice descartável; agora é o histórico. A correção pôs guarda.

**Medido:** api 1000 em 28 arquivos, isolamento 277 com o papel restrito (**78 tabelas** de empresa,
todas com RLS e FORCE), rotas públicas 53, cofre 97, policy 74, web 196.

### Onda 10 — o mapa, a tripulação e a saída do bot · `e60e368` (11/09 16:15)

- **4.4** — `/contexto` virou o mapa: cada ponto é um registro que existe e clicar abre o registro de
  verdade. Empresa vazia mostra o caminho de carga, não tela vazia.
- **4.6** — um comando transforma o estado da empresa em base de conhecimento em markdown, com selo
  de geração. Página gerada é reescrita; página editada à mão, nunca.
- **4.3** — resposta sem fonte vira sinal. **A ligação que valia a fatia inteira:** a lista de fontes
  de uma sessão **nunca recebia chamada de ferramenta** — um agente que lia o painel, pegava o número
  e respondia citando a origem fechava a sessão marcada como sem procedência, o degrau subia, e numa
  empresa com um aprovador só isso travava o agente por 24 horas por ter feito exatamente o que devia.
  Consertado na origem, com a guarda provisória removida **no mesmo commit**.
- **5.5** — aprovar pelo WhatsApp, preso ao conteúdo exato e à identidade cadastrada. No caminho,
  descobriu-se que **a tela nunca comparava os argumentos gravados com o resumo assinado na
  aprovação**: a promessa de vínculo ao conteúdo valia no papel e não no código, na superfície que as
  pessoas usam.
- **5.6** — o rebaixamento passou a ter efeito, e o teto do agente **mudou de casa**: saiu do laço e
  foi para a porta, o que conserta duas coisas de uma vez (a recusa não entrava no RASTRO, e a
  comparação usava o nível de **catálogo**, mais permissivo que o efetivo).
- **5.8** — o bot do Telegram foi **aposentado**, não migrado: ele já estava morto nesta branch (o laço
  propunha e confirmava com a própria conta de máquina, e a fila fechou os dois lados). Com ele caiu a
  armadilha das duas senhas — no servidor, comando de composição que antes falhava por variável
  ausente **agora funciona**.

**Medido:** policy 74/2, web 228/17, api 1199/32; isolamento 277, rotas públicas 53, cofre 97,
rastro-retenção 33. Pisos da CI: api 983/32, web 187/17.

**Parcial declarado:** a fatia 5.5 entregou o canal, mas com a regra de não mandar conteúdo não
público para fora do sistema e a capacidade de WhatsApp classificada como confidencial, **de fábrica
o canal notifica e não decide** (§4). E a tela de Agentes continua inflando as horas devolvidas (§5).

### Onda 11 — plataforma e porta de entrada · `45d081e` (12/09/2026)

Cinco fatias: onboarding autônomo + carga guiada (6.1+4.5), assinatura e cobrança (6.2), console da
plataforma (6.3), painel de custo de IA (6.4) e a isca com o mapa da ROOT ao vivo (6.5).

**Estabilizada e commitada em 12/09/2026, pelo orquestrador** — três agentes estabilizadores pararam
por travamento de ambiente (não por defeito de código), e a conferência foi feita à mão. Medido:

| suíte | casos | arquivos |
|---|---|---|
| api (conjunto padrão) | 1475 | 37 |
| isolamento entre empresas | 287 | 83 tabelas no registro · 86 com RLS e FORCE |
| `cofre` com isolamento ligado | 97 | |
| `rotas-publicas-tenant` com isolamento ligado | 53 | |
| web | 278 | 19 |
| policy | 74 | 2 |

Typecheck do monorepo, typecheck das suítes, `prisma migrate diff` (sem diferença entre migrações e
schema) e o arranque compilado (`pnpm smoke`) verdes. Os pisos da CI subiram junto, com a conta
escrita no arquivo.

**O que a estabilização encontrou, e que nenhum agente tinha visto:**

- **Um defeito real na varredura de arranque do teto de IA.** O modo "arranque" promete soltar *toda*
  reserva aberta "sem pedir idade" — e a consulta de dentro cumpria, mas a de fora continuava
  filtrando por idade nos dois modos. Como o filtro é `<` estrito, a reserva carimbada no mesmo
  instante do corte não entrava. Efeito: a reserva de uma chamada cujo processo morreu fica de pé
  ocupando o teto da empresa até a virada do dia — exatamente o que o coletor existia para evitar.
  Conserto: a regra agora é uma só, escrita igual nas duas consultas.
- **A décima trava de arranque nunca tinha sido vista disparar.** O agendador de rotinas recusa subir
  sem o serviço de assinatura (senão a rotina de empresa suspensa volta a rodar, gastando o teto de
  modelo da ROOT e publicando para fora em nome dela). A asserção estava no código desde a fatia 6.2
  e **nenhum caso a exercia** — era um `throw` dentro de um comentário. As outras nove têm caso; esta
  ganhou o dela agora.
- **Duas tabelas de empresa sem prova de isolamento.** `Assinatura` e `CobrancaDeAssinatura` nasceram
  com policy e **sem semente** — e sem semente o caso "A não lê linha de B" roda contra tabela vazia e
  passa com qualquer policy, inclusive `USING (true)`. Quem pegou foi a catraca do catálogo, que
  compara o registro da suíte com as tabelas que existem no banco. É a mesma armadilha que já tinha
  deixado dez tabelas sem prova na onda 7, e a catraca posta lá foi o que a impediu de se repetir.
- **Dois testes que não mediam o que diziam medir** (o padrão desta execução inteira, agora em 14):
  um media a *forma* do token de sessão sem fixar o relógio, e a tolerância a token sem `typ` vence às
  12:00 UTC de 12/09/2026 — ele ficou vermelho sozinho, no dia, sem uma linha de código ter mudado;
  o outro, o controle negativo do teto de taxa do cadastro anônimo, parava uma tentativa **antes** da
  que distingue "recusa conta" de "recusa não conta", e teria passado igual nos dois mundos.

**O que ficou conferido, item a item, do hand-off da onda:** a constante duplicada do slug da
plataforma sumiu (só `src/tenants/provisionar.ts` a declara, e todo o resto importa); os cinco módulos
novos estão registrados no módulo da aplicação por edição pontual, sem ninguém ter derrubado a linha
de outro; a alçada de quem autoriza suporte é lida **do banco** e não do token de oito horas; a
reautenticação está de pé e a autoridade é reconferida **depois** da conferência de senha (que leva
tempo); a recusa escrita no RASTRO do cliente tem teto de taxa; e a cerca do console inspeciona
**argumentos**, não só o par de modelo e operação.

**O que continua valendo como decisão sua, e não foi tocado:**

- **A semente da migração do console procura o identificador errado** — foi escrita antes da correção
  da constante duplicada. O console nasce **vazio**. A migração não pôde ser corrigida porque migração
  aplicada é imutável; o conserto é uma migração nova. O efeito, por acaso, é na direção segura: a
  superfície nasce menor, não maior.
- **Empresa nova nasce sem linha de assinatura**, e sem linha ninguém é cobrado nem suspenso. É falha
  aberta deliberada — o contrário trancaria a carteira inteira no minuto em que subisse.
- **A tolerância a token sem `typ` já venceu** (12/09/2026, 12:00 UTC) e o código nunca chegou a
  produção. Quando esta branch subir, **toda sessão aberta hoje é recusada de uma vez** e todo mundo
  precisa entrar de novo. Não é perda de dado e não tem conserto a fazer — é um aviso para não
  acontecer no meio de uma demonstração.

---

## 2. O que NÃO foi feito, e por quê

### As quatro fatias declaradas impossíveis desde o começo

Nenhuma delas falhou. Todas quatro têm "pronto quando" que depende de **tempo de produção correndo**
ou de **uma pessoa fazendo algo fora do repositório** — e esta execução não tinha nem um nem outro.

| Fatia | Por que é impossível aqui | O que destrava |
|---|---|---|
| **0.3b** — deploy em produção com `GATEWAY_MODO=observar` | É operação na VPS. A execução tinha proibição explícita de rodar deploy, `docker compose` contra produção ou `git push` | A ordem de deploy do §3, executada por uma pessoa |
| **0.5** — convergência com `operacaoroot/root-os` | O "pronto quando" é uma **reunião**: Pedro e Rodrigo com os dois repos lado a lado, e uma ADR escrita com a decisão | Marcar a reunião. Recomendação do plano segue de pé: base única, backlog do Rodrigo importado, migrations dele **não** entram sem renumerar |
| **3.9** — `GATEWAY_MODO=impor` em produção | O critério é **7 dias com zero rotina travada medidos em `PolicyDecision`**, e o plano pede 2 semanas de observação antes. Não existe atalho: precisa de dias de operação real | 0.3b primeiro, depois o relatório da 3.1 sobre dado de verdade |
| **5.7** — os 2–3 agentes do degrau 1 em rotina no tenant ROOT | Duas travas: **D-A** (quais agentes) é decisão do Pedro, e o critério é **7 dias medidos em `EventLog`** com execuções sem intervenção | Decidir D-A e deixar rodando uma semana |

### O que também ficou de fora, e a razão de cada um

- **0.1 — merge, push e tag.** Regra da execução: nenhum agente empurra, mescla ou toca a `main`. A
  branch continua só no disco, que é o risco nº 1 do próprio plano.
- **0.0 — como o código chega na VPS.** Metade feita: o `.stignore` parou de mandar `.env` e `.git`.
  A outra metade (**N-9**: `git pull` ou rsync explícito no `deploy/up.sh`) é decisão humana e não foi
  tomada.
- **0.6 — backlog no ClickUp.** É `docs/BACKLOG-CLICKUP.md`, pronto para virar tarefa. Criar as
  tarefas no espaço root é operação.
- **3.1 — relatório do modo observar.** A ferramenta existe desde a onda 1; o relatório precisa de
  produção rodando.
- **I.1, I.3, I.4 — infra.** Destino do `marketing-os` (VPS da Root?), Google OAuth (dono e prazo) e
  excluir `root_bio`/`root_bio-db` no easyPanel: as três são decisão ou operação de infraestrutura.
- **4.5 e 6.1 — a metade humana.** O código do onboarding e da carga guiada está na onda 11; os
  critérios ("10 perguntas com fonte, ≥ 9 certas, feito pelo Lucas" e "pessoa que a ROOT nunca viu
  chega à primeira resposta em < 1h, cronometrado") exigem as pessoas.

---

## 3. A ordem de deploy, consolidada

**Este é o item mais importante deste documento.** A ordem cresceu onda a onda e não é a de sempre:
dois passos são **anteriores** ao que antes era o começo, e nenhum deles dá erro na hora — dá
comportamento errado depois. A versão operacional, com os comandos, está em `docs/DEPLOY.md §2.0`;
o que segue é a lista inteira, incluindo o que aconteceu depois daquele texto.

### Antes do merge

| # | Passo | Se pular |
|---|---|---|
| 1 | Rodar `deploy/janela-horaria-ilegivel.sql` (cópia com o motivo em `consulta-antes-do-merge.sql`) **no banco de produção** | A fatia 2.3 fez o sinal de janela horária ilegível **acender** onde antes ficava calado, e acender sobe um degrau em **toda** ação daquela empresa: o que era registro reversível vira saída externa com aprovação. Zero linha = mudança inócua. Linha com `orgId` nulo = a política BASE, e afeta todas as empresas. Sem rodar, você descobre no dia seguinte com a operação inteira um degrau acima |
| 2 | Conferir, **contra um dump da produção**, se existe filho de uma empresa pendurado em pai de outra | A migração de `orgId` da onda 2 é deliberadamente rigorosa e **para** com contagem e exemplo se achar cruzamento. Como `migrate deploy` roda no `command` do container, parar é **a API não subir**. Se existir linha cruzada, o conserto é de dado, não de código, e precisa acontecer antes. Hoje ninguém sabe se existe |
| 3 | CI verde na revisão que vai subir | Sem isso o ensaio do passo 8 vira a primeira execução de tudo |
| 4 | Marcar como obrigatórias, na proteção da `main`: "Tipos e testes (policy, web, api)", "Migrations aplicam do zero" e agora também "Isolamento entre tenants" | **Só o Pedro pode fazer, e é a única coisa da lista assim.** O workflow sozinho não reprova merge nenhum: um pull request vermelho continua podendo ser mesclado. Desde a onda 5 o job de isolamento reprova de verdade — o que sobrou é o pior dos dois mundos, a aparência da prova sem a prova |

### Antes de tocar no servidor

| # | Passo | Se pular |
|---|---|---|
| 5 | Backup do banco do dia (`docs/DEPLOY.md §4`) | Migration aditiva não desfaz. Sem backup, o rollback de estrutura não existe |
| 6 | Variável nova nos **dois** lugares: bloco `environment:` do serviço em `docker-compose.yml` **e** `.env` | O container **não lê arquivo `.env`**: só chega o que está no bloco. Foi o que segurou a `ANTHROPIC_API_KEY` por semanas. Nesta execução entraram: `COFRE_CHAVES` e `COFRE_CHAVE_ATUAL` (vazias = cofre funciona na chave antiga, mas **não rotaciona**), `ROTINAS_CRON` (padrão ligado; único jeito de subir sem relógio), as três do canal de aprovação — `CANAL_APROVACAO_SEGREDO`, `CANAL_APROVACAO_CODIGO_SEGREDO`, `CANAL_APROVACAO_CAPACIDADES` (vazias = canal desligado) — e, da onda 11, o limiar de alerta do painel de custo |
| 7 | `NEXT_PUBLIC_CENTRAL_PIXEL_KEY` como **build arg** da imagem | O Next troca toda `NEXT_PUBLIC_*` pelo valor durante o `next build`. Declarada só no bloco `environment:`, ela nunca chega ao navegador e o rastreio da Central segue caindo na empresa padrão. Trocar a chave exige **reconstruir a imagem**; `docker restart` não muda nada |
| 8 | `docker tag mktos-app:latest mktos-app:rollback` | A imagem anterior vira lixo na próxima poda e o rollback deixa de existir. É o passo que mais dói ter pulado |

### Construir e provar

| # | Passo | Se pular |
|---|---|---|
| 9 | `build` + ensaio da migração num banco descartável + **smoke da imagem compilada** | As duas formas de a subida morrer: migration que não aplica (e falhar é a API não subir) e grafo de injeção do Nest que não resolve. **O typecheck não enxerga o segundo.** Esta execução criou **nove travas que derrubam o arranque de propósito** — a porta sem o provedor de teto, quatro registros sem inscrição ou com inscrição dupla, o módulo de rotinas ausente, e conferências em conectores e no cofre |
| 10 | `db:seed:politica` — **antes de subir**, não depois | A política que vale em runtime é a **do banco**. A onda 7 acrescentou descrição de argumento a capacidades que o código novo já usa, e o esquema do banco tem `additionalProperties: false`: **campo que o esquema antigo não conhece é recusado pela porta**. Subir antes de semear faz toda chamada com campo novo falhar com "argumento inválido" numa ação que o catálogo do repositório diz ser válida. O seed **recusa rodar sozinho** quando a mudança afrouxa: capacidade não declarada valia R5, então acrescentá-la em R3/R4 exige assinatura gravada na versão |
| 11 | O ritual das permissões, **em três passos e nesta ordem**: (1) construir o pacote compartilhado, (2) `db:sync-permissions`, (3) todo mundo sai e entra de novo | Pular o primeiro fazia o comando alinhar em silêncio pelo catálogo antigo — hoje ele **aborta**. Pular o terceiro faz a permissão existir no banco e não no token, que dura horas, e a tela some sem erro. **O comando não é aditivo:** ele realinha com `set:` e **revoga vínculo feito à mão** que não esteja na tabela do código |

### Subir e conferir

| # | Passo | Se pular |
|---|---|---|
| 12 | `up -d --no-build --vps api web` | Sem `--no-build` sobe uma imagem reconstruída na hora, não a que passou no smoke. **Sem `--vps` o compose base publica em `0.0.0.0`** e expõe banco, redis e MinIO na internet |
| 13 | Conferir: `docker compose ps`, a linha de boot `política base vN carregada DO BANCO (62 capacidades)`, as três superfícies públicas, `/rastro` | Aquela linha de boot é a prova de que o passo 10 pegou |
| 14 | Registrar o que subiu (commit/tag) | Enquanto o Syncthing for o transporte, nada no servidor registra isso sozinho |

### A virada do papel restrito — é outra operação, e tem ordem própria

**Hoje, preencher `DB_APP_USER`/`DB_APP_PASSWORD` faz a API recusar subir, de propósito.** Enquanto
não virar, o RLS das ondas 3 a 5 está **inerte**: a aplicação conecta como dona, e dono atravessa
policy.

| # | Passo | Se pular |
|---|---|---|
| 15 | Declarar contexto de plataforma nos **sete** caminhos que consultam o banco antes de haver empresa: login por senha, login com Google, provisionamento, ClickUp, financeiro, carga da política e sonda de saúde | Sob o papel restrito, cada um devolve **zero linha, em silêncio** — o login inclusive, que vira "credenciais inválidas" para a empresa inteira sem nada no log. O arranque compara a lista e recusa subir nessa condição. Enquanto a linha `[tenant] ATENÇÃO: N caminho(s) de plataforma ainda NÃO declaram contexto` existir no boot, **não vire a chave** |
| 15b | **Confirmar** o achado da onda 11: dois serviços de autenticação estariam declarados como caminhos exigidos e **fora** da lista de chamadores autorizados | Se for verdade, no dia da virada o login **para de achar usuário** e o caminho de entrada inteiro morre depois do cadastro. Foi levantado e mandado confirmar; não há veredito |
| 16 | Decidir o **agendamento**: `BYPASSRLS` no papel da aplicação, ou mover a descoberta de rotinas para comando de manutenção com a conexão dona | A pergunta que descobre **quais empresas varrer** é a única consulta do produto sem empresa na sessão. Sob o papel restrito ela volta vazia e calada, por policy: **nenhuma rotina dispara, em empresa nenhuma**, e a causa não é defeito. É decisão humana e **não tem padrão seguro**. **A coleta de quinta da pauta (MC5, `pauta.coleta`) cai junto:** até essa decisão, a rodada da semana só sai pelo "Rodar agora" em `/rotinas` |
| 17 | Dimensionar a fila de conexões (ou adotar um intermediário) | A vazão medida cai perto da metade (tabela na onda 3). A alternativa que eliminaria o custo — adaptador de driver que define o tenant ao pegar a conexão — é **dependência nova**, logo decisão humana |
| 18 | Só então preencher as duas variáveis e recriar o container (`up -d --no-build api`) | Fora de ordem, este passo derruba a API de propósito |

**Uma falha desta migração aparece em banco de verdade sem ser vazamento:** tabela auxiliar criada à
mão no servidor (`backup_leads_2026`, `temp_conciliacao`) faz a conferência final abortar — e abortar
é a API não subir. As duas receitas de conserto estão em `docs/DEPLOY.md`, medidas em 11/09.

**Rollback do isolamento é um comando e não perde as policies:** `SELECT app_rls_desligar();` /
`app_rls_ligar();`. Nenhuma das três funções pode ser chamada pelo papel restrito — é assim que ele
não desliga o próprio isolamento.

### Depois, e só depois

19. Duas semanas de `observar` medidas pelo relatório da 3.1 → decisão de calibragem escrita no ADR →
    `GATEWAY_MODO=impor` (fatia 3.9). `GATEWAY_MODO` é lido no construtor: rollback é
    `up -d --no-build api`, **`docker restart` não serve**.

---

## 4. O que muda de comportamento em produção

Tudo abaixo é mudança deliberada. A lista existe para ninguém descobrir no dia seguinte.

**Na porta e na régua**

1. **Em `observar`, R3+ retém de verdade.** Observar passou a afrouxar o **registro**, nunca o
   **efeito**. Antes, a porta criava a aprovação, escrevia "TERIA RETIDO" e chamava o efeito assim
   mesmo — mandava WhatsApp em nome de quem nunca aprovou.
2. **R5 não é executado em modo nenhum**, e o bypass foi removido *de vez*: qualquer motivo futuro de
   "não permitido" (desligamento por empresa, agente rebaixado, catálogo bloqueado) falha fechado.
   Isso **contraria a letra da fatia**, que dizia que recusa por classificação seguia passando em
   observar, e foi deliberado: a escada diz que R5 é bloqueio, e as constraints proíbem regra
   automática agir no lugar de gente. Sai de graça agora porque nenhuma capacidade R5 tem efeito
   ligado; fechar depois, com o primeiro ligado, sairia caro. **Voltar atrás é reverter um `if`.**
3. **Toda R2 exige aprovação, na prática.** `avaliar()` lê `aprovacaoR2Ligada !== false` e o
   `PolicyService` nunca passa esse campo. Com a porta retendo de verdade, criar lead, criar tarefa e
   criar lançamento passam a **enfileirar**. Diverge do critério do próprio plano ("R0–R2 continuam
   executando normalmente em observar"); ligar a configuração por empresa exige campo novo em `Org`.
4. **`financeiro.lancamento.criar` saiu de R2 e virou R3** — rota viva (`POST /finance/transactions`)
   com ferramenta MCP, ou seja, caminho que um agente chama hoje. Quem criava lançamento sem aprovação
   passa a precisar da assinatura de um responsável. **Consequência estrutural:** a base ROOT ficou
   **sem nenhuma capacidade R2**, e a escada diz que é por R2 que todo cliente estreia em ação — quem
   estreia, estreia em R3.
5. **Janela horária ilegível acende sinal**, e acender sobe um degrau em toda ação daquela empresa.
   Daí o passo 1 da ordem de deploy.
6. **Conteúdo externo agora eleva o nível de verdade.** O sinal existia e não acendia em lugar nenhum.
   Com as três portas ligadas, agente que lê qualquer coisa tem a ação seguinte um degrau acima.
   **Preço declarado:** mais ação vai parar na fila.
7. **Agente que erra duas vezes seguidas fica 24 horas sem passar do primeiro degrau de escrita**, e
   volta sozinho pelo relógio.

**Nas escritas e nas aprovações**

8. **As quatro escritas do Google vão para a fila e exigem outra pessoa.** A regra "quem propôs não
   aprova" é da onda 5 e não foi enfraquecida. **Medição, com ressalva de procedência:** a semente
   cria três usuários na empresa ROOT — um administrador humano e duas contas de máquina, que a regra
   de alçada classifica explicitamente como não sendo gente —, e o login com Google só cria usuário
   novo se o e-mail estiver numa allowlist que **está vazia**. Logo, **na semente**, a ROOT tem **um**
   usuário com alçada, e as quatro escritas ficam permanentemente retidas até existir um segundo.
   **Isso foi medido na semente, não no banco de produção**, que ficou fora do alcance: produção pode
   já ter mais gente. Conferir antes de decidir. O conserto é de operação, não de código.
9. **Leitura do Google passa a escrever no rastro.** Abrir a tela do Gmail deixa marca (chamada,
   decisão e dois eventos, com retenção de cinco anos).
10. **Aprovação com vínculo quebrado passa a REJEITAR a aprovação**, não só recusar a execução. É
    terminal de propósito — vínculo quebrado não é transitório —, mas é mudança de comportamento da
    tela.
11. **R4 e R5 exigem motivo escrito e reautenticação com senha.** Quem entrou pelo **login com Google
    não consegue aprovar R4**: aquele fluxo grava hash de bytes aleatórios como senha, justamente
    para que ela não seja utilizável.
12. **Conta de máquina não confirma nem rejeita.**
13. **Duas permissões novas** (`aprovacoes.ver`, `aprovacoes.decidir`) mudam quem alcança a fila: de um
    papel para seis que veem e quatro que decidem. O papel do financeiro passa a poder assinar
    aprovação de marketing, porque a tabela de alçada já lhe dava o degrau.
14. **REGRESSÃO, e é nossa: publicar peça pela tela não funciona para ninguém.** A tela propõe e
    confirma com o mesmo usuário, na mesma requisição; desde que "quem propôs não aprova" entrou (onda
    5, commit `3adfdc1`, 29/08), a confirmação recusa. Não foi consertado porque o conserto — propor
    **em nome do agente** — muda quem publica sozinho e é decisão do Pedro.
    `apps/api/test/publicar-peca.test.ts` mede a dívida e fica vermelho no dia do conserto.

**Nos tenants, conectores e custo**

15. **Rota de módulo não contratado devolve 404**, não só some do menu. Empresa nova nasce sem módulo
    nenhum e enxerga só a espinha do OS.
16. **O pixel resolve a empresa pela chave**, não mais por `slug: 'root'` fixo. Evento sem chave
    continua caindo na empresa padrão, agora por um caminho com nome e inventário de recusas no log.
17. **A tela de Conexões deixou de mentir** — o estado é sondado. O custo declarado: ela não distingue
    "o aplicativo não tem credencial" de "esta empresa não autorizou"; as duas aparecem como
    desconectado.
18. **Desligar um conector barra de verdade**, inclusive aprovações criadas antes do desligamento.
19. **Com o teto de custo ligado, modelo fora da tabela de preço é recusado.** Atinge o provider
    `openrouter`, cujo modelo padrão não está em `preco.ts`: empresa com teto ligado para de gerar com
    ele, com mensagem dizendo exatamente isso. Três saídas: cadastrar o preço, trocar o modelo padrão,
    ou aceitar a recusa. **Ninguém inventou número de preço.**
20. **A retenção do rastro virou por empresa** (`RastroRetencao.dias` → política → `RASTRO_RETENCAO_DIAS`
    → 1825) e o expurgo é comando, não rotina — manutenção que apaga prova é comando que alguém dá.
21. **O bot do Telegram saiu do compose.** Some o resumo diário agendado (ele cabe nas rotinas, e a
    receita está escrita — mas mandar mensagem para canal externo é saída externa, logo **fica na
    fila**: o briefing viraria aprovação em vez de sair sozinho). Em troca, o compose **deixou de
    exigir** `MCP_SERVICE_PASSWORD` e `MCP_ACTION_PASSWORD`: no servidor, comando de composição que
    antes falhava por variável ausente agora funciona.
22. **O canal de aprovação por WhatsApp, de fábrica, notifica e não decide.** As duas promessas da
    fatia não podem ser verdadeiras juntas para uma capacidade confidencial: "o canal mostra
    exatamente o que vai sair" e "o canal não copia conteúdo não público para fora do sistema". Foi
    deixado no lado seguro, à espera de decisão.

---

## 5. Riscos conhecidos, e o que os contém hoje

### Segurança

| Risco | O que o contém hoje |
|---|---|
| **Senhas de serviço vazadas no histórico do git.** `mcp-service-12345` esteve, entre 07/07 e 31/07, simultaneamente na constante do seed que **cria** a conta `mcp@marketing-os.local`, no valor de reserva do cliente MCP e do telegram, no default do compose e no `.env.example`. Se o seed rodou em produção nesse período sem a variável no ambiente — que era o estado padrão —, a senha em produção **é essa string**. `admin12345` foi `ADMIN_PASSWORD` de 06/07 a 31/07, esteve na tela de login e no compose do commit de deploy. Confirmado por dois agentes, independentemente, direto no histórico | **Pouco.** O repositório `operacaoroot/marketing-os` é **privado**, sem forks e sem estrelas (verificado em 10/09) — a exposição é de quem tem acesso ao repositório, não da internet. Isso muda a urgência de "agora" para "esta semana"; não elimina a troca. As senhas saíram dos arquivos na onda 2, mas **arquivo não é sistema**. **Não existe caminho de rotação no repositório**: não há script, e o seed não é idempotente nem pode rodar em produção |
| **Não existe limite de taxa em lugar nenhum da API.** Dois agentes procuraram, independentemente. Vale para as três rotas anônimas: pixel, avatar e página pública da bio | Nada. Qualquer superfície pública é uma torneira: consulta sem teto, linha de registro sem teto, escrita sem teto onde a rota escreve. Com retenção de rastro de cinco anos, lixo escrito ali fica cinco anos. **É o buraco mais largo dos dez do checklist OWASP** e não era fatia de ninguém |
| **39 de 52 ligações entre tabelas com empresa aceitam apontar para linha de outra empresa** (contagem do estabilizador da onda 5) | Com o papel restrito, vira negação de serviço entre clientes. **Enquanto a aplicação entrar como dona — que é o estado de hoje —, seguir um desses ponteiros numa consulta que traz o relacionamento devolve a linha da outra empresa.** Fica vivo até a virada do §3 |
| **O RLS está inerte em produção** | Por desenho: a virada é operacional e tem a ordem do §3. Até lá, o isolamento é disciplina de quem escreve código, não garantia do banco |
| **A chave de pixel é pública por natureza** | A correção da onda 4 tirou o slug: hoje só o identificador aleatório resolve, o que fecha "quem sabe o nome do cliente escreve no painel dele". O que fecharia de vez — registro por site, com domínio declarado, conferência de origem e teto de taxa — exige tabela nova |
| **O `.env` de produção pode estar no Mac.** O `.stignore` só interrompe o tráfego futuro | Nada. **Alguém precisa conferir e apagar à mão** — nenhum agente pode abrir o arquivo para verificar |
| **O caminho humano não passa pela régua.** Desligar conector, religar conector, alterar permissão de usuário e rotacionar credencial são guardadas só por permissão: a régua as classifica e não as barra, porque a escada roda na porta e a porta é o caminho do agente | Nada além da permissão de papel |
| **Meta, WhatsApp e Obsidian continuam sem trava no caminho HTTP direto**, quando a pessoa clica na tela fora do laço do agente | O ClickUp já pergunta, e `ConectoresService.envolver` existe para os outros. Cada um precisa de uma linha |

### Dado e dinheiro

| Risco | O que o contém hoje |
|---|---|
| **Vault vazio arquiva a memória inteira.** A projeção arquiva toda nota da origem que ela não viu, e a conferência de configuração exige apenas que o **caminho exista**. O caminho configurado na VPS aponta para uma pasta que a documentação do projeto diz **não ser o vault real** | A correção da onda 9 pôs guarda. Mas a **classe** do acidente — conector mal montado destruindo dado que o produto promete guardar — passa a existir no dia em que a memória entrar |
| **Gasto de vetorização invisível ao painel e ao teto.** Dois serviços chamam a API de embeddings direto, porque o provedor de modelo só sabe conversar e a Anthropic não tem esse endpoint. **Medido pelo revisor da onda 10 contra o vault real:** 1.490 notas e 7 MB depois do corte; reindexação **completa**, que não é incremental, perto de 2 milhões de unidades; a volta é de 30 em 30 minutos, logo 48 passadas por dia; ~US$ 0,04 por passada, **US$ 50–60 por mês, perto de R$ 300**. **Duas ressalvas do próprio revisor:** o preço é externo e ele **não pôde conferi-lo sem rede** — trate como ordem de grandeza —, e o lote é **único**, todas as notas numa requisição só, então com esse volume ele provavelmente bate no limite por requisição do fornecedor, e aí o gasto invisível vira **reindexação que falha**, que talvez seja pior | Nada: não passa pelo teto por empresa e por dia que a onda 6 construiu, e **não existe fatia no plano que pague isso** |
| **A documentação gerada afrouxa, em proporção, a guarda que protege as notas reais.** As páginas geradas são notas dentro do vault: entram no laço de reindexação (a conta quase dobra) e entram no **denominador** do teto de arquivamento, que é uma fração do que está vivo — com 400 páginas ele sobe de 20 para 100 | A recomendação escrita é a reindexação ignorar a documentação gerada, ao preço de ela não aparecer na busca semântica. **Ainda não decidido** |
| **A tela de Agentes mente, e é um número de venda.** As horas devolvidas multiplicam os minutos declarados por **todas** as passagens, inclusive as que **falharam**; o indicador se chama "horas por semana" e é acumulado de **vida inteira**; e a fórmula aparece escrita na tela. A onda 10 criou uma consequência nova: **as duas telas publicam versões contraditórias do mesmo número** sob rótulos quase iguais — Rotinas mostra semanal medido do log real, Agentes mostra vitalício inflado. Confirmado pelo revisor, os três na origem | Nada. **Não demonstrar a cliente antes de consertar:** é o número que sustenta renovação e venda |
| **Uma conta de máquina com seis permissões de escrita e nenhum cliente.** Com o bot aposentado, a conta de ação da IA ficou sem consumidor, mas a semente continua criando-a, exigindo a senha dela e dando-lhe editar leads, campanhas e tarefas, responder e-mail, editar agenda e editar arquivos no Drive | Nada. Credencial viva sem dono é superfície de ataque, não sujeira cosmética |
| **Backup sem cópia off-site** | O backup existe, verifica o dump e tem restore testado semanalmente. Mas está **no mesmo disco do banco**: não sobrevive a perder a VPS |

### Processo

| Risco | O que o contém hoje |
|---|---|
| **Verificação que parece proteger e não protege.** Esta execução encontrou o padrão **catorze vezes** (as duas últimas na estabilização da onda 11), em oito formas: teste que nunca roda (o `test:isolamento` existia no `package.json` "desde sempre" e nunca executou a suíte — o arquivo estava no `exclude`, e o argumento posicional do vitest é filtro aplicado **depois** do glob); guarda que falha aberta; catraca dentro de trabalho que não reprova; defesa testada contra entrada que a produção não produz; catraca que lê o arquivo errado; contagem que mede a fonte errada; teste que **não pode falhar** porque o ambiente de teste não tem a peça que quebra em produção; e teste com **data de validade** — que mede certo hoje e vira vermelho sozinho amanhã, sem uma linha de código mudar | A disciplina que ficou: **controle negativo** — montar o caso de modo que ele falhe quando a defesa sair. Foi o que a correção do mapa fez (emulou captura de ponteiro no teste e **reintroduziu o defeito** para provar que o caso fica vermelho) e o que a varredura do cofre fez (escreveu casos que **devem** vazar). **Lição que vale para tudo: script que existe não é prova de que roda** |
| **A `main` continua sendo o que roda em produção**, cinco semanas atrás, e as 14 mil linhas mais estas dez ondas seguem **só no disco** | Nada. É o risco nº 1 do próprio plano, e o passo 0.1 não foi dado |
| **57 arquivos de teste ficam no ponto cego da catraca de arquitetura** | Declarado no comentário, com o preço escrito. Não tem conserto neste desenho: a própria catraca cita os nomes que procura dezenas de vezes e se acusaria |
| ~~**A onda 11 não está commitada e não foi verificada de ponta a ponta**~~ — **resolvido em 12/09/2026**: commitada, com as seis suítes medidas e os pisos da CI atualizados. Os quatro registros compartilhados foram reconciliados e conferidos um a um | Ver §1, onda 11, para o que a conferência encontrou — inclusive um defeito real no coletor de reservas do teto de IA e duas tabelas sem prova de isolamento |

### Veredito de segurança registrado

`docs/AUDITORIA-SEGURANCA.md` tem o histórico das três revisões dos dez itens do OWASP LLM Top 10 e é
a fonte para o estado item a item. Vale registrar como se comportou: **um veredito foi corrigido para
pior** na revisão adversarial da própria fatia 3.8 (o sinal de escalonamento por procedência externa
caiu de PARCIAL para **NÃO ATENDE**, pelo motivo exato de que **efeito produtivo zero não é
atendimento parcial**), e depois **para melhor** quando a ligação da onda 8 acendeu o sinal de verdade
no caminho real. Continuam como **NÃO ATENDE**: contexto carregado pelo cliente virando regra da casa
sem validação, e "um agente, um trabalho" sem teste que verifique.
