---
dublê: true
---
# Vault-dublê da Equipe (produção 22B, I6)

Notas fictícias com a MESMA estrutura das notas da Governança e da Organização do
vault da Root: a tabela de sócios, a nota de cada sócio com "## Dono das funções",
a matriz quem-faz-o-quê e as fichas de função com `dono:` no frontmatter.

Os sócios do dublê são Alice, Bruno e Clara. Nenhum nome real.

Na homologação: copiar o conteúdo desta pasta para a raiz do volume
`rootos_final_vault` (montado em `/vault`), reindexar o vault e preencher o
"Nome no vault" de três pessoas da casa com Alice, Bruno e Clara no `/perfil`.
A suíte `apps/api/test/equipe-atribuicoes.test.ts` lê estes mesmos arquivos.

A reindexação recusa vault sem rastreamento (503, "rastreamento não verificável"): o volume precisa de um `.git` com um commit destes mesmos arquivos (`git init`, `git -c core.autocrlf=false add .`, `git commit`). O `homolog/e2e/producao22b.mjs` faz isso sozinho no container da stack do seed, só num vault marcado `dublê: true`.
