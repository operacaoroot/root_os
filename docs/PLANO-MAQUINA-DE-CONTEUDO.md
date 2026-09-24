# A máquina de conteúdo do ROOT OS — uma gravação por semana vira a semana inteira

> Decidido em 23/09/2026 com o Pedro: **tudo dentro do OS**, nada de script solto nem n8n, e a
> **peça-mãe é um vídeo gravado**. O que for pesado roda no Mac e devolve o resultado ao OS.
>
> Plano vigente do produto: `docs/PLANO-CONTINUIDADE.md`. Este documento é uma frente
> dele, não um plano concorrente. Prefixo das fatias: **MC**.

## De onde vem

O modelo é a máquina de conteúdo mostrada no vídeo da Ratos de IA
(`youtube.com/watch?v=WnZsMYeR7aA`, 16/09/2026): uma gravação por semana vira episódio,
newsletter, página de links e uma semana de carrosséis, stories e cortes agendados. O Pedro deu
duas ordens em 23/09/2026:

1. **"Pensa sempre em incluir no OS."** A máquina nasce como frente do ROOT OS, com o tenant, a
   porta, a régua e o RASTRO que o resto do produto já respeita.
2. **A peça-mãe é o vídeo.** O circuito de vídeo pelo Mac entra no escopo — não é o texto que
   vira vídeo, é o vídeo que vira todo o resto.

O fluxo do vídeo tem doze etapas, e cada uma tem dona aqui:

| # | Etapa do vídeo | Fatia |
|---|---|---|
| 1 | Links soltos num grupo de WhatsApp | MC1 |
| 2 | Rotina de quinta à noite com 4 pesquisas: links do grupo, notícias do nicho, creators, newsletters no Gmail | MC1–MC5 |
| 3 | O humano marca as notícias que ficam | MC6 |
| 4 | Roteiro: abre com impacto, meio mais denso, fecha em alta, com o link de cada matéria | MC8 |
| 5 | Gravação, com uma palavra-chave dita em voz alta a cada erro | D-MC2 |
| 6 | Edição automática: corta silêncios e os erros marcados | MC9 |
| 7 | Transcrição com timestamps, base de tudo o que vem depois | MC9 |
| 8 | 3 títulos, 3 thumbs e a descrição com capítulos | MC11 |
| 9 | Página de links do episódio, com pixel | MC12 |
| 10 | Newsletter tirada da transcrição, no tom de voz do autor | MC10, MC13 |
| 11 | Por notícia: um carrossel, um story e um corte vertical | MC15 |
| 12 | Calendário, publicação agendada no IG/TikTok e DM para quem comenta a palavra-chave | MC16–MC18 |

## O que já é nosso

Levantado no código em 23/09/2026:

| Precisa de | Aqui hoje |
|---|---|
| Fontes e rodada | módulo `pauta`: fontes RSS e perfis do Instagram via Apify; a rodada cura por IA e deriva 1 peça por canal |
| Publicar com aprovação | `pauta/publicacao.service.ts`: WhatsApp (Evolution) e ClickUp, `@SensitiveWrite`, aprovação confirmada |
| Relógio por empresa | `/rotinas`: executores registrados e cron por empresa (`routines/`) |
| Página de links com pixel | módulo `bio`: páginas, links rastreados, `PixelEvent` do lado do servidor |
| Ler newsletter | conector Google: `gmailRecent` e `gmailGet` (`google/google.service.ts:845,859`), leitura R0 |
| Guardar a voz do autor | memória: `ContextItem` por chave, escrito via evento do RASTRO (ADR-011) |
| Governança | régua R0–R5, `ToolGateway`, efeitos por registro, aprovação com segunda pessoa em R3+ |

## O que falta, e é o trabalho

1. **Entrada pelo grupo de WhatsApp.** O Evolution só envia. O webhook que existe é o do canal de
   aprovação, e ele descarta mensagem de grupo de propósito
   (`gateway/canais/resposta-de-canal.ts:369`).
2. **Busca web.** ~~O tipo `busca` existe no enum `PautaFonteTipo` e não tem código.~~ Feito no MC3.
3. **Creators no X e no YouTube.** O `ACTORS` do Apify só conhece Instagram, TikTok e web.
4. **Gmail como fonte da pauta.** O conector lê; a pauta não o usa.
5. **Curadoria humana.** Hoje a IA escolhe 5 itens e ninguém marca nada.
6. **Entidade episódio**, que carrega a rodada até a semana publicada.
7. **Roteiro.**
8. **Todo o circuito de mídia**: upload de vídeo, edição, transcrição, render.
9. **Perfil de voz** — hoje a voz está fixa no prompt, em código.
10. **Derivação por notícia** — hoje é uma peça por rodada.
11. **Calendário.**
12. **Publicação no Instagram e no TikTok** — a Meta hoje só lê.
13. **DM automática.**

## Onde roda cada coisa

| Onde | O quê | Por quê |
|---|---|---|
| **VPS** (`mktos_api`) | coleta, rotina de quinta, curadoria, roteiro, textos (títulos, descrição, newsletter), página de links, calendário, publicação | é onde o tenant, a porta e o RASTRO moram; nada disso pesa |
| **Mac, via Claude Code** | edição de vídeo, transcrição, render de thumbs, carrosséis, stories e cortes | a VPS vive perto do teto de CPU, e vídeo lá derrubaria o resto |

O Mac não guarda estado: pega o que o OS pede, faz, e devolve por upload com URL assinada, com a
conta de máquina. Segue o desenho Hermes + Claude Code de 13/09/2026
(`Obsidian/Root/20-empresa/root-os/18 - Plano Hermes + Claude Code + ROOT OS local (set-26).md`).
O ferramental do Mac:

- **Edição:** PalmierPro MCP (`http://127.0.0.1:19789/mcp`, só responde com o app aberto); fallback
  `auto-editor` + ffmpeg.
- **Gravação:** OBS, cena "2 · Tela + Câmera", brutos em `~/Movies/OBS`.
- **Render de imagem:** a máquina de carrossel, com o brand kit da Root.

## As fatias

Convenção de tamanho do plano vigente: **P** ≤ 1 dia de agente, **M** 2–4 dias, **G** 1–2
semanas. "Pronto" é sempre um teste, um número ou um comportamento que dá para demonstrar. Fatia G
tem especificação antes do código, em `docs/especificacoes/MC-*.md`, com decisões, opções e
recomendação.

### Fase 1 · Entrada — na sexta de manhã a lista está pronta para marcar

| # | Entrega | Depende | Pronto quando | Muda no repo | Tam |
|---|---|---|---|---|---|
| MC1 | **Grupo de links no WhatsApp vira captura** ✅ 23/09/2026 · `1f88073` | D-MC10 | um link colado no grupo aparece em `/referencias` em menos de 1 min; mensagem sem link é ignorada; o mesmo link colado duas vezes vira 1 captura; parser com teste | **sem endpoint próprio**: a Evolution só aceita uma URL de webhook por instância, e a do root já é o canal de aprovação. A entrada é `POST /approvals/canal/whatsapp/:orgId` (segredo no cabeçalho, resposta imediata, `comTenantPublico`), que antes de o canal ler desvia o grupo inscrito por `gateway/canais/entrada-de-grupo.registry.ts` para `pauta/entrada-de-links.service.ts`; parser puro (`pauta/links-do-grupo.ts`) que só aceita `remoteJid === EVOLUTION_LINKS_JID`; `PautaCaptura` deduplicada por `urlHash`, fonte `manual` com plataforma `whatsapp`; variável no compose e no `.env.example` | M |
| MC2 | **Gmail como fonte** ✅ 23/09/2026 · `fb29ab4` | — | a coleta da rodada traz as newsletters da etiqueta como capturas deduplicadas; Google ausente vira erro na fonte sem derrubar a rodada; teste com Gmail falso | valor `gmail` em `PautaFonteTipo` (migration + `PAUTA_FONTE_TIPOS`/`PAUTA_FONTE_ROTULOS` em `packages/shared`), etiqueta em `handle`; coletor `pauta/coletor-gmail.service.ts` que lê **pela porta** as capacidades R0 `comunicacao.email.buscar` (`q='label:<x> newer_than:7d'`) e `comunicacao.email.ler`, deduplicado pelo permalink que o conector devolve; despacho único por tipo em `pauta/coleta.service.ts`, usado pelo "Coletar agora" e pela coleta da rodada (`rss` + `gmail`); etiqueta exige `gmail.ver` e recusa pastas de sistema. O rótulo "L" e a entrada na curadoria ficam com o MC5/MC6: `gerar()` segue lendo só `rss`, porque o link da captura é o permalink de uma caixa de entrada e o item escolhido vira link publicado | M |
| MC3 | **Busca web das notícias do nicho** (implementa o `busca`) ✅ 23/09/2026 · `24fff3d` | D-MC1 | a coleta da rodada traz as notícias da semana da consulta como capturas deduplicadas, sem estourar o teto de runs (teto atingido pula com aviso na fonte) | consulta em `handle`; `ApifyService.buscarNoGoogle` com `apify~google-search-scraper` (Brasil, pt-BR, `d7`, uma página); parte pura em `pauta/busca-da-pauta.ts` (resultado orgânico, data conferida do nosso lado, chave da tela); coletor inscrito no despacho por `pauta.service.ts`, com o run reservado antes de chamar o Apify e o custo rateado nas capturas + RASTRO `pauta.coleta_busca`; a rodada coleta `busca` e a curadoria lê `rss` + `busca`. O rótulo "N" fica com o MC5, como o "L" do MC2 | P |
| MC4 | **Creators no X e no YouTube, dentro da rodada** ✅ 23/09/2026 · `93dd440` | D-MC1 | perfis cadastrados entram na rodada rotulados "C" | `apidojo~tweet-scraper` e `streamers~youtube-scraper` no `ACTORS`; `scrapePerfil` despacha por plataforma e `postDoItem` (`pauta/perfil-da-pauta.ts`) normaliza o item; o perfil entra na coleta da rodada com teto reservado e pulado com aviso; `gerar()` lê todas as origens com o rótulo W/N/R/C/L (`origemDaFonte`, shared; `pauta/origem-da-rodada.ts`), newsletter só como contexto; `origens: ['R', 'N']` mantém a rodada de antes | M |
| MC5 | **Rotina de quinta às 22h** ✅ 23/09/2026 · `5fab6e5` | MC1–MC4, MC6 | a rotina roda sozinha e gera uma rodada com as 4 origens rotuladas (W/N/C/L), **sem curar** | **feito:** executor `pauta.coleta` (`routines/executores/pauta-coleta.executor.ts`, `TIPO_PAUTA_COLETA` em `routines/rotina.tipos.ts`, provider em `routines.module.ts`): conta as fontes ativas das origens (zero = `pulada`), coleta por `RodadaService.coletarPorOrigem` (uma fonte que falha não derruba as outras; conta por origem) e gera por `gerarParaCuradoria` com `config.horas ?? 168` — rodada em `aguardando_curadoria`; janela vazia vira `erro` com a conta da coleta. Caminho de **criação**: `POST /rotinas` (`automacoes.executar`; só tipo inscrito, cron e fuso conferidos, config conferida pelo tipo em `routines/nova-rotina.ts`; `origem: manual`, agente `editor-de-pauta`), e "Nova rotina de coleta" em `/rotinas` com `0 22 * * 4` / `America/Sao_Paulo` / 168h. `PAUTA_CRON=off` também pula este tipo. ~~`gerar()` incluir a captura da fonte `manual`/`whatsapp` (rótulo W)~~ feito no MC4; a chave do RSS (`coletarFeeds` com `normalizarUrlDaCaptura`) **fica como está**: trocar muda o hash contra as capturas gravadas, e a curadoria já junta a mesma matéria (`umaPorMateriaDoInsumo`); ~~incluir a captura da fonte `gmail` (rótulo L)~~ feito no MC4. **Aviso:** sob o papel restrito (passo 16 de `docs/ESTADO-DA-EXECUCAO.md`) nenhuma rotina dispara, esta inclusive, até essa decisão | M |
| MC6 | **Curadoria humana** ✅ 23/09/2026 · `48a9313` | — | o operador marca pelo painel e só os itens marcados seguem; a IA propõe candidatos e deixa de escolher 5 | status `aguardando_curadoria` em `PautaRodadaStatus` (migration `20260924050000` + `PAUTA_RODADA_STATUS`); **modo novo** `RodadaService.gerarParaCuradoria` (`POST /pauta/rodadas/curadoria`, janela padrão 168h) ao lado de `gerar`, que segue igual para a rotina `pauta.rodada`: todos os candidatos da janela até `PAUTA_TETO_DE_CANDIDATOS` (200, sobra no log e na auditoria), cada um `{id da captura, origem, titulo, url, resumo, sugerido, porque}`, e a IA só sugere (`SYSTEM_SUGESTAO` em `pauta/curadoria-da-rodada.ts`; IA ausente ou falhando não trava a lista, vira aviso em `erro`); `PUT /pauta/rodadas/:id/curadoria` salva a marcação e `POST …/curadoria/confirmar` deixa só os marcados, monta o miolo sem IA e passa a `curada` (exige ≥1; escrita condicionada ao status); a newsletter entra como candidata marcada `semLinkPublico` e nunca vira o link publicado; `AbaCuradoria.tsx` na aba nova "Curadoria" de `/pauta`. `gerarParaCuradoria` já aceita `rotinaId` para o MC5 | M |

### Fase 2 · Episódio e mídia

| # | Entrega | Depende | Pronto quando | Muda no repo | Tam |
|---|---|---|---|---|---|
| MC7 | **Entidade `PautaEpisodio`** ✅ 23/09/2026 | MC6 | teste de isolamento verde; a aba mostra o episódio andando de status | model com `orgId`, 1:1 com `PautaRodada`, número sequencial por empresa; status `coleta → curadoria → roteiro → gravacao → edicao → pacote → derivacao → agendado → concluido`; campos de roteiro, chaves de mídia, transcrição, títulos, thumbs, descrição, `bioPageId`; RLS com FORCE + semente no isolamento; aba "Episódios" com a linha do tempo. **feito:** migration `20260924060000_pauta_episodio`; o enum `PautaEpisodioStatus` (espelho `PAUTA_EPISODIO_STATUS`) vai **de `roteiro` a `concluido`** — coleta e curadoria seguem como status da `PautaRodada`, e só a rodada `curada` vira episódio (`POST /pauta/episodios`, número sob `pg_advisory_xact_lock` por empresa + único `(orgId, numero)`; `rodadaId` único); anda um passo por vez, à frente ou atrás (`transicaoDoEpisodio`, shared; `POST /pauta/episodios/:id/status` com escrita condicionada ao status lido). Filho com sentinela `''` + gatilho `mktos_orgid_do_pai` para a rodada e para `bioPageId`, que é FK com `SET NULL`; a FK da rodada é `RESTRICT` (apagar rodada com episódio é 409). A mídia é um JSON `midia` ainda sem forma (o MC9 define as chaves). O item de newsletter (`semLinkPublico`) chega ao episódio **sem** o `url`, para o MC12 não ter como publicá-lo. Aba "Episódios" em `/pauta` e "Criar episódio" nas abas Rodadas e Curadoria | M |
| MC8 | **Roteiro** ✅ 23/09/2026 | MC7, D-MC2 | o roteiro renderiza no painel e exporta para abrir na tela durante a gravação | prompt `SYSTEM_ROTEIRO` (impacto, meio denso, fecha em alta; resumo + link por matéria; a palavra de corte fixada); markdown gravado no episódio; espelho opcional via `pauta/espelho.service.ts`. **feito:** `RoteiroService` + parte pura em `pauta/roteiro-do-episodio.ts`; a IA devolve JSON com ordem e texto, o sistema monta o markdown com o link do item (nunca o do modelo) e a palavra de corte no topo; gerar leva o status a `gravacao` (`POST /pauta/episodios/:id/roteiro/gerar`), editar (`PUT …/roteiro`), exportar (`GET …/roteiro.md`); palavra de corte por episódio (coluna nova, migration `20260924070000`) ou por empresa (nota `pauta.palavra-de-corte` da memória, só lida, criada por `POST /memoria`), padrão `root, corta`, e vale na hora (o lembrete do topo sai com a palavra efetiva no painel, no `.md` e no espelho); `blocoDeVoz` (`pauta/voz-da-pauta.ts`) é o ponto que o MC10 preenche no roteiro; espelho `ep-NN-roteiro-<id>.md` por `EspelhoService.espelharDocumento`; tela `SecaoRoteiro.tsx` com "Abrir para gravar" | P |
| MC9 | **Estação de mídia no Mac** · código ✅ 23/09/2026, falta o bruto real | MC7, D-MC2, D-MC3 | `/root-midia ep-NN` transforma um bruto real de 10 min em vídeo final + transcrição dentro do episódio, com os timestamps batendo com o vídeo final e o resultado no RASTRO | **mudou de desenho:** o MinIO da VPS não é público (`docker-compose.vps.yml` publica em `172.17.0.1`), então URL assinada não serve ao Mac e **o vídeo fica no Mac** — o OS recebe só o leve. **feito:** `GET /pauta/episodios/pendentes-midia` (gravação/edição, com a palavra de corte efetiva e o que falta), `POST …/:id/midia` (arquivos, durações, cortes por motivo, editor → Edição; mídia nova descarta a transcrição velha) e `POST …/:id/transcricao` (segmentos em ordem, dentro do vídeo final → grava `transcricao` + `transcricaoTexto` e vai a Pacote), todas `pauta.editar`, escrita condicionada e RASTRO (`pauta.episodio_midia`/`_transcricao`, sem a pasta do Mac); esquemas `PautaMidiaSchema`/`PautaTranscricaoSchema` no shared; o Mac entra pelo **login normal** da API (sem conta nova). No repo, `tools/root-midia/` (Node 22 sem dependência: `pendentes`, `silencios`, `cortes`, `cortar`, `transcrever`, `enviar`, `ensaio`; o `transcrever` grava também a legenda `.srt` ao lado do JSON) e a skill `SKILL.md` (PalmierPro primeiro, ffmpeg de reserva; instala por link simbólico). Seção "Mídia" no detalhe do episódio. Provado com clipe sintético e contra a API local; **falta** o bruto real de 10 min, que depende do modelo do whisper (D-MC3) | G |

### Fase 3 · Pacote do episódio

| # | Entrega | Depende | Pronto quando | Muda no repo | Tam |
|---|---|---|---|---|---|
| MC10 | **Perfil de voz do Pedro** ✅ no código 24/09/2026 (falta o teste cego) | MC9 | no teste cego, o Pedro prefere a versão com o perfil | `ContextItem` de chave fixa `voz.pedro` (kind `definicao`, sem migration), gerado de N transcrições e escrito via evento do RASTRO (ADR-011). **feito:** `VozService` + parte pura em `pauta/voz-da-pauta.ts`; `POST /pauta/voz/aprender` (episódios transcritos e/ou textos colados, com tetos) destila o perfil operacional por `SYSTEM_VOZ` e grava versão nova da nota pelo `MemoriaService` (procedência `promocao`); edição à mão `PUT /pauta/voz` com a versão lida (409); chave configurável pela nota `pauta.voz.chave`, presa a `voz.`; regras da marca somadas; `VozService.bloco` é o ponto único que o roteiro e as peças (SYSTEM_PECAS) usam, com queda no tom da casa (roteiro) ou no SYSTEM_PECAS de antes (peças); exceção de fronteira registrada na ADR-011; aba "Voz" em `/pauta`. **Pendente com o Pedro:** ligar o `SYSTEM_CURADORIA` (que escreve o miolo das peças com voz fixa) ao bloco, e confirmar que `pauta.editar` escreve a nota que vai ao modelo | M |
| MC11 | **Pacote do YouTube** · código ✅ 24/09/2026, falta um episódio real | MC9, D-MC4 | 3 títulos + descrição com capítulos saem da transcrição de um episódio real | títulos, capítulos e links por matéria a partir da transcrição; 3 thumbs no brand kit da Root, renderizadas no Mac. **feito:** `PacoteService` + parte pura em `pauta/pacote-do-episodio.ts`; `POST /pauta/episodios/:id/pacote/gerar` (3 títulos ≤100 com ângulos, descrição com abertura, capítulos nos tempos reais da transcrição conferidos pelas regras do YouTube — consertados ou tirados com motivo —, links só dos itens com link público, nunca da newsletter, o marcador `{{pagina-de-links}}` para o MC12 e hashtags; 3 briefs de thumb), `PUT …/pacote/titulo`, `GET …/thumbs`, `POST …/thumbs/:n` (PNG ≤2 MB para o MinIO) e a prévia; no Mac, `root-midia thumbs ep-NN` com o template `thumb.html` (tokens copiados da marca, não a máquina de carrossel) e o Chrome sem janela, provado com frame sintético (`root-midia ensaio-thumb`); seção "Pacote do YouTube" no detalhe do episódio. Mídia nova descarta o pacote; depois de agendado, título e thumb travam; no máximo 10 capítulos e folga de 200 bytes para a URL da página (o MC12 tem de caber nela). **Falta:** rodar com a transcrição de um episódio real (depende do whisper, D-MC3); provar o render pelo agent-browser (só o Chrome de `/Applications` foi provado). **Pendente com o Pedro:** editar o brief de uma thumb sem gerar o pacote inteiro de novo | M |
| MC12 | **Página de links do episódio** · código ✅ 24/09/2026 | MC8, D-MC5 | todo link citado no roteiro aparece na página e o clique vira `PixelEvent` | uma `BioPage` por episódio (handle `ep-NN`) via `bio.service.ts` (`salvarPage`, `criarLink:159`); conserto de `linkRastreado` (`pauta/publicacao.service.ts:41`), que hoje pendura o link na primeira página da empresa. **feito:** `PaginaDeLinksService` + parte pura `pauta/pagina-de-links-do-episodio.ts`; `POST /pauta/episodios/:id/pagina-de-links` (`pauta.editar`; handle `<slug>-ep-NN` com segundo candidato, porque o handle é global) e `…/publicar` (`pauta.publicar` + `bio.editar`, pelo mesmo `BioService.publicar` do `/bio`); um botão por matéria de link público (nunca a newsletter) + links da casa da nota `pauta.pagina-de-links.chamadas`; idempotente por `BioLink.chave` (migration `20260924080000_pauta_pagina_de_links`); página no ar só se remonta com `bio.editar`; a descrição do MC11 sai com a URL no lugar do marcador quando a página está no ar; `linkRastreado` pendura um link de campanha (`campanha:peca:<id>`, fora da página, mas o `/r/` segue e grava o `PixelEvent`) na página do episódio no ar, senão sai cru com o motivo no RASTRO, e o destino da peça segue a regra da página (nunca o Gmail); montar/publicar exigem o módulo `bio` contratado (403), o RASTRO guarda o antes/depois de cada botão e o plano vazio limpa a página existente; seção "Página de links" no detalhe, escondida sem o módulo bio. **Desvio:** página e botões gravados pelo Prisma em vez de `salvarPage`/`criarLink` (o `findUnique` do `salvarPage` não vê o handle de outra empresa sob RLS e o `criarLink` não aceita `chave`); publicar é o `BioService.publicar`. **Falta:** um episódio real publicado e um clique de verdade no `bio.operacaoroot.com` | M |
| MC13 | **Newsletter a partir da transcrição** · código ✅ 24/09/2026 | MC9, MC10, D-MC7 | a newsletter usa frases ditas no vídeo e passa no checklist anti-slop | derivação da newsletter parte da transcrição, não do `corpo`, com a voz do MC10; até D-MC7, sai como rascunho exportável. **feito:** `NewsletterService` + parte pura `pauta/newsletter-do-episodio.ts`; `POST /pauta/episodios/:id/newsletter/gerar` (título, abertura, uma seção por matéria falada com o link do item — nunca a newsletter L —, fechamento com `{{pagina-de-links}}` e `{{video}}`), gravada como `PautaPeca` newsletter/email da rodada com meta `{episodioId, origem: 'transcricao'}`; checagem anti-slop pura no shared (`checagemAntiSlop`: palavras proibidas, emoji, frases de IA, parágrafo > 60 palavras) que refaz uma vez e, persistindo, grava com os apontamentos; `GET …/newsletter.md`/`.html` com os marcadores trocados quando existem; `PUT …/newsletter/video`; seção "Newsletter" com Copiar e o aviso de envio manual; a checagem olha só o texto do modelo (fonte e chamadas do sistema ficam de fora) e os títulos do modelo perdem URL e marcador; gerar descarta a newsletter do miolo que ainda vale. **Decisão:** os links das seções saem crus (URL do item), sem `BioLink` — só a chamada para a página de links é medida — até a D-MC7. **Falta:** rodar com a transcrição de um episódio real (D-MC3) e a D-MC7 (destino) | P |
| MC14 | **Publicar no YouTube** | MC11, D-MC6 | V1 manual; V2 pela YouTube Data API como capacidade R3 | nada na V1 | — |

### Fase 4 · A semana de posts

| # | Entrega | Depende | Pronto quando | Muda no repo | Tam |
|---|---|---|---|---|---|
| MC15 | **Derivação por notícia** | MC9, MC10 | um episódio com 6 notícias vira 6 carrosséis, 6 stories e 6 cortes para revisar | `derivar()` (`rodada.service.ts:291`) roda por item; formatos `story` e `corte` em `PautaPeca.formato` (texto livre, sem migration); renders no Mac: carrossel a partir de `exportarCarrossel` (`publicacao.service.ts:200`), story no template da marca, corte vertical pelo PalmierPro com os timestamps do item; CTA com palavra-chave em cada peça | G |
| MC16 | **Calendário da semana** | MC15 | a semana aparece com os slots preenchidos e dá para arrastar e reagendar | `agendadaPara` em `PautaPeca` (migration); aba "Semana" | M |
| MC17 | **Publicação agendada no IG e no TikTok** | MC16, D-MC8, 403 da aprovação resolvido | uma peça aprovada publica sozinha no horário e aparece como publicada, com `externalId` | capacidades `instagram.post.publicar` e `tiktok.post.publicar` (o IG não apaga post por API: reversibilidade `manual`, nível sobe); efeito por registro; executor `pauta.publicar-agendadas`, que publica **só** peça já aprovada | G |
| MC18 | **DM por palavra-chave** | MC17, D-MC9 | especificação escrita; nenhuma linha de código antes de D-MC9 | só `docs/especificacoes/MC-18-*.md` | G |

**Por que MC18 é só especificação.** É resposta automática para terceiros, exposição externa em
massa, e a invariante 7 exige segunda pessoa a partir de R3. A regra "palavra-chave → mensagem"
precisa antes de um desenho de texto pré-aprovado com alcance na régua. Não se resolve abrindo a
régua.

## Decisões

| ID | Decisão | Estado | Recomendação ou o que foi aplicado |
|---|---|---|---|
| D-MC1 | Provedor da busca web | **aplicada** | Actor do Apify: o token e o teto de runs por mês já existem, então não entra fornecedor novo |
| D-MC2 | Palavra-chave de erro na gravação | pendente | Uma palavra curta e rara, na voz da Root — por exemplo "root, corta". Fixar no roteiro. **No código (MC8):** "root, corta" é o padrão e fica configurável por empresa (nota da memória `pauta.palavra-de-corte`, criada por `POST /memoria`; a tela Contexto só cria nota com a memória vazia) e por episódio — escolher a palavra continua com o Pedro |
| D-MC3 | Transcrição | pendente | Local no Mac (`mlx-whisper`, M5 com 16 GB), sem custo por minuto. É dependência nova, só no Mac, e dependência nova é decisão humana. **No código (MC9):** a `/root-midia` usa o `whisper-cli` (whisper.cpp, Homebrew) com um modelo ggml apontado por `WHISPER_MODEL` (ex.: `ggml-large-v3-turbo.bin` ou `ggml-small.bin`), não o `mlx-whisper` — baixar o modelo é a ação pendente do Pedro |
| D-MC4 | Thumbs | **aplicada no código** (MC11) | Template HTML da marca renderizado no Mac, não modelo de imagem: mantém a identidade e custa zero. `tools/root-midia/thumb.html` + Chrome sem janela; o frame sai do vídeo final pelo ffmpeg |
| D-MC5 | Pixel da Meta na página do episódio | pendente | Adiar. O `PixelEvent` do servidor já mede os cliques |
| D-MC6 | Upload no YouTube | pendente | Manual até o Pedro parar de corrigir o pacote; depois, a API |
| D-MC7 | Destino da newsletter | pendente | Em aberto: o Substack não tem API de publicar. Alternativas: Beehiiv, Gmail para uma lista, ou só rascunho |
| D-MC8 | Publicação no IG/TikTok | pendente | Pedir já o App Review da Meta (`instagram_content_publish`; a redirect `/api/conectar/:plataforma/callback` já está registrada). Até aprovar, a peça chega pronta para postar com um toque |
| D-MC9 | DM automática sob a régua | pendente | Desenhar "resposta pré-aprovada" como capacidade própria antes de construir |
| D-MC10 | Grupo e número do WhatsApp de links | **aplicada no código** | Grupo novo "Root · links" na instância dedicada do root que já existe. O código lê o grupo de `EVOLUTION_LINKS_JID` (MC1). **Fica com o Pedro:** criar o grupo, preencher a variável e configurar o webhook `messages.upsert` na instância — mudança em sistema externo |

## Esta onda

Branch **`root-os/maquina-de-conteudo`**, saída de `origin/main`. Nada vai para `main`, VPS ou
remoto nesta onda. O registro da onda vai para `docs/ESTADO-DA-EXECUCAO.md`, com hash, o número
medido e o que ficou de fora.

**Ordem:** MC1 → MC2 → MC3 → MC4 → MC6 → MC5.

**Concluída em 23/09/2026** (onda MC-A): seis commits, de `1f88073` a `5fab6e5`. Registro, números
medidos, ordem de deploy e tarefas do Pedro em `docs/ESTADO-DA-EXECUCAO.md` §1, onda MC-A.

MC6 vem antes de MC5 porque a rotina de quinta gera a rodada **sem curar**, e é o status
`aguardando_curadoria` da MC6 que dá nome a esse estado. As quatro primeiras são independentes
entre si e só tocam entrada. Nenhuma delas escreve para fora do OS: tudo é entrada ou leitura de
conector (R0).

**Fica fora desta onda:**

- MC7 a MC18 — as fases 2, 3 e 4 inteiras.
- As decisões pendentes (D-MC2 a D-MC9). Nenhuma é tomada por agente.
- Tudo o que é configuração em sistema externo: criar o grupo "Root · links", apontar o webhook do
  Evolution, rotular as newsletters no Gmail, cadastrar as fontes de creators.
- Deploy. A onda termina em commit na branch.

## O que trava e o que não trava

- **A aprovação está quebrada em produção.** O `db:sync-permissions` do deploy de 12/09/2026 segue
  pendente e a fila responde 403 para todo mundo (`docs/DEPLOY-12-09-2026.md` §1). Toda fatia que
  publica depende disso. As de entrada (MC1–MC6) não dependem.
- **O papel restrito cala as rotinas.** Quando ele virar (passo 16 de
  `docs/ESTADO-DA-EXECUCAO.md`), a consulta que descobre quais empresas varrer volta vazia sob
  policy e **nenhuma rotina dispara**. A rotina de quinta cai junto. É decisão humana, sem padrão
  seguro.
- **A prioridade diante do resto do plano é do Pedro:** as 22 decisões de A5, A6 e A8, a
  convergência com a base do Rodrigo (0.5), a virada do papel restrito, D-A (5.7) e N-9. MC1–MC6
  são pequenas, isoladas e dão resultado visível na primeira sexta, por isso cabem como frente
  paralela.

## O que cada fatia tem de respeitar

- **Tabela nova com empresa** leva `orgId`, e a migration liga RLS com FORCE e policies de leitura
  e escrita separadas (padrão de `20260911050000_isolamento_por_linha`). Filho usa a sentinela `''`
  e o gatilho `mktos_orgid_do_pai`, e entra em `FILHOS_COM_ORGID_REDUNDANTE`. Semente em
  `apps/api/test/tenant-isolation.test.ts`. Sem isso a conferência final aborta e a API não sobe.
- **Enum mudado no Prisma** tem espelho em `packages/shared/src/schemas.ts`, e o shared é
  recompilado (`pnpm --filter @mktos/shared build`).
- **Migration** nasce com `prisma migrate dev --create-only` contra o banco de teste, aplica com
  `db:deploy`, e `db:diff` sai "No difference detected".
- **Prefixo de rota novo** declarado em `apps/api/src/tenants/modulos.ts`. Prefixo não declarado
  lança em tempo de execução.
- **Escrita para fora** é capacidade em `packages/policy/politica-marketing-os.json`, com o nível
  batendo com `verificarCatalogo()`, e efeito por `gateway/efeitos.registry.ts`, nunca por import.
  `test/arquitetura.test.ts` fiscaliza. Capacidade nova em produção pede `db:seed:politica` antes da
  subida.
- **Permissão nova só se indispensável.** `pauta.ver`, `pauta.editar` e `pauta.publicar` já
  existem. Permissão nova custa três passos: build do shared, `db:sync-permissions`, todo mundo sai
  e entra.
- **Variável nova** vai no bloco `environment:` do `docker-compose.yml` **e** no `.env.example`.
  O container não lê arquivo `.env`.
- **IA** entra por `@Inject(LLM_PROVIDER)`, sempre com `orgId`, com modelo presente em
  `apps/api/src/llm/preco.ts`. JSON da IA passa por `pauta/parse-json.ts`.
- **Nada com injeção do Nest roda sob tsx ou vitest.** Teste de função pura e de service montado à
  mão com dublês, como os testes vizinhos. Script com Nest mora em `src/scripts/` e roda compilado.
- **Quem acrescenta arquivo ou caso de teste sobe o piso** em `.github/workflows/ci.yml` no mesmo
  commit, com a conta no comentário.
- **Dependência nova é decisão humana.** No repo, nenhuma nesta frente; no Mac, D-MC3.

## Verificação

**Por fatia**, vale o "pronto quando" da tabela. As suítes que rodam em toda fatia:

```
pnpm typecheck
pnpm --filter @mktos/api typecheck:test
pnpm --filter @mktos/api test
pnpm --filter @mktos/web test
pnpm --filter @mktos/policy test          # quando houver capacidade nova
pnpm --filter @mktos/api test:porta
pnpm --filter @mktos/api test:isolamento  # quando houver tabela nova
pnpm --filter @mktos/api db:diff          # quando houver schema novo
pnpm --filter @mktos/api build && pnpm --filter @mktos/api smoke
```

**Linha de base antes da onda** (clone da onda, banco de teste local com a política semeada,
23/09/2026): api 1233 passando / 557 pulados, web 398, policy 74, typechecks limpos.

Duas suítes da API contra o mesmo banco ao mesmo tempo se destroem (os fixtures usam ids fixos):
um banco por execução, ou em série.

**Deploy**, quando houver, pelo roteiro de `docs/DEPLOY.md` §2.0 e §5: tag de rollback e imagem
salva em disco; ensaio da migration em banco descartável; smoke na imagem com `ROTINAS_CRON=off`;
`db:seed:politica` antes do `up`; conferir a linha de boot das capacidades.

### O ensaio "episódio 00"

A frente só se prova ponta a ponta, com material real:

1. Uma semana real de links no grupo.
2. A rotina de quinta.
3. A curadoria.
4. O roteiro.
5. Uma gravação de 10 min.
6. `/root-midia ep-00`.
7. O pacote do episódio.
8. A derivação da semana.

Em cada etapa, medir o tempo humano gasto. É o número de "horas devolvidas" que falta no pitch da
Root, e ele sai do ensaio, não de estimativa.
