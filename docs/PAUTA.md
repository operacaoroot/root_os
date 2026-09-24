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

**O link publicado nasce `BioLink` na página de links do episódio (MC12).** O clique no grupo
volta como `BioEvent` + `PixelEvent` e alimenta `GoalWeek.bioClicks` sozinho. Até o MC12 o link
caía na primeira `BioPage` da empresa (qualquer uma) e nascia inativo sem chave — e o `/r/` de
link inativo manda para a home da bio sem medir nada. Agora é um **link de campanha** na página do
episódio da rodada, e **no ar**: chave `campanha:peca:<id>` (`bio/link-de-campanha.ts`), inativo
para não aparecer na página, mas o `BioService.destinoDoLink` segue link ativo **ou** de campanha
(sempre com a página no ar) — o clique cai na matéria e grava o `PixelEvent`. O destino é o primeiro
item com link público pela regra da página e da descrição (`linkDoPacote`: nunca o permalink da
newsletter). Sem episódio, sem página ou com a página em rascunho, a peça sai com o destino cru e
o motivo vai ao RASTRO (`rastreio` em `pauta.peca_publicada`).

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
  - Os campos de títulos, thumbs e descrição são escritos pelo pacote do YouTube (MC11); o roteiro
    desde o MC8, e a mídia e a transcrição desde o MC9 (abaixo).
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
  - **Voz:** o prompt recebe o bloco de voz da empresa (`VozService.bloco`, MC10 — abaixo): o
    perfil do autor com as regras da marca, ou o tom da casa sem perfil.
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
- **A mídia do episódio (MC9).** A edição e a transcrição rodam **no Mac** e o vídeo **fica lá**:
  o MinIO da VPS não é público (`docker-compose.vps.yml` publica em `172.17.0.1`), então URL
  assinada não chega ao Mac, e o upload no YouTube é manual na V1 (D-MC6). O OS recebe só o leve.
  - **API** (módulo `pauta`, todas `pauta.editar`; `MidiaService`, parte pura em
    `pauta/midia-do-episodio.ts`): `GET /pauta/episodios/pendentes-midia` — gravação e edição, do
    número menor, com a palavra de corte efetiva e o que falta (`midia` ou `transcricao`);
    `POST /pauta/episodios/:id/midia` (`PautaMidiaSchema`: `arquivoBruto`, `arquivoFinal`,
    `duracaoSeg` do final, `duracaoBrutoSeg`, `cortes` `{inicio, fim, motivo}` em segundos do bruto,
    em ordem e sem sobreposição, `palavraDeCorte`, `editor`) — da gravação ou da edição vai para a
    edição, e uma mídia nova **descarta** a transcrição que houver (os tempos eram do vídeo
    anterior); `POST /pauta/episodios/:id/transcricao` (`PautaTranscricaoSchema`: segmentos
    `{inicio, fim, texto}` em ordem, com tetos de quantidade e de tamanho) — só na edição e com a
    mídia lá; segmento que passa do fim do vídeo final é a transcrição do bruto (400). Grava
    `transcricao` + `transcricaoTexto` e vai para o pacote. Escrita condicionada ao status e ao
    `atualizadoEm` (409 quando outro envio passou na frente); RASTRO `pauta.episodio_midia` e
    `pauta.episodio_transcricao`, com o nome do arquivo e nunca a pasta do Mac.
  - **Rota antes do `:id`:** o `MidiaController` é registrado antes do `EpisodioController`, senão
    o `GET /pauta/episodios/:id` casa com `pendentes-midia` e responde 404.
  - **Limite prático:** o corpo JSON do Nest é de 100 kb, cerca de 40 min de fala; a ferramenta
    confere antes de mandar. Subir o limite é decisão de quem cuida da API.
  - **No Mac** (`tools/root-midia/`, Node 22 sem dependência; README e `SKILL.md` lá): `pendentes`,
    `silencios` (ffmpeg silencedetect), `cortes` (a lista do que manter), `cortar` (sem reencodar
    quando toda borda cai em quadro-chave; senão `trim` + `concat`), `transcrever` (`whisper-cli`,
    modelo em `WHISPER_MODEL`), `enviar` e `ensaio` (clipe sintético). Login normal da API com
    `ROOT_OS_API_URL` (fora desta máquina, só `https://`), `ROOT_OS_EMAIL`, `ROOT_OS_SENHA`, lidas
    também de `~/.config/root/root-midia.env`. A skill `/root-midia ep-NN` prefere o MCP do
    PalmierPro (troca de câmera) e cai no ffmpeg quando o app está fechado.
  - **Heurística da palavra de corte:** achada num segmento da transcrição do bruto, saem esse
    segmento, o anterior (a tomada errada) e a pausa até a retomada, menos a margem. Se a tomada
    errada ocupou dois segmentos, sobra um pedaço — por isso a skill mostra as tomadas ao Pedro antes
    de cortar. Silêncio ≥ 0,8 s sai com 0,2 s de margem de cada lado; nas pontas do arquivo, inteiro.
  - **Os cortes enviados saem do `manter`**, não dos `removidos` do `cortes.json`: o `manter` pode ser
    ajustado à mão, e o que sai fora do plano automático vai com o motivo `manual`. A transcrição do
    `cortes` tem de ser a do bruto (duração conferida), e o `cortar` recusa plano de outro bruto e
    saída que seja o bruto por outro nome (caixa do APFS, link simbólico).
  - **Tela:** seção "Mídia" no detalhe do episódio (`SecaoMidia.tsx`, só leitura): o nome do vídeo
    final, as durações, os cortes por motivo, a transcrição com o tempo de cada trecho, e o comando
    `/root-midia ep-NN` enquanto falta algo.
- **A voz do autor (MC10).** O roteiro e as peças passam a ser escritos no jeito de falar do Pedro.
  - **Onde mora:** nota da memória de chave `voz.pedro` (kind `definicao`), escrita só por
    `MemoriaService` — o caminho da ADR-011, com evento `memoria.item.*` no RASTRO e versão no
    histórico. Perfil novo é **versão nova da mesma nota**; a anterior continua em
    `GET /memoria/:id/versoes`. A empresa troca a chave pela nota `pauta.voz.chave` (a primeira
    linha é a chave, também com histórico), sempre sob o prefixo `voz.`: assim quem só tem
    `pauta.editar` não alcança nenhuma outra nota da memória.
  - **Aprender** (`POST /pauta/voz/aprender`, `pauta.editar` + `automacoes.executar`,
    `PautaVozAprenderSchema`): até 6 episódios com transcrição (sem transcrição = 400, de outra
    empresa = 404, antes de gastar IA) e até 5 textos colados de 200 a 20 mil caracteres, somando
    no máximo 60 mil (o corpo JSON morre em 100 kb no body-parser antes do esquema). O material
    vai ao modelo com teto de 60 mil caracteres dividido entre as fontes (a menor inteira, a sobra
    para as maiores) e passa por `neutralizarConteudoExterno`. `SYSTEM_VOZ` pede JSON com ritmo,
    tamanho de frase, vocabulário, expressões recorrentes, como abre, como fecha, como explica termo
    técnico e o que nunca diz — instrução seguível, sem fato do material. O sistema monta o perfil
    com seções fixas, tira do vocabulário e das expressões a palavra que a marca proíbe e soma as
    regras da marca ao "Nunca diz". Resposta fora do formato: 503, nada gravado. Procedência:
    `promocao` (texto de modelo) e `sourceRef` com os apelidos, a contagem de textos e o modelo —
    o título colado não entra, porque a procedência vai para o RASTRO sem redação.
  - **Editar à mão** (`PUT /pauta/voz` `{perfil, versao, chave}`, `pauta.editar`): versão nova com
    procedência `operador`; `versao` diferente da atual é outra aba (409, conferido dentro do
    cadeado da memória por `versaoEsperada`), e `chave` diferente da atual quer dizer que o
    rascunho é de outra nota (409). A tela guarda a versão e a chave de quando abriu o editor, e
    trava aprender e trocar a chave enquanto ele está aberto. Trocar a chave não põe a chave no
    motivo da versão: o motivo vai em claro para o RASTRO, que redige a chave. **Trocar a chave**: `PUT /pauta/voz/chave`.
    **Painel**: `GET /pauta/voz` (`pauta.ver`) — perfil, procedência, últimas 10 versões, regras da
    marca e os episódios transcritos com o tamanho.
  - **Montagem:** `VozService.bloco(orgId, semPerfil)` é o ponto único; `blocoDeVoz` devolve o
    perfil (neutralizado, até 4 mil caracteres, com a linha de procedência `perfil vN · origem ·
    data`) seguido das regras da marca — as palavras proibidas, sem emoji, sem "no mundo da IA" e
    sem jargão de palco, não prometer o que a matéria não sustenta: o tom da casa menos as linhas
    de estilo, que o perfil substitui. Sem perfil (ou arquivado, ou memória fora do ar) o roteiro
    fica no tom da casa e as peças no `SYSTEM_PECAS` de antes, sem bloco. Recebem o bloco o roteiro
    (`systemDoRoteiro`) e as peças (`systemDasPecas`). **A curadoria antiga não recebe:** o
    `SYSTEM_CURADORIA` (`POST /pauta/rodadas`, rotina `pauta.rodada`) escreve o miolo de 200–350
    palavras com voz fixa, e esse miolo é insumo das peças. Ligá-la ao bloco ficou para decisão do
    Pedro. O perfil não vai numa cerca `blocoExterno`: é instrução de estilo, e o cabeçalho diz que
    ele não muda formato, fonte nem link — exceção registrada na ADR-011 ("Fronteiras").
  - **O que o perfil não pode ensinar:** `montarPerfil` tira a palavra proibida do vocabulário e
    das expressões e, nos campos de texto, a frase que a cita (campo que fica vazio recusa o
    perfil, 503). O "Nunca diz" começa pelas regras da marca; o teto corta primeiro expressões,
    vocabulário e itens do autor, e nunca as alcança.
  - **Tela:** aba "Voz" em `/pauta` (`AbaVoz.tsx`): perfil vigente renderizado com a procedência,
    editar à mão (com aviso de palavra proibida), aprender marcando episódios e colando textos, as
    regras da marca, o histórico e a chave.
  - **Falta:** o teste cego com o Pedro (roteiro com e sem perfil) — é o critério de pronto do
    plano e depende dele.
- **O pacote do YouTube (MC11).** Da transcrição do vídeo final saem 3 títulos, a descrição com
  capítulos e 3 briefs de thumb; as thumbs são renderizadas no Mac (D-MC4) e voltam como PNG. Subir
  no YouTube é manual na V1 (D-MC6). `PacoteService`, parte pura em `pauta/pacote-do-episodio.ts`;
  as regras dos capítulos moram no shared, porque a tela confere com a mesma conta.
  - **Gerar** (`POST /pauta/episodios/:id/pacote/gerar`, `pauta.editar` + `automacoes.executar`,
    `{substituir}`): só no Pacote e na Derivação, e com transcrição (400 antes de gastar IA); já tem
    pacote e `substituir` não veio, 409 — gerar de novo troca os briefs e as imagens das thumbs saem
    junto. A chamada leva o `orgId` e o bloco de voz (`VozService.bloco`, MC10; sem perfil, o tom da
    casa). A transcrição vai ao modelo como `[mm:ss] fala`; longa demais (45 mil caracteres), os
    segmentos se agrupam em blocos de 15 s a 4 min, e o tempo de cada bloco continua sendo o começo
    real de uma fala. Escrita condicionada ao status e ao `atualizadoEm` lidos antes da IA (409);
    o status **não** muda. RASTRO `pauta.episodio_pacote_gerado` só com as contas, as correções e os
    avisos. Resposta sem JSON ou com menos de 3 títulos utilizáveis: 503, nada gravado. A resposta
    traz `{episodio, avisos, correcoes}`.
  - **Títulos:** 3, dentro de 100 caracteres (cortados na palavra), sem URL, emoji nem `<`/`>` (o
    YouTube recusa), sem palavra proibida da marca e sem repetir; cada um com o ângulo. **Título
    escolhido:** `PUT …/:id/pacote/titulo` `{n: 1..3 | null}` marca um só (RASTRO
    `pauta.episodio_titulo_escolhido`).
  - **Capítulos** (`consertarCapitulos` + `conferirCapitulos`/`linhasDosCapitulos` do shared): o
    modelo copia os tempos dos colchetes; o sistema encosta cada um no começo de fala mais próximo,
    ordena, tira o repetido e o que passa do fim, leva o primeiro para 00:00 (ou põe uma "Abertura"
    em 00:00 se o primeiro estiver a 10 s ou mais), junta ao anterior o que dura menos de 10 s, fica
    com no máximo 10 (o mais curto se junta ao anterior, com a correção dita) e confere as regras do YouTube (primeiro em 00:00, pelo menos 3, 10 s cada, ordem crescente, o
    último até o fim). Formato `mm:ss`; com uma hora ou mais, `hh:mm:ss` em todas as linhas. O que
    não fecha nem consertado sai da descrição com o motivo em `avisos` — vídeo de 25 s nunca terá 3.
  - **Descrição:** abertura (2–3 frases do modelo, sem URL), "Capítulos", "Links citados no episódio"
    (os itens mantidos com link público, na ordem da rodada — **nunca** o da newsletter: origem L,
    `semLinkPublico` ou host de caixa de entrada ficam de fora), a chamada para a página de links do
    episódio com o marcador `{{pagina-de-links}}` (o MC12 troca pela URL — `descricaoComPaginaDeLinks`
    no shared) e até 3 hashtags. Teto de 5.000 **bytes**, medido com o marcador e guardando 200 bytes
    (`PAUTA_RESERVA_DA_PAGINA_DE_LINKS`) para a URL que o MC12 põe no lugar — a URL tem de caber
    nisso. Passando, saem os links do fim ("e mais N na página do episódio"), depois o fim da
    abertura; com no máximo 10 capítulos, isso basta. Títulos sem três ângulos diferentes viram aviso.
  - **Thumbs:** 3 briefs `{n, texto (até 4 palavras), destaque (uma palavra do texto, a que vai na
    cor de acento; se o modelo apontar outra, a mais longa), tempoSeg (o frame, dentro do vídeo)}`;
    faltando brief, trechos de 4 palavras dos títulos completam (sem repetir texto, pontuação e acento
    à parte); se nem assim chegar a 3, o aviso diz. Não há edição de brief: trocar uma thumb é gerar o
    pacote de novo, o que troca também títulos e descrição. `GET …/:id/thumbs` (`pauta.ver`) entrega ao Mac os briefs,
    o `arquivoFinal` e a duração; `POST …/:id/thumbs/:n` (`pauta.editar`, multipart `file`) aceita só
    `image/png` com a assinatura de PNG, até 2 MB (o multer corta antes), 16:9 e de 640 a 3840 de
    largura — grava no storage da casa (MinIO, não público) em `pauta/thumb/<episódio>-<n>-<hash>.png`
    e guarda a chave no JSON do episódio (a chave não sai no detalhe); RASTRO `pauta.episodio_thumb`.
    `GET …/:id/thumbs/:n/imagem` (`pauta.ver`) devolve o PNG para a prévia, sem cache.
  - **No Mac** (`tools/root-midia`): `root-midia thumbs ep-NN` lê os briefs, tira o frame do vídeo
    final no tempo de cada um (ffmpeg, 1280×720), preenche `thumb.html` (o template da marca, com os
    tokens da ROOT **copiados** do brand pack: verde-limão `#9BDB1F`, magenta `#FF1F6B`, fundo
    `#070A08`, JetBrains Mono no título, Space Grotesk no apoio), fotografa num Chrome sem janela
    (perfil temporário; o Chrome de `/Applications`, `ROOT_MIDIA_CHROME` ou o do agent-browser; sem
    nenhum, o próprio agent-browser), confere 1280×720 e 2 MB e sobe. `--sem-enviar` só grava;
    `root-midia ensaio-thumb` prova o render com um frame sintético, sem falar com o OS.
  - **Depois de agendado** (e concluído) o pacote é o registro do que subiu: gerar, marcar título e
    enviar thumb são 400 (`motivoParaNaoMexerNoPacote`, shared), e as escritas são condicionadas ao
    status lido. **Mídia nova** (edição refeita) descarta a transcrição **e o pacote**, porque os
    capítulos e os frames das thumbs são tempos do vídeo anterior (`pacoteDescartado` no RASTRO).
  - **Tela:** seção "Pacote do YouTube" no detalhe do episódio (`SecaoPacote.tsx`): gerar (com
    confirmação para substituir), os três títulos com a escolha e copiar, a descrição com "Copiar
    descrição", a conta em bytes e os capítulos conferidos, e as thumbs — a prévia das que o Mac
    subiu, o brief e o comando `/root-midia thumbs ep-NN` das que faltam.
- **A página de links do episódio (MC12).** Uma `BioPage` por episódio no `bio.operacaoroot.com`,
  com um botão por matéria mantida que tem link público e os links de chamada da casa. O clique
  segue o caminho de sempre da bio (`/r/:linkId` → `BioTrackingService` → `BioEvent` + `PixelEvent`);
  o pixel da Meta no cliente não entra (D-MC5, adiada). `PaginaDeLinksService`, parte pura em
  `pauta/pagina-de-links-do-episodio.ts`.
  - **Montar** (`POST /pauta/episodios/:id/pagina-de-links`, `pauta.editar`): cria a página em
    rascunho na primeira vez (handle `<slug da empresa>-ep-NN`; o handle é único na bio inteira, e
    o de outra empresa é invisível sob RLS, então quem acusa é o índice único e aí vai o segundo
    candidato, `<slug>-ep-NN-<4 do id>`; a URL tem de caber nos 200 bytes da descrição) e guarda
    `bioPageId` no episódio (escrita condicionada a `bioPageId` nulo; duas abas = 409). Os botões:
    as matérias com link público na ordem da rodada, sem repetir URL (a regra é a mesma da
    descrição, `linkDoPacote`: origem L, `semLinkPublico` e host de caixa de entrada ficam de fora,
    com aviso), rótulo = título da matéria (80), destino = URL (500, só http/https); depois os links
    da casa, em destaque. **Idempotente:** cada botão leva `BioLink.chave` (`pauta:item:<hash da
    URL>`/`pauta:casa:<hash>`, único por página — migration `20260924080000_pauta_pagina_de_links`);
    montar de novo atualiza o que mudou, **desativa** (não apaga — os cliques ficam) o que saiu e
    põe os botões do painel (sem chave) depois, na ordem deles; campanha de peça e botão do painel
    nunca são tocados. Tudo sob `pg_advisory_xact_lock` da página. RASTRO `bio.page_create` e
    `pauta.episodio_pagina_de_links` (as contas, os avisos e `botoes`: o antes/depois de cada botão
    criado, atualizado ou desativado, como o `bio.link_update` do `/bio`). Página **no ar** só se
    remonta com `bio.editar` também (403) — é mudar o que o público vê, como editar um botão no
    `/bio`. Plano vazio é 400 só sem página; com ela, montar de novo desativa os botões da montagem.
  - **Módulo bio:** as rotas moram em `/pauta`, então o gate de módulos só confere a pauta. Montar
    e publicar leem `Org.modulos` e recusam com 403 quem não contrata a `bio` (no `/api/bio/*` ela
    receberia 404); a seção some da tela pelo `useModulos`.
  - **Desvio do plano:** a página e os botões são gravados pelo Prisma, não por `salvarPage` /
    `criarLink`: o `findUnique` do `salvarPage` não enxerga o handle de outra empresa sob RLS (quem
    acusa é o índice único) e o `criarLink` não aceita `chave`. Publicar, sim, é o `BioService.publicar`.
  - **Links da casa:** nota da memória `pauta.pagina-de-links.chamadas` (ou
    `operador:links-da-casa`), **só lida** por `MemoriaService.porChave`; a nota se cria por
    `POST /memoria` (ADR-011). Uma linha por link: `Rótulo | https://…`, `Rótulo: https://…`,
    `[Rótulo](https://…)` ou só a URL; no máximo 5. Memória fora do ar: a página sai sem eles, com
    aviso.
  - **Publicar** (`POST …/:id/pagina-de-links/publicar` `{publicada}`, `pauta.publicar` +
    `bio.editar`): passa pelo **mesmo** `BioService.publicar` do painel (`bio.editar`, RASTRO
    `bio.page_publish`/`bio.page_unpublish`) — o `BioModule` exporta o serviço para isso. Publicar
    sem página ou sem botão ativo é 400. A página pública é a de sempre
    (`GET /bio/public/page/:handle`, `/@handle` no host da bio); rascunho é 404.
  - **A descrição aponta para a página:** o detalhe do episódio traz `paginaDeLinks` e, com a página
    **no ar**, a `descricao` já sai com a URL no lugar de `{{pagina-de-links}}`
    (`descricaoComPaginaDeLinks`); o banco guarda o marcador, então gerar o pacote de novo continua
    certo. Em rascunho, o marcador fica e a tela avisa.
  - **Tela:** seção "Página de links" no detalhe do episódio (`SecaoPaginaDeLinks.tsx`): criar /
    montar de novo com a conta e os avisos, os botões com a origem (matéria, da casa, do /bio) e o
    que saiu riscado, publicar / tirar do ar, e o endereço.
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
