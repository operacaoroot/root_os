# Marketing OS — Modelo de Dados

> PostgreSQL 16 + pgvector. Toda tabela de domínio tem `org_id` (multi-tenant-ready), `created_at`, `updated_at`.
> Convenção: `snake_case`, PK `id uuid default gen_random_uuid()`, soft-delete via `deleted_at` onde fizer sentido.

---

## Mapa das tabelas por domínio

### Identidade, acesso e auditoria
```
users(id, org_id, name, email, phone, password_hash, is_active, last_login_at)
roles(id, org_id, key, name, description)                         -- Admin, Diretor, Gestor, Social, Tráfego...
permissions(id, key)                                              -- leads.editar, whatsapp.enviar, mcp.executar...
role_permissions(role_id, permission_id)
user_roles(user_id, role_id)
sessions(id, user_id, token_hash, ip, user_agent, expires_at)
api_keys(id, org_id, name, key_hash, scopes[], is_active)         -- p/ serviços e clientes MCP
audit_logs(id, org_id, actor_type[user|ai|system], actor_id,
           action, entity_type, entity_id, before jsonb, after jsonb,
           ip, metadata jsonb, created_at)
```

### Integrações (o núcleo do Hub)
```
integrations(id, key, name, category)                             -- catálogo: clickup, gmail, instagram...
integration_accounts(id, org_id, integration_id, label, status,  -- uma conta conectada
                     external_account_id, config jsonb, connected_by, connected_at)
integration_tokens(id, integration_account_id, access_token_enc,  -- SEMPRE criptografado
                   refresh_token_enc, scopes[], expires_at)
integration_health(id, integration_account_id, status[ok|degraded|down],
                   last_sync_at, next_sync_at, last_error, latency_ms, checked_at)
sync_jobs(id, integration_account_id, kind, status, started_at,
          finished_at, records_in, records_out, error)
webhook_events(id, org_id, source, event_type, payload jsonb,     -- raw p/ auditoria/replay
               signature_ok, dedup_key, processed_at, status)
```

### Leads e origem
```
lead_sources(id, org_id, key, name, channel)                      -- instagram, gmail, sales_page, indicação...
leads(id, org_id, name, email, phone, source_id, campaign_id,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      landing_page, first_event_id, status, owner_id, next_action,
      score, entered_at, anonymous_id)                            -- anonymous_id = stitch com o pixel
lead_events(id, org_id, lead_id, type, payload jsonb, occurred_at)-- interações, mudanças de status
lead_scores(id, lead_id, score, model, factors jsonb, computed_at)
```

### Página de vendas, pixel e conversões
```
sales_pages(id, org_id, name, url, product, is_active)
visitor_sessions(id, org_id, anonymous_id, user_id, sales_page_id,
                 utm_* , device, browser, geo_country, geo_city,
                 referrer, started_at, last_seen_at)
pixel_events(id, org_id, session_id, anonymous_id, event_name,     -- page_view, click_cta, form_submit,
             event_id UNIQUE, url, value, product, campaign_id,    --   checkout_start, purchase...
             metadata jsonb, occurred_at)                          -- event_id => idempotência/dedup
conversions(id, org_id, lead_id, session_id, type, value,
            campaign_id, occurred_at)
```

### Campanhas
```
campaigns(id, org_id, name, objective, channel, budget, spend,
          period_start, period_end, owner_id, status, landing_page_id)
campaign_metrics(id, campaign_id, date, impressions, clicks, leads,
                 conversions, sales, revenue, cost, cpl, cpa, roas)  -- 1 linha/dia (série temporal)
campaign_events(id, campaign_id, type, payload jsonb, occurred_at)   -- decisões, mudanças de status
campaign_assets(id, campaign_id, kind, url, drive_file_id, note)     -- criativos
```

### Tarefas (ClickUp + Asana unificados)
```
task_sources(id, org_id, tool[clickup|asana], external_project_id, name)
tasks(id, org_id, source_id, external_id, title, description, status,
      priority, assignee, due_date, tags[], external_url,
      created_ext_at, updated_ext_at, synced_at)
task_links(id, task_id, entity_type[lead|campaign|content|client], entity_id)
```

### Conteúdo e Instagram
```
content_items(id, org_id, title, format, theme, channel, status,
              owner_id, publish_at, link, briefing, caption,
              drive_file_id, obsidian_note_id)
content_metrics(id, content_item_id, date, reach, impressions, likes,
                comments, saves, shares, clicks, leads_attributed)
instagram_accounts(id, org_id, integration_account_id, username, followers)
instagram_posts(id, org_id, ig_account_id, ig_media_id, type[post|reel|story|carousel],
                caption, permalink, published_at, content_item_id)
instagram_metrics(id, instagram_post_id, date, reach, impressions,
                  engagement, likes, comments, saves, shares, profile_visits, link_clicks)
```

### Comunicação (Gmail + WhatsApp)
```
email_threads(id, org_id, integration_account_id, external_thread_id, subject, last_message_at)
emails(id, org_id, thread_id, external_id, sender, to[], subject, snippet,
       labels[], has_attachments, is_read, received_at)
email_classifications(id, email_id, category[lead|proposta|cobrança|cliente|urgente|outro],
                      urgency, entity_type, entity_id, model, confidence, created_at)
whatsapp_messages(id, org_id, direction[in|out], provider, from_number, to_number,
                  body, template, status, related_type, related_id, sent_at)
whatsapp_alerts(id, org_id, alert_id, sent_message_id, sent_at)
whatsapp_commands(id, org_id, from_number, user_id, command, args jsonb,
                  authorized, response_summary, created_at)
```

### Conhecimento (Drive + Obsidian + índice vetorial)
```
drive_files(id, org_id, integration_account_id, external_id, name, mime_type,
            folder, web_link, owner, modified_at, entity_type, entity_id)
obsidian_notes(id, org_id, path, title, tags[], frontmatter jsonb,
               links[], summary, updated_at)
knowledge_index(id, org_id, source[drive|obsidian|report|memory], source_id,
                chunk_text, embedding vector(1536), metadata jsonb)  -- pgvector
```

### Relatórios
```
reports(id, org_id, kind[daily|weekly|campaign|content|instagram|executive],
        title, config jsonb, created_by)
report_runs(id, report_id, status, format[html|pdf|md], period_start, period_end,
            output_url, drive_file_id, generated_at, generated_by[user|ai|cron])
report_recipients(id, report_id, channel[whatsapp|email|drive], destination, active)
```

### IA
```
ai_runs(id, org_id, prompt_key, prompt_version, model, input jsonb,
        output jsonb, tokens_in, tokens_out, latency_ms, user_id, created_at)
ai_tool_calls(id, ai_run_id, tool_name, input jsonb, output jsonb,
              permission_class, approved_by, status, error)
ai_recommendations(id, org_id, kind[action|opportunity|risk|content|campaign|funnel],
                   title, body, sources jsonb, severity, status, created_at)
ai_memory(id, org_id, kind[decision|learning|hypothesis|persona|offer|copy|winner|loser],
          title, body, embedding vector(1536), tags[], created_by, created_at)
```

### Alertas
```
alert_rules(id, org_id, key, module, condition jsonb, severity, channel[], is_active)
alerts(id, org_id, rule_id, title, module, severity[info|attention|high|critical],
       description, data jsonb, suggested_owner, suggested_action,
       status[open|ack|resolved], created_at, resolved_at)
```

---

## Relacionamentos-chave (drill-down clicável)

- **Card "Leads de hoje"** → `SELECT * FROM leads WHERE entered_at::date = today AND org_id = ?`
- **Lead → ficha completa** → `leads` + `lead_events` + `pixel_events`(por `anonymous_id`) + `emails`(por match) + `tasks`(via `task_links`) + `campaigns` + `lead_scores` + `ai_recommendations`.
- **Campanha → dossiê** → `campaigns` + `campaign_metrics`(série) + `leads`(FK) + `conversions` + `campaign_assets` + `tasks`(links) + `content_items` + `drive_files` + `alerts`.
- **Card "Automações com falha"** → `sync_jobs WHERE status='error'` + `webhook_events WHERE status='failed'`.

## Índices críticos (performance do drill-down)
```sql
CREATE INDEX ON leads (org_id, entered_at);
CREATE INDEX ON leads (org_id, campaign_id);
CREATE INDEX ON leads (anonymous_id);
CREATE UNIQUE INDEX ON pixel_events (event_id);
CREATE INDEX ON pixel_events (org_id, occurred_at);
CREATE INDEX ON pixel_events (session_id);
CREATE INDEX ON campaign_metrics (campaign_id, date);
CREATE INDEX ON tasks (org_id, status, due_date);
CREATE INDEX ON audit_logs (org_id, created_at);
CREATE INDEX ON knowledge_index USING ivfflat (embedding vector_cosine_ops);
```

## Retenção / LGPD (ver `SECURITY.md`)
- `pixel_events` de visitantes anônimos: retenção configurável (ex.: 180 dias) → agregado depois.
- Dados pessoais de lead: anonimizáveis por `lead_id` (função `anonymize_lead`).
- `raw` de webhooks: retenção curta (30–90 dias) após processado.
