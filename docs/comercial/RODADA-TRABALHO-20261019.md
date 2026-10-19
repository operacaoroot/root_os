# Rodada do Trabalho, das pendências e dos contratos — 19/10/2026

> Fonte: ata de 19/10 ("Estrutura de tarefas, aprovações e contratos vivos") + as respostas do Rodrigo às considerações (19/10).
> Branch: `comercial/cockpit-homolog`, sobre a tag `implantacao-entrega-20261019`.
> Ambiente: SÓ homologação. Nada em produção; merge na main é rito da quinta com o Pedro.
> Encerramento: `homolog/RESULTADO-TRABALHO.md` + tag `trabalho-entrega-20261020` + bundle refeito + imagem de pé.

## O que o Rodrigo decidiu (respostas de 19/10)

1. **Kanban da implantação com rolagem LATERAL.** As colunas ficam numa linha só e a tela rola para o lado; "não faz sentido ter coluna na parte de baixo". Isso substitui o "caber todos numa tela espremendo colunas" da rodada anterior.
2. **A ordenação é escolha do usuário**, que depois **salva a configuração de visualização**.
3. **Toda tarefa é vinculada a um cliente**, sempre. O nome da tarefa é **objetivo e imperativo** (verbo + objeto). O cliente NÃO entra no nome, porque é um campo da tarefa.
4. **Contrato encerra à mão**: alguém da casa move para **concluído** ou **desativado** quando ele termina.
5. (Aprovação em um clique: ver lane T7. Decisão pela regra que já vale — nada afrouxa.)
6. **As decisões do comercial vão para Pendências**, unificadas lá.

## Regras duras (as de sempre)

- A porta e a política não afrouxam. Alçada, segunda pessoa, reautenticação e prazo da aprovação ficam como estão. Item de menu sai com `oculto: true` + `ROTAS_ABSORVIDAS`; chave de `SECOES` nunca é renomeada.
- Migração aditiva; tabela nova com `orgId`, RLS FORCE, sentinela/gatilho quando filha; isolamento no inventário. Capacidade nova (se houver) pelo catálogo com `db:seed:politica` + assinatura antes da subida.
- **Não criar uma sexta "verdade" sobre cliente.** Hoje cliente aparece em `ComercialFicha` (com `clienteAtivoEm`), em `Partner` do FinOps e no que a transação de fechamento escreve. Para o vínculo da tarefa (T4), reusar o cadastro que o fechamento JÁ cria; só se nenhum servir, criar a entidade, e registrar o porquê no RESULTADO.
- Commits ≤30 min; máx. 2 lanes em paralelo; linha em `homolog/progresso.md` por marco ("Rodada trabalho"); bundle refeito nos 10 primeiros minutos de cada rodada; revisor adversarial antes da imagem final. Provas Playwright + screenshots escuro/claro/390px por tela mexida.

## Lanes

### T1 — Implantação numa tela só, com rolagem lateral
- O item de menu **"Implantação de clientes" passa a abrir o kanban denso da lista "Onboarding de cliente"** (pasta Clientes). A bancada antiga `/onboarding` deixa de ser porta: a rota redireciona para o kanban; o **trilho vira uma aba do pop-up da tarefa** (T2) do card do cliente.
- **Layout do kanban (vale para TODO quadro do Trabalho, mesmo componente):** as colunas ficam **numa linha só, com largura fixa** (referência ClickUp: ~250px no médio, ~210px no compacto) e o quadro **rola para o lado** (`overflow-x: auto`, barra lateral visível, roda do mouse com Shift e arrasto do trackpad). **Nunca quebrar coluna para baixo.** A rolagem vertical por coluna continua. Atalho opcional: chips de etapa no topo que levam até a coluna (como o funil).
- **Sai o "Novo cliente na esteira (fase 0)"** e o "+ adicionar" da lista de onboarding: o cliente nasce do contrato assinado no funil (6ª escrita do fechamento, já entregue).
- **Porta única para quem fechou fora do sistema** (clientes já assinados antes do OS, indicação direta): fica NO COMERCIAL, como ação "Registrar cliente já fechado" (lead + contrato anexado → mesma transação de fechamento, mesma proteção dela). Nunca na implantação.
- Se o clique em todo o retângulo não funcionar em algum quadro, é defeito: a prova cobre clique fora do título (canto do cartão, rodapé) em todas as densidades.

### T2 — Um pop-up de tarefa só, em todo lugar
- Componente único de tarefa **por cima da tela atual**, com estado na URL (`?tarefa=<id>`; voltar do navegador fecha; foco preso e devolvido; Esc fecha; celular = folha), no mesmo padrão do painel do lead.
- Usado em: **Pendências** (aba Atividade e Decisões), **Minhas tarefas**, **Trabalho** e **Implantação**. Hoje Pendências e Minhas tarefas levam a outra tela (`/trabalho?tarefa=…`): passam a abrir o pop-up sem sair de onde está.
- **O retângulo inteiro do item é clicável** (linha da atividade, linha/cartão da tarefa). Ações internas (Limpar, mover, links) param a propagação.

### T3 — Vistas salvas em Minhas tarefas (e no quadro)
- O usuário escolhe **ordenação** (qualquer coluna: vencimento, status, cliente, lista, prioridade, criada em; crescente ou decrescente), **agrupamento** (nenhum · vencimento no estilo ClickUp: Atrasadas › Hoje › Amanhã › Esta semana › Depois › Sem data · status · cliente · lista), **colunas** e **filtros**.
- **Salvar como vista** com nome, marcar uma como **padrão**; trocar de vista num seletor no topo. Guardado **no servidor por usuário** (tabela nova, RLS), para acompanhar a pessoa em qualquer computador. A preferência atual em localStorage migra para a vista padrão na primeira vez.

### T4 — Toda tarefa ligada a um cliente; nome imperativo
- Campo **cliente obrigatório** em toda tarefa NOVA: criação na tela, aceite de sugestão de ata, "virar tarefa" da ideia do cliente, card do fechamento (já vem com o cliente). Seletor com busca.
- **Cliente "Root (interno)"** para o que é da casa (pastas Administrativa e Gestão), para a regra valer sem exceção.
- Tarefas antigas sem cliente: **não bloqueiam** edição; aparecem com o selo "sem cliente" e um filtro para limpar.
- Coluna e filtro **Cliente** em Minhas tarefas e no quadro; o cliente aparece no cartão (densidade média e cheia) e no pop-up.
- **Padrão de nome: verbo no imperativo + objeto**, curto ("Enviar proposta revisada", "Marcar kickoff", "Instalar o kit"). O formulário mostra a dica; a IA das atas e das ideias propõe nesse formato. Não validar por regex (seria frágil); só orientar.

### T5 — Atas: a sugestão vira tarefa editável
- No aceite da sugestão, tudo editável antes de criar:
  - **título** (pré-preenchido no padrão imperativo);
  - **o que será executado** (descrição; pré-preenchida com o trecho da ata, que continua guardado como procedência);
  - **responsável** num seletor dos **perfis reais da empresa** (Rodrigo, Pedro, Lucas e quem mais estiver no organograma) — hoje é texto livre e não atribui a ninguém;
  - **cliente** (T4, obrigatório);
  - **pasta › lista** em dois níveis;
  - **vencimento**.
- A IA continua só propondo; nada vira tarefa sem o clique de gente.

### T6 — Motor Comercial sem "Decisões"; decisões em Pendências
- Menu do Motor Comercial, itens soltos nesta ordem: **Funil vivo · Contratos vivos · Simulador de WhatsApp · Torre das automações · Relatório da semana**. "Decisões do comercial" sai (`oculto` + `ROTAS_ABSORVIDAS`); `/comercial` redireciona para `/comercial/funil`.
- **Pendências unifica as decisões**: os itens da fila de decisões do comercial (manter preço, liberar proposta, etc.) aparecem em Pendências, numa seção/aba "Decisões", com os mesmos botões de um toque (reusar `_decisao.tsx`); contador no topo. A regra de cada decisão não muda.

### T7 — Aprovações: decidir sem trocar de tela
- **Nível médio (R2/R3):** o botão **Aprovar fica na própria linha**. Quando o conteúdo exato cabe na linha (mover etapa com destino conferido, publicar a sala versão N), um clique aprova. Quando o conteúdo é longo (texto de WhatsApp, proposta), o clique na linha expande o conteúdo NO LUGAR e o Aprovar fica ali, sem navegar. O servidor segue conferindo o hash.
- **Nível alto (R4):** a regra exige o titular e a senha: o clique abre a caixa de senha **no mesmo lugar**, e "Aprovar" vai junto com a senha. Não existe um clique só aqui, por regra.
- **Vencidas:** não se aprovam (o prazo protege contra decisão velha executando fora de contexto). Ganham o botão **"Pedir de novo"**: recria o pedido com o conteúdo atual num clique, para a outra pessoa aprovar.
- Ligar a limpeza das vencidas (`expirarVencidas`) numa rotina diária: hoje ninguém chama, e a fila acumula pedidos mortos.

### T8 — Contratos vivos
- **Painel no topo** com contagens: **Ativos · Em implantação** (ativo com card de implantação aberto, só informativo) **· Concluídos · Desativados**.
- **Lista**: ativos primeiro, **concluídos e desativados sempre por último**; **busca** por nome e CNPJ; **filtros** por situação, produto e sócio da conta.
- **Encerrar à mão** (decisão 4): ações **"Concluir contrato"** e **"Desativar contrato"**, com **motivo obrigatório**, registradas no fio do lead e na auditoria. Classificar o nível pelo efeito (`nivelPorEfeito`). Se houver parcela em aberto no Asaas, **avisar** na hora de concluir/desativar e NÃO cancelar a cobrança sozinho (fica [a decidir] pela mesa).

### T9 — Provas e fechamento
- e2e `homolog/e2e/trabalho.mjs`: menu Implantação abre o kanban; colunas numa linha com rolagem lateral (nenhuma coluna abaixo da outra a 1280 e 1440); clique no canto do cartão abre o pop-up; Pendências e Minhas tarefas abrem o pop-up sem sair; vista salva criada, marcada padrão e reaplicada após recarregar; tarefa nova exige cliente; sugestão de ata editada (título, descrição, responsável perfil, cliente, lista) e aceita; menu comercial sem Decisões e decisão tomada pela Pendências; aprovação R3 na linha, R4 com senha inline, vencida "pedir de novo"; contrato concluído com motivo vai para o fim da lista e o painel recontado.
- `ux-painel.mjs`, `painel.mjs` e `implantacao.mjs` continuam verdes.
- `RESULTADO-TRABALHO.md`, tag `trabalho-entrega-20261020`, bundle, imagem de pé.

## O que esta rodada NÃO decide
- Cancelar cobrança no Asaas ao desativar contrato.
- Unificar de vez as entidades de cliente (só reusa a que existe; a unificação é ADR para o Pedro).
- Apagar as telas antigas (`/onboarding`, `/comercial` de decisões): ficam vivas atrás do redirecionamento.
