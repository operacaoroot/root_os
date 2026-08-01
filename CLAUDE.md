# marketing-os — sistema de marketing FullBPO/ROOT

## Onde roda
- VPS: stack compose `marketing-os` (`/srv/marketing-os/`), containers `mktos_api` e `mktos_web`. Ver skill `vps-fullbpo`.
- Deploy na VPS: `deploy/up.sh --vps api web`. O `--vps` faz duas coisas: (1) soma o `docker-compose.vps.yml`, que binda as portas em `172.17.0.1` (só o Traefik alcança) — **sem ele o compose base publica em `0.0.0.0`** e expõe banco/redis/minio na internet, já que o ufw não governa porta publicada pelo Docker e o `DOCKER-USER` não cobre a faixa 4000-9011; (2) **não** injeta `~/.config/root/*.env`, porque no servidor os segredos vivem no `.env` (via `merge-env.sh`) e variável de ambiente vence o `.env` — o `bio-secrets.env` de lá guarda a `ENCRYPTION_KEY` **antiga** do root-bio e o default do vault aponta para caminho inexistente.
- O serviço `telegram` só roda no Mac. Na VPS ele não sobe, mas o compose exige `MCP_SERVICE_PASSWORD` e `MCP_ACTION_PASSWORD` (`:?`) para *interpolar o arquivo inteiro* — sem elas nenhum comando compose funciona no servidor. Hoje se passa as duas inline no deploy; não estão no `.env`.

## Link na bio (módulo `bio`)
- Absorvido do root-bio (app standalone aposentado; código de referência em `~/dev/root-bio`, commitado, sem deploy).
- Superfície pública: `bio.operacaoroot.com` aponta para o `mktos_web`; o middleware reescreve `/@handle` → `/b/handle` e `/r/:id` → `/api/bio/r/:id`. Painel em `/bio`.
- Callback OAuth em `/api/conectar/:plataforma/callback` — **path travado**: é a redirect URI registrada nos consoles da Meta e do TikTok. Mudar exige novo App Review.
- `ENCRYPTION_KEY` cifra os tokens OAuth; trocar sem re-cifrar torna todos ilegíveis (ver `apps/api/prisma/migrate-bio.ts`).
- Cada evento da bio também vira `PixelEvent` com o mesmo `eventId`, e os cliques alimentam `GoalWeek.bioClicks` sozinhos (não digitar na tela de Metas).
- Virada para produção: `docs/DEPLOY_BIO.md`.

## Estrutura e comandos
- Monorepo (`apps/` + `packages/`), Node. `npm run dev` / `build` / `typecheck` / `lint`; banco: `db:generate`, `db:migrate`, `db:seed`.
- MCP server do projeto em repo separado: `~/Library/Projetos/marketin-os-mcp/` (grafia sem "g" mesmo).
- `merge-env.sh` monta o `.env` — não editar `.env` final na mão.
- Existe um zip antigo `GD/FullBPO/marketing-os-main.zip` e uma cópia `GD/OPERACAO ROOT/marketing-os-main/` — são snapshots, não usar.
