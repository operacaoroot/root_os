# Leva 5 · adequações de 26/10 (reunião Rodrigo + Lucas + Pedro)

Fonte: transcrição "Reformulação do ClickUp e usabilidade do sistema com Pedro" (26/10/2026) e as respostas do Rodrigo item a item na mesma noite.
Base de código: `main` em 145cba2b (= produção `rootos-official:agente-tarefas-c94f1798`, 26/10 18:55 BRT). Trabalhar numa branch `leva5/<data>` a partir da main; publicar só com OK do Rodrigo.

Regra da casa, igual às levas do Lucas: o conceito não muda, dado nenhum é apagado, cada lane tem desfazer. O que já estava feito em 26/10 (itens 2, 3, 6, 12, 13, 18, 23 da conversa) não entra aqui.

## Lanes

### L1 · Trabalho sem o espelho do ClickUp (item 1)
- O ClickUp não vai mais ser usado. "Todas as tarefas" ainda mostra os 18 status e as listas importadas (Gestão de Temas, Copy, Rotina de stories, Design & Gravação).
- Fazer: as listas importadas do ClickUp saem da visão "Todas" e das contagens do Dia a dia e vão para uma pasta "Arquivo do ClickUp" dentro de Marketing, recolhida por padrão (P-50 já pôs pasta = área). Os status herdados deixam de aparecer como colunas vazias em qualquer quadro.
- Não muda: nenhuma tarefa, status ou lista é apagada (a Produção do Marketing depende do status de algumas). Só muda onde aparecem.
- Onde: `apps/web/src/components/trabalho/TrabalhoView.tsx`, `TabelaDeTarefas.tsx`, `apps/web/src/components/tarefas/TarefasDoDia.tsx`; marcação da pasta pelo mesmo mecanismo de `doComercial` (migration aditiva, coluna nova na WorkFolder).
- Prova: contagem de abertas no Dia a dia = contagem no Trabalho › Todas, antes e depois.

### L2 · Botão direito em todas as telas de tarefa e de lead (item 7)
- Hoje só o Trabalho tem o menu (renomear, copiar ID, mover, mesclar, duplicar, arquivar, excluir, compartilhar) e o histórico só aparece no Registro de ações.
- Fazer: o mesmo `MenuDaTarefa` no Dia a dia, na Caixa › Minhas tarefas, no Financeiro › Tarefas e nas Tarefas do comercial. No Comercial, botão direito no card do lead (funil, lista de leads, propostas) com: abrir, mover de etapa, copiar link da sala, vincular WhatsApp, editar valor negociado, ver histórico. Item "Histórico" em todo menu, abrindo as entradas do `AuditLog` daquela entidade (quem, quando, antes e depois).
- Onde: `apps/web/src/components/trabalho/MenuDaTarefa.tsx`, `apps/web/src/components/tarefas/TarefasDoDia.tsx`, `apps/web/src/app/caixa/AbaMinhasTarefas.tsx`, `apps/web/src/app/comercial/_funil/*`; API: rota de leitura do AuditLog por `entityType`+`entityId` (só leitura, com RLS).
- Não muda: as ações continuam passando pelas mesmas rotas e proteções (mover no funil continua com a segunda assinatura em E8/E9).

### L3 · Implantação vira lista "Onboarding de cliente" (item 8)
- Decisão do Rodrigo: os clientes da Implantação vão para a lista "Onboarding de cliente" (lista 82699f94, pasta Clientes) e ficam lá por enquanto. A subseção Implantação sai do menu e do Dia a dia. O módulo volta no futuro, quando os contratos tiverem padrão (item 9, Rodrigo está montando skills para isso).
- Fazer: script `implantacao-para-lista.js --simular/--valer` que cria (ou atualiza) um card na lista Onboarding para cada trilho ativo (MaisQ, ProMedical, Sr. aGranel, Papeleira e os demais), com o nome do cliente, a etapa atual como etiqueta e o link do trilho na descrição. Menu: `/onboarding` e `/onboarding/bancada` com `oculto: true` em ROTAS_ABSORVIDAS (a rota continua respondendo pelo link). Cartão `ImplantacaoNoDiaADia` sai do Dia a dia. Desfazer: `--desfazer` apaga só os cards criados pelo script (marcados em `metadata.origem = "implantacao-20261027"`) e devolve o menu.
- Não muda: OnboardingTrilho, OnboardingCard e o trilho /e/<token> do cliente continuam existindo e funcionando.
- Onde: `apps/web/src/components/AppShell.tsx` (menu), `apps/web/src/components/tarefas/ImplantacaoNoDiaADia.tsx`, `apps/api/src/onboarding/*`, `tools/` para o script.

### L4 · Painel do lead enxuto (itens 11 e 16)
- Pedido: mais visual, mais objetivo, menos informação. As abas Fio, Dinheiro e Decisões saem da vista. Ficam: **Geral** (nova, primeira tela), **Pendências e sugestões** (nova), Sala, WhatsApp.
- **Aba Geral**: campos no modelo da ficha "Sessão Estratégica" do escritório, adaptados ao que a Root vende (só a estrutura foi copiada; nenhum dado). Blocos:
  1. Quem: Empresa (título), Contato, Tipo de pessoa (PJ/PF), **WhatsApp** (editável, com botão "vincular a contato" que lista as conversas do número da Root sem vínculo), E-mail, Preferências de atendimento.
  2. Origem: Como conheceu (canal, lista fechada: Indicação de cliente, Indicação de parceiro, BNI, Evento, Rede social, Site, Comunidade, Outro), Origem da indicação (texto), Vendedor, Sócio responsável.
  3. Negócio: Produto (Imersão / Operação / Continuidade), Tipo do negócio (pagante, parceria, permuta, repasse), Valor negociado, Quantidade de parcelas, 1ª parcela, Link da proposta, Etapa atual (só leitura, com o botão de mover).
  Cada bloco é um cartão com rótulo pequeno em cima e valor grande embaixo; campo vazio aparece em cinza com "preencher", e vira editável no clique. Nada de texto corrido na primeira tela.
- **Aba Pendências e sugestões**: duas listas. "Falta preencher" (campos vazios da aba Geral, um clique leva ao campo) e "Próximos passos" (as sugestões que o assistente do comercial já gera: mandar proposta, abrir sala, agendar kickoff), cada uma com botão "fazer" ou "marcar como feito". É aqui que a automação deixa de travar o Rodrigo (item 14): o passo que a automação não conseguiu fazer aparece aqui com "fazer à mão" e "subir documento".
- Não muda: os dados do Fio (LeadEvent), do Dinheiro e das Decisões continuam gravados e acessíveis pelo histórico (L2); só saem da primeira tela. As automações que leem a ficha continuam iguais.
- Onde: `apps/web/src/app/comercial/_painel/` (novas `AbaGeral.tsx`, `AbaPendencias.tsx`; `AbaFio/AbaDinheiro/AbaDecisoes` ficam no código, fora das abas), `apps/api/src/comercial/assistente.service.ts` para as sugestões.
- Duas variantes para o Rodrigo escolher na prova (fotos no RESULTADO): A) três cartões lado a lado (Quem · Origem · Negócio) com a etapa como faixa no topo; B) uma coluna de cartões à esquerda e, à direita, a linha do tempo resumida (5 últimos fatos) com o botão "ver tudo". Implementar A; deixar B atrás de um seletor de preferência.

### L5 · Funil mais fluido (item 14)
- Mover lead entre etapas hoje funciona, mas "está bem estranho": o card pisca, a coluna recarrega inteira, o arrasto para E8/E9 não existe.
- Fazer: atualização otimista (o card anda na hora e volta se a API negar), animação curta de 150 ms, sem recarregar a coluna; o menu "mover" lista todas as etapas; para E8/E9 o arrasto abre a confirmação da segunda assinatura em vez de ser bloqueado.
- Não muda: `mover.service.ts` e a regra de aprovação. Só a tela.
- Onde: `apps/web/src/app/comercial/_funil/*`.

### L6 · Motor da Sala do cliente (item 15)
- Pedido: a sala existe no modelo (SalaDoCliente, SalaVersao) mas "não abre" para leads antigos e há lead sem sala; o combinado é a sala nascer no primeiro contato e o cliente acompanhar tudo por ela.
- Fazer: (a) consertar o botão que não abre (conferir `sala-estado.service.ts` e o link do painel); (b) a sala nasce sozinha quando o lead entra no funil ou recebe a primeira mensagem, por um efeito da capacidade já existente (sem capacidade nova se der; se precisar, uma só, R1); (c) script `salas-faltantes.js --simular/--valer` cria sala para os leads ativos sem sala; (d) a sala passa a mostrar para o cliente: etapa atual, documentos trocados, próximos passos e o canal de contato, com as versões gravadas em SalaVersao.
- Não muda: o conteúdo das salas que já existem; a política de quem pode publicar na sala.
- Onde: `apps/api/src/comercial/sala-estado.service.ts`, `reacoes-da-proposta.service.ts`, `apps/web/src/app/s/*` (ou onde a sala pública mora; conferir), `tools/salas-faltantes.js`.

### L7 · Popup do Chat (item 17)
- Ao abrir o Chat no canto inferior: primeira coisa visível é o campo de nova mensagem com as últimas mensagens logo acima (hoje abre no começo e é preciso rolar tudo). O menu dos canais (central · chat · conversas) fica fixo no topo do popup; só a lista rola. A roda do mouse rola o popup quando o cursor está sobre ele e não a página atrás (`overscroll-behavior: contain`, foco na caixa ao abrir). Troca de conversa sem piscar.
- Onde: `apps/web/src/components/AppShell.tsx` (botão e popup), `apps/web/src/app/whatsapp/_caixa/CaixaDoWhatsapp.tsx` (lista e rolagem).
- Prova: e2e abre o popup com 60 mensagens e confere que a última está visível sem rolar.

### L8 · Conexão "Claude (Anthropic)" em Conexões (item 21)
- Hoje a chave da Anthropic só entra por variável de ambiente (`anthropic-env.yml` na cadeia) e a produção já tem uma chave preenchida. O pedido é poder colocar a chave pela tela, como as outras conexões.
- Fazer: `CartaoDeConexao` "Claude (Anthropic)" no Catálogo, com: campo da chave (gravada no cofre, nunca exibida depois), botão "testar" (uma chamada mínima), modelo padrão por função (lista: `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`) e o teto diário de custo já existente (`TetoDeCustoIa`) mostrado ali. A api lê a chave do cofre primeiro e cai para a variável de ambiente se não houver. Registro no AuditLog quando a chave muda.
- Não muda: LLM_PROVIDER e a chave atual seguem valendo até alguém gravar outra pela tela. Nenhuma chamada nova ao modelo fora do teste.
- Onde: `apps/web/src/app/conexoes/CatalogoDeConexoes.tsx`, novo `ConexaoClaude.tsx`, `apps/api/src/integrations/integrations.service.ts`, leitura em `apps/api/src/agents/agent-runtime.service.ts` e demais pontos que leem LLM_PROVIDER (5 arquivos).
- Depois disso (item 22): os agentes passam a sugerir tarefas e preenchimentos. Fica para a leva seguinte, com a chave validada.

### L9 · Provas e fechamento
- e2e `leva5.mjs` cobrindo L1, L4 (as duas variantes, com foto), L5, L7; testes de API para L2 (leitura do AuditLog com RLS), L3 e L6 (scripts em `--simular`).
- `homolog/RESULTADO-LEVA5.md` com "Para publicar": migrations (aditivas), variáveis novas (nenhuma prevista), passos de dado (`implantacao-para-lista.js --valer`, `salas-faltantes.js --valer`), e o que o Rodrigo decide (variante A ou B do painel).
- Tag `leva5-<data>`, bundle `leva5-delta.bundle` (^145cba2b).

## Backlog (decidido em 26/10, não entra nesta leva)

### Próxima grande modificação: banco único de cliente com histórico que não apaga nada (item 25)
Pedido do Rodrigo: tudo o que for alterado fica guardado, para sempre termos o histórico de todo mundo; o modelo citado é o do Nubank (banco imutável, onde nada é apagado e tudo se liga). Direção proposta, para discutir antes de desenhar:
1. **Uma entidade de cliente só.** Hoje o cliente mora em 5 lugares que não se ligam: `Lead` (40 campos, 12 tabelas apontam para ele), `Partner` (26 campos, 4 apontam), `AcordoComercial` (aponta só para Partner), `OnboardingTrilho` (aponta para o card do CRM antigo) e `WhatsAppConversa` (aponta para lead ou cliente). Nasce `Conta` (ou `Cliente`): lead e cliente viram **estados** da mesma conta, e Lead/Partner passam a apontar para ela. Migração em duas fases: primeiro a coluna `contaId` em todas as cinco (aditiva, preenchida por script com diário), depois as telas passam a ler pela conta.
2. **Livro de fatos.** Uma tabela append-only `Fato` (quem, quando, entidade, campo, valor anterior, valor novo, origem: tela/agente/automação/script), escrita por trigger em toda tabela de negócio. Nada é apagado: excluir vira um fato "excluído em". Já existem pedaços disso no banco: `AuditLog` (antes/depois por ação, mas não é universal), `LeadEvent` (o Fio do lead), `EventLog` dos agentes (encadeado por hash, já é imutável) e as versões (`SalaVersao`, `PolicyVersion`, `ContextItemVersion`, `EditorialVersion`). Hoje só 4 tabelas em 158 têm exclusão lógica; as outras apagam de verdade.
3. **Consulta "como estava em"**: toda ficha ganha "ver como estava em <data>" lendo o livro de fatos. É o que o Datomic do Nubank dá de graça; em Postgres se faz com a tabela de fatos + visões.
4. Fora do escopo por agora: trocar de banco. O Postgres com pgvector fica; o padrão imutável entra por cima.
Depende de: Rodrigo e Lucas olharem como o banco está hoje (mapa entregue em 26/10) e fecharem a lista de campos da Conta.

### Demais itens para depois
- Toda tarefa ligada a um cliente ativo, com sugestão ao criar (item 4): junto com a Conta.
- Central de operação ao estilo do hub do FinOps: todas as tarefas, por cliente, quem deve o quê (item 5): junto com a Conta.
- Lead fechado vira cliente com acompanhamento próprio (item 10): junto com a Conta.
- Trocar a foto da rotina (item 19).
- Vincular Instagram e demais canais ao WhatsApp (item 20): o Rodrigo vai detalhar.
- Agentes sugerindo tarefas e preenchimentos (item 22): depois da chave pela tela (L8).
- Simplificar o sistema em torno de Comercial, Trabalho e Financeiro (item 24): diretriz das levas, não um item.
- Padrão de implantação por skills pré-construídas (item 9): Rodrigo está fazendo fora do OS.
- Concorrente vendendo MCP em um dia por R$ 8 a 10 mil: pauta dos sócios, não é do OS.
- Pendentes do catálogo do Lucas ainda abertos: Repetir personalizado (P-18), foto do Google no login (P-29), topo da tarefa no formato do ClickUp (P-30), comparativo L-02 a L-09.

## Fora desta leva, mas na mesma noite
- CI da main vermelho desde 22/10 (typecheck sem memória; schema × migrations fora de sincronia). Rodada própria "CI verde".
- Disco da VPS em 86% depois da remoção das imagens das homologações em 26/10. Cache de build (7 a 17 GB) é o próximo passo sem risco. Backup do banco fora da VPS ainda não existe.
