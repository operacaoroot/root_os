---
name: root-midia
description: Estação de mídia do ROOT OS no Mac (MC9, thumbs no MC11). Pega um episódio gravado da fila do OS, corta os silêncios e as tomadas erradas (palavra de corte), edita no PalmierPro quando ele está aberto ou no ffmpeg, transcreve com o whisper-cli e devolve ao OS só o leve — mídia e transcrição; depois do pacote gerado, renderiza as 3 thumbs no template da marca e sobe os PNG. Use quando o Pedro disser "/root-midia ep-NN", "edita o episódio", "sobe a transcrição do ep", "o que falta de mídia" ou "/root-midia thumbs ep-NN".
argument-hint: ep-NN
---

# /root-midia ep-NN

A mídia pesada roda no Mac e **o vídeo fica aqui**: o MinIO da VPS não é público, e o upload no
YouTube é manual na V1 (D-MC6). O OS recebe só o leve — onde estão os arquivos, a duração, o que foi
cortado e a transcrição com os tempos do vídeo **final**. Depois disso o episódio está em **Pacote**.

A ferramenta é `root-midia.mjs`, nesta mesma pasta (Node 22, sem dependência). Abaixo, `RM` é
`node ~/.claude/skills/root-midia/root-midia.mjs`.

## Antes de começar

- **Variáveis** (nunca no repositório): a ferramenta lê sozinha `~/.config/root/root-midia.env`
  (`CHAVE=valor` por linha; outro caminho com `ROOT_MIDIA_ENV`) a cada chamada — não precisa de
  `source`, que não sobrevive de uma chamada de Bash para a outra. O que já estiver exportado vence o
  arquivo. Se faltar e-mail ou senha, peça ao Pedro para completar o arquivo:
  - `ROOT_OS_API_URL` — a API do OS com o `/api` (padrão `http://localhost:4001/api`). Fora desta
    máquina, só `https://` — com `http://` a ferramenta recusa, porque a senha iria em claro;
  - `ROOT_OS_EMAIL` e `ROOT_OS_SENHA` — uma conta do OS com `pauta.editar`. A ferramenta entra pelo
    login normal da API (`POST /auth/login`), como o servidor MCP do repositório;
  - `WHISPER_MODEL` — o caminho do modelo ggml do whisper.cpp;
  - `ROOT_MIDIA_PALAVRA` — só se a fila do OS não disser a palavra (padrão `root, corta`).
- **Binários:** `ffmpeg`, `ffprobe` e `whisper-cli` (Homebrew, em `/opt/homebrew/bin`).
- **Modelo do whisper (D-MC3):** baixar é decisão e ação do Pedro — **não baixe nada**. Sem o modelo,
  `RM transcrever` para com a mensagem do que falta. O que ele precisa fazer: baixar um modelo ggml
  multilíngue do repositório `ggerganov/whisper.cpp` no Hugging Face (`ggml-large-v3-turbo.bin`,
  ~1,6 GB, melhor para português; ou `ggml-small.bin`, ~470 MB, mais rápido), guardar fora do repo e
  apontar `WHISPER_MODEL` para ele.
- **Nunca:** apagar ou sobrescrever o bruto, subir o vídeo para qualquer lugar, instalar pacote,
  baixar modelo, pedir a senha no chat ou passá-la na linha de comando (fica no histórico) — ela
  mora só no arquivo de variáveis.

## Passo a passo

1. **A fila.** `RM pendentes` — confira que o `ep-NN` está lá e anote **o que falta** (`midia` ou
   `transcricao`) e **a palavra de corte** que vale para ele. Fora da fila: se está no roteiro, falta
   gerar o roteiro/gravar; se já passou da edição, o Pedro volta o status na tela.
   Se falta só a transcrição, pule para o passo 7.
2. **O bruto.** As gravações do OBS ficam em `~/Movies/OBS` (`.mp4`, nome com data e hora). Liste
   as mais recentes com a duração (`ffprobe`) e **confirme com o Pedro** qual é o bruto do episódio.
3. **Pasta de trabalho:** `~/Movies/OBS/root-midia/ep-NN/` (crie). Tudo o que for gerado vai nela;
   o bruto fica onde está.
4. **Transcrever o bruto** (é o que acha as tomadas erradas):
   `RM transcrever <bruto> --saida ep-NN/bruto.transcricao.json`.
   Sem modelo: avise o Pedro do que baixar e siga só com os silêncios — o episódio vai até Edição e
   espera a transcrição.
5. **Os cortes:**
   `RM cortes <bruto> --transcricao ep-NN/bruto.transcricao.json --palavra "<palavra da fila>" --saida ep-NN/cortes.json`.
   O `cortes.json` traz `manter` (o que fica), `removidos` (o que sai, com o motivo) e
   `tomadasErradas` (o trecho de cada uma). **Mostre as tomadas erradas ao Pedro** antes de cortar.
   A heurística: ao achar a palavra num segmento, saem esse segmento e o anterior (a tomada errada).
   Se a tomada errada ocupou dois segmentos, sobra um pedaço — o Pedro diz, e você ajusta `manter`.
   Só o `manter`: o `enviar` recalcula dele os cortes que vão ao OS, e o que você tirou à mão vai
   com o motivo `manual`. A transcrição tem de ser a do **bruto** — a do final é recusada.
6. **Editar.**
   - **PalmierPro primeiro**, quando o MCP dele responder (`http://127.0.0.1:19789/mcp`, só com o app
     aberto — se as ferramentas `palmier-pro` não estiverem disponíveis ou recusarem conexão, peça ao
     Pedro para abrir o app ou siga no ffmpeg). No PalmierPro: importar o bruto, montar a timeline com
     os trechos de `manter` na ordem, aplicar a **troca de câmera** (cena "2 · Tela + Câmera" do OBS:
     tela cheia nos trechos de demonstração, câmera nos de fala — o Pedro diz o critério do episódio)
     e exportar `ep-NN/ep-NN-final.mp4`. Editor = `palmier`.
   - **Sem o PalmierPro:** `RM cortar <bruto> ep-NN/cortes.json ep-NN/ep-NN-final.mp4`. Sem reencodar
     quando toda borda cai em quadro-chave; senão reencoda (corte exato). Não troca câmera. Editor =
     `ffmpeg`.
   Confira a duração do final contra o `esperadoSeg` que o `cortar` imprime (a soma do `manter`; o
   `duracaoFinalSeg` do `cortes.json` fica velho se você ajustou o `manter`). O `cortar` recusa um
   `cortes.json` de outro bruto e uma saída que seja o próprio bruto por outro nome.
7. **Transcrever o final** (os tempos têm de bater com o vídeo que vai ao ar):
   `RM transcrever ep-NN/ep-NN-final.mp4 --saida ep-NN/final.transcricao.json`. Sai junto a legenda
   `ep-NN/final.transcricao.srt`, a que o Pedro sobe no YouTube.
8. **Enviar ao OS:**
   `RM enviar ep-NN --final ep-NN/ep-NN-final.mp4 --bruto <bruto> --cortes ep-NN/cortes.json --transcricao ep-NN/final.transcricao.json --editor ffmpeg|palmier`.
   A mídia leva o episódio a Edição; a transcrição, a Pacote. Mandar a mídia de novo (edição
   refeita) descarta a transcrição anterior e o pacote do YouTube que saiu dela (títulos, descrição
   e thumbs, com os tempos do vídeo antigo) — mande a transcrição nova junto e avise o Pedro que o
   pacote tem de ser gerado de novo. A transcrição é lida e conferida
   antes do primeiro envio: arquivo errado para tudo sem escrever nada no OS. Se o final não bate
   com a soma do `manter`, sai um AVISO — ajuste o `manter` e envie de novo.
   Só a transcrição (a mídia já está lá): `RM enviar ep-NN --transcricao ep-NN/final.transcricao.json`.
9. **Relate ao Pedro:** o status novo, a duração bruto → final, quantos cortes por motivo e as
   tomadas erradas tiradas. O detalhe do episódio em `/pauta` (aba Episódios) mostra o mesmo.

## As thumbs (`/root-midia thumbs ep-NN`, MC11)

Depois que o Pedro gerou o pacote na tela (aba Episódios → Pacote do YouTube), o episódio tem 3 briefs
de thumb (texto de até 4 palavras, a palavra de destaque e o tempo do frame).

1. `RM thumbs ep-NN --sem-enviar` — renderiza as 3 na pasta `ep-NN-thumbs/` ao lado do vídeo final
   (outro lugar com `--saida`). O vídeo final vem do OS (`arquivoFinal`); se ele mudou de lugar,
   `--final <vídeo>`.
2. **Mostre os 3 PNG ao Pedro** (abra com o Read). Hoje não dá para trocar o frame nem o texto de uma
   thumb sozinha: a tela não edita o brief, e `--so N` renderiza o mesmo brief de novo (serve para
   refazer ou reenviar uma que falhou). Se ele quiser outra, o caminho é "Gerar de novo" na tela, que
   troca o pacote inteiro — títulos (o marcado se perde), descrição e as 3 thumbs, com as imagens já
   enviadas — e gasta IA. Diga isso antes de ele decidir.
3. `RM thumbs ep-NN` (ou `--so N`) sobe os PNG; a prévia aparece no detalhe do episódio.

O template é `thumb.html`, nesta pasta, com as cores e fontes da ROOT copiadas. O Chrome do render é o
de `/Applications`, o de `ROOT_MIDIA_CHROME` ou o que o agent-browser baixou; ele roda sem janela, com
perfil temporário, e é encerrado assim que grava o PNG. Conferir sem tocar no OS: `RM ensaio-thumb`.

## Quando algo falha

- `HTTP 400` da API traz o motivo em português (status errado, transcrição do bruto em vez do final,
  corte fora de ordem) — leia e corrija, não force.
- `HTTP 409`: o episódio mudou no meio (outra aba, outro envio). Rode `RM pendentes` e repita.
- Transcrição grande demais para a API (acima de 2 MB, muito mais que 1h de fala): a ferramenta
  avisa antes de mandar. Quase sempre é a transcrição do bruto no lugar da do vídeo final.
- Conferir a instalação sem tocar em gravação real: `RM ensaio` (clipe sintético numa pasta
  temporária: silencios → cortes → cortar).

## Instalar a skill

Um link simbólico da pasta para as skills do Claude Code — nada é instalado sozinho:

```sh
ln -s "<caminho do repositório>/tools/root-midia" ~/.claude/skills/root-midia
```
