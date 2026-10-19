# Atendimento por WhatsApp: entrega para revisão

19/10/2026. A comparação inicial e as decisões de adaptação estão em `ATENDIMENTO-FINOPS.md`.
**Nada disto foi publicado**, nem na homologação v2 nem na produção, e nenhuma mensagem real foi
lida ou enviada.

## Origem e destino

| | Repositório | Commit |
|---|---|---|
| Referência (só leitura) | `pedromagnago/FinOps5.0`, `main` | `f0c40ece6116ef752276433b8dda2cf4520ecbb4` |
| Base do destino | `operacaoroot/marketing-os`, `root-os/tarefas` | `abd1476` (a v2 roda `10939e1`, um commit antes) |
| Este trabalho | branch local `root-os/atendimento` | um commit em cima de `abd1476`. **Não enviado ao GitHub.** |

Cópia de trabalho: `C:\Users\lucas\Projetos\root-os-atendimento`, fora do Drive e da VPS.

## O que foi implementado

| Função (FinOps) | No ROOT OS | Situação |
|---|---|---|
| Caixa: lista por último contato, 30 por página, não lidas, filtros (minhas, sem responsável, sem cliente, grupos, encerradas), busca | `GET /atendimento/conversas` e tela Conversas | implementada e testada |
| Histórico paginado, 50 por página | `GET /atendimento/conversas/:id/mensagens?antes=` | implementada e testada |
| Busca no texto das mensagens | `GET /atendimento/mensagens/busca?q=` | implementada e testada (sem campo na tela) |
| Marcar como lida | `POST /atendimento/conversas/:id/lida`, chamado ao abrir a conversa | implementada e testada |
| Contato: telefone, grupo, participante, `@lid` com número alternativo | `lerEventoDaEvolution` (`packages/shared/src/atendimento.ts`) | implementada e testada |
| Vínculo com cliente | aponta para o card do CRM (lista de cadastro), só da mesma empresa | implementada e testada |
| Responsável; quem responde primeiro assume | `PATCH /atendimento/conversas/:id` | implementada e testada |
| Encerrar e reabrir com versão; a mensagem do cliente reabre | `POST …/encerrar` e `…/reabrir`, com 409 se a conversa mudou | implementada e testada |
| Mensagens e anexos (texto, imagem, áudio, vídeo, documento, figurinha, contato e local como texto) | ouvinte do webhook; anexo no MinIO em `atendimento/<orgId>/<id>`, servido pela API | implementada e testada |
| Anexo protegido | lista de tipos aceitos, teto de 50 MB, só a empresa dona abre, `nosniff` | implementada e testada |
| Envio com id da tela; clicar duas vezes não manda duas | `POST …/responder` com `clienteMensagemId` único no banco | implementada e testada |
| Estados separados | aguardando assinatura → enviando → aceita → entregue → lida, ou erro; só sobe | implementada e testada |
| Eventos repetidos | `(orgId, evolutionId)` único; o eco da resposta não vira mensagem duplicada | implementada e testada |
| Falha de envio | vira erro com o motivo; "tentar de novo" reaproveita a mesma resposta; aviso com 2 falhas em 15 min | implementada e testada |
| Mensagem apagada pelo cliente | marcada como apagada, sem apagar a linha | implementada e testada |
| Mensagem → tarefa | Dia a dia › Tarefas, com a regra de igual e parecida, o cliente da conversa e o trecho da mensagem; uma tarefa por mensagem, garantida pelo banco | implementada e testada (o FinOps só escondia o botão) |
| Liga e desliga por empresa | `PUT /atendimento/ajuste` (`atendimento.configurar`), desligada por padrão | implementada e testada |
| IA de triagem (`chat-ticket-agent`) | — | **não portada** (pendência 6) |
| Resposta automática fora do horário | — | fora do escopo, de propósito |
| Nome do grupo e foto (`findGroupInfos`) | — | não portado; o grupo aparece como "Grupo …1234" |
| Recuperar mídia após cerca de 72 h (`chat-recover-media`) | — | não portado; o anexo fica marcado "falhou" |
| Aviso de transferência (`chat_transferido`) | — | não portado |
| Tempo real | consulta a cada 10 s (conversa) e 20 s (lista) | adaptado |
| Chat interno e e-mail | continuam separados (assistente flutuante e Gmail pela porta) | sem mudança |

### Como a caixa convive com o que já usa a Evolution

O webhook continua sendo um só, `POST /approvals/canal/whatsapp/:orgId`, com a mesma URL e o
mesmo segredo, e nenhuma instância nova foi criada. A caixa entra por um registro de ouvintes
(`gateway/canais/ouvintes-do-webhook.registry.ts`) que roda **depois** dos consumidores atuais:

| Consumidor atual | Como fica preservado |
|---|---|
| Canal de aprovação, entrada (`APROVAR/RECUSAR ROOT-…`) | Roda primeiro, como antes. A caixa não guarda mensagem de quem está em `ChannelIdentity` nem resposta com código `ROOT-`. Teste: "não guarda o que é do canal…" |
| Canal de aprovação, saída (pedido de assinatura) | Sem mudança no envio. As conversas com quem assina ficam fora da caixa pela mesma regra. |
| Grupo de links da pauta (`EVOLUTION_LINKS_JID`) | Continua sendo despachado primeiro. A caixa ignora grupo inscrito. Teste: "grupo_inscrito". |
| Efeito `whatsapp.mensagem.enviar` (grupo fixo) | Não foi tocado. |
| Publicação da pauta no grupo | Não foi tocada. |

Uma falha da caixa não chega ao canal, e uma falha do canal não impede a caixa. Os dois casos têm
teste. A resposta HTTP do webhook continua constante.

## Arquivos alterados

Novos:

- `apps/api/prisma/migrations/20261019230000_atendimento_whatsapp/migration.sql`
- `apps/api/src/atendimento/` (`atendimento.module.ts`, `atendimento.controller.ts`, `atendimento.service.ts`, `entrada-do-atendimento.service.ts`)
- `apps/api/src/gateway/canais/ouvintes-do-webhook.registry.ts`, `whatsapp-do-atendimento.registry.ts`
- `packages/shared/src/atendimento.ts`
- `apps/web/src/app/conversas/page.tsx`
- testes: `apps/api/test/atendimento-evento.test.ts`, `atendimento-fluxo.test.ts`, `apps/web/tests/component/conversas.test.tsx`
- `docs/ATENDIMENTO-FINOPS.md` e este arquivo

Alterados:

- `schema.prisma`: 4 modelos e 2 enums novos, mais as relações de volta em `Org`, `User` e `WorkTask`. Nenhuma coluna existente mudou.
- `canal-de-aprovacao.controller.ts`: chama os ouvintes depois do caminho de sempre.
- `canais.module.ts`: os dois registros novos.
- `pauta/evolution.service.ts`: oferece `enviarTexto` e `baixarMidia` ao registro do atendimento e ganha `baixarMidia` (`POST /chat/getBase64FromMediaMessage/{instância}`).
- `politica-marketing-os.json`: a capacidade `atendimento.whatsapp.responder`, nível R3, sem ferramenta de agente.
- `integrations/conectores.ts`: a capacidade responde ao conector `whatsapp`.
- `permissions.ts`: `atendimento.ver`, `atendimento.responder` e `atendimento.configurar`.
- `nav.ts`: Dia a dia › Conversas; Aprovações perde o aviso "caixa de entrada ainda não disponível".
- `tenants/modulos.ts`: o prefixo `atendimento` entra na espinha.
- `work.module.ts`: exporta `TarefasDoDiaService`.
- `app.module.ts`: registra o módulo.
- Testes antigos com contagem atualizada, cada um com o motivo escrito: `sobrescrita.test.ts` (22 capacidades sem ferramenta), `conector-desligado.test.ts` (64, 72 e 25) e `nav.test.ts` (47 destinos).

## Testes executados

| O quê | Resultado |
|---|---|
| `atendimento-evento.test.ts`: leitura do webhook, estados, aviso de falha, tipos de anexo | 16/16 |
| `atendimento-fluxo.test.ts`: percurso completo com banco em memória que impõe as chaves únicas da migration, Evolution falsa e porta que retém R3 | 26/26 |
| `conversas.test.tsx`: tela desligada e ligada, permissões, tiques, aviso de falha, resposta retida | 6/6 |
| Prova de que os testes pegam erro: tirei a trava "só sobe" e a reivindicação da tarefa | 5 testes ficaram vermelhos; com o código restaurado, todos voltam a passar |
| Suíte inteira da API, da web e da política contra a linha de base limpa (`4b9085c`) | mesmas falhas da base (134 na API, 78 na web, todas anteriores e ligadas ao Windows: CRLF, link simbólico, instabilidade em `agentes-estado`); **nenhuma falha nova** |
| Tipos: API, testes da API e web | sem erro |
| Postgres 16 + pgvector descartável na VPS, rede própria, sem porta publicada; apagado depois | todas as 87 migrations aplicam do zero |
| A migration bate com o schema (`prisma migrate diff`) | nenhuma divergência do atendimento. Já há 22 tabelas antigas divergentes, sem relação com esta mudança |
| Isolamento por linha com o papel restrito `mktos_app`, dados sintéticos de 2 empresas | A não lê, não altera, não apaga e não grava linha de B. Sem empresa resolvida, ou na resolução pública, não lê nada |
| Chaves no banco | id repetido da Evolution, `clienteMensagemId` repetido, segunda tarefa da mesma mensagem e mensagem de A apontando para conversa de B: todos recusados |
| Reversão | o SQL do cabeçalho da migration remove tudo e preserva o resto; a migration volta a aplicar limpa depois |

**Não testado aqui:** a tela no navegador com login de verdade (sem banco local nesta máquina),
a Evolution de verdade e qualquer mensagem real.

## Como o Lucas confere pela interface (depois de subir na v2)

1. Entrar como Admin Master. Quem já estava logado precisa sair e entrar de novo, porque a permissão viaja no token.
2. Dia a dia › **Conversas**. A tela diz que a caixa está desligada. Clicar em **Ligar a caixa**.
3. Sem mensagem real, a v2 recebe eventos **sintéticos** pelo túnel. O script do item 3 do roteiro manda um texto, uma imagem e um aviso de leitura de um número fictício.
4. Conferir que a conversa aparece com a contagem de não lidas, abre e zera a contagem.
5. Escolher cliente e responsável. Encerrar, mandar outro evento sintético e ver a conversa reabrir.
6. Escrever uma resposta e clicar em **Pedir envio**. A tela diz que foi para Aprovações e que nada saiu.
7. Em Aprovações, a resposta aparece com o texto exato. **Outra pessoa** assina. Na v2 a Evolution não deve estar ligada; sem ela, a resposta vira "não enviada" com o motivo, que é o comportamento certo.
8. Em uma mensagem, clicar em **virar tarefa**. A tarefa aparece em Dia a dia › Tarefas com o cliente e o trecho. Clicar de novo na mesma mensagem não cria outra.

## Configuração necessária (sem valores)

- **Nenhuma variável nova.** Usa `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCIA` e `CANAL_APROVACAO_SEGREDO`, que já existem, e o MinIO (`S3_*`).
- **Seed da política com assinatura de capacidade nova**, obrigatória para a capacidade existir na tabela:
  `POLITICA_CAPACIDADE_NOVA_AUTOR` e `POLITICA_CAPACIDADE_NOVA_MOTIVO` (por exemplo, motivo "atendimento por WhatsApp, Dia a dia › Conversas") com `db:seed:politica`.
- **Eventos do webhook na Evolution**, a confirmar sem alterar nada: hoje o canal só precisa de `MESSAGES_UPSERT`. Os estados entregue e lida dependem de `MESSAGES_UPDATE`, e "apagada" depende de `MESSAGES_DELETE`. Incluir esses eventos **no mesmo webhook** não afeta os consumidores atuais, que ignoram qualquer evento que não seja `messages.upsert`. Ainda assim é alteração de integração e precisa de autorização. Sem eles, a resposta para em "aceita pelo WhatsApp".
- Sem `webhook_base64`, os anexos são baixados pela API (`getBase64FromMediaMessage`). Funciona dos dois jeitos.

## Migration, backup e reversão

- Migration: `20261019230000_atendimento_whatsapp`. Cria 4 tabelas e 2 enums, liga o isolamento por linha, concede as tabelas ao `mktos_app` e cria as 3 permissões, ligadas só ao `admin_master`. **Não altera nem apaga nada que já existe.**
- Backup antes: o mesmo padrão das últimas releases, `pg_dump` com a API parada e o arquivo guardado na pasta da release (`/srv/rootos/releases/<release>/`).
- Reversão em duas camadas, com o SQL exato no cabeçalho da migration:
  1. **Código**: voltar à imagem anterior pela cadeia de overrides. As tabelas novas ficam sem uso e não atrapalham.
  2. **Banco**, só se for preciso: o `DROP` das 4 tabelas e 2 tipos, a remoção das 3 permissões e da linha em `_prisma_migrations`. Isso apaga as conversas guardadas. Os anexos ficam no MinIO em `atendimento/<orgId>/` e são apagados à parte.
- Desligar sem reverter nada: **desligar a caixa** na própria tela para de guardar; **desligar o WhatsApp em Integrações** barra qualquer resposta, inclusive as já assinadas.

## Pendências e decisões

1. **Cada resposta precisa da assinatura de outra pessoa (R3).** É o que a régua do OS manda para tudo que sai para fora sem volta, e não foi afrouxado. Na prática, um atendimento com duas pessoas pode ficar lento. Mudar exige decisão de vocês e um rebaixamento assinado da política (`POLITICA_REBAIXAMENTO_*`). Ainda assim a porta conferiria a régua, porque a capacidade expõe para fora.
2. **Qual número.** A caixa vê o número da instância da ROOT, o mesmo das aprovações. Cliente só aparece se escrever para esse número. Atender pelos números do FinOps exigiria outra instância, e o pedido proíbe criar uma.
3. **Eventos `MESSAGES_UPDATE` e `MESSAGES_DELETE` no webhook**: ver Configuração. Dependem de autorização.
4. **Liga e desliga na tela Conversas, e não em Integrações.** O WhatsApp em si continua em Integrações, e desligar lá barra as respostas. Se o Lucas quiser a caixa também no catálogo de Integrações, é uma mudança pequena.
5. Permissões só no Admin Master. Outros perfis recebem pela tela de perfis.
6. **IA de triagem** (a do FinOps propõe ticket e nunca responde): próxima etapa. Ela entraria como proposta pela porta, dentro do teto de custo de IA, sem resposta ao cliente.
7. Nome e foto de grupo, recuperação de mídia vencida e aviso de transferência não foram portados.
8. A tela não foi vista no navegador com login. Isso fica para a v2 (roteiro abaixo).
9. A branch está só na máquina. Enviar ao GitHub é o primeiro passo do roteiro.

## Roteiro de publicação (cada passo depende de autorização)

1. Enviar a branch `root-os/atendimento` ao GitHub, com um commit em cima de `abd1476`.
2. **v2 (homologação)**, combinando a vez com as outras sessões: bundle → build com tag nova → backup do banco da v2 → `migrate deploy` → `db:seed:politica` com a assinatura de capacidade nova → `up -d api web` → health.
3. Na v2, testar com eventos sintéticos assinados com o segredo do canal da v2, pelo túnel, e com a Evolution da v2 **desligada** em Integrações, para garantir que nada sai. Seguir "Como o Lucas confere".
4. Revisão do Lucas e do Pedro, incluindo as decisões 1 a 4.
5. **Produção**: release nova em `/srv/rootos/releases/atendimento-<commit>-<data>/` com REPORT e rollback, em cima do que estiver no ar (`cadeia-depois.txt` da última release): pg_dump com a API parada → migration → seed da política assinado → up → health com espera.
6. **Teste real autorizado** (só com o OK de vocês): ligar a caixa da ROOT; uma pessoa da equipe manda mensagem de um celular próprio para o número da ROOT; conferir a entrada; responder; outra pessoa assina; conferir a chegada e, com `MESSAGES_UPDATE` ligado, entregue e lida.
7. Só então dizer que está instalado.
