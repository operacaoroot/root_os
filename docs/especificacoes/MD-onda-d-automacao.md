# Onda D — automação da máquina de conteúdo (da transcrição ao post no horário, com um ponto humano por semana)

> Especificação escrita em 24/09/2026 na branch `root-os/maquina-de-conteudo`, por cima das ondas
> MC-A, MC-B e MC-C (`docs/PLANO-MAQUINA-DE-CONTEUDO.md`). Prefixo das fatias: **MD**. É o desenho
> das 13 fatias que levam a frente da publicação manual (MC16) à publicação no horário, com a
> aprovação humana concentrada num ponto por semana. **Não é código.** Cada fatia vira um commit
> próprio, na ordem do fim deste documento.
>
> As decisões da onda foram tomadas pelo Pedro em 24/09/2026 ("seguir as recomendações, o máximo
> de automação; o que depende de conta, painel ou assinatura minha fica manual") e estão em
> "Decisões da onda D". O que depende de conta, painel ou assinatura dele está marcado **manual** em
> cada fatia e consolidado em "O que fica com o Pedro". O que está marcado **a conferir** não foi
> confirmado em documentação oficial nesta data e tem de ser conferido no início da fatia que
> depende dele.


## De onde vem

O Pedro pediu o máximo de automação para a semana de conteúdo e lembrou de um repositório
open-source que prometia publicar "sem interação humana". A pesquisa de 24/09/2026 teve quatro
frentes: o repositório (e o que existe de publicador aberto), o Instagram, o YouTube e a DM. As
fontes estão no fim; aqui ficam as conclusões que mudam o plano.

### 1. Para a conta da própria Root, publicar no Instagram não passa por App Review

A documentação da Meta diz que um app que só atende a conta profissional do dono, ou uma conta que
ele gerencia, precisa apenas de **Standard Access**, que é concedido automaticamente e vale para
quem tem papel no app (administrador, desenvolvedor ou testador). App Review e verificação da
empresa só entram no **Advanced Access**, exigido para contas de terceiros. Na trilha do Login do
Instagram, publicar pede `instagram_business_basic` + `instagram_business_content_publish`.

Consequência: a MC17 (publicação no Instagram), que estava em espera pela D-MC8 (App Review), sai
para a conta da Root sem esperar a Meta. O que continua segurando é a governança do próprio OS: o
403 da fila em produção e a segunda pessoa. A D-MC8 passa a valer só para publicar em conta de
cliente e para o webhook de comentários.

Detalhes do fluxo, conferidos na página "Content Publishing" e na referência de `IG User Media`:

- duas chamadas: `POST /<IG_ID>/media` cria o container e `POST /<IG_ID>/media_publish` publica;
  entre as duas, `status_code` consultado uma vez por minuto, por no máximo 5 minutos; container não
  publicado expira em 24 h;
- teto de 100 posts por API em 24 h móveis (carrossel conta 1), consultado em
  `GET /<IG_ID>/content_publishing_limit`; carrossel com até 10 itens;
- imagem só em **JPEG**, até 8 MB, largura de 320 a 1440 px, aspecto de 4:5 a 1,91:1 (o PNG de
  1080×1350 da MC15 passa depois de convertido);
- Reels: MP4/MOV com o `moov` no início, H.264/HEVC, AAC até 48 kHz, 23–60 fps, de 3 s a 15 min, até
  300 MB; Stories: `media_type=STORIES`, vídeo de 3 a 60 s e até 100 MB, sem sticker de link;
- **a mídia precisa estar numa URL pública** no momento da chamada (a Meta baixa o arquivo). O
  upload retomável, que aceita arquivo local, só existe na trilha do Login do Facebook for Business.
  O MinIO da VPS não é público e o mp4 do corte mora no Mac, então nenhuma URL que a Meta consiga
  baixar existe hoje. É isso que a MD4 resolve.

**A conferir:** se um post publicado com o app em modo de desenvolvimento aparece para quem não tem
papel no app (a página de modos diz que dado de teste só é visto por quem tem papel, mas a regra é
da plataforma Facebook, e apps do tipo Business declaram não ser sensíveis ao modo). O primeiro
Story real responde.

### 2. O YouTube trava como privado todo vídeo de projeto sem auditoria

Todo vídeo enviado por `videos.insert` a partir de projeto de API não verificado, criado depois de
28/07/2020, fica **restrito ao modo privado** até o projeto passar pela auditoria de conformidade.
A trava **não tem recurso**: ninguém muda a visibilidade, nem pelo Studio, e o vídeo precisa ser
reenviado. A auditoria é pedida pelo formulário "YouTube API Services - Audit and Quota Extension",
que pede política de privacidade publicada, conta de demonstração e o número do projeto; a
documentação oficial não informa prazo (relatos de terceiros falam em semanas).

Consequências para o desenho:

- a MC14 V2 (YouTube pela API) só publica de verdade depois da auditoria; antes dela, qualquer
  upload real serve só como teste, e teste só em **canal de teste**;
- `videos.update`, `playlistItems.insert` e `videos.delete` **não aceitam** o escopo
  `youtube.upload`: o conector pede `youtube.upload` + `youtube.force-ssl`;
- `status.publishAt` só funciona com `privacyStatus: private` em vídeo que nunca foi publicado;
- em tela de consentimento External com status "Testing", o refresh token vence em 7 dias;
- cota não pesa: 1 de 100 `videos.insert` por dia e ~150 de 10.000 unidades por episódio.

### 3. O webhook de comentários só chega com Advanced Access — ler por consulta não precisa

A página de Webhooks da Meta é explícita: o app precisa estar em **Live** e o **Advanced Access** é
exigido para receber `comments`, sem exceção para a conta do dono. Como Advanced Access exige App
Review e verificação da empresa, a DM disparada por webhook (MC18.3) não sai antes da Meta.

A pesquisa achou um atalho oficial que a MC18 não previa: **ler** os comentários da própria conta
(`GET /<IG_MEDIA_ID>/comments`, com `instagram_business_manage_comments`) funciona com Standard
Access, pela página "Comment Moderation". Isso permite montar a fila "quem comentou e o que
responder" já (MD9), por consulta periódica, sem App Review. A **resposta privada** automática com
Standard Access muito provavelmente falha para quem não tem papel no app: um repositório de
automação comentário→DM documenta o erro `100/2534001` nesse caso (**provável**, fonte de campo, não
oficial). Por isso a DM automática (MD11) fica implementada e desligada até o App Review.

Outros números que a MC18 tinha como "a conferir" e que ficaram confirmados: texto da mensagem com
limite de **1000 bytes** UTF-8 (não caracteres); resposta privada uma por comentário, em até 7 dias;
teto de 750 respostas privadas por hora por conta; reentrega do webhook por 36 h; aviso de mensagem
automática no início da conversa. A Graph `v21.0`, fixada em `META_GRAPH_URL`, vale até 21/01/2027
(a `v24.0` vale até 18/02/2028).

### 4. O repositório open-source mais provável, e o que se aproveitou dele

Nenhum repositório aberto publica de ponta a ponta sem uma de duas muletas: um intermediário pago
(Upload-Post, Post for Me, Arcade, Post Bridge) ou automação de navegador com perfil logado.

| Candidato | O que é | Por que não entra |
|---|---|---|
| **`harry0703/MoneyPrinterTurbo`** (125.485 estrelas, MIT, push em 24/09/2026) — o mais provável | Do tema ao vídeo curto sem rosto (roteiro por LLM, banco de imagens, voz sintética, legenda); publica no TikTok, Instagram e YouTube Shorts pelo SaaS Upload-Post, com `upload_post_enabled` e `upload_post_auto_upload` desligados por padrão | A peça-mãe da Root é o vídeo gravado pelo Pedro, não vídeo de banco de imagens; e o "um clique" guarda os tokens das redes num terceiro |
| `calesthio/OpenMontage` (61.154 estrelas, AGPL, criado em 29/03/2026) | Transforma o Claude Code num estúdio de vídeo, com portões de aprovação humana no roteiro e no storyboard e custo por provedor | AGPL; não publica |
| `gitroomhq/postiz-app` (36.284 estrelas, AGPL) | O único publicador self-hosted mantido com IG, TikTok e YouTube; mesmo stack do OS (Nest, Next, Prisma) mais Temporal; API com `draft`/`schedule`/`now` e MCP | Serviço novo com cofre de tokens fora do OS, Temporal e Postgres próprios numa VPS que já vive no teto; para a conta da Root a Graph direto pelo OS resolve |
| `mutonby/openshorts` (MIT, exceto `cloud/`) | Corta vídeo longo em shorts com nota de momento viral e modo SCREENCAST (tela em cima, apresentador embaixo) | Publica pelo Upload-Post |
| `MoneyPrinterV2`, `social-auto-upload` | Sobem vídeo por Selenium/automação de navegador com perfil logado | Fere os termos das plataformas e não deixa aprovação nem RASTRO confiáveis |

**O que se aproveitou, só como ideia, sem uma linha de código deles:**

- os interruptores `enabled`/`auto_upload` **desligados por padrão** (MoneyPrinterTurbo) viraram a
  regra da onda: toda automação nasce desligada e quem liga é o Pedro (tabela de interruptores
  abaixo);
- o **privado por padrão** do `youtube-shorts-pipeline` virou o envio sempre `private` da MD10;
- `draft`/`schedule`/`now` e o **upload de mídia separado do post** (Postiz) viraram a separação entre
  a mídia no storage com URL assinada (MD4) e o container da Meta (MD6);
- os **portões de aprovação** e o custo por provedor (OpenMontage) batem com a régua e com
  `apps/api/src/llm/preco.ts`, que o OS já tem;
- a **nota de momento com motivo** (OpenShorts) virou a MD13; o modo SCREENCAST confirma o layout do
  corte que a MC15 já faz.

O vídeo da Ratos de IA, que é o modelo da frente, também não é "zero humano": a descrição diz que o
autor escolhe as notícias, grava, revisa e publica no YouTube, e agenda IG e TikTok pelo Post for Me.

### 5. TikTok: sem auditoria, sai privado

Cliente não auditado da Content Posting API publica tudo em modo privado (`SELF_ONLY`), com a conta
privada na hora de postar e no máximo 5 usuários em 24 h. O modo `MEDIA_UPLOAD` (escopo
`video.upload`) manda o vídeo para a caixa de entrada do app, onde o criador termina o post; se esse
modo também sai privado sem auditoria é **a conferir**. O ganho da automação é pequeno enquanto isso
não mudar, e por isso a MD12 fica em espera.


## O que a onda entrega, visto da semana do Pedro

- **Sexta:** a transcrição chega do Mac (o vigia da MD2 dispara o `root-midia` sozinho quando aparece
  gravação nova) e o OS anda sozinho até a semana em rascunho (MD1): pacote, página de links montada,
  newsletter, 12 peças e os slots propostos. Nada sai do OS.
- **Segunda:** o Pedro revisa a semana na aba Semana e clica em **"Aprovar a semana"** (MD8). O Lucas
  ou o Rodrigo assinam com senha e motivo em `/atendimento` — uma assinatura cobre o conteúdo exato
  de cada peça (MD7).
- **De segunda a sexta:** com a publicação automática ligada, o OS publica cada peça no Instagram na
  hora do slot (MD6); o YouTube recebe o `publishAt` e publica sozinho (MD10, depois da auditoria).
  A fila de quem comentou a palavra-chave aparece pronta para responder à mão (MD9), até a DM
  automática ser ligada (MD11, depois do App Review).

**Nenhuma fatia pede dependência npm nova.** A onda absorve a MC14 (→ MD10), a MC17 no Instagram
(→ MD4 a MD8; o TikTok vai para a MD12, em espera) e a MC18.0 a MC18.4 (→ MD9 e MD11; o webhook da
MC18.3 sai da primeira versão e volta depois como melhoria de latência).


## Decisões da onda D

Tomadas pelo Pedro em 24/09/2026, seguindo as recomendações do desenho. Nenhuma foi tomada por
agente.

| ID | Decisão | Como fica no código | Atrás de interruptor? |
|---|---|---|---|
| **D-MD1** | Aceitar o **uso contado** na invariante 4 para aprovação de lote (estende a D-MC9.1 da DM às publicações) | **Implementar** como na MD7: a invariante 4 passa a "uso único — ou uso contado, item a item, quando a capacidade declara lote", com consumo atômico e teste de corrida | **Sim, dois portões.** (1) A publicação automática nasce **desligada** por interruptor da empresa (nota `pauta.publicacao.automatica`, MD6/MD8). (2) Só vale depois do `db:seed:politica` **assinado** com `POLITICA_CAPACIDADE_NOVA_*` e `POLITICA_REBAIXAMENTO_*`: sem ele as capacidades novas não existem na política do banco e valem R5 pela falha fechada. **A assinatura do seed é o portão humano** |
| **MD3** | Janela da porta (`fora_da_janela`) no fuso de São Paulo | **Aplicar**, com o fuso configurável pela variável `POLITICA_FUSO_HORARIO` (padrão `America/Sao_Paulo`), no compose e no `.env.example`, e registrado como **mudança de comportamento** no ESTADO: para todas as capacidades, o sinal deixa de acender das 17h às 20h de SP e passa a acender das 05h às 08h | Não; é conserto |
| **MD4** | O mp4 do corte passa a morar no storage da VPS, servido à Meta por URL pública assinada de prazo curto | **Aplicar**: rota de upload por stream com teto, URL assinada por HMAC com validade de no máximo 1 h, conferida antes do banco. Muda a decisão da MC9/MC15 (o mp4 ficava só no Mac); nada é apagado no Mac | Não |
| **D-MC6** | YouTube pela API | **Implementar a MD10 completa**. O conector `youtube` nasce **desligado** e sem credencial até o Pedro fazer o OAuth; o envio é **sempre privado**, e a publicação só roda com `YOUTUBE_AUDITORIA=aprovada` | **Sim:** conector desligado até o OAuth; `YOUTUBE_AUDITORIA` (padrão `pendente`) segura envio e publicação |
| **D-MC9.x** | DM por palavra-chave: aplicar as recomendações da MC18 com os ajustes da pesquisa | D-MC9.1 (d) já e (a) como destino; D-MC9.2 teto 200 no catálogo e 100 por regra; D-MC9.3 (a); D-MC9.4 7 dias, 08h–20h de SP pelo executor; D-MC9.5 texto fixo; D-MC9.6 (a) link de campanha por matéria; D-MC9.7 (a) o CTA fica e a resposta é à mão; D-MC9.8 trilha do Login do Instagram, com `META_WEBHOOK_APP_SECRET` explícito quando o webhook voltar; D-MC9.9 só HMAC da pessoa; D-MC9.10 sem resposta pública. Ajustes: texto medido em bytes (≤ 1000), linha de aviso de mensagem automática, ignorar comentário com `ad_id`, da própria conta ou com mais de 7 dias, prefixo `webhooks/meta` fora do `meta` | **MD9 liga já** (fila manual + coletor; basta a rotina). **MD11 fica implementada e desligada** pela nota `pauta.dm.automatica` até o App Review |
| **MD12** | TikTok pela caixa de entrada | **Não fazer nesta onda.** Registrada como **em espera** | — |
| — | Segunda pessoa (titular) e 403 da fila em produção | **Manuais do Pedro.** O código **não** contorna a segunda pessoa: nada de "propor em nome do agente" (D-MC9.3 b), nada de rebaixar degrau, e `publicar-peca.test.ts` fica intocado | — |

### Os interruptores, e o estado em que cada um nasce

Toda automação da onda nasce desligada. A tabela é a lista do que o Pedro liga, e em que ordem faz
sentido.

| Interruptor | Fatia | Onde | Nasce | O que liga |
|---|---|---|---|---|
| Rotina `pauta.encadear` | MD1 | `/rotinas` ("Nova rotina de encadeamento") | inexistente: nada anda sozinho | o OS andar da transcrição à semana em rascunho |
| Vigia do Mac | MD2 | `root-midia vigia instalar` (launchd) | não instalado | o `root-midia` rodar quando aparece gravação nova |
| Seed da política assinado | MD6, MD7 | `db:seed:politica` com as duas assinaturas | não rodado: as capacidades novas valem R5 e a porta bloqueia | existir `instagram.post.publicar`, `pauta.semana.aprovar`, a invariante 4 nova e as capacidades de YouTube e DM |
| Rotina `pauta.publicar-agendadas` | MD6 | `/rotinas` | inexistente | o executor olhar as peças agendadas |
| **Publicação automática da empresa** | MD6, MD8 | nota da memória `pauta.publicacao.automatica` (primeira linha `ligada`), escrita só pelo `MemoriaService` | desligada | o executor publicar item de lote ativo no horário; desligada, grava `pulada: publicação automática desligada` e a peça segue manual (MC16) |
| Conector `instagram` (RF-G-06) | MD5–MD11 | `/conexoes` | como está hoje | desligar barra toda chamada à Graph da empresa, inclusive aprovação já assinada |
| Conector `youtube` | MD10 | `/conexoes` + OAuth | desligado, sem credencial | abrir sessão de envio e publicar |
| `YOUTUBE_AUDITORIA` | MD10 | variável de ambiente | `pendente`: sessão de envio e publicação recusadas | `teste`: envio liberado para canal de teste, publicação recusada; `aprovada`: tudo |
| Rotina `pauta.coletar-comentarios` | MD9 | `/rotinas` | inexistente | a fila de comentários se montar sozinha ("liga já") |
| **DM automática** | MD11 | nota `pauta.dm.automatica` | desligada | o envio da resposta privada sob o lote; desligada, a fila manual da MD9 continua |
| Papel restrito (passo 16 do ESTADO) | todas | operação na VPS | não virado | virado, **nenhuma rotina dispara** — as desta onda inclusive — até a decisão do agendamento |


## As fatias

Convenção de tamanho do plano: **P** ≤ 1 dia de agente, **M** 2–4 dias, **G** 1–2 semanas. O tamanho
abaixo é estimativa deste documento. "Pronto quando" é sempre um comportamento demonstrável; cada
fatia termina com as suítes verdes e os pisos da CI subidos no mesmo commit.

| # | Entrega | Depende | Tam |
|---|---|---|---|
| MD1 | Encadeamento no OS: da transcrição à semana em rascunho, parando antes de qualquer saída | MC-C; D-MC11 | M |
| MD2 | Vigia do Mac: launchd dispara o `root-midia` quando aparece gravação nova, sem nunca apagar o bruto | MC9, MC15; D-MC3 para o bruto real | M |
| MD3 | Janela da porta no fuso de São Paulo | — | P |
| MD4 | Mídia da peça no OS: JPEG, mp4 do corte por streaming com teto e URL pública assinada | MC15; `S3_*` | M |
| MD5 | Conexão de publicação do Instagram (trilha Login do Instagram) e Graph v24 | — | M |
| MD6 | Publicador do Instagram: capacidade R3, efeito por registro, máquina de estados e executor | MD3, MD4, MD5 | G |
| MD7 | A régua aprende a aprovação de lote com uso contado (MC18.1 generalizada) | MD6; D-MD1 | G |
| MD8 | Aprovar a semana num ponto só: o lote com o conteúdo exato, assinado por outra pessoa | MD1, MD4–MD7 | M |
| MD9 | DM mínima: fila de respostas com o link rastreado (MC18.0) e coletor de comentários por consulta | MD5; MD6 ou MC16 | M |
| MD10 | YouTube: conector próprio, upload resumable pelo Mac e publicação agendada pelo OS | MD7, MD8; MD2 opcional; D-MC6 | G |
| MD11 | DM automática sob o lote, disparada pelo coletor | MD7, MD8, MD9; App Review | M |
| MD12 | TikTok pela caixa de entrada — **em espera** | MD6, MD8 | M |
| MD13 | Corte com nota e motivo | MD1 | P |


### MD1 — Encadeamento no OS: da transcrição à semana em rascunho

> **Estado (24/09/2026):** implementada, com o ensaio do "pronto quando" e a revisão registrados no
> `docs/ESTADO-DA-EXECUCAO.md` (§1, onda D). Escolhas além do texto abaixo: os slots são propostos a
> partir do **dia seguinte**; o distribuir manual usa o slot proposto da peça aprovada quando ele
> ainda está livre e na grade; "sem newsletter"/"sem peças" contam as **descartadas** como existentes
> (a rotina só gera onde nunca houve nada) e a página apagada no `/bio` não é recriada; a semana
> parcial é `erro` e a passagem seguinte refaz só as matérias sem peça.

**SPEC.** Quando a transcrição chega (`POST /pauta/episodios/:id/transcricao`), o OS anda sozinho até
a semana distribuída **em rascunho** e para nos pontos humanos. Não publica nada.

1. **Rotina nova `pauta.encadear`:** `TIPO_PAUTA_ENCADEAR` em `apps/api/src/routines/rotina.tipos.ts`,
   dentro de `TIPOS_DA_PAUTA`, `AGENTE_DO_TIPO` (`editor-de-pauta`) e `MODULO_DO_TIPO` (`pauta`);
   config conferida em `routines/nova-rotina.ts`, `{ etapas?: ('pacote'|'pagina'|'newsletter'|'semana'|'slots')[] }`
   (sem `etapas`, todas); executor em `routines/executores/pauta-encadear.executor.ts`, registrado
   em `routines.module.ts` no molde de `pauta-coleta.executor.ts`; cron sugerido `*/5 * * * *` em
   `America/Sao_Paulo`. **O interruptor é a própria rotina:** sem ela criada, nada roda.
2. **Função pura `proximoPasso(ep)`** em `pauta/encadeamento-do-episodio.ts`: Pacote com transcrição e
   sem títulos → `pacote`; com títulos, sem `bioPageId` e com o módulo `bio` → `pagina` (só montar);
   sem newsletter com `meta.episodioId` → `newsletter`; sem peças da semana → `semana`; peças em
   rascunho sem slot → `slots`; no resto, `parar` com motivo (renders pendentes no Mac, página fora
   do ar, aguardando aprovação). **Nunca devolve publicar.** Um passo por episódio por passagem, no
   máximo 2 episódios.
3. **Os passos reaproveitam o que existe:** `PacoteService.gerar`, `PaginaDeLinksService` (montar,
   nunca publicar — publicar fica no ponto único da MD8), `NewsletterService.gerar`,
   `DerivacaoService.gerar` e um método novo `AgendaService.proporSlots`, que usa o `distribuir` puro
   de `pauta/agenda-da-semana.ts` para gravar `slotProposto` em peças **rascunho**. `agendadaPara`
   continua exclusivo de peça aprovada. Tudo passa por `umaPorVez` (`pauta/uma-por-vez.ts`) com as
   **mesmas** chaves dos controllers: o clique manual simultâneo vira `pulada`, sem pagar a IA duas
   vezes.
4. **Migration `pauta_peca_slot_proposto`:** `PautaPeca.slotProposto DateTime?` e índice
   `(orgId, slotProposto)` (a tabela já tem RLS). O "refazer mídia" (`b07c35c`) e o derivar de novo
   zeram o slot; o slot proposto não colide com `agendadaPara` nem com o `slotProposto` de outro
   episódio; o PATCH manual de status não converte slot proposto em agenda.
5. **RASTRO e erros:** cada passo grava `pauta.encadeamento_passo` (etapa, episódio, resultado), com
   o ator sistema e a correlação da rotina. Erro de IA ou teto de custo devolve `erro` com a etapa e
   não avança; três erros seguidos na mesma etapa viram `pulada` com aviso, até alguém mexer.
6. **API e shared:** `GET /pauta/episodios/:id/encadeamento` (`pauta.ver`), com o próximo passo e o
   motivo da parada; `PAUTA_ETAPAS_DO_ENCADEAMENTO` e o schema da config no shared.
7. **UI:** "Nova rotina de encadeamento" em `/rotinas`; no detalhe do episódio, a linha "Próximo passo
   automático"; na aba Semana, o slot proposto em cinza com "proposto, falta aprovar".
8. **Testes:** `apps/api/test/pauta-encadeamento.test.ts` (a função pura em cada estado, nunca
   publica, newsletter sem transcrição para); o service montado à mão com dublês (um passo por
   passagem, 409 do `umaPorVez` como `pulada`, slot sem colisão, refazer mídia limpando o slot); teste
   da web para o slot proposto.

**Pronto quando.** API compilada contra banco criado do zero, LLM dublê e empresa descartável: com a
rotina criada, o POST da transcrição do ep-01 e o "Rodar agora" repetido levam, em até 5 passagens, o
episódio a Derivação com pacote, página de links em rascunho e newsletter; as 12 peças em rascunho com
`slotProposto` e `agendadaPara` nulo; um `pauta.encadeamento_passo` por etapa no RASTRO e o gasto de
IA contado no teto da empresa; zero chamadas a Evolution ou Meta. Sem a rotina, nada acontece. Um
"Gerar semana" manual no meio da passagem faz a rotina registrar `pulada`, sem segunda cobrança.
Suítes verdes e `db:diff` limpo.

**Manual.** Criar a rotina em `/rotinas` depois do deploy; decidir a virada do papel restrito; D-MC11
(a grade, de onde saem os slots propostos).

**Risco.** A IA gasta sem ninguém olhando; o teto de custo por empresa e o passo único por passagem
seguram. Os prompts da frente nunca rodaram com modelo real, então a primeira semana pode sair ruim
em cadeia, e isso só aparece na revisão. Com o papel restrito virado, tudo cala sem erro visível.


### MD2 — Vigia do Mac: launchd dispara o `root-midia` quando aparece gravação nova

> **Estado (24/09/2026):** implementada, com o "pronto quando" ensaiado pelo launchd de verdade
> (plist carregado de uma pasta temporária, API local, transcrição de ensaio porque o modelo do
> whisper não está no Mac) e registrado no `docs/ESTADO-DA-EXECUCAO.md` (§1, onda D). Escolhas além
> do texto abaixo: quem carimba o `statusDesde` é um **gatilho** do banco (o status muda por cinco
> serviços, nem todos pelo `EpisodioService`); a fila devolve `derivacao` como lista à parte (a
> `items` segue sendo a do `enviar` manual); a passagem **espera** até 5 min um bruto novo ficar
> maduro (senão o `WatchPaths` dispararia cedo demais e só o intervalo de 15 min o pegaria); bruto
> que falhou e render repetido com a mesma assinatura não giram a cada passagem; a notificação
> repetida fica calada por 6 h; a trava fica ao lado do arquivo de variáveis; o final nunca
> sobrescreve um que já está na pasta. A subida do mp4/JPEG (MD4) e o YouTube (MD10) ainda não
> estão no vigia: entram no passo dos renders quando essas fatias chegarem.
>
> **Depois da revisão (24/09/2026):** a fila da Derivação é lida do mais novo, em lotes de 20, até
> juntar 20 com render pendente (os antigos parados lá escondiam o da semana); a cadeia relê a fila
> antes de mandar e não envia se o episódio saiu de Gravação no meio (a mídia mandada à mão não é
> trocada pelo corte do ffmpeg); a trava é tomada atrás de uma porta exclusiva (`wx`), que é o único
> arquivo que o vigia remove; o `instalar` confere e monta os caminhos só com o arquivo de
> variáveis; os renders esperam com o OBS gravando; o carrossel estourado e o corte sem trecho viram
> notificação; os renders vão para `<OBS>/root-midia/ep-NN/ep-NN-semana` (sob o launchd o diretório
> atual é `/`); "vários em Gravação" só avisa com gravação nova na pasta. **Desvio do item 6:** o
> `ensaio-vigia` ficou subcomando manual, como o `ensaio` da MC9 (a CI não tem ffmpeg); a decisão da
> passagem (`passoDoBruto`, com disco, relógio, espera e cadeia injetados) é que está na suíte, com
> os caminhos ambíguo, gravando, jovem, sem modelo, cadeia que falha, bruto já falho e episódio que
> mudou.

**SPEC.**

1. **Arquivos:** `tools/root-midia/lib/vigia.mjs`; subcomandos novos em `tools/root-midia/root-midia.mjs`:
   `vigia` (uma passagem e sai) e `vigia instalar|desinstalar|estado`.
2. **Uma passagem:**
   - (a) trava em `~/.config/root/root-midia-vigia.lock` com pid e hora, vencida em 3 h; segunda
     instância sai calada;
   - (b) `GET /pauta/episodios/pendentes-midia` por `lib/os.mjs`, com o login de
     `~/.config/root/root-midia.env`; só age com **exatamente um** episódio em `gravacao` sem mídia;
   - (c) procura o bruto na **raiz** de `ROOT_MIDIA_OBS_DIR` (novo, padrão `~/Movies/OBS`, sem descer
     a subpastas — `root-midia/ep-NN` fica fora): `.mkv`, `.mp4` ou `.mov` com `mtime` posterior ao
     `statusDesde` do episódio; estável só com tamanho e `mtime` iguais em duas leituras a 60 s e
     `mtime` com mais de 2 min; OBS gravando pula; mais de um candidato notifica "ambíguo: rode
     /root-midia ep-NN" e sai;
   - (d) roda a cadeia do comando manual **só pelo ffmpeg** (o PalmierPro exige o app aberto):
     `silencios` → `cortes` com a palavra efetiva que a rota devolve → `cortar` → `transcrever` →
     `enviar --final --bruto --cortes --transcricao`. Sem `WHISPER_MODEL`, notifica e para. **Nunca
     baixa modelo** (D-MC3);
   - (e) se `GET /pauta/episodios/:id/semana` indicar peças sem render, roda `cortes-verticais`,
     `stories` e `carrosseis`; depois da MD4, sobe também o mp4 e o JPEG; depois da MD10, faz o upload
     do YouTube quando o lote tiver o item;
   - (f) notifica por `osascript -e 'display notification …'` (array de argumentos);
   - (g) log em `~/Library/Logs/root-midia/vigia.log`, rotacionado em 5 MB.
3. **Nunca apagar:** nenhum `unlink`, `rm` ou `rmSync` em caminho sob `ROOT_MIDIA_OBS_DIR` fora de
   `root-midia/`; o bruto só é lido. Um teste-catraca varre `lib/*.mjs` e `root-midia.mjs` e só aceita
   as remoções que já existem, em pasta temporária.
4. **Instalar e desinstalar:** `vigia instalar` grava
   `~/Library/LaunchAgents/com.operacaoroot.root-midia.vigia.plist` com `ProgramArguments =
   [process.execPath, <caminho absoluto do root-midia.mjs>, 'vigia']`, `WatchPaths =
   [ROOT_MIDIA_OBS_DIR]`, `StartInterval = 900` (renders e uploads que não dependem de arquivo novo),
   `ThrottleInterval = 60`, `StandardOutPath`/`StandardErrorPath` no log e `EnvironmentVariables` só
   com `ROOT_MIDIA_ENV` — **a senha fica no arquivo com permissão 600, nunca no plist** — e roda
   `launchctl bootstrap gui/<uid> <plist>`. `desinstalar` roda `launchctl bootout
   gui/<uid>/com.operacaoroot.root-midia.vigia` e apaga só o plist. `estado` roda `launchctl print` e
   mostra a última linha do log. Ficou o launchd porque é nativo, observa pasta e instala e remove
   com um comando; o cron do macOS não observa pasta e pediria acesso total ao disco.
5. **API:** migration `pauta_episodio_status_desde` com `PautaEpisodio.statusDesde DateTime
   @default(now())`, gravada em toda transição de `EpisodioService.status`; `pendentes-midia` passa a
   devolver `statusDesde` e `precisaDeRender` para os episódios em Derivação; schema no shared,
   recompilado.
6. **Testes** (na suíte da api, `root-midia.test.ts`): escolha do bruto (estável, gravando, ambíguo,
   anterior à transição); a trava; o plist gerado, com as chaves certas e sem senha; a catraca do
   não-apagar; `ensaio-vigia`, que gera um bruto sintético pelo `ensaio` numa pasta temporária e roda
   uma passagem contra a API local; `pauta-episodio.test.ts` cobrindo o `statusDesde`.

**Pronto quando.** Mac com API local, LLM dublê e `ROOT_MIDIA_OBS_DIR` numa pasta de teste:
`root-midia vigia instalar` → `launchctl print gui/$UID/com.operacaoroot.root-midia.vigia` mostra o
agente; um bruto sintético copiado para a pasta com o ep-01 em Gravação chega a Pacote com
transcrição em até 3 min (whisper com modelo pequeno, ou transcrição de ensaio sem modelo) e a
notificação aparece; o `sha256` do bruto é o mesmo antes e depois; dois brutos novos ao mesmo tempo →
"ambíguo" e nada enviado; `vigia desinstalar` → `launchctl print` falha e o plist sumiu.

**Manual.** Baixar o modelo do whisper e apontar `WHISPER_MODEL` (D-MC3); criar
`~/.config/root/root-midia.env` (`ROOT_OS_API_URL`, `ROOT_OS_EMAIL`, `ROOT_OS_SENHA`) com `chmod 600`;
rodar `root-midia vigia instalar` uma vez (o macOS pode pedir permissão para o node ler `~/Movies`,
**a conferir**); manter o hábito de pôr o episódio em Gravação antes de gravar — é isso que diz ao
vigia qual episódio é o do bruto.

**Risco.** Processar um arquivo que não era o episódio; a exigência de um episódio em gravação,
`mtime` posterior à transição e candidato único reduz. Mac dormindo não vigia (o launchd roda ao
acordar). ffmpeg e whisper pesam se dispararem durante uma reunião. A senha do OS fica em arquivo
local, como já é hoje. **Pausa longa:** o único sinal de "ainda gravando" é o arquivo mudar; uma
pausa do OBS maior que 2 min parece gravação terminada, e a passagem que cair nela manda a fala
parcial (o episódio vai a Pacote e o resto é ignorado). O vigia pressupõe um arquivo por episódio
sem pausa longa; com pausa longa, parar a gravação e rodar `/root-midia ep-NN` à mão (README, SKILL
e a dica da tela dizem isso).


### MD3 — Janela da porta no fuso de São Paulo

> **Estado (24/09/2026):** implementada, com o ensaio pelo HTTP e a revisão registrados no
> `docs/ESTADO-DA-EXECUCAO.md` (§1, onda D, e item 25 da §4). Escolhas além do texto abaixo: a hora
> vem de `partesNoFuso` do `@mktos/shared` (a mesma conta da agenda da semana), e `FUSO_DA_POLITICA`
> é a própria `PAUTA_FUSO_DA_AGENDA`; a agenda **não** lê `POLITICA_FUSO_HORARIO`; o simulador da
> Régua aceita `momento` (ISO) e `agora: true`, e o "Agora" usa o relógio do **servidor**, não o do
> navegador; fuso inválido derruba o arranque. Quem decidir por hora de SP depois (a D-MC9.4 é a
> primeira) usa `minutosNoFuso` de `policy/limites.ts`.

**SPEC.**

1. **Onde está o erro:** `apps/api/src/policy/sinais.service.ts:230` calcula `agora.getHours() * 60 +
   agora.getMinutes()` no fuso do processo. O `Dockerfile` (`node:22-slim`), o `docker-compose.yml` e o
   `.env.example` não definem `TZ`, então o container roda em UTC e a janela 08:00–20:00 de
   `politica-root.json` (`limitesPadrao.janelaHoraria`) vale das 05h às 17h de Brasília.
2. **Troca:** os minutos saem de `Intl.DateTimeFormat('en-GB', {timeZone, hour: '2-digit', minute:
   '2-digit', hourCycle: 'h23'})`, numa função exportada ao lado de `foraDaJanela` em
   `policy/limites.ts` (a conta da janela mora num lugar só). O fuso vem de **`POLITICA_FUSO_HORARIO`**
   (decisão do Pedro), com padrão `America/Sao_Paulo`; fuso que o `Intl` não conhece recusa subir,
   como a janela ilegível já é tratada. O simulador (`policy/simulador.ts:250`) usa a mesma função
   quando parte do relógio. O JSON da política não muda, então não há seed.
3. **Por que entra na onda:** sem a troca, todo post das 18h (21h UTC) e toda DM noturna acenderiam
   `fora_da_janela` e subiriam um degrau sem motivo, e o lote da MD7 ficaria sempre no teto.
4. **Variável e registro:** `POLITICA_FUSO_HORARIO` no bloco `environment:` do `api` no
   `docker-compose.yml` e no `.env.example`. O ESTADO registra a **mudança de comportamento**, para
   todas as capacidades: das 17h às 20h de SP o sinal deixa de acender, das 05h às 08h passa a
   acender.
5. **Testes** (na suíte que cobre o `SinaisService`, `porta.test.ts` ou vizinho): 21:00 UTC (18h em
   SP) não acende; 23:30 UTC (20h30) acende; 10:30 UTC (07h30) acende; o mesmo resultado com `TZ=UTC`
   e `TZ=Asia/Tokyo`; `POLITICA_FUSO_HORARIO` inválido recusado.

**Pronto quando.** `TZ=UTC pnpm --filter @mktos/api test` verde com os casos novos, e `TZ=Asia/Tokyo`
dando o mesmo resultado; `test:porta` com 39 ou mais; o simulador da régua em `/regua` mostrando o
sinal pelo horário de SP.

**Manual.** Nenhum além do OK já dado.

**Risco.** Baixo. Alguma rotina que hoje sobe de degrau à tarde deixa de subir.


### MD4 — Mídia da peça no OS: JPEG, mp4 do corte e URL pública assinada

> **Estado (24/09/2026):** implementada, com o ensaio do "pronto quando" contra MinIO descartável, a
> revisão e as pendências do Pedro registrados no `docs/ESTADO-DA-EXECUCAO.md` (§1, onda D, e item 26
> da §4). Escolhas além do texto abaixo: o sha256 vem declarado em `X-Conteudo-Sha256` e é conferido
> no fim; o envio em partes é feito à mão com as primitivas do `minio` (o `putObject(stream)`
> pendura quando a origem falha); `POST …/midia-publica` só assina peça **aprovada**; o Mac sobe o
> mp4 por `ROOT_OS_ENVIO_URL`, porque o proxy do Next corta corpo acima de 10 MB.

**SPEC.**

1. **JPEG:** `POST /pauta/pecas/:id/imagens/:n` (`derivacao.controller.ts`) passa a aceitar
   `image/jpeg` além de PNG. A função pura nova `pauta/imagem-jpeg.ts` confere a assinatura `FFD8FF`,
   lê largura e altura do marcador SOF0/SOF2 e limita a 8 MB e largura de 320 a 1440; a proporção
   segue `PAUTA_DIMENSOES_DA_PECA` (carrossel 4:5, story 9:16). A peça guarda PNG e JPEG em
   `meta.imagens[n]`, com chave nomeada pelo sha, no padrão de `chaveDaImagemDaPeca`. Carrossel com
   mais de 10 slides é recusado na aprovação (checagem em `derivacao-do-episodio.ts`). No Mac,
   `stories` e `carrosseis` convertem com `sips -s format jpeg -s formatOptions 90` (nativo) e sobem
   os dois.
2. **mp4 do corte:** rota nova `POST /pauta/pecas/:id/video/arquivo` (`pauta.editar`), só para
   formato `corte` e para a transcrição atual (a mesma regra que hoje dá 409 no `PUT …/video`). O corpo
   é lido **cru, como stream**, com `Content-Type: video/mp4` e `Content-Length` obrigatório e ≤
   `PAUTA_VIDEO_MAX_BYTES` (padrão 300 MB) — conferir em `common/corpo-da-midia.ts` que nenhum parser
   toca em `video/mp4`. Um `Transform` conta os bytes (413 se passar do declarado), calcula o `sha256`
   e confere as caixas de topo: `ftyp` primeiro e `moov` antes de `mdat` (faststart). O método novo
   `StorageService.putStream(chave, stream, tamanho, contentType)` usa o `putObject` do `minio`, que
   já é dependência e aceita stream — sem multer e sem segurar 300 MB em memória. Chave
   `pauta/pecas/<id>/corte-<sha>.mp4`; a peça grava `meta.video = {chave, sha256, bytes, duracaoSeg,
   enviadoEm}` e mantém o caminho do Mac.
3. **URL pública assinada:** `pauta/midia-publica.ts`, puro: `assinar({orgId, pecaId, chave, exp})`
   devolve `base64url(payload) + '.' + HMAC-SHA256` com `PAUTA_MIDIA_PUBLICA_SEGREDO` e `exp` de no
   máximo 1 h; `conferir(token, agora)` em tempo constante. Controller `pauta/midia-publica.controller.ts`
   com `GET /midia-publica/:token`; o prefixo novo `midia-publica` é declarado em
   `apps/api/src/tenants/modulos.ts` como módulo `pauta`, fora do `JwtAuthGuard`. A rota confere o
   token **antes de qualquer consulta**, depois roda `comTenantPublico(orgId)`
   (`common/tenant-publico.ts`), confere que a chave ainda é da peça e faz o streaming com
   `Content-Type`, `Content-Length` e `Cache-Control: private, no-store`, sem `x-correlation-id` (molde
   do avatar em `bio/bio-public.controller.ts`). Token inválido, vencido, de outra empresa ou com
   chave trocada → **404 igual**, que não vaza existência. O RASTRO guarda só os 8 primeiros
   caracteres do HMAC. A origem vem de `PAUTA_MIDIA_PUBLICA_ORIGEM`, com padrão `PUBLIC_BIO_ORIGIN`
   (o `bio.operacaoroot.com` já leva `/api` à API). Sem `Range` na primeira versão (**a conferir** se
   a Meta pede).
4. **Variáveis novas** no `environment:` do `api` e no `.env.example`: `PAUTA_MIDIA_PUBLICA_SEGREDO`,
   `PAUTA_MIDIA_PUBLICA_ORIGEM` e `PAUTA_VIDEO_MAX_BYTES`. Segredo vazio = rota desligada (404).
5. **Mac:** `cortes-verticais` (`tools/root-midia/lib/semana.mjs`) fixa `-ar 48000`, confere o
   `+faststart` e sobe o mp4 com `fetch` nativo (`body: createReadStream`, `duplex: 'half'`); o reenvio
   é idempotente pelo sha.
6. **Decisão que muda:** o mp4 deixa de ficar só no Mac (MC9/MC15). Nada é apagado nesta fatia; o
   volume por semana vai ao ESTADO.
7. **Testes:** `pauta-midia-publica.test.ts` (vencido, adulterado, de outra empresa ou com chave
   trocada → 404 sem consulta; `exp` acima de 1 h recusado); `pauta-semana.test.ts` (JPEG válido e
   inválido, mp4 sem faststart → 400, `Content-Length` acima do teto → 413 antes de ler, corpo maior
   que o declarado aborta, sha gravado); `rotas-publicas-tenant.test.ts` e `modulos-por-tenant.test.ts`
   com a rota e o prefixo novos; `root-midia` com a conversão JPEG e o upload por stream contra
   servidor dublê.

**Pronto quando.** Com um MinIO descartável local e a API compilada: `root-midia cortes-verticais
ep-01` sobe 4 mp4 e o sha no OS é igual ao `shasum` local; `curl` na URL assinada devolve o arquivo
byte a byte igual; token vencido ou adulterado → 404 sem linha de consulta no log; um JPEG de
1080×1350 é servido; `Content-Length` de 301 MB → 413; `test:isolamento`, smoke com a rota nova e
`db:diff` limpos.

**Manual.** Gerar `PAUTA_MIDIA_PUBLICA_SEGREDO` no easyPanel (nunca colar em chat); conferir que
`S3_*` estão preenchidas na VPS; conferir o limite de corpo do Traefik/proxy da VPS ROOT para 300 MB.

**Risco.** Disco e banda da VPS (~1 GB por semana de cortes). É uma rota pública nova que serve
arquivo, protegida pelo HMAC de 1 h conferido antes do banco; a URL com token pode ficar em log de
proxy durante essa hora. Proxy com limite de corpo pode cortar o upload.


### MD5 — Conexão de publicação do Instagram (trilha Login do Instagram) e Graph v24

> **Estado (24/09/2026):** implementada, com o ensaio do "pronto quando" contra dublê local da Meta e
> as pendências do Pedro registrados no `docs/ESTADO-DA-EXECUCAO.md` (§1, onda D, e item 27 da §4).
> Escolhas além do texto abaixo: o sync da bio passa a renovar o token da conta de publicação (antes
> só renovava conta de desafio); a de publicação reconectada pela bio sem o escopo de publicar cai
> para `bio`; um segundo @ de publicação rebaixa o anterior na mesma transação; `permissions`
> ausente na resposta da Meta não conta como concedido.

**SPEC.**

1. **`apps/api/src/bio/plataformas/instagram.ts`:** constante nova `ESCOPOS_DE_PUBLICACAO =
   ['instagram_business_basic', 'instagram_business_content_publish',
   'instagram_business_manage_comments']` — comentários já incluídos, para a MD9 não pedir outra
   reconexão; `urlDeAutorizacao(estado, cred, finalidade: 'bio' | 'publicacao')`; o `ESCOPOS` global
   **continua intocado** (é pedido a todo criador da bio, e permissão de Standard Access só pode ser
   pedida a quem tem papel no app); `AUTORIZAR`, `TOKEN` e `GRAPH` aceitam sobrescrita por
   `INSTAGRAM_OAUTH_URL`, `INSTAGRAM_TOKEN_URL` e `INSTAGRAM_GRAPH_URL` para dublê, com os valores de
   hoje como padrão (variáveis no compose e no `.env.example`).
2. **Migration `bio_finalidade`:** enum `BioFinalidade {bio, publicacao}`; `BioOauthState.finalidade`
   e `BioConexao.finalidade`, padrão `bio`; índice único parcial para uma conexão de publicação por
   empresa e plataforma; espelho do enum no shared.
3. **`bio.service.ts`:** `iniciarConexao(orgId, plataforma, finalidade)` grava a finalidade no state;
   o callback continua em `/api/conectar/instagram/callback` (a mesma redirect, sem cadastro novo);
   com finalidade `publicacao`, o callback confere que `escopos` contém
   `instagram_business_content_publish` — sem ele, grava como `bio` e devolve o aviso "a Meta não
   concedeu publicar".
4. **Rotas:** `POST /pauta/instagram/conectar` (`pauta.publicar` e `bio.editar`) devolve a URL;
   `GET /pauta/instagram/conexao` (`pauta.ver`) mostra o @, os escopos e a validade. A renovação do
   token de 60 dias já existe (`bio-sync.service.ts:73`).
5. **`meta.service.ts`:** o padrão de `META_GRAPH_URL` e o `authUrl` passam de `v21.0` para `v24.0`; o
   comentário que afirma sem fonte que mudar a redirect exige App Review (~linhas 222–226) é corrigido.
   A mesma frase no `CLAUDE.md` ("Mudar exige novo App Review") ganha a ressalva.
6. **UI:** cartão "Conta de publicação" na aba Semana, com conectar/reconectar, o @ e os escopos, e a
   frase "publicar na conta da própria Root não passa por App Review; a conta precisa ter papel no
   app".
7. **Testes** (suíte da bio-oauth): a finalidade gravada e lida; os `ESCOPOS` da bio continuam sem
   `content_publish`; callback sem o escopo não vira publicação; outra empresa não lê a conexão;
   `modulos-por-tenant` e isolamento cobrindo as colunas.

**Pronto quando.** Com fetch dublê do OAuth e da Graph: iniciar com finalidade `publicacao` gera URL
com os três escopos; o callback com `permissions` contendo `content_publish` grava `BioConexao` com
finalidade `publicacao`; sem o escopo, o aviso e a conexão como `bio`; a bio de um criador continua
pedindo só `instagram_business_basic`; `db:diff` limpo e suítes verdes.

**Manual.** No developers.facebook.com: confirmar que o app de `INSTAGRAM_APP_ID` é do tipo Business
e tem o caso de uso "API setup with Instagram login"; ver `instagram_business_content_publish` com
Standard Access, **sem** pedir Advanced Access; confirmar a redirect
`https://bio.operacaoroot.com/api/conectar/instagram/callback`; adicionar o @ da Root como Instagram
Tester e aceitar o convite no app do Instagram; confirmar que a conta é profissional; depois do deploy,
reconectar pela aba Semana e aceitar a permissão de publicar.

**Risco.** Com o app em modo de desenvolvimento, o post talvez só apareça para quem tem papel no app
(**a conferir** no primeiro Story real). O token de 60 dias morre sem uso. As duas trilhas de login
da Meta continuam no código; esta fatia escolhe a do Instagram e não pede publicação na do Facebook.


### MD6 — Publicador do Instagram: capacidade R3, efeito por registro e executor

> **Estado (24/09/2026):** implementada, com o ensaio do "pronto quando" contra dublê local da Graph
> e MinIO descartável registrados no `docs/ESTADO-DA-EXECUCAO.md` (§1, onda D, e item 28 da §4).
> Escolhas além do texto abaixo: o publicador recebe o cliente da Graph por injeção
> (`GRAPH_DE_PUBLICACAO`, montado no `*.module.ts` da pasta do conector), porque a catraca proíbe
> `pauta/` de importar o conector; o schema da política não tem `hashKeys`, então os argumentos são
> exatamente os seis do item 1 (o corpo inteiro vai ao hash) e `agendadaPara` é opcional (a porta
> recusa `null` em campo obrigatório); a rotina ainda não chama a porta — sem a MD7 a porta não
> confere lote, e chamá-la criaria uma aprovação por minuto —, então com a nota ligada e o lote ela
> também registra `pulada` com o motivo; o container com a resposta do publish perdida é achado pela
> legenda nas mídias recentes (o story, sem legenda, fica `publicada` sem id, nunca repostado);
> "Voltar ao manual" leva a `recusada`; a aprovação que esperava na fila continua lá, mas não publica:
> de `recusada` o efeito não começa e, depois de um pedido novo, recusa toda aprovação que não seja a
> do último pedido gravado na linha. Quem a confirmar recebe a recusa com o motivo.
>
> **Depois da revisão (24/09/2026):** a linha a caminho tem POSSE (`proximaEm` no futuro enquanto
> alguém trabalha nela; a rotina só pega a vencida e a toma condicionada ao valor lido), porque o
> tique de cada minuto disputava a linha com o efeito — abortava o carrossel aprovado no meio dos
> containers e podia mandar um segundo `media_publish`. Depois da marca `publicandoEm` o mesmo
> container nunca é publicado de novo: `FINISHED` só é relido, e em 10 min vira erro que manda
> conferir no Instagram; o pedido novo relê o container antigo antes de criar outro. O efeito que
> termina em erro lança (`acao.falhou`, a confirmação mostra o motivo). A conclusão pela rotina
> escreve o RASTRO na correlação e no ator da chamada aprovada (item 5), com a da passagem em
> `correlacaoDaRotina`. O pedido morto (aprovação vencida, recusada ou sumida) chega à tela como
> `erro`, com o botão de pedir de novo; o container vencido continua voltando a `pendente` (item 5),
> e a tela o mostra como erro. A falta da URL pública da mídia é conferida também no pedido, antes da
> fila. A `pulada` do executor vai ao RASTRO uma vez por peça, slot e motivo (item 6). **A única
> mudança na rota antiga** `POST /pauta/pecas/:id/publicar` (item 7) é o texto da recusa de peça do
> Instagram, que apontava para App Review e passou a apontar para o "Publicar agora".
>
> **Manual, a acrescentar:** a segunda pessoa com alçada `responsavel` só confirma o pedido R3. Fora
> das 08h–20h de São Paulo (`fora_da_janela`) ou no segundo pedido dentro de uma hora
> (`volume_atipico`) o "Publicar agora" sai **R4**, e aí a confirmação exige alçada **`titular`**,
> reautenticação e até 10 min. Recomendação: a segunda pessoa com alçada titular; ou o Pedro decide
> aceitar só o R3 dentro da janela, e os posts da noite ficam manuais.

**SPEC.**

1. **Capacidade `instagram.post.publicar`** em `packages/policy/politica-marketing-os.json`: efeito
   `{escreveForaDoOS: true, produzArtefato: false, reversibilidade: 'manual', exposicaoExterna: true,
   impactoFinanceiro: 'nenhum', sensibilidade: 'publica', destruicao: false, obrigacaoLegal: false}`;
   `classificar()` dá **R3**, e o `nivel` declarado é R3; `hashKeys`: `pecaId`, `formato`, `legenda`,
   `midias` (`[{chave, sha256}]`), `igUserId`, `agendadaPara`; `argsSchema` com `required`; mapeada
   para `instagram` em `CONECTOR_DA_CAPACIDADE` (`apps/api/src/integrations/conectores.ts`), o que faz o
   interruptor da empresa recusar; **sem `desfazer`** — apagar post pela API não existe, e se
   existisse seria R5.
2. **HTTP puro no conector** (`bio/plataformas/instagram.ts`, único lugar com o literal da Graph):
   `limiteDePublicacao`, `criarContainer({image_url | video_url, media_type, is_carousel_item,
   children, caption, share_to_feed})`, `statusDoContainer`, `publicarContainer(creation_id)`,
   `permalinkDe(mediaId)`.
3. **Serviço `pauta/publicacao-instagram.service.ts`**, que registra o efeito em `EfeitosRegistry`
   (`gateway/efeitos.registry.ts`), nunca por import.
4. **Tabela `PautaPublicacao`**, filha de `PautaPeca`: `orgId` com sentinela `''`, gatilho
   `mktos_orgid_do_pai`, entrada em `FILHOS_COM_ORGID_REDUNDANTE` e semente em
   `tenant-isolation.test.ts`; campos `pecaId`, `rede` (enum `PautaRede {instagram, youtube, tiktok}`),
   `estado` (enum `PautaPublicacaoEstado {pendente, container_criado, processando, publicada, erro,
   recusada}`), `containers Json`, `externalId`, `permalink`, `tentativas`, `proximaEm`, `erro`,
   `loteItemId?`, `approvalId?`; único `(pecaId, rede)`; enums espelhados no shared.
5. **O efeito, aprovado uma vez:** cria os containers com as URLs assinadas da MD4 (exp 1 h) —
   carrossel: um container por slide JPEG com `is_carousel_item` e depois o `CAROUSEL` com `children`;
   story: `STORIES` com `image_url`; corte: `REELS` com `video_url` e `share_to_feed=true`. Status já
   `FINISHED` publica na mesma chamada; `REELS` em `IN_PROGRESS` fica `processando` e o executor
   conclui (status uma vez por minuto, até 5 min; `content_publishing_limit`; `media_publish`;
   `permalink`). A conclusão não pede nova aprovação: a aprovação cobriu o container criado com os
   argumentos conferidos. Cada passo vai ao RASTRO como `pauta.publicacao_passo`, com a correlação da
   chamada aprovada. No fim, a peça fica `publicada` com `externalId`, `urlPublicada` e `publicadaEm`, e
   o RASTRO registra `pauta.peca_publicada` com canal `instagram`. Resposta do publish perdida: o
   efeito relê o container antes de repetir e, se já publicado (o valor exato do `status_code` é **a
   conferir**), recupera o id em vez de postar de novo. Container vencido em 24 h volta a `pendente`.
6. **Executor `pauta.publicar-agendadas`** (`routines/executores/pauta-publicar.executor.ts`, cron `* *
   * * *`): pega peças `aprovada` com `agendadaPara` entre agora−2 h e agora e publicação não
   concluída, no máximo 3 por passagem, e chama `ToolGateway.executar` com `actorType` sistema e a
   correlação da rotina. Publica **só** com `loteItemId` de lote ativo (MD8) **e** com a nota
   `pauta.publicacao.automatica` ligada (D-MD1): sem lote, grava `pulada: sem aprovação da semana`;
   com a nota desligada, `pulada: publicação automática desligada`; nos dois casos a peça segue o
   fluxo manual da MC16. Janela perdida (mais de 2 h) vira erro, volta ao manual e avisa.
7. **Caminho por item, que vale sem o lote e sem o interruptor:** botão "Publicar agora" na aba Semana
   → `POST /pauta/pecas/:id/publicar-instagram` (`pauta.publicar`), que entrega o pedido à
   `PortaDoOperador`; a porta retém como R3 e devolve `precisaDeOutraPessoa`; a confirmação em
   `/atendimento` executa o efeito. A rota antiga `POST /pauta/pecas/:id/publicar` e o
   `publicar-peca.test.ts` ficam **exatamente** como estão.
8. **UI:** cada slot da Semana mostra o estado da publicação (pendente, processando, publicada com
   link, erro com motivo) e o botão "voltar ao manual".
9. **Seed:** a capacidade nova entra com `POLITICA_CAPACIDADE_NOVA_AUTOR/_MOTIVO`. Sem o seed assinado
   no banco, a capacidade não tem classificação e vale R5: a porta bloqueia.
10. **Testes:** `pauta-publicacao-instagram.test.ts` com fetch dublê (carrossel de 5 slides gera 5+1
    containers e o publish; story; reels passando de `IN_PROGRESS` a `FINISHED`; `ERROR` sem publish;
    limite atingido; resposta perdida sem segundo post; interruptor do conector desligado sem chamada;
    nota de publicação automática desligada sem chamada; rascunho recusado; sem aprovação, retido);
    `packages/policy` (nível declarado = `classificar()`); `arquitetura.test.ts` (efeito só pelo
    registro, literal da Graph só no conector); `escritas-pela-porta.test.ts`; isolamento, `db:diff` e
    seed.

**Pronto quando.** API local, Graph dublê (servidor HTTP em `INSTAGRAM_GRAPH_URL` que baixa a
`image_url` e confere o sha) e MinIO local: "Publicar agora" num carrossel aprovado fica retido; uma
segunda conta descartável com alçada `responsavel` confirma em `/atendimento`; o dublê recebe 5
containers de item e 1 `CAROUSEL`, todos com a URL assinada; a peça fica `publicada` com `externalId`
e permalink, e o RASTRO registra `peca_publicada`; com o conector desligado, a recusa sai sem chamada
ao dublê; o executor, sem lote, registra `pulada`.

**Manual.** MD5 feita no painel da Meta e conta reconectada; segunda pessoa com alçada `responsavel`
na empresa Root; o 403 da fila resolvido (`db:sync-permissions` pendente desde 12/09/2026);
`db:seed:politica` com `POLITICA_CAPACIDADE_NOVA_*` antes da subida; decisão do papel restrito, para o
executor rodar; ligar a nota `pauta.publicacao.automatica` só depois do seed assinado.

**Risco.** Post duplicado se a Meta publicar e a resposta se perder; a leitura do container antes de
repetir reduz, mas o valor do status está a conferir. A URL assinada pode vencer antes de a Meta
baixar um vídeo grande. A API da Meta muda de versão. É a primeira escrita pública automática do OS.


### MD7 — A régua aprende a aprovação de lote com uso contado

> **Estado (24/09/2026):** implementada, com o seed ensaiado num banco descartável (recusa sem as
> duas assinaturas, aceita com elas) e o fluxo pelo HTTP e pela porta do `dist` registrados no
> `docs/ESTADO-DA-EXECUCAO.md` (§1, onda D, e item 29 da §4). Escolhas além do texto abaixo: o
> `loteItemId` é tirado dos argumentos pela porta e NÃO entra no `argsSchema`; a janela e o prazo
> comparam com o relógio do processo; as rotas são `/approvals/lotes/:id` e
> `/approvals/lotes/:id/pedir-assinatura` (quem pede é quem montou); `vencido` é calculado na
> leitura. A rotina da MD6 continua sem chamar a porta com o item: é o item 7 da MD8.

**SPEC.** É o desenho da MC18.1 ("O que muda na régua", `docs/especificacoes/MC18-dm-por-palavra-chave.md`)
generalizado para uma lista de itens. Serve à semana de posts, ao YouTube e à DM.

1. **`packages/policy/src/esquema.ts`:** `CapacidadeSchema` declara `aprovacao?: {modo: 'lote',
   tetoDeItens: int>0, validadeMaximaDias: int>0} | {modo: 'sob_lote', lote: string}`, com enum
   fechado e sem descarte calado do Zod; `diffDePolitica` trata mudança nesse campo como afrouxamento;
   `verificarCatalogo()` cobra três regras: capacidade `sob_lote` aponta para capacidade `lote`; o
   nível do lote é ≥ o nível de cada `sob_lote` avaliado com qualquer sinal (sobe um degrau, teto R4);
   modo `lote` só com `efeito.alcance > 10`.
2. **Invariante 4**, em `politica-root.json`: "aprovação é de uso único — ou de uso contado, item a
   item, quando a capacidade declara lote —, presa ao conteúdo exato e com prazo". A nota do vault é
   do Pedro (manual abaixo).
3. **Capacidade `pauta.semana.aprovar`:** efeito `{escreveForaDoOS: true, reversibilidade: 'nenhuma',
   exposicaoExterna: true, sensibilidade: 'publica', alcance: 60, demais false/nenhum}`;
   `classificar()` dá R3 e o alcance acima de 10 sobe para **R4** (titular, reautenticação, motivo,
   600 s); `aprovacao {modo: 'lote', tetoDeItens: 60, validadeMaximaDias: 8}`; o efeito registrado ativa
   o lote (escrita interna). `instagram.post.publicar` ganha `aprovacao {modo: 'sob_lote', lote:
   'pauta.semana.aprovar'}` e continua aceitando o caminho de sempre sem `loteItemId`.
4. **Tabelas genéricas no módulo approvals:** `AprovacaoDeLote` (`orgId` com RLS FORCE e policies
   separadas; `capabilityId`, `recursoTipo`, `recursoId` = o episódio, `hashConteudo` = hash canônico da
   lista ordenada de itens, `estado` enum `{proposta, aguardando, ativo, encerrado, vencido, revogado}`,
   `validaAte`, `approvalId`, `propostoPorId`, `aprovadoPorId`, `aprovadoEm`, `motivo`) e `ItemDoLote`
   (filho com sentinela, gatilho e `FILHOS_COM_ORGID_REDUNDANTE`; `loteId`, `capabilityId`,
   `recursoId`, `hashItem` = `canonicalHash` com as `hashKeys` da capacidade do item, `janelaDe`,
   `janelaAte`, `usoMaximo` (1 na publicação), `tetoPorDia`, `usosNoDia` e `diaDoContador` para a DM
   da MD11, `usos`, `consumidoEm`, `estado`). Enums espelhados no shared.
5. **Porta (`gateway/tool-gateway.service.ts`):** com `loteItemId` nos args e capacidade `sob_lote`, a
   porta não propõe nem consome token: chama `LotesService.consumirItem`, que roda **uma** instrução —
   `UPDATE "ItemDoLote" SET usos = usos + 1, "consumidoEm" = now() WHERE id = :id AND "orgId" = :org
   AND estado = 'ativo' AND :agora BETWEEN "janelaDe" AND "janelaAte" AND usos < "usoMaximo" AND
   "hashItem" = :hashAtual AND <lote ativo e validaAte > now()> RETURNING …` (a variante por dia é o SQL
   do item 6 da MC18). Zero linhas é recusa registrada e **nunca** cai no caminho B; o `loteItemId`
   fica fora do hash; o RASTRO do item leva `hashConteudo`, aprovador, `aprovadoEm` e motivo vindos do
   lote, mais `estadoAnterior` e `estadoNovo` (os usos), que são os campos de R4 conferidos por
   `event-log.service.ts`; capacidade sem `sob_lote` recusa `loteItemId`.
6. **`gateway/validacao.ts`** aprende `maximum` e `maxItems`.
7. **Prazo de assinatura:** continua 600 s (R4). "Pedir assinatura de novo" recria a aprovação com o
   **mesmo** hash, sem remontar o lote.
8. **Seed com as duas assinaturas:** `POLITICA_CAPACIDADE_NOVA_AUTOR/_MOTIVO` e
   `POLITICA_REBAIXAMENTO_AUTOR/_MOTIVO` (a invariante 4 reescrita conta como AFROUXA em
   `sobrescrita.ts`). **É o portão humano da D-MD1.**
9. **Testes:** `packages/policy/test` (o campo sobrevive a `lerPolitica` e `lerDelta`; modo
   desconhecido recusado; lote com alcance ≤ 10 recusado; lote abaixo do item com sinal recusado; texto
   novo da invariante 4); `porta.test.ts` (item de outra empresa, de lote vencido ou revogado, fora da
   janela, com hash diferente, em segundo uso ou de outra capacidade → recusado e registrado sem
   efeito; `loteItemId` em capacidade comum → recusado); `lotes.test.ts` (**dois consumos simultâneos
   do mesmo item deixam passar um só** — o teste de corrida que mexer em invariante exige; quem propôs
   não confirma; editar uma peça depois de ativo derruba só o item dela); `validacao.test.ts`;
   `tenant-isolation` com as duas tabelas; `publicar-peca.test.ts` sem mudança.

**Pronto quando.** Suítes de policy, api, porta e isolamento verdes com os casos novos;
`verificarCatalogo()` sem divergência; `db:seed:politica` ensaiado em banco descartável — aceita com
as duas assinaturas e recusa sem elas; `db:diff` limpo; `publicar-peca.test.ts` idêntico ao de antes.

**Manual.** A D-MD1 já foi aceita; falta assinar o seed com `POLITICA_CAPACIDADE_NOVA_*` e
`POLITICA_REBAIXAMENTO_*`; no mesmo dia, atualizar a nota `Root/20-empresa/root-os/09 - Escada de
risco R0-R5.md`; confirmar os 600 s de prazo da assinatura do lote (recomendado manter).

**Risco.** É a mudança mais sensível da onda: mexe numa invariante e na porta. Um defeito no consumo
contado solta publicação sem assinatura, por isso o consumo cabe numa instrução só e tem teste de
corrida. Com 600 s de prazo, a segunda pessoa precisa assinar logo depois do pedido.


### MD8 — Aprovar a semana num ponto só

> **Estado (24/09/2026):** implementada, com o ensaio do "pronto quando" contra dublê local da Graph,
> MinIO descartável e duas contas descartáveis registrado no `docs/ESTADO-DA-EXECUCAO.md` (§1, onda D).
> Escolhas além do texto abaixo: o hash de cada item é o da peça **como aprovada no slot**
> (`argsDoItem`), o mesmo que o executor manda à porta no horário; a reação à assinatura (item 4) é
> inscrita em `LotesService.aoAtivar` e roda na transação que liga o lote — a peça que mudou entre a
> montagem e a assinatura não é aprovada, o item dela cai ali; montar de novo substitui o lote ainda
> sem assinatura; editar o texto no Agendado passou a valer (a peça sai do lote e da agenda), porque a
> regra antiga ("depois de agendado o texto não muda") impediria o item 5; reagendar mantém a peça
> aprovada no horário novo, fora do lote; o hash recalculado que a titular vê (item 3) é conferido
> pela API (`GET /pauta/lotes/:id/conteudo`, só para quem tem `aprovacoes.decidir`), não no
> navegador; "Publicar agora" de peça com item ativo é 409. Pedir a assinatura (item 2) usa a rota da
> MD7, `POST /approvals/lotes/:id/pedir-assinatura`, com a mesma permissão `pauta.publicar` e a trava
> "quem monta é quem pede", em vez de uma rota nova em `/pauta`. A peça que já tem publicação em
> `erro`, `recusada` ou com o pedido morto entra no lote e a ativação a reabre para o executor; a
> rotina que desiste de uma peça revoga o item dela. Os itens do YouTube (MD10) e da DM (MD11) entram
> quando existirem.

**SPEC.**

1. **Montar o lote:** `POST /pauta/episodios/:id/semana/preparar-aprovacao` (`pauta.publicar`) parte
   das peças da semana com `slotProposto` (MD1) ou `agendadaPara`; a tela deixa marcar "fica fora".
   Pré-condições, cada uma com mensagem própria: página de links no ar (sem ela o `/r/` não
   redireciona); mídia pronta (JPEG por slide ou story e mp4 do corte no storage, MD4); carrossel com
   no máximo 10 slides; legenda dentro do limite do Instagram (2.200 caracteres, **a conferir**);
   conexão de publicação ativa (MD5); nenhum slot no passado. Para cada peça, o lote grava o
   `hashItem` com as `hashKeys` de `instagram.post.publicar`: a legenda final depois de
   `semLinksDeCaixaDeEntrada`, as mídias `{chave, sha256}`, o `igUserId` e o `agendadaPara`. A janela
   vai do slot a slot + 2 h. Os itens do YouTube (MD10) e as regras de DM (MD11) entram no **mesmo**
   lote quando existirem.
2. **Pedir a assinatura:** a rota **já existe desde a MD7**: `POST /approvals/lotes/:id/pedir-assinatura`
   (`AssinaturaDeLoteService.pedirAssinatura`) entrega `pauta.semana.aprovar` à `PortaDoOperador`
   (`gateway/porta-do-operador.service.ts`), que devolve `aguardando_aprovacao` com
   `precisaDeOutraPessoa`. A MD8 não cria uma segunda rota: só a montagem (`preparar-aprovacao`)
   fica com a pauta.
3. **Em `/atendimento`,** o cartão do lote mostra, por item, a miniatura (rota autenticada), a legenda
   inteira, o horário em SP e o @ de destino, além do total e do hash curto. A assinatura R4 pede
   senha e motivo. **Requisito vindo da revisão da MD7:** o `ItemDoLote` guarda só o `hashItem`, e
   `GET /approvals/lotes/:id` não mostra conteúdo. Antes do confirm, a tela recalcula o `hashItem` de
   cada item a partir da peça atual (`argsDaPublicacao` + `hashDoItem`), mostra o conteúdo e marca a
   divergência; a titular não assina hash sem ver o que ele cobre.
4. **Ao confirmar,** o efeito ativa o lote; passa as peças a `aprovada` com `agendadaPara =
   slotProposto`, numa escrita condicionada ao estado lido; limpa o `slotProposto`; leva o episódio a
   `agendado` (D-MC11).
5. **Depois de ativo:** editar texto, mídia ou horário de uma peça revoga **só** o item dela, e a peça
   volta a rascunho fora da agenda, como no refazer mídia; reagendar vira um lote novo de um item;
   "Cancelar a semana" revoga o lote inteiro — é R1, sem aprovação, porque só diminui o alcance.
6. **Aviso à segunda pessoa:** pelo canal de aprovação do WhatsApp que já existe, **só como aviso**
   com o link de `/atendimento` (o canal recusa R4). Sem canal configurado, fica só a fila.
7. **O executor da MD6** passa a encontrar o `loteItemId` e publica no horário — se a nota
   `pauta.publicacao.automatica` estiver ligada.
8. **UI:** na aba Semana, o botão "Aprovar a semana" e a linha do tempo "rascunho → proposto →
   aguardando assinatura → ativo → publicando → publicada", legível a 375 px; o estado do interruptor
   de publicação automática aparece ao lado do botão.
9. **Testes:** `pauta-lote-da-semana.test.ts` (as pré-condições; o hash muda com legenda, mídia,
   horário e conta; item revogado não publica e os outros publicam; nada publicado antes da
   assinatura; interruptor desligado não publica com lote ativo); teste da web para o botão e os
   estados.

**Pronto quando.** Graph dublê, MinIO local e duas contas descartáveis (proponente e titular): a
semana gerada pela MD1 → "Aprovar a semana" → a titular assina com senha e motivo; com a publicação
automática ligada e `agendadaPara` ajustado para o passado recente, o executor publica os 11 itens no
dublê, até 3 por passagem; a Semana mostra "publicada" com permalink; editar uma peça depois de ativo
revoga só ela, e o executor a pula; sem assinatura, o dublê recebe zero chamadas; com a nota
desligada, também zero; o RASTRO registra um consumo por item, com o aprovador do lote.

**Manual.** Seed assinado (MD7); criar na empresa Root um segundo usuário com alçada `titular`, Lucas
ou Rodrigo (D-MC9.3 a) — sem ele, nada publica sozinho; resolver o 403 da fila; a segunda pessoa
assinar em até 10 min depois do pedido (passou o prazo, basta pedir de novo); decisão do papel
restrito; ligar a nota `pauta.publicacao.automatica`.

**Risco.** Um lote assinado publica 11 posts sem ninguém olhando na hora, então a revisão de segunda
precisa ser de verdade. Erro de fuso publicaria na hora errada: a gravação é em UTC e a exibição em
SP, com teste. Executor parado mais de 2 h derruba a peça no manual.


### MD9 — DM mínima: fila de respostas com o link rastreado e coletor de comentários

> **Estado (25/09/2026):** implementada, com o ensaio do "pronto quando" contra dublê local da Graph e
> as pendências do Pedro registrados no `docs/ESTADO-DA-EXECUCAO.md` (§1, onda D, e item 31 da §4).
> Escolhas além do texto abaixo: a capacidade é **R0**, não R1 — R1 com `fora_da_janela` ou
> `volume_atipico` vira R2, que exige aprovação, e a rotina de 10 em 10 min encheria a fila de
> pedidos de LER; o efeito só lê e devolve, e quem grava a fila é a rotina. O efeito devolve o @ e o
> id do comentário em `sigiloso()` sem resumo (sha256 sem chave de um @ se desfaz), e o
> `ToolCall.resultado` passou a redigi-los como o `EventLog`. O filtro de `ad_id` fica para o webhook
> da MD11: a consulta não pede o campo, que não é do nó IG Comment.
> A linha de aviso de mensagem automática fica para a MD11 (esta DM é mandada por gente).

**SPEC.**

1. **MC18.0 como especificada, com as recomendações como padrão:** D-MC9.6 (a) — link de campanha
   `campanha:dm:<itemId>` por matéria (`chaveDeCampanha` em `bio/link-de-campanha.ts`), destino por
   `linkPublicoDoItem` (`pauta/link-publico.ts`); D-MC9.7 (a) — o CTA "chegam no direct" continua e a
   resposta é à mão; texto fixo com o `/r/` e o endereço da página, passado por
   `semLinksDeCaixaDeEntrada`; validação em **bytes UTF-8** (≤ 1000) e `checagemAntiSlop` quando o
   texto é proposto; matéria de newsletter (origem L) não gera link.
2. **Coletor, capacidade `instagram.comentario.ler`:** efeito `{escreveForaDoOS: false,
   produzArtefato: true, reversibilidade: 'automatica', exposicaoExterna: false, sensibilidade:
   'interna', demais false/nenhum}` → **R1**, sem aprovação, com `POLITICA_CAPACIDADE_NOVA_*` no seed
   (ACRESCENTA; a invariante 4 não muda nesta fatia); conector `instagram` em
   `CONECTOR_DA_CAPACIDADE`; HTTP no conector: `comentariosDa(midiaId)` faz `GET /<media>/comments` com
   `fields=id,text,timestamp,from{id,username},parent_id` e teto de páginas.
3. **Executor `pauta.coletar-comentarios`** (cron `*/10`): lê pela porta só as mídias dos últimos 7
   dias com palavra (carrossel e corte). O id da mídia vem de `PautaPublicacao.externalId` (MD6); na
   postagem manual da MC16, o executor resolve o `urlPublicada` pelo `midiasDesde` que já existe,
   comparando o permalink.
4. **Casamento:** exportar `normalizarPalavra` de `pauta/derivacao-do-episodio.ts`; função pura
   `casaPalavraInteira` ("AGENTES2" não casa com "AGENTES"); o coletor ignora comentário da própria
   conta, com mais de 7 dias, com `ad_id` ou que seja resposta (`parent_id`), salvo nota em contrário.
5. **Tabela `ComentarioComPalavra`** (`orgId`, RLS FORCE, semente): `commentId` único por empresa;
   `midiaId`; `pecaId`; `palavra`; `pessoaHmac` (HMAC-SHA256 com `META_WEBHOOK_PESSOA_HMAC_KEY`, o nome
   da MC18); `usuario` (o @, que só existe porque a resposta é manual); `comentadoEm`; `expiraEm` =
   `comentadoEm` + 7 dias; `respondidoEm`; `respondidoPor`. **O texto do comentário não é gravado.** O
   executor anula o `usuario` depois de `expiraEm`.
6. **Fila na aba Semana, "Quem comentou e o que responder":** @, palavra, peça, "copiar texto", "abrir
   perfil" e "marquei como respondido". O RASTRO registra `pauta.dm_manual_respondida` só com o HMAC.
7. **Variável nova** `META_WEBHOOK_PESSOA_HMAC_KEY` no compose e no `.env.example`.
8. **Testes:** os da MC18.0 listados na especificação; coletor com dublê (paginação, palavra inteira,
   própria conta, 7 dias, reentrega na mesma linha); expurgo do @; RASTRO sem @ nem id em claro; web a
   375 px; isolamento.

**Pronto quando.** Graph dublê e uma peça publicada pela MD6, ou marcada como postada com permalink:
três comentários no dublê (a palavra certa, "palavra2" e um da própria conta) → uma linha só na fila,
com @ e texto com o `/r/` do link de campanha; copiar e marcar como respondido → RASTRO sem @; com 7
dias simulados, o @ some da linha; o clique no `/r/` vira `PixelEvent` separado do botão da página.

**Manual.** O escopo de comentários já vem na reconexão da MD5; gerar `META_WEBHOOK_PESSOA_HMAC_KEY` no
easyPanel; criar a rotina `pauta.coletar-comentarios` em `/rotinas`; mandar as DMs à mão a partir da
fila; publicar em `docs/PRIVACY.md` o parágrafo de dados de quem comenta (D-MC9.9).

**Risco.** A consulta a cada 10 min dá ~60 chamadas por hora para 10 mídias (o limite exato da Graph
está a conferir). Guardar o @ por 7 dias é dado pessoal e pede base legal e aviso de privacidade. Se
o volume passar do que dá para responder à mão, a pressão vai para ManyChat, que fica fora do OS.


### MD10 — YouTube: conector próprio, upload resumable pelo Mac e publicação agendada pelo OS

> **Estado (25/09/2026):** implementada, com o ensaio do "pronto quando" contra dublê local do
> Google (300 MB em 5 blocos, a conexão derrubada no 3º) e as pendências do Pedro registrados no
> `docs/ESTADO-DA-EXECUCAO.md` (§1, onda D, e item 32 da §4). Escolhas além do texto abaixo: a
> thumb e a playlist entram na conclusão (um segundo uso do item de envio, pela porta) e são
> conferidas de novo no agendamento, que recusa sem a thumb assinada; `YOUTUBE_OAUTH_URL` existe para
> o dublê renovar o token; o "desligado até o OAuth" é o conector sem credencial (não há interruptor
> desligado por padrão); a thumb escolhida e o horário viraram colunas do episódio e o arquivo é
> declarado por rota própria; o token de acesso fica só na memória da API e cada entrega ao Mac vai ao
> RASTRO. Depois dos três revisores: o Mac recebe um token renovado com `scope=youtube.upload` (o
> largo não sai com a auditoria aprovada); a sessão e o token só saem dentro da janela do item de
> envio; o modo teste exige `YOUTUBE_CANAL_DE_TESTE` e marca o vídeo, que nunca é publicado; o pacote
> mudado revoga os itens; a rotina parte dos itens vivos e, com a nota desligada, só pula.

**SPEC.** O Mac só envia os bytes; o OS abre a sessão com os metadados travados (sempre `private`),
guarda a credencial, confere o vídeo e publica.

1. **Módulo `apps/api/src/youtube/`** (`YoutubeModule`, `YoutubeService`, `YoutubeConexaoController`):
   OAuth web próprio num projeto dedicado do Google Cloud (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`,
   `YOUTUBE_REDIRECT_URI`); escopos `youtube.upload` e `youtube.force-ssl`; `access_type=offline` e
   `prompt=consent`; refresh token no cofre (`cofre/cofre.service.ts`, chave `youtube`); a saúde acusa
   tela de consentimento em Testing (token vence em 7 dias) e há revogação; molde em
   `google/google.service.ts` (authUrl e `token()`), **sem tocar no `SCOPES` do Google**; conector
   `youtube` no `CONNECTORS` do shared, no `RegistroDeConectores` e em `CONECTOR_DA_CAPACIDADE`,
   **nascendo desligado e sem credencial** até o OAuth do Pedro; prefixo `youtube` em `modulos.ts`
   (módulo `pauta`), com o callback no padrão público de `google-conexao.controller.ts`;
   `YOUTUBE_API_URL` e `YOUTUBE_UPLOAD_URL` sobrescrevíveis para dublê.
2. **Interruptor de auditoria (D-MC6):** `YOUTUBE_AUDITORIA` = `pendente` (padrão: sessão de envio e
   publicação recusadas, com a mensagem de que o vídeo ficaria privado para sempre), `teste` (envio
   liberado, para canal de teste; publicação recusada) ou `aprovada` (tudo). O envio é **sempre**
   `privacyStatus: private`, em qualquer valor.
3. **Capacidades, as duas `sob_lote` de `pauta.semana.aprovar`:** `youtube.video.enviar` —
   `{escreveForaDoOS: true, reversibilidade: 'manual', exposicaoExterna: false, sensibilidade:
   'publica'}` → R3 (`automatica` daria R2, mas desfazer seria apagar o vídeo, que é destruição e R5,
   então o valor honesto é `manual`); `youtube.video.publicar` — `{escreveForaDoOS: true,
   reversibilidade: 'manual', exposicaoExterna: true, sensibilidade: 'publica'}` → R3, com a thumb e a
   playlist no mesmo efeito. Os itens entram no lote da semana (MD8): o de envio com hash
   `{episodioId, sha256, bytes, título, descrição, categoria, sha da thumb}`, o de publicação soma o
   `publishAt`.
4. **Rotas (`pauta.editar`):** `POST /pauta/episodios/:id/youtube/sessao {bytes, sha256, mime}` —
   confere o item de envio ativo e o interruptor de auditoria; abre a sessão resumable com os
   metadados do pacote da MC11, **sempre `private` e sem `publishAt`**; valida título ≤ 100
   caracteres e descrição ≤ 5.000 **bytes** depois de trocar `{{pagina-de-links}}`; guarda a URI da
   sessão cifrada (`common/crypto.ts`) na tabela `EnvioAoYoutube` (`orgId` RLS; `episodioId`,
   `sha256`, `bytes`, `sessaoCifrada`, `videoId`, `estado`, `expiraEm` de 7 dias); devolve a URI e um
   access token curto (~1 h; o refresh token nunca sai do cofre). `POST …/youtube/sessao/token` —
   token novo, só com sessão aberta. `POST …/youtube/concluido {videoId}` — `videos.list` confere que
   o vídeo está privado e que os metadados batem; `thumbnails.set` envia o PNG escolhido, lido do
   MinIO; playlist opcional pela nota `pauta.youtube.playlist`.
5. **Publicação:** dentro da janela do lote e com `YOUTUBE_AUDITORIA=aprovada`, o executor relê o
   vídeo, recusa se título, descrição ou thumb divergirem do hash e manda `videos.update` com
   **`part=status`** e `publishAt` no horário do pacote (o update de snippet apagaria o que fosse
   omitido). Daí em diante quem publica é o YouTube.
6. **Mac** (`root-midia youtube ep-NN` ou o passo do vigia da MD2 quando o lote tiver o item de envio):
   `sha256` do `final.mp4` por stream; pede a sessão e manda blocos de 64 MiB (múltiplos de 256 KiB)
   com `fetch` nativo; retoma com `Content-Range: bytes */total` e resposta 308; 5xx espera e tenta de
   novo; 404 abre sessão nova; estado em `~/.config/root/youtube-ep-NN.json`. O vídeo não passa pela
   VPS.
7. **Variáveis novas** no compose e no `.env.example`: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`,
   `YOUTUBE_REDIRECT_URI`, `YOUTUBE_API_URL`, `YOUTUBE_UPLOAD_URL` e `YOUTUBE_AUDITORIA`.
8. **Testes:** `youtube.test.ts` com dublê do protocolo (308 com `Range`, 404 de sessão, 5xx); service
   montado à mão (sessão só com item ativo; interruptor `pendente` recusa a sessão e `teste` recusa a
   publicação; hash divergente recusa publicar; o update manda só `part=status`); `root-midia`
   retomando depois de corte no meio; isolamento, `modulos-por-tenant` e `arquitetura` (literal
   `googleapis` só no conector).

**Pronto quando.** Com um dublê local do YouTube: arquivo sintético de 300 MB em 5 blocos, com a
conexão derrubada no 3º; a retomada pelo 308 completa o envio e o dublê devolve o `videoId`; o OS
confere o vídeo e define a thumb; com o lote ativo e `YOUTUBE_AUDITORIA=aprovada`, o OS manda
`publishAt`; sem lote, ou com `pendente`, a abertura de sessão é recusada e o dublê não recebe nada.

**Manual.** Dizer qual conta Google é dona do canal da Root (pessoal, Workspace ou Brand Account);
criar o projeto dedicado no Google Cloud, ativar a YouTube Data API v3, criar o client OAuth web com a
redirect e pôr a tela de consentimento em produção (ou Internal); verificar o canal por telefone em
`youtube.com/verify` (sem isso o `thumbnails.set` devolve 403); pedir a auditoria no formulário
`yt_api_form`, com política de privacidade publicada e conta de demonstração; fazer o consentimento
OAuth uma vez, logado na conta dona do canal; trocar `YOUTUBE_AUDITORIA` para `aprovada` quando a
auditoria sair.

**Risco.** Antes da auditoria, qualquer teste real trava o vídeo em privado sem recurso, então teste
só em canal de teste. O Mac recebe por ~1 h um token com os dois escopos (defesas: token curto, só
para sessão aberta, RASTRO e releitura pelo OS antes de publicar; se o refresh com
`scope=youtube.upload` devolver token mais estreito — **a conferir** —, o Mac passa a receber só
esse). O prazo da auditoria é desconhecido.

**Correção da premissa (revisão final, 25/09).** O token só de envio NÃO impede publicar: o
`videos.insert` aceita `youtube.upload` e grava `status.privacyStatus` na inserção, então, com a
auditoria aprovada, ele cria vídeo público à parte no canal, fora da porta. `soEnvio` defende só
contra alterar e apagar vídeo. O risco residual é da D-MC6 e está com o Pedro (ESTADO, MD10,
pendência 10). No código: o token, a sessão e a conclusão pedem `pauta.youtube.enviar` (a conta do
Mac, não todo editor); a conclusão pergunta à sessão aberta pelo OS qual vídeo ela criou (o id do
Mac não é a fonte da verdade) e confere `fileDetails.fileSize` com os bytes assinados; e lê a
playlist de uploads do canal, alertando sobre vídeo não privado que o OS não abriu.


### MD11 — DM automática sob o lote, disparada pelo coletor

> **Estado (25/09/2026):** implementada e **desligada** (nota `pauta.dm.automatica`), com o ensaio do
> "pronto quando" contra dublê local da Graph e as pendências do Pedro registrados no
> `docs/ESTADO-DA-EXECUCAO.md` (§1, onda D, e item 34 da §4). Escolhas além do texto abaixo: pausar é
> **R0**, não R1 (R1 com sinal vira R2 e exige outra pessoa, e pausar é o freio); as pausas automáticas
> revogam o item pelo serviço do lote, como a rotina de publicação (MD8), e a capacidade é o botão da
> tela; `midias` são as PEÇAS da matéria (a regra é assinada antes de os posts existirem na Meta); o
> id do comentário não entra nos argumentos nem no RASTRO — o efeito acha a linha do envio pela
> correlação da passagem; duas capacidades novas, não três (a ativação é o lote); a coleta da MD9
> deixou de regravar o destino do link de campanha (a troca no /bio fica, e a regra a vê);
> `INSTAGRAM_PEDIR_MENSAGENS` liga o pedido do escopo de mensagens na conexão, só depois do painel e
> do App Review.

**SPEC.** A MC18.1 a MC18.4 adaptadas ao lote da MD7/MD8, sem depender do webhook. **Implementada e
desligada** até o App Review.

1. **Capacidade `instagram.resposta_privada.enviar`:** o efeito da MC18 (`escreveForaDoOS`,
   reversibilidade `nenhuma`, exposição, `publica`, alcance 1) → R3, e o sinal `fonte_nao_confiavel`,
   que o executor marca sempre, sobe para **R4**; `aprovacao {modo: 'sob_lote', lote:
   'pauta.semana.aprovar'}` — o lote R4 cobre, e o teste de `verificarCatalogo()` da MD7 trava a
   desigualdade.
2. **A regra de cada palavra vira item do lote da semana (MD8):** `tetoPorDia` com padrão 100 (teto
   de 200 no catálogo, D-MC9.2); janela de 7 dias a partir da publicação da peça; hash `{palavra,
   texto, bioLinkId, destinoAprovado, midias}`; consumo contado por dia com o SQL do item 6 da MC18,
   com virada em `America/Sao_Paulo`; pausar é a capacidade `instagram.regra_de_resposta.pausar`, R1.
3. **Disparo:** o coletor da MD9, a cada 10 min. O webhook (MC18.3) sai da primeira versão e volta
   depois como melhoria de latência, com prefixo `webhooks/meta` (o `meta` é do módulo `instagram`),
   `META_WEBHOOK_APP_SECRET` explícito e a assinatura conferida antes de tocar no banco.
4. **Para cada comentário casado, nesta ordem:** deduplica por `commentId` e pelo par `(itemId,
   pessoaHmac)`; confere que o destino atual do `BioLink` é o aprovado e que a página está no ar (se
   não, pausa a regra); confere a janela 08h–20h de SP calculada pelo executor (fora dela, segura até
   as 08h); chama a porta com `loteItemId` e procedência externa; o efeito faz `POST <IG_ID>/messages`
   com `recipient.comment_id` pelo conector; grava em `EnvioDeResposta`, como na MC18, com HMAC e
   retenção de 90 dias.
5. **Texto:** abre com uma linha avisando que a mensagem é automática; no máximo 1000 bytes; fixo, sem
   IA na hora do envio.
6. **Falhas:** três recusas seguidas da Meta pausam a regra; o erro `100/2534001` grava "precisa de
   Advanced Access" e pausa.
7. **Interruptor:** nota `pauta.dm.automatica`, **desligada por padrão**. Desligada, nenhum envio sai e
   a fila manual da MD9 continua.
8. **Seed:** as três capacidades novas com `POLITICA_CAPACIDADE_NOVA_*`; a invariante 4 já mudou na
   MD7.
9. **Testes:** os de `resposta-pre-aprovada.test.ts` da especificação MC18, adaptados ao item de lote,
   mais o dublê devolvendo `100/2534001`.

**Pronto quando.** Com a Graph dublê e a nota ligada: um comentário casado gera um envio com o `/r/`;
a mesma pessoa não recebe duas mensagens; o 101º envio do dia é recusado e o item continua ativo; a
virada do dia zera o contador sem nova aprovação; fora da janela, o envio fica segurado até as 08h de
SP; destino alterado no `/bio` pausa a regra; com a nota desligada, nenhum envio sai; o RASTRO
registra R4 com o aprovador do lote, sem `comment_id` nem pessoa em claro.

**Manual.** Verificação da empresa no portfólio de negócios da Meta; **um** pedido de App Review com
`instagram_business_basic`, `_manage_comments`, `_manage_messages` e `_content_publish` (a página de
Private Replies não exige `manage_messages`, mas o relato de campo mostra que sem ele a DM falha para
quem não tem papel no app), com o vídeo do fluxo, política de privacidade e URL de exclusão de dados,
e depois o app em Live; reconectar com `_manage_messages`; teste único comentando com uma conta sem
papel no app (o erro `100/2534001` confirma que a mensagem exige Advanced Access); segundo titular na
empresa e seed assinado (MD7); só então ligar a nota `pauta.dm.automatica`.

**Risco.** O App Review pode ser negado ou demorar, e aí a fila manual da MD9 fica. Um robô comentando
a palavra gasta o teto do dia. "Não quero saber de AGENTES" também casa. A marca passa a falar
sozinha com estranhos.


### MD12 — TikTok pela caixa de entrada — **em espera**

**Não entra nesta onda** (decisão do Pedro, 24/09/2026). O desenho fica registrado para quando voltar.

**SPEC (para depois).** No horário do slot, o OS manda o corte para a caixa de entrada do TikTok da
Root: Content Posting API no modo `MEDIA_UPLOAD` (escopo `video.upload`), `FILE_UPLOAD` em partes de 5
a 64 MB lidas do MinIO por stream, e o Pedro termina o post no app com um toque. Capacidade
`tiktok.rascunho.enviar` (`{escreveForaDoOS: true, reversibilidade: 'manual', exposicaoExterna: false,
sensibilidade: 'publica'}` → R3), `sob_lote` do lote da semana. `bio/plataformas/tiktok.ts` ganha
`ESCOPOS_DE_PUBLICACAO` com `video.upload` e a finalidade de publicação, no desenho da MD5.
`PautaPublicacao` com rede `tiktok` ganha o estado `na_caixa_de_entrada`, e o Pedro marca como postada
(MC16). Teto: no máximo 5 envios pendentes em 24 h; o nosso lado recusa antes da API e limita a 2
cortes por dia. O Direct Post fica fora (sem auditoria, sai `SELF_ONLY` e exige conta privada).

**Pronto quando (para depois).** Com dublê do TikTok: init → 3 partes → status → a peça fica
`na_caixa_de_entrada`; o sexto envio em 24 h é recusado antes da chamada; com o conector desligado, a
recusa sai sem chamada.

**Manual (para depois).** Adicionar a Content Posting API e o escopo `video.upload` ao app no portal
do TikTok (se o escopo passa por revisão é **a conferir**); conferir se o envio de app não auditado
para a caixa de entrada também sai privado; reconectar o TikTok com o escopo novo.

**Risco.** O ganho é pequeno, porque ainda exige o toque no app. A recomendação é só voltar a ela
depois de uma semana real com o Instagram automático.


### MD13 — Corte com nota e motivo

> **Estado (25/09/2026):** implementada, com o ensaio do "pronto quando" contra dublê local do
> modelo e MinIO descartável registrado no `docs/ESTADO-DA-EXECUCAO.md` (§1, onda D, fatia MD13, e
> item 33 da §4). Escolhas além do texto abaixo: a meta guarda os 3 candidatos (e não só "os
> outros"), com o que está em uso marcado pelo trecho; a resposta antiga do modelo (`de`/`ate` no
> próprio corte) vira um candidato sem nota; a troca só aparece antes do lote (o corte proposto da
> aba Semana e o corte em rascunho da semana de posts); o Mac manda o trecho que renderizou no
> registro e no envio do mp4, e a API recusa com 409 o de outro trecho; e a troca grava
> `meta.renderPedidoEm`, que entra na assinatura do render para o vigia não pular a volta a um
> trecho já renderizado.

**SPEC.** Independente das outras fatias; entra a qualquer hora depois da MD1.

1. Na derivação por matéria (`pauta/derivacao-do-episodio.ts`, a mesma chamada de hoje), o modelo
   devolve até 3 candidatos de corte, cada um com `nota` de 0 a 10 e `motivo` curto, avaliando gancho
   nos 3 primeiros segundos, fala completa e ausência de referência a slide anterior.
2. Cada candidato passa pela função pura que já existe (dentro do vídeo, em ordem, menos de 3 min, pelo
   menos 10 s).
3. O de maior nota vira o corte; os outros ficam em `meta.cortesCandidatos`.
4. Na aba Semana dá para trocar o candidato antes do lote. A troca desassocia o mp4 do storage da peça
   (`meta.video` volta a nulo; o objeto no MinIO não é apagado) e marca para novo render, que o vigia
   da MD2 faz.
5. Sem dependência; o custo é um pouco mais de tokens de saída na mesma chamada.
6. **Testes** em `pauta-semana.test.ts` com o dublê: 3 candidatos, candidato inválido descartado com
   motivo, troca voltando o render a pendente.

**Pronto quando.** Ensaio com LLM dublê: cada matéria sai com 3 candidatos e o de maior nota como
padrão; trocar pela tela marca a peça para novo render; o vigia re-renderiza e o sha do mp4 no OS
muda.

**Manual.** Nenhum.

**Risco.** A nota do modelo não mede viralidade; serve só para ordenar a revisão humana.


## Não fazer

- Não adotar MoneyPrinterTurbo, MoneyPrinter, ShortGPT ou OpenReels como motor. Eles geram vídeo sem
  rosto a partir de banco de imagens, e a peça-mãe da Root é o vídeo gravado pelo Pedro. A publicação
  "um clique" deles sai por um SaaS (Upload-Post) que guarda os tokens das redes fora do OS.
- Não usar automação de navegador com perfil logado (MoneyPrinterV2 com Selenium,
  social-auto-upload), nem o agent-browser, para postar. Fere os termos das plataformas e não deixa
  aprovação nem RASTRO confiáveis.
- Não subir o Postiz agora. É serviço novo com cofre de tokens fora do OS, Temporal e Postgres
  próprios, numa VPS que já vive no teto. Para a conta da própria Root, a Graph direto pelo OS resolve
  com Standard Access. Rever quando aparecer cliente com várias redes (D-MC8).
- Não copiar código AGPL (Postiz, OpenMontage, MoneyPrinterV2, Post for Me) para dentro do OS.
  Aproveitar só ideias: draft/schedule/now, upload de mídia separado do post, portões de aprovação e
  interruptores desligados por padrão.
- Não ligar o MCP do Postiz, do OpenShorts ou de qualquer publicador direto num agente. Isso pula a
  porta, a régua e o RASTRO. O agente fala só com o OS.
- Não usar intermediário SaaS (Upload-Post, Post for Me em nuvem, ManyChat) sem decisão do Pedro. Se
  entrar, é efeito registrado, com o custo no quadro "por fora" das propostas.
- Não rebaixar a publicação para R2 nem declarar a ativação do lote com `escreveForaDoOS: false` para
  fugir da segunda pessoa. É o desconto de degrau que a régua existe para impedir.
- Não resolver a segunda pessoa com "propor em nome do agente" (D-MC9.3 b). Também não mexer no
  `publicar-peca.test.ts` nem na rota antiga `POST /pauta/pecas/:id/publicar` pelo caminho novo.
- Não pedir App Review para publicar na conta da própria Root: o Standard Access basta. O App Review
  só entra para a DM automática e para publicar em contas de clientes.
- Não pôr os escopos de publicação no `ESCOPOS` global da bio, porque seriam pedidos a todo criador
  que conecta.
- Não usar o Direct Post do TikTok sem auditoria: sai `SELF_ONLY` e exige conta privada.
- Não subir episódio real pela YouTube API antes da auditoria achando que vira rascunho
  reaproveitável. O vídeo fica privado para sempre, e só se testa em canal de teste.
- Não fazer o vídeo do episódio passar pela VPS. O Mac envia direto ao YouTube numa sessão aberta pelo
  OS.
- Não apagar nada pela automação: nem o bruto e o final no Mac, nem post ou vídeo nas redes. Apagar é
  destruição e vale R5.
- Não deixar o vigia do Mac usar o PalmierPro, que exige o app aberto, nem baixar modelo do whisper
  sozinho (D-MC3).
- Não tornar o webhook de comentários pré-requisito da DM. A consulta periódica cobre a primeira
  versão, e o webhook vira melhoria de latência depois do App Review.
- Não rodar duas réplicas da API. O freio do segundo clique (`umaPorVez`) mora na memória do processo.
- Não copiar nem citar o `agenciametrik/rato-ia`. É material de curso sem licença, com pastas de
  clientes de terceiros.


## A ordem de execução

**MD1 → MD2 → MD3 → MD4 → MD5 → MD6 → MD7 → MD8 → MD9 → MD10 → MD13 → MD11.** A MD12 fica em espera.

| # | Fatia | Por que neste lugar |
|---|---|---|
| 1 | MD1 | Dá resultado sem Meta e sem mexer na régua: a semana chega em rascunho sozinha |
| 2 | MD2 | Fecha a outra ponta sem Meta: o Mac processa a gravação sem ninguém chamar o comando |
| 3 | MD3 | Conserto pequeno que tem de estar antes de qualquer publicação no horário (o post das 18h subiria de degrau) |
| 4 | MD4 | A Meta só baixa mídia de URL pública; sem ela, nenhum container nasce |
| 5 | MD5 | A conta com permissão de publicar, e o escopo de comentários já junto |
| 6 | MD6 | O publicador, que já funciona item a item com segunda pessoa, antes de existir o lote |
| 7 | MD7 | A régua aprende o lote; é a mudança sensível, feita com o publicador já testado |
| 8 | MD8 | O botão "Aprovar a semana", que junta MD1, MD4, MD6 e MD7 |
| 9 | MD9 | A fila manual de DM, que liga já e aproveita o `externalId` da MD6 |
| 10 | MD10 | O YouTube entra no mesmo lote; depende da auditoria para publicar de verdade |
| 11 | MD13 | Melhoria independente, sem risco, antes da fatia que depende da Meta |
| 12 | MD11 | Por último: implementada e desligada até o App Review, reaproveitando lote, coletor e fila |

Cada fatia é um commit narrativo, com as suítes da verificação do plano verdes, os pisos da CI subidos
com a conta escrita e, quando houver schema, `db:diff` limpo e `test:isolamento` verde.


## O que fica com o Pedro

Nenhum agente faz estes passos; o código não contorna nenhum deles. Na ordem do que destrava mais:

1. **Resolver o 403 da fila em produção** (`db:sync-permissions`, pendente desde 12/09/2026) e **criar
   o segundo usuário `titular`** na empresa Root (Lucas ou Rodrigo). Sem os dois, nada que passa por
   aprovação sai, nem item a item.
2. **Assinar o `db:seed:politica`** com `POLITICA_CAPACIDADE_NOVA_*` e `POLITICA_REBAIXAMENTO_*` e, no
   mesmo dia, atualizar a nota `09 - Escada de risco R0-R5.md` do vault. Sem o seed, as capacidades
   novas valem R5.
3. **Decidir a virada do papel restrito** (passo 16 do ESTADO): virado, nenhuma rotina dispara.
4. **Painel da Meta** (MD5): app Business com o caso de uso do Instagram, Standard Access, redirect
   conferida, @ da Root como Instagram Tester com o convite aceito; depois do deploy, reconectar pela
   aba Semana.
5. **Criar as rotinas** em `/rotinas` (encadeamento, publicar agendadas, coletar comentários) e ligar
   a publicação automática na aba Semana (o interruptor com motivo, que grava a nota
   `pauta.publicacao.automatica`) quando quiser a publicação no horário. Sem a rotina de publicação,
   a tela avisa que nada sai no horário.
6. **Mac:** baixar o modelo do whisper (D-MC3), gravar `~/.config/root/root-midia.env` com `chmod 600`
   e rodar `root-midia vigia instalar`.
6b. **Rota até a API sem passar pelo web** (Traefik, corpo de 300 MB ou mais) e `ROOT_OS_ENVIO_URL`
   no `~/.config/root/root-midia.env`, antes do deploy: sem ela, o corte acima de 10 MB não sobe e
   não entra no lote.
7. **Segredos no easyPanel** (gerados na hora, nunca colados em chat): `PAUTA_MIDIA_PUBLICA_SEGREDO`,
   `META_WEBHOOK_PESSOA_HMAC_KEY` e, quando a MD10 entrar, `YOUTUBE_CLIENT_ID`/`_SECRET`.
8. **YouTube:** dizer a conta dona do canal, criar o projeto dedicado, verificar o canal por telefone,
   pedir a auditoria e fazer o consentimento OAuth.
9. **Privacidade:** publicar `docs/PRIVACY.md` com o parágrafo de quem comenta (pedido pelo App Review
   e pela auditoria do YouTube).
10. **Meta, para a DM automática:** verificação da empresa, um App Review com as quatro permissões, o
    app em Live e o teste único com conta sem papel no app; só então ligar a DM automática na aba
    Semana (a API recusa antes de `INSTAGRAM_PEDIR_MENSAGENS=sim`).
10b. **A ordem de deploy da onda inteira** está no ESTADO, no fim da MD11 ("ORDEM DE DEPLOY DA ONDA
    D"): um seed só, com as duas assinaturas, e a linha de boot com 69 capacidades.
11. **Responder à mão** as DMs da semana pela fila da MD9 até lá.


## Riscos da onda

- **A primeira escrita pública automática do OS** (MD6/MD8): um lote assinado publica a semana sem
  ninguém olhando na hora. Os portões são o seed assinado, a segunda pessoa, o hash por item e o
  interruptor da empresa.
- **A invariante 4 muda** (MD7). Um defeito no consumo contado solta publicação sem assinatura; o
  consumo é uma instrução só, com teste de corrida.
- **Nenhum prompt da frente viu um modelo real**, e a MD1 encadeia todos sem ninguém olhando entre
  eles. A revisão de segunda é o freio.
- **O papel restrito cala todas as rotinas** desta onda, sem erro visível.
- **Rota pública nova servindo arquivo** (MD4), protegida por HMAC de 1 h conferido antes do banco.
- **Os números da Meta e do Google mudam** (versão da Graph, limites, regras de janela, prazo da
  auditoria): cada "a conferir" é conferido de novo no início da fatia que depende dele.
- **A branch só existe no disco**, o risco nº 1 do plano inteiro.


## Fontes

Consultadas em 24/09/2026.

**Meta (Instagram)**

- Instagram Platform, visão geral e níveis de acesso — https://developers.facebook.com/docs/instagram-platform/overview/
- App Review do Instagram (Standard Access para conta própria: "Not required") — https://developers.facebook.com/documentation/instagram-platform/app-review
- Níveis de acesso da Graph API — https://developers.facebook.com/docs/graph-api/overview/access-levels/
- Papéis do app — https://developers.facebook.com/docs/development/build-and-test/app-roles/
- Modos do app — https://developers.facebook.com/docs/development/build-and-test/app-modes/
- Content Publishing — https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Referência `IG User Media` — https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- Business Login do Instagram (escopos, token de 60 dias, redirect) — https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
- Webhooks (Advanced Access para `comments`) — https://developers.facebook.com/docs/instagram-platform/webhooks/
- Comment Moderation (ler comentários com Standard Access) — https://developers.facebook.com/docs/instagram-platform/comment-moderation/
- Private Replies — https://developers.facebook.com/docs/instagram-platform/private-replies/
- Messaging API (1000 bytes, aviso de bot) — https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/
- Versões da Graph API — https://developers.facebook.com/docs/graph-api/changelog/versions/
- Relato de campo do erro `100/2534001` (não oficial) — https://github.com/atakansaracoglu/insta-auto/pull/6

**Google (YouTube)**

- `videos.insert` (trava de privado sem auditoria) — https://developers.google.com/youtube/v3/docs/videos/insert
- Vídeo travado como privado não tem recurso — https://support.google.com/youtube/answer/7300965?hl=en
- Auditoria e extensão de cota — https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- Formulário da auditoria — https://support.google.com/youtube/contact/yt_api_form
- Upload resumable — https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- `videos.update` — https://developers.google.com/youtube/v3/docs/videos/update
- Recurso `videos` (`publishAt`, limites de título e descrição) — https://developers.google.com/youtube/v3/docs/videos
- `thumbnails.set` — https://developers.google.com/youtube/v3/docs/thumbnails/set
- Custo de cota — https://developers.google.com/youtube/v3/determine_quota_cost
- OAuth 2.0 (refresh token de 7 dias em Testing) — https://developers.google.com/identity/protocols/oauth2
- Políticas de desenvolvedor (consentimento antes de upload automatizado) — https://developers.google.com/youtube/terms/developer-policies

**TikTok**

- Content Posting API, primeiros passos (cliente não auditado = privado) — https://developers.tiktok.com/doc/content-posting-api-get-started
- Upload para a caixa de entrada — https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
- Regras de compartilhamento — https://developers.tiktok.com/doc/content-sharing-guidelines

**Open-source e referência**

- MoneyPrinterTurbo — https://github.com/harry0703/MoneyPrinterTurbo (e `app/services/upload_post.py`)
- OpenMontage — https://github.com/calesthio/OpenMontage
- Postiz — https://github.com/gitroomhq/postiz-app e https://docs.postiz.com/public-api
- OpenShorts — https://github.com/mutonby/openshorts
- youtube-shorts-pipeline — https://github.com/rushindrasinha/youtube-shorts-pipeline
- MoneyPrinterV2 — https://github.com/FujiwaraChoki/MoneyPrinterV2
- social-auto-upload — https://github.com/dreammis/social-auto-upload
- Post for Me — https://github.com/DayMoonDevelopment/post-for-me
- Texto da AGPL-3.0, seção 13 — https://opensource.org/license/agpl-v3
- O vídeo da Ratos de IA que é o modelo da frente — https://www.youtube.com/watch?v=WnZsMYeR7aA
