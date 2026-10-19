# Atendimento por WhatsApp: adaptação do FinOps para o ROOT OS

Pedido do Pedro, conduzido pelo Lucas (19/10/2026). Este arquivo registra a comparação feita
antes de qualquer alteração, o plano por etapas, o que foi implementado e o que falta.

## Origem do código

| Sistema | Repositório | Commit de referência |
|---|---|---|
| FinOps (referência, só leitura) | `pedromagnago/FinOps5.0`, `main` | `f0c40ece6116ef752276433b8dda2cf4520ecbb4` |
| ROOT OS (destino) | `operacaoroot/marketing-os`, branch `root-os/tarefas` | `4b9085c792adcc9a6fb6f696116148465f8d2e85` (produção em 19/10, 17:36 UTC) |
| Trabalho desta adaptação | branch `root-os/atendimento`, worktree `C:\Users\lucas\Projetos\root-os-atendimento` | ver `git log 4b9085c..` |

Conta GitHub em uso nesta máquina: `operacaoroot`, com leitura nos dois repositórios.
No checkout do FinOps, todos os imports do módulo de atendimento resolvem: o GitHub não indica
trabalho local faltando. O que estiver só na máquina do Pedro não foi visto.

## O que existe hoje no ROOT OS

`/atendimento` **não é atendimento**: é a fila de **Aprovações** da porta. O próprio menu diz
"a caixa de entrada por WhatsApp ainda não está disponível". O schema não tinha conversa,
mensagem nem contato de cliente. A Evolution é uma instância só (variáveis de ambiente do
processo) e tem um único webhook, `POST /approvals/canal/whatsapp/:orgId`, com estes consumidores:

1. **Canal de aprovação, entrada**: conversa direta de pessoa cadastrada em `ChannelIdentity`
   responde `APROVAR|RECUSAR ROOT-…` (`gateway/canais/canal-de-aprovacao.service.ts`).
2. **Canal de aprovação, saída**: avisa quem pode assinar, por conversa direta
   (`envio-de-aprovacao.service.ts`, transporte registrado pelo `EvolutionService`).
3. **Grupo de links (MC1)**: grupo `EVOLUTION_LINKS_JID` vira `PautaCaptura`
   (`EntradaDeGrupoRegistry` → `pauta/entrada-de-links.service.ts`).
4. **Efeito `whatsapp.mensagem.enviar`** (R3): sempre para o grupo `EVOLUTION_GRUPO_JID`.
5. **Publicação da pauta**: `PautaPublicacaoService.publicarWhatsapp`, para o grupo.

## Comparação por função

Legenda: **T** existente e testada · **E** existente sem validação · **A** precisa adaptar ·
**X** ausente.

| Função | FinOps (como faz) | ROOT OS antes | Situação |
|---|---|---|---|
| Caixa de conversas (lista, ordem por último contato, 30 por página) | `useConversas`, `chat_contacts` + última mensagem | não existe | X |
| Filtros (minhas, grupos, sem cliente) e busca | filtro no cliente; busca de texto no servidor | não existe | X |
| Não lidas por conversa, marcar como lida | RPC `chat_nao_lidas`, `lida_em` | não existe | X |
| Histórico paginado | keyset por `created_at`, 50 por vez | não existe | X |
| Identificação do contato (telefone, JID, grupo × individual) | `jidToPhone`, `@g.us`, `participant` em grupo | só `chaveDeIdentidadeWhatsapp` para operadores | A |
| Vínculo contato → cliente | `chat_grupo_empresa`, `empresa_chat_contatos`, autovínculo por 90 dias | cliente = card do CRM (`WorkTask` em lista de cadastro) | A |
| Responsável pela conversa | `atendente_id`, transferência com notificação, assume ao responder | não existe | X |
| Situação e encerramento | `encerrar_conversa_chat` com versão; reabre na próxima mensagem do cliente | não existe | X |
| Mensagens recebidas (texto, imagem, áudio, documento, figurinha) | `messages.upsert`, tipos achatados | canal só lê texto curto de operador | A |
| Anexos protegidos | bucket privado `inbox`, caminho por empresa, URL assinada | MinIO privado, arquivo servido pela própria API | A |
| Envio de resposta | `chat-send-message`, saída antes do envio, `client_message_id` único | só envio para grupo fixo ou operador | A |
| Estados de envio (aceita, entregue, lida, erro) | `status_envio` com `messages.update` (`SERVER_ACK`, `DELIVERY_ACK`, `READ`) | não existe | X |
| Eventos repetidos | `evolution_message_id` único, eco `fromMe` reconciliado | sem chave única (aprovação é de uso único) | X |
| Aviso de envio com problema | `statusEnvioChat.ts`: 2 erros em 15 min | não existe | X |
| Mensagem → tarefa | `useVirarTarefa` (sem trava no banco: dá para duplicar) | tarefas com regra de igual/parecida (`tarefas-do-dia.ts`) | A |
| IA de triagem (`chat-ticket-agent`) | propõe ticket em `operador_acoes`, não responde cliente | porta com aprovação, teto de custo de IA | A (etapa futura) |
| Resposta automática fora do horário | existe, travada por `IA_ENVIO_WHATSAPP_BLOQUEADO` | não existe | fora do escopo |
| Chat interno IA ↔ time | `chat_interno_mensagens` | assistente flutuante (`ChatFlutuante`), sem chat entre pessoas | separado |
| E-mail | `email_inbox` e pipeline próprio | Gmail pela porta (`google/gmail`) | separado |

## Decisões de adaptação

- **Um webhook só, sem trocar nada.** A caixa de entrada **escuta** a mesma rota
  (`approvals/canal/whatsapp/:orgId`) por um registro de ouvintes. Os consumidores 1 a 3 continuam
  recebendo exatamente o que recebiam, na mesma ordem. O ouvinte roda depois deles, e uma falha
  dele não chega a eles.
- **A caixa não guarda o que é do canal de aprovação nem do grupo de links**: remetente cadastrado
  em `ChannelIdentity`, grupo inscrito na pauta e respostas no formato `APROVAR/RECUSAR ROOT-…`
  ficam de fora.
- **Desligada por padrão, por empresa.** Só guarda mensagem depois que alguém com
  `atendimento.configurar` liga a caixa na própria tela. Não há variável nova no servidor.
- **Responder passa pela porta.** Capacidade nova `atendimento.whatsapp.responder`. Pela régua ela
  é **R3**, porque expõe para fora, não tem volta e é confidencial. Cada resposta fica retida até
  **outra pessoa** assinar em Aprovações, e quem propõe não assina. Isso não foi afrouxado. Mudar
  é decisão da política (assinatura de rebaixamento) e está nas pendências. O conector `whatsapp`
  desligado em Conexões bloqueia a resposta.
- **Destino sempre calculado no servidor**, a partir da conversa. A tela nunca manda número.
- **Estados separados**: `aguardando_assinatura` → `enviando` → `aceita` (a Evolution devolveu id)
  → `entregue` → `lida`, ou `erro`. O estado só sobe, nunca desce.
- **Tarefa reaproveita Dia a dia › Tarefas** (mesma regra de igual e parecida, mesmo cliente do CRM),
  com trava no banco: uma mensagem gera no máximo uma tarefa.
- **Fica de fora:** o módulo financeiro, IA respondendo cliente, resposta automática, segunda
  instância e qualquer ligação ao banco do FinOps.

## Plano por etapas

1. Banco: contato, mensagem, ajuste por empresa e vínculo mensagem → tarefa. Migration escrita à
   mão, com isolamento por linha e as permissões novas só no Admin Master.
2. Entrada: ouvinte no webhook único; texto, mídia, confirmação de entrega e leitura, mensagem
   apagada; deduplicação por id.
3. Anexos: baixar da Evolution, guardar no MinIO por empresa e servir pela API com permissão.
4. API: lista, histórico, busca, lidas, responsável, cliente, encerrar/reabrir, responder pela
   porta, virar tarefa.
5. Tela `Dia a dia › Conversas` no visual do OS (`.com-tema`).
6. Testes com dados sintéticos e Evolution simulada.

O estado de cada etapa e o roteiro de publicação estão em `ATENDIMENTO-ENTREGA.md`.
