#!/usr/bin/env bash
# Backup do Postgres do ROOT OS — com retenção, verificação do dump e um modo
# que PROVA a restauração. Backup que ninguém restaurou não é backup, é esperança.
#
# Uso:
#   deploy/backup-db.sh                      # tira o backup do dia e roda a retenção
#   deploy/backup-db.sh --restore-test       # restaura o dump mais novo num banco NOVO e descartável
#   deploy/backup-db.sh --restore-test ARQ   # idem, apontando o arquivo
#   deploy/backup-db.sh --listar             # o que existe hoje em disco
#   deploy/backup-db.sh --limpar-restos      # derruba banco de restore-test que ficou para trás
#
# Conexão (NADA de senha neste arquivo — vem toda do ambiente):
#   DATABASE_URL=postgresql://user:senha@host:porta/banco     (o mesmo que a API usa)
#     A URI vai INTEIRA para o pg_dump e para o psql, que sabem lê-la. Este script não
#     desmonta URL: parser à mão erra em senha com '+', em URL sem caminho e em '@'
#     literal, e o erro aparece como "falha de autenticação" ou, pior, como conexão no
#     servidor errado.
#   ou as variáveis padrão do libpq: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
#   BACKUP_DB_CONTAINER=mktos_db   → roda pg_dump/psql DENTRO do container do banco.
#     É o único modo que funciona onde o host não tem cliente Postgres — o caso da VPS
#     e o do Mac. Duas consequências que o script NÃO esconde:
#       · sem DATABASE_URL ele conecta pelo socket unix de dentro do container (o pg_hba
#         da imagem oficial é `local all all trust`), e aí PGHOST/PGPORT do host não
#         valem nada — o script avisa quando estão definidos em vez de fingir que usou;
#       · com DATABASE_URL o host da URL é resolvido DE DENTRO do container, porque é lá
#         que o cliente roda. A URL viaja por variável de ambiente, nunca na linha de
#         comando (que apareceria no `ps` do host). Nesse caso a URL é a verdade inteira:
#         nenhuma variável PG* do host é repassada ao container.
#     Em qualquer caso o script imprime host/porta/banco/usuário como o psql os enxergou,
#     antes de copiar ou apagar qualquer coisa.
#
# Ajustes (todos opcionais):
#   BACKUP_DIR=/root/backups/root-os     onde os dumps ficam
#   BACKUP_RETENCAO_DIARIOS=7            quantos diários manter (inteiro >= 1)
#   BACKUP_RETENCAO_SEMANAIS=4           quantos semanais manter (inteiro >= 1)
#   BACKUP_TABELAS_CHAVE="Org User Capability PolicyVersion"   precisam ter linha no restore-test
#   BACKUP_TAMANHO_MINIMO=1024           bytes; abaixo disso o dump é considerado vazio
#   BACKUP_LINHAS_MINIMAS=1              linhas de dado exigidas no dump (0 desliga)
#   BACKUP_QUEDA_MAXIMA_PCT=50           queda de tamanho contra o dump anterior que dispara alarme ("off" desliga)
#   BACKUP_ESPACO_FOLGA_PCT=20           folga exigida sobre o tamanho do banco no restore-test
#   BACKUP_ESPACO_DESCONHECIDO_OK=1      deixa o restore-test seguir sem conseguir medir o disco
#   BACKUP_PERMITIR_REMOTO=1             deixa o restore-test rodar contra servidor não-local
#   BACKUP_MANTER_RESTORE=1              não derruba o banco de teste no fim (para inspecionar)
#   BACKUP_PARCIAL_HORAS=12              idade a partir da qual um .parcial órfão é varrido
#   BACKUP_BANCO_MANUTENCAO=postgres     banco usado só para CREATE/DROP DATABASE
#
# O nome do banco do restore-test NÃO é configurável, de propósito. Ele é gerado aqui,
# com prefixo fixo e sufixo único, criado com CREATE DATABASE sem "IF EXISTS" e marcado
# com um COMMENT ON DATABASE. Este script só derruba banco que ele mesmo criou e marcou —
# nunca um banco preexistente. A versão anterior aceitava qualquer nome que CONTIVESSE
# "test", e por isso derrubava bancos chamados `contest` ou `latest_backup`.
#
# O BACKUP_DIR default mora FORA de /srv/marketing-os de propósito: na VPS o
# repositório inteiro é sincronizado por Syncthing, e dump dentro dele viraria
# cópia do banco de produção viajando para todo mundo que sincroniza.
#
# Agendamento (o script não se agenda sozinho) — crontab do root na VPS:
#   17 3 * * *  BACKUP_DB_CONTAINER=mktos_db PGUSER=mkt PGDATABASE=marketing_os \
#               /srv/marketing-os/deploy/backup-db.sh >> /var/log/rootos-backup.log 2>&1
#   40 4 * * 1  BACKUP_DB_CONTAINER=mktos_db PGUSER=mkt PGDATABASE=marketing_os \
#               /srv/marketing-os/deploy/backup-db.sh --restore-test >> /var/log/rootos-backup.log 2>&1
#   O restore-test sobe uma cópia inteira da produção dentro da mesma instância: ele
#   confere o espaço livre antes e se recusa a começar se não couber com folga.
#
# Formato: SQL puro comprimido (`pg_dump | gzip`), não o formato custom. É maior e
# não restaura em paralelo, mas dá para VERIFICAR sem ferramenta nenhuma — o rodapé
# que o pg_dump só escreve quando terminou inteiro é o que separa dump bom de dump
# truncado. Restaurar precisa só de psql.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/root/backups/root-os}"
DIR_DIARIO="$BACKUP_DIR/diario"
DIR_SEMANAL="$BACKUP_DIR/semanal"
RETENCAO_DIARIOS="${BACKUP_RETENCAO_DIARIOS:-7}"
RETENCAO_SEMANAIS="${BACKUP_RETENCAO_SEMANAIS:-4}"
TAMANHO_MINIMO="${BACKUP_TAMANHO_MINIMO:-1024}"
LINHAS_MINIMAS="${BACKUP_LINHAS_MINIMAS:-1}"
QUEDA_MAXIMA_PCT="${BACKUP_QUEDA_MAXIMA_PCT:-50}"
ESPACO_FOLGA_PCT="${BACKUP_ESPACO_FOLGA_PCT:-20}"
PARCIAL_HORAS="${BACKUP_PARCIAL_HORAS:-12}"
TABELAS_CHAVE="${BACKUP_TABELAS_CHAVE:-Org User Capability PolicyVersion}"
BANCO_MANUTENCAO="${BACKUP_BANCO_MANUTENCAO:-postgres}"
DB_CONTAINER="${BACKUP_DB_CONTAINER:-}"

PREFIXO="rootos"
PREFIXO_RESTORE="rootos_rt_"
MARCADOR="rootos-backup-db restore-test descartavel"
RODAPE_PGDUMP="-- PostgreSQL database dump complete"

# Padrão exato do carimbo. Serve de glob E de padrão de `case`: só entra na retenção
# o que casa com ele. Retenção com padrão largo (`rootos-*.sql.gz`) apaga o dump do dia
# assim que alguém larga um `rootos-manual-*.sql.gz` na pasta, porque em C/UTF-8 letra
# ordena acima de dígito e os arquivos fora de formato ocupam as vagas primeiro.
GLOB_DIARIO="$PREFIXO-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].sql.gz"
GLOB_SEMANAL="$PREFIXO-semana-[0-9][0-9][0-9][0-9]-W[0-9][0-9].sql.gz"

PARCIAL_ATUAL=""
RESTORE_DB_CRIADO=""
SEMANAL_ATUAL=""
IDENT_HOST=""; IDENT_PORT=""; IDENT_DB=""; IDENT_USER=""

msg()  { printf '[backup] %s\n' "$*"; }
erro() { printf '[backup] ERRO: %s\n' "$*" >&2; exit 1; }

# --------------------------------------------------------------------------
# Saída limpa
# --------------------------------------------------------------------------

# Sem trap, uma execução morta no meio (deploy, OOM, Ctrl-C, timeout do cron) deixa
# um .parcial no disco — cópia em claro da produção — para sempre, e deixa o banco de
# teste de pé. Este trap é o que garante que o disco não acumula produção em claro.
limpeza() {
  local status=$?
  trap - EXIT
  set +e
  if [ -n "$PARCIAL_ATUAL" ] && [ -f "$PARCIAL_ATUAL" ]; then
    rm -f "$PARCIAL_ATUAL"
    msg "limpeza: dump parcial removido (${PARCIAL_ATUAL##*/})"
  fi
  if [ -n "$RESTORE_DB_CRIADO" ]; then
    if [ "${BACKUP_MANTER_RESTORE:-0}" = "1" ]; then
      msg "ATENÇÃO: banco de teste '$RESTORE_DB_CRIADO' MANTIDO por BACKUP_MANTER_RESTORE=1."
      msg "         É uma cópia em claro da produção (token cifrado, hash de senha, RASTRO)."
      msg "         Toda execução seguinte vai avisar até você rodar: $0 --limpar-restos"
    else
      derruba_marcado "$RESTORE_DB_CRIADO"
    fi
  fi
  exit "$status"
}
trap limpeza EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# --------------------------------------------------------------------------
# Conexão — sem parser de URL
# --------------------------------------------------------------------------

USA_URL=0
[ -n "${DATABASE_URL:-}" ] && USA_URL=1

exige_clientes() {
  if [ -n "$DB_CONTAINER" ]; then
    command -v docker >/dev/null 2>&1 || erro "BACKUP_DB_CONTAINER definido mas docker não está no PATH."
    docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || erro "container '$DB_CONTAINER' não existe."
    if [ "$USA_URL" = 0 ]; then
      [ -n "${PGUSER:-}" ]     || erro "no modo container sem DATABASE_URL, exporte PGUSER."
      [ -n "${PGDATABASE:-}" ] || erro "no modo container sem DATABASE_URL, exporte PGDATABASE."
      if [ -n "${PGHOST:-}" ] || [ -n "${PGPORT:-}" ]; then
        msg "AVISO: PGHOST/PGPORT estão definidos e NÃO serão usados — no modo container a"
        msg "       conexão é pelo socket unix de dentro de '$DB_CONTAINER'."
      fi
    else
      msg "modo container com DATABASE_URL: o host da URL é resolvido DE DENTRO de '$DB_CONTAINER'."
    fi
  else
    command -v pg_dump >/dev/null 2>&1 || erro "pg_dump não está no PATH. Use BACKUP_DB_CONTAINER=<container do banco>."
    command -v psql    >/dev/null 2>&1 || erro "psql não está no PATH. Use BACKUP_DB_CONTAINER=<container do banco>."
    if [ "$USA_URL" = 0 ]; then
      [ -n "${PGUSER:-}" ]     || erro "usuário do banco não definido — exporte DATABASE_URL ou PGUSER."
      [ -n "${PGDATABASE:-}" ] || erro "banco não definido — exporte DATABASE_URL ou PGDATABASE."
    fi
  fi
}

# pg_cli <binário> <argumentos…>
# `-w` sempre: sem ele, um pg_hba inesperado faria o cron travar num prompt de senha
# em vez de falhar. A senha nunca entra na linha de comando, nem no host nem no container.
pg_cli() {
  local bin="$1"; shift
  if [ -n "$DB_CONTAINER" ]; then
    if [ "$USA_URL" = 1 ]; then
      ROOTOS_CONN="$DATABASE_URL" docker exec -e ROOTOS_CONN -i "$DB_CONTAINER" \
        sh -c 'b="$1"; shift; exec "$b" -w -d "$ROOTOS_CONN" "$@"' sh "$bin" "$@"
    else
      local flags v val
      flags=""
      for v in PGUSER PGDATABASE PGPASSWORD PGOPTIONS PGSSLMODE PGCONNECT_TIMEOUT; do
        eval "val=\${$v:-}"
        [ -n "$val" ] && flags="$flags -e $v"
      done
      # shellcheck disable=SC2086
      docker exec $flags -i "$DB_CONTAINER" "$bin" -w "$@"
    fi
  else
    if [ "$USA_URL" = 1 ]; then
      PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}" "$bin" -w -d "$DATABASE_URL" "$@"
    else
      PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}" "$bin" -w "$@"
    fi
  fi
}

# Consulta na conexão como ela veio (o banco da URL / do PGDATABASE).
psql_atual() {
  pg_cli psql -v ON_ERROR_STOP=1 -tAq -c "$1"
}

# Consulta em OUTRO banco do mesmo servidor. `\connect` reaproveita os parâmetros da
# conexão atual (inclusive senha) e troca só o banco — que é como trocar de banco sem
# reescrever a URL, ou seja, sem desmontar a URL.
psql_em() {
  local banco="$1"; shift
  pg_cli psql -v ON_ERROR_STOP=1 -tAq -c "\\connect \"$banco\"" "$@"
}

# Quem é o servidor do outro lado, dito pelo psql (variáveis :HOST/:PORT/:DBNAME/:USER),
# não por leitura nossa da URL. Em conexão por socket, :HOST é o diretório do socket.
identifica_conexao() {
  local linhas
  linhas="$(pg_cli psql -tAq -c '\echo :HOST' -c '\echo :PORT' -c '\echo :DBNAME' -c '\echo :USER')" \
    || erro "não consegui conectar no banco. Confira DATABASE_URL / PG* e o container."
  IDENT_HOST="$(printf '%s\n' "$linhas" | sed -n '1p')"
  IDENT_PORT="$(printf '%s\n' "$linhas" | sed -n '2p')"
  IDENT_DB="$(printf '%s\n'   "$linhas" | sed -n '3p')"
  IDENT_USER="$(printf '%s\n' "$linhas" | sed -n '4p')"
  msg "conexão: container='${DB_CONTAINER:-(nenhum)}' host='$IDENT_HOST' porta='$IDENT_PORT' banco='$IDENT_DB' usuário='$IDENT_USER'"
}

host_e_local() {
  case "$1" in
    ""|/*|localhost|localhost.localdomain|127.*|::1) return 0 ;;
    *) return 1 ;;
  esac
}

# --------------------------------------------------------------------------
# Validação dos números
# --------------------------------------------------------------------------

valida_inteiro() {
  local valor="$1" nome="$2" minimo="$3"
  case "$valor" in
    ''|*[!0-9]*) erro "$nome precisa ser um inteiro; veio '$valor'." ;;
  esac
  [ "$valor" -ge "$minimo" ] || erro "$nome precisa ser >= $minimo; veio '$valor'."
}

# Zero na retenção apagaria todo o histórico; letra em qualquer um destes faria
# comparação numérica silenciosamente errada. Fecha na entrada.
valida_config() {
  valida_inteiro "$TAMANHO_MINIMO"  "BACKUP_TAMANHO_MINIMO"  1
  valida_inteiro "$LINHAS_MINIMAS"  "BACKUP_LINHAS_MINIMAS"  0
  valida_inteiro "$ESPACO_FOLGA_PCT" "BACKUP_ESPACO_FOLGA_PCT" 0
  valida_inteiro "$PARCIAL_HORAS"   "BACKUP_PARCIAL_HORAS"   1
  [ "$QUEDA_MAXIMA_PCT" = "off" ] || valida_inteiro "$QUEDA_MAXIMA_PCT" "BACKUP_QUEDA_MAXIMA_PCT" 1
}

humano() {
  local b="${1:-0}"
  if   [ "$b" -ge 1073741824 ]; then printf '%s GB' "$((b / 1073741824))"
  elif [ "$b" -ge 1048576 ];    then printf '%s MB' "$((b / 1048576))"
  elif [ "$b" -ge 1024 ];       then printf '%s kB' "$((b / 1024))"
  else printf '%s B' "$b"; fi
}

# --------------------------------------------------------------------------
# Inventário dos dumps
# --------------------------------------------------------------------------

# wc -c em vez de stat: o stat do BSD e o do GNU usam flags diferentes para a
# mesma pergunta, e este script roda nos dois (Mac e VPS).
tamanho_de() {
  wc -c < "$1" | tr -d ' '
}

# Lista os dumps de um diretório, do mais novo para o mais velho, um por linha.
# Só entra o que casa com o carimbo exato; a ordenação é em LC_ALL=C e o nome tem
# largura fixa, então ordem alfabética reversa == ordem cronológica reversa.
# Nada de `ls | sort | head`: head sai no primeiro acerto, o SIGPIPE derruba o sort e,
# com pipefail, a atribuição inteira falha (status 141) mesmo havendo dumps.
lista_dumps() {
  local dir="$1" glob="$2" caminho base achou=""
  for caminho in "$dir"/$glob; do
    [ -f "$caminho" ] || continue
    base="${caminho##*/}"
    case "$base" in
      $glob) achou="$achou$caminho
" ;;
    esac
  done
  [ -n "$achou" ] || return 0
  printf '%s' "$achou" | LC_ALL=C sort -r
}

# Arquivos que parecem backup mas estão fora do formato: nunca contam para a retenção
# e nunca são apagados. Só aparecem no relatório para o operador decidir.
conta_intrusos() {
  local dir="$1" glob="$2" caminho base n=0
  for caminho in "$dir"/$PREFIXO*.sql.gz; do
    [ -f "$caminho" ] || continue
    base="${caminho##*/}"
    case "$base" in
      $glob) : ;;
      *) n=$((n + 1)) ;;
    esac
  done
  printf '%s' "$n"
}

dump_mais_novo() {
  local lista
  lista="$(lista_dumps "$DIR_DIARIO" "$GLOB_DIARIO")"
  [ -n "$lista" ] || lista="$(lista_dumps "$DIR_SEMANAL" "$GLOB_SEMANAL")"
  [ -n "$lista" ] || return 0
  printf '%s' "${lista%%$'\n'*}"
}

# --------------------------------------------------------------------------
# Verificação do dump
# --------------------------------------------------------------------------

# Um dump serve quando: o gzip está íntegro, tem tamanho de gente, tem CREATE TABLE,
# tem pelo menos um bloco de dados COM LINHA e termina com o rodapé que o pg_dump só
# escreve depois de fechar tudo. Sem a exigência de linha, um banco com 45 tabelas e
# zero registro passa como "ok — 45 tabelas" e o alarme só tocaria no restore-test
# semanal, sete dias depois.
# Uma passada só de gzip; o awk lê até o fim, então não há SIGPIPE aqui.
verifica_dump() {
  local arq="$1" bytes contas tabelas blocos linhas rodape

  [ -f "$arq" ] || { msg "verificação: arquivo não existe ($arq)"; return 1; }

  bytes="$(tamanho_de "$arq")"
  if [ "$bytes" -lt "$TAMANHO_MINIMO" ]; then
    msg "verificação: dump com $bytes bytes, abaixo do mínimo de $TAMANHO_MINIMO — tratando como vazio"
    return 1
  fi

  if ! gzip -t "$arq" 2>/dev/null; then
    msg "verificação: gzip corrompido"
    return 1
  fi

  contas="$(gzip -dc "$arq" | awk -v rodape="$RODAPE_PGDUMP" '
    dentro == 1 { if ($0 == "\\.") dentro = 0; else linhas++; next }
    /^COPY .* FROM stdin;$/ { dentro = 1; blocos++; next }
    /^CREATE TABLE / { tabelas++; next }
    /^INSERT INTO / { blocos++; linhas++; next }
    $0 == rodape { fim = 1; next }
    END { printf "%d %d %d %d\n", tabelas + 0, blocos + 0, linhas + 0, fim + 0 }
  ')" || { msg "verificação: não consegui ler o dump inteiro"; return 1; }

  tabelas="$(printf '%s' "$contas" | cut -d' ' -f1)"
  blocos="$(printf '%s'  "$contas" | cut -d' ' -f2)"
  linhas="$(printf '%s'  "$contas" | cut -d' ' -f3)"
  rodape="$(printf '%s'  "$contas" | cut -d' ' -f4)"

  if [ "$tabelas" -lt 1 ]; then
    msg "verificação: nenhum CREATE TABLE no dump"
    return 1
  fi

  # O rodapé só vale se aparecer FORA de um bloco de dados (senão uma linha de tabela
  # com esse texto forjaria a aprovação). Dump interrompido no meio não tem rodapé.
  if [ "$rodape" -ne 1 ]; then
    msg "verificação: rodapé do pg_dump ausente — dump truncado"
    return 1
  fi

  if [ "$LINHAS_MINIMAS" -gt 0 ] && { [ "$blocos" -lt 1 ] || [ "$linhas" -lt "$LINHAS_MINIMAS" ]; }; then
    msg "verificação: $tabelas tabelas, $blocos blocos de dados e $linhas linhas — dump só de esquema, sem dado"
    return 1
  fi

  msg "verificação: ok — $bytes bytes, $tabelas tabelas, $blocos blocos de dados, $linhas linhas"
  return 0
}

# Queda abrupta de tamanho contra o dump anterior: sinal de banco truncado, migração
# que apagou tabela, ou dump de outra instância. Não descarta o arquivo (pode ser
# legítimo), mas sai vermelho para o cron reclamar; no dia seguinte o novo tamanho já
# vira a referência e o alarme se resolve sozinho.
compara_com_anterior() {
  local novo="$1" anterior="$2" b_novo b_ant limite
  [ "$QUEDA_MAXIMA_PCT" != "off" ] || return 0
  if [ -z "$anterior" ] || [ ! -f "$anterior" ]; then
    msg "comparação: não há dump anterior — nada com que comparar"
    return 0
  fi
  b_novo="$(tamanho_de "$novo")"
  b_ant="$(tamanho_de "$anterior")"
  limite=$(( b_ant * (100 - QUEDA_MAXIMA_PCT) / 100 ))
  if [ "$b_novo" -lt "$limite" ]; then
    msg "comparação: $b_novo bytes hoje contra $b_ant em ${anterior##*/} — queda maior que ${QUEDA_MAXIMA_PCT}%"
    return 1
  fi
  msg "comparação: $b_novo bytes hoje contra $b_ant em ${anterior##*/} — dentro do esperado"
  return 0
}

# --------------------------------------------------------------------------
# Backup
# --------------------------------------------------------------------------

varre_parciais() {
  local dir arq
  for dir in "$DIR_DIARIO" "$DIR_SEMANAL"; do
    [ -d "$dir" ] || continue
    while IFS= read -r arq; do
      [ -n "$arq" ] || continue
      rm -f "$arq"
      msg "limpeza: parcial órfão de execução anterior removido (${arq##*/})"
    done <<EOF
$(find "$dir" -type f -name '*.parcial' -mmin "+$((PARCIAL_HORAS * 60))" 2>/dev/null || true)
EOF
  done
}

fazer_backup() {
  valida_config
  valida_inteiro "$RETENCAO_DIARIOS"  "BACKUP_RETENCAO_DIARIOS"  1
  valida_inteiro "$RETENCAO_SEMANAIS" "BACKUP_RETENCAO_SEMANAIS" 1

  # O dump é a base de produção inteira em texto claro — inclusive token cifrado,
  # hash de senha e o RASTRO. Nasce 0600, em diretório 0700, e não 0644 como o
  # umask padrão do root deixaria.
  umask 077
  mkdir -p "$DIR_DIARIO" "$DIR_SEMANAL"
  varre_parciais

  identifica_conexao
  avisa_restos

  local carimbo destino parcial anterior queda=0
  anterior="$(dump_mais_novo)"
  carimbo="$(date +%Y%m%d-%H%M%S)"
  destino="$DIR_DIARIO/$PREFIXO-$carimbo.sql.gz"
  parcial="$destino.parcial"
  PARCIAL_ATUAL="$parcial"

  msg "banco '$IDENT_DB' → $destino"

  # --no-owner/--no-privileges deixam o dump restaurável por qualquer dono, que é
  # o que o restore-test precisa. Escrevo em .parcial e só renomeio depois de
  # verificar: assim o diretório nunca guarda um arquivo que parece backup e não é.
  if ! pg_cli pg_dump --no-owner --no-privileges | gzip -9 > "$parcial"; then
    erro "pg_dump falhou — nenhum arquivo gravado."
  fi

  verifica_dump "$parcial" || erro "dump reprovado na verificação — nenhum arquivo gravado."
  compara_com_anterior "$parcial" "$anterior" || queda=1

  mv "$parcial" "$destino"
  PARCIAL_ATUAL=""

  promove_semanal "$destino"
  poda "$DIR_DIARIO"  "$RETENCAO_DIARIOS"  "$GLOB_DIARIO"  "$destino"
  poda "$DIR_SEMANAL" "$RETENCAO_SEMANAIS" "$GLOB_SEMANAL" "$SEMANAL_ATUAL"
  msg "pronto: $destino"

  [ "$queda" -eq 0 ] || erro "o dump de hoje encolheu demais contra o anterior. O arquivo FOI mantido em $destino; confira o banco antes de confiar nele."
}

# O semanal é o primeiro backup bom de cada semana ISO, não "o de domingo": máquina
# desligada no domingo deixaria buraco de semana inteira. Hardlink porque é o mesmo
# conteúdo — só some do disco quando os dois nomes forem podados.
promove_semanal() {
  local origem="$1" semana alvo
  semana="$(date +%G-W%V)"
  alvo="$DIR_SEMANAL/$PREFIXO-semana-$semana.sql.gz"
  SEMANAL_ATUAL="$alvo"
  [ -e "$alvo" ] && return 0
  ln "$origem" "$alvo" 2>/dev/null || cp "$origem" "$alvo"
  msg "semanal $semana: $alvo"
}

# Poda o que passa da retenção. Três travas contra apagar o que não devia:
#   · só considera nome no formato exato do carimbo (o resto é contado e deixado quieto);
#   · ordena em LC_ALL=C, onde o nome de largura fixa ordena igual à data;
#   · nunca apaga o arquivo recém-criado, mesmo que algo o coloque fora da ordem.
poda() {
  local dir="$1" manter="$2" glob="$3" recem="${4:-}" lista arq intrusos n=0
  [ -d "$dir" ] || return 0
  valida_inteiro "$manter" "retenção de $dir" 1

  intrusos="$(conta_intrusos "$dir" "$glob")"
  [ "$intrusos" -eq 0 ] || msg "retenção: $intrusos arquivo(s) fora do formato do carimbo em $dir — não conto nem apago"

  lista="$(lista_dumps "$dir" "$glob")"
  while IFS= read -r arq; do
    [ -n "$arq" ] || continue
    n=$((n + 1))
    if [ -n "$recem" ] && [ "$arq" = "$recem" ]; then continue; fi
    [ "$n" -gt "$manter" ] || continue
    rm -f "$arq"
    msg "retenção: removido ${arq##*/}"
  done <<EOF
$lista
EOF
}

listar() {
  local intrusos
  msg "diários  ($DIR_DIARIO):"
  ls -lh "$DIR_DIARIO"/$GLOB_DIARIO 2>/dev/null || msg "  (nenhum)"
  msg "semanais ($DIR_SEMANAL):"
  ls -lh "$DIR_SEMANAL"/$GLOB_SEMANAL 2>/dev/null || msg "  (nenhum)"
  if [ -d "$DIR_DIARIO" ]; then
    intrusos="$(conta_intrusos "$DIR_DIARIO" "$GLOB_DIARIO")"
    [ "$intrusos" -eq 0 ] || msg "fora do formato do carimbo em $DIR_DIARIO: $intrusos arquivo(s) — ignorados pela retenção"
  fi
}

# --------------------------------------------------------------------------
# Restore test
# --------------------------------------------------------------------------

# Quanto o volume do banco ainda aguenta. Sem isto, o restore-test semanal do cron
# pode encher o disco com uma cópia da produção e derrubar a produção.
espaco_livre() {
  local kb="" dir
  if [ -n "$DB_CONTAINER" ]; then
    kb="$(docker exec "$DB_CONTAINER" sh -c \
      'df -Pk "${PGDATA:-/var/lib/postgresql/data}" 2>/dev/null | sed -n 2p | tr -s " " | cut -d" " -f4' \
      2>/dev/null || true)"
  else
    dir="$(psql_atual "show data_directory" 2>/dev/null || true)"
    if [ -n "$dir" ] && [ -d "$dir" ]; then
      kb="$(df -Pk "$dir" 2>/dev/null | sed -n 2p | tr -s ' ' | cut -d' ' -f4 || true)"
    fi
  fi
  case "${kb:-}" in
    ''|*[!0-9]*) return 0 ;;
  esac
  printf '%s' "$((kb * 1024))"
}

checa_espaco() {
  local tamanho preciso livre
  tamanho="$(psql_atual "select pg_database_size(current_database())")" \
    || erro "não consegui medir o tamanho do banco de origem."
  preciso=$(( tamanho + tamanho * ESPACO_FOLGA_PCT / 100 ))
  livre="$(espaco_livre)"

  if [ -z "$livre" ]; then
    if [ "${BACKUP_ESPACO_DESCONHECIDO_OK:-0}" != "1" ]; then
      erro "não consegui medir o espaço livre do volume do banco. O restore-test sobe uma cópia inteira da produção na mesma instância: sem essa medida eu não começo. Exporte BACKUP_ESPACO_DESCONHECIDO_OK=1 para assumir o risco."
    fi
    msg "AVISO: espaço livre desconhecido — seguindo por BACKUP_ESPACO_DESCONHECIDO_OK=1."
    return 0
  fi

  msg "espaço: origem $(humano "$tamanho"), preciso de $(humano "$preciso") (folga ${ESPACO_FOLGA_PCT}%), livre $(humano "$livre")"
  [ "$livre" -ge "$preciso" ] || \
    erro "espaço insuficiente para o restore-test — cancelado ANTES de criar qualquer banco. Encher o disco do Postgres derruba a produção."
}

# Só derruba banco que este script criou E marcou. Sem o marcador, recusa — mesmo que
# o nome pareça descartável.
derruba_marcado() {
  local db="$1" marca
  marca="$(psql_em "$BANCO_MANUTENCAO" -c \
    "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = '$db'" 2>/dev/null || true)"
  case "$marca" in
    "$MARCADOR"*) : ;;
    *)
      msg "RECUSADO derrubar '$db': não tem o marcador deste script (li: '${marca:-nada}')."
      return 1
      ;;
  esac
  descreve_banco "$db"
  if psql_em "$BANCO_MANUTENCAO" -c "DROP DATABASE \"$db\"" >/dev/null 2>&1; then
    msg "banco de teste '$db' derrubado."
  else
    msg "ATENÇÃO: não consegui derrubar '$db'. Ele continua no disco, com cópia em claro da produção."
    return 1
  fi
}

# Antes de qualquer remoção: onde estou, qual banco, e o que tem dentro dele.
descreve_banco() {
  local db="$1" info
  info="$(psql_em "$db" -c "
    select (select count(*) from pg_tables where schemaname = 'public')::text || ' tabelas / ' ||
           coalesce((select sum((xpath('/row/c/text()',
                       query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename),
                                    false, true, '')))[1]::text::bigint)
                     from pg_tables where schemaname = 'public'), 0)::text || ' linhas'" 2>/dev/null || true)"
  msg "alvo: container='${DB_CONTAINER:-(nenhum)}' host='$IDENT_HOST' porta='$IDENT_PORT' banco='$db' conteúdo=${info:-(não consegui ler)}"
}

restos_marcados() {
  psql_em "$BANCO_MANUTENCAO" -c \
    "select datname from pg_database
      where datname like '${PREFIXO_RESTORE}%'
        and coalesce(shobj_description(oid, 'pg_database'), '') like '${MARCADOR}%'
      order by 1" 2>/dev/null || true
}

# Roda em toda execução, inclusive no backup diário: banco de teste que sobrou é
# cópia em claro da produção esperando alguém achar.
avisa_restos() {
  local lista db
  lista="$(restos_marcados)"
  [ -n "$lista" ] || return 0
  msg "ATENÇÃO: sobrou banco de restore-test de execução anterior — cópia em claro da produção:"
  while IFS= read -r db; do
    [ -n "$db" ] || continue
    msg "  - $db"
  done <<EOF
$lista
EOF
  msg "  derrube com: $0 --limpar-restos"
}

limpar_restos() {
  local lista db falhou=0
  identifica_conexao
  lista="$(restos_marcados)"
  if [ -z "$lista" ]; then
    msg "nenhum banco de restore-test para limpar."
    return 0
  fi
  while IFS= read -r db; do
    [ -n "$db" ] || continue
    derruba_marcado "$db" || falhou=1
  done <<EOF
$lista
EOF
  [ "$falhou" -eq 0 ] || erro "algum banco de teste não pôde ser derrubado (veja acima)."
}

restore_test() {
  local arq="${1:-}"
  valida_config

  [ -z "${BACKUP_RESTORE_DB:-}" ] || erro "BACKUP_RESTORE_DB não existe mais: o nome do banco de teste é gerado aqui, com prefixo '$PREFIXO_RESTORE' e sufixo único, e este script só derruba banco que ele mesmo criou e marcou. Tire a variável do ambiente/cron."

  identifica_conexao
  avisa_restos

  # Este modo CRIA e DERRUBA banco. Contra a produção da VPS, isso é dano; contra o
  # banco errado, é dano silencioso. Fecha por padrão.
  if ! host_e_local "$IDENT_HOST"; then
    [ "${BACKUP_PERMITIR_REMOTO:-0}" = "1" ] || \
      erro "restore-test recusado: o servidor é '$IDENT_HOST', que não é local. Este modo cria e derruba banco no servidor onde conecta. Se é isto mesmo, exporte BACKUP_PERMITIR_REMOTO=1."
    msg "AVISO: servidor não-local '$IDENT_HOST' liberado por BACKUP_PERMITIR_REMOTO=1."
  fi

  [ -n "$arq" ] || arq="$(dump_mais_novo)"
  [ -n "$arq" ] || erro "nenhum dump encontrado em $BACKUP_DIR."

  verifica_dump "$arq" || erro "o dump não passou na verificação; nem tentei restaurar."
  checa_espaco

  local db
  db="$PREFIXO_RESTORE$(date +%Y%m%d%H%M%S)_$$"
  msg "restore-test: $arq → banco novo '$db'"

  # Sem "IF EXISTS": se o nome já existir, é sinal de que algo está errado e eu paro.
  # Este script nunca derruba um banco preexistente para caber.
  psql_em "$BANCO_MANUTENCAO" -c "CREATE DATABASE \"$db\"" >/dev/null \
    || erro "não consegui criar o banco de teste '$db'. Se ele já existe, é resto de outra execução: rode --limpar-restos. Este script NÃO derruba banco preexistente."
  RESTORE_DB_CRIADO="$db"
  psql_em "$BANCO_MANUTENCAO" -c "COMMENT ON DATABASE \"$db\" IS '$MARCADOR criado em $(date +%Y-%m-%dT%H:%M:%S%z) pelo pid $$'" >/dev/null \
    || erro "não consegui marcar o banco de teste '$db'."

  # ON_ERROR_STOP=1: sem isso o psql engole erro linha a linha e "restaura" um
  # banco pela metade com código de saída 0. O `\connect` na frente do fluxo é o
  # que manda o dump para o banco de teste sem reescrever a URL de conexão.
  if ! { printf '\\connect "%s"\n' "$db"; gzip -dc "$arq"; } \
       | pg_cli psql -v ON_ERROR_STOP=1 -q >/dev/null; then
    erro "restauração falhou — o dump NÃO serve. O banco de teste é derrubado na saída (era cópia em claro da produção); para inspecionar, repita com BACKUP_MANTER_RESTORE=1."
  fi

  local tabelas_totais falhou=0 t existe linhas
  tabelas_totais="$(psql_em "$db" -c "select count(*) from information_schema.tables where table_schema = 'public'")"
  msg "restaurado: $tabelas_totais tabelas em public"

  printf '[backup] %-24s %10s\n' "TABELA" "LINHAS"
  for t in $TABELAS_CHAVE; do
    case "$t" in *[!A-Za-z0-9_]*) erro "nome de tabela inválido em BACKUP_TABELAS_CHAVE: '$t'." ;; esac
    existe="$(psql_em "$db" -c "select to_regclass('public.\"$t\"') is not null")"
    if [ "$existe" != "t" ]; then
      printf '[backup] %-24s %10s\n' "$t" "AUSENTE"
      falhou=1
      continue
    fi
    linhas="$(psql_em "$db" -c "select count(*) from public.\"$t\"")"
    printf '[backup] %-24s %10s\n' "$t" "$linhas"
    [ "${linhas:-0}" -gt 0 ] || falhou=1
  done

  # Tabela chave vazia é backup que restaura estrutura e perdeu conteúdo — o modo
  # exato de falha que um backup "verde" costuma esconder. Sai vermelho.
  [ "$falhou" -eq 0 ] || erro "restore-test REPROVADO: tabela chave ausente ou sem linhas."
  msg "restore-test aprovado."
}

# --------------------------------------------------------------------------

# O cabeçalho do arquivo é a documentação: imprime do fim do shebang até a
# primeira linha que não é comentário, sem número de linha chumbado.
uso() {
  awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0"
}

case "${1:-}" in
  ""|--backup)     exige_clientes; fazer_backup ;;
  --restore-test)  exige_clientes; restore_test "${2:-}" ;;
  --limpar-restos) exige_clientes; limpar_restos ;;
  --listar)        listar ;;
  -h|--help)       uso ;;
  *)               erro "opção desconhecida: $1 (use --help)" ;;
esac
