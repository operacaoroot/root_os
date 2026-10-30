# Dublê do Google (Calendar) — agenda v2

Node puro, sem dependência, estado em memória. Emula o que o conector do Google
usa da agenda: `/token`, `/oauth2/v2/userinfo` (a sonda), `events.list` com
`syncToken` (410 quando o token é velho ou foi invalidado), `insert`, `get`,
`patch`, `update`, `delete` (marca `cancelled`) e `freeBusy`. A lista completa
das rotas e da porta de controle `/_duble/...` está no cabeçalho de `server.mjs`.

## Subir

```bash
# direto
PORT=4021 node homolog/mocks/google/server.mjs

# em container (na rede da stack, o nome sem ponto passa na trava do conector)
docker build -t rootos-duble-google homolog/mocks/google
docker run -d --name duble_google --network <rede-da-stack> rootos-duble-google
```

Na API: `GOOGLE_API_DUBLE_URL=http://duble_google:4021` (ou
`http://127.0.0.1:4021` fora do Docker). A trava em
`apps/api/src/google/dubles-do-google.ts` só aceita loopback ou nome sem ponto.
A variável não existe no compose de produção.

Variáveis do dublê: `PORT` (padrão 4021), `CONTA` (padrão
`operacao.root@exemplo.invalid`), `PUBLIC_URL` (o `htmlLink` dos eventos).

## Para o e2e

```bash
curl -X POST localhost:4021/_duble/semear -H 'content-type: application/json' \
  -d '{"limpar":true,"eventos":[{"id":"ev1","summary":"Reunião Interna - Todos","start":{"dateTime":"2026-11-03T08:00:00-03:00"},"end":{"dateTime":"2026-11-03T09:00:00-03:00"}}]}'
curl -X POST localhost:4021/_duble/livre-ocupado -H 'content-type: application/json' \
  -d '{"socio.pessoal@exemplo.invalid":[{"start":"2026-11-03T13:00:00Z","end":"2026-11-03T14:00:00Z"}]}'
curl -X POST localhost:4021/_duble/mexer/ev1 -H 'content-type: application/json' -d '{"summary":"mudado pelo celular"}'
curl -X POST localhost:4021/_duble/invalidar-sync
curl localhost:4021/_duble/pedidos
```

Nenhum dado real: só e-mails de exemplo com domínio `.invalid`.
