# Leva 5 · L1, L3 e L2 (parte das tarefas) · 27/10/2026

> Roteiro: `docs/comercial/RODADA-LEVA5-20261027.md` (reunião de 26/10, Rodrigo + Lucas + Pedro). Branch `leva5/20261027`, base = produção c88be864 + main. Este arquivo não tem dado de cliente nem segredo: só contagens, nomes de lista e ids curtos. Nada foi à produção; nada foi commitado por este agente.

## 1. O que mudou

### L1 · Trabalho sem o espelho do ClickUp (item 1)

Como as listas importadas eram identificadas: cada lista do ClickUp guarda o id numérico de lá em `WorkList.externalId` (ex.: Gestão de Temas = `901327640001`), e todas moram na pasta de topo **Marketing** (P-50, `pastas-por-area.js`). Não havia marca de "importada": a regra nova não depende do nome nem do externalId, e sim de uma coluna, pelo mesmo desenho de `doComercial`.

| Onde | O quê |
|---|---|
| `apps/api/prisma/schema.prisma` (só `WorkFolder` e `WorkList`) | colunas `arquivoDoClickUp Boolean @default(false)` |
| `apps/api/prisma/migrations/20261027010000_arquivo_do_clickup/migration.sql` | só as duas colunas (aditiva, `IF NOT EXISTS`); quem move e marca é o script, porque a decisão de quais listas vão é da empresa da casa, não do esquema |
| `apps/api/src/work/arquivadas.ts` | a regra num lugar só: `listaForaDoArquivoDoClickUp()`, `tarefaForaDoArquivoDoClickUp()`, `idsDasPastasDoArquivoDoClickUp()`, `ehDoArquivoDoClickUp()` (a marca da pasta desce para subpastas e listas) |
| `apps/api/src/work/work.service.ts` | `estrutura()`: pasta e lista ganham `arquivoDoClickUp: true` no DTO (a pasta FICA em `folders`, diferente da Clientes); "Todas" (`f.todas`) e "a pessoa em todas as listas" ganham `tarefaForaDoArquivoDoClickUp()` no `AND` |
| `apps/api/src/work/tarefas-do-dia.service.ts` | `ondeSaoTarefas` (painel, contadores e criação do Dia a dia) ganha o mesmo recorte |
| `packages/shared/src/arquivo-do-clickup.ts` (novo) | nome da pasta, as quatro listas da reunião, `ehIdDoClickUp`, `ehNomeDoArquivoDoClickUp`, `ehDoArquivoDoClickUp`, `listasForaDoArquivoDoClickUp`, a frase `TRAB_ARQUIVO_DO_CLICKUP` |
| `packages/shared/src/schemas.ts` | `TrabListaDto.arquivoDoClickUp?` e `TrabPastaDto.arquivoDoClickUp?` |
| `apps/web/src/components/trabalho/TrabalhoView.tsx` | `listasDoRecorte` passa por `listasForaDoArquivoDoClickUp`: **os status das listas do Arquivo não viram coluna em "Todas", com ou sem segmento**. Esta é a regra escolhida (em vez de mudar o padrão de `vazios`): é a mesma pergunta que a API já responde para as tarefas, e `?vazios=ocultar` (P4) continua valendo para o resto |
| `apps/web/src/components/trabalho/ArvoreDoTrabalho.tsx` | a pasta marcada vem RECOLHIDA por padrão (memória nova `trabalho-arvore-abertas`, porque para ela o que se lembra é quem abriu), com a frase no título e `data-pasta-do-arquivo-do-clickup`; as listas dela levam `data-lista-do-arquivo-do-clickup` |
| `deploy/layout/arquivo-do-clickup.js` (novo) | simula por padrão; `--valer` cria a pasta "Arquivo do ClickUp" dentro de Marketing (se não existir), move para lá as quatro listas (mesmos ids; tarefas, status e campos intactos), marca pasta e listas, audita (`work.folder.create|update`, `work.list.update`, `metadata.origem = script.arquivo-do-clickup`); `--desfazer` volta a partir de `/tmp/arquivo-do-clickup-antes.json` (listas às pastas de antes, marcas falsas; a pasta criada sai só se ficou vazia). Lista com id do ClickUp que não está nas quatro (Análise, Calendário de conteúdo, Demandas gerais) FICA e é listada no ensaio |

Nada é apagado nem arquivado: a Produção do Marketing continua lendo o status das listas (a leitura por id e o quadro da lista pelo id não mudaram).

### L3 · Implantação vai para a lista "Onboarding de cliente" (item 8)

| Onde | O quê |
|---|---|
| `packages/shared/src/nav.ts` | item `implantacao` → `oculto: true` (a rota `/trabalho/implantacao` continua respondendo pelo link); `ROTAS_ABSORVIDAS` ganha `/trabalho/implantacao → /trabalho` (o destino é a árvore, porque o id da lista Onboarding é de cada empresa e `nav.ts` é estático; pela árvore a lista abre com `?lista=<id>`). `/onboarding` continua apontando para `/trabalho/implantacao` (a página de `/onboarding` redireciona para lá e isso não mudou); `/onboarding/bancada` não é item do NAV (rota de detalhe), nada a fazer |
| `packages/shared/src/pasta-do-comercial.ts` | cabeçalho registra a reversão parcial de I3 (22B) por pedido do Rodrigo em 26/10; `pastasNaArvoreDoTrabalho(e)`, `ehPastaDoComercial(e, id)` e a frase `TRAB_PASTA_DO_COMERCIAL_NA_ARVORE` |
| `apps/web/src/components/trabalho/ArvoreDoTrabalho.tsx` | a pasta Clientes (que a API segue mandando em `pastasDoComercial`, **sem mudança na API**) é desenhada no FIM da árvore, recolhida por padrão, com o selo "· Comercial"; abre as listas (clique = `?lista=<id>`); não se arrasta, não recebe nem solta lista, não entra na ordem, não ganha ícone; o "⋯" mostra Renomear/Mover/Excluir desabilitados com a frase. Só aparece com a árvore inteira (sem pasta escolhida no topo). Continua fora de Todas, das contagens, do Dia a dia, dos chips de pasta e dos segmentos |
| `apps/web/src/components/tarefas/VisaoGeralDasTarefas.tsx`, `apps/web/src/app/dia-a-dia/page.tsx` | o cartão `ImplantacaoNoDiaADia` sai do Dia a dia (o componente fica no código, sem uso; o WhatsApp ocupa a linha inteira) |
| `deploy/layout/implantacao-para-lista.js` (novo) | para cada `OnboardingTrilho` com `fase != encerrado` SEM card (cardId nulo, card inexistente ou na Lixeira), cria o card na lista Onboarding de cliente: nome do cliente, etapa pela fase do trilho (mapa `FASES_DA_ETAPA` do shared, a primeira etapa da lista que aceita a fase; fase fora do mapa cai na primeira etapa aberta, e o ensaio diz), descrição com `/onboarding/<id>` e `Origem: implantacao-20261027`, comentário assinado "Implantação", auditoria `work.task.create` com `metadata.origem = implantacao-20261027`, e grava `OnboardingTrilho.cardId` (e `ComercialFicha.cardId` quando estava vazia). **Trilho com lead**: o id do card é `cardIdDoLead` (importado de `comercial/card-da-implantacao`, sem editar), para o fechamento futuro achar o mesmo card; `abrirCardDaImplantacao` não é chamado de propósito porque as três procedências dele (fechamento, antecipado, importação do CRM) escreveriam no card uma história que não é a destes clientes. **Trilho sem lead**: id derivado do trilho (`uuidDe`), para rodar de novo achar o mesmo card. Card com esse id arquivado ou na Lixeira VOLTA (como o fechamento faz). `--desfazer`: cards criados vão para a **Lixeira** (recuperável; "dado nenhum é apagado"), os restaurados voltam ao estado de antes, e `cardId` do trilho volta ao que era; só toca card cuja auditoria tem a origem. O script conta os trilhos ao rodar (não dá para medir aqui) |
| `apps/web/tests/unit/nav.test.ts` | MENU_FINAL, OCULTOS_E_DESTINO (`implantacao: '/trabalho'`), contagens 45/13/12, filhos de Tarefas = `['trabalho-atas']` |

Não mudou: `OnboardingTrilho`, `OnboardingCard`, `/e/<token>`, `apps/api/src/onboarding/**`, `apps/api/src/implantacao/**` (a rota `GET /trabalho/implantacao/resumo` continua viva, sem leitor na tela).

### L2 (tarefas) · Botão direito em todas as telas de tarefa, com Histórico (item 7)

| Onde | O quê |
|---|---|
| `apps/web/src/components/historico/HistoricoDaEntidade.tsx` (novo) | CONTRATO: `export function HistoricoDaEntidade(props: { entityId: string; entityType?: string; titulo?: string; aberto: boolean; onFechar: () => void })` + `export default`. Lê `GET /audit?entidade=<id>&limit=100&tipo=<entityType>` e mostra do mais novo ao mais velho: quando (SP), quem (`actorName` que a API resolve; conta apagada = id curto; `system` = "sistema"; `ai` = "agente <nome>"), a ação e as chaves que mudaram entre `before` e `after` (antes → depois, `mudancasEntre`), com o JSON inteiro como fallback quando um lado não é objeto. Sem `auditoria.ver` (ou com 403 da API) diz "Você não tem permissão para ver o histórico (auditoria.ver)." em vez de erro. Esc e clique fora fecham; portal, `role=dialog` |
| `apps/api/src/audit/audit.controller.ts` | `GET /audit` ganha `tipo` (entityType), mesma permissão `auditoria.ver`, validação `^[0-9a-zA-Z_.:-]{1,64}$` |
| `apps/api/src/audit/audit.service.ts` | `list` aceita `entityType`; `before`, `after` e `metadata` entram na resposta SÓ quando a lista é de uma entidade (`entityId` no filtro): a listagem geral do Registro de ações segue leve |
| `packages/shared/src/schemas.ts` | `AuditLogRowSchema` ganha `before?`, `after?`, `metadata?` (`z.unknown().optional()`) |
| `packages/shared/src/menu-da-tarefa.ts` | ação `historico` (nona), rótulo "Histórico", nunca desabilitada (só leitura) |
| `apps/web/src/components/trabalho/MenuDaTarefa.tsx` | item Histórico abre `HistoricoDaEntidade` com `entityType="work_task"`; o estado vive em `useMenuDaTarefaProvider`/`useMenuDaTarefaProprio` (o dono do portal), porque o painel do menu morre no clique fora. Props atuais intactas; só acresceu `onHistorico?` interno |
| `apps/web/src/components/tarefas/TarefasDoDia.tsx` | o calendário (dias, "Sem prazo", "Repetem sem data") ganha `alvoDoMenu` (botão direito e Shift+F10). Quadro e lista já tinham o menu desde a 22B |
| `apps/web/src/components/trabalho/QuadroPorEtapa.tsx`, `CalendarioDeTarefas.tsx` | `alvoDoMenu` nos cartões (Caixa › Minhas tarefas no quadro e no calendário). A Tabela já tinha |

Estado encontrado: Dia a dia (`TarefasDoDia`), Caixa › Minhas tarefas (`AbaMinhasTarefas`) e Financeiro › Tarefas (`app/financeiro/tarefas/page.tsx` = `TarefasDoDia area="Financeiro"`, idem Marketing › Tarefas) JÁ envolviam a lista com `MenuDaTarefaProvider` e espalhavam o menu no quadro e na lista; faltavam o calendário e o quadro de Minhas tarefas, e o item Histórico. As ações continuam pelas mesmas rotas e guardas (`SoGenteNoTrabalhoGuard`, `tarefas.editar`).

## 2. Como testar na tela

**L1 (depois de `arquivo-do-clickup.js --valer`)**
1. Trabalho › árvore: dentro de Marketing aparece "Arquivo do ClickUp" recolhida (seta à esquerda, título com a frase). Abrir mostra Gestão de Temas, Copy, Rotina de stories, Design & Gravação; clicar numa abre o quadro dela normalmente, com os status de sempre.
2. Trabalho › chip Todas: as colunas são só os status das listas fora do Arquivo (os 18 herdados somem, mesmo com "Ocultar status vazios" desligado); no segmento Marketing, idem.
3. Prova das contagens: Dia a dia › Visão geral, número de abertas = Trabalho › Todas com "Ocultar concluídas" ligado e sem filtro. O script imprime `abertas antes`, `abertas nas listas do Arquivo` e `esperado depois` (e, com `--valer`, `abertas depois`): os dois números da tela têm de ser iguais entre si antes e depois, e o "depois" = antes menos as do Arquivo.

**L3**
1. Menu lateral: Trabalho tem Tarefas e Atas; "Implantação de clientes" não aparece. `/trabalho/implantacao` digitado no endereço continua abrindo o kanban; `/onboarding` redireciona para lá.
2. Trabalho › árvore (sem pasta escolhida no topo): no fim, "CLIENTES · Comercial" recolhida; abrir mostra Onboarding de cliente (e Esteira/Execução, se existirem); clicar abre o quadro. Arrastar a pasta ou uma lista dela não funciona; "⋯" mostra o porquê. A Clientes não vira chip de pasta nem segmento; as tarefas dela seguem fora de Todas e do Dia a dia.
3. Dia a dia › Visão geral: sem o cartão "Implantação"; o WhatsApp (quando ligado) ocupa a linha.
4. Depois de `implantacao-para-lista.js --valer`: cada trilho ativo tem um card na lista Onboarding de cliente com o nome do cliente, na etapa da fase, com o link `/onboarding/<id>` na descrição; abrir o card mostra a aba Trilho.

**L2**
1. Em qualquer tarefa (quadro, lista, Todas, calendário, Dia a dia, Minhas tarefas, Financeiro › Tarefas, Implantação): botão direito ou "⋯" → "Histórico" (última linha) abre a janela com quem, quando, ação e `chave: antes → depois`.
2. Com um papel sem `auditoria.ver`: a janela diz a frase, sem caixa de erro. Esc fecha.
3. Registro de ações (`/rastro`) não mudou de aparência.

## 3. Para publicar

1. Migration `20261027010000_arquivo_do_clickup` (aditiva; roda no `migrate deploy` do container). Testar antes num Postgres descartável, como sempre.
2. Imagem nova da API e do web (a API lê as colunas novas; o web desenha a árvore e o Histórico). Nenhuma variável, permissão ou capacidade nova; política inalterada.
3. Dentro do `mktos_api`, nesta ordem:
   - `node /tmp/arquivo-do-clickup.js` (ensaio: conferir a lista das quatro, as que ficam e as contagens) → `node /tmp/arquivo-do-clickup.js --valer`;
   - `node /tmp/implantacao-para-lista.js` (ensaio: conta os trilhos ativos e diz o que cria/restaura) → `node /tmp/implantacao-para-lista.js --valer`.
   Os dois guardam o "antes" em `/tmp/*.json` no container: copiar para fora antes de recriar o container se quiser desfazer depois.
4. Avisar o Lucas (Marketing) que as quatro listas mudaram de pasta e saíram de Todas, e o Pedro que a Implantação virou lista.

## 4. Como desfazer

- Scripts: `--desfazer` em cada um (ordem inversa). `arquivo-do-clickup.js --desfazer` devolve as listas e as marcas; `implantacao-para-lista.js --desfazer` manda os cards criados para a Lixeira e devolve o `cardId` dos trilhos. Os cards na Lixeira saem de vez só por "apagar de vez" (`admin.usuarios`), à mão.
- Código: a migration é aditiva (as colunas podem ficar com `false` sem efeito nenhum); voltar a imagem anterior devolve o menu e o Dia a dia.

## 5. Riscos e decisões para o Rodrigo

1. **A pasta Clientes voltou à árvore do Trabalho** (recolhida, só para abrir). Isto reverte a parte "fora da árvore" da decisão I3 da 22B ("a pasta cliente sai sim"), porque sem a subseção Implantação a lista Onboarding de cliente ficaria sem porta. Tudo o mais da I3 fica: fora de Todas, das contagens, do Dia a dia; sem renomear, mover ou apagar pelo Trabalho. A API não mudou para isso.
2. **Destino de `/trabalho/implantacao` em ROTAS_ABSORVIDAS é `/trabalho`**, não `/trabalho?lista=<id>`: o id da lista é de cada empresa e `nav.ts` é estático. A tela aceita `?lista=<id ou externalId>`; a lista Onboarding não tem externalId estável. Se quiser o link direto no menu de alguém, é `/trabalho?lista=<id da lista Onboarding da casa>`.
3. **Regra dos status herdados**: escolhi "as listas do Arquivo não dão coluna em Todas" (e não mudar o padrão de `vazios` para ocultar), porque é a mesma pergunta da API para as tarefas e não mexe no comportamento de P4 para o resto. Um status herdado que também exista, com o mesmo nome, numa lista fora do Arquivo continua aparecendo (é dela).
4. **Quais listas vão ao Arquivo**: as quatro da reunião, pelo nome. Análise, Calendário de conteúdo e Demandas gerais (também do ClickUp) ficam em Marketing, visíveis em Todas e no Dia a dia. Para mandar outras, acrescentar em `LISTAS` do script e em `LISTAS_DO_ARQUIVO_DO_CLICKUP` do shared.
5. **`implantacao-para-lista.js` não usa `abrirCardDaImplantacao`** (só `cardIdDoLead`), para não gravar no card uma procedência de fechamento/antecipado/importação que não é a destes clientes. O id derivado do lead garante que o fechamento futuro reaproveita o card. Sem rodar não dá para dizer quantos trilhos há: o ensaio conta.
6. **`--desfazer` do L3 usa a Lixeira**, não apaga de verdade: alguém pode ter comentado no card entre o `--valer` e o `--desfazer`, e apagar levaria o comentário.
7. **O que não roda localmente**: `tsc`/typecheck completo e `next build` (regra da casa para esta rodada); as mudanças de tipo foram conferidas pelos testes (vitest transforma sem checar tipos). Quem publicar deve rodar o typecheck no Predator/CI antes.
8. `GET /audit` passou a devolver `before/after/metadata` quando filtrado por entidade: a Lixeira já linka `/rastro?entidade=`; a tela do Registro de ações ignora os campos novos.

## 6. Testes

- `pnpm --filter @mktos/web exec vitest run tests/unit/nav.test.ts tests/unit/navegacao-modulos.test.ts` → 59 passaram.
- `pnpm --filter @mktos/web exec vitest run tests/component/historico-da-entidade.test.tsx tests/component/trabalho-leva5-arvore.test.tsx tests/component/trabalho-menu-da-tarefa.test.tsx tests/component/comercial-menu-da-tarefa.test.tsx tests/component/menu.test.tsx` → 58 passaram.
- `pnpm --filter @mktos/web exec vitest run` dos 15 arquivos de Trabalho/Dia a dia/Caixa tocados pela árvore, pelo menu e pelo Dia a dia (tarefas-do-dia-padrao, producao22c-whatsapp-resumo, producao22-implantacao, trabalho-pastas, trabalho-arvore-editar, trabalho-arquivadas-e-mover-pasta, trabalho-filtros-e-todas, caixa-quadro-e-pessoas, trabalho-vazios-e-excluir, painel-kpi-tarefas, trabalho-implantacao-popup, caixa-vistas, trabalho-campo-data, trabalho-final-f4, historico-da-entidade) → 191 passaram.
- `pnpm --filter @mktos/api exec vitest run test/work-arquivo-do-clickup.test.ts` → 7 passaram (regras puras; a prova contra o Postgres é o script em `--simular` e a e2e da L9).
- `pnpm --filter @mktos/shared build` (tsup) rodou uma vez para a suíte da API ler os exports novos do `dist` (o web resolve o shared pelo `src`).

Novos testes: `apps/api/test/work-arquivo-do-clickup.test.ts`, `apps/web/tests/component/historico-da-entidade.test.tsx`, `apps/web/tests/component/trabalho-leva5-arvore.test.tsx`.

## 7. Arquivos fora da minha lista que precisei tocar (append mínimo)

- `packages/shared/src/menu-da-tarefa.ts`: ação `historico` (array, rótulo, `razaoParaNaoFazer`). O menu e o teste do Comercial leem a lista daqui.
- `packages/shared/src/schemas.ts`: três campos opcionais em `AuditLogRowSchema`; um campo opcional em `TrabListaDto` e `TrabPastaDto`.
- `packages/shared/src/index.ts`: um `export * from './arquivo-do-clickup.js'` no fim.
- `apps/web/tests/component/comercial-menu-da-tarefa.test.tsx`: `toHaveLength(8)` → `toHaveLength(ACOES_DO_MENU_DA_TAREFA.length)`.
- `apps/web/tests/unit/navegacao-modulos.test.ts` e `apps/web/tests/component/menu.test.tsx`: a lista de rótulos do Trabalho sem "Implantação de clientes".
