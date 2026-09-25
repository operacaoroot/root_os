# DÚVIDAS — kit Root OS Campo Bom

Formato: Q-00x · data · frente bloqueada · pergunta · opções. Frente bloqueada fica parada até resposta do Pedro.

## Q-001 · 25/09/2026 · BLOQUEIA a frente "deploy/instalação"

**Fato:** a base `98d8ed4` (origin/main) não tem o ferramental de instalação por cliente. Faltam `apps/api/test/deploy-instancia.test.ts`, `deploy/instalar.sh`, `deploy/atualizar.sh`, `deploy/lib-instancia.sh`, `deploy/test-stubs/` e `docs/INSTALACAO.md`. Tudo isso entrou no commit `409fbf3` (17/09/2026, "Prepara instalação segura por cliente") e seguintes (`8c4ce0a`, `61ff10b`, `0b5cf62`, `a98b8d3` de 18/09/2026), que só existem em `pedromagnago/integra` e `pedromagnago/varredura-pendencias-claude`. A integra está 70 commits à frente de `98d8ed4` e 0 atrás.

**Evidência:** `vitest run test/deploy-instancia.test.ts` → exit 1, "No test files found"; `git merge-base --is-ancestor 409fbf3 98d8ed4` → exit 1.

**Pergunta:** qual base o kit deve usar?
- (a) Recriar o worktree a partir da ponta de `origin/pedromagnago/integra` (traz os 70 commits, inclusive o que ainda não foi para main).
- (b) Manter `98d8ed4` e trazer só os commits de instalação por cherry-pick (409fbf3 → a98b8d3), com risco de conflito com o que a integra mudou em volta.
- (c) Manter `98d8ed4` e escrever o instalador do zero (retrabalho; não recomendado).

## Q-002 · 25/09/2026 · BLOQUEIA a frente "entrega por pasta no Drive"

**Fato:** a pasta `Meu Drive/OPERACAO ROOT/clientes/campo-bom/kit-rootos-v0.4.2` não existe; nem `OPERACAO ROOT/clientes/` existe. `OPERACAO ROOT` é pasta de negócio e a constituição proíbe escrita sem autorização explícita.

**Pergunta:** autoriza criar `OPERACAO ROOT/clientes/campo-bom/kit-rootos-v0.4.2/`? Ou prefere outro caminho?

## Q-003 · 25/09/2026 · BLOQUEIA a decisão de alvo (afeta todas as fases depois da 0)

**Fato:** o pedido do Pedro é o Root OS da Campo Bom "rodar em um contêiner separado na VPS da Root". O roteiro desta fase lista como decisões "Mac da Campo Bom, Colima, bind 127.0.0.1" e o nome da branch é `kit-instalacao-mac`. As duas coisas são alvos diferentes: instalar num Mac do cliente (Colima como runtime Docker, porta só local) não é o mesmo que publicar na VPS ROOT (2.25.223.180, easyPanel + Traefik + Swarm, com domínio e TLS).

**Pergunta:** o alvo é
- (a) VPS ROOT, serviço/stack próprio no easyPanel (ex.: projeto `campobom`), banco isolado, subdomínio próprio — é o que o pedido diz e o que este relatório assume;
- (b) Mac da Campo Bom com Colima, entregue como kit por pasta;
- (c) os dois: VPS como produção e kit Mac como contingência/local.

Enquanto não houver resposta, a fase 0 segue neutra (vale para qualquer alvo) e nenhuma ação na VPS é feita.
