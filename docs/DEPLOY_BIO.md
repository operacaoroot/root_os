# Virada do root-bio para dentro do marketing-os

Runbook da migração do serviço `root_bio` (easyPanel, projeto `root`) para o
módulo Link na bio da plataforma. Ver a skill `vps-fullbpo` para acesso à VPS.

O que muda no fim: `bio.operacaoroot.com` deixa de ser servido pelo container
`root_bio` e passa a ser servido pelo `mktos_web`. As URLs públicas (`/@handle`,
`/r/:id`, `/termos`, `/privacidade`) e a redirect URI do OAuth continuam
idênticas — nada quebra para quem já tem o link, e não é preciso novo App Review.

## Antes de começar

- [ ] `pg_dump` do `root_bio-db` guardado fora do container
- [ ] Anotado o `ENCRYPTION_KEY` atual do serviço `root_bio`

## 1. Backup do banco de origem

```bash
ssh vps
docker exec root_bio-db pg_dump -U postgres root_bio \
  | gzip > /root/backups/root_bio_$(date +%Y%m%d_%H%M).sql.gz
ls -lh /root/backups/root_bio_*.sql.gz
```

Não apagar depois da virada. Manter pelo menos uma semana.

## 2. Levar os segredos para a plataforma

A `ENCRYPTION_KEY` do root-bio deve ser **reusada** na plataforma. Assim os
tokens OAuth migram sem re-cifragem e ninguém precisa reconectar Instagram/TikTok.

> Se a plataforma já tiver uma `ENCRYPTION_KEY` diferente em uso por outro
> módulo, mantenha a dela e passe a antiga como `BIO_OLD_ENCRYPTION_KEY` no
> passo 4 — o script re-cifra. Tokens que não abrirem entram como
> `token_expirado` e basta reconectar pela tela.

```bash
# ler os valores do serviço antigo
cat /root/.config/root/bio-secrets.env   # ENCRYPTION_KEY
cat /root/.config/root/bio-apps.env      # INSTAGRAM_*/TIKTOK_*

cd /srv/marketing-os
bash merge-env.sh
# colar (Ctrl-D no fim):
# ENCRYPTION_KEY=...
# INSTAGRAM_APP_ID=...
# INSTAGRAM_APP_SECRET=...
# TIKTOK_CLIENT_KEY=...
# TIKTOK_CLIENT_SECRET=...
# BIO_HOST=bio.operacaoroot.com
# PUBLIC_BIO_ORIGIN=https://bio.operacaoroot.com
```

## 3. Subir a plataforma

```bash
cd /srv/marketing-os && git pull && deploy/up.sh --build
docker logs mktos_api --tail 30   # a migration add_bio roda no boot
curl -s localhost:4001/api/health
```

## 4. Migrar os dados

```bash
# IP do banco antigo na rede do easyPanel
BIO_DB=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' root_bio-db)

docker exec -e BIO_DATABASE_URL="postgresql://postgres:SENHA@${BIO_DB}:5432/root_bio" \
  mktos_api pnpm db:migrate-bio --dry     # ensaio: confere as contagens

docker exec -e BIO_DATABASE_URL="postgresql://postgres:SENHA@${BIO_DB}:5432/root_bio" \
  mktos_api pnpm db:migrate-bio           # pra valer
```

O script é idempotente — se algo falhar no meio, rodar de novo é seguro.
Se aparecer aviso de token que não abriu, anotar para reconectar no passo 6.

## 5. Apontar o domínio

No easyPanel/Traefik, `bio.operacaoroot.com` passa a apontar para
`172.17.0.1:4000` (mktos_web), como os outros domínios da plataforma.

## 6. Conferir

```bash
curl -sI https://bio.operacaoroot.com/@root | head -3      # 200 + Set-Cookie: rid
curl -sI https://bio.operacaoroot.com/termos | head -1     # 200
curl -sI https://bio.operacaoroot.com/privacidade | head -1
curl -sI https://bio.operacaoroot.com/r/<linkId> | head -3 # 302 pro destino
```

No painel (`/bio`):
- [ ] Página, botões e contador do desafio conferem com o que estava no ar
- [ ] Analytics mostra o histórico migrado (não só de hoje)
- [ ] Conexões: Instagram/TikTok em `ok`; se em `reconectar`, refazer o OAuth
- [ ] "Sincronizar agora" traz posts sem erro
- [ ] Metas: `bioClicks` preenchido e a taxa "Tráfego de venda" com número

Nos consoles da Meta e do TikTok — **conferir, não alterar**: as redirect URIs
devem seguir `https://bio.operacaoroot.com/api/conectar/{plataforma}/callback` e
as URLs de termos/privacidade devem responder.

## 7. Desativar o serviço antigo

Só depois de tudo conferido:

```bash
docker service scale root_root_bio=0    # ou parar pelo easyPanel
# root_bio-db: parar depois, e só excluir de vez após ~1 semana
```

O código do root-bio fica em `~/dev/root-bio` (commitado) como referência
histórica. Não é mais deployado.
