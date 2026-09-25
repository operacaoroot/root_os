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

## Respostas (25/09/2026, plano aprovado pelo Pedro)

- **Q-001 → base = `98d8ed4` + merge da tag `v0.4.1`.** A branch parte da produção e recebe, por `git merge --no-ff v0.4.1`, o instalador homologado na VPS em 17/09/2026. `git merge-tree --write-tree HEAD v0.4.1` → exit 0 (merge limpo). O WIP sem aceite da integra (`70c1059` em diante) **não entra**: `git merge-base --is-ancestor 70c1059 v0.4.1` → exit 1. Nota de procedência: a tag `v0.4.1` aponta para `0b5cf62` ("Liga o web na rede do easyPanel quando a instância é do painel", 17/09/2026 16:24), um commit depois de `d7ac2f6` ("Registra a validação humana da homologação na VPS"), que é ancestral da tag. O merge traz os 15 commits de `98d8ed4..v0.4.1`.
- **Q-002 → autorizado.** Criar `Meu Drive/OPERACAO ROOT/clientes/campo-bom/kit-rootos-v0.4.2/` foi autorizado pelo Pedro no plano aprovado em 25/09/2026. Escrita só dentro dessa pasta.
- **Q-003 → alvo = (b) Mac da Campo Bom com Colima, bind 127.0.0.1.** Nada na VPS. O pedido de VPS foi substituído pelo Pedro.

## Q-004 · 25/09/2026 · BLOQUEIA só o "tudo exit 0" do `pnpm test` (o resto segue)

**Fato:** a própria base de produção `98d8ed4` sai vermelha em `pnpm test` neste Mac, por dois motivos que não vêm do kit. Medido num clone limpo em `98d8ed4` (scratchpad), banco descartável `ckit_base_padrao_test`, `db:deploy` + `db:seed:politica` antes:

1. `packages/policy/test/politica.test.ts` › "cobre as 35 ferramentas MCP, todas em R0": `expected … to have a length of 35 but got 36`. O PR #11 (`b2e0119`, 24/09) pôs `comunicacao.agenda.periodo` (R0) no catálogo sem subir a contagem. A correção existe e é só de teste (2 linhas): `c9f5784` ("O catálogo do marketing-os tem 36 leituras MCP com a agenda", Pedro, 25/09 10:23), mas mora na integra DEPOIS de `70c1059`, que a resposta de Q-001 manda deixar de fora. `origin/main` ainda diz 35.
2. `apps/api/test/rotas-publicas-tenant.test.ts`: os 38 casos passam, e o `afterAll` morre em `AuditLog_orgId_fkey` ao apagar a org padrão que ele mesmo criou (outro arquivo, em paralelo, grava AuditLog nela). Sozinho o arquivo passa (38/38, exit 0). Vermelho nas duas rodadas completas medidas (base e kit), então não é acaso neste Mac.

**Pergunta:** para o `pnpm test` do kit sair exit 0:
- (a) cherry-pick `-x` de `c9f5784` (só teste) no kit, como exceção registrada a Q-001; e o item 2 vira tarefa à parte na main (corrigir a limpeza do teste), com o kit declarando o vermelho como herdado;
- (b) nada entra; o kit declara os dois vermelhos como herdados da produção (mesma contagem de casos da linha de base ou mais);
- (c) outra.

Enquanto não houver resposta: nenhum teste de produto foi mudado. As outras frentes (tag, bundle, ensaio) seguem, porque não dependem desses dois arquivos; a tag é local e se refaz se a resposta mudar o HEAD.

**Q-004, fato 3 (medido depois):** o `pnpm test` literal da raiz é `turbo run test`, e o turbo 2.10.4 roda em modo de ambiente estrito: `TEST_DATABASE_URL` não chega aos pacotes. Com `-- --continue`, a api sai com **566 casos pulados e 5 arquivos pulados** (1.354 passados, 1 falha por timeout de 5 s em `rotinas.test.ts`). Com `--env-mode=loose` os 1.921 rodam, mas os três pacotes em paralelo estouram o timeout de 5 s em um caso da api (`rotinas`) e um do web (`trabalho-esteira`). A CI não usa o turbo para testar: roda `pnpm --filter @mktos/<pacote> test` pacote a pacote, com resumo JSON e piso. É essa a forma que o RELATORIO conta. Nenhum timeout foi aumentado.
