# RELATÓRIO — Root OS base para a Campo Bom

Data: 25/09/2026 · Branch: `root-os/kit-instalacao-mac` · Base: `98d8ed4` (origin/main)

## Escopo
Instalar o Root OS **base**, sem personalização da Campo Bom. O que for específico do cliente fica para o segundo passo.

## Decisões registradas pelo roteiro desta fase

| Decisão | Estado |
|---|---|
| Alvo: Mac da Campo Bom | **Em conflito** com o pedido do Pedro ("contêiner separado na VPS da Root"). O pedido prevalece até resposta em Q-003. |
| Runtime: Colima | Só vale se o alvo for o Mac (Q-003). Na VPS ROOT o runtime é o Docker Swarm do easyPanel. |
| Bind 127.0.0.1 | Vale nos dois alvos para banco e API interna. Na VPS a entrada pública é só pelo Traefik do easyPanel. |
| Todos os módulos habilitados | Registrado. |
| `--sem-llm` (instalação sem chave de LLM) | Registrado. Nenhuma chave entra no kit. |
| Entrega por pasta no Drive | Registrado; pasta de destino não existe e depende de autorização (Q-002). |

## Linha de base (fase 0)
- Typecheck da api: exit 0, 0 erros (depois de gerar o Prisma Client e buildar `@mktos/shared` e `@mktos/policy`).
- Typecheck dos testes da api: exit 0, 0 erros.
- Teste de deploy de instância: **não existe na base** (Q-001). O instalador por cliente (`deploy/instalar.sh`, `atualizar.sh`, `lib-instancia.sh`) está só na branch `pedromagnago/integra`.

## Não provado
- Deploy de instância (sem teste na base).
- Suíte completa da api (precisa de banco de teste descartável).
- Build da web e da imagem Docker.
- Qualquer coisa na VPS ROOT (fora do escopo desta fase).

## Atualização 25/09/2026 — base definida e linha de base refeita

Decisões do Pedro (DUVIDAS.md, respostas de Q-001 a Q-003): base `98d8ed4` + merge da tag `v0.4.1`; pasta do kit no Drive autorizada; alvo = **Mac da Campo Bom com Colima, bind 127.0.0.1**, nada na VPS. Com isso, a linha "Alvo" da tabela de decisões acima deixa de estar em conflito.

Merge `eba198b` (`--no-ff v0.4.1`): exit 0, 0 conflitos, 15 commits, 78 arquivos. Nenhuma dependência nova (lockfile igual).

| Verificação | Comando | Exit | Contagem |
|---|---|---|---|
| Teste de deploy de instância | `pnpm --filter @mktos/api exec vitest run test/deploy-instancia.test.ts` | 0 | 1 arquivo · 34 passados · 0 falhas · 0 pulados · 53,6 s |
| Typecheck da api | `pnpm --filter @mktos/api typecheck` | 0 | 0 erros |
| Typecheck dos testes da api | `pnpm --filter @mktos/api typecheck:test` | 0 | 0 erros · 57 entradas em `apps/api/test/` |

### Não provado (atualizado)
- Suíte completa da api (precisa de banco de teste descartável).
- Instalação num Colima real: o teste de deploy usa stubs de `docker` e `curl`.
- Build da web e da imagem Docker.
