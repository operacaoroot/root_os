# RESULTADO da rodada dos agentes (21/10/2026)

> Roteiro: `docs/comercial/RODADA-AGENTES-20261021.md` (a ata do Rodrigo de 21/10 e o catálogo `docs/agentes/catalogo-levantamento-20261021.json`). Contrato das lanes: `docs/agentes/CONTRATO-DAS-LANES.md`.
> Branch `homolog/final-20261019`, sobre a tag `producao-21b-20261021`. Tag desta rodada: **`agentes-entrega-20261021`**. Bundle delta: `C:\Users\User\dev\agentes-delta.bundle` (`homolog/final-20261019` e a tag, `^producao-21b-20261021`); completo de reserva: `C:\Users\User\dev\rootos-final-completo.bundle`.
> Só homologação, no Predator. **Nada foi à produção.** Este arquivo não tem dado de cliente nem segredo: só contagens. A receita de subida é `docs/comercial/VIRADA-PRODUCAO.md`, seção "A virada da rodada dos agentes".

## 1. Os pedidos da ata

| # | Pedido | O que foi feito | Onde |
|---|---|---|---|
| 1 | Construir os agentes de Comercial, Implantação, Trabalho e pastas, Rotinas da casa e Canais | Cadastro único com as 77 linhas do levantamento, mais AG-01 e TR-11; as funções novas existem (CO-13, CO-14, CO-15, CO-16, IM-07, TR-04 a TR-09, AG-01) e as existentes receberam o que a coluna "o que melhorar" pedia (§3) | `packages/shared/src/agentes.ts` |
| 2 | Um agente da agenda que mantém o padrão | AG-01, rotina `agenda.vigia` a cada 15 min, só na empresa da casa, nasce desligada; propõe pela capacidade `agenda.evento.padronizar` (R3), nunca apaga, nunca muda horário nem convidados, só em evento organizado pela própria agenda | `apps/api/src/agenda/`, `/agenda` |
| 3 | Equipe: só Rodrigo, Lucas e Pedro, com os agentes ao lado | `/organograma` mostra as três pessoas (máquina, sistema, teste, sem papel e desativadas ficam fora da vista, contadas, sem apagar) e, sob cada uma, as funções de que é dona, por área; dono editável com auditoria; o WhatsApp de cada pessoa cadastrado pela tela | `apps/api/src/agents/equipe.*`, `apps/web/src/app/organograma/` |
| 4 | Discriminar agente, rotina e automação | `/agentes` com três abas (Agentes · Rotinas · Automações e integrações), cada linha com para que serve, estado, dono, modelo e esforço efetivos, gatilho, última e próxima execução e gasto do mês; filtros no endereço, padrão "ativos"; o cartão de hoje (controle, orçamento, procedimento local) dentro da linha | `apps/web/src/app/agentes/`, `GET /agents/cadastro` |
| 5 | Integrações num padrão só | Um cartão (`CartaoDeConexao`) para todos os conectores, mesmo vocabulário de estado, quem usa (do cadastro), credencial nunca exibida; Asaas, Pluggy, OFX e Apify entram no contrato único (Granola, YouTube, ZapSign e as duas Evolution já estavam) | `apps/web/src/app/conexoes/`, `GET /integrations/cartoes` |
| 6 | DigiSac e Zapfy excluídos | 10 arquivos apagados, referências fora, `WHATSAPP_PROVEDOR=digisac` derruba o arranque com a frase do que trocar, a credencial do DigiSac sai do cofre (migration), catraca `sem-digisac` | §3, A6 |

## 2. Decisões desta rodada

- **O cadastro é a fonte.** Seeds, tela, Equipe, cartões de conexão, documentação gerada e o provedor de modelo leem `packages/shared/src/agentes.ts`. O código mandou onde o levantamento divergiu (§7).
- **Modelo por função** pelo cadastro: Opus 5.5 para julgamento e texto longo, Sonnet 5.5 para extração e texto curto guiado, Haiku 5.5 para classificar em volume; sem modelo para regra e integração; Fable em nenhum. `LLM_MODELO_<ID>`/`LLM_ESFORCO_<ID>` (ou as listas `LLM_MODELOS_POR_FUNCAO`/`LLM_ESFORCOS_POR_FUNCAO`, que o compose passa ao container) sobrescrevem. O Haiku não recebe `fallbacks`; Opus e Sonnet recebem `fallbacks: "default"`; esforço sempre explícito; thinking adaptativo.
- **Preço:** a tabela da skill `claude-api` manda. Opus 5.5 com cache de leitura a US$ 0,20 (o roteiro dizia 0,40); Haiku 5.5 com as duas faixas (acima de 100 mil tokens de entrada, 0,50/2,50).
- **A régua não afrouxou.** As quatro capacidades novas estão no nível que a escada calcula pelo efeito (§4). O vigia da agenda e o arquivista pedem aprovação; o caminho para o Rodrigo deixar agir sozinho está em §8.
- **Pendências** é uma tabela própria (`Pendencia`): a caixa LÊ, como lê a `ComercialDecisao`, e continua sem fonte própria. Só a pessoa a quem a pendência espera responde, e o tratador exige a permissão do assunto.
- **Pasta do cliente:** criar e ligar passam pela porta (R3). Ligar pasta existente só por nome igual, e nunca uma pasta que já é de outro cliente (índice único).
- **Formulário do site** só aceita lead da empresa que ligou a nota `comercial.formulario.site` (a Root inclusive).
- **`ia-acao@`** desativada por script, nunca apagada.

## 3. As lanes

| Lane | O que entrou | Commits |
|---|---|---|
| 0 · contrato | cadastro único; `funcao` em `LlmMessage`/`LlmStepInput` e nas 26 chamadas; política 1.11.0 com 4 capacidades; `Pendencia`; as portas `PASTA_DO_CLIENTE` e `ARQUIVISTA_DO_CLIENTE`; `Partner.pastaDrive*`; o componente `PastaDoCliente`; a busca na web na interface do modelo | `5aa9e8b`, `0b83ba2` |
| A1 · fundação | os três seeds e a documentação gerada leem do cadastro (o assistente numa definição só, com filtro de módulo; sem R3/R5 de demonstração); modelo e esforço por função no provedor, na ponte e no envelope do teto; preços 5.5; fallback por modelo; `agentSlug` da função em toda chamada e o livro `GastoDeIaPorFuncao`; as cinco rotinas da casa (`casa.clickup`, `casa.vault`, `casa.conciliacao`, `casa.bio`, `casa.metas`) registram cada passagem, e o ClickUp nasce desligado pelo interruptor; vetorização e transcrição no teto do dia; `ia-acao@` fora do seed e o script `desativar-ia-acao`; a ponte respeita modelo e esforço | `cf12b6c` |
| A2 · comercial | CO-11 com resumo de três linhas (número inventado pelo modelo é trocado pela linha do sistema); CO-08 copia o PDF assinado para `02-contrato`; CO-10 com a 7ª escrita `pasta` (e as duas outras portas do card); CO-13 minuta sobre o modelo do Drive, com inserções e lacunas marcadas, nunca inventa número; CO-14 revisor por regras e depois modelo; CO-15 rota pública `POST /api/publico/lead` (teto por origem, isca, CORS só de operacaoroot.com, idempotente, pela porta); CO-16 triagem do WhatsApp atrás de duas chaves | `85d1196` |
| A3 + TR · implantação e trabalho | IM-01 grava `ata.notas` e a ata gerada em `03-kickoff`; IM-02 pelo laço do agente, com busca na web atrás da nota; IM-07 monta o kit; P6 lê o cadastro; TR-01 aceite na mesma transação e ata em `05-acompanhamento`; TR-02/TR-03 numa entrada só, pelo id do Granola; TR-07 cobrador (rotina desligada); TR-08 triagem da caixa com cache; TR-09 delegador por sugestão; pendências na caixa | `883e396` |
| A4 · Drive | conector com criar pasta, copiar estrutura, enviar arquivo, conferir dentro da raiz e padronizar evento; TR-04 pasta do cliente pela porta; TR-05 arquivista com fila, `_fonte` só por pendência e segunda leitura (TR-11); TR-06 `WorkAnexo`; script `criar-pastas-dos-clientes`; "Abrir pasta do cliente" na tela de clientes | `a36ce73` |
| A5 · agenda | regra de reunião e conferência no shared; vigia, rotina, rotas e tela; CLI de sobrescrita (§8) | `28225f2` |
| A6 · canais | DigiSac e Zapfy excluídos; contrato único para Asaas, Pluggy, OFX e Apify; cartão único | `ea5b91f` |
| A7 · equipe e tela | Equipe, dono por função (`DonoDaFuncao`), WhatsApp de cada pessoa, `/agentes` em três abas | `624e1fb` |
| A8 · prova real | `homolog/e2e/agentes-reais.mjs` pela ponte (§5) e as correções que ela revelou | `04aee3f` |
| Revisão adversarial | §6: os 5 de corrigir e os baratos, com teste | `e73b541` |

## 4. As capacidades novas (política 1.11.0)

| Capacidade | Nível | Quem dispara |
|---|---|---|
| `comercial.lead.criar` | **R1** (escreve só dentro do OS); com sinal aceso, R2 retido | formulário do site (CO-15), triagem do WhatsApp (CO-16) |
| `drive.pasta.criar` | **R3** (sai da casa, desfazer à mão); com sinal, R4 | fechamento, Iniciar onboarding, Registrar já fechado, "Criar pasta", script |
| `drive.arquivo.enviar` | **R3** (idem, conteúdo do cliente); com sinal, R4 | arquivista (sala, anexo, contrato assinado, WhatsApp, ata, kit, minuta) |
| `agenda.evento.padronizar` | **R3** (escreve no Google, voltar à mão); com sinal, R4 | vigia da agenda, "Aprovar aqui" na `/agenda` |

Nenhuma tem ferramenta (agente nenhum as chama pelo laço) nem desfazer. Base 16 + delta 74 = **82** no boot.

## 5. Provas

**Suítes** (Postgres descartável na 5440, recém-migrado, política semeada; medidas sobre a integração final, depois dos consertos da revisão):

| Suíte | Resultado | Linha de base (adendo 21B) |
|---|---|---|
| API inteira | 5373 casos: 5007 verdes, 309 vermelhos, 57 pulados (49 arquivos; 7 deles só por carga da máquina, com a imagem compilando junto: rodados sozinhos, 159/159) | 5000: 310 vermelhos |
| Web inteira | 1660: 1595 verdes, 65 vermelhos (8 arquivos) | 1591: 78 vermelhos (9 arquivos) |
| Política | 108/108 | 102/102 |
| Isolamento (papel restrito) | 516/516 | 498/498 |
| Rotas públicas, cofre e dinheiro com RLS | 157/157 | 56 + 97 |
| `tsc` | limpo na API e no web | |

Os 42 arquivos vermelhos de comportamento da API estão todos na linha de base (`homolog/final/suites.md` §4 e os RESULTADOs anteriores: adversarial 19, arquitetura 1, contrato-de-conector 7, memória, vault, pauta, importador do ClickUp, M05 e exercícios que pedem clone próprio), com uma exceção desta rodada já consertada: `reports-prompt` (3), que não conhecia o campo `funcao` (4/4 depois). Na web, os 8 arquivos são da linha de base (agentes-estado intermitente, financeiro, pauta); `conexoes` saiu da lista (refeita, 18/18). Novas da rodada: `agentes-cadastro` 12, `pendencias` 6, `llm-modelo-por-funcao` 18, `llm-preco-e-stub` 12, `llm-envelope-e-teto-externo` 13, `agentes-fundacao-*` 28, `comercial-agentes-*` 59, `agentes-a3-*` 41, `clientes-pasta-e-arquivista` 18, `google-drive-cliente` 16, `work-anexos` 6, `agenda-vigia*` 49, `sem-digisac` 12, `contrato-de-conector-padrao` 33, `conexao-cartoes` 10, `equipe-a7-*` 45; web `agentes-tres-abas` 8, `equipe-a7` 9, `cartao-de-conexao` 14, `caixa-pendencias`, `clientes-pasta-e-anexos` 8, `agenda-vigia` 14.

**Prova com modelo real pela ponte** (`homolog/e2e/agentes-reais.mjs`; detalhe em `homolog/provas/agentes-reais.md`): 180 chamadas, casos sintéticos, construtor de prompt e parser reais de cada função, 3 rodadas; "passou" = parser aceitou e 75% ou mais dos campos certos. Tokens não medidos (a ponte devolve só o texto). Ninguém usou chave de API.

| Função | Modelo | Resultado | Campos certos | Observação |
|---|---|---|---|---|
| CO-03 Leitor de ata do comercial | Opus 5.5 high | passou | 21/21 | nada inventado |
| CO-04 Construtor de proposta | Sonnet 5.5 medium | passou | 11/12 | Opus 12/12; manter |
| CO-06 Assistente da sala | Sonnet 5.5 medium | passou | 9/9 | a injeção foi para uma pessoa |
| CO-11 Vigia das 08h | Haiku 5.5 low | passou | 10/12 | **Sonnet 12/12: troca recomendada** (barata, uma chamada por dia; não urgente, o conferente protege) |
| CO-12 Relator da quinta | Sonnet 5.5 medium | passou | 15/15 | o Opus escreveu número em 2 rodadas; manter |
| CO-13 Construtor de contrato | Opus 5.5 high | passou | 33/33 | |
| CO-14 Revisor de contrato | Opus 5.5 high | passou | 15/15 | achou os 3 defeitos plantados |
| CO-16 Triagem do WhatsApp | Haiku 5.5 low | passou | 15/15 | 5 de 5, inclusive a injeção |
| IM-01 Leitor de ata do onboarding | Opus 5.5 high | passou | 30/30 | senha não reproduzida |
| IM-02 Pesquisador de conta | Opus 5.5 high | passou | 18/18 | pela chamada direta (a ponte não chama ferramenta; o laço e a busca na web só com o provedor `anthropic`) |
| IM-03 Roteirista | Sonnet 5.5 high | passou | 21/21 | |
| IM-07 Montador do kit | Sonnet 5.5 high | passou | 27/27 | |
| TR-01 Leitor de atas | Sonnet 5.5 high | passou | 33/33 | |
| TR-02 Leitor do Granola | Sonnet 5.5 high | passou | 18/21 | o Opus fez 21/21 tratando compromisso da cliente como tarefa; o prompt não decide isso ([a decidir]); manter |
| TR-05 Arquivista | Haiku 5.5 low | passou | 12/12 | |
| TR-11 Arquivista, 2ª leitura | Sonnet 5.5 low | falhou → **passou** | 6/9 → 9/9 | defeito de prompt e limiar (print sem texto em `07-evidencias` com 0,6); depois da correção, nova prova (3 rodadas, `homolog/provas/agentes-reais-tr-05-tr-11.md`): o print sem texto vai a `_fonte` (0,3) e à mão; empata com o Opus: manter. TR-05 de novo 12/12 |
| TR-07 Cobrador | Haiku 5.5 low | passou | 9/9 | |
| TR-08 Triagem da caixa | Haiku 5.5 low | passou | 15/15 | |
| TR-09 Delegador | Opus 5.5 high | passou | 15/15 | |
| AG-01 Vigia da agenda | Haiku 5.5 low | passou | 9/9 | o caso ambíguo foi para a pendência |

Haiku e Sonnet contra o modelo de cima: manter em CO-04, CO-06, CO-12, CO-16, IM-03, IM-07, TR-01, TR-05, TR-07, TR-08, TR-11 e AG-01; **troca recomendada** só no CO-11 (Haiku → Sonnet), pela variável `LLM_MODELOS_POR_FUNCAO=CO-11=claude-sonnet-5-5`, decisão do Rodrigo. Nada foi trocado no cadastro. Correções que a prova revelou e entraram: o esforço da função agora chega ao CLI da ponte (`--effort`); o prompt do arquivista não se contradiz mais sobre print sem texto e o limiar ficou estrito; o texto do padrão no vigia.

**Roteiros e2e** (imagem `rootos-final-app:agentes1`; `agentes.mjs` e `final.mjs` rodados de novo, verdes, na imagem final `rootos-final-app:agentes2`, com os consertos):

| Roteiro | Onde | Resultado |
|---|---|---|
| `agentes.mjs` (novo) | seed, 3031 | **PASSA, 8 passos**: formulário (CORS de operacaoroot.com, outra origem sem CORS, idempotente, isca calada; às 07h de São Paulo o lead ficou retido em R2, como a régua manda); pasta do cliente sem raiz responde `sem_raiz`; anexo (a stack não tem MinIO: 503 com a frase do storage e nada gravado pela metade; o caminho com storage é a suíte `work-anexos`); vigia responde; Equipe com 3 pessoas e 77 funções; `/agentes` com as três abas e o filtro no endereço; `/conexoes` com 20 cartões, vocabulário único e sem DigiSac, a API dos cartões sem credencial; pendências. Fotos `homolog/provas/agentes-*.png` (escuro, claro, 390 px) |
| `final.mjs` | cópia, 3030 | **17/17** (fotos com dado real fora do git) |
| `producao21.mjs` | seed, 3031 | **PASSA, 20 passos** |
| `interface.mjs` | seed, 3031 | **PASSA, 17 passos** |
| `painel.mjs` | seed, 3031 | **PASSA, 13 passos** |

O Drive, a Evolution e o Google Agenda de verdade não existem nas stacks: fechamento criando a pasta, arquivista classificando e enviando, triagem do WhatsApp e vigia propondo estão provados nas suítes com dublê HTTP (`google-drive-cliente`, `clientes-pasta-e-arquivista`, `comercial-agentes-*`, `agenda-vigia`) e com modelo real na prova pela ponte.

**As stacks** (`up -d --no-build api web`, bancos não recriados, política semeada com a assinatura de capacidade nova): `rootos-final` (3030) com 202 tarefas, 19 leads, 18 `Partner`, 8 usuários, 19 listas, 5 pastas e 84 status antes e depois (migrations 102 → 113); ensaiados ali os passos de dado do "Para publicar": a tripulação (`0 criados, 8 atualizados`) e `desativar-ia-acao` (simular, valer, de novo: "nada mudou"). `rootos-final-seed` (3031): seed fictício refeito com as três pessoas de exemplo. **Imagem final nas duas: `rootos-final-app:agentes2`** (a `agentes1` ficou de reserva, sem os consertos da revisão). O vigia da agenda já tinha sido semeado ligado nas stacks pela `agentes1` (o upsert não mexe em linha existente; as stacks rodam com `ROTINAS_CRON=off`); na produção ele nasce desligado.

## 6. Revisão adversarial

Só leitura, sobre `producao-21b-20261021..HEAD`, com três revisores e a conferência do achado no código. Veredito antes dos consertos: **não fecha** (um bloqueio). Os cinco itens de bloqueio e de corrigir, e os baratos, foram consertados com teste (cada teste novo falha no código antigo e passa no novo); com isso a revisão **fecha com ressalvas** (as de §8).

| Achado | Gravidade | Conserto | Onde |
|---|---|---|---|
| Dois clientes de nome parecido podiam ficar ligados à mesma pasta do Drive, e o arquivo de um ir à pasta do outro | bloqueava | o efeito recusa pasta que já é de outro cliente (a frase fica em `pastaDriveErro`), recusa ligar quando a chave do nome casa com mais de um cliente, índice único `Partner(orgId, pastaDriveId)` (migration `20261021380000_pasta_do_cliente_unica`), a fila de aprovação diz "ligar a de mesmo nome ou criar com o modelo"; o script não propõe nome repetido; cliente chamado `_modelo-cliente` é recusado | `clientes/pasta-do-cliente/` |
| O vigia da agenda nascia ligado e em qualquer empresa | corrigir | nasce desligado e só na empresa da casa (`tenants/empresa-da-casa.ts`, o mesmo critério do Obsidian) | `agenda/` |
| O vigia podia trocar o título de um convite de outra agenda | corrigir | o efeito lê `organizer` e recusa quando não é a própria agenda; o vigia não propõe para convite de fora | `google/padronizar-evento.ts`, `agenda/` |
| Qualquer pessoa respondia qualquer pendência | corrigir | só a pessoa a quem ela espera, e cada tratador exige a permissão do assunto, relida no banco (`whatsapp.triagem` → `leads.editar`, `arquivo.classificar` → `tarefas.editar`, `agenda.padrao` → `agenda.editar`, `tarefa.cobranca` → `tarefas.ver`) | `pendencias/` |
| O formulário público aceitava lead de qualquer empresa cujo id se soubesse | corrigir | só com a nota `comercial.formulario.site` = `ligado`; sem ela, o mesmo 404 | `comercial/formulario-do-site/` |
| WhatsApp da Equipe podia ser o número de um lead (desviaria as mensagens dele do comercial) | barato | recusado (409) | `agents/equipe.service.ts` |
| Tipo do arquivo entrava cru no cabeçalho do envio ao Drive | barato | `google/tipo-mime.ts` confere antes | `google/` |
| Nomes de clientes reais em três testes | barato | trocados por fictícios | `apps/api/test/` |
| Comentários dizendo que a semente cria `ia-acao@` | barato | corrigidos | `docker-compose.yml`, `README.md`, `CLAUDE.md` |

Conferido e bom: o Drive só dentro da raiz (atalho resolvido, subida até a raiz com teto, nada apaga nem sobrescreve); o arquivista confere empresa, cliente, chave, hash e aprovação, o modelo nunca escolhe o cliente; a agenda nunca apaga e nunca leva horário, convidados nem recorrência no PATCH; o formulário com IP de `req.ips` (não falsificável por cabeçalho), CORS exato, schema estrito, mesmo 404, nenhuma mensagem, cobrança ou contrato; nenhum resto de DigiSac; `ia-acao@` desativada sem apagar e o login recusa conta inativa; nenhum segredo no diff; as 8 tabelas novas com RLS FORCE e no isolamento.

## 7. Correções que o código pediu ao cadastro

TR-11 entrou (segunda leitura do arquivista, Sonnet 5.5 low); CO-08, CO-10, CO-11, CO-13 (`contexto.arquivo.listar`), CO-15, CO-16, IM-01, IM-02 (sem `contexto.nota.ler`, que não tem efeito ligado), IM-06 e CE-05/CT-02 (no teto), IM-07, TR-08, AG-01, CA-02 e RO-04 (nível R0, a cada 1 min, 8 tarefas e 21 reações) tiveram `onde`, `escreve`, `nivel` ou `paraQueServe` ajustados ao código.

## 8. [a decidir]

- **Dono padrão por área**: Comercial Lucas; Implantação, Rotinas da casa, Canais, Conteúdo, Central e Receitas Pedro; Trabalho e pastas e Agenda Rodrigo; Financeiro Lucas. Troca pela Equipe (hoje só o Admin Master edita: `admin.usuarios` ou `admin.permissoes`; se "controle" deve incluir o Diretor ou ganhar permissão própria, é decisão).
- **O vigia da agenda agir sozinho.** Pela escada, `agenda.evento.padronizar` é R3 e não desce: reversibilidade `manual`. O CLI `node dist/agenda/sobrescrita-da-agenda.cli.js --org root` (simula) e `--valer --como <e-mail do Rodrigo> --motivo "..."` declara a sobrescrita assinada (R2 reversível com `desfazer: agenda.evento.restaurar`), mas hoje a régua recusa (`desfazer-inexistente`): falta a capacidade `agenda.evento.restaurar` e a porta respeitar R2 sem aprovação por empresa. O que já funciona: quem propõe é a rotina, então **uma pessoa** basta para confirmar em `/atendimento`.
- **Drive pede titular na prática.** Fora das 08h–20h e a partir do segundo pedido da hora, `drive.*` sobe a R4 (titular com reautenticação): o script das pastas e os anexos frequentes vão pedir o Rodrigo. Caminhos: aprovação em lote da semana para `drive.arquivo.enviar` (como a MD7) ou sobrescrita assinada.
- **Ligar pasta existente só com nome igual.** Precisa renomear a pasta ou o cliente, ou uma rota "ligar à mão" (que pediria uma capacidade R0 para listar a raiz).
- **Formulário à noite fica retido** (R1 + sinal = R2) e o reenvio idêntico abre outra aprovação (a idempotência vale quando o lead nasce). Liberar à noite é sobrescrita assinada.
- **CO-11 para Sonnet** (§5).
- **TR-02: compromisso da cliente vira tarefa da casa?** O prompt não diz; Sonnet e Opus leem diferente.
- **Formato do kit** (começou pelo manifesto); **aceitar subtarefa sugerida para agente entrega ao agente?**; as 22 decisões do plano de controle do delegador; cache da triagem da caixa em memória do processo.
- **Dados reais antigos no repositório:** `apps/api/prisma/data/*.json` (anterior a esta rodada) tem nomes de clientes e valores reais; não foi mexido.
- **Triagem do WhatsApp** (nasce desligada): o modelo é chamado antes de deduplicar o `mensagemId`, sem teto por remetente, e o texto fica em `Pendencia.dados` sem prazo de retenção. Ligar só depois de decidir isso e o número (instância dedicada da Root).
- **`meta` continua aceito** em `WHATSAPP_PROVEDOR` (o esqueleto da K08-4).
- **Tokens de sessão já emitidos** para `ia-acao@` valem até expirar (8 h): o guarda não relê `isActive`.
- **Teto de IA da Root:** sugerido US$ 10 por dia, ligado (VIRADA, A6).
- **IM-03 sem parte pura** (prompt e parser dentro do serviço); extrair como as outras.
- **CE-04** (procedimento local): os agentes reais são `procedimento-<nome>`, criados pela tela; aparecem como "fora do cadastro".
- Herda os [a decidir] das RESULTADO-PRODUCAO-21 e 21B.

## 9. Para publicar (orquestrador do Mac)

A sequência exata, com os comandos, é `docs/comercial/VIRADA-PRODUCAO.md`, seção **"A virada da rodada dos agentes"** (passos A0 a A11). O resumo, para conferir antes:

1. **Imagem** a partir da tag `agentes-entrega-20261021` (contém `producao-21b-20261021`).
2. **Migrations** (o `migrate deploy` do container aplica, na ordem): `20261021300000_pendencia`, `20261021300100_pasta_do_cliente`, `20261021310000_gasto_de_ia_por_funcao`, `20261021320000_minuta_do_contrato`, `20261021330000_arquivo_do_cliente_e_anexo`, `20261021340000_reuniao_do_granola_id`, `20261021340100_delegacao_sugestao`, `20261021350000_agenda_conferencia`, `20261021360000_cofre_sem_digisac`, `20261021370000_dono_da_funcao`, `20261021380000_pasta_do_cliente_unica`. Todas aditivas (8 tabelas novas com RLS FORCE, colunas nulas, índices), **menos a `20261021360000`, que apaga só as credenciais do conector `digisac` no cofre** (irreversível; a Root nunca ligou uma conta DigiSac). Rollback só de imagem: possível, voltando também `ANTHROPIC_MODEL` (a imagem anterior não tem `claude-opus-5-5` no preço e o teto recusaria); a minuta de contrato, se já existir, confunde a imagem anterior.
3. **Política 1.11.0, ANTES da subida:** `pnpm db:seed:politica` com `POLITICA_CAPACIDADE_NOVA_AUTOR='<quem responde>'` e `POLITICA_CAPACIDADE_NOVA_MOTIVO='Rodada dos agentes 21/10/2026: comercial.lead.criar (R1, formulário do site e triagem do WhatsApp), drive.pasta.criar e drive.arquivo.enviar (R3, pasta do cliente e arquivista), agenda.evento.padronizar (R3, vigia da agenda); e contexto.arquivo.ler (R0) se ainda não estava'`. Esperado: `4 criadas, 78 atualizadas, 82 no total`; o boot diz 82 capacidades.
4. **Variáveis** (bloco `environment:` do `api` no compose do painel **e** aba Ambiente): `ANTHROPIC_API_KEY=<chave do Rodrigo>` (posta por ele), `LLM_PROVIDER=anthropic`, `ANTHROPIC_MODEL=claude-opus-5-5`; novas e opcionais, vazias: `LLM_MODELOS_POR_FUNCAO`, `LLM_ESFORCOS_POR_FUNCAO`; `WHATSAPP_PROVEDOR=simulado` (`evolution` depois de ligar o número; `digisac` derruba o arranque). **Remover** do compose, da aba Ambiente e do `final.env`: `DIGISAC_URL`, `DIGISAC_TOKEN`, `DIGISAC_SERVICE_ID`, `DIGISAC_WEBHOOK_SEGREDO`, `MCP_ACTION_PASSWORD`, `MCP_ACTION_EMAIL`. Teto diário sugerido US$ 10 (o `insert` está na VIRADA, A6).
5. **Depois da subida, no container:** `node dist/scripts/desativar-ia-acao.js` (simula), `--valer`, de novo (nada muda); `pnpm db:seed:tripulacao`. Nenhuma permissão nova (não rode `db:sync-permissions`).
6. **Notas da memória** (pela API, como gente, procedência `operador`, nunca restritas): `clientes.pasta.raiz` = `1OYHyKiE7uJlzWf-u9cRtYyvm8hXnYO0H`; quando houver: `comercial.contrato.modelo` (o nome do arquivo do modelo de contrato da Root), `comercial.formulario.site` = `ligado` (quando o snippet de `docs/comercial/FORMULARIO-DO-SITE.md` entrar no site, com a chave `k` = o id da empresa `root`), `comercial.whatsapp.triagem` = `ligada` (só com a Evolution), `onboarding.pesquisa.web` = `ligada`, `trabalho.cobranca.dias`.
7. **A pasta 10-clientes:** conferir que a conta Google da Root (`operacao.root@`) tem **Editor** na pasta real `Root/10-clientes` (está no Drive do Pedro e aparece para a Root como atalho) e que `_modelo-cliente` está dentro dela.
8. **As pastas dos clientes:** `criar-pastas-dos-clientes.js --org root --detalhe /tmp/pastas-simular.md`; conferir com o Rodrigo; `--como <e-mail do Rodrigo> --valer --detalhe /tmp/pastas-valer.md` entre 08h e 20h; outra pessoa confirma cada pedido em `/atendimento`; `--simular` de novo dá zero.
9. **Equipe:** cada sócio cadastra o próprio WhatsApp (como o WhatsApp mostra o número).
10. **Avisar a operação:** o ClickUp da `root` aparece **Desligado** em Conexões depois da primeira passagem (religar é decisão de gente); o vigia da agenda e o cobrador de tarefas nascem desligados em `/rotinas`.
11. **Conferências:** VIRADA, A10.

## 10. Apagar depois

Ninguém apagou nada nesta rodada. Herda as listas das RESULTADO-PRODUCAO-21 e 21B, mais:

- Imagens `rootos-final-app:adendo21` (a de antes; guardar até a virada), as intermediárias sem tag dos builds desta rodada.
- Bancos de teste no Postgres 5440 (fictícios): `rootos_ag0_test`, `rootos_ag_a1_test` a `rootos_ag_a7_test`, `rootos_ag_a3_test_rls`, `rootos_ag_a4_test_rls`, `rootos_ag_a5_test_rls`, `rootos_ag_a7_test_rls`, `rootos_ag_fix_test`, `rootos_ag_full_test`, `rootos_ag_full_test_rls`.
- `C:\Users\User\dev\scratch-agentes\` (o gerador do cadastro, logs das suítes, `suites.sh`) e os arquivos `a4-*.mjs`/`a4-detalhe.md` (sintéticos) em `C:\Users\User\dev\`.
- Worktrees dos agentes desta rodada em `.claude/worktrees/` (branches `worktree-agent-*` integradas).
- Na 3031: o lead fictício do e2e (retido em R2, com duas aprovações pendentes) e os leads e o evento das passadas anteriores.

Para voltar: `rootos-final-app:adendo21` segue no Docker. Troque a tag nos dois `docker-compose.final*.yml` e rode `up -d --no-build api web` **num shell sem as variáveis de outra stack exportadas**.
