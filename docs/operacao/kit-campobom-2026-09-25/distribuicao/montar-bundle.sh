#!/usr/bin/env bash
# Monta o bundle de distribuição do ROOT OS v0.4.2 para a Campo Bom.
#
#   montar-bundle.sh <repo com a tag v0.4.2> <saída .bundle> <área de trabalho vazia>
#
# O bundle leva UM commit sem pai e a tag v0.4.2 apontando para ele, e nada mais: nenhuma branch,
# nenhum histórico, nenhum autor da equipe. A árvore é a de v0.4.2 (7f8a762) menos docs/ inteira, as
# pastas de teste, tools/clickup-inventario.py, o override da VPS (docker-compose.vps.yml) e o
# .stignore do Syncthing entre VPS e Mac (REMOVER; Q-007 = b), com o CLAUDE.md trocado pelo
# contrato da máquina do cliente, um .claude/settings.json com as travas de segredo e UMA correção
# do instalador (instalar-senha-acao.patch: o seed recebe a senha da conta ia-acao@ e deixa de
# imprimi-la no log; é o commit 612f7a9 da branch do kit). O build da imagem não lê nenhum dos
# removidos (Dockerfile: install + build de src/; vitest/tsconfig.test só nos testes; deploy/up.sh
# só soma o override da VPS com --vps, que o kit não usa). Identidade e datas fixas: rodar de novo
# com a mesma tag e os mesmos três arquivos dá o mesmo commit.
set -euo pipefail

REPO="${1:?repo}"; SAIDA="${2:?saída .bundle}"; TRAB="${3:?área de trabalho}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
TAG=v0.4.2
ORIGEM_ESPERADA=7f8a762cda94cb4fa1e299bfab506a6b217469e9
REMOVER=(
  CLAUDE.md
  docs
  apps/api/test
  apps/web/tests
  packages/policy/test
  deploy/test-stubs
  tools/clickup-inventario.py
  docker-compose.vps.yml
  .stignore
)
PATCHES=(instalar-senha-acao.patch)
# Qualquer resto de teste fora das pastas acima reprova a montagem (em vez de ir no bundle calado).
RESTO_TESTE='(^|/)(test|tests|__tests__|test-stubs)/|\.(test|spec)\.[cm]?[jt]sx?$'

[ ! -e "$TRAB" ] || { echo "área de trabalho já existe: $TRAB" >&2; exit 1; }
[ ! -e "$SAIDA" ] || { echo "saída já existe: $SAIDA" >&2; exit 1; }
ORIGEM="$(git -C "$REPO" rev-parse "$TAG^{commit}")"
[ "$ORIGEM" = "$ORIGEM_ESPERADA" ] || { echo "a tag $TAG de $REPO aponta para $ORIGEM, esperado $ORIGEM_ESPERADA" >&2; exit 1; }
DATA="$(git -C "$REPO" show -s --format=%cI "$ORIGEM")"

git init -q "$TRAB"
cd "$TRAB"
git fetch -q --no-tags "$REPO" "refs/tags/$TAG:refs/origem/$TAG"
git read-tree "refs/origem/$TAG^{tree}"
for p in "${REMOVER[@]}"; do
  [ -n "$(git ls-files -- "$p")" ] || { echo "caminho a remover não existe na árvore: $p" >&2; exit 1; }
  git rm -r -q --cached -- "$p"
done
RESTO="$(git ls-files | grep -cE "$RESTO_TESTE" || true)"
[ "$RESTO" = 0 ] || { echo "sobrou $RESTO arquivo(s) de teste na árvore:" >&2; git ls-files | grep -E "$RESTO_TESTE" >&2; exit 1; }
for p in "${PATCHES[@]}"; do git apply --cached --whitespace=nowarn "$AQUI/$p" || { echo "o patch $p não aplica na árvore de $TAG" >&2; exit 1; }; done
CLAUDE_SHA="$(git hash-object -w "$AQUI/CLAUDE.md")"
SETTINGS_SHA="$(git hash-object -w "$AQUI/settings.json")"
git update-index --add --cacheinfo "100644,$CLAUDE_SHA,CLAUDE.md"
git update-index --add --cacheinfo "100644,$SETTINGS_SHA,.claude/settings.json"
ARVORE="$(git write-tree)"

export GIT_AUTHOR_NAME="ROOT OS" GIT_AUTHOR_EMAIL="release@rootos.invalid" GIT_AUTHOR_DATE="$DATA"
export GIT_COMMITTER_NAME="ROOT OS" GIT_COMMITTER_EMAIL="release@rootos.invalid" GIT_COMMITTER_DATE="$DATA"
COMMIT="$(printf '%s\n' \
  "ROOT OS v0.4.2 - distribuição da Campo Bom" \
  "" \
  "Árvore de v0.4.2 ($ORIGEM_ESPERADA) sem docs/, sem as pastas de teste, sem" \
  "ferramenta interna e sem os arquivos da VPS e do Syncthing, com o contrato da" \
  "máquina do cliente em CLAUDE.md e .claude/settings.json e uma correção do" \
  "instalador: deploy/instalar.sh passa MCP_ACTION_PASSWORD ao seed." \
  "" \
  "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" \
  | git commit-tree "$ARVORE")"
git tag -a "$TAG" -m "ROOT OS $TAG (distribuição Campo Bom)" "$COMMIT"
git update-ref -d "refs/origem/$TAG"
git bundle create -q "$SAIDA" "refs/tags/$TAG"
git bundle verify -q "$SAIDA"
echo "commit=$COMMIT"
echo "arvore=$ARVORE"
echo "tag=$(git rev-parse "refs/tags/$TAG")"
