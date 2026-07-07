# Marketing OS

> **Sistema Operacional de Marketing** — painel único, clicável e acionável + Hub/MCP que conecta ferramentas e expõe capacidades para qualquer IA, com segurança, permissões e auditoria.
>
> **Produto do projeto `root`** (studio de IA/SaaS). Nome configurável via `APP_NAME`.

## ⚠️ Isolamento (leia antes de tudo)
Este projeto é **completamente isolado** do escritório Cardozo & Saggioro: **Docker próprio, MCP próprio, credenciais próprias, dados próprios**. Zero contato com a infra, o MCP (`cardozo-saggioro`), a rede ou os containers do escritório. Nada é puxado de lá. → [docs/ISOLATION.md](docs/ISOLATION.md)

## Status
**Fase 0 — Planejamento concluído.** Sem código de aplicação ainda. Esta entrega é a fundação: arquitetura, isolamento, modelo de dados, integrações, MCP, segurança e roadmap.

## Documentação (leia nesta ordem)
1. [docs/ISOLATION.md](docs/ISOLATION.md) — **regra dura de isolamento do escritório**
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — princípios, stack, blocos, fluxo de dados
3. [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — tabelas, relacionamentos, índices, retenção
4. [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — conectores: dados, ações, sensibilidade, fase
5. [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md) — ferramentas para IA, classes de risco, aprovação
6. [docs/SECURITY.md](docs/SECURITY.md) — RBAC, ações sensíveis, LGPD, riscos
7. [docs/KPIS.md](docs/KPIS.md) — indicadores por módulo
8. [docs/ROADMAP.md](docs/ROADMAP.md) — fases e MVP

## Stack (resumo)
TypeScript ponta-a-ponta · Next.js (web) · NestJS + BullMQ (api/workers) · PostgreSQL 16 + pgvector · Redis · MinIO (S3) · Prisma · Auth.js + RBAC · **MCP SDK próprio** (TS) · Anthropic/Claude atrás de `LLMProvider` · WhatsApp (conta própria) atrás de `WhatsappProvider`. Tudo em stack Docker dedicado (`marketing-os-net`).

## Estrutura
```
marketing-os/
  apps/
    web/          # Next.js — dashboard clicável
    api/          # NestJS — routes, webhooks, connectors, jobs, mcp, auth, audit
  packages/
    connectors/   # 1 plugin isolado por ferramenta
    mcp/          # MCP server PRÓPRIO + tools + schemas
    shared/       # types, schemas (zod), prompts, utils
  data/           # migrations, seeds
  docs/           # esta documentação
  infra/          # scripts de deploy (stack isolado)
  .env.example    # NUNCA commitar .env real; NUNCA apontar p/ o escritório
  docker-compose.yml
```

## Rodar as dependências (Fase 1 em diante)
```bash
cp .env.example .env      # preencha os segredos (credenciais PRÓPRIAS)
docker compose up -d      # Postgres + Redis + MinIO isolados (rede marketing-os-net)
# portas host padrão: web 4000 · api 4001 · db 5442 · redis 6390 · minio 9010/9011
```

## Princípios inegociáveis
Isolamento total do escritório · um dado uma verdade · tudo clicável e acionável · IA nunca inventa (cita fonte) · ação sensível exige humano · nada de token no frontend · nada de fornecedor único.

## Memória do projeto
Além do código, este projeto tem **memória própria no Obsidian** (vault `root`) e vive versionado no **GitHub** — o "ponto zero" para não perder nada.

## Próximo passo
Iniciar **Fase 1** (base do sistema, isolada). Ver [docs/ROADMAP.md](docs/ROADMAP.md).
