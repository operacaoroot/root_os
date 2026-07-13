# Deploy do Marketing OS — servidor 24/7 (Hetzner + Docker + HTTPS)

Coloca o Marketing OS no ar num servidor Linux, acessível pela internet com HTTPS,
sem depender do seu Mac. Sem domínio: usamos `sslip.io` (resolve o IP → HTTPS válido).

> Tudo já é dockerizado. O `deploy/prod.sh` sobe a stack completa (Caddy + api/web/
> telegram + db/redis/minio) com os segredos do root. db/redis/minio ficam em
> `127.0.0.1` (não expostos); só o Caddy fica na internet (80/443).

## 1) Criar o servidor (Hetzner Cloud)
- Novo servidor: **Ubuntu 24.04**, tipo **CX22** (2 vCPU / 4 GB — suficiente).
- Adicione sua **chave SSH** (a mesma do Mac). Anote o **IP público** (ex.: `203.0.113.5`).
- **Firewall** (Hetzner Cloud → Firewalls, ou depois): liberar **22, 80, 443**.

## 2) Entrar e instalar o Docker
```bash
ssh root@SEU_IP
curl -fsSL https://get.docker.com | sh        # Docker + compose plugin
```

## 3) Clonar o repositório (privado)
Use o token do root (está no seu Mac em `~/.config/root/github.env`, var `ROOT_GITHUB_TOKEN`):
```bash
git clone https://operacaoroot:COLE_O_TOKEN@github.com/operacaoroot/marketing-os.git
cd marketing-os
```

## 4) Copiar os segredos do root (do Mac → servidor)
No **Mac**, envie os `.env` do root (credenciais próprias — OpenAI, Telegram, ClickUp, Google, etc.):
```bash
ssh root@SEU_IP 'mkdir -p ~/.config/root && chmod 700 ~/.config/root'
scp ~/.config/root/*.env root@SEU_IP:~/.config/root/
```

## 5) Criar o `prod.env` (segredos de produção) — no servidor
`sslip.io`: troque os pontos do IP por hífens → `203-0-113-5.sslip.io`.
```bash
cat > ~/.config/root/prod.env <<EOF
PANEL_HOST=203-0-113-5.sslip.io          # << seu IP com hífens + .sslip.io
BIND_ADDR=127.0.0.1
JWT_SECRET=$(openssl rand -hex 32)
AUTH_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)
S3_SECRET_KEY=$(openssl rand -hex 16)
ADMIN_EMAIL=voce@exemplo.com
ADMIN_PASSWORD=UMA_SENHA_FORTE_AQUI
EOF
chmod 600 ~/.config/root/prod.env
```

## 6) Subir
```bash
bash deploy/prod.sh          # build (alguns minutos) + up -d
```

## 7) Popular o banco (só na 1ª vez — cria o admin e os dados-base)
```bash
docker compose exec api sh -c 'cd /app/apps/api && pnpm db:seed'
```

## 8) Acessar
- Abra **`https://SEU_IP-com-hifens.sslip.io`** (o Caddy emite o certificado no 1º acesso; aguarde ~30s).
- Login: **`ADMIN_EMAIL` / `ADMIN_PASSWORD`** (os do `prod.env`).
- Crie logins pros seus amigos em **Usuários e permissões**; troque sua senha em **Configurações**.

## Pontos de atenção
- **Telegram (1 bot por token):** o bot que roda no **Mac** e o do servidor **não podem usar o mesmo token ao mesmo tempo** (dá conflito 409). No Mac, pare o bot: `docker compose stop telegram`. (Ou crie um 2º bot no @BotFather só pro servidor.)
- **Google/Meta (OAuth):** pra reconectar em produção, adicione no console do Google/Meta os redirects **`https://SEU_HOST/api/google/callback`** e **`.../api/meta/callback`**, e (Google) sua conta em *Usuários de teste*. Sem isso, o resto do painel funciona igual — só o login Google/Meta fica pendente.
- **Obsidian:** a vault fica no seu Mac. No servidor sobe vazia (0 notas). Pra ter a base lá, sincronize depois: `rsync -az "~/Documents/Obsidian Vault/" root@SEU_IP:~/marketing-os-vault/` e rode o reindex em `/obsidian`.
- **Isolamento:** é o servidor do `root` — nada do escritório. Mesmo princípio de sempre.

## Atualizar (deploy de versão nova)
```bash
cd marketing-os && git pull && bash deploy/prod.sh
```

## Operação
- Ver serviços: `docker compose ps` · logs: `docker compose logs -f api`
- Backup do banco: `docker compose exec db pg_dump -U mkt marketing_os > backup.sql`
