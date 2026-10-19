# Revisão adversarial · Rodada do Trabalho (T1 a T8, T1b) · 19/10/2026

Escopo: `git diff 17f992d..HEAD` (commits "Rodada do trabalho T1..T9" e T1b até `c439412`), contra o roteiro `docs/comercial/RODADA-TRABALHO-20261019.md`, o `CLAUDE.md` e a §0 da `PASSAGEM-PREDATOR-COMERCIAL.md`. Só leitura; nenhum código alterado.

Testes rodados contra `rootos_comercial_test` (homologação), todos verdes e nenhum pulado:
API `aprovacoes-pedir-de-novo` 18/18, `comercial-contrato-encerrar` 5/5, `work-cliente` 9/9, `work-vistas` 6/6, `trabalho-atas` 29/29, `comercial-fechado-fora` 10/10. Web: `atendimento-t7`, `caixa-decisoes`, `caixa-vistas`, `comercial-contratos-t8`, `trabalho-cliente`, `trabalho-implantacao-popup`, `comercial-fechado-fora`, `nav` (77/77).

Gravidade: **P1** consertar antes da imagem final · **P2** deveria · **P3** menor.

---

## P1

### P1-1 · T1b · A cobrança marcada nasce com o 1º vencimento de HOJE, não com o declarado e assinado pela titular
- `apps/api/src/comercial/fechamento.service.ts:491` chama `dinheiro.criarCobrancaDoAceite(orgId, leadId, aprovado)` para quem fechou fora com `criarCobranca: true`; `apps/api/src/comercial/dinheiro.service.ts:434` cria a cobrança no provedor com `primeiroVencimento: hojeEmSP()`. O `fora.primeiroVencimento` declarado (que está no hash que a titular assinou, no manifesto e no contrato do Financeiro quando não há cobrança) é ignorado.
- Cenário: cliente assinou fora em 01/09 com 1º vencimento em 10/11. A pessoa marca "criar cobrança". A titular assina o R4 lendo 10/11. O efeito cria no Asaas N parcelas a partir de hoje (19/10): o cliente recebe boleto com data que ninguém combinou nem aprovou. Pior, a régua (`contrato-vivo.service.ts`, `regua`) pula o aviso da parcela 1 até D+1 porque "é paga na sala", e no D+1 a marca `atrasada`. É escrita financeira externa divergente do conteúdo assinado: a aprovação está presa ao hash, mas o efeito executa outra coisa.
- O teste `comercial-fechado-fora.test.ts:366` ("nasce como a do funil") confere parcelas, valor e forma, nunca a data.
- Correção: passar o 1º vencimento ao `criarNoProvedor` quando `a.fora` (ex.: `primeiroVencimento: a.fora?.primeiroVencimento ?? hojeEmSP()`, com as linhas de `ComercialCobranca` nas datas mensais de `parcelasDoContratoFora`), recusar no schema 1º vencimento no passado quando `criarCobranca` (ou decidir com a mesa o que fazer com parcelas já vencidas), e ajustar a exceção da parcela 1 na régua para lead `fora`. Acrescentar ao teste a asserção da data enviada ao provedor.

---

## P2

### P2-1 · T1b · O cartão da fila não mostra o que a titular assina no fechamento de quem fechou fora
- `apps/web/src/app/atendimento/frase-do-pedido.ts:167`: o pedido R4 aparece só como "Fechar o negócio de X"; os argumentos são `{leadId, chave, propostaHash}`. Para quem fechou fora, esse R4 é a ÚNICA conferência humana dos dados declarados e do PDF (não há Pix nem ZapSign), e nada obriga a abrir a aba Dinheiro do lead antes de assinar. Proposta e sala ganharam cartão que só acende o botão com o conteúdo carregado e o hash de agora conferido; o fechamento fora não.
- Cenário: alguém digita valor 1.199.700 em vez de 119.970 centavos; a titular assina pela fila com a senha sem ver valor, parcelas, "sem cobrança: motivo" nem o PDF.
- Correção: `CartaoDoFechamentoFora` em `/atendimento` com os campos da declaração, o motivo da cobrança pulada, o link do PDF e o hash recalculado (`aceiteDaDeclaracao`), botão de aprovar só com o cartão carregado e conferindo, como `CartaoDaProposta`.

### P2-2 · T1b · Quem registrou consegue CONFIRMAR o próprio registro; a recusa só vem no efeito, depois da senha
- `fechamento.service.ts:406` recusa no efeito quando `ctx.actorId === a.fora.porId`. Mas `confirm` não sabe disso: na reproposta por outra pessoa (teste `comercial-fechado-fora.test.ts`, "quem registrou não assina nem quando outra pessoa propõe de novo") a aprovação é confirmada pelo registrante com senha e motivo, e só a execução falha. A fila mostra o botão a ele (`euPossoAprovar`), a assinatura dele fica no RASTRO como aprovação dada, e a linha fica confirmada/consumida sem efeito.
- Correção: levar a regra para a conferência de leitura da fila e para `conferirAprovado` (impedimento antes do `confirm`, com o porquê na tela), mantendo a do efeito como segunda tranca.

### P2-3 · T1b · O registro não procura o CNPJ fora do próprio lead: cliente do funil pode ser registrado de novo
- `apps/api/src/comercial/fechado-fora.service.ts:130`: o lead nasce por `leads.entrada` com `ref: fechado-fora:<CNPJ>`, e o id do lead deriva da origem (`leadIdDaEntrada`). As travas de 409 ("já ativo", "aceitou na sala") só olham ESTE lead. Um cliente que já está no funil (outro lead, `ComercialFicha.cnpj` igual, `proposta.aceita` ou `cliente.ativo`) não é achado.
- Cenário: o lead do funil está em E8 aguardando assinatura; alguém registra "fechado fora" com o mesmo CNPJ. Nascem dois fechamentos: o `Partner` é reaproveitado pelo CNPJ, mas contrato do Financeiro, card da implantação, trilho e (se marcada) cobrança saem em dobro.
- Correção: antes da entrada, procurar `ComercialFicha.cnpj` e `Partner.cnpjCpf` (isCliente) da empresa; havendo lead vivo ou cliente ativo com o mesmo documento, recusar com o link do lead.

### P2-4 · T1 · A "porta única" da implantação só vale no `POST /trabalho/tarefas`
- `apps/api/src/work/work.service.ts:630` (`editarTarefa`): `PATCH /trabalho/tarefas/:id` com `listId` da lista "Onboarding de cliente" move qualquer tarefa para lá, e `parentId: null` (`:664`) promove uma subtarefa do cartão a cartão solto. `apps/api/src/comercial/leitura-e-reacao.service.ts:229-243` ("virar tarefa" da ideia) cria por `tx.workTask.create` direto em qualquer `listId` pedido, e o fallback `comEtapa({})` pode cair na lista da implantação.
- `work.service.ts:209` (`editarPasta`): renomear a pasta "Clientes" ou pô-la dentro de outra pasta (`listaDaImplantacao` exige pasta raiz) produz exatamente o incidente que o T1 conserta para a lista (Implantação vazia, próximo fechamento abre outra lista). `apagarLista` também aceita a lista vazia.
- Correção: a mesma conferência (`listaDaImplantacao`) em `editarTarefa` (destino da lista e `parentId` → nulo), no `listaDestino` da reação e em `editarPasta`/`apagarLista` para a pasta e a lista da implantação; testes para os três caminhos.

### P2-5 · T4 · `GET /trabalho/clientes` entrega CNPJ/CPF do cadastro do Financeiro a quem só tem `tarefas.ver`
- `apps/api/src/work/work.controller.ts:36` com `tarefas.ver`; `apps/api/src/work/clientes-da-casa.ts:106` devolve `cnpj: p.cnpjCpf`, e a busca aceita dígitos. Até aqui a lista de `Partner` exigia `financeiro.ver` (`finance` `GET partners`). Os papéis de marketing/operação que têm `tarefas.ver` sem `financeiro.ver` passam a ler a carteira de clientes com documento, e `cnpjCpf` aceita CPF (pessoa física, dado pessoal).
- Correção: o seletor devolve só id e nome (a busca por documento continua no servidor), ou devolve o documento mascarado; o documento inteiro só com `financeiro.ver` ou `leads.ver`.

---

## P3

- **T7 · escrita numa leitura.** `apps/api/src/approvals/approvals.controller.ts:268`: `GET /approvals/fila` semeia a rotina `aprovacoes.vencidas` (upsert em `Rotina`, ativa, sem linha de auditoria de quem a criou). Há precedente na casa (`onboarding/trilho/trilho.service.ts:391`, `listar` semeia `onboarding.relogio`) e o upsert não reativa rotina pausada (`update: {}`), por isso fica P3. Melhor semear no provisionamento da empresa e no tique, e registrar a criação como sistema. A limpeza em si está certa: só `pendente` com `expiraEm < agora`, filtro repetido na escrita, não toca `confirmada`/`consumida`/`rejeitada`, não estende prazo, RASTRO como sistema.
- **T7 · confirmada com capacidade conta como "pedido vivo" para sempre.** `pedidosVivos` trata `confirmada` com `capabilityId` como viva sem prazo; uma confirmada cuja execução falhou bloqueia o "Pedir de novo" daquele recurso indefinidamente. Limitar ao prazo ou ao estado da `ToolCall`.
- **T7 · pedir de novo atravessa o módulo.** A rota mora em `/approvals` (espinha) e chama serviços do comercial sem conferir o módulo `leads` da empresa. Só alcança vencidas que já existiam; conferir o módulo do domínio no registro.
- **T8 · corrida entre Concluir e Desativar.** `contrato-vivo.service.ts:307`: o id do fato deriva de `(tipo, 'encerramento')`, então `contrato.concluido` e `contrato.desativado` simultâneos gravam os dois (a releitura acontece antes). Usar uma chave única para os dois tipos, ou trava do lead.
- **T8 · `reversibilidade: 'automatica'` sem caminho de volta.** `contrato-vivo.service.ts:51`: não existe rota de reabrir; declarar `manual` (continua R0/R1 pela escada) para o efeito descrever o que acontece. Os marcos dia 15 e D-30 seguem disparando para contrato desativado (só fatos internos; a cobrança mantida é decisão registrada).
- **T1b · `anexo()` devolve o PDF mais novo, não o citado pela declaração vigente.** `fechado-fora.service.ts:183`: registrar v3 com o mesmo PDF da v1 (fato `contrato.anexado` já existente, mesma chave) faz a tela baixar o PDF da v2. Buscar o anexo por `arquivoSha256` da declaração que o fechamento lê.
- **T1b · cadência e assinatura da Root inferidas.** O contrato do Financeiro sem cobrança assume parcelas mensais (o formulário não pergunta a periodicidade) e `documentoAnexado` grava `assinadoRootEm` igual à data declarada da assinatura do cliente. Dizer "mensal (padrão)" no manifesto ou perguntar; marcar a assinatura da Root como declarada.
- **T1b · duas aprovações vivas por versão.** Novo registro com dados diferentes abre `fech-<lead>-v2` sem retirar o pedido da v1 da fila (o efeito recusa a v1 por chave e hash, então é ruído, não brecha).
- **T4 · o cliente da casa entra no Financeiro como cliente.** `Partner.interno` nasce `isCliente: true`, e `apr.service.ts:111` (`papel=cliente`) passa a listar "Root (interno)". Filtrar `interno` nas listas e relatórios do Financeiro. A ideia de lead ainda sem fechamento vai para o cliente interno (`leitura-e-reacao.service.ts:197`): decisão documentada, mas rotula trabalho de prospect como "da casa".
- **T6 · `ROTAS_ABSORVIDAS` de `/comercial` aponta `/caixa`**, enquanto a rota redireciona para `/comercial/funil`. Coerente com "a função foi para Pendências", mas o destino da tabela e o do redirect divergem; vale uma linha no comentário.
- **Texto.** Os travessões e o "—" que aparecem no diff estão no código movido de `/onboarding/[id]` para `BancadaDoTrilho.tsx` (textos antigos, ex.: "O relógio — o que está vencido hoje", "portão cumprido — pode avançar"). Não são novos, mas a tela foi tocada: trocar por " · " ou dois-pontos.

---

## O que foi conferido e está certo

1. **Porta e política (T7).** `confirm` não mudou: hash conferido no servidor contra a `ToolCall`, alçada relida do banco, segunda pessoa, motivo e senha em R4, prazo. A tela só muda a forma (`formaDaAssinatura`): um clique em R2/R3 que cabe na linha (mover com destino do hash, sala com a versão carregada e conferida), caixa com motivo e senha no lugar em R4, conteúdo longo aberto no lugar. "Pedir de novo": só na vencida (recusada e consumida não), marca `expirada` a pendente vencida antes, não reaproveita token, prazo nem assinatura, recria pelo serviço do domínio com conteúdo relido (mover pelo destino do HASH, proposta só na versão vigente, WhatsApp pelo texto guardado), quem clica vira proponente e o teste confirma que ele não assina; exige a permissão da rota de origem (`leads.editar`); conta de máquina recusada; e-mail, agenda, documento, WhatsApp genérico e lote ficam fora com o porquê. Dois cliques: trava em memória do processo (vale com um container, como `umaPorVez`).
2. **Isolamento.** `WorkTask.clienteId` com gatilho `mktos_orgid_do_pai('Partner','clienteId')` (search_path fixo, sem SECURITY DEFINER) e conferência de RLS na migration; nomes resolvidos por `nomesDosClientes` com `orgId` (Trabalho e caixa); `VistaSalva` com RLS FORCE, leitura e escrita separadas, grant ao `mktos_app`, inventário em `tenant-isolation.test.ts`, todo acesso filtra `orgId` e `userId` (a de outra pessoa é 404, testado). `/trabalho/pessoas` lista nomes de gente ativa sem conta de máquina.
3. **T8.** Nível pelo efeito (`classificar` dá R0), gate `leads.editar`, conta de máquina e pessoa inativa recusadas, motivo obrigatório, fio + auditoria, uma vez só, parcela em aberto pede ciência e nada cancela cobrança (a régua só grava fatos internos).
4. **T5.** `responsavelId` conferido por `orgId`, ativo e sem papel de máquina; cliente exigido antes da tomada; a IA só propõe; o trecho da ata segue na descrição como procedência (testado); falha na criação devolve a sugestão a rascunho.
5. **T1/T2.** `/onboarding` e `/comercial` redirecionam para caminho fixo só com a query (sem open redirect); pop-up com `?tarefa=` empilhado (voltar fecha, `fechar` volta a entrada), foco e Esc pelo Dialog do Radix com o foco devolvido; link esticado é um `button` com `after:inset-0` e as ações internas são irmãs com `relative z-10`, sem interativo aninhado.
6. **T1b, o que está certo.** Fechamento continua `comercial.fechamento.executar` R4 pela porta, chave `fech-<lead>-v<n>`, proposto só por pessoa (máquina recusada), efeito só pela fila (`ctx.approvalId`), hash da declaração cobre os dados e o sha256 do PDF e é RECALCULADO do payload no efeito; aceite declarado tem procedência escrita, não grava `propostaAceitaEm`, e lead com `proposta.aceita` é recusado; E9 só pela reação a `cliente.ativo`. Upload: `leads.editar`, multer em memória com teto de 10 MB, mimetype e assinatura `%PDF-`, chave por lead e sha, download com `leads.ver` e lead da empresa, `attachment` e `no-store`. Cobrança `pulado` só com motivo escrito (schema exige) e dentro do hash assinado; não abre fechamento sem a assinatura R4. Endereço vazio vira `[a decidir]`.
7. **Testes.** Nenhum `skip`/`only` novo além do `describe.skipIf(!URL)` de sempre; os testes antigos alterados mudaram junto com comportamento decidido (nome imperativo, terceira aba, pop-up no lugar do link, lista da implantação fechada para cartão solto), sem afrouxar asserção.

---

## Veredito

**P1:** P1-1 (cobrança de quem fechou fora com 1º vencimento de hoje em vez do declarado e assinado).

P2: P2-1 (cartão da fila sem o conteúdo do fechamento fora), P2-2 (registrante confirma e só o efeito recusa), P2-3 (registro não procura o CNPJ em outros leads), P2-4 (porta única da implantação contornável por PATCH, pela ideia e pela pasta), P2-5 (`/trabalho/clientes` expõe CNPJ/CPF com `tarefas.ver`).
