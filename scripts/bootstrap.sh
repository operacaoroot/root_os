#!/usr/bin/env bash
# ============================================================================
# pnpm bootstrap — prepara um banco para o ROOT OS, quantas vezes for preciso.
# ============================================================================
#
# IDEMPOTENTE E DE PRESERVAÇÃO EXATA: rodar de novo não apaga nada, não religa
# módulo, não mexe em papel, permissão, nome ou senha de quem já existe. Cria
# só o que falta. O que este script NUNCA faz:
#   · `db:seed:demo` — o único comando que apaga dado (mão humana: nome de
#     banco descartável + flag `--sim-apagar`);
#   · `db:sync-permissions` — realinha papéis com `set` e REVOGA vínculo feito
#     à mão; é o ritual de três passos de quando `permissions.ts` muda;
#   · `db:seed -- --rotacionar-senhas` — troca senha de conta existente.
#
# A sequência é a que até 17/09/2026 só existia deduzida do código:
#   1. pacotes internos construídos (`seed-politica.ts` importa @mktos/policy)
#   2. cliente do Prisma gerado
#   3. migrations APLICADAS (`migrate deploy`, não `migrate dev`)
#   4. empresa, papéis, permissões e contas (`db:seed`, preservação exata)
#   5. política versionada no banco (`db:seed:politica`; em banco já semeado
#      recusa afrouxar sem assinatura — e está certo)
#
# DATABASE_URL: o AMBIENTE tem precedência; senão, lida de apps/api/.env (ou do
# arquivo em BOOTSTRAP_ENV_FILE), sem executar o arquivo como shell. Sem ela,
# para com instrução. `--so-checar` carrega o ambiente, imprime o que faria e
# sai sem rodar nada — é o que a suíte mede.
set -euo pipefail
cd "$(dirname "$0")/.."

SO_CHECAR=0
for arg in "$@"; do
  case "$arg" in
    --so-checar) SO_CHECAR=1 ;;
    *) echo "argumento desconhecido: $arg (só --so-checar existe)" >&2; exit 64 ;;
  esac
done

ENV_API="${BOOTSTRAP_ENV_FILE:-apps/api/.env}"
ORIGEM_DA_URL="ambiente"

# Carrega VAR=valor de um arquivo .env sem executá-lo: linha a linha, ignora
# comentário e vazio, corta no primeiro `=`, tira aspas simples/duplas das
# pontas. Variável já presente no ambiente NÃO é sobrescrita (precedência).
carregar_env() {
  local arquivo="$1" linha chave valor
  [ -f "$arquivo" ] || return 0
  while IFS= read -r linha || [ -n "$linha" ]; do
    case "$linha" in ''|'#'*) continue ;; esac
    case "$linha" in *=*) ;; *) continue ;; esac
    chave="${linha%%=*}"; valor="${linha#*=}"
    chave="${chave#export }"; chave="${chave// /}"
    case "$chave" in ''|*[!A-Za-z0-9_]*) continue ;; esac
    valor="${valor%%[[:space:]]#*}"           # comentário no fim da linha
    valor="${valor%"${valor##*[![:space:]]}"}" # espaço à direita
    case "$valor" in
      \"*\") valor="${valor#\"}"; valor="${valor%\"}" ;;
      \'*\') valor="${valor#\'}"; valor="${valor%\'}" ;;
    esac
    if [ -z "${!chave:-}" ]; then
      export "$chave=$valor"
      # `if`, e não `[ ] && …`: uma lista `&&` que falha como ÚLTIMO comando do
      # laço faz a função devolver 1, e o `set -e` derruba o script logo depois
      # de exportar — foi medido com um .env cuja última linha não era a URL.
      if [ "$chave" = "DATABASE_URL" ]; then ORIGEM_DA_URL="$arquivo"; fi
    fi
  done < "$arquivo"
  return 0
}

carregar_env "$ENV_API"

if [ -z "${DATABASE_URL:-}" ]; then
  cat >&2 <<MSG

  FALTA A DATABASE_URL.

  Ela não está no ambiente nem em ${ENV_API}. Crie o arquivo a partir do exemplo e preencha:
      cp apps/api/.env.example apps/api/.env
  Com o compose local (porta 5442):
      DATABASE_URL=postgresql://mkt:mkt@localhost:5442/marketing_os

MSG
  exit 1
fi

# Só o nome do banco, nunca a URL inteira (tem senha).
BANCO="${DATABASE_URL##*/}"; BANCO="${BANCO%%\?*}"

if [ "$SO_CHECAR" = 1 ]; then
  cat <<MSG
[bootstrap] só checando — nada será executado
  DATABASE_URL: banco "${BANCO}" (origem: ${ORIGEM_DA_URL})
  passos: build shared+policy → db:generate → db:deploy → db:seed → db:seed:politica
  fora, de propósito: db:seed:demo · db:sync-permissions · --rotacionar-senhas
MSG
  exit 0
fi

passo() { printf '\n\033[1m[bootstrap] %s\033[0m\n' "$1"; }

passo "1/5 pacotes internos"
pnpm --filter @mktos/shared build >/dev/null
pnpm --filter @mktos/policy build >/dev/null

passo "2/5 cliente do Prisma"
pnpm --filter @mktos/api db:generate >/dev/null

passo "3/5 migrations (deploy) — banco \"${BANCO}\""
pnpm --filter @mktos/api db:deploy

passo "4/5 empresa, papéis, permissões e contas (preservação exata)"
pnpm --filter @mktos/api db:seed

passo "5/5 política versionada no banco"
pnpm --filter @mktos/api db:seed:politica

cat <<MSG

  PRONTO. Nada foi apagado, nenhum módulo religado, nenhum papel, permissão ou senha alterados.

  Subir:   pnpm --filter @mktos/api dev      (API em http://localhost:4001/api)
           pnpm --filter @mktos/web dev      (web em http://localhost:4000)
  Entrar:  admin@marketing-os.local — a senha é a de ADMIN_PASSWORD no primeiro seed, ou a impressa.
  Operações EXPLÍCITAS, fora do bootstrap:
    rotacionar senhas das contas de serviço:   pnpm --filter @mktos/api db:seed -- --rotacionar-senhas
    realinhar papéis após mudar permissions.ts: pnpm --filter @mktos/shared build && pnpm --filter @mktos/api db:sync-permissions
    dados de exemplo (APAGA; só banco descartável): pnpm --filter @mktos/api db:seed:demo -- --sim-apagar

MSG
