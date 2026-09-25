# Perguntas do Claude

Escritor: Claude. Acrescentar, sem apagar o histórico.

## Q-001 (Q-TEST) — 17/09/2026 01:32 -03 — E0
**Pergunta:** MCP é obrigatório nesta entrega?
**Evidência:** `docs/WORKFLOW-MADRUGADA-CLAUDE.md`, "Decisões que não precisam ser perguntadas novamente": *"MCP opcional. Claude Code é a oficina do cliente, não um runtime obrigatório na VPS."* `docs/PLANO-PRODUTO.md` §1 item 6.
**Opções:** (a) obrigatório; (b) opcional.
**Recomendação:** (b) — já decidido; esta pergunta é o teste do canal.
**Bloqueia:** nada.
**Enquanto aguardo:** E1.

## Q-002 — 17/09/2026 01:33 -03 — E0 (item 2: Syncthing)
**Pergunta:** posso commitar neste worktree, sabendo que o `.git` dele está numa pasta sincronizada pelo Syncthing com um dispositivo remoto — ou devo usar um clone local isolado só para os commits?
**Evidência (sanitizada):**
- `~/Library/Application Support/Syncthing/config.xml`: `<folder id="projetos-mdc" label="Projetos" path="/Users/pedro/Library/Projetos" type="sendreceive" … paused=false>` compartilhada com `LP7YWNR…` (MacBook-Air-2.local, este Mac) e `6JOYOS4…` (nome `dc6de249b110`).
- `cat volute/.git` → `gitdir: /Users/pedro/Library/Projetos/root_os/.git/worktrees/volute`; refs desta branch em `~/Library/Projetos/root_os/.git/refs/heads/pedromagnago/`.
- `~/Library/Projetos/.stignore` não existe; o `.stignore` de `root_os` não ignora `.git` (decisão N-9 ainda pendente, `docs/DEPLOY.md §1`).
- Este worktree (`~/orca/workspaces/root_os/volute`) está FORA da pasta sincronizada: editar arquivos aqui não sincroniza nada.
**O que um commit faz:** grava objetos e move `refs/heads/pedromagnago/varredura-pendencias-claude` dentro de `~/Library/Projetos/root_os/.git`, que sincroniza. Não altera working tree remota em `main`. Risco residual: conflito de arquivo em `.git` no remoto, ou remoto com esta branch em checkout — não consigo confirmar daqui.
**Opções:** (a) commitar aqui e registrar; (b) clonar esta branch em `~/orca/workspaces/root_os/madrugada/` (fora do Syncthing), commitar lá, e no fim trazer os commits para cá com `git fetch` de caminho local (fast-forward, sem push); (c) não commitar; entregar diff.
**Recomendação:** (b). Zero risco de sincronização; os commits chegam aqui no fechamento por fetch local.
**Bloqueia:** só os commits de E1/E2. Edição e testes seguem.
**Enquanto aguardo:** E1 (correções P0 com teste antes/depois, sem commit). Se não houver resposta até o primeiro portão de E1 verde, adoto (b) e registro.

## Q-003 · 02:06 -03 · E3 · Destino da VPS e manifesto — `AGUARDA_PEDRO`
- **Pergunta:** o destino remoto é a VPS ROOT (`2.25.223.180`)? Há produção instalada lá hoje (o `PLANO-PRODUTO.md` diz "desde 17/09"; o `~/CLAUDE.md` de 16/09 diz "nada rodando")?
- **Evidência:** nenhum acesso remoto foi feito nesta janela (regra: só com destino confirmado). `MANIFESTO-VPS.md` preenchido como rascunho com o que o ensaio local prova; os campos de inventário estão marcados `pendente (inventário)`.
- **Alternativas:** (a) Pedro confirma destino → faço só o inventário somente leitura e completo o manifesto; (b) Pedro aprova o manifesto por escrito → repito E2 na homologação remota, sem ensaio de falha na produção; (c) nada → a validação fica local ("VPS NÃO validada").
- **O que bloqueia:** E3 remoto. Não bloqueia E4.
- **Lacuna que só o Pedro resolve:** as tags do ensaio existem só no clone local; a VPS precisaria de push (não autorizado) ou de transporte por `git bundle` (sem push). Recomendo (b)-bundle para a homologação e push só quando P1 for aceito.

## Q-004 · 02:06 -03 · E4 · Desmonte da instância local do ensaio — `AGUARDA_PEDRO` (não bloqueante)
- **Pergunta:** derrubo a instância `rootos-homologacao` do Mac (5 containers, 3 volumes, 1 rede, 2 imagens, ~5 GB) ou deixo de pé para inspeção pela manhã?
- **Evidência:** tudo foi criado por mim (diff de inventário em `evidencias-e2/inventario-docker.diff.txt`); nada preexistente foi tocado; Docker com folga (67 GB em imagens no total, sem pressão).
- **Decisão tomada por padrão:** **deixo de pé** e desligada de qualquer rede pública (loopback), com o comando exato de desmonte no `RELATORIO-CLAUDE.md`. Deixar de pé é reversível; derrubar apaga a prova viva.

## Respostas do Pedro (17/09, 09:51 -03, pela sessão do Claude — não pelo RESPOSTAS.md)
- **Q-001 → OBRIGATÓRIO.** O conector MCP para o Claude Code do cliente é entregável do produto. Consequência: entra na etapa A2 do `docs/PLANO-PRODUTO.md` com teste próprio na CI (`packages/mcp`) — o plano é editado pelo Codex; fica aqui como decisão a refletir lá.
- **Q-002 → fetch local.** Feito às 09:52: conferência byte a byte das cópias, `git fetch` de caminho local, `merge --ff-only`. Worktree em `72e32d3`, 0 pendências. Sem push. O clone `~/orca/workspaces/root_os/madrugada` fica como espelho (tags do ensaio só lá).
- **Q-003 → só inventário somente leitura.** Feito às 09:51 (`evidencias-e3/inventario-vps-root.txt`); manifesto atualizado com o medido. Instalação remota segue **não aprovada**.
- **Q-004 → deixar de pé.** A instância local `rootos-homologacao` continua no Mac para inspeção (`http://127.0.0.1:4100`, `http://127.0.0.1:4101/api/health/versao`).

## Q-005 · 09:55 -03 · E3 · Homologação na VPS × regra "tudo dentro do easyPanel" — `AGUARDA_PEDRO`
- **Pergunta:** a homologação na VPS ROOT deve nascer como serviço Compose do easyPanel (projeto `root`) ou pode ser exceção fora do painel, escrita?
- **Evidência:** a produção lá foi adotada pelo painel (`root_marketing-os`, volumes `external` com nome fixo); o `deploy/instalar.sh` sobe por `docker compose -p rootos-homologacao` direto, sem painel.
- **Alternativas:** (a) adicionar ao instalador um modo que gera o stack (compose + override + `.env`) para o painel adotar, sem subir nada — mais trabalho, coerente com a regra; (b) exceção escrita para homologação; (c) manter só local.
- **Recomendação:** (a), antes de qualquer instalação remota — é também o que uma instância por cliente vai precisar quando o cliente usar painel.

## Q-005 — resposta (17/09, 10:40 -03): Pedro disse "podemos seguir" → implementada a alternativa (a)
- `--painel <projeto>/<serviço>` no instalador; geração fail-closed do compose do painel; lembrete no atualizador e no `--voltar`. Ver `docs/INSTALACAO.md` § easyPanel. A instalação remota continua dependendo de aprovação do manifesto.

## Q-006 · 12:45 -03 · E3 · `root-os-landing` removido às 15:41:40 UTC — `AGUARDA_PEDRO` (informativo)
- **Fato:** container `root-os-landing` e rede `root-os-landing_default` destruídos com padrão de `docker compose down`; ao mesmo tempo apareceu `/etc/easypanel/projects/root/landing`. Nenhum comando do ensaio toca no landing (0 ocorrências nos logs; naquele minuto eu só lia `docker ps`/`curl`).
- **Pergunta:** foi você migrando a landing para o painel? Se não, a landing pública está fora do ar e precisa de olho.
