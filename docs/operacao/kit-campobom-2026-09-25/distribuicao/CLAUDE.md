# ROOT OS · Campo Bom — regras de qualquer sessão do Claude nesta máquina

Esta pasta faz parte da instalação do **ROOT OS v0.4.2 da Campo Bom**, feita com o kit
`kit-rootos-v0.4.2` que a Root entregou. Vale para `~/RootOS/` e tudo abaixo dela: o código em
`~/RootOS/codigo`, a instância em `~/RootOS/instancia/producao` e o `repo/` dela. Português do
Brasil, datas `DD/MM/AAAA`.

## O que esta sessão pode fazer

- Ler arquivo de código e de log, e rodar comando de leitura que não mostre segredo.
- Conferir a instância: `curl` em `http://127.0.0.1:4001/api/health`, `docker ps --filter name=rootos_prod_`.
- Instalar, retomar ou conferir a instalação: **só pelo kit** (abra o Claude na pasta
  `kit-rootos-v0.4.2` e siga o `CLAUDE.md` de lá). Daqui não se instala nada.

## Segredos: nunca aparecem

Os arquivos `~/RootOS/instancia/producao/.env`, `~/RootOS/instancia/producao/segredos-iniciais.txt`,
`~/RootOS/google.env` e qualquer `.env` embaixo de `~/RootOS/` não se abrem, não se leem (nem pela
ferramenta Read), não se copiam e não se resumem. Deles só se confere existência, permissão
(`stat -f %Lp`) e contagem por nome de variável (`grep -c '^NOME=.'`).

Também mostram segredo, e por isso são proibidos: `docker inspect` (de container), `docker compose
config`, `docker exec <container> env` / `printenv` / `sh` / `bash` / `cat`, qualquer `docker exec`
nos containers `rootos_prod_api`, `rootos_prod_web`, `rootos_prod_minio` e `rootos_prod_redis`, `ps`
em qualquer forma, e `env` / `printenv` / `set` num shell que carregou um desses arquivos. O único
`docker exec` permitido é `docker exec rootos_prod_db psql …` com uma consulta de leitura.

## Proibido, mesmo com pedido

- Mudar código, `git pull`, `git fetch`, `git push` ou apontar o repositório para um servidor remoto.
- Expor porta fora de `127.0.0.1`, `colima start --network-address` ou usar o Docker Desktop.
- Apagar a instância, `docker compose down`, `docker rm`, `docker volume rm`, `docker system prune`,
  `colima delete`, `rm -r`. Rodar `deploy/atualizar.sh` ou `deploy/papel-app.sh`: são decisões da
  Root.
- Tocar em SAP, ERP, e-mail, agenda ou arquivo da empresa fora de `~/RootOS/`.

## Deu errado

Pare e escreva o que aconteceu (comando, exit, últimas linhas do log **sem segredo**) na pasta
`retorno/` do kit. O contato da Root está no `LEIA-ME.md` do kit.
