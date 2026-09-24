# Onboarding do cliente — o trilho da esteira de entrega

> Plano e especificação, 23/09/2026. Escrito pelo Rodrigo com o Claude, a partir de duas fontes:
> a nota do Pedro no root-base (`40-Operacao/Contexto — ferramenta de onboarding e esteira de
> entrega.md`, 23/09) e as onze decisões da conversa de desenho do mesmo dia (mockup em
> https://claude.ai/artifact/TKvqgTuxfCXtTXo65kSU4m). O que está aqui **foi construído** no
> mesmo dia; o que ficou de fora está na seção 9, com o motivo.

## 1. Em cinco linhas

1. A Root entrega **uma esteira só, em 5 fases, com portão entre elas** (Pedro, §4). A ferramenta
   é o **trilho**: guarda o estado de cada cliente, dispara o que é automático e **não deixa
   avançar sem o portão cumprido**.
2. O **formulário único** (Pedro, §6) tem quatro blocos: A qualificação (antes da 1ª reunião),
   B os 8 temas da carga guiada **como estão no código**, C intenção, D operação e linha de base.
   Nenhum nono questionário.
3. O que a **reunião de kickoff** (gravada, depois da assinatura) responde, o cliente **só
   confirma**: um agente lê a ata e propõe uma resposta por tema, com trecho e minuto; o sócio
   aprova na bancada; o cliente recebe um **link público sem login** e confirma no celular, por
   texto ou áudio. É a decisão do Rodrigo de 23/09, e é o que torna o formulário leve.
4. Cada resposta confirmada vira **nota na memória da empresa do cliente** dentro do OS, com
   procedência (a reunião, o minuto, quem confirmou). Corrigir substitui, não duplica.
5. Toda fase termina com **próximo passo com dono e data**. Estado sem próximo passo é alerta.

## 2. Decisões que este desenho fixa (23/09/2026)

| # | Decisão | De quem |
|---|---|---|
| 1 | Kickoff gravado **depois** da assinatura; a triagem curta (bloco A) continua antes da 1ª reunião | Rodrigo |
| 2 | O formulário do cliente é um **link público** que escreve na carga guiada do OS | Rodrigo |
| 3 | Agente propõe a partir da ata; **sócio aprova antes de enviar** (literal vai direto, interpretado pede OK, sem proposta chega em branco) | Rodrigo |
| 4 | Cliente responde por **texto ou áudio** (áudio vira texto no OS) | Rodrigo |
| 5 | **Tronco comum + ramos por nível** (beabá / avançar junto / entregar pronto) | Rodrigo |
| 6 | Só clientes **novos**; os quatro atuais não voltam ao trilho | Rodrigo |
| 7 | Conduz o kickoff: **o sócio da reunião inicial + quem implanta** | Rodrigo |
| 8 | Quem implanta: qualquer um dos três; nos primeiros casos, o sócio da reunião inicial | Rodrigo |
| 9 | **Pedro autorizou e constrói junto** — a mudança no OS não espera ADR | Pedro |
| 10 | Cobrança de retorno em **3 dias** (lembrete automático; dia 5 o sócio cobra) | Rodrigo |
| 11 | Sempre avisam antes de gravar (a frase está no roteiro) | os três |
| 12 | A ferramenta **mora no ROOT OS** (§9.7 do Pedro): módulo `onboarding` + esteira do Trabalho | Rodrigo, 23/09 |
| 13 | **Reusar os 8 temas** da carga guiada, sem criar nono questionário (§2 do Pedro) | Pedro |

## 3. O modelo (qual e por quê)

| Trabalho | Modelo | Por quê |
|---|---|---|
| Leitor de ata (propostas com trecho e minuto) | `claude-opus-5`, esforço `high`, pelo `AnthropicProvider` do OS | Transcrição longa em português, extração **sem inventar**: cada proposta tem de citar trecho verbatim, e o modelo é quem melhor sustenta essa restrição em 45 min de fala. Passa pelo envelope de teto de custo por empresa e por agente (`src/llm/provider-com-teto.ts`). |
| Pesquisador de conta (dossiê + 3 hipóteses, fase 0) | `claude-opus-5`, esforço `high` | Mesma razão: cada afirmação sai marcada como hipótese, com fonte. |
| Roteirista do kickoff (personaliza as perguntas com o bloco A) | `claude-opus-5`, esforço `medium` | Tarefa curta; o roteiro base é determinístico e funciona sem modelo. |
| Áudio → texto | OpenAI `gpt-4o-transcribe` (queda para `whisper-1`), em `src/llm/transcricao.provider.ts` | A Anthropic não tem transcrição. Fica dentro de `src/llm/` porque a catraca de arquitetura exige que o modelo tenha uma casa só. |
| Embeddings | inalterado (OpenAI) | Fora do escopo. |

Nada de modelo no caminho de **entrada** do cliente: confirmar, corrigir e responder não chamam
modelo. O modelo entra antes (ler a ata) e depois (retrato é construído das notas, não pedido).

## 4. A esteira e os portões (o que o código faz valer)

| Fase | Entra quando | Portão para sair | Automático |
|---|---|---|---|
| 0 Qualificar | reunião marcada | tem sistema e base **e** perfil (P1/P2/P3) **e** bloco A respondido | link do bloco A vai com prazo D-3; sem resposta em D-1, aviso ao dono |
| 1 Diagnóstico | bloco A ok | frente escolhida (receita) **e** próximo passo com dono e data | folha de reunião (dossiê + hipóteses + perguntas que faltam + roteiro de 60 min) |
| 2 Contrato e onboarding | proposta aceita | entrada compensada **e** dupla nomeada **e** linha de base medida **e** ambiente ok (D-1) **e** blocos B–D confirmados | grupo + boas-vindas com datas reais; kickoff → ata → bancada → link → lembrete em 3 dias → retrato |
| 3 Imersão | portão 2 | critério de saída da receita **atingido na frente do cliente**, com evidência | pauta dos 2 dias gerada pela receita; dúvidas/objeções viram glossário |
| 4 Operação assistida | portão 3 | antes/depois registrado → case → mensalidade | check semanal, medição do dia 30, alerta de N dias sem uso (N configurável, padrão 7) |

`avancar()` recusa com a lista exata do que falta. Não há "pular fase".

## 5. O formulário único (a espinha)

- **A · qualificação** (9 perguntas, antes da 1ª reunião, uns 7 min) — `espinha.ts`. Cinco são
  sobre a empresa (o que faz, sistemas e acesso ao dado, a tarefa que toma tempo, a coisa a tirar
  do prato, o uso de IA hoje) e quatro, acrescentadas em **24/09/2026**, são sobre a pessoa e a
  compra: `a-quem-e` (o papel dela e **quem decide**), `a-porte` (o tamanho da operação, que é o
  que separa prateleira de implantação), `a-onde-doi` (a dor qualitativa, além das horas) e
  `a-o-que-espera` (expectativa e prazo). Quantas são e quantos minutos leva saem de
  `QUANTAS_NA_TRIAGEM` e `MINUTOS_DA_TRIAGEM`: a mensagem do WhatsApp e a tela do cliente contam
  da espinha, porque o texto fixo "cinco perguntas, uns 5 minutos" sobreviveu ao bloco A crescer.
- **B · os 8 temas** — importados de `agents/roster/carregador-de-contexto.ts` como estão.
- **C · intenção** (3 perguntas abertas, do card 08).
- **D · operação e linha de base** — a dupla (dono das perguntas + guardião do acesso), o número
  de partida da frente escolhida, ambiente (SO, admin, antivírus/VPN), anexos (pedidos como link
  ou envio no grupo; upload de arquivo entra na fase 2 do trilho).
- **Ramos por nível:** no beabá o tema de acessos vira "quem participa da turma"; no avançar
  junto / entregar pronto, o guardião do acesso é obrigatório.
- **Proibido:** senha, token, chave, dado bancário. Toda resposta e toda ata passam por
  `segredos.ts` antes de gravar; o que parece credencial é mascarado e contado.

Uma espinha, duas superfícies: o **roteiro do kickoff** é a espinha escrita como conversa (com a
frase de consentimento e a pergunta "se ficar raso"); o **link do cliente** é a mesma lista, com o
que a ata já respondeu em modo confirmar.

**A pergunta é uma só.** Se o roteirista reescreveu a pergunta com o vocabulário do cliente (marco
`roteiro.personalizado`), o link mostra a versão reescrita — a mesma que o roteiro impresso mostra
a quem conduziu. Quem conduziu perguntou daquele jeito; o cliente lê daquele jeito. A tela nunca
reescreve pergunta.

## 5b. O link é o KICKOFF, não um formulário (24/09/2026)

`mapa-do-cliente.ts` + `/e/[token]`. O link do cliente deixou de ser "responda 18 campos" e passou
a ser **a estação atual de um trecho**: ele vê o caminho inteiro, onde está, o que ficou para trás
e o que recebe adiante. É o recorte do cliente das cinco fases — não a esteira interna da Root.

Seis estações, iguais para todo cliente (dado versionado, uma casa só):

| # | Estação | O que é para o cliente | De onde o OS tira o estado |
|---|---|---|---|
| 1 | Conversa | a conversa em que ele conta a casa | `reuniaoEm` / `kickoffEm` / item com origem `ata` |
| 2 | Acordo | o combinado do trabalho | `portoes.propostaEnviadaEm`, fase ≥ contrato, ou existir link B–D |
| 3 | **Kickoff** | confirmar o que já disse, decidir o que só ele decide | convite B–D aberto e não concluído |
| 4 | Contexto | as fontes dele entram | memória carregada ou `portoes.ambienteOkEm`; detalhe vem de `d-anexos` |
| 5 | Memória viva | o vault com as notas da casa, na voz dele | `OnboardingItem.notaId` (o `carregarMemoria` rodou) |
| 6 | Frente rodando | a frente escolhida em operação | `portoes.criterioDeSaida` ou fase ≥ operação |

Duas regras que valem mais do que o desenho:

1. **Nunca inventa data.** `quando` só existe quando há data gravada; a única data do futuro que o
   mapa afirma é a validade do convite ("até 07/10"). É a mesma regra do `SemDataError` das
   mensagens — nunca `XX/XX`.
2. **A posição é a afirmação.** O que vem antes da estação atual aparece como vencido (o link B–D
   só nasce depois do acordo, e o acordo depois da conversa); o que vem depois **nunca** aparece
   como feito.

E a estação de hoje pede o que falta **nesta ordem** (`ordemDoKickoff`): (1) as **decisões** — o
obrigatório que a conversa não cobriu, porque é ele que define o que a gente constrói; (2) **o que
ouvimos de você** — as propostas aprovadas, com o minuto, para confirmar ou corrigir; (3) o
**opcional**, sem peso. A página termina na **promessa da estação 5** (`promessaDaMemoria`): a
pasta pelo slug, os títulos das notas da casa, as fontes que ele já citou e a pergunta da primeira
semana — construída do que existe, nunca pedida a modelo, como o retrato.

## 5c. A teia: o vault dele crescendo enquanto responde (24/09/2026)

`teia-do-cliente.ts` + o painel "O seu vault" em `/e/[token]`. Pedido do Rodrigo: o link "imita o
Obsidian". Cada tema da espinha É uma nota do vault do cliente (a mesma chave `onboarding:<id>` que a
carga guiada escreve) e as notas se ligam entre si como no grafo do Obsidian. Ao confirmar ou
responder, a nota acende e a ligação com o índice aparece — a teia de contexto se forma na frente
dele, e não num "obrigado, recebemos" no fim.

Três espécies de nó: **tema** (`pronta` quando ele confirmou/respondeu, `rascunho` quando há
proposta aprovada esperando o OK, `vazia` quando nada foi dito); **da conversa** — uma nota que JÁ
NASCEU da transcrição (marco `ata.notas`, com minuto e trecho; hoje escrita pelo agente na sessão,
amanhã pelo leitor de ata), o que dá ao vault conteúdo desde o primeiro dia; e o **índice** (o MOC
do Obsidian), que liga só o que existe de verdade: pronta e da conversa. As ligações entre temas
são dado versionado (`LIGACOES_DA_ESPINHA`); as notas da conversa trazem as suas (`liga`).

Ao lado de cada pergunta vai a referência `[[Nota]]` com o estado e "liga com". O último tópico é
o **Índice** — a nota-mapa: já escritas da conversa (com minuto e corpo), prontas (com as
ligações), esperando OK, em branco. E `carregarMemoria` passou a gravar também as notas da
conversa na memória do cliente (`onboarding:ata:<id>`, kind `nota`, procedência com a data da ata
e o minuto), idempotente pelo corpo.

## 5d. Até o botão final, tudo se refaz (24/09/2026)

Pedido do Rodrigo depois de testar o link: **nada pode se perder, e o cliente precisa poder corrigir
o que já mandou**. Cada resposta é gravada na hora (`OnboardingItem`, com quem, quando e por onde) e
a tela mostra "salvo às" com a hora que veio do banco. `confirmar` e `corrigir` valem de novo sobre
o que já foi confirmado/corrigido (a procedência da reunião fica); `responder` vale sobre qualquer
estado; quem corrigiu pode "voltar ao que ouvimos". O que fecha o link é só o botão final — em dois
passos ("isto fecha o link… ainda não"). O erro fica ao lado do campo que falhou, com
`aria-describedby`; a barra fixa mostra só a conta ("faltam 3 obrigatórias"), e a lista do que
falta fica junto do botão de fechar, com atalho para cada tema.



**Banco (empresa da Root, tenant 001), migration `20260924010000_onboarding_do_cliente`:**

- `OnboardingTrilho` — um por cliente: fase, perfil, nível, receita, contato, cartão da esteira
  (`cardId` → `WorkTask`), empresa provisionada no OS (`empresaId`), portões (JSON com data e
  quem), próximo passo com dono e data.
- `OnboardingItem` — uma linha por (trilho, tema): proposta do agente, fonte (minuto, trecho),
  tipo (literal/interpretado/em-branco), estado (proposto → aprovado → confirmado/corrigido/
  respondido), texto final, quem/quando, id da nota na memória do cliente.
- `OnboardingConvite` — o link: hash do token, blocos (A ou BCD), validade (14 dias), revogado,
  enviado, lembrado, concluído, acessos.
- `OnboardingAta` — o registro da leitura: fonte (texto/pdf/link), hash, tamanho, segredos
  removidos, modelo, custo, quantas propostas. **A transcrição bruta não é gravada** (regra do
  Pedro §10): fica só o que virou proposta, com o trecho curto.
- `OnboardingMarco` — a linha do tempo do trilho (fase mudou, portão cumprido, link enviado,
  lembrete, check semanal, alerta). Cada marco também vai ao RASTRO.

Os quatro filhos carregam `orgId` com a sentinela `''` e o gatilho `mktos_orgid_do_pai`
(`FILHOS_COM_ORGID_REDUNDANTE` sobe de 11 para 15). Isolamento por linha em todas; a leitura de
`OnboardingConvite` aceita a sentinela pública, porque é por ela que o link acha a empresa.

**API (`apps/api/src/onboarding/trilho/`):** rotas autenticadas em
`/api/tenants/onboarding/trilhos/*` (permissões `tarefas.ver` / `tarefas.editar`, as da esteira)
e anônimas em `/api/tenants/onboarding/link/:token/*`. O prefixo `tenants` já é espinha do OS —
nenhuma linha em `modulos.ts`.

**Agentes (roster da Root):** `leitor-de-ata`, `pesquisador-de-conta`, `roteirista-de-kickoff`.
R1, sem capacidade acima de leitura da própria memória. Semeados na primeira leitura do trilho
(idempotente, como `garantirRoster`).

**Rotina:** `onboarding.relogio`, diária às 09:00 (Brasília), semeada uma vez por empresa. Ela
não manda mensagem: **prepara** a mensagem (lembrete, aviso de D-1, alerta de N dias) e a deixa
na bancada com o botão de copiar. Mandar pelo OS passa por `whatsapp.mensagem.enviar`, que é R3
com segunda pessoa — é decisão da mesa (ver §9).

**Web:** `/onboarding` (a bancada: fases, portões, propostas, link, marcos), `/onboarding/[id]/
roteiro` (imprimível), `/e/[token]` (o **kickoff** do cliente: o mapa das seis estações, as
decisões, as confirmações e a promessa da memória viva — público, no celular).

## 7. O fluxo, ponta a ponta

```
Reunião marcada → trilho nasce (fase 0) → link do bloco A vai no WhatsApp com prazo
→ dossiê + 3 hipóteses (agente) → folha de reunião → diagnóstico → receita escolhida
→ proposta aceita → contrato (esteira ZapSign, fora deste módulo) → entrada compensada
→ grupo + boas-vindas com datas reais → KICKOFF GRAVADO (roteiro) → ata (texto/PDF/link)
→ agente propõe (trecho + minuto) → sócio aprova → link BCD no grupo → 3 dias → lembrete
→ cliente confirma/corrige/responde (texto ou áudio) → retrato + primeira pergunta
→ notas na memória do cliente → portão 2 → imersão (pauta pela receita) → critério de saída
→ operação assistida (check semanal, dia 30, alerta) → antes/depois → case → mensalidade
```

## 8. Testes e prova

- Puros (sem banco): espinha (blocos, ramos, ids únicos), fases e portões (recusa com a lista do
  que falta; nunca pula), segredos (mascara senha/token/pix; não mascara texto normal), leitor de
  ata (parser recusa proposta sem trecho; literal só quando o trecho está na ata), convite (token
  não sai do banco, hash sim; validade; revogado), relógio (lembrete no dia 3, aviso D-1, alerta N
  dias), roteiro (consentimento, cobertura), mensagens (datas reais, nunca `XX/XX`).
- Com banco descartável: o trilho ponta a ponta com o modelo substituído por dublê — cria,
  lê a ata, aprova, gera o link, confirma pela rota anônima, responde, fecha o retrato, carrega a
  memória do cliente, avança de fase pelos portões.
- Registros: `modelos-globais` (a sentinela nos quatro filhos), `tenant-isolation` (as cinco
  tabelas com semente e gatilho), `modulos-por-tenant` (prefixo declarado), `arquitetura` (a
  transcrição mora em `src/llm/`).

## 9. O que ficou de fora, e por quê

1. **Mandar WhatsApp sozinho.** O conector Evolution existe e `whatsapp.mensagem.enviar` é R3 com
   segunda pessoa. Automatizar o lembrete de 3 dias exige a mesa decidir se o agente propõe em
   nome próprio (o mesmo debate de publicar peça). Até lá a mensagem é preparada e copiada.
2. **Granola pelo MCP.** Liberado para a Root na semana de 28/09. O leitor aceita texto colado,
   PDF e link; a entrada pelo MCP é uma quarta fonte que reaproveita o mesmo caminho.
3. **Upload de anexos do cliente pelo link.** O bloco D pede os anexos como link ou pelo grupo.
   Upload de arquivo para o MinIO com varredura entra na fase 2 do trilho.
4. **Cardápio completo de receitas.** Só a "arquivista documental" está inteira (é a única
   descrita na nota). As outras cinco são sementes com o que se sabe; preencher é da mesa.
5. **Preço tabelado, N de dias, nicho.** Decisões da mesa de 24/09 (Pedro §9). O código lê de
   configuração; os valores padrão estão marcados como provisórios.
