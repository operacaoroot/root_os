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
node apps/api/prisma/import-clickup-work.normalize.mjs
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
```

O diretório do manifesto precisa ter permissão `0700`. Arquivos criados têm `0600`. Antes de cada transação de criação, a CLI grava uma cópia integral do snapshot e `*.pre-apply.json` com plano, estado prévio e manifesto anterior. O manifesto guarda IDs nativos determinísticos, hash por entidade, versões de snapshot, anexos por tarefa e IDs criados por lote. Os IDs derivam de org + espaço + tipo + ID externo; se o banco concluir a transação e a escrita do manifesto falhar, a próxima simulação detecta os mesmos registros, sem duplicar.
Antes de liberar o download autenticado, copiar todos os binários conciliados para os paths relativos do índice sob o vault, copiar `attachments-index.json` ao mesmo diretório, e conferir hash/tamanho e uma resposta autenticada da rota. O índice é separado do manifesto de rollback do importador.

O importador **só cria**. Repetição com a mesma fonte vira no-op; se um registro nativo ou a origem mudar, produz conflito e recusa o apply inteiro para reconciliação humana. Nunca sincroniza por cima de edição local. O apply reconfere plano e fingerprint anterior numa transação serializável; o backup em disco é escrito antes dela. O rollback apaga somente IDs criados no último lote e somente se o fingerprint de linhas e relações ainda for idêntico ao estado pós-importação. A rechecagem e a exclusão acontecem na mesma transação serializável, com bloqueio de escrita temporário nas tabelas Work e nas relações que poderiam sofrer cascade. Esse lock é **global às empresas**: execute rollback numa janela curta de manutenção, observando transações concorrentes; o timeout é 120 segundos e um conflito aborta sem exclusão parcial. Uma tarefa, comentário, hora, status, campo ou vínculo criado/editado depois bloqueia a reversão; nesse caso restauração é manual a partir do backup e do manifesto. O rollback não depende da presença posterior dos binários dos anexos. Nenhuma execução desta CLI deve ser chamada de migração completa até o delta final do ClickUp ser reconciliado e aceito.
Se o banco concluir a transação de criação e o processo cair antes de escrever o manifesto, uma execução seguinte com `--apply` reconstitui o mapeamento dos IDs determinísticos sem duplicar, mas marca `recoveredWithoutRollback`: não há prova suficiente para reversão automática desse lote. Se a queda acontecer entre o COMMIT do rollback e a gravação de `rolledBackAt`, a reexecução confere o fingerprint anterior do lote e apenas reconcilia o manifesto, sem deletar outra vez. Um arquivo `.lock` deixado por queda deve ser analisado junto ao banco/backup antes de remoção manual.

## Cobertura e lacunas atuais

Nativo: listas em pasta plana com caminho completo, status por lista, tarefa e subtarefa com ID externo, título, descrição, prioridade, primeiro responsável textual, datas, URL de origem, etiquetas, campos e comentários com autor/data originais (`authorId` local nulo). O PATCH já move o **mesmo** card entre listas, atribuindo a primeira etapa da lista de destino.

Somente snapshot/manifesto: hierarquia real de pastas, responsáveis adicionais, checklists, dependências, metadados históricos e anexos físicos. As dependências aparecem no card com direção e link para o ID nativo da outra tarefa do lote; não há relação nativa no banco. Links internos estáveis de anexos aparecem na descrição e são baixados pela UI com Bearer pela rota autenticada. `statusDesde` nativo é carimbado pelo banco no momento do import; não representa a data histórica de entrada na etapa. O relatório de dry-run enumera avisos e lacunas; nenhuma dessas capacidades é apresentada como nativa completa.
