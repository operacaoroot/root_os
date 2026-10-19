# RESULTADO da cópia dos cartões do Lucas · comercial e gestão da produção no nosso modelo

> Rodada 1, de 16:17 a 16:55 de 19/10/2026 (modo acelerado, pedido das 16:20). Branch `homolog/copia-lucas-20261019`, sobre `trabalho-entrega-20261020`. Tag `copia-entrega-20261020`. Bundle em `C:\Users\User\dev\copia-lucas.bundle` (`main..homolog/copia-lucas-20261019`).
> Roteiro: `docs/comercial/RODADA-COPIA-LUCAS-20261019.md`. Registro linha a linha: `homolog/progresso.md` (linhas "Cópia do Lucas"). Revisão adversarial: `homolog/revisao/copia-revisao.md`.
> **Só contagens aqui.** Título, nome, e-mail e CNPJ de cliente moram só em `homolog/copia/` (fora do git). Nada voltou à produção; nenhum código do Lucas foi mesclado: o nosso código é a verdade.

## 1. Onde ver

- Stack **`rootos-copia`**: web `http://127.0.0.1:3020` (também `100.95.41.124:3020`), API `:4020` (health 200). Login: o do Rodrigo, com a senha `COPIA_LOGIN_SENHA` de `homolog/.env.copia`. As outras contas da produção entram sem senha utilizável.
- A **`rootos-comercial` (3010/4010) não foi tocada**: os containers dela são de antes desta rodada, e nenhum script aponta para 3010, 4010 ou 5440.
- Subir de novo: `docker compose -p rootos-copia -f homolog/docker-compose.copia.yml --env-file homolog/.env.copia up -d`. A imagem é a da `trabalho-entrega-20261020`, só com outra etiqueta (`rootos-copia-app:trabalho-entrega-20261020`). Nada foi construído.

## 2. Como foi feito

| Peça | O que é |
|---|---|
| C1 · stack | `homolog/docker-compose.copia.yml`. São dois Postgres em containers separados. **`db`** é o destino, no nosso esquema, e é o único banco que a API lê. **`staging`** guarda o dump de produção restaurado: fica numa rede **interna** só dele, sem a API e **sem porta no host**, e o importador lê por `docker exec … psql` numa transação de leitura. As rotinas estão desligadas (`ROTINAS_CRON=off`), o LLM é dublê, o WhatsApp é simulado e Asaas e ZapSign são dublês. |
| C1 · destino | É migrado do zero pelo arranque da API. `preparar-destino.mjs` cria a espinha da semente **sem a demonstração**: a empresa `root` com o nome da produção, permissões e papéis, e as 8 contas da produção por e-mail, com nome, telefone, papel e situação. Nenhum hash de senha veio da produção: cada conta recebe um segredo aleatório que ninguém guarda, menos o login do Rodrigo e a conta de serviço `admin@` da semente. Depois vêm o `db:seed:politica` (77 capacidades) e a estrutura sugerida pela rota (3 pastas e 3 listas). |
| C3 · classificação | São dois mapas fora do git: `homolog/copia/mapa-crm.json` (pasta CRM, cartões de cadastro e listas de teste) e `homolog/copia/mapa-gestao.json` (Operação, Jorge Tabeliao, Comercial, Administrativo, Financeiro). O formato está em `homolog/importar-copia/MAPA.md`. O staging foi lido só por SELECT. |
| C2 · importador | `homolog/importar-copia/importar.mjs`. É idempotente pela chave `prod:<id>` (`WorkTask.externalId`, a referência do lead na entrada idempotente e o Partner por CNPJ ou nome) e escreve **pela API da stack**, com duas contas de gente: o importador pede e o conferente confirma a escrita sensível. Os únicos usos de SQL direto no destino estão em `homolog/importar-copia/EXCECOES.md`: `externalId` e `createdAt` da tarefa, que a rota não aceita, e leituras. O detalhe linha a linha (tarefa → origem → destino → cliente → etapa → motivo) está em `homolog/copia/mapa-das-tarefas.md`, fora do git. |

## 3. O que entrou, por destino

92 cartões de origem foram classificados: 71 viraram tarefa, 17 viraram lead e 4 ficaram fora.

| Destino | Quantos | De onde |
|---|---|---|
| Administrativa › Administrativo | 6 | lista Administrativo |
| Administrativa › Financeiro | 3 | lista Financeiro |
| Gestão › Comercial | 8 | lista Comercial (o que não era lead) |
| Gestão › Operação interna | 15 | lista Operação (operação da casa, cliente "Root (interno)") |
| Clientes › Execução | 39 | lista Operação com cliente (33, sendo 2 cartões-mãe e 31 subtarefas, mais 1 entrega), Contratos dos clientes (3) e os 3 cartões de onboarding desviados (ver §4) |
| Clientes › Onboarding de cliente (Implantação) | 0 | ver §4 |
| **Tarefas no total** | **71** | 31 subtarefas e 10 concluídas; todas com cliente (T4) e com o comentário de procedência "Copiado da produção em 19/10/2026 · lista de origem: X" |
| Funil vivo (leads) | 17 | Gestão de Leads (10) e Comercial (7). Etapas: follow-up 8, proposta 8, qualificação 1 |
| Clientes (`Partner`) | 6 | 5 clientes de verdade, ligados às tarefas, e o "Root (interno)". Os mapas conhecem 16 clientes: os outros 10 são leads, e lead só vira `Partner` no fechamento |
| Etiquetas | 4 | a "área" do Lucas virou a etiqueta `Área: <nome>` |
| Contas | 8 da produção + 2 da importação | as 2 da importação ficam desativadas ao fim |

Ficaram de fora 4 cartões: 3 da lista "Teste teste" e 1 da lista Jorge Tabeliao, cujo título é uma sequência de teclas sem dono nem descrição, tratado como teste. Também ficou de fora **toda a pasta Demandas internas › Marketing e a lista solta Marketing**, que não entraram em mapa nenhum. No destino não há pasta, lista nem tarefa de marketing ou teste, e a prova confere isso.

A segunda passada do importador (16:45, rodada pela revisão) não mudou nenhuma contagem: WorkTask 71, Lead 17, Partner 6, WorkComment 71, LeadEvent 51, Approval 17. Subiram só dois registros de auditoria, os logins das contas da importação. Conferência no banco: 71 tarefas, 71 chaves `prod:` distintas e 0 tarefas sem cliente; 17 leads, 7 deles com dono (os mesmos 7 que tinham responsável na produção). A primeira passada deslocou as datas em 3 horas, porque o staging guarda data sem fuso e o Node a lia como hora local. O importador foi corrigido e uma passada de reconciliação acertou as 71 tarefas: criação e vencimento batem com o staging em 71 de 71. A passada limpa seguinte não mudou nada.

## 4. O que o nosso código recusou, e ficou como está

| Caso | Quantos | O que aconteceu |
|---|---|---|
| Cartão de **Contratos dos clientes** pedido em Onboarding de cliente | 3 | A **porta da implantação** (T1) recusa cartão solto nessa lista: o cartão nasce do contrato assinado no comercial ou de "Registrar cliente já fechado", e esse caminho exige o PDF do contrato no storage. A stack não tem storage e a produção não tem os PDFs, então inventar seria criar documento falso. Os 3 foram para **Clientes › Execução** (Fechado no comercial → A fazer, os demais → Em andamento), com o motivo no mapa. Por isso **a Implantação aparece vazia**, e o passo 4 da prova está como FALHA registrada. |
| Lead pedido em **contrato** ou **fechado** | 6 (4 + 2) | `contrato` e `fechado` são etapas de sistema: entram pelo aceite na sala e pela 1ª parcela com as assinaturas, nunca por arrasto. Os 6 ficaram em **proposta**, a etapa anterior. Dos 5 da pasta CRM com contrato assinado, só 1 tem CNPJ na produção (e mesmo esse está sem e-mail e sem telefone), então "Registrar cliente já fechado" também não se aplicaria sem inventar dado. |
| Mover etapa no funil | 17 movimentos | Seguiram a régua: o importador pede, o conferente confirma com reautenticação e motivo, e o importador executa com o token. As 17 aprovações foram consumidas. |
| Subtarefa de cartão que virou lead | 6 | O funil não tem subtarefa: as 6 entraram soltas em Clientes › Execução, ligadas ao cliente, com o motivo no mapa. |
| Subtarefa de cartão que virou lead | 6 | O funil não tem subtarefa. As 6 entraram soltas em Clientes › Execução, ligadas ao cliente, com o motivo no mapa. |
| Comentário e histórico do lead | — | O fio do comercial só aceita eventos tipados, e gravar `LeadEvent` por SQL criaria um fato que nenhuma regra nossa produz. A descrição do cartão que virou lead não foi para o lead: está no staging e no mapa. A data de entrada do lead é a da importação, porque a entrada idempotente não aceita data. |

## 5. O que o modelo do Lucas tinha e o nosso não representa

| Conceito do Lucas | Como ficou na cópia |
|---|---|
| **Áreas** (`WorkArea`, `WorkTask.areaId`) | Viraram etiqueta `Área: <nome>` (4 etiquetas). Não houve esquema novo. |
| **Vários responsáveis** (`outrosResponsaveisIds`) | O nosso modelo tem um responsável só. O importador escreveria os outros num comentário "Também com: …", mas na produção de 19/10 nenhuma tarefa copiada tinha mais de um responsável, então nenhum comentário desses foi criado. |
| **Natureza cadastro** ("cliente = cartão", `WorkTask.clienteId` apontando para outra tarefa) | O cartão de cadastro virou `Partner`: dedupe por CNPJ quando existe, senão pelo nome normalizado. As tarefas que apontavam para ele apontam para o `Partner`. Nenhum cartão de cadastro virou tarefa. |
| **Comentários** | O caminho existe (autor mapeado por e-mail, data original), mas a produção tinha **0** comentários nas listas copiadas. |
| `AcordoComercial` (repasses e permutas) | Não foi copiado: não há equivalente no escopo desta rodada. 3 clientes que só existem ali ficaram fora. |

## 6. Provas

| Prova | Resultado |
|---|---|
| `homolog/e2e/copia.mjs` contra a `rootos-copia` | **7 de 8 PASSAM** (rodada final às 16:50, sobre o estado reconciliado: 22,9 s), com 15 fotos `copia-*.png` (escuro, claro e 390 px) em `homolog/copia/fotos/`, fora do git porque têm dado real. Passam: login; contagens por lista batendo com o `contagens.json` (71 = 71); nenhuma pasta, lista ou tarefa de marketing ou teste, e todas as 71 com procedência; Funil vivo com os 17 leads e etapas iguais na tela, na API e nas contagens; o pop-up (`?tarefa=`) com cliente `Partner` e o comentário de procedência; Minhas tarefas do Rodrigo com as dele (2) e nenhuma de outra pessoa; nenhuma tela rola na horizontal a 390 px. **FALHA**: Implantação sem cartão (§4). |
| Idempotência | A segunda passada não mudou nenhuma contagem (§3) |
| Revisão adversarial | `homolog/revisao/copia-revisao.md`, sem P1 e com 2 P2, os dois consertados (§7) |

## 7. O que a revisão achou

- **P2 · o staging era alcançável da API.** A porta 5442 estava publicada só em loopback, mas no Docker Desktop qualquer container alcança a porta do host por `host.docker.internal`, e só a senha protegia o dump. **Consertado:** o staging não publica porta, a rede dele virou `internal` e o container foi recriado. A API agora recebe `ECONNREFUSED`, e o importador segue lendo por `docker exec`.
- **P2 · as contas da importação ficaram ativas.** Eram duas `admin_master`, numa API também publicada no Tailscale. **Consertado:** `preparar-destino.mjs --desativar`.
- **P3 consertados no importador:** o UPDATE de comentário passou a filtrar a empresa; a mensagem de erro no console deixou de carregar texto de cliente; o nome longo de `Partner` não duplica; a tarefa criada sem a chave, por uma queda entre o POST e o UPDATE, é adotada na passada seguinte (achada pela auditoria) em vez de duplicada; e `preparar-destino.mjs`, que escreve por Prisma, entrou no `EXCECOES.md`.
- **P3 registrados, sem conserto:** o RLS está inerte nesta stack, porque a conexão é de superusuário, como na produção. O pedido e a confirmação de etapa são duas contas movidas pelo mesmo script, e esse é o preço de importar por máquina. Além do login do Rodrigo, a conta de serviço `admin@` da semente também tem senha conhecida (no `.env.copia`).

## 8. A decidir (Rodrigo)

1. **Implantação vazia.** Os 3 clientes em implantação na produção estão em Execução. Para que apareçam na Implantação, uma pessoa registra cada um em "Registrar cliente já fechado", com o PDF assinado e um storage na stack. Ou se aceita que, na cópia, eles fiquem em Execução.
2. **Leads com contrato assinado em proposta** (6). O fechamento de verdade pede CNPJ, e-mail e telefone, que a produção não tem para 5 deles.
3. **Dúvidas de classificação**, marcadas com "DÚVIDA" no motivo do mapa: 6 no CRM e 7 na gestão. Alguns exemplos: o cartão do Jorge Tabeliao como teste; um "agendar onboarding" sem cartão de cliente, levado ao funil; um upsell em Administrativo que talvez seja lead; um cartão-mãe concluído com 31 subtarefas abertas, copiado ao pé da letra; dois leads que o `AcordoComercial` sugere serem repasse ou parceria, mantidos como o cartão diz.

## 9. Backlog · APAGAR DEPOIS (pedido do Rodrigo)

Quando o Rodrigo terminar de olhar, **uma pessoa** apaga o que segue (este ambiente não apaga nada):

- o dump `C:\Users\User\dev\producao\producao-root-20261019.dump` (e a pasta `C:\Users\User\dev\producao\`);
- a stack `rootos-copia` inteira: containers `rootos_copia_{web,api,db,staging,redis,asaas_mock,zapsign_mock}`; volumes `rootos-copia_rootos_copia_db`, `rootos-copia_rootos_copia_staging` (o banco `producao_staging`), `rootos-copia_rootos_copia_vault`, `rootos-copia_rootos_copia_asaas`, `rootos-copia_rootos_copia_zapsign`; redes `rootos-copia-net`, `rootos-copia-staging-net`; e a etiqueta de imagem `rootos-copia-app:trabalho-entrega-20261020` (a imagem segue com a etiqueta da `rootos-comercial`). Comando: `docker compose -p rootos-copia -f homolog/docker-compose.copia.yml --env-file homolog/.env.copia down -v`, depois `docker image rm rootos-copia-app:trabalho-entrega-20261020`;
- a pasta `homolog/copia/` inteira: mapas, mapa das tarefas, contagens, fotos, `prova-copia.json` e os rascunhos `_lane-d-*`;
- `homolog/.env.copia`;
- a pasta de rascunhos `C:\Users\User\dev\scratch-e\`, com scripts de inspeção da prova, fora do repositório;
- o bundle `C:\Users\User\dev\copia-lucas.bundle`.
