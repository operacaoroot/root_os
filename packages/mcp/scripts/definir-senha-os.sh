#!/usr/bin/env bash
# Define (ou troca) a SENHA de uma pessoa no ROOT OS de produção, para o login por e-mail e senha
# (a saída de emergência da tela de login, e a identidade do operador no MCP). Roda no Mac, age na root-vps.
# A senha é digitada aqui, sem eco, nunca passa por argumento nem fica em histórico; o hash bcrypt é
# gerado dentro do container da API e gravado por UPDATE em "User" (1 linha, pelo e-mail, só conta ativa).
# Se a troca deu certo, oferece gravar a mesma identidade no mcp.env do MCP (gravar-operador.sh ao lado).
# Uso: bash ~/root-os-mcp/definir-senha-os.sh <e-mail da pessoa no OS>
set -euo pipefail
EMAIL="${1:?uso: definir-senha-os.sh <e-mail>}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
read -r -s -p "Senha nova para $EMAIL no ROOT OS (mínimo 12 caracteres): " SENHA; echo
read -r -s -p "Repita: " SENHA2; echo
[ "$SENHA" = "$SENHA2" ] || { echo "as duas não batem"; exit 1; }
[ ${#SENHA} -ge 12 ] || { echo "curta demais"; exit 1; }
REMOTO=$(cat <<'FIM'
set -euo pipefail
EMAIL="$1"
IFS= read -r SENHA
[ "$(hostname)" = "srv1983380" ] || { echo "host inesperado: $(hostname)"; exit 1; }
HASH=$(printf '%s' "$SENHA" | docker exec -i mktos_api sh -c 'cd /app/apps/api 2>/dev/null || true; node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(require(\"bcryptjs\").hashSync(s,10)))"')
[ -n "$HASH" ] || { echo "não gerou o hash"; exit 1; }
docker exec -i mktos_db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -X -q -v email="$0" -v hash="$1"' "$EMAIL" "$HASH" <<'SQL'
UPDATE "User" SET "passwordHash" = :'hash', "updatedAt" = now()
WHERE lower(email) = lower(:'email') AND "isActive" = true
RETURNING email, name, (SELECT string_agg(r.key, ',') FROM "_UserRoles" ur JOIN "Role" r ON r.id = ur."A" WHERE ur."B" = "User".id) AS papeis;
SQL
FIM
)
SAIDA=$(printf '%s\n' "$SENHA" | ssh root-vps "bash -c $(printf '%q' "$REMOTO") remoto $(printf '%q' "$EMAIL")")
printf '%s\n' "$SAIDA"
if printf '%s' "$SAIDA" | grep -qiF -- "$EMAIL"; then
  echo "A senha de $EMAIL vale a partir de agora."
  if [ -f "$AQUI/gravar-operador.sh" ]; then
    read -r -p "Gravar essa identidade no mcp.env do MCP agora e testar o login? [S/n] " R
    case "${R:-S}" in
      [Nn]*) echo "Depois: bash $AQUI/gravar-operador.sh $EMAIL" ;;
      *) SENHA_DO_OPERADOR="$SENHA" bash "$AQUI/gravar-operador.sh" "$EMAIL" ;;
    esac
  else
    echo "Depois: MCP_OPERADOR_EMAIL=$EMAIL e MCP_OPERADOR_SENHA=<a senha> em ~/.config/root/mcp.env."
  fi
else
  echo "Nenhuma conta ATIVA com esse e-mail recebeu a senha. Confira o e-mail com que você entra no OS."
  exit 1
fi
