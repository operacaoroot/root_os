# Leva 5 · resultado (27/10/2026)

Roteiro: `docs/comercial/RODADA-LEVA5-20261027.md` (reunião Rodrigo + Lucas + Pedro de 26/10 e as respostas do Rodrigo item a item). Base: produção `c88be864` (layout-leva4o, 26/10 20:55 BRT) + `main` 6a9be2a5, na branch `leva5/20261027`. Quatro frentes em paralelo, cada uma com relatório próprio em `homolog/leva5/`:

| Frente | Itens da reunião | Relatório | Commit |
|---|---|---|---|
| Trabalho: Arquivo do ClickUp, Implantação vai para a lista Onboarding, botão direito com Histórico em toda tela de tarefa | 1, 8, 7 (tarefas) | `homolog/leva5/L1-L3-L2tarefas.md` | `840e3102` |
| Comercial: painel do lead enxuto (Geral + Pendências e sugestões), botão direito no card do lead, funil fluido | 11, 16, 7 (leads), 14 | `homolog/leva5/L4-L2leads-L5.md` | `1e9cf265` |
| Sala do cliente: nasce com o lead, o "não abre" explica e resolve, acompanhamento para o cliente | 15 | `homolog/leva5/L6.md` | `969e9dc1` |
| Chat flutuante abre no fim com menu fixo; conexão "Claude (Anthropic)" | 17, 21 | `homolog/leva5/L7-L8.md` | `94542436` |

Regra da casa mantida nas quatro: dado nenhum apagado, migrations só aditivas, scripts simulam por padrão, cada frente com desfazer, nenhuma permissão, capacidade ou variável de ambiente nova (`db:seed:politica` não precisa rodar).

## Para publicar

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

(preenchida na publicação)
