# ADR-011 · A MEMÓRIA versiona por evento de mudança com projeção

- **Data:** 11/09/2026
- **Situação:** aceita
- **Requisitos:** RF-M-01 (contexto versionado), RF-M-06 (resposta vira nota), e a preparação
  declarada de RF-M-08 (detecção de contradição).
- **Origem da pergunta:** `HANDOFF-DEV/03-ARQUITETURA.md`, seção "8. O que ainda não está
  desenhado" — *"Como a MEMÓRIA versiona. Documento com histórico, ou evento de mudança com
  projeção. Afeta a detecção de contradição (RF-M-08)."* O vault é somente leitura; esta decisão
  mora aqui para viajar junto com o código.

## Contexto

A MEMÓRIA guarda o que o cliente decidiu que é verdade na casa dele: as regras, o dicionário de
dados, as definições escolhidas, o histórico de decisões. É o insumo de toda resposta do OS, e é o
que o grupo de estratégia chama de "mandar contexto para a IA direito".

Duas coisas tornam o versionamento uma decisão de arquitetura, e não um detalhe de tabela:

1. **RF-M-08 pede contradição, não diferença de texto.** "Apontar em vez de sobrescrever" exige
   saber *o que foi afirmado, por quem, com que procedência e quando* — não só que o parágrafo
   mudou. Um `diff` entre duas revisões de um documento responde "o texto é outro"; ele não
   responde "alguém afirmou X em março, e agora alguém afirma não-X".
2. **A base já tem um livro-caixa de mudanças, e ele é encadeado por hash.** `EventLog`
   (`src/gateway/event-log.service.ts`) é append-only, sequencial por empresa, com `prevHash`/`hash`
   e um vocabulário de conteúdo que já nomeia exatamente os campos desta pergunta: `motivo`,
   `estadoAnterior`, `estadoNovo`, `fontes`, `resumo`, `referencia`. `02-CONSTRAINTS` proíbe apagar
   evento do RASTRO. Inventar um segundo registrador de mudanças ao lado dele seria criar uma
   segunda verdade sobre o mesmo assunto — e, pior, uma que ninguém pode provar que não foi editada.

## As duas alternativas, e o único argumento que de fato as separa

**Esta seção não traz medição, e a versão anterior dela dizia que trazia.** Chamava-se "as duas
alternativas, medidas" e não continha um número, um teste ou um dado — o título prometia uma
comparação empírica que nunca existiu. O que há aqui é argumento de desenho, e dois dos três
argumentos originais não sobreviviam ao próprio código desta fatia. Estão corrigidos abaixo, com o
que foi tirado dito por extenso.

### A — Documento com histórico (recusada)

`ContextItem` + `ContextItemRevisao`, onde a revisão é a verdade e a nota é a última revisão.

O que ela tem de bom é real e não vale a pena fingir que não: é o desenho mais simples, a consulta
de histórico é um `findMany` ordenado, e ninguém precisa entender projeção para mexer nela.

- ~~**O histórico não registra intenção.**~~ **FALSO, e retirado.** Nada impede uma tabela de revisão
  de ter `motivo`, `autorTipo`, `autorId`, `sourceType` e `sourceRef` — e a tabela que esta fatia
  IMPLEMENTOU (`ContextItemVersion`) é exatamente essa tabela, com exatamente esses campos. O
  argumento descrevia uma versão empobrecida da alternativa para vencer dela. A intenção é guardada
  nos dois desenhos; o que muda é se alguma coisa a corrobora.
- **Ela cria uma segunda verdade sobre mudança — e o desenho escolhido também cria.** Honestidade
  primeiro: `ContextItemVersion` guarda o corpo inteiro de cada versão, é o segundo livro, e o
  comando de migração do acervo escreve nela **sem evento nenhum** (`semEventoPorque = 'migracao'`).
  A diferença entre os dois desenhos não é ter ou não ter segundo livro: é o segundo livro estar
  **amarrado** ao primeiro. Aqui cada linha de versão carrega `eventoId`/`eventoSeq`, o evento
  carrega `referencia` apontando de volta, e existe uma conferência que compara os dois
  (`GET /memoria/integridade`). Na alternativa não há o que amarrar. É diferença de grau, não de
  natureza, e vale escrito assim.
- **Ela não é à prova de adulteração — e este é o único argumento que separa as duas.** Uma tabela
  de revisão é `UPDATE`-ável como qualquer outra, e nada acusaria. O RASTRO é encadeado: mexer numa
  linha quebra o elo seguinte e `GET /audit/verificar` acusa. Este argumento **só vale porque foi
  entregue**, e a entrega é o que está descrito em "A conferência que sustenta o terceiro
  argumento", logo abaixo. Enquanto nada comparasse a versão com o evento — que era a situação na
  primeira versão desta fatia —, uma alteração direta na linha de versão passava aqui tão
  despercebida quanto passaria na alternativa recusada, e este argumento era uma promessa vestida
  de propriedade.

### B — Evento de mudança com projeção (escolhida)

Toda alteração da MEMÓRIA é **primeiro um evento de mudança no RASTRO que já existe** —
`memoria.item.criado`, `memoria.item.alterado`, `memoria.item.arquivado`,
`memoria.item.restaurado` — carregando o vocabulário da política (`motivo`, `estadoAnterior`,
`estadoNovo`, `fontes`, `resumo`, `referencia`) e a sensibilidade declarada.

Desse evento saem **duas projeções**, e as duas são derivadas:

- `ContextItem` — o estado **corrente** da nota. É o que a busca, a tela e o agente leem. Carrega o
  vetor, porque só o corrente precisa ser encontrado por similaridade.
- `ContextItemVersion` — uma linha por mudança, com o corpo daquela versão, a procedência daquela
  versão e o ponteiro para o evento que a produziu (`eventoId`, `eventoSeq`).

## A conferência que sustenta o terceiro argumento

`GET /memoria/integridade` (`MemoriaService.conferirElos`) percorre as versões desta empresa e
pergunta três coisas por linha:

1. o corpo gravado ainda corresponde ao `contentHash` da própria versão?
2. esse `contentHash` é o mesmo que o evento carimbou?
3. o evento aponta de volta para **esta** versão (`referencia`)?

O que faz a pergunta 2 valer alguma coisa: `MemoriaService` manda o `contentHash` da versão como
`contentHash` **do evento**, e essa coluna entra no hash da cadeia (`EventLogService.encadear`).
Então editar a linha de versão sem tocar no evento é pego aqui; editar também o evento para esconder
quebra a cadeia e `GET /audit/verificar` acusa. Uma fecha o que a outra deixa aberto — e é só por
causa desse par que o terceiro argumento contra a alternativa A é uma propriedade, e não uma frase.

Para as versões **sem** elo, a conferência devolve um diagnóstico, porque "sem elo" tem quatro
significados diferentes e só um deles é acusação:

| diagnóstico | o que aconteceu | como se reconhece |
| --- | --- | --- |
| `expurgado` | o evento venceu e a retenção o apagou | `eventoId` nulo, `eventoSeq` **presente** |
| `migracao` | veio do comando de migração do acervo, que não escreve evento | `semEventoPorque = 'migracao'` |
| `falha_ao_registrar` | a escrita do evento falhou; o rastro não derruba a operação | `semEventoPorque = 'falha_ao_registrar'` |
| `elo_de_volta_nao_gravado` | o evento existe e aponta para cá; só o `update` de volta falhou | achado pela `referencia` |
| `sem_explicacao` | ninguém assumiu esta linha | é o único que reprova |

A distinção entre expurgado e adulterado só existe porque `eventoId` virou **chave estrangeira** com
`ON DELETE SET NULL` (migration `20260911193000_memoria_elo_do_evento`). Sem ela, o primeiro expurgo
por retenção transformaria o campo em ponteiro pendurado: um identificador que não resolve, e nada
para separar "o evento venceu" de "alguém apagou a prova". Prova aparente é pior do que prova
ausente.

**O que a conferência NÃO faz, declarado:** ela ainda não é chamada por `GET /audit/verificar`, que
é onde deveria morar para existir UM lugar onde se pergunta "o rastro fecha?". `src/audit/` e
`src/gateway/` não pertencem a esta fatia; está registrado em FORA DO ESCOPO no relatório, e é uma
chamada de uma linha.

## Decisão

**A MEMÓRIA versiona por evento de mudança, e o que se lê é projeção.** Nenhum caminho muda a
memória sem registrar o evento correspondente no RASTRO; o `ContextItem` e o `ContextItemVersion`
são o que se pode reconstruir a partir dele.

A ordem das escritas é (1) **ler o estado corrente**, montar a mudança a partir dele e gravar item e
versão — tudo numa transação sob o cadeado da empresa; (2) o evento; (3) o elo de volta
(`eventoId`/`eventoSeq` na versão). **Não são uma transação só, e não podem ser:**
`EventLogService.registrar` abre transação própria porque precisa do mesmo cadeado para a sequência
do rastro, e chamá-lo de dentro da nossa pegaria uma segunda conexão esperando um cadeado que só a
primeira solta. Se o passo 2 falhar, **a memória fica gravada e a versão fica sem elo** — é a regra
da casa (o rastro nunca derruba a operação) e a ausência é o sinal: versão sem evento aparece na
consulta de histórico e diz exatamente o que aconteceu, em vez de a escrita do cliente ser desfeita
sem ninguém saber.

Três consequências que são parte da decisão, não efeito colateral:

1. **Procedência é obrigatória, não opcional.** Toda nota nasce com `sourceType`
   (`vault`, `upload`, `promocao`, `operador`, `conector`) e `sourceRef`. Nota sem procedência é
   recusada na entrada — é o que sustenta RF-M-02 lá na ponta ("toda resposta carrega procedência;
   sem dado, declara a ausência").
2. **Não se apaga nota; arquiva-se.** `arquivadoEm` + evento de arquivamento. Apagar contexto é
   apagar a explicação de decisões passadas, e a restauração é um evento como outro qualquer.
3. **`supersedesId` é campo de primeira classe desde já, e é MUITOS-PARA-UM.** É o gancho declarado
   de RF-M-08: quando a detecção de contradição chegar, ela compara afirmação nova com a corrente e
   **liga** uma à outra em vez de sobrescrever. O campo existe agora para que a fatia futura não
   precise de migração de dados sobre uma memória já cheia.

   A primeira versão desta fatia pôs `@unique` no campo, o que fazia a aresta nascer **um-para-um**.
   Está desfeito (migration `20260911193000_memoria_elo_do_evento`), e a decisão fica registrada
   aqui: **duas afirmações novas podem contradizer a mesma regra antiga**, e é o caso comum — a
   regra de desconto contrariada pela ata de abril e de novo pela de agosto. Com o índice único, a
   segunda seria recusada pelo banco no meio da detecção. Apontar, que é o que RF-M-08 promete, é
   muitos-para-um.

   **O que continua não cabendo, decidido e escrito:** uma nota nova que contradiz **duas** regras
   antigas de uma vez. O campo é um só. Quando esse caso aparecer, o desenho é uma tabela de ligação
   (`ContextContradicao`, com as duas pontas e o motivo), e a migração é barata porque esta coluna
   vira linha dela. Não se antecipa agora porque não há consumidor: RF-M-08 ainda não existe em
   código, e tabela vazia com nome bonito é dívida que ninguém revisa.

## O que a decisão custa, escrito antes de doer

- **A projeção pode divergir do evento.** É o custo clássico de CQRS, e ele chegou a se realizar: a
  primeira versão desta fatia lia o estado corrente FORA da transação e só depois pegava o cadeado,
  que protegia apenas a numeração. Duas alterações concorrentes da mesma nota liam a versão 1, a
  primeira gravava a 2, a segunda gravava a 3 **com os dados da 1** — a alteração do meio sumia sem
  evento nenhum dizendo que sumiu, e os dois eventos declaravam `estadoAnterior` na mesma versão 1.
  A cadeia mentia. Medido na revisão adversarial: 12 corridas de duas alterações simultâneas, 12
  perdas. E o teste da época **não pegava**, porque cobrava que a versão da projeção fosse a maior do
  histórico — o que continua verdadeiro justamente enquanto a história mente.

  Contido agora por quatro coisas: a leitura acontece **dentro** do cadeado e quem chama passa uma
  função que monta a mudança a partir do que a transação leu; a versão nasce na mesma transação do
  item; o evento carrega `referencia` apontando para a linha de versão; e existe a conferência de
  `GET /memoria/integridade`. O caso de teste é com **duas conexões** de verdade — uma corrida
  simulada em uma conexão só não teria pegado nada.
- **O RASTRO vence, e a versão sobrevive — dizendo que sobreviveu.** `RastroRetencao` (fatia 3.5)
  apaga evento vencido. `ContextItemVersion` **não** vence: ela é a memória da memória, e o produto
  promete histórico de decisões, não histórico de cinco anos. Depois do expurgo a versão continua
  legível e o que se perde é a *prova encadeada* daquela mudança — não o conteúdo.

  O que mudou: `eventoId` é chave estrangeira com `ON DELETE SET NULL`, então o expurgo **limpa** o
  id e a `eventoSeq` fica. Esse par (`eventoId` nulo, `eventoSeq` presente) é o que distingue
  "expurgado" de "adulterado". Sem ele, o histórico exibiria um identificador que não resolve, e
  ninguém saberia qual dos dois aconteceu.
- **Escrever nota passou a custar duas escritas e um evento.** É caro por linha e barato por uso:
  memória é escrita raramente e lida em toda execução de agente.

## Fronteiras que esta decisão NÃO move

- **Nota é conteúdo externo.** O corpo de uma nota veio do vault, de um envio ou de uma resposta
  promovida — nunca é instrução. Quando a memória alimentar o contexto do modelo, ela passa pelas
  MESMAS funções de cerca, neutralização e marca de procedência de
  `src/agents/context-builder.service.ts` (`blocoExterno`, `neutralizarConteudoExterno`), pelo
  caminho que já existe. Esta fatia **não** abre caminho novo até o modelo, e por isso o inventário
  de cercas da suíte adversarial continua com os três lugares de hoje.

  **Exceção registrada — a voz do autor (MC10, 24/09/2026).** As notas de chave `voz.*` (o perfil
  de voz, `voz.pedro` por padrão) e a nota `pauta.voz.chave` (qual chave a empresa usa) abrem um
  caminho novo até o modelo, fora do `context-builder`: o corpo do perfil entra no system prompt do
  roteiro e das peças da pauta **como instrução de estilo**, por `blocoDeVoz`
  (`apps/api/src/pauta/voz-da-pauta.ts`). O que continua valendo: passa por
  `neutralizarConteudoExterno`, leva uma linha de procedência (`perfil vN · origem · data`), tem
  teto de 4 mil caracteres, entra DEPOIS das regras de formato, de fonte e de link — com um
  cabeçalho dizendo que não as muda — e vem seguido das regras da marca, que o perfil não
  substitui. O que muda: não vai na cerca `blocoExterno`, porque a cerca manda o modelo tratar o
  texto como dado, e um perfil de voz tratado como dado não serve para nada. O inventário de cercas
  do adversarial segue com três.

  A permissão também atravessa: estas notas são lidas com `pauta.ver` e escritas com
  `pauta.editar` (aprender gasta IA e pede ainda `automacoes.executar`), e não com
  `obsidian.ver`/`obsidian.editar`. O que limita o alcance é o prefixo: a chave da voz só pode
  estar sob `voz.`, então quem tem só `pauta.editar` não alcança nenhuma outra nota. A escrita
  continua sendo `MemoriaService` (evento no RASTRO, versão, histórico). **Pendente com o Pedro:**
  confirmar que `pauta.editar` (o papel `analista` inclusive) pode escrever uma instrução que vai
  ao modelo; até lá, é a decisão desta fatia.
- **O corpo não entra no RASTRO, em tamanho nenhum.** O evento carrega a FORMA do corpo (tamanho e
  hash), os hashes e a `referencia`; o corpo mora na versão. A primeira versão desta fatia mandava
  um excerto de 280 letras, o que quer dizer que corpo curto — que é a maioria das regras da casa —
  entrava inteiro, junto com o título e a chave. O argumento que decidiu não é tamanho de payload:
  **o RASTRO é lido com `auditoria.ver` e a memória com `obsidian.ver`**, e o conteúdo do cliente
  não atravessa essa fronteira de permissão sem alguém decidir que atravessa — ainda mais para um
  lugar de onde não se apaga nada depois. Título e chave vão como `sigiloso()`.

  A redundância declarada: para nota da vault, `fontes` publica `vault:<caminho>`, que é a mesma
  informação da chave. `fontes` é procedência, metadado que a casa nunca redige e que RF-M-02 exige.
  Ou seja, a redação da chave protege a nota digitada na tela e não protege a da vault. Está escrito
  para ninguém achar que cobre mais do que cobre.
- **A vault vazia não arquiva a memória.** `projetarDaVault` recusa a volta inteira quando a lista
  vem vazia e há notas vivas daquela origem, e recusa o arquivamento quando ele passa de 20% das
  notas vivas (com piso de 5). `ObsidianService.reindex` recusa antes, na origem, quando a pasta
  existe e não tem nenhum `.md`. O motivo é concreto: `configured` só pergunta se o caminho existe,
  e o `OBSIDIAN_VAULT_HOST` da VPS aponta para uma pasta que a documentação do projeto diz não ser a
  vault real. Antes desta fatia o estrago seria um índice descartável; agora seria o histórico.
- **O vetor não é reconstruído.** A migração do que já existe (`KnowledgeNote`) **copia** a coluna
  `embedding`, em SQL, sem chamar fornecedor nenhum. Vetor é caro e a contagem antes/depois é o
  critério de aceite, não a leitura do código.
- **Desfazer a migração não apaga histórico.** `desfazer-migracao` só alcança nota que NASCEU na
  cópia e que ninguém encostou desde então: origem `vault`, chave com o prefixo, **versão 1**,
  histórico de **uma** linha marcada `semEventoPorque = 'migracao'` e **nenhum** elo com o RASTRO. O
  que não passa nas cinco é preservado e contado na saída do comando. O critério anterior era só
  "origem `vault` e chave com prefixo", que alcançava nota editada depois, nota criada pela projeção
  da vault (que nunca passou pelo comando) e o histórico das duas — contra a consequência 2 deste
  próprio documento.
