#!/usr/bin/env bash
# Publica a imagem rootos-official:root-atas-granola-7b36a3d SÓ na api do os.operacaoroot.com.
# Correção do "Gerar ata" do Granola (resposta cortada no meio do JSON). Preparado em 30/10/2026
# pelo Claude do Pedro; não roda sozinho. Uso: bash publicar-atas.sh
set -euo pipefail
PROJETO=root_marketing-os
DIR=/etc/easypanel/projects/root/marketing-os/code
IMG=rootos-official:root-atas-granola-7b36a3d
REL=/srv/rootos/releases/atas-granola-7b36a3d-$(date -u +%Y%m%d)
docker run --rm --network none --entrypoint sh $IMG -c 'grep -q "veio cortada" /app/apps/api/dist/work/atas/atas-do-granola.service.js && grep -q "anthropic/claude-opus-5.5" /app/apps/api/dist/llm/preco.js' \
  || { echo "imagem sem a correção das atas ou sem os preços do OpenRouter"; exit 1; }
img_ar=$(docker inspect -f '{{.Image}}' mktos_api)
[[ "$img_ar" == sha256:848a7255* ]] || { echo "o ar mudou de imagem desde a compilação ($img_ar): juntar as branches root/precos-openrouter na release nova em vez de rodar isto"; exit 1; }
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
assert a["image"]=="rootos-official:root-atas-granola-7b36a3d"
assert e["LLM_PROVIDER"]=="anthropic", "o provedor principal mudaria"
assert e["OPENAI_BASE_URL"].startswith("https://openrouter.ai"), "o OpenRouter de vetor/transcrição sairia"
print("ok: api na imagem nova; provedor segue anthropic; web segue em", c["web"]["image"][:45])'
dc "${DEPOIS[@]}" up -d --no-deps --no-build api 2>&1 | tail -2
docker image inspect -f '{{.Id}}' $IMG > "$REL/imagem.txt"
cat > "$REL/REPORT.txt" <<R
ATAS DO GRANOLA, publicado em $(date -u +%FT%TZ) a pedido do Pedro ("não tá rodando a ata", tela Trabalho > Atas, 30/10/2026).
Erro: "a resposta do leitor de atas não é o JSON combinado: Expected ',' or ']' after array element".
Causa: o leitor do Granola (TR-02) chamava step() com max_tokens 6000, e na Anthropic esse limite cobre o pensamento
adaptativo e a resposta; a reunião de 29/10 (127 mil caracteres) esgotava o limite no meio da lista de sugestões.
Correção (commit 7b36a3d4 sobre 16a92871, branch root/precos-openrouter, pasta /srv/rootos/builds/openrouter-precos):
SAIDA_DA_LEITURA = TETO_MAXIMO_DE_SAIDA_DA_RESPOSTA (16 mil, o mesmo do complete()); stopReason max_tokens vira
aviso claro sem gravar nada. Teste novo em trabalho-atas-granola.test.ts (22 de 22 passam num Postgres descartável).
As 9 falhas de trabalho-atas-fontes/arquitetura já existiam em 16a92871, sem relação com esta mudança.
Imagem $IMG ($(cat $REL/imagem.txt)), só na api. Antes: $img_ar. Sem migration.
PARA A PRÓXIMA RELEASE: juntar root/precos-openrouter (7b36a3d4), senão a correção e os preços somem.
VOLTAR PARA ANTES: cd $DIR && docker compose --project-name $PROJETO \$(cat $REL/cadeia-antes.txt) up -d --no-deps --no-build api
R
chmod 600 "$REL"/*
sleep 20
curl -s -o /dev/null -w "health %{http_code}\n" https://os.operacaoroot.com/api/health
echo "REPORT em $REL/REPORT.txt"
