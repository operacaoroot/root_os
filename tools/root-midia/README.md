# root-midia — a estação de mídia do ROOT OS no Mac (MC9, thumbs no MC11, semana de posts no MC15, agenda no MC16, vigia na MD2, YouTube na MD10)

A mídia pesada roda no Mac; ao OS volta só o leve. O vídeo do episódio **fica no Mac** e, desde a
MD10, sobe DAQUI direto ao YouTube (`youtube ep-NN`), nunca pela VPS. Desde a MD4, o mp4 de cada **corte** vertical e um JPEG de cada
imagem da semana sobem também ao storage do OS, porque a Meta só publica o que consegue baixar de
uma URL (assinada, de até 1 h). Nada é apagado no Mac.

| Arquivo | O quê |
|---|---|
| `root-midia.mjs` | a CLI (Node 22, sem dependência: `fetch` nativo e `child_process` chamando `ffmpeg`, `ffprobe`, `whisper-cli`) |
| `lib/cortes.mjs` | puro: silencedetect → silêncios, a heurística da palavra de corte, a lista do que MANTER, o filtro do ffmpeg |
| `lib/whisper.mjs` | puro: o JSON do `whisper-cli -oj` → segmentos `{inicio, fim, texto}` em segundos, e a legenda `.srt` |
| `lib/os.mjs` | a conversa com o OS: login normal da API (`POST /auth/login`), as três rotas da mídia e o arquivo de variáveis |
| `lib/arquivos.mjs` | a trava do bruto: o mesmo arquivo por outro nome (caixa, link simbólico) |
| `lib/thumbs.mjs` | puro: o template preenchido e escapado, os argumentos do ffmpeg (frame) e do Chrome, onde achar o Chrome, a conferência do PNG (MC11) |
| `thumb.html` | o template da thumb, 1280×720, com os tokens da marca ROOT **copiados** (não lê o brand pack em tempo de execução) |
| `lib/semana.mjs` | puro (MC15): a região do rosto lida da coleção de cenas do OBS, o filtro e os argumentos do corte vertical, o story preenchido, o `slides.json` da máquina de carrossel e onde achar o render; (MC16) a agenda da semana em linhas |
| `story.html` | o template do story, 1080×1920, no mesmo padrão do `thumb.html` (tokens copiados) |
| `lib/vigia.mjs` | (MD2) o vigia: qual arquivo é o bruto, a trava, a memória entre passagens, o plist do launchd, a notificação, o log e a transcrição de ensaio |
| `SKILL.md` | a skill `/root-midia ep-NN` do Claude Code — o passo a passo, PalmierPro primeiro |

Rotas do OS (módulo `pauta`): `GET /pauta/episodios/pendentes-midia`,
`POST /pauta/episodios/:id/midia` (→ Edição) e `POST /pauta/episodios/:id/transcricao` (→ Pacote), todas
`pauta.editar`; e, para as thumbs (MC11), `GET /pauta/episodios` e `GET /pauta/episodios/:id/thumbs`
(`pauta.ver`) e `POST /pauta/episodios/:id/thumbs/:n` (`pauta.editar`, PNG até 2 MB); e, para a
semana de posts (MC15), `GET /pauta/episodios/:id/semana` (`pauta.ver`), `POST /pauta/pecas/:id/imagens/:n`
(PNG até 5 MB) e `PUT /pauta/pecas/:id/video` (`pauta.editar`); e, para o calendário (MC16),
`GET /pauta/agenda` (`pauta.ver`), só lido.
Detalhes em `docs/PAUTA.md`.

## Variáveis

Lidas do ambiente do Mac e do arquivo `~/.config/root/root-midia.env` (outro caminho com
`ROOT_MIDIA_ENV`; o ambiente vence o arquivo). **Não** são variáveis da API: ficam fora do
`docker-compose.yml` e catalogadas, sem valor, num bloco comentado do `.env.example`. A senha nunca vai
para o repositório, e `ROOT_OS_API_URL` fora desta máquina tem de ser `https://`.

| Variável | Para quê | Padrão |
|---|---|---|
| `ROOT_OS_API_URL` | a API do OS, com o `/api` | `http://localhost:4001/api` |
| `ROOT_OS_ENVIO_URL` | MD4: para onde sobe o mp4 do corte, com o `/api`. O proxy do Next (`os.operacaoroot.com/api`) corta o corpo em 10 MB: aponte para a API sem passar pelo web. Fora desta máquina, só `https://` | `ROOT_OS_API_URL` |
| `ROOT_OS_EMAIL` / `ROOT_OS_SENHA` | uma conta do OS com `pauta.editar` (e `pauta.youtube.enviar`, para o envio ao YouTube) | — (exigidas por `pendentes` e `enviar`) |
| `WHISPER_MODEL` | caminho do modelo ggml do whisper.cpp | — (sem ele, `transcrever` para e diz o que baixar; D-MC3) |
| `ROOT_MIDIA_PALAVRA` | a palavra de corte, quando não vem da fila do OS | `root, corta` |
| `ROOT_MIDIA_CHROME` | o Chrome do render das thumbs | o de `/Applications`, depois o Chrome for Testing do agent-browser |
| `ROOT_MIDIA_PIP` | onde está o rosto no canvas, `x,y,largura,altura` (MC15) | lido do JSON do OBS; sem ele, `1540,738,322,298` (escalado quando `--canvas` não é 1920x1080) |
| `ROOT_MIDIA_TELA` | a região da tela no canvas (MC15) | o canvas inteiro (o de `--canvas`; padrão `0,0,1920,1080`) |
| `ROOT_MIDIA_OBS_COLECAO` | o JSON da coleção de cenas do OBS, só lido (MC15) | `~/Library/Application Support/obs-studio/basic/scenes/Gravação.json` |
| `ROOT_MIDIA_CARROSSEL_RENDER` | o `render.mjs` da máquina de carrossel (MC15) | o do plugin instalado, com o `playwright` ao lado |
| `ROOT_MIDIA_MARCA` | o `brand.json` da marca na máquina de carrossel (MC15) | `~/.maquina-carrossel/marcas/root/brand.json` |
| `ROOT_MIDIA_OBS_DIR` | a pasta das gravações que o vigia olha, só a raiz (MD2) | `~/Movies/OBS` |
| `ROOT_MIDIA_VIGIA_LOG` | o log do vigia (MD2) | `~/Library/Logs/root-midia/vigia.log` |
| `ROOT_MIDIA_TRANSCRICAO_DE_ENSAIO` | **só ensaio** (MD2): `1` troca o whisper por uma transcrição sintética; recusada fora da API desta máquina | — |

## Comandos

```sh
node tools/root-midia/root-midia.mjs ajuda
node tools/root-midia/root-midia.mjs ensaio      # clipe sintético: silencios → cortes → cortar
node tools/root-midia/root-midia.mjs ensaio-thumb --saida /tmp/thumb.png   # 1 thumb com frame sintético
node tools/root-midia/root-midia.mjs ensaio-semana   # 1 corte vertical + 1 story (+ 1 carrossel) sintéticos
```

**Thumbs (MC11, D-MC4).** `thumbs ep-NN` lê os 3 briefs do pacote, tira o frame de cada um do vídeo
final no tempo sugerido (ffmpeg, 1280×720), preenche `thumb.html` e fotografa num Chrome sem janela,
com perfil numa pasta temporária (o Chrome aberto do Pedro não é tocado). No Mac, o Chrome sem janela
grava o PNG em ~2 s e fica de pé por minutos: a ferramenta espera o arquivo, encerra o processo e
segue. O PNG é conferido (1280×720, até 2 MB) antes de subir. O template carrega JetBrains Mono e Space
Grotesk do Google Fonts; sem rede, cai nas fontes do sistema (SF Mono/Menlo). Sem Chrome nenhum, o
render vai pelo próprio agent-browser (espera a rede parar e as fontes carregarem) — esse caminho
**ainda não foi provado**: o ensaio rodou com o Chrome de `/Applications`. `--so N` refaz uma thumb
com o mesmo brief; trocar o texto ou o frame exige gerar o pacote de novo na tela. Episódio agendado
não recebe thumb (o pacote é o registro do que subiu). `ensaio-thumb` sem `--saida` grava em
`$TMPDIR/root-midia-ensaio-ep-00-thumb-1.png`.

**A semana de posts (MC15).** Depois de gerar a semana na tela (aba Episódios → "Semana de posts"),
cada matéria tem um carrossel, um story e um corte. `semana ep-NN` lista o estado. Os renders:

- `carrosseis ep-NN` — a **máquina de carrossel** do Claude Code tem render chamável por linha de
  comando (`render/render.mjs <pasta>` lê `slides.json` e grava `png/slide-NN.png` em 1080×1350, com o
  próprio Chromium do playwright). A ferramenta converte a peça do OS em `slides.json` (capa,
  conteúdo alternando claro/escuro, fechamento com o `cta` da palavra-chave; texto escapado, porque o
  render põe o HTML cru), aponta o `brand.json` da marca root e roda `node render.mjs <pasta>` em
  lista de argumentos. Sem o render instalado (com `node_modules/playwright`), para e diz o que fazer
  (`/maquina-carrossel:setup` é decisão do Pedro). **Diferença do pedido:** não houve template
  próprio de carrossel — o da máquina é o canônico da marca. O render sai com código 0 mesmo quando o
  texto estoura a caixa; a ferramenta lê o `report.json` da pasta, avisa o slide e **não sobe** o
  carrossel estourado (encurte o texto na tela e renderize de novo, ou `--forcar`).
- `stories ep-NN` — `story.html` 1080×1920 com o frame do vídeo final no começo do corte da matéria
  (+1 s), fotografado como a thumb.
- `cortes ep-NN [final.mp4]` (também `cortes-verticais`) — o trecho de cada corte reencodado em
  1080×1920: a **tela** (o canvas inteiro, encaixado sem deformar, sobras na cor da marca) em cima e o
  **rosto** (o PiP) embaixo, cobrindo a largura. O PiP sai do JSON da coleção "Gravação" do OBS (só
  lido): na cena "2 · Tela + Câmera" a câmera C920 em 1280×720, recortada 296 px à esquerda e 201 à
  direita, escalada para dentro de uma caixa 336×299 em (1533, 737) — a imagem cai em 1538–1864 ×
  737–1036, e a região vai arredondada para dentro em par: **1540,738,322,298** (não os 480×270 do
  canto que o plano supunha). `--pip`/`ROOT_MIDIA_PIP`, `--tela`, `--canvas`, `--obs` e `--cena`
  trocam. `cortes <arquivo>` sem `ep-` segue sendo o plano de cortes do MC9. O áudio sai em 48 kHz
  (o teto da Graph). Ao OS vão o caminho, a duração, o tamanho e os bytes
  (`PUT /pauta/pecas/:id/video`) e, desde a MD4, o **próprio mp4**: confere o faststart pelas caixas
  de topo (`ftyp` primeiro, `moov` antes do `mdat`), calcula o sha256 e sobe cru, por stream
  (`POST /pauta/pecas/:id/video/arquivo`, `X-Conteudo-Sha256`, até 300 MB). O mesmo arquivo que já
  está no OS (mesmo sha) não é registrado nem sobe de novo. O mp4 continua no Mac. A falha do envio
  fica no corte: ele volta com `subiu: false` e o motivo (o vigia avisa), e a ferramenta segue para o
  próximo. Sem `ROOT_OS_ENVIO_URL`, com a API fora desta máquina, o mp4 acima de 10 MB nem tenta
  subir (o proxy do web não responderia); o envio tem prazo de 1 min mais 1 s a cada 256 kB.
  Desde a MD13 o trecho é o candidato em uso (o de maior nota, ou o que alguém escolheu na tela), e
  o log diz qual: `Corte da matéria 1 (candidato 3 de 3, nota 6)`. Trocar o candidato no OS tira o
  mp4 da peça, e o próximo `cortes` (ou o vigia) renderiza o trecho novo por cima do arquivo local.
  O registro e o envio levam o trecho renderizado (`inicio`/`fim` no PUT, `X-Trecho-Do-Corte` no
  POST): se a troca aconteceu enquanto o ffmpeg rodava, o OS responde 409, o corte volta com
  `subiu: false` e o motivo, e a próxima passagem renderiza o trecho certo.

Os PNG sobem para a peça (`POST /pauta/pecas/:id/imagens/:n`, até 5 MB) e, ao lado de cada um, o
JPEG que o `sips` do macOS converte (`-s format jpeg -s formatOptions 90`, até 8 MB), que é o que a
Meta aceita; `--sem-enviar` só grava na
pasta (`<ep>-semana/` ao lado do vídeo final, ou `--saida`). `ensaio-semana` prova tudo sem o OS: um
vídeo sintético 1920×1080 com um PiP cor-de-rosa, 1 corte (1080×1920, a duração do trecho e o rosa
embaixo), 1 story (1080×1920) e, com a máquina instalada, 1 carrossel (1080×1350).

**O calendário da semana (MC16).** `agenda [--de AAAA-MM-DD]` lista os sete dias da agenda do OS
(sem `--de`, esta semana): cada slot com a peça, o estado e onde está a mídia para postar à mão — os
PNG no OS (baixar pela aba Semana; o carrossel pela metade diz "3 de 7 PNG" e o comando que
completa) ou o mp4 que ficou no Mac, pelo caminho. Só lê: distribuir,
reagendar e marcar como postada são da tela.

**O vídeo no YouTube (MD10).** `youtube <ep-NN> [--final f.mp4] [--declarar]` manda o vídeo final
direto ao YouTube, sem passar pela VPS. Mede o sha256 por stream e declara ao OS
(`PUT /pauta/episodios/:id/youtube/arquivo`) quando mudou — é o que o lote da semana assina; o
`enviar` já declara sozinho. Sem `--declarar`, pede a sessão (`POST …/youtube/sessao`): a API só
abre com o item de envio num lote ASSINADO, com a auditoria fora de `pendente` e o YouTube ligado em
Conexões, e devolve a URI da sessão e um token de ~1 h (o refresh fica no cofre do OS). Os blocos
são de 64 MiB (múltiplos de 256 KiB), por `fetch` nativo; a retomada é a do protocolo: 308 com
`Range` diz o próximo byte, conexão caída pergunta `Content-Range: bytes */total`, 5xx espera
(1 s, 2 s, 4 s…) e pergunta, 401 pede token novo para a mesma sessão (no máximo 2 seguidos; o
mesmo token de volta para na hora, com a frase de conectar o canal de novo), 404 pede sessão nova e
recomeça do zero. No fim, `POST …/youtube/concluido {videoId}`: o OS confere o vídeo privado e
define a thumb escolhida. O estado vai para `~/.config/root/youtube-ep-NN.json` (`chmod 600`), sem a
URI nem o token; rodar de novo continua de onde parou. O vigia faz o mesmo sozinho com os episódios
de `GET /pauta/youtube/pendentes`, nunca com o OBS gravando.

`cortar` não reencoda quando toda borda cai num quadro-chave (gravação intra, ou nada a cortar);
senão reencoda com `trim` + `concat` (corte exato, aguenta taxa de quadros variável). `--copiar`
força a cópia, com as bordas no quadro-chave mais próximo.

## O vigia (MD2)

O launchd roda `root-midia vigia` quando a pasta do OBS muda (`WatchPaths`) e a cada 15 min
(`StartInterval`, para os renders), com 60 s de folga entre disparos. Uma passagem:

1. **Trava** em `~/.config/root/root-midia-vigia.lock` (ao lado do arquivo de variáveis), com o pid e
   a hora. Outra passagem de pé sai calada; trava de processo morto ou com mais de 3 h é retomada.
   Ler, conferir e escrever a trava acontece atrás de uma porta (`…lock.porta`, criada exclusiva e
   removida logo depois): `root-midia vigia` rodado à mão junto com o launchd não sai com dois donos.
   Soltar escreve "livre" no arquivo, não o apaga.
2. **A fila do OS** (`GET /pauta/episodios/pendentes-midia`, login normal): só age com **exatamente um**
   episódio em Gravação sem mídia; dois ou mais = nada feito, e a notificação só sai se houver
   gravação nova na pasta depois da entrada do mais antigo deles (gravar em lote não vira aviso).
3. **O bruto:** na **raiz** de `ROOT_MIDIA_OBS_DIR` (não desce; `root-midia/ep-NN` e links simbólicos
   ficam de fora), `.mkv`/`.mp4`/`.mov` com data de modificação **depois do `statusDesde`** do
   episódio (a entrada em Gravação, carimbada pelo banco). Duas leituras com 60 s de intervalo: mudou
   = o OBS está gravando, a passagem pula; dois candidatos parados = notificação
   **"ambíguo: rode /root-midia ep-NN"** e nada enviado; um só, parado há 2 min = segue (a passagem
   espera até 5 min um bruto novo amadurecer).
4. **A cadeia do comando manual, só pelo ffmpeg** (o PalmierPro exige o app aberto): transcrever o
   bruto → silêncios e palavra de corte (a que a fila devolve) → cortar → transcrever o final →
   `enviar --final --bruto --cortes --transcricao`. Tudo vai para `<OBS>/root-midia/ep-NN/`, com nome
   que ainda não existe (o final de uma edição à mão nunca é sobrescrito). Antes de mandar, a fila é
   relida: se o episódio saiu de Gravação no meio da cadeia (a mídia foi à mão, o status mudou),
   **nada vai** e a notificação diz "ep-NN mudou durante a cadeia". **Sem `WHISPER_MODEL`,
   notifica e para — não baixa modelo (D-MC3).** Bruto que falhou não é refeito a cada passagem:
   rode `/root-midia ep-NN` à mão.
5. **Os renders da Derivação e do Agendado:** a fila também devolve `derivacao` (os episódios com
   peça da semana da transcrição atual sem render, na Derivação ou já com a semana assinada) com
   `precisaDeRender` por formato e uma assinatura; o vigia roda `cortes`, `stories` e `carrosseis` do
   episódio, na pasta `<OBS>/root-midia/ep-NN/ep-NN-semana`. A fila lista do mais novo, até 20 com
   render pendente. O mesmo render com a mesma
   assinatura só é tentado de novo depois de 24 h (o carrossel estourado não gira a cada 15 min), e
   o que não subiu vira notificação: o carrossel com texto estourado ("encurte na tela") e o corte
   sem trecho. **Com o OBS gravando** (o bruto mudando, ou arquivo da raiz mexido nos últimos 2 min),
   os renders ficam para a próxima passagem: ffmpeg e Chrome não disputam o Mac com a gravação. Os
   renders sobem o mp4 e o JPEG ao storage (MD4). O envio ao YouTube (MD10) é o passo seguinte da
   passagem: só com o lote da semana assinado e nunca com o OBS gravando.
6. **Notifica** pelo `osascript` nativo (o texto vai como argumento do script); a mesma notificação
   fica calada por 6 h.
7. **Log** em `~/Library/Logs/root-midia/vigia.log`, uma linha com a hora por aviso, rodado aos 5 MB.

**Nunca apaga** o bruto nem nada da pasta do OBS: a catraca de `apps/api/test/root-midia.test.ts`
varre `root-midia.mjs` e `lib/*.mjs` e só aceita remover pasta temporária própria (`mkdtemp`), o plist
do agente e a porta da trava.

```sh
node tools/root-midia/root-midia.mjs vigia instalar     # grava o plist e roda launchctl bootstrap gui/<uid>
node tools/root-midia/root-midia.mjs vigia estado       # launchctl print + a última linha do log
node tools/root-midia/root-midia.mjs vigia desinstalar  # launchctl bootout e apaga SÓ o plist
node tools/root-midia/root-midia.mjs vigia              # uma passagem agora, à mão
node tools/root-midia/root-midia.mjs ensaio-vigia       # contra a API DESTA máquina, com um episódio em Gravação
```

`instalar` recusa arquivo de variáveis legível por outros (a senha mora nele: `chmod 600`) e grava em
`~/Library/LaunchAgents/com.operacaoroot.root-midia.vigia.plist` só `ProgramArguments` (o node e este
script, em lista), `WatchPaths`, `StartInterval` 900, `ThrottleInterval` 60, `Nice` 10, o log e
`EnvironmentVariables` com **apenas** `ROOT_MIDIA_ENV`. O agente usa o node de quem instalou
(`process.execPath`): trocar de versão do node pede instalar de novo. Com o Mac dormindo não há
vigia; o launchd roda ao acordar. O `instalar` confere as variáveis e monta os caminhos **só com o
arquivo de variáveis**, que é o que o agente vai ver: o que estiver exportado apenas no seu shell
não conta (e falta de `WHISPER_MODEL` no arquivo sai como aviso). **O hábito que faz tudo
funcionar:** pôr o episódio em Gravação **antes** de gravar — gravação anterior à entrada em
Gravação não é aceita sozinha.

**O que o vigia pressupõe:** um arquivo por episódio e **nenhuma pausa maior que 2 min** na
gravação. O único sinal de "ainda gravando" é o arquivo mudar; uma pausa longa do OBS parece
gravação terminada, e a passagem que cair nela manda a fala parcial (o episódio vai a Pacote e o
resto é ignorado). Para pausa longa, pare a gravação e rode `/root-midia ep-NN` à mão com os
arquivos.

A decisão da metade do bruto (`passoDoBruto` em `lib/vigia.mjs`: esperar, gravando, ambíguo,
jovem, sem modelo, cadeia que falha, episódio que mudou) roda na suíte com disco, relógio e cadeia
de mentira, sem ffmpeg. O `ensaio-vigia` fica fora da suíte pelo mesmo motivo do `ensaio` da MC9: a
CI não tem ffmpeg, e ele prova a cadeia de verdade contra a API local.

`ensaio-vigia` recusa API fora de loopback e exige um episódio em Gravação nela: gera dois brutos
sintéticos (pelo clipe do `ensaio`) numa pasta temporária e confere "ambíguo" sem envio; depois um
bruto só, que leva o episódio a Pacote com o sha256 do bruto igual antes e depois. Sem
`--whisper` (ou sem o modelo), usa a transcrição de ensaio.

## Testes

As funções puras são testadas pela suíte da API: `apps/api/test/root-midia.test.ts` (vitest; os
tipos saem do JSDoc com `// @ts-check`, pelo `allowJs` do `tsconfig.test.json`). O ffmpeg de verdade
fica no `ensaio`, fora da CI — ela não tem ffmpeg, e caso pulado reprova a trava de cobertura.
