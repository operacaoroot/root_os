# FullBPO FinOps OS — Automações (Edge Functions + pg_cron)

> Documento substitui `05_N8N_WORKFLOWS.md` (arquivado em `archive/legacy/`).
> A automação do FinOps **não usa n8n**. Toda orquestração é Supabase nativa:
> - **Edge Functions (Deno)** para lógica
> - **pg_cron** para disparo periódico
> - **pg_net** para chamar Edge Functions de dentro do Postgres
> - **Vault** para guardar segredos (chaves API, JWT)
>
> Helper canônico: `public.call_edge_function(function_name, body jsonb)` (definido em
> [`supabase/migrations/20260318035019_setup_vault_and_cron.sql`](supabase/migrations/20260318035019_setup_vault_and_cron.sql)).

---

## Sumário

| # | Fluxo | Edge Function(s) | Disparo | Estado |
|---|---|---|---|---|
| 1 | Geração de rotinas diárias/semanais/mensais | `rotinas-worker` | pg_cron 08:00 seg-sex | **stub** (Fase 6) |
| 2 | Régua de cobrança | `cobranca-worker` | pg_cron 08:30 diário | **stub** (Fase 6) |
| 3 | Snapshot de acuracidade + posição de caixa | `financial-checks` | pg_cron 23:00 e 23:15 | parcial |
| 4 | Alertas operacionais (caixa negativo, fechamento, resumo) | `financial-checks` | pg_cron 07:30, 09:00 (úteis), dia 5 do mês | parcial |
| 5 | Entrada WhatsApp + classificação de doc + triagem IA | `evolution-webhook` → `transcribe-audio` / `classify-document` / `chat-ai-triage` | webhook Evolution API | ✅ operacional |
| 6 | Envio de mensagem para o cliente (operador → WA) | `chat-send-message` | RPC do frontend | ✅ operacional |
| 7 | Ticket Agent (LLM decide abrir / manter / fechar ticket) | `chat-ticket-agent-worker` → `chat-ticket-agent` | pg_cron ~30 s (worker) + dispatch urgente | ✅ operacional |
| 8 | SLA / Escalação de conversas paradas | `chat-sla-escalation` | pg_cron 15 min (horário comercial) | ✅ operacional |
| 9 | Compactação de threads longas (memoria_resumida) | `chat-thread-compact` | pg_cron 2–6 h | ✅ operacional |
| 10 | Resumo sob demanda da thread (para operador assumir) | `chat-thread-summary` | RPC do frontend | ✅ operacional |
| 11 | Análise de sentimento (diária + semanal) | `sentimento-worker` | pg_cron 23:30 (diária), seg 00:05 (semanal) | ⚠️ **schema mismatch — em correção na Fase 1** |
| 12 | Títulos recorrentes / auto-aprovação >48h / indexadores | `titulos-worker` | pg_cron 07:00, 6/6h, dia 1 do mês | **stub** (Fase 6) |
| 13 | Relatórios (DRE mensal) | `reports-worker` | pg_cron dia 28 às 06:00 | **stub** (Fase 6) |
| 14 | Sincronização incremental Omie | `omie-sync-job` | pg_cron 08:00 | ✅ operacional |
| 15 | Webhook bancário (Pluggy) | `pluggy-sync-item` | webhook Pluggy | ✅ operacional |
| 16 | Agente IA genérico (MCP) | `ai-agent` + `mcp-server` (tools) | RPC do frontend | ✅ operacional (modo sugerir; ver §17) |

Estados:
- **✅ operacional** = roda em produção e cumpre o caso de uso.
- **parcial** = código existe mas alguma feature do escopo ainda falta.
- **stub** = esqueleto vazio, ainda não cumpre o caso de uso.

---

## 1. Geração de Rotinas Cadenciadas

**Substitui:** workflow n8n "fullbpo_rotinas_diarias" (legacy).

- **Disparo:** `pg_cron` job `fullbpo-rotinas-diarias` (`0 8 * * 1-5`).
- **Function:** `rotinas-worker` chamada com `{"action":"generate"}`.
- **Comportamento esperado:**
  1. Busca empresas ativas (`companies.status='ativo'`).
  2. Para cada empresa, verifica se já existe rotina do dia (`rotinas.tipo='diaria'`, `data_rotina=CURRENT_DATE`).
  3. Cria rotina com `itens` (JSONB array, ver lista canônica abaixo).
  4. Cria `notificacoes` para o responsável.
- **Itens diária (seg-sex):** importar extrato OFX, verificar títulos vencidos, registrar comprovantes, conciliar, posição de caixa, programação de pagamentos.
- **Itens semanal (seg):** projeção fluxo de caixa, reunião com cliente, análise inadimplência, revisão pendentes.
- **Itens mensal (último dia útil):** conciliação completa, DRE, posição de saldos, devolutiva, envio à contabilidade.
- **Estado atual:** stub. Implementar na Fase 6.

Outras ações do mesmo worker (já registradas no cron):
- `{"action":"check_sla"}` — a cada 15 min em horário comercial — verifica SLA de rotinas.
- `{"action":"check_overdue"}` — 16:00 seg-sex — marca rotinas atrasadas + notifica.

---

## 2. Régua de Cobrança

**Substitui:** workflow n8n "fullbpo_regua_cobranca" (legacy).

- **Disparo:** `pg_cron` job `fullbpo-regua-cobranca` (`30 8 * * *`).
- **Function:** `cobranca-worker`.
- **Comportamento esperado:**
  - D-3 antes do vencimento → mensagem amistosa via WhatsApp (template).
  - D+1 → cobrança gentil.
  - D+5 → cobrança formal.
  - D+15 → cria tarefa interna `tipo='cobranca_juridica'`.
- **Templates:** `chat_message_templates` (após unificação na Fase 2 — hoje `templates_mensagem` ainda existe).
- **Saída de mensagem:** chamar `chat-send-message` (mesma function usada pelo operador).
- **Estado atual:** stub. Implementar na Fase 6.

---

## 3. Snapshot de Acuracidade + Posição de Caixa

- **Disparo:**
  - `fullbpo-acuracidade` (`0 23 * * *`) → `financial-checks {"action":"acuracidade_snapshot"}`.
  - `fullbpo-posicao-caixa` (`15 23 * * *`) → `financial-checks {"action":"cash_position_snapshot"}`.
- **Comportamento esperado:**
  - Acuracidade: calcula `pct_contas_conciliadas`, `pct_previsao_vs_orcado`, `pct_bancos_sem_pendencia` e grava em `acuracidade_snapshots` (1 linha/empresa/dia).
  - Posição de caixa: snapshot diário do saldo das contas + obrigações próximas.
- **Estado atual:** function existe, lógica precisa de validação. Parcial.

---

## 4. Alertas Operacionais (caixa, fechamento, resumo)

- **Disparo:**
  - `fullbpo-cash-alert` (`0 9 * * 1-5`) → `financial-checks {"action":"cash_alert"}`.
  - `fullbpo-closing-reminder` (`0 8 5 * *`) → `financial-checks {"action":"closing_reminder"}`.
  - `fullbpo-daily-summary` (`30 7 * * 1-5`) → `financial-checks {"action":"daily_summary"}`.
- **Comportamento esperado:**
  - Alerta caixa: se `saldo_atual + previsão 30d < 0`, abre `notificacoes` urgente + tarefa.
  - Reminder fechamento: dia 5 do mês, cobra que o fechamento do mês anterior foi finalizado.
  - Resumo diário: KPIs do dia anterior para o operador.

---

## 5. Entrada de WhatsApp → Triagem IA → Ticket

```
Cliente envia msg (texto / áudio / doc) no WhatsApp
              │
              ▼
   Evolution API (provedor)
              │ webhook
              ▼
┌───────────────────────────────────┐
│ evolution-webhook                 │
│  - valida secret Evolution        │
│  - normaliza payload              │
│  - resolve company_id             │
│      grupo → chat_grupo_empresa   │
│      phone → empresa_chat_contatos│
│  - upsert contact                 │
│  - insert chat_messages           │
│  - se mídia: baixa + storage      │
│      + insert docs_inbox          │
│  - fire-and-forget:               │
│      transcribe-audio (se áudio)  │
│      classify-document (se doc)   │
│      chat-ai-triage (sempre)      │
└───────────────────────────────────┘
              │
   ┌──────────┼──────────────────────┐
   ▼          ▼                      ▼
transcribe   classify              chat-ai-
-audio       -document              triage
(Whisper +   (OpenRouter            (LLM intent
 Gemini      vision + OCR           + urgência
 fallback)   Mistral)                + ação
   │           │                      sugerida)
   │           │                      │
   │           └─ atualiza             │
   │              docs_inbox           │
   │              + confirma           │
   │              recebimento WA       │
   │              (se score ok)        │
   │                                   │
   └─ atualiza chat_messages.conteudo  │
      (transcrição) + redispara triage │
                                       │
                       ┌───────────────┴────────────┐
                       ▼                            ▼
              chat_messages              chat_ticket_agent_pending
              (ia_classificacao,         (fila para worker debounce)
               ia_acao, urgencia)
                       │
                       │ urgência > 80 → dispatch imediato
                       ▼
              chat-ticket-agent-worker  ← pg_cron ~30s
                       │
                       ▼
              chat-ticket-agent (LLM)
                       │
                       ▼
              chat_tickets + chat_ticket_events
```

**Bugs conhecidos sendo corrigidos na Fase 1:**
- `evolution-webhook` não preenche `docs_inbox.evolution_message_id`, e `classify-document` precisa dele para enviar a confirmação ao WhatsApp ("✅ Recebemos seu boleto, vencimento X").

---

## 6. Envio de Mensagem (Operador → Cliente)

- **Function:** `chat-send-message`.
- **Disparo:** RPC `supabase.functions.invoke('chat-send-message', { contact_id, text, ... })` do frontend.
- **Comportamento:**
  - Resolve token Evolution via `platform_settings`.
  - Chama Evolution API `sendText`.
  - Loga em `integration_logs`.
- **Pendente (Fase 1):** rate-limit por `contact_id` (tabela `chat_send_rate_limit` + RPC `try_acquire_send_slot`).

---

## 7. Ticket Agent

- **Worker (pg_cron):** `chat-ticket-agent-worker` lê `chat_ticket_agent_pending`, aplica debounce 90s (imediato para urgentes), cancela se operador já respondeu.
- **Agente (chamado pelo worker):** `chat-ticket-agent` decide via LLM uma de quatro ações:
  1. abrir ticket novo,
  2. reabrir ticket recente (mesmo intent),
  3. manter ticket atual,
  4. sugerir fechamento.
- **Persistência:** `chat_tickets` + `chat_ticket_events` (timeline).
- **Contexto enviado ao LLM:** `chat_contacts.memoria_resumida` (vinda do compactador) + histórico recente + operações abertas (CPA/CRE/tarefas).
- **Decisão arquitetural pendente:** consolidar `agent` + `worker` numa única function com transação atômica (Fase 2).

---

## 8. SLA / Escalação de Conversas

- **Function:** `chat-sla-escalation`.
- **Disparo:** `pg_cron` (15 min em horário comercial).
- **Regra atual:**
  - Acha contatos cuja **última mensagem do cliente** tem mais de 4 h sem resposta do operador.
  - Marca `chat_contacts.escalonado_em`.
  - Notifica supervisor via `notificacoes`.
  - Eleva `prioridade='urgente'` se > 24 h.
- **Pendente:** SLA configurável por empresa/plano + componente UI regressivo (Fase 5).

---

## 9. Compactação de Threads (memoria_resumida)

- **Function:** `chat-thread-compact`.
- **Disparo:** `pg_cron` 2–6 h.
- **Regra:** se `chat_contacts` tem > 50 mensagens, gera resumo via LLM e grava em `chat_contacts.memoria_resumida`. `chat-ai-triage` e `chat-ticket-agent` consomem esse campo para reduzir tokens.
- **Pendente:** envelhecimento (TTL) do `memoria_resumida` — hoje fica eternamente.

---

## 10. Resumo Sob Demanda da Thread

- **Function:** `chat-thread-summary`.
- **Disparo:** botão "Resumir" na UI quando operador vai assumir uma thread.
- **Saída (sem persistência):** tópicos, última solicitação do cliente, pendências do operador, tom/sentimento.

---

## 11. Análise de Sentimento

- **Disparo:**
  - `fullbpo-sentimento-diario` (`30 23 * * *`) → `sentimento-worker {"action":"daily"}`.
  - `fullbpo-sentimento-semanal` (`5 0 * * 1`) → `sentimento-worker {"action":"weekly"}`.
- **Comportamento esperado:**
  - **Diário:** para cada contato com `feedback=true`, lê mensagens do dia, manda para LLM, grava em `chat_sentimento_diario` (classificacao, score, analise, pontos_atencao, total_mensagens). Se score < -0.3 → notifica supervisor.
  - **Semanal:** agrega 7 dias por contato em `chat_sentimento_semanal` (score_medio, tendencia, total_analises).
- **Bug em correção (Fase 1):** o worker usa `contato_id`; o schema usa `contact_id`. Schema também não tinha as colunas `analise`, `pontos_atencao`, `total_mensagens`, `tendencia`, `total_analises`. Sendo corrigido por:
  1. Migration `ALTER TABLE` adicionando colunas + tornando `feedback` nullable.
  2. Refator do worker para usar `contact_id` e mandar payload completo.

---

## 12. Títulos Recorrentes / Auto-aprovação / Indexadores

- **Disparo:**
  - `fullbpo-titulos-recorrentes` (`0 7 * * *`) → `titulos-worker {"action":"generate_recurring"}`.
  - `fullbpo-auto-aprovacao` (`0 */6 * * *`) → `{"action":"auto_approve"}` — aprova títulos pendentes há > 48h.
  - `fullbpo-check-indexadores` (`0 1 1 * *`) → `{"action":"check_indexers"}` — atualiza contratos com indexador (IGPM, IPCA, CDI).
- **Estado:** stub. Fase 6.

---

## 13. Relatórios

- **Disparo:** `fullbpo-dre-mensal` (`0 6 28 * *`) → `reports-worker {"report_type":"dre"}`.
- **Estado:** stub. Fase 6.

---

## 14. Sincronização Omie

- **Function:** `omie-sync-job`.
- **Disparo:** `pg_cron` 08:00 diário (`20260515180000_omie_cron_incremental.sql`).
- **Comportamento:** sincroniza plano de contas, contas a pagar/receber via Omie API. Credenciais via `get_omie_credentials(p_company_id)` (Vault).
- **Auxiliar:** `omie-import-plano-contas` (manual, importação inicial).

---

## 15. Webhook Pluggy (Open Finance / Extrato)

- **Function:** `pluggy-sync-item`.
- **Disparo:** webhook do provedor Pluggy quando há novo extrato.
- **Comportamento:** insere/atualiza `transacoes`, dispara conciliação automática, opcional notifica via `notificacoes` e cria `chat_messages` se houver dúvida.
- **Suporte:** `pluggy-create-connect-token` (frontend obtém token), `pluggy-ping` (health check).

---

## 16. Agente IA Genérico (MCP)

- **Function:** `ai-agent` (loop) + `mcp-server` (registry de tools).
- **Disparo:** RPC do frontend (`/operations/agent`).
- **Modos disponíveis hoje:** `readonly` (apenas tools de leitura) e `full` (tools de leitura + tools `suggest_*`).
- **Tools `suggest_*`** retornam deeplink de UI; o operador clica para executar manualmente. Hoje **o agente NÃO executa nenhuma ação** diretamente.

---

## 17. Política do Agente (Fase 4 — em design)

> Decisão de produto (2026-05-23): o agente vai poder eventualmente auto-executar, mas isso **passa por uma policy por empresa**, configurada pelo admin/cliente.

- **Tabela `ia_agent_policies`** (a criar):
  - `company_id`, `escopo`, `tool_name`, `modo IN ('bloqueado','sugerir','auto_executar')`, `limite_valor`, `requer_confirmacao`.
- **Default:** toda tool nova nasce com `modo='sugerir'`. Apenas o admin FullBPO promove para `auto_executar`, com `limite_valor` quando aplicável.
- **Tabela `ia_agent_execucoes`** registra cada execução para auditoria.
- **UI:** `/admin/clients/:id/ia-agent` com matriz `tool × modo`.

---

## Como rodar / observar

```sql
-- Listar todos os crons ativos
SELECT * FROM public.list_cron_jobs();

-- Pausar/retomar um cron
SELECT public.toggle_cron_job('fullbpo-sentimento-diario', false);
SELECT public.toggle_cron_job('fullbpo-sentimento-diario', true);

-- Reagendar
SELECT public.reschedule_cron_job('fullbpo-sentimento-diario', '0 23 * * *');

-- Disparar manual
SELECT public.call_edge_function('sentimento-worker', '{"action":"daily"}'::jsonb);

-- Logs de execução
SELECT * FROM cron_execution_log
WHERE function_name = 'sentimento-worker'
ORDER BY started_at DESC LIMIT 20;
```

**Observabilidade:** `system_logs` (migration `20260513120000`), `cron_execution_log` (`20260513130000`), `alerting` (`20260513140000`) e `ia_usage_log` (consumo dos providers de LLM).

---

## Decisões fundadoras (não negociáveis)

1. **Sem n8n.** Toda nova automação é Edge Function + pg_cron.
2. **Edge Function não usa anon key para escrever** — sempre `SUPABASE_SERVICE_ROLE_KEY`, mas com filtro explícito por `company_id`.
3. **Toda execução é idempotente** (chave única ou `IF NOT EXISTS` na escrita).
4. **Toda execução loga em `cron_execution_log`** (sucesso/falha/tempo).
5. **Toda interação LLM loga em `ia_usage_log`** (provider, model, tokens, custo estimado).
6. **Agente IA não auto-executa sem `ia_agent_policies` autorizando** (Fase 4 em diante).