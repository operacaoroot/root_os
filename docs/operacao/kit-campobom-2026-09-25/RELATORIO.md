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
