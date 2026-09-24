# root-midia — a estação de mídia do ROOT OS no Mac (MC9)

A mídia pesada roda no Mac; ao OS volta só o leve. O vídeo **fica no Mac** (o MinIO da VPS não é
público e o upload no YouTube é manual na V1, D-MC6).

| Arquivo | O quê |
|---|---|
| `root-midia.mjs` | a CLI (Node 22, sem dependência: `fetch` nativo e `child_process` chamando `ffmpeg`, `ffprobe`, `whisper-cli`) |
| `lib/cortes.mjs` | puro: silencedetect → silêncios, a heurística da palavra de corte, a lista do que MANTER, o filtro do ffmpeg |
| `lib/whisper.mjs` | puro: o JSON do `whisper-cli -oj` → segmentos `{inicio, fim, texto}` em segundos, e a legenda `.srt` |
| `lib/os.mjs` | a conversa com o OS: login normal da API (`POST /auth/login`), as três rotas da mídia e o arquivo de variáveis |
| `lib/arquivos.mjs` | a trava do bruto: o mesmo arquivo por outro nome (caixa, link simbólico) |
| `SKILL.md` | a skill `/root-midia ep-NN` do Claude Code — o passo a passo, PalmierPro primeiro |

Rotas do OS (todas `pauta.editar`, módulo `pauta`): `GET /pauta/episodios/pendentes-midia`,
`POST /pauta/episodios/:id/midia` (→ Edição) e `POST /pauta/episodios/:id/transcricao` (→ Pacote).
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

## Comandos

```sh
node tools/root-midia/root-midia.mjs ajuda
node tools/root-midia/root-midia.mjs ensaio      # clipe sintético: silencios → cortes → cortar
```

`cortar` não reencoda quando toda borda cai num quadro-chave (gravação intra, ou nada a cortar);
senão reencoda com `trim` + `concat` (corte exato, aguenta taxa de quadros variável). `--copiar`
força a cópia, com as bordas no quadro-chave mais próximo.

## Testes

As funções puras são testadas pela suíte da API: `apps/api/test/root-midia.test.ts` (vitest; os
tipos saem do JSDoc com `// @ts-check`, pelo `allowJs` do `tsconfig.test.json`). O ffmpeg de verdade
fica no `ensaio`, fora da CI — ela não tem ffmpeg, e caso pulado reprova a trava de cobertura.
