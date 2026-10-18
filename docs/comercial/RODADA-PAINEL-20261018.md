# Rodada do painel — 18/10/2026

> Fonte: ata da reunião "RootOS painel e tarefas: estrutura de inbox, aprovações e funil de vendas" (18/10/2026, Rodrigo).
> Branch: `comercial/cockpit-homolog`, sobre a tag `comercial-ux-20261013` (HEAD `2ff773e`).
> Ambiente: SÓ homologação (Docker `rootos-comercial`, web 3010 / api 4010). Nada vai à produção; o merge na main é rito da quinta com o Pedro.
> Encerramento: `homolog/RESULTADO-PAINEL.md` + tag `painel-entrega-20261018` + bundle `main..comercial/cockpit-homolog`.

## O pedido, nas palavras do Rodrigo

1. Uma **caixa de entrada** no Dia a dia, "semelhante à do ClickUp": tudo que tem ele como responsável, o que foi alterado em cada task, os últimos passos, e a condição de **limpar** a atividade. Mais o **quadro das minhas tarefas** com filtros e colunas (nome, vencimento, status, comentários num clique, responsáveis). Entra "entre pendências e aprovações".
2. **Agenda** separada (como está) e **Visão geral** mantida.
3. A seção **Contexto desce** para depois do Motor de IA.
4. **Trabalho**: a Lista de tarefas vira **pasta** (como pasta do ClickUp, com várias listas dentro — administrativa, gestão, atribuições, operacional). O **Quadro interno e a Lista de tarefas viram uma coisa só** ("é quase que repetido"). A **Implantação de clientes se aglutina** como pasta/lista dentro do Trabalho ("onboarding de cliente" e depois "execução", acompanhando o cliente). Ele pediu sugestões aqui — estão na lane P2.
5. **Cortar do menu** (por enquanto): Temas do ClickUp, Banco de ideias, Estratégia do mês.
6. **Banco de atas** dentro do Trabalho: as atas que vão sendo feitas chegam direto, visíveis na área da operação, **e geram sugestões de tarefas** para a lista.
7. **Motor de Marketing**: não mexer nesta rodada.
8. **Aprovações**: "uma confusão do caralho" — tem que dar para enxergar o que está acontecendo e o que cada um tem que confirmar/clicar, no estilo da inbox do ClickUp.
9. **WhatsApp do comercial**: virar motor funcional; usar como **referência de layout** a estrutura que o Pedro construiu no FinOps (FullBPO). O que existe "já está legal", mas tem texto fugindo dos quadros, mobile/desktop sem acompanhar, e boxes engessados.
10. **Funil vivo**: poder **mover** o card entre status (hoje não tem opção de mover). Ele sabe da regra de não pular etapa: mover com pendência deve **avisar com um balão** ("está sendo movido, mas algo ainda não foi executado"), não bloquear. **Scroll por coluna** (cada status rola sozinho, não a tela toda) e uma barra para visualizar status por status. **Tooltip nas etiquetas** de filtro explicando o que cada uma significa.
11. **Excluir as subseções Leads e Funil de vendas** antigas — tudo passa pelo que já está construído em Decisões comerciais.
12. Foco geral: "fazer com que esse sistema passe a estar completamente funcional daqui para frente".

## Regras duras (nenhuma lane passa por cima)

- **A porta e a política não afrouxam.** R3/R4, alçada, segunda pessoa e reautenticação ficam exatamente como estão. A lane P4 muda a FORMA da fila, nunca a regra. Nenhuma capacidade nova sem necessidade.
- **Item de menu sai com `oculto: true` + `ROTAS_ABSORVIDAS`**, nunca apagando o `NavItem` (precedente: `assinatura`). As chaves de `SECOES` são publicadas (`area:<chave>` nas notas do vault): **reordenar pode, renomear/tirar chave não** (`nav.ts` linhas 6–12).
- **Migração aditiva** apenas. Toda tabela nova com `orgId`, RLS FORCE, sentinela/gatilho quando filha (seguir `FILHOS_COM_ORGID_REDUNDANTE`).
- **Mover card por pessoa ≠ agente**: o aviso de pendência vale para o arrasto humano; agente continua barrado pelos portões, e a transação de fechamento continua exigindo as pré-condições (fechar não vira arrastável).
- Commits a cada ~30 min, máx. 2 lanes em paralelo, caminho demonstrável antes de polimento. Baseline do Windows: os vermelhos de permissão 0600/symlink listados em `homolog/.tmp/baseline-falhas-api.txt` não são desta rodada.
- Provas: Playwright + screenshots escuro/claro/390px por tela mexida, nos padrões de `homolog/provas/`. `pnpm test` da web e da API verdes (fora o baseline), política e isolamento intactos.
- Identidade: o tema escuro do OS já é a identidade (`--os-ac #9bdb1f`, mono + grotesk). Texto de tela em PT-BR direto, sem jargão.

## Lanes

### P0 — ordem do menu e cortes (pequena, abre a rodada)
- `SECOES`: mover `empresa` (Contexto) para depois de `automacoes` (Motor de IA). Ordem final: dia · trabalho · conteudo · comercial · financeiro · automacoes · empresa · resultados · apoio.
- `oculto: true` em: `conteudo` (Temas do ClickUp), `marketing-ideias`, `marketing-estrategia`, `leads`, `funil`. Entradas em `ROTAS_ABSORVIDAS` apontando: `/leads` e `/funil` → `/comercial` e `/comercial/funil` ("o cockpit absorve o MVP"); as três de trabalho → `/trabalho` (com o porquê: cortadas por decisão de 18/10, telas vivas).
- `nav.test.ts` atualizado junto; `moduloDaRotaDoWeb` continua resolvendo as rotas ocultas (são itens vivos).

### P1 — a caixa de entrada (Dia a dia)
Reconstruir **/caixa** (o item "Pendências" já existe; mantém chave e rota) com duas abas:
- **Atividade**: eventos das tasks em que EU sou responsável (mudança de status, comentário novo, atribuição, vencimento alterado), do mais novo para o mais velho, com o trecho do que mudou. Cada item tem **Limpar** (some da caixa, fica no histórico) e há **Limpar tudo**. Lido/limpo é por usuário: tabela nova `CaixaVisto` (orgId, userId, origem/eventoId, visto em) — aditiva, RLS.
- **Minhas tarefas**: tabela com colunas nome · lista · status · vencimento · responsáveis · comentários (contagem; clique abre popover com os últimos, sem sair da tela). Filtros: lista/pasta, status, vencimento (vencidas, hoje, semana), responsável (eu/qualquer). Colunas mostráveis/ocultáveis, preferência em localStorage.
- Fontes: `WorkTask` (quadro/listas do Trabalho) + aprovações pendentes do usuário (contagem com link para /atendimento — a fila continua lá). Não inventar segunda fonte de verdade: a caixa LÊ, quem grava são as telas donas.
- API: `GET /caixa/atividade` (paginada) + `POST /caixa/limpar` (um/todos). Comentário de task: se `WorkTask` ainda não tem comentário próprio, usar o fio/apontamentos existentes; se nada existir, criar `WorkComentario` (filha de WorkTask, aditiva) — conferir antes no schema.

### P2 — Trabalho vira pastas; quadro e lista viram um
- **`WorkPasta`** (nova, aditiva): nome, ordem, orgId. `WorkList.pastaId` opcional (null = "solta", compat total).
- Pastas iniciais sugeridas (seed leve, editável na tela): **Administrativa**, **Gestão**, **Clientes**. Dentro de Clientes: a lista do modelo `esteira-de-clientes` + listas "Onboarding de cliente" e "Execução" (o Rodrigo pediu para acompanhar o cliente por listas que avançam).
- **Uma tela só**: `/trabalho` ganha alternância **Quadro ⇄ Lista** sobre a MESMA fonte (`WorkTask`); `/tarefas` (tabela `Task`, paralela) sai do menu (`oculto: true`) e a rota redireciona para `/trabalho` com a visão de lista. Não apagar a tabela `Task` (pendência ROOT-10 é do Pedro); só parar de oferecê-la como porta.
- Navegação: seletor de pasta no topo da tela (não no menu lateral — o menu não vira árvore de 3 níveis); `/onboarding` continua existindo e o cartão do cliente na lista linka o trilho.

### P3 — banco de atas + sugestões de tarefa
- Tela **Atas** dentro do Trabalho (`/trabalho/atas` ou aba na tela única): lista as atas da operação com data, participantes, resumo e a nota inteira ao abrir.
- Fontes de entrada: (a) as notas do vault (root-base `80-Reunioes`, que a memória do OS já indexa — filtrar pela área/pasta); (b) colar/upload manual de ata avulsa (grava como nota da memória pelo caminho da ADR-011, nunca por fora).
- **Sugestões de tarefas**: agente lê a ata e PROPÕE tarefas (título, lista de destino, dono sugerido, trecho da ata como procedência). Propostas ficam em rascunho para aceite de um clique na tela (aceitar cria a `WorkTask`); nunca cria task sozinho. Reusar o padrão do leitor de ata do onboarding (propor com trecho; parser confere o trecho contra a ata). Gasto de IA pelo `LlmProvider` com orgId, sob o teto.

### P4 — aprovações legíveis (/atendimento)
Só forma, zero regra:
- Agrupar por **"o que depende de você"** / "aguardando outra pessoa" / "decididas e vencidas" (histórico).
- Cartão compacto de UMA linha: quem pediu · o quê (verbo + objeto em português) · nível · há quanto tempo · botão único do passo ("Confirmar", "Assinar como titular", "Recusar"). Expandir mostra o conteúdo exato como hoje (o cartão do lote MD8 continua o mesmo por dentro).
- Topo com contadores (aguardando você N · vencendo hoje N) e filtro por tipo (WhatsApp, publicação, lote da semana, Google).
- Estados vazios que explicam ("nada esperando por você").
- As condições de assinatura (alçada, segunda pessoa, reautenticação) aparecem ANTES do clique, como já é regra — só que legível.

### P5 — funil vivo: mover, rolar, entender
- **Mover**: arrastar HTML5 nativo (precedente do kanban do Trabalho) + menu "Mover para" no card (teclado/celular). Mover com pendência de portão **executa** e marca o card com um **balão persistente** "movido com pendências: <lista exata do que falta>", gravado no fio do lead; o aviso some quando a pendência é sanada. Etapas cuja transição é efeito de sistema (fechamento, assinatura) não aceitam arrasto — o menu explica o porquê.
- **Scroll por coluna**: colunas com altura da viewport e `overflow-y` próprio; a página não rola inteira. **Barra de status**: chips fixos no topo com contagem por etapa; clicar foca/rola até a coluna.
- **Tooltips das etiquetas**: cada etiqueta de filtro ganha explicação ao parar o mouse (e `aria-describedby`); textos curtos definidos no shared junto das etiquetas, para a API e a tela dizerem o mesmo.

### P6 — WhatsApp do comercial: layout FinOps e caixas que respiram
- Referência de layout: as telas de atendimento/chat do FinOps5.0 do Pedro (`_finops_import/extracted/FinOps5.0-main` e `docs/finops-ref/` — olhar como REFERÊNCIA visual, não portar código).
- Corrigir no simulador e nas telas do comercial: texto vazando dos quadros (quebra e reticências com título completo no hover), grades que acompanham mobile ⇄ desktop (o padrão 390px já tem prova — estender), boxes com altura/espaçamento fluidos em vez de fixos.
- O motor em si (porta, capacidade R3, provedores simulado/evolution/meta) não muda nesta rodada — é forma.

### P7 — integração, provas e encerramento
- Rebuild da imagem da homolog com tudo; `ux-painel.mjs` continua verde; roteiro novo `painel.mjs` cobrindo: caixa (atividade + limpar), pasta criada e lista movida, ata colada gerando sugestão aceita, aprovação confirmada pela tela nova, card movido com balão de pendência.
- Screenshots por tela (escuro/claro/390px) em `homolog/provas/painel-*`.
- `RESULTADO-PAINEL.md` com o que entrou, o que ficou de fora e as decisões que a rodada expôs; tag `painel-entrega-20261018`; bundle novo.

## O que esta rodada NÃO decide (fica para a mesa)
- Apagar de vez as telas cortadas do menu (ROOT-10 é do Pedro).
- A régua do funil para AGENTE (o aviso-no-lugar-de-trava é só para gente).
- Plataforma de WhatsApp de produção (Evolution × Cloud API × Digisac) e número — a rodada trabalha no simulado.
- Unificação da tabela `Task` com `WorkTask` (projeção, tarefa 12 antiga).
