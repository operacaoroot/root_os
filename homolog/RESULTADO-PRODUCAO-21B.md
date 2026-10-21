# RESULTADO do adendo da rodada de produção 1 (21/10/2026, madrugada)

> Roteiro: `docs/comercial/RODADA-PRODUCAO-20261021-ADENDO.md`. Branch `homolog/final-20261019`, sobre a tag `producao-21-20261021`. Tag deste adendo: `producao-21b-20261021`. Bundle delta: `C:\Users\User\dev\producao21b-delta.bundle` (`homolog/final-20261019` e a tag, `^producao-21-20261021`).
> Só homologação, no Predator. **Nada foi à produção** e o importador não rodou lá. Este arquivo não tem dado de cliente nem segredo: só contagens.

## 1. Os pedidos

| # | Pedido | O que foi feito | Onde |
|---|---|---|---|
| 1 | "Gestão" é pasta, não seção do menu | Conferido: nenhum item de menu "Gestão"; Gestão é pasta de Tarefas (Administrativo, Financeiro, Pessoas), como a rodada principal deixou | `apps/web/src/components/navegacao-modulos.ts` |
| A1 | A lista Comercial vai para o Comercial | As tarefas continuam `WorkTask` (mesma edição, mesmo Dia a dia), agora numa lista própria do comercial (`externalId = comercial:tarefas`) que **não aparece na árvore nem em Todas**, com `WorkTask.leadId` quando citam um lead. Funil vivo com o bloco recolhível **"Tarefas do comercial"** (as sem lead, contagem, atrasadas, filtro Responsável do painel de Filtros, "+ tarefa" inline, concluir e editar). Painel do lead com o bloco **"Tarefas"** ("+ tarefa" já ligada ao lead). O cartão do funil mostra a tarefa aberta mais antiga do lead como próxima ação quando a ficha não tem uma ou quando o prazo dela vem antes, senão como segunda linha, e "N tarefas abertas"; a ficha nunca é gravada (a régua protege a próxima ação) | `apps/api/src/work/lista-do-comercial.ts`, `apps/api/src/comercial/tarefas/`, `_funil/TarefasDoComercial.tsx`, `_painel/TarefasDoLead.tsx`, `ficha.service.ts` |
| A1 | O importador leva as tarefas | Etapa nova no `importar-crm`, depois das do CRM (casa contra os leads que ele cria, também no `--simular`): cada tarefa, com o mesmo id, vai para a lista do comercial, etapa pelo nome, concluída continua concluída, área Comercial, ligada ao lead quando o título o cita sem dúvida. Depois a lista "Comercial" é ARQUIVADA | `importador-crm/plano.ts`, `importador-crm.service.ts` |
| A2 | A lista do contato sai | O cartão e a lista são arquivados (a FK das tarefas é RESTRICT: lista com tarefa arquivada é arquivada, não apagada). A lista é achada pelo **id** (o da cópia de 19/10, que é o da produção), não pelo nome; só se ainda estiver solta e com no máximo 1 cartão ativo, senão vai às sobras | idem |
| A3 | Editar as pastas com facilidade | Na coluna da esquerda do Trabalho: "+ nova pasta" inline; renomear pasta e lista com duplo clique, F2 ou "⋯" › Renomear (Enter salva, Esc desfaz), nome repetido no mesmo nível recusado com a frase; apagar pasta vazia com confirmação simples e, com listas, com o destino escolhido (outra pasta ou Sem pasta: as listas e subpastas mudam de lugar, a pasta sai); apagar lista com tarefa ativa oferecendo "mover as tarefas para outra lista" ou "arquivar todas e apagar"; arrastar lista para outra pasta; arrastar e Alt+↑/↓ para reordenar; a lista da implantação e a pasta Clientes protegidas, com a frase no menu | `ArvoreDoTrabalho.tsx`, `ExcluirDaArvore.tsx`, `work.service.ts`, `packages/shared/src/arvore-do-trabalho.ts` |

## 2. A regra de qual tarefa cita qual lead (no código, sem nomes)

1. O nome citado sai do título: separador com espaços (" — ", " – ", " - ") e ações que sempre vêm antes de um nome (FUP, Follow up, Proposta, Marcar/Agendar/Remarcar/Confirmar reunião, Indicação). Verbo genérico no começo ("Cobrar…", "Checar…", "Atualizar…") nunca é seguido de nome: tarefa interna.
2. **Liga** só com nome igual ao do lead (empresa da ficha, nome, contato, a parte antes de "|" ou "(") ou começando pela empresa em palavras inteiras. Com uma palavra só, liga só à EMPRESA; o "começa por" pede empresa de duas palavras ou mais.
3. **Nunca liga** (vai às sobras do `--detalhe` e entra como tarefa do comercial sem lead): primeiro nome sozinho, nome parecido sem ser igual (prefixo comum de 4+ letras, palavra em comum, grafia abreviada), mais de um lead candidato e "indicação de X" (quem indicou não é o lead).
4. Citado com duas palavras ou mais, sem lead igual nem parecido: o lead é criado em Qualificação (origem `cartao:<id da tarefa>`, fato passado, sem porta nem mensagem). Tarefa concluída nunca cria lead.

## 3. A prova do importador

Banco descartável `producao21b2_ensaio_test` no Postgres da `rootos-final` (5443): a cópia da produção de 19/10 (`producao-root-20261019b.dump`) + as 102 migrations + a simulação do estado de 21/10 da rodada anterior (pasta Administrativa vazia e o lead criado à mão). A lista Comercial e a lista do contato existem na cópia.

| Etapa | simular | valer | valer de novo | simular |
|---|---|---|---|---|
| Total de escritas | 160 | 160 | 0 | 0 |
| Etapas da rodada principal (estrutura, leads, clientes, contratos, implantação, limpezas), como na `RESULTADO-PRODUCAO-21` | 123 | 123 | 0 | 0 |
| fato, dono e etapa do lead que a tarefa criou | 3 | 3 | 0 | 0 |
| lista do comercial criada | 1 | 1 | 0 | 0 |
| tarefas da lista Comercial movidas | 15 | 15 | 0 | 0 |
| · ligadas a lead existente | 2 | 2 | 0 | 0 |
| · lead criado em Qualificação | 1 | 1 | 0 | 0 |
| · internas (não citam ninguém) | 5 | 5 | 0 | 0 |
| · ambíguas (sobras, entram sem lead) | 7 | 7 | 0 | 0 |
| lista Comercial arquivada | 1 | 1 | 0 | 0 |
| lista do contato: cartão / lista arquivados | 1 / 1 | 1 / 1 | 0 | 0 |

Sobras 7 (as 7 ambíguas; a "lista solta de teste" que sobrava na rodada principal era a lista do contato e saiu). Erros 0. Contadores de efeito externo (mensagens, aprovações, cobranças, documentos, salas, contratos do Financeiro, reações, decisões) iguais antes e depois de cada passada. No banco depois: 15 tarefas na lista do comercial, 3 com lead, 2 concluídas. Conferido no `--detalhe` (fora do git): as duas ligadas casam por nome igual e por "começa pelo nome da empresa"; nenhuma ligação a lead errado. Antes da revisão a regra era mais frouxa e deu o mesmo resultado na cópia (primeiro banco, `producao21b_ensaio_test`).

## 4. Provas

| Suíte | Resultado |
|---|---|
| Novas do adendo | API: `comercial-tarefas` 12, `comercial-importar-crm` 17, `work-arvore-editar` 17. Web: `comercial-tarefas` 9, `trabalho-arvore-editar` 21 (e `trabalho-vazios-e-excluir` ajustada ao diálogo novo) |
| API inteira | 5000 casos, 4655 verdes, 310 vermelhos, 35 pulados. Os vermelhos estão nos arquivos da linha de base, mais três que passam sozinhos (`pauta-dm-automatica` 32/32, `pauta-lote-da-semana` 14 + 15 pulados, `trabalho-atas-granola` 21/21): carga da suíte inteira |
| Web inteira | 1591 casos, 1513 verdes, 78 vermelhos, nos mesmos 9 arquivos da linha de base; `agentes-estado` oscila sozinho (11 e 12 vermelhos em duas passadas) e o adendo não toca agentes |
| `tsc` | limpo na API e no web |
| Isolamento | nenhuma tabela nova; `WorkTask.leadId` com FK composta `(leadId, orgId)` em tabela que já tem RLS FORCE |
| Política | sem capacidade nova neste adendo |

| Roteiro e2e (imagem `rootos-final-app:adendo21`) | Onde | Resultado |
|---|---|---|
| `producao21.mjs` com os 7 passos do adendo | seed, 3031 | **PASSA, 20 passos, 37 s**. Adendo: criar pasta inline, renomear com duplo clique e o repetido recusado, arrastar a lista para outra pasta, Alt+↓, apagar pasta com listas para Sem pasta, apagar lista pelo menu com o nome, 390 sem rolagem lateral; Funil com o bloco, "+ tarefa", a contagem sobe e desce ao concluir, a lista do comercial fora da árvore; painel do lead com "+ tarefa" ligada ao lead e a linha do funil mostrando a tarefa; bloco no claro e a 390. Fotos `homolog/provas/adendo-producao21-*.png` |
| `interface.mjs` | seed, 3031 | **PASSA, 17 passos** |
| `painel.mjs` | seed, 3031 | **PASSA, 13 passos** (com `UX_API`/`UX_WEB`/`HOMOLOG_ENV` da 3031; o padrão do script é a stack antiga 3010, e três passadas minhas foram lá por engano: criaram leads de prova fictícios na 3010 e caíram no passo do mover, que lá ainda é a tela antiga) |
| `final.mjs` | cópia, 3030 | **17/17** (fotos com dado real em `homolog/organizar/producao21b-final/`, fora do git) |

**As stacks** (`up -d --no-build api web`, bancos não recriados): `rootos-final` (3030) com 202 tarefas, 19 leads, 18 `Partner`, 8 usuários, 19 listas, 5 pastas, 84 status antes e depois (migrations 101 → 102); `rootos-final-seed` (3031) com 81, 51, 11, 5, 13, 12, 47 antes e depois. O passo de depuração do mover na 3031 moveu um lead fictício do seed para E3.

**Revisão adversarial curta** (só leitura, sobre o diff desde a tag): sem tarefa ativa levada sem escolha, sem vazamento entre empresas, permissões como pedidas. **Dois a corrigir, corrigidos com teste:** (1) o casamento aceitava o nome inteiro do lead como empresa: um lead que se chama só por um primeiro nome ligaria "FUP <nome>" e "Proposta <nome> <sobrenome>…"; agora uma palavra liga só à empresa e o "começa por" pede empresa de duas palavras ou mais; (2) o nome do contato estava em dois documentos e o sha256 do nome, sem sal, se desfazia por tentativa; o nome saiu dos documentos e a lista passou a ser achada pelo id. **Notas acolhidas:** as rotas da árvore não alcançam a lista do comercial (404), e ela volta sozinha se alguém a arquivar pelo banco; a lista do contato só sai com no máximo 1 cartão ativo. **Achado meu:** apagar a lista depois de "mover as tarefas" levaria em cascata os valores dos campos próprios dela, que as tarefas movidas guardam; agora a lista é arquivada nesse caso.

## 5. Para publicar (orquestrador do Mac): as duas rodadas juntas

Imagem a partir da tag `producao-21b-20261021` (contém a `producao-21-20261021`).

1. **Migrations** (aplicadas pelo `migrate deploy` do container, na ordem):
   - `20261021100000_trabalho_arquivadas`: `WorkFolder.arquivadaEm` e `WorkList.arquivadaEm` (colunas nulas).
   - `20261021140000_ata_sugestao_ref_do_drive`: só o CHECK de `AtaSugestao.ataRef` (aceita `drive:`).
   - `20261021200000_tarefa_do_lead`: `WorkTask.leadId` (coluna nula), FK composta `(leadId, orgId)` → `Lead`, índice `(orgId, leadId)`.
2. **Capacidade nova** (rodada principal): `contexto.arquivo.ler`, R0, conector `drive`, delta 1.9.0 → 1.10.0. **Antes da subida**, `db:seed:politica` com `POLITICA_CAPACIDADE_NOVA_AUTOR='<quem responde>'` e `POLITICA_CAPACIDADE_NOVA_MOTIVO='Produção 21/10: contexto.arquivo.ler (R0) para ler as atas da pasta do Drive pela porta'`. O adendo não traz capacidade nova.
3. **Variáveis novas: nenhuma** nas duas rodadas. `WHATSAPP_PROVEDOR` fica `simulado` até o Rodrigo ligar a Evolution.
4. **Permissões novas: nenhuma** (as tarefas do comercial usam `leads.ver`, `leads.editar` e `tarefas.editar`).
5. **O importador na produção**, dentro do container da API, depois da imagem nova no ar, num momento quieto (substitua `<api>` e `<e-mail>`; o `--detalhe` fica no servidor, fora de repositório, e tem dado de cliente):
   ```bash
   docker exec -w /app/apps/api <api> node dist/scripts/importar-crm.js --org root --como <e-mail> --detalhe /tmp/importar-crm-simular.md
   # conferir com o Rodrigo as contagens e o /tmp/importar-crm-simular.md, em especial:
   #  - "leads.reaproveitados" = 1 (o lead criado à mão em 21/10 casa com o cartão); 0 = pare (haveria duplicata);
   #  - "comercial.ligadas": cada linha "ligar ao lead" no detalhe tem de ser o lead certo; na cópia foram 2;
   #  - "comercial.leads": o lead a criar em Qualificação; na cópia foi 1;
   #  - "contato.lista" = 1; se vier 0 e a lista estiver nas sobras, o id mudou ou ela cresceu: o Rodrigo decide à mão.
   docker exec -w /app/apps/api <api> node dist/scripts/importar-crm.js --org root --como <e-mail> --valer --web https://os.operacaoroot.com --detalhe /tmp/importar-crm-valer.md
   docker exec -w /app/apps/api <api> node dist/scripts/importar-crm.js --org root --como <e-mail> --detalhe /tmp/importar-crm-depois.md
   # o último tem de dizer "Zero a fazer". Saída 3 = algum efeito externo contado a mais: pare e confira.
   ```
   Na cópia de 19/10 a passada inteira deu 160 escritas (§3); a produção de 21/10 pode diferir no que mudou depois da cópia. Depois da conferência, o Rodrigo decide apagar os `/tmp/importar-crm-*.md`.
6. **Conferir na produção depois**: Funil vivo (as colunas da rodada principal, o bloco "Tarefas do comercial" com as internas e as ambíguas, e os cartões com "N tarefas abertas"), o painel dos leads ligados (bloco Tarefas), Contratos vivos, Implantação, e Tarefas: sem as listas Comercial e do contato, sem a pasta CRM e a Administrativa, Gestão com Administrativo, Financeiro e Pessoas, Clientes com Esteira, Onboarding e Execução, Sem pasta com Operação, e o "+ nova pasta" e o "⋯" de cada pasta e lista.

## 6. [a decidir]

- **As 7 ambíguas** entram como tarefas do comercial sem lead (no bloco do Funil vivo). Quem quiser ligar uma ao lead certo usa "editar" na tarefa; o motivo de cada uma está no `--detalhe`.
- **O lead criado pelo importador** a partir de uma tarefa nasce em Qualificação com o nome que o título cita (o detalhe diz qual); confira antes do `--valer`.
- **O nome do contato continua no histórico do git** (no roteiro do adendo como foi entregue e numa linha do progresso desta rodada), embora tenha saído dos arquivos; reescrever o histórico não foi feito.
- **Tarefa recorrente ligada a lead**: concluída pelo Comercial, a próxima ocorrência herda o lead; concluída por outra tela, não (o `WorkService` não copia `leadId`).
- **"+ tarefa" do Comercial não confere título repetido** (o Dia a dia confere).
- **Arrastar pasta para dentro de outra pasta** não foi feito (arrastar pasta só reordena); mover pasta segue pelo caminho que já existia.
- **Valores de campos próprios** da lista não acompanham as tarefas movidas para outra lista (ficam guardados; por isso a lista de origem é arquivada, não apagada).
- Herda o [a decidir] da `RESULTADO-PRODUCAO-21` (§8), menos "a lista solta de teste", que era a do contato e agora sai.

## 7. Apagar depois

Ninguém apagou nada neste adendo. Herda a lista da `RESULTADO-PRODUCAO-21` (§9), mais:

- Bancos de ensaio no Postgres da `rootos-final` (5443), **com dado real da cópia de 19/10, importado**: `producao21b_ensaio_test` e `producao21b2_ensaio_test`.
- Bancos de teste no Postgres 5440 (fictícios): `rootos_p21b_a_test`, `rootos_p21b_b_test`, `rootos_p21b_c_test`, `rootos_p21b_int_test`, `rootos_p21b_full_test`.
- `C:\Users\User\dev\scratch-p21b\` (scripts, logs e os `--detalhe` do importador, **com dado real**).
- `homolog/organizar/producao21b-final/` (fotos e placar do `final.mjs` com dado real; fora do git).
- Uma imagem sem tag, de um build intermediário deste adendo (a tag `producao21b` voltou à imagem antiga da rodada principal, `7e19e3c5e393`, que já estava na lista de apagar).
- Worktrees dos agentes em `.claude/worktrees/` (branches `worktree-agent-*` integradas).
- Na stack antiga 3010: os leads fictícios de prova que o `painel.mjs` criou por engano lá.

Para voltar: `rootos-final-app:producao21c` segue no Docker. Troque a tag nos dois `docker-compose.final*.yml` e rode `up -d --no-build api web` **num shell sem as variáveis de outra stack exportadas**.
