# RESULTADO da rodada de produção 4: o WhatsApp por dentro do OS (22/10/2026)

> Roteiro: `docs/comercial/RODADA-PRODUCAO-20261022-WHATSAPP.md` (o Rodrigo, 21/10 23:45: "tem que passar tudo por lá"). Branch `homolog/final-20261019`, sobre a tag `producao-22b-20261022`. Tag desta rodada: **`producao-22c-20261022`**. Bundle delta: `C:\Users\User\dev\producao22c-delta.bundle` (`homolog/final-20261019` e a tag, `^producao-22b-20261022`).
> Só homologação, no Predator. **Nada foi à produção.** Este arquivo não tem número, nome de contato nem texto de mensagem: só contagens e ids curtos. Quem publica é o orquestrador do Mac, pela cadeia de releases (§7), DEPOIS da produção 22 e da 22B.

## 1. O que entrou

| Lane | Pedido | O que foi feito | Onde |
|---|---|---|---|
| W1 | Tudo o que chega fica gravado | O webhook da Evolution (o mesmo do canal de aprovação) **grava primeiro** toda mensagem, 1:1 e grupo, inclusive `fromMe`, e só depois entrega aos leitores de sempre, na mesma ordem (grupo de links, entrada do lead e triagem, canal). A gravação nunca lança nem muda o corpo; a instância do corpo é a prova de empresa (sem ela ou de outra, não grava); conector desligado não grava. Duas tabelas novas com RLS: `WhatsAppConversa` (raiz) e `WhatsAppMensagem` (filha, sentinela e gatilho), idempotente por `(empresa, instância, id da mensagem)`. Modo `@lid`: a conversa fica no número real, com o lid guardado ao lado. Mídia só com metadados (tipo, nome, tamanho, duração), nada baixado. Edição, apagamento e reação viram linha própria que cita a original. `CONNECTION_UPDATE` faz Conexões medir de novo o estado | `gateway/canais/gravacao-do-whatsapp.registry.ts`, `whatsapp/leitura-da-evolution.ts`, `whatsapp/gravador.service.ts` |
| W1 | Sincronização | Rotina `whatsapp.sincronizar`: só na empresa da casa, nasce **ligada** a cada 5 min (São Paulo) na primeira abertura da caixa ou na primeira mensagem; só lê pela porta nova `LEITURA_DA_EVOLUTION` (`chat/findChats`, `group/fetchAllGroups` com participantes, `chat/findMessages`), com tetos por passagem (40 conversas, 1500 mensagens, 3 páginas de 50). Falha da Evolution = `erro` com contagens e tenta de novo; desligado ou não configurado = `pulada` | `whatsapp/sincronizacao.service.ts`, `pauta/evolution.service.ts` (métodos novos) |
| W2 | A caixa em `/whatsapp` | Lista à esquerda (foto ou iniciais, nome, prévia ou "📎 tipo", hora de São Paulo, bolha de não lidas, selo grupo e participantes), chips Todas · Leads · Clientes · Grupos · Sem vínculo · Equipe (e Arquivadas) com contagem, busca por nome, número e texto. Conversa à direita com rolagem própria (balões, nome do remetente no grupo, citação, mídia "não baixada", "enviada por <pessoa>", mais antigas), cabeçalho com o vínculo e a caixa de resposta. Abrir marca como lida; "Arquivar conversa" só tira da lista. No celular, lista e conversa em telas separadas com Voltar. O simulador de celulares mudou inteiro para `/whatsapp/simulador` | `apps/web/src/app/whatsapp/`, `whatsapp/caixa.*` |
| W2 | Responder é de gente | `POST /whatsapp/conversas/:id/responder` com a permissão nova `whatsapp.conversar`, só gente (guarda pelo token e releitura no banco), pela porta `RESPOSTA_DE_GENTE_PELA_EVOLUTION`; **não passa pela régua** (a régua é de agente); grava a mensagem com `enviadaPorId`, audita `whatsapp.mensagem.enviada_por_pessoa` sem texto nem número; conversa de lead também entra em `ComercialMensagem` para o fio seguir completo. As mensagens de agente (M1 a M8, pauta, aprovação) não mudaram | `whatsapp/caixa.service.ts` |
| W3 | Vínculo com lead e cliente | 1:1 casa sozinho pelo telefone (lead e `Partner.phone`; igualdade de dígitos, com e sem 55, o 9º dígito não é mexido; dois candidatos não casam; lead e cliente com o mesmo número = o cliente). Grupo **nunca liga sozinho**: `ROOT | <nome>` (e `Root | `, `ROOT - `) igual, normalizado, a UM cliente, senão a UM lead, vira sugestão de um clique; parecido só aparece na busca; empate não sugere. Equipe pelo nome do grupo (Estratégia e Produto, FullBPO, Operação Root) ou pelo número de gente da casa. Vincular a lead, a cliente, desvincular, marcar equipe e "pôr este número no lead" são de gente, auditados, e o casamento automático nunca refaz decisão de pessoa | `whatsapp/vinculo.ts`, `vinculo.service.ts`, `components/whatsapp/VinculoDaConversa.tsx` |
| W3 | O lead e o cliente veem o WhatsApp | Aba "WhatsApp" no painel do lead (conversas ligadas e últimas mensagens, link para a caixa); o fio do lead ganha as mensagens de gente sem duplicar `ComercialMensagem`; bloco "WhatsApp" na ficha do cliente; a teia do cliente conta a conversa (só a contagem). Telefone editável no lead e no cliente (rotas próprias: o `PATCH /leads/:id` passa pelo `ApprovalGuard`) e o casamento roda de novo depois | `AbaWhatsapp.tsx`, `WhatsappDoCliente.tsx`, `comercial/fio.service.ts`, `onboarding/trilho/teia-do-cliente.ts` |
| W3 | Script | `vincular-conversas.js` (simula por padrão; `--valer --como`): casa tudo e aplica as sugestões de grupo de nome IGUAL; lead de nome de uma palavra fica para o clique | `apps/api/src/scripts/vincular-conversas.ts` |
| W4 | O Dia a dia sabe do WhatsApp | Cartão "WhatsApp" na Visão geral: não lidas de Leads, Clientes e Sem vínculo (cada linha abre a caixa com o filtro) e "Conversas sem vínculo: N"; bolha de não lidas no item WhatsApp do menu (99+, releitura a cada 30 s com a aba visível). `GET /whatsapp/resumo` com cache de 30 s por empresa, esquecido ao ler, arquivar, responder e vincular. Nada vira tarefa nem pendência | `whatsapp/resumo.*`, `WhatsappNoDiaADia.tsx`, `Sidebar.tsx` |
| W5 | Provas | Dublê da Evolution para a stack 3031 (Node puro: leitura, envio, `POST /simular/mensagem` que entrega ao webhook com o segredo da empresa) e o e2e `producao22c.mjs` | `homolog/mocks/evolution/`, `homolog/e2e/producao22c.mjs` |

## 2. Decisões desta rodada

- **Nenhuma capacidade nova; a política não mudou** (83 capacidades, 33 com efeito). A sincronização é leitura pelo conector (como o próprio webhook), não pela porta; responder é de gente com permissão própria, fora da régua. Nenhum agente ganhou envio.
- **A gravação vem antes e não decide nada.** Ela não autoriza, não responde e não cria lead. Se falhar, o webhook segue igual para os leitores; o casamento do vínculo espera no máximo 2 s dentro do webhook (revisão A3).
- **Filtros sem sobreposição**: Equipe é `equipe = true` seja qual for o vínculo; Leads, Clientes e Sem vínculo só fora da equipe; arquivada só em Arquivadas. A mesma regra na caixa, no cartão do Dia a dia e na bolha.
- **Não lidas**: o webhook soma só entrada nova; o que a casa manda nunca soma; a primeira sincronização de uma conversa não soma (o histórico já lido no celular não vira "não lido"). Ler é por pessoa (`lidaEm`, `lidaPorId`) e zera a conversa.
- **Decisão de gente vence**: desvincular e marcar ou tirar da equipe também gravam quem decidiu, e o casamento automático não religa nem desliga.
- **Permissão `whatsapp.conversar` pela migration** (não pelo `db:sync-permissions`, que não é aditivo): Admin Master, Gestor de Marketing e Analista, os papéis de gente com `leads.editar`. `ia_acao` fica de fora.
- **A 3031 usa a reserva da casa para o dublê** (`EVOLUTION_*` no compose): a `ENCRYPTION_KEY` dessa stack tem 48 bytes desde a montagem e o cofre dela nunca gravou (zero linhas); trocá-la quebraria o link cifrado das 44 salas da semente. Em produção a credencial está no cofre e nada disso se aplica.

## 3. As lanes

| Lane | Commits |
|---|---|
| 0 · contrato (orquestrador) | `124aa398`, `15d834eb`, `d4dd4d75` |
| A · W1 | `8be1d386`, `fee1553c`, `da9d513c`, `1ccda705`, `baafd531`; merge `0abd2663` |
| B · W2 | `11f9a110`, `4d271c51`, `4c76510f`, `b9875769`, `2000bc9f`, `603b745a`; merge `7bae66d5` |
| C · W3 | `a51ea51e`, `8f64f480`, `4a118425`, `8020c030`; merge `84d987c3` |
| D · W4 e W5 | `1fd6f116`, `d55a3033`, `498a443e`, `aa82b329`; merge `76b6b041` |
| Integração | `0b49e2e7`, `0babdd01` (cache do resumo esquecido), `9eb65371` (stacks), `50f73205` (e2e e a reserva da casa na 3031) |
| Revisão | `bf29f818` (§5) |

Os quatro worktrees nasceram na `main`; cada lane voltou o seu para `d4dd4d75` antes de começar (árvore limpa, nada perdido).

## 4. Provas

**Suítes** (Postgres descartável na 5440, recém-migrado, política semeada):

| Suíte | Resultado | Linha de base (22B) |
|---|---|---|
| API inteira (em `9eb65371`) | 5803 casos: 5457 verdes, 310 vermelhos, 36 pulados (46 arquivos) | 5678: 290 vermelhos (44 arquivos) |
| Web inteira | 1850: 1785 verdes, 65 vermelhos (os 8 arquivos da base) | 1789: 66 vermelhos (8 arquivos) |
| Política | 110/110 | 110/110 |
| Isolamento (papel restrito) | 528/528 (as duas tabelas novas no inventário; filhos com `orgId` redundante 33) | 520/520 |
| Novas e as do webhook (depois da revisão) | `whatsapp-*` 8 arquivos 128/128; com `comercial-canal-evolution`, `canal-de-aprovacao`, `canal-segredo`, `grupo-de-links`, `modelos-globais`, `rotinas`, `comercial-agentes-entrada` 404/404 | |
| `tsc` | limpo na API e no web | |

Os vermelhos a mais da API são de carga: `adversarial` (+2, a instrumentação estática), `contrato-de-conector` (+1), `sem-digisac` (1), `comercial-funil-mover` (2, estáticos) e `editorial-local` (1) estouraram os 5 s na passada inteira e **passam sozinhos** (12/12, 24/24, 31/31; os dois casos da instrumentação 8/8; o do conector 1/1); `import-clickup-work` tem 1 vermelho sozinho, o mesmo da base. `vault-colecao` (20) é o da base da rodada 22 (na 22B ele pulou). `comercial-seed` segue com o defeito antigo da semente dependente da hora. Nenhum vermelho novo.

Novas da rodada: API `whatsapp-leitura` 22, `whatsapp-gravacao` 19 (os leitores antigos recebem o mesmo corpo, com e sem gravador: lead com e sem `@lid`, canal, grupo de links, `fromMe`, outro grupo, `connection.update`; gravador quebrado não barra ninguém), `whatsapp-sincronizacao` 12, `whatsapp-caixa` 24 (com a catraca: só a caixa chama `responderComoPessoa`), `whatsapp-vinculo` 22, `whatsapp-vinculo-banco` 18, `whatsapp-resumo` 8; web `caixa-whatsapp` 11 e `whatsapp-caixa` 15 (componente), `whatsapp-vinculo` 16, `producao22c-whatsapp-resumo` 19, e ajustes em `nav`, `rotas-movidas`, `menu`, `comercial-whats-layout`.

**Roteiros e2e** (imagem final `rootos-final-app:producao22c`, `890afadafac1`):

| Roteiro | Onde | Resultado |
|---|---|---|
| `producao22c.mjs` (novo) | seed, 3031, com o dublê | **PASSA, 18 passos, 38 s** (do zero): 00 credencial da casa no dublê e instância aberta; 01 "Rodar agora" da sincronização traz as 7 conversas; 02 o webhook grava 1:1, grupo (participante `@lid`) e o 1:1 `@lid`; 03 chips com contagem igual à lista e busca por nome e texto; 04 cartão do Dia a dia e bolha; 05 abrir marca lida; 06 e 07 responder 1:1 e no grupo (o dublê recebe; "enviada por"); 08 grupo ao cliente pela sugestão num clique; 09 1:1 ao lead à mão pela busca; 10 aba WhatsApp do lead; 11 bloco da ficha do cliente; 12 arquivar e voltar; 13 o `@lid` é uma conversa só com o número real; 14 grupo da equipe no chip Equipe e fora de Sem vínculo; 15 simulador em `/whatsapp/simulador`; 16 a 390 px telas separadas sem rolagem lateral; 17 depois de ler, cartão e bolha descem |
| `producao22b.mjs` | seed, 3031 | **PASSA, 14 passos** |
| `producao22.mjs` | seed, 3031 (com `producao22-semente.cjs`) | **PASSA, 10 passos** |
| `producao21.mjs` | seed, 3031 | **PASSA, 20 passos** |
| `agentes.mjs` | seed, 3031 | **PASSA, 8 passos** |
| `final.mjs` | cópia, 3030 | **17/17** (fotos com dado real em `homolog/organizar/fotos/`, fora do git) |

Fotos da rodada em `homolog/provas/producao22c-*.png` (caixa, conversa, resposta 1:1 e grupo, vínculo por sugestão e busca, aba do lead, ficha do cliente, Dia a dia, simulador; escuro, claro e 390 px).

**O e2e achou, e a integração corrigiu antes de fechar:** guardar a credencial da Evolution na 3031 dava 500 (a chave de cifra da stack, §2); e o roteiro lia o histórico e o cabeçalho antes de a conversa carregar. A primeira passada também mostrou que o roteiro não desfaz os vínculos que cria: para repetir, apagam-se antes as conversas fictícias dele na 3031 (§8).

**As stacks** (`up -d --no-build api web`, bancos não recriados, política sem mudança): `rootos-final` (3030) com 202 tarefas, 19 leads, 18 `Partner`, 8 usuários, 19 listas, 5 pastas e 84 status antes e depois (migrations 119 → 120), a permissão nova nos três papéis; `rootos-final-seed` (3031) de pé com o dublê `evolution_duble` (container `rootos_final_seed_evolution`, `127.0.0.1:4034`). Boot com 83 capacidades e 33 com efeito ligado.

**O script `vincular-conversas.js`** na 3031: `--simular` 1 → `--valer` 1 → `--valer` 0 → `--simular` 0, só contagens e ids curtos.

## 5. Revisão adversarial

Revisor curto sobre `git diff 8dc987d6 HEAD` (as quatro lanes integradas), só leitura. Veredito: **fecha com ressalvas**; nada crítico nem alto. As nove perguntas do roteiro fecham (seis com ressalva): nada gravado sem `orgId`; webhook idempotente sem mexer nos leitores; instância como prova de empresa; resposta só de gente com permissão; vínculo errado por nome parecido impossível sem clique; nenhum segredo nem número no diff; a Evolution só pelo conector; migration aditiva com RLS; isolamento sem oráculo.

Consertados com teste (`bf29f818`):
- **A1** envio pela caixa que estoura o prazo dizia "nada foi enviado; tente de novo", e a mensagem podia ter saído (o cliente receberia duas vezes). Agora: "não confirmou a tempo; confira no celular antes de repetir".
- **A2** o lead que fechou vira cliente com o mesmo telefone; o casamento tentava ligar os dois e batia no CHECK (o webhook só avisava, e o script abortava no meio). Agora vale o cliente.
- **A3** a gravação esperava, sem prazo, o casamento carregar até 10 mil clientes e leads a cada mensagem de grupo. Agora grupo da equipe ou sem o prefixo não carrega as listas, e o webhook espera o casamento no máximo 2 s.
- **A4** a lista lia todas as mensagens das conversas listadas para achar a última (o `distinct` do Prisma é em memória), a cada 15 s por aba. Agora `DISTINCT ON` no banco; a busca roda uma vez e as contagens filtram pelos ids.
- **A5** marcar como lida aceitava conta de máquina (o MCP tem `leads.ver`). Agora é só de gente.
- **A7** o script ligava grupo a lead de nome de uma palavra ("ROOT | Pedro"). Agora fica para o clique (`soNoClique`); erro numa conversa não aborta o lote.
- **A9** o log do casamento levava a mensagem crua do erro (que no Postgres traz a linha). Agora só o nome e o código.
- **A10** o telefone de cliente aceitava qualquer `Partner`. Agora só cliente.

Registrados, sem conserto:
- **A6** as FKs de lead e cliente nas duas tabelas são simples (com `SET NULL`), não compostas com `orgId`: o serviço confere a empresa sob o isolamento antes de gravar, mas o banco não barraria um bug futuro. FK composta com `SET NULL` só da coluna do vínculo pede sintaxe que o Prisma não descreve; fica para uma migration própria.
- **A8** na primeira sincronização de uma conversa, no máximo 150 mensagens (3 páginas de 50); o que passar disso nunca volta. Na produção a Evolution só tem o que chegou depois da ligação do número (21/10 23:22, `HISTORIC=false`) e o webhook cobre o fluxo novo; continuar de onde parou pede guardar o cursor da página.
- **A5 (metade)**: a conta de máquina com `leads.ver` lê pela API o texto das conversas da caixa ([a decidir], §6).

## 6. [a decidir] e o que fica para o Rodrigo

1. **Retenção das mensagens.** A mensagem é registro do negócio e fica. Sugestão: o mesmo prazo do rastro da empresa (`RastroRetencao`, padrão de 5 anos), com expurgo por rotina desligada como a da Lixeira; ou 2 anos para o texto, guardando a linha sem o texto. Hoje nada é apagado.
2. **Baixar mídia** (próxima rodada): hoje só os metadados. Baixar pede decidir onde guardar (MinIO da empresa), o teto e quem pode abrir.
3. **A triagem (CO-16)** continua desligada e pede a chave do modelo; a gravação não depende dela.
4. **Cadastrar o WhatsApp dos sócios na Equipe** (`/organograma` › Equipe, ou o `/perfil`): sem isso, as conversas 1:1 com os sócios aparecem como "sem vínculo" em vez de Equipe.
5. **Telefones dos leads**: nenhum dos 13 leads tem telefone (o CRM veio sem). As conversas 1:1 só casam sozinhas depois de preencher (na aba WhatsApp do lead, na ficha, ou pelo "pôr este número no lead" da caixa).
6. **A conta de máquina lê a caixa?** O MCP (`ia_servico`) tem `leads.ver` e lê o texto das conversas pela API. Fechar pede um guarda de gente também no `GET` (ou uma permissão de leitura própria).
7. **Mensagem nova em conversa arquivada** não a desarquiva (fica no chip Arquivadas, com a bolha). Decidir se deve voltar sozinha para a caixa.
8. **Evento de edição da Evolution** (`MESSAGES_UPDATE`) não está assinado no webhook da instância; a edição que chega como mensagem nova é gravada. Assinar ou não.
9. Pendências que já estavam: as das RESULTADO-PRODUCAO-22B §6, 22, 21, 21B e AGENTES.

## 7. Para publicar (orquestrador do Mac)

Imagem a partir da tag **`producao-22c-20261022`**, que contém `producao-22b-20261022` e `producao-22-20261022`. **A 22 e a 22B sobem antes** (RESULTADO-PRODUCAO-22 §7 e RESULTADO-PRODUCAO-22B §7). A sequência é a da cadeia de releases (`docs/comercial/VIRADA-PRODUCAO.md`).

1. **Política: nada.** Nenhuma capacidade nova nem mudada; o boot continua dizendo 83 capacidades e 33 com efeito ligado.
2. **Migration** (o `migrate deploy` do container aplica). **Aditiva**:
   - `20261022230000_whatsapp_da_empresa`: tabelas `WhatsAppConversa` (raiz) e `WhatsAppMensagem` (filha, sentinela, gatilho `WhatsAppMensagem_orgId_do_pai`), RLS FORCE com as quatro policies nas duas, grant ao `mktos_app`, CHECKs (um vínculo só, direção, origem, forma do `chatJid`), e a permissão `whatsapp.conversar` com o vínculo aos papéis `admin_master`, `gestor_marketing` e `analista` (idempotente, `ON CONFLICT DO NOTHING`). A conferência no fim aborta a migration se faltar RLS, FORCE, policy ou o gatilho.
   Ensaiado na 3030 (cópia da produção de 19/10): 119 → 120 migrations, contagens iguais antes e depois.
3. **Permissão nova: `whatsapp.conversar`, pela migration.** **Não rode `db:sync-permissions`.** A permissão viaja no JWT: **todo mundo sai e entra** depois da subida, senão a caixa abre sem "Responder".
4. **Variáveis novas: nenhuma.** O webhook da instância `rootos` não muda (mesma URL, `x-canal-segredo`, eventos `MESSAGES_UPSERT` e `CONNECTION_UPDATE`). A credencial continua no cofre da empresa `root`.
5. **A rotina `whatsapp.sincronizar`** nasce **ligada**, só na empresa da casa, a cada 5 min, na primeira abertura de `/whatsapp` (ou na primeira mensagem que chegar). Depois da subida:
   - abrir `/whatsapp` uma vez;
   - em `/rotinas`, "Rodar agora" em "Sincronizar o WhatsApp da empresa" (`whatsapp-sincronizar`) e conferir o histórico: `ok` com "N conversa(s) …, M mensagem(ns) lida(s)". `pulada` = conector desligado ou não configurado; `erro` = a Evolution não respondeu (tenta de novo em 5 min). Com `ROTINAS_CRON=off` ela só roda pelo "Rodar agora".
6. **O script dos vínculos de grupo**, no container da api, depois da primeira sincronização:
   ```bash
   # 1) simular (padrão): só contagens e ids curtos
   docker exec -w /app/apps/api <api> node dist/scripts/vincular-conversas.js --org root
   # 2) conferir: "sugestoesDeNomeIgual" e "aplicadas" = 7 (os sete ROOT | <cliente>), "equipe" = 3, "erros" = 0.
   #    Se der menos de 7, o nome de algum grupo não é IGUAL ao do cliente (só parecido): esse se liga na caixa,
   #    pela busca. Se quiser ver os nomes, acrescente --detalhe <arquivo FORA do repositório>.
   # 3) valer:
   docker exec -w /app/apps/api <api> node dist/scripts/vincular-conversas.js --org root --valer --como <e-mail do Rodrigo>
   # 4) de novo, simular: tem de dar zero ("Zero a fazer.")
   ```
   Ensaiado na 3031 com dados fictícios: simular 1 → valer 1 → valer 0 → simular 0. Nada é apagado; desfazer é "Desvincular" na caixa.
7. **Comportamento que muda na subida (avisar):**
   - `/whatsapp` vira a **caixa**; os celulares do comercial ficam em `/whatsapp/simulador` (o link "Celulares do comercial" está no topo da caixa; `/comercial/simulador` redireciona para lá);
   - o painel do lead ganha a aba **WhatsApp**; a ficha do cliente, o bloco **WhatsApp** e o telefone editável;
   - o Dia a dia ganha o cartão **WhatsApp**; o menu, a bolha de não lidas no item WhatsApp;
   - toda mensagem que chega ao número fica gravada (antes, a que não era de lead nem de aprovação se perdia).
8. **Rollback só de imagem: possível.** As tabelas novas são ignoradas pela imagem anterior; a permissão fica sem rota. Com a imagem anterior, o webhook volta a não gravar (o que chegar nesse intervalo só existe na Evolution, e a sincronização traz quando a imagem nova voltar).
9. **Conferências na produção depois:**
   - o log de arranque sem erro, com 83 capacidades e 33 com efeito;
   - `/whatsapp`: **os 10 grupos** aparecem (sete `ROOT | <cliente>`, `ROOT | Estratégia e Produto`, `FullBPO | Operação Root` e a comunidade), com nome e contagem de participantes; os três da equipe no chip **Equipe**;
   - depois do script (item 6): os sete ligados aos clientes (chip **Clientes** com 7, o nome do cliente no cabeçalho de cada um, com link para a ficha);
   - **as duas mensagens de teste do Rodrigo** (1:1, `@lid`) visíveis numa conversa **sem vínculo** (elas estão na Evolution desde 21/10 e a sincronização as traz);
   - responder numa conversa de teste e ver a mensagem no celular, com "enviada por" na caixa e a linha `whatsapp.mensagem.enviada_por_pessoa` no Registro de ações (sem o texto);
   - Dia a dia com o cartão WhatsApp e a bolha no menu.

## 8. Apagar depois

Ninguém apagou nada da produção nem da cópia nesta rodada. Na 3031 (fictício), o orquestrador apagou entre duas passadas do e2e as 7 conversas e a 1 mensagem do comercial que o próprio e2e tinha criado, para repetir do zero. Herda as listas das RESULTADO-PRODUCAO-22B, 22, 21, 21B e AGENTES, mais:

- Imagens sem tag dos dois builds que caíram no `next/font` (falha passageira do Google Fonts; o terceiro passou sem mexer em nada); `rootos-final-app:producao22b` fica como reserva até a virada.
- Bancos de teste no Postgres 5440 (fictícios): `rootos_p22c_0_test`, `rootos_p22c_shadow_test`, `rootos_p22c_a_test`, `rootos_p22c_b_test`, `rootos_p22c_c_test`, `rootos_p22c_d_test`, `rootos_p22c_full_test`, `rootos_p22c_full_test_rls`.
- `C:\Users\User\dev\scratch-p22c\` (logs e JSON das suítes, sem segredo); `C:\Users\User\AppData\Local\Temp\w2-provas\` e `C:\Users\User\AppData\Local\Temp\w3run\` (fotos e runner das lanes B e C).
- Worktrees desta rodada em `.claude/worktrees/` (branches `worktree-agent-ae53919f…`, `-a512e15e…`, `-a7b4d585…`, `-a1415744…`, integradas).
- Na 3031 (fictício): as conversas e mensagens "e2e 22c", o container e a imagem do dublê `evolution_duble`, os vínculos e o telefone que o e2e pôs, o cliente importado da semente do `producao22`, e os dois segredos do canal acrescentados ao `homolog/.env.final-seed` (fora do git).
