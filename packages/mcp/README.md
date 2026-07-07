# @mktos/mcp — Hub MCP do Marketing OS

Servidor **MCP (Model Context Protocol)** que expõe ferramentas padronizadas para qualquer IA
(Claude Desktop, Claude Code, ou qualquer cliente MCP) consultar o Marketing OS **com segurança**.

## Princípios (ver `docs/MCP_TOOLS.md` e `docs/ISOLATION.md`)
- A IA **nunca** toca o banco direto. Toda tool chama a **API** do Marketing OS.
- Autentica com uma **conta de serviço só-leitura** (`ia_servico`) → passa por **RBAC + auditoria**.
- Nesta fase, **todas as tools são `read_only`** (menor privilégio). Escrita/ações sensíveis entram
  depois com o fluxo de aprovação humana.
- Toda resposta inclui o campo `source` da API → a IA **cita a fonte** e não inventa.

## Tools (Fase 2 — read-only)
| Tool | O que faz |
|---|---|
| `get_dashboard_summary` | Resumo executivo do dia |
| `get_funnel_metrics` | Etapas do funil + conversão |
| `search_leads` | Lista leads (filtro period/status) |
| `get_lead` | Ficha completa de um lead |
| `list_campaigns` | Campanhas com leads/conversões/CPL |
| `get_campaign` | Dossiê da campanha (CPL/CPA + leads) |
| `list_tasks` | Tarefas (filtro overdue/status) |
| `get_overdue_tasks` | Só tarefas atrasadas |
| `get_events_summary` | Tráfego do pixel: totais, receita, quebra por evento/origem, série diária |
| `list_recent_events` | Últimos eventos do pixel (page_view/purchase/lead…) |

## Rodar
```bash
# 1) API do Marketing OS precisa estar no ar (http://localhost:4001) com o seed aplicado
# 2) build
pnpm --filter @mktos/mcp build
# 3) teste end-to-end (sobe o server, lista e chama tools)
pnpm --filter @mktos/mcp smoke
```

## Plugar no **Claude Desktop**
Edite `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "marketing-os": {
      "command": "node",
      "args": ["/Users/rodrigosaggioro/marketing-os/packages/mcp/dist/index.js"],
      "env": {
        "MCP_API_URL": "http://localhost:4001/api",
        "MCP_SERVICE_EMAIL": "mcp@marketing-os.local",
        "MCP_SERVICE_PASSWORD": "mcp-service-12345"
      }
    }
  }
}
```
Reinicie o Claude Desktop. Pergunte: *"Use o marketing-os: o que aconteceu hoje?"*

## Plugar no **Claude Code**
```bash
claude mcp add marketing-os \
  -e MCP_API_URL=http://localhost:4001/api \
  -e MCP_SERVICE_EMAIL=mcp@marketing-os.local \
  -e MCP_SERVICE_PASSWORD=mcp-service-12345 \
  -- node /Users/rodrigosaggioro/marketing-os/packages/mcp/dist/index.js
```

> ⚠️ Em produção, use uma senha forte para a conta de serviço e restrinja a rede.
> Este MCP é **exclusivo do Marketing OS (root)** — não tem qualquer relação com o MCP do escritório.
