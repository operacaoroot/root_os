# Auditoria de segurança — OWASP Top 10 for LLM Applications 2025

**Escopo:** LLM01, LLM02, LLM05 e LLM06 do checklist normativo
`HANDOFF-DEV/05-SEGURANCA-OWASP.md`, aplicados ao código da branch `root-os/frente-0`.
**Data:** 10/09/2026 · **Fatia do plano:** 0.3a · **RF:** RF-G-03, RNF-08

Os outros seis riscos (LLM03, LLM04, LLM07 a LLM10) **não foram auditados nesta passagem** e
seguem sem veredito. Não os marque como verdes em nenhum lugar por causa deste documento.

## Como ler

Cada item é uma linha do checklist do documento normativo. O veredito vale para o código lido, não
para a intenção do desenho:

| Símbolo | Significa |
|---|---|
| ATENDE | verificado no código, com arquivo e linha |
| PARCIAL | existe o mecanismo, mas não cobre o caso todo |
| NÃO ATENDE | verificado, e o controle não está no lugar |
| NÃO VERIFICADO | fora do que foi lido nesta passagem — sem veredito |

---

## LLM01 — Injeção de prompt

O risco nº 1 do checklist, e o próprio documento normativo diz por quê: os conectores de Drive,
Gmail e WhatsApp ingerem conteúdo de terceiros o tempo todo.

| Item do checklist | Veredito |
|---|---|
| Conteúdo externo tratado como dado, nunca comando — **em código**, não em instrução de prompt | NÃO ATENDE |
| Filtragem de entrada e saída em cada fronteira | PARCIAL |
| Ferramentas conectadas com menor privilégio | ATENDE |
| Aprovação humana para ação de alto impacto | ATENDE |
| Teste adversarial nesta versão | NÃO ATENDE |
| Conteúdo de fonte não confiável aciona o sinal de escalonamento | NÃO ATENDE |

**O que foi verificado.**

O único lugar onde "conteúdo externo é dado, não instrução" aparece hoje é uma frase do prompt:
`apps/api/src/agents/sop.ts:23`, dentro de `REGRAS_DA_CASA`. O checklist pede exatamente o
contrário — o controle **em código**. Em código o mecanismo existe pela metade:
`ExecCtx.procedenciaExterna` (`apps/api/src/gateway/tool-gateway.service.ts:21`) alimenta o sinal
`fonte_nao_confiavel` (`apps/api/src/policy/sinais.service.ts:35`), que sobe o nível um degrau na
régua. **Nenhum chamador do sistema jamais marca esse campo como verdadeiro**: os dois caminhos que
disparam o runtime — `apps/api/src/agents/agents.controller.ts` e
`apps/api/src/scripts/perguntar.ts` — não o passam. O sinal está ligado à régua e desligado do
mundo: hoje é código morto.

Enquanto isso, `apps/api/src/agents/context-builder.service.ts:66` injeta o corpo das notas
recuperadas direto no turno de usuário, sob o rótulo `DA BASE DE CONHECIMENTO:`, sem nenhuma
delimitação que separe dado de instrução e sem marcar a procedência para a régua. As notas vêm do
vault lido do disco (`apps/api/src/obsidian/obsidian.service.ts:117`, `reindex`), e o vault contém
material de terceiros colado por pessoas. É a porta de entrada de injeção indireta que está aberta.

**Menor privilégio (ATENDE).** Um agente só alcança as capacidades que declarou: o runtime monta as
ferramentas a partir de `agent.capacidades` e a porta **confere de novo**, recusando qualquer
capacidade fora da lista antes de olhar nível
(`apps/api/src/gateway/tool-gateway.service.ts:133-146`). Tem teste: `apps/api/test/porta.test.ts`,
"capacidade fora da declaração do agente é recusada, sem olhar nível". Um agente sem capacidade
declarada nem roda (`apps/api/src/agents/agent-runtime.service.ts:345`).

**Aprovação humana (ATENDE — foi o objeto desta fatia).** Ver LLM06 abaixo.

**Filtragem em cada fronteira (PARCIAL).** Entrada de argumento tem validação por schema quando o
schema existe — e em 49 das 60 capacidades do catálogo ele não existe (detalhe em LLM05). A saída do
modelo é escapada antes de virar HTML no painel (LLM05).

**Pendente.**

1. Marcar `procedenciaExterna` de verdade em todo caminho que traga conteúdo de fora (nota do
   vault, e-mail, mensagem, página) — é mão única por desenho: só eleva.
2. Delimitar o conteúdo externo no prompt, em vez de concatená-lo ao pedido.
3. Executar o teste adversarial que o checklist exige **nesta versão**: documento com instrução
   escondida, e-mail com instrução no rodapé, mensagem de cliente tentando elevar privilégio.
   Nenhum dos três foi rodado.

---

## LLM02 — Vazamento de informação sensível

| Item do checklist | Veredito |
|---|---|
| Nenhum dado sensível no prompt sem necessidade | PARCIAL |
| Saída filtrada antes de exibir | ATENDE |
| Minimização: só o necessário entra no contexto do modelo | PARCIAL |
| Segredo nunca alcança o contexto do agente | ATENDE |
| Log não recebe conteúdo sensível cru — vale o resumo e a referência | NÃO ATENDE |

**Segredo fora do contexto (ATENDE).** O que o modelo recebe como ferramenta é montado em
`apps/api/src/agents/tool-adapter.ts` (`paraFerramentas`): nome, descrição e `argsSchema` do
catálogo. Nada de credencial, host ou token. Quem tem o segredo é o serviço do conector — por
exemplo `EvolutionService`, que o efeito de `whatsapp.mensagem.enviar` chama passando só o texto
(`apps/api/src/agents/efeitos.service.ts:75-82`); o destino sequer é escolhido pelo modelo, é fixo do
ambiente. Não existe módulo COFRE no código: os segredos vêm de variável de ambiente, e os tokens
OAuth ficam cifrados em repouso (ver `docs/SECURITY.md`).

**Isolamento na busca vetorial (ATENDE, e é o que sustenta este item).** O filtro de tenant está
**dentro da consulta**, nos dois caminhos de `apps/api/src/obsidian/obsidian.service.ts:180-212` —
`WHERE "orgId" = $2` tanto no KNN por cosseno quanto na queda para busca textual. Não é uma camada
por cima que alguém pode contornar.

**Minimização (PARCIAL).** `ContextBuilder` tem teto de 6.000 caracteres, 5 notas e 400 caracteres
por trecho (`context-builder.service.ts:24-25`). É um teto de **custo**, não de sensibilidade:
qualquer nota do vault que case com a busca entra, sem olhar classificação. O corte protege a conta
da OpenAI, não o dado.

**Log com conteúdo cru (NÃO ATENDE).** Três lugares:

- `ToolCall.args` só é redigido quando a capacidade é `sensibilidade: restrita`
  (`tool-gateway.service.ts:523-528`). São **8 capacidades** no catálogo. As **17** marcadas
  `confidencial` — entre elas `email.enviar`, `comunicacao.email.ler`, `crm.lead.ler` e toda a
  família `financeiro.*.ler` — gravam argumento cru.
- `SessionStep.args` grava `chamada.args` **sem redação nenhuma**
  (`agent-runtime.service.ts:257`), inclusive para as `restrita`. A redação da porta não vale nesse
  caminho.
- `SessionStep.payload` guarda a resposta bruta do modelo (`saida.raw`), com o texto todo.

Nada disso vaza para fora do banco do tenant, mas contraria a linha do checklist como está escrita.

**Pendente.** Estender a redação a `confidencial`, aplicá-la também no traço da sessão, e decidir se
`payload` do modelo tem retenção própria — hoje ele cai na retenção global de
`RASTRO_RETENCAO_DIAS`, que é 1825 dias e não é por tenant.

---

## LLM05 — Tratamento inadequado de saída

| Item do checklist | Veredito |
|---|---|
| Saída validada e sanitizada antes de gravar ou renderizar | ATENDE |
| Saída nunca executada diretamente sem verificação | ATENDE |
| Argumento de ferramenta proposto pelo modelo é validado por schema antes de chegar ao conector | PARCIAL |

**Renderização (ATENDE).** Os dois renderizadores de markdown do painel escapam `&`, `<` e `>`
**antes** de aplicar qualquer substituição que gere HTML: `apps/web/src/app/relatorios/page.tsx:146`
(`inline`) e `apps/web/src/app/contexto/page.tsx:141`. O `dangerouslySetInnerHTML` recebe texto já
escapado. A resposta do agente no chat sai como texto JSX comum
(`apps/web/src/components/ChatFlutuante.tsx:208`), escapada pelo React.

**Execução (ATENDE).** Resultado de ferramenta volta ao modelo como JSON serializado
(`tool-adapter.ts`, `paraModelo`); não existe `eval`, `Function`, nem execução de SQL montado com
texto do modelo. As duas consultas com SQL cru são as da busca vetorial, e ambas usam parâmetro
posicional.

**Validação de argumento (PARCIAL — e é o furo).** A porta valida os argumentos **antes** de
classificar, o que é o desenho certo: recusa na porta com o motivo, sem queimar aprovação
(`tool-gateway.service.ts:153`, validador em `apps/api/src/gateway/validacao.ts`). Tem teste:
"argumento com o nome errado é recusado NA PORTA, antes de reter nada".

O problema é a cobertura. `validarArgs` devolve lista vazia quando a capacidade não declara
`argsSchema` — permissivo de propósito, para não derrubar o que funciona hoje. No catálogo
empacotado (base + delta), 60 capacidades, **49 não têm `argsSchema`**, e **16 dessas são R2 ou
acima**:

```
clickup.tarefa.criar · crm.lead.criar · conteudo.publicar · omie.titulo.alterar
usuario.permissao.alterar · omie.pagamento.baixar · nfe.emitir · registro.excluir
credencial.rotacionar · operacao.tarefa.alterar · pecas.campanha.alterar
clickup.tarefa.alterar · documento.criar · documento.anexar
financeiro.lancamento.criar · financeiro.lancamento.excluir
```

Os números acima foram contados nos dois JSONs de `packages/policy` (`politica-root.json` mais o
delta `politica-marketing-os.json`, resolvidos), que é o que o build embarca. A `PolicyVersion` ativa
de um banco pode divergir disso — ela só é reescrita quando alguém roda `db:seed:politica` — e nesse
caso a contagem daquele banco é outra.

Para essas, o argumento proposto pelo modelo chega ao efeito sem validação de schema. A régua e a
aprovação humana continuam valendo — o conteúdo é o que a pessoa lê e assina — mas a linha do
checklist, como está escrita, não é atendida.

**Pendente.** Declarar `argsSchema` para as 16 capacidades R2+ da lista acima. Depois disso vale
discutir se o validador deve deixar de ser permissivo (recusar capacidade sem schema), que é a
postura de falha fechada.

---

## LLM06 — Agência excessiva

A resposta central do produto: o agente propõe, a política decide, o gateway impõe.

| Item do checklist | Veredito |
|---|---|
| Todo agente começa sem permissão nenhuma | ATENDE |
| Capacidade não declarada pelo agente é recusada pelo gateway | ATENDE |
| Capacidade sem classificação na régua vale R5 e entra bloqueada | ATENDE |
| Um agente, um trabalho — verificado por teste | NÃO ATENDE |
| Nenhum caminho de código alcança conector fora do gateway — verificado por teste de arquitetura | NÃO ATENDE |

**A correção desta fatia.** Até 10/09/2026, com `GATEWAY_MODO=observar` a porta criava a aprovação,
escrevia `TERIA RETIDO` no log e **chamava o efeito assim mesmo**. Como `whatsapp.mensagem.enviar`
(R3) já tem efeito ligado, isso publicava escrita externa sem consentimento humano — a mensagem saía
no nome de alguém que nunca aprovou. Contra RF-G-03 e RNF-08.

A porta agora tem dois freios, e **nenhum dos dois muda com o modo**
(`tool-gateway.service.ts`, passo 7):

- **bloqueio** (R5, e capacidade sem classificação, que vale R5 — `permitido === false`). R5 é o
  degrau em que o OS **prepara, registra e encaminha** para uma pessoa executar na origem. A porta
  devolve `recusado` com o preparo, nos dois modos, e **não** cria aprovação: R5 não é executado pelo
  OS, então a fila só ganharia item que ninguém pode aprovar. Em observar continua saindo o aviso no
  log — agora dizendo `BLOQUEADO`, não "teria bloqueado", porque ele bloqueou mesmo — e a decisão
  fica gravada em `PolicyDecision` com `modo=observar`, que é o que o relatório de calibragem lê. O
  que não acontece mais é o efeito;
- **retenção por aprovação** (`exigeAprovacao === true`) — é consentimento humano, não calibragem.
  Sem token, a ação para, vira item na fila e quem executa depois é `AcoesService.executarAprovada`,
  com os argumentos gravados na proposta.

**Decisão de falha fechada, para o Pedro revisar.** A fatia, como escrita, mandava manter a recusa
por classificação "logando e deixando passar" em observar, inclusive R5. Isso contraria duas coisas
normativas: a escada (`04-ESCADA-R0-R5.md` — R5 é bloqueio, o OS prepara e encaminha para uma pessoa
executar na origem) e a proibição, nas constraints, de regra automática agir no lugar de gente. Foi
implementado o contrário do que a fatia pedia: **R5 nunca chama o efeito, em modo nenhum.** A
exposição de hoje era nula — nenhuma capacidade R5 tem efeito ligado em `efeitos.service.ts` —, e é
exatamente por isso que a hora de fechar é agora: quando alguém ligar o primeiro, não vai lembrar
que o modo observar abria exceção. O preço é que uma capacidade classificada como R5 por engano
para de funcionar em observar em vez de só aparecer no relatório; o conserto é reclassificar no
catálogo, que é a conversa que o modo observar existe para provocar.

Provado por teste em `apps/api/test/porta.test.ts` (roda com `TEST_DATABASE_URL`; sem a variável, a
suíte se pula inteira — ver `docs/DEPLOY.md` e a CI):

- `em MODO OBSERVAR, R3 RETÉM DE VERDADE` — usa o **efeito real** do registro, não um espião: se ele
  rodasse, a mensagem teria saído. Verifica que nada foi enviado, que o item entrou na fila e que o
  `ToolCall` ficou `aguardando_aprovacao`;
- `em MODO OBSERVAR o R5 continua BLOQUEADO` — o efeito não roda, a resposta traz o preparo, a
  decisão fica gravada com `modo=observar` e a fila continua vazia;
- `R2 exige aprovação enquanto ninguém configurar o contrário` — pina o fato de que R2 é o degrau
  configurável e hoje ninguém configura (ver pendência abaixo). A capacidade usada é
  `operacao.tarefa.alterar` e o nível esperado sai de `policy.simular()`, não de uma string fixa:
  com `crm.lead.criar` cravado em `'R2'` o teste ficou vermelho no dia em que a fatia 2.2 subiu essa
  capacidade para R3 — acusando o teste, não o código;
- `em MODO OBSERVAR, o que não exige aprovação continua passando (R0 e R1)` — a porta não virou
  `impor` disfarçado;
- `em MODO IMPOR nada disso mudou`.

**A suíte foi executada, não só escrita.** Em 10/09/2026, contra o Postgres descartável do host
(`mktos-shadow`, `pgvector:pg16`, porta 55432), com as migrations aplicadas e a política semeada:
`vitest run` na `apps/api` fecha em **65 testes verdes nos 6 arquivos**, `porta.test.ts` entre eles
com 20. `tsc --noEmit` de `src` e de `tsconfig.test.json` passa limpo.

Rodando a suíte contra o gateway anterior (`git show HEAD:...tool-gateway.service.ts`), **cinco**
testes ficam vermelhos, e é útil saber quais:

- `em MODO OBSERVAR, R3 RETÉM DE VERDADE` — o antigo acusa `executado` onde devia acusar
  `aguardando_aprovacao`, que é literalmente "a mensagem saiu";
- `R2 exige aprovação... e por isso retém em observar` — mesma falha, um degrau abaixo;
- `em MODO OBSERVAR o R5 continua BLOQUEADO` — o antigo executava o efeito **e** deixava para trás
  uma aprovação de R5 que ninguém pode aprovar; a asserção de fila vazia é o que pega a segunda;
- `capacidade fora da declaração do agente é recusada` e `argumento com o nome errado é recusado NA
  PORTA` — não pela recusa em si, que o antigo já fazia, mas pela asserção nova de que a recusa vira
  linha em `PolicyDecision`.

O teste de **R0 e R1 em observar fica verde** contra o gateway antigo: nada nele mudou, e é por isso
que ele está na lista — ele é a prova de que a correção não transformou observar em impor.

**Superfície de agente atrás de permissão de administrador.** As rotas que fazem um agente rodar —
`POST /agents/:slug/executar`, `POST /agents/:slug/stream` e `POST /agents/:slug/linha-de-base` —
passaram a exigir `admin.usuarios` além da permissão que já pediam
(`apps/api/src/agents/agents.controller.ts`). `mcp.executar` sozinho não servia de trava: ele está no
perfil `ia_servico`, que o próprio catálogo de papéis descreve como "só leitura (menor privilégio)".
As rotas de leitura seguem em `mcp.ver`. É uma trava grossa e provisória — ver pendência.

**Agente começa sem nada (ATENDE).** `impedimento()` recusa agente `planejado`, `pausado`, inativo
ou sem capacidade declarada (`agent-runtime.service.ts:339-348`).

**Recusa da porta agora entra no rastro de decisões (ATENDE).** As duas recusas que a porta faz
antes de classificar — capacidade fora da declaração do agente e argumento que não casa com o
schema — criavam `ToolCall` e evento e **não** passavam por `avaliarERegistrar`. Não existiam em
`PolicyDecision`, e são justamente as duas mais frequentes de um agente novo: quem lesse o relatório
de calibragem (`scripts/relatorio-observar.ts`, que lê essa tabela) para decidir a virada de
`observar` para `impor` decidiria sem elas. Agora a decisão é registrada antes da recusa, com o
`decisionId` e o nível no `ToolCall`, e o relatório distingue as três recusas pelo motivo gravado:

| Recusa | `PolicyDecision.motivo` |
|---|---|
| bloqueio por R5 | `R5 é preparado e encaminhado, nunca executado pelo OS` |
| capacidade não declarada | `recusado na porta: capacidade fora da declaração do agente` |
| argumento inválido | `recusado na porta: argumentos inválidos` |

O rótulo é texto estável de propósito: o relatório agrupa por essa string. O detalhe — qual campo
faltou, qual capacidade o agente tentou — fica em `ToolCall.erro` e no payload do evento
`tool.recusado`. A linha é gravada e depois corrigida em `permitido` e `exigeAprovacao` pela porta,
porque `avaliar()` só devolve `permitido: false` em R5 e, para a régua, uma leitura R0 pedida por um
agente que não a declarou "é permitida" — quem recusou foi a porta. É uma escrita a mais num caminho
raro; o certo é `avaliarERegistrar` aceitar a recusa da porta (pendência 10).

**Sem classificação vale R5 (ATENDE).** `avaliar(null)` devolve R5 não permitido com o motivo
"capacidade sem classificação vale R5" (`packages/policy/src/escada.ts`), e a porta bloqueia em modo
impor. Teste: "capacidade que não existe vale R5 — falha fechada".

**Um agente, um trabalho (NÃO ATENDE).** Não existe teste que verifique isso. O campo existe no
modelo (missão, SOP, capacidades), mas nada impede declarar um agente com o catálogo inteiro.

**Conector fora do gateway (NÃO ATENDE).** Há pelo menos duas violações conhecidas:
`apps/api/src/agents/efeitos.service.ts:3` importa `EvolutionService` direto, e
`apps/api/src/gateway/acoes.service.ts` é um segundo caminho de execução, com assinatura
`(args, orgId)` — sem ator e sem correlação. O teste de arquitetura que transforma isso em catraca é
a fatia 3.2 do plano; a remoção das violações é a 3.3.

**Rebaixamento por erro sem efeito.** `agent-runtime.service.ts:380` grava `rebaixadoAte` quando o
agente falha (RF-N-07), mas `impedimento()` não lê esse campo e o cálculo de sinais não o consulta.
O rebaixamento é escrito e nunca aplicado. Não é item do checklist OWASP, mas é agência excessiva
pela porta dos fundos.

---

## Pendências, em ordem de gravidade

| # | O quê | Risco | Onde |
|---|---|---|---|
| 1 | `procedenciaExterna` nunca é marcada: o sinal `fonte_nao_confiavel` é código morto | LLM01 | `agents.controller.ts`, `context-builder.service.ts` |
| 2 | Teste adversarial da versão não foi executado | LLM01 | — |
| 3 | 16 capacidades R2+ sem `argsSchema` | LLM05 | `packages/policy/politica-*.json` |
| 4 | Redação de log cobre só `restrita`, e não vale no traço da sessão | LLM02 | `tool-gateway.service.ts:523`, `agent-runtime.service.ts:257` |
| 5 | Teste de arquitetura do gateway não existe; duas violações conhecidas | LLM06 | fatias 3.2 e 3.3 |
| 6 | `rebaixadoAte` gravado e nunca lido | LLM06 | `agent-runtime.service.ts:339` |
| 7 | Nenhum teste de "um agente, um trabalho" | LLM06 | — |
| 8 | `admin.usuarios` como trava de execução de agente é grosseiro: fecha o chat do painel para todo mundo que não seja `admin_master` | LLM06 | precisa de uma permissão `agentes.executar` dedicada — decisão humana |
| 9 | R2 é "aprovação configurável" e ninguém configura: `avaliarERegistrar` não passa `aprovacaoR2Ligada`, e `avaliar()` lê `!== false`. Toda R2 exige aprovação, nos dois modos | LLM06 | `apps/api/src/policy/policy.service.ts:111` |
| 10 | `avaliarERegistrar` não aceita recusa da porta nem motivo próprio, então o gateway grava a decisão e corrige a linha logo em seguida | LLM06 | `apps/api/src/policy/policy.service.ts:104-129` (arquivo de outra fatia desta onda) |
| 11 | R5 em modo observar passou a bloquear de verdade: capacidade classificada como R5 por engano para de funcionar em observar, em vez de só aparecer no relatório | LLM06 | decisão desta fatia — ver "Decisão de falha fechada" acima |

O item 9 é falha fechada e portanto seguro, mas diverge do que o plano assumia ("R0–R2 continuam
executando normalmente em observar"). Está pinado por teste para não mudar sem alguém decidir. O
item 11 também é falha fechada, e é o único ponto desta fatia que contraria a instrução escrita —
está detalhado acima para o Pedro confirmar ou reverter.
