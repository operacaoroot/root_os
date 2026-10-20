# Suítes da versão final (F1) · 19/10/2026

> Medido sobre `homolog/final-20261019` em 95f747c, num worktree próprio, e depois do conserto
> (1cefd89). Windows desta máquina, Postgres da homologação em 127.0.0.1:5440, bancos
> descartáveis criados para esta medição: `rootos_final_test` (API), `rootos_final_test_rls`
> (isolamento, com o papel `mktos_app` cuja senha já estava no `.env.homolog`; a senha não foi
> trocada) e `rootos_baselucas_test` (linha de base). Migrations e `db:seed:politica` aplicados
> antes de cada suíte. Sem dado de cliente.

## 1. A linha de base foi refeita, e a antiga estava baixa

A linha de base da rodada anterior (236 vermelhos, `../base-lucas`, banco `base_lucas_test`)
**não valia**: o `../base-lucas` não tem `packages/policy/dist`, então todo arquivo que importa
`@mktos/policy` (porta, runtime, cofre, lotes, estado-do-agente, resposta-sem-fonte e outros)
caía na carga e contava **um** vermelho só, em vez dos casos que ele tem. O `db:seed:politica`
nem roda ali (`MODULE_NOT_FOUND @mktos/policy`).

A linha de base nova é uma cópia limpa de `lucas/tarefas` (abd1476, que contém o snapshot do
Pedro) por `git archive`, fora do repositório (`C:\Users\User\dev\final-suites-base-prod`), com
`pnpm install`, `prisma generate` e `shared`/`policy` construídos, rodada contra um banco
descartável recém-migrado e com a política semeada. O `../base-lucas` não foi tocado.

Cuidado registrado: a primeira cópia ficou dentro do worktree (`homolog/.tmp/`) e a catraca
`arquitetura.test.ts` passou a ler o código dela (7 vermelhos falsos numa execução avulsa).
A cópia foi movida para fora antes das medições "depois"; a medição "antes" já estava fechada.

## 2. Placar

| Suíte | Produção (abd1476) | Final antes (95f747c) | Final depois (1cefd89) |
|---|---|---|---|
| Política (`packages/policy`) | n/m | 101 / 101 | 101 / 101 |
| Web (vitest) | 1103 casos: 1027 verdes, **76** vermelhos, 0 pulados (9 arquivos) | 1390: 1310 verdes, **80** vermelhos, 0 pulados (12 arquivos) | 1390: 1313 verdes, **77** vermelhos, 0 pulados (9 arquivos) |
| API (vitest, conjunto padrão) | 4250: 3918 verdes, **297** vermelhos, 35 pulados (42 arquivos) | 4754: 4420 verdes, **299** vermelhos, 35 pulados (43 arquivos) | 4754: 4428 verdes, **269** vermelhos, 57 pulados (38 arquivos) |
| Isolamento (`test:isolamento`, papel restrito) | n/m | 498 / 498 | 498 / 498 |
| Rotas públicas com RLS (`RLS_NO_TESTE=1`) | n/m | 56 / 56 | 56 / 56 |
| Cofre com RLS (`RLS_NO_TESTE=1`) | n/m | 95 / 97 | 97 / 97 |

Linha de base antiga, para comparação: 236 vermelhos em 3390 casos (ver §1: estava baixa).

Leitura do "antes" para o "depois" na API (−30):
- **−1 por conserto** (§3): `pauta-episodio`.
- **−9 por carga da máquina**: tempo esgotado de 5 s (`STACK_TRACE_ERROR` do vitest) em
  `import-clickup-arvore` (4), `work-estrutura-sugerida` (1), `work-quadro-movimento` (1),
  `onboarding-trilho-e2e` (1), `contrato-de-conector` (1) e `adversarial` (1). Todos passam
  sozinhos e passaram na execução "depois". A versão final tem 48 arquivos a mais que a produção
  (179 contra 131) correndo em paralelo; nenhum deles é vermelho de comportamento.
- **−20 +1 em `vault-colecao`**: na primeira passada o arquivo dá os mesmos 20 vermelhos da
  produção; na segunda, a guarda do próprio teste recusa o banco reaproveitado ("a empresa root
  deste banco tem 2 linhas que não são desta suíte") e o arquivo inteiro vira 1 vermelho de
  carga com 22 pulados. Mesmo motivo do `obsidian-reindex-tenant`, que já é assim na produção.
  Os 22 pulados a mais do "depois" são esses.

Na web (−3): os vermelhos de `comercial-fechado-fora`, `contexto-marca` e
`trabalho-arquivamento-versionado` eram tempo esgotado sob carga; passam sozinhos e passaram no
"depois". O cofre com RLS: os 2 do "antes" eram um tempo esgotado de 5 s e o controle negativo
logo depois dele; 97/97 sozinho.

**Nenhum vermelho veio da política de conflito.** Todo arquivo de teste da produção existe na
versão final (218 de 218). Os que a versão final carrega com mudança (`caixa`, `menu`, `nav`,
`menu-root`, `navegacao-modulos`, `painel-kpi-tarefas`, `orientacao-legados`, `atendimento`,
`pauta-lote-da-semana`, `trabalho-*` na web; `caixa`, `checkout-de-tarefa`,
`modulos-por-tenant`, `fila-de-aprovacao`, `conector-desligado`, `tenant-isolation`,
`work-campo-moeda`, `adversarial`, `arquitetura` e outros na API; `politica` e `sobrescrita` na
política) estão **verdes**, com as decisões em `conflitos.md` e `enxugamento.md`. Os vermelhos
de `adversarial` e `pauta-lote-da-semana` que restam são os mesmos casos da produção.

A versão final é **mais verde** que a produção em 8 casos que a produção tem vermelhos e nós
não: `checkout-de-tarefa` (2), `modulos-por-tenant` (2), `pauta-dm-automatica` (1),
`pauta-publicacao-instagram` (1), `documentacao` (1), `adversarial` (1).

## 3. O que foi consertado

| Commit | Arquivo vermelho | Classe | O que era |
|---|---|---|---|
| 1cefd89 | `apps/api/test/pauta-episodio.test.ts` (MD2: `statusDesde`) | (c) | O `prisma format` da rodada da implantação (7321943) realinhou o bloco do `PautaEpisodio` no `schema.prisma`, e o teste do Pedro confere o texto `statusDesde DateTime @default(now())` com espaço simples. Conserto no código: o bloco voltou ao alinhamento da produção (só espaço; modelo idêntico, `prisma validate` ok). Era o `pauta-episodio` que as rodadas anteriores registravam como linha de base; não era. |

## 4. Vermelhos que restam (todos (a): vermelhos na produção, com o mesmo código e o mesmo teste)

Na comparação caso a caso (nome do teste) entre a final "depois" e a produção, **nenhum caso é
vermelho só na final**, com duas ressalvas medidas: `vault-colecao` (carga, ver §2) e
`agentes-estado` na web (abaixo). Classes: (a) já vermelho na produção; (b) efeito declarado da
política de conflito; (c) defeito nosso.

### API (269)

| Arquivo | Final · Produção | Classe | Motivo |
|---|---|---|---|
| `import-clickup-reconciliar` | 48 · 48 | (a) | Windows: o manifesto exige diretório `chmod 700`. |
| `import-clickup-normalize` | 12 · 12 | (a) | Windows: modo de arquivo e hash da captura privada. |
| `import-clickup-work` | 1 · 1 | (a) | Windows: conferência de arquivo regular/modo antes do apply. |
| `root-midia` | 5 · 5 | (a) | Windows: link simbólico (EPERM) e separador de caminho `\`. |
| `documentacao` | 2 · 3 | (a) | Windows: link simbólico (EPERM). |
| `vault-pertenca` | 1 · 1 | (a) | Windows: link simbólico (EPERM). |
| `memoria` | 32 · 32 | (a) | Pedro: guarda de acesso atual (`exigirAcessoAtual`, "Acesso insuficiente") sem a pessoa no dublê; faxina barrada pelo gatilho de imutabilidade do `ContextItem`. |
| `memory-vetor-concorrencia` | 13 · 13 | (a) | Pedro: mesma guarda de acesso atual. |
| `embeddings-resiliencia` | 15 · 15 | (a) | Pedro: guarda do índice protegido (`identidadeHttpDoIndice`) e da leitura atual. |
| `embeddings-base-url` | 1 · 1 | (a) | Pedro: a projeção da vault não entrega a nota nova no dublê. |
| `root21-vault-versionada` | 9 · 9 | (a) | Pedro: guarda do índice protegido. |
| `contexto-trabalho` | 10 · 10 | (a) | Pedro: faxina barrada pelo gatilho de imutabilidade + guardas de acesso. |
| `contexto-p05d` | 9 · 9 | (a) | Pedro: o dublê do banco não tem `$queryRawUnsafe`. |
| `catalogo-de-colecao` | 3 · 3 | (a) | Pedro: o dublê não tem `$transaction`. |
| `release-p2-regressions` | 2 · 2 | (a) | Pedro: o dublê não tem `$transaction` (reindexar). |
| `contrato-de-conector` | 7 · 7 | (a) | Pedro: `exigirAcessoAtual` lê usuário que o dublê não tem. |
| `adversarial` | 19 · 20 | (a) | Pedro: o dublê do Obsidian não tem `buscarIndiceInternoSemSolicitante`, que o `ContextBuilder` chama. |
| `resposta-sem-fonte` | 10 · 10 | (a) | Pedro: o mesmo método ausente no dublê. |
| `estado-do-agente` | 13 · 13 | (a) | Pedro: `ZodError` no corpo das transições do agente. |
| `runtime` | 2 · 2 | (a) | Pedro: `SessionService.lerAutorizado` com acesso atual. |
| `arquitetura` | 1 · 1 | (a) | Pedro: `src/obsidian/contexto-movimento-explicito.service.ts` importa o `ObsidianService` fora da porta (catraca RF-G-01). Mesma violação na produção. |
| `pauta-voz`, `pauta-relatorio`, `pauta-performance`, `pauta-estrategia`, `pauta-concorrentes` | 11, 7, 5, 3, 2 · iguais | (a) | Pedro: `identidadeHumana`/`identidadeDaRotina` ("Acesso insuficiente"). |
| `pauta-agenda` | 1 · 1 | (a) | Pedro: a rota da grade passou a pedir `obsidian.ver` e o teste espera só `pauta.ver`. |
| `onboarding` | 3 · 3 | (a) | Pedro: guarda de acesso atual e retrato da memória. |
| `provisionamento` | 2 · 2 | (a) | Pedro: estado `nao_conferido` e `SemTenantError` no lugar do erro de plataforma. |
| `finance-contrato-e-empresa` | 4 · 4 | (a) | Pedro: guarda de acesso atual e projeção do contrato. |
| `comercial-exercicio` | 16 · 16 | (a) | Pedro/Lucas: o exercício só existe com `ROOTOS_QA_PREVIEW=1`. Com a variável, a versão final dá **19/19** (medido). |
| `financeiro-exercicio`, `m05-atualizacao-atomica`, `m05-fonte-canonica`, `m05-procedimento-recuperacao`, `work-atividade-versionada` | carga · carga | (a) | Pedro: exigem o clone QA local e a porta autorizada ("F08 exige clone descartável", "M05 author destination required", "M02 exige o clone QA local na porta 55582"). |
| `obsidian-reindex-tenant` | carga · carga | (a) | A guarda do teste recusa banco com a empresa `root` povoada por outra suíte. |
| `vault-colecao` | carga · 20 | (a) | Mesma guarda no banco reaproveitado; em banco novo, os mesmos 20 da produção (faxina barrada pelo gatilho de imutabilidade). |

### Web (77)

| Arquivo | Final · Produção | Classe | Motivo |
|---|---|---|---|
| `agentes-fonte-autorizada` | 19 · 19 | (a) | Pedro: a tela não mostra "Modelo disponível: …" nem o resultado privado com a API simulada. |
| `pauta-voz` | 13 · 13 | (a) | Pedro: os botões "Editar à mão" e "Aprender a voz" não aparecem com a API simulada. |
| `conexoes` | 12 · 12 | (a) | Pedro: o texto "o hub de conectores" saiu da tela. |
| `agentes-estado` | 10 · 9 | (a) | Pedro, intermitente: a página (`apps/web/src/app/agentes`) e o teste são idênticos aos da produção; o conjunto de casos vermelhos varia de 9 a 11 de uma execução para outra **também na produção** (medido: 11 numa execução avulsa da produção). O caso "AGENTE ENCERRADO NÃO GANHA BOTÃO" passou no "antes" e caiu no "depois". |
| `agentes-procedimento-local` | 9 · 9 | (a) | Pedro: opção "nota" ausente no seletor; modelo local não exibido. |
| `pauta-agenda` | 4 · 4 | (a) | Pedro: rótulo "Texto da grade" e contagem de chamadas. |
| `pauta-lote-da-semana` | 4 · 4 | (a) | Pedro: `toHaveTextContent` do cartão do lote. A versão final carrega a adaptação da P4 ("Assinar como titular", item que nasce fechado), e os 4 vermelhos são os mesmos casos da produção. |
| `financeiro-gerar-contrato` | 3 · 3 | (a) | Pedro: texto "Aluguel" duplicado na tela. |
| `financeiro-obrigacao` | 3 · 3 | (a) | Pedro: texto do contrato privado duplicado na tela. |

## 5. Como repetir

Scripts em `homolog/.tmp/` (ignorado pelo git; leem as URLs do `.env.homolog` na hora, nada
copiado): `deploy.sh <banco>`, `api-suite.sh <rótulo> [arquivos]`, `web.sh`, `web-policy.sh`,
`iso-suite.sh`, `base.sh deploy|run`, `base-web.sh`; `falhas.cjs` e `motivos.cjs` leem o resumo
JSON do vitest. A cópia da produção em `C:\Users\User\dev\final-suites-base-prod` teve os
`node_modules` montados no lugar antigo: para usá-la de novo, `pnpm install` nela primeiro.
