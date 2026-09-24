# root-midia — a estação de mídia do ROOT OS no Mac (MC9, thumbs no MC11, semana de posts no MC15)

A mídia pesada roda no Mac; ao OS volta só o leve. O vídeo **fica no Mac** (o MinIO da VPS não é
público e o upload no YouTube é manual na V1, D-MC6).

| Arquivo | O quê |
|---|---|
| `root-midia.mjs` | a CLI (Node 22, sem dependência: `fetch` nativo e `child_process` chamando `ffmpeg`, `ffprobe`, `whisper-cli`) |
| `lib/cortes.mjs` | puro: silencedetect → silêncios, a heurística da palavra de corte, a lista do que MANTER, o filtro do ffmpeg |
| `lib/whisper.mjs` | puro: o JSON do `whisper-cli -oj` → segmentos `{inicio, fim, texto}` em segundos, e a legenda `.srt` |
| `lib/os.mjs` | a conversa com o OS: login normal da API (`POST /auth/login`), as três rotas da mídia e o arquivo de variáveis |
| `lib/arquivos.mjs` | a trava do bruto: o mesmo arquivo por outro nome (caixa, link simbólico) |
| `lib/thumbs.mjs` | puro: o template preenchido e escapado, os argumentos do ffmpeg (frame) e do Chrome, onde achar o Chrome, a conferência do PNG (MC11) |
| `thumb.html` | o template da thumb, 1280×720, com os tokens da marca ROOT **copiados** (não lê o brand pack em tempo de execução) |
| `lib/semana.mjs` | puro (MC15): a região do rosto lida da coleção de cenas do OBS, o filtro e os argumentos do corte vertical, o story preenchido, o `slides.json` da máquina de carrossel e onde achar o render |
| `story.html` | o template do story, 1080×1920, no mesmo padrão do `thumb.html` (tokens copiados) |
| `SKILL.md` | a skill `/root-midia ep-NN` do Claude Code — o passo a passo, PalmierPro primeiro |

Rotas do OS (módulo `pauta`): `GET /pauta/episodios/pendentes-midia`,
`POST /pauta/episodios/:id/midia` (→ Edição) e `POST /pauta/episodios/:id/transcricao` (→ Pacote), todas
`pauta.editar`; e, para as thumbs (MC11), `GET /pauta/episodios` e `GET /pauta/episodios/:id/thumbs`
(`pauta.ver`) e `POST /pauta/episodios/:id/thumbs/:n` (`pauta.editar`, PNG até 2 MB); e, para a
semana de posts (MC15), `GET /pauta/episodios/:id/semana` (`pauta.ver`), `POST /pauta/pecas/:id/imagens/:n`
(PNG até 5 MB) e `PUT /pauta/pecas/:id/video` (`pauta.editar`).
Detalhes em `docs/PAUTA.md`.

## Variáveis

Lidas do ambiente do Mac e do arquivo `~/.config/root/root-midia.env` (outro caminho com
`ROOT_MIDIA_ENV`; o ambiente vence o arquivo). **Não** são variáveis da API: ficam fora do
`docker-compose.yml` e catalogadas, sem valor, num bloco comentado do `.env.example`. A senha nunca vai
para o repositório, e `ROOT_OS_API_URL` fora desta máquina tem de ser `https://`.

| Variável | Para quê | Padrão |
|---|---|---|
| `ROOT_OS_API_URL` | a API do OS, com o `/api` | `http://localhost:4001/api` |
| `ROOT_OS_EMAIL` / `ROOT_OS_SENHA` | uma conta do OS com `pauta.editar` | — (exigidas por `pendentes` e `enviar`) |
| `WHISPER_MODEL` | caminho do modelo ggml do whisper.cpp | — (sem ele, `transcrever` para e diz o que baixar; D-MC3) |
| `ROOT_MIDIA_PALAVRA` | a palavra de corte, quando não vem da fila do OS | `root, corta` |
| `ROOT_MIDIA_CHROME` | o Chrome do render das thumbs | o de `/Applications`, depois o Chrome for Testing do agent-browser |
| `ROOT_MIDIA_PIP` | onde está o rosto no canvas, `x,y,largura,altura` (MC15) | lido do JSON do OBS; sem ele, `1540,738,322,298` (escalado quando `--canvas` não é 1920x1080) |
| `ROOT_MIDIA_TELA` | a região da tela no canvas (MC15) | o canvas inteiro (o de `--canvas`; padrão `0,0,1920,1080`) |
| `ROOT_MIDIA_OBS_COLECAO` | o JSON da coleção de cenas do OBS, só lido (MC15) | `~/Library/Application Support/obs-studio/basic/scenes/Gravação.json` |
| `ROOT_MIDIA_CARROSSEL_RENDER` | o `render.mjs` da máquina de carrossel (MC15) | o do plugin instalado, com o `playwright` ao lado |
| `ROOT_MIDIA_MARCA` | o `brand.json` da marca na máquina de carrossel (MC15) | `~/.maquina-carrossel/marcas/root/brand.json` |

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
  trocam. `cortes <arquivo>` sem `ep-` segue sendo o plano de cortes do MC9. **O mp4 fica no Mac**:
  ao OS vão o caminho, a duração, o tamanho e os bytes (`PUT /pauta/pecas/:id/video`).

Os PNG sobem para a peça (`POST /pauta/pecas/:id/imagens/:n`, até 5 MB); `--sem-enviar` só grava na
pasta (`<ep>-semana/` ao lado do vídeo final, ou `--saida`). `ensaio-semana` prova tudo sem o OS: um
vídeo sintético 1920×1080 com um PiP cor-de-rosa, 1 corte (1080×1920, a duração do trecho e o rosa
embaixo), 1 story (1080×1920) e, com a máquina instalada, 1 carrossel (1080×1350).

`cortar` não reencoda quando toda borda cai num quadro-chave (gravação intra, ou nada a cortar);
senão reencoda com `trim` + `concat` (corte exato, aguenta taxa de quadros variável). `--copiar`
força a cópia, com as bordas no quadro-chave mais próximo.

## Testes

As funções puras são testadas pela suíte da API: `apps/api/test/root-midia.test.ts` (vitest; os
tipos saem do JSDoc com `// @ts-check`, pelo `allowJs` do `tsconfig.test.json`). O ffmpeg de verdade
fica no `ensaio`, fora da CI — ela não tem ffmpeg, e caso pulado reprova a trava de cobertura.
