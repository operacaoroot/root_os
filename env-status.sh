#!/usr/bin/env bash
# Mostra o estado do env do marketing-os SEM revelar valor nenhum.
# Uso na VPS:  cd /srv/marketing-os && bash env-status.sh
#
# Três colunas: se a variável está preenchida no .env, se ela chega no
# container, e o veredito. "NÃO CHEGA" com valor preenchido quase sempre
# significa que ela falta no bloco `environment:` do docker-compose.yml —
# o container não lê o .env, só recebe o que está listado ali.
set -uo pipefail
cd "$(dirname "$0")"

printf "%-28s %-12s %-16s %s\n" "VARIÁVEL" "NO .ENV" "NO CONTAINER" "OBSERVAÇÃO"
printf "%.0s─" $(seq 1 92); echo

for k in $(awk -F= '/^[A-Z_][A-Z0-9_]*=/{print $1}' .env | sort -u); do
  no_env=$(grep -m1 "^${k}=" .env | cut -d= -f2-)
  no_cont=$(docker exec mktos_api printenv "$k" 2>/dev/null)

  if [ -n "$no_env" ]; then a="preenchida"; else a="VAZIA"; fi
  if [ -n "$no_cont" ]; then b="chega"; else b="NÃO CHEGA"; fi

  obs=""
  if [ -n "$no_env" ] && [ -z "$no_cont" ]; then
    if grep -qE "^ *${k}:" docker-compose.yml; then
      obs="preenchida mas não repassada (serviço web/outro?)"
    else
      obs="→ falta no bloco environment: do compose"
    fi
  elif [ -z "$no_env" ] && [ -n "$no_cont" ]; then
    obs="usando o default do compose"
  elif [ -z "$no_env" ] && [ -z "$no_cont" ]; then
    obs="não configurada"
  fi

  printf "%-28s %-12s %-16s %s\n" "$k" "$a" "$b" "$obs"
done

echo
echo "Variáveis no compose que nem existem no .env (usam default):"
awk '/^  api:/,/^  web:/' docker-compose.yml \
  | grep -oE '^      [A-Z_][A-Z0-9_]*:' | tr -d ' :' | sort -u \
  | while read -r k; do grep -qE "^${k}=" .env || echo "  $k"; done
