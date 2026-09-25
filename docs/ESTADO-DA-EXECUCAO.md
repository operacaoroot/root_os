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

### Onda MC-A — entrada da máquina de conteúdo · `5fab6e5` (23/09/2026)

Frente nova, fora da numeração do plano de continuidade: `docs/PLANO-MAQUINA-DE-CONTEUDO.md`,
fatias MC1 a MC6. **Branch `root-os/maquina-de-conteudo`**, saída de `origin/main` do
`operacaoroot/marketing-os`, com o plano em `d8b20be`. Nada empurrado, nada mesclado, nada na VPS.

Seis commits, um por fatia, na ordem MC1 → MC2 → MC3 → MC4 → MC6 → MC5. A MC6 veio antes da MC5
porque é ela que cria o status `aguardando_curadoria`, onde a rotina de quinta deixa a rodada.

| Fatia | Commit | O que entrou | Parcial? |
|---|---|---|---|
| MC1 | `1f88073` | Link colado no grupo de WhatsApp vira captura em `/referencias`. Não há endpoint novo: a Evolution só aceita uma URL de webhook por instância, então o webhook do canal de aprovação (`POST /approvals/canal/whatsapp/:orgId`) desvia o grupo `EVOLUTION_LINKS_JID` para `pauta/entrada-de-links.service.ts` antes de o canal ler. Parser puro, deduplicação por `urlHash` | **Sim.** Só liga com o grupo criado, a variável preenchida e o canal de aprovação configurado, e isso é tarefa do Pedro. O critério "aparece em menos de 1 min" só se mede em produção; aqui, do webhook à captura leva menos de 1 s. A escrita foi medida com o dono do banco, não com o papel restrito |
| MC2 | `fb29ab4` | Tipo `gmail` em `PautaFonteTipo`. A etiqueta fica em `handle`, e a leitura passa **pela porta** com as capacidades R0 `comunicacao.email.buscar`/`ler`. Google ausente vira erro na fonte e não derruba a rodada | **Sim.** Se a empresa subir a leitura do Gmail para R2 ou mais, a coleta fica retida (no máximo uma aprovação por rodada, documentado em `docs/PAUTA.md`). O permalink usa `/mail/u/0/`, que pode abrir outra conta para quem tem várias logadas |
| MC3 | `24fff3d` | Tipo `busca` implementado: `ApifyService.buscarNoGoogle` (`apify~google-search-scraper`, Brasil, `d7`). O run é reservado antes da chamada e o custo é rateado nas capturas. Teto estourado pula a fonte com aviso | **Sim.** O actor não rodou contra o Apify real, então falta conferir se `languageCode: 'pt-BR'` é aceito e se `resultsPerPage` ainda tem efeito. A chamada herda a exceção de arquitetura que já existia para o perfil ("onda 8 — resto da 3.3"); nenhuma exceção nova. O `handle` subiu de 60 para 200 caracteres |
| MC4 | `93dd440` | X (`apidojo~tweet-scraper`) e YouTube (`streamers~youtube-scraper`). O perfil entra na coleta da rodada, e a rodada lê todas as origens com rótulo W/N/R/C/L. `origens: ['R','N']` reproduz a rodada antiga | **Sim.** Os dois actors e os campos de entrada e saída seguem o schema público e não rodaram contra o Apify real. **Mudança de gasto:** rotina sem `origens` passa a coletar os perfis ativos, a 1 run por perfil por disparo. `origens` só se muda pela API |
| MC6 | `48a9313` | Curadoria humana. O modo novo `gerarParaCuradoria` põe todos os candidatos da janela (até 200) com a sugestão da IA, e o operador marca na aba "Curadoria" de `/pauta`. Só os marcados seguem. A newsletter entra como `semLinkPublico` e nunca vira link publicado. O modo antigo (`gerar`) ficou intacto | Não no código. A aba não foi aberta num navegador real. Em aberto: os sugeridos já virem marcados (é uma linha em `aplicarSugestoes`) |
| MC5 | `5fab6e5` | Executor `pauta.coleta`: conta as fontes, coleta por origem (uma fonte que falha não derruba as outras) e gera em `aguardando_curadoria`, sem curar. Rotina criada por `POST /rotinas` ou pelo botão "Nova rotina de coleta" em `/rotinas` (quinta 22h, São Paulo, 168h) | **Sim.** Sob o papel restrito ela não dispara (passo 16 do §3). A rodada nasce com `rotinaId` nulo, e a aba mostra "rotina: —". A tela `/rotinas` a 375px não foi vista |

**Medido no fechamento** (Mac, banco de teste descartável `marketing_os_test` no container
`mktos-mc-db`, pgvector pg16, política semeada, 23/09/2026 ~22h):

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | 7 de 7 tarefas verdes |
| `pnpm --filter @mktos/api typecheck:test` | limpo |
| `pnpm test` (turbo) | policy **74** em 2 arquivos · api **1479 passando / 557 pulados** em 53 arquivos (48 + 5 pulados) · web **420** em 32 arquivos |
| `pnpm --filter @mktos/api test` direto, com `TEST_DATABASE_URL` | **2036 de 2036** em 53 arquivos. Os 557 pulados do turbo são os casos que pedem banco: o turbo não repassa `TEST_DATABASE_URL` à tarefa |
| `pnpm --filter @mktos/api test:porta` | **39** |
| `pnpm --filter @mktos/api test:isolamento` com `TENANT_DATABASE_URL` no papel restrito | **319** em 1 arquivo. A onda não criou tabela, então não houve semente nova. Para rodar foi preciso dar ao `mktos_app` a senha da CI (`ALTER ROLE ... LOGIN PASSWORD 'ci'`, o mesmo passo do `ci.yml`) no container descartável. Sem a conexão restrita a suíte mede o dono e dá 193 falhas, que é o comportamento esperado da suíte |
| `pnpm --filter @mktos/api db:diff` | `No difference detected.` |
| `pnpm --filter @mktos/api build` + `smoke` | **SMOKE OK.** As cinco rotas padrão responderam 401. As rotas novas da onda aparecem mapeadas no boot: `POST /api/approvals/canal/whatsapp/:orgId`, `POST /api/pauta/rodadas/curadoria`, `PUT` e `POST …/:id/curadoria[/confirmar]`, `POST /api/rotinas`. Linha de boot: `política base v1 carregada DO BANCO (62 capacidades)`, e 21 capacidades com efeito ligado. Variáveis do smoke, todas descartáveis: `JWT_SECRET` de teste, `ROTINAS_CRON=off` e os seis intervalos de sincronização em 0, como em `docs/DEPLOY.md` §2.3 |

Contra a linha de base de antes da onda (api 1233 / 557, web 398, policy 74): **+246 casos na
api** (seis arquivos novos: `grupo-de-links`, `pauta-gmail`, `pauta-busca`, `pauta-perfil`,
`pauta-curadoria`, `pauta-coleta-rotina`), **+22 no web** (`pauta-curadoria`, `rotinas-coleta`).
Policy igual. Os pisos da CI subiram fatia a fatia, com a conta no comentário: api 1458/45 e web
258/23. **O fechamento não achou nada quebrado pela onda, e por isso não há commit de conserto.**
O boot com o provider novo do executor, que o MC5 tinha deixado sem conferir, passou no smoke.

**O que não foi feito, e por quê:**

- **Nada rodou contra sistema externo.** Os actors do Apify (busca, X, YouTube), o Gmail real e o
  webhook real da Evolution nunca foram chamados. A execução não podia sair da máquina. O primeiro
  run de cada um precisa ser conferido: formato do item e custo por run. O `tweet-scraper` pode
  ter cobrança mínima por consulta.
- **As três chaves de URL continuam separadas.** O RSS grava `urlHash` pela própria regra, e a
  busca e o grupo usam `normalizarUrlDaCaptura`. Unificar mudaria o hash contra as capturas já
  gravadas, e os itens ainda presentes nos feeds entrariam de novo. A curadoria junta a mesma
  matéria antes do prompt (`umaPorMateriaDoInsumo`). Se o Pedro quiser unificar, é outra fatia.
- **`origens` não tem controle na tela de Rotinas.** Só pela API.
- **A consulta à política antes da porta** (para a coleta do Gmail não criar aprovação quando a
  empresa sobe a leitura para R2+) não existe. Criar essa consulta mexeria no núcleo de governança.
- **O `next lint` do web** não está configurado e abre o assistente interativo. Não rodou.
- **As fases 2 a 4 (MC7 a MC18) e as decisões D-MC2 a D-MC9** ficaram fora da onda, por escopo.

**Ordem de deploy desta onda.** Vale por cima da ordem consolidada do §3, que continua inteira:

| # | Passo | Se pular |
|---|---|---|
| A1 | Backup e tag de rollback, como no §3 (passos 5 e 8). **E a receita de volta (A1-volta, abaixo) fica à mão antes do `up`** | Os dois `ALTER TYPE ... ADD VALUE` não se desfazem: o Postgres não remove valor de enum. E a imagem de antes **não lê** linha com valor novo: o Prisma dela não conhece `aguardando_curadoria` nem `gmail`, e valor de enum fora do client gerado é erro de conversão, não valor ignorado |
| A2 | `db:deploy` aplica, nesta ordem, `20260924020000_pauta_fonte_gmail` (`PautaFonteTipo += gmail`) e `20260924050000_pauta_rodada_aguardando_curadoria` (`PautaRodadaStatus += aguardando_curadoria`). Nenhuma tabela nova e nada muda no RLS. Conferir antes com `db:status`: se a produção ainda não tiver as migrations anteriores da `main` (`20260917010000_esteira_de_clientes`, `20260924010000_onboarding_do_cliente`), elas entram antes, na ordem do nome | Código novo contra enum antigo: cadastrar fonte Gmail e gerar rodada para curadoria falham no Prisma com valor de enum inválido |
| A3 | Variáveis novas: `EVOLUTION_LINKS_JID` e `EVOLUTION_LINKS_ORG_ID` (a empresa dona do grupo — o id da org da Root), já declaradas no bloco `environment:` do serviço `api` no `docker-compose.yml` e no `.env.example`. Na VPS, preencher as duas no `.env` e recriar o container (`up -d --no-build api`) | Qualquer uma vazia, o grupo de links fica desligado (o boot avisa), que é o padrão seguro. Sem a empresa, o webhook de outra empresa cuja instância esteja no grupo gravaria cada link lá. `docker restart` não pega a variável |
| A4 | **Nada de `db:seed:politica` nem de `db:sync-permissions` por causa desta onda.** A política e as permissões não mudaram: a coleta do Gmail usa as capacidades R0 que já existiam, e as telas usam `pauta.ver`, `pauta.editar` e `automacoes.executar`. Se o deploy levar também commits anteriores que mexem nisso, vale o §3 deles | — |
| A5 | Smoke da imagem com `ROTINAS_CRON=off` antes do `up` (§3, passo 9) | O executor `pauta.coleta` é provider novo no `RoutinesModule`. Aqui ele subiu, mas quem vale é o smoke da imagem construída |

**A1-volta — antes de subir a imagem de antes** (`mktos-app:rollback`), a partir da primeira rodada
em curadoria ou da primeira fonte Gmail. Sem isso, `GET /pauta/rodadas` e a aba Radar de
`/referencias` respondem 500 para a empresa inteira: `listarRodadas` e a lista de fontes da `main`
não filtram por status nem por tipo, e as capturas lidas com a fonte junto caem no mesmo erro. A
migration não volta — valor de enum não se remove —, então a volta é de **dado**:

```bash
# 1. Guardar o original FORA do banco (tabela auxiliar em `public` faz a conferência do isolamento abortar).
docker exec -i mktos_db psql -U mkt -d marketing_os -c "\copy (SELECT id, status FROM \"PautaRodada\" WHERE status = 'aguardando_curadoria') TO STDOUT CSV" > volta-rodadas.csv
docker exec -i mktos_db psql -U mkt -d marketing_os -c "\copy (SELECT id, tipo, ativo FROM \"PautaFonte\" WHERE tipo = 'gmail') TO STDOUT CSV" > volta-fontes.csv
# 2. Levar as linhas a valores que a imagem antiga conhece.
docker exec -i mktos_db psql -U mkt -d marketing_os <<'SQL'
BEGIN;
UPDATE "PautaRodada" SET status = 'falhou', erro = 'volta da imagem: aguardava curadoria (ver volta-rodadas.csv)' WHERE status = 'aguardando_curadoria';
UPDATE "PautaFonte" SET tipo = 'manual', ativo = false WHERE tipo = 'gmail';
COMMIT;
SQL
```

`falhou` porque a imagem antiga não tem o que fazer com uma lista de candidatos; `manual` + pausada
porque a coleta antiga não sabe ler o Gmail. Ao voltar para a imagem nova, os dois CSV dizem o que
restaurar (`UPDATE … SET status = 'aguardando_curadoria' WHERE id IN (…)`; `tipo = 'gmail'` e o
`ativo` guardado). Se ninguém quiser guardar nada, a outra saída é declarar que, a partir da
primeira linha com valor novo, a volta é **só por restauração do backup do passo A1**, perdendo o
que entrou depois dele. As tabelas e colunas da MC-B e da MC16 não pedem nada: a imagem antiga não
as consulta (o Prisma lista as colunas que conhece), e só apagar uma rodada que já virou episódio
dá erro (FK `RESTRICT`), como deve.

**Tarefas do Pedro, fora do repositório** (nenhum agente pode fazer):

1. **Grupo de links (D-MC10):** criar o grupo "Root · links" com o número da instância dedicada do
   root. Pegar o JID do grupo (termina em `@g.us`) e preencher `EVOLUTION_LINKS_JID` no `.env` da
   VPS, com o id da org da Root em `EVOLUTION_LINKS_ORG_ID`. Conferir que o webhook da instância tem o evento `messages.upsert` apontando para
   `/approvals/canal/whatsapp/<orgId do root>`, com o cabeçalho `x-canal-segredo`. **Sem o canal
   de aprovação configurado** (`CANAL_APROVACAO_SEGREDO` e as outras do passo 6 do §3), o grupo de
   links também fica desligado.
2. **Gmail:** conectar a conta Google da empresa em Integrações e criar no Gmail uma etiqueta só
   para as newsletters. Depois, cadastrar a fonte `gmail` com essa etiqueta em
   `/referencias → Radar`. Quem cadastra precisa de `gmail.ver`.
3. **Busca:** cadastrar em Radar as fontes de busca com a consulta do nicho. Cada disparo gasta 1
   run por fonte. Com o teto padrão de 30 por mês e a rotina uma vez por semana, cabe com folga.
4. **Creators:** cadastrar os perfis do X e do YouTube em Radar e **revisar o teto dos perfis que
   já existem**, porque perfil agora entra na coleta automática. Para manter o gasto de antes,
   gravar `origens` na config da rotina.
5. **Rotina de quinta:** depois do deploy, criar na empresa root pela tela `/rotinas` ("Nova
   rotina de coleta") ou por `POST /rotinas`. Nada foi criado no banco de produção.
6. **Decisões de produto em aberto:** sugeridos já virem marcados na curadoria (MC6); unificar a
   chave de URL do RSS; cercar o texto do grupo como conteúdo externo no prompt da ficha (hoje ele
   entra como a nota digitada na tela).

**Aviso do papel restrito, e ele vale para esta onda inteira.** Quando o papel restrito virar
(passos 15 a 18 do §3), a consulta que descobre quais empresas varrer volta vazia sob policy e
**nenhuma rotina dispara**, em empresa nenhuma, a coleta de quinta inclusive. É o passo 16, e ele
não tem padrão seguro: `BYPASSRLS` no papel da aplicação, ou mover a descoberta para um comando de
manutenção com a conexão dona. Até essa decisão, a rodada da semana só sai pelo "Rodar agora" em
`/rotinas`. O grupo de links não depende de rotina (entra pelo webhook, sob `comTenantPublico`),
mas a escrita dele ainda não foi medida com `TENANT_DATABASE_URL`.

### Onda MC-B — do episódio à newsletter · `23fa681` (24/09/2026)

Fases 2 e 3 do `docs/PLANO-MAQUINA-DE-CONTEUDO.md`, fatias MC7 a MC13, na mesma branch
`root-os/maquina-de-conteudo`, por cima do fechamento da MC-A (`a72ddd9`). Nada empurrado, nada
mesclado, nada na VPS. Sete commits, um por fatia, na ordem do plano.

| Fatia | Commit | O que entrou | Parcial? |
|---|---|---|---|
| MC7 | `668992e` | Entidade `PautaEpisodio` (migration `20260924060000_pauta_episodio`), 1:1 com a rodada `curada`, número sequencial por empresa, status de `roteiro` a `concluido` andando um passo por vez (`transicaoDoEpisodio`, shared). Filho com sentinela `''` + gatilho `mktos_orgid_do_pai` para a rodada **e** para `bioPageId`, que virou FK para `BioPage` com `SET NULL`. Aba "Episódios" em `/pauta` e "Criar episódio" nas abas Rodadas e Curadoria | Não no código. Duas decisões esperam o Pedro: do Concluído dá para voltar a Agendado; e coleta/curadoria continuam sendo status da rodada, não do episódio (o plano listava as duas no episódio). A aba foi vista a 375px no fechamento (abaixo) |
| MC8 | `5dc2149` | Roteiro: `SYSTEM_ROTEIRO` devolve ordem e texto, o sistema monta o markdown com o link do item (nunca o do modelo) e a palavra de corte no topo. Gerar leva a `gravacao`; editar com versão lida; `.md` para abrir na gravação; espelho opcional. Palavra de corte por episódio (migration `20260924070000_pauta_episodio_palavra_de_corte`) ou por empresa (nota `pauta.palavra-de-corte`), padrão `root, corta` | **Sim.** D-MC2 (a palavra) é do Pedro. Nenhum LLM real foi chamado: o formato do prompt só foi provado com dublê. O espelho no Drive e na vault real não foi exercitado |
| MC9 | `9ff2142` | `tools/root-midia` (Node 22, sem dependência: silêncios, palavra de corte, cortar, transcrever pelo `whisper-cli`, enviar) e a skill `/root-midia`. O vídeo **fica no Mac**; o OS recebe só o leve por `GET …/pendentes-midia`, `POST …/:id/midia` (→ Edição) e `POST …/:id/transcricao` (→ Pacote), pelo login normal da API | **Sim.** Sem modelo do whisper (D-MC3) não houve bruto real de 10 min, e sem ele a palavra de corte não é detectada. O caminho pelo PalmierPro está só descrito: o MCP dele recusou conexão (app fechado). Transcrição acima de ~40 min de fala esbarra no corpo de 100 kB do Nest |
| MC10 | `1d6becb` | Perfil de voz: `POST /pauta/voz/aprender` destila as transcrições (e textos colados) por `SYSTEM_VOZ` e grava versão nova da nota `voz.pedro` pelo `MemoriaService` (caminho da ADR-011, exceção registrada na própria ADR); `VozService.bloco` entra no roteiro e nas peças. Aba "Voz" | **Sim.** O critério é o teste cego com o Pedro. A curadoria (`SYSTEM_CURADORIA`) ficou com a voz própria. A rota exige `pauta.editar`, não `obsidian.editar`, com a chave presa ao prefixo `voz.` — confirmar com o Pedro |
| MC11 | `b9235c2` | Pacote do YouTube: 3 títulos, descrição com capítulos conferidos pelas regras do YouTube (consertados ou tirados com motivo), links só de item com link público, 3 briefs de thumb; `root-midia thumbs ep-NN` renderiza `thumb.html` num Chrome sem janela e sobe o PNG (≤ 2 MB) para o MinIO | **Sim.** Falta a transcrição de um episódio real. O upload das thumbs contra um MinIO de verdade não foi provado (o ambiente de teste não tem `S3_*`). Thumb substituída fica no MinIO (o `StorageService` não apaga). As fontes vêm do Google Fonts na hora do render |
| MC12 | `5c7df88` | Página de links: uma `BioPage` por episódio (handle `<slug>-ep-NN`), um botão por matéria de link público e os links da casa da nota `pauta.pagina-de-links.chamadas`, idempotente por `BioLink.chave` (migration `20260924080000_pauta_pagina_de_links`). Publicar passa pelo mesmo `BioService.publicar` do `/bio` e exige `pauta.publicar` + `bio.editar`. A peça do grupo sai com link de campanha medido na página do episódio no ar | **Sim.** Falta publicar e clicar de verdade em `bio.operacaoroot.com`. **Mudança de comportamento:** peça de rodada sem episódio no ar sai com o link cru (motivo no `rastreio`); antes era medida pela primeira `BioPage` da empresa |
| MC13 | `23fa681` | Newsletter tirada da transcrição, gravada como `PautaPeca` newsletter/email da rodada, com a checagem anti-slop pura do shared (refaz uma vez; persistindo, grava com os apontamentos), `.md`/`.html` para copiar, marcadores `{{pagina-de-links}}` e `{{video}}` trocados quando existem | **Sim.** D-MC7 (destino) está em aberto: não há rota de envio e o canal newsletter segue recusado com 400. Falta a transcrição real e a conferência do texto com o Pedro |

**Medido no fechamento** (Mac, banco de teste descartável `marketing_os_test` no container
`mktos-mc-db`, pgvector pg16, política semeada, 24/09/2026 ~02h40):

| Comando | Resultado |
|---|---|
| `pnpm typecheck` (com `--force`, sem cache do turbo) | 7 de 7 tarefas verdes |
| `pnpm --filter @mktos/api typecheck:test` | limpo |
| `turbo run test --force` | policy **74** em 2 arquivos · api **1847 passando / 570 pulados** em 56 arquivos (+ 5 pulados) · web **506** em 39 arquivos |
| `pnpm --filter @mktos/api test` direto, com `TEST_DATABASE_URL` | **2417 de 2417** em 61 arquivos |
| `pnpm --filter @mktos/api test:porta` | **39** |
| `pnpm --filter @mktos/api test:isolamento` com `TENANT_DATABASE_URL` no papel restrito (`mktos_app`/`ci`) | **326** em 1 arquivo. Os +7 são a semente de `PautaEpisodio`, a única tabela nova da onda |
| `pnpm --filter @mktos/api db:diff` | `No difference detected.` |
| `db:deploy` num banco **novo** (`marketing_os_e2e`, criado vazio no mesmo container) | todas as migrations aplicam do zero, as três da onda inclusive; depois `db:seed:politica` (62 capacidades) e `db:seed` com senhas descartáveis |
| `pnpm --filter @mktos/api build` + `smoke` | **SMOKE OK** duas vezes: as cinco rotas padrão e, com `SMOKE_ROTAS`, `/api/pauta/episodios`, `/api/pauta/episodios/pendentes-midia` e `/api/pauta/voz`, todas 401. As 29 rotas novas de `/api/pauta/episodios/…` e `/api/pauta/voz…` aparecem mapeadas, e `pendentes-midia` antes de `:id`. Linha de boot: `política base v1 carregada DO BANCO (62 capacidades)`, 21 capacidades com efeito ligado. Variáveis descartáveis: `JWT_SECRET` de teste, `ROTINAS_CRON=off` e os seis intervalos em 0 |

Contra a linha de base da MC-A (api 2036 em 53 arquivos, web 420 em 32, policy 74, porta 39,
isolamento 319): **+381 casos e +8 arquivos na api** (`pauta-episodio`, `pauta-roteiro`,
`pauta-midia`, `root-midia`, `pauta-voz`, `pauta-pacote`, `pauta-pagina-de-links`,
`pauta-newsletter`), **+86 casos e +7 arquivos no web** (um `component/pauta-*` por fatia), +7 no
isolamento. Policy e porta iguais. Os pisos da CI subiram fatia a fatia, com a conta no comentário
(web 332/30; api 1778/53). **O fechamento não achou nada quebrado pela onda, e por isso não há
commit de conserto.**

**Ensaio ponta a ponta, local** (feito antes da revisão; as correções dela estão cobertas pelos
testes, e o ensaio não foi refeito). API compilada (`dist/main.js`) contra o banco novo
`marketing_os_e2e`, com a conta `admin@marketing-os.local` do seed e senha descartável. O LLM foi
um **dublê** local compatível com Chat Completions (`LLM_PROVIDER=openai`, `OPENAI_BASE_URL` em
`127.0.0.1`, chave falsa), que devolve JSON fixo no formato de cada prompt. Nenhuma chave real.
Duas fontes e três capturas inseridas por SQL (um RSS com duas matérias e uma newsletter de origem
L com permalink do Gmail). O que rodou de verdade, em ordem:

1. `POST /pauta/rodadas/curadoria` → rodada em `aguardando_curadoria` com 3 candidatos e a
   sugestão da IA; marcar e confirmar → `curada`.
2. `POST /pauta/episodios` → `ep-01` em `roteiro`; `…/roteiro/gerar` → `gravacao`. O roteiro saiu
   com a palavra `root, corta` no topo, o link de cada matéria pelo item e, na newsletter L,
   "sem link público — cite <fonte>" (o permalink do Gmail não aparece).
3. `tools/root-midia`: bruto sintético de 200 s (ffmpeg, dois silêncios) → `silencios` → `cortes`
   → `cortar` (189,8 s, reencodado) → `pendentes` → `enviar ep-01 --final --cortes --transcricao`
   com uma transcrição **escrita à mão** (6 segmentos; não houve whisper) → `edicao` e depois
   `pacote`.
4. `…/pacote/gerar` → 3 títulos, 3 capítulos conferidos, os dois links públicos, o marcador da
   página e 3 briefs de thumb.
5. `…/pagina-de-links` → `BioPage` `root-ep-01` com 2 botões e o aviso da newsletter que ficou de
   fora; `…/publicar` → no ar; a descrição do pacote passou a sair com
   `https://bio.operacaoroot.com/@root-ep-01` no lugar do marcador. `GET /api/bio/public/page/root-ep-01`
   devolveu os dois botões; `GET /api/bio/r/<linkId>` com cookie `rid` → 302 para a matéria e uma
   linha `link_click` em `BioEvent` e em `PixelEvent`.
6. `…/newsletter/gerar` → checagem aprovada, uma seção por matéria falada (a L sem linha "Fonte");
   `PUT …/newsletter/video` e o `.md`/`.html` com os dois marcadores trocados.
7. `POST /pauta/voz/aprender` com o episódio → nota `voz.pedro` versão 1.
8. Status até `agendado` e `concluido`; gerar o pacote depois disso é recusado com 400.

O RASTRO ficou com uma linha por passo (`pauta.rodada_para_curadoria`, `…curadoria_marcada`,
`…curadoria_confirmada`, `…episodio_criado`, `…episodio_roteiro_gerado`, `…episodio_midia`,
`…episodio_transcricao`, `…episodio_pacote_gerado`, `…episodio_pagina_de_links`,
`bio.page_create`, `bio.page_publish`, `…newsletter_gerada`, `…newsletter_video`, três
`…episodio_status`). O dublê recebeu 5 chamadas, todas reconhecidas. `root-midia ensaio` e
`ensaio-thumb` (1280×720, 573 kB, Chrome de `/Applications`) também passaram.

Com o web em `next dev` contra essa API, a aba Episódios e o detalhe inteiro do `ep-01` foram
abertos num Chrome sem janela (agent-browser) a **375×812**: `scrollWidth` 375, nenhum elemento
passando da borda, linha do tempo e seções quebrando linha. O único alerta da página é o de
hidratação do `data-os-theme` no `<html>`, que vem de `d81991a`, anterior à frente.

**O que não rodou no ensaio:** LLM real (os prompts nunca viram um modelo), whisper (sem modelo),
PalmierPro (app fechado), `root-midia thumbs` com upload (sem MinIO/`S3_*`), espelho no Drive/vault,
a peça do WhatsApp com o link de campanha (coberta só pelos testes do serviço) e o papel restrito
na API de pé (o ensaio conectou como dono; o isolamento das tabelas novas foi medido pela suíte).
O banco `marketing_os_e2e` ficou no container descartável.

**O que não foi feito, e por quê:**

- **Nada rodou contra sistema externo nem com gravação real.** Os critérios de MC9, MC11 e MC13
  ("bruto real de 10 min", "episódio real", "frases ditas no vídeo") dependem do modelo do whisper
  e de uma gravação do Pedro.
- **As decisões de produto ficaram com o Pedro** (lista abaixo). Nenhuma foi tomada por agente
  além do que cada fatia registrou como decisão provisória.
- **MC14 a MC18 e D-MC6, D-MC8, D-MC9** ficaram fora da onda, por escopo.
- **A limpeza de thumbs antigas no MinIO** e o **limite de corpo de 100 kB** do Nest são decisões
  de quem cuida da API; nenhuma foi mexida. (O limite do corpo foi resolvido na MC-R, só para as
  rotas de mídia.)
- **Problema anterior à frente, achado no MC12 e não corrigido:** `destinoDosItens`
  (`curadoria-da-rodada.ts`) pode escolher o permalink do Gmail de uma newsletter antiga sem a
  marca `semLinkPublico`, e a peça do WhatsApp mandaria esse link privado ao grupo. (Corrigido na
  MC-R, com a regra única de `pauta/link-publico.ts`.)

**Ordem de deploy desta onda.** Soma-se à da MC-A (A1–A5) e à consolidada do §3:

| # | Passo | Se pular |
|---|---|---|
| B1 | Backup e tag de rollback, como no §3 (passos 5 e 8); a receita A1-volta vale também aqui | As três migrations são aditivas e não se desfazem sozinhas. Tabela e colunas novas não quebram a imagem antiga; os valores de enum da MC-A, sim |
| B2 | `db:deploy` aplica, nesta ordem e depois das da MC-A: `20260924060000_pauta_episodio` (tabela `PautaEpisodio` com RLS FORCE, policies de leitura e escrita, gatilhos `mktos_orgid_do_pai` para a rodada e para a `BioPage`), `20260924070000_pauta_episodio_palavra_de_corte` (coluna nula) e `20260924080000_pauta_pagina_de_links` (coluna nula `BioLink.chave` + índice único `(pageId, chave)`, sem conflito: hoje todos os valores são NULL); e, por último, a da MC16, `20260924090000_pauta_peca_agenda` (ver a seção da fatia). Só usa funções que já existem (`mktos_orgid_do_pai`, `app_rls_aplicar_policies`). Ensaiar antes num banco descartável, como manda o §3 | Código novo contra tabela ausente: toda a aba Episódios responde 500 |
| B3 | **Nenhuma variável nova na API.** As seis do `tools/root-midia` (`ROOT_OS_API_URL`, `ROOT_OS_EMAIL`, `ROOT_OS_SENHA`, `WHISPER_MODEL`, `ROOT_MIDIA_PALAVRA`, `ROOT_MIDIA_CHROME`) são **só do Mac**, catalogadas comentadas no `.env.example` e fora do `docker-compose.yml` de propósito | — |
| B4 | **Nada de `db:seed:politica` nem de `db:sync-permissions` por causa desta onda.** Nenhuma capacidade e nenhuma permissão nova: as rotas usam `pauta.ver`, `pauta.editar`, `pauta.publicar`, `automacoes.executar` e, na página de links, `bio.editar`. Publicar a página passa pelo `BioService.publicar` que o `/bio` já usa | — |
| B5 | Smoke da imagem com `ROTINAS_CRON=off` antes do `up` (§3, passo 9), com `SMOKE_ROTAS` incluindo `/api/pauta/episodios` e `/api/pauta/voz` | Sete controllers novos no `PautaModule`; aqui subiram, mas quem vale é a imagem construída |

**Tarefas do Pedro, fora do repositório** (nenhum agente pode fazer):

1. **Whisper (D-MC3):** o `whisper-cli` já está no Mac (`/opt/homebrew/bin/whisper-cli`). Falta
   baixar um modelo ggml (`ggml-large-v3-turbo.bin` ou `ggml-small.bin`) e apontar `WHISPER_MODEL`
   para ele. Sem isso `transcrever` para, e a palavra de corte não é detectada.
2. **Conta e variáveis do Mac:** escolher a conta do OS com `pauta.editar` que o Mac vai usar e
   gravar `ROOT_OS_API_URL` (o domínio público da API, com `/api`, em `https://`), `ROOT_OS_EMAIL` e
   `ROOT_OS_SENHA` em `~/.config/root/root-midia.env`, fora do repositório.
3. **Instalar a skill:** `ln -s <repo>/tools/root-midia ~/.claude/skills/root-midia`.
4. **PalmierPro:** abrir o app (o MCP em `127.0.0.1:19789` recusou conexão) e validar o caminho da
   skill com as ferramentas reais.
5. **Palavra de corte (D-MC2):** escolher; hoje vale `root, corta`, trocável pela nota
   `pauta.palavra-de-corte` (via `POST /memoria`) ou por episódio.
6. **Primeira gravação real:** `/root-midia ep-NN` num bruto de verdade, conferindo o roteiro, o
   pacote e a newsletter gerados por um modelo real.
7. **Teste cego da voz (MC10):** roteiro e peças com e sem perfil; e decidir se a curadoria entra no
   bloco de voz e se `pauta.editar` pode escrever a nota `voz.*`.
8. **Destino da newsletter (D-MC7):** Substack sem API, Beehiiv, Gmail para uma lista ou só
   rascunho.
9. **Links da casa da página:** criar a nota `pauta.pagina-de-links.chamadas` (`Rótulo | https://…`,
   até 5) por `POST /memoria`; e confirmar a regra de permissão (remontar página no ar pede
   `bio.editar`; publicar pede `pauta.publicar` + `bio.editar`).
10. **Decisões menores em aberto:** Concluído voltar a Agendado; marcar o título escolhido renomear o
    episódio; editar títulos, descrição e brief de thumb no OS; mídia refeita descartar a
    newsletter; a D-MC5 (pixel da Meta) segue adiada.

**Riscos que esta onda deixa:** os prompts de roteiro, pacote, newsletter e voz nunca viram um
modelo de verdade, então o primeiro episódio real é também o primeiro teste do formato. Com
`LLM_PROVIDER=openai` a saída de `complete()` fica em 900 tokens (`TETO_SAIDA_RESPOSTA`, anterior
à frente), pouco para roteiro e newsletter longos; o padrão `anthropic` usa 16000. (Resolvido na
MC-R: as gerações longas pedem 8000 via `maxTokens`.) E o aviso do
papel restrito da MC-A continua valendo: sem a decisão do passo 16, a rodada da semana só sai pelo
"Rodar agora".

### Onda MC-R — consertos de robustez das ondas A e B · commitada (24/09/2026)

Três defeitos apontados nos fechamentos da MC-A e da MC-B, cada um com teste que falhava antes
(`apps/api/test/pauta-robustez.test.ts`: 14 dos 24 casos originais reprovam no código anterior) e
passa agora; a revisão de três leitores somou 7 casos (abaixo).

1. **O permalink do Gmail não sai mais por caminho nenhum.** A regra de "link público" mora num
   lugar só, `pauta/link-publico.ts` (`linkPublicoDoItem`, `ehLinkPrivado`), e barra por qualquer um
   de três fatos: a marca `semLinkPublico`, a origem L (em qualquer das `origens`) e o host de caixa
   de entrada. Usam a regra o destino da peça no WhatsApp, a página de links (MC12), a descrição do
   YouTube (MC11), a newsletter (MC13), o roteiro (MC8 — lia só a marca), o miolo da curadoria e o
   pedido que deriva as peças (os dois imprimiam o `url` de qualquer item sem a marca). O miolo já
   gravado e o corpo da peça que vai ao grupo, ao ClickUp e ao carrossel do Instagram (legenda e
   slides) passam por `semLinksDeCaixaDeEntrada`; a captura sem fonte com permalink nasce marcada,
   fica sem URL no prompt da rodada e não se funde com outra newsletter no insumo; o candidato antigo
   ganha a marca na leitura (`lerCandidatos`, também no `GET /pauta/rodadas/:id` em curadoria, que a
   aba lê — a tela mostra "só contexto") e o item antigo ao entrar no episódio (`itensMantidos`).
2. **Teto de saída por chamada.** `LlmMessage.maxTokens` (opcional) e `saidaDaResposta`: só sobe o
   padrão do provider, nunca o baixa, para em `TETO_MAXIMO_DE_SAIDA_DA_RESPOSTA` (16000 — o SDK da
   Anthropic recusa chamada sem streaming acima de ~21 mil) e ignora pedido inválido. OpenAI e
   OpenRouter saem de 900 para 8000 (`SAIDA_DA_GERACAO_LONGA`) no roteiro, pacote, newsletter (as
   duas chamadas), voz e peças; a Anthropic segue em 16000 (padrão maior). O envelope do teto de
   custo reserva pelo mesmo número (`tetoDeSaida({ tipo: 'completa', maxTokens })`). Curadoria,
   ficha, relatório e `step()` não mudaram. Nenhum `temperature`/`top_p`/`budget_tokens` novo.
3. **Corpo grande só nas rotas de mídia.** `common/corpo-da-midia.ts`, instalado no `main.ts` antes
   do `listen`: `POST /api/pauta/episodios/:id/midia` e `/transcricao` aceitam até 2 MB
   (`PAUTA_TETO_DO_CORPO_DA_MIDIA`, no shared); o resto da API segue nos 100 kb do Nest. Dois
   cuidados que o teste fixa: o parser vai embrulhado com outro nome (o Nest pula o seu `json()` se
   achar um `jsonParser` na pilha) e é o body-parser do próprio `@nestjs/platform-express` (o
   `express` da raiz é o 5, com outro body-parser que não marca `req._body`). Conferido também no
   dist de verdade: 500 kB na transcrição e na mídia → 401 (passou do parser), nas vizinhas → 413,
   2,2 MB → 413, JSON pequeno no login continua lido. A estação de mídia confere pelo mesmo teto.

**Revisão (três leitores).** Corrigido: `semLinksDeCaixaDeEntrada` deixava passar o link colado em
`_itálico_`, `*negrito*` ou letra (o `\b` antes do `https`), apagava qualquer `()` do texto e era
quadrática numa sequência longa de espaços (o regex começava por `[ \t]*`; 100 mil espaços davam
5 s de event loop pelo PATCH da peça) — virou varredura linear que limpa só em volta do link; o
pedido das peças chamava de "newsletter" todo item sem link público (agora só o privado; o resto é
"sem link"); ClickUp e carrossel mandavam o corpo cru; o GET da rodada em curadoria devolvia o
candidato antigo sem a marca; `chaveDaMateria` fundia as newsletters sem fonte (decidia só pela
origem); o comentário do `TETO_DO_CORPO` apontava o teste errado; o risco dos 900 tokens da MC-B
ficou anotado como resolvido. Nada recusado.

Medido: api 2448/2448 com o banco (62 arquivos), 1878 + 570 pulados sem ele; web 506 (39);
`pnpm typecheck`, `typecheck:test` e o smoke do dist limpos. Sem tabela, sem enum, sem migration,
sem variável e sem permissão nova — nada muda na ordem de deploy além do build da imagem.


### Fatia MC15 — a semana de posts: derivação por notícia (24/09/2026)

Por matéria mantida do episódio, um carrossel, um story e um corte vertical para revisar. Sem tabela,
sem enum, sem migration, sem permissão e sem capacidade nova; nenhuma variável nova na API (as cinco
novas são do Mac, catalogadas comentadas no `.env.example`, como as da MC9).

- **API:** `DerivacaoService` + `DerivacaoController` (`pauta/derivacao*.ts`). `GET
  /pauta/episodios/:id/semana`, `POST …/semana/gerar` (uma chamada por matéria, orgId, voz da MC10,
  teto longo da MC-R), `PUT /pauta/pecas/:id/semana`, `POST|GET /pauta/pecas/:id/imagens/:n` e `PUT
  /pauta/pecas/:id/video`. `PautaPeca` canal `instagram`, formato `carrossel`/`story`/`corte`.
  Idempotente por (episódio, matéria, formato); aprovada e publicada nunca são tocadas. O corte sai
  dos números dos segmentos que a IA escolhe, conferido por `trechoDoCorte`. Nenhum link no prompt;
  todo link do texto do modelo sai; `linkDaMateria` pela regra única da MC-R. O episódio vai do
  Pacote à Derivação. A derivação antiga ignora essas peças; `exportarCarrossel` recusa story/corte e
  leva o `cta`.
- **Mac:** `root-midia semana|carrosseis|stories|cortes ep-NN` e `ensaio-semana`
  (`tools/root-midia/lib/semana.mjs`, `story.html`). **O carrossel usa o render da máquina de
  carrossel** (plugin instalado, `render/render.mjs <pasta>` a partir de `slides.json`, 1080×1350,
  marca root) — não houve template próprio. **O rosto do corte** sai do JSON da coleção "Gravação" do
  OBS (lido, nunca escrito): a C920 em 1280×720 recortada e escalada para dentro de 336×299 em
  (1533, 737) → região **1540,738,322,298**, e não os 480×270 que o plano supunha. **O mp4 do corte
  fica no Mac** (MinIO da VPS não é público; um corte pesa dezenas de MB; o Instagram publica por URL
  pública, então guardar lá não publica nada) — a peça guarda caminho, duração, tamanho e bytes.
- **Tela:** seção "Semana de posts" no detalhe do episódio (`SecaoSemana.tsx`).

**Revisão (três revisores, antes do commit).** Corrigido:

- o slide de CTA do modelo só sai quando é CTA (verbo de comentar e a palavra, as duas como palavra
  inteira; no máximo o último) — antes, um carrossel sobre PREÇO com a palavra PRECO perdia os
  slides de conteúdo até virar nulo;
- a transcrição longa no prompt não perde mais o fim (1.200 segmentos só levavam até o #912): o
  espaço da fala sai do prefixo real, e sem espaço a fala zera em vez de cortar segmentos;
- **o CTA da palavra-chave também fecha a legenda do corte** (Reels/TikTok), com a mesma palavra do
  carrossel da matéria; com carrossel ou corte já aprovado, a matéria fica com a palavra dele; a
  unicidade vale entre carrossel e corte das outras matérias;
- editar só a legenda/título do corte mantém o mp4 (o trecho só se refaz quando o tempo muda, a
  tela só manda o trecho quando mudou), e o trecho novo refaz `de`/`até`; o Mac tira o frame do
  story do começo do corte **atual** da matéria;
- editar, subir PNG e registrar mp4 releem a peça sob o cadeado do `gerar` e gravam na mesma
  transação; PNG que chega depois de uma edição é 409;
- depois de agendado, o texto não se edita (400, como o pacote); o render continua aceito;
- na aba Rodadas, a peça da semana aparece sem "Salvar texto" (e o `PATCH /pauta/pecas/:id`
  recusa texto dela com 400, aceitando só o status); "Baixar carrossel" só no carrossel;
- a conta do `gerar` quando a IA falha soma o formato firme como mantido;
- o título da matéria e o do episódio vão ao prompt sem URL;
- o story avisa na tela quando a página de links do episódio não está no ar;
- no Mac: o carrossel com texto estourado (o `report.json` do render) não sobe sem `--forcar`; o
  `tema` do `slides.json` sai escapado; sem `--tela`/`--pip`, o padrão acompanha o `--canvas`.

**Medido** (Mac, `marketing_os_test` no `mktos-mc-db`, 24/09/2026 ~04h):

| Comando | Resultado |
|---|---|
| `pnpm typecheck` / `pnpm --filter @mktos/api typecheck:test` | limpos |
| `pnpm --filter @mktos/api test` com `TEST_DATABASE_URL` | **2515 de 2515** em 63 arquivos (+67: `pauta-semana` 53, `root-midia` +14) |
| a mesma suíte sem banco | 1944 passados / 571 pulados |
| `pnpm --filter @mktos/web test` | **522** em 40 arquivos (+16: `pauta-semana` 14, `pauta-episodios` +2) |
| `build` + `smoke` com `SMOKE_ROTAS` de `…/semana` e `…/imagens/1` | **SMOKE OK**; as 6 rotas novas mapeadas (refeito depois da revisão) |
| `root-midia ensaio-semana` | **OK**: corte 1080×1920 com 12,4 s (o trecho pedido) e o rosa do PiP embaixo; story 1080×1920 (255 kB); carrossel de 4 slides 1080×1350 pela máquina de carrossel |

Pisos da CI: api 1861/55, web 346/31, com a conta no `ci.yml`. Policy, porta e isolamento não mudam
(nenhuma capacidade nem tabela).

**Ensaio ponta a ponta, local.** API compilada contra `marketing_os_e2e`, LLM dublê local
(`LLM_PROVIDER=openai`, `OPENAI_BASE_URL` em loopback, chave falsa), empresa e conta descartáveis
(`pauta.ver`, `pauta.editar`, `automacoes.executar`), episódio em Pacote com a **transcrição de
exemplo** (13 segmentos, 3 matérias, uma delas newsletter com permalink do Gmail sem a marca) e um
vídeo sintético 1920×1080 de 390 s com o PiP no lugar da câmera. `POST …/semana/gerar` → **9 peças
(3+3+3)**, episódio em Derivação, a matéria 3 com o corte encurtado (a IA pediu 198 s) e aviso; a
newsletter sem link em peça nenhuma. No Mac, pelo login normal: `semana` listou; `cortes ep-04 <final>`
gerou os 3 cortes 1080×1920 (57,9 s, 131,5 s, 139,7 s) e registrou os três no OS (`pauta.semana_video`);
`stories` e `carrosseis --sem-enviar` renderizaram 3 stories e 3 carrosséis de 5 slides. Com envio, o
PNG recebeu **503 "storage não configurado"** — o ambiente não tem MinIO (`S3_*`), como no MC11.
Com o `next dev` contra essa API, o detalhe do episódio a **375×812** (agent-browser): `scrollWidth`
375, nenhum elemento passando da borda, as 3 matérias com as 3 peças. Empresa do ensaio apagada no
fim.

**O que não rodou / fica com o Pedro:**

1. **LLM real** — o prompt da derivação só viu o dublê; o primeiro episódio real é o primeiro teste
   do formato (em especial a escolha do trecho pelos números dos segmentos).
2. **Upload dos PNG contra um MinIO de verdade** (o ambiente não tem `S3_*`); a rota e a gravação da
   chave estão cobertas pelos testes com storage dublê. Imagem substituída fica no MinIO (o
   `StorageService` não apaga), como as thumbs.
3. **Decisões:** a palavra-chave e o texto do CTA (hoje "Comentário com a palavra X → o link da
   matéria e o episódio completo chegam no direct", sem segunda pessoa) dependem da D-MC9 (DM
   automática); **o story não leva a palavra** — chama para o link da bio. O plano pede "CTA com
   palavra-chave em cada peça"; carrossel e corte cumprem, e o story fica como **divergência
   pendente do Pedro, ligada à D-MC9** (a resposta a story chega por DM, e o texto dela depende de
   como a automação vai casar a palavra); a região da tela no corte é o canvas inteiro, com o PiP aparecendo pequeno no canto de
   cima — recortar só a área útil é `--tela`, a decidir com o Pedro depois de um corte real; o
   PalmierPro não entrou no corte vertical (ffmpeg direto, reproduzível e testável).
4. **O que publica** continua fora: Instagram/TikTok são MC17/D-MC8, o agendamento é MC16.


### Fatia MC16 — o calendário da semana e a postagem com um toque (24/09/2026)

As peças aprovadas da semana de posts se distribuem nos slots da grade e cada slot fica pronto para
postar à mão. **Uma migration** (duas colunas numa tabela que já tem RLS), sem tabela, enum,
permissão, capacidade nem variável nova. Revisada por três lentes antes do commit (ver "A revisão"
no fim desta seção).

- **Banco:** `20260924090000_pauta_peca_agenda` — `PautaPeca.agendadaPara` (+ índice `(orgId,
  agendadaPara)`) e `urlPublicada`. **Decisão registrada:** "postada à mão" reaproveita `status
  publicada`, `publicadaEm` e `publicadaPor`, com `externalId` nulo; o id na rede fica para a MC17,
  que preenche o mesmo `urlPublicada`.
- **Deploy desta fatia (entra no fim da ordem do B2):** `db:deploy` aplica
  `20260924090000_pauta_peca_agenda` depois das três da MC-B — migration aditiva, duas colunas
  nulas numa tabela que já tem RLS e um índice pequeno `(orgId, agendadaPara)`; nenhum seed,
  nenhuma variável, nenhuma permissão. Smoke com `SMOKE_ROTAS` incluindo `/api/pauta/agenda` (401).
  Na volta para a imagem anterior, as colunas ficam e ninguém as lê.
- **Grade:** nota da memória `pauta.semana.grade` (o padrão mais próximo do que o repo já faz para
  configuração por empresa: voz, palavra de corte, links da casa), escrita só pelo `MemoriaService`.
  Padrão sem nota: carrossel seg/qua/sex 12h, corte ter/qui 18h, story seg–sex 9h, São Paulo.
  Feriados nacionais (com os da Páscoa, Carnaval e Corpus Christi) e os da empresa não abrem slot.
- **API:** `AgendaService`/`AgendaController` (`pauta/agenda*.ts`) — `GET /pauta/agenda`, `GET|PUT
  /pauta/agenda/grade`, `POST /pauta/episodios/:id/agenda/distribuir`, `PUT /pauta/pecas/:id/agenda`
  e `POST /pauta/pecas/:id/postada` (`pauta.publicar`; registro interno, nada sai do OS). O
  `distribuir` é função pura. A peça que sai de `aprovada` (PATCH de status, edição do texto) sai da
  agenda. Distribuir **não** muda o status do episódio.
- **Tela:** aba "Semana" em `/pauta` (`AbaSemana.tsx`); a "Semana de posts" do episódio mostra o slot
  ou a postagem da peça. **Mac:** `root-midia agenda [--de]`, só leitura.

**Medido** (Mac, `marketing_os_test` no `mktos-mc-db`, 24/09/2026 ~04h50):

| Comando | Resultado |
|---|---|
| `pnpm typecheck` / `pnpm --filter @mktos/api typecheck:test` | limpos |
| `pnpm --filter @mktos/api test` com `TEST_DATABASE_URL` | **2563 de 2563** em 64 arquivos (+48: `pauta-agenda` 46, `root-midia` +2) |
| a mesma suíte sem banco | 1991 passados / 572 pulados |
| `pnpm --filter @mktos/web test` | **540** em 41 arquivos (+18: `pauta-agenda` 17, `pauta-semana` +1) |
| `pnpm --filter @mktos/policy test` / `test:porta` | 74 / 39 (iguais) |
| `test:isolamento` com `TENANT_DATABASE_URL` (`mktos_app`/`ci`) | 326 (igual: nenhuma tabela nova) |
| `db:deploy` + `db:diff` | aplicou; "No difference detected" |
| `build` + `smoke` (com `SMOKE_ROTAS` de `/pauta/agenda` e `/pauta/agenda/grade`) | **SMOKE OK** |

Pisos da CI: api 1901/56, web 361/32, com a conta no `ci.yml`.

**Ensaio local.** API compilada contra `marketing_os_e2e` (migration aplicada lá), conta do seed com
senha descartável, um episódio em Derivação com 2 matérias e 6 peças inseridas (5 aprovadas, 1
rascunho; carrossel com PNG no storage, corte com mp4 no Mac). `POST …/agenda/distribuir
{aPartirDe: 2026-09-28}` → 5 alocadas: carrosséis seg e qua 12h, stories seg e ter 9h, corte ter
18h. Reagendar o carrossel 2 para qui 12h30 → fora da grade; o carrossel 1 no mesmo minuto → 409; o
passado → 400; sem fuso → 400. Marcar o corte postado com o link → publicada à mão; o rascunho → 400;
`http://` → 400. Grade: `reels:` → 400 com a linha; a boa gravou a nota versão 1 pelo
`MemoriaService` e o feriado da empresa (02/10) sumiu com os slots da sexta. RASTRO com
`pauta.semana_distribuida`, `…_reagendada`, `…_postada` e `pauta.agenda_grade`. `root-midia agenda
--de 2026-09-28` pelo login normal listou os slots com o caminho do mp4. Com o `next dev` contra
essa API, a aba Semana a **375×812** (agent-browser, sessão com o token injetado): `scrollWidth`
375, nenhum elemento passando da borda, as 5 peças com copiar/baixar/reagendar/marcar postada.
Rodada, episódio e peças do ensaio apagados no fim (a nota da grade e o RASTRO ficaram no banco
descartável).

**O que não rodou / fica com o Pedro:**

1. **Arrastar e soltar** ficou de fora (opcional no pedido): reagendar é pelo seletor de dia e hora,
   que funciona no celular.
2. **Baixar mídia contra um MinIO de verdade** — o ambiente não tem `S3_*`; a rota é a de prévia do
   MC15 (`GET /pauta/pecas/:id/imagens/:n`), já coberta pelos testes com storage dublê.
3. **Decisões:** a grade padrão (horários e dias) é sugestão — confirmar com o Pedro; Carnaval e
   Corpus Christi (pontos facultativos) entram como dia sem slot; o episódio não vai sozinho para
   Agendado ao distribuir (lá o texto trava) — se a Root quiser o contrário, é uma linha.
4. **O que publica** segue fora: postar no Instagram/TikTok pelo OS é a MC17 (D-MC8, App Review da
   Meta). Os PNG de um carrossel baixam um a um (não há zip; dependência nova é decisão humana).
5. **Agendar à mão a peça sem data** (escolher o horário de uma aprovada que ainda não tem slot) não
   tem tela: ela volta pelo Distribuir, e depois se move com Reagendar. O aviso do "sem vaga" aponta
   esse caminho, não um que não existe.

**A revisão (três lentes: correção, regras, contrato).** O que mudou por causa dela:

- **Carrossel pela metade** deixava de avisar: `midiaDaPeca` devolvia `storage` com 1 PNG só. Agora
  a mídia traz `esperadas` (1 no story, os slides no carrossel) e, faltando PNG, é `parcial` com os
  que faltam e o comando; a aba mostra "3 de 7 PNG (falta: …) — não poste ainda" sem botão de
  baixar, e o `root-midia agenda` imprime o mesmo.
- **"A partir de" sem teto**: `2099-01-05` agendava lá e sumia com as peças. Agora vai até hoje + 62
  dias (90 do reagendar − 28 do horizonte), 400 além disso, com `min`/`max` no campo. O
  `PautaDiaCivilSchema` ganhou a faixa 2000–2100: `?de=9999-12-27` era 500 (RangeError na conta de
  fuso) e agora é 400.
- **Distribuir com a memória fora** gravava pela grade padrão; agora é 503 e nada é agendado. O
  plano B do padrão ficou só na leitura da semana.
- **A nota da grade editada por `/memoria`** passava do teto e a regex da linha era quadrática (99
  mil caracteres travavam o event loop por ~3,5 s a cada GET, na medida da revisão). Acima do teto a leitura não parseia; a linha é
  cortada no primeiro `:`.
- **Horário de verão**: `instanteNoFuso` devolvia uma hora antes na hora que não existe (00:00 de
  04/11/2018 em São Paulo virava sábado 23h). Agora segue o "compatible" do Temporal, com teste em
  Nova York e na São Paulo de 2018/2019.
- **Reagendar/Tirar numa peça de episódio fora da Derivação/Agendado** sempre falhava; a peça traz
  `motivoParaNaoAgendar` e a tela troca os botões pelo motivo.
- O aviso "agende à mão" apontava um caminho que não existe; a seção "Semana de posts" avisa que
  editar ou descartar tira a peça da agenda; o teste de "aprovar de novo não recria o slot" agora
  reaprova a descartada de fato.


### Fatia MC18 — especificação da DM por palavra-chave (24/09/2026)

**Só documento, nenhum código:** `docs/especificacoes/MC18-dm-por-palavra-chave.md`, ligado no
`docs/PLANO-MAQUINA-DE-CONTEUDO.md` (linhas da MC18 e da D-MC9). O que ele fixa:

- **Meta** (conferido nas páginas oficiais em 24/09/2026, com o que é "a conferir" marcado): resposta
  privada em até 7 dias do comentário, uma por comentário, `instagram_business_manage_comments`; o
  webhook `comments` só chega com o app em **Live** e com **Advanced Access** — App Review mesmo para
  a conta da própria Root. Não existe hoje no código nenhum receptor de webhook da Meta.
- **Régua:** `classificar()` rodado contra `packages/policy/dist`: o envio avulso é R3 (R4 com
  `fonte_nao_confiavel`, que o executor marca em todo comentário); a ativação de uma regra com teto
  acima de 10/dia é R4 (`titular`, senha, motivo), sempre ≥ o envio. A proposta, "resposta
  pré-aprovada com alcance", pede mudar a invariante 4 (de uso único para também "uso contado"),
  ensinar `maximum` ao validador da porta e dar à porta o envio sob regra.
  Registrado junto: `limitesPadrao.porHora`/`porDia` não são lidos por nenhum código de runtime.
- **Decisões do Pedro, por fatia:** D-MC9.1 a D-MC9.10, com recomendação. A **MC18.0** (resposta à
  mão com o link rastreado) só depende da D-MC9.6 e da D-MC9.7, não da Meta nem da régua; a DM
  automática (MC18.1 em diante) depende da D-MC9.1 a .5 e .8 e do App Review. A mais urgente é a
  D-MC9.7: o CTA que a MC15 já escreve ("chegam no direct") promete uma DM que ninguém manda, e a
  frase mora em três funções da derivação, no fallback de `tools/root-midia/lib/semana.mjs` e nas
  peças já derivadas.
- **Revisão (três leitores: correção, regras, contrato), toda incorporada na especificação:** o
  `CapacidadeSchema` (Zod sem `.strict()`) apagaria calado o campo `aprovacao`, e o seed pede as
  duas assinaturas (`CAPACIDADE_NOVA` pelas três capacidades, `REBAIXAMENTO` pela invariante 4); o
  envio é **R4** pelo `fonte_nao_confiavel` (o `destinatario_novo` não é calculado em runtime e o
  `erro_recente` só conta com agente), o RASTRO dele segue o R4 e a D-MC9.2(b) (ativação R3) caiu
  por rebaixar; a porta ganha o modo `sob_regra` para o envio (hash sem `comment_id`); teto do dia,
  prazo e conector recusam sem pausar a regra, e o contador vira o dia na mesma escrita, em
  `America/Sao_Paulo`; `volume_atipico` não serve de disjuntor (acende no segundo envio de uma
  rajada); webhook pela sentinela **pública** (`resolverTenantDoIgUserId`), com um segredo de
  plataforma do ambiente e o corpo cru só na rota; `EnvioDeResposta` com `regraId` e único
  `(regraId, pessoa)`; link `campanha:dm:<itemId>` por matéria, destino por `linkPublicoDoItem`;
  PII no RASTRO por `sigiloso()` (`piiNoRastro` não tem leitor). **Pendência à parte, fora da
  MC18:** o sinal `fora_da_janela` da porta compara com `getHours()` no fuso do processo, e o
  container não define `TZ` — a janela 08:00–20:00 vale das 05:00 às 17:00 de Brasília.

**Medido** (sem mudança de código, só para confirmar a base): typechecks limpos; api **2563/2563**
em 64 arquivos com `TEST_DATABASE_URL`; web **540** em 41; policy 74. Pisos da CI intocados.


### Correção final da frente (24/09/2026)

A revisão da branch inteira deixou oito achados importantes que sobreviveram à verificação
adversarial; os oito foram corrigidos, cada um com teste que prova o conserto. Dos menores, os
baratos e claramente certos também.

| Achado | Commit | O que mudou |
|---|---|---|
| Rodada antiga guardava a URL escrita pelo modelo | `3449d39` | `comOrigem` descarta o item cuja URL não casa com captura e grava a URL **da captura**; sem item que case, a rodada falha |
| Mensagem do grupo virava título público | `d0741ec` | Candidato sem título leva o **domínio**; a mensagem fica só no `resumo`; processar grava o título da ficha na captura |
| Mídia refeita deixava o corte e o story nos tempos antigos | `b07c35c` | `registrarMidia` (e a transcrição reenviada, pelo hash) leva as peças da semana não postadas ao rascunho, sem agenda nem render, sob `pauta-semana:<id>` tomado antes do episódio; `PUT …/video` e o PNG do story são 409 fora da transcrição atual; o `root-midia` pula `transcricaoMudou` |
| Proxy do Next cortava as gerações em 30 s | `5546c97` | `experimental.proxyTimeout` = 10 min (`PRAZO_DO_PROXY_DA_API_MS`), exige refazer a imagem do `web`; semana, roteiro, pacote, newsletter, voz, curadoria e "Coletar agora" passam por `umaPorVez` (`pauta/uma-por-vez.ts`): o segundo pedido é 409 **antes** de gastar. Memória do processo — vale com um container da API só |
| Rollback da imagem com enums novos | `5c23e41` | Receita A1-volta (CSV fora do banco + `UPDATE`) e o passo 8 do §3 apontando para ela; a migration da MC16 entrou na ordem do B2 e na nota do §3 |
| Erro fora da tela no celular | `555396b` | A caixa de erro de `/pauta` é `sticky top-0`, `role="alert"`, com "Fechar" |
| "Baixar mídia" no iPhone | `bbabe61` | "Salvar as N imagens" pela folha de compartilhar (`navigator.share` com arquivos; se o gesto venceu, segundo toque com os PNG prontos); sem ela, um download por imagem; a URL do blob vive 40 s (`lib/baixar.ts`, também no roteiro e na newsletter) |
| Skill com caminho relativo | `354f255` | `SKILL.md` com o caminho absoluto da pasta do episódio; a CLI cria a pasta do `--saida` antes do whisper e diz qual criou |

Menores feitos: o corpo de 2 MB só com sessão válida (`55b46fa`; conferido no dist: anônimo e
token forjado com 500 kB → 413, sessão válida → 403 do guarda de permissão, anônimo pequeno →
401); a busca da captura conferindo o host resolvido a cada salto e seguindo redirecionamento à
mão (`d3e9234`, `pauta/pagina-publica.ts`; a troca de DNS entre a conferência e a conexão fica de
fora); o grupo de links preso a uma empresa por `EVOLUTION_LINKS_ORG_ID` (`a23acb7`, **variável
nova**, no compose e no `.env.example`; sem ela o grupo fica desligado); o Avançar da Edição ao
Pacote só com transcrição e a mensagem de pacote/newsletter mandando voltar à Edição (`66de2b6`);
a receita copiável das notas da palavra de corte e dos links da casa em `docs/PAUTA.md`
(`0a03c60`); o texto do topo de `/pauta` com o caminho da semana, a confirmação da curadoria
apontando o episódio, a aba Semana descendo até hoje e o slot do corte dizendo como o mp4 do Mac
chega ao post (`ee0428f`).

**Não feitos, e por quê:** a barra fixa da Curadoria a 375 px (mexer no espaço do botão
"perguntar" pede conferir no navegador, e o achado não foi verificado); abrir `/pauta` direto na
Curadoria quando há rodada esperando (pede uma leitura a mais na abertura da página); as rotas
próprias da palavra de corte e dos links da casa (ficou a receita); a D-MC9.7 e o resto da MC18.
Nenhum achado confirmado foi recusado.

**Deploy desta correção:** nenhuma migration, tabela, enum, permissão ou seed. Uma variável nova
(`EVOLUTION_LINKS_ORG_ID`, passo A3). A imagem do `web` precisa ser refeita (o prazo do proxy mora
no `next.config.mjs`). Fumaça do prazo: `next dev` com `API_PROXY_TARGET` num servidor que responde
em 35 s → 200 em 35 s (o `next build` completo não roda aqui: o `next/font` do Google precisa de
rede).

**Medido:** `pnpm typecheck` e `typecheck:test` limpos; api **2581/2581** em 64 arquivos com
`TEST_DATABASE_URL`, 2009 + 572 pulados sem ele; web **546** em 42; policy 74; `build` + `smoke`
com `SMOKE_ROTAS` de `/api/pauta/episodios`, `/agenda`, `/voz` e `pendentes-midia` → **SMOKE OK**.
Pisos da CI: api 1916/56, web 366/33, com a conta no `ci.yml`.

### Onda MC-C — a semana de posts, e o fechamento da frente · `ab3e5bc` (24/09/2026)

Fase 4 do `docs/PLANO-MAQUINA-DE-CONTEUDO.md` (MC15, MC16, MC18) mais a MC-R (consertos das ondas A
e B), a correção final da revisão da branch e o conserto deste fechamento. Mesma branch
`root-os/maquina-de-conteudo`, por cima do fechamento da MC-B (`4814250`). **Nada empurrado, nada
mesclado, nada na VPS.** Vinte commits, de `edb44ac` a `ab3e5bc`; as seções acima (MC-R, MC15,
MC16, MC18, correção final) têm o detalhe de cada um.

| Fatia | Commit | O que entrou | Parcial? |
|---|---|---|---|
| MC-R | `edb44ac` | Permalink do Gmail barrado por uma regra só (`pauta/link-publico.ts`) em roteiro, pacote, página, newsletter, peça do grupo, ClickUp e carrossel; teto de saída próprio para as gerações longas (`SAIDA_DA_GERACAO_LONGA` = 8000 no OpenAI/OpenRouter); corpo de 2 MB só nas rotas de mídia (`common/corpo-da-midia.ts`) | **Sim.** Os 8000 tokens são estimativa, nunca rodaram com modelo real. O body-parser vem do `@nestjs/platform-express` sem estar declarado na api (decisão humana). Transcrição acima de ~1h de fala segue recusada pelo schema (decisão de produto) |
| MC15 | `c2b6190` | Por matéria mantida, um carrossel, um story e um corte vertical (`DerivacaoService`, `POST …/semana/gerar`, uma chamada por matéria); renders no Mac: carrossel pela máquina de carrossel, story no `story.html`, corte 1080×1920 pelo ffmpeg com o rosto lido do OBS; PNG sobem, o mp4 fica no Mac | **Sim.** O prompt só viu o dublê. CTA "chegam no direct" pendente da D-MC9.7. Região da tela no corte = canvas inteiro, a decidir depois de um corte real |
| MC16 | `4b8b538` | Migration `20260924090000_pauta_peca_agenda` (`agendadaPara`, `urlPublicada`); grade por empresa na nota `pauta.semana.grade`; distribuir, reagendar, marcar postada à mão; aba "Semana"; `root-midia agenda` | **Sim.** Arrastar e soltar ficou de fora (seletor de dia e hora). Grade padrão, feriados facultativos e "distribuir não leva a Agendado" esperam o Pedro. Postar pelo OS é a MC17 |
| MC18 | `1ac517c` | Só a especificação da DM por palavra-chave (`docs/especificacoes/MC18-dm-por-palavra-chave.md`): Meta, régua, D-MC9.1 a D-MC9.10, fatias MC18.0 a MC18.5 | **Sim, por desenho.** Nenhum código antes das decisões; o App Review da Meta é do Pedro |
| Correção final | `3449d39` … `168ca2c` (15) | Os oito achados importantes da revisão da branch e os menores baratos (tabela na seção "Correção final da frente") | Três menores não feitos (abaixo) |
| Fechamento | `ab3e5bc` | A barra fixa da Curadoria a 375 px: 267 px de altura (um botão por linha, espremida pelo `pr-40`) → 187 px, usando a largura toda e deixando livre a faixa de baixo para o "perguntar"; desktop igual (59 px) | Não |

**Medido no fechamento** (Mac, `marketing_os_test` no container `mktos-mc-db`, pgvector pg16,
política semeada, 24/09/2026 ~06h20–06h45):

| Comando | Resultado |
|---|---|
| `pnpm typecheck --force` | 7 de 7 tarefas verdes, 0 do cache |
| `pnpm --filter @mktos/api typecheck:test` | limpo |
| `turbo run test --force` (sem `TEST_DATABASE_URL`) | policy **74** em 2 arquivos · api **2009 passando / 572 pulados** em 64 arquivos (59 + 5 pulados) · web **546** em 42 |
| `pnpm --filter @mktos/api test` direto, com `TEST_DATABASE_URL` | **2581 de 2581** em 64 arquivos |
| `pnpm --filter @mktos/api test:porta` | **39** |
| `test:isolamento` com `TENANT_DATABASE_URL` no papel restrito (`mktos_app`/`ci`) | **326** em 1 arquivo (a onda não criou tabela) |
| `pnpm --filter @mktos/api db:diff` | `No difference detected.` |
| `db:deploy` num banco **novo** (`marketing_os_zero_c`, criado vazio no mesmo container) | **48 de 48** migrations do zero, as seis da frente inclusive; `db:status` "up to date"; depois `db:seed:politica` |
| `pnpm --filter @mktos/api build` + `smoke` (contra o banco novo) | **SMOKE OK** duas vezes: as cinco rotas padrão e, com `SMOKE_ROTAS`, `/api/pauta/episodios`, `…/pendentes-midia`, `/api/pauta/voz`, `/api/pauta/agenda`, `/api/pauta/agenda/grade` e `/api/pauta/rodadas`, todas 401 |
| `tools/root-midia` | `root-midia.test.ts` + `pauta-midia.test.ts` **110** (dentro da suíte da api); `ensaio` OK (final mais curto e sem silêncio longo); `ensaio-thumb` 1280×720, 573 kB; `ensaio-semana` OK (corte 1080×1920 com o rosto embaixo, story 1080×1920, carrossel de 4 slides) |
| `pnpm --filter @mktos/web test` depois do conserto `ab3e5bc` | **546** em 42 (nenhum caso novo: o conserto é de classe CSS, conferido no navegador) |

**A frente inteira contra a linha de base de antes dela** (23/09, antes da MC-A): api **1233 + 557
pulados → 2009 + 572 sem banco; 2581 com banco** (+791 no total, +11 arquivos), web **398 → 546**
(+148), isolamento **319 → 326** (+7, a semente de `PautaEpisodio`), policy **74 = 74**, porta
**39 = 39**. Só esta onda, contra o fechamento da MC-B: api 2417 → 2581 (+164; `pauta-robustez`,
`pauta-semana`, `pauta-agenda` e casos novos nos vizinhos), web 506 → 546 (+40, 39 → 42 arquivos).
Pisos da CI: api 1916/56, web 366/33 (subiram na correção final, com a conta no `ci.yml`; o
fechamento não acrescentou caso).

**Ensaio ponta a ponta, local** — o da MC-B, agora até a semana postada. API compilada
(`dist/main.js`) contra o banco novo `marketing_os_zero_c` (migrations do zero, política semeada),
empresa `root` e conta descartáveis (`pauta.ver`, `pauta.editar`, `pauta.publicar`,
`automacoes.executar`, `bio.editar`). LLM: o **dublê** local de Chat Completions (`LLM_PROVIDER=openai`,
`OPENAI_BASE_URL` em `127.0.0.1`, chave falsa; o dublê da MC15, com a derivação). Canal de
aprovação com os dois segredos descartáveis e `EVOLUTION_LINKS_JID`/`EVOLUTION_LINKS_ORG_ID`
preenchidas. **Storage:** um MinIO descartável em `127.0.0.1:9311`, da imagem `minio/minio` que já
estava no Mac (nada baixado), removido no fim — é a primeira vez que o envio dos PNG e das thumbs
roda contra um MinIO. O que rodou de verdade, em ordem:

1. **Grupo de links pelo webhook:** mensagem com nome, telefone e link → 201 e captura em
   rascunho, título nulo, a mensagem na `nota`; a mesma pelo webhook de outra empresa →
   `ignorado:empresa-errada`; sem o segredo → 404.
2. **Curadoria** (`origens` W, R, L): 4 candidatos; o do grupo com título **`blog.exemplo`** (o
   domínio, `d0741ec`), a newsletter marcada `semLinkPublico`. Marcar os 4 e confirmar → `curada`.
3. **Episódio e roteiro:** `ep-01` → roteiro gerado → Gravação; o `.md` com `root, corta` no topo, o
   link de cada item e, na newsletter, "sem link público — cite Newsletters (ensaio)". Nenhum
   permalink.
4. **Mac, `root-midia`:** bruto sintético 1920×1080 de 410 s (PiP rosa na região do OBS, dois
   silêncios) → `silencios` (2) → `cortes` (3 trechos, 401,8 s) → `cortar` (reencodado, 28 s) →
   `enviar ep-01 --final --bruto --cortes --transcricao` com 15 segmentos **escritos à mão** (não há
   whisper) → Edição → Pacote.
5. **Pacote e página:** 3 títulos, 5 capítulos, os 3 links públicos (o do grupo como
   `blog.exemplo`), nenhum Gmail; `root-midia thumbs ep-01` renderizou e **subiu as 3 thumbs** (~550
   kB). Página `root-ep-01` com 3 botões e o aviso da newsletter de fora; publicada, a descrição
   passou a levar `https://bio.operacaoroot.com/@root-ep-01`. A página pública não tem nome nem
   telefone; eles só aparecem no `resumo` interno do item, como a correção decidiu.
6. **Newsletter** com o link do vídeo: o `.md` sem Gmail, sem nome, sem telefone e sem marcador
   sobrando. **Voz:** `POST /pauta/voz/aprender` → nota `voz.pedro`.
7. **Semana de posts:** `POST …/semana/gerar` → **12 peças** (4 matérias × 3, `criadas: 12`),
   episódio em Derivação, uma palavra por matéria (PRECO, PLANILHA, ABERTOS, AGENTES) no CTA do
   carrossel e do corte, nenhum Gmail em peça nenhuma.
8. **Renders no Mac:** `cortes ep-01` → 4 mp4 1080×1920 (39,7 s, 119,7 s, 124,7 s, 115,8 s) em 28 s,
   com o rosto lido do `Gravação.json` do OBS (1540,738,322,298), registrados no OS. `stories` e
   `carrosseis` **sem** MinIO → 503 "storage não configurado" (o mesmo da MC15); **com** o MinIO
   local → 4 stories e 4 carrosséis de 5 slides no OS (24 `pauta.semana_imagem`), e `GET
   /pauta/pecas/:id/imagens/1` → 200 `image/png`.
9. **Agenda:** aprovar 11 das 12 (o story da matéria 2 ficou rascunho) → `distribuir {aPartirDe:
   2026-09-28}` → **11 alocadas, 0 sem vaga** (seg 28/09: story 9h e carrossel 12h; ter: story 9h e
   corte 18h; …). Marcar postada o carrossel 1 com `https://www.instagram.com/p/…` e o corte 1 sem
   link → `publicada` à mão; o rascunho → 400 "aprove antes"; `http://` → 400. `root-midia agenda
   --de 2026-09-28` listou cada slot com "5 PNG no OS" ou "mp4 no Mac: <caminho>".
10. **Mídia refeita** (`b07c35c`): voltar o episódio Derivação → Pacote → Edição e reenviar a
    transcrição com uma fala trocada → Pacote. As 10 peças não postadas voltaram a rascunho, fora
    da agenda, sem PNG e sem mp4; as 2 postadas ficaram. `root-midia cortes --so 2` pula ("o corte
    é da transcrição anterior") e `PUT /pauta/pecas/:id/video` → **409**.

O RASTRO ficou com `pauta.captura_whatsapp` (3), `…rodada_para_curadoria` (2), `…curadoria_marcada`,
`…curadoria_confirmada`, `…episodio_criado`, `…roteiro_gerado`, `…episodio_midia`,
`…episodio_transcricao` (2), `…pacote_gerado`, `bio.page_create`, `…pagina_de_links`,
`bio.page_publish`, `…newsletter_gerada`, `…voz_aprendida`, `…semana_gerada`, `…semana_video` (4),
`…semana_imagem` (24), `…episodio_thumb` (3), `…peca_editada` (11), `…semana_distribuida`,
`…semana_postada` (2) e `…episodio_status` (2). O dublê recebeu 11 chamadas, 10 reconhecidas; a
outra foi a vetorização da nota de voz (embeddings no mesmo `OPENAI_BASE_URL`), que devolveu 500 e
virou o aviso "vetorização falhou" da memória, sem efeito no fluxo.

**A 375×812** (`next dev` com `API_PROXY_TARGET` na API do ensaio — a linha de boot mostra
`proxyTimeout: 600000` —, agent-browser sem janela, sessão com o token injetado): Curadoria (com uma
segunda rodada em curadoria, 3 candidatos do grupo), Episódios, Semana (a de hoje e a seguinte, com
os 11 slots), Voz e o detalhe inteiro do `ep-01`. Em todas, `scrollWidth` 375 e nenhum elemento
passando da borda. Os únicos "cortados" da medida são dois `<input>` com o valor mais longo que o
campo (rolam por dentro, como deve). **Achado e consertado:** a barra fixa da Curadoria (o menor
que a correção final deixou por conferir no navegador) media 267 px, com um botão por linha →
`ab3e5bc`, 187 px, nenhum dos quatro botões no retângulo do "perguntar", desktop igual. **Achado
e não consertado, anterior à frente:** o seletor de tema da barra lateral sai cortado a 375 px
("ESCUR", "PAPE", "MON"); é o `Sidebar.tsx`, que a frente não tocou.

**O que não rodou:** LLM real (nenhum dos prompts da frente viu um modelo), whisper (sem modelo),
PalmierPro, o MinIO **da VPS** (o do ensaio é local), Evolution, Gmail, Apify, Meta, TikTok e
YouTube reais, o papel restrito com a API de pé, o `next build` (o `next/font` do Google precisa de
rede), o 409 do segundo clique (`umaPorVez`, coberto pelos testes; o dublê responde rápido demais
para a corrida) e o clique medido em `/r/` (feito na MC-B). O banco `marketing_os_zero_c` ficou no
container descartável; o MinIO do ensaio foi removido.

**Revisão adversarial da branch** (antes do fechamento, registrada em "Correção final da frente"):
**8 achados importantes confirmados, 0 refutados, 8 corrigidos**, cada um com teste que prova o
conserto (`3449d39`, `d0741ec`, `b07c35c`, `5546c97`, `5c23e41`, `555396b`, `bbabe61`, `354f255`),
mais 7 menores feitos. Dos três menores não feitos, este fechamento conferiu e consertou um (a
barra da Curadoria); ficam abrir `/pauta` direto na Curadoria quando há rodada esperando e as rotas
próprias da palavra de corte e dos links da casa (hoje, a receita do `docs/PAUTA.md`). O ensaio
acima exercitou de ponta a ponta três dos consertos (`d0741ec`, `b07c35c`, `a23acb7`) e o envio dos
PNG que ficara sem prova desde a MC11.

**Ordem de deploy desta onda.** Soma-se à A (A1–A5) e à B (B1–B5):

| # | Passo | Se pular |
|---|---|---|
| C1 | A migration da MC16, `20260924090000_pauta_peca_agenda`, já está no fim do B2: duas colunas nulas e o índice `(orgId, agendadaPara)` numa tabela que já tem RLS | Aba Semana e distribuir respondem 500 |
| C2 | **A imagem do `web` é reconstruída**: o prazo do proxy de `/api` (10 min, `apps/web/next.config.mjs`) vale no build | `up -d --no-build` com a imagem velha mantém os 30 s, e gerar a semana, o roteiro, o pacote, a newsletter e a voz voltam a dar 500 no meio |
| C3 | `EVOLUTION_LINKS_ORG_ID` (passo A3), já no compose e no `.env.example` | Grupo de links desligado, o padrão seguro |
| C4 | Nenhuma capacidade, permissão ou seed nova: `pauta.publicar` (marcar postada) já existia | — |
| C5 | Smoke da imagem com `SMOKE_ROTAS` incluindo `/api/pauta/agenda` e `/api/pauta/agenda/grade` | `AgendaController` e `DerivacaoController` são controllers novos do `PautaModule` |
| C6 | Um container da API só: o freio do segundo clique (`umaPorVez`) mora na memória do processo | Com duas réplicas, dois cliques em containers diferentes pagam a IA duas vezes |

**ORDEM DE DEPLOY CONSOLIDADA DA FRENTE (A + B + C).** Vale por cima do §3, que continua inteiro
(os passos 1–4, 10–11 e a virada do papel restrito são dele):

1. **Merge da branch** `root-os/maquina-de-conteudo` na `main`, com a CI verde (§3, passos 1–4). É
   decisão do Pedro; nenhum agente mescla nem empurra.
2. **`db:status` na produção:** se faltarem as migrations anteriores da `main`
   (`20260917010000_esteira_de_clientes`, `20260924010000_onboarding_do_cliente`), elas entram antes,
   na ordem do nome.
3. **Backup do dia** (§3, passo 5) e **`docker tag mktos-app:latest mktos-app:rollback`** (passo 8).
   Deixar à mão a **receita A1-volta** (§1, onda MC-A): a imagem antiga não lê `aguardando_curadoria`
   nem `gmail`.
4. **Variáveis no `.env` da VPS:** `EVOLUTION_LINKS_JID` e `EVOLUTION_LINKS_ORG_ID` (as duas já
   estão no bloco `environment:` do compose). Pré-requisito: o canal de aprovação configurado
   (`CANAL_APROVACAO_SEGREDO`, `CANAL_APROVACAO_CODIGO_SEGREDO`). Conferir que `S3_*` estão
   preenchidas (PNG da semana e thumbs). Nenhuma outra variável na API; as do `tools/root-midia`
   são **só do Mac**.
5. **Build das duas imagens**, `api` e `web` (a `web` por causa do prazo do proxy).
6. **Ensaio das migrations** num banco descartável com o dump da produção. As seis da frente, nesta
   ordem: `20260924020000_pauta_fonte_gmail`, `20260924050000_pauta_rodada_aguardando_curadoria`,
   `20260924060000_pauta_episodio`, `20260924070000_pauta_episodio_palavra_de_corte`,
   `20260924080000_pauta_pagina_de_links`, `20260924090000_pauta_peca_agenda`. Todas aditivas; as
   duas primeiras são `ALTER TYPE … ADD VALUE`, que não se desfazem.
7. **Smoke da imagem** com `ROTINAS_CRON=off`, os intervalos em 0 e
   `SMOKE_ROTAS=/api/pauta/episodios,/api/pauta/episodios/pendentes-midia,/api/pauta/voz,/api/pauta/agenda,/api/pauta/agenda/grade,/api/pauta/rodadas`.
8. **Seeds e permissões:** nada por causa da frente (nenhuma capacidade, nenhuma permissão nova). O
   `db:seed:politica` do §3 (passo 10) segue valendo se o deploy levar commits de fora que mexem na
   política.
9. **`up -d --no-build --vps api web`** (a migration roda no `command` do container).
10. **Conferir:** a linha de boot da política; `entrada do grupo … ligada por EntradaDeLinksService`
    (sem as variáveis, o aviso de desligado); `storage pronto`; `/pauta` abrindo as seis abas; o
    RASTRO.
11. **Registrar** o que subiu (commit/tag).
12. **Depois do deploy, na tela:** a rotina de quinta em `/rotinas` ("Nova rotina de coleta"), as
    fontes em Radar e as notas da memória pela receita do `docs/PAUTA.md` (palavra de corte, links
    da casa). **Aviso:** sob o papel restrito (§3, passo 16), nenhuma rotina dispara — a de quinta
    inclusive — até a decisão do agendamento.

**Voltar:** receita A1-volta antes da imagem `rollback`; as tabelas e colunas da B e da MC16 não
pedem nada. A `web` antiga volta aos 30 s de proxy.

**Tarefas do Pedro, consolidadas da frente** (nenhum agente pode fazer; as das ondas A e B acima
continuam valendo, aqui na ordem do que destrava mais):

1. **Merge, push e deploy** pela ordem acima — e a proteção da `main` (§3, passo 4).
2. **Grupo "Root · links" (D-MC10):** criar o grupo na instância do root, preencher o JID e o id da
   org, apontar o webhook `messages.upsert` para `/approvals/canal/whatsapp/<orgId>` com
   `x-canal-segredo`.
3. **Fontes:** conectar o Google e criar a etiqueta das newsletters (fonte `gmail`); cadastrar as
   buscas e os creators; revisar o teto dos perfis (perfil agora entra na coleta automática).
4. **Rotina de quinta** em `/rotinas` e a **decisão do passo 16** (sem ela, só "Rodar agora").
5. **Mac:** baixar o modelo do whisper e apontar `WHISPER_MODEL` (D-MC3); gravar
   `~/.config/root/root-midia.env` com a URL `https://…/api` e a conta com `pauta.editar`;
   `ln -s <repo>/tools/root-midia ~/.claude/skills/root-midia`; abrir o PalmierPro e validar a skill.
6. **Episódio 00 real:** gravar, rodar `/root-midia ep-00` e conferir roteiro, pacote, newsletter e
   semana gerados por um **modelo real**; medir o tempo humano de cada etapa; ajustar os 8000 tokens
   da `SAIDA_DA_GERACAO_LONGA` se faltar.
7. **D-MC9.7, a mais urgente:** o CTA que a MC15 já escreve promete uma DM ("chegam no direct") que
   ninguém manda. Responder à mão (MC18.0, com a D-MC9.6) ou trocar para "link na bio".
8. **D-MC8, App Review da Meta** (app em Live, Advanced Access, as permissões de conteúdo,
   comentários e mensagens) — destrava a MC17 e a DM automática (D-MC9.1 a .5 e .8).
9. **D-MC6 (YouTube)** e **D-MC7 (destino da newsletter)**.
10. **D-MC2 (palavra de corte)** e as notas `pauta.palavra-de-corte` e
    `pauta.pagina-de-links.chamadas` pela receita do `docs/PAUTA.md`.
11. **A semana:** confirmar a grade padrão (carrossel seg/qua/sex 12h, corte ter/qui 18h, story dia
    útil 9h), Carnaval e Corpus Christi sem slot, e se distribuir leva o episódio a Agendado.
12. **O corte:** depois de um corte real, recortar só a área útil da tela (`--tela`) ou manter o
    canvas inteiro.
13. **Teste cego da voz** (MC10), e se `pauta.editar` pode escrever a nota `voz.*`.
14. **Menores:** declarar `body-parser` na api; subir o teto da transcrição acima de 1h; o ClickUp
    pelo mesmo portão de links do WhatsApp; sugeridos já marcados na curadoria; unificar a chave de
    URL do RSS; Concluído voltar a Agendado; zip dos PNG do carrossel (dependência nova); o `TZ` do
    container (a janela `fora_da_janela` da porta está em UTC); abrir `/pauta` na Curadoria quando há
    rodada esperando; rotas e tela próprias para a palavra de corte e os links da casa; o seletor de
    tema cortado a 375 px na barra lateral.

**Riscos que a frente deixa:**

- **Nenhum prompt viu um modelo real** — curadoria, roteiro, pacote, newsletter, voz e derivação só
  conversaram com o dublê. O primeiro episódio real é o primeiro teste do formato, da escolha do
  trecho do corte pelos números dos segmentos e do teto de 8000 tokens.
- **O freio do segundo clique mora na memória do processo:** vale com um container da API só.
- **O papel restrito cala a rotina de quinta** (§3, passo 16), sem padrão seguro.
- **A imagem do `web` velha** deixa as gerações longas morrerem aos 30 s.
- **Rollback com enum novo** só pela receita A1-volta (ou pelo backup, perdendo o que entrou).
- **O mp4 do corte só existe no Mac:** limpar a pasta `~/Movies/OBS/root-midia/ep-NN` apaga o que o
  slot aponta. E o MinIO nunca apaga PNG ou thumb substituída.
- **O CTA promete DM** que ninguém manda até a D-MC9.7.
- **A troca de DNS** entre a conferência e a conexão, ao processar uma captura, segue aberta.
- **A aprovação em produção** responde 403 desde o deploy de 12/09 (`db:sync-permissions`
  pendente), e publicar a peça no grupo depende dela.
- **A branch só existe no disco**, o risco nº 1 do plano inteiro.

### Onda D, fatia MD1 — o encadeamento da transcrição à semana em rascunho (24/09/2026)

Especificação em `docs/especificacoes/MD-onda-d-automacao.md` (MD1). A rotina nova `pauta.encadear`
anda sozinha, um passo por episódio a cada passagem (no máximo dois episódios), da transcrição até a
semana em rascunho com os slots **propostos**: pacote → página de links **montada, fora do ar** →
newsletter → semana de posts → slots. Nada sai do OS. O interruptor é a própria rotina: sem ela
criada em `/rotinas`, nada anda.

| Peça | Onde |
|---|---|
| O próximo passo (puro; nunca devolve publicar), a trava de três erros e a dispensa | `apps/api/src/pauta/encadeamento-do-episodio.ts` |
| O serviço (os MESMOS serviços e chaves do `umaPorVez` dos botões; RASTRO `pauta.encadeamento_passo` com ator sistema e a correlação da rotina) | `apps/api/src/pauta/encadeamento.service.ts` |
| O executor, registrado no molde da coleta | `apps/api/src/routines/executores/pauta-encadear.executor.ts`; tipo em `rotina.tipos.ts`, config em `nova-rotina.ts` |
| `GET /pauta/episodios/:id/encadeamento` (`pauta.ver`) | `encadeamento.controller.ts` |
| `AgendaService.proporSlots` + migration `20260924100000_pauta_peca_slot_proposto` (`PautaPeca.slotProposto`, índice `(orgId, slotProposto)`) | `agenda.service.ts` |
| Tela: "Nova rotina de encadeamento", "Próximo passo automático" no episódio, slot proposto em cinza na Semana; `root-midia agenda` diz "proposto, falta aprovar" | `NovaRotinaDeEncadeamento.tsx`, `LinhaDoEncadeamento.tsx`, `AbaSemana.tsx`, `tools/root-midia/lib/semana.mjs` |

Desfechos de um passo: 409 (o clique manual em curso, pela mesma chave do `umaPorVez`) é `pulada`,
sem pagar a IA duas vezes; 400/403/404 (falta insumo, como página sem nenhum link) é `dispensada`
até alguém mexer no episódio; o resto (IA fora, JSON ruim, teto de custo) é `erro` e a passagem
lança, para contar como falha no histórico da rotina. Três erros seguidos na mesma etapa, com o
episódio igual, travam a etapa: a passagem do relógio registra `travada` uma vez e pula; o "Rodar
agora" tenta de novo. O slot é proposto a partir do dia seguinte (quem aprova precisa de tempo), sem
colidir com a agenda de ninguém nem com o proposto de outro episódio.

**Medido** (Mac, `marketing_os_test`, 24/09/2026 ~15h20): `pnpm typecheck` 7/7; `typecheck:test`
limpo; api direto com `TEST_DATABASE_URL` **2634 de 2634** em 65 arquivos (+39: `pauta-encadeamento`
37, `pauta-midia` +1, `root-midia` +1); web **554** em 43 (+8, `component/pauta-encadeamento`);
`test:isolamento` **326** (coluna nova em tabela que já tinha RLS); `db:diff` limpo; `tools/root-midia`
**112**. Policy e porta não foram tocadas. Pisos da CI: api 1949/57, web 373/34, com a conta no
`ci.yml`.

**Ensaio local** (`dist/main.js` contra `marketing_os_zero_md1`, criado vazio: **49 de 49**
migrations do zero e `db:seed:politica`; empresa e conta descartáveis com teto de custo de IA de
US$ 5 ligado; o dublê de LLM da MC-C, com atraso de 1,5 s por matéria na semana; Evolution e Graph
apontadas para um "escutador" local; `ROTINAS_CRON` ligado):

1. Transcrição do `ep-01` → Pacote. **Oitenta segundos com o relógio de pé e sem a rotina: nada.**
   O GET do encadeamento dizia "gerar o pacote" e "rotina: não existe".
2. `POST /rotinas` do tipo novo (config `{etapas: ["publicar"]}` → 400). Cinco "Rodar agora":
   pacote (3 títulos) → página montada fora do ar (4 botões) → newsletter em rascunho → **12 peças**
   em rascunho, episódio em Derivação → **12 slots propostos**, `agendadaPara` nulo em todas. A sexta
   passagem: `pulada`, "nenhum episódio com passo a dar".
3. RASTRO: um `pauta.encadeamento_passo` por etapa, `actorType system`, com a correlação. O teto da
   empresa contou **6 chamadas** (US$ 0,03 estimados) — as mesmas 6 que o dublê recebeu (pacote 1,
   newsletter 1, semana 4).
4. `ep-02`, rotina posta em `rodando`: o **tique das 15h30** (fuso de São Paulo) gerou o pacote
   sozinho (`origem cron`). Página e newsletter por "Rodar agora". Com um **"Gerar semana" manual em
   curso**, a passagem voltou `pulada` ("já está em andamento") e o dublê recebeu 4 chamadas da semana
   do `ep-02`, não 8. A passagem seguinte propôs os 12 slots do `ep-02`: **zero colisões** entre os 24.
5. O escutador da Evolution e da Meta recebeu **zero** pedidos. `smoke` com as rotas novas: 401.
6. A 375 px (`next dev`, agent-browser): Semana com o proposto em cinza ("proposto, falta aprovar"),
   o detalhe com "Próximo passo automático" e `/rotinas`, todas com `scrollWidth` 375.

**A revisão (três revisores, 24/09/2026 ~16h)** mudou seis coisas no comportamento:

- **O que a pessoa descartou ou apagou não volta sozinho.** A semana inteira descartada, a newsletter
  da transcrição descartada e a página apagada no `/bio` (há `pauta.episodio_pagina_de_links` no
  RASTRO e o episódio ficou sem página) param a rotina com o motivo na tela; refazer é o botão. A
  newsletter do miolo **aprovada** também para a etapa (gerar a da transcrição a descartaria).
- **A semana pela metade é `erro`** (IA ou teto de custo cortou numa matéria): entra no histórico e na
  trava de três, e a passagem seguinte volta só às matérias sem peça nenhuma (`itens`), sem ir aos
  slots. A matéria com um formato faltando fica para a mão, citada no motivo.
- **A passagem lê os candidatos em lotes de 20** até dar os dois passos ou acabar a lista: os
  episódios parados na Derivação (o fim normal do caminho) não escondem o novo.
- **O "Rodar agora" passa por cima da dispensa**, como já passava da trava: o insumo que faltava
  pode morar fora do episódio (a grade, a rodada, o env).
- **Config ilegível lança** no executor (`configuração da rotina: …`), como na coleta, em vez de andar
  todas as etapas; o GET mostra a parada. O GET também diz quando `ROTINAS_CRON=off` ou
  `PAUTA_CRON=off` calam o tique (`rotina.calada`), e aí `dispara` é falso.
- No distribuir à mão, o proposto às irmãs em rascunho do mesmo episódio ocupa o slot, e o proposto
  da aprovada só vale se ainda está na grade vigente (grade editada ou feriado novo → próximo livre).

Medido depois da revisão: api direto **2645 de 2645** em 65 arquivos (+11, todos sem banco; sem ele
2071 passados e 574 pulados); web **555** em 43 (+1); typecheck e `typecheck:test` limpos; `db:diff`
limpo. Pisos da CI: api 1958/57, web 374/34.

**Pendências (do Pedro, e da onda):** criar a rotina em `/rotinas` depois do deploy (ela é o
interruptor); a virada do papel restrito cala todas as rotinas, esta inclusive (§3); a grade da
semana (D-MC11) é de onde os slots propostos saem — sem nota `pauta.semana.grade`, vale a padrão.
Os prompts nunca viram modelo real: a primeira semana pode sair ruim em cadeia, e isso só aparece
na revisão. Virar o slot proposto em agenda é a MD8.

**Deploy:** a migration aditiva `20260924100000_pauta_peca_slot_proposto` entra depois das seis da
frente (coluna nula e índice numa tabela com RLS); `SMOKE_ROTAS` ganha
`/api/pauta/episodios/x/encadeamento`; nenhuma variável, capacidade, permissão ou seed nova.

### Onda D, fatia MD2 — o vigia do Mac (24/09/2026)

Especificação em `docs/especificacoes/MD-onda-d-automacao.md` (MD2). O launchd acorda o
`root-midia vigia` quando a pasta do OBS muda e a cada 15 min; uma passagem faz o que a
`/root-midia ep-NN` faria à mão, só pelo ffmpeg, e sai. Nada é apagado: o bruto só é lido.

| Peça | Onde |
|---|---|
| O que decide e monta (bruto, trava, memória, plist, notificação, log, transcrição de ensaio) | `tools/root-midia/lib/vigia.mjs` |
| A passagem, `vigia instalar\|desinstalar\|estado` e `ensaio-vigia` | `tools/root-midia/root-midia.mjs` |
| `PautaEpisodio.statusDesde` + gatilho `PautaEpisodio_statusDesde` | migration `20260924190735_pauta_episodio_status_desde` |
| A fila com `statusDesde` e `derivacao[].precisaDeRender` (peça da transcrição atual sem render, com assinatura) | `pauta/midia.service.ts`, `renderPendente` em `pauta/midia-do-episodio.ts`; tipos no shared |
| A dica "ponha em Gravação antes de gravar" | `apps/web/src/app/pauta/SecaoMidia.tsx` |

**Medido** (Mac, `marketing_os_test`, 24/09/2026 ~17h): `pnpm typecheck` 7/7; `typecheck:test`
limpo; api direto com `TEST_DATABASE_URL` **2668 de 2668** em 65 arquivos (+23: `root-midia` 18,
`pauta-midia` 3, `pauta-episodio` 2, um deles com banco); web **556** em 43 (+1); `test:isolamento`
**326** (coluna nova em tabela que já tinha RLS); `db:diff` limpo; `smoke` com
`/api/pauta/episodios/pendentes-midia` → 401. Policy e porta não foram tocadas. Pisos da CI: api
1977/57, web 375/34, com a conta no `ci.yml`.

**Medido depois da revisão** (mesmo banco, 24/09/2026 ~17h30): `pnpm typecheck` 7/7;
`typecheck:test` limpo; api direto **2683 de 2683** em 65 arquivos (+15: `root-midia` +14,
`pauta-midia` +1, todos sem banco; sem ele, 2108 passados e 575 pulados); web **556** em 43 (a dica
da pausa entrou num caso que já existia); `test:isolamento` **326**; `db:diff` limpo. Piso de casos
da api a **1990** (+13), com a conta no `ci.yml`.

**Ensaio local — o "pronto quando" pelo launchd de verdade** (`dist/main.js` contra
`marketing_os_zero_md2`, criado vazio: migrations do zero e `db:seed` com senhas aleatórias numa
pasta temporária; arquivo de variáveis com `chmod 600` apontando para a API em loopback; o modelo do
whisper **não está no Mac**, então a transcrição foi a de ensaio, `ROOT_MIDIA_TRANSCRICAO_DE_ENSAIO=1`,
recusada fora de loopback; o plist foi carregado de uma pasta temporária com `--agentes`, sem gravar
em `~/Library/LaunchAgents`):

1. `vigia instalar` → `launchctl print gui/501/com.operacaoroot.root-midia.vigia` mostrou o agente
   (node e script em lista, `ROOT_MIDIA_ENV` como única variável); `plutil -lint` OK. Com o arquivo
   de variáveis em 644, `instalar` recusou pedindo `chmod 600`.
2. `ep-02` em Gravação; um bruto sintético de 15 s copiado para a pasta às 19:21:25 → a passagem
   esperou as duas leituras e os 2 min, e às **19:23:37** o episódio estava em **Pacote** (2 min 12 s):
   tomada errada da palavra de corte tirada (15,0 s → 3,2 s), mídia e transcrição no OS, a
   notificação nativa disparada. `bruto.transcricao.json`, `cortes.json`, `ep-02-final.mp4` e a
   transcrição do final com `.srt` em `<OBS>/root-midia/ep-02/`.
3. O sha256 do bruto: `1b7e8847…ca71e32` antes e depois.
4. `ep-03` em Gravação e **dois** brutos copiados juntos → em ~1 min, "ambíguo: rode /root-midia
   ep-03", nada enviado, `ep-03` segue em Gravação. Na passagem seguinte, a mesma notificação saiu
   calada no log (6 h).
5. `ep-02` posto em Derivação com um corte sem mp4 → `launchctl kickstart` → a passagem renderizou o
   corte vertical (1080×1920, 3 s) e o registrou no OS; a fila deixou de listar o episódio.
6. Sem `WHISPER_MODEL` (arquivo sem a chave de ensaio): "Falta o modelo do whisper (WHISPER_MODEL,
   D-MC3)", notificado, o bruto **não** marcado como falho (vale assim que o modelo aparecer).
7. `vigia estado` (carregado, 4 execuções, última saída 0, a última linha do log) → `vigia
   desinstalar` → `launchctl print` sai com 113 e o plist sumiu.

Também `ensaio-vigia` (no processo, intervalos curtos): dois brutos → ambíguo e nada enviado; um →
Pacote, sha256 igual.

**Correções da revisão (três revisores, 24/09/2026):**
- A `derivacao` da fila é lida do **mais novo**, em lotes de 20 e no máximo 5 lotes, até juntar 20
  com render pendente. Antes, os 20 mais antigos parados na Derivação (nada os tira de lá sozinho)
  escondiam o episódio da semana. Caso novo em `pauta-midia` com 21 episódios.
- A cadeia do vigia **relê a fila antes de mandar** (`enviar` com `exigirGravacao`): se o episódio
  saiu de Gravação no meio (a mídia foi à mão, o status mudou), nada vai, a notificação diz "ep-NN
  mudou durante a cadeia" e o bruto não vira falho.
- A trava é tomada atrás de uma **porta** criada com `wx` e removida logo depois (a catraca libera
  esse caminho pelo nome): o `vigia` à mão junto com o launchd não sai com dois donos.
- O `vigia instalar` confere as variáveis e monta os caminhos **só com o arquivo de variáveis**
  (o que o launchd vai ver); falta de `WHISPER_MODEL` no arquivo sai como aviso.
- Os renders **esperam com o OBS gravando** (bruto mudando, jovem, ou arquivo da raiz mexido nos
  últimos 2 min); o carrossel estourado e o corte sem trecho **viram notificação**; os renders vão
  para `<OBS>/root-midia/ep-NN/ep-NN-semana` (sob o launchd o diretório atual é `/`, e o carrossel
  sem o final no disco tentava `mkdir /ep-NN-semana`).
- "Vários em Gravação" só notifica com gravação nova na pasta depois da entrada do mais antigo.
- A decisão da metade do bruto saiu para `passoDoBruto` (`lib/vigia.mjs`), com disco, relógio,
  espera, transcritor e cadeia injetados, e a suíte cobre os caminhos sem ffmpeg. **Desvio do
  item 6 da SPEC:** o `ensaio-vigia` ficou subcomando manual, como o `ensaio` da MC9 (a CI não tem
  ffmpeg).
- Documentado (README, SKILL, dica da tela, risco da spec): o vigia pressupõe um arquivo por
  episódio e **nenhuma pausa maior que 2 min** na gravação.
- Recusado: renderizar só a peça pendente em vez do formato inteiro. O render do formato é o mesmo
  do comando manual e é idempotente; a memória de 24 h por assinatura já segura a repetição.

**Mudanças de comportamento:** `GET /pauta/episodios/pendentes-midia` devolve `statusDesde` em cada
item e a lista nova `derivacao`, do episódio mais novo para o mais antigo (a `items` segue igual
para o `enviar` manual). O `statusDesde` é
carimbado pelo **banco** em toda troca de status, por qualquer caminho; o episódio que já existe
ganha o instante da migration (gravação anterior a ela não é aceita pelo vigia — o manual segue).

**Pendências (do Pedro):**
- Baixar um modelo ggml do whisper e pôr `WHISPER_MODEL=/caminho/ggml-….bin` no
  `~/.config/root/root-midia.env` (D-MC3). Sem isso o vigia notifica e para a cada bruto novo.
- Criar `~/.config/root/root-midia.env` com `ROOT_OS_API_URL` (https), `ROOT_OS_EMAIL`,
  `ROOT_OS_SENHA` (e `ROOT_MIDIA_OBS_DIR` se a pasta não for `~/Movies/OBS`) e rodar
  `chmod 600 ~/.config/root/root-midia.env`.
- Rodar uma vez `node <repo>/tools/root-midia/root-midia.mjs vigia instalar` e conferir com `vigia
  estado`. A permissão do macOS para o node ler `~/Movies` na primeira execução sob o launchd
  **não foi conferida** (o ensaio usou uma pasta temporária): se o log disser `EPERM` na pasta,
  dar acesso ao node em Ajustes › Privacidade.
- O hábito: pôr o episódio em Gravação **antes** de gravar.

**Deploy:** a migration `20260924190735_pauta_episodio_status_desde` (coluna com padrão, gatilho e a
conferência do gatilho) entra depois da `20260924100000`; `SMOKE_ROTAS` já tem a fila da mídia.
Nenhuma variável na API, capacidade, permissão ou seed nova; as variáveis novas são do Mac
(`ROOT_MIDIA_OBS_DIR`, `ROOT_MIDIA_VIGIA_LOG`, `ROOT_MIDIA_TRANSCRICAO_DE_ENSAIO`, comentadas no
`.env.example`).

### Onda D, fatia MD3 — a janela da porta no fuso de São Paulo (24/09/2026)

Especificação em `docs/especificacoes/MD-onda-d-automacao.md` (MD3). O sinal `fora_da_janela`
lia a hora com `getHours()`, que segue o `TZ` do processo; o container roda em UTC, e a janela
08:00–20:00 da política valia das 05h às 17h de Brasília. Agora a porta e o simulador da Régua
leem a hora no fuso da política por `partesNoFuso` do `@mktos/shared` (a mesma conta que põe os
slots na agenda da semana, `Intl` com `hourCycle: 'h23'`), e o `TZ` do processo deixa de
importar. O JSON da política não mudou: sem seed e sem assinatura.

| Peça | Onde |
|---|---|
| `FUSO_DA_POLITICA`, `fusoDaPolitica()` (`POLITICA_FUSO_HORARIO`), `minutosNoFuso`, `horarioNoFuso`, `fusoValido` | `apps/api/src/policy/limites.ts` |
| A porta lê a hora pelo fuso; fuso desconhecido derruba o arranque | `apps/api/src/policy/sinais.service.ts` |
| O simulador aceita `momento` (ISO) ou `agora: true` e devolve `relogio` (fuso e hora considerada); horário, instante OU agora | `apps/api/src/policy/simulador.ts` |
| O painel devolve `fuso`; o texto do sinal diz o fuso | `apps/api/src/policy/regua.service.ts` |
| O rótulo diz o fuso, o botão "Agora" pede a hora ao servidor, o resultado mostra a hora lida; a janela em "Limites desta empresa" diz o fuso | `apps/web/src/app/regua/AbaSimulador.tsx`, `AbaSinais.tsx`, `tipos.ts` |
| `POLITICA_FUSO_HORARIO` (padrão `America/Sao_Paulo`) | `docker-compose.yml` (`environment:` do `api`) e `.env.example` |

**Medido** (Mac, `marketing_os_test`, 24/09/2026 ~17h50, já com as correções da revisão):
`pnpm typecheck` 7/7; `typecheck:test` limpo; api direto com `TEST_DATABASE_URL` **2689 de 2689**
em 65 arquivos, igual com `TZ=UTC`, `TZ=Asia/Tokyo` e o fuso do Mac (+6 em `porta`, 1 com banco;
sem ele, 2113 passados e 576 pulados); `test:porta` **45**; web **560** em 43 (+4); policy 74 (não
tocada). `build` + `smoke` OK com `TZ=UTC`, e `POLITICA_FUSO_HORARIO=Marte/Olympus` com
`SMOKE_ESPERA_QUEBRA` fecha a trava. O caso novo da porta foi rodado contra o `getHours()` antigo e
reprovou em `21:00Z com TZ=UTC`. Pisos da CI: api 1994/57, web 379/34, com a conta no `ci.yml`.

**Ensaio pelo HTTP** (`dist/main.js` com `TZ=UTC`, token assinado com segredo descartável):
`GET /api/policy/regua` devolve `fuso: America/Sao_Paulo`; `POST /api/policy/simular` com
`email.enviar` e `momento` 21:00Z → hora considerada 18:00, nenhum sinal, R3; 23:30Z → 20:30,
`fora_da_janela`, R4; 10:30Z → 07:30, `fora_da_janela`, R4. Depois da revisão, com o
`dist/main.js` em `TZ=UTC` às 20:50 UTC: `agora: true` → hora considerada 17:50 em SP, R3;
`agora` junto com `horario` → 400 "informe o horário, o instante OU agora, só um deles".

**Depois da revisão de três revisores:** o botão "Agora" mandava `new Date()` do navegador, e um
computador com o relógio 10 min adiantado via 20:05 e R4 onde a porta, no mesmo instante, daria
19:55 e R3. Agora ele manda `agora: true` e o simulador lê o relógio do servidor, uma vez só
(`resolverAgora`), que é a mesma fonte da porta. `minutosNoFuso` deixou de ter um `Intl` próprio e
lê a hora de `partesNoFuso` do `@mktos/shared`; `FUSO_DA_POLITICA` é a própria
`PAUTA_FUSO_DA_AGENDA`. **Limite registrado:** a agenda da semana (MC16, slots propostos da MD1)
lê a constante `PAUTA_FUSO_DA_AGENDA` e NÃO acompanha `POLITICA_FUSO_HORARIO`. Preencher a
variável com outro fuso faz a porta julgar o slot das 18:00 de SP em outro relógio; se um dia a
operação sair de SP, as duas mudam juntas. A regra para as próximas fatias (a D-MC9.4, "08h–20h de
SP pelo executor", é a primeira): quem decide por hora de SP usa `minutosNoFuso` de
`policy/limites.ts`, nunca `getHours()` nem uma conta nova.

**Mudança de comportamento, para TODAS as capacidades:** das 17h às 20h de São Paulo o sinal
deixa de acender, e das 05h às 08h passa a acender. Rotina que hoje sobe um degrau à tarde deixa
de subir; rotina que roda de madrugada entre 05h e 08h passa a subir. Fica de fora a formatação de
data em `integrations/conectores.ts` (texto de exibição, não decide nível).

**Deploy:** nenhuma migration, capacidade, permissão ou seed. `POLITICA_FUSO_HORARIO` já tem padrão no
compose; valor inválido derruba a API no arranque (conferir o log se ela não subir).

### Onda D, fatia MD4 — a mídia da peça no storage e a URL pública assinada (24/09/2026)

Especificação em `docs/especificacoes/MD-onda-d-automacao.md` (MD4). A Graph da Meta só publica
mídia que ela consegue baixar de uma URL pública, e só aceita imagem em JPEG. Até aqui o mp4 do
corte ficava só no Mac e as imagens eram PNG num MinIO fechado. **Decisão que muda (MC9/MC15):** o
mp4 do corte passa a morar também no storage da VPS; nada é apagado no Mac. Nenhuma capacidade
nova: servir o arquivo é leitura, e publicar é a MD6.

| Peça | Onde |
|---|---|
| JPEG da peça: assinatura FFD8FF, tamanho pelo SOF0/SOF1/SOF2, até 8 MB, largura 320–1440, proporção do formato | `apps/api/src/pauta/imagem-jpeg.ts`; `POST /pauta/pecas/:id/imagens/:n` aceita `image/jpeg` (multer em 8 MB); `GET …/imagens/:n?tipo=jpeg` |
| `meta.imagens[]` com `tipo` (`png`/`jpeg`, ausente = PNG) e `sha256` inteiro; a tela recebe `imagens` (PNG) e `jpegs` | `derivacao-do-episodio.ts`, `derivacao.service.ts`, `PautaImagemDaPeca` no shared |
| O mp4 cru, por stream: `POST /pauta/pecas/:id/video/arquivo` (`pauta.editar`), `Content-Type: video/mp4`, `Content-Length` ≤ `PAUTA_VIDEO_MAX_BYTES` e `X-Conteudo-Sha256` conferidos antes de ler; 415/411/413/400 com `Connection: close` | `derivacao.controller.ts`, `video-do-corte.ts` (`conferirCabecalhosDoEnvio`) |
| `ConferenciaDoMp4` (Transform): conta, sha256, `ftyp` primeiro, `moov` antes do `mdat`, nenhuma caixa passa do fim; lido o `moov`, a duração tem de bater com o trecho (±1 s) e o vídeo ser 1080×1920, senão aborta ali | `apps/api/src/pauta/video-do-corte.ts` |
| `StorageService.putStream`: envio em partes de 16 MB feito à mão (no máximo uma parte em memória); o erro do stream aborta o envio e o objeto nunca aparece | `apps/api/src/storage/storage.service.ts` |
| Chave `pauta/pecas/<id>/corte-<sha256>.mp4`; `meta.video` = o registro do Mac (`arquivo`, `registradoEm`) + `chave`, `sha256`, `bytes`, `duracaoSeg`, `enviadoEm`; o `PUT …/video` (render novo) tira os campos do storage | `derivacao.service.ts` (`enviarVideo`, `registrarVideo`), `PautaVideoDaPeca` no shared |
| `GET /pauta/pecas/:id/video/arquivo` (`pauta.ver`): baixar o mp4 pela tela | `derivacao.controller.ts`; botão "Salvar o mp4" na aba Semana (`AbaSemana.tsx`: a folha de compartilhar no celular, como as imagens, e o download no desktop), agenda com `midia.onde: 'video'` |
| Token `base64url(payload).base64url(HMAC-SHA256)` com `PAUTA_MIDIA_PUBLICA_SEGREDO` (32+ caracteres, senão rota desligada), `exp` de no máximo 1 h, conferido em tempo constante | `apps/api/src/pauta/midia-publica.ts` |
| `POST /pauta/pecas/:id/midia-publica` (`pauta.publicar`), **só para a peça aprovada** (400 nas outras): as URLs do JPEG de cada imagem e do mp4, RASTRO `pauta.midia_publica_assinada` com 8 caracteres de cada HMAC | `midia-publica.service.ts`, `midia-publica.controller.ts` (`MidiaPublicaDaPecaController`) |
| `GET /api/midia-publica/:token`, sem guarda: token conferido ANTES de consulta; depois `comTenantPublico(orgId do token)`, o módulo `pauta` da empresa, a chave ainda da peça (só JPEG e mp4), peça aprovada ou já publicada (a que voltou a rascunho perde a URL), streaming por `pipeline` com `Cache-Control: private, no-store`, `nosniff`, sem `x-correlation-id`; qualquer falha = o mesmo 404 | `midia-publica.controller.ts` (`MidiaPublicaController`); prefixo `midia-publica` → módulo `pauta` em `tenants/modulos.ts` |
| O vigia (MD2) passa a contar como render a fazer o corte só registrado no Mac (sem o mp4 no storage) e a imagem sem o JPEG; o JPEG entra na assinatura. O encadeamento (MD1) usa a mesma régua para o motivo "peça(s) sem render" | `midiaProntaDaPeca` e `renderPendente` em `pauta/midia-do-episodio.ts`; `encadeamento.service.ts` |
| Carrossel com mais de 10 slides não aprova (`PATCH /pauta/pecas/:id`) | `motivoParaNaoAprovarDaSemana` em `derivacao-do-episodio.ts`, chamado em `rotina.service.ts` |
| Mac: `-ar 48000` no corte; `cortes` confere o faststart pelas caixas de topo, calcula o sha256, registra (PUT) e sobe (POST) por `fetch` com `createReadStream` e `duplex: 'half'`; o mesmo sha que já está no OS não sobe de novo; a falha do envio fica no corte (`subiu: false` com o motivo, o vigia avisa) e o laço segue; pelo proxy do web o mp4 acima de 10 MB nem tenta, e o envio tem prazo; `stories`/`carrosseis` convertem com `sips -s format jpeg -s formatOptions 90` e sobem os dois | `tools/root-midia/lib/semana.mjs`, `lib/os.mjs` (`enviarVideoDoCorte`, `ROOT_OS_ENVIO_URL`), `root-midia.mjs` |
| `PAUTA_MIDIA_PUBLICA_SEGREDO`, `PAUTA_MIDIA_PUBLICA_ORIGEM` (vazia = `PUBLIC_BIO_ORIGIN`), `PAUTA_VIDEO_MAX_BYTES` (314572800); `ROOT_OS_ENVIO_URL` só no Mac | `docker-compose.yml` (`environment:` do `api`) e `.env.example` |

**Desvios da especificação, com o porquê:**
- O `putObject(stream)` do `minio` **não** é usado para o mp4: ele liga o stream ao fatiador com
  `pipe`, que não repassa erro da origem. Quando a conferência recusa o arquivo no meio, o fatiador
  nunca termina e o envio fica pendurado (lido em `node_modules/minio/dist/main/internal/client.js`,
  `uploadStream`). O `putStream` usa as primitivas públicas do mesmo `minio`
  (`initiateNewMultipartUpload`, `uploadPart`, `completeMultipartUpload`, `abortMultipartUpload`).
- O sha256 vem **declarado** no cabeçalho `X-Conteudo-Sha256` e é conferido no fim. É ele que dá o
  nome da chave antes de o corpo terminar; sem ele seria preciso subir numa chave temporária e
  depois copiar e apagar. Como o S3 só publica o objeto no `complete`, um envio recusado não
  substitui nada que já estava na chave.
- A duração não vem do Mac: é lida do `mvhd` do próprio arquivo, e a largura/altura do `tkhd`.
- A rota pública também confere se a empresa do token ainda tem o módulo `pauta` (o gate deixa
  anônimo passar).

**Achado que vira manual — o proxy do Next corta o corpo em 10 MB.** O `/api` do
`os.operacaoroot.com` passa pelo rewrite do Next, e o Next 15 clona o corpo de toda requisição
com teto de `middlewareClientMaxBodySize` (10 MB) — `next/dist/server/body-streams.js`,
usado por `router-server.js` no proxy do rewrite, com ou sem middleware. Medido com `next dev`
apontando para a API compilada: o corte de 17,9 MB por `http://127.0.0.1:4315/api/…` fica sem
resposta e o Next registra "Request body exceeded 10MB"; nada é gravado (a peça seguiu com o sha
anterior). Subir o teto do Next faria o web segurar o corpo inteiro em memória (o clone não tem
contrapressão). Por isso o Mac sobe o mp4 por `ROOT_OS_ENVIO_URL`, que precisa apontar para a API
sem passar pelo `mktos_web` (passo do Pedro na VPS). PNG (5 MB) e JPEG (8 MB) cabem nos 10 MB.

**Medido** (Mac, `marketing_os_test`, 24/09/2026 ~18h30): `pnpm typecheck` 7/7; `typecheck:test`
limpo; api direto com `TEST_DATABASE_URL` **2734 de 2734** em 66 arquivos (+45, +1 arquivo:
`pauta-midia-publica` 24, `pauta-semana` +7, `root-midia` +9, `modulos-por-tenant` +1,
`pauta-midia` +1, `rotas-publicas-tenant` +3 com banco); sem ele, 2155 passados e 579 pulados; web **563** em 43
(+3); `test:isolamento` **326** (nenhuma tabela nova); `test:porta` 45; policy 74 (não tocada);
`db:diff` "No difference detected." (nenhuma migration); `build` + `smoke` OK com
`/api/pauta/pecas/x/video/arquivo` e `/api/pauta/episodios/x/semana` em 401. Pisos da CI: api
2030/58, web 382/34, com a conta no `ci.yml`.

**Ensaio local — o "pronto quando"** (`dist/main.js` contra `marketing_os_zero_md4`, criado vazio:
migrations do zero, `db:seed` e `db:seed:politica`; segredo gerado com `openssl rand -base64 48`;
MinIO descartável da imagem `minio/minio` em `127.0.0.1:9312`, removido no fim; um episódio `ep-01`
em Derivação com 4 matérias semeado direto no banco; vídeo final sintético de 120 s em 1920×1080
com áudio de 44,1 kHz):
1. `root-midia cortes-verticais ep-01` → 4 cortes (20, 25, 20 e 30 s; 17,9, 22,4, 17,9 e 26,9 MB,
   todos acima de uma parte, então pelo envio em partes), áudio em **48000 Hz** no ffprobe; o
   `sha256` gravado no OS é **igual** ao `shasum -a 256` local nos quatro. Rodar de novo a matéria 1
   → "o mesmo mp4 já está no OS", sem PUT nem POST.
2. `POST …/midia-publica` → URL com `exp` em 1 h; `curl` nela → 200 `video/mp4`, `Content-Length`
   17900266, `Cache-Control: private, no-store`, sem `x-correlation-id`, e `cmp` **byte a byte
   igual** ao mp4 do Mac. O download autenticado (`GET …/video/arquivo`) também igual; sem token, 401.
3. Com `log_statement = all` no banco do ensaio: token **vencido**, **outra empresa**, **outra
   chave** e **HMAC trocado** → 404 cada, e **0** comandos no Postgres; o token válido, de controle,
   → `set_config` + `SELECT … "PautaPeca"`.
4. `root-midia carrosseis ep-01 --so 1` → 4 PNG e 4 JPEG no OS; a URL assinada do JPEG 1 → 200
   `image/jpeg`, **1080×1350** pelo `sips`, igual ao do Mac. `stories --so 1` → JPEG 1080×1920.
5. `Content-Length` de **301 MB** (arquivo esparso, `curl -T`) → **413** "O mp4 tem 301 MB; o teto é
   300 MB." em 19 ms, com 851 kB enviados antes de a conexão fechar. Um corte refeito com
   `-movflags -faststart` → 400 "não tem faststart".

**Volume:** um corte de 20–30 s saiu com 17–27 MB no ensaio (vídeo sintético, `libx264`, ~7 Mbit/s).
Com cortes reais de 1–3 min, a estimativa é de 50 a 150 MB por corte e **0,3 a 1 GB por semana** de
quatro cortes, mais uns 5 MB de JPEG. **Estimativa**, a medir com o primeiro episódio real. Nada é
apagado do storage nesta fatia (nem ao reenviar: o sha novo é outra chave).

**Deploy:** nenhuma migration, capacidade, permissão ou seed. Variáveis novas com padrão no compose;
sem `PAUTA_MIDIA_PUBLICA_SEGREDO` a rota pública responde 404 e `POST …/midia-publica` responde 503.

**Correção da revisão (três revisores, 24/09/2026).** Corrigido, cada item com teste:
- **O encadeamento contava o corte com o mp4 no OS como "sem render".** A MD4 criou `onde: 'video'`
  e o encadeamento seguia com `storage || mac`. Agora os dois (vigia e encadeamento) usam a mesma
  função, `midiaProntaDaPeca`: o corte está pronto só com o mp4 no storage, e a imagem, com o PNG e
  um JPEG por imagem. O corte só registrado no Mac passa a pedir render no motivo, como já pedia ao
  vigia.
- **Um envio que não chegava derrubava os cortes seguintes.** `subirCorteAoOs`
  (`tools/root-midia/lib/semana.mjs`) isola a falha do POST por corte; sem `ROOT_OS_ENVIO_URL` e com
  a API fora desta máquina, o mp4 acima de 10 MB nem tenta subir; se a peça já tem outro mp4 no OS,
  o corte barrado também não é registrado, porque o PUT apagaria a referência. O fetch do envio tem
  prazo (`AbortSignal.timeout`, 1 min mais 1 s a cada 256 kB).
- **O cabeçalho de 64 bits partido entre 9 e 15 bytes dava 500.** A conferência recalcula quantos
  bytes o cabeçalho precisa depois de juntar o pedaço.
- **`pipe` no lugar de `pipeline`** nas três rotas que entregam arquivo do storage (mídia pública,
  mp4 e imagem da peça): `common/entregar-arquivo.ts`.
- **Editar a legenda durante o envio derrubava o mp4 (409).** O envio compara só o que está no vídeo
  (início, fim e transcrição).
- **Salvar o mp4 no celular:** a folha de compartilhar, como as imagens (o download do iPhone vai
  ao app Arquivos, e o Instagram escolhe das Fotos).
- Os textos que ainda diziam "o mp4 fica no Mac" (`docs/PAUTA.md`, o uso semanal do
  `PLANO-MAQUINA-DE-CONTEUDO.md` e o cabeçalho de `AbaSemana.tsx`), e a ordem dos comentários em
  `midia-do-episodio.ts`.

**Decisão registrada:** `POST /pauta/pecas/:id/midia-publica` fica como rota (é o ensaio da MD6 e o
que o efeito da MD6 vai chamar), mas só assina peça **aprovada**. Uma pessoa com `pauta.publicar`
não põe mais o arquivo de um rascunho numa URL pública.

**Medido depois da correção** (Mac, `marketing_os_test`, 24/09/2026): `pnpm typecheck` 7/7;
`typecheck:test` limpo; api direto com `TEST_DATABASE_URL` **2742 de 2742** em 66 arquivos (+8:
`pauta-encadeamento` +1, `pauta-midia-publica` +3, `pauta-semana` +1, `root-midia` +3); sem ele,
2163 passados e 579 pulados; web **564** em 43 (+1); `build` + `smoke` OK. Schema, política e porta
não mudaram. Pisos da CI: api 2037/58, web 383/34, com a conta no `ci.yml`.

**Pendências (do Pedro), na ordem:**
1. **Gerar `PAUTA_MIDIA_PUBLICA_SEGREDO`** no terminal da VPS (`openssl rand -base64 48`) e colar no
   serviço `api` do easyPanel. Nunca em chat. Sem ele a rota pública fica desligada (404).
2. **Conferir `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT` e `S3_BUCKET`** no serviço `api` da
   VPS. Sem elas, o envio de imagem e de mp4 responde 503.
3. **Abrir uma rota até a API que não passe pelo `mktos_web`** (o proxy do Next corta o corpo em
   10 MB), com o limite de corpo do Traefik em pelo menos 300 MB.
4. **Pôr `ROOT_OS_ENVIO_URL`** (essa rota, com o `/api`) em `~/.config/root/root-midia.env`
   **antes do deploy**. Sem ela, a primeira passagem do vigia depois do deploy refaz os cortes, e o
   mp4 acima de 10 MB fica só registrado, com o aviso "não subiu ao OS".
5. **Conferir na MD6** se a Graph pede `Range` (esta versão não atende) e se baixa pela origem
   `PUBLIC_BIO_ORIGIN`. O `requestTimeout` do Node é de 300 s: subir 300 MB pede cerca de 8 Mbit/s
   de subida do Mac até a VPS.

### Onda D, fatia MD5 — a conta de publicação do Instagram e a Graph v24 (24/09/2026)

Especificação em `docs/especificacoes/MD-onda-d-automacao.md` (MD5). A conta da própria Root publica
com Standard Access, sem App Review, desde que o @ tenha papel no app. Esta fatia cria só a
**conexão**: nada é publicado (isso é a MD6), nenhuma capacidade nova, nenhuma permissão nova.

| Peça | Onde |
|---|---|
| `ESCOPOS_DE_PUBLICACAO` = `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments` (comentários já pedidos para a MD9); o `ESCOPOS` da bio **intocado** (só `instagram_business_basic`); `urlDeAutorizacao(estado, cred, finalidade)` | `apps/api/src/bio/plataformas/instagram.ts` |
| `INSTAGRAM_OAUTH_URL`, `INSTAGRAM_TOKEN_URL`, `INSTAGRAM_GRAPH_URL` só para dublê (vazias = Meta), lidas a cada chamada | `instagram.ts`; `docker-compose.yml` e `.env.example` |
| Os escopos concedidos lidos nas formas que a Meta usa (texto ou lista, com ou sem `data[]`); ausentes = `null`, e a publicação não presume nada | `escoposConcedidos` e `trocarCodigo` em `instagram.ts` |
| Migration `20260924220041_bio_finalidade`: enum `BioFinalidade {bio, publicacao}`, `BioOauthState.finalidade` e `BioConexao.finalidade` (padrão `bio`), índice único parcial `BioConexao_publicacao_unica` (`orgId`, `plataforma`) `WHERE finalidade = 'publicacao'`; espelho `BIO_FINALIDADES` no shared | `apps/api/prisma/`; `packages/shared/src/schemas.ts` |
| `iniciarConexao(orgId, plataforma, finalidade)` grava a finalidade no state; publicação pelo TikTok recusada (MD12 em espera) | `apps/api/src/bio/bio.service.ts` |
| Callback no **mesmo** `/api/conectar/instagram/callback`: `publicacao` só com `instagram_business_content_publish` concedido; sem ele, grava `bio` e volta com `publicacao_sem_escopo`. A de publicação reconectada pela bio sem publicar cai para `bio` (`publicacao_perdida`). Um segundo @ de publicação rebaixa o anterior na mesma transação; o índice parcial segura duas autorizações simultâneas. State fora do formato (16–128 base64url) volta como `expirado` sem consulta; cancelar gasta o state. A volta da publicação é `/pauta?aba=semana&conexao=<motivo>` | `bio-oauth.controller.ts`, `bio/finalidade-da-conexao.ts` |
| `POST /pauta/instagram/conectar` (`pauta.publicar` **e** `bio.editar`) devolve a URL; `GET /pauta/instagram/conexao` (`pauta.ver`) devolve @, escopos, validade, status e se há credencial, nunca o token. Conectar não pergunta ao interruptor (autorizar não sai da casa, como `IntegrationsService.autorizar`) | `apps/api/src/pauta/conta-de-publicacao.controller.ts`, `BioService.contaDePublicacao` |
| O token de 60 dias da conta de publicação passa a ser renovado pelo sync agendado da bio (antes só a conta de desafio era renovada, e a de publicação morreria em 60 dias) | `BioSyncService.renovarContasDePublicacao` |
| Graph da trilha do Facebook de `v21.0` para `v24.0` (padrão de `META_GRAPH_URL` e o diálogo do OAuth); o texto que dizia que mudar a redirect exige App Review foi corrigido (sem fonte; o que exige é recadastrar no console) | `apps/api/src/meta/meta.service.ts`, `integrations.controller.ts`, `bio-oauth.controller.ts`, `CLAUDE.md` |
| Cartão "Conta de publicação" no topo da aba Semana: conectar/reconectar, o @, os escopos, a validade e a frase do App Review; a volta do OAuth abre a Semana com o aviso. Na bio, a conexão de publicação ganha o selo "publicação" | `apps/web/src/app/pauta/ContaDePublicacao.tsx`, `pauta/page.tsx`, `bio/AbaConexoes.tsx` |

**Desvios da especificação, com o porquê:**
- A renovação do token "já existia" só para conta de desafio (`sincronizarTudo` só varre
  `BioChallengeAccount`). Sem o laço novo, a conta de publicação morreria em 60 dias.
- A reconexão pela bio da conta que era de publicação: se a Meta não devolver o escopo de publicar,
  a conexão cai para `bio` (o token novo não publica). Deixar `publicacao` faria a MD6 falhar na
  hora do post.
- O callback continua sem declarar empresa no contexto (a leitura do state é anterior a saber a
  empresa), e a renovação nova varre as conexões de todas as empresas do mesmo jeito que o sync dos
  desafios já varria. Sob `TENANT_MODO=impor` a rodada lança e vira aviso; sob `mktos_app` não acha
  conta nenhuma; nos dois casos o token de publicação morreria no dia 60 sem alarme. Os dois
  arquivos (`src/bio/bio-sync.service.ts` e `src/bio/bio-oauth.controller.ts`) entraram em
  `CAMINHOS_DE_PLATAFORMA_EXIGIDOS`: a conferência do arranque passa a recusar a virada do papel
  restrito enquanto eles não declararem contexto. Hoje a API conecta como dona e só loga o aviso.

**Medido** (Mac, `marketing_os_test`, 24/09/2026 ~19h10): `pnpm typecheck` 7/7; `typecheck:test`
limpo; api direto com `TEST_DATABASE_URL` **2769 de 2769** em 67 arquivos (+27: `bio-oauth` 26,
novo, 9 deles com banco; `modulos-por-tenant` +1); sem ele, 2181 passados e 588 pulados; web
**570** em 44 (+6, `component/pauta-conta-de-publicacao` novo); `test:isolamento` **326** (a
semente de `BioConexao` e `BioOauthState` agora com `finalidade = 'publicacao'`); `db:diff` "No
difference detected."; `build` + `smoke` OK. Policy e porta não mudaram. Pisos da CI: api 2052/59,
web 388/35, com a conta no `ci.yml`.

**Ensaio local — o "pronto quando"** (`dist/main.js` contra `marketing_os_zero_md5`, criado vazio
com as migrations do zero e o `db:seed`, apagado no fim; dublê HTTP da Meta em `127.0.0.1:4199`
nas três variáveis; credencial de app fictícia no ambiente):
1. `POST /api/pauta/instagram/conectar` → URL com
   `scope=instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments`
   e a redirect `…/api/conectar/instagram/callback`.
2. O dublê concede publicar → callback → `302 /pauta?aba=semana&conexao=ok`;
   `GET /api/pauta/instagram/conexao` mostra `@root.ensaio`, os três escopos, `podePublicar: true`
   e a validade de 60 dias, sem token.
3. O dublê nega publicar → `302 /pauta?aba=semana&conexao=publicacao_sem_escopo`; a conexão fica
   `bio` com `instagram_business_basic`, e a conta de publicação volta a `null`.
4. `GET /api/bio/connections/instagram/start` → `scope=instagram_business_basic` só; o callback
   volta em `/bio?conexao=ok` e grava `criador.ensaio` como `bio`.
5. State malformado → `/bio?conexao=expirado`; nenhum state sobrou no banco; sem sessão, 401.

**Correção da revisão** (três revisores, 24/09/2026 ~19h30):
- A renovação da conta de publicação deixou de filtrar por `status: 'ok'`. Antes, uma falha de rede
  ou um 5xx gravava `erro`, a heurística `/oauth|token|401|expired/` marcava `token_expirado` até em
  limite de taxa (a Graph devolve `OAuthException` com código 4), e a conta saía de todas as rodadas
  seguintes: o token morria no dia 60. Agora a busca é pela validade (vence em menos de 10 dias e
  ainda não venceu); só o código 190 da Graph (`tokenRecusadoPelaMeta`) marca `token_expirado`; o
  resto grava só `ultimoErro`; e a renovação que dá certo volta a `status: 'ok'` e limpa o erro
  (vale também para a conta de desafio, que passa pelo mesmo `tokenValido`).
- `GET /pauta/instagram/conexao` responde se há credencial por `BioCredenciaisService.estado`, sem
  decifrar o segredo nem pegá-lo emprestado do cofre (o empréstimo carimbava `usadoEm` a cada vez que
  alguém abria a aba Semana).
- `DELETE /bio/connections/:id` exige `pauta.publicar` quando a conexão é a de publicação, e o audit
  `bio.conexao_delete` guarda a `finalidade`. Na aba Conexões da bio a lixeira dela some para quem
  não tem `pauta.publicar`.
- O state que existe mas venceu (ou é de outra plataforma) é gasto e volta para a tela que o pediu:
  `/pauta?aba=semana&conexao=expirado` na publicação.
- `INSTAGRAM_OAUTH_URL`, `INSTAGRAM_TOKEN_URL` e `INSTAGRAM_GRAPH_URL` são lidas por
  `process.env.X` dentro de `instagram.ts` e entraram no catálogo `CREDENCIAIS` da catraca de
  arquitetura: ler qualquer uma delas fora do conector reprova a suíte.
- O texto "mudar a redirect exige App Review" saiu também de `arquitetura.test.ts`,
  `tenants/modulos.ts` e `tenants/modulos.interceptor.ts`. O parágrafo da aba Semana deixou de dizer
  que a publicação espera a Meta (D-MC8): ela chega na MD6, e o TikTok está em espera. A mensagem de
  `publicacao.service.ts` ("exige content_publish com App Review") fica para a MD6, porque a lista
  "não fazer" proíbe mexer na rota antiga.
- O caso "outra empresa" do `bio-oauth.test.ts` passou a provar algo: a empresa B conecta o MESMO @
  para publicar pelo state dela, a conexão fica em B e a conta de publicação de A não muda.

Recusado: reconectar pela bio a conta que era de publicação continua podendo rebaixá-la
(`publicacao_perdida`). O @ só é conhecido depois do OAuth, e o token novo, sem o escopo de
publicar, já substituiu o antigo na mesma linha; manter `publicacao` faria a MD6 falhar na hora do
post. O aviso na volta é o que sobra.

**Medido depois da correção**: `pnpm typecheck` 7/7; `typecheck:test` limpo; api direto com
`TEST_DATABASE_URL` **2775 de 2775** em 67 arquivos (`bio-oauth` 26 → 32); sem ele, 2184 passados e
591 pulados; web **571** em 44; `test:isolamento` **326**; `db:diff` "No difference detected.";
`build` + `smoke` OK. Pisos da CI: api 2054/59, web 389/35.

**Deploy:** uma migration aditiva (enum, duas colunas com padrão `bio`, um índice parcial); nenhuma
capacidade, permissão ou seed. As três variáveis novas ficam **vazias** em produção.

**Pendências (do Pedro), na ordem:**
1. No developers.facebook.com, no app de `INSTAGRAM_APP_ID`: conferir que é do tipo **Business** e
   tem o caso de uso **"API setup with Instagram login"**; ver `instagram_business_content_publish`
   e `instagram_business_manage_comments` com **Standard Access**, sem pedir Advanced Access.
2. Ainda no app: conferir que `https://bio.operacaoroot.com/api/conectar/instagram/callback` está
   nas redirects do Login do Instagram.
3. App roles › Roles › **Instagram Testers**: adicionar o @ da Root; no Instagram, Configurações ›
   Apps e sites › Convites de testador › aceitar. Conferir que a conta é **profissional**.
4. Depois do deploy: aba Semana da Pauta › **Conectar** (ou Reconectar) e aceitar publicar. Se
   voltar "A Meta não concedeu publicar", refazer os passos 1 e 3.
5. **A conferir no primeiro OAuth real:** se o corpo do token curto traz `permissions`. Sem ele a
   conexão fica como da bio (falha fechada) e o aviso aparece: aí é trocar a leitura por outra
   prova antes da MD6.

### Onda D, fatia MD6 — o publicador do Instagram (24/09/2026)

Especificação em `docs/especificacoes/MD-onda-d-automacao.md` (MD6). A primeira escrita pública
automática do OS entra pela régua como qualquer escrita de fora: capacidade R3, efeito por registro,
segunda pessoa. **Nada publica sozinho nesta onda**: a rotina conclui o que já foi aprovado item a
item e, no horário, só registra `pulada` até existir o lote (MD7/MD8).

| Peça | Onde |
|---|---|
| Capacidade `instagram.post.publicar` (R3 pelo efeito, `reversibilidade: manual`, `sensibilidade: publica`; sem `ferramenta`, sem `desfazer`; `argsSchema` fechado com `pecaId`, `formato`, `legenda`, `midias`, `igUserId` obrigatórios e `agendadaPara` opcional); delta `1.3.0`, catálogo com 63; `CONECTOR_DA_CAPACIDADE` = `instagram` | `packages/policy/politica-marketing-os.json`, `apps/api/src/integrations/conectores.ts` |
| HTTP puro da publicação (`limiteDePublicacao`, `criarContainer`, `statusDoContainer`, `publicarContainer`, `permalinkDe`, `midiasRecentes`), Graph `v24.0` no caminho, prazo de 60 s, `ErroDaGraph` com `status: null` quando não houve resposta | `apps/api/src/bio/plataformas/instagram.ts` (o único arquivo com o endereço da Graph) |
| O cliente chega ao publicador por injeção: token e interface em `pauta/graph-de-publicacao.ts`, fiação em `bio/plataformas/publicacao.module.ts` (o `*.module.ts` da pasta do conector, que a catraca permite) | idem; catraca nova em `arquitetura.test.ts` |
| O serviço: pedido pela porta, efeito inscrito no `EfeitosRegistry`, máquina de estados (tomada só de `pendente`/`erro`, posse em `proximaEm`, escrita condicionada ao estado lido e à posse), conclusão pela rotina com o interruptor, RASTRO `pauta.publicacao_passo` e `pauta.peca_publicada` | `apps/api/src/pauta/publicacao-instagram.service.ts`, parte pura em `publicacao-instagram.ts` |
| Rotas `POST /pauta/pecas/:id/publicar-instagram` e `POST …/publicacao/manual` (`pauta.publicar`), `GET …/publicacao` (`pauta.ver`) | `apps/api/src/pauta/publicacao-instagram.controller.ts` |
| Tabela `PautaPublicacao` (filha de `PautaPeca`: sentinela, gatilho `mktos_orgid_do_pai`, RLS FORCE com leitura e escrita separadas; único `(pecaId, rede)`); enums `PautaRede` e `PautaPublicacaoEstado` espelhados em `PAUTA_REDES` e `PAUTA_PUBLICACAO_ESTADOS` | migration `20260924224733_pauta_publicacao`; `modelos-globais.ts` (`FILHOS_COM_ORGID_REDUNDANTE` = 17); `tenant-isolation.test.ts` |
| Rotina `pauta.publicar-agendadas` (`* * * * *`), no `TIPOS_DA_PAUTA` (`PAUTA_CRON=off` a cala), criada em `/rotinas` por "Nova rotina de publicação" | `apps/api/src/routines/executores/pauta-publicar.executor.ts`; `apps/web/src/app/rotinas/NovaRotinaDePublicacao.tsx` |
| A agenda traz `publicacao` por peça; cada slot da Semana mostra o estado, o link da publicada, o motivo do erro, "Publicar agora" e "Voltar ao manual"; o `root-midia agenda` mostra a mesma linha | `agenda.service.ts`; `apps/web/src/app/pauta/PublicacaoNoInstagram.tsx`; `tools/root-midia/lib/semana.mjs` |

**Desvios da especificação, com o porquê:**
- **O publicador não importa o conector.** A catraca "conector só pela porta" proíbe `pauta/`
  de importar `bio/plataformas/instagram.ts`, e acrescentar uma exceção seria dívida nova. O
  cliente chega por injeção, e a catraca nova confere que só a declaração, a fiação e o publicador
  citam o token.
- **Sem `hashKeys` no catálogo.** O `CapacidadeSchema` não tem o campo (o Zod o descartaria em
  silêncio). Os argumentos são exatamente os seis da SPEC, e o corpo inteiro vai ao hash, que é o
  mesmo conteúdo. O `loteItemId` fora do hash é da MD7.
- **`agendadaPara` é opcional.** A validação da porta trata `null` em campo obrigatório como
  ausente; o "Publicar agora" de peça sem agenda não teria como passar.
- **A rotina ainda não chama a porta.** Sem a MD7 a porta não confere lote: um `ToolGateway.executar`
  da rotina criaria uma aprovação R3 por minuto. A decisão (`decisaoDaRotina`) já cobre nota, lote,
  janela e a espera pela MD7; o que falta é a MD7 trocar `loteConferidoPelaPorta` e a chamada.
- **Resposta do publish perdida:** o container `PUBLISHED` é achado pela legenda nas mídias recentes
  (não há campo que ligue container a mídia). O story, sem legenda e fora de `/media`, fica
  `publicada` sem id e com o aviso — nunca repostado.
- **Limite de 100/24 h atingido vira `erro`** (volta ao manual), não espera: a janela é móvel e o
  container vence em 24 h.
- **O texto da recusa de Instagram na rota antiga** (`publicacao.service.ts`) deixou de dizer que
  publicar exige App Review e aponta para o "Publicar agora". Só o texto: a rota e o
  `publicar-peca.test.ts` não mudaram.

**Correção da revisão (três revisores, 24/09/2026 ~21h).** Confirmados e corrigidos, cada um com teste:
- **A rotina disputava a linha com o efeito** (bloqueante). A `concluir` pegava `container_criado`
  com `proximaEm` nulo, que era exatamente a linha do efeito trabalhando: o tique no meio dos
  containers mandava o carrossel aprovado para `erro` (e o efeito terminava sem publicar, com a
  aprovação gasta); o tique no meio do `media_publish` passava pela "tomada" (de `container_criado`
  para `container_criado`) e mandava um **segundo publish** do mesmo container. Agora a linha tem
  **posse**: a tomada do efeito grava `proximaEm = agora + (mídias + 6) × 60 s`, a marca do publish
  grava outra, a rotina só pega posse vencida e a toma com `updateMany` condicionado ao `proximaEm`
  lido, e toda escrita do dono é condicionada à posse dele (o `gravar` dos containers que der 0
  aborta com 409). `publicandoEm` passou a ser lido: com ele, a máquina **nunca** chama
  `media_publish` de novo — `FINISHED` vira "confirmando" (relê a cada minuto) e, passados 10 min,
  erro que manda conferir no Instagram. Publish com erro e resposta: relê uma vez; `PUBLISHED`
  recupera, senão `erro`. Publish sem resposta: `container_criado` e a rotina relê. O pedido novo
  depois de um publish incerto relê o container antigo antes de criar outro (`PUBLISHED` = é este o
  post). Testes: tique no meio da criação, tique no meio do publish, posse vencida no meio do publish,
  publish perdido sem post (1 min, 10 min, pedido novo) e pedido novo que acha o post antigo.
- **O efeito devolvia sucesso em falha** (ERROR, limite, publish recusado): agora lança depois de
  gravar estado e passo; a porta registra `acao.falhou` e a confirmação mostra o motivo.
- **O pedido `pendente` não tinha saída** quando a aprovação vencia (900 s) ou era recusada, e o
  container vencido gravava `pendente` "peça de novo" sem botão. `publicacoesParaATela` (usada pela
  agenda e por `GET …/publicacao`; o `dasPecas` sem chamador saiu) deriva da aprovação: vencida,
  recusada, sumida ou consumida sem a tomada chega como `erro` com o motivo; `pendente` com erro
  gravado também. A tela oferece "Publicar agora" em `pendente` com motivo. A falta da URL pública
  da mídia é conferida no pedido, **antes** da fila (nenhuma aprovação queimada), e no efeito grava
  `erro` antes do 503.
- **O RASTRO da conclusão pela rotina** saía na correlação e no ator da passagem. A tomada do efeito
  guarda `correlacao` e `aprovadoPor` em `containers`; a rotina escreve os passos e o
  `pauta.peca_publicada` neles, com `correlacaoDaRotina` e `approvalId` no `metadata`, e
  `publicadaPor` é quem confirmou.
- **A `pulada` do executor não ficava em lugar nenhum** (o histórico não grava `pulada`). Agora vai
  ao RASTRO como passo `pulada`, uma vez por peça, slot e motivo.
- Menores: o `pedir` cria a linha ou a reabre só de `pendente`/`erro`/`recusada` (409 se outra
  aprovação a levou); o `recusar` do efeito só escreve de `pendente`/`erro`; a aprovação de um
  pedido antigo não publica (o `ContextoDoEfeito` leva o `approvalId` quando vem da fila); o post
  recuperado sem id deixa de aparecer como "à mão" na agenda; o comentário de `containers` no
  schema lista as chaves reais; `midias` no `argsSchema` ganhou `minItems` 1, `maxItems` 10 e
  `items` fechado (chave e sha256 hex de 64), e o validador da porta passou a percorrer lista e
  `pattern` (`validacao.test.ts` +2). No banco de teste o reseed pediu a assinatura de
  REBAIXAMENTO (o seed não prova que `items` aperta, e a capacidade já estava lá); **na VPS a
  capacidade é nova**, e a assinatura continua sendo só a `POLITICA_CAPACIDADE_NOVA_*`.
- **Pisos:** isolamento 254 → 259 e a conta da policy (77, piso em 60 por escrito), que tinham
  ficado para trás; api e web remedidos.

Recusados: nenhum. Mantido e declarado: o texto da recusa da rota antiga (acima) e o container
vencido voltando a `pendente` como a SPEC pede (a tela o mostra como erro, com o botão).

**Medido depois da correção** (Mac, `marketing_os_test`, 24/09/2026 ~21h): `pnpm typecheck`;
`typecheck:test`; api direto **2821 de 2821** em 68 arquivos (sem banco, 2209 passados e 612
pulados); web **577** em 44; policy **77** em 2; `test:porta` 45; `test:isolamento` **332**;
`db:diff` "No difference detected.". Pisos da CI: api 2075/60, web 394/35, isolamento 259, policy
60/2.

**Medido na primeira entrega** (Mac, `marketing_os_test`, 24/09/2026 ~20h): `pnpm typecheck` 7/7; `typecheck:test`
limpo; policy **77** (+3: nível e efeito, sinal sobe a R4, `argsSchema`; o piso de 14 sem ferramenta
foi a 15); api direto com `TEST_DATABASE_URL` **2811 de 2811** em 68 arquivos (+35:
`pauta-publicacao-instagram` 26, novo, 13 com banco; `arquitetura` +4; `escritas-pela-porta` +2;
`modulos-por-tenant` +1; `pauta-agenda` +1; `root-midia` +1); sem ele, 2207 passados e 604 pulados;
web **576** em 44 (+5); `test:porta` 45; `test:isolamento` **332** (+6, `PautaPublicacao`);
`db:diff` "No difference detected."; `build` + `smoke` OK. Pisos da CI: api 2073/60, web 393/35,
com a conta no `ci.yml`. O `db:seed:politica` no banco de teste recusou sem assinatura e aceitou com
`POLITICA_CAPACIDADE_NOVA_*` ("capacidade nova em R3 (não declarada valia R5)").

**Ensaio local — o "pronto quando"** (`dist/main.js` contra `marketing_os_zero_md6`, criado vazio:
migrations do zero, `db:seed` e `db:seed:politica`; MinIO descartável da imagem `minio/minio` em
`127.0.0.1:9316`; dublê da Graph em `127.0.0.1:4296` como `INSTAGRAM_GRAPH_URL`, que **baixa** cada
`image_url` e registra o sha256; conta de publicação e episódio semeados no banco; 5 JPEG
1080×1350 do `sips` subidos por `POST …/imagens/:n`; banco, MinIO, API e dublê removidos no fim):
1. "Publicar agora" no carrossel aprovado → `aguardando_aprovacao`, `precisaDeOutraPessoa`, fila
   `/atendimento`; **0** chamadas ao dublê. Às 20h08 de SP o pedido saiu **R4** por
   `fora_da_janela` (a régua da MD3 funcionando): quem pediu → 403 "Quem propôs a ação não pode
   aprová-la"; a conta `gestor_marketing` → 403 "Alçada insuficiente para aprovar R4". Para medir o
   R3 da SPEC, a API subiu de novo com `POLITICA_FUSO_HORARIO=Pacific/Auckland` (11h lá) e o
   histórico de chamadas do banco descartável foi zerado (o segundo pedido da hora acende
   `volume_atipico`): o terceiro pedido saiu **R3**.
2. A segunda conta descartável (`gestor_marketing`, alçada `responsavel`) confirmou por
   `POST /approvals/:id/confirm` (o que `/atendimento` chama) → `executado`.
3. O dublê recebeu **5** containers de item (`is_carousel_item=true`), cada um com a URL assinada
   `…/api/midia-publica/<token>`, baixou os 5 JPEG (200 `image/jpeg`) com o sha256 **igual** ao
   `shasum -a 256` local dos cinco, e **1** `CAROUSEL` com `children=c1,…,c5` e a legenda; depois o
   status, o limite, o `media_publish` e o permalink.
4. A peça ficou `publicada` com `externalId` e `urlPublicada`; `PautaPublicacao` `publicada` com a
   aprovação; o RASTRO tem `pauta.peca_publicada` (canal `instagram`) e os passos `pedido`,
   `container`, `publicada` com a correlação da chamada; `acao.executada` no EventLog; a agenda
   mostra a postada com `manual: false` e a publicação.
5. Com o Instagram desligado (`POST /integrations/instagram/desligamento`), "Publicar agora" num
   segundo carrossel aprovado → 403 com a frase do interruptor; **0** chamadas novas ao dublê.
6. `POST /rotinas` (tipo `pauta.publicar-agendadas`) e "Rodar agora" com a peça no horário →
   `pulada (publicação automática desligada)`; com a nota `pauta.publicacao.automatica` = `ligada`
   → `pulada (sem aprovação da semana)`; **0** chamadas ao dublê, peça segue aprovada e sem
   publicação.

Não conferido na tela: o bloco novo do slot a 375 px (o ensaio não loga no navegador); a
disposição segue a dos botões vizinhos (`flex-wrap`, `break-words`) e o teste de componente cobre
os estados.

**Deploy:** uma migration aditiva (dois enums e a tabela, com RLS e gatilho). **Antes da subida**,
o `db:seed:politica` com `POLITICA_CAPACIDADE_NOVA_AUTOR` e `POLITICA_CAPACIDADE_NOVA_MOTIVO`:
sem ele a capacidade não existe na política do banco, vale R5 e a porta bloqueia (falha fechada,
nada sai). Nenhuma permissão nova, nenhuma variável nova (usa `INSTAGRAM_GRAPH_URL` da MD5 vazia e
`PAUTA_MIDIA_PUBLICA_*` da MD4).

**Pendências (do Pedro), na ordem:**
1. A MD5 feita no painel da Meta e a conta reconectada na aba Semana (itens 1 a 4 da MD5).
2. `db:seed:politica` na VPS **antes** do deploy, assinado:
   `POLITICA_CAPACIDADE_NOVA_AUTOR='pedro.magnago@fullbpo.com' POLITICA_CAPACIDADE_NOVA_MOTIVO='MD6: catálogo ganha instagram.post.publicar (R3)' pnpm --filter @mktos/api db:seed:politica`.
3. `PAUTA_MIDIA_PUBLICA_SEGREDO` (32+) no `.env` da VPS e a origem pública da API (MD4): sem eles o
   efeito recusa com 503 e nada é enviado.
4. Uma segunda pessoa na empresa Root (`POST /users` pela tela de usuários). Sem ela, todo
   "Publicar agora" fica retido. **A alçada decide o horário:** com `responsavel` (papel
   `gestor_marketing` ou acima) ela confirma só o pedido R3. Fora das 08h–20h de São Paulo
   (`fora_da_janela`) ou no segundo pedido dentro de uma hora (`volume_atipico`), o pedido sai
   **R4**: exige alçada **`titular`**, reautenticação e confirmação em até 10 min (o ensaio mediu
   isso às 20h08). Recomendação: a segunda pessoa com alçada titular; ou decidir por escrito
   aceitar só o R3 dentro da janela, e os posts da noite ficam manuais.
5. O 403 da fila em produção: `pnpm --filter @mktos/shared build` → `db:sync-permissions` → todos saem e
   entram (pendente desde 12/09/2026).
6. Criar a rotina em `/rotinas` › "Nova rotina de publicação" (conclui o Reels que a Meta ainda
   processa). Sob o papel restrito (passo 16), nenhuma rotina dispara até a decisão do agendamento.
7. **Não** ligar a nota `pauta.publicacao.automatica` antes da MD7/MD8 e do seed assinado com as
   duas categorias.
8. **A conferir no primeiro post real:** o valor `PUBLISHED` do `status_code` do container já
   publicado; se o post feito com o app em modo de desenvolvimento aparece para quem não tem papel
   no app; o teto de 2.200 caracteres da legenda.

### Onda D, fatia MD7 — a régua aprende a aprovação de lote com uso contado (24/09/2026)

Especificação em `docs/especificacoes/MD-onda-d-automacao.md` (MD7), base na MC18.1 generalizada.
Decisão D-MD1 aplicada como recomendado: a invariante 4 ganhou a segunda forma, e o portão humano é
a assinatura do seed. **Nada publica sozinho nesta fatia**: a rotina da MD6 segue registrando
`pulada` (quem troca a chamada para o item de lote é a MD8), e a nota `pauta.publicacao.automatica`
continua desligada.

| Peça | Onde |
|---|---|
| `CapacidadeSchema.aprovacao` = `{modo:'lote', tetoDeItens, validadeMaximaDias}` \| `{modo:'sob_lote', lote}`, união discriminada com `.strict()` (modo desconhecido ou chave estranha é recusa, nunca descarte calado) | `packages/policy/src/esquema.ts` |
| `aprovacao` virou trava de execução no diff: qualquer mudança afrouxa | `packages/policy/src/sobrescrita.ts` |
| `verificarCatalogo()` cobra as três regras (sob_lote aponta para lote; o lote é ≥ o item com um sinal aceso; lote só com alcance > 10) e devolve `problemas` por linha | `packages/policy/src/verificacao.ts`, `scripts/verificar.ts` |
| Invariante 4 reescrita; base `1.2.0` | `packages/policy/politica-root.json` |
| `pauta.semana.aprovar` (R4 pelo alcance 60: titular, reautenticação, motivo, 600 s; lote de até 60 itens por até 8 dias; sem ferramenta; `argsSchema` fechado com `totalDeItens` 1–60); `instagram.post.publicar` ganhou `sob_lote` e continua aceitando o caminho de sempre; delta `1.4.0`, catálogo com 64; `CONECTOR_DA_CAPACIDADE` = `null` (ativar o lote não sai da casa; cada item pergunta ao interruptor dele) | `packages/policy/politica-marketing-os.json`, `apps/api/src/integrations/conectores.ts` |
| Tabelas `AprovacaoDeLote` (empresa, RLS FORCE) e `ItemDoLote` (filho: sentinela, gatilho `mktos_orgid_do_pai`, `FILHOS_COM_ORGID_REDUNDANTE` = 18); enums `LoteEstado` e `ItemDoLoteEstado` espelhados em `LOTE_ESTADOS` e `ITEM_DO_LOTE_ESTADOS` | migration `20260924235614_aprovacao_de_lote`; `modelos-globais.ts`; `tenant-isolation.test.ts` |
| `LotesService`: `montar` (confere o catálogo da empresa, o teto, o prazo, as janelas e o `argsSchema` de cada item; grava o hash de cada item e o da lista ordenada), `ativar` (o efeito), `consumirItem` (UMA instrução `UPDATE … FROM … RETURNING`, com a virada do dia em SP para o teto diário da DM do MD11), `revogarItensDoRecurso`, `revogarLote`, `detalhe` | `apps/api/src/approvals/lotes.service.ts`, parte pura em `lotes.ts` |
| `AssinaturaDeLoteService`: pede a assinatura pela `PortaDoOperador` (só quem montou; "pedir de novo" troca a aprovação e mantém o hash) e inscreve o efeito que ativa | `apps/api/src/approvals/assinatura-de-lote.service.ts` |
| Rotas `POST /approvals/lotes/:id/pedir-assinatura` (`pauta.publicar`) e `GET /approvals/lotes/:id` (`aprovacoes.ver`) | `apps/api/src/approvals/lotes.controller.ts` |
| A porta: `loteItemId` sai dos argumentos antes de tudo (fora da validação, do hash, do RASTRO dos argumentos e do efeito, que o recebe em `ctx.loteItemId`); capacidade sem `sob_lote`, id vazio, token junto ou recurso ausente é recusa `lote_nao_aceito`; com item, o CAMINHO L consome em vez de propor, confere que o degrau do lote cobre o degrau efetivo, e zero linhas é recusa `lote_recusado` registrada, nunca o caminho B; `tool.resultado` leva o `hashConteudo` da lista, aprovador, aprovadoEm, motivo e o contador antes e depois; o arranque recusa subir sem `LotesService` | `apps/api/src/gateway/tool-gateway.service.ts`, `efeitos.registry.ts` |
| `acao.executada` passa a levar `estadoAnterior`/`estadoNovo` quando o efeito os devolve (a ativação do lote é o primeiro) | `apps/api/src/gateway/acoes.service.ts` |
| O validador da porta aprende `minimum` e `maximum` | `apps/api/src/gateway/validacao.ts` |
| A aba Capacidades da Régua mostra "aprova em lote" e "sai também por item de lote" | `apps/api/src/policy/regua.service.ts`, `apps/web/src/app/regua/AbaCapacidades.tsx` |
| Catraca: só a porta consome item; só o efeito inscrito ativa; nada fora do serviço escreve lote | `apps/api/test/arquitetura.test.ts` |

**Desvios da especificação, com o porquê:**
- **O `loteItemId` não entrou no `argsSchema`.** A porta o tira dos argumentos antes da validação,
  então o esquema continua descrevendo só o conteúdo assinado. A trava do diff pede a assinatura de
  rebaixamento pela mudança do campo `aprovacao`, não por uma propriedade nova.
- **A janela e o prazo usam o relógio do processo** (`agora` como parâmetro), não o `now()` do banco:
  é o mesmo instante com que a régua decidiu os sinais (MD3), e as suítes que prendem o relógio
  conseguem medir a janela.
- **A rota é `/approvals/lotes/…`, não `/pauta/lotes/…`.** O lote é genérico (a semana, o YouTube e a
  DM entram como itens) e o prefixo `approvals` já é espinha; a montagem da semana, que é da pauta,
  fica na MD8.
- **Quem pede a assinatura é quem montou.** Assim a trava da fila ("quem propôs não aprova") vale
  para o lote inteiro antes de qualquer aprovação ser consumida; o efeito repete a conferência.
- **`vencido` é calculado na leitura**, como a fila de aprovação faz (ninguém roda o expirador).
- **O item consumido fica `consumido`** (enum com três estados: `ativo`, `consumido`, `revogado`), e o
  lote sem item ativo passa a `encerrado`.

**Medido** (Mac, `marketing_os_test`, 24/09/2026 ~21h): `pnpm typecheck` 7/7; `typecheck:test`
limpo; policy **88** em 2 (+11); api direto com `TEST_DATABASE_URL` **2854 de 2854** em 69 arquivos
(+33: `lotes` 13, novo; `porta` +12; `validacao` +3; `arquitetura` +4; `modelos-globais` +1); sem
ele, 2221 passados e 633 pulados; web **578** em 44 (+1); `test:porta` **57**; `test:isolamento`
**340** (+8); `db:diff` "No difference detected."; `build` + `smoke` OK; `verificar` "64
capacidades · 0 divergência(s)"; `publicar-peca.test.ts` sem mudança. Pisos da CI: api 2085/61, web
395/35, isolamento 266, policy 60/2, com a conta no `ci.yml`. O banco de teste foi ressemeado com as
duas assinaturas (`teste-md7@local`).

**Ensaio local — o "pronto quando"** (banco `marketing_os_zero_md7` criado vazio, migrations do zero,
semeado com o catálogo da MD6 e depois com o da MD7; `dist/main.js` em `127.0.0.1:4097`; duas contas
descartáveis, a que monta e a titular; tudo removido no fim):
1. `db:seed:politica` sem assinatura, só com `CAPACIDADE_NOVA_*` e só com `REBAIXAMENTO_*` →
   "Nada foi semeado" (os três itens listados acima); com as duas → `1 criadas, 63 atualizadas, 64
   no total`, a versão gravada com as duas assinaturas; de novo, idempotente.
2. Lote de 2 posts montado pelo `LotesService` compilado. A titular pede a assinatura → 403 "Quem
   pede a assinatura do lote é quem o montou"; quem montou → `aguardando_aprovacao`, **R4**, fila
   `/atendimento`; pedir de novo → 409; quem montou confirma → 403 "Quem propôs a ação não pode
   aprová-la"; a titular sem motivo → 400; com senha e motivo → `executado`, lote `ativo` com
   aprovador e motivo, `estadoAnterior`/`estadoNovo` no retorno.
3. A porta de verdade (contexto do Nest, do `dist`) com `loteItemId`: o primeiro post sai (**R4**,
   com `volume_atipico`; o lote R4 cobre), o segundo uso do mesmo item → "já foi usado", o outro post
   com a legenda trocada → "o conteúdo difere do que foi assinado", o mesmo post como assinado → sai.
   O efeito foi chamado **2** vezes, sem `loteItemId` nos argumentos e com ele no contexto; **0**
   aprovações novas na fila; lote `encerrado`; RASTRO com `contentHash` da lista, aprovador,
   antes `{usos:0}` e depois `{usos:1}` (só `agente` faltando, que não existe numa rotina) e as duas
   recusas como `lote_recusado`.

Não conferido: nenhum dublê da Graph nesta fatia — nada nela chama o Instagram (a publicação por item
de lote liga na MD8, que troca a chamada da rotina).

**Revisão da MD7 (três revisores, 24/09/2026 ~22h).** Corrigido, cada um com caso:
- **`ctx.loteItemId` só vem da porta.** `executar` descarta o campo do contexto de quem chama antes de
  tudo; só o consumo do CAMINHO L o escreve de novo. Um ctx forjado numa capacidade R0 chega ao efeito
  sem o campo (`porta`).
- **A falha ao encerrar o lote não desfaz um uso que já contou.** `encerrarSeAcabou` virou arrumação
  com log dentro de `consumirItem`; antes, uma queda ali fazia a porta registrar recusa e não chamar
  o efeito de uma saída assinada (`lotes`, com a contagem quebrada por proxy).
- **Lote vencido não vai à fila** (409 antes da porta), e aprovação `confirmada` que venceu sem
  executar não segura mais o lote com "já está na fila" (`lotes`).
- **Revogar o último item ativo encerra o lote**, e a auditoria passou a `entityType:
  'recurso_do_lote'` com os ids dos itens em `after.itens` (`lotes`).
- **`expirarVencidos` recebe `orgId`** e passa por `exigirTenant`, como os irmãos.
- **O antes e o depois da `acao.executada`** entram só com a capacidade resolvida, na mesma guarda do
  conteúdo redigível.
- **A porta prova, com banco,** o item de outra capacidade (usos 0), o lote que a política resolvida
  deixou abaixo do degrau efetivo e o `sob_lote` sem lote no catálogo (`porta`, com a política
  forjada por espião, porque a sobrescrita já é recusada por `verificarCatalogo`).
- **A catraca de arquitetura procura também SQL cru** (`UPDATE/INSERT/DELETE "AprovacaoDeLote"` ou
  `"ItemDoLote"` na visão com as strings) fora do serviço, e confere que enxerga o do próprio serviço.
- A asserção vazia `semLotes.onModuleInit()` saiu de `porta` (caía pelo teto, não pelos lotes; a prova
  real está em `teto-custo-ia`). Textos: o motivo de `pulada` passou a "a rotina ainda não publica
  por item de lote (MD8)", o `CLAUDE.md` e o passo 2 da MD8 na especificação apontam a rota que já
  existe, e o passo 3 ganhou o requisito de a titular VER o conteúdo de cada item, com o hash
  recalculado da peça atual, antes de assinar (hoje o item guarda só o hash).

Medido depois da revisão: api direto **2862 de 2862** em 69 (+8, todos com banco); sem banco, 2221
passados e 641 pulados; web 578; policy 88; `test:porta` **61**; `test:isolamento` 340; `db:diff`
limpo. Pisos sem mudança (nada novo roda sem banco). Uma execução da suíte inteira teve um vermelho
passageiro em `cofre.test.ts` (inventário de credenciais herdadas), que passou sozinho e na
repetição inteira; não tem relação com lote.

**Deploy:** uma migration aditiva (dois enums, duas tabelas, RLS e gatilho). **Antes da subida**, o
`db:seed:politica` com as DUAS assinaturas (`docs/DEPLOY.md` §2.3b): sem ele a capacidade nova vale
R5 e a porta bloqueia todo pedido de assinatura (falha fechada). Nenhuma permissão nova, nenhuma
variável nova.

**Pendências (do Pedro), na ordem:**
1. Decidir, antes do seed, se o prazo de assinatura do lote fica em 600 s (o do R4, recomendado) —
   se não, é outra linha na régua e volta para cá.
2. `db:seed:politica` na VPS **antes** do deploy, com as duas assinaturas (comando no §2.3b).
3. **No mesmo dia**, atualizar a nota do vault `Root/20-empresa/root-os/09 - Escada de risco R0-R5.md`
   com o texto novo da invariante 4 (está em `politica-root.json`) — `escada.ts` não mudou.
4. A segunda pessoa com alçada **titular** (o lote é R4): sem ela, nenhum lote é ativado.
5. O 403 da fila em produção (pendente desde 12/09/2026) continua valendo para quem assina.

### Onda D, fatia MD8 — aprovar a semana num ponto só (24/09/2026)

Especificação em `docs/especificacoes/MD-onda-d-automacao.md` (MD8). Junta a MD1 (slots propostos),
a MD4 (mídia no storage), a MD5 (conta), a MD6 (publicador) e a MD7 (lote com uso contado): a semana
de um episódio vira UM lote R4, assinado por outra pessoa, titular, com senha e motivo, e cada post
sai no horário pelo item dele. **Nada publica sozinho sem as duas travas da D-MD1:** o seed assinado
(MD7) e a nota `pauta.publicacao.automatica` ligada — desligada, o lote ativo só gera `pulada`.

| Peça | Onde |
|---|---|
| Montar o lote (`POST /pauta/episodios/:id/semana/preparar-aprovacao`, `pauta.publicar`, `{fora}`), ler o estado da aprovação (`GET …/semana/aprovacao`, `pauta.ver`), "Cancelar a semana" (`POST /pauta/lotes/:id/cancelar`, `pauta.publicar`) e o conteúdo que a titular lê (`GET /pauta/lotes/:id/conteudo`, `aprovacoes.decidir`: o conteúdo exato só para quem pode decidir) | `apps/api/src/pauta/lote-da-semana.controller.ts`, `lote-da-semana.service.ts`, parte pura em `lote-da-semana.ts` |
| A reação à assinatura por registro: `LotesService.aoAtivar(recursoTipo, fn)` (uma inscrição por tipo), rodando na transação que liga o lote, com os itens relidos dentro dela; o item que a reação não faz valer é revogado ali e vai à auditoria `lote.ativado` | `apps/api/src/approvals/lotes.service.ts` |
| A publicação que a peça já tem (MD6): a montagem barra a que está na Meta, publicada ou com "Publicar agora" vivo na fila (`problemaDaPublicacao`); a ativação devolve a `pendente` sem pedido a linha em `erro`, `recusada` ou com o pedido morto (`reabreNaAtivacao`), e revoga o item da peça cuja publicação já está na Meta | `lote-da-semana.ts`, `lote-da-semana.service.ts`, `publicacoesEmJogo` em `publicacao-instagram.service.ts` |
| Leituras novas do lote: `itensVivos` (o item ativo de cada peça, preferindo o lote ativo) e `lotesEmCurso` | idem |
| A rotina publica pelo item: acha o item ativo (também o de lote que venceu com ela parada, para dar a peça por perdida), toma a linha em `pendente` ou `erro` com ou sem pedido avulso gravado, pergunta ao interruptor, monta os argumentos da peça de agora e chama a porta com `loteItemId` (`actorType system`); desistir (recusa da porta, janela perdida) vira `erro` com o `loteItemId` e **revoga o item**, e a peça volta ao manual de fato; o teto de 3 conta só quem vai à porta, não as puladas; `decisaoDaRotina` perdeu o `loteConferidoPelaPorta` | `apps/api/src/pauta/publicacao-instagram.service.ts`, `publicacao-instagram.ts` |
| O efeito da MD6 pelo lote: quem publica é quem assinou, a aprovação é a do lote, `loteItemId` na `PautaPublicacao`; "Publicar agora" de peça com item ativo é 409 | `publicacao-instagram.service.ts` |
| Revogar só o item da peça ao mexer depois de ativo (`revogarItemDaPeca`): texto, JPEG, mp4, reagendar, status, postada à mão, voltar ao manual, e as peças que o refazer mídia ou a transcrição nova mandam a rascunho. A aprovada só sai da agenda pela troca de mídia quando o lote está **assinado e válido** (`filtroDoItemAssinado`); no lote só montado ou na fila, a troca só revoga o item | `derivacao.service.ts`, `agenda.service.ts`, `rotina.service.ts`, `midia.service.ts`, `publicacao-instagram.service.ts` |
| O texto da semana se edita no Agendado (`motivoParaNaoEditarASemana` só trava Concluído) | `packages/shared/src/schemas.ts` |
| Tipos e a etapa da peça (`etapaDaPecaNaSemana`, `PAUTA_ETAPAS_DA_PECA_NA_SEMANA`), `PautaPrepararAprovacaoSchema`, `lote` na peça da agenda e `publicacaoAutomatica` na agenda | `packages/shared/src/schemas.ts`; `agenda.service.ts` |
| Tela: seção "Aprovar a semana" na aba Semana (por episódio, com o estado da automática, "fica fora", montar e pedir a assinatura, pedir de novo, cancelar com confirmação) e a linha do tempo em cada slot | `apps/web/src/app/pauta/AprovarASemana.tsx`, `LinhaDoTempoDaPeca.tsx`, `AbaSemana.tsx`, `PublicacaoNoInstagram.tsx` |
| `/atendimento`: o cartão do lote (legenda inteira, miniatura pela rota autenticada, horário em SP, @, hash recalculado, divergência) e o botão de aprovar só com ele carregado | `apps/web/src/app/atendimento/CartaoDoLote.tsx`, `Item.tsx` |
| O aviso do canal de aprovação leva o link da fila (`linkDaFila`); o caminho `/atendimento` mudou para `gateway/fila-de-aprovacao.ts` (a porta o reexporta) | `apps/api/src/gateway/canais/pedido-no-canal.ts` |
| `root-midia agenda` diz se a semana está assinada ou na fila (e avisa a automática desligada) | `tools/root-midia/lib/semana.mjs` |

**Desvios da especificação, com o porquê:**
- **O hash do item é o da peça como aprovada no slot** (`argsDoItem`), porque é esse pedido que o
  executor manda à porta no horário. Ajustar `agendadaPara` "para o passado recente" mudaria o hash e
  a porta recusaria (é o horário assinado): o ensaio usou slots poucos minutos à frente e esperou.
- **A peça editada entre a montagem e a assinatura não é aprovada** (a ativação recalcula e revoga o
  item), e o resto da semana vale. A titular já via essa peça marcada no cartão.
- **Editar o texto no Agendado passou a valer.** A regra antiga impediria o item 5 (a assinatura leva
  o episódio a Agendado). É mudança de comportamento, registrada no §4 (item 30).
- **Reagendar mantém a peça aprovada** no horário novo e fora do lote; "Aprovar a semana" monta um
  lote novo só com ela. Trocar o JPEG ou o mp4 leva a aprovada a rascunho, como o item 5 pede.
- **Montar de novo substitui** o lote do episódio ainda sem assinatura (revogado, com o motivo).
- **O hash recalculado que a titular vê é conferido pela API**, não no navegador.
- **Não houve `hashKeys`**: como na MD6, o corpo inteiro do pedido vai ao hash.
- **"Cancelar a semana" não passa pela porta**: não há capacidade nova (seria outra assinatura de
  seed) — só revoga, e revogar só diminui o alcance.
- **Pedir a assinatura usa a rota da MD7**, `POST /approvals/lotes/:id/pedir-assinatura`, e não uma
  `POST /pauta/lotes/:id/pedir-assinatura` nova (item 2 da SPEC). A rota já existia com a mesma
  permissão (`pauta.publicar`) e a trava "quem monta é quem pede"; uma segunda seria outro caminho
  para o mesmo pedido.
- **O conteúdo do lote é `aprovacoes.decidir`**, não `aprovacoes.ver`: a regra do Pedro para a fila
  (`approvals.controller.ts`) é que o conteúdo exato vai só para quem pode decidir.
- **A peça com publicação anterior entra no lote.** A linha em `erro`, `recusada` ou com o pedido
  morto não barra a montagem: a assinatura é a autorização nova, e a ativação a reabre para o
  executor. Barra a que está na Meta, a publicada e a que tem "Publicar agora" vivo na fila.

**Correções da revisão (três revisores):**
- A peça com linha de publicação (pedido R3 vencido ou vivo, `erro`, `recusada`) entrava no lote e a
  rotina nunca a tomava, em silêncio. Agora a montagem barra só o que não pode sair, a ativação
  reabre a linha e a rotina toma `pendente`/`erro` com item de lote assinado, com ou sem pedido avulso
  gravado (o erro que o próprio item já deu não se repete). O "Publicar agora" confirmado depois acha
  a peça publicada: nenhum post a mais.
- O lote montado e nunca assinado (a Root hoje, sem segunda pessoa) tirava da agenda a aprovada cuja
  mídia era trocada. O rebaixamento exige lote `ativo` e válido; sem isso, só o item é revogado.
- Ao desistir da peça (janela perdida, recusa da porta), a rotina revoga o item: o "Publicar agora" e
  a aba voltam a valer, e a mensagem do 409 cita "Voltar ao manual". A janela perdida é detectada
  também com o lote já vencido, e o teto por passagem não conta as puladas.
- `ativar` relê os itens dentro da transação; a substituição de lote não revoga o lote que foi
  assinado no meio (o novo cai, 409); duas candidatas do mesmo formato no mesmo slot barram a
  segunda, na montagem e na ativação; o episódio só vai a Agendado com ao menos uma peça aprovada; a
  aba reconfere a peça de lote ainda não assinado; "ativo" na linha do tempo exige a peça aprovada e
  a publicação fora do manual; em `/atendimento`, o "Recusar" aparece enquanto o cartão do lote não
  carrega.

**Medido** (Mac, `marketing_os_test`, 24/09/2026 ~23h05, já com as correções da revisão): `pnpm
typecheck` 7/7; `typecheck:test` limpo; api direto **2889 de 2889** em 70 arquivos (+27:
`pauta-lote-da-semana` 26, novo, 12 com banco; `root-midia` +1); sem banco, 2236 passados e 653
pulados; web **585** em 45 (+7: `pauta-lote-da-semana`, novo); policy 88; `test:porta` 61;
`test:isolamento` 340; `db:diff` "No difference detected."; `build` + `smoke` OK. Pisos da CI: api 2097/62, web 401/36, com a conta no `ci.yml`. Uma rodada da suíte teve o vermelho passageiro conhecido de `cofre.test.ts` (inventário de
herdadas), verde sozinho e na repetição inteira.

**Ensaio local — o "pronto quando"** (`dist/main.js` contra `marketing_os_zero_md8`, criado vazio:
migrations do zero, `db:seed` e `db:seed:politica`; MinIO descartável da imagem `minio/minio` em
`127.0.0.1:9318`; dublê da Graph em `127.0.0.1:4298` que **baixa** cada `image_url`/`video_url` e
registra o sha256; a semana semeada como a MD1 a deixa — 4 matérias × carrossel/story/corte em
rascunho com o slot proposto, um minuto entre eles, e um story a mais sem JPEG —, página de links no
ar, conta de publicação; 16 JPEG 1080×1350, 4 JPEG 1080×1920 e 4 mp4 1080×1920 do `ffmpeg` subidos
pelas rotas da MD4; duas contas descartáveis, a que monta e a titular; tudo removido no fim):
1. `GET …/semana/aprovacao`: sem impedimento, automática desligada, 13 peças em `proposto`, o story
   sem JPEG com "Falta o JPEG 1…". Montar sem "fica fora" → 400 com essa frase e "marque fica fora";
   com ele → lote de **12** itens, válido até o fim da última janela.
2. Pedir a assinatura → `aguardando_aprovacao`, **R4**, `precisaDeOutraPessoa`, fila `/atendimento`.
   A titular leu o conteúdo (12 posts, 0 divergentes, `@root.ensaio`, miniatura 200 `image/jpeg`) e
   a fila mostrou alçada titular, senha e motivo. Tela a 375 px: sem rolagem lateral (`sw = cw =
   375`) em `/atendimento` e na aba Semana.
3. Com a nota ligada, no horário do primeiro slot e sem assinatura: a rotina "nenhuma peça no
   horário" — **0** chamadas ao dublê. Quem montou confirma → 403 "Quem propôs…"; a titular sem motivo
   → 400; com senha e motivo → `executado`, lote `ativo`: 12 peças `aprovada` no slot, proposto limpo,
   episódio **Agendado**.
4. Nota desligada, no horário → `pulada (publicação automática desligada)`, **0** chamadas.
5. Editar o texto do story da matéria 2 (`PUT …/semana`) → 200; só o item dela `revogado` ("o texto
   da peça foi editado"), a peça em rascunho fora da agenda, o lote segue ativo com 11.
6. Nota ligada, depois do último slot: "Rodar agora" quatro vezes → 3, 3, 3 e 2 publicadas; a quinta,
   nada. O dublê recebeu **27** containers (16 itens de carrossel, 4 `CAROUSEL`, 4 `REELS`, 3
   `STORIES`), **23** downloads 200 com o sha256 igual ao dos arquivos locais, e **11** publish. No
   banco: 11 peças `publicada` com permalink e `publicadaPor` = a titular; o story editado em rascunho;
   11 `PautaPublicacao` `publicada` com `loteItemId`; lote `encerrado` com 11 itens consumidos e 1
   revogado; o RASTRO com **11** `tool.resultado` (R4, porque passava das 20h em SP) com o aprovador =
   a titular, e 11 `pauta.peca_publicada`.

Não conferido: o aviso do canal do WhatsApp (sem canal no ensaio, fica só a fila, como a SPEC diz);
o YouTube (MD10) e a DM (MD11) como itens do lote, que não existem ainda.

**Deploy:** nenhuma migration, nenhuma variável e nenhuma permissão nova. Vale o seed assinado da MD7
antes da subida (sem ele `pauta.semana.aprovar` vale R5 e todo pedido de assinatura é bloqueado).

**Pendências (do Pedro), na ordem:**
1. O seed da MD7 assinado na VPS, antes do deploy (`docs/DEPLOY.md` §2.3b), com
   `POLITICA_CAPACIDADE_NOVA_*` e `POLITICA_REBAIXAMENTO_*`.
2. Criar na empresa Root a segunda pessoa com alçada **titular** (Lucas ou Rodrigo, D-MC9.3 a):
   `POST /users` pela tela de usuários, papel `admin_master`. Sem ela, nenhum lote é ativado.
3. Resolver o 403 da fila em produção: `pnpm --filter @mktos/shared build` → `db:sync-permissions` →
   todos saem e entram.
4. A titular assinar em até 10 min depois do pedido; passou, "Pedir a assinatura de novo".
5. Decidir o papel restrito (passo 16): sob ele nenhuma rotina dispara, e a publicação no horário
   depende da rotina `pauta.publicar-agendadas` criada em `/rotinas`.
6. Só depois dos itens 1 a 5, ligar a nota `pauta.publicacao.automatica` (primeira linha `ligada`)
   pela memória. A revisão de segunda na aba Semana precisa ser de verdade: um lote assinado publica
   a semana inteira sem ninguém olhando na hora.
7. Conferir no primeiro post real o limite de 2.200 caracteres da legenda (a conferir desde a MD6).

### Onda D, fatia MD9 — a fila da DM à mão, com o coletor de comentários (25/09/2026)

Especificação em `docs/especificacoes/MD-onda-d-automacao.md` (MD9), base na MC18.0 com as
recomendações D-MC9.6 (a) e D-MC9.7 (a): o CTA "chegam no direct" continua, e a resposta é à mão.
**Nada sai do OS nesta fatia**: a leitura dos comentários é só leitura, pela porta, e a DM é mandada
pelo Instagram, à mão. A fila "liga já" (decisão do Pedro): basta a rotina criada em `/rotinas`.

| Peça | Onde |
|---|---|
| Capacidade `instagram.comentario.ler` (**R0**, sem `ferramenta`, sem `desfazer`, `rota` = a fila `GET /pauta/comentarios`; `argsSchema` fechado: `igUserId` e até 30 `{pecaId, palavra, midiaId?, permalink?}`); delta `1.5.0`, catálogo com 65; `CONECTOR_DA_CAPACIDADE` = `instagram` | `packages/policy/politica-marketing-os.json`, `apps/api/src/integrations/conectores.ts` |
| HTTP no conector: `comentariosDa(token, midiaId, tetoPaginas)` faz `GET /<media>/comments` com `fields=id,text,timestamp,from{id,username},parent_id`, 50 por página, paginação pelo cursor `after` montado sobre o nosso endereço (o `paging.next` do corpo nunca é seguido). O `midiasDesde` antigo, que a fila usa para achar o post pelo permalink, passou a paginar do mesmo jeito (antes seguia o `next` do corpo, com o token na URL) | `apps/api/src/bio/plataformas/instagram.ts` |
| O cliente chega ao coletor por injeção (`GRAPH_DE_COMENTARIOS`, token e interface em `pauta/graph-de-comentarios.ts`, fiação no mesmo `bio/plataformas/publicacao.module.ts`); catraca nova: só os três arquivos citam o token, e a Graph só é chamada dentro do efeito | idem; `arquitetura.test.ts` |
| A parte pura: `casaPalavraInteira` (a régua de `normalizarPalavra`, agora exportada), `triarComentario` (própria conta pelo id ou pelo @, resposta — salvo a nota `pauta.comentarios.respostas` = `ligada` —, mais de 7 dias, sem autor, sem palavra; o motivo "anúncio" é defensivo, para o webhook da MD11: a consulta não pede `ad_id`, que não é campo do nó IG Comment e daria #100), `ondeEsperaResposta` (a definição única de "pendente", da fila e da agenda), `hmacDaPessoa`, `mesmoPermalink`, `textoDaDm`, `problemaDoTextoDaDm` (bytes, `/r/`, anti-slop) | `apps/api/src/pauta/dm-por-comentario.ts`; `derivacao-do-episodio.ts` |
| O serviço: o efeito lê e faz a triagem e devolve SÓ quem casou, com o id do comentário e o @ em `sigiloso()` e a pessoa como HMAC — o texto do comentário não sai do efeito; a rotina grava a fila (a reentrega cai na mesma linha), cria o link de campanha da matéria e anula o @ vencido; a fila, marcar respondido (RASTRO `pauta.dm_manual_respondida` só com o HMAC), preparar e editar o texto da DM | `apps/api/src/pauta/comentarios.service.ts`, `comentarios.controller.ts` |
| O registro da chamada deixa de guardar o que o RASTRO esconde: `ToolCall.resultado` troca `sigiloso()` pelo resumo, como o `EventLog` já fazia (`semSigilosos`, `resumoCriptografico` e `temSigiloso` exportados). `sigiloso(v, rotulo, { semResumo: true })` é o modo para valor de pouca entropia: o registro guarda só `{ sigiloso, rotulo }`, sem sha256 nem tamanho — é o que o @ e o id do comentário usam | `apps/api/src/gateway/event-log.service.ts`, `tool-gateway.service.ts` |
| Tabela `ComentarioComPalavra` (filha de `PautaPeca`: sentinela, gatilho `mktos_orgid_do_pai`, RLS FORCE com leitura e escrita separadas; `commentId` único por empresa; `usuario` nulo depois de `expiraEm`; sem o texto do comentário) | migration `20260925021740_comentario_com_palavra`; `modelos-globais.ts` (`FILHOS_COM_ORGID_REDUNDANTE` = 19); `tenant-isolation.test.ts` |
| Rotina `pauta.coletar-comentarios` (`*/10`), no `TIPOS_DA_PAUTA` (`PAUTA_CRON=off` a cala), criada em `/rotinas` por "Nova rotina de comentários" | `apps/api/src/routines/executores/pauta-comentarios.executor.ts`; `apps/web/src/app/rotinas/NovaRotinaDeComentarios.tsx` |
| Rotas `GET /pauta/comentarios` (`pauta.ver`), `POST /pauta/comentarios/:id/respondido` (`pauta.publicar`), `POST /pauta/episodios/:id/dm/preparar` e `PUT /pauta/episodios/:id/dm/:itemId` (`pauta.editar`, corpo `PautaTextoDaDmSchema`: ≤ 1000 **bytes**) | `comentarios.controller.ts`; `packages/shared/src/schemas.ts` |
| Tela: "Quem comentou e o que responder" na aba Semana — @, palavra, peça, prazo, "Copiar texto", "Abrir perfil", "Marquei como respondido", a última leitura da rotina e o texto da DM por matéria (copiar, preparar, editar contando bytes, voltar ao padrão) | `apps/web/src/app/pauta/ComentariosComPalavra.tsx`, `page.tsx` |
| `comentariosPendentes` na agenda; `root-midia agenda` diz quantos esperam a DM, sem @ | `agenda.service.ts`; `tools/root-midia/lib/semana.mjs` |
| Variável `META_WEBHOOK_PESSOA_HMAC_KEY` (32+; vazia = a rotina pula sem ler) | `docker-compose.yml` (`environment:`) e `.env.example` |

**Desvios da especificação, com o porquê:**
- **A leitura é R0, não R1.** A SPEC declarava `produzArtefato: true` (R1). Medido na régua: R1 com
  qualquer sinal sobe a R2, e R2 exige aprovação no OS (a API nunca passa `aprovacaoR2Ligada`).
  `fora_da_janela` acende toda noite (20h–08h de SP) e `volume_atipico` acende nas primeiras semanas
  de uma leitura de 10 em 10 min (a média de 30 dias começa perto de zero): a rotina criaria um
  pedido de aprovação para LER a cada passagem. Declarada R0, o efeito só lê e devolve; quem grava a
  fila é a rotina, do lado de dentro — o mesmo desenho da coleta de quinta, que lê o Gmail em R0 e
  grava as capturas. Com sinal, sobe a R1 e segue sem aprovação (caso com banco e caso da política).
  A assinatura do seed continua sendo a de capacidade nova (`ACRESCENTA`).
- **O efeito devolve o @ e o id do comentário marcados com `sigiloso(…, { semResumo: true })`**, e
  por isso o `ToolCall.resultado` passou a redigi-los (antes só o `EventLog` redigia): sem isso, o @
  ficaria cru no registro da chamada, fora do expurgo dos 7 dias. **Sem resumo**, e não com o
  sha256 de costume: um @ é público e de pouca entropia, e o id do comentário se lista pela Graph;
  quem lê o banco calcularia o sha256 dos @ que comentaram no post e acharia a pessoa num rastro que
  vive 1825 dias. Fica só a marca e o rótulo.
- **Sem `rota` HTTP própria para a leitura**: quem lê é a rotina. A `rota` do catálogo aponta para a
  fila que a leitura enche (`GET /pauta/comentarios`), o que também prende a capacidade ao módulo
  pauta na Régua (`moduloDaCapacidade`); a descrição da capacidade diz que a rota só mostra a fila e
  nunca dispara a leitura. O teste "todas as R0 são ferramentas MCP" ganhou a exceção declarada.
- **Sem a linha de aviso de mensagem automática** (ajuste (ii) da pesquisa): a DM desta fatia é
  mandada por uma pessoa. O aviso entra com a MD11.
- **O link da DM nasce com a primeira linha da fila** (a rotina o cria, com `pauta.dm_links` no
  RASTRO como ator `system`/`rotina`) ou pelo "Preparar os textos da DM"; a leitura da fila não cria
  nada.

**Revisão (três revisores, 25/09/2026), o que mudou:**
- O @ e o id do comentário deixaram de ir ao `ToolCall` e ao `EventLog` como sha256 sem chave (ver
  acima); o teste procura `sha256('fulano.silva')` e `sha256('c-secreto-1')` nos dois e não acha.
- `editarTexto` grava a meta INTEIRA sob o cadeado `pauta-semana:<episodioId>` e relê depois dele,
  como `comAPecaTravada`: um JPEG ou mp4 gravado no meio não é mais desfeito (teste de corrida que
  fica vermelho sem o cadeado).
- A falha da Graph ao listar as mídias (post achado pelo permalink) aparece no resumo como erro, não
  como "post não achado", e a lista é pedida uma vez por passagem mesmo quando falha.
- Com o módulo pauta desligado, a passagem ainda apaga o @ vencido (apagar não lê a Graph).
- A fila corta pelo que importa: primeiro as pendentes, das que vencem antes; o resto completa até
  200. `pendentes` vem de `count` no banco, com a mesma condição da agenda (`ondeEsperaResposta`).
- O texto editado à mão com um `/r/` que não existe mais (página remontada no /bio) volta ao padrão,
  com o aviso para editar de novo.
- O dublê da Graph devolve só os `fields` pedidos e pagina as mídias pelo cursor com um `next` que
  aponta para fora; o caso "de anúncio" saiu do teste com banco (continua no puro).
- Caso novo: carrossel e corte da mesma matéria usam o mesmo `BioLink` e o mesmo `/r/`.
- O laço que espera o `PixelEvent` conta tentativas (com `vi.setSystemTime` o `Date.now()` fica
  parado, e o prazo nunca vencia).

**Medido** (Mac, `marketing_os_test`, 25/09/2026 ~00h): `pnpm typecheck` 7/7; `typecheck:test`
limpo; api direto com `TEST_DATABASE_URL` **2926 de 2926** em 71 arquivos (+37:
`pauta-comentarios` 29, novo, 18 com banco; `rastro-por-nivel` +1; `arquitetura` +3;
`escritas-pela-porta` +2; `modelos-globais` +1; `root-midia` +1); sem ele, 2255 passados e 671
pulados; web **596** em 46 (+11, `component/pauta-comentarios` novo); policy **90** em 2 (+2);
`test:porta` 61; `test:isolamento` **346** (+6, `ComentarioComPalavra`); `db:diff` "No difference
detected."; `build` + `smoke` OK. Pisos da CI: api 2113/63, web 410/37, isolamento 271, com a
conta no `ci.yml`. (Números remedidos depois da revisão; o ensaio abaixo é de antes dela.)
O `db:seed:politica` no banco de teste recusou sem assinatura ("Nada foi semeado") e aceitou com
`POLITICA_CAPACIDADE_NOVA_*` ("capacidade nova em R0 (não declarada valia R5)").

**Ensaio local — o "pronto quando"** (`dist/main.js` contra `marketing_os_zero_md9`, criado vazio:
migrations do zero, `db:seed` e `db:seed:politica`; dublê da Graph em `127.0.0.1:4299` como
`INSTAGRAM_GRAPH_URL`, com os comentários paginados de 2 em 2 pelo cursor e as mídias da conta;
conta de publicação com o escopo de comentários, página do episódio no ar com o botão da matéria,
um carrossel publicado pelo OS (MD6, `PautaPublicacao` com o id da mídia) e um corte aprovado; banco,
API, web e dublê removidos no fim):
1. O corte foi marcado como postado pela rota da MC16 com `https://www.instagram.com/reel/ENSAIOMD9/?igsh=abc`.
   `POST /rotinas` (tipo `pauta.coletar-comentarios`) e "Rodar agora" → `ok`, "2 post(s), 4
   comentário(s) lido(s) · 2 novo(s) na fila · ignorados: sem a palavra 1, da própria conta 1". No
   carrossel, os três comentários do dublê (`AGENTES por favor`, `AGENTES2` e o da própria conta)
   viraram **uma** linha, `@maria.ensaio`, com o texto `…/r/78fd4339…` e a página
   `…/@root-ep-01-md9`; o corte foi achado pelo permalink em `/me/media` (`@ana.ensaio`,
   `PLANILHA`). O dublê viu a segunda página com `after=2` e os `fields` da SPEC.
2. "Rodar agora" de novo → "0 novo(s) na fila · 2 já estava(m)"; 2 linhas no banco.
3. "Marquei como respondido" → 200 com quem e quando; a segunda vez, 409. O `AuditLog`
   `pauta.dm_manual_respondida` tem só `{pecaId, palavra, pessoaHmac}`. Nenhuma linha de `AuditLog`,
   `EventLog` ou `ToolCall` contém o @, o id do comentário, o id da pessoa ou o texto do comentário
   (0, 0, 0). As duas leituras saíram **R1** (23h40 de SP, `fora_da_janela`) e **0** aprovações.
4. `GET /api/bio/r/<link da DM>` com o cookie de visitante → 302 para a matéria; o `PixelEvent`
   `link_click` tem o `linkId` do link `campanha:dm:md9-1`, e nenhum tem o do botão da página.
5. Com a fila levada a 7 dias e 1 hora atrás, "Rodar agora" → "2 @ apagado(s) depois dos 7 dias";
   as duas linhas ficaram com `usuario` nulo e o HMAC; a fila e a agenda contam 0 pendentes.
6. Instagram desligado em `/conexoes` → a passagem vira `erro` com a frase do interruptor e **0**
   chamadas novas ao dublê.
7. Tela a 375 px (aba Semana, com a fila e o texto por matéria aberto): sem rolagem lateral
   (`sw = cw = 375`, nenhum elemento para fora).

**Deploy:** uma migration aditiva (a tabela, com RLS e gatilho). **Antes da subida**, o
`db:seed:politica` com `POLITICA_CAPACIDADE_NOVA_*`: sem ele a capacidade não existe na política do
banco, vale R5 e a rotina falha fechada (nada é lido). Variável nova `META_WEBHOOK_PESSOA_HMAC_KEY`
(vazia = a rotina pula). Nenhuma permissão nova.

**Riscos.** A leitura de 10 em 10 min dá cerca de 6 chamadas por hora por post (o limite da Graph
para leitura de comentários está a conferir). O @ é dado pessoal: quem o apaga é a passagem da
rotina depois dos 7 dias — com a rotina parada, pausada ou apagada, ele fica no banco (a tela já o
esconde) até a próxima passagem; com o módulo pauta desligado a passagem ainda o apaga. Se o volume passar do que dá para responder à mão, a pressão vai para uma
ferramenta de fora (ManyChat), que é decisão do Pedro e fica fora do OS.

**Pendências (do Pedro), na ordem:**
1. A MD5 feita no painel da Meta com `instagram_business_manage_comments` em Standard Access e a
   conta reconectada na aba Semana (o cartão mostra o escopo). Sem ele, a passagem pula com o aviso.
2. Gerar a chave no easyPanel e pôr no `.env` da VPS: `META_WEBHOOK_PESSOA_HMAC_KEY` =
   `openssl rand -base64 48` (nunca colar em chat). Trocar a chave depois faz a mesma pessoa virar
   outra no histórico.
3. `db:seed:politica` na VPS **antes** do deploy, assinado:
   `POLITICA_CAPACIDADE_NOVA_AUTOR='pedro.magnago@fullbpo.com' POLITICA_CAPACIDADE_NOVA_MOTIVO='MD9: catálogo ganha instagram.comentario.ler (R0), a leitura da fila da DM à mão' pnpm --filter @mktos/api db:seed:politica`.
4. Depois do deploy, `/rotinas` › "Nova rotina de comentários" (`*/10 * * * *`). Sob o papel
   restrito (passo 16), nenhuma rotina dispara até a decisão do agendamento.
5. Publicar em `docs/PRIVACY.md` (e na página pública de privacidade) o parágrafo de dados de quem
   comenta (D-MC9.9): o @ fica 7 dias para a resposta à mão e some; o id da pessoa só como HMAC; o
   texto do comentário não é guardado. O texto é do Pedro (é aviso legal).
6. Mandar as DMs à mão a partir da fila, e medir o volume da primeira semana: é o número que decide
   se a MD11 (DM automática, depois do App Review) vale o custo.
7. **A conferir no primeiro uso real:** se `from.id` do comentário da própria conta é o mesmo id da
   conta de publicação (a triagem também compara pelo @, por garantia); e o limite de chamadas da
   Graph para ~6 leituras por hora por post.

### Onda D, fatia MD10 — o YouTube pela API (25/09/2026)

Especificação em `docs/especificacoes/MD-onda-d-automacao.md` (MD10), com a decisão D-MC6 do Pedro:
implementar a MD10 inteira, com o conector sem credencial até o OAuth dele e o envio sempre privado
até a auditoria. O Mac só manda os bytes, direto ao YouTube; o OS abre a sessão com os metadados
travados, guarda a credencial, confere o vídeo e marca o horário. **Nada vai ao YouTube sem o lote
da semana assinado pela titular**, e com `YOUTUBE_AUDITORIA=pendente` (o padrão) nada vai de jeito
nenhum.

| Peça | Onde |
|---|---|
| Conector `youtube`: OAuth web com `state` assinado de 10 min (`typ: estado-youtube`, que o guarda de sessão recusa), escopos `youtube.upload` + `youtube.force-ssl`, `access_type=offline` + `prompt=consent`, refresh token no cofre (chave `youtube`), token de acesso só em memória; contrato inteiro (autorizar, sincronizar, saúde que acusa Testing e diz a auditoria, revogar no Google e no cofre); HTTP do Data API com destinos fixos | `apps/api/src/youtube/youtube.service.ts` (único arquivo com o endereço do YouTube); `CONNECTORS` no shared; `DEVEM_IMPLEMENTAR` do `RegistroDeConectores` |
| O retorno do OAuth `GET /api/youtube/callback` (público, prefixo `youtube` = módulo `pauta`): o controlador recebe só `concluirAutorizacao` por injeção e não importa o conector | `youtube/youtube-conexao.controller.ts`, `youtube/conexao-do-youtube.ts`, `youtube/youtube.module.ts` |
| Capacidades R3 `youtube.video.enviar` (`exposicaoExterna: false`) e `youtube.video.publicar` (`true`), as duas `reversibilidade: manual` e `sob_lote` de `pauta.semana.aprovar`, sem ferramenta; delta `1.6.0`, catálogo com 67; `CONECTOR_DA_CAPACIDADE` = `youtube` | `packages/policy/politica-marketing-os.json`, `integrations/conectores.ts` |
| O cliente chega à pauta por injeção (`CLIENTE_DO_YOUTUBE`); os dois efeitos, a sessão do Mac, a conclusão, a thumb e o horário, e a parte do YouTube da rotina `pauta.publicar-agendadas` | `pauta/cliente-do-youtube.ts`, `pauta/envio-ao-youtube.service.ts`, parte pura em `pauta/youtube-do-episodio.ts`; `routines/executores/pauta-publicar.executor.ts` |
| Rotas: `GET …/:id/youtube` (`pauta.ver`); `PUT …/:id/youtube/arquivo`, `POST …/youtube/sessao`, `…/sessao/token`, `…/youtube/concluido`, `PUT …/pacote/thumb` e `…/pacote/horario` (`pauta.editar`); `GET /pauta/youtube/pendentes` (`pauta.ver`, o vigia); `POST /pauta/youtube/conectar` (`pauta.publicar`) | `pauta/envio-ao-youtube.controller.ts` |
| O lote da semana leva os dois itens: o envio (janela até 1 h antes do horário, 4 usos: até 3 sessões e a conclusão) e o agendamento (até 15 min antes, 2 usos); a titular lê o título, a descrição inteira, a thumb, o arquivo e o horário; a ativação revoga o item cujo pacote mudou | `pauta/lote-da-semana.service.ts`; `PautaAprovacaoDaSemana.youtube` e `PautaConteudoDoLote.youtube` no shared |
| Tabela `EnvioAoYoutube` (filha do episódio: sentinela, gatilho, RLS FORCE; `episodioId` único; `bytes` BigInt; a URI da sessão cifrada; `enviadoEmTeste`); `PautaEpisodio.thumbEscolhida` (CHECK 1–3) e `publicarNoYoutubeEm`; enum espelhado em `ENVIO_AO_YOUTUBE_ESTADOS` | migrations `20260925032020_envio_ao_youtube` e `20260925042725_envio_ao_youtube_em_teste`; `FILHOS_COM_ORGID_REDUNDANTE` = 20; `tenant-isolation.test.ts` |
| Tela: seção "YouTube" no detalhe do episódio (auditoria, canal, thumb, horário de São Paulo, vídeo declarado, faltas, "Conectar o canal", o aviso da volta do OAuth); a linha do vídeo no "Aprovar a semana" com "fica fora"; o vídeo no cartão do lote em `/atendimento` | `apps/web/src/app/pauta/SecaoYoutube.tsx`, `AprovarASemana.tsx`, `apps/web/src/app/atendimento/CartaoDoLote.tsx` |
| Mac: `root-midia youtube ep-NN [--final] [--declarar]` (sha256 por stream, blocos de 64 MiB, retomada pelo 308/`bytes */total`, 5xx com espera, 401 pede token, 404 pede sessão nova; estado em `~/.config/root/youtube-ep-NN.json` sem a URI nem o token); o `enviar` declara sozinho; o vigia envia os de `pendentes` quando o OBS não está gravando | `tools/root-midia/lib/youtube.mjs`, `root-midia.mjs`, `lib/os.mjs` |

**Desvios da especificação, com o porquê:**
- **A thumb e a playlist entram na CONCLUSÃO, pelo efeito de envio** (o PRONTO QUANDO pede "o OS
  confere o vídeo e define a thumb" antes do horário, e a SPEC da capacidade põe as duas no efeito
  de publicar). Ficou nos dois: o "concluído" é um segundo uso do item de envio, pela porta (definir
  a thumb é escrita no canal), e o efeito de publicar confere a thumb e a playlist de novo — a thumb
  que não entrou na conclusão (o 403 do canal sem verificação) fica como aviso e é refeita no
  agendamento, que RECUSA se ela ainda não entrar.
- **`YOUTUBE_OAUTH_URL`**, uma variável a mais que as seis da SPEC: sem ela o ensaio renovaria o
  token no Google de verdade. Vazia vale `https://oauth2.googleapis.com`; fora de loopback, só https
  (vale para as três URLs e para a URI da sessão).
- **"Conector desligado até o OAuth"** é o estado sem credencial: a saúde diz "não conectado", e a
  sessão, o token e o agendamento são recusados. Não nasce uma linha de `ConectorDesligado`: o
  interruptor por empresa não tem estado "desligado por padrão", e criar um mudaria todos os
  conectores. O que segura por padrão é o `YOUTUBE_AUDITORIA=pendente`.
- **A thumb que sobe e o horário do vídeo viraram colunas do episódio** (o pacote do MC11 não tinha
  os dois). Travam só quando o VÍDEO está agendado: o Agendado do episódio vem da semana do
  Instagram (D-MC11) e não pode impedir o YouTube de entrar num lote depois.
- **O arquivo é declarado por rota própria** (`PUT …/youtube/arquivo`): reenviar a mídia do MC9
  descartaria a transcrição e o pacote. Declarar outro arquivo derruba os itens do YouTube ainda
  vivos; depois que o vídeo subiu, o arquivo não troca pelo OS (409).
- **A rota declarada de `youtube.video.publicar` é `PUT …/pacote/horario`**: quem agenda é a rotina;
  a rota só prende a capacidade ao módulo `pauta` (o mesmo recurso da MD9).
- **O lote só do YouTube ainda pede os impedimentos da semana** (página de links no ar, conta de
  publicação do Instagram): o YouTube anda junto com a semana, como a SPEC da MD8.
- **O token do Mac é OUTRO, renovado com `scope=youtube.upload`** (`tokenDoEnvio`, guardado à parte
  do da API). Se o Google ignorar o escopo pedido e devolver o largo (o `force-ssl` publica e apaga
  fora do lote), com `YOUTUBE_AUDITORIA=aprovada` ele não sai, e a recusa vem antes da porta; sem a
  auditoria, todo vídeo do projeto fica privado de qualquer jeito, e o modo teste só alcança o canal
  de teste. Cada entrega vai ao RASTRO (`pauta.youtube_token_entregue`, com `soEnvio` e `renovado`,
  sem o valor).
- Depois do `publishAt` aceito, os usos que sobraram dos dois itens são revogados: o lote se
  encerra, e o vídeo agendado não tem por onde sair de novo pelo OS.
- **A sessão já aberta é devolvida sem passar pela porta** (e sem gastar uso), como o token novo:
  os dois conferem ali o item ativo do lote assinado, o hash do pacote de agora contra o assinado,
  a auditoria e o interruptor do YouTube. Só abrir sessão nova e concluir gastam uso.

**Medido** (Mac, `marketing_os_test`, 25/09/2026 ~01h): `pnpm typecheck` 7/7; `typecheck:test`
limpo; api direto **2977 de 2977** em 73 arquivos (+51: `youtube` 28 novo, `pauta-youtube` 13 novo com
banco, `arquitetura` +5, `escritas-pela-porta` +2, `modulos-por-tenant` +1, `modelos-globais` +1,
`root-midia` +1; `conector-desligado` remediu a conta); sem banco, 2293 passados e 684 pulados; web
**604** em 47 (+8, `pauta-youtube` novo); policy **93** (+3); `test:porta` 61; `test:isolamento`
**352** (+6, `EnvioAoYoutube`); `db:diff` "No difference detected."; `build` + `smoke` OK. O
`db:seed:politica` no banco de teste recusou sem assinatura e aceitou com `POLITICA_CAPACIDADE_NOVA_*`
("capacidade nova em R3 (não declarada valia R5)", as duas). Pisos da CI: api 2145/65, web 417/38,
isolamento 276, policy 60/2, com a conta no `ci.yml`.

**Ensaio local — o "pronto quando"** (`dist/main.js` contra `marketing_os_zero_md10`, criado vazio:
migrations do zero, `db:seed` e `db:seed:politica` assinado; MinIO descartável da imagem
`minio/minio` em `127.0.0.1:9419`; dublê do Google/YouTube em `127.0.0.1:4412` como
`YOUTUBE_API_URL`/`_UPLOAD_URL`/`_OAUTH_URL`, que grava os bytes recebidos e derruba a conexão no
meio do 3º bloco; arquivo sintético de 300 MB (`dd`), `HOME` do `root-midia` numa pasta
descartável; banco, MinIO, API, dublê e o arquivo removidos no fim):
1. `POST /pauta/youtube/conectar` → a URL do Google com os dois escopos, `offline` e `consent`; o
   callback com o `state` devolvido → 302 `…/pauta?aba=episodios&youtube=ok` (o dublê recebeu a
   troca do código e o `channels.list`); com `state` forjado → `youtube=expirado`, sem consulta.
2. Thumb 1280×720 subida e escolhida, horário `2026-09-27T18:00-03:00`. Com `YOUTUBE_AUDITORIA=pendente`,
   `root-midia youtube ep-01` declarou o arquivo e a sessão voltou **400** "PRIVADO PARA SEMPRE"; o
   dublê recebeu **0** chamadas. Com `aprovada` e **sem lote**: **409** "Não há item de envio…", **0**
   chamadas.
3. "Aprovar a semana" → lote com 2 itens (envio e agendamento); a titular leu o conteúdo (título,
   thumb 1, arquivo `5bc28a28ef2d`, 314.572.800 bytes, horário) e assinou com senha e motivo → ativo.
4. `root-midia youtube ep-01`: o dublê recebeu a sessão com `privacyStatus: private`, sem `publishAt`,
   título, descrição com a página no ar e categoria 28; 5 blocos de 64 MiB, a conexão derrubada no
   3º (20 MiB guardados), a consulta `bytes */314572800` → 308 com `Range`, a retomada em
   `155189248-` e o 200 com o id. **O sha256 recebido é igual ao do arquivo** (`5bc28a28…`). O
   "concluído": `videos.list` e `thumbnails.set` com o PNG (sha256 igual ao da thumb) → `conferido`.
5. `POST /rotinas` (`pauta.publicar-agendadas`) e "Rodar agora": com a nota desligada, `pulada`
   (publicação automática desligada) e **0** chamadas; com `pauta.publicacao.automatica` = `ligada`,
   `ok` "ep-01 youtube: agendada (2026-09-27T21:00:00.000Z)": o dublê recebeu `videos.list` e
   `videos.update?part=status` com `{id, status: {privacyStatus: private, publishAt, selfDeclaredMadeForKids: false}}`
   — nenhum campo de `snippet`.
6. O vigia: um segundo episódio com o lote assinado apareceu em `GET /pauta/youtube/pendentes`, e
   uma passagem de `root-midia vigia` (arquivo de variáveis descartável) subiu os 5 blocos e concluiu
   (`"youtube":["ep-02 conferido"]`).
7. No banco: 3 `ToolCall` do YouTube (R4 às 01h de SP, `fora_da_janela`, coberto pelo lote R4), e
   **nenhum** `ToolCall`, `EventLog` ou `AuditLog` com a URI da sessão, o token ou o refresh.

**A correção dos três revisores** (25/09/2026, no mesmo commit):
- **O 401 do Mac não vira laço.** O `root-midia` pede no máximo 2 tokens seguidos (`TOKENS_SEGUIDOS`)
  e para na hora se o OS devolver o mesmo token, com a frase de conectar o canal de novo; o
  `POST …/sessao/token` descarta o token guardado e renova de verdade (`forcar`). O dublê do protocolo
  ganhou o 401 que persiste.
- **A janela do item de envio vale fora da porta.** A sessão aberta, o token novo e a fila do vigia
  (`pendentes`) exigem `agora` entre `janelaDe` e `janelaAte` do item — o lote vai até o último post
  da semana, e sem isso o token seguia saindo por dias depois do que a titular assinou.
- **A rotina parte dos itens vivos** (`LotesService.recursosComItemAtivo`) e só então lê os envios
  deles: as linhas `declarado`/`conferido` de outros episódios não tiram o da semana da consulta. Com
  a nota desligada, a passagem só pula, também com a janela fechada (como o Instagram).
- **O pacote mudado revoga os itens.** A sessão e o token recusados por hash revogam os dois itens do
  vídeo ali mesmo, e o "Aprovar a semana" oferece o vídeo de novo (a montagem revoga o item ativo
  divergente antes de montar). O item de envio gasto (o vídeo já subiu) não segura mais o vídeo.
- **O modo teste tem trava de canal.** `YOUTUBE_CANAL_DE_TESTE` (compose e `.env.example`) com o id
  do canal; vazio ou outro canal conectado (`IntegrationAccount.config.canalId`) recusa a sessão. A
  linha grava `enviadoEmTeste`; o vídeo desse modo nunca é oferecido nem aceito para publicar, e o
  mesmo arquivo declarado de novo fora do modo teste recomeça o envio (o `root-midia` redeclara
  sozinho). Os textos do "Aprovar a semana" e do resumo do lote dizem que ele fica privado para
  sempre.
- **O vídeo que sumiu ou foi recusado solta a linha.** `divergenciaDoVideo` recusa `uploadStatus`
  `rejected`, `failed` e `deleted`; a conclusão com um id que não existe no canal mantém a sessão
  reaproveitável (a próxima execução pergunta ao YouTube o id, sem subir de novo); o agendamento de
  um vídeo que sumiu solta o `videoId`.
- **A playlist não duplica:** `playlistItems.list` por vídeo antes do insert.
- **A titular vê a thumb** no cartão do lote (a imagem pela rota autenticada do pacote), e não só o
  número; `PautaItemDoYoutubeNoLote` ganhou `episodioId`. O "Aprovar a semana" distingue os três
  casos (os dois itens, só o envio do modo teste, só o agendamento do vídeo que já subiu) e avisa
  quando a publicação automática está desligada.
- **Rastro e catraca:** `POST /pauta/youtube/conectar` grava `conector.autorizar` (o mesmo evento de
  /conexoes; a permissão segue `pauta.publicar`, o precedente da conta de publicação da MD5);
  `youtube.com` e `youtu.be` entraram em `HOSTS`, e o link de exibição vem do conector
  (`urlDoVideo`). O aviso da volta do OAuth mora no topo da aba Episódios. A saúde lembra do Testing
  pela data da conexão quando o Google não manda o prazo.
- **Recusado:** nada. Medido depois da correção: api direto **2990 de 2990** em 73 arquivos (+13:
  `youtube` +10, `pauta-youtube` +3); sem banco, 2303 passados e 687 pulados; web **605** em 47 (+1);
  policy 93; `test:porta` 61; `test:isolamento` 352; `root-midia` 122; `db:diff` limpo; `build` +
  `smoke` OK. Pisos: api 2153/65, web 418/38.

Não conferido na tela a 375 px: o ensaio não entra no navegador com senha. A seção segue os
vizinhos (`flex-wrap`, `break-words`, `min-w-0`, `grid-cols-1` até `sm`) e o teste de componente
cobre os estados.

**Deploy:** duas migrations aditivas (o enum, a tabela com RLS e gatilho, duas colunas e um CHECK no
episódio; depois a coluna `enviadoEmTeste`). **Antes da subida**, o `db:seed:politica` com `POLITICA_CAPACIDADE_NOVA_*`: sem ele as
duas capacidades valem R5 e a porta bloqueia (falha fechada, nada vai ao YouTube). Variáveis novas no
compose e no `.env.example`: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`,
`YOUTUBE_API_URL`/`_UPLOAD_URL`/`_OAUTH_URL` (vazias em produção), `YOUTUBE_AUDITORIA` (padrão
`pendente`) e `YOUTUBE_CANAL_DE_TESTE` (vazia). Nenhuma permissão nova.

**Riscos.** Antes da auditoria, qualquer envio real trava o vídeo em privado para sempre: com
`teste`, só no canal de `YOUTUBE_CANAL_DE_TESTE`. O Mac recebe por ~1 h um token pedido só com
`youtube.upload`; se o Google não estreitar, com `aprovada` o envio pelo Mac fica parado até a
autorização só de envio existir (pendência 9) — sem a auditoria, o token largo sai, curto, só com a
sessão aberta, o item ativo dentro da janela e o RASTRO de cada entrega.
O token de acesso fica na memória do processo: dois containers da API renovariam cada um o seu (a
regra de uma réplica, da onda D, continua). O prazo da auditoria é desconhecido.

**Pendências (do Pedro), na ordem:**
1. Dizer qual conta Google é dona do canal da Root (pessoal, Workspace ou Brand Account).
2. Criar o projeto próprio no Google Cloud, ativar a **YouTube Data API v3**, criar o cliente OAuth
   **web** com a redirect `https://os.operacaoroot.com/api/youtube/callback` e pôr a tela de
   consentimento em **produção** (ou Internal, se a conta for Workspace). Em Testing a autorização
   vence em 7 dias (a saúde avisa).
3. Pôr no `.env` da VPS (easyPanel): `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` e
   `YOUTUBE_REDIRECT_URI=https://os.operacaoroot.com/api/youtube/callback`; deixar
   `YOUTUBE_AUDITORIA=pendente`.
4. `db:seed:politica` na VPS **antes** do deploy, assinado:
   `POLITICA_CAPACIDADE_NOVA_AUTOR='pedro.magnago@fullbpo.com' POLITICA_CAPACIDADE_NOVA_MOTIVO='MD10: catálogo ganha youtube.video.enviar e youtube.video.publicar (R3, sob o lote da semana)' pnpm --filter @mktos/api db:seed:politica`.
5. Verificar o canal por telefone em `youtube.com/verify` (sem isso o `thumbnails.set` devolve 403).
6. Conectar uma vez, logado na conta dona do canal: aba Episódios › seção YouTube › "Conectar o
   canal" (ou Conexões).
7. Pedir a auditoria no formulário "YouTube API Services - Audit and Quota Extension"
   (`support.google.com/youtube/contact/yt_api_form`), com a política de privacidade publicada e uma
   conta de demonstração. Para testar antes, um **canal de teste** com `YOUTUBE_AUDITORIA=teste` e
   `YOUTUBE_CANAL_DE_TESTE=<id UC… do canal de teste>`, conectado no lugar do canal real. O vídeo
   do teste fica privado para sempre no canal de teste; para mandar o episódio ao canal real depois,
   reconecte o canal real e rode `root-midia youtube ep-NN` fora do modo teste (o arquivo é
   declarado de novo e o vídeo volta ao "Aprovar a semana").
8. Quando a auditoria sair: `YOUTUBE_AUDITORIA=aprovada` no `.env` e recriar o container (`up -d`).
   A publicação só sai também com a nota `pauta.publicacao.automatica` ligada (D-MD1).
9. **A conferir no primeiro OAuth real:** se o refresh com `scope=youtube.upload` devolve um token
   só de envio (o RASTRO `pauta.youtube_token_entregue` diz `soEnvio`). Se não devolver, com
   `aprovada` o OS não entrega token ao Mac: a saída é uma segunda autorização só de envio, guardada
   no cofre com outro nome (fatia a abrir). Conferir também se o Google manda
   `refresh_token_expires_in` em Testing (sem ele, a saúde lembra pela data da conexão) e a categoria
   certa do canal (nota `pauta.youtube.categoria`, padrão 28).

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

> A frente da máquina de conteúdo (onda MC-A, §1) tem uma ordem curta própria, que se soma a
> esta: duas migrations de enum, uma variável e nenhum seed. A onda MC-B (§1) soma mais três
> migrations (uma tabela nova com RLS e duas colunas nulas), nenhuma variável na API e nenhum seed.
> A MC16 soma a sexta, `20260924090000_pauta_peca_agenda` (duas colunas nulas e um índice), no fim
> da ordem do B2: **MC-A 2 + MC-B 3 + MC16 1**, e o `db:status` da produção mostra essas seis mais
> as da `main` que ainda não subiram. A imagem do `web` também muda (o prazo do proxy de `/api`
> subiu para 10 min em `apps/web/next.config.mjs`): vale só com a imagem reconstruída no passo 9 —
> `up -d --no-build` com a imagem velha mantém os 30 s e as gerações longas voltam a dar 500.
> A ordem da frente inteira, numerada de 1 a 12, está no fim da onda MC-C (§1): "ORDEM DE DEPLOY
> CONSOLIDADA DA FRENTE (A + B + C)".

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
| 6 | Variável nova nos **dois** lugares: bloco `environment:` do serviço em `docker-compose.yml` **e** `.env` | O container **não lê arquivo `.env`**: só chega o que está no bloco. Foi o que segurou a `ANTHROPIC_API_KEY` por semanas. Nesta execução entraram: `COFRE_CHAVES` e `COFRE_CHAVE_ATUAL` (vazias = cofre funciona na chave antiga, mas **não rotaciona**), `ROTINAS_CRON` (padrão ligado; único jeito de subir sem relógio), as três do canal de aprovação — `CANAL_APROVACAO_SEGREDO`, `CANAL_APROVACAO_CODIGO_SEGREDO`, `CANAL_APROVACAO_CAPACIDADES` (vazias = canal desligado) — e, da onda 11, o limiar de alerta do painel de custo. Da onda MC-A, `EVOLUTION_LINKS_JID` e `EVOLUTION_LINKS_ORG_ID` (qualquer uma vazia = grupo de links desligado; ordem própria no §1, onda MC-A) |
| 7 | `NEXT_PUBLIC_CENTRAL_PIXEL_KEY` como **build arg** da imagem | O Next troca toda `NEXT_PUBLIC_*` pelo valor durante o `next build`. Declarada só no bloco `environment:`, ela nunca chega ao navegador e o rastreio da Central segue caindo na empresa padrão. Trocar a chave exige **reconstruir a imagem**; `docker restart` não muda nada |
| 8 | `docker tag mktos-app:latest mktos-app:rollback` | A imagem anterior vira lixo na próxima poda e o rollback deixa de existir. É o passo que mais dói ter pulado. **Voltar para ela depois da máquina de conteúdo pede antes a receita A1-volta (§1, onda MC-A)**: a imagem antiga não lê rodada em `aguardando_curadoria` nem fonte `gmail` |

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

**Na pauta (onda D)**

23. **MD1: montar a página de links passou pelo `umaPorVez`** (`pauta-pagina-de-links:<empresa>:<episódio>`):
    o segundo clique simultâneo, ou o clique durante a passagem do encadeamento, é 409 na hora.
24. **MD1: distribuir põe a peça aprovada no slot PROPOSTO dela** quando ele ainda está livre, no
    futuro e na grade vigente (sem feriado novo); sem ele, o de antes. O proposto de outro episódio e
    o das irmãs em rascunho do mesmo episódio passam a ocupar o slot para o distribuir. Descartar pelo
    PATCH devolve o slot proposto; aprovar não converte proposto em agenda.

**Na porta (onda D)**

25. **MD3: a janela horária da política é lida em São Paulo** (`POLITICA_FUSO_HORARIO`, padrão
    `America/Sao_Paulo`, em `apps/api/src/policy/limites.ts`), e não mais no `TZ` do processo, que no
    container é UTC. Em TODA capacidade, das 17h às 20h de SP o `fora_da_janela` deixa de acender e
    das 05h às 08h passa a acender: rotina que subia um degrau à tarde deixa de subir, e a que roda
    de madrugada nessa faixa passa a subir. Regra nova no arranque: valor inválido na variável
    impede a API de subir, com a linha `POLITICA_FUSO_HORARIO="<valor>" não é um fuso conhecido` no
    log. A agenda da semana segue na constante de SP e não lê a variável.

**Na mídia da peça (onda D)**

26. **MD4: o mp4 do corte deixa de ficar só no Mac.** `root-midia cortes` passa a subir o arquivo
    inteiro ao storage da VPS (`pauta/pecas/<id>/corte-<sha256>.mp4`), além de registrar o caminho,
    e `stories`/`carrosseis` sobem também um JPEG por imagem. A aba Semana troca "o vídeo ficou no
    Mac" por "Salvar o mp4" quando ele está no OS. Há uma rota pública nova,
    `GET /api/midia-publica/:token`, que serve o JPEG e o mp4 da peça aprovada por URL assinada de até 1 h; sem
    `PAUTA_MIDIA_PUBLICA_SEGREDO` ela responde 404 para tudo. Carrossel com mais de 10 slides deixa
    de ser aprovado. O vigia do Mac passa a refazer o corte que só foi registrado (sem o mp4 no
    storage) e a imagem sem JPEG — na primeira passagem depois do deploy, as peças da semana já
    renderizadas voltam a ser renderizadas uma vez para subir o que falta. O mp4 acima de 10 MB
    **não passa pelo proxy do Next**: o Mac precisa de `ROOT_OS_ENVIO_URL` apontando para a API
    direto.

**Na conexão da bio (onda D)**

27. **MD5: a conta de publicação do Instagram.** Nasce a finalidade da conexão (`bio` ou
    `publicacao`). Tudo que existe fica `bio` e a bio de um criador continua pedindo só
    `instagram_business_basic`. Mudanças visíveis: a conexão que era a de publicação, se reconectada
    pela bio sem o escopo de publicar, deixa de ser de publicação (aviso na volta); o sync agendado
    da bio passa a renovar também o token da conta de publicação; a Graph da trilha do Facebook
    (métricas do `MetaService`) passa de `v21.0` para `v24.0` quando `META_GRAPH_URL` está vazia.
28. **MD6: publicar no Instagram pelo OS.** A capacidade R3 `instagram.post.publicar` existe (depois
    do seed assinado); "Publicar agora" na aba Semana fica retido até OUTRA pessoa confirmar em
    `/atendimento`, e o conector `instagram` desligado barra também essa publicação. A recusa da
    rota antiga para peça de Instagram mudou de texto (aponta para o "Publicar agora"). A peça
    publicada pelo OS aparece como postada com `manual: false`. A rotina nova só age se for criada
    em `/rotinas`. O pedido cuja aprovação venceu ou foi recusada aparece como erro, com "Publicar
    agora" de novo. Fora das 08h–20h de SP ou no segundo pedido da hora, a confirmação exige
    alçada titular (R4). **Porta:** o validador de argumentos passou a conferir listas
    (`minItems`, `maxItems`, `items`) e `pattern` quando o `argsSchema` os declara; a outra
    capacidade que declara é o `convidados` do evento do Google (lista de texto), que passa a recusar item
    que não seja texto já na porta.
29. **MD7: a aprovação de lote com uso contado.** Depois do seed com as DUAS assinaturas, existe
    `pauta.semana.aprovar` (R4) e a invariante 4 tem a segunda forma. A porta aceita `loteItemId` só
    em capacidade `sob_lote` (hoje só `instagram.post.publicar`): em qualquer outra, o campo é
    recusado com a causa `lote_nao_aceito` em vez de ignorado. Com item válido, a publicação sai sem
    fila, uma vez, e o RASTRO leva o aprovador do lote; item vencido, revogado, fora da janela, com
    conteúdo trocado ou já usado é recusa registrada (`lote_recusado`), nunca pedido novo na fila. A
    porta recusa subir sem `LotesService`. O validador passou a conferir `minimum`/`maximum`; nenhuma
    capacidade anterior os declarava. `acao.executada` passa a levar `estadoAnterior`/`estadoNovo`
    quando o efeito os devolve. A Régua mostra o modo de lote na aba Capacidades.
30. **MD8: a semana assinada publica sozinha — se a nota deixar.** Com um lote ativo e a nota
    `pauta.publicacao.automatica` ligada, a rotina `pauta.publicar-agendadas` publica cada peça no
    horário pelo item dela (a porta consome o uso), com `publicadaPor` = quem assinou; sem a nota, só
    registra `pulada`. Assinar a semana passa as peças a `aprovada` no slot e leva o episódio a
    **Agendado** (antes, ir a Agendado era passo à mão). **O texto das peças passa a se editar no
    Agendado** (só Concluído trava): a peça editada volta a rascunho, sai da agenda e do lote. Trocar o
    JPEG ou o mp4 de uma peça num lote **assinado** também a leva a rascunho, fora da agenda (no lote
    só montado, só revoga o item); reagendar, mudar o status para fora de aprovada, "Marcar como
    postada", "Voltar ao manual" e o refazer mídia do episódio revogam o item. "Publicar agora" de peça
    com item ativo é 409. A assinatura devolve a `pendente` sem pedido a publicação que a peça tinha em
    `erro`, `recusada` ou com o pedido morto, e a rotina, quando desiste de uma peça do lote, revoga o
    item dela. O conteúdo do lote em `/atendimento` exige `aprovacoes.decidir`. O aviso do canal de aprovação (R4/R5, sem código)
    passa a trazer o link de `/atendimento` quando `WEB_ORIGIN` é https ou loopback.
31. **MD9: a fila da DM à mão.** Com a rotina `pauta.coletar-comentarios` criada, o OS lê pela porta
    (R0, só leitura, com o interruptor do Instagram) os comentários dos posts com palavra dos últimos
    7 dias, a cada 10 min, e grava quem comentou a palavra: o @ por 7 dias e o HMAC da pessoa, nunca o
    texto. Cada linha nova cria o link de campanha `campanha:dm:<itemId>` (inativo) na página do
    episódio. O `ToolCall.resultado` de qualquer efeito passa a trocar o que vier em `sigiloso()` pelo
    resumo criptográfico, como o `EventLog` já fazia (antes desta fatia nenhum efeito devolvia
    `sigiloso()`); o @ e o id do comentário vão sem resumo (só a marca e o rótulo). O `midiasDesde`
    (também usado pela sincronização da bio) passou a paginar pelo cursor `after`, sem seguir o
    `next` do corpo. Sem `META_WEBHOOK_PESSOA_HMAC_KEY`, sem o escopo de comentários ou sem o seed
    assinado, nada é lido.
32. **MD10: o YouTube pela API.** O canal se conecta por OAuth próprio (`/api/youtube/callback`, fora
    do Google da empresa) e o refresh token vai ao cofre. Com o lote da semana assinado e
    `YOUTUBE_AUDITORIA` fora de `pendente`, o Mac abre a sessão pela porta e sobe o vídeo direto ao
    YouTube, sempre privado; o OS confere o vídeo e define a thumb. Com `aprovada` e a nota
    `pauta.publicacao.automatica` ligada, a rotina `pauta.publicar-agendadas` passa a mandar também o
    `publishAt` (só `part=status`). O "Aprovar a semana" passa a incluir o vídeo quando ele está
    pronto, e a titular o lê no cartão do lote. O `root-midia enviar` passa a declarar o vídeo final
    (sha256), e o vigia passa a enviar os episódios com o item de envio ativo. Sem o seed assinado,
    sem credencial ou com a auditoria pendente (o padrão), nada vai ao YouTube. O modo teste passa a
    exigir `YOUTUBE_CANAL_DE_TESTE` e só abre sessão para esse canal.

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
