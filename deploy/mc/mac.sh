#!/usr/bin/env bash
# A parte do Mac do deploy da máquina de conteúdo (frente MC).
#
#   bash deploy/mc/mac.sh <etapa>
#
# publicar → (CI verde) → mesclar → enviar          código no GitHub e na VPS
# whisper → skill → config → (conta criada) → vigia  a estação de mídia deste Mac
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
BRANCH=root-os/maquina-de-conteudo
GH=operacaoroot/marketing-os
MODELO_DIR="$HOME/models/whisper"
MODELO="$MODELO_DIR/ggml-large-v3-turbo-q5_0.bin"
CONF="$HOME/.config/root/root-midia.env"

falha() { echo "PARADO: $*" >&2; exit 1; }
cd "$REPO"

case "${1:-}" in

publicar)
  [ "$(git branch --show-current)" = "$BRANCH" ] || falha "abra a branch $BRANCH em $REPO"
  [ -z "$(git status --porcelain)" ] || falha "há mudança sem commit em $REPO"
  git fetch origin
  if ! git merge-base --is-ancestor origin/main HEAD; then
    git merge --no-edit origin/main || falha "conflito ao juntar o main: chame o Claude"
  fi
  git push -u origin "$BRANCH"
  if ! gh pr view "$BRANCH" -R "$GH" >/dev/null 2>&1; then
    CORPO=$(mktemp)
    cat > "$CORPO" <<'MD'
A máquina de conteúdo do ROOT OS: uma gravação por semana vira episódio, pacote do YouTube, página de links, newsletter e 12 posts, com a publicação no Instagram no horário depois que uma segunda pessoa assina a semana.

- Plano e decisões: `docs/PLANO-MAQUINA-DE-CONTEUDO.md` e `docs/especificacoes/MD-onda-d-automacao.md`
- Registro das ondas MC-A, MC-B, MC-C e MD, com a ordem de deploy consolidada: `docs/ESTADO-DA-EXECUCAO.md`
- Guia de uso: `docs/GUIA-MAQUINA-DE-CONTEUDO.md`
- Deploy em etapas: `deploy/mc/vps.sh` e `deploy/mc/mac.sh`

Toda automação nasce desligada. A publicação automática só liga com o seed da política assinado, uma segunda pessoa titular e o interruptor da aba Semana.

O merge também corrige a CI vermelha do main desde o #11 (36 leituras R0 e as contagens de capacidades).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
MD
    gh pr create -R "$GH" --base main --head "$BRANCH" \
      --title "A máquina de conteúdo: da gravação da semana ao post publicado no horário" \
      --body-file "$CORPO"
  fi
  echo "Acompanhando a CI (Ctrl+C sai sem cancelar nada):"
  gh pr checks "$BRANCH" -R "$GH" --watch || true
  ;;

mesclar)
  gh pr checks "$BRANCH" -R "$GH" || falha "a CI não está verde"
  gh pr merge "$BRANCH" -R "$GH" --merge
  ;;

enviar)
  SHA=$(ssh vps-root 'git -C /srv/projetos/root_os rev-parse HEAD') || falha "sem acesso à VPS"
  git fetch origin
  git merge-base --is-ancestor "$SHA" origin/main || falha "a VPS está num commit fora do main ($SHA)"
  git branch -f main origin/main
  git bundle create /tmp/mc.bundle "$SHA..main"
  ssh vps-root 'mkdir -p /root/mc'
  scp /tmp/mc.bundle deploy/mc/vps.sh vps-root:/root/mc/
  echo "Enviado. Na VPS: ssh vps-root  e depois  bash /root/mc/vps.sh diagnostico"
  ;;

whisper)
  mkdir -p "$MODELO_DIR"
  if [ -f "$MODELO" ]; then echo "Já baixado: $MODELO"; exit 0; fi
  curl -L --fail --progress-bar -o "$MODELO.parcial" \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
  mv "$MODELO.parcial" "$MODELO"
  ls -lh "$MODELO"
  ;;

skill)
  mkdir -p "$HOME/.claude/skills"
  ln -sfn "$REPO/tools/root-midia" "$HOME/.claude/skills/root-midia"
  ls -l "$HOME/.claude/skills/root-midia"
  ;;

config)
  mkdir -p "$(dirname "$CONF")"
  if [ ! -f "$CONF" ]; then
    ( umask 077
      cat > "$CONF" <<ENV
ROOT_OS_API_URL=https://os.operacaoroot.com/api
ROOT_OS_EMAIL=
ROOT_OS_SENHA=
WHISPER_MODEL=$MODELO
ENV
    )
  fi
  chmod 600 "$CONF"
  open -a TextEdit "$CONF"
  echo "Preencha ROOT_OS_EMAIL e ROOT_OS_SENHA com a conta do Mac criada no OS, salve e feche."
  ;;

vigia)
  grep -q '^ROOT_OS_SENHA=.\+' "$CONF" 2>/dev/null || falha "falta a senha em $CONF (rode: config)"
  node tools/root-midia/root-midia.mjs pendentes
  node tools/root-midia/root-midia.mjs vigia instalar
  node tools/root-midia/root-midia.mjs vigia estado
  ;;

*)
  sed -n '2,8p' "$0"; exit 1 ;;
esac
