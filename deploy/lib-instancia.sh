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
# Quem ouve porta no host: lsof no macOS, ss no Linux (usa o que existir, nessa ordem).
: "${LSOF:=lsof}"
: "${SS:=ss}"

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

# Quem ouve TCP numa porta do HOST, uma linha por ouvinte: "<endereço> <pid> <comando>".
# Nada ouvindo = nada impresso. Nem lsof nem ss = exit 2 (quem chama falha fechado:
# não saber se a porta está livre não é saber que está).
ouvintes_na_porta() {
  local porta="$1" saida
  if command -v "$LSOF" >/dev/null 2>&1; then
    # -F: saída de máquina (p=pid, c=comando, n=endereço:porta). Exit 1 = ninguém ouvindo.
    saida="$("$LSOF" -nP -iTCP:"$porta" -sTCP:LISTEN -Fpcn 2>/dev/null)" || return 0
    printf '%s\n' "$saida" | awk '
      /^p/ { pid = substr($0, 2) }
      /^c/ { cmd = substr($0, 2) }
      /^n/ { e = substr($0, 2); sub(/:[0-9]+$/, "", e); print e, pid, cmd }'
  elif command -v "$SS" >/dev/null 2>&1; then
    # Sem root o ss não mostra o processo: sai "?" no lugar, e a porta conta igual.
    saida="$("$SS" -Hltnp "sport = :$porta" 2>/dev/null)" || return 2
    printf '%s\n' "$saida" | awk '
      NF >= 4 {
        e = $4; sub(/:[0-9]+$/, "", e); cmd = "?"; pid = "?"
        if (match($0, /users:\(\("[^"]*"/)) cmd = substr($0, RSTART + 9, RLENGTH - 10)
        if (match($0, /pid=[0-9]+/)) pid = substr($0, RSTART + 4, RLENGTH - 4)
        print e, pid, cmd
      }'
  else
    return 2
  fi
}

# Colisão de porta contra o HOST — o que as irmãs não cobrem: qualquer programa já
# ouvindo (outro Postgres, um `next dev`, uma instância antiga fora do instalador).
# Na VPS o `up` falharia no meio da instalação; no Colima é pior: o container sobe
# dentro da VM e o encaminhamento para o Mac falha calado. Recebe o bind e pares
# VAR=porta. Colide o ouvinte no próprio bind, no curinga (* 0.0.0.0 ::) e, com
# bind no loopback, também em ::1 — o navegador tenta ::1 primeiro em "localhost".
conferir_portas_livres_no_host() {
  local bind="$1" par var porta ouvintes e pid cmd item conflitos=""
  shift
  for par in "$@"; do
    var="${par%%=*}"; porta="${par#*=}"
    if ! ouvintes="$(ouvintes_na_porta "$porta")"; then
      falha "não consigo conferir se a porta $porta está livre no host: nem '$LSOF' nem '$SS' responderam. Sem saber, a instalação não segue."
    fi
    while read -r e pid cmd; do
      [ -n "$e" ] || continue
      case "$e" in
        "$bind"|'*'|0.0.0.0|'::'|'[::]') ;;
        '::1'|'[::1]') case "$bind" in 127.*) ;; *) continue ;; esac ;;
        *) [ "$bind" = 0.0.0.0 ] || continue ;;
      esac
      item="porta $porta ($var) — já ouvindo em $e:$porta: ${cmd:-?} (pid ${pid:-?})"
      case "$conflitos" in *"$item"*) ;; *) conflitos="$conflitos
    $item" ;; esac
    done <<LISTA
$ouvintes
LISTA
  done
  [ -z "$conflitos" ] || falha "porta já em uso NO HOST (bind $bind):$conflitos
  Feche o programa que ocupa a porta e rode de novo. Nada foi criado."
}

# O override gerado: é o que isola de verdade, independentemente do compose.
escrever_override() {
  local destino="$1" prefixo="$2" rede="$3" imagem="$4" bind="$5"
  local web="$6" api="$7" db="$8" redis="$9" minio="${10}" minio_console="${11}" modo="${12:-}" alias_painel="${13:-}"
  # `modo` vazio = instância comum. `instancia` = instância que o easyPanel adota:
  # o web entra também na rede `easypanel` (externa) com o alias `<projeto>_web`,
  # porque é por esse nome que o Traefik do painel roteia os domínios (medido na
  # produção: url http://root_marketing-os_web:4000/). `compose-do-painel` = o
  # arquivo que se cola no painel: além da rede, a imagem vai por variável e o
  # `build:` do compose base é removido (`!reset`) — o diretório do painel não tem
  # código para construir, e imagem por valor faria cada atualização exigir recolar
  # o arquivo; esquecer seria um "Deploy" subindo a versão anterior sem ninguém pedir.
  local reset_build="" redes_do_web="" rede_easypanel=""
  case "$modo" in
    "") ;;
    instancia|compose-do-painel)
      [ -n "$alias_painel" ] || falha "escrever_override: modo '$modo' exige o alias do painel"
      redes_do_web="    networks:
      marketing-os-net: null
      easypanel:
        aliases:
          - ${alias_painel}"
      rede_easypanel="  easypanel:
    external: true"
      ;;
    *) falha "escrever_override: modo desconhecido '$modo'" ;;
  esac
  if [ "$modo" = compose-do-painel ]; then imagem='${ROOTOS_IMAGE}'; reset_build='    build: !reset null'; fi
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
${reset_build}
    image: ${imagem}
    ports: !override
      - "${bind}:${api}:4001"
  web:
    container_name: ${prefixo}_web
    image: ${imagem}
${redes_do_web}
    ports: !override
      - "${bind}:${web}:4000"
networks:
  marketing-os-net:
    name: ${rede}
${rede_easypanel}
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

# TRAVA POR INSTÂNCIA — duas atualizações ao mesmo tempo não podem compartilhar
# ensaio, metadados nem corte. `mkdir` é atômico no mesmo filesystem; o pid
# dentro diz de quem é. Pid morto = trava obsoleta (removida com aviso).
travar_instancia() {
  local trava="$DIR_INSTANCIA/.atualizando" pid
  if mkdir "$trava" 2>/dev/null; then
    printf '%s\n' "$$" > "$trava/pid"; TRAVA_DA_INSTANCIA="$trava"; return 0
  fi
  pid="$(cat "$trava/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    falha "outra atualização desta instância está em curso (pid $pid, $trava). Espere terminar; não rode duas em paralelo." 75
  fi
  aviso "trava obsoleta em $trava (pid ${pid:-?} não existe) — removendo"
  rm -rf "$trava"
  mkdir "$trava" || falha "não consegui travar $trava"
  printf '%s\n' "$$" > "$trava/pid"; TRAVA_DA_INSTANCIA="$trava"
}
destravar_instancia() { [ -n "${TRAVA_DA_INSTANCIA:-}" ] && rm -rf "$TRAVA_DA_INSTANCIA"; TRAVA_DA_INSTANCIA=""; return 0; }

# sha256 de stdin, no macOS e no Linux.
sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi
}

# --- easyPanel ---------------------------------------------------------------
# O painel roda cada serviço Compose com `-p <projeto>_<serviço>` a partir de UM
# docker-compose.yml próprio (mais um override dele, que só declara a rede
# `easypanel`) e de um .env que ele escreve do campo de ambiente do serviço. Para
# ele ADOTAR uma instância instalada por aqui, o que precisa bater desde o
# primeiro `up` é o nome do projeto — é dele que saem os nomes dos volumes —,
# a rede e os nomes de container. Medido na produção da VPS ROOT em 17/09/2026:
# projeto `root_marketing-os`, arquivos em /etc/easypanel/projects/root/marketing-os/code/.
painel_valido() { [[ $1 =~ ^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?/[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$ ]]; }
projeto_do_painel() { printf '%s_%s' "${1%%/*}" "${1#*/}"; }

# Gera o arquivo ÚNICO que se cola no painel: compose base da tag + override da
# instância, fundidos por `docker compose config --no-interpolate` (os `${VAR}`
# ficam como estão — quem interpola é o painel, com o .env dele), sem `build:` e
# com a imagem por variável. Falha fechada: se sair `build:`, se a imagem não vier
# por variável ou se algum valor do .env tiver sido interpolado, o arquivo não é
# gravado. Usa DIR_REPO, DIR_INSTANCIA e o .env já carregado.
gerar_compose_do_painel() {
  local destino="$1" tmp_override tmp_saida senha
  tmp_override="$(mktemp -t rootos-painel-override.XXXXXX)"; tmp_saida="$(mktemp -t rootos-painel-compose.XXXXXX)"
  escrever_override "$tmp_override" "$ROOTOS_CONTAINER_PREFIX" "$ROOTOS_NETWORK_NAME" "" "$ROOTOS_BIND_IP" \
    "$WEB_HOST_PORT" "$API_HOST_PORT" "$DB_PORT" "$REDIS_PORT" "$MINIO_PORT" "$MINIO_CONSOLE_PORT" compose-do-painel "${ROOTOS_PROJECT}_web"
  if ! OVERRIDE_ATIVO="$tmp_override" compose config --no-interpolate > "$tmp_saida"; then
    rm -f "$tmp_override" "$tmp_saida"; falha "não consegui fundir o compose para o painel (docker compose config --no-interpolate)"
  fi
  rm -f "$tmp_override"
  if grep -qE '^[[:space:]]*build:' "$tmp_saida"; then rm -f "$tmp_saida"; falha "o compose do painel saiu com 'build:' — o painel não tem código para construir; nada gravado"; fi
  [ "$(grep -cF 'image: ${ROOTOS_IMAGE}' "$tmp_saida")" -ge 2 ] || { rm -f "$tmp_saida"; falha "o compose do painel não traz a imagem por variável (\${ROOTOS_IMAGE}) em api e web; nada gravado"; }
  grep -qF -- "- ${ROOTOS_PROJECT}_web" "$tmp_saida" || { rm -f "$tmp_saida"; falha "o compose do painel não liga o web na rede easypanel com o alias ${ROOTOS_PROJECT}_web — o Traefik do painel não acharia a instância; nada gravado"; }
  senha="$(valor_no_env "$DIR_INSTANCIA/.env" DB_PASSWORD)"
  if [ -n "$senha" ] && grep -qF -- "$senha" "$tmp_saida"; then rm -f "$tmp_saida"; falha "o compose do painel contém um valor do .env interpolado; nada gravado"; fi
  mkdir -p "$(dirname "$destino")"
  mv "$tmp_saida" "$destino"; chmod 600 "$destino"
}

# Depois de instalar ou atualizar: regenera o compose do painel e diz o que a
# pessoa precisa colar lá. Imprime nada quando a instância não é do painel.
lembrete_do_painel() {
  local acao="$1" arquivo="$DIR_INSTANCIA/painel/docker-compose.yml" mudou="novo"
  [ -n "${ROOTOS_PAINEL:-}" ] || return 0
  if [ -f "$arquivo" ]; then
    gerar_compose_do_painel "$arquivo.novo"
    if cmp -s "$arquivo" "$arquivo.novo"; then mudou="igual"; else mudou="mudou"; fi
    mv "$arquivo.novo" "$arquivo"
  else
    gerar_compose_do_painel "$arquivo"
  fi
  cat <<MSG
  easyPanel — serviço Compose '$ROOTOS_PAINEL' (projeto Compose $ROOTOS_PROJECT, o mesmo que este script usa):
MSG
  case "$acao" in
    instalar) cat <<MSG
     a. no painel, projeto '${ROOTOS_PAINEL%%/*}' → serviço Compose '${ROOTOS_PAINEL#*/}' → cole $arquivo
     b. no campo de ambiente do serviço, cole o CONTEÚDO de $DIR_INSTANCIA/.env (o painel guarda cópia própria)
     c. Deploy. Como o projeto é o mesmo, o painel ADOTA os containers, a rede e os volumes que já existem
        (recria api/web com a mesma imagem; os dados ficam nos volumes $ROOTOS_PROJECT\_mktos_*).
MSG
    ;;
    *) cat <<MSG
     a. no campo de ambiente do serviço, atualize ROOTOS_IMAGE, ROOTOS_VERSION e ROOTOS_COMMIT com os valores de $DIR_INSTANCIA/.env
     b. o compose do painel ($arquivo) $([ "$mudou" = mudou ] && echo "MUDOU nesta versão — cole o arquivo novo" || echo "não mudou nesta versão")
     SEM o passo (a), um "Deploy" pelo painel re-sobe a IMAGEM ANTERIOR: o painel não lê o .env desta instância.
MSG
    ;;
  esac
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
