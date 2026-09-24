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

O gatilho roda **dentro da API** (o container `mktos_api` já fica 24/7 na VPS), num tick de
1 minuto que pergunta "qual rotina bate agora?".

> **Mudei de ideia sobre o `@nestjs/schedule` na implementação.** Como as rotinas são
> editáveis pela tela, registrar/desregistrar um `CronJob` a cada edição vira contabilidade de
> estado — e um cron salvo errado só apareceria no próximo boot. Com o tick, editar passa a
> valer no minuto seguinte sem re-registro, e o matcher de cron (`pauta/cron.ts`, ~40 linhas,
> com 16 testes cobrindo fuso, faixas, passos e domingo 0/7) fica sob nosso controle. Menos
> dependência, menos estado.

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
enum PautaFonteTipo     { rss  perfil  busca  manual  gmail }
enum PautaCapturaStatus { rascunho  processando  ficha  descartada  erro }
enum PautaFamilia       { CUR  REA  STO  DEM  CON  INT  TRE  ENC  outra }
enum PautaObjetivo      { ALC  AUT  VIN  VEN  ENG  PRO  LEA }
enum PautaRodadaStatus  { coletando  aguardando_curadoria  curada  aprovada  publicada  falhou }
enum PautaCanal         { whatsapp  instagram  newsletter  clickup }
enum PautaPecaStatus    { rascunho  aprovada  publicada  descartada }

model PautaFonte {          // o Radar: feed, perfil vigiado, busca salva ou etiqueta do Gmail (handle)
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
4. **Radar** — as fontes automáticas: feeds de IA, perfis vigiados, buscas no Google e etiquetas
   do Gmail. Origem do insumo das rodadas.

## 7. Rodadas, peças e canais

A rodada roda 3x/semana, coleta a janela de 72h, e **numa chamada** monta o prompt com insumo
fresco + as fichas campeãs do acervo. O derivador de carrossel não recebe "escreva sobre X" —
recebe família, objetivo, fórmula de headline, estrutura de corpo, prova obrigatória e
anti-padrões, tirados do que o próprio estudo já provou.

| Canal | Como sai | Trava |
|---|---|---|
| **WhatsApp (grupo)** | Evolution API, instância e número **dedicados do root** | `@SensitiveWrite('content')` — não sai sem token de aprovação confirmado |
| **ClickUp** | cria o tema de verdade (`CLICKUP_LIST_PAUTA`) | — |
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

**Onda 2 — Rotina. ✅ entregue (03/08/26)**
- `AnthropicProvider` (SDK oficial) atrás do `LlmProvider` — **agora é o default** (`LLM_PROVIDER=anthropic`).
- Agendador próprio (tick de 1 min + `pauta/cron.ts`) + `PautaRotina` + `PautaRodada`.
- Coletor RSS sem dependência (`rss.service.ts`); painel `/pauta` com Rodadas e Rotinas.
- **A rotina do app do Claude pode ser desligada.**

**Onda 3 — Canais. ✅ entregue (03/08/26)**
- `PautaPeca` por canal; derivação numa chamada com o repertório campeão no prompt.
- Evolution (instância própria) para o grupo, atrás de `@SensitiveWrite('content')`.
- `BioLink` rastreado automático; export do carrossel; write-back no ClickUp.

**Como rodar (continuando o de cima):**
```bash
pnpm --filter @mktos/api db:deploy   # aplica add_pauta_rotina
# .env: ANTHROPIC_API_KEY (obrigatória p/ curar) e, para publicar no grupo,
#       EVOLUTION_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCIA / EVOLUTION_GRUPO_JID
```
Depois, em `/referencias → Radar` cadastre os feeds e em `/pauta → Rotinas` crie a rotina
`0 7 * * 1,3,5` (o preset "3x/semana · 07:00").

## 11. Riscos e o que dói na prática

- **Cron com réplica única.** O tick roda por processo. Hoje a API é 1 container — ok. Se um dia
  escalar, a rodada duplica: precisa de lock (advisory lock no Postgres em volta do disparo).
- **Feed que morre não derruba a coleta.** Cada fonte é lida em try/catch e o erro fica em
  `PautaFonte.ultimoErro`, visível na tela. Um 404 num feed não impede os outros de entrarem.
  Vale para o Gmail (MC2): Google não conectado vira "Google não conectado. Conecte em
  Integrações." na fonte, e a rodada segue com o RSS.
- **Gmail como fonte (MC2).** A fonte `gmail` guarda uma etiqueta em `handle`; a coleta busca
  `label:<etiqueta> newer_than:7d` e cada e-mail vira uma captura (assunto no título, trecho
  limpo na nota, texto inteiro no `bruto`). Lê pela porta, com as capacidades R0
  `comunicacao.email.buscar`/`ler` — o interruptor do conector Gmail corta a coleta. A URL da
  captura é o permalink que o conector devolve e o `urlHash` sai dele sem normalização (a da
  tela apaga o fragmento, onde mora o id). Cadastrar ou trocar a etiqueta exige `gmail.ver`, e
  pastas do próprio Gmail (inbox, sent…) são recusadas: a etiqueta é a fronteira do que entra
  numa pauta que `pauta.ver` lê. A captura é coletada pela rodada mas ainda **não** entra na
  curadoria da rodada (o permalink é de uma caixa de entrada, não link publicável) — entra
  com a curadoria humana (MC6), como candidata sem link público.
  - **Teto de 50 e-mails por coleta**, o do conector, sem paginação. Lista cheia deixa um
    aviso em `ultimoErro` ("os mais antigos podem ter ficado de fora").
  - **Um e-mail que falha não tranca a etiqueta**: os outros entram, a auditoria registra os
    que entraram e a fonte guarda "N de M e-mail(s) não entraram". Conector desligado e
    leitura retida param a coleta inteira.
  - **Limitação conhecida — leitura acima de R0.** Se a empresa sobrescrever
    `comunicacao.email.buscar`/`ler` para R2 ou acima, a porta cria a aprovação antes de o
    coletor ver a retenção: cada coleta (inclusive a da rotina) deixa um pedido novo na fila,
    e aprová-lo executa uma busca cujo resultado não vai a lugar nenhum. A fonte mostra o
    motivo; o conserto é voltar a leitura a R0 ou pausar a fonte. Não há hoje consulta à
    política sem registro para o coletor desistir antes.
- **Busca no Google (MC3).** A fonte `busca` guarda a consulta em `handle` (uma linha, até 200
  caracteres e 32 palavras; URL é recusada) e roda o actor `apify~google-search-scraper` com
  recorte fixo: `countryCode: 'br'`, `languageCode: 'pt-BR'`, `quickDateRange: 'd7'`, uma
  página (`maxPagesPerQuery: 1`). Cada resultado **orgânico** vira captura: título, link e a
  descrição do Google na nota; anúncio, "as pessoas também perguntam" e endereço interno do
  Google ficam de fora. A chave é a **mesma da tela e do grupo de links**
  (`normalizarUrlDaCaptura`): a matéria que a busca acha e alguém cola no grupo é uma captura
  só. A URL gravada é a que o Google devolveu (a normalizada serve só à chave). O RSS ainda
  grava com a regra própria, então a matéria que chega pelo feed e pela busca vira duas
  capturas; a curadoria passa a lista por `umaPorMateria` antes do prompt. A data é conferida de novo do nosso lado — resultado com data (no campo `date` ou na
  frente da descrição, "há 2 dias —") mais velha que a semana é descartado; sem data, passa.
  A rodada coleta a busca junto com RSS e Gmail, e a curadoria lê as capturas de `rss` e
  `busca` (o bruto tem `resumo`/`publicadoEm`, os mesmos campos do RSS).
  - **Teto por fonte, reservado antes do run.** A coleta reserva o run numa escrita
    condicional (`runsNoMes < tetoRunsMes`, com a virada do mês zerando o contador) antes de
    chamar o Apify: a rotina e o "Coletar agora" ao mesmo tempo não passam os dois pelo último
    run. Teto atingido **não é erro**: a busca é pulada, o aviso fica em `ultimoErro` e a
    rodada segue. Run que falha no Apify conta (cobrou); sem `APIFY_TOKEN` não reserva nada.
    Busca pulada não mexe em `ultimaLeitura`, e o "Coletar fontes" da aba Rodadas diz quantas
    foram puladas.
  - **Cada coleta da rodada gasta.** A rotina com `coletarAntes`, o "Rodar agora" e o botão
    "Coletar fontes" gastam 1 run por fonte de busca ativa a cada disparo, sem olhar
    `intervaloMin`; quem freia é o teto do mês da fonte.
  - **Custo.** O `custoUsd` do run é rateado entre as capturas novas, em 4 casas (somar a
    coluna dá o gasto **aproximado**); o total exato vai para o RASTRO em
    `pauta.coleta_busca`, mesmo quando nada novo entrou. Processar a captura (virar ficha)
    mantém o custo, o run e a procedência da busca.
  - **Busca salva antiga.** Antes do MC3 o Radar cadastrava "Busca salva" sem consulta. Essa
    fonte é pulada com aviso ("foi cadastrada sem consulta") e não conta como erro; o conserto
    é removê-la e cadastrar de novo com os termos.
  - **Mesma dívida do perfil:** o Apify é chamado direto de `pauta.service.ts`, fora da porta
    (lista de exceções de `test/arquitetura.test.ts`, "onda 8 — resto da 3.3").
- **Creators no X e no YouTube (MC4).** A fonte `perfil` ganhou plataforma: `instagram` (o
  padrão, e o que vale para perfil gravado sem plataforma), `tiktok`, `x` (`twitter` é aceito
  como apelido) e `youtube`. O cadastro confere o @ pela regra da rede e aceita a URL do perfil
  colada (`x.com/fulano`, `youtube.com/@canal`, `youtube.com/channel/UC…`). Actors:
  `apidojo~tweet-scraper` (`twitterHandles`, `sort: 'Latest'`) e `streamers~youtube-scraper`
  (aba de vídeos do canal, sem shorts nem lives); os ids ficam em `ACTORS`, sem variável de
  ambiente — trocar um id é trocar o formato do item, que `postDoItem`
  (`pauta/perfil-da-pauta.ts`) lê por plataforma. Cada post vira captura com a chave da tela; o
  bruto guarda o item cru mais `resumo`, `publicadoEm` e `perfil: {plataforma, handle, texto}`.
  - **Na rodada.** O perfil entra na coleta da rodada como a busca: reserva o run antes do
    Apify, teto atingido pula com aviso (antes do MC4 era erro), run que falha conta, custo
    rateado + RASTRO `pauta.coleta_perfil`. **Cada disparo gasta 1 run por perfil ativo** —
    menos na rotina com `origens` sem `C`: a coleta antes da curadoria percorre só os tipos das
    origens pedidas (`tiposDaColetaDasOrigens`), e `['R', 'N']` coleta só feed e busca, como
    antes do MC4. Rotina sem `origens` na config coleta tudo, perfis inclusive, com o teto de
    cada fonte como freio.
  - **Gravação.** O post é gravado direto, como na busca, e não por `capturar`: a rotina não
    aparece no RASTRO como pessoa que colou o link (o registro é o `pauta.coleta_perfil`, com o
    ator de verdade), e o mesmo post gravado ao mesmo tempo por outra coleta (P2002) conta como
    repetido em vez de derrubar o resto do run.
  - **URL colada.** O @ sai da URL só se o host for o da rede escolhida, e o link de post ou de
    página (`/p/`, `/reel/`, `/watch`, `/shorts/`, `x.com/i/…`) é recusado com mensagem, em vez
    de virar `@p` e gastar run no creator errado. O `/user/` e o `/c/` do YouTube também são
    recusados: o nome antigo não é o @ do canal. O teto de 60 caracteres vale para o @ extraído.
  - **Post velho.** A primeira coleta de um canal traz os últimos vídeos, que podem ter meses, e
    a janela da rodada se mede por `capturadoEm`. A captura fica (serve de referência), mas a
    curadoria descarta o post de creator com `publicadoEm` anterior à janela.
  - **Processar.** Post do X e do YouTube vira ficha com o texto guardado na coleta (abrir o
    link daria a tela de login do X); Instagram e TikTok seguem relendo pelo Apify, e a
    procedência do perfil atravessa.
- **As origens da rodada (MC4).** A curadoria lê as capturas da janela de **todas** as origens,
  com a letra que a curadoria humana vai mostrar: **W** grupo de WhatsApp (fonte `manual` com
  plataforma `whatsapp`), **N** busca, **R** RSS, **C** creator, **L** newsletter
  (`origemDaFonte`, em `@mktos/shared`). A letra vai ao prompt e ao item curado (`origem`).
  A newsletter entra **só como contexto**: a URL dela é o permalink de uma caixa de entrada, o
  prompt a mostra sem link e o item L que a IA escolher mesmo assim sai da seleção (até o MC6
  decidir o link de cada item). `origens` no corpo de `POST /pauta/rodadas` ou em
  `config.origens` da rotina restringe a leitura; `['R', 'N']` reproduz a rodada de antes do
  MC4. Newsletters não se fundem entre si na deduplicação da curadoria.
  - **Cota por origem.** Uma consulta por origem (60 cada) e as origens alternando até o teto
    de 60 itens (`insumoDaRodada`): o lote que a coleta acabou de gravar não tira do corte o link
    que o grupo mandou na semana.
  - **A mesma matéria em mais de uma origem** vira um item só, com todas as letras no prompt
    (`origem: W+R`); o item curado leva a primeira de `PAUTA_ORIGENS`, W antes de todas.
  - **O link do grupo** chega sem título: o prompt usa a mensagem (`nota`) como resumo.
  - **A origem é sempre a nossa:** a que a IA escrever no item é descartada antes de casar a
    URL com a captura.
- **Curadoria humana (MC6).** Um segundo modo de gerar a rodada, ao lado do antigo (que a
  rotina `pauta.rodada` segue usando, com a IA escolhendo de 3 a 5): `POST
  /pauta/rodadas/curadoria` (`{horas?, origens?}`, janela padrão 168h) monta a lista com
  **todas** as capturas da janela, até `PAUTA_TETO_DE_CANDIDATOS` (200) — o que passa do teto
  fica contado por origem no log e na auditoria (`pauta.rodada_para_curadoria`), inclusive o
  que nem coube na consulta da origem que encheu (conta-se o total dela). A rodada nasce
  em `aguardando_curadoria` e cada candidato é `{id, origem, titulo, url, resumo, sugerido,
  porque}`, com o id da captura. A IA só **sugere** (acende `sugerido` e diz `porque`, pelo
  número do item): não tira ninguém, não marca ninguém, e sem IA ou com a chamada falhando a
  lista nasce do mesmo jeito, com o motivo em `erro`. Um item basta.
  - **Marcar e confirmar** (`pauta.editar`): `PUT /pauta/rodadas/:id/curadoria` com
    `{marcados: [ids]}` grava a marcação inteira; `POST …/curadoria/confirmar` (a marcação pode
    vir junto) deixa só os marcados em `itens`, monta o `corpo` deles **sem IA**, limpa o aviso
    de `erro` e passa a rodada a `curada` — daí em diante é a rodada de sempre (derivar, publicar). Confirmar exige
    um marcado; id que não é candidato recusa a marcação inteira; as duas escritas são
    condicionadas ao status, então uma aba atrasada não reabre curadoria confirmada. Derivar
    recusa a rodada que ainda aguarda.
  - **A newsletter** é candidata como as outras, marcada `semLinkPublico`: a tela mostra o
    permalink para quem cura, mas o miolo, o prompt das peças e o link publicado
    (`destinoDosItens`) pulam o dela.
  - **Aba Curadoria** em `/pauta`: lista com checkbox, letra da origem, título com link,
    resumo, destaque nos sugeridos com o porquê, filtro por origem e "só sugeridos", contador e
    a barra de Salvar/Confirmar presa no rodapé (celular primeiro, com o canto do botão
    "perguntar" livre). "Abrir Curadoria" na aba Rodadas abre a rodada clicada.
- **Coleta de quinta (MC5).** Rotina do tipo `pauta.coleta`
  (`routines/executores/pauta-coleta.executor.ts`), sem `PautaRotina` por trás: nasce pelo
  `POST /rotinas` (tela `/rotinas`, "Nova rotina de coleta": `0 22 * * 4`, `America/Sao_Paulo`,
  168h) com `origem: manual` e a config na própria `Rotina` (`{horas?, origens?}`; padrão 168h
  e todas as origens). Cada passagem: (1) sem fonte ativa nas origens (o grupo de WhatsApp conta)
  é `pulada`; (2) coleta rss, busca, perfil e gmail pelo despacho de sempre — uma fonte que falha
  fica com o erro dela no Radar e as outras seguem (`coletarDaRodadaPorTipo`); (3) gera a rodada
  por `gerarParaCuradoria` (status `aguardando_curadoria`, a IA só sugere, **ninguém cura**). O
  resumo da passagem é só contagem: novas/fontes/erros/puladas por origem e os candidatos por
  letra. Janela vazia vira `erro` com a conta da coleta junto, em vez de sumir. O W não se coleta:
  chega pelo webhook e entra pela janela. `PAUTA_CRON=off` também tira este tipo do tique. A
  janela conta do disparo, não do fim da coleta (senão a semana de coleta mais lenta abre um
  buraco que rodada nenhuma lê). Empresa sem o módulo `pauta` não cria a rotina (o
  `POST /rotinas` é espinha e confere `MODULO_DO_TIPO`) e, se tiver uma de antes, a passagem sai
  `pulada` sem gastar Apify nem IA.
  **Sob o papel restrito (passo 16 de `docs/ESTADO-DA-EXECUCAO.md`) nenhuma rotina dispara, esta
  inclusive**; o "Rodar agora" segue funcionando.
- **O episódio (MC7).** A rodada `curada` vira `PautaEpisodio` — e só ela: aguardando curadoria,
  coletando, falhou, aprovada e publicada são 400. Filho 1:1 da rodada (`rodadaId` único, FK
  `RESTRICT`), com a sentinela `''` e o gatilho `mktos_orgid_do_pai` conferindo a rodada **e** a
  página de links (`bioPageId`, para o MC12). Migration `20260924060000_pauta_episodio`.
  - **Número por empresa** (`ep-01`, `ep-02`…, `apelidoDoEpisodio`): sai sob
    `pg_advisory_xact_lock('pauta-episodio:<orgId>')` na mesma transação que grava, e o índice
    único `(orgId, numero)` é a segunda tranca. Rodada que já tem episódio é 409; rodada apagada
    no meio da criação (o gatilho recusa, P2003) é 404. Título padrão: o da rodada, sem o apelido
    (a tela já o mostra ao lado).
  - **Status** (`PautaEpisodioStatus`, espelho em `PAUTA_EPISODIO_STATUS`): roteiro → gravação →
    edição → pacote → derivação → agendado → concluído. Anda **um passo**, para a frente ou para
    trás (refazer); pular é 400 (`transicaoDoEpisodio`, no shared, porque a tela desenha os botões
    com a mesma conta). A escrita é condicionada ao status lido — duas abas não fazem pular dois.
  - **API** em `/pauta/episodios` (módulo `pauta`; `pauta.ver` lê, `pauta.editar` escreve):
    `POST` `{rodadaId, titulo?}`, `GET`, `GET /:id` (com os itens mantidos da rodada e os dois
    vizinhos do status), `PATCH /:id` `{titulo}`, `POST /:id/status` `{para}`. Tudo auditado
    (`pauta.episodio_criado`/`_titulo`/`_status`). Nada sai do OS.
  - **A rodada que virou episódio não se apaga** (409 na API, inclusive quando o episódio nasce
    entre a conferência e o delete; o banco recusa por fora dela).
  - O item de newsletter (`semLinkPublico`) chega ao episódio **sem** o `url`: o episódio é a fonte
    da página de links pública (MC12) e não carrega o link privado da caixa de entrada.
  - **Tela:** aba "Episódios" em `/pauta` (lista com número, título e status; detalhe com a linha
    do tempo das sete etapas, os itens e os botões dos vizinhos). "Criar episódio" na rodada
    curada da aba Rodadas e no aviso depois de confirmar a Curadoria.
  - Os campos de mídia, transcrição, títulos, thumbs e descrição **existem e ficam vazios** até o
    MC9–MC12; o roteiro é escrito desde o MC8 (abaixo).
- **O roteiro do episódio (MC8).** Sai dos itens que a curadoria manteve e vira o markdown de
  `PautaEpisodio.roteiro`; gerar passa o episódio de `roteiro` para `gravacao`.
  - **Gerar** (`POST /pauta/episodios/:id/roteiro/gerar`, `pauta.editar` + `automacoes.executar`,
    corpo `{substituir}`): só em roteiro ou gravação — depois, o roteiro é registro do que foi
    gravado (400; dá para voltar o status ou editar à mão). Já tem roteiro e `substituir` não veio:
    409 sem gastar IA. A chamada leva o `orgId` (teto e custo da empresa) e o RASTRO registra
    provider, modelo, a ordem e quais matérias o sistema completou (`pauta.episodio_roteiro_gerado`).
    A escrita é condicionada ao status **e** ao `atualizadoEm` lidos antes da IA: uma edição à mão
    feita enquanto o modelo pensava não some (409).
  - **A IA devolve JSON** (`SYSTEM_ROTEIRO` em `pauta/roteiro-do-episodio.ts`): abertura, as
    matérias na ordem dramática (abre com a de maior impacto, meio com as densas, fecha em alta) com
    título curto, resumo de 2–3 linhas, "na tela" e o gancho para quem toca o negócio, e o
    fechamento. O markdown é montado pelo sistema: o **link de cada matéria sai do item pelo
    número**, URL escrita pelo modelo é tirada do texto, a newsletter sai "sem link público", e a
    matéria que a IA esquecer entra antes do fechamento com o que a curadoria disse dela. Resposta
    que não é JSON (markdown, frase) é 503 e nada é gravado.
  - **Palavra de corte (D-MC2)**, fixada no topo do roteiro pelo sistema: a do episódio
    (`PUT /pauta/episodios/:id/palavra-de-corte` `{palavraDeCorte}`, nulo volta à da empresa;
    migration `20260924070000_pauta_episodio_palavra_de_corte`), senão a da empresa — a primeira
    linha da nota da memória com chave `pauta.palavra-de-corte` ou, sem ela, `operador:palavra-de-corte`,
    **só lida** —, senão `root, corta`. Memória fora do ar cai no padrão. A nota da empresa se cria
    pelo caminho da ADR-011, hoje `POST /memoria` com a chave `pauta.palavra-de-corte`: a tela
    Contexto só oferece criar nota enquanto a memória está vazia (e então a chave sai
    `operador:palavra-de-corte`). A palavra **vale na hora**: o painel, o modo de gravação, o `.md` e
    o espelho trazem o lembrete do topo com a palavra efetiva (`comPalavraDeCorte`, no shared), e
    definir a do episódio reescreve essa linha no roteiro gravado. Não é preciso gerar de novo.
  - **Voz:** o prompt recebe `blocoDeVoz()` (`pauta/voz-da-pauta.ts`), o ponto único que o MC10
    preenche com o perfil do autor; hoje é o tom da casa.
  - **Editar** (`PUT /pauta/episodios/:id/roteiro` `{roteiro, versao}`): não muda o status; versão
    diferente da atual é outra aba (409). **Exportar**: `GET /pauta/episodios/:id/roteiro.md`
    (`text/markdown`, `ep-NN-roteiro.md`; 404 sem roteiro). **Painel**: `GET …/:id/roteiro`.
  - **Espelho:** com o espelho ligado (off/local/drive), gerar, editar e trocar a palavra gravam
    `ep-NN-roteiro-<8 primeiros do id>.md` pelo mesmo `EspelhoService` das fichas
    (`espelharDocumento`; no local, na subpasta `episodios/`). O id vai no nome porque o número é
    por empresa e o destino padrão (a vault do servidor, a pasta do Drive da variável de ambiente)
    pode ser o mesmo para várias. Desligado não faz nada; falhando, o roteiro fica salvo e o erro volta na resposta.
  - **Tela:** bloco "Roteiro" no detalhe da aba Episódios (`SecaoRoteiro.tsx`): palavra de corte,
    Gerar roteiro (com confirmação para substituir), editor, Exportar .md e **Abrir para gravar** —
    tela limpa por cima do painel, fonte grande ajustável, links clicáveis, Tela cheia para o
    segundo monitor, rola no celular. O markdown vira elemento React (`roteiro-markdown.tsx`), sem
    innerHTML, e só http(s) é link.
- **CDATA no RSS.** Limpar tags antes de desembrulhar o CDATA apaga o conteúdo inteiro
  (`<![CDATA[…]]>` casa com `/<[^>]+>/`). O `semTags` desembrulha primeiro — foi um bug real,
  pego rodando contra o Ars Technica, onde 0 de 40 itens vinham com resumo.
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
