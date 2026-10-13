# Revisão adversarial · Lane C (telas web do cockpit comercial)

Lane G, segunda passada, 13/10/2026. Revisor: Opus 5.5, sem ter escrito o código. Escopo: commits 3915cc2, 416dab0, ab43a9d, a7f7a5e, 171391d, a60f70e, 5151b85 e 38962c7. Lidos: `apps/web/src/app/comercial/_ui.tsx`, as telas (fila, funil, fio, sessão, fechamento, contratos, contrato vivo, torre e relatório; o simulador ficou de fora), `apps/web/src/lib/cockpit.ts`, a seção comercial de `packages/shared/src/nav.ts` e os testes; comparados com `comercial.controller.ts`, `dinheiro.controller.ts`, `inteligencia.controller.ts` e os serviços que eles chamam. Nada foi consertado. `cockpit.test.ts`, `nav.test.ts` e `comercial-cockpit.test.tsx`: 60/60 verdes (os casos não cobrem os defeitos abaixo).

## P1

### C-1 · Duas telas entregam a qualquer `leads.editar` o link para assinar o contrato pela Root, e uma diz que o botão "só consulta"
- **Onde:** `apps/web/src/app/comercial/lead/[id]/page.tsx:144` e `:152-178` (botão "assinar pela Root" na etapa contrato); `apps/web/src/app/comercial/contratos/[leadId]/page.tsx:102` e `:107-128` (botão "ver a assinatura da Root"; texto da linha 114: "O botão só consulta o documento"). A rota é `POST /comercial/contratos/:leadId/assinar-pela-root` (`dinheiro.controller.ts:69-77`, `leads.editar`), que devolve `linkAssinatura = doc.linkRoot`.
- **Defeito:** a raiz é a D-1 (lane D): a rota entrega o link do signatário da casa a quem tem `leads.editar`. A tela piora em dois pontos: oferece o botão a qualquer pessoa que abra o fio na etapa contrato e em TODO contrato vivo, sem conferir papel; e o texto do contrato vivo apresenta como consulta inofensiva um botão que devolve uma credencial de assinatura.
- **Cenário:** um analista abre `/comercial/contratos/<lead>`, clica em "ver a assinatura da Root", recebe o link e assina na ZapSign em nome do sócio; o webhook grava `contrato.assinado_root` e o fechamento R4 fica pronto para ser proposto.
- **Confirmado** por leitura (tela, rota e texto). O impacto depende da D-1, ainda aberta.
- **Conserto:** junto com a D-1. Na tela, o botão só para quem a API disser que é o signatário (403 aos demais, e a tela esconde); no contrato vivo, texto que diga o que o botão entrega, ou tirar o botão. A mais: conferir `https:` antes de pôr `linkAssinatura` em `href` (linhas 172 e 132); hoje o valor vem da ZapSign, então `javascript:` não tem por onde entrar.

Nenhum outro P1 confirmado. Nenhuma tela grava etapa à mão nem contorna portão (ver o fim).

## P2

### C-2 · Com o prazo desligado, a fila promete que o padrão vale "às 20:59" e mostra "expira em 2,9 milhões de dias"
- **Onde:** `apps/web/src/app/comercial/page.tsx:91`, `:111`, `:146`, com `apps/web/src/lib/cockpit.ts:73-80`; na API, `decisoes.service.ts:56` (`SEM_PRAZO = 9999-12-31T23:59:59Z`).
- **Defeito:** sem `decisaoExpiraHoras` (nasce nulo), toda decisão nasce com a sentinela, e a tela a trata como prazo: o chip calcula a duração sobre 7.900 anos e a frase diz "Se ninguém responder até 20:59, vale o padrão", o que é falso (sem prazo o padrão nunca vale).
- **Confirmado** (o teste da linha 70 do `cockpit.test.ts` só cobre prazos curtos).
- **Conserto:** a API devolve `semPrazo` (a ficha já calcula `decisaoSemPrazo`) e a tela escreve "sem prazo: só sai com resposta".

### C-3 · Proposta que foi à fila de decisões aparece como "foi à porta (R3)", com link para `/atendimento`
- **Onde:** `apps/web/src/lib/cockpit.ts:237-239` (`na_porta` e `na_fila` no mesmo ramo, `aguardaAprovacao: true`); `apps/web/src/app/comercial/lead/[id]/sessao/page.tsx:282`.
- **Defeito:** `na_fila` é laudo sujo ou fora da tabela encaminhado à fila de decisões do comercial (`proposta.service.ts:350`, `approvalId: null`). A pessoa vai a `/atendimento`, não acha nada, e a proposta fica parada.
- **Confirmado.**
- **Conserto:** separar os estados em `explicarRascunho`; `na_fila` leva a `/comercial`, ancorado na `decisaoId`.

### C-4 · "Gerar agora" no relatório gera sempre 7 dias; a tela abre em 30 e o botão parece não fazer nada
- **Onde:** `apps/web/src/app/comercial/relatorio/page.tsx:22` (`dias = 30`) e `:31` (POST com `{}`); na API, `relatorio-da-semana.ts:46,51-55` (padrão 7) e `relatorio-da-semana.service.ts:193-201` (`ler` só devolve o gerado se o recorte bater).
- **Defeito:** o botão não manda o recorte. Em 30 ou 90 dias, a API gasta modelo no de 7 e a releitura volta ao vivo, com "leitura ausente". A linha 121 escreve "gerado em <agora>" também quando `origem` é `ao_vivo`. Somado a E-11, o clique numa quinta antes das 18:00 ainda impede o relatório do relógio daquele dia de sair com o recorte que ele escolher.
- **Confirmado.**
- **Conserto:** mandar `{ dias }`; abrir em 7; com `origem === 'ao_vivo'`, dizer "números ao vivo, sem leitura gerada".

### C-5 · A torre escreve "ausente" para o custo que a API mediu e "R$ 0" para a ponte e o stub
- **Onde:** `apps/web/src/app/comercial/torre/page.tsx:38-41`; na API, `torre.service.ts:133-150`; o teste `apps/web/tests/component/comercial-cockpit.test.tsx:60-73` fixa o comportamento.
- **Defeito:** com provedor real e gasto, a API manda `custoDeIaHojeCentavos: null` e `custoDeIaHojeUsd: 0.42`; a tela ignora o dólar e escreve "ausente". Com ponte (que gasta a assinatura do host) ou stub, mostra "R$ 0" e não lê `provedorDeIa` nem `custoDesconhecido`.
- **Confirmado.**
- **Conserto:** mostrar o dólar quando os centavos forem nulos, "sem medida" quando `custoDesconhecido`, e o provedor na legenda; corrigir o teste.

### C-6 · Hora sem dia: "última vez 14:02" de uma automação parada há cinco dias
- **Onde:** `apps/web/src/app/comercial/torre/page.tsx:54` (`horaSP(a.ultimaVezEm)`), `apps/web/src/lib/cockpit.ts:78` ("venceu às"), `apps/web/src/app/comercial/page.tsx:146` ("até HH:MM").
- **Defeito:** a torre existe para dizer o que parou, e uma automação que rodou na semana passada parece ter rodado hoje.
- **Confirmado.**
- **Conserto:** `diaHoraSP` (já existe) quando o instante não é de hoje em SP, ou "há 5 dias".

### C-7 · O contrato vivo mostra uma saúde que veio da semente, com legenda que afirma a fórmula
- **Onde:** `apps/web/src/app/comercial/contratos/[leadId]/page.tsx:49` ("saúde: uso, respostas, prazos"), `apps/web/src/app/comercial/contratos/page.tsx:41-44`; na API, `contrato-vivo.service.ts:212` lê `ficha.saude`, enquanto funil e ficha usam `saudeDoLead()` (nulo, `proxima-acao.ts:167`).
- **Defeito:** nenhum código escreve `ComercialFicha.saude`; o 86 da Alicerce é sobreposição da semente. O mesmo lead aparece "saúde ausente" no funil e "86 · saúde: uso, respostas, prazos" no contrato vivo, e a fórmula é [a decidir].
- **Confirmado.**
- **Conserto:** contrato vivo usa `saudeDoLead()` até a fórmula existir; tirar a legenda.

### C-8 · "Esperando aprovação do sócio", mas qualquer `leads.editar` aprova
- **Onde:** `apps/web/src/app/comercial/lead/[id]/sessao/page.tsx:133` e `:177-181`; na API, ver E-4 (`inteligencia.controller.ts:69-74`, `diagnostico.service.ts:149-155`).
- **Defeito:** a tela vende o toque como do sócio; o portão fica com qualquer analista ou com a conta `ia_acao`, e o chip "aprovado por <nome>" sugere uma alçada que ninguém conferiu.
- **Confirmado.**
- **Conserto:** o da E-4; a tela mostra o botão só a quem pode. Se a mesa decidir que qualquer um aprova, trocar "do sócio" por "de outra pessoa".

### C-9 · A ata longa morre em 413
- **Onde:** `apps/web/src/app/comercial/lead/[id]/sessao/page.tsx:195-201`, `:209`, `:228`; `packages/shared/src/comercial.ts:422` (`max(400_000)`); `apps/api/src/main.ts:54` (corpo de 100 kb).
- **Defeito:** a transcrição de uma sessão de 1h30 passa de 100 kB em JSON; a tela deixa enviar e mostra "Erro 413" sem dizer o que fazer.
- **Plausível** (limites lidos, não exercitado).
- **Conserto:** decidir o teto (corpo maior só nessa rota, como `corpo-da-midia.ts`, ou schema menor) e a tela avisar antes.

## P3

- **C-10** `_ui.tsx:24-58`: `useCarregar` não limpa `dados` quando o caminho muda; no funil, a lista do filtro anterior fica sob o botão novo, e com erro fica com a caixa de erro em cima.
- **C-11** `funil/page.tsx:37-46`: `explicarBloqueio` não descarta resposta antiga; "mover" em A e logo em B pode escrever o portão de A com o nome de B.
- **C-12** `page.tsx:44` e `:127`: "decisões suas" é a fila inteira; a decisão que a própria pessoa propôs aparece com botões e responde 403 (`DecisaoNaFila` não traz `propostoPor`, e a tela não confere `aprovacoes.decidir`).
- **C-13** `lead/[id]/page.tsx:196-199` e `:231-233`: o padrão da saída é geladeira, a data não é obrigatória na tela (400 na API) e aceita o passado; o 409 traz `faltando` e `erroDaResposta` o descarta ("Saída recusada.").
- **C-14** `relatorio/page.tsx:87`: o funil do relatório escreve a chave crua (`reuniao_agendada`, `follow_up`) numa coluna fixa de 110 px, sem `COMERCIAL_ROTULO_DA_ETAPA`; em 390 px o texto invade a barra (plausível).
- **C-15** `torre/page.tsx:22`, `:36-37`, `:47`: o texto diz que o vigia "só avisa o que quebrou", mas a tela não mostra `vigia.premissas` (qual premissa, que lead), ignora `proximoDegrau` e `autonomiaGravada`, e rotula "acerto 30 d" o que a lane E define como "rodou sem erro". O relatório ignora `previsaoPendente`, `narrativaAvisos` e `propostasVencendo`.
- **C-16** `torre/page.tsx:13-14`, `:24-27`; `relatorio/page.tsx:15-16`, `:64-69`: ramos de 501 viraram código morto (a fase 2 entregou as rotas), com comentários desatualizados; os testes de componente cobrem o 501 e o caso da C-5.
- **C-17** `contratos/[leadId]/page.tsx:99`: "Aditivos: nenhum." vem de `aditivos: 0` fixo na API (`contrato-vivo.service.ts:215`): número com cara de medido que é constante.
- **C-18** `lead/[id]/page.tsx:168` e `:244`, `contratos/[leadId]/page.tsx:115-128`: botões sem desabilitar durante o envio (as rotas são idempotentes; só repetem requisição).
- **C-19** `decisoes.service.ts:288` (vizinho): "rodou sozinho hoje" só exclui a fonte `pessoa` e conta fatos do cliente (`whats`, `form`, `sala`) como automação; "automações com erro" (`:278`) conta todo `erro` desde sempre.
- **C-20** `ficha.service.ts:522` (vizinho): o funil lê `take: 1000` do mais antigo; acima de mil fichas, os leads NOVOS somem do funil sem aviso.
- **C-21** `packages/shared/src/nav.ts`: "Funil de vendas" (`/funil`, `dashboard.ver`) e "Funil vivo" (`/comercial/funil`, `leads.ver`) na mesma seção, com permissões diferentes. Decisão de produto, para a mesa.
- **C-22** Fins de linha: o 3915cc2 regravou `nav.ts`, `nav.test.ts` e `menu.test.tsx` inteiros em CRLF (612 e 1331 linhas no `--stat` para 6 e 5 de conteúdo); `relatorio/page.tsx` em CRLF e `cockpit.ts` misto. Apaga o `blame` e gera conflito com qualquer lane que mexa no NAV.
- **C-23** `cockpit.ts:121-125`: `percentual` adivinha a escala (até 1 multiplica por 100); 1% vindo na escala 0 a 100 sairia "100%". Latente.

## O que foi verificado e está bom

- **Nenhuma escrita à mão.** As únicas chamadas que escrevem são `decisoes/:id/responder`, `lead/:id/saida`, `lead/:id/ata`, `diagnostico/gerar|aprovar`, `proposta/gerar|publicar|segurar`, `fechamentos/:id/rodar`, `relatorio/semana/gerar` e `assinar-pela-root`. Não há PUT nem PATCH de etapa, saúde ou próxima ação.
- **O arraste do funil não escreve nada:** o `onDragStart` faz `preventDefault` e só lê a ficha para explicar o portão; "mover" é a alternativa de teclado, com `aria-label`.
- **Publicar e fechar passam pela porta:** publicar vai a R3 (`propostas.liberar`), o fechamento só propõe (R4); responder decisão exige `leads.editar` e `aprovacoes.decidir`, e a API barra quem propôs. A tela não afirma "aprovado" nem "publicado" por conta própria: lê o estado da API (exceção: C-3).
- **NAV coerente com a API:** os itens novos usam `leads.ver` e o módulo `leads`, iguais aos GET correspondentes, e o `nav.test.ts` os fixa.
- **Sem XSS:** não há `dangerouslySetInnerHTML`; narrativa, fio e contexto da decisão saem como texto. O único `href` vindo de dado é o link de assinatura (C-1).
- **Preço:** nenhum preço, desconto ou parcela escrito na tela; tudo vem da API, e a tabela do shared bate com a de 04/10.
- **Fuso:** toda hora passa por `Intl.DateTimeFormat` com `timeZone: 'America/Sao_Paulo'`; sem `getHours` nem `toLocaleString`.
- **Nulo aparece como "ausente"**, nunca zero (exceção: C-5).
- **390 px:** as grades caem para uma coluna; as tabelas do fechamento e da torre viram blocos empilhados abaixo de `md`.
- **Texto:** sem travessão nem emoji no texto visível das telas revisadas.
