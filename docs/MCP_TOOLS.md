# ROOT OS — servidor MCP (`packages/mcp`)

> Servidor **MCP (Model Context Protocol)** próprio, em TypeScript, com o `@modelcontextprotocol/sdk`.
> Exposto para Claude Desktop, Claude Code e qualquer cliente MCP. Como plugar: `packages/mcp/README.md`.

## Estado real (conferido em 10/09/2026, contra `packages/mcp/src/server.ts`)

**São 35 ferramentas, todas `read_only`.** Não existe nenhuma ferramenta de escrita no servidor MCP:
`grep -c 'registerTool(' packages/mcp/src/server.ts` devolve 35, e todas passam por `apiGet` — o
cliente (`packages/mcp/src/client.ts`) só sabe fazer `GET`.

> Este documento já disse "10 tools". Era o número da Fase 2; o servidor cresceu e o texto não.
> O número acima é contável a partir do código; se ele divergir de novo, o código é que manda.

## Como a segurança é aplicada de verdade

O enforcement **não** está no servidor MCP, e sim na API:

1. O servidor MCP autentica em `POST /api/auth/login` com a **conta de serviço só-leitura**
   (`MCP_SERVICE_EMAIL`, default `mcp@marketing-os.local`). Sem `MCP_SERVICE_PASSWORD` o processo
   nem sobe — não há senha default no código (`client.ts:8-11`).
2. Cada tool chama um endpoint `GET` da API com esse token. O `RequirePermissions` do endpoint é
   que decide: a conta de serviço só enxerga o que o papel dela permite.
3. A IA **nunca** toca o banco. Não existe conexão direta de banco no `packages/mcp`.
4. `stdout` é do protocolo; log vai para `stderr` (`index.ts:9`).

Isso é o ADR-005 na prática (`docs/adr/ADR-005-dois-mcps.md`): leitura de banco e ação têm
superfícies separadas, e nunca `@modelcontextprotocol/server-postgres`.

### O que este documento afirmava e não é verdade hoje

| Afirmação antiga | Realidade |
|---|---|
| `defineTool({ permission, class, rateLimit, outputSchema })` | A assinatura real é `server.registerTool(nome, { description, inputSchema, annotations }, handler)`. Não há campo de permissão, classe de risco nem rate limit no servidor MCP |
| "Toda chamada → linha em `ai_tool_calls`" | A tabela **não existe** no `schema.prisma`. O registro que existe hoje é o `AuditLog` da API e o `EventLog` do gateway |
| Tools `write_safe` / `write_sensitive` / `destructive` (`create_task`, `send_whatsapp_message`, `update_campaign`…) | **Nenhuma foi implementada.** A classificação de risco de ação vive em `packages/policy` (escada R0–R5) e é aplicada pelo Tool Gateway, não pelo MCP |

As classes de risco continuam sendo o desenho alvo para quando a escrita entrar no MCP — mas o
lugar onde elas já existem em runtime é a régua, não este pacote.

## Catálogo — as 35 ferramentas

Todas são `read_only` (`annotations: { readOnlyHint: true, openWorldHint: false }`). "Permissão" é
a exigida pelo endpoint da API que a tool chama.

### Painel e funil
| Tool | Endpoint | Permissão | Argumentos |
|---|---|---|---|
| `get_dashboard_summary` | `GET /dashboard/summary` | `dashboard.ver` | — |
| `get_funnel_metrics` | `GET /funnel/metrics` | `dashboard.ver` | — |
| `get_goals_panel` | `GET /goals/panel` | `dashboard.ver` | — |

### Leads e campanhas
| Tool | Endpoint | Permissão | Argumentos |
|---|---|---|---|
| `search_leads` | `GET /leads` | `leads.ver` | `period`, `status` |
| `get_lead` | `GET /leads/:id` | `leads.ver` | `lead_id` |
| `list_campaigns` | `GET /campaigns` | `campanhas.ver` | `status` |
| `get_campaign` | `GET /campaigns/:id` | `campanhas.ver` | `campaign_id` |

### Pixel e eventos
| Tool | Endpoint | Permissão | Argumentos |
|---|---|---|---|
| `get_events_summary` | `GET /events/summary` | `dashboard.ver` | `days` |
| `list_recent_events` | `GET /events/recent` | `dashboard.ver` | `limit` |

### Tarefas (internas) e Trabalho (ClickUp)
| Tool | Endpoint | Permissão | Argumentos |
|---|---|---|---|
| `list_tasks` | `GET /tasks` | `tarefas.ver` | `overdue`, `status` |
| `get_overdue_tasks` | `GET /tasks?overdue=1` | `tarefas.ver` | — |
| `trabalho_estrutura` | `GET /trabalho/estrutura` | `tarefas.ver` | — |
| `trabalho_tarefas` | `GET /trabalho/tarefas` | `tarefas.ver` | `list_id`, `status_id`, `assignee`, `q`, `page`, `limit` |
| `trabalho_tarefa` | `GET /trabalho/tarefas/:id` | `tarefas.ver` | `task_id` |

`trabalho_tarefas` retorna uma página por chamada, sem percorrer as páginas seguintes. `total` é o total retornado pela API para a seleção, não a quantidade de itens da página. Os parâmetros opcionais `page` (inteiro de 1 a 100000) e `limit` (inteiro de 1 a 500) são encaminhados ao endpoint; quando omitidos, permanecem ausentes da query e prevalecem os defaults da API. O endpoint rejeita offsets `(page - 1) * limit` acima de 10.000.000.

### Conteúdo
| Tool | Endpoint | Permissão | Argumentos |
|---|---|---|---|
| `get_content_stats` | `GET /content/stats` | `dashboard.ver` | — |
| `list_content` | `GET /content` | `dashboard.ver` | `status`, `eixo`, `formato` |

### Conhecimento (Obsidian, busca semântica)
| Tool | Endpoint | Permissão | Argumentos |
|---|---|---|---|
| `search_knowledge` | `GET /knowledge/search` | `obsidian.ver` | `query`, `limit` |
| `get_note` | `GET /knowledge/:id` | `obsidian.ver` | `note_id` |

### Google (Agenda, Gmail, Drive)
| Tool | Endpoint | Permissão | Argumentos |
|---|---|---|---|
| `list_calendar_events` | `GET /google/calendar` | `dashboard.ver` | `max` |
| `search_gmail` | `GET /google/gmail` | `gmail.ver` | `q`, `max` |
| `get_email` | `GET /google/gmail/:id` | `gmail.ver` | `message_id` |
| `list_drive_files` | `GET /google/drive` | `drive.ver` | `q`, `max` |
| `get_doc` | `GET /google/docs/:id` | `drive.ver` | `doc_id` |

### Instagram (Meta)
| Tool | Endpoint | Permissão | Argumentos |
|---|---|---|---|
| `get_instagram_overview` | `GET /meta/instagram/overview` | `instagram.ver` | — |
| `list_instagram_media` | `GET /meta/instagram/media` | `instagram.ver` | `limit` |

### Financeiro (FinOps)
| Tool | Endpoint | Permissão | Argumentos |
|---|---|---|---|
| `get_finance_summary` | `GET /finance/summary` | `financeiro.ver` | — |
| `get_finance_kpis` | `GET /finance/kpis` | `financeiro.ver` | — |
| `list_finance_accounts` | `GET /finance/accounts` | `financeiro.ver` | — |
| `list_finance_transactions` | `GET /finance/transactions` | `financeiro.ver` | `status`, `type`, `account_id`, `from`, `to`, `limit` |
| `get_cashflow` | `GET /finance/cashflow` | `financeiro.ver` | `from`, `to` |
| `get_dre` | `GET /finance/dre` | `financeiro.ver` | `month`, `from`, `to` |
| `list_chart_accounts` | `GET /finance/chart-accounts` | `financeiro.ver` | — |
| `list_payables` | `GET /finance/payables` | `financeiro.ver` | `tipo` |
| `get_conciliacao` | `GET /finance/conciliacao` | `financeiro.ver` | `account_id` |
| `list_bank_connections` | `GET /finance/bank/connections` | `financeiro.ver` | — |

## Como a IA "cita a fonte"

As respostas da API trazem, quando existe, o campo `source`. O `packages/mcp` devolve o JSON da API
inteiro para o cliente, sem reescrever — o servidor não resume nem interpreta. Fazer o modelo citar
é regra de prompt, não do transporte. A obrigação de recusar resposta sem procedência é da fatia
4.3 do plano (`docs/PLANO-CONTINUIDADE.md`), e ainda não está implementada.

## Quando a escrita entrar

Não pelo MCP direto. O caminho decidido é o Tool Gateway (ADR-004): a capacidade é declarada em
`packages/policy`, a régua R0–R5 classifica, o gateway registra no `EventLog` **antes** do efeito e
decide entre executar, exigir aprovação ou recusar. Uma tool MCP de escrita seria só mais uma
superfície chamando o gateway — nunca um caminho paralelo.

## Rodar e plugar

```bash
pnpm --filter @mktos/mcp build     # tsc
pnpm --filter @mktos/mcp smoke     # sobe o server, lista e chama tools (API precisa estar no ar)
```

Variáveis: `MCP_API_URL` (default `http://localhost:4001/api`), `MCP_SERVICE_EMAIL`,
`MCP_SERVICE_PASSWORD` (obrigatória). Ver `.env.example`.
