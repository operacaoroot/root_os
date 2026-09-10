# marketing-os — sistema de marketing FullBPO/ROOT

## Onde roda
- VPS: stack compose `marketing-os` (`/srv/marketing-os/`), containers `mktos_api` e `mktos_web`. Ver skill `vps-fullbpo`.
- Deploy na VPS: `deploy/up.sh --vps api web`. O `--vps` faz duas coisas: (1) soma o `docker-compose.vps.yml`, que binda as portas em `172.17.0.1` (só o Traefik alcança) — **sem ele o compose base publica em `0.0.0.0`** e expõe banco/redis/minio na internet, já que o ufw não governa porta publicada pelo Docker e o `DOCKER-USER` não cobre a faixa 4000-9011; (2) **não** injeta `~/.config/root/*.env`, porque no servidor os segredos vivem no `.env` (via `merge-env.sh`) e variável de ambiente vence o `.env` — o `bio-secrets.env` de lá guarda a `ENCRYPTION_KEY` **antiga** do root-bio e o default do vault aponta para caminho inexistente.
- O serviço `telegram` só roda no Mac. Na VPS ele não sobe, mas o compose exige `MCP_SERVICE_PASSWORD` e `MCP_ACTION_PASSWORD` (`:?`) para *interpolar o arquivo inteiro* — sem elas nenhum comando compose funciona no servidor. As duas já estão no `.env` da VPS (conferido em 31/07/26), então não é mais preciso passá-las inline; se um dia sumirem de lá, todo comando compose volta a falhar de saída.
- Para só reler o `.env` sem refazer imagem: `docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-build api`. O `deploy/up.sh` força `--build`, e `docker restart` **não** serve — variável de ambiente é fixada na criação do container.

## Link na bio (módulo `bio`)
- Absorvido do root-bio em 01/08/26 (app standalone aposentado, serviço `root_bio` em 0/0; código de referência em `~/dev/root-bio`, commitado, sem deploy). Dados de produção migrados.
- Superfície pública: `bio.operacaoroot.com` aponta para o `mktos_web`; o middleware reescreve `/@handle` → `/b/handle` e `/r/:id` → `/api/bio/r/:id`. Painel em `/bio`.
- Callback OAuth em `/api/conectar/:plataforma/callback` — **path travado**: é a redirect URI registrada nos consoles da Meta e do TikTok. Mudar exige novo App Review.
- `ENCRYPTION_KEY` cifra os tokens OAuth; trocar sem re-cifrar torna todos ilegíveis (ver `apps/api/prisma/migrate-bio.ts`).
- Cada evento da bio também vira `PixelEvent` com o mesmo `eventId`, e os cliques alimentam `GoalWeek.bioClicks` sozinhos (não digitar na tela de Metas).
- Virada para produção: `docs/DEPLOY_BIO.md`.

## Referências e pauta (módulo `pauta`)
- Painel `/referencias`: captura (link/print/texto) → fila → ficha de 14 campos gerada por IA → acervo com busca semântica. Ver `docs/PAUTA.md`.
- A ficha segue o schema do vault `Cerebro-Conteudo` (`9 - Engenharia Reversa das Referências`). Taxonomia real: **8 famílias × 7 objetivos** — enum reduzido perde 1/3 do acervo.
- Importar o acervo do vault: `PAUTA_IMPORT_DIR="<.../Cerebro-Conteudo>" pnpm --filter @mktos/api import:pauta` (idempotente; 432 fichas, 119 campeãs).
- Link do Instagram/TikTok exige `APIFY_TOKEN`; cada fonte tem teto de execuções/mês porque o Apify cobra por run.
- Espelho `.md` no vault é opcional e escolhido na tela (Radar): `off` · `local` (filesystem) · `drive` (Google Drive). Na VPS o `OBSIDIAN_VAULT_HOST` aponta para `/srv/marketing-os/vault`, que **não** é o vault real do Mac — por isso o destino Drive existe.
- Painel `/pauta`: a rotina (cron) coleta os feeds, cura a janela e deriva uma peça por canal. O gatilho é um tick de 1 min com matcher próprio (`pauta/cron.ts`), não `@nestjs/schedule` — rotina editada na tela vale no minuto seguinte, sem re-registro. `PAUTA_CRON=off` desliga.
- **O LLM default agora é Claude** (`LLM_PROVIDER=anthropic`, SDK oficial). Nos modelos Opus atuais `temperature`/`top_p`/`budget_tokens` retornam **400** — não copie o formato do `OpenAiProvider`. O OpenAI segue necessário para embeddings (a Anthropic não tem esse endpoint).
- WhatsApp em grupo é via **Evolution** com instância e número dedicados do root: a Cloud API da Meta não envia para grupo. Publicar é `@SensitiveWrite('content')` — passa por aprovação confirmada, e o link vai como `BioLink` rastreado.

## Root Central (módulo `central`)
- Absorvido do repo `operacaoroot/root-central` em 01/08/26 (Next 15 SSG standalone; código de referência segue no GitHub). Detalhes: `docs/CENTRAL.md`.
- Superfície pública em `os.operacaoroot.com/central` — mesmo `mktos_web`, **fora do `AppShell`** (entrada em `PUBLICAS`), sem login. Rotas em `apps/web/src/app/central/`, resto do módulo em `apps/web/src/central/`.
- O prefixo `/central` vive só em `src/central/lib/rotas.ts`. Mover pra domínio próprio = trocar `BASE` + regra de host no middleware.
- Materiais são **arquivo versionado** (`src/central/data/materiais/*.ts`), validados por Zod **no import**: código/slug/id duplicado ou referência quebrada derruba o `build`, não a produção. Nunca "consertar" isso movendo para banco sem decidir o que se perde.
- Era Tailwind v4 (`@theme`); aqui virou v3 com tokens `central-*` sobre CSS var, e **todo o CSS está escopado em `.central-root`** — sem isso a identidade ROOT vaza pro painel.
- Eventos viram `PixelEvent` com prefixo `central_` via `/api/events/track` (mesmas chaves de visitante do `public/pixel.js`). O resgate `/central/r/CODIGO` é **Route Handler**, não página: como página o redirect saía por `<meta refresh>` com 1s de espera.

## Estrutura e comandos
- Monorepo (`apps/` + `packages/`), Node. `npm run dev` / `build` / `typecheck` / `lint`; banco: `db:generate`, `db:migrate`, `db:seed`.
- Testes: na `main`, só o `apps/web` tem suíte (58, vindos do root-central). Na branch `root-os/frente-0` existem mais 65 na API e 19 em `packages/policy` — mas `tenant-isolation` está fora do `pnpm test` e `porta`/`runtime` se pulam sem `TEST_DATABASE_URL`. Não há CI. O `next lint` do web nunca foi configurado: roda o assistente interativo e falha.
- MCP server do projeto em repo separado: `~/Library/Projetos/marketin-os-mcp/` (grafia sem "g" mesmo).
- **Onde cada `.env` é lido** (a pegadinha que mais custa tempo):
  - **Container (VPS e Mac via compose):** o container **não lê arquivo `.env`**. Só chega o que estiver listado no bloco `environment:` do serviço em `docker-compose.yml`. Preencher no `.env` uma variável que não está nesse bloco **não faz nada** — foi o que segurou a `ANTHROPIC_API_KEY` por semanas.
  - **`.env` da raiz:** serve ao compose para interpolar `${VAR}` naquele bloco. É o arquivo que o `merge-env.sh` edita (caminho fixo `/srv/marketing-os/.env` — o script só roda na VPS).
  - **`pnpm --filter @mktos/api dev` (sem docker):** o Nest usa `ConfigModule.forRoot()` sem `envFilePath`, então lê o `.env` do cwd, que é **`apps/api/.env`**.
  - `deploy/up.sh` (fora da VPS) injeta `~/.config/root/*.env` — mas essa pasta **não existe** nesta máquina.
  - Regra prática: variável nova = adicionar em **dois** lugares, o bloco `environment:` do compose e o `.env`.
- Existe um zip antigo `GD/FullBPO/marketing-os-main.zip` e uma cópia `GD/OPERACAO ROOT/marketing-os-main/` — são snapshots, não usar.

## Plano de desenvolvimento e a branch que é a base
- **O plano vigente é `docs/PLANO-CONTINUIDADE.md`** (10/09/2026). Ele substitui o `ROADMAP.md`, que virou histórico. Cópia espelhada no vault em `GD/Obsidian/Root/20-empresa/root-os/17 - Plano de continuidade (set-26).md` — a do repo é a canônica.
- **A base do produto é a branch `root-os/frente-0`**, não a `main`. Ela traz a régua R0–R5 em runtime (`packages/policy`), a porta (`apps/api/src/gateway`), o runtime de agentes (`apps/api/src/agents`), as telas da espinha do OS e 65 testes de API. Enquanto o merge (fatia 0.1 do plano) não acontecer, `main` está 5 semanas atrás e é ela que roda em produção.
- **Em `GATEWAY_MODO=observar` a porta EXECUTA escrita R3** — ela cria a aprovação, loga "TERIA RETIDO" e chama o efeito assim mesmo. Não subir a branch para produção antes da fatia 0.3a (fazer R3+ reter mesmo em observar). `GATEWAY_MODO` é lido no construtor: trocar exige `up -d --no-build api`, `docker restart` não serve.
- **`.stignore` não ignora `.git` nem `.env`**: um `git checkout` no Mac altera o working tree da VPS, e o `.env` de produção viaja para cá. Fatia 0.0 do plano resolve; até lá, cuidado com troca de branch.
- Nada que dependa de injeção do Nest roda sob `tsx` ou `vitest` (esbuild não emite `emitDecoratorMetadata`). Script que usa Nest mora em `src/scripts/` e roda compilado; o teste de boot que vale é `pnpm --filter @mktos/api smoke`.
- `prisma migrate deploy` roda no `command` do container `api`: migration que falha derruba a API. Testar antes num Postgres descartável.

## O grupo de estratégia no WhatsApp
As decisões de produto e oferta da ROOT são tomadas no grupo **"ROOT | Estratégia e Produto"** (Pedro, Lucas Fernandes, Rodrigo Saggioro). Ele fica na instância `Pedro Magnago` da Evolution, no JID `120363407836726219@g.us` — o campo `Chat.name` do banco está desatualizado com um nome antigo, então busca por nome não acha. Leitura por SQL no Postgres da Evolution na VPS (`n8n_evolution-api-db`), tabela `Message` com `key->>'remoteJid'`. O `fetchAllGroups` da API HTTP estoura timeout nessa instância (277 grupos).
