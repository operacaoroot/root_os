# MC18 — DM por palavra-chave (quem comenta a palavra recebe o link da matéria no direct)

> Especificação escrita em 24/09/2026 na branch `root-os/maquina-de-conteudo`, fatia MC18 da frente
> `docs/PLANO-MAQUINA-DE-CONTEUDO.md`. **Não é código.** As decisões D-MC9.x do fim deste documento
> são do Pedro, nenhuma foi tomada por agente, e cada fatia só começa depois das suas:
>
> - **MC18.0 (resposta à mão, sem Meta e sem régua nova):** D-MC9.6 e D-MC9.7.
> - **MC18.1 a MC18.4 (a DM automática):** D-MC9.1, D-MC9.2, D-MC9.3, D-MC9.4, D-MC9.5 e D-MC9.8,
>   mais o App Review da D-MC8 (só a MC18.3 em diante depende dele e da MC17).
>
> O que está marcado **a conferir** não foi confirmado em documentação oficial nesta data e tem de
> ser conferido antes da fatia que depende dele. Revisada no mesmo dia por três leitores (correção,
> regras do repo e contrato); o que eles acharam está incorporado abaixo.


## O que o fluxo faz

É a etapa 12 do vídeo da Ratos de IA: o carrossel e o corte da semana terminam com "comenta a
palavra X", e quem comenta recebe no direct o link da matéria e o episódio completo.

1. A derivação da MC15 já dá a cada matéria do episódio uma **palavra-chave única**
   (`palavraChaveDe` e `palavraUnica` em `apps/api/src/pauta/derivacao-do-episodio.ts`), grava a
   palavra no `meta.palavraChave` do carrossel e do corte, e fecha as duas peças com o CTA
   "o link da matéria e o episódio completo chegam no direct". A frase sai de **três** funções:
   `ctaDoCarrossel().beneficio` (o fechamento que vai para o render do carrossel no Mac),
   `slideDoCta` e `linhaDoCtaNaLegenda`. O story não leva a palavra: chama para o link da bio.
2. Alguém comenta a palavra num post ou reel da conta da Root.
3. A Meta avisa o OS por webhook (`comments`), com o id do comentário, o texto e a mídia.
4. O OS confere três coisas: a mídia é uma peça da semana com palavra-chave; o comentário contém
   aquela palavra; existe uma **regra ativa, aprovada, dentro do prazo e abaixo do teto do dia** para
   aquele par palavra → resposta.
5. O OS manda **uma resposta privada** para o comentário (a "private reply" da Meta): o texto
   aprovado, com o **link rastreado** da matéria — um `/r/<linkId>` de um `BioLink` de campanha,
   como o `linkRastreado` de `apps/api/src/pauta/publicacao.service.ts` já faz para a peça do
   WhatsApp. O destino do link sai de `linkPublicoDoItem` (`apps/api/src/pauta/link-publico.ts`):
   matéria sem link público (origem L, newsletter com `mail.google.com`) **não gera regra nem DM**.
   O clique no link passa pelo `/r/` e vira `PixelEvent` (MC12).
6. Cada envio cai no RASTRO **antes** de sair (invariante 5), com a regra e quem a aprovou.

O que o fluxo **não** faz: não responde publicamente ao comentário, não conversa, não escreve texto
novo por IA na hora do envio e não manda nada para quem não comentou.


## O que a Meta exige

Conferido nas páginas da Meta listadas em "Fontes" em 24/09/2026. O código hoje tem **duas** trilhas
de login com a Meta, e a escolha entre elas muda os nomes das permissões:

- `apps/api/src/meta/meta.service.ts` — Login do Facebook, Graph `v21.0`, escopos
  `public_profile`, `pages_show_list`, `pages_read_engagement`, `business_management`,
  `instagram_basic`, `instagram_manage_insights` (só leitura de métricas);
- `apps/api/src/bio/plataformas/instagram.ts` — Login do Instagram (`graph.instagram.com`), escopo
  `instagram_business_basic`, escolhida "porque NÃO exige Página do Facebook vinculada".

Nenhuma das duas pede hoje permissão de comentário ou de mensagem, e **não existe no código nenhum
receptor de webhook da Meta** (nenhum `hub.challenge` nem `X-Hub-Signature-256` em `apps/api/src`).

| Exigência | O que é | Estado |
|---|---|---|
| Resposta privada: permissões | Login do Instagram: `instagram_business_basic` + `instagram_business_manage_comments`. Login do Facebook: `instagram_basic` + `instagram_manage_comments` + `pages_read_engagement` | **fato** (página "Private Replies") |
| Mensagem comum (resposta a story, conversa depois da primeira DM) | `instagram_business_basic` + `instagram_business_manage_messages` (no Login do Facebook, o equivalente `instagram_manage_messages`) | **fato** para o Login do Instagram; o nome do lado do Facebook e se a resposta privada também exige `manage_messages` na revisão: **a conferir** |
| Janela da resposta privada | até **7 dias** depois do comentário em post ou reel; em live, só durante a transmissão | **fato** |
| Quantas mensagens por comentário | **uma**; mensagem seguinte só se a pessoa responder, o que abre a janela comum | "uma" é **fato**; a abertura da janela de 24h pela resposta da pessoa: **a conferir** |
| Janela comum de mensagens | 24h a partir da última mensagem da pessoa; fora dela, só com a etiqueta de agente humano | 24h é **fato**; o prazo da etiqueta humana (7 dias no Messenger): **a conferir** para o Instagram |
| Envio | `POST /<IG_USER_ID>/messages` com `recipient: { comment_id }` e `message: { text }` | **fato** |
| Webhook de comentários | campo `comments` (e `live_comments`); assinatura da conta por `POST /me/subscribed_apps` com `subscribed_fields` | **fato** |
| Verificação do webhook | `GET` com `hub.mode=subscribe`, `hub.challenge` (devolver) e `hub.verify_token` (o do painel do app) | **fato** |
| Autenticidade do evento | cabeçalho `X-Hub-Signature-256: sha256=<HMAC-SHA256 dos bytes crus do corpo com o App Secret>` | **fato** — a API hoje não guarda o corpo cru em rota nenhuma |
| Reentrega | falhou, a Meta tenta de novo na hora e depois com frequência decrescente por **36 horas** | **fato** — o receptor tem de ser idempotente |
| Modo do app | o app precisa estar em modo **Live** para receber webhook | **fato** |
| Nível de acesso | **Advanced Access** é exigido para receber `comments` e `live_comments`; mensagens pedem Advanced Access quando o app atende contas que não são do dono do app | **fato** — ou seja, **webhook de comentário exige App Review mesmo para a conta da própria Root** |
| App Review e verificação da empresa | Advanced Access passa por App Review (vídeo do fluxo, política de privacidade, uso descrito); verificação da empresa no Business Manager | exigência de App Review para Advanced Access é **fato**; a verificação da empresa, o callback de exclusão de dados e o prazo de análise: **a conferir** |
| Conta | profissional (empresa ou criador) e **pública** para receber comentário por webhook | **fato** |
| Chave "permitir acesso a mensagens" nas ferramentas conectadas da conta | exigida em versões anteriores da API para mensagens | **a conferir** |
| Teto de envio | 750 chamadas por hora por conta para resposta privada a post e reel; 100 por segundo para resposta a comentário de live | vindo do resumo de busca da página de limites do Messenger: **a conferir** na página |
| Tamanho do texto da mensagem | limite de caracteres da mensagem de texto | **a conferir** (o limite do schema da rota, abaixo, segue o menor dos dois) |
| Versão da Graph | o código fixa `v21.0` (`META_GRAPH_URL`) | se a `v21.0` ainda é aceita na data da fatia: **a conferir** |

**Consequência prática:** a DM automática depende do mesmo App Review da MC17 (D-MC8). O pedido de
revisão deve sair **uma vez só**, com as permissões de publicar, de comentário e de mensagem juntas,
e com a trilha de login escolhida (recomendação na D-MC9.8).


## O problema de governança

**É escrita externa, irreversível, em nome da marca, para terceiros, em volume.** Cada item pesa na
régua de `packages/policy/src/escada.ts`:

- `escreveForaDoOS`: sai do OS para o Instagram.
- `reversibilidade`: a API não tem "desenviar" (a pessoa pode apagar do lado dela; a marca não
  recolhe pela API — **a conferir** se o app do Instagram permite desfazer à mão a mensagem enviada
  por API; se permitir, vira `manual`, que dá o mesmo R3).
- `exposicaoExterna`: chega a gente de fora, com o nome da Root.
- `alcance`: não é um envio, é um por comentário. Um post que viraliza são centenas.

E três freios do OS não servem aqui do jeito que estão:

1. **A aprovação é de uso único** (invariante 4: "aprovação é de uso único, presa ao conteúdo exato e
   com prazo"; `usoUnico: true` em R2–R5, validade de 900 s em R3). Aprovar cada DM na fila é
   inviável: o comentário chega a qualquer hora, a janela da Meta é de 7 dias e a fila de
   `/atendimento` viraria caixa de entrada.
2. **R3 exige segunda pessoa** (invariante 7, "aprovador é sempre pessoa: nunca o agente que propôs",
   conferida em `approvals.service.ts`, `confirm`, que recusa `rec.propostoPorId === actorId`). Numa
   empresa de operador único, toda DM ficaria retida para sempre.
3. **Os tetos de volume não existem em runtime.** `limitesPadrao` de `politica-root.json` declara
   `porExecucao: 10`, `porHora: 30`, `porDia: 200`, mas nenhum arquivo de `apps/api/src` lê
   `porHora` nem `porDia`. O único freio de volume que roda é o sinal `volume_atipico`
   (`apps/api/src/policy/sinais.service.ts`), e ele **não serve** para esta capacidade: acende quando
   `naUltimaHora > (total de 30 dias / 720) × 3`. Num fluxo por rajada, como a DM de um post da
   semana, com 1 envio nos 30 dias a média é 0,0014 por hora, e o segundo envio da hora já acende.

O plano já registrou a saída que **não** vale: "não se resolve abrindo a régua". Rebaixar a DM para
R2, ou marcar o envio como vindo "de gente" sem ninguém ter assinado, é o mesmo defeito que
`apps/api/test/publicar-peca.test.ts` mede e que o CLAUDE.md proíbe resolver por atalho.


## O caminho recomendado: a resposta pré-aprovada com alcance

O humano aprova **uma vez** o par **palavra-chave → texto + link**, com **teto por dia**, **prazo de
validade** e **as mídias onde vale**. Uma segunda pessoa, com alçada, assina essa regra. Depois
disso, cada envio individual sai sozinho **dentro** do envelope aprovado e cai no RASTRO com a regra
e o aprovador. Nada fora do envelope sai: texto diferente, link com destino diferente, mídia que não
está na regra, o 101º envio do dia numa regra de teto 100 ou um envio depois do prazo são recusados
e registrados.

**Regra do desenho:** o nível da **ativação** é sempre maior ou igual ao nível do **envio** avaliado
com o sinal que um comentário de estranho sempre acende (`fonte_nao_confiavel`), que é **R4**. É isso
que faz a assinatura da regra cobrir cada envio sem rebaixar nada (invariante 3), e um teste de
`packages/policy` trava a desigualdade.

O que isso preserva de cada invariante:

| Invariante | Como fica |
|---|---|
| 1 · o nível é o gatilho mais alto | a ativação é classificada pelo envelope inteiro (alcance = teto do catálogo) |
| 2 · sem classificação vale R5 | as três capacidades novas entram no catálogo com `nivel` igual ao `classificar()` |
| 3 · conteúdo externo só eleva | o comentário **nunca** entra no texto nem num prompt: dele se usa só o id, a mídia e se contém a palavra. O executor marca a procedência externa em todo envio, `fonte_nao_confiavel` acende e o envio é **R4**; a aprovação R4 da regra (titular, senha, motivo) é o que o cobre |
| 4 · aprovação de uso único, presa ao conteúdo, com prazo | **muda** — ver "O que muda na régua". Continua presa ao conteúdo exato (o hash cobre palavra, texto, destino do link, mídias, teto e prazo) e com prazo; deixa de ser de uso único e passa a ser **de uso contado** |
| 5 · sem RASTRO não executa | cada envio grava `ToolCall`, `PolicyDecision` e evento **antes** do efeito |
| 6 · desligamento de R2 para cima | o interruptor do conector `instagram` recusa todos os envios da empresa enquanto estiver desligado (a regra continua ativa); a regra tem "pausar" próprio, sem aprovação |
| 7 · aprovador é pessoa, nunca quem propôs | vale na ativação: quem propõe a regra não a assina. Cada envio carrega o `aprovadoPorId` da regra |

### As capacidades

**Três capacidades novas** em `packages/policy/politica-marketing-os.json` (nomes no contrato do
catálogo, último segmento é o verbo):

1. **`instagram.resposta_privada.enviar`** — um envio. Só executável **sob uma regra ativa**: a porta
   recusa a chamada que não traga `regraId` válido (ver o item 3 de "O que muda na régua"). Não tem
   rota própria nem ferramenta de agente — quem chama é o executor do webhook.
2. **`instagram.regra_de_resposta.ativar`** — ativar uma regra. O efeito declarado é o **envelope**
   que ela autoriza: é por isso que ela escreve fora do OS, mesmo que o ato de ativar seja uma linha
   no banco. Declarar `escreveForaDoOS: false` aqui seria o desconto de degrau que a régua existe
   para não dar.
3. **`instagram.regra_de_resposta.pausar`** — pausar ou encerrar uma regra. Diminui o alcance do
   OS, não escreve fora: R1, sem aprovação, com `pauta.editar`. Efeito:
   `escreveForaDoOS: false`, `produzArtefato: true`, `reversibilidade: 'automatica'`,
   `sensibilidade: 'interna'`, o resto `false`/`'nenhum'` — sem `produzArtefato: true` o
   `classificar()` dá R0 (conferido) e o `verificarCatalogo()` acusaria a divergência com o R1
   declarado.

**O que tira a regra do ar, e o que não tira.** Retomar uma regra **pausada** não é "despausar": é
ativar de novo, com nova aprovação R4, porque o prazo e o teto podem ter mudado de sentido (é a
assimetria de `conector.desligar` R3 / `conector.religar` R4, em miniatura). Por isso só pausa a
regra o que muda o **envelope** ou mostra defeito nele:

| Situação | O que acontece | A regra |
|---|---|---|
| teto do dia atingido | o envio é **recusado e registrado** | continua ativa; o contador **zera sozinho** na virada do dia em `America/Sao_Paulo`, sem nova aprovação |
| prazo vencido | recusado e registrado | vira `vencida` (fim natural; renovar é nova aprovação) |
| conector `instagram` desligado | recusado e registrado | continua ativa; religar o conector (R4, já assinado) devolve os envios |
| fora da janela de horário | **segurado** até 08:00, dentro do prazo | continua ativa |
| destino do `BioLink` diferente do aprovado | recusado | **pausa** e avisa |
| página do episódio fora do ar (`linkRedireciona` falso) | recusado | **pausa** e avisa |
| 3 recusas seguidas da Meta nesta regra | o terceiro erro é registrado | **pausa** e avisa (contagem própria em `EnvioDeResposta`, não o sinal `erro_recente`) |
| alguém clica em "pausar" | — | **pausa** |

Efeito proposto para o envio e a ativação (`sensibilidade: 'publica'`: o texto e o link são os
mesmos para todo mundo e já estão na legenda; os identificadores da pessoa e do comentário entram no
RASTRO por `sigiloso()`, ver o passo 8; se o texto um dia carregar dado da pessoa, a capacidade sobe
para `confidencial`, que dá o mesmo R3 base):

```jsonc
"efeito": {
  "escreveForaDoOS": true, "produzArtefato": false, "reversibilidade": "nenhuma",
  "exposicaoExterna": true, "impactoFinanceiro": "nenhum", "sensibilidade": "publica",
  "destruicao": false, "obrigacaoLegal": false,
  "alcance": 1      // no envio; na ativação, o teto absoluto do catálogo (200)
}
```

### O que `classificar()` diz

Rodado de verdade contra `packages/policy/dist` (o mesmo `classificar` e `avaliar` que a porta usa),
em 24/09/2026. "Com o sinal" é `fonte_nao_confiavel`, que o executor do webhook marca em todo envio
(`ProcedenciaExterna`). Um sinal sobe **um** degrau, e dois sinais também sobem um só: o resultado é o
mesmo que a primeira versão desta página mostrava com `destinatario_novo` junto.

Dois sinais que a primeira versão contava **não existem em runtime para este fluxo**:
`destinatario_novo` nunca é calculado por `SinaisService.calcular` (só aparece na descrição de
`regua.service.ts` e no simulador), e `erro_recente` só é contado quando há `agentSlug` — o executor do
webhook não tem agente. O R4 do envio depende, portanto, de o executor marcar a procedência externa, e
um teste da MC18.4 cobra essa marca.

| Efeito | `classificar()` | `avaliar()` sem sinal | `avaliar()` com o sinal |
|---|---|---|---|
| envio avulso, `alcance: 1` | **R3** | R3 · alçada `responsavel` · sem reautenticação · validade 900 s | **R4** · `titular` · reautenticação · motivo |
| envio avulso, `reversibilidade: manual` | R3 | igual | R4 |
| envio avulso, `sensibilidade: confidencial` | R3 | igual | R4 |
| ativação com teto de **10**/dia | **R3** | R3 · `responsavel` | R4 |
| ativação com teto de **50**/dia | **R4** | R4 · `titular` · reautenticação · validade 600 s | R4 (sinal não passa de R4) |
| ativação com teto de **200**/dia | **R4** | R4 · `titular` · reautenticação | R4 |
| ativação, teto 50, `sensibilidade: restrita` | **R5** | bloqueado: o OS nunca executa | R5 |
| pausar (interno, `produzArtefato: true`) | R1 | sem aprovação | R2 (configurável) |

Leitura:

- **O envio é R3 por natureza e R4 com o sinal que sempre acende.** Nenhum envio individual cabe no
  caminho de aprovação por item: R4 pede reautenticação com senha a cada DM.
- **A ativação é R4** assim que o teto passa de 10 (`ALCANCE_LIMITE = 10` sobe um degrau). Como o
  `alcance` do catálogo é estático, a capacidade declara o **teto absoluto** (200/dia, o mesmo
  `porDia` de `limitesPadrao`) e fica R4 sempre; o teto de cada regra é argumento, menor ou igual a
  esse. Assinar exige `titular`, senha de novo e motivo escrito — o peso certo para "a marca vai
  falar sozinha com até 200 pessoas por dia durante 7 dias". É também o que satisfaz a regra do
  desenho: ativação R4 ≥ envio R4.
- **Nunca declarar `restrita`**: alcance acima de 10 empurra R4 para R5, e R5 é "preparar e
  encaminhar", não executar. É o limite de cima do desenho.
- Hoje **nenhuma** capacidade do catálogo usa `alcance` (conferido em `politica-*.json`): esta seria a
  primeira, e o gatilho de alcance passaria a ter um caso de teste real.
- **Dois níveis, duas coisas.** O nível da **ativação** (R4) decide quem assina a regra. O nível de
  **cada envio** (R4, pelo sinal) decide o que o RASTRO do envio exige; os sinais não passam de R4 e
  não mudam o comportamento do executor — janela, teto e pausas são regras do próprio executor, no
  passo a passo abaixo.

### O que muda na régua se for aceito

É mudança no documento normativo (`Root/20-empresa/root-os/09 - Escada de risco R0-R5.md`, que
`escada.ts` espelha: "mudou lá, muda aqui"), não só no JSON:

1. **A invariante 4 ganha a segunda forma.** Proposta de texto: "aprovação é de uso único — ou de
   **uso contado**, quando a capacidade declara alcance —, presa ao conteúdo exato e com prazo". Em
   `politica-root.json` (`invariantes`) e no documento do vault, no mesmo dia.
2. **A ativação ganha o modo.** Em `escada.ts`, a capacidade passa a poder declarar
   `aprovacao: { modo: 'alcance', tetoPorDia: 200, validadeMaximaDias: 7 }`. `APROVACAO_POR_NIVEL`
   **não** muda: o modo é da capacidade, não do degrau. Só capacidade com `alcance > 1` declarado
   aceita o modo `alcance` — um teste de `packages/policy` trava isso.
3. **A porta aprende o envio sob regra.** É a mudança que de fato deixa o envio sair sem fila, e
   ela **não** está na ativação: hoje o `ToolGateway` propõe aprovação sempre que a decisão a exige e
   não há token (`tool-gateway.service.ts`, caminho B), e com token consome a aprovação pelo hash dos
   argumentos e pelo recurso (`approvals.consumir`). Um envio com `comment_id` próprio nunca casa
   com a aprovação da ativação, que é de outra capacidade e tem outros argumentos. O desenho:
   - **quem declara:** o envio declara `aprovacao: { modo: 'sob_regra', regra:
     'instagram.regra_de_resposta.ativar' }`; a capacidade apontada tem de declarar o modo `alcance`
     e ter nível ≥ o do envio avaliado com `fonte_nao_confiavel` (teste de `packages/policy`);
   - **o que a porta faz:** com `regraId` nos argumentos e a capacidade em modo `sob_regra`, em vez
     de propor aprovação ou consumir token, chama o consumo contado da regra (item 6) — na empresa da
     sessão, estado `ativa`, `validaAte` no futuro, teto do dia, e o hash do envelope do envio igual
     ao `hashConteudo` aprovado. Qualquer "não" é recusa registrada, nunca queda para o caminho B;
   - **o que entra no hash:** `regraId`, o texto e o `bioLinkId`/destino — o `comment_id` e o id da
     pessoa ficam **fora** (senão nenhum envio casa com a regra);
   - **capacidade sem o modo `sob_regra` não aceita `regraId`**: vai para o caminho de sempre.
4. **O esquema do catálogo aprende o campo — hoje ele o apagaria calado.** `CapacidadeSchema` de
   `packages/policy/src/esquema.ts` é `z.object` do Zod sem `.strict()`: chave desconhecida é
   **descartada em silêncio** no parse, sem erro. Um `aprovacao: {modo: 'alcance'}` no catálogo, antes
   de o esquema declarar o campo, some em `lerPolitica`/`lerDelta` e o modo nunca chega ao runtime.
   Então: `CapacidadeSchema` declara `aprovacao` explicitamente (com `modo` em enum, `tetoPorDia` e
   `validadeMaximaDias` inteiros positivos), `diffDePolitica` trata mudança desse campo como
   afrouxamento, e entram os testes 'o campo `aprovacao` sobrevive a `lerPolitica` e `lerDelta`',
   '`modo: alcance` com `alcance <= 1` é recusado' e '`modo` desconhecido é recusado'.
5. **O validador da porta aprende `maximum`.** `apps/api/src/gateway/validacao.ts` só conhece
   objeto, `required`, tipo, `enum` e `minLength`; `maximum: 200` no `tetoPorDia` seria ignorado em
   silêncio. É o mesmo risco que a A8 registrou para `maxItems`, e o conserto é o mesmo (casos
   próprios em `apps/api/test/validacao.test.ts`, antes do resto).
6. **Consumo contado é atômico, com a virada do dia dentro da mesma escrita.** O uso único de hoje
   é `consumidoEm` + escrita condicionada. O contado é **uma** instrução, com `:hoje` calculado em
   `America/Sao_Paulo` pelo executor:

   ```sql
   UPDATE "RespostaPreAprovada"
      SET "usosNoDia"     = CASE WHEN "diaDoContador" = :hoje THEN "usosNoDia" + 1 ELSE 1 END,
          "diaDoContador" = :hoje
    WHERE id = :regraId AND "orgId" = :orgId
      AND estado = 'ativa' AND "validaAte" > now()
      AND ("diaDoContador" <> :hoje OR "usosNoDia" < "tetoPorDia")
   RETURNING "usosNoDia";
   ```

   Zero linha afetada é recusa. Sem a virada embutida, ou o contador nunca zera, ou o zeramento vira
   um passo separado e volta a corrida: dois webhooks na virada zeram e incrementam em ordem trocada.
7. **O RASTRO do envio segue o R4.** O envio é R4 pelo sinal de procedência externa, e
   `niveis.R4.rastro` exige `hashConteudo`, `aprovador`, `aprovadoEm`, `motivo`, `estadoAnterior` e
   `estadoNovo` (`event-log.service.ts` confere pelo nível **decidido** e grava
   `payload.rastro.faltando` se faltar). `hashConteudo`, `aprovador`, `aprovadoEm` e `motivo` vêm da
   ativação; `estadoAnterior`/`estadoNovo` são o contador da regra antes e depois do consumo
   (`{ dia: '2026-09-28', usosNoDia: 36 }` → `{ dia: '2026-09-28', usosNoDia: 37 }`). A tela do Rastro
   mostra o envio pendurado na regra.
8. **O seed da política leva duas assinaturas.** `db:seed:politica` vai **antes** da subida
   (`docs/DEPLOY.md` §2.0, §2.3b) com:
   - `POLITICA_CAPACIDADE_NOVA_AUTOR` + `_MOTIVO`, pelas três capacidades novas (categoria
     `ACRESCENTA`, `apps/api/prisma/seed-politica.ts`);
   - `POLITICA_REBAIXAMENTO_AUTOR` + `_MOTIVO`, pela invariante 4 reescrita: trocar o texto conta
     como "invariante removida" em `packages/policy/src/sobrescrita.ts`, que é `AFROUXA` — e é
     afrouxamento de verdade, então a assinatura é a certa, não um contorno.

Se o Pedro **não** aceitar a mudança na invariante 4, o desenho não fica de pé pela porta, e as
saídas são a resposta à mão (fatia MC18.0) ou a ferramenta terceira.

### O envio individual, passo a passo

1. `POST` do webhook chega → o corpo é lido **cru**, só nesta rota, com o limite de tamanho aplicado
   antes (como `common/corpo-da-midia.ts` já faz para as rotas de mídia) → confere
   `X-Hub-Signature-256` com **o segredo de plataforma do ambiente** (ver D-MC9.8), em tempo
   constante, sobre os bytes crus → responde 200 rápido e enfileira. **Nada do corpo é usado — nem
   para achar a empresa — antes de a assinatura bater.** Assinatura errada: recusa sem gravar nada
   além do log.
2. Resolve a empresa pelo `igUserId` do evento com `resolverTenantDoIgUserId` (sentinela pública,
   ver D-MC9.8) e roda o resto em `comTenantPublico`.
3. Deduplica, na mesma transação que o passo 6: `commentId` único por empresa (a Meta reentrega por
   36 h) e `(regraId, pessoa)` único (**uma DM por pessoa por regra**: quem comenta 5 vezes recebe
   uma e gasta um do teto).
4. Casa a palavra: função pura que normaliza caixa e acento e exige **palavra inteira** (a mesma
   normalização de `normalizarPalavra`). "AGENTES2" não casa com "AGENTES".
5. Acha a regra ativa da mídia com aquela palavra. Sem regra: registra "sem regra" e para — **nada
   sai**.
6. Confere o envelope, pela tabela "O que tira a regra do ar": conector ligado, prazo, destino atual
   do `BioLink` igual ao aprovado, página do episódio no ar (`linkRedireciona`), e o consumo atômico
   do teto do dia (item 6 acima). Recusa por teto, prazo ou conector é registrada e **a regra
   continua**; destino ou página divergentes **pausam a regra** e avisam. Um consumo recusado desfaz
   a transação do passo 3, e a recusa fica no RASTRO: a pessoa pode receber amanhã se comentar de
   novo.
7. Janela de horário: o executor calcula **ele mesmo** se a hora atual em `America/Sao_Paulo` está
   dentro da `janelaHoraria` da política (08:00–20:00) e, fora dela, **segura** o envio até as 08:00
   (dentro do prazo da regra e dos 7 dias da Meta; o teto consumido é o do dia em que sai). Não usa o
   sinal `fora_da_janela` da porta, que hoje compara em UTC (ver Riscos). Não há disjuntor por volume:
   o teto do dia da regra é o freio (ver D-MC9.4).
8. Grava o RASTRO do envio (R4, item 7 acima), com o `comment_id` e o id da pessoa passados por
   `sigiloso()` — no registro só entram o resumo criptográfico e o tamanho —, **depois** chama o
   efeito registrado em `gateway/efeitos.registry.ts` (nunca por import; `test/arquitetura.test.ts`
   cobra).
9. Registra o resultado (id da mensagem da Meta ou o erro) em `EnvioDeResposta`. Não tenta de novo o
   mesmo comentário se a Meta disse que já houve resposta. Terceira recusa seguida da Meta na regra:
   pausa.


## Modelo de dados (proposta, depois das decisões)

- `RespostaPreAprovada` — a regra. `id`, `orgId`, `episodioId`, `itemId` (a matéria), `palavra`,
  `texto`, `bioLinkId` (o link de campanha `campanha:dm:<itemId>`, **o mesmo** que a MC18.0 cria),
  `destinoAprovado`, `midias` (ids de mídia do Instagram das peças), `tetoPorDia`, `validaAte`,
  `estado` (`proposta`, `ativa`, `pausada`, `encerrada`, `vencida`), `usosNoDia`, `diaDoContador`
  (data em `America/Sao_Paulo`), `hashConteudo`, `approvalId`, `propostoPorId`, `aprovadoPorId`,
  `pausadaPor`, `motivoDaPausa`. Tabela com empresa: RLS com FORCE e policies de leitura e escrita
  separadas, semente em `apps/api/test/tenant-isolation.test.ts`.
- `EnvioDeResposta` — cada envio. Filho da regra: `regraId` (é por ele que o gatilho acha o pai),
  `orgId` com sentinela `''` + gatilho `mktos_orgid_do_pai` + entrada em
  `FILHOS_COM_ORGID_REDUNDANTE`. `commentId` **único por empresa**, `pessoa` = **HMAC-SHA256** do id da
  pessoa no Instagram com a chave `META_WEBHOOK_PESSOA_HMAC_KEY` (nunca o `@`), índice **único
  `(regraId, pessoa)`**, `estado` (`enviado`, `segurado`, `recusado`, `erro`), `mensagemId`, `erro`,
  `criadoEm`. Retenção de 90 dias (D-MC9.9).
- `RotaDeWebhookMeta` — `igUserId → orgId`, sem segredo nenhum, só para o webhook achar a empresa
  (D-MC9.8). Tabela com empresa: `orgId`, RLS com FORCE, policy de **leitura** que libera a sentinela
  pública (só esta consulta) e policy de **escrita** com `WITH CHECK` amarrado à empresa da sessão;
  semente em `tenant-isolation.test.ts`.
- Enum novo tem espelho em `packages/shared/src/schemas.ts`. A mídia do Instagram de cada peça sai da
  MC17 (`externalId` em `PautaPeca`), ou da marcação à mão da MC16 (`urlPublicada`) com a resolução do
  id por leitura.


## Rotas e telas (proposta)

Todo corpo validado por schema zod em `packages/shared/src/schemas.ts`, com limites explícitos:
`palavra` de 3 a 20 caracteres, `texto` de 1 a 1.000 (ou o limite da Meta, se for menor), `tetoPorDia`
de 1 a 200, validade de até 7 dias, e o espelho do enum de estado. O texto proposto ou editado passa
por `semLinksDeCaixaDeEntrada` antes de ser gravado.

- `POST /pauta/episodios/:id/respostas` — propõe as regras do episódio (uma por palavra das peças
  aprovadas cuja matéria tem link público), com o texto padrão e o teto padrão; `pauta.editar`; nada
  sai.
- `POST /pauta/respostas/:id/ativar` — entrega à `PortaDoOperador` a capacidade
  `instagram.regra_de_resposta.ativar`; responde **200** com `aguardando_aprovacao` e
  `precisaDeOutraPessoa: true`, nunca "ativada".
- `POST /pauta/respostas/:id/pausar` — R1, sem aprovação.
- `GET /meta/webhook` (verificação) e `POST /meta/webhook` (eventos) — rotas públicas, fora do
  `JwtAuthGuard`, pela sentinela pública (`common/tenant-publico.ts`); prefixo declarado em
  `apps/api/src/tenants/modulos.ts`.
- Tela: seção "Respostas no direct" no detalhe do episódio e na aba "Semana", legível a 375 px: por
  palavra, o texto, o link, o teto, o prazo, o estado, "enviadas hoje: 37 de 100" e o botão pausar.
  Antes do clique em ativar, a frase: "vai para a fila e precisa de outra pessoa com alçada de
  titular".


## Os testes que travam as fatias

- **MC18.0** · `apps/api/test/pauta-semana.test.ts` (ou arquivo próprio) · 'o link `campanha:dm:<itemId>`
  redireciona e grava `PixelEvent` separado do botão da página' · 'carrossel e corte da mesma matéria
  usam o mesmo link' · 'matéria de newsletter (origem L / `mail.google.com`) não vira link de DM' ·
  'o texto editado passa por `semLinksDeCaixaDeEntrada`'. `apps/web` · 'a aba Semana mostra o texto da
  DM com o botão copiar'. Pisos de api e web subidos no commit da fatia.
- `packages/policy/test` · as três capacidades passam por "todo nível declarado é o que a régua
  calcula" sem caso novo · 'modo alcance só em capacidade com alcance > 1' · 'o campo `aprovacao`
  sobrevive a `lerPolitica`/`lerDelta`; `modo` desconhecido é recusado' · 'capacidade `sob_regra` só
  aponta para capacidade em modo alcance de nível ≥ o seu com `fonte_nao_confiavel`' · 'ativação com
  teto do catálogo é R4; com `restrita` seria R5' · a invariante 4 nova no texto de
  `politica-root.json`.
- `apps/api/test/validacao.test.ts` · '`maximum` recusa acima do teto' e '`maximum` ausente continua
  permissivo'.
- `apps/api/test/porta.test.ts` (a suíte que já monta o `ToolGateway`) · 'envio com `regraId` de outra capacidade, de outra empresa,
  de regra vencida ou pausada NÃO dispensa aprovação e é recusado' · 'capacidade sem modo `sob_regra`
  não aceita `regraId`' · 'o `comment_id` não entra no hash do envelope'.
- `apps/api/test/resposta-pre-aprovada.test.ts` (funções puras + service montado à mão com dublês) ·
  'quem propôs a regra não a ativa' (invariante 7) · 'mudar o texto, o destino do link ou o teto
  depois da assinatura exige nova aprovação' · 'o envio 101 com teto 100 é recusado e registrado, e a
  regra continua ativa' · 'no dia seguinte o contador zera sem nova aprovação' · 'dois envios
  simultâneos no último uso do dia: um sai, o outro não' · 'virada do dia com dois envios
  simultâneos: os dois contam no dia novo, nenhum no velho' · 'regra vencida não envia' · 'comentário
  repetido (reentrega da Meta) não gera segundo envio' · 'a mesma pessoa comentando duas vezes recebe
  uma DM' · 'palavra dentro de outra palavra não casa' · 'o texto do comentário nunca aparece no
  texto enviado' · 'destino do BioLink alterado no /bio pausa a regra' · 'conector desligado não envia
  nada e não pausa a regra' · 'fora da janela (em `America/Sao_Paulo`) o envio fica segurado, não
  recusado' · 'três recusas seguidas da Meta pausam a regra' · 'o envio sai com procedência externa
  marcada (R4)' · 'o RASTRO do envio tem os campos de R4 e não guarda `comment_id` nem id da pessoa
  em claro'.
- `apps/api/test/webhook-meta.test.ts` · 'assinatura errada não grava nada' · 'nada do corpo é lido
  antes da assinatura bater' · 'verificação devolve o `hub.challenge` só com o token certo' ·
  'igUserId de outra empresa não resolve' · 'corpo grande demais é recusado antes do parse'.
- `apps/api/test/rotas-publicas-tenant.test.ts` — ganha a entrada de `resolverTenantDoIgUserId`.
- `apps/api/test/tenant-isolation.test.ts` — reprova sozinha até as tabelas novas terem RLS + FORCE;
  `test:isolamento` verde na MC18.2 e na MC18.3.
- `apps/api/test/arquitetura.test.ts` — o efeito do envio só pelo registro; nenhum literal
  `graph.instagram.com` fora do conector.
- `apps/api/test/publicar-peca.test.ts` — **continua exatamente como está.** Se mudar de cor por
  causa da MC18, alguém resolveu a dívida de "propor em nome do agente" por acidente.
- Pisos de casos e arquivos em `.github/workflows/ci.yml`, subidos no mesmo commit de cada fatia.


## A alternativa: ferramenta terceira (ManyChat)

O ManyChat (e ferramentas parecidas) já faz "comentou a palavra → manda DM" no Instagram, como
parceiro da Meta, sem que a Root precise do próprio App Review para isso. O que se sabe e o que é a
conferir:

| | |
|---|---|
| **Prós** | no ar em dias, não semanas; o App Review e as mudanças da API são problema do fornecedor; já trata janela, deduplicação e reentrega; o texto pode carregar o nosso `/r/<linkId>`, então o clique continua virando `PixelEvent` no OS |
| **Contras** | o envio **não passa pela porta**: sem RASTRO, sem interruptor por empresa, sem segunda pessoa — a governança passa a ser a do painel do ManyChat, e o OS só vê o clique; os dados de quem comenta (id, `@`, nome) ficam num terceiro, que vira operador no sentido da LGPD e entra no aviso de privacidade; mais uma conta conectada ao Instagram da Root; custo por contato |
| **A conferir** | preço vigente e o que conta como contato; se o gatilho por palavra em comentário está no plano pago mais barato; se a API ou o webhook dele deixam o OS registrar cada envio (o que devolveria parte do RASTRO); o termo de tratamento de dados |

Com o ManyChat, o que o OS ainda faz: gera o texto e o link de campanha por palavra (fatia MC18.0) e
a pessoa cola no ManyChat. A aprovação vira convenção, não trava.


## DECISÕES PENDENTES — do Pedro, não de agente

### D-MC9.1 — Aceitar a "aprovação de alcance" na régua (a invariante 4 muda)?

- (a) Sim: resposta pré-aprovada com uso contado, teto e prazo, como descrito acima — com as três
  mudanças na porta (modo `alcance` na ativação, modo `sob_regra` no envio, consumo contado).
- (b) Não: cada DM passa pela fila como R4. Na prática, nenhuma DM sai a tempo.
- (c) Não, e a DM fica fora do OS (ManyChat), com o OS só gerando texto e link.
- (d) Não por enquanto: resposta à mão, com o OS entregando a fila de "quem comentou e o que
  responder" (fatia MC18.0).

**Recomendação:** (d) já, sem depender da Meta nem da régua; (a) como destino, decidida junto com o
App Review da D-MC8. (c) só se o volume de comentários passar do que dá para responder à mão antes de
o App Review sair.

**Por quê:** (a) é a única forma de a DM automática respeitar a porta, mas mexe numa invariante
normativa e depende do App Review. (d) entrega o valor do CTA na primeira semana e mede o volume
real, que é o número que decide se (a) vale o custo.

### D-MC9.2 — Qual o teto absoluto do catálogo?

- (a) Teto do catálogo 200/dia → ativação R4 (`titular`, senha, motivo).
- ~~(b) Teto do catálogo 10/dia → ativação R3 (`responsavel`, sem senha).~~ **Descartada na revisão:**
  cada envio é R4 pelo sinal de procedência externa, e uma assinatura R3 autorizando ações R4
  rebaixaria o que a invariante 3 diz que só sobe. A regra do desenho (ativação ≥ envio) fica num
  teste de `packages/policy`.

**Recomendação:** (a). O teto de cada regra pode ser menor (sugestão: 100/dia). A decisão que sobra é
o **número** do teto do catálogo (200 é o `porDia` de `limitesPadrao`); qualquer valor acima de 10
mantém a ativação em R4.

### D-MC9.3 — Quem é a segunda pessoa na Root?

- (a) Pedro propõe, Lucas ou Rodrigo assinam como `titular`.
- (b) A regra é proposta pelo agente da derivação e o Pedro assina (é a dívida de "propor em nome do
  agente", decisão sua desde a onda 8, com `publicar-peca.test.ts` medindo).

**Recomendação:** (a). Enquanto não houver outro usuário com alçada `titular` na empresa da Root, a
regra fica retida — é decisão de operação, não defeito. Não resolver isto por (b) dentro da MC18.

### D-MC9.4 — Prazo, horário e tetos padrão da regra

**Recomendação:** validade de **7 dias** a partir da publicação da peça (casa com a janela da Meta);
teto padrão **100/dia**, contado por dia de `America/Sao_Paulo` e zerado sozinho na virada; fora da
janela 08:00–20:00 da política, o envio fica **segurado** até 08:00 (dentro dos 7 dias). A janela e
o "segurar até as 08:00" são calculados em `America/Sao_Paulo` **pelo próprio executor**, não pelo
sinal `fora_da_janela` da porta. Sem disjuntor de volume além do teto na primeira versão; o disjuntor
que existe é de erro (3 recusas seguidas da Meta pausam a regra). Renovar é nova aprovação.

### D-MC9.5 — O texto é fixo ou a IA varia por pessoa?

**Recomendação:** fixo, sem IA na hora do envio, sem `@` da pessoa. O vínculo de conteúdo só existe
com texto fixo; IA por envio seria conteúdo que ninguém aprovou, e o comentário entraria num prompt
(invariante 3). O texto passa pela `checagemAntiSlop` e pelo `VozService.bloco` **quando é
proposto**, não quando é enviado.

### D-MC9.6 — Para onde o link aponta?

- (a) Um link de campanha `campanha:dm:<itemId>` — um por **matéria** —, com o destino dado por
  `linkPublicoDoItem` (o mesmo do botão da página do episódio). O carrossel e o corte da mesma matéria
  dividem o link, a MC18.0 o cria e a regra da MC18.2 **reaproveita** o mesmo `bioLinkId`: os cliques
  da fase manual e da automática ficam num link só.
- (b) A página do episódio inteira.

**Recomendação:** (a) com a página do episódio **no ar** como pré-condição (sem ela o `/r/` não
redireciona). Mede o clique da DM separado do clique da página, e o CTA promete "o link da matéria e
o episódio completo" — o texto leva o link rastreado da matéria e o endereço da página do episódio.
Matéria sem link público (origem L, `mail.google.com` e as outras caixas de entrada) não gera link
nem texto de DM, e o texto proposto ou editado passa por `semLinksDeCaixaDeEntrada`.

### D-MC9.7 — O CTA que já sai hoje promete uma DM que ninguém manda

O carrossel e o corte da MC15 dizem "chegam no direct". Postados à mão pela MC16, antes da MC18,
prometem algo que não acontece.

- (a) Manter o texto e responder à mão (MC18.0).
- (b) Trocar o CTA para "link na bio" até a DM existir.

**Recomendação:** (a) se o Pedro topa responder à mão na primeira semana; senão (b). A troca não é
uma linha: a frase mora em `ctaDoCarrossel().beneficio` (o fechamento que o render do carrossel usa),
`slideDoCta` e `linhaDoCtaNaLegenda` (`apps/api/src/pauta/derivacao-do-episodio.ts`), no fallback
fixo de `tools/root-midia/lib/semana.mjs` (o `beneficio` do slide de fechamento) e nos testes que
fixam o texto (`apps/api/test/pauta-semana.test.ts`, o do `beneficio` e os dois da legenda do
corte). As peças **já derivadas** guardam o texto em `meta.cta` e no corpo: têm de ser derivadas de
novo ou editadas.

**Junto (a pergunta que já estava na D-MC9):** o story leva a palavra? Resposta a story chega como
**mensagem**, não como comentário: é a janela comum de 24h e a permissão de mensagens, não a resposta
privada. **Recomendação:** o story continua com o link da bio na primeira versão.

### D-MC9.8 — Trilha de login, qual segredo assina o webhook e como ele acha a empresa

- Trilha: (a) Login do Instagram (`instagram_business_*`, sem Página do Facebook, a do `/bio`); (b)
  Login do Facebook (a do `meta.service.ts`, com Página).
- **Segredo:** o código já modela um app **por empresa** na trilha (a): `BioCredenciaisService`
  resolve o segredo do app pelo cofre da empresa (`NOMES_CONHECIDOS.segredoDoApp`), depois o global,
  depois `INSTAGRAM_APP_SECRET`. Com segredo por empresa, conferir a assinatura antes de saber a
  empresa é impossível, e a saída ingênua — ler o banco a partir de um corpo ainda não autenticado — é
  a que não pode. Opções: (i) **um** segredo de plataforma vindo do ambiente
  (`INSTAGRAM_APP_SECRET` na trilha (a), `META_APP_SECRET` na (b), os dois já no `docker-compose.yml`
  e no `.env.example`), e empresa com app próprio no cofre fica **fora** do webhook da MC18; (ii) uma
  URL de webhook por empresa com app próprio, conferida com o segredo daquela empresa.
- **Empresa:** a Meta tem **uma** URL de webhook por app, então com (i) não dá para pôr o `orgId` na
  URL como no canal do WhatsApp (`POST /approvals/canal/whatsapp/:orgId`). A resolução é pela
  **sentinela pública**, como as outras rotas públicas: nova `resolverTenantDoIgUserId` em
  `apps/api/src/common/tenant-publico.ts` (uma consulta, devolve só o `orgId`), lendo
  `RotaDeWebhookMeta` pela policy de leitura da sentinela, com entrada em
  `apps/api/test/rotas-publicas-tenant.test.ts`; o resto do pedido roda em `comTenantPublico`. **Não**
  é o contexto de plataforma (`CHAMADORES_DE_PLATAFORMA`), que é outra sentinela, e ampliar a policy
  da sentinela para ler `MetaAccount` (que guarda token) está fora.

**Recomendação:** trilha (a) — decidir junto com a D-MC8, porque o App Review é um só — e segredo
(i), `INSTAGRAM_APP_SECRET` do ambiente, com as empresas de app próprio fora da MC18. Em qualquer caso,
nada do corpo é usado antes de a assinatura bater.

### D-MC9.9 — Dados de quem comenta (LGPD)

**Recomendação:** guardar só o `commentId` e um HMAC do id da pessoa (para "uma DM por pessoa por
regra", com o índice único `(regraId, pessoa)` e a chave `META_WEBHOOK_PESSOA_HMAC_KEY` do ambiente),
nunca o `@` nem o texto do comentário; `EnvioDeResposta` com retenção curta (90 dias) e expurgo
próprio. No RASTRO (que guarda por 5 anos, `rastroDias: 1825`), o `comment_id` e o id da pessoa
entram por `sigiloso()` — só o resumo criptográfico. **Não** contar com
`retencao.piiNoRastro: 'mascarada'`: nenhum código de runtime lê esse campo, como `porHora`/`porDia`.
O aviso de privacidade (`docs/PRIVACY.md`) ganha o parágrafo antes do App Review, que pede a URL.

### D-MC9.10 — Responder também em público ("te mandei no direct")?

**Recomendação:** não na primeira versão. É outra capacidade (comentário público, R3), outro texto a
aprovar e mais exposição.


## Fatias de implementação

Cada fatia começa só depois das decisões da coluna "Depende".

| # | Entrega | Depende | Pronto quando | Tam |
|---|---|---|---|---|
| MC18.0 | **Resposta à mão, com o link rastreado** | MC15, MC16, D-MC9.6, D-MC9.7 | para cada peça aprovada com palavra e com link público, a aba "Semana" mostra o texto da DM com o `/r/` do link de campanha `campanha:dm:<itemId>` (um por matéria, destino por `linkPublicoDoItem`) e um "copiar", a 375 px; o texto passa por `semLinksDeCaixaDeEntrada`; matéria de newsletter não gera link; o clique vira `PixelEvent` separado do botão da página; nada sai do OS, sem capacidade nova; os testes da MC18.0 acima verdes e os pisos subidos | P |
| MC18.1 | **A régua aprende o uso contado** | D-MC9.1, D-MC9.2 | `packages/policy` com o modo `alcance` e o `sob_regra` declarados no `CapacidadeSchema` (sem descarte calado), a invariante 4 nova no JSON e no vault, o validador com `maximum`, a porta com o envio sob regra, e os testes da seção acima verdes; `verificarCatalogo()` sem divergência com as três capacidades novas; `db:seed:politica` ensaiado com as duas assinaturas (`CAPACIDADE_NOVA` e `REBAIXAMENTO`) | M |
| MC18.2 | **A regra: propor, ativar, pausar** | MC18.1, MC18.0, D-MC9.3, D-MC9.4, D-MC9.5 | a regra só fica `ativa` depois de outra pessoa `titular` assinar com senha e motivo; mudar texto, destino ou teto volta a `proposta`; a regra reaproveita o `bioLinkId` da MC18.0; o corpo das rotas validado por schema do shared com os limites; `test:isolamento` verde com as tabelas novas; tela a 375 px | M |
| MC18.3 | **Webhook de comentários** | D-MC8 (App Review), D-MC9.8 | um evento assinado com o segredo de plataforma de teste vira item na fila da empresa certa, resolvida por `resolverTenantDoIgUserId` na sentinela pública; assinatura errada não grava e nada do corpo é lido antes dela; corpo cru só nesta rota, com o limite antes; reentrega não duplica; `RotaDeWebhookMeta` com RLS FORCE, semente e `test:isolamento` verde; smoke da rota pública; `META_WEBHOOK_VERIFY_TOKEN` no `docker-compose.yml` e no `.env.example` | M |
| MC18.4 | **O envio sob a regra** | MC18.2, MC18.3, MC17 | com a Graph dublê: comentário com a palavra → um envio com o link `/r/`; a mesma pessoa não recebe duas; o envio além do teto não sai e a regra continua; o contador vira o dia sem aprovação; fora da janela (São Paulo) fica segurado; destino alterado pausa a regra; conector desligado não envia; cada envio no RASTRO como R4, com a regra e o aprovador, antes do efeito, sem `comment_id` nem pessoa em claro; `META_WEBHOOK_PESSOA_HMAC_KEY` no `docker-compose.yml` e no `.env.example` | M |
| MC18.5 | **Prova real** | MC18.4, app em Live com Advanced Access | um comentário real num post real da Root recebe a DM, o clique vira `PixelEvent`, e o tempo humano gasto na semana entra no ensaio "episódio 00" | P |


## Riscos

- **O App Review pode negar ou demorar**, e sem Advanced Access não chega webhook de comentário nem
  para a conta da própria Root. MC18.0 é o que fica de pé se isso acontecer.
- **Robô comentando a palavra em massa** gasta o teto do dia em contas falsas. O teto contém o
  estrago; a deduplicação por pessoa (índice `(regraId, pessoa)`) reduz. O `volume_atipico` **não**
  serve de disjuntor aqui (acende no segundo envio de uma rajada).
- **Casamento errado**: "não quero saber de AGENTES" também casa. O texto aprovado tem de ser bom
  para quem pediu e inofensivo para quem não pediu.
- **Destino mudado depois da assinatura**: o `BioLink` é editável em `/bio`. Sem comparar o destino
  atual com o aprovado a cada envio, a regra mandaria para um link que ninguém aprovou.
- **Página do episódio fora do ar**: o `/r/` não redireciona (`linkRedireciona`), e a DM levaria um
  link morto. A regra pausa.
- **Resolução da empresa no webhook** é mais uma rota pública que consulta o banco antes de haver
  empresa. Ela entra pela sentinela pública (`resolverTenantDoIgUserId`), cobrada por
  `rotas-publicas-tenant.test.ts`; resolver por outro caminho, ou abrir o contexto de plataforma
  num endpoint da internet, é o defeito a evitar.
- **O `fora_da_janela` da porta compara em UTC.** `SinaisService` usa `agora.getHours()` no fuso do
  processo, e o `Dockerfile` (`node:22-slim`), o `docker-compose.yml` e o `.env.example` não definem
  `TZ`: no container a janela 08:00–20:00 vale das 05:00 às 17:00 de Brasília. A MC18 não depende
  disso (o executor calcula a janela em `America/Sao_Paulo`), mas é **pendência à parte**, fora da
  MC18, para todas as capacidades que a porta avalia.
- **A fila de aprovação ainda responde 403 em produção** (`db:sync-permissions` pendente desde
  12/09/2026, `docs/DEPLOY-12-09-2026.md` §1): nenhuma ativação é assinável até isso ser resolvido.
- **Duas trilhas de login com a Meta** no código: escolher uma para a MC17 e a MC18 e não pedir
  permissão nas duas.
- **Os números da Meta mudam** (versão da Graph, limites, regras de janela): cada "a conferir" desta
  página é conferido de novo no início da fatia que depende dele.


## Depende de

- **Só para a MC18.0:** MC15/MC16 (a palavra por matéria e as peças aprovadas), MC12 (página do
  episódio no ar e o `BioLink` de campanha), D-MC9.6 e D-MC9.7.
- **Para a DM automática (MC18.1 em diante):** D-MC8 e MC17 — App Review (publicar, comentários,
  mensagens), app em Live, a mídia publicada com `externalId`; as D-MC9.1 a .5 e .8.
- **403 da aprovação resolvido** em produção, e um segundo usuário `titular` na empresa da Root.
- `db:seed:politica` antes da subida, com as duas assinaturas: `POLITICA_CAPACIDADE_NOVA_*` pelas três
  capacidades novas e `POLITICA_REBAIXAMENTO_*` pela invariante 4 reescrita.


## Esforço

G no total, mas em pedaços: MC18.0 é P e não depende de ninguém de fora; MC18.1 a MC18.4 são quatro
fatias M, **8 a 16 dias** de agente pela convenção do plano (M = 2 a 4 dias), e não começam antes da
D-MC9.1 e do App Review; MC18.5 é o dia da prova. O que pesa não é o código: é a mudança numa
invariante da régua e o calendário da Meta.


## Fontes

Consultadas em 24/09/2026:

- Meta, "Private Replies" — https://developers.facebook.com/docs/instagram-platform/private-replies/
- Meta, "Webhooks" (Instagram Platform) — https://developers.facebook.com/docs/instagram-platform/webhooks/
- Meta, "Send Messages" (Instagram API with Instagram Login) — https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/
- Meta, limites do Messenger Platform (fonte do número de 750/h, **a conferir** na página) — https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview/rate-limiting
