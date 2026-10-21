# A agenda da Root no ROOT OS

> Decidido em 24/09/2026. Tela `/agenda`, conta `operacao.root@gmail.com`.

A agenda da Root **é** o Google Calendar da conta `operacao.root@gmail.com` — o
mesmo que toca o celular dos sócios e manda o convite para o cliente. O OS não
guarda reunião nenhuma em banco: não existe tabela de evento, e isso é decisão,
não pendência. Uma cópia local seria uma segunda verdade, pronta para divergir
no primeiro evento que alguém mexer pelo telefone.

O que o OS acrescenta é o **padrão de nomenclatura** e a garantia de que ele é
cumprido por quem marca por aqui.

## O padrão

| Caso | Forma | Exemplo |
| --- | --- | --- |
| Reunião de cliente | `Reunião <Online\|Presencial> - <Cliente> - <Responsável>` | `Reunião Online - Andrade Peças - Pedro` |
| Reunião interna | `Reunião Interna - <Sócio ou Todos>` | `Reunião Interna - Todos` |

- **A interna não declara modalidade no título.** Ela existe no formulário (é
  ela que decide o link do Meet), mas não entra na linha: entre nós, ela não
  muda o que o título precisa dizer.
- **Responsável** é um sócio, ou `Todos`.
- **Reunião online nasce com link do Google Meet**, criado junto com o evento.
  Presencial não ganha sala — ganha o campo de local.

A gramática mora em **um lugar só**: `packages/shared/src/agenda.ts`.
`montarTituloDeReuniao()` escreve, `lerTituloDeReuniao()` desmonta, e as duas são
usadas pela tela, pela API e pela leitura. O contrato está travado em
`apps/web/tests/unit/agenda-padrao.test.ts`.

A **leitura é tolerante e a escrita é estrita**: ler aceita travessão, acento
faltando, espaço sobrando e a variante antiga sem responsável; escrever só
produz a forma canônica. O que não couber em forma nenhuma aparece na tela como
**fora do padrão**, em âmbar e com o título cru — é assim que o combinado
sobrevive, porque padrão que ninguém vê ser quebrado morre em duas semanas.

## As capacidades

| Capacidade | Nível | Rota | O que faz |
| --- | --- | --- | --- |
| `comunicacao.agenda.listar` | R0 | `GET /google/calendar` | os próximos N eventos (cartão do painel) |
| `comunicacao.agenda.periodo` | R0 | `GET /google/calendar/periodo?de=&ate=` | um intervalo, com o padrão já desmontado e o link do Meet — é o que a tela desenha |
| `agenda.reuniao.marcar` | R3 | `POST /google/calendar/reuniao` | marca no padrão: **não aceita título** |
| `agenda.evento.criar` | R3 | `POST /google/calendar/event` | o que **não** é reunião (bloqueio de agenda, viagem); título livre |
| `agenda.evento.padronizar` | R3 | `POST /agenda/padronizar/:eventoId` | põe UM evento no padrão: troca só o título, acrescenta o Meet na reunião online e guarda o título antigo na 1ª linha da descrição. Nunca apaga, nunca muda horário nem convidados. Proposta pelo vigia (abaixo) |

O detalhe que faz o padrão valer para todo mundo: `agenda.reuniao.marcar` não
tem campo `titulo` no `argsSchema`, e `additionalProperties: false` recusa um que
apareça. O título nasce dentro do conector. Um agente chamando a capacidade pela
porta recebe o mesmo tratamento que a tela.

## O que a tela mostra

- o mês inteiro do calendário, colorido por natureza: cliente online (brand),
  cliente presencial (good), interna (neutra), fora do padrão (âmbar);
- filtros por clientes / internas / fora do padrão, com a contagem do que está
  fora;
- o dia escolhido por extenso: horário, cliente, responsável, modalidade, Meet,
  convidados e o link para abrir no Google;
- o formulário de marcar, com a **pré-visualização do título** — a mesma função
  que o servidor usa para gravar.

Ver exige `dashboard.ver`; marcar exige `agenda.editar`.

## A fricção conhecida: R3 pede outra pessoa

Marcar reunião é escrita fora do OS e está classificada como **R3**, igual às
outras escritas do Google. Na prática: a ação **não sai no clique** — vai para a
fila de `/atendimento` e precisa da confirmação de **outra pessoa** com alçada
(quem propõe não pode aprovar, invariante 7 da escada). A tela diz isso antes e
depois do clique, e leva até a fila.

Se um dia a Root decidir que marcar reunião deve sair na hora, o caminho honesto
**não** é mexer no efeito declarado: é R2 com a aprovação configurável desligada
para a empresa (`aprovacaoR2Ligada: false`), por sobrescrita de política
assinada — com data, responsável e motivo, como manda o RF-P-06. Rebaixar o nível
no JSON para conseguir o mesmo efeito é o caminho que a régua existe para
impedir.

## Ao subir para produção

O catálogo do repositório **não** muda a régua da produção sozinho: quem decide
lá é a `PolicyVersion` do banco. Capacidade nova exige a assinatura da categoria:

```bash
POLITICA_CAPACIDADE_NOVA_AUTOR='<quem>' \
POLITICA_CAPACIDADE_NOVA_MOTIVO='agenda da Root: comunicacao.agenda.periodo e agenda.reuniao.marcar' \
  pnpm --filter @mktos/api db:seed:politica
```

Sem rodar o seed, as duas rotas novas respondem **403 — "não está no catálogo
desta empresa"**: capacidade sem classificação vale o nível máximo, e o OS não a
executa. Vale para as duas, inclusive a leitura do mês.

## O vigia da agenda (AG-01, 21/10/2026)

Marcar pelo OS garante o padrão; marcar pelo celular, não. O vigia é o que
segura o resto: a cada 15 minutos ele confere as reuniões da agenda da Root e
propõe a correção de quem saiu do padrão. Código em `apps/api/src/agenda/`,
regra em `packages/shared/src/agenda.ts`, linha `AG-01` do cadastro
(`packages/shared/src/agentes.ts`: Haiku 5.5, esforço baixo).

### A rotina

- Tipo **`agenda.vigia`**, slug `vigia-da-agenda`, cron `*/15 * * * *` em São
  Paulo. Nasce **só na empresa da casa** (slug da plataforma, `root`: a mesma
  pergunta do `ObsidianService.exigirEmpresaDaCasa`, em
  `apps/api/src/tenants/empresa-da-casa.ts`), na primeira vez que alguém abre
  `/agenda` (a lista `GET /agenda/fora-do-padrao` semeia a rotina). Em outra
  empresa a rotina não é semeada e a passagem, se chamada, é `pulada` sem ler
  nada: a agenda que o vigia confere é a da conta Google da casa.
- **Nasce DESLIGADA** (`ativo: false`, `planejado`), como as outras rotinas da
  casa que escrevem fora do OS (o cobrador de tarefas, a coleta da pauta):
  quem liga é gente, em `/rotinas`. Até a revisão adversarial de 21/10/2026 ela
  nascia ligada, em `aprendendo`, e em qualquer empresa que abrisse `/agenda`.
  Ligada, ela só LÊ (R0) e PROPÕE; toda escrita é R3 e fica retida na fila; a
  deduplicação impede repetir proposta; e há teto por passagem (10 chamadas de
  modelo, 10 propostas à porta), então a primeira passagem numa agenda
  bagunçada não enche a fila de uma vez. A passagem sem nada novo é `pulada` e
  nem vira linha de histórico.
- **Só o que a própria agenda organizou.** Evento cujo organizador não é a
  agenda lida (`organizer.self` do Google não verdadeiro: um convite de outra
  pessoa) não ganha proposta nem pendência: a conferência fica `resolvido` com
  o motivo "quem organizou o evento não é esta agenda", gravado uma vez. O
  efeito de `agenda.evento.padronizar` pede `organizer` no GET e recusa o mesmo
  caso, mesmo que alguém monte o pedido à mão.
- **Só age na empresa com Google conectado**, e pergunta isso ao conector, não
  à variável: primeiro o interruptor do Google Agenda (`gcal`, em Conexões),
  depois a sonda do contrato de conector do Google. Desligado ou não
  conectado: `pulada`, nada é lido.
- Ligar: em `/rotinas`, a rotina "Vigia da agenda (AG-01)" da empresa da casa.
- Desligar: pausar a rotina em `/rotinas`, ou desligar o Google Agenda em
  Conexões (cala a leitura e a escrita), ou `ROTINAS_CRON=off` (cala todas).

### O que ela faz em cada passagem

1. Lê pela porta (`comunicacao.agenda.periodo`, R0, como sistema, ator
   `vigia-da-agenda`) os eventos de **ontem a +60 dias**.
2. **Qual evento é reunião** (`ehReuniao`): tem convidado além de quem marcou,
   ou link do Meet, ou o título fala em reunião, call, conversa ou kickoff.
   Bloqueio pessoal e lembrete sem convidado ficam fora; cancelado, também.
3. **Conferência estrita** (`conferirEvento`): o título tem de ser exatamente o
   que `montarTituloDeReuniao` escreveria, o responsável tem de ser Rodrigo,
   Lucas, Pedro ou Todos (escrito no título, não completado pela leitura), e a
   reunião online tem de ter Meet. A tela usa a mesma régua: o que é âmbar no
   calendário é o que o vigia acha fora; compromisso que não é reunião fica
   neutro.
4. Fora do padrão, **novo ou mudado** desde a última passagem:
   - a **gramática** conserta sozinha o que dá (título legível com cliente e
     responsável escritos, faltando só a forma canônica e/ou o Meet);
   - o resto vai ao **modelo** (AG-01), com o título, a descrição e o local
     **cercados** (`blocoExterno`: texto de terceiro é dado, nunca ordem), os
     clientes e leads ligados aos convidados pelo e-mail (exato, depois pelo
     domínio da empresa; nunca por gmail e afins) e os sócios presentes pelo
     e-mail da casa. O e-mail de fora não vai inteiro ao prompt, só o domínio;
   - **a peneira decide, não o modelo** (`propostaSegura`): gramática estrita,
     um título só, certeza alta, cliente entre os candidatos ou escrito no
     evento, responsável presente ou escrito, interna só sem convidado de
     fora, presencial só com local. O que não passa é descartado;
   - com proposta segura: **`agenda.evento.padronizar` pela porta**, proposta
     pelo vigia (ator sistema), com o RASTRO da porta;
   - sem proposta segura: **pendência** `agenda.padrao` ("Esta reunião está
     fora do padrão: qual é o cliente?") com as opções montadas pela gramática
     (cada cliente candidato com o sócio, a interna quando não há convidado de
     fora, "outro cliente" com o nome no complemento) e "Não é reunião".
5. Evento que voltou ao padrão (pela porta ou à mão), que deixou de ser
   reunião ou que saiu da agenda: a conferência é dada por resolvida e a
   pendência aberta é descartada pelo vigia (a decisão de gente nunca é
   desfeita).

**Deduplicação.** O que o vigia concluiu de cada evento fica em
`AgendaConferencia` (migration `20261021350000_agenda_conferencia`): título
lido, assinatura do evento (título, convidados, Meet, local, descrição e
status; o horário fica de fora de propósito), proposta e onde ela está. **Não é
cópia da agenda**: o Google continua sendo a única agenda. Mesmo evento com a
mesma assinatura não é pago ao modelo nem proposto de novo; a mesma proposta
com aprovação viva não volta à porta; "não é reunião" dito por uma pessoa fica
dito, mesmo com o evento mudado.

**A janela da política.** Fora das 08h às 20h de São Paulo a porta acende
`fora_da_janela` e a correção subiria de R3 para R4 (titular, reautenticação,
motivo). O vigia não força isso: fora da janela ele confere e grava a
proposta, e manda à fila na primeira passagem dentro dela.

**Eventos marcados pelo OS** (`agenda.reuniao.marcar`) nascem no padrão, com
Meet na online: o vigia só os confere e não propõe nada. Se o título for mudado
à mão depois, vale a regra geral.

### O nível e quem confirma

Pelo `classificar` honesto, `agenda.evento.padronizar` é **R3** (escreve fora
do OS, reversibilidade manual): cai na fila de `/atendimento` como qualquer
escrita, e a aprovação de R3 vale 15 minutos. Na prática:

- **A proposta do vigia precisa de UMA pessoa.** Quem propôs foi o vigia
  (sistema), então qualquer pessoa com alçada de responsável confirma —
  inclusive o Rodrigo sozinho. A tela diz "proposta pelo vigia: qualquer
  pessoa com alçada confirma".
- **"Aprovar aqui" na tela `/agenda`** leva à mesma porta: com a aprovação do
  vigia viva, devolve a mesma (o lugar de confirmar é a fila); vencida ou sem
  aprovação, quem clicou PROPÕE, e aí confirma **outra** pessoa (invariante 7).
  A tela diz isso antes e depois do clique.
- **A resposta da pendência** também propõe em nome de quem respondeu: outra
  pessoa confirma.
- O efeito confirmado recebe só `{eventoId, tituloAtual, tituloNovo,
  adicionarMeet}` (`additionalProperties: false`): não existe argumento para
  apagar, mudar horário ou convidados. O efeito em si mora no conector do
  Google (`google/google.service.ts`, lane do Drive), que o inscreve no registro
  de efeitos; sem ele, a porta responde "não tem efeito ligado nesta versão" e
  o vigia anota o motivo e tenta de novo na passagem seguinte.

### O vigia age sozinho? (sobrescrita assinada da política)

O caminho honesto é o do RF-P-06: uma **sobrescrita de política assinada** para
a empresa (versão nova, com responsável identificado e motivo escrito), sem
mexer no que o efeito faz no código. O comando:

```bash
# dentro do container da API (roda compilado):
node dist/agenda/sobrescrita-da-agenda.cli.js --org <slug-da-root>
#   simula: mostra o delta e o que a régua diz dele; não grava nada

node dist/agenda/sobrescrita-da-agenda.cli.js --org <slug-da-root> --valer \
  --como <e-mail do Rodrigo no OS> \
  --motivo "AAAA-MM-DD: o vigia da agenda (AG-01) padroniza o título sem fila; o título antigo fica na descrição e agenda.evento.restaurar o devolve"
```

O delta declara, **só para esta empresa**, `agenda.evento.padronizar` em **R2**,
com `reversibilidade: automatica` e `desfazer: agenda.evento.restaurar`
(preservando as outras capacidades que a empresa já tenha sobrescrito).

**Hoje ele não basta, e a simulação diz por quê** (medido em
`apps/api/test/agenda-vigia-sobrescrita.test.ts`):

1. A escada decide pelo efeito (`nivelBase = maior(declarado,
   classificar(efeito))`): com `reversibilidade: manual`, nenhuma sobrescrita
   desce de R3. Declarar `automatica` exige um `desfazer` **implementado**, e
   `agenda.evento.restaurar` (alteração que devolve o título da linha "Título
   original: …" e tira o Meet acrescentado) ainda não existe no catálogo nem no
   conector. Sem ele a régua recusa o documento (`desfazer-inexistente`) e o
   `--valer` não grava nada.
2. Mesmo em R2, a porta (`ToolGateway`) chama a régua sem `aprovacaoR2Ligada`,
   então R2 também fica retido. Desligar a aprovação de R2 por empresa ainda
   não tem onde ser escrito.

As duas peças são do dono da política e da porta, não do vigia: **[a decidir]**
(a capacidade `agenda.evento.restaurar` no catálogo e no conector; e o campo de
"aprovação de R2 desligada" por empresa, lido pela porta). Com as duas no ar, o
mesmo comando aplica e a simulação passa a dizer "o vigia corrige o título sem
passar pela fila". Até lá, o atalho real é o de cima: a proposta do vigia
precisa de uma pessoa só.

### Ao subir

- Migration `20261021350000_agenda_conferencia` (aditiva; a imagem anterior
  ignora a tabela).
- A capacidade `agenda.evento.padronizar` entra pelo seed da política 1.11.0 da
  Lane 0, com a assinatura `POLITICA_CAPACIDADE_NOVA_*` de capacidade nova.
  Sem o seed, a porta trata a capacidade como sem classificação (R5) e recusa.
- Nenhuma variável nova, nenhuma permissão nova (`dashboard.ver` para ver,
  `agenda.editar` para pedir a correção).
