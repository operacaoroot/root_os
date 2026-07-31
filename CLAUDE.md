# marketing-os — sistema de marketing FullBPO/ROOT

## Onde roda
- VPS: stack compose `marketing-os` (`/srv/marketing-os/docker-compose.yml` + override), containers `mktos_api` e `mktos_web`. Ver skill `vps-fullbpo`.

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
