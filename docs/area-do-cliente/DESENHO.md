# Área do cliente · desenho v1 (30/10/2026)

Fonte: Fluxo do cliente v6 (reunião de sócios de 29/10/2026 e as anotações em papel), o pedido do Rodrigo de 30/10 ("a área do cliente em si e a visualização do que vem sendo portado nela pelo ROOT OS") e a Área do Cliente do escritório Cardozo & Saggioro como molde de mecanismo. Do escritório vem só o mecanismo: nenhum dado, nenhum código, nenhum nome.

A fonte única do desenho é `apps/api/src/platform/area-do-cliente.json`, lida em Contexto › Área do cliente. Este documento explica o porquê; o arquivo diz o quê.

## 1. A ideia em uma frase

A área do cliente é a Sala do Cliente depois do negócio fechado. O mesmo link `/s/<token>` que o cliente recebeu no primeiro contato muda de modo e passa a mostrar quatro blocos com os 15 itens do painel. Nada de app novo, nada de segundo login, nada de segunda verdade.

Por que dentro da Sala e não um portal à parte:

- A Sala já é o link único do cliente, do primeiro contato ao kickoff (leva 5, L6: "o cliente acompanha tudo pela sala"). Um portal novo seria o segundo lugar para a mesma pessoa.
- A Sala já publica por versão com liberação de uma segunda pessoa (`SalaVersao` + porta R3). É exatamente a "curadoria total" que o escritório decidiu em 19/07: tudo automatizado, mas só publica com concordância da equipe.
- A Sala já deriva o acompanhamento do fio (etapa, próximos passos, documentos trocados, contato). O que falta é o resto dos 15 itens e a bancada que mostra o que está no ar.

## 2. O mecanismo do escritório, traduzido

| No escritório (cliente.cssaportal.com.br) | No ROOT OS |
|---|---|
| Coletores (Drive, atas do ClickUp e Granola, processos, resumo do WhatsApp) | O fio do lead, `ArquivoDoCliente`, o Banco de atas (Granola, Drive, vault), a agenda pela porta, o trilho, a Frota, o cofre, a memória |
| Fila de propostas pendentes | Item derivado ou rascunho em `SalaVersao` |
| Equipe aprova e edita | A bancada escreve; a porta retém; segunda pessoa libera em `/atendimento` |
| Publicado, o cliente vê | Última versão publicada de cada item no `/s/<token>` |
| "Marcar como lido" + `lido_por` para a equipe | `SalaLeitura`: selo "novo" até abrir; a bancada vê "lido em" |
| Tela "Portal do Cliente" no App Único | Aba "Área do cliente" no painel do lead, ao lado da aba Sala |
| Senha + código por e-mail | Token do link hoje; código pelo WhatsApp do decisor para cofre e aprovação (decisão D1) |

A regra de ouro que o escritório ensinou e que vale aqui: o que o sistema já sabe chega sozinho e nunca é digitado; o que a Root escreve passa pela porta antes de o cliente ver; o que não chegou aparece como vazio, dizendo em que fase chega. Nenhum campo inventa dado.

## 3. Os quatro blocos (o que o cliente vê)

1. **Onde estamos**: cronograma (09), linha de execução (10), agenda das reuniões (14), atas (18).
2. **O combinado**: contrato (01), escopo (01), PRD (21), arquitetura (21).
3. **Como usar**: instruções de acesso e de uso (11), cofre (20), central com glossário e dúvidas (12), vídeos (22), instruções de manutenção (sem tarefa), caminho para tirar dúvida (22).
4. **Novidades da Root** (sem tarefa).

Quatro blocos, não quinze abas: o cliente lê de cima para baixo e acha o que precisa em um toque. No celular é uma coluna só, com o botão do WhatsApp fixo embaixo, como a Sala já faz.

Dois itens do papel não têm tarefa no fluxo v6 (manutenção e novidades). Eles entram no desenho com a tarefa proposta e viram a decisão D5 para o fluxo v7.

## 4. Os estados de um item

Para o cliente: `vazio` (ainda não chegou, com a fase em que chega) e `publicado` (com o selo "novo" até abrir).

Para a bancada, mais quatro: `derivado` (o OS montou sozinho e espera publicar), `rascunho`, `na_porta` (esperando a segunda pessoa) e `lido` (com a data).

## 5. O motor (o que serve a todos os itens)

- **M1 · modo área**: o `/s/<token>` ganha o segundo modo quando o lead fecha.
- **M2 · publicar por item, com versão**: os quatro tipos de publicado de hoje viram quinze; o derivado nunca é digitado; R3 como hoje (ou R2 para os de rotina, decisão D2).
- **M3 · leitura**: `SalaLeitura`, o "novo" e o "lido em".
- **M4 · bancada**: a aba "Área do cliente" no painel, com os 15 slots, estado, fonte, tarefa do fluxo e a ação que resolve; chip "área N/15 no ar" nos cards de `/clientes`.
- **M5 · mapa**: Contexto › Área do cliente lendo o arquivo (esta branch).
- **M6 · acesso**: o link para ler; código pelo WhatsApp para cofre e aprovação.
- **M7 · domínio**: um nome curto, decisão do Lucas.

## 6. As levas (o backlog em ordem)

- **A · A área em si e a bancada** (o primeiro momento): M1, M2, M3, M4, M5.
- **B · O que o OS já sabe**: contrato, escopo, agenda, atas, cronograma, linha de execução, dúvidas, domínio. Sete slots no ar sem ninguém digitar nada além do que a tarefa do fluxo já pede.
- **C · O que ainda não existe no OS**: acesso com código, PRD e arquitetura com aprovação pela área, cofre no celular, glossário, vídeos, instruções de acesso e de manutenção.
- **D · As rotinas do fluxo pela área**: novidades, status de sexta (30), pulso (32), nota (43), relatório mensal (51).

Cada item do arquivo diz a leva, o estado da construção, a fonte no OS e o "feito quando". É esse arquivo que vira cartão quando a mesa quiser o backlog no Trabalho.

## 7. Decisões abertas (para a mesa)

D1 acesso · D2 nível de aprovação por item · D3 ata inteira ou resumo · D4 domínio · D5 tarefas para manutenção e novidades · D6 "lido" visível ao cliente · D7 vídeos por cliente ou por trilha. Recomendações no arquivo. Nenhuma trava a leva A; D1 e D3 travam partes da B e da C.

## 8. O que esta branch traz

- `apps/api/src/platform/area-do-cliente.json`: a fonte.
- `GET /tenants/plataforma/operacao/area-do-cliente` (sessão da plataforma, `dashboard.ver`).
- `apps/web/src/app/contexto/area-do-cliente/page.tsx`: o mapa (blocos, itens, motor, levas, decisões), com filtro por leva, estado e bloco.
- Item "Área do cliente" no Contexto, logo depois do Fluxo do cliente, só para a plataforma.
- `docs/comercial/RODADA-AREA-DO-CLIENTE-20261030.md`: o roteiro da leva A, pronto para o Predator ou para uma sessão.

Sem migration, sem variável nova, sem permissão nova, sem capacidade nova.

## 9. Como seguir

1. Mesa lê o mapa em Contexto › Área do cliente e toma D1 a D7 (ou deixa as recomendações valerem).
2. Leva A roda pelo roteiro, numa branch a partir da produção da hora.
3. A leva B entra assim que a A estiver no ar com um cliente real da lista Onboarding de cliente.
4. Toda rodada atualiza o `estado` dos itens no arquivo: o mapa é o backlog vivo.
