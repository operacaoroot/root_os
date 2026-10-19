# Rodada da implantação e da publicação — 18/10/2026 (noite)

> Fonte: ata de 18/10 (trecho da implantação) + mockup aprovado pelo Rodrigo no canvas "Implantação e Sala do Cliente" (5 pranchetas, descritas abaixo em texto — o canvas não é acessível desta máquina).
> Branch: `comercial/cockpit-homolog`, sobre a tag `painel-entrega-20261018`.
> Ambiente: SÓ homologação (Docker `rootos-comercial`). Nada em produção; merge na main é rito da quinta com o Pedro.
> Encerramento: `homolog/RESULTADO-IMPLANTACAO.md` + tag `implantacao-entrega-20261019` + bundle refeito + imagem da homolog de pé.

## O pedido do Rodrigo, nas palavras dele

Implantação de clientes: "UI e UX estão uma merda; dá para melhorar muito". Caber mais status na tela; diminuir as tasks; clicar em qualquer parte da tarefa para abrir; acessar a última movimentação ou o último comentário sem nem clicar na task; rolar a tela de cada status separadamente; e **a task tem que ser aberta lá assim que o contrato for fechado na sessão estratégica do comercial**. A sala é publicada e aberta para o cliente ver, com motor de publicações. As propostas também são publicadas; nos relatórios do comercial ele quer ver **quantas vezes a pessoa acessou o link e quais as ideias dela**.

## Regras duras (as mesmas das rodadas anteriores, mais três)

- A porta e a política não afrouxam. Capacidade nova entra pelo catálogo com `db:seed:politica` + assinatura `POLITICA_CAPACIDADE_NOVA_*` ANTES da subida, como o delta 1.8.0 fez.
- Migração aditiva; tabela nova com `orgId`, RLS FORCE, sentinela/gatilho quando filha (`FILHOS_COM_ORGID_REDUNDANTE` atualizado); isolamento no inventário.
- **Entrada do cliente é dado não confiável.** Reação e anotação da proposta chegam por rota pública com token: limitar tamanho (anotação ≤ 1.000 caracteres), rate-limit por token (mesmo padrão do link do onboarding), varrer segredos, texto NUNCA vira instrução — se algum dia for a prompt, vai cercado como o resto. Visita e leitura nunca executam nada.
- **Idempotência nas escritas do fechamento**: rodar duas vezes não duplica card, como as cinco escritas existentes.
- Commits ≤30 min, máx. 2 lanes em paralelo, linha em `homolog/progresso.md` por marco ("Rodada implantação"), bundle refeito nos 10 primeiros minutos de cada rodada. Baseline de vermelhos do Windows não é desta rodada.
- Identidade do OS (tema escuro, `--os-ac #9bdb1f`, mono + grotesk). Texto de tela em PT-BR direto. Provas Playwright + screenshots escuro/claro/390px por tela mexida.

## Lanes

### I1 — o card nasce do fechamento (a ponta mais importante)
- A transação de fechamento ganha a **sexta escrita**: criar o card do cliente na lista **"Onboarding de cliente"** (pasta Clientes, da estrutura sugerida da rodada do painel; se a empresa não tiver a estrutura, criar pelo mesmo `POST /trabalho/estrutura/sugerida` dentro da transação).
- Dados copiados do lead (nome, empresa, contatos, produto, valor) — nada redigitado. Retrolinks nos dois sentidos: card ↔ lead ↔ trilho (`OnboardingTrilho.cardId` já existe; usar). Procedência gravada no card ("criado pelo fechamento · <data>") para a tela mostrar o selo.
- Evento no fio do lead (`implantacao.card_criado`). Idempotente: fechamento re-executado encontra o card e não duplica.
- As etapas da lista "Onboarding de cliente" passam a ser as do mockup aprovado: **Fechado no comercial → Kickoff marcado → Kit montado → Contexto carregado → Imersão → Operação assistida → Encerrado** (atualizar o modelo `onboarding-de-cliente` de `MODELOS_DE_LISTA`; lista já criada em homolog: migrar as etapas pelo caminho normal de edição de lista, sem apagar tarefa).

### I2 — o kanban denso (prancheta 1 do mockup)
Vale para a visão Quadro do Trabalho inteira; a Implantação é o caso de prova. O mockup, em texto:
- **Densidade**: seletor compacto/médio/cheio no topo (preferência em localStorage). No compacto o cartão tem ~64px: linha 1 = nome em 13px bold + dias na etapa à direita (mono 10px; `statusDesde` já existe; >5 dias em magenta); linha 2 = próxima ação em 11,5px, uma linha com reticências; rodapé = **última movimentação ou último comentário** em mono 10px ("Pedro · moveu · há 2h" / "Marina · 'mandei os acessos' · há 1d") — lido da MESMA projeção de auditoria/`WorkComment` que a caixa de entrada consome (não criar segunda fonte).
- **Colunas estreitas**: grid de colunas iguais, 7 etapas visíveis em 1440px; cabeçalho = nome mono 11px + contagem + WIP (`3/2` em magenta quando estoura); coluna de saída (Encerrado) esmaecida.
- **Rolagem por coluna**: cada coluna com `overflow-y` próprio e altura da viewport; a página não rola inteira (mesmo padrão que o funil ganhou na rodada do painel; reusar).
- **Clique em qualquer ponto do cartão abre** o painel/ficha (cartão inteiro é o alvo; ações internas param a propagação; acessível por teclado: cartão focável, Enter abre).
- **Parar o mouse** (ou focar) mostra um balão com os 3 últimos passos + o último comentário, com "clique abre o painel" no rodapé — posicionado sem sair da tela, `aria-describedby`, some com Esc.
- Filtros no topo: todos/meus/atrasados + busca por cliente.

### I3 — o motor de publicação da sala (pranchetas 2 e 3)
- A sala (`/s/<token>`) passa a ser **publicada por versão**: a bancada monta o rascunho (estações, próximos passos com dono e data, itens publicados, combinado, quem cuida da conta) e **publicar** é capacidade nova **R3 `comercial.sala.publicar`** pela porta (segunda pessoa aprova em /atendimento, como toda publicação da casa). O cliente só vê a última versão publicada; rascunho nunca vaza.
- Conteúdo da versão (mockup): cabeçalho com nome da sala + selo "no ar · versão N · <data>" + "link privado · sem login"; **Onde estamos** (estações Conversa→Acordo→Kickoff→Contexto→Frente rodando, feitas/atual/futuras, com data nas feitas — derivadas do fio/trilho, nunca inventadas); **Próximos passos** (o quê · quando · com quem); **Publicado para você** (proposta com estado, contrato com estado, roteiro do kickoff, kit "chega após o kickoff" esmaecido); rail com **O combinado** (resposta em 4h úteis, horários 08:30/13:00/18:00, Claude do 1º mês), botão do WhatsApp (número = placeholder [NÚMERO DA ROOT], decisão pendente da mesa) e **quem cuida da conta**; rodapé "cada visita sua fica registrada…".
- **Celular** (prancheta 3): uma coluna, estações na vertical, próximo passo, publicados, botão WhatsApp fixo embaixo com alvo ≥48px.
- Visita já é medida (POST visita da rodada UX); cada visita vira fato no fio e conta no relatório (I5). Tabela da versão: nova, filha do lead, RLS + sentinela.

### I4 — a proposta publicada mede leitura e colhe ideias (prancheta 4)
- A página da proposta do lead (a que a sala linka) ganha, por seção: **registro de leitura** (seção vista + tempo, agregado por acesso; sem dado pessoal além do token) e a **barra de reação**: `faz sentido` · `tenho uma dúvida` · `anotar uma ideia` (chips; a anotação abre caixa de texto). Visual do mockup: blocos `// 01 · O QUE VAMOS MONTAR`, `// 02 · COMO FUNCIONA`, `// 03 · INVESTIMENTO` (preço grande em lima, quadro de custos de terceiros com mês normal/pior mês/Claude do 1º mês), anotação enviada aparece dentro da seção com selo "a sua anotação · enviada <hora>"; rail com resumo + "aceitar a proposta" + "falar no WhatsApp" + contador "N anotações · N dúvidas".
- Gravação: tabela **`LeadReacao`** (filha de Lead: seção, tipo, texto ≤1.000, instante, origem token; RLS + sentinela + gatilho) + fato no fio (`proposta.reagida` / `proposta.ideia` / `proposta.lida` com seção). Rota pública com as travas das regras duras.
- Na bancada: a reação aparece no painel do lead (aba Fio) na hora.

### I5 — relatório do comercial: bloco Leitura e reação (prancheta 5)
- Tiles: propostas vivas · acessos a propostas · visitas às salas · ideias recebidas.
- Tabela **Leitura por lead**: lead · enviada · acessos · último acesso · seção mais lida · ideias · situação acionável (chips: "leu 3× sem responder · FUP 1 preparado" em magenta; "respondeu" em lima; "não abriu · reenviar?" apagado). O N do "leu sem responder" fica **[a decidir]** pela mesa — usar 3 como provisório marcado; o gatilho PREPARA o FUP pelo fupeiro/relógio (humano envia, R3 segue).
- **Ideias deixadas pelos clientes**: cartões com lead · seção · hora · texto, e ações de um clique: **responder** (abre o painel na aba certa) e **virar tarefa** (cria WorkTask com procedência e trecho, mesmo padrão das sugestões de ata — rascunho aceito por gente, aqui direto porque quem clica é gente).
- Fontes: os eventos de I3/I4 + a visita da sala. Nenhum número escrito por modelo.

### I6 — integração e provas
- e2e `homolog/e2e/implantacao.mjs`: fechamento de teste cria o card na lista certa com selo e retrolinks (rodar 2× não duplica); o card aparece no kanban compacto com rodapé de movimentação; hover/foco mostra o balão; mover de coluna funciona; sala publicada v1, editada, v2 com aprovação de segunda pessoa, cliente vê só a v2; reação + anotação pela rota pública aparecem no fio, no relatório e viram tarefa; screenshots escuro/claro/390 (`implantacao-*.png`).
- Seed da homolog ganha o cenário (Alicerce fechada → card; reações de exemplo) para a tela demonstrar.
- `RESULTADO-IMPLANTACAO.md` com o que entrou, o que ficou de fora, decisões expostas; tag `implantacao-entrega-20261019`; bundle.

## O que esta rodada NÃO decide
- O número de WhatsApp da Root e a plataforma (o botão usa placeholder).
- O N do "leu sem responder" e se reação do cliente dispara aviso no WhatsApp da mesa (preparado, não enviado).
- Expor a sala em domínio próprio (sala.operacaoroot.com) — fica atrás do token na homolog.
