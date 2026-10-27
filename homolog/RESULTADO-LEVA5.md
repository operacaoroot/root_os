# Leva 5 · resultado (27/10/2026)

Roteiro: `docs/comercial/RODADA-LEVA5-20261027.md` (reunião Rodrigo + Lucas + Pedro de 26/10 e as respostas do Rodrigo item a item). Base: produção `c88be864` (layout-leva4o, 26/10 20:55 BRT) + `main` 6a9be2a5, na branch `leva5/20261027`.

**Enquanto a leva era montada, a outra sessão (chave do Pedro) publicou `frota-f41461c-20261027` na produção às 04:31Z de 27/10** (a Frota: servidores de cliente que a ROOT opera, seção própria do OS, migration `20261027040000_frota`), construída sobre o merge `85eff404` desta mesma leva (ela leu o `leva5.bundle` em `/srv/rootos/bundles`). A leva 5 absorveu esses dois commits no merge `c4b2f2ac` (conflitos só de forma: alinhamento no schema e fim de linha em `nav.ts`/`nav.test.ts`; a área `frota` entrou somada), e a imagem publicada parte daí. Nota deixada para a outra sessão em `/srv/rootos/bundles/LEIA-ME-leva5.txt`: a próxima leva deve partir de `leva5/20261027`, senão apaga a leva 5 da produção. Quatro frentes em paralelo, cada uma com relatório próprio em `homolog/leva5/`:

| Frente | Itens da reunião | Relatório | Commit |
|---|---|---|---|
| Trabalho: Arquivo do ClickUp, Implantação vai para a lista Onboarding, botão direito com Histórico em toda tela de tarefa | 1, 8, 7 (tarefas) | `homolog/leva5/L1-L3-L2tarefas.md` | `840e3102` |
| Comercial: painel do lead enxuto (Geral + Pendências e sugestões), botão direito no card do lead, funil fluido | 11, 16, 7 (leads), 14 | `homolog/leva5/L4-L2leads-L5.md` | `1e9cf265` |
| Sala do cliente: nasce com o lead, o "não abre" explica e resolve, acompanhamento para o cliente | 15 | `homolog/leva5/L6.md` | `969e9dc1` |
| Chat flutuante abre no fim com menu fixo; conexão "Claude (Anthropic)" | 17, 21 | `homolog/leva5/L7-L8.md` | `94542436` |

Regra da casa mantida nas quatro: dado nenhum apagado, migrations só aditivas, scripts simulam por padrão, cada frente com desfazer, nenhuma permissão, capacidade ou variável de ambiente nova (`db:seed:politica` não precisa rodar).

## Publicado em 27/10/2026, 04:52Z (01:52 BRT)

- Release **`leva5-c4b2f2ac-20261027`** (`/srv/rootos/releases/leva5-c4b2f2ac-20261027/`): imagem `rootos-official:leva5-c4b2f2ac` (sha256 `5f7d5313…`), antes `rootos-official:frota-f41461c` (`0a78ce78…`). Backup do banco de antes em `banco-antes.dump` (105 MB) na pasta da release; cadeia de antes e de depois ali também (`REPORT.txt` diz como voltar). Migrations `20261027010000_arquivo_do_clickup` e `20261027020000_ficha_geral` aplicadas; API saudável em 18 s; `/login` 200; `conector "anthropic" implementa o contrato (por AnthropicConector)` no arranque.
- Passos de dado na produção (ensaio e depois para valer; logs `dados-*.log` e os "antes" em `antes-dos-scripts/*.json` na pasta da release): **Arquivo do ClickUp** criado (`5a48bfda`) com Gestão de Temas, Rotina de stories, Design & Gravação e Copy; Análise, Calendário de conteúdo e Demandas gerais ficaram; 39 tarefas abertas em Todas/Dia a dia antes e depois. **Implantação**: 8 trilhos ativos, 6 já tinham card, 2 cards criados em "Fechado no comercial" (Lucas Rezende, Campo Bom). **Salas**: 22 leads, 3 em saída, nenhum lead ativo tinha sala; 19 salas criadas (`--como rodrigo.saggioro@gmail.com`).
- Imagens presas contra o prune diário: `guarda-frota-f41461c` e `guarda-leva5-c4b2f2ac` (`sleep infinity`).
- Código: branch `leva5/20261027` e tag `leva5-20261027` no GitHub (operacaoroot/marketing-os); `main` avançada por fast-forward até o mesmo commit.

## Para publicar (como foi feito)

1. **Imagem nova do api e do web** (uma imagem só, como as levas do Lucas). Build na VPS a partir do bundle: `/srv/rootos/bundles/build-leva5.sh <sha>`.
2. **Migrations aditivas, duas**, rodadas à parte pelo `publicar-leva-com-migration.sh` (na produção a API parte com `node dist/main.js`, sem migrate):
   - `20261027010000_arquivo_do_clickup`: `WorkFolder.arquivoDoClickUp`, `WorkList.arquivoDoClickUp` (boolean, padrão falso).
   - `20261027020000_ficha_geral`: `ComercialFicha.tipoDePessoa`, `preferenciasDeAtendimento`, `linkDaProposta` (nulas).
3. **Subida**: `bash /srv/rootos/bundles/publicar-leva-com-migration.sh rootos-official:leva5-<sha> leva5-<sha>-20261027` (backup do banco, conferência de que só a imagem muda na cadeia, migration, api e web; volta sozinho se a API não ficar saudável). A cadeia que vale é a que está no ar (inclui `agente-env.yml` e `config-20261022/*`).
4. **Conferir no arranque** (`docker logs mktos_api`): a linha `conector "anthropic" implementa o contrato (por AnthropicConector)` e nenhuma recusa de arranque.
5. **Passos de dado, dentro do `mktos_api`** (`docker cp deploy/layout/<script>.js mktos_api:/tmp/` e `docker exec mktos_api node /tmp/<script>.js`), sempre o ensaio antes:
   - `arquivo-do-clickup.js` → `--valer`: cria "Arquivo do ClickUp" dentro de Marketing e leva para lá as quatro listas da reunião (Gestão de Temas, Copy, Rotina de stories, Design & Gravação). Prova: a contagem de abertas no Dia a dia bate com Trabalho › Todas antes e depois (o script imprime).
   - `implantacao-para-lista.js` → `--valer`: um card na lista "Onboarding de cliente" para cada trilho ativo sem card (origem `implantacao-20261027`).
   - `salas-faltantes.js` → `--valer --como <e-mail do Rodrigo>`: sala para cada lead ativo sem sala.
   Os três guardam o "antes" em `/tmp/*.json` no container: copiar para fora antes de recriar o container.
6. **Smoke depois da subida**: `GET /api/integrations/cartoes` traz a linha `anthropic`; `GET /api/integrations/anthropic/estado` diz `chave.origem = 'ambiente'` (a chave da env continua valendo); `/comercial/funil` abre o lead na aba Geral; o Chat flutuante abre no fim; `/trabalho` mostra Clientes (recolhida) e, depois do script, Arquivo do ClickUp; o menu não mostra mais "Implantação de clientes".
7. **Avisar**: o Lucas (Marketing) de que as quatro listas mudaram de pasta e saíram de Todas; o Pedro de que a Implantação virou lista por enquanto e de que a pasta Clientes voltou à árvore do Trabalho (recolhida).

## Como desfazer

- **Imagem**: `REPORT.txt` da release (`cadeia-antes.txt`, `up -d --no-deps --no-build api web`). As colunas novas ficam no banco, nulas/falsas, e o código antigo as ignora.
- **Dados**: `implantacao-para-lista.js --desfazer` (cards criados vão à Lixeira, `cardId` volta a nulo), `arquivo-do-clickup.js --desfazer` (listas voltam, marcas saem), `salas-faltantes.js --desfazer --como` (revoga só as salas criadas pelo script e nunca abertas). Ordem inversa da subida.
- **Painel do lead**: as abas antigas voltam trocando `ABAS_DO_PAINEL` em `apps/web/src/app/comercial/_painel/estado.ts`; Fio, Sessão, Dinheiro e Decisões continuam vivas por link direto (`aba=fio|sessao|dinheiro|decisoes`).
- **Chave do Claude gravada pela tela**: `DELETE /api/integrations/anthropic/chave` volta à variável de ambiente.

## O que o Rodrigo decide

1. **Painel do lead, variante A ou B**: A (padrão) = etapa como faixa no topo e três cartões lado a lado (Quem · Origem · Negócio); B = cartões em coluna à esquerda e a linha do tempo resumida (5 últimos fatos) à direita. O botão "Variante A/B" no cabeçalho do painel alterna (fica no navegador). Para fixar: `VARIANTE_PADRAO_DO_PAINEL` em `packages/shared/src/ficha-geral.ts`. Fotos: `homolog/provas/leva5-painel-geral-A-*.png` e `leva5-painel-geral-B-*.png`.
2. **"Continuidade" como produto**: o catálogo (`COMERCIAL_PRODUTOS`) tem imersão, operação, kit e turma, e a tabela de preço depende dele; a Geral oferece esses quatro. Acrescentar "Continuidade" mexe no shared e na tabela de preço.
3. **"Como conheceu" na coluna `canal`**: a lista nova (Indicação de cliente, Indicação de parceiro, BNI, Evento, Rede social, Site, Comunidade, Outro) convive com os três canais antigos do C07 (`conteudo`, `erp_parceiro`, `indicacao`), que seguem válidos. Unificar é um script de dado, quando quiser.
4. **Pasta Clientes de volta à árvore do Trabalho** (recolhida, só para abrir): reverte só a parte "fora da árvore" da decisão I3 de 22B, porque sem a subseção Implantação a lista Onboarding ficaria sem porta. Continua fora de Todas, das contagens e do Dia a dia.
5. **Quais listas vão ao Arquivo do ClickUp**: só as quatro da reunião. Análise, Calendário de conteúdo e Demandas gerais ficam em Marketing.
6. **Número do WhatsApp da Root na sala do cliente**: a sala mostra o botão "falar com a Root" assim que a nota `comercial.whatsapp.numero` (primeira linha = número com 55) for escrita no Contexto; até lá, o marcador de sempre.
7. **Catálogo do Lucas** (`docs/catalogo-root-os/index.html`): esta leva não acrescentou os itens P-75+ ali; o conteúdo está neste resultado e nos relatórios por frente.

## Provas

- Typecheck do monorepo (shared, policy, api, web) e os testes de unidade/componente das quatro frentes: ver a seção "Conferência" abaixo.
- e2e `homolog/e2e/leva5.mjs` contra a cópia do banco da produção na VPS (projeto `rootos-teste-leva5`, portas 4160/4161, pelo túnel ssh): saída em `homolog/provas/leva5.json` e `leva5-*.png`.

## Conferência

- **Typecheck** (`tsc --noEmit`) dos quatro pacotes na branch final: shared, policy, api e web com **0 erros**.
- **Suíte do web** (vitest, 173 arquivos): 1910 casos verdes, 68 vermelhos em 11 arquivos. Medido contra a base (85eff404) com os mesmos arquivos: `agentes-estado` (11), `pauta-voz` (13), `financeiro-gerar-contrato` (3) e `financeiro-obrigacao` (3) já falhavam antes da leva; `agentes-fonte-autorizada`, `agentes-procedimento-local`, `pauta-agenda` e `pauta-lote-da-semana` são das mesmas famílias, fora de tudo o que a leva tocou; `trabalho-projecao-unificada` só estourou o prazo de 5 s sob carga (1,0 s isolado). Os três vermelhos desta leva foram consertados em `e6debdde` (aba Sala e a I3 da 22B revista).
- **Suíte da API** (vitest, 250 arquivos): 4021 casos verdes, 108 vermelhos em 46 arquivos, quase todos `PrismaClientConstructorValidationError` (sem `TEST_DATABASE_URL` no Mac: os testes com banco não rodam aqui); `arquitetura` (1 caso, importação do Obsidian) e `contrato-de-conector` (7, dublê sem `user`) já falhavam antes. Os testes puros das quatro frentes passaram (sala-motor-puro 12, work-arquivo-do-clickup 7, comercial-ficha-geral-puro 11, llm-chave-da-anthropic 21, integracoes-anthropic 9, contrato-de-conector-padrao 33, conexao-cartoes 11, llm-modelo-por-funcao 18).
- **Ambiente de teste na VPS** (`rootos-teste-leva5`, cópia do banco da produção de 27/10 04:26 UTC, imagem `leva5-d9a5933c`): as duas migrations aplicaram (`126 migrations found`, `All migrations have been successfully applied`); a API subiu saudável com a linha `conector "anthropic" implementa o contrato (por AnthropicConector)`; os três scripts rodaram em ensaio e depois para valer: Arquivo do ClickUp criado com as 4 listas (39 abertas antes e depois), 2 cards criados na lista Onboarding (6 trilhos já tinham), 19 salas criadas.
- **e2e `homolog/e2e/leva5.mjs`** pelo túnel, 23 passos, 24 fotos, 83 s, tudo verde: cartão Claude no catálogo e `anthropic/estado`; sala/estado e sala pública 200 com Acompanhamento; menu do lead com Histórico (22 cartões); painel abre na Geral com 17 campos, variante B com linha do tempo, Histórico com linhas, Pendências (11 a preencher, 3 passos), aba Sala; popup do Chat no fim (`scrollTop + clientHeight = scrollHeight`, `overscroll-behavior: contain`, foco na caixa de resposta) com o menu fora do que rola; árvore com Clientes e Arquivo do ClickUp, menu sem "Implantação de clientes", `/trabalho/implantacao` respondendo; cartão Claude em Conexões; 390 px sem rolagem horizontal. Fotos commitadas: só as que não mostram conversa de WhatsApp (`leva5-trabalho-*`, `leva5-conexoes-*`, `leva5-painel-geral-A/B-dark`, `leva5-painel-pendencias-dark`); as demais ficam no Mac.
