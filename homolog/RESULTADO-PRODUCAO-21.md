# RESULTADO da rodada de produção 1 (21/10/2026)

> Roteiro: `docs/comercial/RODADA-PRODUCAO-20261021.md` (a ata do Rodrigo de 21/10, olhando a produção, e o pedido de usar a Evolution no lugar do DigiSac).
> Branch `homolog/final-20261019`, sobre a tag `interface-todas-20261020` (o que roda em produção desde 20/10 23:10). Tag desta rodada: `producao-21-20261021`. Bundle delta: `C:\Users\User\dev\producao21-delta.bundle` (`homolog/final-20261019` e a tag, `^interface-todas-20261020`).
> Só homologação, no Predator. **Nada foi à produção** e o importador não rodou lá. Este arquivo não tem dado de cliente nem segredo: só contagens.

## 1. Os pedidos da ata

| # | Pedido | O que foi feito | Onde |
|---|---|---|---|
| 1 · P1 | "Carga por prazo" e "Tarefas por lista" cabem na caixa, sem rolagem lateral, balão dentro | Saiu o `overflow-x-auto` dos quadros. As colunas dividem a largura e o nome quebra em até duas linhas; abaixo de 64 px por coluna o gráfico vira barras horizontais e cresce para baixo. Um balão por gráfico, posicionado por conta (`posicaoDoBalao`: em cima, à direita, à esquerda, embaixo ou dentro, sempre preso à caixa). Mouse abre no hover, teclado no foco, Esc fecha; no toque, o primeiro toque abre, tocar fora fecha, o segundo navega. "Tarefas por pessoa" ficou como estava | `apps/web/src/components/tarefas/graficos.tsx`, `VisaoGeralDasTarefas.tsx` |
| 2 · P2 | Agenda por semana, boa no celular | Mês · Semana · Dia no endereço (`?visao=&dia=`), setas e Hoje. Semana em grade 07h a 22h com rolagem vertical própria e os eventos de dia inteiro no topo; abaixo de 640 px, lista por dia. Mesma fonte de eventos, com o intervalo da visão; a API não mudou. O Mês também passou a ler dia e hora em São Paulo | `apps/web/src/app/agenda/` (`semana.ts`, `GradeDaSemana.tsx`) |
| 3 · P3/P5 | CRM sai do Trabalho; leads no Funil vivo, contratos em Contratos vivos | O importador (§3) leva os cartões ao Comercial e arquiva a pasta CRM e as duas listas (`arquivadaEm`, fora da árvore, de Todas e dos contadores; os dados ficam) | `apps/api/src/comercial/importador-crm/`, `apps/api/src/work/arquivadas.ts` |
| 4 · P5 | Sem pasta › Marketing e Teste teste saem; Operação fica | Etapas da limpeza no importador: a tarefa real vai a Demandas internas / Marketing › Demandas gerais e a lista vazia é ARQUIVADA; os 3 cartões e a lista Teste teste, arquivados. Comercial, Operação e a lista solta de teste ficam (ela vai às sobras: o Rodrigo decide) | importador |
| 5 · P3 | Gestão com Administrativo, Financeiro e Pessoas; Clientes com Esteira, Onboarding e Execução | `ESTRUTURA_SUGERIDA` nova; a Administrativa saiu do desenho e nunca é recriada; lista SOLTA de mesmo nome é movida para a pasta sugerida (mesmo id); arquivadas não contam; abrir o card da implantação só cria Clientes. Excluir pela tela: lista vazia ou toda arquivada, com o nome escrito; "Arquivar todas as N tarefas" antes; pasta vazia; tudo auditado e só de gente | `apps/api/src/work/estrutura-sugerida.ts`, `work.service.ts`, `ExcluirDaArvore.tsx` |
| 6 · P4 | Recolher os status vazios, na tela e nos Filtros, para a vista salva | Botão "Ocultar status vazios" com a contagem ("12 vazios ocultos"), o mesmo no painel de Filtros (`?vazios=ocultar`), a vista salva leva. Vale em Todas, no quadro da lista e na Implantação. Ao arrastar, as vazias voltam como destino | `TrabalhoView.tsx`, `packages/shared/src/vistas.ts` |
| 7 · P6 | Implantação vazia, datas esquisitas, agentes que não aparecem, sugestões | Diagnóstico (§4). Cartão com "na etapa há N d" (de `statusDesde`) e a próxima data real em `dd/mm`, com o dia da semana no balão, em São Paulo; sem data, nada. Painel com "Quem trabalha nesta etapa" (leitor de ata, pesquisador de conta, roteirista do kickoff e o relógio): o estado, o último fato neste cliente e o que vem a seguir, só leitura. Sete sugestões em `docs/comercial/SUGESTOES-IMPLANTACAO.md` | `apps/web/src/lib/datas-do-cartao.ts`, `QuemTrabalhaNaEtapa.tsx`, `onboarding/trilho/quem-trabalha.ts` |
| 8 · P7 | Atas do vault, do Granola e de uma pasta do Drive; atas e transcrições; busca; duas colunas | Lista única com vault, coladas, Granola (cada reunião é transcrição, lida na hora, nunca gravada) e a pasta do Drive (nota `trabalho.atas.drive`, escrita pelo `MemoriaService`, lida SÓ pela porta). Tipo ata ou transcrição, busca por palavra e por intervalo de datas no endereço, a mais nova primeiro. Desktop: a página não rola, a lista tem a altura da janela e rola sozinha; celular: lista e detalhe separados com Voltar | `apps/api/src/work/atas/`, `apps/api/src/google/drive-das-atas.ts`, `AtasView.tsx` |
| 9 · P5 | Painel geral, Propostas e Rodada da semana ficam e refletem os importados | Sem mudança de tela; o Painel geral lê o que o importador gravou (o `cliente.ativo` importado leva a data do contrato, para não contar negócio velho como desta semana) | |
| 10 · P8 | WhatsApp pela Evolution no lugar do DigiSac | §5 | `apps/api/src/pauta/evolution.service.ts`, `gateway/canais/evolution.port.ts`, `ConexaoEvolution.tsx` |
| 11 · P9 | A sala: quando ela entra | Aba Sala com a linha do tempo real (sala criada e por qual fato, link entregue por qual mensagem e provedor ou "não entregue: WhatsApp simulado", versão publicada, versão na porta com o link para Aprovações, última visita), "Copiar link da sala" (só `leads.editar`, só gente, `no-store`, auditoria `sala.link.copiado` sem o token) e o texto de ajuda pedido | `apps/api/src/comercial/sala-estado.*`, `AbaSala.tsx` |

**A explicação da sala para o Rodrigo** (o orquestrador leva): a sala nasce quando o lead entra (ou quando o OS prepara a primeira mensagem ou a agenda); o cliente só a vê se uma mensagem do WhatsApp levar o link, e hoje o WhatsApp da produção é o simulado, então nenhum link saiu. O que se publica na aba Sala vai à porta (R3) e só aparece para o cliente depois que outra pessoa libera em Aprovações. Até o WhatsApp ser ligado, o "Copiar link da sala" permite mandar o link por outro canal.

## 2. Decisões tomadas nesta rodada

- **O importador e a tela ARQUIVAM, não apagam, o que tem dado.** Lista vazia excluída pela tela é apagada; lista ou pasta que guarda tarefa arquivada é arquivada (a FK das tarefas é RESTRICT, e arquivado é dado que fica). No importador, a lista Marketing solta, a Teste teste, as duas do CRM, a pasta CRM e a Administrativa vazia são arquivadas.
- **Importar fato passado não é ato comercial novo** (registrado no `CLAUDE.md`, Leads, como decisão do dono do produto): sem porta, sem aprovação, sem mensagem, sem cobrança.
- **Implantação**: cliente em Kickoff ganha o card em "Kickoff marcado"; em Implantação, em "Kit montado" (o modelo não tem etapa chamada Implantação; é a primeira depois do kickoff). Recorrente e Depoimento ficam só com o contrato vivo, sem card.
- **Contrato vivo importado**: um por cliente, com a lista dos contratos importados dentro; sem parcela, sem régua e sem o marco do dia 15.
- **Evolution**: o HTTP fica em `pauta/evolution.service.ts` (a catraca de credenciais só deixa esse arquivo ler `EVOLUTION_*`; nenhuma exceção aberta). A entrada só aceita a mensagem com a instância da empresa no corpo.
- **Drive**: a leitura de arquivo (Documento, PDF com texto, .txt e .md) precisou de uma capacidade nova R0, `contexto.arquivo.ler`, porque a existente só lê Documento e gravava o texto cru no registro da porta; a nova devolve o texto como sigiloso (o registro guarda hash e tamanho).

## 3. O importador do CRM (P5)

`node dist/scripts/importar-crm.js` (compilado, dentro da imagem). Padrão `--simular`; escreve só com `--valer`; `--org` obrigatório; `--como <e-mail>` obrigatório para `--valer` (pessoa ativa, relida no banco, com `leads.editar` e `tarefas.editar`, conta de máquina recusada); `--detalhe <arquivo>` recusa caminho dentro de repositório git e grava com modo 600; `--web <origem>` para o link dos comentários (sem ele, `WEB_ORIGIN`). O console só tem contagens. Antes de subir o Nest, o script desliga as tarefas de fundo e a varredura de arranque do teto de IA (para não zerar as reservas em voo da API viva). Conta os efeitos externos (mensagens, aprovações, cobranças, documentos, salas, salas publicadas, contratos do Financeiro, reações, decisões) antes e depois e sai com código 3 se algum mudar.

**Prova no banco descartável** `producao21_ensaio_test` (a cópia da produção de 19/10, `producao-root-20261019b.dump`, + as 99 migrations da tag + a migration nova; antes, para espelhar a produção de 21/10, a pasta Administrativa vazia e um lead criado à mão igual a um cartão em Followup):

| Etapa | simular | valer | valer de novo | simular |
|---|---|---|---|---|
| estrutura (Pessoas, Clientes e as 3 listas, Administrativo e Financeiro movidas) | 7 | 7 | 0 | 0 |
| leads criados / reaproveitados | 11 / 1 | 11 / 1 | 0 | 0 |
| fato, dono e etapa do lead | 12 / 12 / 12 | 12 / 12 / 12 | 0 | 0 |
| `Partner` cliente / `cliente.ativo` | 5 / 5 | 5 / 5 | 0 | 0 |
| contratos importados | 6 | 6 | 0 | 0 |
| trilho / card da implantação | 3 / 3 | 3 / 3 | 0 | 0 |
| comentário / cartão arquivado | 18 / 18 | 18 / 18 | 0 | 0 |
| listas / pasta do CRM arquivadas | 2 / 1 | 2 / 1 | 0 | 0 |
| tarefa de Marketing movida / lista arquivada | 1 / 1 | 1 / 1 | 0 | 0 |
| Teste teste: cartões / lista arquivados | 3 / 1 | 3 / 1 | 0 | 0 |
| Administrativa arquivada | 1 | 1 | 0 | 0 |

Total: 123 a fazer, 123 feitos, 0 e 0. Uma sobra (a lista solta de teste), nenhum erro. Os contadores de efeito externo ficaram iguais antes e depois de cada passada; reações do comercial, zero.

**Conferido nas telas**, com a API da 3030 apontada por alguns minutos para o ensaio já importado e neutralizado (`neutralizar-copia.mjs`: senhas trocadas, credenciais anuladas, rotinas desligadas) e depois devolvida ao banco dela: `final.mjs` **17/17** (Painel geral, Funil, Propostas, Lista de leads, Visão geral, Trabalho, sem rolagem a 390 px). Pela API, o que as telas recebem: Funil com 2 em qualificação, 5 em follow-up e 5 fechados; Contratos vivos 5 (os 5 com o aviso de importado); Implantação 3 cards (1 em Kickoff marcado, 2 em Kit montado); a pasta CRM e a Administrativa fora da árvore; Gestão com Administrativo, Financeiro e Pessoas. Fotos com dado real em `homolog/organizar/producao21-ensaio/` (fora do git).

Testes: `comercial-importar-crm` 13/13 com fixture sintética (cada status, contrato filho, lead duplicado por CNPJ e por nome, status desconhecido, cliente com dois contratos, as limpezas, segunda passada sem mudança e nenhum efeito externo).

## 4. Por que a Implantação aparecia vazia (P6)

O card da implantação só nasce por três caminhos: o fechamento, "Registrar cliente já fechado" e "Iniciar onboarding". Nenhum cliente da produção passou por eles: os clientes estão como cartões na lista "Gestão de Leads" do CRM antigo. Os agentes (leitor de ata, pesquisador de conta, roteirista do kickoff) só agem quando alguém entrega uma ata ou pede um dossiê no trilho, e nada na tela os mostrava. As datas pareciam esquisitas porque os formatadores usavam o fuso do navegador, e a data do trilho gravada à meia-noite UTC caía no dia anterior. O importador cria os cards (com trilho) dos clientes em Kickoff e Implantação; o cartão passou a dizer há quantos dias está na etapa e a próxima data real; o painel mostra quem trabalha na etapa. A próxima reunião do cliente na Agenda ficou de fora: não há jeito barato, por cartão e pela porta, de ler a agenda (é a sugestão 1 do documento de sugestões). Os trilhos importados começam na fase 0, mesmo com o cliente já no kickoff (sugestão 2).

## 5. WhatsApp pela Evolution (P8)

- Envio 1:1 ao lead (botões e formulário como texto numerado), criar grupo e enviar no grupo, estado da instância e QR, com endereço, chave e instância no cofre por empresa (conector `evolution`); `EVOLUTION_*` só como reserva da empresa da casa.
- Regra de endereço contra SSRF: domínio público só em https; nome sem ponto (rede do Docker) e rede privada só para a casa; IP literal nunca; loopback só em teste; link-local e loopback recusados também depois de resolver o nome; redirecionamento não é seguido.
- Entrada: o webhook do canal de aprovação (mesmo segredo, 404 sem ele) desvia a conversa 1:1 de quem é lead para o comercial, por registro, e só com a instância da empresa no corpo.
- Integrações: cartão "WhatsApp (Evolution)" com estado, Gerar QR (imagem e código de pareamento), Revogar e a URL do webhook; a chave nunca volta à tela. O DigiSac saiu da tela; o código fica e `WHATSAPP_PROVEDOR=digisac` segue aceito. O padrão segue `simulado`.
- **Na produção**: a Evolution da Root responde na rede interna do Docker. URL interna sugerida: `http://root_evolution:8080` (aceita só para a empresa da casa). Webhook da instância: `https://os.operacaoroot.com/api/approvals/canal/whatsapp/<orgId>`, cabeçalho `x-canal-segredo`, evento `MESSAGES_UPSERT`. A instância é a mesma do canal de aprovação.
- Pesquisa (21/10): rotas conferidas no código-fonte do `EvolutionAPI/evolution-api` (`src/api/routes/group.router.ts`, `src/validate/group.schema.ts`, `src/validate/message.schema.ts`, `whatsapp.baileys.service.ts`): `POST /group/create/{instância}` com `{subject, participants, description?}` devolve o metadata do grupo (`id` em `@g.us`); `POST /message/sendText/{instância}` com `{number, text}`; `GET /instance/connect/{instância}` devolve `{pairingCode, code, base64, count}`; `GET /instance/connectionState/{instância}` devolve o estado `open`, `connecting` ou `close`. Cabeçalho `apikey`. Nenhuma conta, número ou ferramenta do escritório Cardozo & Saggioro foi usada; toda prova é com dublê.
- Testes: `comercial-canal-evolution` 23/23 (dublê HTTP), `conexao-evolution` 6/6.

## 6. Provas

**Suítes** (Postgres descartável na 5440, política semeada):

| Suíte | Resultado |
|---|---|
| API inteira | 4962 casos, 4623 verdes, 304 vermelhos, 35 pulados. Todos os vermelhos em arquivos da linha de base (`homolog/final/suites.md` §4 e RESULTADO-INTERFACE). Três arquivos fora da lista, todos de ambiente: `comercial-seed` (1, depende do relógio, vermelho também no código da base), `marketing-preparacao` (1, as permissões não estão sincronizadas no banco de teste) e `pauta-youtube` (1, passa 17/17 sozinho) |
| Web inteira | 1559 casos, 1483 verdes, 76 vermelhos, todos nos 9 arquivos da linha de base (agentes, conexões, financeiro, pauta) |
| Política | 102/102 (101 + o caso da capacidade nova) |
| Isolamento | nenhuma tabela nova nesta rodada (`FILHOS_COM_ORGID_REDUNDANTE` não mudou); as duas migrations são uma coluna nula em tabela que já tem RLS FORCE e um CHECK |
| `tsc` | limpo na API e no web; na configuração de teste da API, 107 erros, os mesmos 107 com e sem esta rodada (em 12 arquivos de teste que ela não toca) |
| Novas da rodada | API: `work-arquivadas` 6, `work-estrutura-sugerida` 11, `work-hierarquia` (+1, só gente), `comercial-importar-crm` 13, `onboarding-quem-trabalha` 3, `comercial-canal-evolution` 23, `comercial-sala-estado` 8, `trabalho-atas-fontes` 16, `texto-do-pdf` 11. Web: `graficos-cabem` 18, `agenda-semana` 7, `trabalho-vazios-e-excluir` 16, `producao21-implantacao` e `datas-do-cartao` 28, `conexao-evolution` 6, `trabalho-atas-fontes` 10, `comercial-aba-sala` 7 |

**Roteiros e2e** (imagem `rootos-final-app:producao21c`):

| Roteiro | Onde | Resultado |
|---|---|---|
| `producao21.mjs` (novo) | seed, 3031 | **PASSA, 13 passos, 25 s**: Visão geral a 1440 e a 390 (toque) sem rolagem lateral e com o balão da primeira e da última coluna dentro da caixa; Agenda Semana no endereço, setas e Hoje, lista por dia a 390; Todas com "Ocultar status vazios" (16 colunas, 12 vazias, 4 depois, "12 vazios ocultos") e a vista salva com `vazios: ocultar`; o menu da lista com "Excluir lista"; Implantação com "na etapa há N d" e "Quem trabalha nesta etapa"; Atas com a página parada e a lista rolando sozinha, busca por palavra e por data no endereço, celular com Voltar; Integrações com a Evolution e sem o DigiSac; aba Sala com o estado, a ajuda e o link na área de transferência. Fotos `homolog/provas/producao21-*.png` (escuro, claro e 390 px) |
| `interface.mjs` | seed, 3031 | **PASSA, 17 passos** |
| `painel.mjs` | seed, 3031 | **PASSA, 13 passos** (a espera da tela de Atas no celular foi ajustada: com `?ata=` o detalhe é tela própria) |
| `trabalho.mjs` | seed, 3031 | **13 passos verdes até o T8**, que pede um contrato vivo ativo: os 10 da 3031 já foram concluídos por passadas anteriores, e a jornada que cria um novo só roda depois das 10h de São Paulo |
| `implantacao.mjs` | seed, 3031 | **não rodou**: a jornada exige rodar depois das 10h de São Paulo ("o primeiro horário oferecido está a 31,2 h") |
| `final.mjs` | cópia, 3030 | **17/17** (fotos fora do git em `homolog/organizar/producao21-final/`) e, sobre o ensaio importado, 17/17 (§3) |

**As stacks** (imagem nova sem perder dado, `up -d --no-build api web`, política semeada com a capacidade nova): `rootos-final` (3030) com 202 tarefas, 19 leads, 18 `Partner`, 8 usuários, 19 listas, 5 pastas e 84 status antes e depois (migrations 99 → 101); `rootos-final-seed` (3031) com 71, 46, 11, 5, 10, 9 antes e depois. **O organizador em `--simular` na 3030 depois da imagem nova: zero mudanças** (pastas e listas a criar 0, listas e tarefas a mover 0, leads a criar 0; 19 leads e 71 tarefas já no lugar). Durante a troca, um erro meu: o shell tinha as variáveis do `.env.final` exportadas e elas venceram o `--env-file` da stack do seed, que tentou recriar o banco do seed na porta da 3030; a porta foi recusada e nada subiu errado. A stack do seed foi recriada num ambiente limpo, com o mesmo volume e as mesmas contagens.

**Revisão adversarial** (curta, só leitura, sobre o diff da tag até aqui): importador idempotente e sem efeito externo, sem dado no console, `--detalhe` fora do git, `--como` só de gente; link da sala só `leads.editar`, só gente, sem o token na auditoria; Drive só pela porta, arquivo fora da pasta recusado, texto não gravado; nenhum segredo nem dado real no diff (o único nome de produção, uma lista citada no roteiro, foi trocado). **Três a corrigir, corrigidos com teste:** excluir lista, excluir pasta e arquivar todas aceitavam conta de máquina (`ia_acao` tem `tarefas.editar`), agora só gente, pelo token e relido no banco; a entrada da Evolution aceitava mensagem sem a instância (com o segredo do processo, uma empresa injetaria mensagem em outra), agora exige a instância; o leitor de PDF tinha regex quadrática, árvore de páginas sem visitados e nenhum teto total de descompressão (um PDF montado travaria a API), agora com teto de leitura, visitados e 64 MB por documento. De quebra: a varredura de arranque do teto de IA não roda no script, o detalhe é gravado com modo 600 e o log da Evolution leva só o status. **Achados do e2e, corrigidos com teste:** no celular de verdade o primeiro toque numa coluna do gráfico já navegava (o navegador emula `mouseenter` antes do `click`); na tela de Atas, trocar "de" e "até" em sequência deixava a resposta mais velha mandar na lista.

## 7. Para publicar (orquestrador do Mac)

1. **Migrations novas** (aplicadas pelo `migrate deploy` do container):
   - `20261021100000_trabalho_arquivadas`: `WorkFolder.arquivadaEm` e `WorkList.arquivadaEm`, colunas nulas em tabelas com RLS FORCE.
   - `20261021140000_ata_sugestao_ref_do_drive`: só troca o CHECK de `AtaSugestao.ataRef` para aceitar `drive:`.
2. **Capacidade nova**: `contexto.arquivo.ler`, R0, conector `drive`, delta da política 1.9.0 → 1.10.0. **Antes da subida**, `db:seed:politica` com a assinatura de capacidade nova, por exemplo `POLITICA_CAPACIDADE_NOVA_AUTOR='<quem responde>'` e `POLITICA_CAPACIDADE_NOVA_MOTIVO='Produção 21/10: contexto.arquivo.ler (R0) para ler as atas da pasta do Drive pela porta'`. Sem o seed, a porta recusa a leitura do Drive como R5 (o resto funciona).
3. **Variáveis novas para o `final.env`: nenhuma.** As da Evolution já estão no compose (`EVOLUTION_*`, `WHATSAPP_PROVEDOR`, `CANAL_APROVACAO_*`). `WHATSAPP_PROVEDOR` fica `simulado` até o Rodrigo ligar o número da Root em Integrações › WhatsApp (Evolution), com a URL interna `http://root_evolution:8080`, a chave e a instância.
4. **O importador na produção**, dentro do container da API, depois da imagem nova no ar (substitua `<api>` pelo nome do container e `<e-mail>` pelo do Rodrigo; o detalhe fica no servidor, fora de repositório, e tem dado de cliente):
   ```bash
   docker exec -w /app/apps/api <api> node dist/scripts/importar-crm.js --org root --como <e-mail> --detalhe /tmp/importar-crm-simular.md
   # conferir as contagens e o /tmp/importar-crm-simular.md com o Rodrigo.
   # "leads.reaproveitados" tem de ser 1 (o lead criado à mão em 21/10 casa com o cartão);
   # se vier 0, o nome do lead não casa com a empresa do cartão e haveria duplicata: pare.
   docker exec -w /app/apps/api <api> node dist/scripts/importar-crm.js --org root --como <e-mail> --valer --web https://os.operacaoroot.com --detalhe /tmp/importar-crm-valer.md
   docker exec -w /app/apps/api <api> node dist/scripts/importar-crm.js --org root --como <e-mail> --detalhe /tmp/importar-crm-depois.md
   # o último tem de dizer "Zero a fazer". Saída 3 = algum efeito externo contado a mais: pare e confira.
   ```
   Rode num momento quieto (se alguém aprovar algo na fila durante a passada, o contador de efeitos muda e o script sai com 3). Depois da conferência, o Rodrigo decide apagar os `/tmp/importar-crm-*.md`.
5. **Conferir na produção depois**: Funil vivo, Lista de leads, Contratos vivos (o aviso "Contrato importado do CRM antigo · anexar o PDF"), Painel geral, Implantação (os cards de Kickoff e Implantação) e Trabalho (sem a pasta CRM e sem a Administrativa; Gestão com Administrativo, Financeiro e Pessoas; Sem pasta sem Marketing e Teste teste).

## 8. [a decidir]

- **A lista solta de teste** (1 tarefa): ficou, nas sobras do importador. O Rodrigo decide.
- **Número novo pela Evolution não vira lead**: a entrada só leva ao comercial quem já é lead. A instância é a mesma do canal de aprovação.
- **O segredo do webhook é do processo, não da empresa**: uma empresa cliente precisaria do segredo do servidor para ligar a própria instância (conserto sugerido: segredo por empresa, HMAC do global com o `orgId`).
- **QR da Evolution fora da porta**: sai só para `admin.usuarios` e não é guardado; se quiserem RASTRO, é uma capacidade R0 nova.
- **Remetente `@lid`** não é desviado ao comercial (o número real vem em outro campo).
- **Abrir a transcrição do Granola pede só `tarefas.ver`**, como ver a lista de reuniões; se a transcrição for mais sensível, a permissão sobe.
- **O Drive real não foi provado**: tudo com dublê. A lista traz até 50 arquivos por busca.
- **Desarquivar pasta ou lista** ainda não tem tela.
- **Os trilhos importados começam na fase 0** (sugestão 2 do documento de sugestões); o relógio do onboarding vai registrar "sem próximo passo" para eles, só internamente.
- **Duas passadas do importador ao mesmo tempo** duplicariam linhas de auditoria (não há cadeado da passada inteira); a produção roda uma só, pelas mãos do orquestrador.
- **Revinculação de DNS** entre a conferência do endereço e a chamada à Evolution segue aberta, como em `pagina-publica.ts`; faltam também algumas faixas IPv6 (64:ff9b::/96, 2002::/16, fec0::/10).
- **O leitor de PDF lê na thread da API**: com os tetos novos ele termina, mas um PDF grande ainda ocupa a thread enquanto lê; e o download do Drive é lido inteiro antes do teto.

## 9. Apagar depois

Ninguém apagou nada nesta rodada. Herda a lista da `RESULTADO-TODAS`, mais:

- Imagens `rootos-final-app:producao21a` e `rootos-final-app:producao21b` (antes das correções); depois da virada, `rootos-final-app:todas2`.
- Bancos de teste no Postgres 5440 (fictícios): `rootos_p21_test`, `rootos_p21_a_test`, `rootos_p21_b_test`, `rootos_p21_c_test`, `rootos_p21_d_test`, `rootos_p21_full_test`.
- O banco `producao21_ensaio_test` no Postgres da `rootos-final` (5443): **dado real da cópia de 19/10, importado e neutralizado**.
- `C:\Users\User\dev\scratch-p21\` (logs, o `env.ensaio` com as senhas da homologação e os `--detalhe` do importador, **com dado real**) e `C:\Users\User\dev\scratch-p21-*.txt|log`.
- `homolog/organizar/producao21-final/` e `homolog/organizar/producao21-ensaio/` (fotos e placares com dado real; fora do git).
- Worktrees dos agentes desta rodada em `.claude/worktrees/` (branches `worktree-agent-*` integradas).

Para voltar: `rootos-final-app:todas2` segue no Docker. Troque a tag nos dois `docker-compose.final*.yml` e rode `up -d --no-build api web` **num shell sem as variáveis de outra stack exportadas**.
