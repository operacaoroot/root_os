# Marketing OS — Pauta (Acervo, Radar, Rodadas e Peças)

> Módulo que traz para dentro do OS a produção de conteúdo que hoje roda solta: a rotina de
> notícias de IA 3x/semana (criada no app do Claude) vira **gatilho**, e do mesmo gatilho saem
> as peças de cada canal — grupo do WhatsApp, Instagram, newsletter, tema no ClickUp.
>
> ⚠️ **Isolamento (`ISOLATION.md`):** conta/app/credenciais **próprias do `root`**. A instância
> do Evolution e o número de WhatsApp são **dedicados** — nunca o canal do escritório.

---

## 1. O problema

Hoje a rotina roda fora do OS: o gatilho mora no app do Claude, o resultado mora numa conversa,
e a distribuição é copiar-e-colar. Três consequências:

- **Não acumula.** Cada rodada começa do zero; o que funcionou na semana passada não realimenta.
- **Não mede.** O link vai cru no grupo; o clique não volta como número em lugar nenhum.
- **Não deriva.** Vira uma newsletter e para aí — o mesmo insumo daria carrossel, Reels e pauta.

A captura de referência tem o mesmo sintoma na outra ponta: prints acumulam em
`Obsidian/Referências de Conteúdo/` sem virar nada.

## 2. O conceito: são dois acervos, não um

O erro seria uma tabela `fontes` genérica. O que existe são duas naturezas de insumo com tempo
de vida oposto, e a geração precisa das **duas na mesma chamada**:

| | **Insumo (pauta)** | **Referência (repertório)** |
|---|---|---|
| O que é | notícia de IA da semana | roteiro/carrossel que funcionou |
| Validade | ~72h | anos |
| Responde | *sobre o que* falar agora | ***como*** falar pra funcionar |
| Volume | dezenas por rodada | centenas, cresce devagar |
| Estado hoje | não existe no OS | **existe e é maduro** — ver §3 |

Sem insumo a rodada não tem assunto. Sem repertório ela escreve genérico. A rotina atual só
tem o primeiro — por isso entrega notícia, e não conteúdo da ROOT.

## 3. O que já existe (não recriar)

**No vault `Cerebro-Conteudo` (Drive/Obsidian):**

- `9 - Engenharia Reversa das Referências` — **427 roteiros classificados** em
  `_DADOS-classificacao-roteiros.csv` e **432 fichas** em `fichas/*.md`, com schema fixo de
  14 campos e a taxonomia `família × objetivo` em cada uma (a ficha basta: traz classificação
  e conteúdo, então o importador não precisa do CSV). `_ESTRUTURAS-CAMPEAS.md` decide **quais 4
  das 8 famílias entram no método** — CUR Curiosidade/Revelação · REA React/Análise ·
  STO Storytelling · DEM Demonstração, 83,3% do que é ensinado nos bunkers maduros.
- `8 - Referência de Conteúdo` — perfis estudados + `dataset_instagram-scraper_*.json`
  (150 posts do Apify: caption, likesCount, commentsCount, hashtags, ownerUsername, url, timestamp).
- `README.md` do vault — método neutro, ordem de leitura para uma IA produzir peça.

**No OS:**

| Peça | Onde | Reaproveita como |
|---|---|---|
| `Report` (texto + `data` + provider + model) | `reports.service.ts` | molde da `PautaRodada` |
| `LlmProvider` (abstração trocável) | `llm/llm.provider.ts` | geração |
| `ApprovalGuard` + `ResourceType: 'content'` | `approvals/` | trava do envio ao WhatsApp |
| Obsidian + pgvector + embeddings | `obsidian/` | busca semântica do acervo |
| `BioLink` + `/r/:id` → `BioEvent`/`PixelEvent`/`GoalWeek` | `bio/` | medição de clique |
| Write-back no ClickUp | `content.service.ts` | pauta vira tarefa |

**Já declarado no `.env.example`, nunca lido pelo código:** `APIFY_TOKEN` (linha 111),
`LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`. As permissões
`whatsapp.enviar`, `whatsapp.configurar`, `automacoes.ver` e `automacoes.executar` também já
existem em `@mktos/shared` sem implementação.

## 4. Arquitetura

```
  Captura manual ─┐
                  ├─→ PautaCaptura ─→ (Apify / fetch / visão) ─→ PautaReferencia ─┐
  Radar (feeds) ──┘                                                (ficha 14 campos)│
                                                                                    │
  PautaRotina (cron 3x/sem) ─→ PautaRodada ──────────────────────────────────────┘
                                    │        insumo fresco + repertório
                                    ↓
                              PautaPeca (1 por canal)
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ↓                           ↓                           ↓
   WhatsApp (Evolution)      Instagram (manual)           ClickUp (tema)
   auto, com aprovação    máquina de carrossel + legenda    write-back
```

O gatilho é `@nestjs/schedule` **dentro da API** — o container `mktos_api` já roda 24/7 na VPS.
Nada de infra nova, e a `PautaRotina` guarda cron/tz/ativo editáveis pelo painel.

## 5. Modelo de dados

Prefixo `Pauta*` (mesma convenção do módulo `Bio*`). Migration: `add_pauta`.

> **Correção feita na implementação:** o acervo tem **8 famílias e 7 objetivos**, não 4×3.
> As 4 famílias campeãs (CUR/REA/STO/DEM) são as que o estudo elegeu para o método, mas
> CON (contraste), INT (interação), TRE (trend/meme) e ENC (encenação) existem nas fichas —
> e os objetivos VEN (venda), ENG (engajamento), PRO (prova social) e LEA (leads) cobrem
> 117 fichas. Enum reduzido perderia ~1/3 do acervo na importação.
> Os rótulos de CON/INT/TRE/ENC e VEN/ENG/PRO/LEA foram **inferidos dos títulos** das fichas
> (não há legenda escrita no vault); corrigir é trocar uma linha em
> `PAUTA_FAMILIA_LABEL` / `PAUTA_OBJETIVO_LABEL` em `packages/shared/src/schemas.ts`.

```prisma
enum PautaFonteTipo     { rss  perfil  busca  manual }
enum PautaCapturaStatus { rascunho  processando  ficha  descartada  erro }
enum PautaFamilia       { CUR  REA  STO  DEM  CON  INT  TRE  ENC  outra }
enum PautaObjetivo      { ALC  AUT  VIN  VEN  ENG  PRO  LEA }
enum PautaRodadaStatus  { coletando  curada  aprovada  publicada  falhou }
enum PautaCanal         { whatsapp  instagram  newsletter  clickup }
enum PautaPecaStatus    { rascunho  aprovada  publicada  descartada }

model PautaFonte {          // o Radar: feed, perfil vigiado ou busca salva
  id, orgId, tipo, nome, url, handle?, ativo, intervaloMin, ultimaLeitura?, ultimoErro?
}

model PautaCaptura {        // caixa de entrada — cru, antes de virar ficha
  id, orgId, fonteId?, tipo (link|print|texto), url?, urlHash @unique,
  titulo?, bruto Json,      // payload do Apify / HTML extraído / OCR
  imagens String[],         // objetos no MinIO
  status, erro?, capturadoEm, capturadoPor
}

model PautaReferencia {     // a ficha — schema do Cerebro-Conteudo, 14 campos
  id, orgId, capturaId?, titulo, plataforma, autor?, url?, publicadoEm?,
  familia, objetivo,
  materiaPrima, tensaoCentral, emocaoAlvo, motorPsicologico, formulaHeadline,
  estruturaCorpo, prova, cta?, preRequisitos?, antiPadroes?, teoriaImplicita?,
  metricas Json?,           // likes/comments/views do Apify
  campea Boolean,           // entra no prompt de geração
  vaultPath String?,        // espelho .md (§8)
  embedding vector(1536)
}

model PautaRotina  { id, orgId, slug @unique, nome, cron, tz, ativo, config Json,
                     ultimoRun?, ultimoStatus?, proximoRun? }

model PautaRodada  { id, orgId, rotinaId, status, janelaIni, janelaFim,
                     itens Json,           // o que a IA selecionou, com fonte e URL
                     corpo String,         // o miolo curado
                     provider, model, custoUsd?, criadaEm }

model PautaPeca    { id, orgId, rodadaId, canal, formato, titulo, corpo,
                     meta Json,            // slides do carrossel, JID do grupo, etc.
                     status, bioLinkId?, externalId?, publicadaEm?, publicadaPor? }
```

**Por que a ficha é coluna nomeada e não `Json`:** os 14 campos são o schema estável do método
(três anos de acervo o validaram) e precisam ser filtráveis. `metricas` fica `Json` porque o
formato muda por plataforma.

## 6. Página `/referencias`

Quatro abas, uma responsabilidade cada:

1. **Captura** — cola link (IG/TikTok/X/artigo), sobe print, ou marca perfil pra monitorar.
   Grava `PautaCaptura` como `rascunho` sem processar nada. Barato e instantâneo — é o que
   resolve os prints soltos no Drive.
2. **Fila** — processa: link do Instagram → Apify `instagram-scraper` (o actor que já foi usado);
   artigo → fetch + extração; print → leitura por visão. A IA preenche a ficha e classifica
   `família × objetivo`; **você aprova ou corrige**. A curadoria continua sua, o braçal sai.
3. **Acervo** — busca semântica (pgvector, mesmo motor do módulo Obsidian) + filtros por família,
   objetivo, plataforma, autor, período, performance. Marca `campeã` no que entra na geração.
4. **Radar** — as fontes automáticas: feeds de IA, perfis vigiados, buscas salvas. Origem do
   insumo das rodadas.

## 7. Rodadas, peças e canais

A rodada roda 3x/semana, coleta a janela de 72h, e **numa chamada** monta o prompt com insumo
fresco + as fichas campeãs do acervo. O derivador de carrossel não recebe "escreva sobre X" —
recebe família, objetivo, fórmula de headline, estrutura de corpo, prova obrigatória e
anti-padrões, tirados do que o próprio estudo já provou.

| Canal | Como sai | Trava |
|---|---|---|
| **WhatsApp (grupo)** | Evolution API, instância e número **dedicados do root** | `@SensitiveWrite('content')` — não sai sem token de aprovação confirmado |
| **Instagram** | legenda + espinha do carrossel → máquina de carrossel (marca `root`) | **manual**: publicação via Graph API exige `content_publish` + App Review, e o app da Meta está em troca |
| **Newsletter** | corpo em markdown, link sempre como `BioLink` | — |
| **ClickUp** | vira tema em Gestão de Temas (write-back que já existe) | — |

**Todo link publicado nasce `BioLink`.** O clique no grupo volta como `BioEvent` + `PixelEvent`
e alimenta `GoalWeek.bioClicks` sozinho — a peça nasce medida, sem digitar nada em Metas.

## 8. Espelho `.md` no vault — três destinos, escolhidos na tela

Decisão: **Postgres é canônico, o vault recebe espelho** (escrita numa direção só, sem conflito).

O destino é configurável em `/referencias` → aba Radar, e fica guardado em
`IntegrationAccount.config` (key `pauta-espelho`) — trocar não exige redeploy. Os defaults vêm
do `.env` (`PAUTA_ESPELHO`, `PAUTA_ESPELHO_DIR`, `PAUTA_DRIVE_FOLDER_ID`).

| Destino | Como grava | Quando serve |
|---|---|---|
| `off` (default) | não espelha | só o painel importa |
| `local` | filesystem em `OBSIDIAN_VAULT_PATH/<dir>` | quando a vault está montada na máquina que roda a API |
| `drive` | Google Drive, pela conta OAuth do módulo `google` | **quando não está** — é o caso de hoje |

**Por que o Drive existe:** `OBSIDIAN_VAULT_HOST=/srv/marketing-os/vault` (a API lê a vault **na
VPS**), enquanto o vault real vive no Google Drive do Mac e a pasta `vault/` do repo está vazia.
O destino `drive` não depende de bind mount nenhum — grava direto na pasta pelo `files.create`
/`files.update` da API do Drive, com nome estável (atualiza no lugar em vez de duplicar).

O `estado()` do serviço diz na tela por que um destino está indisponível (vault inexistente,
Google não conectado, pasta não informada) em vez de falhar mudo. E o espelho nunca derruba a
ficha: se o destino falhar, a ficha continua gravada e o erro vai para o log — nesse caso o
`vaultPath` fica nulo e o botão **Sincronizar todas** recupera o atraso depois.

**Remover ficha não apaga o `.md`.** Apagar arquivo dentro da vault do usuário é irreversível e
o espelho é one-way; o órfão fica lá para ele decidir. O mesmo vale ao trocar de destino: os
arquivos do destino antigo não são recolhidos.

**Pendências reais do destino `drive`:** a autorização OAuth do Google ainda está **bloqueada**
(app em modo Teste, escopos sensíveis — ver `ROADMAP.md` Fase 5). Enquanto não resolver, o
destino aparece como indisponível com o motivo escrito na tela.

Nota: o bind mount está comentado como READ-ONLY no `docker-compose.yml` mas **não tem
`read_only: true`**. O destino `local` restringe a escrita à subpasta configurada (rejeita
caminho absoluto e `..`).

## 9. Permissões

Novas em `@mktos/shared`: `pauta.ver` · `pauta.editar` (capturar/editar ficha) ·
`pauta.publicar` (aprovar peça). Reutiliza `whatsapp.enviar` (já declarada) para o envio,
e `automacoes.executar` para rodar rotina fora de hora.

## 10. Ondas de entrega

**Onda 1 — Acervo. ✅ entregue (01/08/26)**
- Schema `PautaFonte` / `PautaCaptura` / `PautaReferencia` + migration `20260801020000_add_pauta`.
- API `/api/pauta/*`: captura (link/texto/print), processamento (Apify → IA → ficha),
  acervo com busca semântica (pgvector), fontes com teto de gasto, espelho `.md`.
- Web `/referencias` com as 4 abas; permissões `pauta.ver` / `pauta.editar` / `pauta.publicar`.
- Importador do acervo: `pnpm --filter @mktos/api import:pauta` (ver §12).
- *Sem cron e sem canais de propósito — o acervo vale sozinho.*

**Como rodar (nesta ordem):**
```bash
# 1. banco (precisa do Postgres de pé)
pnpm --filter @mktos/api db:deploy      # aplica a migration add_pauta
pnpm --filter @mktos/api db:seed        # registra as permissões pauta.* nos perfis

# 2. acervo existente → 432 fichas, 119 marcadas campeãs
PAUTA_IMPORT_DIR="$HOME/Library/CloudStorage/GoogleDrive-pedro.magnago@fullbpo.com/Meu Drive/Obsidian/Cerebro-Conteudo" \
  pnpm --filter @mktos/api import:pauta

# 3. busca semântica (precisa de OPENAI_API_KEY)
curl -XPOST localhost:4000/api/pauta/referencias/reindexar -H "Authorization: Bearer <token>"
```

**Onda 2 — Rotina.** `AnthropicProvider` atrás do `LlmProvider` (env já declarado);
`@nestjs/schedule` + `PautaRotina` + `PautaRodada`; aba Radar com feeds; tela de revisão da
rodada. **Aqui a rotina do app do Claude é desligada.**

**Onda 3 — Canais.** `PautaPeca` por canal; conector Evolution (instância própria) com
`@SensitiveWrite`; `BioLink` automático; export pra máquina de carrossel; write-back no ClickUp.

## 11. Riscos e o que dói na prática

- **Cron com réplica única.** `@nestjs/schedule` dispara por processo. Hoje a API é 1 container —
  ok. Se um dia escalar, a rodada duplica: precisa de lock (advisory lock no Postgres).
- **Custo do Apify.** Cobra por execução. Guardar custo por run e teto mensal na `PautaFonte`;
  sem teto, um perfil vigiado com intervalo curto queima crédito silenciosamente.
- **Grupo do WhatsApp.** A Cloud API da Meta **não** envia para grupo — daí o Evolution. Exige
  o JID do grupo (não é o número) e um número dedicado; banimento de número é risco real,
  então rate-limit e nada de disparo em massa.
- **Publicação no Instagram.** Fora de escopo até o App Review — não prometer automação lá.
- **Deploy.** `deploy/up.sh --vps api web`. O `--vps` é obrigatório: sem ele o compose base
  publica em `0.0.0.0` e expõe banco/redis/minio. Ver `CLAUDE.md`.

## 12. Importador do acervo (onda 1)

`apps/api/prisma/import-pauta.ts`, idempotente (reimportar não duplica). Lê duas coisas, ambas
opcionais:

1. `9 - Engenharia Reversa das Referências/fichas/*.md` → `PautaReferencia`. O parser casa os 14
   rótulos da ficha e trata continuação de linha. **Validado contra os arquivos reais: 432/432
   fichas importáveis, nenhum campo obrigatório faltando.**
2. `8 - Referência de Conteúdo/dataset_instagram-scraper_*.json` → `PautaCaptura` (posts crus vão
   para a fila, não viram ficha — ainda não têm análise).

**Critério de `campea`:** bunker maduro (4 ou 6) **e** família campeã (CUR/REA/STO/DEM). Dá
exatamente **119 fichas** — o mesmo número que o `_ESTRUTURAS-CAMPEAS.md` declara ao reduzir o
escopo de 427 para 119. É a "preferência revelada" do estudo, não uma escolha nova.

Cada ficha importada leva as tags `roteiro-<n>`, `laboratorio-de-roteiros` e `bunker-<n>`, e
`origem = 'laboratorio'` — dá para separar do que foi capturado depois.
