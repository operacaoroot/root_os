#!/usr/bin/env bash
# Publica a imagem rootos-official:root-precos-openrouter-16a9287 SÓ na api do os.operacaoroot.com.
# Preparado em 29/10/2026 pelo Claude do Pedro; não roda sozinho. Uso: bash publicar-precos.sh
set -euo pipefail
PROJETO=root_marketing-os
DIR=/etc/easypanel/projects/root/marketing-os/code
IMG=rootos-official:root-precos-openrouter-16a9287
REL=/srv/rootos/releases/precos-openrouter-16a9287-$(date -u +%Y%m%d)
docker run --rm --network none --entrypoint sh $IMG -c 'grep -q "anthropic/claude-opus-5.5" /app/apps/api/dist/llm/preco.js' || { echo "imagem sem o preço novo"; exit 1; }
img_ar=$(docker inspect -f '{{.Image}}' mktos_api)
[[ "$img_ar" == sha256:860d0751* ]] || { echo "o ar mudou de imagem desde a compilação ($img_ar): juntar root/precos-openrouter na release nova em vez de rodar isto"; exit 1; }
mkdir -m 700 -p "$REL"
cadeia=$(docker inspect mktos_api --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')
IFS=, read -ra ARQS <<<"$cadeia"
ANTES=(); for f in "${ARQS[@]}"; do [[ -f "$f" ]] || { echo "sumiu $f"; exit 1; }; ANTES+=(-f "$f"); done
printf '%s ' "${ANTES[@]}" > "$REL/cadeia-antes.txt"
echo "$img_ar" > "$REL/imagem-antes.txt"
printf 'services:\n  api:\n    image: %s\n' "$IMG" > "$REL/publish-images.yml"
DEPOIS=("${ANTES[@]}" -f "$REL/publish-images.yml")
dc() { docker compose -p "$PROJETO" --project-directory "$DIR" "$@"; }
dc "${DEPOIS[@]}" config --format json | python3 -c '
import json,sys; c=json.load(sys.stdin)["services"]; a=c["api"]; e=a["environment"]
assert a["image"]=="rootos-official:root-precos-openrouter-16a9287"
assert e["LLM_PROVIDER"]=="openrouter" and e["OPENAI_BASE_URL"].startswith("https://openrouter.ai")
print("ok: api na imagem nova; web segue em", c["web"]["image"][:45])'
dc "${DEPOIS[@]}" up -d --no-deps --no-build api 2>&1 | tail -2
docker image inspect -f '{{.Id}}' $IMG > "$REL/imagem.txt"
cat > "$REL/REPORT.txt" <<R
PREÇOS DO OPENROUTER, publicado em $(date -u +%FT%TZ) a pedido do Pedro ("coloca o custo do opus e das demais mais usadas na plataforma").
Imagem $IMG ($(cat $REL/imagem.txt)), só na api; a web segue na imagem do ícone da aba. Antes: $img_ar.
Código: /srv/rootos/builds/openrouter-precos, branch root/precos-openrouter, commit 16a92871 sobre 50cfe8c4. Sem migration.
preco.ts: anthropic/claude-opus-5.5 (4/20, cache 0,20/5), anthropic/claude-haiku-5.5 (0,10/0,50, cache 0,01/0,125; acima de
100 mil tokens 0,50/2,50, cache 0,05/0,625), cache de leitura do Sonnet 5.5 a 0,10, Sonnet 4.5 com faixa acima de 200 mil (6/22,5).
Fonte: pricing de https://openrouter.ai/api/v1/models em 29/10/2026. transcricao.provider.ts usa usage.cost do OpenRouter.
PARA A PRÓXIMA RELEASE: juntar root/precos-openrouter (16a92871), senão estes preços somem.
VOLTAR PARA ANTES: cd $DIR && docker compose --project-name $PROJETO \$(cat $REL/cadeia-antes.txt) up -d --no-deps --no-build api
R
chmod 600 "$REL"/*
sleep 20
curl -s -o /dev/null -w "health %{http_code}\n" https://os.operacaoroot.com/api/health
echo "REPORT em $REL/REPORT.txt"
