# RESULTADO dos ajustes da versão final (19 e 20/10/2026)

> Branch `homolog/final-20261019`, sobre a tag `final-entrega-20261020` (17b95d24). Tag `final-ajustes-20261020`. Bundle delta `C:\Users\User\dev\ajustes-delta.bundle` (`homolog/final-20261019` e a tag, `^17b95d24`).
> Roteiro: `docs/comercial/RODADA-AJUSTES-20261019.md` (as respostas do Rodrigo aos quatro pontos em aberto do `homolog/RESULTADO-FINAL.md`). Registro marco a marco: `homolog/progresso.md` (linhas "Ajustes da final").
> Só homologação, no Predator. **Nada foi à produção.** Este arquivo não tem dado de cliente nem segredo.

## 1. As quatro respostas e o que foi feito

| # | Resposta do Rodrigo | O que foi feito |
|---|---|---|
| 1 | Textos operacionais do Pedro entram se não interferirem; se contradisserem, vale o da branch | §A1 |
| 2 | Iniciar um onboarding sem o lead ter chegado em negócio fechado | §A2 |
| 3 | Tarefas dentro de Marketing e de Financeiro ficam como estão | **não mexido** (nenhum arquivo dessas telas no diff desta rodada) |
| 4 | Pendências fica no menu | **não mexido** (`nav.ts` sem mudança de item nesta rodada) |

## A1. Os textos do Pedro

Fonte: `pedro/operacao-painel-20261014` (7ed42fb), comparada com a branch. Entre 7ed42fb e o snapshot f5552402 só diferem textos (nenhum código). Critério: entra o que é informação nova e não contradiz o que as rodadas de 13 a 19/10 escreveram (`CLAUDE.md`, `docs/comercial/*`, `docs/comercial/VIRADA-PRODUCAO.md`, `.env.example`); onde contradiz, fica o da branch. Commit 9f530dc.

| Arquivo | Trecho do Pedro (resumo) | Entrou / ficou de fora | Porquê |
|---|---|---|---|
| `AGENTS.md` (novo) | Título e "Autorização de Pedro em 11/10/2026: Rodrigo assume o desenvolvimento" | entrou | fato, não contradiz |
| `AGENTS.md` · Trabalho autorizado §1 | quem pode implementar, fazer commit, push, merge na main, migrations, deploy e rollback na VPS sem nova aprovação a cada etapa | **ficou de fora** | contradiz a branch em quem pode fazer merge e deploy e quando: no Predator nada vai à `main` nem ao GitHub (`PASSAGEM-PREDATOR-COMERCIAL.md` §0), nada vai à produção nesta frente, e a virada é do Rodrigo e do Pedro depois da validação, com a política assinada por quem responde (`VIRADA-PRODUCAO.md`) |
| `AGENTS.md` · Trabalho autorizado §2 | a autorização vale entre sessões e substitui exigências anteriores de aprovação e confirmação, inclusive as de skills e roteiros | **ficou de fora** | anularia as regras duras dos roteiros desta frente (confirmação antes de produção, nada na `main`, nada fora do Predator) |
| `AGENTS.md` · Trabalho autorizado §3 | Rodrigo coordena; conferir branch e diff dos demais; preservar trabalho; testes proporcionais; recuperação antes de migration e deploy; registrar commit e pendência | entrou | é o que a branch já pratica |
| `AGENTS.md` · Alcance §1 | não concede acesso a pessoas novas, não autoriza apagar dados nem trabalho alheio, preserva segredos e controles; aprovações de negócio continuam com a operação | entrou | coerente com a regra de não apagar e com a régua |
| `AGENTS.md` · Alcance §2 | não usar o documento para desligar controles nem contornar SSH, GitHub ou provedores; bloqueio técnico se descreve | entrou, **menos a última frase** ("não confunda esse bloqueio com falta de autorização para desenvolver ou publicar código") | o resto é coerente; a última frase pode ser lida como licença de publicar sem nova confirmação, que é o ponto em que a branch é a referência (revisão adversarial, achado 10) |
| `AGENTS.md` · Referência de produção §1 | endereço `os.operacaoroot.com`, projeto Compose `root_marketing-os` no diretório do easyPanel, conferir containers e a cadeia de compose antes do deploy | entrou | é o mesmo que o `VIRADA-PRODUCAO.md` diz |
| `AGENTS.md` · Referência de produção §2 | `/srv/marketing-os` e `/srv/rootos/ferramenta` são checkouts antigos; checkout local do Pedro; documentos de setembro são históricos, não proibições | **ficou de fora** | o `VIRADA-PRODUCAO.md` constrói a imagem em `/srv/projetos/root_os`, para onde `/srv/marketing-os` aponta; e "setembro é histórico, não proibição" afrouxaria regras de setembro que a branch mantém (Syncthing, política antes da subida) |
| `CLAUDE.md`, `README.md`, `docs/DEPLOY.md`, `docs/PLANO-CONTINUIDADE.md` · cabeçalho "Autorização vigente" §1 | "Leia AGENTS.md" e "Preserve dados, segredos e trabalho dos demais" | entrou | coerente |
| os mesmos · cabeçalho §1 | as duas frases da autorização (merge e deploy sem nova aprovação; substitui confirmações anteriores, inclusive de skills) | **ficou de fora** | o mesmo motivo do §1 e §2 do `AGENTS.md` |
| os mesmos · cabeçalho §2 | as descrições antigas de produção são históricas; conferir o ambiente efetivo pelo `AGENTS.md` antes de receita de deploy | entrou, com uma frase da branch: a receita de subida desta branch é o `VIRADA-PRODUCAO.md` | coerente: a seção "Onde roda" do `CLAUDE.md` e o `docs/DEPLOY.md` descrevem o `/srv/marketing-os` de setembro, e o VIRADA já sobe pelo easyPanel |
| `CLAUDE.md` · parágrafo `/conteudo` × banco de ideias | "Nenhuma tela foi apagada e `ROTAS_ABSORVIDAS` não ganhou entrada" | **ficou de fora** (fica o da branch) | contradiz a rodada do painel de 18/10, que ocultou `/conteudo`, `/marketing/ideias`, `/marketing/estrategia`, `/leads`, `/funil` e `/tarefas` com entrada em `ROTAS_ABSORVIDAS` |
| `CLAUDE.md` · Banco de atas e Pastas | ausentes no do Pedro | ficam os da branch | são da rodada do painel (P2, P3) |
| `.env.example` | 7ed42fb não tem variável que falte na branch; as 5 linhas que o snapshot f5552402 acrescenta (`PROPOSTAS_URL`, `PROPOSTAS_API_TOKEN` e o comentário) já estão na branch, iguais | nada a trazer | a branch já é o superconjunto |

Conferido: nenhum token, senha ou chave entrou (varredura do diff por `token`, `senha`, `password`, `secret`, `aact_`, `sk-`: nada).

## A2. Iniciar o onboarding antes do negócio fechado

A terceira porta da Implantação, sempre a partir de um lead do funil. Commits b71c0bd, e822308, f814a31, ee0b947 (lane A2) e 2ac511f (conserto da revisão).

| Ponto do roteiro | Como ficou |
|---|---|
| Onde se clica | **"Iniciar onboarding"** no painel do lead (aba Fio), visível só com `leads.editar` e `tarefas.editar`, antes de fechado e fora das saídas; e no topo da Implantação, que abre a busca de leads elegíveis do funil (`GET /comercial/onboarding-antecipado/elegiveis`). Nenhum dos dois cria cartão sem lead; a porta única do Trabalho continua recusando cartão avulso na lista "Onboarding de cliente" |
| Rota | `POST /comercial/leads/:leadId/onboarding-antecipado` `{etapa?}`. Leitura das etapas de entrada em `GET /comercial/onboarding-antecipado/etapas` |
| Etapa de entrada | escolhida no ato, padrão "Kickoff marcado"; "Fechado no comercial" (o lead não fechou) e "Encerrado" são recusadas, como etapa inexistente |
| O que cria | numa transação sob o cadeado do lead (`pg_advisory_xact_lock`): o trilho (`TrilhoService.criarNaTransacao`, a mesma criação do fechamento), o `Partner` cliente, o card pela MESMA `abrirCardDaImplantacao` com o MESMO id derivado do lead, os retrolinks `ComercialFicha.cardId`/`trilhoId` e `OnboardingTrilho.cardId`, o fato `implantacao.iniciada_antes_do_fechamento` no fio e a linha `work.task.create` na auditoria com a pessoa como ator. Dados copiados da ficha; o que falta fica `[a decidir]` |
| Selo | "Iniciado antes do fechamento · lead em <etapa>", **sem coluna nova**: `seloDoCard` lê o fio e a ficha, pelo mesmo caminho do selo "criado pelo fechamento" |
| Cliente (T4) | dedupe: o `Partner` da ficha, o CNPJ entre clientes, o nome normalizado (a régua do "Novo cliente"), senão cria. **Telefone e e-mail sozinhos não ligam cliente** (revisão, achado 1: o contador partilhado unia duas empresas). Fornecedor nunca vira cliente |
| Quando o lead fecha depois | o fechamento toma o mesmo cadeado, reaproveita o card, o trilho e o `Partner` da ficha (este só se o CNPJ for o do aceite, ou vazio e de mais ninguém; senão vale a D-12 e fica o aviso `cliente.a_conciliar` na escrita, no fio e no card), tira o selo e comenta no card uma vez por chave (`implantacao.fechamento_registrado`), sem mover a etapa. Com fechamento pendente ou em curso, iniciar é 409 |
| Lead que sai do funil | o card fica, com o aviso "lead saiu do funil: <motivo>" no selo (cor de alerta) e num comentário, uma vez por saída. Nada é apagado nem arquivado |
| Quem | só gente: `SoGenteGuard` do mover do funil, a pessoa relida no banco e `exigirAcessoAtual` com as duas permissões. Conta de máquina e agente: 403. Lead fechado, em saída (perdido, desqualificado, geladeira) ou parceiro: recusa com o motivo, também quando o card antecipado já existe |
| Nível | `EFEITO_DE_INICIAR_ONBOARDING` pela escada, como o encerrar contrato da T8: tudo dentro do OS, sem mensagem, cobrança nem documento, dá **R0**, sem segunda pessoa; se a conta subir, a rota recusa |
| O que não mudou | sem migration, sem permissão nova, sem capacidade nova, sem variável nova; política, porta, aprovações, `nav.ts` e prisma fora do diff. A rota antiga de criar trilho segue viva |

## A3. Provas

**Suíte nova da API** `comercial-onboarding-antecipado.test.ts`: **26/26** (Postgres descartável). Cobre: iniciar em lead em proposta (card na lista e na etapa certas, selo, `Partner`, trilho, fato no fio); iniciar duas vezes (um card, um trilho, um `Partner`, um fato); fechar depois (o mesmo card, sem selo, comentário do fechamento, nenhum `Partner` nem trilho novo, e fechar duas vezes também não duplica); lead perdido (card fica com aviso); conta de máquina e agente (403); lead fechado ou em saída (recusa com motivo, com e sem card); etapa recusada; dedupe por CNPJ e nome, fornecedor não promovido; e os casos da revisão: contador partilhado, CNPJ de outro cliente, cliente da ficha com outro CNPJ, 6 corridas iniciar × fechamento, fechamento a caminho (409), pool de 2 conexões, permissão tirada no banco, e a varredura final de CNPJ repetido. Web: teste de componente do botão 5/5.

**Suítes** (lane A2 e revisor, depois do conserto):

| Suíte | Resultado |
|---|---|
| API: comercial inteiro, dinheiro, fechado-fora, jornada, revisões p2 e p3, work-cliente, quadro-movimento, work-final-f4, esteira, onboarding-trilho | 542 casos, 525 verdes; os 17 vermelhos são da linha de base (16 de `comercial-exercicio`, que pede `ROOTOS_QA_PREVIEW=1`, e 1 de `comercial-seed`; este não estava na linha de base, e foi provado que **o código da tag `final-entrega-20261020` falha igual na mesma hora** (cópia por `git archive` fora do repositório, banco novo, 02:38: 142 contra 139 eventos e 7 contra 6 decisões nos dois). A causa é da semente: a validade da proposta semeada entra no hash da versão pelo dia de São Paulo da publicação (`agora − 3 h − 5 dias` na Mercado Bom Preço, `agora − 6 dias` na Rede Pão Bom), e com os dois relógios do teste essas datas caem em dias diferentes mais ou menos das 23h às 5h. De dia passa (139 e 6). Não foi consertado nesta rodada: é do seed, fora do roteiro) |
| API inteira (antes do conserto) | 4785 casos, 291 vermelhos: os 269 da linha de base + 20 de `vault-colecao` (os da produção, que em banco novo aparecem caso a caso em vez de 1 de carga) + 1 tempo esgotado sob carga + o `comercial-seed` da meia-noite. Nenhum arquivo vermelho fora da linha de base |
| Web inteira | 1405 casos, 77 vermelhos: os mesmos 9 arquivos e contagens da linha de base |
| Política | 101/101 |
| `tsc` da API, da config de teste e do web | limpos |
| Revisor, provas próprias no contrato novo | 13/13; casa 253/254 (o vermelho é a catraca `arquitetura` pelo arquivo do Pedro, já na linha de base) |

**Revisão adversarial** (`homolog/revisao/ajustes-adversarial.md`): primeira passada **não fecha** (1 bloqueia: o contador partilhado ligava o lead ao cliente errado e o contrato nascia nele; 2 a corrigir: CNPJ repetido, corrida que duplicava o trilho). Depois de 2ac511f e 9e71517, **fecha com ressalvas**: 1, 2, 3, 4, 5a, 9 e 10 consertados, sem regressão no fechamento normal, no fechado fora nem no `criarNaTransacao`. Ficam registrados: 5b (empresa sem o módulo `trabalho` ganha card, como no fechamento de hoje: decisão de produto) e N1 (um cliente antigo de mesma razão social e sem CNPJ ainda é achado pelo nome, e o fechamento grava nele o CNPJ do aceite; é a regra do "Novo cliente"; fechar seria gravar CNPJ só no `Partner` que o próprio antecipado criou).

**Roteiros e2e na imagem dos ajustes** (`rootos-final-app:ajustes2`, com o conserto 2ac511f; a `ajustes1`, sem ele, passou pelos mesmos roteiros antes):

| Roteiro | Onde | Resultado |
|---|---|---|
| `onboarding-antecipado.mjs` (novo) | seed, 3031 | PASSA, 10 passos, 7,8 s: lead em Follow-up com proposta → "Iniciar onboarding" no painel (etapa padrão Kickoff marcado) → card na Implantação com o selo, cliente e o fato no fio → o pop-up abre o trilho ligado → aceite na sala, cobrança e contrato pela porta (R4 com senha), Pix e assinatura nos dublês → fechamento com as seis escritas, `cliente`, `kit_e_trilho`, `card` e `cobranca` reaproveitados → um card só, na mesma etapa, sem o selo, com o comentário e o fato do fechamento. Rodado duas vezes (Rede Pão Bom na `ajustes1`, Construtora Alicerce na `ajustes2`) |
| `ux-painel.mjs` | seed | PASSA, 13 passos |
| `painel.mjs` | seed | PASSA, 16 passos, 36 s |
| `jornada-docker.mjs` | seed | PASSA inteira, 23 passos, 13 toques humanos (rodada às 10h06: antes das 10h ela para de propósito, porque a M3 só sai 24 h antes do primeiro horário oferecido) |
| `implantacao.mjs` | seed | PASSA, 14 passos, 85 s |
| `trabalho.mjs` (com `trabalho-t7` e `trabalho-t1b`) | seed | PASSA com os avisos de sempre (T1b sem storage; nenhuma decisão pendente no seed): T7 com R3 na linha, R4 com senha e "Pedir de novo" na vencida. Numa passada de madrugada ele caiu em "nenhum contrato vivo ativo": o T8 conclui um contrato por passada e o seed só tinha o que a passada anterior já tinha concluído (condição do dado; voltou a passar com o contrato que o roteiro novo fechou) |
| `final.mjs` | cópia, 3030 | **17 de 17**, 43 fotos fora do git (`homolog/organizar/ajustes-final/`) |

**As stacks** (imagem nova sem perder dado): `rootos-final` (3030) e `rootos-final-seed` (3031) recriadas só nos serviços `api` e `web`, com `--no-build`. Nenhuma migration nova (98 aplicadas, "No pending migrations"); na 3030 as contagens ficaram iguais antes e depois da troca (98 migrations, 202 tarefas, 19 leads, 18 `Partner`). Para voltar: `rootos-final-app:final3` (3030) e `final2` (3031) seguem no Docker.

**A virada** (`docs/comercial/VIRADA-PRODUCAO.md`): sobe a tag `final-ajustes-20261020`; o `final.bundle` foi refeito com ela. Nada mais muda no roteiro: sem migration, variável, capacidade ou permissão nova.

## Onde ver

| O quê | Onde |
|---|---|
| A versão final com a cópia de 19/10 organizada, com os ajustes | `rootos-final`: web `http://100.95.41.124:3030` (e `127.0.0.1:3030`), imagem `rootos-final-app:ajustes2`, login como na `RESULTADO-FINAL` §1 |
| Com o seed fictício (onde os roteiros rodaram) | `rootos-final-seed`: web `http://127.0.0.1:3031`, imagem `ajustes2`. A Rede Pão Bom e a Construtora Alicerce terminaram fechadas pelo roteiro novo; os leads elegíveis que sobraram no seed estão em etapas anteriores (sessão, diagnóstico, reunião) |
| Onde clicar | painel do lead › aba Fio › "Iniciar onboarding"; ou Trabalho › Clientes › Onboarding de cliente (Implantação) › "Iniciar onboarding" no topo |

## Para o Rodrigo decidir

- **Empresa sem o módulo `trabalho`** ganha o card na Implantação pela porta nova, como já ganha pelo fechamento (revisão 5b). Exigir o módulo nas duas portas ou deixar como está.
- **Cliente antigo de mesma razão social e sem CNPJ** é achado pelo nome no onboarding antecipado, e o fechamento grava nele o CNPJ do aceite (revisão N1). É a regra do "Novo cliente" do Trabalho; fechar seria gravar o CNPJ só no `Partner` que o próprio antecipado criou e avisar nos outros casos.
- **O aviso `cliente.a_conciliar`** aparece quando o lead do antecipado ficou ligado a um cliente e o aceite trouxe outro CNPJ: alguém concilia à mão (os dois cadastros ficam; nada é apagado).
- **O `comercial-seed` de madrugada** (das 23h às 5h, mais ou menos) é defeito da semente que já estava na tag; consertar é fixar o dia da validade da proposta semeada.

## A tag e o bundle

`final-ajustes-20261020` aponta para o commit que traz este arquivo (`git rev-parse final-ajustes-20261020^{commit}`). Bundle delta `C:\Users\User\dev\ajustes-delta.bundle` com `homolog/final-20261019` e a tag, pré-requisito 17b95d24 (`final-entrega-20261020`). O `C:\Users\User\dev\final.bundle` (`main..homolog/final-20261019`, com a tag nova) foi refeito para a virada. Nada foi apagado nesta rodada; o que sobra para apagar depois é a lista da `RESULTADO-FINAL` §9 mais: as imagens `rootos-final-app:ajustes1` e `ajustes2` (depois da virada), os bancos de teste `rootos_ajustes_test`, `rootos_ajustes_rev_test` e `rootos_ajustes_tag_test` (5440, fictícios), as pastas `C:\Users\User\dev\ajustes-tag-wt` e `C:\Users\User\dev\ajustes-rev-tmp`, os rascunhos `C:\Users\User\dev\scratch-ajustes-*` (um deles guarda o link da sala da Alicerce do seed, dado fictício) e `homolog/organizar/ajustes-final/` (fotos com dado real).
