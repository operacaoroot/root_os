# A versão final — nossa + Pedro + Lucas — 19/10/2026 (noite)

> Fonte: reunião "Rodrigo e Lucas OS" (19/10, 17h) + as respostas do Rodrigo às decisões (19/10).
> Branch nova: **`homolog/final-20261019`**, a partir de `comercial/cockpit-homolog` (tag `trabalho-entrega-20261020`). As branches de origem não mudam.
> Ambiente: SÓ homologação no Predator. **Nada em produção nesta rodada**: ela entrega o roteiro da virada (`docs/comercial/VIRADA-PRODUCAO.md`) para o Rodrigo e o Pedro executarem depois da validação.
> Encerramento: `homolog/RESULTADO-FINAL.md` + tag `final-entrega-20261020` + bundle `main..homolog/final-20261019` + stack `rootos-final` de pé.

## As três fontes

| Fonte | Ref | O que traz |
|---|---|---|
| **Nossa** | `comercial/cockpit-homolog` (808d743) | cockpit comercial (funil vivo, painel do lead, sala publicada por versão, proposta com leitura e reações, contratos vivos, torre, relatório, simulador/atendimento do WhatsApp, fechamento com 6 escritas, registrar cliente já fechado), Dia a dia (Pendências com Atividade/Minhas tarefas/Decisões, vistas salvas, Aprovações em 3 grupos com aprovar na linha, Agenda), Trabalho (pastas, quadro denso com rolagem lateral, lista, pop-up único, cliente obrigatório → `Partner`, atas com sugestões editáveis, Implantação com card que nasce do fechamento) |
| **Pedro, 14/10** | `origin/entrega/operacao-painel-20261014` (7ed42fb) — **em produção, fora da main** | painel de operação da Root, Contexto e brandbook, agentes com ferramenta local, sessões, memória, onboarding ligado a fontes canônicas |
| **Lucas** | `origin/root-os/tarefas` (abd1476; produção roda 10939e1) + `origin/root-os/comercial-painel` (19dd275) | a base dele já contém o **snapshot da produção 7ed42fb** (commit f5552402, extraído da imagem). Comercial com Painel geral (dash), aba Negócios, ficha do lead/cliente com reuniões do Granola, Propostas (/propostas, dash + lista + detalhe com tempo por parte e visitas), Clientes (onboarding e sucesso), Dia a dia com Visão geral (dash) e Tarefas de todas as áreas com Calendário, tarefas "como no ClickUp" (concluídas, seleção em lote, descrição própria, repetição, ordem manual, régua Atrasadas · Hoje · Próximos 7 dias · Sem prazo, vários responsáveis), Áreas (`WorkArea`), lista `cadastro`, Financeiro (fixo, variável, eventual, análise, Asaas), Cofre da empresa, Granola em Conexões, cargas do CRM |

**NÃO entra**: `origin/root-os/atendimento` além do que já está em `root-os/tarefas` — os 3 commits dela (Dia a dia › Conversas, caixa de WhatsApp do FinOps) ficam de fora: **o WhatsApp continua onde nós o criamos** (decisão 3).
**Conferir antes de mesclar**: o snapshot f5552402 deve ser equivalente a 7ed42fb. Se for, NÃO mesclar a branch do Pedro de novo (seria o mesmo conteúdo duas vezes); se houver diferença, registrar e mesclar só o que faltar.

## Decisões do Rodrigo (19/10)

**Ficam do Lucas** (reunião): o dash do **Dia a dia** (Visão geral: atrasadas, sem responsável, feitas na semana, por área → **por pasta/lista nossa**, por pessoa) como **primeira aba e entrada** do Dia a dia; o dash do **Painel geral** da empresa; o dash **Painel geral do Comercial** (fechadas, em negociação, conversão, ticket médio, funil geral, fase do funil, contratos fechados por mês, oportunidades por mês, canal de aquisição, vendas por vendedor, em negociação agora) como primeira tela do Motor Comercial, **no layout dele**; a aba **Propostas**; a **lista de leads** (base para lista de transmissão e e-mail — decisão 2); financeiro, cofre, Granola, análise e marketing **sem mudança**; menu lateral recolhível; "Todas as tarefas" de todas as pastas numa visão só (estilo "Everything" do ClickUp).
**Saem** (duplicados): Clientes e Tarefas dentro do Comercial; o funil dele (vale o nosso); a tela de aprovação dele (vale a nossa).
1. **Propostas**: a aba do Lucas é a tela (dash, lista, detalhe), e passa a ler TAMBÉM as propostas publicadas pela sala (`/s/<token>/proposta`, com leitura por seção e reações). As antigas dele continuam lá.
2. **Lista de leads**: fica.
3. **WhatsApp**: continua no Motor Comercial, como construímos (simulador/atendimento ligado ao lead).
4. **Áreas**: o dash do Lucas é **adequado para ler as nossas pastas e listas**. A tabela `WorkArea` fica no esquema (já está em produção, com dado), mas a organização e os dashboards usam pastas/listas.
5. **Organizar as tarefas reais** como construímos (pastas Administrativa · Gestão · Clientes [Esteira · Onboarding de cliente · Execução] · Marketing; leads ao funil; clientes como `Partner`). **O que sobrar sem lugar claro vai para uma lista de sobras no RESULTADO** — o Rodrigo quer ser avisado.

## Regras duras

- **Em conflito, a nossa é a referência** nas três áreas de foco (Motor Comercial, Dia a dia, Trabalho), com as exceções acima (o que fica do Lucas). Fora do foco (financeiro, cofre, Granola, análise, marketing, o que é do Pedro), **o que está em produção é a referência**: não quebrar nada que o Lucas ou o Pedro já usam.
- **Migration aplicada em produção não se edita.** Entra uma **migration de conciliação depois da última do Lucas** (`20261019220000_tarefas_varios_responsaveis`): converte o `WorkTask.clienteId` dele (→ outra `WorkTask` de lista `cadastro`) para o nosso (→ `Partner`, achado/criado por CNPJ ou nome normalizado), troca FK e CHECK pelos nossos, garante `Partner.interno`. Idempotente nos dois pontos de partida (banco com o esquema dele = produção; banco com o nosso = homologações atuais). A nossa `20261019100000_tarefa_do_cliente` vira no-op seguro quando a coluna já existe. `outrosResponsaveisIds` e `WorkArea` ficam.
- Política, porta, alçada e isolamento não afrouxam por causa do merge. Tabela dele sem RLS entra com RLS.
- A cópia de produção é dado real de cliente: só nesta máquina, nunca no git, nunca em log além de contagens; credenciais, tokens e hashes de senha neutralizados ao restaurar; rotinas que chamam fora desligadas; provedores nos dublês.
- Cada conflito vira uma linha numa tabela do RESULTADO: arquivo · o que era de cada lado · o que ficou · porquê.
- Commits ≤30 min; linha em `homolog/progresso.md` por marco ("Versão final"); bundle nos 10 primeiros minutos de cada rodada; revisor adversarial antes do fechamento.

## Lanes

### F1 — o merge (o caminho crítico)
- `homolog/final-20261019` = nossa + `root-os/tarefas` + `root-os/comercial-painel` (conferir a equivalência do snapshot com 7ed42fb antes).
- Conciliação do `clienteId` (acima). `prisma migrate diff` limpo.
- Suítes inteiras: web, API (as nossas + as do Lucas + as do Pedro), política, isolamento. Vermelho que vier da política de conflito vai explicado no RESULTADO, nunca "resolvido" desligando teste.

### F2 — Motor Comercial
- Primeira tela: **Painel geral do Lucas** (layout dele), lendo os nossos dados (Lead, ficha comercial, fechamentos, contratos vivos, canal da entrada).
- Itens do menu, nesta ordem: **Painel geral · Funil vivo · Propostas · Lista de leads · Contratos vivos · Simulador de WhatsApp · Torre das automações · Relatório da semana**. Saem do Comercial: Clientes, Tarefas, o funil antigo dele (oculto + rota absorvida, nunca apagar `NavItem`).
- **Propostas** (decisão 1): a tela dele lê também as propostas publicadas pela sala (leitura por seção, reações, aceites) e mostra as antigas dele.
- **Lista de leads** (decisão 2): fica, lendo a tabela `Lead` do cockpit.
- WhatsApp no lugar de sempre (decisão 3).

### F3 — Dia a dia
- Ordem: **Visão geral** (o dash do Lucas, primeira aba e entrada, adequado às nossas pastas/listas — decisão 4) · **Pendências** (Atividade, Minhas tarefas com vistas salvas, Decisões) · **Aprovações** (a nossa) · **Agenda** · **Painel geral da empresa** (dash mantido).
- O Calendário do Lucas (arrastar muda o prazo) vira uma das visões de Minhas tarefas.

### F4 — Trabalho
- Base nossa (pastas, quadro denso, lista, pop-up, cliente obrigatório, atas, Implantação).
- Trazer do Lucas o que só ele fez: **calendário**, **seleção em lote**, **tarefa que se repete**, **ordem manual**, **vários responsáveis** (no cartão e no pop-up; o primeiro é o principal), **régua de prazo** (Atrasadas · Hoje · Próximos 7 dias · Sem prazo) como agrupamento das vistas, **concluídas** (mostrar/ocultar).
- **"Todas as tarefas"**: no seletor de pastas, "Todas" mostra as tarefas de todas as pastas e listas numa visão só.
- **Menu lateral recolhível** em todo o OS.

### F5 — os dados reais na stack final
- Stack **`rootos-final`** (portas livres, sugestão web **3030** / api **4030**; conferir), imagem do merge. **`rootos-comercial` (3010) e `rootos-copia` (3020) não são tocadas.**
- A cópia nova da produção estará em **`C:\Users\User\dev\producao\producao-root-20261019b.dump`** (quando o Rodrigo liberar o envio). Se não existir, use a de 16h (`producao-root-20261019.dump`) e registre; se nenhuma existir, pule F5 e registre "aguardando a cópia".
- O esquema da versão final contém o do Lucas: **restaurar o dump direto no banco da stack** e aplicar as migrations do merge por cima (a conciliação converte). Neutralizar credenciais logo depois de restaurar. Login da homologação para o Rodrigo e para o Lucas (senha no `.env` da stack).
- **Organizar no lugar** (decisão 5), por script idempotente `homolog/organizar/organizar.mjs` que **é o mesmo que a virada de produção vai rodar**: mover listas e tarefas para as pastas nossas, cartões da Gestão de Leads → leads no funil (o cartão de origem arquivado com o link), cartões `cadastro` → `Partner`, cliente em toda tarefa de comercial/gestão, testes arquivados (não apagados), **marketing fica onde está**. Reaproveitar a classificação da rodada da cópia (`homolog/copia/mapa-*.json`, mesmos ids da produção) e classificar o que for novo desde as 16h.
- **Sobras** (decisão 5): tudo que não tiver destino claro fica onde está, com a lista em `homolog/organizar/sobras.md` (fora do git, tem título) e a contagem no RESULTADO.

### F6 — provas, revisão e o roteiro da virada
- Os nossos 5 roteiros e2e (`trabalho`, `implantacao`, `painel`, `ux-painel`, jornada) verdes na imagem final com o seed; um roteiro `final.mjs` com a cópia (dashes do Lucas lendo as nossas listas, Propostas com uma proposta da sala, lista de leads, "Todas as tarefas", calendário, vários responsáveis no pop-up, menu recolhido, financeiro/cofre/Granola abrindo como em produção). Fotos com dado real fora do git.
- Revisão adversarial: conciliação do `clienteId` nos dois pontos de partida, nada do Pedro/Lucas quebrado fora do foco, RLS das tabelas dele, neutralização da cópia, idempotência do organizador.
- **`docs/comercial/VIRADA-PRODUCAO.md`** (no git, sem dado de cliente): o passo a passo exato para a produção, para o Rodrigo e o Pedro — conferir quem está na VPS; backup (`pg_dump` + `docker tag … rollback`); bundle da branch para `/srv/projetos/root_os`; build da imagem; `db:seed:politica` com a assinatura das capacidades novas ANTES da subida; `migrate deploy` (a conciliação); subir `api`/`web` pelo compose do easyPanel; rodar `organizar.mjs` (com `--simular` primeiro, mostrando o que vai mover); conferências; e o rollback (imagem + restore do dump) se algo falhar. Tempo estimado de cada passo.
- `homolog/RESULTADO-FINAL.md`, tag `final-entrega-20261020`, bundle, stack `rootos-final` de pé.

## Backlog (já registrado)
Apagar depois, no Predator: as cópias de produção (`C:\Users\User\dev\producao\`), as stacks `rootos-copia` e `rootos-final` com volumes, `homolog/copia/` e `homolog/organizar/` (arquivos com dado real), os `.env` delas e os bundles. Lista exata no RESULTADO-FINAL.
