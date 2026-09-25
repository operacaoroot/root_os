# Guia da máquina de conteúdo

Uma gravação por semana vira a semana inteira: episódio no YouTube, newsletter, página de links e
12 posts no Instagram. Este guia é para quem opera a máquina (o Pedro) depois do deploy das ondas
MC-A, MC-B, MC-C e D. A ordem de deploy está em `docs/ESTADO-DA-EXECUCAO.md`, seção "Onda MD", e o
plano da frente em `docs/PLANO-MAQUINA-DE-CONTEUDO.md`.

Atualizado em 25/09/2026.

---

## (a) O que a máquina faz sozinha e onde ela para

### Sozinha

1. **Link colado no grupo "Root · links"** vira captura em `/referencias` em menos de 1 minuto.
2. **Quinta, 22h:** a rotina de coleta lê o grupo, o Gmail, as buscas, os feeds e os creators, e
   deixa a rodada da semana esperando a curadoria.
3. **Depois da gravação:** o vigia do Mac acha o arquivo novo do OBS, corta os silêncios e as
   tomadas erradas, transcreve e manda ao OS. O bruto nunca é apagado.
4. **Da transcrição à semana em rascunho:** a rotina de encadeamento gera o pacote do YouTube, monta
   a página de links (fora do ar), gera a newsletter, as 12 peças (carrossel, story e corte por
   matéria) e propõe um horário para cada uma.
5. **Renders no Mac:** o vigia renderiza os cortes, os stories e os carrosséis e sobe o mp4 e o JPEG
   ao OS, porque a Meta só publica o que consegue baixar.
6. **Com a semana assinada:** cada post sai no Instagram no horário dele, uma vez só. O vídeo sobe do
   Mac direto ao YouTube, sempre privado, e o OS marca o horário de publicação quando a auditoria do
   Google sair.
7. **A cada 10 minutos:** quem comentou a palavra-chave de um post aparece na fila de respostas, com
   o texto da DM e o link rastreado da matéria.

### Onde ela para e espera uma pessoa

- **Curadoria:** marcar as notícias que seguem. A IA só sugere.
- **Roteiro:** gerar, ler e ajustar. Gerar o roteiro põe o episódio em Gravação, e é isso que
  autoriza o vigia a pegar o próximo arquivo do OBS.
- **Pacote do YouTube:** escolher o título, a thumb e o horário.
- **Página de links:** pôr no ar. A máquina só monta.
- **Newsletter:** copiar e enviar à mão (o destino ainda não foi decidido, D-MC7).
- **"Aprovar a semana":** o Pedro revisa e pede a assinatura; outra pessoa com alçada titular (Lucas
  ou Rodrigo) lê cada post e assina com senha e motivo. Sem essa assinatura nada sai.
- **Interruptores:** a publicação automática e a DM automática nascem desligadas e só uma pessoa
  liga.
- **DM:** até o App Review da Meta, a resposta é à mão, a partir da fila.

---

## (b) Configurar uma vez

Cada passo diz onde fazer e o que confere que deu certo. Os passos 1 a 5 são no servidor e vêm
antes de tudo; o resto pode seguir em qualquer ordem, menos onde o texto avisa.

**No servidor (VPS ROOT)**

1. **Deploy na ordem consolidada.** Siga `docs/ESTADO-DA-EXECUCAO.md`, seção "Onda MD", "Ordem de
   deploy consolidada da frente inteira".
   *Confere:* `docker logs mktos_api` mostra `política base vN carregada DO BANCO (71 capacidades)`.
2. **Seed da política, assinado, antes do `up`.** A assinatura é o portão humano da publicação
   automática. Comando pronto em `docs/DEPLOY.md` §2.3l (`POLITICA_CAPACIDADE_NOVA_*` e
   `POLITICA_REBAIXAMENTO_*`, as duas).
   *Confere:* o seed termina com `capacidades: 7 criadas (9 se a agenda da Root ainda não tiver sido semeada), … 71 no total`. Se disser "Nada foi
   semeado", faltou uma das duas assinaturas.
3. **Permissões novas, em três passos.** `pnpm --filter @mktos/shared build`, depois
   `pnpm --filter @mktos/api db:sync-permissions`, depois todo mundo sai e entra de novo.
   *Confere:* `/atendimento` abre sem 403 para você e para o titular (o 403 está pendente desde
   12/09/2026).
4. **Segredos na aba Ambiente do easyPanel e no `environment:` do compose do painel** (gerados no terminal da VPS com `openssl rand -base64 48`, nunca
   colados em chat): `PAUTA_MIDIA_PUBLICA_SEGREDO` e `META_WEBHOOK_PESSOA_HMAC_KEY`. Conferir também
   `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT` e `S3_BUCKET`. Recriar o container
   (`docker compose -p root_marketing-os up -d --no-build api` em
   `/etc/easypanel/projects/root/marketing-os/code`; restart não basta).
   *Confere:* o boot mostra `storage pronto` e `mídia das peças no storage: …`.
5. **Rota até a API sem passar pelo web.** O proxy do Next corta o corpo em 10 MB e o mp4 do corte
   passa disso. No easyPanel, um domínio próprio da API ou uma regra do Traefik para
   `POST /api/pauta/pecas/*/video/arquivo` apontando para `mktos_api:4001`, sem limite de corpo
   abaixo de 300 MB.
   *Confere:* o passo 8 (arquivo do Mac) com `ROOT_OS_ENVIO_URL` apontando para ela, e um corte
   acima de 10 MB subindo na primeira semana.

**Pessoas e permissões**

6. **Segundo titular.** Em `/regua`, aba Pessoas, criar o Lucas ou o Rodrigo com o papel Admin
   Master. O código não contorna a segunda pessoa.
   *Confere:* ele entra, abre `/atendimento` e vê a fila.
7. **Conta do Mac.** Crie em `/regua`, aba Pessoas, uma conta usada só pelo Mac. Ela precisa de
   `pauta.editar` e, para mandar o vídeo ao YouTube, de `pauta.enviar_ao_youtube`, que hoje só o
   papel Admin Master tem. Enquanto não houver um perfil próprio mais estreito (pendência 10 da
   MD10), não use essa conta para mais nada: é ela que recebe o token de envio.
   *Confere:* com essa conta no arquivo do passo 8, `root-midia pendentes` lista os episódios.

**No Mac**

8. **Arquivo de variáveis.** Crie `~/.config/root/root-midia.env` com `ROOT_OS_API_URL`
   (https, terminando em `/api`), `ROOT_OS_ENVIO_URL` (a rota do passo 5), `ROOT_OS_EMAIL`,
   `ROOT_OS_SENHA` (a conta do passo 7) e `WHISPER_MODEL`. Depois rode
   `chmod 600 ~/.config/root/root-midia.env`.
   *Confere:* `node tools/root-midia/root-midia.mjs pendentes` responde sem erro de login.
9. **Modelo do whisper.** Baixe `ggml-small.bin` (~470 MB) ou `ggml-large-v3-turbo.bin` (~1,6 GB) do
   repositório `ggerganov/whisper.cpp` no Hugging Face, guarde fora do repo e aponte
   `WHISPER_MODEL=/caminho/do/modelo.bin` no arquivo do passo 8.
   *Confere:* o vigia deixa de notificar "Falta o modelo do whisper".
10. **Skill da mídia.** `ln -s <repo>/tools/root-midia ~/.claude/skills/root-midia`.
    *Confere:* `/root-midia ep-NN` aparece no Claude Code.
11. **Vigia.** `node tools/root-midia/root-midia.mjs vigia instalar`, depois `vigia estado`.
    *Confere:* o estado mostra o agente carregado e a última linha do log
    (`~/Library/Logs/root-midia/vigia.log`). Se o log mostrar `EPERM`, libere o node em Ajustes >
    Privacidade e Segurança.

**Entrada da pauta**

12. **Grupo de links.** Crie o grupo "Root · links" na instância do root na Evolution, preencha
    `EVOLUTION_LINKS_JID` e `EVOLUTION_LINKS_ORG_ID` no easyPanel e aponte o webhook
    `messages.upsert` da instância para `/api/approvals/canal/whatsapp/<orgId>` com o cabeçalho
    `x-canal-segredo`.
    *Confere:* um link colado no grupo aparece em `/referencias` em menos de 1 minuto.
13. **Google e a etiqueta das newsletters.** Conecte o Google em `/conexoes`, crie no Gmail uma
    etiqueta para as newsletters e cadastre a fonte `gmail` com essa etiqueta no Radar
    (`/referencias`).
    *Confere:* "Coletar agora" na fonte traz as newsletters da semana.
14. **Fontes.** No Radar, cadastre as buscas do nicho e os creators (Instagram, TikTok, X, YouTube)
    e revise o teto de execuções de cada um (o Apify cobra por execução).
    *Confere:* "Coletar agora" sem erro na fonte.
15. **Palavra de corte.** A padrão é "root, corta". Para trocar a da empresa, use a receita de
    `docs/PAUTA.md` ("A palavra de corte e os links da casa, sem tela"); para um episódio só, a
    seção Roteiro do episódio. Os links fixos da página de links saem da mesma receita.
    *Confere:* o roteiro gerado mostra a palavra no topo.
16. **Grade da semana.** Na aba Semana, "Grade da semana". Sem mexer, vale carrossel seg/qua/sex
    12h, corte ter/qui 18h e story em dia útil 9h, no horário de São Paulo.
    *Confere:* os horários propostos da próxima semana seguem a grade.
17. **Rotinas.** Em `/rotinas`, crie as quatro: "Nova rotina de coleta" (quinta 22h), "Nova rotina
    de encadeamento" (a cada 5 min), "Nova rotina de publicação" (a cada minuto) e "Nova rotina de
    comentários" (a cada 10 min). Enquanto a decisão do papel restrito (passo 16 do ESTADO) estiver
    pendente, nenhuma rotina dispara sozinha.
    *Confere:* cada uma aparece com o botão "Rodar agora", e o detalhe do episódio passa a mostrar
    "Próximo passo automático".

**Instagram**

18. **Painel da Meta.** No app de `INSTAGRAM_APP_ID` (developers.facebook.com): tipo Business, caso
    de uso "API setup with Instagram login", `instagram_business_content_publish` e
    `instagram_business_manage_comments` com Standard Access, e a redirect
    `https://bio.operacaoroot.com/api/conectar/instagram/callback` cadastrada.
19. **Instagram Tester.** Em App roles > Roles > Instagram Testers, adicione o @ da Root; no app do
    Instagram, Configurações > Apps e sites > Convites de testador, aceite. A conta tem de ser
    profissional.
20. **Conectar a conta de publicação.** Na aba Semana, "Conta de publicação" > Conectar (ou
    Reconectar), e aceite publicar e comentários.
    *Confere:* o cartão mostra os três escopos. Se voltar "A Meta não concedeu publicar", refaça os
    passos 18 e 19.

**YouTube**

21. **Conta dona do canal.** Diga qual é (pessoal, Workspace ou Brand Account).
22. **Google Cloud.** Crie um projeto próprio, ative a YouTube Data API v3 e crie um cliente OAuth
    web com a redirect `https://os.operacaoroot.com/api/youtube/callback`. Ponha a tela de
    consentimento em produção (ou Internal, se for Workspace): em Testing a autorização vence em 7
    dias.
23. **Variáveis.** No easyPanel: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`,
    `YOUTUBE_REDIRECT_URI=https://os.operacaoroot.com/api/youtube/callback` e
    `YOUTUBE_AUDITORIA=pendente`. Recriar o container.
24. **Verificar o canal** por telefone em `youtube.com/verify`. Sem isso a thumb não entra.
25. **Conectar o canal** logado na conta dona: aba Episódios > seção YouTube > "Conectar o canal".
    *Confere:* a volta mostra "youtube=ok" no topo da aba Episódios.
26. **Auditoria.** Peça no formulário "YouTube API Services - Audit and Quota Extension"
    (`support.google.com/youtube/contact/yt_api_form`), com a política de privacidade publicada.
    Quando sair, `YOUTUBE_AUDITORIA=aprovada` e recriar o container.

**DM automática (só depois do App Review)**

27. **Privacidade.** Publique em `docs/PRIVACY.md` e na página pública o parágrafo sobre quem
    comenta: o @ fica 7 dias e some, o id da pessoa é guardado só como HMAC, o texto do comentário
    não é guardado.
28. **Meta.** Verifique a empresa em business.facebook.com > Configurações > Central de segurança >
    Verificação. Faça UM pedido de App Review com `instagram_business_basic`,
    `instagram_business_manage_comments`, `instagram_business_manage_messages` e
    `instagram_business_content_publish`. Aprovado, ponha o app em Live.
29. **Mensagens.** `INSTAGRAM_PEDIR_MENSAGENS=sim` no easyPanel, recriar o container e reconectar a
    conta de publicação na aba Semana.
    *Confere:* comente a palavra com uma conta sem papel no app e a nota ligada por alguns minutos.
    Se a fila mostrar `100/2534001` ("precisa de Advanced Access"), falta o Advanced Access.

---

## (c) A semana típica

**Durante a semana.** Cole no grupo "Root · links" todo link que valer pauta.

**Quinta, 22h (sozinha).** A coleta monta a rodada. Sem a rotina, é o "Rodar agora" em `/rotinas`.

**Sexta de manhã, no celular.**
1. `/pauta` > Curadoria: marque o que segue e confirme.
2. Criar episódio > Gerar roteiro. Leia e ajuste. O episódio vai para Gravação.

**Gravação, no Mac.**
3. Grave no OBS com o roteiro aberto ("Abrir para gravar"). Errou: diga a palavra de corte e repita
   a frase. Não pause por mais de 2 minutos; para pausa longa, pare a gravação.
4. Não faça nada. O vigia pega o arquivo, corta, transcreve e manda ao OS (em até 15 minutos). Sem
   o vigia, `/root-midia ep-NN` faz o mesmo à mão.

**Depois da gravação (sozinha, cerca de 30 minutos).** O encadeamento gera pacote, página,
newsletter, a semana de posts e os horários; na passagem seguinte, o vigia renderiza e sobe as
imagens e os cortes.

**Segunda, pacote do episódio.**
5. No episódio: escolha o título. No Mac, `root-midia thumbs ep-NN`. Na seção YouTube, escolha a
   thumb e o horário.
6. Página de links > Publicar.
7. Newsletter: copie o `.md` ou o `.html` para o destino.

**Segunda, a semana de posts.**
8. Aba Semana: revise cada peça, edite o texto se precisar e, no corte, troque o trecho entre os
   três candidatos se o de maior nota não for o melhor.
9. "Aprovar a semana": confira o que entra e o que fica fora (cada exclusão diz o motivo) e peça a
   assinatura.
10. A titular abre `/atendimento`, lê cada post, vê os slides e assiste ao corte, e assina com senha
    e motivo em até 10 minutos. Se passar, clique "Pedir a assinatura de novo".
11. Se ainda não ligou: "Publicação automática" > Ligar, com motivo.

**Segunda a sexta (sozinha).** Cada post sai no horário. O vídeo sobe privado ao YouTube pelo vigia
e é agendado quando a auditoria estiver aprovada.

**Todo dia, no celular.** Aba Semana > "Quem comentou e o que responder": copie o texto, abra o
perfil, mande pelo Instagram e toque em "Marquei como respondido". Anote o volume da primeira
semana: é ele que decide se a DM automática vale o custo.

**Sexta seguinte.** Recomeça na curadoria.

---

## (d) Interruptores e como desligar tudo rápido

| Interruptor | Onde | Nasce | Liga o quê |
|---|---|---|---|
| Rotina de encadeamento | `/rotinas` | inexistente | andar da transcrição à semana em rascunho |
| Vigia do Mac | `root-midia vigia instalar` | não instalado | cortar, transcrever e renderizar sozinho |
| Seed assinado | `db:seed:politica` | não rodado | existirem as 7 capacidades novas; sem ele valem R5 e nada sai |
| Rotina de publicação | `/rotinas` | inexistente | olhar os posts no horário |
| Publicação automática | aba Semana, bloco "Aprovar a semana" | desligada | publicar os posts assinados no horário |
| Conector do Instagram | `/conexoes` | ligado | toda chamada à Meta da empresa |
| Conector do YouTube | `/conexoes` e "Conectar o canal" | sem credencial | envio e agendamento no YouTube |
| `YOUTUBE_AUDITORIA` | easyPanel | `pendente` | `teste`: envio só ao canal de teste; `aprovada`: envio e agendamento |
| Rotina de comentários | `/rotinas` | inexistente | a fila de quem comentou |
| DM automática | aba Semana, bloco "Aprovar a semana" | desligada | a resposta privada sozinha (só com `INSTAGRAM_PEDIR_MENSAGENS=sim`) |

**Para desligar tudo rápido, nesta ordem:**
1. Aba Semana > bloco "Aprovar a semana" > "Publicação automática" > Desligar, com motivo. O próximo
   slot já não sai. O bloco aparece na semana que tem posts; navegue até ela.
2. No mesmo bloco, "DM automática" > Desligar.
3. `/conexoes`: desligue o Instagram e o YouTube. Isso barra até o que já foi assinado.
4. No "Aprovar a semana" do episódio, "Cancelar a semana": nada mais sai por aquele lote, sem
   pedir assinatura. O que já foi publicado fica, e as peças seguem na agenda, no manual.
5. `/rotinas`: Desligar em cada rotina.
6. No Mac: `node tools/root-midia/root-midia.mjs vigia desinstalar`. Não apaga nada da pasta do OBS.
7. Emergência no servidor: `ROTINAS_CRON=off` na aba Ambiente do easyPanel e
   `docker compose -p root_marketing-os up -d --no-build api` em
   `/etc/easypanel/projects/root/marketing-os/code`.

---

## (e) Quando algo dá errado

1. **A transcrição chegou e nada andou.** A rotina de encadeamento não existe, está desligada, ou o
   papel restrito está virado. Veja "Próximo passo automático" no detalhe do episódio; ele diz o
   motivo. Três erros seguidos na mesma etapa travam a etapa: "Rodar agora" em `/rotinas` passa por
   cima.
2. **O vigia notifica "Falta o modelo do whisper".** Aponte `WHISPER_MODEL` no arquivo do Mac
   (passo 9).
3. **O vigia notifica "ambíguo: rode /root-midia ep-NN".** Há dois arquivos novos na pasta do OBS.
   Rode `/root-midia ep-NN` à mão com o arquivo certo.
4. **A gravação não foi pega.** O episódio não estava em Gravação antes de gravar, havia dois
   episódios em Gravação, ou houve pausa maior que 2 minutos. Rode `/root-midia ep-NN` à mão.
5. **O corte não sobe ("subiu: false").** O mp4 passa de 10 MB e o Mac está mandando pelo web: falta
   `ROOT_OS_ENVIO_URL` ou a rota do passo 5.
6. **"Aprovar a semana" mostra impedimentos.** A frase diz o que fazer: página de links fora do ar,
   conta sem permissão de publicar (reconectar), `PAUTA_MIDIA_PUBLICA_SEGREDO` faltando no servidor,
   peça sem horário, horário que já passou, ou imagem e corte ainda não renderizados.
7. **A titular não consegue assinar.** Três causas: o 403 da fila (passo 3), os 10 minutos
   passaram ("Pedir a assinatura de novo"), ou quem assina é quem montou o lote (tem de ser outra
   pessoa).
8. **O post não saiu no horário.** Confira, nesta ordem: a publicação automática ligada; a rotina de
   publicação existindo e ligada (a tela avisa quando não há quem cumpra o horário); o conector do
   Instagram ligado; o seed assinado (linha de boot com 71). Slot perdido há mais de 4 horas volta
   ao manual: poste à mão pela aba Semana e marque como postada.
9. **Editei um post depois da assinatura e ele não saiu.** É o esperado: a edição revoga só aquele
   item. Peça a assinatura de novo para ele.
10. **YouTube.** "Privado para sempre" na sessão: `YOUTUBE_AUDITORIA=pendente`. Thumb recusada com
    403: o canal não foi verificado por telefone (passo 24). Aviso de "vence em 7 dias": a tela de
    consentimento está em Testing (passo 22).
11. **A fila de comentários está vazia.** A rotina de comentários não existe; ou a conta foi
    conectada sem o escopo de comentários ("não concedeu comentários": reconectar); ou falta
    `META_WEBHOOK_PESSOA_HMAC_KEY` no servidor.

---

## (f) O que ficou em espera, e por quê

- **TikTok (MD12).** Decisão do Pedro: fora desta onda. Sem a auditoria do TikTok, o post direto sai
  só para a própria conta e exige conta privada.
- **DM automática antes do App Review.** O código está pronto e desligado. Sem o App Review da Meta,
  a permissão de mensagens não vale para quem não tem papel no app, então a resposta segue à mão pela
  fila. O webhook de comentários também só chega com Advanced Access; a fila funciona por consulta a
  cada 10 minutos.
- **YouTube público antes da auditoria.** Vídeo enviado por projeto sem auditoria fica privado para
  sempre, sem recurso. Até lá, o envio só vai ao canal de teste (`YOUTUBE_AUDITORIA=teste`) ou o
  vídeo sobe à mão.
- **O risco do token do Mac (D-MC6).** Com a auditoria aprovada, o token de envio que o Mac recebe
  por cerca de 1 hora ainda consegue criar um vídeo público à parte. A defesa hoje é dar
  `pauta.enviar_ao_youtube` só à conta do vigia; a decisão final é sua.
- **Newsletter sem envio (D-MC7).** O destino não foi decidido; ela sai como rascunho para copiar.
