# Área do cliente · leva A (30/10/2026)

Fonte: `docs/area-do-cliente/DESENHO.md` e `apps/api/src/platform/area-do-cliente.json` (o desenho de 30/10/2026 sobre o Fluxo do cliente v6). Pedido do Rodrigo: "a área do cliente em si e a visualização do que vem sendo portado nela pelo ROOT OS".
Base de código: a produção da hora. Em 30/10 03:00 UTC era `3f1da36d` (`root-precos-openrouter`) com o Fluxo v6 por cima (`de286bfb`); esta branch `area-do-cliente/20261030` parte daí. Antes de começar, conferir a produção viva (`docker inspect mktos_api`, `levas.log`, `git worktree list` no Mac) e trazer o commit de produção por bundle se o GitHub estiver atrás. Trabalhar numa branch `area-do-cliente/<data>`; publicar só com OK do Rodrigo.

Regra da casa, igual às levas anteriores: o conceito não muda, dado nenhum é apagado, cada lane tem desfazer. A Sala de hoje continua funcionando igual para lead em andamento. Nenhuma sala publicada perde conteúdo. Texto para o cliente passa pela skill `root-escrita`; tela segue a identidade do OS (tema escuro e claro, sem pintura nova).

## Lanes

### A0 · Contrato e dados (abre as outras)
- Fazer: tipos no shared (`packages/shared/src/area-do-cliente.ts`): `AREA_BLOCOS`, `AREA_ITENS` (os 15 ids do JSON, com bloco e tarefa do fluxo), `EstadoDoItemDaArea` (`vazio | derivado | rascunho | na_porta | publicado | lido`), `ItemDaAreaParaOCliente`, `ItemDaAreaNaBancada`. O JSON continua a fonte do desenho; o shared é a fonte do código (ids iguais, teste que confere).
- Migration ADITIVA `area_do_cliente`: `SalaVersao.item` (texto, nulo = versão da sala de hoje) com índice `(leadId, item, numero)`; tabela `SalaLeitura` (`salaId`, `item`, `versao`, `em`, filha de `SalaDoCliente` com sentinela + gatilho `_orgId_do_pai`, RLS FORCE, `FILHOS_COM_ORGID_REDUNDANTE` + 1). Nada é apagado; as versões de hoje ficam com `item` nulo e seguem valendo.
- Não muda: `SalaDoCliente`, o token, a validade de 90 dias, a política.
- Prova: `tenant-isolation` passa com a tabela nova; a sala antiga abre igual.

### A1 · Modo área no `/s/<token>` (M1)
- Fazer: `SalaService.projetar` passa a devolver `modo: 'sala' | 'area'`. Área quando a ficha tem `clienteAtivoEm` ou o lead tem card na lista Onboarding de cliente (mesma regra de `cardIdDoLead`). `apps/web/src/app/s/[token]/page.tsx` renderiza `AreaDoCliente.tsx` (novo) no modo área: cabeçalho com nome e selo, os quatro blocos (`AREA_BLOCOS`) com os 15 slots, slot vazio com "chega na <fase>" (do JSON, `entra_na_fase`), os derivados que a projeção de hoje já tem (contrato, escopo, contato) preenchidos. Celular em uma coluna; o botão do WhatsApp fixo embaixo fica.
- Não muda: `SalaPublicada`, `Acompanhamento` e a proposta continuam no modo sala; o conteúdo das versões publicadas não muda.
- Onde: `apps/api/src/comercial/sala.service.ts`, `sala-projecao.ts` (parte pura: `modoDaSala`, `slotsDaArea`), `apps/web/src/app/s/[token]/`.
- Prova: e2e com dois leads, um em proposta e um fechado: o primeiro abre a sala de sempre, o segundo abre a área com 15 slots, 3 preenchidos e 12 vazios dizendo a fase.

### A2 · Publicar por item, com versão (M2)
- Fazer: `SalaVersaoService` ganha `rascunhoDoItem(leadId, item)`, `salvarRascunhoDoItem`, `publicarItem` (pela porta, a MESMA capacidade `comercial.sala.publicar`, R3, segunda pessoa em `/atendimento`; argumentos levam `item` e o hash do conteúdo). Conteúdo por item com schema Zod próprio no shared (texto, lista de passos, documento referenciado por id, nunca link em claro). O cliente lê sempre a última versão publicada de cada item (`ultimaPublicadaPorItem`). Derivado (`como_chega: derivado`) não tem rascunho: a tela da bancada mostra "o OS monta sozinho" e o botão some.
- Não muda: a publicação da sala de hoje (`item` nulo) continua valendo e aparece no modo sala.
- Onde: `apps/api/src/comercial/sala-versao.service.ts`, `sala-versao.ts`, `packages/shared/src/sala-versao.ts`, `apps/api/src/comercial/sala.controller.ts`.
- Prova: publicar uma ata não cria versão do cronograma; o histórico da aba lista por item; `ApprovalGuard` retém e a segunda pessoa libera.
- Decisão D2 (R3 para todos ou R2 para os de rotina): implementar R3; deixar a lista dos "de rotina" numa constante para a mesa virar depois.

### A3 · Leitura: "novo" e "lido em" (M3)
- Fazer: `POST /sala/:token/leitura` `{item, versao}` grava `SalaLeitura` (idempotente por `(salaId, item, versao)`), sem permissão (a sala é anônima, como `visita`), com o mesmo teto de taxa por origem. A área mostra "novo" no item cuja última versão não tem leitura e chama a rota ao abrir o item (não ao carregar a página). A bancada lê `lidoEm` por item.
- Não muda: `visita` e `acessos` continuam contando como hoje.
- Onde: `apps/api/src/comercial/sala.controller.ts`, `sala.service.ts`, `apps/web/src/app/s/[token]/AreaDoCliente.tsx`.
- Prova: publicar, abrir no link, conferir que a leitura gravou e o "novo" sumiu; abrir de novo não grava segunda linha.
- Decisão D6 (cliente vê "lido"?): não. Só o "novo".

### A4 · Bancada: aba "Área do cliente" no painel (M4)
- Fazer: `GET /comercial/lead/:id/area` (`leads.ver`) devolve os 15 slots com `estado` (vazio, derivado, rascunho, na_porta, publicado vN, lido em), `fonte` (texto do JSON), `tarefaDoFluxo`, `acao` (`escrever | publicar | abrir_fonte | nada`) e o link interno da fonte quando há (card da implantação, ata, agenda, trilho, Frota). `AbaAreaDoCliente.tsx` ao lado da `AbaSala`: grade por bloco, filtro por estado, botão da ação. Nos cards de `/clientes`, chip "área N/15 no ar" (`FichaDoCliente.tsx`), lido do mesmo serviço.
- Não muda: a aba Sala continua como está (rascunho da sala de hoje).
- Onde: `apps/api/src/comercial/area-do-cliente.service.ts` (novo, parte pura `area-do-cliente.ts`), `apps/web/src/app/comercial/_painel/AbaAreaDoCliente.tsx`, `LeadPainel.tsx`, `apps/web/src/components/ficha/FichaDoCliente.tsx`.
- Prova: quem implanta abre o painel de um cliente da lista Onboarding e vê 3/15 no ar, o que falta e onde resolve, sem abrir o link do cliente.

### A5 · Mapa e backlog (M5, feito nesta branch)
- O arquivo `area-do-cliente.json`, a rota `GET /tenants/plataforma/operacao/area-do-cliente` e a tela Contexto › Área do cliente. A cada lane concluída, trocar o `estado` do item no JSON (`backlog` → `em_construcao` → `no_ar`) no mesmo commit da lane.

### A6 · Provas e fechamento
- e2e `area-do-cliente.mjs` cobrindo A1 (dois leads), A2 (publicar um item sem mexer nos outros, retenção e liberação), A3 (novo e lido), A4 (aba e chip). Testes de API para A0 (isolamento), A2 (versões por item) e A3 (idempotência).
- `homolog/RESULTADO-AREA-DO-CLIENTE.md` com "Para publicar": 1 migration aditiva (`area_do_cliente`), zero variável nova, zero capacidade nova (se A2 ficar na capacidade da sala), zero passo de dado. O que o Rodrigo decide: D1, D2, D3, D6 (as recomendações valem até ele dizer).
- Tag `area-do-cliente-<data>`, bundle `area-do-cliente-delta.bundle` (^produção da hora).

## Backlog (levas B, C e D, não entram nesta rodada)

- **B · O que o OS já sabe** (7 slots derivados): contrato e escopo (fio + `ComercialDocumento` + PDF guardado), agenda (porta `comunicacao.agenda.periodo` + `proxima-reuniao.ts`), atas (Banco de atas + `AtaLigacao.clienteId` + resumo redigido), cronograma (fases do trilho + datas da 09), linha de execução (card + Frota + trilho), dúvidas (grupo + número da Root), domínio curto (D4).
- **C · O que ainda não existe no OS**: acesso com código pelo WhatsApp (D1), PRD e arquitetura (`ArquivoDoCliente` tipo + aprovação pela área), cofre no celular (partilha de `CofreItem` + revelar registrado), glossário e dúvidas (memória), vídeos (Central por trilha, D7), instruções de acesso e de manutenção (notas padrão + personalização; D5 para a tarefa).
- **D · As rotinas do fluxo pela área**: novidades (rotina), status de sexta (30), pulso (32) e nota (43) respondidos pela área, relatório mensal (51).

## O que não fazer

- Não criar app, domínio ou login novo para o cliente antes da D1 e da D4.
- Não copiar nada do escritório além do mecanismo (regra de isolamento da Root).
- Não digitar o que o OS já sabe: derivado é derivado.
- Não publicar em produção sem o OK do Rodrigo e sem conferir a produção viva antes do build.
