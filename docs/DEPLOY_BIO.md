# Virada do root-bio para dentro do marketing-os

**Executada em 01/08/2026.** `root_bio` e `root_bio-db` estão parados (0/0) e
`bio.operacaoroot.com` é servido inteiramente pelo `mktos_web`. Este documento
virou o registro do que foi feito — e do que ainda falta encerrar.

As URLs públicas continuam idênticas (`/@handle`, `/r/:id`, `/termos`,
`/privacidade`) e a redirect URI do OAuth não mudou, então não houve novo
App Review na Meta nem no TikTok.

## Pendências

Só falta **excluir os serviços `root_bio` e `root_bio-db` pela UI do easyPanel**
(a partir de ~08/08/2026, uma semana de margem). O dump está em
`/root/backups/root_bio_20260801_0012.sql.gz`.

Isso resolve junto a única sobra: os routers do `root_bio` continuam no
`main.yaml` (gerado pelo easyPanel) apontando para o backend morto. Não afetam
nada — quem ganha é o router do `marketing-os.yaml`, com `priority: 1000` posta
de propósito — e o easyPanel regenera o arquivo sem eles ao excluir o serviço.

## O que foi feito

### 1. Backup
```bash
docker exec $(docker ps --format '{{.Names}}' | grep '^root_bio-db') \
  pg_dump -U bio -d rootbio | gzip > /root/backups/root_bio_$(date +%Y%m%d_%H%M).sql.gz
```

### 2. Segredos no `.env` da plataforma
A `ENCRYPTION_KEY` do marketing-os **não** foi trocada pela do root-bio: a
plataforma já tinha a sua. A do root-bio entrou só como `BIO_OLD_ENCRYPTION_KEY`
durante a migração, para re-cifrar. Adicionados via `merge-env.sh`:

```
BIO_HOST=bio.operacaoroot.com
PUBLIC_BIO_ORIGIN=https://bio.operacaoroot.com
BIO_SYNC_INTERVAL_MIN=360
BIO_BRIDGE_INTERVAL_MIN=720
MCP_SERVICE_PASSWORD=…      # o compose exige (`:?`) mesmo sem o telegram rodar
MCP_ACTION_PASSWORD=…
```

> Achado da virada: o `.env` tinha um bloco de dev duplicado (`JWT_SECRET`,
> `AUTH_SECRET`, `ENCRYPTION_KEY` com valores de desenvolvimento) que teria
> vencido as chaves boas no próximo deploy. Removido. Se aparecer de novo:
> `grep -oE '^[A-Z_]+=' .env | sort | uniq -d` deve sair vazio.

### 3. Deploy
```bash
cd /srv/marketing-os && deploy/up.sh --vps api web
```
Só `api web`: o `telegram` não roda nesta VPS e subir a stack inteira o ligaria.

A migration `add_bio` roda no boot da api. **Depois dela, rode o seed** — é ele
que cria `bio.ver`/`bio.editar` e as vincula aos perfis; sem isso o menu "Link na
bio" não aparece para ninguém:
```bash
docker exec mktos_api pnpm exec tsx prisma/seed.ts
```

### 4. Migração dos dados
A api e o banco antigo estão em redes Docker diferentes. Em vez de reconectar
containers, o dump foi restaurado num banco temporário dentro do próprio
Postgres da plataforma — parte de um snapshot imutável e não toca no banco vivo:

```bash
docker exec mktos_db psql -U mkt -d postgres -c "CREATE DATABASE bio_origem;"
gunzip -c /root/backups/root_bio_*.sql.gz | docker exec -i mktos_db psql -U mkt -d bio_origem
# (erros de OWNER "role bio does not exist" são esperados e inofensivos)

PW=$(grep -m1 -E '^DB_PASSWORD=' .env | cut -d= -f2- | tr -d '"')
OLD=$(grep -m1 -E '^ENCRYPTION_KEY=' /root/.config/root/bio-secrets.env | cut -d= -f2-)
docker exec -e BIO_DATABASE_URL="postgresql://mkt:${PW}@db:5432/bio_origem" \
            -e BIO_OLD_ENCRYPTION_KEY="$OLD" \
  mktos_api pnpm exec tsx prisma/migrate-bio.ts --dry   # ensaio
# … e sem --dry para valer

docker exec mktos_db psql -U mkt -d postgres -c "DROP DATABASE bio_origem;"
```

Migrado: 2 páginas, 3 botões, 2 desafios, 2 contas, 27 snapshots, 103 visitantes,
126 visitas, 149 eventos (todos espelhados em `PixelEvent`) e 1 credencial de app
re-cifrada. Não havia conexão OAuth ativa, então ninguém precisou reconectar.

### 5. Domínio
`/etc/easypanel/traefik/config/marketing-os.yaml` (arquivo nosso, não do
easyPanel) ganhou os routers da bio com `priority: 1000`. O Traefik recarrega
sozinho ao salvar.

### 6. Conferência
```bash
for p in /@pedromagnago /@lucasfernandes /termos /privacidade; do
  curl -s -o /dev/null -w "$p → %{http_code}\n" "https://bio.operacaoroot.com$p"
done
curl -sI "https://bio.operacaoroot.com/r/<linkId>" | head -3   # 302 pro destino
```

## Comportamento conhecido

Handle inexistente responde **200** com o corpo de "não encontrado" (soft 404),
porque página reescrita por middleware não consegue mudar o status no App Router
do Next. A rota direta `/b/<handle>` devolve 404 correto. O root-bio antigo
devolvia 404 nas duas — é uma regressão pequena, sem efeito funcional.

## Rollback

A imagem anterior está marcada:
```bash
docker tag mktos-app:rollback mktos-app:latest
cd /srv/marketing-os && docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-build api web
```
Para devolver o domínio ao serviço antigo: restaurar
`/root/backups/marketing-os.yaml.bak.*` sobre o config do Traefik e
`docker service update --replicas 1 root_bio`.
