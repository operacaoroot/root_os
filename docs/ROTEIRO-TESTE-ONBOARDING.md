# Roteiro de teste — o degrau de entrada, com pessoa de verdade

**Fatia 6.1+4.5 · RF-O-01, RF-O-02, RF-M-05 · escrito em 11/09/2026**

Este roteiro é entregável, não anexo. Ele existe porque a promessa do degrau de entrada só se
prova com alguém de fora tentando: **uma pessoa que a ROOT nunca viu cria a conta, conecta as
fontes, carrega o contexto e recebe a primeira resposta com fonte em menos de uma hora, sem falar
com ninguém.**

Quem executa não precisa ler o resto do repositório. Quem **observa** precisa ler este arquivo
inteiro antes.

---

## 1. A promessa, em números

| O que | Alvo | Como se mede |
|---|---|---|
| Tempo total, do primeiro clique à primeira resposta | **≤ 60 min** | cronômetro (§4) |
| Intervenções de alguém da ROOT durante a sessão | **0** | contagem do observador |
| Temas obrigatórios carregados | **6 de 6** | tela de entrada |
| Primeira resposta com fonte citada | **sim** | §6, critério F3 |
| Perguntas do participante que o observador **não** pôde responder | anotar todas | §7 |

Não há alvo de satisfação nesta rodada. O que se está medindo é se o caminho **existe e fecha**,
não se ele é agradável. Usabilidade vem depois, com mais gente.

---

## 2. Quem faz o quê

**Participante** — dono ou sócio de uma empresa pequena real, que nunca viu o ROOT OS e não
trabalha na ROOT. Precisa ter: um notebook, uma conta Google de trabalho com e-mail verificado, e
sessenta minutos sem reunião. Não precisa saber o que é slug, tenant, agente ou contexto.

**Observador** — alguém da ROOT. Fica calado. Cronometra, anota e **não ajuda**. A única fala
permitida é a do §5 (abertura) e a do §8 (encerramento). Se o participante travar, o observador
anota onde e deixa travar: é isso que o teste está medindo.

**Ninguém mais.** Se, em qualquer momento, alguém da ROOT precisar mexer no sistema para o
participante seguir, **o teste falhou** — anote em qual passo e pare (critério F1).

---

## 3. Antes do cronômetro (preparo, feito no dia anterior)

Estes itens são de instalação, não de cliente: são feitos **uma vez** para o produto, nunca por
participante. Confira todos antes de marcar a sessão.

- [ ] A API está no ar e `GET /api/health` responde.
- [ ] `POST /api/tenants/onboarding/cadastro` responde (teste com um nome descartável e apague a
      empresa depois — ver §9).
- [ ] **O TETO DE TAXA da rota de cadastro conta a SUA máquina também.** São cinco tentativas por
      hora e por endereço de origem (`apps/api/src/onboarding/teto-de-taxa.ts`), e o preparo acima
      gasta pelo menos uma. Se você ensaiar o cadastro várias vezes da mesma rede em que a sessão
      vai acontecer, o participante recebe "tentativas de cadastro demais" e a sessão morre no
      primeiro minuto — anote como falha de PREPARO, não do produto. Ensaie de outra rede, ou
      reinicie o contêiner da API antes da sessão (o contador é em memória, por processo).
- [ ] `/entrar` abre **sem sessão** no navegador anônimo. Se ele redirecionar para `/login`, a rota
      saiu da lista `PUBLICAS` em `apps/web/src/components/AppShell.tsx` e a sessão não pode
      começar — o lado do cadastro fica inalcançável, que é a promessa inteira.
- [ ] O login com a conta Google está configurado (`GET /api/auth/google/disponivel` devolve
      `disponivel: true`).
- [ ] `OPENAI_API_KEY` — **anote se está presente ou ausente**. Isso muda o que se espera no passo
      F3 (ver §6, a nota sobre busca semântica).
- [ ] O participante **não** foi adicionado a nenhuma lista, allowlist ou empresa. Se você precisou
      cadastrá-lo à mão em algum lugar, o teste já falhou antes de começar.

Nada aqui autoriza mexer no ambiente durante a sessão.

---

## 4. O cronômetro

**Começa** quando o participante digita o endereço de `/entrar` no navegador e a tela aparece.

**Para** quando uma das quatro coisas acontece, o que vier primeiro:

1. a primeira resposta aparece na tela com as fontes listadas embaixo (sucesso);
2. o participante desiste em voz alta ("não vou conseguir", "prefiro falar com alguém");
3. passam **60 minutos**;
4. um critério de falha do §7 acontece.

Anote o horário de início, o de cada marco (§6) e o de parada. Anote também **todo silêncio maior
que dois minutos** — silêncio longo numa tela de entrada é quase sempre alguém sem saber o que
fazer, e ele não aparece em nenhuma métrica de servidor.

---

## 5. O que o observador fala na abertura (leia, não improvise)

> "Você vai criar a conta de uma empresa num sistema que você nunca usou. Use a sua empresa de
> verdade e responda com informação de verdade — o que você escrever fica guardado na conta que
> você mesmo vai criar, e a gente apaga tudo no fim se você pedir. Vou ficar aqui do lado sem
> falar nada, nem se você me perguntar. Pode pensar em voz alta. Quando você achar que terminou,
> me avisa."

Depois disso, silêncio.

---

## 6. Os marcos, com orçamento de tempo

| # | Marco | Orçamento | O que anotar |
|---|---|---|---|
| M1 | Conta criada (a tela diz "Conta criada") | 3 min | quantas vezes releu o formulário |
| M2 | Entrou com a conta Google e voltou para a entrada | 3 min | se hesitou em qual conta escolher |
| M3 | Primeiro tema respondido | 5 min | se entendeu que era para escrever em português corrido |
| M4 | Seis temas obrigatórios respondidos | 30 min | em qual tema demorou mais; quantos aprofundamentos vieram |
| M5 | Primeira resposta na tela, com fontes | 5 min | **critério F3** |
| M6 | (opcional) Fonte conectada por OAuth | 5 min | se ele tentou, e se parou por causa do provedor |

Os orçamentos somam 51 minutos e o alvo é 60. A folga é de propósito: ela é o que absorve uma
pergunta de aprofundamento a mais.

**F3 — o critério da primeira resposta.** Ela **passa** quando, embaixo do texto, aparece a lista
de fontes e cada linha traz uma chave `onboarding:<tema>` e uma procedência que começa com
`operador:`. Ela **falha** quando a lista vem vazia, quando o texto afirma algo que o participante
não disse, ou quando aparece um número que não está em nenhuma das notas.

> **Nota sobre a busca semântica — leia antes de julgar o passo seguinte.**
> Depois da primeira resposta, a tela oferece uma pergunta livre ao assistente. Essa é a resposta
> que passa pelo modelo de verdade, e ela **pode sair sem fonte** quando `OPENAI_API_KEY` está
> presente no ambiente: a busca que alimenta o contexto roda em modo semântico e ignora nota sem
> vetor, e o vetor do índice só é gerado para a empresa da casa. A tela avisa quando isso acontece,
> em vermelho. **Esse aviso não é falha do participante nem do roteiro** — é a limitação declarada
> em `apps/api/src/onboarding/retrato.ts`. Anote se apareceu, e siga.

---

## 7. O que conta como falha

Falha **dura** — para a sessão, anota e encerra:

- **F1 — alguém da ROOT precisou agir.** Qualquer mexida no banco, no ambiente, numa allowlist ou
  numa tela de administrador para o participante conseguir seguir.
- **F2 — o participante ficou preso esperando aprovação.** Se qualquer passo da entrada abrir um
  pedido de aprovação, ele nunca vai sair: a empresa nova tem **um** usuário com alçada e quem
  propõe não pode aprovar. Anote a tela exata.
- **F3 — a primeira resposta saiu sem fonte** (ver §6).
- **F4 — o participante desistiu** ou passou de 60 minutos.
- **F5 — apareceu dado de outra empresa** em qualquer tela. Pare imediatamente, tire foto e
  escale: é incidente, não resultado de teste.

Falha **branda** — não para a sessão, mas entra no relatório:

- o participante respondeu "não sei" ou "depois eu vejo" em algum tema obrigatório — **anote o
  tema e quantas vezes o OS aprofundou**. O procedimento aprofunda UMA vez e, na segunda resposta
  curta, aceita o que ele escreveu e segue (`VERSOES_ATE_ACEITAR`, em
  `apps/api/src/onboarding/carga-guiada.ts`). Se ele ficar preso na mesma pergunta uma terceira
  vez, isso é falha DURA e não branda: a carga virou armadilha;
- uma pergunta de aprofundamento veio e ele não entendeu o que faltava;
- ele escreveu no campo de resposta algo que era claramente para outro tema;
- ele procurou um botão que não existe (anote qual, e onde procurou).

---

## 8. Encerramento (leia, não improvise)

> "Acabou. Duas perguntas: em algum momento você pensou em desistir? E, se um amigo dono de
> empresa te perguntasse o que esse sistema faz, o que você responderia?"

Anote as duas respostas **palavra por palavra**. A segunda é a única medida honesta de se o
produto se explicou sozinho.

Depois pergunte se ele quer manter a conta ou apagá-la. Se quiser apagar, faça o §9 **na frente
dele**.

---

## 9. Depois da sessão

- [ ] Empresa de teste apagada (ou mantida, se ele pediu) — anote qual.
- [ ] Planilha de tempos preenchida (§1 e §6).
- [ ] Falhas duras e brandas transcritas.
- [ ] As duas frases do §8, literais.
- [ ] Se houve F5, incidente aberto antes de qualquer outra coisa.

---

## 10. Folha de anotação (copie para a sessão)

```
Participante: ____________________  Data: ____/____/______
Observador:   ____________________  OPENAI_API_KEY presente? ( ) sim ( ) não

Cronômetro   início: __:__    parada: __:__    total: ____ min
Motivo da parada: ( ) primeira resposta  ( ) desistiu  ( ) 60 min  ( ) falha F__

M1 conta criada           __:__   obs: ______________________________
M2 entrou com o Google    __:__   obs: ______________________________
M3 primeiro tema          __:__   obs: ______________________________
M4 seis temas             __:__   aprofundamentos: ____  obs: _______
M5 primeira resposta      __:__   fontes listadas? ( ) sim ( ) não
M6 fonte conectada        __:__   ( ) não tentou

Intervenções da ROOT: ____ (alvo: 0)
Silêncios > 2 min: ____   onde: ___________________________________

Falhas duras:   ____________________________________________________
Falhas brandas: ____________________________________________________

"Pensou em desistir?"  ______________________________________________
"O que esse sistema faz?" ___________________________________________
```

---

## 11. O que este roteiro **não** testa

Escrito aqui para ninguém concluir demais a partir de uma sessão de uma hora:

- **cobrança e assinatura** — outra fatia (6.2). Uma empresa criada por este caminho não tem plano
  nem cobrança; ela não é suspensa por nada e também não paga nada;
- **os módulos de negócio** — a empresa nasce só com a espinha do OS. Financeiro, leads, pauta e o
  resto não aparecem no menu, e é assim que tem de ser;
- **o segundo usuário** — convidar gente para a empresa não faz parte deste caminho;
- **o retorno no dia seguinte** — a entrada foi feita para ser reaberta (o estado é derivado do
  banco, não guardado no navegador), mas isso precisa de uma sessão própria, com a pessoa voltando
  de outra máquina;
- **o desempenho sob carga** — uma pessoa por vez.
