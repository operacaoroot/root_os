# Área do cliente · leva A (30/10/2026)

Branch `area-do-cliente/20261030` do `operacaoroot/marketing-os`, sobre `de286bfb` (Fluxo v6 do Lucas) que está sobre a produção `3f1da36d` (`rootos-official:root-delegador-3f1da36`, no ar desde 30/10 02:43 UTC, conferida em `docker inspect mktos_api` às 17:30 BRT). Roteiro: `docs/comercial/RODADA-AREA-DO-CLIENTE-20261030.md`. Desenho: `docs/area-do-cliente/DESENHO.md` e `apps/api/src/platform/area-do-cliente.json`.

Pedido do Rodrigo (30/10): "a área do cliente em si e a visualização do que vem sendo portado nela pelo ROOT OS", esquematizada, didática e simples, com cada aspecto no backlog. Depois do mockup aprovado ("show!"): "aglutine tudo, organize os pontos e vamos avançar".

## O que a leva A entrega

A área do cliente é a Sala do Cliente depois do fechamento. O mesmo link `/s/<token>` muda de modo e mostra os quatro blocos com os quinze itens do painel do Fluxo v6. Nenhum app, domínio ou login novo. Do escritório Cardozo & Saggioro veio só o mecanismo (coletor → fila → aprovação → publicado → lido), nenhum dado nem código.

| Lane | O que | Onde | Estado |
|---|---|---|---|
| A0 | Tipos no shared (`AREA_BLOCOS`, `AREA_ITENS`, `AREA_FASES_DO_FLUXO`, estados, esquemas, tipos do cliente e da bancada) | `packages/shared/src/area-do-cliente.ts` | feito |
| A0 | Migration aditiva: `SalaVersao.item`, índices únicos parciais (uma aberta por lead para a sala, uma por item), tabela `SalaLeitura` (filha de `SalaDoCliente`, sentinela + gatilho, RLS FORCE) | `apps/api/prisma/migrations/20261030150000_area_do_cliente` | feito |
| A1 | Modo área: `SalaService.projetar` devolve `modo` e `area`; a página renderiza `AreaDoCliente.tsx` (cabeçalho com selo, régua das sete fases, quatro blocos, quem cuida, WhatsApp fixo); as ações do cliente (kickoff, aceite) continuam embaixo | `apps/api/src/comercial/area-do-cliente-projecao.ts`, `sala.service.ts`, `apps/web/src/app/s/[token]/AreaDoCliente.tsx`, `page.tsx` | feito |
| A2 | Publicar por item, com versão: `versoesDoItem`, `salvarRascunhoDoItem`, `publicarItem` pela MESMA capacidade `comercial.sala.publicar` (R3, segunda pessoa em /atendimento); o efeito lê o item da própria versão e substitui só a publicada daquele item; item derivado é recusado com o motivo; o cartão de /atendimento mostra a versão do item | `sala-versao.service.ts`, `comercial.controller.ts`, `apps/web/src/app/atendimento/CartaoDaSala.tsx` | feito |
| A3 | Leitura: `POST /sala/:token/area/leitura {item, versao}` grava `SalaLeitura` (idempotente); a área mostra "novo" até abrir e chama a rota ao ABRIR o item; a bancada vê "lido em" (decisão D6: o cliente nunca vê) | `sala.controller.ts`, `sala.service.ts`, `AreaDoCliente.tsx` | feito |
| A4 | Bancada: `GET /comercial/lead/:id/area` (15 slots com estado, fonte, tarefa do fluxo, ação); aba "Área do cliente" no painel do lead (depois da Sala) com editor por item; chip "área N/15" na lista de Clientes ativos | `area-do-cliente-bancada.ts`, `area-do-cliente.service.ts`, `apps/web/src/app/comercial/_painel/AbaAreaDoCliente.tsx`, `estado.ts`, `clientes-ativos/*` | feito |
| A5 | Mapa: o JSON ganhou `mockup`, os estados `em_construcao` do motor M1–M4 e dos quatro derivados, e a nota do que o mockup trouxe ao M1 | `apps/api/src/platform/area-do-cliente.json` (Contexto › Área do cliente lê) | feito |
| A6 | Provas: teste puro da API (18 casos), suítes vizinhas da sala, testes da web; isolamento e fluxo de publicação por item escritos, por rodar com banco; e2e escrito, por rodar no ambiente de teste da VPS | abaixo | parcial |

O que mudou no que já existia, e por quê:

- `SalaVersao` ganhou `item` (nulo = a versão da sala de sempre). Todo leitor da sala passou a filtrar `item: null` (`publicadaDaSala`, `versoes`, `sala-estado.service.ts`, o contador do importador). Sem isso uma versão de item poderia virar "a versão publicada da sala".
- O índice "uma versão aberta por lead" passou a valer só para a sala (`item IS NULL`); nasceu "uma aberta por (lead, item)". A sala e um item podem ter rascunho ao mesmo tempo; dois cliques em publicar a mesma ata continuam dando uma versão só.
- O número da versão continua único por lead e cobre a sala e os itens: a aprovação prende `leadId:vN` e o efeito lê o item da versão, então **o catálogo da política não muda** (`argsSchema` da capacidade tem `additionalProperties: false`; `item` não entra nos argumentos). A "edição" do item (1ª, 2ª...) é derivada na leitura (`edicoesPorVersao`).
- O fato `sala.publicada` leva `item` (nulo para a sala).
- `ClienteAtivo` ganhou `area: {publicados, total} | null` (só para lead em modo área; conta o que a Root publicou, não os derivados).
- A aba "Área do cliente" entrou em `ABAS_DO_PAINEL` depois da Sala (desfazer = tirar o nome da lista).

## Os derivados da leva A

A regra de ouro: o que o OS já sabe chega sozinho e nunca é digitado. Nesta leva, quatro slots entram derivados da projeção que a sala já tinha:

- **Contrato**: o documento de assinatura (estado e o link do cliente, quando ainda falta assinar).
- **Escopo**: a oferta aceita (ou a recomendada da proposta publicada), com valor, parcelas e a descrição do produto; abre a página da proposta.
- **Tirar uma dúvida**: o WhatsApp da Root (nota `comercial.whatsapp.numero`); sem a nota, o marcador honesto.
- **Linha de execução**: os próximos passos da sala publicada (o que, quando, com quem) e os derivados do acompanhamento.

Agenda, cronograma e atas são da leva B. A régua das sete fases do fluxo é derivada de fatos com data (fechamento → Abertura; kickoff que passou → Primeira semana; sete dias → Construção; trinta dias ou trilho em operação → Acompanhamento; trilho encerrado → última) e é PROVISÓRIA até a leva B trazer as datas combinadas na tarefa 09. Está escrito no cabeçalho de `area-do-cliente-projecao.ts`.

## Provas

Rodado no Mac em 30/10/2026:

- `pnpm --filter @mktos/shared build`: OK.
- `tsc --noEmit` da API (com `NODE_OPTIONS=--max-old-space-size=6144`): OK. Da web: OK.
- `tsc -p tsconfig.test.json` da API (o typecheck de TODOS os arquivos de teste, o passo da CI) NÃO completou no Mac: estourou a memória com 6 GB de heap depois de 16 min. O arquivo de teste novo (`area-do-cliente-puro.test.ts`) foi conferido sozinho com as mesmas opções do `tsconfig.test.json`: OK. O passo inteiro fica para a CI ou para a VPS.
- `vitest` API: `area-do-cliente-puro.test.ts` (18 casos: shared × JSON, modo, fase, derivados, novo/lido, edição, bancada, esquemas), `comercial-sala-versao-puro`, `comercial-sala-puro`, `clientes-ativos`: 52 passaram.
- `vitest` web: `comercial-painel-estado`, `navegacao-modulos`, `sala-do-cliente` passaram; os testes de componente da sala, do painel, de /atendimento e de clientes ativos: ver a linha de resultado no commit. `nav.test.ts` tem 2 falhas que já existiam no commit-base `de286bfb` (contagem de itens ocultos do menu, arquivo `packages/shared/src/nav.ts` não tocado por esta branch).

NÃO rodado no Mac (sem Postgres local; precisa do banco descartável ou do ambiente de teste da VPS):

- `tenant-isolation.test.ts` com a `SalaLeitura` (registro, semente, linha de prova e contagem 34 escritos).
- `comercial-sala-publicada.test.ts` (o fluxo R3 da sala continua igual; os casos do item estão por escrever na mesma suíte, contra o banco).
- `homolog/e2e/area-do-cliente.mjs` (escrito, contra a cópia do banco da produção na VPS, como o `leva5.mjs`).

## Para publicar (depois do OK do Rodrigo)

1. Conferir a produção viva antes do build: `docker inspect mktos_api` (hoje `rootos-official:root-delegador-3f1da36`), `levas.log`, `git worktree list` no Mac. Se a agenda v2 (Predator, branch `agenda-v2/20261029`) ou o Painel de vida R2 tiverem publicado antes, rebasear esta branch sobre a produção da hora e refazer o typecheck.
2. Imagem nova de api e web a partir do bundle (`build-leva5.sh <sha>` ou o equivalente da hora).
3. **Uma migration aditiva**, `20261030150000_area_do_cliente`, pelo `publicar-leva-com-migration.sh` (backup do banco, migration, api e web, volta sozinho se a API não ficar saudável). A migration confere RLS/FORCE/policies/gatilho e aborta se faltar.
4. **Zero variável nova. Zero capacidade nova. Zero permissão nova. Zero passo de dado.** Nada de `db:seed:politica`.
5. Smoke: `GET /api/comercial/lead/<id>/area` de um cliente da lista Onboarding devolve 15 itens com `modo: 'area'`; o link `/s/<token>` dele abre a área (data-testid `area-do-cliente`) com escopo e dúvidas preenchidos; a aba "Área do cliente" aparece no painel; publicar um item cai em /atendimento como "Área do cliente · <item> · versão N".
6. Avisar o Lucas e o Pedro: o link do cliente fechado mudou de cara.

## Como desfazer

- **Imagem**: `REPORT.txt` da release (`cadeia-antes.txt`, `up -d --no-deps --no-build api web`). A coluna `item` e a tabela `SalaLeitura` ficam no banco; o código antigo as ignora (toda versão da sala de hoje tem `item` nulo).
- **Dados**: nada a desfazer; nenhum passo de dado.
- **Banco** (só se for preciso voltar a migration): o caminho de volta está no cabeçalho da migration; perde as versões por item e as leituras.
- **Tela**: a aba sai tirando `'area'` de `ABAS_DO_PAINEL`; a área do link sai tirando o `if (estado.modo === 'area')` de `page.tsx`.

## O que o Rodrigo decide (as recomendações valem até ele dizer)

- D2 (R3 para todo item, ou R2 nos de rotina): implementado R3 para todos; a lista "de rotina" é uma constante a criar quando a mesa decidir.
- D6 ("lido" visível ao cliente?): não; só o "novo". Implementado assim.
- D1, D3, D4, D5, D7: não travam esta leva; travam partes das levas B e C (ver o quadro de pendências em `docs/area-do-cliente/DESENHO.md` §10).
