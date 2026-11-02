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

**Desenho e mapa (30/10, madrugada):**

- `apps/api/src/platform/area-do-cliente.json`: a fonte.
- `GET /tenants/plataforma/operacao/area-do-cliente` (sessão da plataforma, `dashboard.ver`).
- `apps/web/src/app/contexto/area-do-cliente/page.tsx`: o mapa (blocos, itens, motor, levas, decisões), com filtro por leva, estado e bloco.
- Item "Área do cliente" no Contexto, logo depois do Fluxo do cliente, só para a plataforma.
- `docs/comercial/RODADA-AREA-DO-CLIENTE-20261030.md`: o roteiro da leva A.
- Mockup navegável do que o cliente vê: https://claude.ai/artifact/3v25PGk1PhR58CMEdJNbj4 (aprovado pelo Rodrigo em 30/10). Dele entraram no M1 a régua das sete fases, o selo "no ar · atualizado em" e o bloco "quem cuida da conta".

**Leva A (30/10, tarde), lanes A0 a A5 feitas e A6 parcial**, detalhe em `homolog/RESULTADO-AREA-DO-CLIENTE.md`:

- `packages/shared/src/area-do-cliente.ts`: os ids, blocos, fases, estados, esquemas e tipos (fonte do código; teste confere contra o JSON).
- Migration aditiva `20261030150000_area_do_cliente`: `SalaVersao.item`, dois índices únicos parciais, tabela `SalaLeitura` (filha da sala, RLS FORCE).
- API: `area-do-cliente-projecao.ts` (modo, fase do fluxo, derivados, os 15 slots), `sala-versao.service.ts` por item (mesma capacidade R3), `POST /sala/:token/area/leitura`, `GET /comercial/lead/:id/area` e as rotas de versão por item, `area-do-cliente-bancada.ts`.
- Web: `AreaDoCliente.tsx` no link do cliente, aba "Área do cliente" no painel do lead, chip "área N/15" em Clientes ativos, cartão do item em /atendimento.
- Zero variável, zero capacidade, zero permissão nova. Uma migration aditiva. Nada publicado em produção.

## 9. Como seguir

1. Rodrigo dá o OK e a leva A sobe pela receita de `homolog/RESULTADO-AREA-DO-CLIENTE.md` (conferindo a produção da hora antes do build).
2. A mesa de quinta (05/11) ratifica D1 a D7 (ou deixa as recomendações valerem).
3. A leva B entra assim que a A estiver no ar com um cliente real da lista Onboarding de cliente.
4. Toda rodada atualiza o `estado` dos itens no arquivo: o mapa é o backlog vivo.

## 10. Quadro de pendências (30/10/2026, tarde)

Tudo o que estava aberto, num lugar só, por quem resolve.

**A. Mesa dos sócios (D1 a D7): nenhuma trava a leva A; as recomendações valem até a mesa dizer.**

| Decisão | Recomendação em vigor | Trava |
|---|---|---|
| D1 acesso | só o link para ler; código pelo WhatsApp só para revelar acesso do cofre e aprovar documento | cofre, PRD, arquitetura (leva C) |
| D2 nível de aprovação por item | R3 para todos (feito na leva A); a lista "de rotina" para R2 fica como constante a criar quando a mesa decidir | nada |
| D3 ata | o resumo redigido (tarefa 18), nunca a ata inteira | atas (leva B) |
| D4 domínio | Lucas decide; até lá `os.operacaoroot.com/s/<token>` | M7 (leva B) |
| D5 tarefas para manutenção e novidades | manutenção na 29 ou 54; novidades vira tarefa mensal do Marketing; entra no fluxo v7 | manutenção, novidades (levas C e D) |
| D6 "lido" | só a bancada vê a data; o cliente vê só o "novo" (feito na leva A) | nada |
| D7 vídeos | catálogo da Central por trilha, com um vídeo curto por cliente quando couber | vídeos (leva C) |

**B. Leva A (esta branch), para fechar:**

1. OK do Rodrigo para publicar; conferir a produção da hora (a agenda v2 do Predator e o Painel de vida R2 podem ter publicado antes: rebasear se for o caso).
2. Rodar com banco o que o Mac não roda: `tenant-isolation` (a `SalaLeitura`), o fluxo R3 por item em `comercial-sala-publicada` (casos por escrever na suíte) e o e2e `homolog/e2e/area-do-cliente.mjs` no ambiente de teste da VPS.
3. Publicar: uma migration aditiva, zero variável, zero capacidade, zero passo de dado.
4. Depois de no ar: um cliente real da lista Onboarding com escopo e dúvidas preenchidos e a primeira ata publicada pela bancada; o Lucas e o Pedro avisados de que o link do cliente fechado mudou.

**C. Leva B, o que o OS já sabe (logo depois da A):** agenda (porta `comunicacao.agenda.periodo` + `proxima-reuniao.ts`), cronograma com as datas combinadas (tarefa 09; troca a régua provisória das fases), atas em resumo (Banco de atas + `AtaLigacao.clienteId`, D3), linha de execução completa (card da implantação + Frota + trilho), contrato e escopo com o PDF guardado (`ComercialDocumento` + `ArquivoDoCliente`), domínio curto (D4). Prova: um cliente real com sete slots no ar sem ninguém digitar nada além do que a tarefa do fluxo já pede.

**D. Leva C, o que ainda não existe no OS:** acesso com código pelo WhatsApp (D1), PRD e arquitetura com aprovação pela área e o link do arquivo do cliente (hoje o item só diz que o documento existe), cofre no celular (`CofreItem` partilhado + revelar registrado), glossário e dúvidas (memória), vídeos (Central por trilha, D7), instruções de acesso e de manutenção (notas padrão + personalização, D5).

**E. Leva D, as rotinas do fluxo pela área:** novidades (rotina mensal), status de sexta (30), pulso (32) e nota (43) respondidos pela área, relatório mensal (51). Depende do fluxo v7.

**F. Fora do código:** compartilhar o mockup e a página do desenho com o Lucas e o Pedro (artifacts privados até o Rodrigo abrir); fluxo v7 com as tarefas da D5; a nota do projeto no root-base acompanha cada leva.
