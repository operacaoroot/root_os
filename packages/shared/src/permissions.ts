// Permissões por ação (ver docs/SECURITY.md). Fonte única compartilhada por api e web.

/*
 * AS DUAS CHAVES NOVAS DE APROVAÇÃO — e por que nenhuma permissão existente servia.
 *
 * A fila de aprovação (`/atendimento`, RF-A-05) ficou anos com os dois lados
 * dizendo coisas diferentes: o menu exigia `whatsapp.enviar` e a API exigia
 * `mcp.executar`. O resultado prático era uma tela que aparecia para um perfil e
 * respondia 403 para ele. Alinhar os dois na permissão errada só troca o sintoma:
 *
 *  · `whatsapp.enviar` mora só no Admin Master, e a fila não é do WhatsApp — ela
 *    retém QUALQUER capacidade R2+ do catálogo (publicar peça, pagar, apagar).
 *    Amarrar a fila a um canal é prometer que ela só tem mensagens.
 *
 *  · `mcp.executar` é a permissão de EXECUTAR FERRAMENTA, e é justamente o que as
 *    duas contas de serviço da IA carregam (`ia_servico`, que é read-only por
 *    desenho, e `ia_acao`). Alinhar o menu nela daria às contas de máquina o
 *    alcance da tela que mostra o CONTEÚDO EXATO de toda ação retida — inclusive
 *    o corpo de mensagem `confidencial`. Pior: ela NÃO está no Diretor, que é o
 *    único papel além do Admin Master com alçada `titular` — ou seja, quem R4 e
 *    R5 exigem como assinatura não alcançava a fila.
 *
 * Daí duas chaves próprias, na convenção da casa (`x.ver` + verbo):
 *
 *  · `aprovacoes.ver`     — abrir a fila e ler o que está retido;
 *  · `aprovacoes.decidir` — confirmar ou rejeitar um item.
 *
 * ELAS NÃO SUBSTITUEM A ALÇADA, e essa distinção é o desenho: a permissão diz
 * quem trabalha na fila; a ALÇADA (`apps/api/src/approvals/alcada.ts`, lida do
 * BANCO a cada confirmação) diz de quem a assinatura vale para cada degrau. Um
 * analista com `aprovacoes.decidir` continua sendo recusado num R3 — e a tela
 * diz isso ANTES do clique, em vez de oferecer um botão que vai levar 403.
 *
 * NENHUMA CONTA DE MÁQUINA RECEBE AS DUAS. `ia_servico` e `ia_acao` ficam de
 * fora de propósito: `confirm`/`reject` já recusam papel de máquina (invariante 7
 * da escada), e não dar a permissão é a mesma recusa um passo antes.
 *
 * `aprovacoes.ver` NÃO DÁ ACESSO AO CONTEÚDO. A fila devolve o corpo exato da
 * ação retida só para quem tem `aprovacoes.decidir` — ver o bloco
 * "A EXPOSIÇÃO DE CONTEÚDO" em `apps/api/src/approvals/approvals.controller.ts`.
 * Quem só vê acompanha resumo, nível, gatilhos, prazo e quem assina.
 *
 * ---------------------------------------------------------------------------
 * DEPOIS DE MEXER AQUI, SÃO TRÊS PASSOS — E PULAR QUALQUER UM FALHA CALADO
 * ---------------------------------------------------------------------------
 *   1. pnpm --filter @mktos/shared build
 *      O script do passo 2 roda a partir de `apps/api` e importa `@mktos/shared`
 *      pelo `dist/`. Sem construir antes, ele sincroniza o CATÁLOGO ANTIGO com
 *      ar de sucesso — a chave nova nem aparece na saída.
 *   2. pnpm --filter @mktos/api db:sync-permissions
 *      O catálogo `Permission` é linha de banco, não schema. Sem o sync, a chave
 *      existe no TypeScript e não existe em perfil nenhum, e a tela some para
 *      todos. **O script NÃO é aditivo**: ele REALINHA cada perfil com a tabela
 *      acima (`set:`), então concessão feita à mão no banco e ausente daqui é
 *      REVOGADA. Se alguma empresa tem permissão fora do padrão, ela precisa
 *      estar aqui antes de rodar.
 *   3. todo mundo sai e entra de novo.
 *      A permissão viaja no JWT, montado no login. Sessão aberta continua com a
 *      lista antiga até o token vencer (horas), e o `PermissionsGuard` lê o
 *      token — quem foi promovido vê a tela do banco e leva 403 na rota. A fila
 *      detecta essa divergência e diz "entre de novo" no lugar do botão, mas o
 *      conserto é o login.
 */
export const PERMISSIONS = [
  'dashboard.ver',
  'leads.ver',
  'leads.editar',
  'campanhas.ver',
  'campanhas.editar',
  'instagram.ver',
  'tarefas.ver',
  'tarefas.editar',
  'financeiro.ver',
  'financeiro.editar',
  'financeiro.conciliar',
  'gmail.ver',
  'gmail.responder',
  'agenda.editar',
  'whatsapp.enviar',
  'whatsapp.configurar',
  'drive.ver',
  'drive.editar',
  'obsidian.ver',
  'obsidian.editar',
  'relatorios.ver',
  'relatorios.gerar',
  'relatorios.enviar',
  'automacoes.ver',
  'automacoes.executar',
  'mcp.ver',
  'mcp.executar',
  'admin.usuarios',
  'admin.permissoes',
  'auditoria.ver',
  'bio.ver',
  'bio.editar',
  'pauta.ver',
  'pauta.editar',
  'pauta.publicar',
  /*
   * MD10: receber a sessão e o token curto do YouTube e concluir o envio. É a
   * conta do Mac, e não todo editor: o token só de envio ainda cria vídeo à
   * parte no canal (ver `tokenParaOMac` em envio-ao-youtube.service.ts). Nasce
   * só no Admin Master; a conta do vigia recebe por um perfil próprio.
   */
  'pauta.enviar_ao_youtube',
  'aprovacoes.ver',
  'aprovacoes.decidir',
  /*
   * Cofre da empresa (senhas, dados e documentos dos sócios). Só o Admin Master
   * recebe, pelo `[...PERMISSIONS]`; a migration 20261019150000 soma o vínculo
   * no banco sem passar pelo db:sync-permissions.
   */
  'cofre.ver',
  'cofre.editar',
  /*
   * Dia a dia › Conversas (atendimento por WhatsApp, 19/10/2026). Só o Admin
   * Master recebe, pelo `[...PERMISSIONS]`; a migration 20261019230000 soma o
   * vínculo no banco. Responder não basta para sair: a resposta é R3 e espera
   * a assinatura de OUTRA pessoa em Aprovações.
   */
  'atendimento.ver',
  'atendimento.responder',
  'atendimento.configurar',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/*
 * QUEM RECEBE `aprovacoes.decidir`, E O CRITÉRIO
 *
 * O critério é NECESSÁRIO, não suficiente: só recebe o verbo quem tem alçada
 * `responsavel` ou `titular` em `apps/api/src/approvals/alcada.ts` — os dois
 * degraus que hoje liberam alguma coisa (R3 pede `responsavel`; R4 e R5 pedem
 * `titular`). Ter alçada NÃO concede a permissão sozinho: quem assina o quê é
 * escolha de operação, não dedução de tabela.
 *
 * NESTA FATIA O VERBO FOI SÓ PARA OS DOIS PAPÉIS QUE O DESENCONTRO QUEBROU —
 * `admin_master` (o menu pedia `whatsapp.enviar`, que só ele tem) e
 * `gestor_marketing` (a API pedia `mcp.executar`, que ele tem) — mais `diretor`,
 * que é `titular` e não alcançava nenhuma das duas: sem ele, o único papel capaz
 * de liberar R4 e R5 ficava fora da fila, que é o defeito que a fatia veio
 * consertar.
 *
 * `financeiro` FICOU DE FORA, e de propósito. Ele tem alçada `responsavel`, mas
 * dar-lhe o verbo seria decisão NOVA: ele passaria a autorizar saída externa
 * (hoje, mensagem de WhatsApp) que ele próprio não executa nem acompanha. É
 * pergunta para o Pedro, não dedução de agente — está no relatório. Enquanto
 * isso ele acompanha a fila com `aprovacoes.ver`.
 *
 * `analista` e `social_media` têm alçada `operador`, que só alcança R2 — e R2 é
 * `configuravel`, quer dizer, nem sempre chega à fila. Ficam com `aprovacoes.ver`
 * para acompanhar o que propuseram e o que espera, sem um botão que a alçada
 * deles não sustenta.
 *
 * `consulta_limitada` não recebe nem `ver`: um perfil de leitura restrita não é
 * lugar para a fila de decisão da empresa.
 */
// Perfis sugeridos → conjunto de permissões. (subset inicial; expandir por fase)
export const ROLES = {
  admin_master: {
    name: 'Admin Master',
    permissions: [...PERMISSIONS] as Permission[],
  },
  diretor: {
    name: 'Diretor',
    permissions: [
      'dashboard.ver', 'leads.ver', 'campanhas.ver', 'instagram.ver',
      'tarefas.ver', 'financeiro.ver', 'gmail.ver', 'drive.ver', 'obsidian.ver',
      'relatorios.ver', 'relatorios.gerar', 'relatorios.enviar',
      'automacoes.ver', 'mcp.ver', 'auditoria.ver', 'bio.ver', 'pauta.ver',
      // Alçada `titular`: é a assinatura que R4 e R5 exigem. Sem estas duas, o
      // único perfil capaz de liberar os degraus altos não alcançava a fila.
      'aprovacoes.ver', 'aprovacoes.decidir',
    ] as Permission[],
  },
  // Perfil dedicado ao Financeiro (FinOps): opera contas, lançamentos e bancos.
  financeiro: {
    name: 'Financeiro',
    permissions: [
      'dashboard.ver', 'financeiro.ver', 'financeiro.editar', 'financeiro.conciliar',
      'relatorios.ver', 'relatorios.gerar', 'mcp.ver',
      // SÓ `ver`, e a ausência do verbo é deliberada: a alçada dele alcança R3,
      // mas dar-lhe a assinatura é decisão de operação que ninguém tomou — ele
      // autorizaria envio externo que não executa. Pergunta no relatório.
      'aprovacoes.ver',
    ] as Permission[],
  },
  gestor_marketing: {
    name: 'Gestor de Marketing',
    permissions: [
      'dashboard.ver', 'leads.ver', 'leads.editar', 'campanhas.ver',
      'campanhas.editar', 'instagram.ver', 'tarefas.ver', 'tarefas.editar',
      'gmail.ver', 'gmail.responder', 'agenda.editar', 'drive.ver', 'drive.editar',
      'obsidian.ver', 'relatorios.ver',
      'relatorios.gerar', 'automacoes.ver', 'mcp.ver', 'mcp.executar',
      'bio.ver', 'bio.editar',
      'pauta.ver', 'pauta.editar', 'pauta.publicar',
      // Alçada `responsavel` — alcança R3, que é onde vive a única saída externa
      // com efeito ligado hoje (`whatsapp.mensagem.enviar`).
      'aprovacoes.ver', 'aprovacoes.decidir',
    ] as Permission[],
  },
  analista: {
    name: 'Analista de Marketing',
    permissions: [
      'dashboard.ver', 'leads.ver', 'leads.editar', 'campanhas.ver',
      'instagram.ver', 'tarefas.ver', 'tarefas.editar', 'relatorios.ver',
      'relatorios.gerar', 'automacoes.ver', 'mcp.ver', 'bio.ver',
      'pauta.ver', 'pauta.editar',
      // Só `ver`: alçada `operador` não sustenta R3 (ver o bloco acima de ROLES).
      'aprovacoes.ver',
    ] as Permission[],
  },
  social_media: {
    name: 'Social Media',
    permissions: [
      'dashboard.ver', 'instagram.ver', 'campanhas.ver', 'tarefas.ver',
      'tarefas.editar', 'drive.ver', 'obsidian.ver', 'relatorios.ver',
      'bio.ver', 'bio.editar',
      'pauta.ver', 'pauta.editar', 'pauta.publicar',
      // Só `ver`: publica peça, mas a assinatura que libera a publicação é de
      // outra pessoa — alçada `operador` não alcança R3.
      'aprovacoes.ver',
    ] as Permission[],
  },
  consulta_limitada: {
    name: 'Consulta Limitada',
    permissions: ['dashboard.ver', 'leads.ver', 'campanhas.ver', 'relatorios.ver'] as Permission[],
  },
  // Conta de serviço usada pelo MCP/IA. Só leitura (menor privilégio).
  //
  // SEM `aprovacoes.*`, E ISSO É A FATIA 3.10 INTEIRA EM UMA LINHA. Este perfil
  // tem `mcp.executar` — a permissão que a rota de confirmação exigia até
  // 11/09/2026. Alinhar o menu de `/atendimento` nela teria dado a uma conta
  // declaradamente read-only o alcance da tela que mostra o conteúdo exato de
  // toda ação retida. Quem decide é gente (invariante 7), e agora a permissão
  // diz o mesmo que a trava.
  ia_servico: {
    name: 'IA / Serviço (read-only)',
    permissions: [
      'dashboard.ver', 'leads.ver', 'campanhas.ver', 'tarefas.ver',
      'financeiro.ver', 'instagram.ver', 'relatorios.ver', 'obsidian.ver', 'gmail.ver', 'drive.ver',
      'mcp.ver', 'mcp.executar', 'bio.ver', 'pauta.ver',
    ] as Permission[],
  },
  // Conta de AÇÃO da IA: escreve SÓ o que o humano aprovou (usada pelo bot após
  // confirmação). Least-privilege de escrita — sem admin, sem relatórios.
  //
  // Também sem `aprovacoes.*`, pelo mesmo motivo: ela EXECUTA o que já foi
  // assinado (com o `x-approval-token`, via ApprovalGuard), nunca assina.
  ia_acao: {
    name: 'IA / Ação (aprovada)',
    permissions: [
      'dashboard.ver', 'leads.ver', 'leads.editar', 'campanhas.ver', 'campanhas.editar',
      'tarefas.ver', 'tarefas.editar', 'gmail.responder', 'agenda.editar', 'drive.editar',
      'mcp.ver', 'mcp.executar',
    ] as Permission[],
  },
} as const;

export type RoleKey = keyof typeof ROLES;
