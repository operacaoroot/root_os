# Marketing OS — Integrações (Conectores)

> Cada conector é um **plugin isolado** que implementa a interface `Connector`. Um conector fora do ar degrada só o card dele.
>
> ⚠️ **Isolamento (ver `ISOLATION.md`):** toda integração usa **conta/app/credenciais próprios do Marketing OS**. Nunca reutilizar contas, tokens ou canais do escritório C&S, nem o MCP `cardozo-saggioro`.

## Contrato de todo conector (`packages/connectors/<tool>`)

```ts
interface Connector {
  key: string;                       // "clickup"
  category: 'tasks'|'automation'|'social'|'email'|'storage'|'knowledge'|'ads'|'messaging';
  auth: AuthStrategy;                // oauth2 | api_key | webhook_secret | none
  testConnection(acc): Promise<HealthStatus>;
  sync(acc, cursor?): Promise<SyncResult>;   // pull incremental
  handleWebhook?(payload, sig): Promise<void>;
  actions: ActionSpec[];             // o que este conector PODE executar (write)
  rateLimit: { rpm: number; burst: number };
}
```
Todo conector tem, obrigatoriamente: **auth própria · logs · health · rate-limit · tratamento de erro**.

---

## Matriz de integrações

| Ferramenta | Categoria | Auth | Direção | Dados que **fornece** (leitura) | Ações que **executa** (escrita) | Sensível? | Fase |
|---|---|---|---|---|---|---|---|
| **Pixel/Página de vendas** | ads | webhook secret / público | ingest | page_view, scroll_*, click_cta, form_*, checkout, purchase, UTMs, sessão, device | — | Baixo (anônimo)/Alto (form) | **1** |
| **ClickUp** | tasks | OAuth2 / API token | 2 vias | tarefas, listas, status, responsáveis, prazos, comentários | criar/atualizar tarefa, comentar | Médio | **2** |
| **Asana** | tasks | OAuth2 / PAT | 2 vias | tarefas, projetos, assignees, due dates | criar/atualizar tarefa | Médio | **2** |
| **WhatsApp** (Evolution; Meta Cloud API como alternativa) | messaging | API key + webhook | 2 vias | mensagens recebidas, status de entrega | **enviar msg/alerta/relatório** (sensível) | **Alto** | **2** |
| **Zapier** | automation | webhook in/out + REST | 2 vias | execuções de zaps, payloads, falhas | disparar zap (write_safe) | Médio | **3** |
| **Apify** | automation | API token | pull | actors, runs, datasets, logs, custo | rodar actor (write_safe) | Médio | **3** |
| **Instagram** (Graph API) | social | OAuth2 (Meta) | pull | seguidores, alcance, posts, reels, stories, engajamento, cliques | — (publicação fora do MVP) | Médio | **4** |
| **Gmail** | email | OAuth2 (Google) | 2 vias | remetente, assunto, snippet, labels, anexos, threads | **enviar/rascunhar** (sensível), marcar lido | **Alto** | **5** |
| **Google Drive** | storage | OAuth2 (Google) | 2 vias | arquivos, pastas, links, metadados, conteúdo (autorizado) | criar pasta, salvar relatório | Médio | **5** |
| **Obsidian** | knowledge | Git / pasta / Drive sync | 2 vias | notas markdown, tags, frontmatter, links internos | criar/atualizar nota (sensível) | Médio | **5** |
| **Claude / API** | ai | API key | — | — (é consumidor via `LLMProvider`) | gera análises/relatórios/recs | — | **transversal** |

---

## Notas por integração (o que dói na prática)

**Pixel / Página de vendas** — é *nosso* endpoint, não uma API de terceiro. Ver `ARCHITECTURE.md §5`. Cuidado LGPD: `form_submit` traz dado pessoal → base legal + consentimento. Eventos anônimos → minimização.

**ClickUp** — conta/token **próprios do Marketing OS** (workspace do `root`, não o do escritório). Webhooks p/ updates near-real-time; fallback em sync cron a cada 15 min.

**Asana** — similar a ClickUp. Unificar ambos no domínio `tasks` (campo `tool`). O painel mostra tarefa agnóstica de origem.

**WhatsApp** — **não amarrar em fornecedor** e **não usar o canal do escritório**. Interface `WhatsappProvider` (`send`, `sendTemplate`, `handleInbound`) com **conta/número próprios do Marketing OS**. Escolher provider (Meta Cloud API, Z-API, 360dialog, etc.) e criar credenciais dedicadas. Meta Cloud API exige templates aprovados p/ mensagens ativas fora da janela de 24h — planejar templates de relatório/alerta.

**Zapier** — dupla direção: recebemos webhooks de zaps E podemos disparar. Registrar cada execução em `webhook_events`/`sync_jobs` p/ o card "Automações com falha".

**Apify** — polling de `runs`/`datasets`. Bom p/ scraping de concorrentes/leads. Vigiar custo (campo de uso).

**Instagram Graph API** — exige conta Business + Facebook Page + App review da Meta. Métricas com *delay* (não é tempo real). DMs: fora do MVP (restrição + risco). Rate limits agressivos → cache agressivo.

**Gmail** — OAuth2 com escopos mínimos (`gmail.readonly` primeiro; `gmail.send` só quando ativar resposta assistida). Classificação por IA → `email_classifications`. Envio **sempre** com aprovação humana.

**Google Drive** — escopo `drive.readonly` + `drive.file` (só arquivos que criamos). Não pedir `drive` full. Indexação de conteúdo só com autorização explícita → `knowledge_index`.

**Obsidian** — sem API oficial. Estratégia recomendada: **vault sincronizado por Git** (ou pasta no Drive) que um job lê. Parsing de markdown + frontmatter + wikilinks → `obsidian_notes` + embeddings. Escrita de nota = ação sensível.

---

## Saúde e operação (tela de Observabilidade)
Cada `integration_account` mostra: status · credenciais ok? · última/próxima sync · erros recentes · botão **testar conexão** · botão **sincronizar agora** · logs. Fonte: `integration_health` + `sync_jobs`.
