# Marketing OS — Segurança, Permissões e LGPD

## 1. Segredos e tokens
- Tokens de integração **criptografados em repouso** (AES-256-GCM). Chave mestra em variável de ambiente / secret manager do `pc-llm`, **nunca** no banco em claro, **nunca** no git.
- `.env` **jamais** commitado — só `.env.example`. Ver `../.env.example`.
- **Nenhum token no frontend.** O browser fala só com nosso backend; o backend fala com terceiros.
- Refresh tokens (Google/Meta) renovados por job antes de expirar. Falha → `integration_health=degraded` + alerta.

## 2. Autenticação e autorização (RBAC)
- Login individual (Auth.js, sessão + `password_hash` argon2). MFA opcional p/ Admin.
- **Perfis:** Admin Master · Diretor · Gestor de Marketing · Analista · Social Media · Tráfego Pago · Copywriter · Atendimento/SDR · Comercial · Financeiro · Consulta Limitada · IA/Serviço.
- **Permissões por ação** (não só por módulo). Guards no NestJS + checagem nas MCP tools.

```
dashboard.ver · leads.ver · leads.editar · campanhas.ver · campanhas.editar
instagram.ver · tarefas.ver · tarefas.editar · gmail.ver · gmail.responder
whatsapp.enviar · whatsapp.configurar · drive.ver · drive.editar
obsidian.ver · obsidian.editar · relatorios.ver · relatorios.gerar · relatorios.enviar
automacoes.ver · automacoes.executar · mcp.ver · mcp.executar
admin.usuarios · admin.permissoes · auditoria.ver
```
- **API keys de serviço** (clientes MCP) têm `scopes[]` — nunca herdam permissão de admin.

## 3. Ações sensíveis → confirmação humana obrigatória
enviar e-mail · enviar WhatsApp · alterar campanha · excluir dados · atualizar nota Obsidian · criar/alterar tarefa crítica · reprocessar automação · enviar relatório p/ cliente · exportar dado pessoal · acessar e-mail sensível.
→ Fluxo: ação gera **draft + approval_token** → humano confirma na UI ou responde no WhatsApp → executa → `audit_logs`.

## 4. Autenticação de comandos por WhatsApp
- Só números **pré-autorizados** (mapa número→usuário em `users.phone`).
- Todo comando → `whatsapp_commands` (autorizado?, args, resposta).
- Comandos read-only executam; comandos sensíveis pedem confirmação explícita ("responda SIM para enviar").
- Rate-limit por número. Comando desconhecido → não faz nada (não vaza dado).

## 5. Auditoria
- `audit_logs` registra **quem** (user/ai/system), **o quê**, **antes/depois**, IP, quando.
- Toda ação de IA também em `ai_runs`/`ai_tool_calls`.
- Tela "Auditoria" filtrável; export só com `auditoria.ver`.

## 6. LGPD — decisões desde o dia 1
1. **Minimização** — coletar só o necessário. Pixel anônimo não guarda PII.
2. **Consentimento** — pixel respeita banner de consentimento; sem consentimento → só evento agregado/anônimo.
3. **Base legal** — `form_submit` com PII exige base legal declarada (política de privacidade na página de vendas).
4. **Separação** — dados pessoais (`leads`) separados de métricas agregadas (`*_metrics`). Métricas não precisam de PII.
5. **Mascaramento** — PII mascarada em logs e em telas de consulta limitada.
6. **Retenção** — `pixel_events` anônimos ~180d; `raw` de webhook 30–90d; configurável.
7. **Direito do titular** — função `anonymize_lead(lead_id)`: apaga/anonimiza PII mantendo métricas agregadas.
8. **Criptografia** — tokens e segredos criptografados; TLS em todo tráfego.
9. **Backup** — dump Postgres agendado + retenção; storage de arquivos versionado.
10. **DPA/subprocessadores** — mapear quem processa dado (Google, Meta, WhatsApp provider, Anthropic) — nota em `docs/`.

## 7. Riscos (técnicos · jurídicos · operacionais)
| Risco | Tipo | Mitigação |
|---|---|---|
| Vazamento de token de integração | Técnico | Criptografia + rotação + escopo mínimo |
| Instagram/Meta App review negar acesso | Técnico/Operacional | Começar por dados próprios; ter fallback manual |
| Rate limit de APIs (Gmail/IG) | Técnico | Cache agressivo + backoff + sync incremental |
| PII coletada sem base legal | **Jurídico** | Consentimento + política + minimização (§6) |
| IA executar ação errada | Operacional | Classes de risco + aprovação humana + audit |
| Dependência de 1 fornecedor WhatsApp | Operacional | Interface `WhatsappProvider` |
| Custo de LLM/Apify escalar | Operacional | Log de tokens/uso + limites por org |
| Envio indevido de relatório a cliente | Jurídico/Operacional | write_sensitive + confirmação + prévia |
| Perda de dados | Técnico | Backup + raw preservado p/ replay |
