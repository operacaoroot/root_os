# Exceções do importador da cópia (C2/C3, 19/10/2026)

O importador (`importar.mjs`) escreve no destino pela API da stack `rootos-copia`, com as
duas contas da importação (o importador propõe, o conferente confirma a escrita sensível).
Abaixo, cada ponto em que ele toca o banco de destino por SQL, e o porquê. Sem dado de
cliente aqui.

## SQL direto no destino (escrita)

- **T · `WorkTask.externalId` e `WorkTask.createdAt`.** `POST /trabalho/tarefas` não aceita
  nenhum dos dois (`TrabTarefaCreateSchema`). O `externalId = prod:<id>` é a chave da
  idempotência (o `@@unique([orgId, externalId])` impede duplicar) e o `createdAt` é a data
  original da produção, pedida no roteiro. Um `UPDATE` por tarefa, logo depois do POST que a
  criou, filtrado por `id` e `orgId`. Nas passadas seguintes, o mesmo `UPDATE` só corre se a
  data no destino divergir da do staging. Nenhuma outra coluna é escrita por SQL.
- **C · `WorkComment.createdAt`, `authorId`, `authorName` dos comentários da PRODUÇÃO.** A rota
  de comentário grava autor = quem chama e data = agora; o comentário copiado guarda o autor
  (quando a pessoa tem conta no destino; senão o nome vai prefixado no texto) e a data
  original. Na cópia de 19/10 a produção tinha **0** comentários, então este caminho não
  escreveu nada. Os comentários de procedência e de "Também com" são do importador, pela API,
  sem SQL.

- **W · `WorkComment` filtrado pela empresa.** O `UPDATE` do item C confere `id`, `taskId` e
  `orgId`, como o do item T.

## Escrita por Prisma, fora da API (C1, `preparar-destino.mjs`)

- O destino nasceu sem a semente de demonstração: `preparar-destino.mjs` repete os passos 1 a
  4 do `apps/api/prisma/seed.ts` (empresa root, permissões, papéis) pelo Prisma, com as mesmas
  fontes do shared, e grava as contas: as oito da produção (nome, e-mail, telefone, ativo,
  papel; senha nunca da produção: hash de segredo descartado, menos o login do Rodrigo) e as
  duas da importação. Não há rota de API para criar empresa, papel ou usuário com papel antes
  de existir quem faça login; é o mesmo caminho do `db:seed`. `--desativar` desliga as contas
  da importação no fim, também pelo Prisma.

## Risco tratado: queda entre o POST da tarefa e o UPDATE do externalId

Se o processo cair depois de `POST /trabalho/tarefas` e antes do `UPDATE` do item T, a tarefa
fica sem `externalId`. Antes de criar, o importador procura (só leitura) tarefa da mesma lista,
com o mesmo título, sem `externalId`, cuja auditoria `work.task.create` tem o importador como
ator, e a adota em vez de criar outra (`orfasAdotadas` na contagem). Os comentários só são
gravados depois do `UPDATE`, então a órfã não tem comentário duplicado.

## Mensagens de erro

O console leva só o status e o código da mensagem da API (as primeiras palavras da frase, sem o
valor enviado); a frase inteira vai só ao `homolog/copia/mapa-das-tarefas.md`, fora do git. O
erro de leitura do staging não cita a saída do banco.

## SQL direto no destino (só leitura)

- **L · leituras.** A API não lista usuários com e-mail, nem tarefa por `externalId`, nem as
  etiquetas da empresa. O importador lê por `SELECT` filtrado pela empresa: `User` (id,
  e-mail, nome, para mapear o responsável pelo e-mail da produção), `WorkTask` com
  `externalId like 'prod:%'` (estado atual, para não duplicar e para reconciliar com o mapa) e
  `WorkTag` (nome → id). Nada é escrito por esse caminho.

## O que a API recusou (regra do nosso código, não afrouxada)

- **Porta da implantação.** Cartão solto em Clientes › Onboarding de cliente é recusado (400,
  `PORTA_DA_IMPLANTACAO`): o cartão nasce do contrato assinado no comercial ou de "Registrar
  cliente já fechado", que exige o PDF do contrato no storage, e esta stack não tem storage.
  O importador manda esses cartões a Clientes › Execução (etapa: Fechado no comercial → A
  fazer; Encerrado ou concluída → Concluída; demais → Em andamento) e anota o motivo no mapa
  das tarefas. Contagem em `contagens.json`, `tarefasRedirecionadasDaImplantacao`.
- **Etapas de sistema do funil.** `contrato` e `fechado` não aceitam arrasto de gente
  (`COMERCIAL_ETAPAS_DE_SISTEMA`: entram pelo aceite na sala e pela 1ª parcela + assinaturas).
  Lead pedido nessas etapas fica em `proposta`, a etapa anterior, com o motivo no mapa.
- **Saídas sem o dado obrigatório.** Geladeira exige data de volta e parceiro exige para quem;
  a produção não tem esses dados e o importador não inventa. Lead pedido nelas fica na etapa
  (na cópia de 19/10 não houve nenhum).

## Mover etapa no funil (escrita sensível, pela régua)

Cada lead que precisa andar passa pelo caminho da tela: `POST /comercial/lead/:id/mover/pedido`
(importador) → `POST /approvals/:id/confirm` (conferente, com reautenticação e motivo) →
`POST /comercial/lead/:id/mover` com o `x-approval-token` (importador). Quem pede não assina.

## O que ficou de fora e por quê

- **Comentários e histórico do lead no fio.** O fio do comercial só aceita os eventos
  tipados de `COMERCIAL_EVENTOS` e não há rota de nota livre no lead; gravar `LeadEvent` por
  SQL criaria um fato que nenhuma reação do nosso código produz. Na produção não havia
  comentário nenhum; a descrição do cartão que virou lead não foi levada ao lead.
- **Data de entrada do lead.** O lead entra com a data da importação (a entrada idempotente
  não aceita data); a data original fica no staging e no mapa das tarefas.
- **Subtarefa de cartão que virou lead.** O pai foi ao funil, que não tem subtarefa; a
  subtarefa entra solta na lista do mapa, com o cliente, e o motivo vai ao mapa.
- **Vários responsáveis e área.** O nosso modelo tem um responsável: os outros iriam num
  comentário "Também com: …" (na produção, nenhuma tarefa tinha). A área do Lucas virou
  etiqueta `Área: <nome>` (o nosso `WorkTag`), sem esquema novo.
