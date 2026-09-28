---
kind: decisao-pendente
dono: Pedro (decide) · Lucas (levantou)
valido_de: 2026-09-28
tags: [root, root-os, marketing, mk7]
---

# MK7 — a lista de telas repetidas, para o Pedro decidir

> A decisão do Pedro de 28/09/2026 diz: *"Nada do OS é apagado sem a lista de repetidos aprovada
> pelo Pedro."* Esta é a lista. Ela existe para ser **recusada, aprovada ou cortada** por ele —
> nenhuma tela foi removida enquanto isso.

## A resposta curta

**Nada precisa ser apagado.** A reorganização que a decisão pediu foi conseguida **pondo o bloco
Marketing no menu e pendurando cada coisa onde ela já tem dono**, e não removendo tela.

A decisão partia de uma leitura razoável — o marketing do OS está espalhado por `/pauta`,
`/referencias`, `/bio`, `/conteudo`, `/instagram`, `/campanhas`, `/funil` e `/leads`. O que a
leitura do código mostrou é que **espalhado não é repetido**: a maior parte dessas telas trata de
assuntos diferentes que compartilham vocabulário.

Duas ficam na fronteira e dependem de uma decisão de produto, não de uma remoção. Estão na §3.

## 1. O que parecia repetido e não é

| Tela | O que ela é de verdade | Por que não é repetição |
|---|---|---|
| `/linha-do-tempo` | o **rastro de auditoria** (seção "O controle", permissão `auditoria.ver`, filho do Rastro) | O app do Lucas chama "linha do tempo" o histórico do projeto com a cliente. Mesmo nome, assunto oposto: um é quem mexeu em quê, o outro é o que foi combinado numa reunião. |
| `/agenda` | a agenda da **Central**, do OS inteiro | A agenda de conteúdo é a aba Semana da Pauta, que tem grade, slots por formato, feriados e aprovação em lote. Não se encostam. |
| `/relatorios` | relatórios do módulo **`relatorios`**, seção "A execução" | O relatório de conteúdo (MK6) mora em `/marketing/relatorio` e lê `PautaPeca`. Nome parecido, dado diferente. |
| `/referencias` | o acervo de fichas da Pauta | Ganhou a aba Concorrentes na MK2 em vez de virar tela nova — é o mesmo acervo com número. |
| `/pauta` | a máquina de conteúdo, **em produção desde 28/09/2026** | É a máquina que o bloco Marketing alimenta. **Não encostar.** |
| `/bio`, `/instagram` | a página de links e a conta | Superfícies de publicação, não de decisão. |
| `/campanhas`, `/funil`, `/leads` | tráfego pago, conversão e demanda | São "o que entra". O bloco Marketing é "o que sai". |

## 2. O visual: o vão era menor do que a decisão supunha

A decisão pede que o visual do bloco siga o do app do Lucas. Ao implementar, encontrei que **o OS
já carrega essa identidade**:

| | App do Lucas | ROOT OS (tema escuro) |
|---|---|---|
| Acento | `#9bdb1f` | `--os-ac: 155 219 31` = `#9bdb1f` |
| Magenta | `#ff1f6b` | `--os-mag: 255 31 107` = `#ff1f6b` |
| Ciano | `#1fffa8` | `--os-cy: 31 255 168` = `#1fffa8` |
| Fontes | Space Grotesk + JetBrains Mono | as mesmas, auto-hospedadas no `app/layout.tsx` |
| Logo ROOT | sombra magenta/ciano | `--os-logo-shadow: 1.5px 0 #ff1f6b, -1px 0 #1fffa8` |

São a mesma marca. O que o app tem a mais é a textura de varredura (o `body::before`), e o OS tem o
equivalente em `--os-grid`. **Não refiz o visual**: repintar telas para chegar onde elas já estavam
seria churn com cara de entrega. As telas do bloco usam os componentes da casa e herdam a
identidade.

Se o Pedro quiser a diferença que sobra — a varredura e o painel de canto vivo do app —, é uma
fatia pequena e separada, e vale decidir olhando as duas telas lado a lado.

## 3. As duas da fronteira — o que o Pedro decide

Nenhuma das duas é remoção. As duas são "quem manda em quê".

### 3.1 `/conteudo` × Banco de ideias (MK3)

`/conteudo` é **espelho do ClickUp** (`ContentItem`, `source` com padrão `"clickup"`, `externalId`,
`listId`): é o quadro de produção da agência, com etapa que grava de volta no ClickUp.

O Banco de ideias da MK3 é outra coisa: ideia nossa, por pilar, com gancho e roteiro, que vira
`PautaPeca` ao ser aprovada.

- **Recomendação:** manter as duas. Elas se cruzam só no nome "conteúdo".
- **O que o Pedro decide:** se o quadro do ClickUp continua sendo a verdade da produção depois que
  o Banco de ideias existir, ou se a Root passa a produzir dentro do OS e o `/conteudo` vira
  leitura. **Não é decisão desta frente** — é decisão de como a Root trabalha.

### 3.2 `/metas` × Estratégia do mês (MK4)

`/metas` guarda meta **semanal** (`GoalConfig`/`GoalWeek`), com número, e recebe `bioClicks`
sozinho da bio. A estratégia do mês (MK4) tem uma seção "Metas", hoje escrita como texto.

- **Recomendação:** manter as duas, e **ligar uma na outra numa fatia futura**: a meta da estratégia
  do mês deveria virar a `GoalConfig` do período, em vez de ser um texto que ninguém mede.
- **O que o Pedro decide:** se vale fazer essa ligação, e quando.

## 4. O que eu peço ao Pedro

1. **Aprovar que nada é removido nesta frente.** É o que a leitura do código sustenta.
2. **Decidir a 3.1** — o ClickUp continua dono da produção?
3. **Decidir a 3.2** — a meta do mês vira meta medida?
4. **Dizer se quer a diferença visual que sobra** (§2), como fatia separada.

Enquanto não houver resposta, o bloco Marketing existe **acrescentando**, e nenhuma tela do OS foi
tocada.
