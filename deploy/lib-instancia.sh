#!/usr/bin/env bash
# ============================================================================
# lib-instancia.sh — o que instalar.sh e atualizar.sh têm em comum.
# ============================================================================
#
# UMA INSTÂNCIA = um ambiente (producao | homologacao) numa pasta própria:
#
#   <base>/<ambiente>/
#     repo/                 checkout DESTACADO na tag instalada (git clone --branch <tag>)
#     .env                  segredos + nomes + portas, 0600 — o compose lê daqui
#     override.yml          gerado: nomes de container, rede, imagem:tag, portas em bind-ip
#     versoes.log           append-only: data | tag | commit | ação
#     segredos-iniciais.txt 0600, só na instalação — a senha inicial do admin
#     backups/              onde deploy/backup-db.sh grava
#
# Produção e homologação são DUAS instâncias inteiras: banco, credenciais,
# containers, rede e portas próprios. Nada é compartilhado, e é por isso que
# os nomes e portas têm de ser distintos entre irmãs no mesmo <base> — a lib
# confere e recusa.
#
# Este arquivo é `source`ado; não roda sozinho. Nada aqui imprime segredo.
set -euo pipefail

# --- os nomes que este par de scripts CONSOME (e que o compose interpola) ---
# Se o docker-compose.yml parametrizar container_name/name/network com estes
# mesmos nomes, o override gerado abaixo apenas coincide com ele. Se ainda não
# parametrizar, o override é o que garante o isolamento — nos dois casos o
# resultado é o mesmo, e é isso que o teste mede.
VARS_DE_NOME=(ROOTOS_PROJECT ROOTOS_CONTAINER_PREFIX ROOTOS_NETWORK_NAME)
VARS_DE_PORTA=(WEB_HOST_PORT API_HOST_PORT DB_PORT REDIS_PORT MINIO_PORT MINIO_CONSOLE_PORT)

AMBIENTES_VALIDOS="producao homologacao"

# Ferramentas externas que os scripts usam — stubáveis pelo PATH nos testes.
: "${DOCKER:=docker}"
: "${GIT:=git}"
: "${CURL:=curl}"

falha() { printf '\n[%s] ERRO: %s\n\n' "${NOME_DO_SCRIPT:-instancia}" "$1" >&2; exit "${2:-1}"; }
aviso() { printf '[%s] aviso: %s\n' "${NOME_DO_SCRIPT:-instancia}" "$*" >&2; }
passo() { printf '\n\033[1m[%s] %s\033[0m\n' "${NOME_DO_SCRIPT:-instancia}" "$*"; }

ambiente_valido() {
  case " $AMBIENTES_VALIDOS " in *" $1 "*) return 0 ;; esac
  return 1
}

# Lê VAR=valor de um .env sem executá-lo (linha a linha; ambiente NÃO vence aqui:
# o .env da instância é a verdade dela). Exporta para o processo.
carregar_env_da_instancia() {
  local arquivo="$1" linha chave valor
  [ -f "$arquivo" ] || falha "não existe $arquivo — a instância não está instalada."
  while IFS= read -r linha || [ -n "$linha" ]; do
    case "$linha" in ''|'#'*) continue ;; esac
    case "$linha" in *=*) ;; *) continue ;; esac
    chave="${linha%%=*}"; valor="${linha#*=}"
    chave="${chave#export }"; chave="${chave// /}"
    case "$chave" in ''|*[!A-Za-z0-9_]*) continue ;; esac
    valor="${valor%"${valor##*[![:space:]]}"}"
    case "$valor" in
      \"*\") valor="${valor#\"}"; valor="${valor%\"}" ;;
      \'*\') valor="${valor#\'}"; valor="${valor%\'}" ;;
    esac
    export "$chave=$valor"
  done < "$arquivo"
  return 0
}

# Só o valor de UMA chave de um .env, sem exportar nada.
valor_no_env() {
  local arquivo="$1" chave="$2" linha
  [ -f "$arquivo" ] || return 0
  while IFS= read -r linha || [ -n "$linha" ]; do
    case "$linha" in "$chave="*) printf '%s' "${linha#*=}"; return 0 ;; esac
  done < "$arquivo"
  return 0
}

# Troca (ou acrescenta) UMA chave num .env, preservando todo o resto byte a
# byte. É o único jeito de o atualizar.sh escrever no .env: as duas marcas de
# versão. Backup com carimbo antes.
gravar_chave_no_env() {
  local arquivo="$1" chave="$2" valor="$3" tmp
  tmp="$(mktemp "${arquivo}.tmp.XXXXXX")"
  if grep -qE "^${chave}=" "$arquivo"; then
    CHAVE="$chave" VALOR="$valor" awk -F= '
      BEGIN { k = ENVIRON["CHAVE"]; v = ENVIRON["VALOR"]; feito = 0 }
      $1 == k && !feito { print k "=" v; feito = 1; next }
      { print }
    ' "$arquivo" > "$tmp"
  else
    cat "$arquivo" > "$tmp"
    printf '%s=%s\n' "$chave" "$valor" >> "$tmp"
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$arquivo"
}

# Os `${VAR}` do compose que NÃO têm default (`${VAR}` seco ou `${VAR:?...}`).
# Cada um precisa existir no .env da instância, senão o compose sobe com vazio
# ou aborta — e o segundo caso derruba `ps` e `config` também.
variaveis_exigidas_pelo_compose() {
  local compose="$1"
  grep -oE '\$\{[A-Z_][A-Z0-9_]*(:\?[^}]*)?\}' "$compose" 2>/dev/null \
    | sed -E 's/^\$\{([A-Z_][A-Z0-9_]*).*$/\1/' | sort -u
}

conferir_variaveis_do_compose() {
  local compose="$1" env="$2" faltando=() v
  while IFS= read -r v; do
    [ -n "$v" ] || continue
    if ! grep -qE "^${v}=." "$env"; then faltando+=("$v"); fi
  done < <(variaveis_exigidas_pelo_compose "$compose")
  if [ "${#faltando[@]}" -gt 0 ]; then
    falha "o compose desta versão exige variáveis que não estão no .env da instância: ${faltando[*]}. Preencha-as (merge por chave, sem sobrescrever o resto) e rode de novo."
  fi
}

# Conflito de nomes/portas com as OUTRAS instâncias do mesmo <base>.
conferir_distinto_das_irmas() {
  local base="$1" ambiente="$2" env_novo="$3" irma env_irma v meu dela conflitos=()
  for irma in "$base"/*/; do
    irma="${irma%/}"
    [ "$(basename "$irma")" = "$ambiente" ] && continue
    env_irma="$irma/.env"
    [ -f "$env_irma" ] || continue
    for v in "${VARS_DE_NOME[@]}" "${VARS_DE_PORTA[@]}"; do
      meu="$(valor_no_env "$env_novo" "$v")"; dela="$(valor_no_env "$env_irma" "$v")"
      if [ -n "$meu" ] && [ "$meu" = "$dela" ]; then conflitos+=("$v=$meu (igual a $(basename "$irma"))"); fi
    done
  done
  if [ "${#conflitos[@]}" -gt 0 ]; then
    falha "produção e homologação NÃO podem compartilhar nome nem porta — conflito com instância irmã: ${conflitos[*]}"
  fi
}

# Portas entre si dentro da mesma instância.
conferir_portas_internas() {
  local env="$1" v p vistas=""
  for v in "${VARS_DE_PORTA[@]}"; do
    p="$(valor_no_env "$env" "$v")"
    case "$p" in ''|*[!0-9]*) falha "porta inválida em $v='$p'" ;; esac
    case " $vistas " in *" $p "*) falha "duas portas iguais ($p) na mesma instância" ;; esac
    vistas="$vistas $p"
  done
}

# O override gerado: é o que isola de verdade, independentemente do compose.
escrever_override() {
  local destino="$1" prefixo="$2" rede="$3" imagem="$4" bind="$5"
  local web="$6" api="$7" db="$8" redis="$9" minio="${10}" minio_console="${11}"
  cat > "$destino" <<YML
# GERADO por deploy/instalar.sh — não edite à mão; a fonte é o .env desta instância.
# Isola esta instância das irmãs: nomes de container, rede, imagem:tag e portas
# bindadas SÓ no IP interno (o Traefik alcança; a internet não).
services:
  db:
    container_name: ${prefixo}_db
    ports: !override
      - "${bind}:${db}:5432"
  redis:
    container_name: ${prefixo}_redis
    ports: !override
      - "${bind}:${redis}:6379"
  minio:
    container_name: ${prefixo}_minio
    ports: !override
      - "${bind}:${minio}:9000"
      - "${bind}:${minio_console}:9001"
  api:
    container_name: ${prefixo}_api
    image: ${imagem}
    ports: !override
      - "${bind}:${api}:4001"
  web:
    container_name: ${prefixo}_web
    image: ${imagem}
    ports: !override
      - "${bind}:${web}:4000"
networks:
  marketing-os-net:
    name: ${rede}
YML
}

# Como chamar o compose desta instância. Tudo explícito: projeto, diretório,
# env-file e os dois arquivos. Nada depende do cwd.
# `OVERRIDE_ATIVO` existe para o atualizador construir e ensaiar a versão nova com
# um override TEMPORÁRIO, sem tocar no da instância antes do corte.
compose() {
  "$DOCKER" compose \
    -p "$ROOTOS_PROJECT" \
    --project-directory "$DIR_REPO" \
    --env-file "$DIR_INSTANCIA/.env" \
    -f "$DIR_REPO/docker-compose.yml" \
    -f "${OVERRIDE_ATIVO:-$DIR_INSTANCIA/override.yml}" \
    "$@"
}

registrar_versao() {
  printf '%s | %s | %s | %s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$1" "$2" "$3" >> "$DIR_INSTANCIA/versoes.log"
}

# Espera a API responder. Sem curl real (testes) o stub responde na hora.
esperar_saude() {
  local url="$1" tentativas="${2:-60}" i corpo
  for ((i = 1; i <= tentativas; i++)); do
    corpo="$("$CURL" -fsS --max-time 3 "$url" 2>/dev/null || true)"
    if printf '%s' "$corpo" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then return 0; fi
    sleep "${ESPERA_ENTRE_TENTATIVAS:-2}"
  done
  return 1
}

# Lê um campo string do JSON pequeno de /health/versao sem depender de jq na
# VPS limpa. Ausência/HTTP inválido devolve vazio; quem chama SEMPRE falha fechado.
campo_da_identidade_no_ar() {
  local url="$1" campo="$2" corpo
  corpo="$("$CURL" -fsS --max-time 3 "$url" 2>/dev/null || true)"
  printf '%s' "$corpo" \
    | sed -nE "s/.*\"${campo}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\\1/p" \
    | head -1
}

versao_no_ar() { campo_da_identidade_no_ar "$1" version; }
commit_no_ar() { campo_da_identidade_no_ar "$1" commit; }
