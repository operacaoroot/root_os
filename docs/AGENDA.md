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
