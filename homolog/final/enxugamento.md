# Enxugamento · main antiga × produção × nossa (Versão final, 19/10/2026)

> Montado ANTES de resolver qualquer conflito do merge (F1), como pede o alerta do Rodrigo
> ("a versão deles já estava mais enxuta"). Sem dado de cliente.
>
> Referências: **main antiga** = `main` 5260924 (07/10). **Produção** = `lucas/tarefas` (abd1476;
> a produção roda 10939e1, que só difere em `abd1476`, carga do ClickUp, script). Ela contém o
> snapshot da entrega do Pedro (f5552402 = 7ed42fb em código; ver §4). **Nossa** =
> `comercial/cockpit-homolog` (808d743, tag `trabalho-entrega-20261020`).
>
> Regra aplicada: fora do foco (Motor de Marketing, Financeiro, Cofre, Granola/Conexões, Análise,
> Contexto, Motor de IA, Resultados, Configurações) vale a forma da produção, salvo mudança NOSSA
> documentada nos RESULTADO-*.md, e nunca para trazer de volta o que eles tiraram. Dentro do foco
> (Motor Comercial, Dia a dia, Trabalho) vale a nossa, com as exceções do roteiro (o que fica do
> Lucas) e o que eles enxugaram ali sem que nós tocássemos.

## 1. Seções do menu (`SECOES`)

| Seção | main antiga | produção | nossa | fica | porquê |
|---|---|---|---|---|---|
| Dia a dia | 1ª | 1ª | 1ª | 1ª | igual nos três |
| Contexto | 2ª | 2ª | 7ª (depois do Motor de IA) | 7ª | mudança nossa, documentada (RESULTADO-PAINEL P0, decisão do Rodrigo de 18/10); a produção não mexeu |
| Trabalho | 3ª, hint "tarefas, quadro, ideias e implantação" | 3ª, sem nenhum item visível (some do menu) | 2ª, hint "tarefas, quadro e implantação" | 2ª, a nossa | foco: o Trabalho é a base nossa (roteiro F4); a produção esvaziou porque mandou tudo para Dia a dia › Tarefas/Operação, que o roteiro troca pela nossa organização |
| Motor de Marketing | 4ª | 4ª | 3ª (só pela descida do Contexto) | como a produção, na posição relativa | fora do foco |
| Motor Comercial | 5ª | 5ª | 4ª | idem | foco |
| Motor Financeiro | 6ª | 6ª | 5ª | idem | fora do foco |
| Motor de IA | 7ª | 7ª | 6ª | idem | fora do foco |
| Resultados · Configurações da empresa · Registros · Configurações da conta | fim | fim | fim | iguais | iguais nos três |

## 2. Itens do menu (`NAV`), seção a seção

Legenda: **vis** = visível no menu; **oc** = oculto (vivo, dono da rota); **—** = não existe.

### Dia a dia (foco)

| Item (chave) | main antiga | produção | nossa | fica | porquê |
|---|---|---|---|---|---|
| Visão geral (dash das tarefas do Lucas) | — | dentro de `/painel` (resumo das tarefas), item `console` "Visão geral da empresa" em 1º | — | **1º item e entrada do Dia a dia**, lendo as nossas pastas e listas | decisão do Rodrigo (fica do Lucas, adequado à decisão 4) |
| `tarefas-todas` "Tarefas" `/dia-a-dia` | — | vis, 2º | — | **oc + rota absorvida** em "Todas as tarefas" do Trabalho (`/trabalho?pasta=todas`); o Calendário vira visão de Minhas tarefas | roteiro F3/F4: a visão de todas as pastas é do Trabalho; não duplicar |
| `caixa` "Pendências" | vis, 1º | **oc** ("as tarefas estão em Tarefas") | vis, com Atividade · Minhas tarefas · Decisões | **vis**, 2º | roteiro F3 manda Pendências na ordem (decisão explícita do Rodrigo vence o enxugamento aqui) |
| `atendimento` "Aprovações" | vis | vis | vis (a nossa, em 3 grupos) | vis, 3º | foco; vale a nossa |
| `agenda` "Agenda" | vis | vis | vis | vis, 4º | igual |
| `console` "Visão geral da empresa" `/painel` | vis, 4º | vis, 1º | vis, 4º | vis, 5º, rótulo **"Painel geral da empresa"** | roteiro F3 ("Painel geral da empresa, dash mantido") |
| `onboarding` | "Implantação de clientes", Trabalho | **"Operação"**, movido para Dia a dia (Implantação + aba "Rodada da semana" do Pedro, só para a ROOT) | "Bancada de onboarding", oc, `/onboarding` redireciona a `/trabalho/implantacao` | **oc** (a nossa) e a aba "Rodada da semana" do Pedro passa a morar na nossa Implantação, só para a ROOT; `/operacao` segue viva | a implantação é nossa (foco Trabalho); a Rodada do Pedro não pode sumir do caminho de quem a usa |

### Trabalho (foco)

| Item | main antiga | produção | nossa | fica | porquê |
|---|---|---|---|---|---|
| `trabalho` | "Quadro interno", vis | oc | **"Tarefas"**, vis (quadro e lista, pastas) | vis, a nossa | foco, base nossa |
| `tarefas` "Lista de tarefas" | vis | oc | oc (redireciona à visão Lista) | oc | os três lados convergem |
| `implantacao` "Implantação de clientes" `/trabalho/implantacao` | — | — | vis, pai `trabalho` | vis | nossa |
| `trabalho-atas` "Atas" | — | — | vis, pai `trabalho` | vis | nossa |
| `conteudo` "Temas do ClickUp" | vis | oc | oc | oc | os três convergem |
| `marketing-ideias` "Banco de ideias" | vis em Trabalho | **vis em Motor de Marketing** | oc em Trabalho | **vis em Motor de Marketing** | fora do foco: marketing sem mudança; a nossa só tirava do Trabalho, e lá ele não volta |
| `marketing-estrategia` "Estratégia do mês" | vis em Trabalho | **vis em Motor de Marketing** | oc em Trabalho | **vis em Motor de Marketing** | idem |

### Motor de Marketing (fora do foco: forma da produção)

| Item | main antiga | produção | nossa | fica |
|---|---|---|---|---|
| Produção de conteúdo · Referências · Marketing (Performance, Relatório do mês) · Instagram · Página de links · Campanhas · Eventos do site | vis | vis | vis | iguais |
| Banco de ideias · Estratégia do mês | (Trabalho) | vis aqui | (oc) | vis aqui |
| `marketing-tarefas` "Tarefas" `/marketing/tarefas` | — | vis | — | **vis** (sem mudança; lê a mesma lista de tarefas) |

### Motor Comercial (foco; ordem do roteiro F2)

| Item | main antiga | produção | nossa | fica | porquê |
|---|---|---|---|---|---|
| `comercial-painel` "Painel geral" `/comercial` | — | vis, 1º (dash do Lucas) | — (`/comercial` redireciona ao Funil vivo; a chave `comercial-decisoes` é dona de `/comercial`) | **vis, 1º, layout do Lucas** lendo os nossos dados | decisão do Rodrigo; `/comercial` volta a ser o painel e deixa de redirecionar |
| `comercial-funil` "Funil vivo" | — | — | vis | vis, 2º | nossa |
| Propostas `/propostas` | — | página viva, sem item no NAV (link só na sessão da plataforma) | — | **vis, 3º** | decisão 1 (a aba do Lucas é a tela) |
| `leads` | "Leads", vis | "Leads", vis | oc (absorvido pelo Funil vivo) | **vis, 4º, "Lista de leads"**, lendo a tabela `Lead` | decisão 2 |
| `funil` "Funil de vendas" (do Lucas) | vis | vis | oc | **oc** + rota absorvida no Funil vivo | sai (vale o nosso) |
| `comercial-contratos` · `comercial-simulador` · `comercial-torre` · `comercial-relatorio` | — | — | vis | vis, 5º a 8º | nossos; WhatsApp onde está (decisão 3) |
| `comercial-decisoes` | — | — | oc (absorvido por `/caixa`) | oc | nossa; deixa de ser dona de `/comercial` |
| `clientes` "Clientes" | — | vis | — | **oc** + rota absorvida (Implantação/Contratos vivos) | sai (duplicado) |
| `comercial-tarefas` "Tarefas" | — | vis | — | **oc** + rota absorvida (Trabalho) | sai (duplicado) |

### Motor Financeiro, Motor de IA, Resultados, Configurações, Registros (fora do foco: forma da produção)

| Item | main antiga | produção | nossa | fica |
|---|---|---|---|---|
| `financeiro` | vis | vis (fixo, variável, eventual, Análise, Asaas) | vis (igual à main) | como a produção |
| `financeiro-tarefas` "Tarefas" | — | vis | — | vis |
| `cofre` "Cofre" (Configurações da empresa) | — | vis | — | vis |
| Agentes, Rotinas, Sessões, Processos, Custos de IA, Relatórios, Metas, Equipe, Ferramentas, Integrações (Granola), Regras, Plano (oc), Registro de ações, Atividade, Configurações da conta | iguais | iguais | iguais | iguais |

## 3. Rotas (`apps/web/src/app`)

- **Nenhuma rota da main antiga foi removida** nem pela produção nem pela nossa (64 → 77 na produção, 64 → 80 na nossa). O enxugamento deles é de MENU (itens ocultos e movidos), não de rota apagada.
- Novas na produção, todas mantidas: `/clientes`, `/cofre`, `/comercial` (Painel geral), `/comercial/lead/[id]` (a ficha do Lucas), `/comercial/tarefas`, `/dia-a-dia`, `/financeiro/obrigacoes/[id]`, `/financeiro/tarefas`, `/marketing/preparacao`, `/marketing/tarefas`, `/operacao` (Pedro), `/pauta/producao`, `/propostas`.
- Novas na nossa, todas mantidas: `/comercial/{contratos,contratos/[leadId],decisoes,funil,relatorio,simulador,torre}`, `/comercial/lead/[id]{,/fechamento,/sessao}`, `/onboarding/bancada`, `/s/[token]{,/proposta}`, `/trabalho/atas`, `/trabalho/implantacao`.
- **Colisões de rota** (as duas criaram o mesmo caminho): `/comercial` (painel do Lucas × redirecionamento nosso ao Funil vivo) e `/comercial/lead/[id]` (ficha do Lucas × painel do lead do cockpit). Resolução no RESULTADO-FINAL §conflitos: `/comercial` é o Painel geral do Lucas; `/comercial/lead/[id]` é o painel do lead do cockpit (foco, a nossa), e a ficha do Lucas segue aberta em janela pelo `abrirFicha` (componente `FichaEmJanela`), que não depende da rota.
- `/onboarding`: a produção o fez "Operação" (Implantação + Rodada da semana); a nossa o redireciona à Implantação. Fica o redirecionamento nosso; a Rodada da semana ganha a aba na nossa Implantação para a ROOT, e `/operacao` segue viva.

## 4. Snapshot do Pedro (f5552402) × 7ed42fb

`git diff 7ed42fb f5552402` = 6 arquivos, nenhum de código: `AGENTS.md` (autorização vigente de 11/10, só no 7ed42fb), o cabeçalho "Autorização vigente" em `CLAUDE.md`, `README.md`, `docs/DEPLOY.md` e `docs/PLANO-CONTINUIDADE.md` (8 linhas cada, só no 7ed42fb), e 5 linhas a mais no `.env.example` do snapshot. **Equivalentes em código: a branch do Pedro NÃO é mesclada de novo.** O que falta (AGENTS.md e os cabeçalhos de autorização) é instrução operacional da produção, não código; fica registrado no RESULTADO-FINAL para o Rodrigo decidir, sem trazer.

`lucas/comercial-painel` (19dd275): os 2 commits a mais que ela tem sobre `lucas/tarefas` (c29fff4, 19dd275) são os mesmos patches de f8156d9 e 12d7a6c, já em `lucas/tarefas` (`git cherry` marca os dois com `-`). Não é mesclada de novo.
