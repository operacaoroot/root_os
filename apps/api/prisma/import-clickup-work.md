# Importador ClickUp → Trabalho nativo (lote Marketing)

Esta CLI é uma ferramenta de migração offline; não roda no servidor web/API nem consulta o ClickUp. **Sem `--apply`, não escreve no banco nem no disco.** O primeiro lote permitido é a allowlist fixa de sete IDs de listas de `Demandas internas / Marketing` do espaço `901313864063`: `901328341442` (Gestão de Temas), `901328341443` (Copy), `901328341445` (Rotina de stories), `901328341450` (Design & Gravação), `901328341456` (Calendário de conteúdo), `901328341455` (Análise) e `901328341451` (Demandas gerais). O ID `901327640001` pertence à lista parecida de Lucas Creator e deve ser rejeitado, nunca inferido pelo nome.

## Contrato do snapshot normalizado v1

Arquivo JSON UTF-8 (exemplo de forma abreviado; um lote válido traz as sete listas e todas as tarefas):

```json
{
  "schemaVersion": 1,
  "source": "clickup",
  "capturedAt": "2026-09-29T04:00:00.000Z",
  "spaceId": "901313864063",
  "scope": { "folderPath": ["Demandas internas", "Marketing"], "listIds": ["ID-DA-LISTA-1"] },
  "completeness": { "allLists": true, "allTasks": true, "includeClosed": true, "paginationComplete": true },
  "extractionGaps": [],
  "unknownSourceFields": ["tasks.archived", "tasks.order", "lists.order", "fields.order"],
  "folders": [
    { "id": "ID-DEMANDAS", "name": "Demandas internas", "parentId": null },
    { "id": "ID-MARKETING", "name": "Marketing", "parentId": "ID-DEMANDAS" }
  ],
  "lists": [{
    "id": "ID-DA-LISTA-1", "name": "Copy", "folderId": "ID-MARKETING", "order": 0,
    "statuses": [{ "id": "ID-STATUS", "name": "to do", "type": "open", "color": "#87909e", "order": 0 }],
    "fields": [{ "id": "ID-CAMPO", "name": "Data de Publicação", "type": "data", "order": 0, "options": [] }]
  }],
  "tasks": [{
    "id": "ID-DA-TAREFA", "listId": "ID-DA-LISTA-1", "statusId": "ID-STATUS",
    "title": "ROOT-001", "description": "Pacote v1...", "priority": "normal",
    "assignees": [{ "id": "ID-PESSOA", "name": "Nome da pessoa" }],
    "startDate": null, "dueDate": null, "createdAt": null, "updatedAt": null,
    "parentId": null, "archived": null, "order": 0, "url": "https://app.clickup.com/t/ID-DA-TAREFA",
    "tags": [], "fieldValues": [{ "fieldId": "ID-CAMPO", "value": "2026-10-01" }],
    "comments": [{ "id": "ID-COMENTARIO", "authorId": "ID-PESSOA", "authorName": "Nome da pessoa", "text": "Texto", "createdAt": "2026-09-28T12:00:00.000Z" }],
    "attachments": [{ "id": "ID-ANEXO", "name": "arquivo.pdf", "url": "/api/trabalho/arquivos/ID-DA-TAREFA/ID-ANEXO", "sha256": "SHA256-DOS-BYTES", "localPath": "/vault/90-OS/migrations/marketing-20260929/arquivo.pdf", "mimeType": "application/pdf", "size": 1234 }],
    "checklists": [{ "id": "ID-CHECKLIST", "name": "Passagem", "items": [{ "id": "ID-ITEM", "name": "Conferir", "resolved": false, "assigneeId": null }] }],
    "dependencies": [{ "taskId": "ID-OUTRA-TAREFA", "type": "blocking" }],
    "raw": {}
  }]
}
```

IDs da origem são strings e mandam na identidade. `lists` deve coincidir **exatamente** com `scope.listIds` e com a allowlist fixa do código; toda tarefa deve pertencer a uma delas e usar um status da própria lista. O caminho de cada lista é calculado seguindo `folderId`/`parentId`, deve bater com `scope.folderPath` e vira o nome completo de `WorkFolder` no modelo plano. Um campo ausente não é convertido silenciosamente em vazio: arrays exigidos precisam ser coletados, e qualquer falha de paginação ou de extração entra em `extractionGaps` e/ou marca `completeness` falso. O apply é recusado nesses casos. A API de exportação não oferece `archived` nem as ordens de listas/campos/tarefas; `archived: null` e `unknownSourceFields` registram a incerteza, e o importador usa `false` e ordem do export como projeção nativa, sem alegar equivalência histórica. `raw` e propriedades adicionais são mantidos na cópia integral do snapshot.

O exportador salva os **bytes** dos anexos fora deste JSON, calcula SHA-256 e usa somente a URL interna estável acima. URLs temporárias/single-use do ClickUp não entram no snapshot. A rota autenticada dos arquivos usa `attachments-index.json` como allowlist. O snapshot local aponta ao staging privado `root-os-migration-20260929` ou `root-os-migration-20260929-refresh` em `/private/tmp` e serve para ensaio; o snapshot VPS aponta a `/vault/90-OS/migrations/marketing-20260929/files/`. **`--apply` só aceita o caminho VPS.** O dry-run conectado e o apply conferem arquivo regular, tamanho quando informado, caminho permitido e SHA-256 dos bytes; o modo `--offline` só valida o contrato JSON. Anexo ausente ou diferente bloqueia o apply.

## Uso

```sh
# A partir da raiz do repositório: normalizar raw-tasks/raw-lists/files em dois snapshots:
node apps/api/prisma/import-clickup-work.normalize.mjs --capture-status /caminho/privado/capture-status.json
# O manifesto exige stable/usableForNormalization/paginationComplete verdadeiros,
# recheck sem diferenças, capturedAt ISO e hashes dos três arquivos de origem.
# Um novo ponto de corte exige contagens conferidas explicitamente:
# --raw-tasks ... --raw-lists ... --files ... --output-dir ...
# --expected-tasks CONTAGEM_CONFERIDA --expected-files CONTAGEM_CONFERIDA
# Emite marketing.local.snapshot.json, marketing.vps.snapshot.json e
# attachments-index.json (org ROOT + paths relativos files/<taskId>/<attachmentId>).

# Validação de contrato e cobertura, sem banco nem escrita:
node --import tsx apps/api/prisma/import-clickup-work.ts --snapshot marketing.local.snapshot.json --offline

# Dry-run padrão com leitura da org e reconciliação do banco; zero escritas:
node --import tsx apps/api/prisma/import-clickup-work.ts --snapshot marketing.vps.snapshot.json --org-id UUID --manifest-dir /vault/90-OS/migrations/marketing-20260929

# Só depois da revisão do dry-run e do backup do banco:
node --import tsx apps/api/prisma/import-clickup-work.ts --snapshot marketing.vps.snapshot.json --org-id UUID --manifest-dir /vault/90-OS/migrations/marketing-20260929 --apply

# Reversão: primeiro conferir, depois aplicar explicitamente:
node --import tsx apps/api/prisma/import-clickup-work.ts --snapshot marketing.vps.snapshot.json --org-id UUID --manifest-dir /vault/90-OS/migrations/marketing-20260929 --rollback
node --import tsx apps/api/prisma/import-clickup-work.ts --snapshot marketing.vps.snapshot.json --org-id UUID --manifest-dir /vault/90-OS/migrations/marketing-20260929 --rollback --apply

# Árvore (depois da migration 20261002110000_trabalho_hierarquia): conferir, depois aplicar:
node --import tsx apps/api/prisma/import-clickup-work.ts --snapshot marketing.vps.snapshot.json --org-id UUID --manifest-dir /vault/90-OS/migrations/marketing-20260929 --arvore --nome-do-espaco "NOME DO ESPAÇO"
node --import tsx apps/api/prisma/import-clickup-work.ts --snapshot marketing.vps.snapshot.json --org-id UUID --manifest-dir /vault/90-OS/migrations/marketing-20260929 --arvore --nome-do-espaco "NOME DO ESPAÇO" --apply
```

O diretório do manifesto precisa ter permissão `0700`. Arquivos criados têm `0600`. Antes de cada transação de criação, a CLI grava uma cópia integral do snapshot e `*.pre-apply.json` com plano, estado prévio e manifesto anterior. O manifesto guarda IDs nativos determinísticos, hash por entidade, versões de snapshot, anexos por tarefa e IDs criados por lote. Os IDs derivam de org + espaço + tipo + ID externo; se o banco concluir a transação e a escrita do manifesto falhar, a próxima simulação detecta os mesmos registros, sem duplicar.
Antes de liberar o download autenticado, copiar todos os binários conciliados para os paths relativos do índice sob o vault, copiar `attachments-index.json` ao mesmo diretório, e conferir hash/tamanho e uma resposta autenticada da rota. O índice é separado do manifesto de rollback do importador.

O importador **só cria**. Repetição com a mesma fonte vira no-op; se um registro nativo ou a origem mudar, produz conflito e recusa o apply inteiro para reconciliação humana. Nunca sincroniza por cima de edição local. O apply reconfere plano e fingerprint anterior numa transação serializável; o backup em disco é escrito antes dela. O rollback apaga somente IDs criados no último lote e somente se o fingerprint de linhas e relações ainda for idêntico ao estado pós-importação. A rechecagem e a exclusão acontecem na mesma transação serializável, que começa pelo bloqueio de escrita temporário nas tabelas Work, na auditoria, nas relações que poderiam sofrer cascade e nas tabelas com chave estrangeira para linha do lote, lidas do catálogo logo antes de a transação abrir. O snapshot da transação só nasce na primeira leitura, depois do bloqueio, então uma escrita que outra sessão confirma enquanto a CLI espera o bloqueio entra na rechecagem: se ela mexeu no lote, a reversão é recusada sem apagar nada. Esse lock é **global às empresas**: execute rollback numa janela curta de manutenção, observando transações concorrentes; o timeout é 120 segundos e um conflito aborta sem exclusão parcial. O rollback não depende da presença posterior dos binários dos anexos. Nenhuma execução desta CLI deve ser chamada de migração completa até o delta final do ClickUp ser reconciliado e aceito.
Se o banco concluir a transação de criação e o processo cair antes de escrever o manifesto, uma execução seguinte com `--apply` reconstitui o mapeamento dos IDs determinísticos sem duplicar, mas marca `recoveredWithoutRollback`: não há prova suficiente para reversão automática desse lote. Se a queda acontecer entre o COMMIT do rollback e a gravação de `rolledBackAt`, a reexecução confere o fingerprint anterior do lote e apenas reconcilia o manifesto, sem deletar outra vez. Um arquivo `.lock` deixado por queda deve ser analisado junto ao banco/backup antes de remoção manual.

O que bloqueia a reversão: o fingerprint lê as colunas que os 11 modelos tinham em `1194a49` (decisão F-a da ROOT-16), então tarefa, comentário, hora, etapa, campo ou etiqueta criados ou editados depois nessas colunas bloqueiam, e mudança só em coluna nova (`spaceId`, `parentId`, `externalId` da pasta, `spaceId` da lista) não bloqueia. Duas coisas que a captura fixa não lia também bloqueiam desde a ROOT-17, e entram no hash só quando existem, para o hash do lote sem elas continuar o gravado no manifesto: pasta criada dentro de uma pasta do lote (a chave da pasta-mãe é RESTRICT) e qualquer chave estrangeira de outra tabela apontando para linha do lote, lida do catálogo do banco (a PR35 traz duas, `EditorialArtifact` e `EditorialFile`, para `WorkTask`). O `--rollback` sem `--apply` diz qual delas apareceu em `newLinks`. Quando a reversão está bloqueada, a restauração é manual a partir do backup e do manifesto.

A colisão de pasta (o "identidade nativa existente" do dry-run) procura a pasta pelo `externalId` com o id do ClickUp e, se a pasta do lote ainda vai ser criada, pela posição onde ela nasceria, `(orgId, spaceId, parentId, name)`, que o índice único da hierarquia garante ser de uma pasta só. Até a ROOT-17 a busca era por `(orgId, name)` sem ordem, e com homônima permitida noutro ramo o resultado dependia da ordem física das linhas (errata E-1 da ROOT-16-REV).

## Árvore do lote (ROOT-17)

O lote de 30/09 entrou com uma pasta plana, `Demandas internas / Marketing`, e as sete listas dentro dela. `--arvore` põe essa pasta no lugar dela na origem: cria o espaço do ClickUp (`WorkSpace`, `externalId` = `spaceId` do snapshot) e as pastas-mãe que faltam (`Demandas internas`, com o id da pasta do ClickUp em `externalId`), com IDs de `idNativo` de `kind` `space` e `folder`, e pendura a pasta do lote na mãe gravando só `parentId` e `externalId`. As listas e as tarefas não mudam de linha nem de ID.

A escrita segue a decisão F-a estendida: ela é condicionada ao estado lido da pasta do lote e devolve o `updatedAt` lido, de modo que o fingerprint do lote não muda e o rollback automático continua valendo depois da árvore. A transação da árvore começa pelo mesmo bloqueio do rollback, toma também o cadeado da árvore da empresa que o serviço usa para mover pasta, e confere o fingerprint antes e depois da escrita. Se ele mudou, inclusive por uma escrita que outra sessão confirmou enquanto a CLI esperava o bloqueio, nada é gravado.

O nome e a ordem da pasta do lote são colunas de `1194a49`, e por isso a pasta fica com o nome do caminho inteiro, agora dentro de `Demandas internas`, enquanto o rollback automático precisar valer. Trocar o nome para `Marketing` aposenta o rollback (medido na ROOT-17: o dry-run passa a acusar a pasta e o `rollbackSafe` cai). Essa troca é a alternativa F-b, que pede backup novo, restauração ensaiada e registro no manifesto.

O snapshot traz só o id do espaço, então `--nome-do-espaco` é obrigatório e precisa ser o mesmo em toda execução: um espaço com o mesmo id e outro nome não é recriado nem renomeado. A árvore exige lote ativo no manifesto, o snapshot exato desse lote e a pasta do lote igual ao snapshot e ainda fora da árvore; com a pasta já no lugar certo, a execução vira no-op. Pasta do lote em outro lugar, espaço ou pasta homônima nativa na posição de nascimento e ciclo viram conflito, sem escrita. Conflito em linha que não é a pasta (uma tarefa editada, por exemplo) não impede a árvore, porque o rollback daquela empresa já estava recusado e continua igual.

Depois de criados, o espaço e as pastas-mãe são nativos: renomeá-los ou movê-los é decisão de quem usa, e a próxima `--arvore` mostra aviso em vez de conflito. O rollback depois da árvore apaga as linhas do lote e, com elas, a posição da pasta do lote; o espaço e as pastas-mãe ficam, e a saída lista os IDs deles em `treeNodesKept`. Reimportar recria a pasta plana com os mesmos IDs, e uma nova `--arvore` a pendura de novo.

Cada `--arvore --apply` que cria ou move algo acrescenta uma entrada em `arvore` no manifesto, com os nós criados, as posições antes e depois e o fingerprint. O bloqueio da árvore é global às empresas, como o do rollback.

## Cobertura e lacunas atuais

Nativo: listas na pasta do lote, que nasce plana com o caminho completo no nome e vai para dentro do espaço e das pastas-mãe da origem com `--arvore`; status por lista, tarefa e subtarefa com ID externo, título, descrição, prioridade, primeiro responsável textual, datas, URL de origem, etiquetas, campos e comentários com autor/data originais (`authorId` local nulo). O PATCH já move o **mesmo** card entre listas, atribuindo a primeira etapa da lista de destino.

Campo `currency` (ROOT-06a): o normalizador grava `type: "moeda"` com `moeda` (`type_config.currency_type`, três letras maiúsculas) e `casas` (`type_config.precision`, de 0 a 2); faltando um dos dois, a normalização falha com o ID do campo e não grava arquivo. O valor é transcrito como veio (texto continua texto, número JSON continua número); `null`, texto vazio e chave ausente não geram valor. A conversão acontece uma vez, no importador, por `valorMonetarioCanonico` de `packages/shared/src/valor-monetario.ts`, a mesma regra da API: o banco recebe `BRL 1500.00` (código ISO, espaço, duas casas, até 12 dígitos inteiros) e o `origemHash` do valor continua sobre a origem, então `"1500.50"` e `1500.5` gravam o mesmo valor sem conflito falso. Valor que não converte (casas além da precisão, expoente, vírgula, mais de 12 dígitos) é erro do snapshot e recusa o apply; a mensagem cita tarefa, campo e motivo, nunca o valor. Campo `moeda` com opção, ou valor com `optionId`, também é erro. Moeda diferente de BRL gera aviso: sem valor gravado, a tela propõe BRL para valor novo.

Etapa `done` (ROOT-06a): é aceita e gravada como `closed`, com nome, cor e ordem da origem. O `done` fica no snapshot e no `origemHash` da etapa, e o dry-run avisa cada etapa `done` com a contagem das tarefas dela. Tipo de etapa fora de `open`, `custom`, `done` e `closed` continua derrubando a normalização e o snapshot.

Lacuna conhecida (A2, condicionada pela errata E10 da ROOT-06-REV): em campo `texto`, `numero`, `url` e `checkbox`, a chave `value` presente com `null` ainda vira o texto `"null"`. A regra de vazio só vale para `currency` até alguém contar os `WorkFieldValue.value = 'null'` do lote Marketing aplicado em 30/09; com zero, a regra se estende; acima de zero, a reconciliação da ROOT-11 recebe a regra de equivalência antes da mudança.

Somente snapshot/manifesto: responsáveis adicionais, checklists, dependências, metadados históricos e anexos físicos. As dependências aparecem no card com direção e link para o ID nativo da outra tarefa do lote; não há relação nativa no banco. Links internos estáveis de anexos aparecem na descrição e são baixados pela UI com Bearer pela rota autenticada. `statusDesde` nativo é carimbado pelo banco no momento do import; não representa a data histórica de entrada na etapa. O relatório de dry-run enumera avisos e lacunas; nenhuma dessas capacidades é apresentada como nativa completa.

A normalização exige `--capture-status`: o manifesto precisa atestar estabilidade e paginação, conter o instante do corte e amarrar por SHA-256 os arquivos de tarefas, listas e anexos. Contagens, listas e diferenças do recheck também são conferidas. A data do snapshot vem desse manifesto, não da modificação do arquivo no disco. Uma captura marcada como instável não pode virar um snapshot válido só pela escolha das contagens. O diretório de saída e arquivos preexistentes precisam ser privados; links simbólicos e permissões de grupo/outros são recusados.
