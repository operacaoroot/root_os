# ROOT OS — execução conduzida pelo Luna, 19/09/2026

Estado: **EM EXECUÇÃO — E2a/E2b revisadas localmente; E2c autorizada ao Luna**.
Pedido: Pedro quer um plano que o modelo Luna execute, não uma lista de prompts
para ele repassar manualmente. Meta temporal: avançar até o aceite do projeto
hoje, sem prometer concluir etapas que ainda não foram implementadas ou aceitas.

## Papéis e mecanismo real

- Executor: subagente **`/root/luna_executor`**, modelo **`gpt-5.6-luna`**, esforço
  `high`, criado nesta sessão a pedido explícito do Pedro. Único escritor de código.
- Coordenador: esta sessão; escreve o plano/registro, revisa diffs e evidências,
  envia as tarefas e esclarece dúvidas do Luna. Não implementa código em paralelo.
- Apoio pontual: `/root/luna_revisao_coletor`, também `gpt-5.6-luna`, esforço
  `medium`, somente leitura. Preparou recorte P3 e revisou caminhos de memória
  enquanto o executor implementava E2b. Não altera arquivos nem cria recursos.
- Pedro: aprova fronteiras remotas, uso de dados/provedores e participa dos aceites
  que precisam de usuário real. O cliente/terceiro executa o aceite independente.
- Cada tarefa termina com diff, testes, riscos e próximo passo. O coordenador
  fornece o próximo trabalho ao Luna sem exigir que Pedro copie prompts.
- Luna não foi configurado como daemon ou monitor fora da sessão. O modelo desta
  conversa principal não foi alterado. Uma interrupção precisa retomar deste
  arquivo e dos registros, sem fingir que houve execução durante a pausa.

Usamos orquestração por checkpoints e revisão de menor privilégio. Para economizar:
um executor Luna, contexto por tarefa, testes focados durante implementação e
regressão completa nos marcos; não reconstruir imagens a cada ajuste documental.
Decisões de autorização, RLS e recuperação sempre passam pela revisão do coordenador.

## Base que não deve ser refeita

G0 fechado em `a98b8d3`, tag local `retomada-rls-g0-20260918`, imagem Linux/amd64
validada; 41 migrations reconciliadas. Fonte de identidade/hashes:
`../retomada-2026-09-18/CANDIDATO-G0.md`. Pacote local verificado como presente
em 19/09 às 16:08 -03: `/tmp/rootos-release-g0-20260918.pkHwDy/`.
O checksum deve ser revalidado antes de qualquer transporte futuro.

Não misturar a validação local com ativação remota: homologação estava em v5,
com conexão dona e `observar`. O ensaio remoto aprovado ontem foi descartável,
com a imagem anterior, não autorização permanente de deploy.

## Sequência de execuções

| Ordem | Trabalho do Luna | Saída verificável / portão |
| --- | --- | --- |
| E0 | Ler instruções/estado, conferir árvore e identificar lacunas reais de P2/P3 | mapa de arquivos/testes e tarefa seguinte delimitada; preservar alterações alheias |
| E1 | G1: inventariar painel/rota da homologação por leitura | dono efetivo da configuração, domínio, rede, fonte de env; preencher manifesto ou registrar o dado que falta |
| E2a | Identidade individual do agente: token opaco, hash, escopo mínimo, revogação, empresa/usuário ativos | testes de emissão, autorização, expiração/revogação, isolamento; nenhuma elevação pelo token |
| E2b | Contexto da empresa e fronteira de dados do ADR-015 | memória por tenant, fontes/campos autorizados, procedência, fallback textual; negar dados sem consentimento aplicável |
| E2c | MCP existente integrado com essa identidade/contexto e painel mínimo | `memoria_buscar`/`memoria_ler`, emissão/revogação pelo usuário autorizado, instrução curta de onboarding; CI e prova compilada |
| E3a | Recepção mínima de uma pasta/arquivo | pareamento, pulso, remessa/lotes/fim, limites, revisão/hash, idempotência, rastreabilidade, frescor, revogação |
| E3b | Conector local integrado à recepção | seleção/prévia/consentimento, envio só de arquivos autorizados, interrupção/reenvio sem duplicação; não enviar raiz absoluta ou credenciais |
| E4 | Molde de uma ferramenta, sem catálogo genérico | prefixo, autorização, tabela com RLS, testes, capacidade classificada; customizações fora do núcleo e execução isolada de produção |
| E5 | Segunda ferramenta e prova de preservação | primeira continua funcionando; atualização preserva dados/env/ferramentas; backup restaurado em ambiente isolado |
| E6 | Release integrada local | regressões API/web/policy/MCP/conector, tipos, migrations do zero/upgrade, teste HTTP do artefato e recuperação; hashes/relatório |
| E7 | Homologação real, somente após manifesto e autorização | backup/restore, troca restrita de API/web, RLS real, saúde/identidade e acesso humano; produção intocada |
| E8 | Aceite final com pessoa no papel do cliente | instalar/conectar fonte/criar duas ferramentas sem Pedro executar por ela; registrar intervenções e pendências, não simular aceite humano |

E1 pode encontrar um portão remoto sem bloquear E2–E6 **locais**. A homologação
não será recriada repetidamente para cada fatia: consolidar uma release quando
os testes locais estiverem verdes. Se E2+ acrescentar schema, o manifesto G0
antigo não cobre o novo artefato: refazer análise de compatibilidade/recuperação.

P6 (SQL) não entra por pressa: engine/autenticação e máquina do piloto precisam
ser confirmadas. Não acrescentar monitor de agentes, catálogo genérico, orquestrador
próprio, outros MCPs ou automações sem caso de uso. O pulso do conector definido
no contrato P3 permanece necessário para revogação. Trilho M permanece separado; risco de
segurança encontrado no caminho é registrado e escalado, não ignorado pelo prazo.

## Contrato de cada tarefa enviada ao Luna

O coordenador envia: objetivo único → arquivos/limites → resultado esperado →
testes → ações proibidas → formato da evidência. Luna responde:

1. O que implementou/mediu e arquivos alterados.
2. Comandos rodados, exit codes, número de casos/falhas/pulados e logs sintéticos.
3. O que não foi provado, incluindo mocks, timeout e aceite humano.
4. Diff/commit focado e próximo impedimento real.

Não pedir confirmação ao Pedro após cada teste verde. Após revisão aprovada,
seguir para a próxima fatia local. Uma falha recebe diagnóstico e correção focada;
duas tentativas sem progresso escalam ao coordenador antes de aumentar escopo.
Não aumentar timeouts, afrouxar RLS/política ou desabilitar testes para obter verde.

## Limites obrigatórios

- VPS: somente `vps-root` (`2.25.223.180`, `srv1983380`), nunca alias `vps`.
- Não fazer escrita remota, backup/restore, papel, rede, painel ou recriação antes
  de manifesto completo e aprovação específica. “Finalizar hoje” não substitui isso.
- Sem push, merge, deploy de produção, checkout/reset/clean amplo ou prune.
- Um banco descartável exclusivo por execução; não compartilhar testes que alteram
  RLS nem tocar nos containers preexistentes. Segredos não entram em Git/logs.
- Recursos de teste só em rede interna ou bind explícito `127.0.0.1`. Nunca
  publicar banco/API sintética em `0.0.0.0` ou `[::]` por omissão do Docker.
- Fontes reais do cliente, envio a provedor, OAuth real ou gasto pago dependem
  de consentimento específico. Usar fixtures sintéticas por padrão.
- Preservar `docs/operacao/madrugada-2026-09-17/STATUS-CLAUDE.md` modificado e
  `docs/PLANO-CONDUCAO-HOJE-2026-09-17.md` não versionado.

## Critério de encerramento

Só declarar **projeto concluído** se o aceite da seção 6 de `PLANO-PRODUTO.md`
for demonstrado. Código verde significa **implementação local validada**;
homologação verde significa **validado em homologação**; nenhum dos dois equivale
ao cliente independente concluir o fluxo. Se o dia terminar ou houver portão
humano/remoto, registrar exatamente o entregue e a próxima ação, sem selar etapas
faltantes como completas.

## Registro de execução

- 19/09, aproximadamente 16:08 -03: candidato G0 presente, árvore sem código novo;
  Luna iniciado para E0/E1 e diagnóstico das próximas fatias. Nenhuma mutação remota.
- Próximos resultados entram em `STATUS-LUNA.md` e nas revisões do coordenador.
- E0/E1: Luna identificou o Compose efetivo e as lacunas de P2/P3. O domínio de
  homologação não resolveu DNS no inventário e a ligação ao painel/Traefik não
  está comprovada. Inventário encerrado sem mutações remotas; isso bloqueia a
  publicação, não a implementação local.
- E2a autorizada: modelo/migration, credencial individual, guard exclusivo e
  rotas humanas de emissão/listagem/revogação próprias. MCP e ContextBuilder
  ficam para E2b/c, depois da fronteira de dados. Emissão e uso relerão autoridade
  atual; nenhum PAT será aceito genericamente nas rotas de sessão.
- E2a entregue: código revisado, 14 unitários e tipos verificados pelo coordenador;
  Luna reportou isolamento SQL, ciclo real da credencial, concorrência, rollback
  de auditoria e HTTP compilado. Commit local autorizado, sem declarar P2 completo.
- E2b autorizada: memória por empresa + grants de fonte exata/campos, default deny,
  autorização humana atual, projeção/consulta limitada e procedência; MCP/painel
  entram depois. Provas de integração devem ficar reutilizáveis no repositório.
- E2b entregue em `ed84dfc`; correção E2b.1 aprovada pelo coordenador após revisar
  trava estrita, CI dedicada e negativas HTTP de PAT/grant/tenant. Luna reportou
  3/3 integração e `SMOKE_RESTRITO_OK`; commit incremental autorizado. Isso não
  substitui regressão integrada E6 nem execução real do workflow remoto de CI.
- E2c enviada ao Luna: leitura por id, cliente MCP exclusivo de PAT e controles
  mínimos no painel; humano/P2 final continuam abertos.

## Recorte preparado para E2c (após revisão E2b)

- API: completar leitura por id no controlador estreito de agente, com o mesmo
  filtro de fonte/campo e rastro da busca. Não reutilizar a leitura humana integral.
- MCP: evoluir `packages/mcp/src/client.ts` e `server.ts`, oferecendo
  `memoria_buscar`/`memoria_ler` com PAT exclusivo. Token ausente, inválido ou
  revogado não dispara login de conta compartilhada. O modo cliente não deve
  exigir senha de serviço nem anunciar ferramentas que seu token não pode usar.
  Compatibilidade legada, se mantida, deve ser explícita e não reabrir memória
  integral pelo caminho antigo. HTTPS, sem encaminhar bearer em redirects,
  timeout e erros sem conteúdo/segredo.
- Painel: reaproveitar `/contexto` e helpers de autenticação para tokens próprios
  e concessões da empresa. Separar permissão de emitir token da de consentir
  dados; exibir texto/destino/fonte/campos antes de consentir. Exibição única do
  segredo, sem persistência no browser. Conectar não concede fonte automaticamente.
- Entrega: instrução curta baseada nos comandos efetivos do pacote, testes de
  cliente MCP/UI e HTTP restrito. Não simular conexão humana no Claude Code como
  aceite concluído. Não criar outro servidor, catálogo ou sistema de orquestração.
