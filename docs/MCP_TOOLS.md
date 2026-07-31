# Marketing OS — MCP / Hub de Ferramentas para IA

> O MCP **não é** um amontoado de automações soltas. É uma camada com **contratos, permissões e logs**.
> Servidor: `packages/mcp` (`@modelcontextprotocol/sdk`, TS). Exposto p/ Claude Desktop, Claude Code e qualquer cliente MCP.

> **Status (Fase 2):** ✅ implementado e testado — 10 tools **read_only** (`get_dashboard_summary`, `get_funnel_metrics`, `search_leads`, `get_lead`, `list_campaigns`, `get_campaign`, `list_tasks`, `get_overdue_tasks`, `get_events_summary`, `list_recent_events`). Todas chamam a API via conta de **serviço só-leitura** (`ia_servico`) → passam por RBAC + auditoria; a IA nunca toca o banco direto. Como plugar: `packages/mcp/README.md`. Tools `write_*` entram nas próximas fases com aprovação humana.

## Anatomia de toda tool

```ts
defineTool({
  name: 'get_lead',
  description: 'Retorna a ficha completa de um lead pelo id.',
  inputSchema: z.object({ lead_id: z.string().uuid() }),   // validação
  outputSchema: LeadCardSchema,                             // contrato de saída
  permission: 'leads.ver',                                  // exige permissão
  class: 'read_only',                                       // classe de risco
  rateLimit: { rpm: 60 },
  handler: async (input, ctx) => { /* só via services, nunca SQL cru solto */ }
})
```
Toda chamada → linha em `ai_tool_calls` (input, output, quem, classe, aprovação, erro).

## Classes de risco e regra de execução

| Classe | Regra | Exemplos |
|---|---|---|
| `read_only` | permissão normal, executa direto | `search_leads`, `get_funnel_metrics` |
| `write_safe` | exige permissão específica do módulo | `create_task`, `score_lead` |
| `write_sensitive` | **retorna draft + `approval_token`; só executa após confirmação humana** (UI ou WhatsApp) | `send_whatsapp_message`, `draft_email_response`→send, `update_campaign` |
| `destructive` | **bloqueado por padrão**; exige dupla confirmação + permissão admin | exclusão/anonimização, `retry_automation` |

O cliente de IA nunca "pula" a classe: o enforcement está no servidor MCP, não no prompt.

---

## Catálogo de tools (MVP marcado com ★)

### Leads
| Tool | Classe | Permissão |
|---|---|---|
| ★ `search_leads` | read_only | leads.ver |
| ★ `get_lead` | read_only | leads.ver |
| `update_lead_status` | write_safe | leads.editar |
| `score_lead` | write_safe | leads.editar |
| ★ `summarize_leads` | read_only | leads.ver |

### Campanhas
`list_campaigns`·`get_campaign`·`get_campaign_metrics` (read_only) · `analyze_campaign`·`compare_campaigns` (read_only) · decisões/alterações → `update_campaign` (write_sensitive).

### Funil
★ `get_funnel_metrics` · `analyze_funnel` · `detect_funnel_bottlenecks` — todas read_only.

### Instagram
`get_instagram_overview` · `get_top_posts` · `analyze_content_performance` · `suggest_content_ideas` — read_only.

### Página de vendas / Pixel
★ `get_sales_page_metrics` · ★ `get_pixel_events` · `analyze_conversion_events` — read_only.

### Tarefas
★ `list_tasks` · ★ `get_overdue_tasks` · `summarize_tasks` (read_only) · `create_task` (write_safe) · `update_task_status` (write_safe).

### Gmail
`search_emails` · `summarize_email` · `classify_emails` (read_only) · `draft_email_response` (write_safe: gera rascunho) · **envio** = write_sensitive.

### Drive / Obsidian
`search_drive_files`·`read_drive_file`·`summarize_drive_file` (read_only) · `search_notes`·`read_note`·`summarize_note` (read_only) · `create_note` (write_sensitive).

### Relatórios
★ `generate_daily_report` · `generate_weekly_report` · `generate_campaign_report` (read_only, geram conteúdo) · `save_report_to_drive` (write_safe) · `send_report_to_whatsapp` (write_sensitive).

### WhatsApp
`send_whatsapp_message`·`send_alert`·`send_report` (write_sensitive) · `process_whatsapp_command` (roteia p/ read_only ou pede confirmação).

### Automações
`list_automation_runs`·`get_failed_automations`·`summarize_automation_errors` (read_only) · `retry_automation` (destructive — bloqueado por padrão).

### Auditoria
`log_ai_action` (system) · `list_audit_events` (read_only, permissão auditoria.ver).

---

## MVP do MCP = só read-only + create_task
As tools ★ (todas read_only exceto `create_task`) são o **MCP básico da Fase 1/7**. A IA já consegue: responder "o que aconteceu hoje?", resumir leads, ver funil, listar tarefas atrasadas, gerar (não enviar) relatório diário. Envio e escrita sensível entram depois, com o fluxo de aprovação pronto.

## Como a IA "cita a fonte"
Toda tool retorna, junto do dado, um campo `source` (`{tool, entity_ids, generated_at}`). O prompt do assistente exige citar. Se a tool retorna vazio → o assistente responde "não há dado suficiente" (regra no system prompt + validação).
