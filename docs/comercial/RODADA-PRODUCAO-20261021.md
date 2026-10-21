# Rodada de produção 1 — 21/10/2026

> Fonte: ata "Refinements to dashboards, work organization, and CRM structure" (21/10/2026, o Rodrigo ditando, já olhando a PRODUÇÃO) e um pedido logo depois: "quero que utilize aquele outro sistema para conexão com o WhatsApp ao invés de Zapfy ou DigiSac" (= a **Evolution** da Root, que já roda na VPS de produção, projeto `root_evolution`).
> A produção (os.operacaoroot.com) roda desde 20/10 23:10 a tag `interface-todas-20261020` (c3761c4b). Esta rodada constrói e prova no Predator; **o orquestrador do Mac publica na produção** pela cadeia de releases (`/srv/rootos/releases/`) e roda o importador lá. Nada daqui escreve na produção.
> Branch: **`homolog/final-20261019`**, sobre a tag `interface-todas-20261020`.
> Encerramento: `homolog/RESULTADO-PRODUCAO-21.md` + tag `producao-21-20261021` + bundle delta `C:\Users\User\dev\producao21-delta.bundle` (`homolog/final-20261019` e a tag, `^interface-todas-20261020`) + stacks 3030 e 3031 na imagem nova + a seção "Para publicar" (abaixo) preenchida.

## O estado real da produção (lido em 21/10 00h, só leitura; sem nomes no git)

Pastas: `Demandas internas / Marketing` (listas Análise, Calendário de conteúdo, Copy, Demandas gerais, Design & Gravação, Gestão de Temas, Rotina de stories), `CRM` (listas **Gestão de Leads**, natureza `cadastro`, 12 cartões; **Contratos dos clientes**, `cadastro`, 6 cartões, todos SUBTAREFAS de cartões da Gestão de Leads), e as três que a "estrutura sugerida" criou sozinha em 21/10 00:18 quando alguém usou "Iniciar onboarding": `Administrativa` (vazia), `Gestão` (vazia), `Clientes` (Esteira de clientes, Onboarding de cliente com 1 cartão, Execução).
Sem pasta: Administrativo (6), Comercial (15), Financeiro (3), Jorge Tabeliao (1, lixo de teste), Marketing (1 tarefa real), Operação (48, 31 subtarefas), **Teste teste** (`cadastro`, 3 cartões de lixo).
Status da Gestão de Leads: Validar (2), Followup (5), Kickoff (1), Implantação (2), Recorrente (1), Depoimento e indicação (1). Os 5 cartões de Kickoff/Implantação/Recorrente/Depoimento são CLIENTES com contrato (os 6 contratos são filhos deles: um cliente tem dois).
Comercial: 1 lead (criado à mão em 21/10 00:05, mesmo cliente de um cartão em Followup) e 1 card de implantação iniciado antes do fechamento. Zero contrato vivo.
O Predator tem a cópia de produção de 19/10 (`C:\Users\User\dev\producao\producao-root-20261019b.dump`) com as MESMAS listas do CRM: use-a, num banco descartável, para provar o importador. Nada de dado real no git nem no log.

## O que o Rodrigo pediu (ponto a ponto)

1. **Dia a dia › Visão geral.** Os dashes estão bons. Em **"Carga por prazo"** o balão do hover das colunas **Atrasadas** e **Sem prazo** sai da caixa; e há **rolagem lateral** no gráfico ("acho muito feio"). O gráfico tem de caber sempre na caixa, em qualquer aparelho, sem rolagem lateral, e o balão sempre dentro da caixa. O mesmo em **"Tarefas por lista"**. "Tarefas por pessoa" fica como está. Pendências ficam.
2. **Agenda:** visão por **semana** além de mês; boa no **celular**.
3. **Trabalho › CRM sai do Trabalho.** Os leads da pasta CRM vão para o **Funil vivo**; os contratos fechados vão para **Contratos vivos**; a **Lista de leads** passa a tê-los; o **Painel geral do comercial** reflete. A pasta CRM sai da seção Trabalho.
4. **Marketing** (Demandas internas / Marketing) fica. **Sem pasta › Marketing**: excluir (a lista; a única tarefa dela é real e vai para Demandas internas / Marketing › Demandas gerais antes). **Sem pasta › Teste teste**: excluir. **Operação** fica.
5. Uma seção **Gestão** (como "Sem pasta" e "Demandas internas" aparecem) com as listas **Administrativo**, **Financeiro** e **Pessoas**. E **Clientes** com as listas dos clientes (Esteira, Onboarding de cliente, Execução).
6. **Todas:** opção clara, na tela, de **recolher os status vazios**; e a mesma opção no painel de **Filtros**, para entrar na **vista salva**.
7. **Implantação de clientes:** "criamos um kanban e toda uma estrutura, com agentes específicos, e nada aparece"; "as datas estão esquisitas"; quer **sugestões** melhores.
8. **Atas:** puxar da pasta de reuniões do **vault**, do **Granola** (ele vai liberar) e de uma **pasta do Drive**; atas **e transcrições**. **Buscar** por palavra-chave e por **data**. A lista à esquerda com **rolagem própria** (só ela rola, não a tela) e a direita mostrando a ata clicada, ampla.
9. **Comercial:** Painel geral fica e se atualiza com os leads e contratos importados. Propostas ficam. Rodada da semana fica.
10. **WhatsApp:** usar a **Evolution** (o sistema da Root) no lugar do DigiSac.
11. **Sala:** "por que a sala não está funcionando na construção do lead; em que momento ela entra; tem publicar mas não sei quando entra". (A explicação vai ao Rodrigo pelo orquestrador; a rodada faz a parte de tela em P9.)

## P1 — Dia a dia: gráficos que cabem e balão dentro da caixa

- Achar os componentes de "Carga por prazo" e "Tarefas por lista" (`VisaoGeralDasTarefas.tsx` e vizinhos). Sem rolagem lateral em nenhuma largura (390 px a 1920 px): as barras/colunas se ajustam à largura da caixa (largura relativa, rótulo que quebra ou abrevia com o nome inteiro no balão; muitas listas = o gráfico cresce para baixo, nunca para o lado). `overflow-x` some do componente.
- O balão (tooltip) é posicionado **dentro da caixa do gráfico**: calcula o lado (esquerda/direita/cima) pelo espaço disponível, inclusive na primeira e na última coluna; no toque (celular) abre ao tocar e fecha ao tocar fora. Sem biblioteca nova.
- Testes de componente: largura 390, 768 e 1440 sem `scrollWidth > clientWidth`; balão da primeira e da última coluna com o retângulo dentro do da caixa.

## P2 — Agenda por semana e no celular

- `/agenda`: troca **Mês · Semana** (e **Dia** no celular, se ajudar), estado no endereço (`?visao=semana&dia=AAAA-MM-DD`), setas de anterior/próxima e "Hoje". Semana em grade de horas (07h–22h, rolagem vertical, eventos de dia inteiro no topo) no desktop; no celular (< 640 px) a semana vira lista por dia, sem rolagem lateral. Mesma fonte de eventos de hoje (nada muda na API, salvo se faltar intervalo por semana).
- Teste de tela das duas visões e da troca; captura 390 px.

## P3 — A estrutura do Trabalho: Gestão e Clientes; Administrativa sai

- `work/estrutura-sugerida.ts` passa a sugerir: **Gestão** com as listas **Administrativo**, **Financeiro** e **Pessoas**; **Clientes** com **Esteira de clientes**, **Onboarding de cliente** e **Execução**. A pasta "Administrativa" deixa de existir no desenho (nunca recriada). Continua só criando o que falta, pelo nome, sem renomear nem mover nada que exista, sob o cadeado da árvore. Lista existente de mesmo nome **solta** (sem pasta) é **movida** para a pasta sugerida em vez de criar outra (é o caso de Administrativo e Financeiro na produção) — mover lista preserva tarefas e ids.
- **Pasta vazia** pode ser apagada pela tela (só vazia: sem lista nenhuma); a da produção (`Administrativa`) sai pelo importador (P5).
- **Lista pode ser excluída pela tela** só quando todas as tarefas dela estão arquivadas ou ela está vazia, com confirmação escrita do nome; a exclusão grava auditoria com a contagem. Sem isso, a tela oferece "arquivar todas" antes. (É como o Rodrigo vai limpar daqui para a frente.)
- O seed e o `db:seed:comercial` usam a regra nova; testes da estrutura atualizados (`work-estrutura*`).

## P4 — Recolher status vazios no Todas (e onde mais houver quadro)

- No cabeçalho do quadro de Todas, ao lado de Quadro · Lista · Calendário, um botão claro **"Ocultar status vazios"** (alterna; mostra quantos estão ocultos: "12 vazios ocultos"). No painel de **Filtros**, o mesmo como booleano (`?vazios=ocultar`), para a **vista salva** levar. Vale também no quadro de uma lista e na Implantação (coluna sem cartão some quando ligado). Arrastar com o modo ligado: as colunas vazias reaparecem como destino enquanto se arrasta (senão não dá para mover para um status vazio).
- Testes: alternar, contar, endereço, vista salva, destino no arraste.

## P5 — O CRM vai para o Comercial (o importador da produção)

O que existe na produção hoje são cartões da lista `cadastro` "Gestão de Leads" e subtarefas na "Contratos dos clientes". O destino é o Comercial: **Lead + ComercialFicha** no funil, e **contrato vivo** para quem já é cliente.

- **Um script compilado** `apps/api/src/scripts/importar-crm.ts` (`node dist/scripts/importar-crm.js`), que roda DENTRO da imagem, contra o banco que recebe em `DATABASE_URL`, com Nest (como os outros scripts de `src/scripts/`). Padrão `--simular` (só lê e imprime contagens); escreve só com `--valer`. `--como <e-mail>`: a pessoa da casa em nome de quem o importador registra (o RASTRO e a auditoria levam a pessoa e a marca `importacao.crm`). `--org <slug|id>` obrigatório. `--detalhe <arquivo>`: o plano com títulos vai para esse arquivo (fora do git, dado real); o console só tem contagens.
- **Regra de etapa** (pelo NOME do status do cartão, normalizado; tabela no código, sem nome de cliente): Validar → Qualificação; Followup → Follow-up (ou a etapa do funil de mesmo sentido); Kickoff, Implantação, Recorrente, Depoimento e indicação → **cliente** (fechado). Status que não casar → sobra listada, nada inventado.
- **Lead do funil**: pela entrada idempotente que já existe (ref `cartao:<id do cartão>`), deduplicando com lead já existente pelo CNPJ ou pelo nome normalizado da empresa (a produção já tem 1 lead criado à mão que é o mesmo cliente de um cartão: reaproveita, não duplica). Empresa = o que vem antes do parêntese no título; contato = o que está dentro; telefone, e-mail, CNPJ, valor e produto dos campos do cartão, quando houver. Etapa pela regra acima, pela mesma escrita de etapa de sempre (`mudarEtapa` com a pessoa; mover livre). Nenhuma mensagem, cobrança, sala publicada ou contrato enviado nasce do importador.
- **Cliente com contrato** (os cartões de status de cliente e os filhos em "Contratos dos clientes"): o lead vai a **fechado** com o `Partner` cliente (dedupe pela regra do `cliente-do-lead.ts`), e cada subtarefa de contrato vira **um contrato vivo** desse cliente (produto e valor do título/campos quando houver; parcelas, vencimentos e régua ficam `[a decidir]` e **desligados**: nenhum aviso de cobrança dispara para contrato importado sem parcela). Use o caminho de domínio que o "Registrar cliente já fechado" (T1b) usa para gravar o fechamento, **sem PDF obrigatório no modo importação** e sem cobrança, com o fato `contrato.importado` (origem `cartao:<id>`) no fio. Se o modelo exigir PDF, crie o contrato vivo em estado "importado, sem documento" e diga na tela ("Contrato importado do CRM antigo · anexar o PDF"). Nada de R4 inventado: importar fato passado não é ato comercial novo; registre isso no CLAUDE.md (seção Leads) como decisão do dono do produto (21/10).
- **Card da implantação** para cliente em Kickoff ou Implantação: o card na lista Onboarding de cliente, na etapa equivalente (Kickoff → "Kickoff marcado"; Implantação → a etapa de implantação do modelo), pela mesma `abrirCardDaImplantacao` (id derivado do lead, idempotente). Recorrente e Depoimento → Clientes › Execução ou só contrato vivo (escolha e registre). O card que já existe na produção (onboarding iniciado antes do fechamento) é reaproveitado.
- **O cartão de origem é arquivado** (nunca apagado) com um comentário "Importado para o Comercial: <link do lead>" (e o do contrato, quando houver). Quando todos os cartões das duas listas do CRM estiverem arquivados, a **pasta CRM e as duas listas saem do Trabalho**: marcadas como arquivadas (migration aditiva `WorkFolder.arquivadaEm` e `WorkList.arquivadaEm`, ou o que já existir para isso), fora da árvore, de Todas e dos contadores; a tela de Trabalho não as mostra; os dados ficam no banco.
- **A limpeza da ata** (no mesmo importador, como etapas separadas e listadas no plano): mover a tarefa real de Sem pasta › Marketing para Demandas internas / Marketing › Demandas gerais e excluir a lista vazia; arquivar os 3 cartões de **Teste teste** e excluir a lista; criar a lista **Pessoas** em Gestão; mover **Administrativo** e **Financeiro** (soltas) para **Gestão**; apagar a pasta **Administrativa** se vazia. **Comercial (sem pasta), Operação e Jorge Tabeliao ficam** (Jorge vai para as sobras como "parece teste: o Rodrigo decide").
- Idempotente: a segunda passada (`--valer` de novo) não muda nada; `--simular` depois dá zero.
- **Prova**: num banco descartável no Predator restaurado da `producao-root-20261019b.dump` + as migrations da tag (como a virada), rodar `--simular`, `--valer`, `--valer` de novo e `--simular`; contagens no RESULTADO (sem nomes). Teste de API com fixture sintética (cartões de cada status, contrato filho, lead duplicado, status desconhecido, cliente com dois contratos). Conferir na 3030 restaurada da mesma forma, se a stack permitir: Funil, Lista de leads, Contratos vivos, Painel geral, Implantação e Trabalho mostram o resultado.

## P6 — Implantação que mostra o que existe, e datas legíveis

- Diagnóstico escrito no RESULTADO: por que a Implantação aparece vazia (hoje só nasce card pelo fechamento, "Registrar cliente já fechado" ou "Iniciar onboarding"; nenhum cliente da produção passou por esses caminhos; o P5 resolve os atuais).
- **Datas**: no cartão, "na etapa há N d" (de `statusDesde`, nunca inventado) e a **próxima data real** quando houver (próxima reunião do cliente na Agenda pelo e-mail/nome; ou o prazo da tarefa), em `dd/mm` curto, com o dia da semana no balão; sem data, nada. Nada de data UTC crua nem "Invalid date".
- **Os agentes da implantação aparecem**: no painel do card, uma seção "Quem trabalha nesta etapa" listando os agentes do roster da Root ligados ao trilho (leitor de ata, relógio do onboarding e os que o código já tem), com o que cada um fez neste cliente (último fato do agente no fio/trilho) e o que vai fazer (a próxima ação do relógio). Só leitura.
- **Sugestões** (`docs/comercial/SUGESTOES-IMPLANTACAO.md`, curto, para o Rodrigo escolher): no mínimo cinco, cada uma com o problema que resolve e o custo. Implemente só as duas acima nesta rodada.

## P7 — Atas: vault, Granola e Drive; atas e transcrições; busca; duas colunas

- **Fontes** (todas por empresa, nenhuma obrigatória): o vault (pasta da nota `trabalho.atas.pasta`, padrão `80-Reunioes`), o **Granola** direto (o conector da rodada da interface; reuniões e transcrições), e uma **pasta do Google Drive** escolhida em Conexões ou na própria tela de Atas (nota da memória `trabalho.atas.drive` com o id da pasta; leitura pelo conector Google que já existe e pela **porta**, capacidade de leitura já existente do Drive; arquivos Google Docs, PDF com texto, .txt e .md; nada é copiado para o banco além do índice: título, data, fonte, hash, tamanho, e o texto só enquanto a ata está aberta ou é usada para sugerir tarefas). Cada item é **ata** ou **transcrição** (tipo na lista e filtro).
- **Busca**: caixa de palavra-chave (título e corpo; no vault e no índice, pela busca que já existe; no Drive, pela busca do Drive dentro da pasta; no Granola, pelo título/participantes) e **intervalo de datas** (de/até), com o estado no endereço. Ordenação por data, mais nova primeiro.
- **Layout**: duas colunas no desktop; a coluna da esquerda (lista) tem **altura da janela e rolagem própria**; a página não rola. A direita mostra a ata/transcrição clicada, ampla, com as ações (gerar ata a partir da transcrição, sugerir tarefas, abrir a fonte). No celular, lista e detalhe em telas separadas com voltar.
- As regras da rodada da interface continuam (transcrição bruta não gravada, segredos mascarados, `blocoExterno`, o parser decide as sugestões).
- Testes: cada fonte com dublê; busca por palavra e por data; rolagem só na lista.

## P8 — WhatsApp pela Evolution (no lugar do DigiSac)

- O "caminho certo" que o próprio `evolution.provider.ts` descreve: a **Evolution inscreve, no próprio conector** (`pauta/evolution.service.ts` ou onde o conector mora), os efeitos de **envio ao lead** (texto; botões/formulário como texto numerado, como no DigiSac) e de **grupo** (criar grupo e enviar no grupo, pela API da Evolution v2), e o provedor `evolution` do comercial passa a entregar por esses efeitos (o mesmo desenho que o DigiSac usou: o HTTP só no conector, a catraca de arquitetura intacta). A **entrada**: o webhook da Evolution que já chega ao canal de aprovação desvia mensagem de lead para a entrada do comercial (por registro, como o grupo de links da pauta), com o segredo do cabeçalho.
- **Configuração em Integrações**: cartão "WhatsApp (Evolution)" com URL, chave e instância **no cofre por empresa** (variáveis `EVOLUTION_*` seguem como reserva da empresa da casa); sondagem de saúde (estado da instância: conectada/QR pendente); a tela mostra o QR quando a instância pedir (rota da Evolution `instance/connect`), para o Rodrigo ligar o número da Root. Na produção a Evolution da Root responde na rede interna do Docker (`root_evolution`, porta 8080): registre a URL interna sugerida no RESULTADO.
- **DigiSac sai da tela** de Integrações (o código fica, sem uso; `WHATSAPP_PROVEDOR=digisac` continua aceito). `WHATSAPP_PROVEDOR` padrão segue `simulado`; a virada para `evolution` é do Rodrigo depois de ligar o número.
- Testes com dublê HTTP da Evolution: envio 1:1, grupo, entrada pelo webhook, recusa sem segredo, catraca de arquitetura verde.

## P9 — A sala: quando ela entra (tela)

- No painel do lead, aba Sala: um quadro de **estado** com a linha do tempo real da sala deste lead: sala criada (quando, por qual fato), link entregue ao cliente (por qual mensagem e provedor; **"não entregue: WhatsApp simulado"** quando for o caso), versão publicada (qual, quando), versão na porta esperando outra pessoa em Aprovações (com o link para lá), última visita do cliente.
- Botão **"Copiar link da sala"** para quem tem `leads.editar` (o token sai decifrado só nessa resposta, com auditoria `sala.link.copiado` com quem e quando; nunca no log). É o que permite mandar o link por outro canal enquanto o WhatsApp não está ligado.
- Texto de ajuda curto na aba: "A sala nasce quando o lead entra. O cliente recebe o link na primeira mensagem do WhatsApp. O que você publica aqui só aparece para ele depois que outra pessoa liberar em Aprovações."

## P10 — Provas, imagem e "Para publicar"

- Web e API: suítes inteiras, sem vermelho novo fora da linha de base; política 101/101 (se P8 mexer em capacidade, só as declaradas e com a assinatura certa, e diga qual); isolamento (tabela nova = contar `FILHOS_COM_ORGID_REDUNDANTE`); `tsc` limpo.
- e2e novo `homolog/e2e/producao21.mjs` (seed 3031): Visão geral sem rolagem lateral e balão dentro (390 e 1440); Agenda semana; Todas com "Ocultar status vazios" e vista salva; Atas (busca por palavra e data, rolagem só na lista, dublê do Drive e do Granola); Integrações com o cartão da Evolution e sem DigiSac; aba Sala com o estado e "Copiar link". Mais os roteiros de sempre e o `final.mjs` na 3030.
- Imagem nova nas duas stacks, sem perder dado da 3030. Capturas (escuro, claro, 390 px) de cada tela tocada.
- **Seção "Para publicar"** no RESULTADO, para o orquestrador do Mac: migrations novas (nomes), variáveis novas (nomes, para o `final.env`), capacidade nova (se houver; com a assinatura), e a sequência exata do importador na produção: `--simular` → conferir com o Rodrigo → `--valer` → `--simular` = zero, com os argumentos (`--org`, `--como`).

## Regras duras

As de sempre (`docs/comercial/PASSAGEM-PREDATOR-COMERCIAL.md` §0, `CLAUDE.md`). Nada em produção daqui. Nada de dado de cliente no git, no log ou no RESULTADO (só contagens). Migração aditiva com RLS. Porta e política não afrouxam para agente; o importador e a exclusão de lista são de gente, com auditoria. Nada do escritório Cardozo & Saggioro (nem DigiSac, nem conta, nem número). Nunca `docker system prune` nem `taskkill` amplo; os processos `claude` antigos ficam quietos. Revisor adversarial curto no fim: importador idempotente e sem efeito externo; exclusão de lista só vazia/arquivada; link da sala só para `leads.editar` e auditado; Evolution sem furar a catraca; Drive lido pela porta; nenhum segredo no diff.
