#!/usr/bin/env bash
# Dá SENHA ao papel restrito com que a aplicação conecta (`mktos_app`).
#
# A migration 20260911020000_papel_de_aplicacao cria o papel NOLOGIN e com as
# permissões mínimas. Senha é segredo de operação: não entra em arquivo
# versionado, não entra em migration, não entra na linha de comando. Entra aqui,
# pela variável de ambiente, e sai daqui direto para o `psql` pela ENTRADA
# PADRÃO — nunca como argumento, que apareceria em `ps` para qualquer usuário da
# máquina.
#
# Uso:
#   DB_APP_PASSWORD="$(openssl rand -hex 32)" deploy/papel-app.sh
#   DB_APP_PASSWORD='...'                     deploy/papel-app.sh --vps
#
# Depois de rodar, faltam TRÊS passos — o script não faz nenhum por você. E o
# PRIMEIRO é ANTERIOR a este script, não posterior:
#
#   0. OS SETE CAMINHOS DE PLATAFORMA PRECISAM DECLARAR CONTEXTO.
#      São as consultas que rodam ANTES de haver empresa porque é elas que
#      descobrem a empresa — login por senha, login com Google, provisionamento,
#      ClickUp, financeiro, carga da política e a sonda de saúde. A lista com
#      motivo está em `CAMINHOS_DE_PLATAFORMA_EXIGIDOS`
#      (`apps/api/src/prisma/contexto-de-plataforma.ts`).
#
#      ENQUANTO FALTAR UM DELES, recriar o container com DB_APP_USER e
#      DB_APP_PASSWORD preenchidos faz a API **RECUSAR SUBIR**, de propósito
#      (`CoberturaDePlataformaIncompletaError`, em `prisma/sessao-de-banco.ts`).
#      A recusa é o comportamento certo: sob o papel restrito e sem a sentinela,
#      o login não acha usuário nenhum e vira "credenciais inválidas" para toda a
#      empresa, em silêncio — policy de linha não recusa, ela recorta.
#      Para voltar ao estado anterior AGORA: tire as duas variáveis do `.env` e
#      recrie o container. A aplicação volta a conectar como dona.
#
#   1. gravar DB_APP_USER=mktos_app e DB_APP_PASSWORD=<a mesma> no `.env`;
#   2. recriar o container da api:
#        docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-build api
#      `docker restart` NÃO serve: variável de ambiente é fixada na criação do
#      container.
#
# Rodar de novo é seguro: troca a senha do papel. O container em pé continua com
# a antiga até ser recriado — troque a senha e recrie na mesma janela. Dar senha
# ao papel, sozinho, não muda nada: enquanto o `.env` não apontar para ele, a
# aplicação segue conectando como dona e o isolamento continua inerte.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE_FILES=(-f docker-compose.yml)
for arg in "$@"; do
  case "$arg" in
    --vps) COMPOSE_FILES+=(-f docker-compose.vps.yml) ;;
    *) echo "[papel-app] erro: '$arg' não é flag conhecida (só --vps)." >&2; exit 2 ;;
  esac
done

if [ -z "${DB_APP_PASSWORD:-}" ]; then
  cat >&2 <<'FIM'
[papel-app] erro: DB_APP_PASSWORD vazio.

  DB_APP_PASSWORD="$(openssl rand -hex 32)" deploy/papel-app.sh

Gere SEM "%": um "%" literal não sobrevive à URL de conexão e a aplicação
recusa subir em vez de conectar com senha errada.
FIM
  exit 2
fi

case "$DB_APP_PASSWORD" in
  *%*) echo "[papel-app] erro: a senha contém '%', que corrompe a URL de conexão. Gere outra: openssl rand -hex 32" >&2; exit 2 ;;
esac

# Lê só o que interessa do .env (nome do banco e usuário DONO), sem executar o
# arquivo — valor com espaço quebraria um `source`.
#
# As ASPAS do arquivo não fazem parte do valor. `DB_NAME="marketing_os"` é a
# forma mais comum de escrever, e a versão anterior devolvia `"marketing_os"`
# COM as aspas: o psql ia procurar um banco que não existe e o erro não dizia
# por quê. Valor entre aspas vale até a aspa de fechamento (então `#` e espaço
# lá dentro sobrevivem); valor sem aspas perde o comentário de fim de linha e o
# espaço das pontas.
ler_do_env() {
  [ -f .env ] || return 0
  local linha valor
  while IFS= read -r linha || [ -n "$linha" ]; do
    case "$linha" in "$1"=*) ;; *) continue ;; esac
    valor="${linha#*=}"
    case "$valor" in
      \"*) valor="${valor#\"}"; valor="${valor%%\"*}" ;;
      \'*) valor="${valor#\'}"; valor="${valor%%\'*}" ;;
      *)
        valor="${valor%%#*}"
        [[ $valor =~ ^[[:space:]]*(.*[^[:space:]])?[[:space:]]*$ ]] && valor="${BASH_REMATCH[1]}"
        ;;
    esac
    printf '%s' "$valor"
    return 0
  done < .env
}

# Identificador de Postgres no formato conservador: letra ou `_`, depois letra,
# dígito ou `_`, até 63 caracteres (o limite do NAMEDATALEN).
#
# Isto NÃO é preciosismo de estilo. O nome do papel entra no SQL lá embaixo sem
# aspas e sem escape — `ALTER ROLE %s ...`. Um valor como
# `DB_APP_USER="x; DROP TABLE \"EventLog\"; --"` viraria comando, rodando com o
# papel DONO do banco. Validar aqui é o que torna a interpolação segura; e,
# dentro deste formato, o identificador não precisa de aspas no SQL (com aspas,
# `MKTOS_APP` e `mktos_app` passariam a ser papéis DIFERENTES, e a migration
# cria o minúsculo).
#
# DB_USER e DB_NAME passam pela mesma peneira: eles não são interpolados em SQL
# — vão como argumento de `-U` e `-d` —, mas um valor estranho vindo do .env só
# produziria um erro de psql difícil de ler.
identificador_valido() {
  [[ $1 =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]
}

exigir_identificador() {
  local nome="$1" valor="$2"
  if ! identificador_valido "$valor"; then
    echo "[papel-app] erro: ${nome}='${valor}' não é um identificador de Postgres aceitável." >&2
    echo "  Esperado: letra ou '_', depois letras, dígitos ou '_', até 63 caracteres." >&2
    echo "  O nome do papel vai para dentro de um comando SQL — nome fora deste formato é execução de SQL arbitrário com o papel dono do banco." >&2
    exit 2
  fi
}

DB_USER="${DB_USER:-$(ler_do_env DB_USER)}"; DB_USER="${DB_USER:-mkt}"
DB_NAME="${DB_NAME:-$(ler_do_env DB_NAME)}"; DB_NAME="${DB_NAME:-marketing_os}"
PAPEL="${DB_APP_USER:-mktos_app}"

exigir_identificador DB_APP_USER "$PAPEL"
exigir_identificador DB_USER "$DB_USER"
exigir_identificador DB_NAME "$DB_NAME"

echo "[papel-app] banco=${DB_NAME} dono=${DB_USER} papel=${PAPEL}"

# Aspas simples duplicadas: o único escape que um literal SQL exige. `printf` é
# embutido do shell e o `sed` recebe a senha pela entrada padrão — em nenhum
# momento ela vira argumento de processo.
SENHA_SQL=$(printf '%s' "$DB_APP_PASSWORD" | sed "s/'/''/g")

# `log_statement = none` na própria sessão para o ALTER ROLE não cair no log do
# Postgres se o servidor estiver registrando DDL. Exige superusuário; num banco
# em que não seja, a linha falha e o `\set ON_ERROR_STOP` só vale a partir da
# seguinte — de propósito.
{
  printf "SET log_statement = 'none';\n"
  printf "\\\\set ON_ERROR_STOP on\n"
  printf "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%s') THEN RAISE EXCEPTION 'papel %% nao existe: rode as migrations antes (prisma migrate deploy)', '%s'; END IF; END \$\$;\n" "$PAPEL" "$PAPEL"
  printf "ALTER ROLE %s WITH LOGIN PASSWORD '%s';\n" "$PAPEL" "$SENHA_SQL"
  printf "SELECT rolname, rolcanlogin AS entra, rolbypassrls AS atravessa_rls, rolsuper AS superusuario FROM pg_roles WHERE rolname = '%s';\n" "$PAPEL"
} | docker compose "${COMPOSE_FILES[@]}" exec -T db psql -U "$DB_USER" -d "$DB_NAME" -q

unset SENHA_SQL

cat <<FIM
[papel-app] senha definida. Sozinho isso NÃO muda nada: a api só passa a usar o
papel quando o .env apontar para ele.

ANTES de seguir, confira o log do boot ATUAL. Se ele traz a linha
"[tenant] ATENÇÃO: N caminho(s) de plataforma ainda NÃO declaram contexto",
PARE: recriar a api com as variáveis abaixo vai fazê-la RECUSAR SUBIR, de
propósito. Declare os caminhos que a mensagem nomeia antes
(CAMINHOS_DE_PLATAFORMA_EXIGIDOS, em apps/api/src/prisma/contexto-de-plataforma.ts).

Falta:
  1. no .env:  DB_APP_USER=${PAPEL}
               DB_APP_PASSWORD=<a mesma senha>
  2. recriar a api (docker restart NÃO relê variável de ambiente):
       docker compose ${COMPOSE_FILES[*]} up -d --no-build api
  3. conferir no log do boot a linha que começa com "[tenant] conectado como".
     Tem de dizer "papel restrito". Se disser "ISOLAMENTO POR LINHA INERTE", a
     api ainda está conectando como dona das tabelas.

Para desfazer: tire DB_APP_USER e DB_APP_PASSWORD do .env e recrie a api.
FIM
