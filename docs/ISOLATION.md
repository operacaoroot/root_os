# Marketing OS — Isolamento (regra dura)

> **Este projeto é do `root` (studio de IA/SaaS). NÃO é do escritório Cardozo & Saggioro.**
> Definido pelo Rodrigo em 2026-07-06. Vale para todo o ciclo de vida do projeto.

## A regra em uma frase
**Docker próprio, MCP próprio, credenciais próprias, dados próprios. Zero contato com a infraestrutura, o MCP (`cardozo-saggioro`), a rede, os containers ou os dados do escritório. Nada é puxado de lá.**

## O que isso proíbe (nunca fazer)
- ❌ Usar/consultar/estender o MCP do escritório (`cardozo-saggioro`) ou qualquer tool dele.
- ❌ Compartilhar Postgres, Redis, MinIO, rede Docker ou volumes com qualquer stack do escritório.
- ❌ Reutilizar tokens, contas, canais (ex.: o WhatsApp/Digisac do escritório), segredos ou credenciais do escritório.
- ❌ Ler ou copiar dados do escritório para dentro deste sistema.
- ❌ Publicar containers deste projeto na mesma rede/stack do escritório.

## O que isso exige (sempre fazer)
- ✅ **Stack Docker dedicado:** `COMPOSE_PROJECT_NAME=marketing-os`, rede `marketing-os-net`, volumes prefixados (`mktos_*`), faixa de portas própria que **não** colide com o escritório.
- ✅ **Serviços próprios:** Postgres+pgvector, Redis e MinIO exclusivos deste projeto.
- ✅ **MCP próprio** (`packages/mcp`), com suas próprias tools, permissões e logs.
- ✅ **Credenciais próprias** para cada integração (ClickUp, Gmail, WhatsApp, etc.) — contas/apps criados para o Marketing OS, nunca as do escritório.
- ✅ **Repositório próprio** no GitHub (privado).
- ✅ **Memória própria** no Obsidian, dentro do contexto `root` (não do escritório).

## Portas (host) — faixa dedicada, sem colisão
O escritório/SGP usa portas na casa dos `:97xx`/`:10000`. Para garantir zero colisão, o Marketing OS usa faixa própria (configurável em `.env`):

| Serviço | Porta host (padrão) |
|---|---|
| web (Next.js) | `4000` |
| api (NestJS) | `4001` |
| Postgres | `5442` |
| Redis | `6390` |
| MinIO API / console | `9010` / `9011` |

## Hospedagem
Host-agnóstico. Se um dia rodar no mesmo servidor físico que hospeda o escritório, **ainda assim** deve ser um stack Docker separado (rede/volumes/portas próprios) sem nenhum serviço compartilhado — ou, preferencialmente, em host próprio. A escolha do host é do Rodrigo; a arquitetura não depende dela.

## Checklist de conformidade (revisar a cada fase)
- [ ] `docker-compose.yml` tem `name: marketing-os` e rede/volumes próprios.
- [ ] Nenhuma variável de ambiente aponta para serviço do escritório.
- [ ] Nenhuma tool MCP do escritório é referenciada no código.
- [ ] Integrações usam contas/apps criados para o Marketing OS.
- [ ] `.env` do projeto é independente; nada de segredo do escritório.
