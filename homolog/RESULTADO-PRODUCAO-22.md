# RESULTADO da rodada de produção 2, melhorias (21 a 22/10/2026)

> Roteiro: `docs/comercial/RODADA-PRODUCAO-20261022.md` (o backlog que as três rodadas de 21/10 deixaram). Branch `homolog/final-20261019`, sobre a tag `agentes-publicar-20261021-v2` (o que está em produção). Tag desta rodada: **`producao-22-20261022`**. Bundle delta: `C:\Users\User\dev\producao22-delta.bundle` (`homolog/final-20261019` e a tag, `^agentes-publicar-20261021-v2`).
> Só homologação, no Predator. **Nada foi à produção.** Este arquivo não tem dado de cliente nem segredo: só contagens. Quem publica é o orquestrador do Mac, pela cadeia de releases (§7).

## 1. O que entrou

| Lane | Pedido | O que foi feito | Onde |
|---|---|---|---|
| M1 · S1 | Próxima reunião no cartão da Implantação | A agenda é lida UMA vez por empresa pela porta (`comunicacao.agenda.periodo`, R0, que já existia), próximos 14 dias, cache de 5 min no processo. Casa o evento com o card pelo e-mail do contato (trilho, lead ou cliente) entre os participantes; sem isso, pelo nome do cliente igual ao do título no padrão da Root; dois cards possíveis, nome parcial ou e-mail e título apontando para cards diferentes = não casa. Cartão: "reunião dd/mm" com dia da semana e hora de São Paulo no balão. Agenda fora do ar: o quadro fica de pé e o painel diz "Agenda indisponível". Só aparece para quem tem `dashboard.ver` (a permissão da rota da agenda) | `apps/api/src/implantacao/` (`proxima-reuniao.ts` puro), `ImplantacaoDoCartao.tsx` |
| M1 · S2 | Etapa do card × fase do trilho | Mapa fixo no `shared` com as sete etapas do modelo (Fechado no comercial → qualificar ou diagnóstico; Kickoff marcado, Kit montado e Contexto carregado → contrato; Imersão → imersão; Operação assistida → operação; Encerrado sem fase). Divergindo: selo "fase do trilho: N de 5" no cartão (também no compacto, a densidade padrão) e a frase no painel. Só leitura | `packages/shared/src/implantacao-do-cartao.ts` |
| M1 · S3 | "Pedir agora" | Leitor de ata e pesquisador de conta abrem a bancada com `?foco=ata`/`?foco=dossie`, o roteirista o roteiro com `?foco=personalizar`, o montador do kit rola até o kit; desabilitado com a razão (desligado no cadastro, parado em Agentes, trilho encerrado, sem `tarefas.editar`). Com `?foco` a bancada mostra a seção mesmo fora da fase de costume, com o aviso | `QuemTrabalhaNaEtapa.tsx`, `BancadaDoTrilho.tsx` |
| M1 · S4 | Limite por etapa | Menu da coluna "Limite de cartões nesta etapa": `PATCH /trabalho/statuses/:id/limite` `{limite, esperado}`, só gente (token e banco), 409 se mudou, auditado com antes e depois. O editor de etapas antigo também passou a exigir gente para mudar o limite. A coluna acima do limite já ficava marcada (`4/1`). Nenhum número definido | `apps/api/src/implantacao/limite-da-etapa.service.ts`, `LimiteDaColuna.tsx`, `work.service.ts` |
| M1 · S5 | O relógio no Dia a dia | Cartão "Implantação" na Visão geral: sem próximo passo, passo vencido (a regra do relógio, só lendo os trilhos) e sem reunião marcada (do S1); cada linha leva a `/trabalho/implantacao?pendencia=…` (filtro novo); sem pendência, "Implantação em dia" | `ImplantacaoNoDiaADia.tsx`, `PendenciaDaImplantacao.tsx` |
| M2 · S6 | PDF do contrato importado | "Anexar o PDF" no cartão de Contratos vivos e no bloco do painel do lead: o MESMO armazém e o MESMO fato `contrato.anexado` do "Registrar cliente já fechado" (o comum foi para `anexo-do-contrato.ts`), `procedencia: 'importado'`; outro PDF = versão nova (a anterior fica no fio), o mesmo PDF não grava nada; `%PDF-` conferido, 10 MB. O aviso some e a tela mostra nome, tamanho e data. Só gente com `leads.editar`, auditado | `apps/api/src/comercial/contrato-importado*.ts`, `ContratosImportados.tsx` |
| M2 · S7 | Parcelas à mão | Bloco "Parcelas" no painel do lead (aba Dinheiro): série mensal ou linha a linha, centavos inteiros, dias de São Paulo, soma na tela, versão condicionada (409). Régua DESLIGADA por padrão; "Ligar a régua de cobrança deste contrato" é escrita de gente auditada (a régua de hoje é a tarefa `dinheiro.regua` do relógio, sem porta; R0 pela escada), com a frase do que acontece e a ciência; ligada, a mesma régua avisa as parcelas (D-3 a D+10, decisão no D+10) e elas não se editam mais. Nenhuma cobrança no Asaas, `Contract`, mensagem ou aprovação nasce | `ParcelasDoImportado.tsx`, `contrato-vivo.service.ts` |
| M3 | Desarquivar | Seção recolhida "Arquivadas (N)" na árvore (nome, data, por quem pela auditoria, quantas tarefas, onde estava); a lista volta à pasta (ou a Sem pasta, dito na tela, se a mãe segue arquivada); a pasta volta com o que foi arquivado no mesmo instante; nome repetido recusado; só gente, auditado | `GET /trabalho/arquivadas`, `POST …/desarquivar`, `ArquivadasDaArvore.tsx` |
| M3 | Arrastar pasta para dentro de pasta | Soltar SOBRE a pasta põe dentro; soltar na faixa ENTRE reordena; "⋯ › Mover para…" pelo teclado; ciclo e 4 níveis conferidos no servidor; Clientes protegida | `POST /trabalho/pastas/:id/mover`, `ArvoreDoTrabalho.tsx` |
| M3 | Três consertos | "+ tarefa" do Comercial recusa título repetido (mesma regra e frase do Dia a dia, no `shared`); a próxima ocorrência de tarefa recorrente herda `leadId` em qualquer tela; mover tarefas copia o valor de campo de mesmo nome e tipo e avisa "N valores de campos sem equivalente ficaram guardados na lista de origem" | `work.service.ts`, `tarefas-do-comercial.service.ts`, `ExcluirDaArvore.tsx` |
| M4 | Segurança e robustez | O guarda relê `isActive` (cache de 60 s por empresa e usuário); segredo do webhook da Evolution por empresa (HMAC-SHA256 do global com o `orgId`, o global só na casa, tempo constante; "Mostrar o segredo do webhook" para `admin.usuarios`, `no-store`, auditado sem o valor); remetente `@lid` pelo número real (`key.remoteJidAlt`/`key.senderPn`); `enderecoDeDentro` num lugar só (NAT64, 6to4, mapeado, compatível, ULA, link-local, multicast) e rebinding fechado na captura da pauta e no link da ata (a conexão vai ao IP conferido em todo salto); leitor de PDF numa `worker_thread` (10 s, 15 MB, 256 MB) e download do Drive com teto em stream; `meta` sai de `WHATSAPP_PROVEDOR`; triagem CO-16 com dedupe antes do modelo, teto de 5 por hora por número e o texto da pendência com 14 dias | `auth/jwt-auth.guard.ts`, `gateway/canais/configuracao-do-canal.ts`, `pauta/endereco-de-dentro.ts`, `google/texto-do-pdf-em-thread.ts`, `comercial/triagem-do-whatsapp/` |
| M5 | `agenda.evento.restaurar` | Capacidade nova, **R3** pela escada (escreve no Google e voltar atrás é outra ação à mão: reversibilidade manual), com rota `POST /agenda/restaurar/:eventoId` `{tituloAtual, tituloOriginal}`, sem ferramenta, sem desfazer próprio (ponta terminal da cadeia). O efeito devolve o título da linha "Título original" e tira a linha (a descrição volta à de antes); recusa título ou linha diferentes do pedido, convite de outra agenda e evento cancelado; **o Meet acrescentado fica**. Com isso o `sobrescrita-da-agenda.cli.js --valer` deixa de cair em `desfazer-inexistente` (a porta ainda retém R2: o vigia agir sozinho continua decisão do Rodrigo) | `packages/policy/politica-marketing-os.json` (1.12.0), `google/padronizar-evento.ts`, `agenda/` |
| M5 | IM-03 com parte pura | Prompt e parser do roteirista em `onboarding/trilho/roteirista.ts`, testados com a fixture do stub, sem mudar o comportamento; prova pela ponte (§4) | `roteirista.ts`, `onboarding-roteirista.test.ts` |
| M5 | CO-11 para Sonnet | Não é código: variável em "Para publicar", decisão do Rodrigo | §7 |

## 2. Decisões desta rodada

- **A régua não afrouxou.** Uma capacidade nova (`agenda.evento.restaurar`, R3). A leitura da agenda da Implantação usa a R0 que já existia, pela porta. Anexar, lançar parcela, ligar a régua do importado, desarquivar, mover pasta e definir limite são de gente, com auditoria.
- **Ligar a régua do importado é R0 pela escada, de gente:** a régua de um contrato novo não passa pela porta hoje (é a tarefa do relógio); a do importado passa a valer pelo mesmo caminho, só depois do clique com a ciência. Desligar não existe; registrar pagamento depois de ligar também não (a régua abre a decisão do D+10).
- **O selo da fase e a reunião aparecem no cartão compacto** (a densidade padrão), numa linha própria; no médio e no cheio vão na linha de metadados.
- **Triagem acima do teto:** da 6ª mensagem do mesmo número na hora, uma pendência por número e por hora (não uma por mensagem), para um disparo não encher a caixa.

## 3. As lanes

| Lane | Commits |
|---|---|
| M1 · implantação | `e39e1ba8`, `bcbd51c1`; integração `9ed51b62` (PATCH antigo), `fb060b4f` (compacto), `7fdc3578` (menu fixo) |
| M2 · contratos importados | `62190ed2`, `6825e1ec` |
| M3 · Trabalho | `d7229139`, `bc6ea841`, `75b376b7` |
| M4 · segurança | `3d70f74b` a `ba12811a` e `6d2c0b6b` (testes da triagem) |
| M5 · agentes (orquestrador) | `e187b852` (restaurar), `17f6d0d2` (IM-03) |
| Revisão | `4cca5786` a `1d246d33`, `ac2ee2ba`, `043a7e6e` (§5) |

## 4. Provas

**Suítes** (Postgres descartável na 5440, recém-migrado, política semeada; medidas sobre a integração final, depois dos consertos da revisão, em `043a7e6e`):

| Suíte | Resultado | Linha de base (rodada dos agentes) |
|---|---|---|
| API inteira | 5600 casos: 5262 verdes, 302 vermelhos, 36 pulados (42 arquivos) | 5373: 309 vermelhos (49 arquivos) |
| Web inteira | 1697: 1630 verdes, 67 vermelhos (8 arquivos) | 1660: 65 vermelhos (8 arquivos) |
| Política | 110/110 | 108/108 |
| Isolamento (papel restrito) | 516/516 | 516/516 |
| Rotas públicas, cofre, dinheiro e sessão com RLS | 167/167 | 157/157 |
| `tsc` | limpo na API e no web | |

Os 42 arquivos vermelhos da API são todos da linha de base (`homolog/final/suites.md` e as RESULTADO anteriores: adversarial 19, arquitetura 1, contrato-de-conector 7, memória, vault, pauta, importador do ClickUp, M05 e os exercícios que pedem clone próprio); os que mudaram de contagem voltam à base rodados sozinhos (`contrato-de-conector` 7, `documentacao` 2, `runtime` 2, `marketing-preparacao` 20/20, `agentes-a3-banco` 21/21: tempo esgotado sob carga). **Um vermelho que apareceu e não era da rodada:** `comercial-agentes-entrada` (7) usava relógio falso fixo em 21/10 14h contra o `criadoEm` real do banco; depois das 14h reais de 21/10 o sinal `volume_atipico` acendia sozinho. O teste passou a usar o dia seguinte às 14h (19/19). Na web, os 8 arquivos são os da base (`agentes-estado` oscila entre 11 e 12, como registrado no adendo 21B).

Novas da rodada: API `implantacao-do-cartao` 20, `comercial-contrato-importado` 16, `work-desarquivar-e-mover` 15, `endereco-de-dentro` 100, `canal-segredo-por-empresa` 14, `sessao-usuario-ativo` 10, `texto-do-pdf-em-thread` 12, `whatsapp-provedor-sem-meta` 3, `pendencia-retencao-do-texto` 3, `pagina-publica-corpo` 7, `onboarding-roteirista` 10, e casos acrescentados em `comercial-tarefas`, `comercial-agentes-entrada`, `comercial-canal-evolution`, `canal-de-aprovacao`, `google-drive-cliente` (restaurar, 5), `agenda-vigia-sobrescrita`, `conector-desligado`; política `agenda.evento.restaurar` (2) e a contagem da sobrescrita; web `producao22-implantacao` 15, `comercial-contratos-importados` 9, `trabalho-arquivadas-e-mover-pasta` 10, e casos em `comercial-tarefas` e `conexao-evolution`.

**Prova do IM-03 com modelo real pela ponte** (`homolog/e2e/agentes-reais.mjs --so IM-03`, o `roteirista.ts` do build; casos sintéticos; ninguém usou chave de API): 3 rodadas, **Sonnet 5.5 7/7** (o modelo do cadastro) e **Opus 5.5 7/7**. Detalhe em `homolog/provas/agentes-reais-im-03.md`.

**Roteiros e2e** (imagem final `rootos-final-app:producao22`, `77d0dadb1029`, com os consertos da revisão):

| Roteiro | Onde | Resultado |
|---|---|---|
| `producao22.mjs` (novo) | seed, 3031 | **PASSA, 10 passos**: M1 o selo "fase do trilho: 1 de 5" em 6 cartões, o painel com "Agenda indisponível" (a stack não tem Google), "Pedir agora" levando a `/onboarding/<id>?foco=ata`, o limite pelo menu da coluna (a coluna marca `4/1` e o limite sai), o cartão Implantação no Dia a dia levando a `?pendencia=sem-proximo-passo`; M2 anexar (a stack não tem storage: recusado com a frase e nada gravado), parcelas 3 × R$ 1.000 com a soma e a régua desligada, ligar a régua com a frase e a ciência; M3 "Arquivadas (1)" com quem e quando e "Desarquivar" de volta à pasta, arrastar pasta sobre pasta (e a mãe para dentro da filha = 400), "Essa tarefa já existe." no "+ tarefa". Fotos `homolog/provas/producao22-*.png` (escuro, claro, 390 px). A semente do contrato importado fictício é `homolog/e2e/producao22-semente.cjs` |
| `producao21.mjs` | seed, 3031 | **PASSA, 20 passos** (o passo do "Copiar link da sala" passou a esperar o botão: ele depende da permissão da sessão, que chega um instante depois do estado; antes contava na hora) |
| `agentes.mjs` | seed, 3031 | **PASSA, 8 passos** |
| `final.mjs` | cópia, 3030 | **17/17** (fotos com dado real em `homolog/organizar/producao22-final/`, fora do git) |

**O e2e achou, e a integração corrigiu antes de fechar:** o selo e a reunião não apareciam no cartão compacto (a densidade padrão); o menu do limite abria cortado na primeira coluna e o "Salvar" não recebia clique (agora abre fixo na janela).

**As stacks** (`up -d --no-build api web`, bancos não recriados, política 1.12.0 semeada antes com a assinatura de capacidade nova: `1 criadas, 82 atualizadas, 83 no total`): `rootos-final` (3030) com 202 tarefas, 19 leads, 18 `Partner`, 8 usuários, 19 listas, 5 pastas e 84 status antes e depois (migrations 113 → 114); `rootos-final-seed` (3031) de pé, com os dados fictícios que os e2e criaram. Boot com 83 capacidades e 33 com efeito ligado.

## 5. Revisão adversarial

Só leitura, sobre `agentes-publicar-20261021-v2..HEAD`, com a régua do roteiro. Veredito: **fecha com ressalvas**, nada de bloqueio. Os achados de corrigir e os baratos foram consertados com teste (cada teste novo falha no código de antes):

| Achado | Gravidade | Conserto | Onde |
|---|---|---|---|
| Página que responde `gzip` e para no meio deixava a leitura pendurada para sempre (o `pipe` não levava o fim da resposta ao descompressor); a captura da pauta lia o corpo sem teto depois de descomprimir | corrigir (regressão desta rodada) | `stream.pipeline`; leitura com teto comum de 2 MB (`lerCorpoComTeto`) na pauta e na ata | `pauta/pagina-publica.ts`, `pauta.service.ts`, `leitura-da-ata.service.ts` |
| O endereço da Evolution de empresa cliente ainda aceitava rebinding (confere o IP, depois o `fetch` resolve de novo) | corrigir | empresa que não é a casa conecta no IP conferido (`pedirAoIp`, Host e SNI originais, 3xx não seguido); a casa segue como estava | `pauta/evolution.service.ts` |
| Leitor de PDF sem limite de threads simultâneas | barato | no máximo 2 em thread, fila por chegada, a vaga volta no `finally` | `google/texto-do-pdf-em-thread.ts` |
| Acima do teto da triagem, as mensagens 7..N não deixavam registro, e sumiam se a pendência da hora já estava decidida | barato | contagem e texto da última em `dados` (14 dias), escrita condicionada; pendência decidida faz a seguinte abrir outra | `triagem-do-whatsapp.service.ts` |
| A semente do e2e rodava contra `root` em produção com uma variável | barato | só em banco com `seed` ou `test` no nome (recusou a 3030) | `homolog/e2e/producao22-semente.cjs` |
| Fixtures com a conta real da casa e domínios com cara de reais | barato | `.invalid` | `implantacao-do-cartao.test.ts` |
| IPv4 traduzido (SIIT, `::ffff:0:a.b.c.d`) não era de dentro | nota | julgado pelo IPv4 embutido | `pauta/endereco-de-dentro.ts` |
| Achado do próprio conserto: a barreira de loopback da casa na Evolution só lia `::ffff:a.b.c.d` em texto (`::ffff:7f00:1`, NAT64 e 6to4 de loopback passavam) | barato | `ipv4Embutido` lê o IPv4 de qualquer forma | `pauta/evolution.service.ts` |

Conferido e bom: anexo e parcelas sem cobrança, `Contract`, mensagem ou aprovação (nenhuma reação inscrita nos fatos novos; parcelas travadas com a régua ligada; só gente; lead de outra empresa = 404); desarquivar e mover pasta sob o cadeado, com `orgId`, nome repetido conferido e só gente; `isActive` na empresa do token, cache por empresa e usuário, rotas públicas e outros `typ` fora do guarda; segredo por empresa em tempo constante, o global só na casa (o mesmo critério do `SessaoDaPlataformaGuard`); rebinding fechado na pauta e na ata, com teste de resolver que muda de resposta; o worker do PDF encerra no prazo, no erro e no sucesso, e existe no build (`tsc`; o Dockerfile copia o repositório); `agenda.evento.restaurar` R3 honesto e única capacidade nova; nenhum segredo no diff; a migration é aditiva.

**Nota que fica:** "Mostrar o segredo do webhook" devolve à CASA o segredo global do processo (é o dela). Todo `admin.usuarios` da casa passa a vê-lo no navegador, e é dele que se deriva o segredo das outras empresas. Coerente com "a casa é a plataforma"; a alternativa (a casa também usar um derivado) muda a configuração da instância da casa e ficou para o Rodrigo (§6).

## 6. [a decidir] e o que fica para o Rodrigo

**Decisões que esta rodada não tomou:**
- **Dono padrão por área** (herdado da rodada dos agentes, §8 de lá).
- **O vigia da agenda agir sozinho.** Com `agenda.evento.restaurar` no catálogo, a sobrescrita assinada `node dist/agenda/sobrescrita-da-agenda.cli.js --org root --valer --como <e-mail> --motivo "..."` passa a ser ACEITA pela régua e grava a padronização em R2 para a empresa (uma pessoa com alçada de operador confirma, em vez de responsável). Agir sem fila ainda exige a porta respeitar R2 sem aprovação por empresa, que não existe. O CLI é do Rodrigo; ninguém rodou `--valer`. **O desfazer devolve título e descrição; o Meet acrescentado fica.**
- **Número novo pela Evolution virar lead** (a triagem CO-16 está pronta e desligada: dedupe, teto, retenção).
- **TR-02** (compromisso da cliente vira tarefa da casa?) e o **formato do kit**.
- **Dados reais antigos** em `apps/api/prisma/data/*.json` (não mexido).
- **CO-11 para Sonnet**: `LLM_MODELOS_POR_FUNCAO=CO-11=claude-sonnet-5-5` (§7).
- **O número do WIP** de cada etapa da Implantação: o menu existe, nenhum limite foi definido.
- **Apagar as cópias do Predator** (§8).
- **O segredo global visível para a casa** na tela da Evolution (§5, nota).
- **Régua do contrato importado:** desligar não existe e registrar pagamento depois de ligar também não (a parcela atrasada abre a decisão do D+10). A frase de ligar diz "nenhuma mensagem vai ao cliente": vale enquanto os textos da régua forem [a decidir].
- **Anexo do importado na homologação:** as stacks não têm storage; o anexo de ponta a ponta está provado só na suíte, com armazém dublê.

**Pendências dele que já estavam:** a chave Anthropic e `LLM_PROVIDER=anthropic` (hoje `openrouter`, morto: nenhum agente chama modelo na produção); a Evolution com QR (o número dedicado; `WHATSAPP_PROVEDOR=simulado`); o Granola; a pasta do Drive das atas (`trabalho.atas.drive`); as 7 tarefas ambíguas do importador; o `criar-pastas-dos-clientes`; os webhooks do Asaas e da ZapSign.

## 7. Para publicar (orquestrador do Mac)

Imagem a partir da tag **`producao-22-20261022`** (contém `agentes-publicar-20261021-v2`). A sequência é a da cadeia de releases (`docs/comercial/VIRADA-PRODUCAO.md`), com estes itens:

1. **Política 1.12.0, ANTES da subida** (a política que vale é a do banco):
   ```bash
   docker run --rm --network "$NET" -w /app/apps/api -e DATABASE_URL="$DB" \
     -e POLITICA_CAPACIDADE_NOVA_AUTOR='<quem responde>' \
     -e POLITICA_CAPACIDADE_NOVA_MOTIVO='Produção 22 (22/10/2026): agenda.evento.restaurar (R3), o desfazer da padronização da agenda (devolve o título e a descrição guardados; o Meet fica)' \
     "<imagem>" pnpm db:seed:politica
   ```
   Esperado: `capacidades: 1 criadas, 82 atualizadas, 83 no total`; o boot diz 83 capacidades e "33 capacidades com efeito ligado". Ensaiado nas duas stacks.
2. **Migration** (o `migrate deploy` do container aplica): `20261022130001_pendencia_texto_expira_em`, `Pendencia.textoExpiraEm` (coluna nula) e um índice. **Aditiva.** É a única.
3. **Variáveis novas: nenhuma.** Conferir que `WHATSAPP_PROVEDOR` é `simulado` (ou `evolution`): **`meta` passa a derrubar o arranque**, como `digisac`. Opcional, decisão do Rodrigo: `LLM_MODELOS_POR_FUNCAO=CO-11=claude-sonnet-5-5` (no `agentes.env`/`final.env` e no bloco `environment:` do `api`).
4. **Permissões novas: nenhuma** (não rode `db:sync-permissions`).
5. **Passos de dado: nenhum.**
6. **Comportamento que muda na subida (avisar):**
   - token de usuário desativado é recusado em até 60 s (os de `ia-acao@`, desativada, param de valer);
   - o webhook da Evolution de empresa que NÃO é a casa passa a exigir o segredo derivado (`HMAC-SHA256(CANAL_APROVACAO_SEGREDO, orgId)`, mostrado em Conexões › WhatsApp (Evolution) para `admin.usuarios`); a casa segue com o do processo. Hoje só a casa usa: nada quebra; outra empresa configurada com o global ouviria 404;
   - a triagem do WhatsApp continua desligada; o expurgo do rastro passa a apagar o texto vencido das pendências da triagem (a pendência fica).
7. **Rollback só de imagem:** possível (a coluna nova é nula e a imagem anterior a ignora; com a política 1.12.0 no banco, a imagem anterior não tem o efeito de `agenda.evento.restaurar` e a porta recusa o pedido).
8. **Conferências na produção depois:**
   - Implantação: o cartão com o selo "fase do trilho: N de 5" onde a etapa e o trilho divergem; o painel com "Agenda indisponível" enquanto o Google da casa não estiver conectado (ou a reunião, se estiver); "Pedir agora" nos quatro agentes; o menu "⋯" de cada coluna com "Limite de cartões nesta etapa" (não definir número);
   - Dia a dia › Visão geral: o cartão "Implantação" e a linha levando à Implantação com o filtro;
   - Contratos vivos: os 6 importados com "Anexar o PDF" e o bloco "Parcelas" no painel do lead (régua desligada); anexar o PDF real é da mesa;
   - Trabalho: "Arquivadas (N)" na árvore (a pasta Administrativa e as listas arquivadas pelo importador aparecem ali; não desarquivar); arrastar pasta sobre pasta;
   - Funil vivo: o "+ tarefa" recusando título repetido;
   - Conexões › WhatsApp (Evolution): "Mostrar o segredo do webhook" só para quem tem `admin.usuarios`;
   - o log de arranque sem erro e com 83 capacidades.

## 8. Apagar depois

Ninguém apagou nada nesta rodada. Herda as listas das RESULTADO-PRODUCAO-21, 21B e AGENTES, mais:

- Imagens `rootos-final-app:producao22a` (intermediária, sem M4) e as sem tag dos builds; `rootos-final-app:agentes2` fica como reserva até a virada.
- Bancos de teste no Postgres 5440 (fictícios): `rootos_p22_orq_test`, `rootos_p22_m1_test`, `rootos_p22_m2_test`, `rootos_p22_m3_test`, `rootos_p22_m4_test`, `rootos_p22_m4_test_rls`, `rootos_p22_fix_test`, `rootos_p22_full_test`, `rootos_p22_full_test_rls`, `rootos_p22_full2_test`, `rootos_p22_full2_test_rls` (e algum `_rls` que uma lane tenha criado).
- `C:\Users\User\dev\scratch-p22\` (logs das suítes e dos e2e, `suites.sh`, o PDF de prova).
- `homolog/organizar/producao22-final/` (fotos e placar do `final.mjs` com dado real; fora do git).
- Worktrees desta rodada em `.claude/worktrees/` (branches `worktree-agent-*` e `producao-22/m2-contratos-importados`, integradas).
- Na 3031 (fictício): os leads "Cliente Importado Exemplo e2e 22 …" da semente (um por passada, régua ligada pelo e2e), as pastas, listas e tarefas "e2e 22 …".

Para voltar: `rootos-final-app:agentes2` segue no Docker. Troque a tag nos dois `docker-compose.final*.yml` e rode `up -d --no-build api web` **num shell sem as variáveis de outra stack exportadas** (a coluna nova fica, nula).
