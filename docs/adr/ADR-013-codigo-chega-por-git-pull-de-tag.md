# ADR-013 · O código chega na VPS por `git pull` de tag (fecha a N-9)

- **Data:** 16/09/2026
- **Situação:** **aceita** em 17/09/2026 — o Pedro decidiu seguir a recomendação ("siga conforme as boas práticas e sua recomendação"). Proposta em 16/09 (etapa P0 de `docs/PLANO-PRODUTO.md`)
- **Origem da pergunta:** `docs/DEPLOY.md §1` e a decisão N-9 de `docs/PLANO-CONTINUIDADE.md`,
  aberta desde 10/09/2026.

## Contexto

Hoje o código chega na VPS por Syncthing, sincronizando o repositório inteiro — inclusive `.git` —
entre o Mac e `/srv/marketing-os`. Não existe `git pull`, rsync nem pipeline. Duas consequências que
já custaram produção: trocar de branch no Mac altera o working tree da VPS; e o servidor não tem
versão identificável.

O produto decidido (base na VPS **do cliente**, instalada pelo GitHub e atualizada sem sobrescrever)
torna isso insustentável: N instâncias não podem depender do Mac de uma pessoa.

## Decisão

**`git pull` de uma tag, na VPS.** `/srv/root-os` vira um clone; `deploy/instalar.sh` faz o primeiro
`git clone` e `deploy/atualizar.sh` faz `git fetch && git checkout <tag>` antes de construir. O
`.stignore` passa a ignorar `.git` **no mesmo commit** — não antes, ou o servidor congela na última
versão que recebeu.

Rejeitado: rsync no `deploy/up.sh`. Não exige credencial na VPS, mas continua dependendo da máquina de
quem faz o deploy e não deixa versão registrada no servidor — que é exatamente o que "atualizar N
instâncias" precisa.

## Consequências

- Exige credencial de **leitura** do repositório fechado em cada VPS (deploy key por instância, só
  leitura, revogável). ADR-006 (núcleo fechado no V1) continua valendo.
- `GET /health/versao` passa a responder a tag, a última migration e a versão da política. "Atualizar N
  instâncias" começa em "saber quais são".
- Rollback de código vira `checkout` da tag anterior + `up -d --no-build`. Rollback de migration
  continua não existindo — só backup.
- Até este ADR ser aceito e executado: **nenhum `git checkout` de branch no Mac com o Syncthing ligado.**
