# Relatório da madrugada — Claude (executor)

Janela executada: 17/09/2026, 01:10 → 02:10 -03 (o relógio real da máquina; a janela prevista era 02:00–07:00). Workspace: worktree `~/orca/workspaces/root_os/volute` (branch `pedromagnago/varredura-pendencias-claude`, HEAD `409fbf3`). Sem push, sem merge, sem deploy de produção, sem acesso à VPS, sem dado de cliente, sem credencial real.

## Veredicto

**P1 aprovado em ensaio local, com prova real (Docker de verdade, sem stub) — VPS NÃO validada.** Instalar, atualizar, fazer backup e restaurar, abortar antes de tocar o banco real quando a migration quebra, e voltar sozinho ao runtime anterior quando a versão nova não fica de pé: tudo isso foi executado de ponta a ponta numa instância criada só para isso, com o artefato em execução conferido de fora contra o git (`/api/health/versao` = `git rev-parse <tag>`). O que falta é remoto: destino não confirmado, manifesto não aprovado (Q-003).

## 1. Commits e arquivos

Por Q-002 (sem resposta), os commits foram feitos no **clone isolado** `~/orca/workspaces/root_os/madrugada` (fora do Syncthing), branch `pedromagnago/varredura-pendencias-claude`, sobre `409fbf3`:

| Commit | Tag | Conteúdo |
|---|---|---|
| `8c4ce0a` | `madrugada-v1` | E1: endurecimento de `deploy/{lib-instancia,instalar,atualizar}.sh` (trava `.atualizando`, retrato `--so-checar`, cópia do ensaio verificada por contagem, recuperação VERIFICADA do corte com exit 1/2, `--voltar` conferindo versão+commit, checksum de migration reescrita), stubs `deploy/test-stubs/bin/{docker,curl}`, `apps/api/test/deploy-instancia.test.ts` (31 casos). |
| `fde68d6` | `madrugada-v2` | Só para o ensaio: migration sem efeito `20260917020000_madrugada_noop` + uma linha em `docs/INSTALACAO.md`. **Não é para produção.** |
| `01ef047` | `madrugada-v3` | Só para o ensaio: migration deliberadamente quebrada. **Não é para produção.** |
| `96efbb9` | `madrugada-v4` | Só para o ensaio: v2 + linha de doc, sem migration. **Não é para produção.** |
| HEAD do clone (`git log -1` em `~/orca/workspaces/root_os/madrugada`; o hash muda a cada amend, por isso não está fixado aqui) | — | E2/E3/E4: `docs/operacao/madrugada-2026-09-17/` (status, dúvidas, manifesto, este relatório, `evidencias-e2/`) + os dois documentos do workflow. Sobre `8c4ce0a`. |

O worktree tem o **mesmo conteúdo** de E1 como modificações não commitadas (é de onde os testes e os scripts rodaram). Trazer os commits para cá é um `git fetch` de caminho local + `merge --ff-only` — **não fiz**, porque o `.git` do worktree mora no diretório sincronizado pelo Syncthing e mexer em refs ali é exatamente o que Q-002 pergunta. Comando, quando decidido: `git -C ~/orca/workspaces/root_os/volute fetch ~/orca/workspaces/root_os/madrugada pedromagnago/varredura-pendencias-claude && git checkout -- deploy apps/api/test/deploy-instancia.test.ts && git merge --ff-only FETCH_HEAD`.

## 2. Testes: reais × simulados

| Prova | Tipo | Resultado |
|---|---|---|
| `apps/api/test/deploy-instancia.test.ts` | hermético (stubs de `docker`/`curl`, fixture git com tags v0..v5, `docker compose config` real) | **31/31**, reconfirmado no fechamento |
| `pnpm --filter @mktos/api typecheck` (E1) | estático | limpo |
| E2.1 instalação limpa (`instalar.sh --ambiente homologacao --tag madrugada-v1 --bind-ip 127.0.0.1 --sem-llm`) | **real** | exit 0; saúde `{"status":"ok","db":"ok"}`; `/api/health/versao` = `madrugada-v1@8c4ce0a…` = git |
| E2.3 atualização (`atualizar.sh --tag madrugada-v2`) | **real** (backup, ensaio em cópia, migrate, política, corte transacional) | exit 0; versão no ar `madrugada-v2@fde68d6…`; 40→41 migrations |
| E2.4 `backup-db.sh` + `--restore-test` | **real** | exit 0/0; restaurado em banco novo `rootos_rt_…`, Org 1 / User 3 / Capability 62 / PolicyVersion 1; banco de teste derrubado |
| E2.5a migration quebrada (`madrugada-v3`) | **real** | exit 1 esperado: P3018 na CÓPIA; banco real sem a migration; instância intacta em v2 |
| E2.5b saúde falha após o corte (`madrugada-v4`, curl real com falha injetada só para `ROOTOS_VERSION=madrugada-v4`) | **real** (falha controlada; a verificação da volta usa o curl de verdade) | exit 1 esperado: "CONFIRMADO no ar (saúde ok, versão madrugada-v2)"; `.env` byte a byte igual; containers na imagem v2 |
| E2.6 `papel-app.sh` + os 3 passos do job "Isolamento entre tenants" da CI, contra cópia real do banco da instância (`rootos_homolog_test_rls`) | **real** | `test:isolamento` 287/287 · rotas públicas com RLS 53/53 · cofre com RLS 97/97; 0 pulados |
| E2.6d API sob o papel restrito na instância | **real** | recusa subir com `CoberturaDePlataformaIncompletaError` (7 caminhos de plataforma) — comportamento documentado; volta ao `.env` exato deixa saúde ok |

Falhos: nenhum inesperado. Pulados: nenhum. Simulados: só a suíte hermética (por desenho). Detalhe por passo em `STATUS-CLAUDE.md`; saídas em `evidencias-e2/` (sanitizadas: sem `.env`, sem senha, caminhos do scratchpad abreviados).

## 3. Recursos criados e estado final

Todos criados por mim; **nenhum recurso preexistente foi tocado** (diff em `evidencias-e2/inventario-docker.diff.txt`).

- **De pé, para inspeção (Q-004):** containers `rootos_homolog_{db,redis,minio,api,web}` (projeto Compose `rootos-homologacao`, loopback 127.0.0.1: 4100/4101/5443/6391/9012/9013), rede `rootos-homologacao-net`, volumes `rootos-homologacao_mktos_{db,minio,redis}_data`, imagens `rootos-app:madrugada-v1-8c4ce0a4a28a` e `rootos-app:madrugada-v2-fde68d648dbb`, instância em `<scratchpad>/e2/base/homologacao/` (`.env` 0600, `segredos-iniciais.txt` 0600 com a senha sintética do admin, `backups/` com 3 dumps diários + 1 semanal, `versoes.log` com 4 linhas).
- **Removidos por mim ao fechar (previstos):** banco `rootos_homolog_test_rls`; imagens `rootos-app:madrugada-v3-…` e `-v4-…`. Os bancos de ensaio/restore (`rootos_ensaio_*`, `rootos_rt_*`) foram derrubados pelos próprios scripts.
- **Clone isolado** `~/orca/workspaces/root_os/madrugada` com as 4 tags locais.

Desmonte completo, quando o Pedro decidir (só objetos acima):
```
docker compose -p rootos-homologacao --project-directory <scratchpad>/e2/base/homologacao/repo \
  --env-file <scratchpad>/e2/base/homologacao/.env -f <scratchpad>/e2/base/homologacao/repo/docker-compose.yml \
  -f <scratchpad>/e2/base/homologacao/override.yml down -v
docker rmi rootos-app:madrugada-v1-8c4ce0a4a28a rootos-app:madrugada-v2-fde68d648dbb
rm -rf <scratchpad>/e2
```
(`<scratchpad>` = `/private/tmp/claude-501/-Users-pedro-orca-workspaces-root-os-volute/45a988a7-c84d-408c-913b-37fa3e1d26d3/scratchpad`.)

## 4. Prova de preservação dos dados sintéticos

Sentinelas plantadas antes da primeira atualização e conferidas depois de **cada** operação (v2 ok, v3 abortada, v4 revertida, papel restrito desfeito): linha `Lead` `sentinela-madrugada-e2` (1/1), nome da empresa `root` com sufixo `[sentinela-e2]`, arquivo não rastreado `repo/ferramentas/sentinela-e2.md` (sha256 `c3fa73ba…` idêntico do início ao fim), `users=3`, `roles=9`. No `.env`, a única diferença entre antes e depois da atualização foram as 3 chaves de versão (`ROOTOS_IMAGE`, `ROOTOS_VERSION`, `ROOTOS_COMMIT`); depois da recuperação de v4 o arquivo voltou ao sha256 exato de v2.

## 5. O que NÃO foi verificado

- **Nada na VPS.** Nenhum inventário, nenhuma instalação remota. "VPS validada" não pode ser dito.
- Login humano na tela e modelo respondendo (`--sem-llm`; ninguém entrou) — o próprio instalador declara isso no fim.
- Rota no Traefik/easyPanel, DNS, HTTPS.
- Build em x86_64 e tempo de build em 2 vCPU (as imagens daqui são arm64 do Mac).
- `--voltar` real (só o caminho automático de recuperação foi exercido de verdade; o `--voltar` manual está coberto pela suíte hermética).
- Instalação de `producao` (só `homologacao`, porque 5442 está ocupada nesta máquina pelo Postgres de teste) — os defaults de produção estão cobertos pela suíte hermética.
- Rotação de chave do cofre, expurgo do rastro, restore-test com `DATABASE_URL` remota.

## 6. Perguntas humanas (DUVIDAS.md)

- **Q-001** (Q-TEST): MCP obrigatório? — recomendação: opcional. Sem resposta.
- **Q-002**: onde commitar com o `.git` sincronizado — adotei o clone isolado (b). Sem resposta.
- **Q-003**: destino da VPS e aprovação do manifesto — `AGUARDA_PEDRO`.
- **Q-004**: desmontar a instância local ou deixar — deixei de pé por padrão.
- Observações para decisão: (i) a imagem de uma tag reprovada no ensaio fica no host (disco na VPS); (ii) Codex nunca respondeu nesta janela — `RESPOSTAS.md` vazio às 02:10; "silêncio não é aceite" foi respeitado: nada que dependesse de resposta foi feito.

## 7. Próximo comando seguro

1. Pedro decide Q-002 e Q-003. Sem decisão, nada muda: o worktree segue com E1 não commitada e a instância local de pé.
2. Se o destino for confirmado: inventário somente leitura na VPS (`docker ps -a`, `docker network ls`, `docker volume ls`, `docker images`, `ss -ltnp`, `df -h`, `free -m`, `nproc`) e completar o manifesto — **nenhuma escrita**.
3. Se o manifesto for aprovado por escrito: `ROOTOS_BASE=/srv/rootos ROOTOS_REPO=<bundle ou origem aprovada> deploy/instalar.sh --ambiente homologacao --tag madrugada-v1 --dominio <a definir> --bind-ip 172.17.0.1 --sem-llm --so-checar` — o retrato primeiro; o real só depois de ler o retrato.
