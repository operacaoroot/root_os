# Leva 5 · L4 (painel do lead enxuto) + L2 (botão direito no lead) + L5 (funil fluido)

> Roteiro: `docs/comercial/RODADA-LEVA5-20261027.md`, lanes L2 (parte dos leads), L4 e L5. Branch `leva5/20261027`. Itens 7, 11, 14 e 16 da reunião de 26/10 (Rodrigo + Lucas + Pedro).
> Regra da casa: o conceito não muda, dado nenhum é apagado, cada lane tem desfazer. `mover.service.ts` e a regra de aprovação não mudaram; nenhuma permissão nova, nenhuma capacidade nova, nenhuma variável de ambiente nova.

## 1. O que mudou, por arquivo

### Contrato (shared)
| Arquivo | O que |
|---|---|
| `packages/shared/src/ficha-geral.ts` (novo) | O contrato da aba Geral e das pendências: `TIPOS_DE_PESSOA` (PJ/PF), a lista fechada `COMO_CONHECEU` (Indicação de cliente, Indicação de parceiro, BNI, Evento, Rede social, Site, Comunidade, Outro) com os rótulos e os três canais do C07 ainda legíveis (`ROTULO_DO_COMO_CONHECEU`, `CANAIS_ACEITOS_NA_FICHA`), `CAMPOS_DA_FICHA_GERAL` por cartão, `valoresDaFichaGeral`/`camposVazios` (a conta do "falta preencher", a mesma na tela e na API), `FichaGeralExtra` (o que a API devolve a mais), `FichaGeralPatchSchema` (o corpo do PATCH; recusa etapa e `proximaAcao*`), `PassoSugerido`/`PendenciasDoLead`, `NotaManualSchema`, a variante A/B (`CHAVE_DA_VARIANTE_DO_PAINEL = 'painel.variante'`, `lerVariante`). |
| `packages/shared/src/index.ts` | Append de uma linha: `export * from './ficha-geral.js'`. |
| `packages/shared/src/comercial.ts` | **Fora da minha lista; append mínimo**: o fato `'nota.manual'` no fim de `COMERCIAL_EVENTOS` (a nota que uma pessoa escreve no fio pela aba Pendências; sem reação). |

### Banco
| Arquivo | O que |
|---|---|
| `apps/api/prisma/schema.prisma` (só o model `ComercialFicha`) | Três colunas novas, nulas: `tipoDePessoa`, `preferenciasDeAtendimento`, `linkDaProposta`. |
| `apps/api/prisma/migrations/20261027020000_ficha_geral/migration.sql` (nova) | `ALTER TABLE "ComercialFicha" ADD COLUMN` das três, nulas. A tabela já tem RLS FORCE: coluna nova não pede policy. Aditiva; nada apagado. |

### API
| Arquivo | O que |
|---|---|
| `apps/api/src/comercial/eventos.ts` | `nota.manual`: fonte `pessoa`, payload `{ texto, feito, referencia, por, porId }` e o resumo no fio ("nota: …" / "feito à mão: …"). |
| `apps/api/src/comercial/ficha.service.ts` | `ajustarNegocio` aceita a lista nova de canais além da antiga (`CANAIS_ACEITOS_NA_FICHA`). Nada mais mudou: os fatos `identidade.editada`, `negocio.tipo_definido` e `negocio.ajustado` continuam o caminho desses campos. |
| `apps/api/src/comercial/pendencias-do-lead.ts` (novo, puro) | `passosDoLead`: a próxima ação da ficha, o que o portão da etapa pede, as decisões abertas, a **automação que não concluiu** (`ComercialReacao` em `erro`, o passo que travava o Rodrigo), os fatos de pendência do fio (`fechamento.escrita` em erro, `pasta.do_cliente`/`documento.na_pasta` em erro, `cliente.a_conciliar` até o cliente ficar ativo). Cada passo tem chave; a `nota.manual` com `feito = chave` **posterior** ao passo o esconde (o passo que nasce de novo volta). Cada passo diz para onde o "fazer" leva (aba, campo ou endereço). |
| `apps/api/src/comercial/ficha-geral.service.ts` (novo) | `extra` (tipo de pessoa, preferências, 1ª parcela, de onde vem o link da proposta: manual, serviço vinculado ou versão da sala, `negocioTravado`); `editar` (o PATCH: nome/empresa → `editarIdentidade`, tipo → `definirTipoDoNegocio`, valor/vendedor/canal → `ajustarNegocio`, e-mail → `Lead.email` condicionado e auditado, o resto → coluna da ficha numa transação com `AuditLog comercial.ficha.editada` antes/depois; **depois do aceite, produto, parcelas e 1ª parcela são do contrato: 409**); `pendencias`; `nota` (`FioService.registrar('nota.manual')` + auditoria `comercial.fio.nota`/`comercial.fio.passo_feito` sem o texto). Só gente: token (`SoGenteGuard`) e releitura no banco (ativa, desta empresa, `leads.editar` agora). |
| `apps/api/src/comercial/ficha-geral.controller.ts` (novo) | `GET /comercial/lead/:id/geral` (`leads.ver`), `PATCH /comercial/lead/:id/ficha` (`leads.editar`, `SoGenteGuard` + `AcessoAtualGuard`), `GET /comercial/lead/:id/pendencias` (`leads.ver`), `POST /comercial/lead/:id/fio/nota` (`leads.editar`, só gente). Controlador próprio para não mexer no construtor do `ComercialController`, que a suíte monta à mão. |
| `apps/api/src/comercial/comercial.module.ts` | Registro do controlador e do serviço (três linhas). |

### Tela
| Arquivo | O que |
|---|---|
| `apps/web/src/app/comercial/_painel/estado.ts` | `ABAS_DO_PAINEL = ['geral', 'pendencias', 'sala', 'whatsapp']`; `ABAS_FORA_DA_VISTA = ['fio', 'sessao', 'dinheiro', 'decisoes']` (vivas por link direto, como aba acrescentada no fim enquanto aberta); `aba=fio` (o padrão de antes) cai na Geral; `campo=<chave>` na query (o campo da Geral a focar); `destinoDaRotaAntiga('fio')` → `aba=geral`. |
| `apps/web/src/app/comercial/_painel/provedor.tsx` | Aba padrão = Geral; `abrir(leadId, aba, origem, campo)` e `trocarAba(aba, campo)`. |
| `apps/web/src/app/comercial/_painel/LeadPainel.tsx` | Cabeçalho enxuto (os editores de nome/empresa, tipo, valor, vendedor e canal saíram daqui: viraram campos da Geral), link discreto **Histórico** (abre `HistoricoDaEntidade` com `entityId = leadId`, `entityType = 'lead'`: é o par que o AuditLog do comercial grava), botão **Variante A/B** (só na Geral), fila de abas nova; lê também `GET .../geral`. As abas antigas continuam renderizadas quando a URL as pede. |
| `apps/web/src/app/comercial/_painel/AbaGeral.tsx` (nova) | Os três cartões (Quem · Origem · Negócio); `Campo` genérico (rótulo em cima, valor grande embaixo, vazio = "preencher", clique abre o editor, Enter/sair salva, Esc desfaz, otimista com volta e erro ao lado); WhatsApp pelo `PUT /whatsapp/vinculos/lead/:id/telefone` + "vincular a contato" (`GET /whatsapp/conversas?filtro=sem_vinculo` → `POST /whatsapp/vinculos/:conversaId {tipo:'lead', id}`); etapa só leitura com o mover do funil (todas as etapas; saída pede motivo; E8/E9 pedem confirmação); link da proposta (manual, do serviço, ou "copiar link da sala"); variantes A e B; `campoFocado` abre o campo. |
| `apps/web/src/app/comercial/_painel/AbaPendencias.tsx` (nova) | "Falta preencher" (chips → Geral com o campo aberto), "Próximos passos" (fazer / marcar como feito / fazer à mão / subir documento, este último leva à aba Dinheiro, onde o anexo do contrato já mora) e o bloco **Tarefas** do lead (saiu do Fio para aqui). |
| `apps/web/src/app/comercial/_painel/historico.tsx` (novo) | Reexport único do `HistoricoDaEntidade` (componente do agente do L2) + `TIPO_DA_ENTIDADE_DO_LEAD`. |
| `apps/web/src/app/comercial/_painel/variante.ts` (novo) | `useVarianteDoPainel` (localStorage `painel.variante`, padrão A). |
| `apps/web/src/app/comercial/_funil/mover.ts` | L5: `precisaDeConfirmacao`/`avisoDaConfirmacao` (E8/E9), `cartaoOtimista`, `cartaoDepoisDoMover`, `aplicarMovimentosLocais`, `locaisQueAindaValem` (o estado local por cima da lista da API e quando ele sai). |
| `apps/web/src/app/comercial/_funil/MenuDoLead.tsx` (novo) | O menu do lead (botão direito, "⋯", Shift+F10, tecla Menu): Abrir, Mover de etapa (todas; saída com motivo; E8/E9 com confirmação), Copiar link da sala (`POST .../sala/link`, clipboard com campo de cópia à mão), Vincular WhatsApp (Geral, campo WhatsApp), Editar valor negociado (Geral, campo), Histórico. Portal fixo na janela; fecha na rolagem só se quem abriu mudou de lugar. `MenuDoLeadProvider` / `useMenuDoLeadProprio` / `alvoDoMenuDoLead` / `BotaoDoMenuDoLead`, o mesmo desenho do `MenuDaTarefa`. |
| `apps/web/src/app/comercial/funil/page.tsx` | L5: o cartão anda na hora (estado local), volta com o aviso se a API negar, a coluna não recarrega (o cartão é refeito com a resposta do mover e relido sozinho por `GET /comercial/lead/:id`), transição de 150 ms na entrada, E8/E9 abrem a confirmação no cartão (arrasto e menu). L2: botão direito e "⋯" no cartão abrem o `MenuDoLead`. O link do cartão abre a Geral. |
| `apps/web/src/app/comercial/_funil/ListaDoFunil.tsx` | L2: botão direito na linha e no cartão do celular; "⋯" ao lado da empresa. Link abre a Geral. |
| `apps/web/src/app/comercial/_funil/NovoLead.tsx` | O lead recém-criado abre o painel na Geral (`aba=geral`). |
| `apps/web/src/app/leads/page.tsx` | L2: botão direito na linha e "⋯" ao lado do contato; mover relê a lista. |
| `apps/web/src/app/propostas/page.tsx` | L2: botão direito na linha com lead e "⋯" ao lado dele; mover relê o painel. |
| `_funil/TarefasDoComercial.tsx`, `_painel/TarefasDoLead.tsx` | **Sem mudança**: já usavam o `MenuDaTarefa` (botão direito e "⋯"); o item "Histórico" que o L2 acrescentou chega por ele. |

### Testes
| Arquivo | O que |
|---|---|
| `apps/api/test/comercial-ficha-geral-puro.test.ts` (novo, 11) | Os passos (ordem, destinos, automação, fatos, a nota que esconde), o fato `nota.manual` no catálogo, todo tipo com fonte, os schemas. |
| `apps/web/tests/unit/comercial-ficha-geral.test.ts` (novo, 12) | Campos e vazios, canais, PATCH, reais da tela, o funil fluido (confirmação, otimista, estado local), o menu do lead (razões e destinos). |
| `apps/web/tests/component/comercial-aba-geral.test.tsx` (novo, 12) | A Geral A e B, editar (texto, lista, reais, erro volta), WhatsApp e vínculo, etapa com confirmação e saída, `?campo=`, negócio travado, Histórico, Pendências (chips, passos, nota no fio, tarefas). |
| `apps/web/tests/unit/comercial-painel-estado.test.ts` | Abas novas, `fio` → Geral, `campo`, fila de abas, rota antiga. |
| `apps/web/tests/component/comercial-painel.test.tsx` | Abas novas (a antiga aberta por link no fim), linha do tempo da B, "ver tudo" abre o Histórico, Enter no funil abre a Geral. |
| `apps/web/tests/component/comercial-funil-mover.test.tsx` (23) | E8 pela arrasto abre a confirmação; o funil fluido (anda na hora e volta; relê só o cartão; confirmação de E9; cancelar); o menu do lead no cartão. |
| `apps/web/tests/component/comercial-tarefas.test.tsx` | O bloco de tarefas do lead agora é lido em `aba=pendencias`. |
| `apps/web/tests/component/comercial-cockpit.test.tsx` | O link da Torre leva à Geral (`aba=geral`). |

## 2. Como testar na tela

1. **Painel enxuto**: no Funil vivo, abrir um lead (clique no cartão, Enter, ou `/comercial/funil?lead=<id>`). A primeira aba é **Geral**: faixa da etapa no topo (variante A) e três cartões. Campo vazio diz "preencher" em cinza; clicar abre o editor; Enter grava, Esc desfaz; o valor aparece na hora e, se a API recusar (e-mail torto, link sem https), volta com a frase ao lado.
2. **WhatsApp**: no cartão Quem, "preencher" o WhatsApp grava pela rota do vínculo (a conversa 1:1 do número casa sozinha); "vincular a contato" lista as conversas do número da Root sem lead nem cliente e liga a escolhida.
3. **Etapa**: "mover para…" na faixa (A) ou no cartão Negócio (B). Qualquer etapa; saída pede o motivo; E8/E9 mostram o aviso da regra e "mover mesmo assim".
4. **Pendências e sugestões**: a segunda aba. "Falta preencher" lista os vazios da Geral (um clique leva ao campo, já aberto). "Próximos passos": a próxima ação, o que o portão pede, decisões, a automação que falhou (com "fazer à mão" e "subir documento") e os fatos de pendência. "Marcar como feito" grava uma nota no fio (o Histórico mostra) e o passo sai da lista. Embaixo, as tarefas do lead.
5. **Histórico**: o link no cabeçalho abre o AuditLog do lead (quem, quando, antes e depois): mover à mão, ficha editada, e-mail, nota do fio, vínculo da proposta. Nas variantes, "ver tudo" da linha do tempo (B) abre o mesmo.
6. **Variante A/B**: o botão "Variante A/B" no cabeçalho alterna e guarda no navegador (`painel.variante`).
7. **Botão direito** (funil quadro e lista, `/leads`, `/propostas`): abrir, mover de etapa (lista todas; E8/E9 pedem confirmação; saída pede motivo), copiar link da sala (vai à área de transferência; sem permissão do navegador, aparece o campo para copiar à mão), vincular WhatsApp (abre a Geral no campo), editar valor negociado (idem), histórico. O "⋯" ao lado do nome faz o mesmo (toque e teclado: Shift+F10, tecla Menu).
8. **Funil fluido**: arrastar um cartão: ele chega à coluna de destino na hora, com a transição; a mensagem aparece no cartão; a coluna não pisca nem recarrega. Negar (sem permissão, lead de outra empresa) devolve o cartão com a frase. Arrastar para E8/E9 abre a confirmação no cartão em vez de mover calado.
9. **Links antigos**: `?aba=fio` abre a Geral; `?aba=dinheiro` (Contratos → "ver no painel") e `?aba=sessao` ainda abrem a aba antiga, acrescentada no fim da fila só enquanto aberta.

## 3. Para publicar

- **Migration**: `20261027020000_ficha_geral` (aditiva: três colunas nulas em `ComercialFicha`). Roda no `command` do container como as outras. Depois dela, `prisma generate` faz parte do build da imagem (já rodado localmente).
- **Shared**: `pnpm --filter @mktos/shared build` (feito localmente; a imagem refaz).
- **Variáveis**: nenhuma. **Permissões**: nenhuma (`leads.ver`/`leads.editar` de sempre). **Capacidades/política**: nenhuma. **`db:seed:politica`**: não precisa.
- **Depende do L2 (agente do Histórico)**: `apps/web/src/components/historico/HistoricoDaEntidade.tsx` (já está na árvore) e a rota `GET /audit?entidade=&tipo=` (`auditoria.ver`). O comercial o importa só por `_painel/historico.tsx`.

## 4. Como desfazer

- **As abas antigas voltam** trocando uma linha em `apps/web/src/app/comercial/_painel/estado.ts`: `ABAS_DO_PAINEL = ['fio', 'sessao', 'dinheiro', 'decisoes', 'sala', 'whatsapp']` (e `ABA_PADRAO = 'fio'`). Nada foi apagado: `AbaFio`, `AbaSessao`, `AbaDinheiro` e `AbaDecisoes` seguem no código e o `LeadPainel` as renderiza quando pedidas. A Geral e a Pendências ficam disponíveis por link (`aba=geral`, `aba=pendencias`) mesmo fora da fila.
- **O menu do lead** sai tirando o `MenuDoLeadProvider` do funil e os `alvoDoMenuDoLead`/`BotaoDoMenuDoLead` das quatro superfícies; nenhuma rota depende dele.
- **O funil fluido** volta ao de antes trocando, em `agir`, o par `setLocais`/`aplicarMover` por `await recarregar()` e tirando a confirmação (`precisaDeConfirmacao`).
- **Banco**: as três colunas ficam (nulas, ignoradas pelo código antigo); a migration não se reverte porque reverter apagaria o que foi preenchido.
- **O fato `nota.manual`** fica no catálogo: tirar derrubaria a leitura das notas já gravadas no fio.

## 5. Riscos e decisões

- **"Como conheceu" na coluna `canal`.** A lista fechada nova (8 valores) entrou na MESMA coluna dos três canais do C07 (`conteudo`, `erp_parceiro`, `indicacao`), que seguem válidos e legíveis. O Painel geral agrupa pelo valor cru com o rótulo; o formulário de entrada de lead (`ComercialCanalDeEntradaSchema`) não mudou e continua gravando os antigos. Se o Rodrigo quiser unificar (migrar `indicacao` → `indicacao_cliente`, etc.), é um script de dado, não código.
- **"Continuidade" não é produto do catálogo.** `COMERCIAL_PRODUTOS` tem `imersao`, `operacao`, `kit`, `turma` (a tabela de preço depende disso). A Geral oferece esses quatro; acrescentar "Continuidade" mexe no shared e na tabela de preço: decisão do Rodrigo.
- **Produto, parcelas e 1ª parcela depois do aceite.** Esses campos nascem da proposta publicada/aceita e o fechamento os lê. A Geral os edita só antes do aceite (`propostaAceitaEm` vazio); depois, 409 com a frase e a aba Dinheiro. O valor negociado continua editável sempre (é da ficha, não do contrato).
- **O "Sócio responsável"** grava o NOME na coluna `socioDaConta` (como a ata já fazia); a lista oferece a equipe. O id na projeção continua vindo da ata (E-24).
- **A nota "feito" esconde o passo só se for posterior a ele.** Um passo que nasce de novo (outra falha, outra etapa) volta à lista. É de propósito.
- **Automação que falhou**: lida de `ComercialReacao.estado = 'erro'` (as 50 mais recentes). Quando o relógio tentar de novo e acertar, a linha muda e o passo some.
- **Funil fluido e a leitura de 30 s**: o estado local fica por cima até a API devolver o cartão na etapa nova; uma leitura que saiu antes do mover não devolve o cartão (não pisca). O cartão é relido sozinho pela ficha; o que a ficha não traz (tarefa aberta, `voltaPara` fora da geladeira) chega no tique seguinte.
- **Testes que falham e NÃO são desta lane**: `comercial-aba-sala.test.tsx` (2 casos) quebra com a `AbaSala.tsx` em andamento do agente da Sala (115 inserções na árvore); `comercial-cockpit.test.tsx` "a assinatura da Root… não manda duas vezes" é de tempo e passa sozinho (passou na última rodada completa). Nenhum vermelho novo nos arquivos desta lane.

## 6. As duas variantes da Geral (para o Rodrigo escolher)

| | A (padrão) | B |
|---|---|---|
| Desenho | A etapa como faixa no topo; abaixo, três cartões lado a lado (Quem · Origem · Negócio). | Os três cartões numa coluna à esquerda (a etapa dentro do Negócio); à direita, a linha do tempo resumida: os 5 últimos fatos do fio e "ver tudo" (abre o Histórico). |
| Para quem | Quem quer ler a ficha inteira de uma vez, sem rolar, e mover a etapa sem procurar. | Quem quer a ficha e o "o que aconteceu por último" na mesma tela, sem abrir o Histórico. |
| Como ver | Botão "Variante A/B" no cabeçalho do painel, na aba Geral. A escolha fica no navegador (`localStorage['painel.variante']`). | |
| Para fixar | Trocar `VARIANTE_PADRAO_DO_PAINEL` em `packages/shared/src/ficha-geral.ts` (e, se quiser tirar o botão, `painel-variante` em `LeadPainel.tsx`). | |

Fotos: na prova e2e (`homolog/e2e/leva5.mjs`, lane L9) com `painel.variante` em A e em B.
