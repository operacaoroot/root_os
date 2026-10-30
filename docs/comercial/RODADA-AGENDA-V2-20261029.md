# Rodada da Agenda v2 (29/10/2026)

> Pedido do Rodrigo em 29/10/2026: "aprimorar a agenda do ROOT OS e levar para lá todos os mecanismos" que a agenda interna de outro sistema dele já tem (seis rodadas de uso real), "manter a identidade visual da Root", construir na homologação do Predator e "já ir para a produção".
> Desenho aprovado para execução: as seis pranchetas em `docs/agenda-v2/desenho/` (`Main` = Semana e dia com o painel de marcar, `Conflitos`, `Regras`, `Mapa` = os 21 mecanismos em ondas, `Celular` = Lista do dia, `Link` = página pública do cliente). São `.dc.html` de um editor de desenho: leia como HTML, as cores e medidas são as da marca. `antes-semana-escuro.png` é a tela de hoje.
> **Base: a produção viva** = commit `16a92871` (branch `root/precos-openrouter`, imagem `rootos-official:root-precos-openrouter-16a9287`, 29/10 23:53Z), que contém as levas do Lucas de 28 e 29/10. Branch desta rodada: **`agenda-v2/20261029`**, criada a partir dele.
> Esta rodada constrói e prova no Predator. **O Predator não tem acesso à VPS da Root nem ao GitHub da operacaoroot**: quem publica é o orquestrador do Mac, pela cadeia de releases. A rodada entrega tudo pronto para isso (seção "Para publicar" + script), e nada daqui escreve na produção.
> Encerramento: `homolog/RESULTADO-AGENDA-V2.md` + tag `agenda-v2-entrega-20261030` + bundle `C:\Users\User\dev\agenda-v2-delta.bundle` (branch e tag, excluindo `16a92871`) + stacks 3030 e 3031 na imagem `rootos-final-app:agenda-v2`.
> Prazo: às **12:00 de 30/10** nenhuma frente nova abre; o que estiver verde fecha, o resto vai ao RESULTADO com o estado exato.

## As quatro decisões (fechadas pelo Rodrigo em 29/10, "pode executar")

1. **Cópia local da agenda, como cache.** A regra de 24/09 ("não existe tabela de evento") é revista assim: o Google Calendar da `operacao.root@` continua sendo A agenda; o OS guarda um espelho só de leitura, atualizado por sincronia incremental, que ninguém edita. Toda escrita vai ao Google e o espelho reflete. Atualize `docs/AGENDA.md` dizendo isso, com a data e o porquê (a régua, os conflitos e o link público precisam ler a semana inteira sem bater no Google a cada clique).
2. **Marcar pela tela sai no clique.** Caminho honesto, o que o próprio `docs/AGENDA.md` descreve: a capacidade de marcar ganha um desfazer implementado (`agenda.reuniao.desmarcar`, que cancela o evento que o OS criou e avisa os convidados), passa a declarar reversibilidade automática, e a porta passa a ler `aprovacaoR2Ligada` por empresa (campo novo, gravado só por sobrescrita assinada, como o RF-P-06 manda). A sobrescrita vale **só para ator humano na tela**; agente, rotina, WhatsApp e link público continuam com a aprovação de hoje. Editar, arrastar e cancelar seguem a mesma lógica (cada um com o seu desfazer). Se a escada não aceitar algum desses em R2 com desfazer real, ele fica em R3 e o RESULTADO diz qual e por quê. Nunca rebaixe nível no JSON para "fazer passar".
3. **Agenda pessoal de cada sócio como "Fechado".** Sem OAuth novo: cada sócio compartilha a agenda pessoal com a `operacao.root@` como "ver só livre/ocupado"; o OS lê pelo `freeBusy` da API do Google os e-mails cadastrados em Regras (um por sócio, opcional) e desenha `Fechado <Nome>` sem título. Fechado conta na régua; Fechado x Fechado não é choque.
4. **Ondas 1, 2 e 3 nesta rodada.** A onda 4 (WhatsApp do grupo marcando e ferramentas MCP `agenda_livre`/`agenda_marcar`) fica fora; deixe o motor pronto para ela (funções puras no `shared`) e anote no RESULTADO.

## O que já existe e você reaproveita (não reescreva)

- `packages/shared/src/agenda.ts`: `montarTituloDeReuniao`, `lerTituloDeReuniao`, `ehReuniao`, `conferirEvento`. A gramática cresce aqui (tipos novos abaixo); leitura tolerante, escrita estrita, contrato em `apps/web/tests/unit/agenda-padrao.test.ts`.
- `apps/api/src/agenda/` (vigia AG-01, `AgendaConferencia`, `padronizar`, `restaurar`, sobrescrita assinada e o CLI), `apps/api/src/google/google.service.ts` (conector, efeitos no registro), `apps/api/src/pauta/agenda*.ts`, `apps/api/src/implantacao/agenda-da-implantacao.service.ts` (o cartão da implantação lê a próxima reunião: passe a ler do espelho).
- `apps/web/src/app/agenda/` (`page.tsx`, `GradeDaSemana.tsx`, `semana.ts`, `MarcarReuniao.tsx`, `ForaDoPadrao.tsx`), os tokens de tema do app (escuro, papel, claro) e os componentes de `referencias/ui`.
- Política `packages/policy/politica-marketing-os.json` (1.12.0, 83 capacidades), `ToolGateway`, `classificar`/`nivelPorEfeito`, seed `db:seed:politica`.
- Provas: `homolog/e2e/*.mjs`, `homolog/banco-de-teste.sh`, `homolog/fixtures/stub/agenda.vigia.json`, as suítes (`pnpm --filter @mktos/api test`, `@mktos/web test`, `@mktos/policy test`, `test:isolamento`).

## Lanes

### G0 — Base (antes de tudo)

- Confira que a branch está em `16a92871` + este roteiro. Se `homolog/final-20261019` tiver algo que não está aqui, NÃO traga: a base é a produção.
- `docs/AGENDA.md` com as quatro decisões. Uma linha em `homolog/progresso.md` ("Agenda v2 29/10").

### G1 — Espelho e sincronia (onda 1)

- Tabela `AgendaEvento` (por empresa, RLS, `orgId` redundante como as outras filhas): id do Google, agenda de origem, título, início, fim, dia inteiro, local, Meet, convidados (e-mail, papel, resposta), organizador, status, `atualizadoNoGoogle`, título lido pela gramática (tipo, cliente, responsáveis, modalidade), e `AgendaSincronia` (agenda, `syncToken`, última passagem, erro). Migration aditiva.
- Rotina `agenda.sincronizar` (empresa da casa, a cada 2 min, como as outras rotinas: nasce ligada só se o Google Agenda estiver conectado; leitura R0 pela porta): `events.list` com `syncToken`; 410 = ressincroniza a janela (-30 a +180 dias). FreeBusy dos e-mails pessoais da decisão 3 vira linhas `Fechado` (tipo próprio, sem título).
- A tela e o cartão da implantação leem do espelho; se a última passagem tiver mais de 10 min, a tela avisa e cai na leitura direta de hoje. O vigia AG-01 passa a ler do espelho.
- Testes: sync inicial, incremental, 410, cancelado, evento movido, isolamento.

### G2 — A régua (onda 1)

- Motor puro no `shared` (`agenda-regua.ts`), usado pela tela, pela API e pelo link público: recebe os eventos do período, as regras e o compromisso proposto; devolve verde/amarelo/vermelho com as frases. Regras: janela de trabalho, intervalo mínimo, trajeto antes de presencial, teto de reuniões por dia, bloqueio fixo, Fechado, Fora (fecha a agenda do dia), feriado (nacional fecha; facultativo só avisa; municipal cadastrável), rito protegido (pergunta ou bloqueia), mesma pessoa em dois lugares. `sugerir()` devolve os próximos horários verdes. `livres()` alimenta o link público.
- Tabelas: `AgendaRegraPessoa` (por sócio da Equipe; valores do desenho `Regras` como padrão: Rodrigo 08:00–19:00, Lucas 09:00–18:00, Pedro 08:30–18:00, intervalo 15/15/10, trajeto 30, teto 5/4/5, substituto), `AgendaRito` (terça 08:00 1 h "Reunião Interna - Todos" pergunta; quinta 19:30 1h30 bloqueia; primeiro sábado dia inteiro bloqueia; confira em `root-base` ou nas atas se a terça é mesmo 08:00, senão `[a decidir]`), `Feriado` (semeado com os nacionais de 2026 e 2027, facultativos desligados), `AgendaRegraTexto` (frase + ligada; o AG-01 lê; o motor não interpreta texto livre).
- Gramática: tipos novos `Fechado <Nome>`, `<Nome> Fora - <motivo>`, `Pessoal - <Nome>`. "Pessoal" por palavra inteira. Feriado reconhecido pelo nome exato, nunca por sufixo.
- Tela **Regras** (aba), só para quem tem a permissão nova `agenda.regras` (sócios): o desenho `Regras`.
- Testes do motor (um por regra, mais combinações), da gramática nova e da tela.

### G3 — A tela (ondas 1 e 2)

Siga o desenho `Main` e `Celular` na identidade da Root (Space Grotesk no texto, JetBrains Mono em rótulo e número, cor só onde informa: cliente em verde-limão lavado, interna neutra, Fechado tracejado, fora do padrão e atenção em âmbar, choque em magenta, OK em ciano, sempre com palavra junto). Os três temas do app funcionam.

- Abas: **Semana e dia · Lista · Mês · Conflitos · Relatórios · Regras**.
- Semana e dia: colunas por dia, filtro **Quem** (Todos ou um sócio), 1/3/5 dias, botão **Calendário ▾** (meses, dias, hoje; fim de semana abre o próximo dia útil), altura das horas (botões − auto +, Ctrl + roda, guardada no navegador), linha do agora, faixas de Fora e feriado no topo, até três simultâneos lado a lado em terços com o título em duas linhas e, a partir do quarto, "+N" que abre a lista. Coluna limpa enquanto marca: só o compromisso novo em tracejado verde; o semáforo fica no painel.
- **Painel de marcar** fixo à direita da grade (vira folha de baixo no celular): Atalho por frase (intérprete puro no `shared`, sem IA, preenche só o que a frase disse; "14h 30 min" = 14:00 por 30 min), tipo (Cliente, Interna, Bloqueio, Pessoal), modalidade, cliente com busca no Funil e em Clientes (ficha: etapa, contato, quantas vezes esteve na agenda), responsáveis da Equipe, quando, duração (5 min até o fim do dia), título montado pela mesma função do servidor, semáforo da régua, Marcar, "Marcar assim mesmo" no vermelho com motivo, "Mandar link de escolha". Clique no vazio da grade abre o painel ali. Rascunho guardado na sessão.
- Detalhe do compromisso: Editar (mesmo painel), arrastar move, puxar a borda estica (mesma régua, com o próprio evento fora da conta), Cancelar com motivo e "avisar os convidados".
- Lista: padrão até 860 px; o dia com a linha do agora e o botão "entrar no Meet".
- Testes de componente (grade, terços e +N, painel, frase, arrastar) e capturas.

### G4 — Escrita no Google (onda 2)

- Decisão 2 inteira: `agenda.reuniao.desmarcar` (desfazer), reversibilidade declarada, `aprovacaoR2Ligada` por empresa lido pelo `ToolGateway` (campo novo, migration aditiva, gravado só pela sobrescrita assinada; tela de leitura em Configurações), CLI de sobrescrita para a casa no molde do `sobrescrita-da-agenda.cli.ts` com `--valer` e o texto do motivo pronto no RESULTADO. Teste que prova: humano na tela = no clique; agente e rotina = fila.
- `agenda.reuniao.editar`, `agenda.reuniao.cancelar` (com desfazer quando der), Meet na online, convite: cliente e responsáveis como convidados com `sendUpdates=all` (e-mail do responsável vem da Equipe; sem e-mail = aviso nos Relatórios). Escrita idempotente (chave por pedido), resposta do Google guardada.
- Histórico: o que o OS gravou no Google, por quem, com "desfazer" onde existe; lido do AuditLog da porta, sem tabela nova se der.
- Testes com dublê do Google.

### G5 — Conflitos e Relatórios (onda 3)

- Aba **Conflitos** do desenho: o motor da régua sobre os próximos 60 dias + o que o AG-01 achou fora do padrão, numa lista só, ordenada por urgência, filtros por tipo e por sócio, séries agrupadas. Cada cartão traz botões que chamam as capacidades (empurrar para o primeiro horário verde, passar para o sócio livre, remarcar, criar Meet, trocar modalidade, aplicar título, "não é reunião", marcar como confirmado com o cliente, levar o compromisso do feriado para o dia útil seguinte, pular a ocorrência do rito). Botão = mesma porta e mesma regra de aprovação da decisão 2.
- Aba **Relatórios**: compromissos por sócio e por tipo no período, sem Meet, responsável sem e-mail, marcados assim mesmo (com motivo), criados direto no Google (só contagem: é a redundância da casa, não é erro).

### G6 — Link de escolha (onda 3)

- `AgendaConvite` (token aleatório longo, sócio, tipo, modalidade, duração, cliente/lead opcional, validade, uso único, criado por). Página pública no web sem login (`/agendar/[token]`, desenho `Link`): só horários verdes de `livres()`, manhã e tarde, e-mail obrigatório na online, nome preenchido quando o convite tem lead. Confirmar cria o compromisso no padrão (aprovação: a do link público, decisão 2), com convite do Google ao cliente, e mostra "Google Agenda" e `.ics`. Expira, não reaproveita, limite por IP, sem vazar a agenda (só livres).
- Rota da API pública registrada antes do pega-tudo; isolamento por token.

### G7 — Cópia diária

- Rotina 03:00 (empresa da casa): JSON e ICS do espelho (−30 a +180 dias) no armazém de arquivos da empresa (o mesmo S3/minio que o OS já usa), guardando 30 dias. Teste.

### G8 — Provas, imagem e entrega

- Suítes inteiras sem vermelho novo fora da linha de base dos RESULTADOs anteriores; política (só as capacidades declaradas, com a assinatura certa); isolamento (tabelas novas contadas); `tsc` limpo; catraca de arquitetura verde.
- e2e `homolog/e2e/agenda-v2.mjs` na 3031 com dublê do Google (calendário com `syncToken`, `freeBusy`, `insert/patch/delete` que guarda o que recebeu): marcar no clique pela tela; a mesma ação por agente cai na fila; frase preenche o painel; choque aparece em Conflitos e o botão resolve; feriado bloqueia; Fora fecha; Fechado conta; arrastar respeita a régua; link público marca e o convite sai; desfazer volta.
- Capturas (escuro, papel e 390 px) de cada aba em `homolog/provas/agenda-v2-*.png`, comparadas com o desenho.
- Imagem `rootos-final-app:agenda-v2` nas stacks 3030 (sem perder os dados) e 3031.
- Revisor adversarial curto no fim: link público (enumeração de token, vazamento de título, abuso), R2 sem fila só para humano (agente não escapa), sincronia não apaga nada do Google, RLS das tabelas novas, nenhum segredo no diff.
- `homolog/RESULTADO-AGENDA-V2.md` com:
  - **Para publicar**: migrations (nomes, todas aditivas? diga), capacidades novas e nível de cada uma com o `POLITICA_CAPACIDADE_NOVA_*` pronto, a sobrescrita assinada da casa (comando e motivo), variáveis novas, passos de dado (semear regras dos sócios, ritos e feriados na produção), as conferências depois de subir, e o script `homolog/agenda-v2/publicar-na-vps.sh` (NÃO rode) na receita das releases: pasta `/srv/rootos/releases/agenda-v2-<hash7>-<data>/`, backup do banco com sha, `cadeia-antes.txt` lido do label `com.docker.compose.project.config_files` do `mktos_api` vivo, imagem `rootos-official:agenda-v2-<hash7>`, migration à parte, seed da política, `docker compose --project-name root_marketing-os $(cat cadeia-depois.txt) up -d --no-deps --no-build api web`, guarda que volta sozinha se a api não ficar saudável em 3 min, REPORT.txt. O script começa conferindo se a produção ainda está em `16a92871`; se não estiver, PARA e diz qual commit juntar (o Lucas publica direto).
  - **O que fica para o Rodrigo**: cada sócio compartilhar a agenda pessoal como livre/ocupado com a `operacao.root@`; conferir as regras e ritos semeados; ligar a sobrescrita da decisão 2; onda 4; tudo marcado `[a decidir]`.

## Regras duras

As de sempre (`docs/comercial/PASSAGEM-PREDATOR-COMERCIAL.md` §0 e `CLAUDE.md`). Nada em produção daqui. Nada de dado de cliente ou segredo no git, no log ou no RESULTADO (só contagens). Migrations aditivas com RLS. Porta e política não afrouxam para agente. Nada do escritório Cardozo & Saggioro: não há código de outro sistema para copiar; a referência é este roteiro e o desenho. Dependência nova é decisão humana: não adicione pacote. Nunca `docker system prune` nem `taskkill` amplo; o Lastro, o Dify e as outras stacks do Predator ficam quietos; processos `claude` antigos ficam quietos. Pode abrir até 4 subagentes (model opus) em arquivos disjuntos, um por lane. Commit a cada marco, uma linha em `homolog/progresso.md` ("Agenda v2 29/10"). Onde faltar decisão de produto, `[a decidir]` no RESULTADO e siga.
