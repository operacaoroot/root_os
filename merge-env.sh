#!/usr/bin/env bash
# Merge seguro de credenciais no .env do marketing-os.
# Uso:  bash merge-env.sh     (cole as linhas VAR=valor e finalize com Ctrl-D)
set -euo pipefail

ENV_FILE="/srv/marketing-os/.env"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP="${ENV_FILE}.bak.${STAMP}"

cp -a "$ENV_FILE" "$BACKUP"
echo "Backup criado: $BACKUP"
echo "Cole as linhas no formato  VARIAVEL=valor  e finalize com Ctrl-D:"
echo "-------------------------------------------------------------"

updated=0; added=0; skipped=0

while IFS= read -r line || [ -n "$line" ]; do
  # ignora vazias e comentários
  [ -z "${line//[[:space:]]/}" ] && continue
  case "$line" in \#*) continue ;; esac

  key="${line%%=*}"
  val="${line#*=}"
  key="$(printf '%s' "$key" | tr -d '[:space:]')"

  # valida nome da variável
  if ! printf '%s' "$key" | grep -qE '^[A-Z_][A-Z0-9_]*$'; then
    echo "  ! ignorado (nome inválido): $key"; skipped=$((skipped+1)); continue
  fi

  if grep -qE "^${key}=" "$ENV_FILE"; then
    # atualiza a linha existente sem quebrar com / & etc. (valor via env, não via sed)
    KEY="$key" VAL="$val" awk -F= '
      BEGIN{k=ENVIRON["KEY"]; v=ENVIRON["VAL"]}
      $1==k {print k"="v; next}
      {print}
    ' "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
    echo "  ~ atualizado: $key"; updated=$((updated+1))
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
    echo "  + adicionado: $key"; added=$((added+1))
  fi
done

chmod 600 "$ENV_FILE"
echo "-------------------------------------------------------------"
echo "Concluído: $updated atualizadas, $added adicionadas, $skipped ignoradas."
echo "Para aplicar nos containers:  cd /srv/marketing-os && docker compose up -d api web"
echo "Se algo der errado, restaure:  cp $BACKUP $ENV_FILE"
