# RESULTADO da rodada de produção 3, interface e tarefas (21 a 22/10/2026)

> Roteiro: `docs/comercial/RODADA-PRODUCAO-20261022-INTERFACE.md` (ata de 21/10, o Rodrigo ditando sobre a produção que roda `agentes-publicar-20261021-v2`). Branch `homolog/final-20261019`, sobre a tag `producao-22-20261022`. Tag desta rodada: **`producao-22b-20261022`**. Bundle delta: `C:\Users\User\dev\producao22b-delta.bundle` (`homolog/final-20261019` e a tag, `^producao-22-20261022`).
> Só homologação, no Predator. **Nada foi à produção.** Este arquivo não tem dado de cliente nem segredo: só contagens e ids curtos. Quem publica é o orquestrador do Mac, pela cadeia de releases (§7), DEPOIS da produção 22.

## 1. O que entrou

| Lane | Pedido da ata | O que foi feito | Onde |
|---|---|---|---|
| I1 | 4 · recolher o menu na logo | O botão de recolher fica logo à frente da `LogoRoot`; no recolhido, o R e o botão lado a lado (252 → 64 px e volta) | `Sidebar.tsx` |
| I1 | 5 · o acordeão fecha | Clicar de novo na área aberta recolhe as subseções sem navegar; outra área abre a dela e fecha a anterior; `aria-current` segue na rota | `Sidebar.tsx` (`passoDoAcordeao`) |
| I1 | 3 · engrenagem | Ao lado da identificação (no `Topbar`, onde o nome mora): Perfil, Lixeira, Registro de ações (`/rastro`, que não mudou de lugar) e Configurações, só o que a permissão libera; teclado, Esc e clique fora. A foto do perfil aparece ali, ao lado do nome | `EngrenagemDoUsuario.tsx`, `Topbar.tsx` |
| I1 | 1 e 13 · o "⋯" da árvore | Só no hover do nome e no foco por teclado (no toque, sempre); o menu abre por portal, posicionado pelo botão e sempre dentro da janela (vira para cima ou para a esquerda); provado em 390, 768 e 1440 px sem frase cortada | `ArvoreDoTrabalho.tsx`, `ExcluirDaArvore.tsx`, `lib/posicao-do-menu.ts` |
| I1 | 14 · ícone e cor na lista | `WorkList`/`WorkFolder` ganham `icone` e `cor` (emoji curto ou ícone do catálogo do app; cor dos tokens do tema, lista fechada); aparece na árvore, no título da lista, em Todas e nos cartões; editável por quem renomeia, auditado como a renomeação; nulo apaga | `IconeDaLista.tsx`, `shared/aparencia-do-trabalho.ts` |
| I2 | 3 · trazer de volta o que foi apagado | **Excluir passa a ser recuperável**: `WorkTask.excluidaEm`/`excluidaPor` (excluir também arquiva, então toda listagem que já pedia `archived: false` a tira; as que mostram arquivada ganharam `tarefaViva()`). **`/lixeira`** (pela engrenagem): abas Tarefas (excluídas e arquivadas) e Listas e pastas (o Desarquivar da rodada 22), com quando, por quem e de onde, Restaurar em lote, busca e "ver no Registro de ações" (`GET /audit?entidade=`). Restaurar volta à lista e à etapa; lista arquivada restaura e avisa. "Apagar de vez" só `admin.usuarios` com a frase "apagar de vez", auditado; nunca o card da implantação. Expurgo dos 30 dias = rotina `trabalho.lixeira.expurgo`, **semeada desligada** (`ativo: false`, planejado) na primeira leitura da Lixeira | `apps/api/src/work/lixeira/`, `LixeiraView.tsx` |
| I2 | 2 · os 4 cards de volta | Script `restaurar-tarefas.js` (simula por padrão, só ids curtos, idempotente, `--como` relido no banco) | `apps/api/src/scripts/restaurar-tarefas.ts`; §7 passo 4 |
| I3 | 2 e 9 · "a pasta Cliente sai sim" | A pasta Clientes (Esteira de clientes, Onboarding de cliente, Execução) é marcada `doComercial` e sai da árvore, de Todas, dos contadores e do Dia a dia; a estrutura volta com ela em `pastasDoComercial`, que só serve para achar lista pelo id. Implantação, fechamento e "Iniciar onboarding" seguem abrindo o card na mesma lista; Esteira e Execução abrem pela linha "Listas da pasta Clientes" na Implantação. Criar, mover ou apagar coisa na Clientes pelo Trabalho é recusado com a frase. O "⋯" diz por que uma lista não sai ("tem N tarefas ativas", "é a lista da implantação") e oferece "Arquivar todas as N tarefas" | `work/pasta-do-comercial.ts`, `shared/pasta-do-comercial.ts`, `ListasDoComercial.tsx` |
| I4 | 11 · botão direito | Menu único em toda tarefa (quadro, lista, Todas, Dia a dia, Implantação, Minhas tarefas, Tarefas do comercial, painel do lead), também no "⋯" do cartão e em Shift+F10/tecla Menu: Renomear, Copiar ID, Mover para (lista e etapa, com busca), Mesclar com outra, Duplicar, Arquivar, Excluir, Compartilhar. O que a pessoa não pode fazer aparece desabilitado com a razão; a API recusa de novo. Mesclar: comentários, anexos e subtarefas mudam para a destino, etiquetas e campos são copiados, a origem é **arquivada** com "Mesclada em [link]"; recusa o card da implantação, tarefa na Lixeira e destino abaixo da origem | `MenuDaTarefa.tsx`, `work/menu-da-tarefa/` |
| I4 | 12 · tarefa no centro | "Abrir no centro" no painel: modal em duas colunas (informações, descrição, anexos, subtarefas e campos à esquerda; comentários e atividade à direita), "Ver trilho do onboarding" quando há trilho, "Voltar para o lado", preferência no navegador, Esc fecha, `?tarefa=` não muda; em 390 px tela cheia empilhada | `TrabalhoView.tsx` (`PainelTarefa`) |
| I5 | 7 · Funil vivo em lista | Tabela própria (sem biblioteca): largura mínima por coluna, redimensionar arrastando a borda do cabeçalho (ou setas), larguras no navegador, cabeçalho fixo, R$ e datas de São Paulo, etapa em chip, responsável em avatar, ordenação com `aria-sort`, colunas visíveis no painel de Filtros (no endereço e na vista salva); abaixo de 640 px, cartões. O quadro não mudou | `_funil/ListaDoFunil.tsx`, `_funil/lista-do-funil.ts` |
| I5 | 8 · Propostas pelo lead | Lead na primeira coluna (contato no balão), sem a coluna origem, situação fica, título da proposta como texto secundário; clicar abre o lead; proposta sem lead: "Vincular a um lead" e "Criar lead" (só gente, auditados, idempotentes; outro lead = 409). "Aparelhos da equipe" subiu para entre o primeiro painel e a lista | `propostas/page.tsx`, `comercial/proposta-do-lead.*`, tabela `PropostaDoLead` |
| I6 | 6 e 9 · cadastro completo | `/perfil`: foto, data de nascimento, cargo, apelido, cidade, fuso, WhatsApp (o da Equipe), `nomeNoVault`; a pessoa edita o próprio, `admin.usuarios` o dos outros, 409 entre abas, auditado sem o conteúdo da foto. Foto: JPG/PNG/WebP pelo tipo dos BYTES, SVG e animada recusados, 16 a 512 px, até 2 MB no envio e 256 KB guardados; a tela reduz a 256 px antes de enviar; o servidor tira os metadados (EXIF/GPS, XMP, IPTC, texto do PNG) e serve com o tipo conferido, `nosniff`, CSP `sandbox`, CORP. Aniversário (dia e mês) na Equipe e no Dia a dia | `apps/api/src/perfil/`, `AvatarDaPessoa.tsx`, `AniversariosDoDia.tsx` |
| I6 | 6 · responsável só com a imagem | Avatar com o nome no balão e no rótulo acessível (pilha com "+N") no quadro, lista, Todas, Implantação, Funil (cartão e tabela), Tarefas do comercial, painel do lead, Dia a dia e Minhas tarefas; nome e avatar onde o nome é a única informação | `AvatarDaPessoa`, `PilhaDeAvatares.tsx` |
| I6 | 9 · Equipe com as atribuições | Para cada pessoa, lidos do vault da Root e só leitura: o que conduz, as funções de que é dona e as de que é substituta, com link para a ficha no Contexto; e, do cadastro único, os agentes e rotinas de que é dona. Leitura pela porta protegida do índice (`obsidian.ver` relido, nota restrita fora). Vault ausente: "memória da Root indisponível" | `agents/atribuicoes-do-vault.ts`, `equipe.service.ts` |
| I6 | 10 · Integrações | Asana, Extrato OFX e Zapier saem dos cartões (o código fica, o `ofx` segue inscrito no contrato e cobrado no arranque; a API do Asaas fica). Granola e WhatsApp (Evolution) no mesmo `CartaoDeConexao`, do mesmo tamanho (`LARGOS` saiu), com as ações próprias numa gaveta "Configurar" | `conexoes/`, `shared/cartoes-de-conexao.ts` |

## 2. Decisões desta rodada

- **Nada é de agente e a régua não mudou**: nenhuma capacidade, permissão nem variável nova; a política segue a 1.12.0 da rodada 22. Tudo de gente (guarda pelo token e releitura no banco), pelas permissões que já existiam (`tarefas.editar`, `leads.editar`, `admin.usuarios`), auditado.
- **Excluir também arquiva.** É o que tira a excluída de toda listagem que já filtrava arquivada sem precisar tocar em cada uma; restaurar limpa as duas marcas. A tarefa não sai da lista nem da etapa ao ir para a Lixeira.
- **"Arquivada em" vem da auditoria** (a tarefa não tem coluna): a linha com `after.archived`, senão a do importador, senão a última `work.task.update`, senão `updatedAt`. Daqui em diante o PATCH que arquiva grava `archived` na auditoria.
- **A pasta Clientes é marcada por coluna** (`doComercial`), não pelo nome: renomear não quebra. A migration só marca a pasta de topo chamada Clientes que **guarda a lista Onboarding de cliente** (revisão M2: uma Clientes feita à mão por outra empresa fica do Trabalho).
- **O card da implantação arquivado ou na Lixeira volta** quando o lead fecha ou é iniciado de novo, com comentário e auditoria `work.task.restore` (revisão M3). Excluir o card pela tela é permitido; ele some da Implantação até restaurar.
- **Sem biblioteca de imagem**: a foto é reduzida no navegador (canvas) e o servidor só confere e tira metadados. Redimensionar no servidor pede pacote novo ([a decidir], §6).
- **A foto fica no banco** (tabela `FotoDePerfil`, até 256 KB, com RLS), não no armazém de anexos: a stack da homologação não tem MinIO, e a foto de 256 px cabe. Trocar a foto guarda a anterior (`substituidaEm`); nada é apagado.
- **A proposta liga ao lead por tabela** (`PropostaDoLead`, uma por proposta e empresa, índice único): o 409 e a idempotência saem do banco. Vínculo gravado vence o casamento antigo pelo nome.

## 3. As lanes

| Lane | Commits |
|---|---|
| A · I1 e I3 | `8c419fbd`, `223b1f99`, `b1f2159d`, `ac1eb676`; merge `b16fce1c` |
| B · I2 e I4 | `1722c6db`, `69e31b43`, `5776dc81`, `152613ff`; merge `b0c38f32` (conflitos com A e D resolvidos pela união) |
| C · I5 | `8336321b`, `db4c9d83`, `58cef329`, `1e96176a`; merge `064107d4` |
| D · I6 | `0bf28389`, `d74a0a8e`, `da1c9580`; merge `97205152`; orquestrador `66198e44` (foto sem metadados) |
| E · I6 (avatar nas telas) | `4eadbac7`, `eb60f70e`, `a5571c91`; merge `ea8f1274` |
| F · I7 (e2e) e orquestrador | `00abaf8a` (e2e, fotos, foto no topo), `ed61dbd4` (o que os e2e acharam), `2a9476cd` (o menu da árvore e a rolagem) |
| Revisão | `d42b2dd7` (§5) |

## 4. Provas

**Suítes** (Postgres descartável na 5440, recém-migrado, política semeada; API, política, isolamento e RLS medidos sobre a integração com a revisão, em `00abaf8a`; o web de novo no fim, em `2a9476cd`; depois de `00abaf8a` só o web mudou):

| Suíte | Resultado | Linha de base (rodada 22) |
|---|---|---|
| API inteira | 5678 casos: 5330 verdes, 290 vermelhos, 58 pulados (44 arquivos) | 5600: 302 vermelhos (42 arquivos) |
| Web inteira | 1789: 1723 verdes, 66 vermelhos (os 8 arquivos da base) | 1697: 67 vermelhos (8 arquivos) |
| Política | 110/110 | 110/110 |
| Isolamento (papel restrito) | 520/520 (as duas tabelas novas, `PropostaDoLead` e `FotoDePerfil`, entraram) | 516/516 |
| Rotas públicas, cofre, dinheiro e sessão com RLS | 167/167 | 167/167 |
| `tsc` | limpo na API e no web | |

Os vermelhos da API são da linha de base, com três ressalvas medidas:
- `import-clickup-arvore` (7) e `marketing-preparacao` (1) caíram só na passada que rodou junto com o build da imagem: sozinhos, 16/16 e 20/20 (tempo esgotado sob carga, como na rodada 22).
- `vault-colecao` pulou o arquivo inteiro nesta passada (na base tinha 20 vermelhos): é dos que pedem clone próprio.
- **`comercial-seed` (1 ou 2, conforme a hora)**: a semente comercial monta a chave da decisão "proposta fora da tabela" pela data de São Paulo de um evento relativo ao relógio; a segunda passada do teste (+3 h) que cruza a meia-noite desse evento cria uma `decisao.aberta` e uma `decisao.tomada` novas (139 → 141 eventos), e em outra hora a proposta liberada some da conferência. Falha igual no worktree da lane C (que não toca a semente) e a semente não mudou desde a tag `producao-22-20261022`. **Defeito antigo da semente de demonstração, dependente da hora; não é desta rodada** (fica para quem cuida da semente).

Novas da rodada: API `work-lixeira` 13, `work-pasta-do-comercial` 10, `comercial-proposta-do-lead` 12, `perfil-foto` 18 (com os metadados), `perfil-banco` 14, `equipe-atribuicoes` 10, `conexao-cartoes` 11, e casos em `work-quadro-movimento` (M3), `caixa`, `equipe-a7-banco`, `tenant-isolation`; web `producao22b-interface` 21, `trabalho-menu-da-tarefa` 12, `lixeira` 5, `comercial-menu-da-tarefa` 1, `comercial-funil-lista` 12, `propostas-do-lead` 9, `perfil-i6` 14, `responsavel-avatar-i6` 11, e casos em Equipe, Conexões, `caixa-entrada` e `nav`.

**Roteiros e2e** (imagem final `rootos-final-app:producao22b`, `32806796ac0c`):

| Roteiro | Onde | Resultado |
|---|---|---|
| `producao22b.mjs` (novo) | seed, 3031 | **PASSA, 14 passos, 60 s**: 01 recolher à frente da logo (252 → 64 px, R e botão lado a lado); 02 acordeão fecha e troca; 03 engrenagem com os quatro itens, dentro da janela também a 390, Lixeira abre `/lixeira`; 04 "⋯" invisível sem hover, visível com hover e foco, sempre no toque, menu dentro da janela em 1440, 768 e 390 com "Tem 1 tarefa ativa…"; 05 ícone e cor gravam, aparecem na árvore e no título, apagam; 06 excluir pelo botão direito, some do quadro, Lixeira, Restaurar volta à lista e à etapa; 07 árvore e estrutura sem a Clientes, Implantação com 10 cards; 08 as 8 ações na ordem, Renomear, Duplicar ("cópia de", sem comentários), Mesclar (origem arquivada com "Mesclada em [link]", comentário chega ao destino), Shift+F10; 09 centralizado em duas colunas, Esc, preferência, `?tarefa=` igual, "Voltar para o lado", 390 empilhado; 10 Funil em lista: largura mínima, arrastar a borda (160 → 240 px) persiste no recarregar, ordenação none → ascending → descending conferida nas linhas, coluna escondida pelos Filtros, 390 em cartões; 11 Propostas com Lead na 1ª coluna, sem origem, Aparelhos entre o painel e a lista, clique abre o lead; 12 foto PNG 64×64 vira JPEG no perfil, no topo e na Equipe, aniversário "9 de março" sem o ano, **avatar no card da Implantação** com o nome no balão; 13 vault-dublê reindexado, "Nome no vault" de três pessoas, o que conduz, dona e substituta iguais às notas, links ao Contexto; 14 Integrações sem Asana, OFX e Zapier, 17 cartões da mesma largura, "Configurar" abre a gaveta do Granola e da Evolution |
| `producao22.mjs` | seed, 3031 | **PASSA, 10 passos** |
| `producao21.mjs` | seed, 3031 | **PASSA, 20 passos** (P8 abre a gaveta "Configurar" da Evolution; a 390 a lista do Funil é cartões) |
| `agentes.mjs` | seed, 3031 | **PASSA, 8 passos** |
| `final.mjs` | cópia, 3030 | **17/17** (fotos com dado real em `homolog/organizar/fotos/`, fora do git) |

**O e2e achou, e a integração corrigiu antes de fechar:**
- `/propostas` rolava de lado a 390 px na cópia da produção: o `sr-only` do cabeçalho (absoluto) escapava do contêiner com rolagem. O contêiner virou `relative` (também o da tabela do Funil).
- **O menu "⋯" da árvore fechava sozinho** quando a pessoa rolava a árvore e clicava em seguida (o evento da rolagem chegava um quadro depois do clique). Reproduzido com a roda do mouse na imagem anterior; agora fecha só se o botão saiu do lugar, e o foco no primeiro item não rola a página.
- O cartão compacto (a densidade padrão da Implantação) não mostrava responsável nenhum: agora mostra o avatar na linha do título quando há pessoa ligada. Os cards da 3031 só têm o responsável em texto antigo (círculo tracejado, como antes); o e2e liga uma pessoa a um card fictício e exige o avatar.
- A foto do perfil não aparecia no topo (o `Topbar` desenhava só as iniciais).

**Avisos que ficam:** a 3031 não tem proposta de serviço sem lead (as duas da semente foram vinculadas nas passadas da lane F), então "Vincular a um lead" foi exercitado em passadas anteriores (fotos `producao22b-propostas-vincular*`) e **"Criar lead" só nos testes** (API 12 e web 9); a stack não tem MinIO (anexo e armazém provados na suíte da API).

**As stacks** (`up -d --no-build api web`, bancos não recriados, política sem mudança): `rootos-final` (3030) com 202 tarefas, 19 leads, 18 `Partner`, 8 usuários, 19 listas, 5 pastas e 84 status antes e depois (migrations 114 → 119), a pasta Clientes marcada com as 3 listas dela; `rootos-final-seed` (3031) de pé com os dados fictícios dos e2e e o vault-dublê. Boot com 83 capacidades e 33 com efeito ligado. **A migration `20261022205000` foi editada depois de aplicada na 3031** (a revisão M2 restringiu o UPDATE): o `migrate deploy` seguiu ("No pending migrations"), e na produção ela entra já na forma final.

**O script `restaurar-tarefas.js`** na 3031, com lista e tarefas fictícias: `--simular` 2 → `--valer` 2 → `--valer` 0 → `--simular` 0, só ids curtos.

## 5. Revisão adversarial

Revisor curto sobre `git diff 0713c1a1 HEAD` (lanes A a D integradas), só leitura. Veredito: **fecha com ressalvas**; nada crítico nem alto. As nove perguntas do roteiro: Lixeira sem furar RLS nem permissão (fecha); pasta Clientes fora da árvore sem sumir da Implantação (fecha com ressalva, M2); mesclar sem perder comentário nem anexo (fecha com ressalva, M1); foto sem executar conteúdo (fecha); menu sem ação fora da permissão (fecha: a API recusa de novo); propostas sem cruzar empresa (fecha); vault sem nota restrita nem caminho controlável (fecha); nenhum segredo nem dado de cliente no diff (fecha); migrations aditivas com RLS (fecham).

Consertados com teste (`d42b2dd7`):
- **M1** mesclar numa subtarefa (de qualquer nível) da própria origem: a destino sumiria com a origem arquivada, ou formaria ciclo de mãe. Agora 400 com a frase.
- **M2** a migration marcava a pasta de topo Clientes de qualquer empresa; Esteira e Execução ficavam sem tela. Agora só a Clientes que guarda a lista da implantação, e a Implantação mostra "Listas da pasta Clientes".
- **M3** o card da implantação na Lixeira (ou arquivado) era reaproveitado escondido pelo fechamento. Agora volta, com comentário e auditoria.
- **B1** "Mover para" aceitava lista da Clientes e tirar o card da Implantação. Agora recusa os dois.
- **B2** o expurgo podia empacar nos mesmos 500 cards. Os cards ficam fora da consulta.
- **B4** o menu da tarefa não achava a lista da implantação (que saiu de `folders`), e Mesclar/Duplicar apareciam habilitados num card sem trilho.

Registrados, sem conserto:
- **B3** "apagar de vez" leva em cascata as horas (`WorkApontamento`) e as linhas de anexo; o arquivo do anexo fica órfão no armazém; as subtarefas vivas voltam ao topo. Está no comentário do código; as horas são dado de cobrança (por isso o expurgo nasce desligado).
- **B5** excluir, mesclar, duplicar e mover tarefa do comercial pelas rotas do Trabalho pedem `tarefas.editar`, não `leads.editar` (o PATCH antigo já tinha essa diferença).
- **B6** o filtro de pastas do vault da Equipe casa `20-Governanca` em qualquer nível (as regras de nota restrita continuam valendo).
- **B7** o "arquivada em" pela última `work.task.update` pode pegar tarefa editada depois de arquivada: por isso o script simula antes e mostra os ids.
- **B8** subpasta dentro da Clientes (hoje nenhuma, e criar é recusado) deixaria as tarefas dela em Todas.

## 6. [a decidir] e o que fica para o Rodrigo

1. **Donos das funções.** No cadastro único do código as 79 funções têm dono humano padrão (Pedro 47, Lucas 20, Rodrigo 12; das 77 não aposentadas, Pedro tem 45). Nenhuma está sem dono no cadastro; "sem dono" só acontece na hora de rodar, quando o primeiro nome não casa com ninguém da Equipe. A pergunta "todos os agentes vinculados a um sócio?" tem resposta sim; a distribuição (Pedro com 45 de 77) é a decisão "dono padrão por área", que continua dele.
2. **`nomeNoVault` de cada sócio** na produção: a Equipe sugere pelo primeiro nome e deixa em branco quando há dúvida. Preencher no `/perfil` de cada um com o nome como está no vault (Rodrigo, Lucas, Pedro) depois da subida; sem isso a seção do vault diz que falta a ligação.
3. **Expurgo da Lixeira**: a rotina nasce desligada. Ligar em `/rotinas` apaga de vez o que está há mais de 30 dias na Lixeira, com as horas lançadas nessas tarefas (B3).
4. **Redimensionar a foto no servidor** pede biblioteca de imagem (dependência nova). Hoje a tela reduz e o servidor confere.
5. **Fotos substituídas** ficam guardadas (`substituidaEm`); decidir se e quando saem.
6. **Credencial gravada de Asana, OFX ou Zapier** na produção: não foi lida daqui. Conferir com `SELECT conector FROM "SegredoDeConector" WHERE conector IN ('asana','ofx','zapier') AND "revogadoEm" IS NULL;` (só o nome do conector).
7. **Cards da Clientes na Caixa** ("Minhas tarefas"), na cobrança de tarefas paradas (TR-07) e nas listas de destino das Atas: continuam aparecendo (o roteiro listou árvore, Todas, contadores e Dia a dia; as Atas o Rodrigo mandou não mexer).
8. **Lead criado pela proposta** nasce em Qualificação sem dono: ganhar dono automático?
9. **Excluir o card da implantação** é permitido pela tela (some da Implantação até restaurar ou até o lead fechar de novo).
10. **Mesclar**: horas, reuniões, fontes de contexto e delegações ficam na origem arquivada.
11. **Editar o nome da pessoa pelo perfil** ficou de fora de propósito (a Equipe agrupa contas pelo nome).
12. Pendências que já estavam: as das RESULTADO-PRODUCAO-22 §6, 21, 21B e AGENTES.

## 7. Para publicar (orquestrador do Mac)

Imagem a partir da tag **`producao-22b-20261022`**, que contém `producao-22-20261022`. **A produção 22 sobe antes** (a política 1.12.0 e a migration dela, RESULTADO-PRODUCAO-22 §7); esta rodada não pede nada além dela na política. A sequência é a da cadeia de releases (`docs/comercial/VIRADA-PRODUCAO.md`).

1. **Política: nada.** Nenhuma capacidade nova nem mudada; o boot continua dizendo 83 capacidades e 33 com efeito ligado (conferido nas duas stacks).
2. **Migrations** (o `migrate deploy` do container aplica, nesta ordem). **Todas aditivas**:
   - `20261022200000_trabalho_icone_e_cor`: `icone` e `cor` (texto nulo, CHECK de tamanho) em `WorkList` e `WorkFolder`;
   - `20261022205000_trabalho_pasta_do_comercial`: `doComercial` (booleano, padrão falso) em `WorkFolder` e `WorkList`, e **a marcação**: dois UPDATE idempotentes que marcam a pasta de topo chamada Clientes **que guarda a lista Onboarding de cliente** e as listas dela. Na produção isso é a pasta Clientes com Esteira de clientes, Onboarding de cliente e Execução (na 3030, cópia de 19/10: `Clientes|t|3|3`). **A marcação das listas da implantação é esta migration, não um script**;
   - `20261022210000_trabalho_lixeira`: `WorkTask.excluidaEm`, `WorkTask.excluidaPor` (nulos) e o índice `(orgId, excluidaEm)`;
   - `20261022215000_proposta_do_lead`: tabela `PropostaDoLead` (empresa, RLS FORCE, quatro policies, grant ao `mktos_app`, conferência que aborta a migration);
   - `20261022220000_usuario_perfil`: sete colunas nulas em `User` (apelido, cargo, cidade, fuso, `dataNascimento`, `nomeNoVault`, `perfilAtualizadoEm`) e a tabela `FotoDePerfil` (RLS FORCE, FK composta com `User`, CHECK de 256 KB).
   Ensaiado na 3030 (cópia da produção de 19/10): 114 → 119 migrations, 202 tarefas, 19 leads, 18 `Partner`, 8 usuários, 19 listas, 5 pastas e 84 status antes e depois.
3. **Variáveis novas: nenhuma. Permissões novas: nenhuma** (não rode `db:sync-permissions`).
4. **Os 4 cards da Implantação que o Rodrigo arquivou em 21/10 (~19:56 BRT).** Duas opções; a primeira é a do roteiro:
   - **Pelo script, no container da api, depois da subida:**
     ```bash
     # a lista "Onboarding de cliente" da empresa root (só o id):
     docker exec <db> psql -U <usuário> -d <banco> -tAc "SELECT l.id FROM \"WorkList\" l JOIN \"Org\" o ON o.id = l.\"orgId\" WHERE o.slug = 'root' AND l.name = 'Onboarding de cliente'"
     # 1) simular (padrão):
     docker exec -w /app/apps/api <api> node dist/scripts/restaurar-tarefas.js --org root --lista <id> --arquivadas-de 2026-10-21T22:30Z --arquivadas-ate 2026-10-21T23:10Z --como <e-mail do Rodrigo>
     ```
     **Conferir**: `noIntervalo: 4` e os ids curtos `45eed525`, `5ca81e97`, `ee277cf5`, `57886cd3` (nada mais; o card `dd3e2d66` criado às 20:13 não está arquivado e não entra). Se aparecer outro id, ou faltar um, pare: a regra do "arquivada em" (§2) pode ter pegado uma edição posterior (B7), e a Lixeira resolve à mão.
     ```bash
     # 2) valer:
     docker exec -w /app/apps/api <api> node dist/scripts/restaurar-tarefas.js --org root --lista <id> --arquivadas-de 2026-10-21T22:30Z --arquivadas-ate 2026-10-21T23:10Z --como <e-mail do Rodrigo> --valer
     # 3) de novo, simular: tem de dar zero ("Zero a fazer.")
     ```
     Esperado: `4 tarefa(s) restaurada(s) (auditoria work.task.restore)`, os 4 cards de volta em Comercial › Implantação na etapa em que estavam (Kickoff marcado, Contexto carregado, Kit montado, Kit montado). Ensaiado na 3031 com tarefas fictícias: simular 2, valer 2, valer 0, simular 0.
   - **Ou pela Lixeira** (engrenagem › Lixeira › Tarefas › Arquivadas): marcar os 4 e Restaurar. O Rodrigo pode fazer sozinho.
5. **Passos de dado: nenhum além do item 4.** Depois da subida, cada sócio preenche o próprio "Nome no vault" no `/perfil` (Rodrigo, Lucas, Pedro, como estão em `20-Governanca/`), ou o admin preenche pelos três; sem isso a Equipe diz que falta a ligação.
6. **Comportamento que muda na subida (avisar):**
   - a pasta Clientes some da árvore do Trabalho, de Todas, dos contadores e do Dia a dia (os cards continuam em Comercial › Implantação; Esteira e Execução abrem pela linha "Listas da pasta Clientes" na Implantação);
   - "Excluir" passa a mandar para a Lixeira (30 dias, restaurável); o "Arquivar" de sempre continua;
   - a primeira abertura da Lixeira cria a rotina "Expurgo da Lixeira (30 dias)" **desligada** em `/rotinas`;
   - o responsável aparece só como avatar (nome no balão); quem não tem foto aparece pelas iniciais;
   - Integrações sem Asana, Extrato OFX e Zapier; Granola e WhatsApp (Evolution) com "Configurar";
   - o card da implantação que estiver arquivado ou na Lixeira volta sozinho se o lead fechar ou for iniciado de novo (com comentário).
7. **Rollback só de imagem: possível.** As colunas novas são nulas ou têm padrão e as tabelas novas são ignoradas pela imagem anterior. Com a imagem anterior, a pasta Clientes volta a aparecer na árvore e a tarefa excluída fica como arquivada (excluir também arquivou). Foto, vínculos de proposta e ícones ficam guardados.
8. **Conferências na produção depois:**
   - o log de arranque sem erro, com 83 capacidades e 33 com efeito;
   - menu lateral: recolher na logo; clicar de novo em Trabalho fecha as subseções;
   - engrenagem ao lado do nome: Perfil, Lixeira, Registro de ações, Configurações;
   - Trabalho: sem a pasta Clientes; o "⋯" só no hover; ícone numa lista de teste (e tirar);
   - Comercial › Implantação: os 4 cards de volta (item 4), o card `dd3e2d66` e a linha "Listas da pasta Clientes";
   - botão direito numa tarefa: as 8 ações; "Abrir no centro";
   - Funil vivo em lista: largura, ordenação e colunas; Propostas com o lead na primeira coluna e "Aparelhos da equipe" acima da lista;
   - `/perfil`: a foto de cada sócio (opcional) e o "Nome no vault"; Equipe com o que cada um conduz e as funções;
   - Conexões: sem Asana, OFX e Zapier; a credencial gravada desses três, se houver (§6 item 6).

## 8. Apagar depois

Ninguém apagou nada nesta rodada. Herda as listas das RESULTADO-PRODUCAO-22, 21, 21B e AGENTES, mais:

- Imagem `rootos-final-app:producao22b-a` (intermediária, sem a lane E nem a revisão) e as sem tag dos builds; `rootos-final-app:producao22` fica como reserva até a virada.
- Bancos de teste no Postgres 5440 (fictícios): `rootos_p22b_a_test`, `rootos_p22b_b_test`, `rootos_p22b_c_test`, `rootos_p22b_c_test_rls`, `rootos_p22b_d_test` (e o `_rls` que a lane D criou), `rootos_lanee_i6_test`, `rootos_p22b_full_test`, `rootos_p22b_full_test_rls`; nos bancos de teste também as empresas `dbg…` e `semente-sf…` da depuração do `comercial-seed`.
- `C:\Users\User\dev\scratch-p22b\`, `C:\Users\User\dev\scratch-p22b-laneb\`, `C:\Users\User\dev\tmp-lanef\`, `C:\CSSA\trabalho\lanec\` (rascunhos e logs das lanes, sem segredo).
- Worktrees desta rodada em `.claude/worktrees/` (branches `producao-22b/*` e `worktree-agent-*`, integradas).
- Na 3031 (fictício): listas, tarefas, cópias e mescladas "e2e 22b …", as duas listas "e2e 22b restaurar …" da prova do script, a foto e a data de nascimento do admin e de "Lucas (exemplo)", o "Nome no vault" de três pessoas, os dois vínculos de proposta e o vault-dublê (com o `.git`) no volume `rootos-final-seed_rootos_final_seed_vault`.
