# ROOT OS (repositório `marketing-os`)

> Plataforma multi-tenant de IA aplicada da ROOT. O painel, as superfícies públicas e o núcleo de governança (régua de risco, porta única, rastro) vivem neste monorepo.
>
> **Produto do projeto `root`.** Nome da interface configurável via `APP_NAME`; a marca em produção é ROOT OS.

## ⚠️ Isolamento (leia antes de tudo)
Este projeto é **completamente isolado** do escritório Cardozo & Saggioro: Docker próprio, MCP próprio, credenciais próprias, dados próprios. → [docs/ISOLATION.md](docs/ISOLATION.md)

## Estado (10/09/2026)

Em produção (`os.operacaoroot.com`, `bio.operacaoroot.com`) roda um monorepo TypeScript com 25 módulos de API e ~40 telas: identidade e RBAC, auditoria, aprovações, dashboard, leads, funil, campanhas, pixel/eventos, tarefas e Trabalho (ClickUp interno), Conteúdo, Pauta e Referências, Metas, Link na bio, Financeiro (FinOps), Google, Meta/Instagram, Obsidian com busca semântica, integrações, relatórios e um servidor MCP com 35 ferramentas só-leitura.

Desde 17–20/08 o produto virou **ROOT OS**: multi-tenant, com escada de risco R0–R5, porta única para toda ação de agente, cofre de segredos, rastro append-only e memória versionada. A branch `root-os/frente-0` já entrega a régua em runtime, o gateway em modo observar, o runtime de agentes e as primeiras 65 provas automatizadas da API — **e ainda não foi mergeada nem publicada**. Produção roda o código de 03/08.

O caminho daqui até o V1 está em **[docs/PLANO-CONTINUIDADE.md](docs/PLANO-CONTINUIDADE.md)** — fatias em ordem de dependência, critério de pronto, plano de migração e as decisões que ainda precisam de gente. Esse documento substitui o `ROADMAP.md`, que fica como histórico.

## Documentação

Comece por [CLAUDE.md](CLAUDE.md) (as armadilhas que mais custam tempo) e pelo [plano de continuidade](docs/PLANO-CONTINUIDADE.md). Depois, por assunto:

| Assunto | Arquivo |
|---|---|
| Regra dura de isolamento | [docs/ISOLATION.md](docs/ISOLATION.md) |
| Arquitetura as-built | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Modelo de dados | [docs/DATA_MODEL.md](docs/DATA_MODEL.md) |
| Conectores | [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) |
| Ferramentas MCP | [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md) |
| Segurança, RBAC, LGPD | [docs/SECURITY.md](docs/SECURITY.md), [docs/PRIVACY.md](docs/PRIVACY.md) |
| Módulo Pauta e Referências | [docs/PAUTA.md](docs/PAUTA.md) |
| Módulo Link na bio | [docs/DEPLOY_BIO.md](docs/DEPLOY_BIO.md) |
| Root Central | [docs/CENTRAL.md](docs/CENTRAL.md) |
| Financeiro (FinOps) | [docs/FINANCE.md](docs/FINANCE.md), [docs/ASAAS.md](docs/ASAAS.md) |
| KPIs | [docs/KPIS.md](docs/KPIS.md) |
| Histórico de fases | [docs/ROADMAP.md](docs/ROADMAP.md) |

## Stack

TypeScript ponta a ponta · Next.js 15 (web) · NestJS 10 (api) · Prisma 6 · PostgreSQL 16 + pgvector · Redis · MinIO · Zod · Anthropic e OpenRouter atrás de `LlmProvider`, OpenAI só para embeddings · WhatsApp por Evolution · MCP SDK próprio. Docker Swarm e easyPanel com Traefik na VPS.

## Estrutura

```
marketing-os/
  apps/
    web/          Next.js — painel, /central, /b/:handle
    api/          NestJS — módulos, gateway, política, agentes, webhooks
    telegram/     bot (só roda no Mac)
  packages/
    policy/       escada R0–R5 e catálogo de capacidades
    mcp/          servidor MCP (35 ferramentas só-leitura)
    shared/       tipos, schemas Zod, navegação
  deploy/         scripts de deploy
  docs/           esta documentação
```

## Rodar

```bash
cp .env.example .env      # segredos próprios; NUNCA commitar o .env real
docker compose up -d      # Postgres + Redis + MinIO isolados
# portas host: web 4000 · api 4001 · db 5442 · redis 6390 · minio 9010/9011
```

Comandos: `npm run dev` / `build` / `typecheck`; banco: `db:generate`, `db:migrate`, `db:deploy`. Testes: `pnpm --filter @mktos/api test`, `pnpm --filter @mktos/policy test`, `pnpm --filter @mktos/web test`. Deploy na VPS: `deploy/up.sh --vps api web` (o `--vps` não é opcional — ver CLAUDE.md).

## Princípios inegociáveis

Isolamento total do escritório · um dado uma verdade · tudo clicável e acionável · a IA nunca inventa (cita fonte) · ação sensível exige gente · conteúdo externo é dado, nunca instrução · nada de token no frontend · nada de fornecedor único.
