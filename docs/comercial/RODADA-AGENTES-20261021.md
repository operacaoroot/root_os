# Rodada dos agentes — 21/10/2026

> Fonte: ata "Construção de agentes e padronização de integrações" (21/10/2026, o Rodrigo ditando) + o catálogo de agentes levantado no mesmo dia (`docs/agentes/catalogo-levantamento-20261021.json`, 77 linhas, página https://claude.ai/artifact/45JVZzQGJYuN5fccEZugrN). Ordem do Rodrigo: **"vai construindo tudo de uma vez"** e **"quero que vá direto para a produção"**: a entrega desta rodada é publicada na produção pelo orquestrador do Mac logo que a tag aparecer, sem nova rodada de ajuste. Por isso a seção "Para publicar" tem de estar completa e verdadeira.
> Branch: **`homolog/final-20261019`**, sobre a tag **`producao-21b-20261021`** (a rodada de produção 1 e o adendo dela). Leia `homolog/RESULTADO-PRODUCAO-21.md` e o RESULTADO do adendo antes de tudo: P6 (agentes visíveis na Implantação), P8 (Evolution no comercial, DigiSac fora da tela) e a árvore de pastas editável **já foram feitos lá — não refaça, continue**.
> Encerramento: `homolog/RESULTADO-AGENTES.md` (com "Para publicar") + tag **`agentes-entrega-20261021`** + bundle delta `C:\Users\User\dev\agentes-delta.bundle` (`homolog/final-20261019` e a tag, `^producao-21b-20261021`) + stacks 3030 e 3031 na imagem nova + `docs/comercial/VIRADA-PRODUCAO.md` atualizado para esta tag.
> Nada em produção daqui: quem publica é o Mac, pela cadeia de releases da VPS.

## O que a ata pede

1. **Construir todos os agentes sugeridos** de cinco áreas do catálogo: **Comercial** (CO-01 a CO-16), **Implantação** (IM-01 a IM-07), **Trabalho e pastas** (TR-01 a TR-10), **Rotinas da casa** (RO-01 a RO-04) e **Canais e integrações** (CA-01 a CA-05). "Construir" = o que está só no papel ou proposto passa a existir; o que existe recebe o que a coluna "o que melhorar" pede. Conteúdo, Financeiro, Central e Receitas **não** são reconstruídos nesta rodada (recebem só a fundação da A1).
2. **Um agente novo da agenda**, que garante que todo agendamento na agenda da Root siga o padrão já definido (`packages/shared/src/agenda.ts`), para que nada entre ou fique lá fora do padrão.
3. **Equipe**: no ROOT OS, a equipe são só três pessoas — **Rodrigo, Lucas e Pedro**. Os agentes aparecem na Equipe ao lado delas.
4. **Discriminar** cada agente: para que serve, se está ativo; e **separar o que NÃO é agente**: rotinas e automações ligadas à execução diária.
5. **Integrações num padrão só**, de integração e de layout.
6. **WhatsApp**: **excluir o DigiSac** (não só esconder) e o **Zapfy**; fica a **Evolution**, o sistema open source que a Root já usa. O resto das integrações fica.

## Decisões já tomadas (não reabrir)

- Modelo por função conforme o catálogo: Opus 5.5 (`claude-opus-5-5`) para julgamento e texto longo; Sonnet 5.5 (`claude-sonnet-5-5`) para extração e texto curto guiado; Haiku 5.5 (`claude-haiku-5-5`) para classificar e resumir em volume; sem modelo para regra, transação e integração. Fable 5.1 em nenhum agente.
- **Pasta do cliente** = cópia de `_modelo-cliente` dentro da pasta raiz **`Root/10-clientes`** (Drive id `1OYHyKiE7uJlzWf-u9cRtYyvm8hXnYO0H`), subpastas `01-comercial`, `02-contrato`, `03-kickoff`, `04-entrega`, `05-acompanhamento`, `06-financeiro`, `07-evidencias`, `99-arquivo`, `_fonte`. A raiz é configurável por empresa (nota da memória `clientes.pasta.raiz`, primeira linha = id da pasta); a da Root vem no "Para publicar".
- A chave da API será a do Rodrigo, posta na produção por ele. Aqui não há chave: **a prova com modelo real usa a ponte** (`homolog/ponte-modelo`, Claude Code da assinatura no Predator).

## Lane 0 — contrato (orquestrador, antes das outras)

- **Cadastro único** `packages/shared/src/agentes.ts`: uma entrada por linha do catálogo + o agente da agenda (`AG-01`). Campos: `id` (CO-01…), `slug`, `nome`, `area`, **`tipo`** (`agente` = decide com modelo · `rotina` = relógio, sem modelo · `automacao` = reação/integração disparada por evento), `paraQueServe` (uma frase em português para a tela), `gatilho`, `frequencia`, `le`, `escreve`, `capacidades` (ids da política), `nivel`, `modelo` (`claude-opus-5-5` | `claude-sonnet-5-5` | `claude-haiku-5-5` | `null`), `esforco`, `dono` (`rodrigo` | `lucas` | `pedro`), `estado` (`ativo` | `desligado` | `so-homologacao` | `aposentado`), `onde`.
- Partida: o JSON do levantamento; **o código manda** onde divergir (corrija a entrada e anote no RESULTADO).
- Dono padrão **[a decidir]**, editável na Equipe: Comercial → Lucas; Implantação → Pedro; Trabalho e pastas → Rodrigo; Rotinas da casa → Pedro; Canais e integrações → Pedro; Agenda → Rodrigo.
- Testes do cadastro: id e slug únicos; todo `agente` tem modelo; toda `rotina`/`automacao` tem `modelo: null`; toda capacidade citada existe na política; nenhum slug do cadastro sem entrada e vice-versa nos seeds.
- Commit e só então abrir as lanes (até 5 subagentes, model opus, arquivos disjuntos; a A1 entra primeiro porque as outras usam o `funcao`).

## A1 — Fundação (os 11 passos da arrumação)

1. Os três seeds (`agents/roster/roster.ts`, `agents/roster/onboarding-da-root.ts`, `prisma/seed-tripulacao.ts`), a tela `/agentes` e `scripts/gerar-documentacao.ts` **leem do cadastro**. O `assistente` deixa de existir em dois lugares.
2. **Modelo por função**: `LlmMessage` e `LlmStepInput` ganham `funcao` (id do cadastro). O provedor escolhe `modelo` e `esforco` pelo cadastro; `LLM_MODELO_<ID>` (ex.: `LLM_MODELO_CO_03`) sobrescreve por função. As 22 chamadas passam a dizer a função. O stub passa a aceitar a função como marca além do `[tarefa:…]`.
3. `llm/preco.ts`: `claude-opus-5-5` (4/20, cache 0,40/5), `claude-sonnet-5-5` (2/10, 0,20/2,50), `claude-haiku-5-5` (0,10/0,50; acima de 100 mil tokens de entrada 0,50/2,50), conforme a tabela da Anthropic. Use a skill `claude-api` para conferir preço, parâmetros e o comportamento de cada modelo (o Opus 5.5 tem esforço padrão `medium` e mandamos sempre explícito; o Haiku 5.5 não tem fallback do lado do servidor, então não mande `fallbacks` para ele; o Sonnet 5.5 só aceita `fallbacks: "default"`).
4. Padrão `ANTHROPIC_MODEL` = `claude-opus-5-5` (compose e código).
5. `agentSlug` (o slug do cadastro) em toda chamada: o orçamento por agente passa a ver tudo.
6. Assistente: fora do seed as capacidades R3/R5 "para a régua aparecer"; fora as ferramentas sem efeito (`contexto.nota.ler`, `numeros.funil.ler`) ou ligue o efeito delas, se for trivial.
7. As rotinas que hoje se cadastram como `Agent` (ClickUp, vault, conciliação, bio, metas) **registram cada passagem** no histórico de rotinas e passam a `tipo: rotina` no cadastro; somem da lista de agentes.
8. Embeddings (`obsidian.service.ts`, `pauta.service.ts`) e transcrição passam pelo teto diário por empresa.
9. `ia-acao@`: o seed deixa de criá-la; migration/script idempotente **desativa** a conta existente (nunca apaga), com auditoria.
10. (Na produção, pelo Rodrigo: chave e `LLM_PROVIDER=anthropic` — só no "Para publicar".)
11. Prova por agente: ver A8.

## A2 — Comercial (CO-01 a CO-16)

- **CO-03, CO-04, CO-06, CO-12**: função e slug passados; modelos do cadastro (CO-03 Opus 5.5 high; CO-04, CO-06, CO-12 Sonnet 5.5 medium).
- **CO-11 Vigia**: além das exceções, um resumo de três linhas no topo pela função CO-11 (Haiku 5.5, low). Os números vêm do sistema; o modelo só escreve a frase.
- **CO-08 Assinador**: quando a assinatura conclui, o PDF assinado é **copiado** para `02-contrato` da pasta do cliente (A4), além de ficar a URL do provedor.
- **CO-10 Fechador**: 7ª escrita `pasta` (A4).
- **CO-13 Construtor de contrato da Root** (novo; Opus 5.5 high): a partir da proposta aceita e da ficha, redige a minuta sobre o **modelo de contrato da Root**, lido de `70-modelos/contratos` do Drive da Root pela porta (nome do arquivo na nota `comercial.contrato.modelo`). Inserção marcada, lacuna marcada, nunca inventa dado. Grava o rascunho em `02-contrato` do cliente e como `ComercialDocumento` rascunho. Sem modelo cadastrado: recusa com "[a decidir] O modelo de contrato da Root ainda não foi cadastrado". Capacidade de gravar no Drive: a da A4.
- **CO-14 Revisor de contrato da Root** (novo; Opus 5.5 high + regras): laudo ranqueado (valor por extenso × algarismo, remissão de cláusula quebrada, parte e CNPJ divergentes da ficha, lacuna aberta, placeholder). Regras primeiro, modelo depois; não reescreve.
- **CO-15 Formulário do site** (novo; sem modelo): rota pública `POST /api/publico/lead` com teto por origem, honeypot, campos validados por schema do shared, CORS só para `operacaoroot.com`; cria o lead pela entrada idempotente com a capacidade nova **`comercial.lead.criar`** (R1 pela escada; classifique pelo `classificar` e diga o nível). Um snippet de formulário HTML em `docs/comercial/FORMULARIO-DO-SITE.md` para o site.
- **CO-16 Triagem do WhatsApp** (novo; Haiku 5.5 low): cada mensagem que entra pela Evolution (a entrada da P8) é classificada em lead novo · dúvida de lead · documento · cliente ativo · outro, com a confiança; lead novo cria lead pela mesma entrada idempotente; documento vai ao arquivista (TR-05); dúvida e cliente ativo vão para a caixa/fio. Confiança baixa vira item na caixa para uma pessoa. Nada é respondido ao contato por este agente.
- **CO-01, CO-02, CO-05, CO-07, CO-09**: só cadastro (estado, dono, para que serve). Não mexer na régua.

## A3 — Implantação (IM-01 a IM-07)

- **IM-01 Leitor de ata do onboarding**: passa a gravar ele mesmo o marco `ata.notas` (hoje escrito por script), com as notas da conversa; a ata vai também como `.md` para `03-kickoff` do cliente (sem a transcrição bruta: a ata gerada).
- **IM-02 Pesquisador de conta**: sai da chamada direta e passa pelo laço do agente e pela porta, usando as capacidades que declara. Busca na web: só se o provedor for `anthropic` (ferramenta de servidor `web_search`), atrás da nota `onboarding.pesquisa.web` = `ligada`; desligada por padrão.
- **IM-03 Roteirista**: Sonnet 5.5 high.
- **IM-04 Carregador**: `tipo: rotina` no cadastro.
- **IM-06 Transcrição**: sob o teto (A1.8).
- **IM-07 Montador do kit** (novo; Sonnet 5.5 high): na etapa "Kit montado" do card, monta o kit de implantação a partir do manifesto do trilho (`OnboardingTrilho.observacoes`) e do contexto carregado do cliente, e grava em `03-kickoff` da pasta do cliente (`kit-<cliente>.md` + índice). Botão "Montar kit" no card; mover para "Kit montado" sem kit mostra aviso, não bloqueia. Formato do kit [a decidir]: comece pelo manifesto que existe.
- Não refazer a P6 ("Quem trabalha nesta etapa"): só garantir que ela lê o cadastro novo.

## A4 — Trabalho e pastas (TR-01 a TR-10)

- **TR-04 Criador da pasta do cliente** (novo; sem modelo):
  - `GoogleService` ganha **criar pasta** e **copiar estrutura** (pastas vazias e os `.md` do modelo; nunca move nem apaga nada) e **enviar arquivo binário** a uma pasta. O HTTP do Google continua só no conector; efeitos pela porta, com capacidades novas **`drive.pasta.criar`** e **`drive.arquivo.enviar`**, classificadas pelo `classificar` (escopo: só dentro da raiz `clientes.pasta.raiz`; fora dela = recusa no efeito). Assinatura `POLITICA_CAPACIDADE_NOVA_*` no seed.
  - Migration aditiva: `Partner.pastaDriveId` e `Partner.pastaDriveUrl` (cliente) e o mesmo ponteiro lido pela ficha e pelo card.
  - **7ª escrita `pasta`** no fechamento, depois do `card`, **fora da transação do banco**, idempotente pelo ponteiro: pasta `10-clientes/<nome do cliente>` (nome normalizado, sem CNPJ). As outras duas portas do card ("Iniciar onboarding" e "Registrar cliente já fechado") chamam a mesma função. Falha do Drive não derruba o fechamento: a escrita fica `erro` com o motivo e há "Criar pasta de novo" no card.
  - O card, a ficha e o cliente mostram **"Abrir pasta do cliente"**.
  - Para clientes que já existem: script `scripts/criar-pastas-dos-clientes.ts` com `--simular`/`--valer`, idempotente (pasta de mesmo nome já existente em `10-clientes` é **ligada**, não recriada: na Root já existem `affari`, `custeio`, `curral`, `promedical` e outras).
- **TR-05 Arquivista do cliente** (novo; Haiku 5.5 low, sobe para Sonnet 5.5 quando a confiança for baixa): todo arquivo que chega para um cliente — upload da sala (hoje cai no MinIO sem leitura), anexo de tarefa (TR-06), PDF assinado (CO-08), documento do WhatsApp (CO-16) — é classificado na subpasta certa (`01-comercial` … `07-evidencias`) com nome padrão `AAAA-MM-DD - <tipo> - <título curto>.<ext>` e enviado pela `drive.arquivo.enviar`. Lê nome, tipo e até as 2 primeiras páginas de texto. Confiança baixa → `00` não existe: vai para `_fonte` e vira item na caixa "classificar à mão". Sem pasta do cliente → espera na fila e reage quando a pasta nascer.
- **TR-06 Anexo na tarefa** (novo): upload na tarefa (pop-up `?tarefa=`), tabela nova `WorkAnexo` (filha de `WorkTask`, sentinela + gatilho de `orgId`, RLS FORCE, conte `FILHOS_COM_ORGID_REDUNDANTE`), arquivo no MinIO e cópia na pasta do cliente da tarefa pelo arquivista; lista de anexos com link para o Drive. Tarefa de cliente interno ("Root (interno)") guarda só no MinIO.
- **TR-01 Leitor de atas**: o aceite cria a tarefa **na mesma transação** da sugestão (conserta o "aceita sem tarefa"); a ata aceita de um cliente vai como `.md` para `05-acompanhamento` dele.
- **TR-02 e TR-03**: uma entrada só para reunião do Granola (o webhook do Lucas e o direto gravam a mesma `ReuniaoDoCartao`, deduplicada pelo id do Granola).
- **TR-07 Cobrador de tarefas** (novo; rotina diária 08:30 + Haiku 5.5 low para o texto): por pessoa, tarefas vencidas, sem dono, paradas há mais de N dias na etapa (N na nota `trabalho.cobranca.dias`, padrão 7); vira item na caixa de cada um. Não manda WhatsApp.
- **TR-08 Triagem da caixa** (novo; Haiku 5.5 low): agrupa a atividade de Pendências por cliente e urgência, com a regra decidindo o que é urgente (prazo, aprovação vencendo) e o modelo só agrupando o que não tem cliente explícito. Em lote, com cache por item.
- **TR-09 Delegador** (novo, mínimo; Opus 5.5 high): numa tarefa atribuída a um agente, propõe subtarefas com dono (pessoa ou agente do cadastro) e prazo; tudo nasce como **sugestão** para uma pessoa aceitar (mesmo desenho do `AtaSugestao`). Não atribui nada sozinho. As 22 decisões do plano de controle seguem [a decidir].
- **TR-10**: só cadastro.

## A5 — O agente da agenda (AG-01, novo)

- **Rotina `agenda.vigia`**, a cada 15 min, só na empresa com Google conectado: lê pela porta (leitura R0 que já existe) os eventos da agenda da Root de ontem a +60 dias.
- **Qual evento é reunião**: tem convidado, ou link de Meet, ou o título fala em reunião/call/conversa/kickoff. Bloqueio pessoal e lembrete sem convidado ficam fora, e a regra fica em `agenda.ts` com teste.
- **Conferência** pela gramática de `packages/shared/src/agenda.ts` (`Reunião Online|Presencial - <Cliente> - <Responsável>` e `Reunião Interna - <Sócio ou Todos>`; online sempre com Meet). Responsável só pode ser Rodrigo, Lucas, Pedro ou Todos.
- **Fora do padrão**:
  - A função AG-01 (Haiku 5.5 low) propõe o título certo a partir do título atual, dos convidados (e-mail → cliente pelo `Partner` ou pelo lead; e-mail da casa → responsável), da descrição e do local.
  - O sistema confere a proposta contra a gramática; o que não passa é descartado.
  - Com proposta única e completa, ela entra pela capacidade nova **`agenda.evento.padronizar`**. A capacidade só troca o título e acrescenta o Meet em reunião online. O título antigo vai para a primeira linha da descrição ("Título original: …"). Nunca apaga, nunca muda horário nem convidados.
  - Sem proposta segura: a decisão vai a Pendências ("Esta reunião está fora do padrão: qual é o cliente?"), com as opções.
- **Nível**: pelo `classificar` honesto. Se cair em R2/R3, ela vai à fila de aprovação como qualquer escrita. No RESULTADO, escreva como o Rodrigo deixa o agente agir sozinho por **sobrescrita assinada da política** (o caminho do `docs/AGENDA.md`), sem afrouxar o efeito.
- **Na tela `/agenda`**: selo "N fora do padrão" e a lista com a proposta de cada uma (aprovar aqui leva à mesma porta). Toda correção feita fica no RASTRO.
- Eventos que nascem pelo OS (`agenda.reuniao.marcar`) já nascem certos: o vigia só os confere.

## A6 — Rotinas da casa e Canais e integrações

- **RO-01 a RO-04**: cadastro como `rotina` ou `automacao`, passagem registrada (A1.7), estado verdadeiro. **RO-01 ClickUp**: com o Trabalho dentro do OS e o token revogado desde 25/07, nasce **desligado** (interruptor), sem apagar o código.
- **DigiSac — EXCLUIR**: apagar `comercial/canais/digisac.provider.ts`, `comercial/digisac-entrada.service.ts`, `comercial/digisac.controller.ts`, `gateway/canais/digisac.conector.ts`, `gateway/canais/digisac.port.ts`, `packages/shared/src/digisac.ts`, `apps/web/src/app/conexoes/ConexaoDigisac.tsx`, os testes e o dublê do DigiSac, as variáveis `DIGISAC_*` do compose e as referências em `whatsapp.service.ts`, `comercial.module.ts`, `whatsapp.port.ts`, `canais.module.ts`, `schemas.ts`, `comercial.ts`, `index.ts`, `arquitetura.test.ts` e nos e2e/provas. `WHATSAPP_PROVEDOR` aceita `simulado` e `evolution` (`digisac` passa a ser recusado no arranque com mensagem clara). Credencial do DigiSac no cofre: migration que apaga as linhas do conector `digisac` (só elas).
- **Zapfy — EXCLUIR**: `zapfy.env` sai do `main.ts`; a linha `WhatsApp (Zapfy)` do catálogo vira `WhatsApp (Evolution)`; qualquer outra menção no código vai embora.
- **Evolution**: continua a da P8. Confira que entrada, envio 1:1 e grupo passam pela mesma porta e pelo cartão padrão (abaixo).
- **CA-02 Aprovação pelo WhatsApp**: tela para cadastrar o número de cada pessoa (identidade de canal) na Equipe (A7), em vez de só no banco.
- **CA-05**: `ia-acao@` (A1.9).
- **Integrações num padrão só**:
  - Todo conector do catálogo implementa o contrato único (autorizar, sincronizar, saúde, revogar) e se inscreve no registro. Os que ainda não se inscrevem entram: Granola, Asaas, ZapSign, Pluggy, OFX, Apify, YouTube e Evolution. O conector OpenAI fica só para embeddings e áudio.
  - **Um componente de layout só** em `/conexoes` (`CartaoDeConexao`), usado por todos: nome, para que serve, quais agentes e rotinas usam (vem do cadastro), estado sondado com a hora da medição, conta ligada, última sincronização, credencial no cofre (nunca exibida), e as ações conectar, testar, desconectar e desligar.
  - Os cartões soltos (`ConexaoGranola`, o do Google, o da Evolution) passam a ser instâncias desse componente.
  - As páginas próprias que existirem (`/google`, `/instagram`) ficam, com um link "Configurar em Conexões".
  - Mesma ordem, mesmo vocabulário de estado: **Conectado**, **Não configurado**, **Erro: <motivo>** e **Desligado**.

## A7 — Equipe e catálogo na tela

- **Equipe (`/organograma`)**:
  - Mostra as **três pessoas** (as contas humanas ativas da empresa; contas de máquina, de importação, de teste e desativadas ficam fora da vista, sem apagar nada) e, sob cada uma, os agentes de que ela é dona, por área.
  - Dono editável (`admin` ou `controle`) com auditoria. Número de WhatsApp de cada pessoa (CA-02).
  - Seed fictício: três pessoas de exemplo; na cópia 3030, as reais.
- **`/agentes`** com três abas:
  - **Agentes**: decidem com modelo.
  - **Rotinas**: rodam no relógio, sem modelo.
  - **Automações e integrações**: reagem a evento ou sincronizam.
- **Cada linha das abas**: para que serve, estado (ativo, desligado, só homologação), dono, modelo e esforço (agentes), gatilho e frequência, última e próxima execução (do histórico), gasto do mês (por `agentSlug`/função) e onde mexer.
- **Filtros**: o padrão é "ativos"; há também área e dono.
- **Página**: mantém o que a tela já tem (controle, orçamento, procedimento local do Pedro) dentro da linha do agente.
- **Documentação gerada** (`gerar-documentacao`): sai do mesmo cadastro, com as três seções.

## A8 — Provas, imagem e "Para publicar"

- **Suítes**:
  - Web e API inteiras, sem vermelho novo fora da linha de base.
  - Política com as capacidades novas: `comercial.lead.criar`, `drive.pasta.criar`, `drive.arquivo.enviar` e `agenda.evento.padronizar` (diga o nível de cada uma).
  - Isolamento: `WorkAnexo` e qualquer tabela nova.
  - `tsc` limpo.
  - Catraca de arquitetura: o HTTP do Google e da Evolution só nos conectores; nenhum arquivo do DigiSac sobra (teste que procura `digisac` no código e falha).
- **Stub**: arquivo de resposta para toda função nova (CO-11, CO-13, CO-14, CO-16, IM-07, TR-05, TR-07, TR-08, TR-09, AG-01) e as existentes que ainda não têm.
- **Prova com modelo real pela ponte**:
  - Estenda `homolog/ponte-modelo/ponte.mjs` para respeitar o **modelo pedido** (`--model claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`).
  - `homolog/e2e/agentes-reais.mjs` roda **um caso sintético por função com modelo** das áreas desta rodada + AG-01 (nada de dado real), no modelo do cadastro. Para as funções em Haiku e Sonnet, roda também o modelo de cima e compara (o parser aceitou? quantos campos certos?).
  - Tabela no RESULTADO: função, modelo, passou/falhou, tokens, observação. Função cujo modelo sugerido perde para o de cima vira recomendação de troca, sem trocar sozinho.
- **e2e `homolog/e2e/agentes.mjs`** (3031):
  - fechamento cria a pasta (dublê do Drive);
  - anexo na tarefa vai à subpasta;
  - arquivista classifica;
  - formulário do site cria lead;
  - triagem do WhatsApp pela Evolution (dublê);
  - vigia da agenda acha e propõe;
  - Equipe com 3 pessoas e agentes;
  - `/agentes` com as três abas;
  - `/conexoes` com o cartão único e sem DigiSac.
- **Roteiros de sempre**: rodar os de sempre e o `final.mjs` na 3030.
- **Imagem**: nova nas duas stacks, sem perder dado da 3030. Capturas em escuro, claro e 390 px.
- **Revisor adversarial** no fim:
  - Drive só dentro da raiz;
  - arquivista sem vazar arquivo de um cliente para a pasta de outro;
  - agenda nunca apaga nem muda horário;
  - formulário público com teto e sem injeção;
  - nenhum resto de DigiSac;
  - `ia-acao@` desativada;
  - nenhum segredo no diff.
- **"Para publicar"** no RESULTADO. Ela vai ser executada na hora, sem ninguém revisar antes, então cada item precisa ser comando ou nome exato. O que mudou de banco precisa ser aditivo e reversível pela imagem anterior (diga se alguma migration impede o rollback só de imagem). Itens:
  - migrations novas (nomes);
  - capacidades novas e a assinatura do seed;
  - variáveis: `ANTHROPIC_API_KEY` (a do Rodrigo), `LLM_PROVIDER=anthropic`, `ANTHROPIC_MODEL=claude-opus-5-5`, teto diário sugerido, `WHATSAPP_PROVEDOR=evolution` depois de ligar o número, e as `DIGISAC_*` a **remover** do `final.env`;
  - notas da memória a criar: `clientes.pasta.raiz` = `1OYHyKiE7uJlzWf-u9cRtYyvm8hXnYO0H`, `comercial.contrato.modelo` quando houver;
  - a sequência do `criar-pastas-dos-clientes` (`--simular`, conferir com o Rodrigo, `--valer`);
  - a conferência de que a conta Google da Root (operacao.root@) tem **edição** na pasta `10-clientes`, que está no Drive do Pedro e aparece para a Root como atalho.

## Regras duras

- As de sempre (`docs/comercial/PASSAGEM-PREDATOR-COMERCIAL.md` §0, `CLAUDE.md`).
- Nada em produção daqui. Nada de dado de cliente no git, no log ou no RESULTADO (só contagens).
- Migração aditiva com RLS. A porta e a política não afrouxam para agente.
- Capacidade nova só com o seed assinado. Nunca apagar evento da agenda nem arquivo do Drive.
- Escrita no Drive só dentro da raiz configurada.
- Nada do escritório Cardozo & Saggioro (conta, número, MCP, DigiSac).
- Nunca `docker system prune` nem `taskkill` amplo; os processos `claude` antigos ficam quietos (o Claude Desktop e o VS Code do Rodrigo).
- Commit a cada marco e uma linha em `homolog/progresso.md` ("Agentes 21/10").
- Onde faltar decisão de produto: `[a decidir]` e siga.
