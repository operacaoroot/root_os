# MK — o módulo de marketing do ROOT OS

> Especificação da frente MK, fatia MK0. Passagem do Pedro em
> `docs/especificacoes/HANDOFF-MK-modulo-de-marketing.md`; decisões dele no vault
> (`60-Decisoes/2026-09-28 — O módulo de marketing segue o app do Lucas`).
> Branch `root-os/marketing-interno`, saindo do `main` `e988cbd`.

Este documento é o inventário e o mapa. Não muda código: as fatias MK1 a MK7 é que mexem.
Ele existe para que cada fatia saiba, antes de começar, **o que já existe no OS, o que entra novo
e o que fica de fora** — e para que a lista de telas repetidas chegue ao Pedro com fundamento.

## De onde vem

O **Marketing OS do Lucas** (`conteudo.operacaoroot.com`, serviço `/opt/marketing-os` na VPS da
Root) foi o protótipo: Node sem dependências, um `server.js` de 15 KB e um `public/index.html` de
218 KB com tudo dentro. Dois papéis (o Lucas e a cliente), um `dados.json` com cópia a cada
alteração. Ele atendeu **uma cliente**, a Dra. Patrícia.

A decisão do Pedro é que a **organização** e o **visual** desse app viram o bloco Marketing do ROOT
OS, para uso interno da Root — e que o que era da cliente fica de fora.

A **máquina de conteúdo** (frente MC) está em produção desde 28/09/2026. O módulo de marketing não a
substitui: encaixa nela. Ideia aprovada no banco vira `PautaPeca` na mesma agenda e na mesma
aprovação da semana; a marca entra nos prompts ao lado da voz. É por isso que quase nada aqui é tela
nova sobre dado novo — é dado novo alimentando a máquina que já roda.

## Como ler o inventário

Cada linha recebe um de três destinos:

- **já existe** — o OS tem, e a fatia reaproveita em vez de duplicar.
- **entra** — não existe; é trabalho de uma fatia MK.
- **fica de fora** — era da cliente, ou não faz sentido interno.

## 1. Inventário — as telas do app do Lucas

O menu do app (`MENU_ADMIN`, em `public/index.html`) tem quatro grupos e dez telas.

| Tela do app | O que é lá | No ROOT OS hoje | Destino | Fatia |
|---|---|---|---|---|
| **Início** | painel do dia: o que espera decisão, o que está agendado | `/central` (seção "A central") faz esse papel para o OS inteiro | **já existe** — o bloco ganha atalhos, não uma segunda home | MK7 |
| **Banco de ideias** | ideias por pilar: título, gancho, roteiro, legenda, CTA, porquê, fontes, formato, prioridade, status, histórico | não existe. `/conteudo` é quadro de produção espelhado no ClickUp; a curadoria da Pauta escolhe **capturas** do mundo, não ideias nossas | **entra** | MK3 |
| **Calendário** | os posts do mês no dia em que vão ao ar | existe: aba **Semana** da Pauta (MC16), com grade da semana, slots por formato, feriados e reagendamento | **já existe** — a ideia aprovada cai nessa agenda | MK3 |
| **Aprovação da cliente** | a cliente aprova, pede ajuste ou recusa | — | **fica de fora** | — |
| **Linha do tempo do projeto** | reuniões, combinados e áudios da cliente, em ordem | `/linha-do-tempo` do OS **é outra coisa**: é o rastro de auditoria (seção "O controle", permissão `auditoria.ver`, filho do Rastro) | **a decidir no MK7** — ver §4 | MK7 |
| **Estratégia do mês** | pilares da vez, cadência, apostas, o que parar | não existe como documento do mês. `/metas` guarda meta semanal (`GoalConfig`/`GoalWeek`), que é número, não estratégia | **entra** | MK4 |
| **Performance** | oito indicadores da conta e de cada post, barras por post e por pilar | não existe para o Instagram da Root. `/instagram` é o módulo da conta; `/relatorios` é relatório de execução | **entra** | MK5 |
| **Relatórios** | o relatório do mês em seis blocos | `/relatorios` existe, mas é do módulo `relatorios`, na seção "A execução" — outro assunto | **entra** | MK6 |
| **Perfil da cliente** | quem é, como se posiciona, números do perfil dela | — | **fica de fora** | — |
| **Concorrentes e referências** | perfis observados: o que fazem bem, o que falta, ideias que rendem | existe pela metade: `/referencias` é o acervo de fichas da Pauta (taxonomia de 8 famílias × 7 objetivos, alimentado pelo acervo do vault) e a fonte `perfil` do Apify já raspa creators | **entra ampliando** — o que falta é **número**: mediana por perfil e índice por post | MK2 |

Fora do menu, o app tem as telas de detalhe **Post** e **Novo post** (o editor). Elas **entram** como
o editor da ideia, dentro do Banco de ideias (MK3).

E tem uma área que o app não expõe como tela, mas a decisão do Pedro nomeia: **Marca**. No app ela
vive espalhada em `pilares` e no perfil. No OS ela **entra** como aba de `/contexto`, que já a
declara pendente no próprio menu ("as abas Marca e Identidade entram nas próximas fatias"). É a MK1.

## 2. Inventário — os dados

O `seed.json` do app tem onze chaves de topo.

| Dado | O que guarda | Destino | Onde passa a morar |
|---|---|---|---|
| `posts[]` | 31 posts com todo o conteúdo e o histórico | **entra** | ideia no Banco (MK3); aprovada, vira `PautaPeca` |
| `pilares` | os pilares da marca | **entra** | MK1, na memória, como a voz (`VozService.bloco`) |
| `estrategias` | a estratégia por mês | **entra** | MK4, documento do mês |
| `concorrentes[]` | 10 perfis, com o que fazem bem e o que falta | **entra** | MK2, sobre a fonte `perfil` do Apify |
| `seguidores` | contagem e data da coleta | **entra** | MK5, snapshot mensal pelo conector Meta |
| `cadencia` | quantos posts por semana, por formato | **entra** | MK4, junto da estratégia |
| `log[]` | o que aconteceu no sistema | **já existe** | RASTRO |
| `reunioes[]` | reuniões com a cliente, com pauta e combinados | **a decidir no MK7** | ver §4 |
| `audios[]` | áudios que a cliente mandava com ideias | **fica de fora** | — |
| `cliente` | dados da Dra. Patrícia | **fica de fora** | — |
| `perfil` | o perfil auditado dela | **fica de fora** | — |

Dentro de `posts[]`, dois campos **ficam de fora**: `decisao` e `comentarios` — são a aprovação
da cliente.

As métricas por post que a Performance usa (`visualizacoes`, `curtidas`, `comentarios`,
`salvamentos`, `compartilhamentos`, `visitasPerfil`, `novosSeguidores`, `pctSeguidores`) **entram**
na MK5. No app elas eram digitadas à mão a partir do Insights; no OS vêm do conector Meta de
leitura, e sem Instagram conectado a tela diz como conectar.

## 3. O que fica de fora, e o que cai junto

Além das telas e dos dados acima:

- **Aprovação pela cliente** — tela `aprovacao`, `applyOp()` com `decidir`/`comentar`, os status
  `aprovacao`/`ajustar`/`recusado`. A aprovação interna que vale é a da **semana**, que já existe.
- **Textos para a cliente** — o `MENU_CLIENTE` inteiro e o papel `cliente` do `config.json`.
- **Auditoria de perfil** — rota `/auditoria/:cliente/:chave`, `serveAuditoria()`, `dados/clientes/`.
- **Regras do CFM** — a seção "O que evitar pelo CFM". O que substitui, internamente, são as regras
  da marca que a MC10 já aplica (`PAUTA_VOZ_REGRAS_DA_MARCA`).

Cai junto uma decisão de arquitetura: **o módulo interno não tem o par admin/cliente**. Some o
`ADMIN_ONLY`, some a senha dupla do `config.json`. Quem pode o quê passa a ser a permissão do OS
(`pauta.ver`, `pauta.editar`, `relatorios.ver`…), como em qualquer outro módulo.

## 4. O que este inventário deixa em aberto

Três pontos que nenhuma fatia MK1–MK6 cobre e que o MK7 precisa fechar:

1. **Linha do tempo.** O app chama assim o histórico do projeto com a cliente (reuniões, combinados,
   áudios). O OS chama assim o rastro de auditoria. São coisas diferentes com o mesmo nome no mesmo
   menu. Internamente, "reuniões e combinados" da Root já têm casa (memória e `/contexto`), e os
   áudios da cliente ficam de fora — então a leitura desta especificação é que **a linha do tempo do
   app não entra**, e o nome no menu do bloco fica com o rastro, que já é do OS. Confirmar com o
   Pedro no MK7.
2. **Início.** O bloco não ganha home própria; `/central` continua sendo a home. O que o MK7 entrega
   é o bloco Marketing no menu, não uma segunda porta de entrada.
3. **A lista de telas repetidas** é entrega do MK7, não deste documento. O que este documento
   adianta é o fundamento dela: pela coluna "No ROOT OS hoje", as candidatas a repetição são
   **poucas** — `/conteudo` (quadro do ClickUp, que não é banco de ideias) e `/metas` (número, que
   não é estratégia). Nenhuma das duas é repetição óbvia. `/pauta`, `/referencias`, `/bio`,
   `/instagram`, `/agenda`, `/linha-do-tempo` e `/relatorios` **não** são repetição: ou são a
   máquina que o bloco usa, ou são outro assunto com nome parecido. **Nada é apagado nesta frente
   sem o Pedro aprovar essa lista.**

## 5. O mapa da nova navegação

O bloco Marketing vive na seção **`sai`** ("O que sai — conteúdo publicado e presença"), que já
existe em `packages/shared/src/nav.ts`. A ordem segue a do app do Lucas, não a de hoje.

```
O que sai
  Pauta                     /pauta            (a máquina: curadoria, episódio, semana, voz)
    Agenda do mês           /pauta  aba Semana
    Referências             /referencias
    Concorrentes            /referencias      aba nova, com números          MK2
  Marketing                 /marketing                                        MK7
    Banco de ideias         /marketing/ideias                                 MK3
    Estratégia do mês       /marketing/estrategia                             MK4
    Performance             /marketing/performance                            MK5
    Relatório do mês        /marketing/relatorio                              MK6
  Link na bio               /bio
  Instagram                 /instagram
  Metas                     /metas

A central
  Contexto                  /contexto
    Marca                   /contexto  aba Marca                              MK1
```

Três decisões de desenho que este mapa fixa:

- **Marca não é tela do bloco.** Ela é contexto da empresa, entra nos prompts como a voz, e o
  `/contexto` já reservou a aba. Pôr marca dentro de Marketing seria escondê-la de quem escreve.
- **Concorrentes fica sob Referências**, não como tela solta: é o mesmo acervo, ganhando número.
- **Agenda do mês não vira rota nova.** É a aba Semana da Pauta, que já é a agenda real, com grade,
  feriados e a aprovação da semana. Duplicá-la seria criar a segunda verdade que a decisão do Pedro
  manda evitar.

O visual do bloco segue o do app do Lucas (fatia MK7). A base é mais próxima do que parece: o OS já
carrega as mesmas duas fontes da marca — JetBrains Mono e Space Grotesk — auto-hospedadas no
`app/layout.tsx`. O que muda são os tokens de cor do bloco e o tratamento de painel e rótulo.

## 6. Verificação desta fatia

MK0 não tem código. Fica pronta quando este documento está commitado e ligado no
`docs/PLANO-MAQUINA-DE-CONTEUDO.md`, e a bateria do handoff passa sem regressão —
`pnpm typecheck` e as suítes, nos pisos do `main` `e988cbd` (api 3068, web 635, policy 97, porta 61,
isolamento 358).
