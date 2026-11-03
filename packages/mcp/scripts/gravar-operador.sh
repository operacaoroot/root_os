#!/usr/bin/env bash
# Grava a identidade do OPERADOR do MCP (e-mail e senha de uma PESSOA do ROOT OS) no arquivo de ambiente
# do MCP e testa o login chamando `quem_sou`. A senha é digitada aqui, sem eco, nunca passa por argumento
# nem fica em histórico (ou vem em SENHA_DO_OPERADOR, quando quem chama é o definir-senha-os.sh).
# O arquivo recebe backup ao lado antes de mudar; as linhas MCP_OPERADOR_* antigas são trocadas.
# Uso: bash ~/root-os-mcp/gravar-operador.sh <e-mail da pessoa no OS> [--sem-teste]
set -euo pipefail
EMAIL="${1:?uso: gravar-operador.sh <e-mail> [--sem-teste]}"
TESTAR=1; [ "${2:-}" = "--sem-teste" ] && TESTAR=0
ENVFILE="${MCP_ENV_FILE:-$HOME/.config/root/mcp.env}"
if [ -n "${SENHA_DO_OPERADOR:-}" ]; then
  SENHA="$SENHA_DO_OPERADOR"
else
  read -r -s -p "Senha de $EMAIL no ROOT OS: " SENHA; echo
fi
[ -n "$SENHA" ] || { echo "senha vazia"; exit 1; }
mkdir -p "$(dirname "$ENVFILE")"
[ -f "$ENVFILE" ] || : > "$ENVFILE"
chmod 600 "$ENVFILE"
BACKUP="$ENVFILE.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENVFILE" "$BACKUP"; chmod 600 "$BACKUP"
TMP="$ENVFILE.tmp.$$"
grep -vE '^(export[[:space:]]+)?MCP_OPERADOR_(EMAIL|SENHA)[[:space:]]*=' "$ENVFILE" > "$TMP" || true
[ -s "$TMP" ] && [ -n "$(tail -c1 "$TMP")" ] && echo >> "$TMP"
# aspas simples por fora: o leitor do MCP (env.ts) tira só o primeiro e o último caractere, o miolo fica como é.
printf "MCP_OPERADOR_EMAIL=%s\nMCP_OPERADOR_SENHA='%s'\n" "$EMAIL" "$SENHA" >> "$TMP"
chmod 600 "$TMP"; mv "$TMP" "$ENVFILE"
echo "gravado em $ENVFILE: MCP_OPERADOR_EMAIL, MCP_OPERADOR_SENHA (backup em $(basename "$BACKUP"))."
if [ "$TESTAR" = 1 ]; then
  if [ -f "$HOME/root-os-mcp/testar.mjs" ]; then
    echo "testando o login pelo MCP (quem_sou)..."
    (cd "$HOME/root-os-mcp" && node testar.mjs)
  else
    echo "para testar: no clone do OS, MCP_API_URL=https://os.operacaoroot.com/api pnpm --filter @mktos/mcp chamar quem_sou"
  fi
fi
