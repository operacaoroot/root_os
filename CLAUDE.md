# marketing-os — sistema de marketing FullBPO/ROOT

## Onde roda
- VPS: stack compose `marketing-os` (`/srv/marketing-os/docker-compose.yml` + override), containers `mktos_api` e `mktos_web`. Ver skill `vps-fullbpo`.

## Estrutura e comandos
- Monorepo (`apps/` + `packages/`), Node. `npm run dev` / `build` / `typecheck` / `lint`; banco: `db:generate`, `db:migrate`, `db:seed`.
- MCP server do projeto em repo separado: `~/Library/Projetos/marketin-os-mcp/` (grafia sem "g" mesmo).
- `merge-env.sh` monta o `.env` — não editar `.env` final na mão.
- Existe um zip antigo `GD/FullBPO/marketing-os-main.zip` e uma cópia `GD/OPERACAO ROOT/marketing-os-main/` — são snapshots, não usar.
