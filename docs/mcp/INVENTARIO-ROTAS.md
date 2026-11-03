# Inventário das rotas da API do ROOT OS

> Gerado em 2026-11-03 por `packages/mcp/scripts/gerar-rotas.ts` a partir de `apps/api/src`. **867 rotas**: 356 de leitura e 511 de escrita; 54 sem sessão (sala do cliente por token, link do onboarding, webhooks, callbacks, login, saúde), que o MCP não alcança. As demais estão todas ao alcance de `os_api`; a coluna Curada diz quais têm ferramenta própria.

Marcas: `gente` recusa conta de máquina · `upload` recebe arquivo · `arquivo` devolve arquivo · `sens` escrita sensível (vira aprovação) · `pub` sem sessão.

## `agenda`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/agenda/aprovacao-r2` | dashboard.ver |  |  |  |
| GET | `/api/agenda/clientes` | dashboard.ver |  |  |  |
| GET | `/api/agenda/conflitos` | dashboard.ver |  |  |  |
| GET | `/api/agenda/convites` | dashboard.ver |  |  |  |
| POST | `/api/agenda/convites` | agenda.editar | gente |  |  |
| POST | `/api/agenda/convites/:id/revogar` | agenda.editar | gente |  |  |
| POST | `/api/agenda/escritas` | agenda.editar | gente |  |  |
| GET | `/api/agenda/espelho` | dashboard.ver |  |  |  |
| POST | `/api/agenda/feriados` | agenda.regras |  |  |  |
| PUT | `/api/agenda/feriados/:id` | agenda.regras |  |  |  |
| GET | `/api/agenda/fora-do-padrao` | dashboard.ver |  |  | `agenda_fora_do_padrao` |
| GET | `/api/agenda/historico` | dashboard.ver |  |  |  |
| GET | `/api/agenda/livre-ocupado` | dashboard.ver |  |  |  |
| GET | `/api/agenda/livres` | dashboard.ver |  |  |  |
| POST | `/api/agenda/padronizar/:eventoId` | agenda.editar |  |  |  |
| GET | `/api/agenda/regras` | dashboard.ver |  |  |  |
| POST | `/api/agenda/regras-texto` | agenda.regras |  |  |  |
| PUT | `/api/agenda/regras-texto/:id` | agenda.regras |  |  |  |
| PUT | `/api/agenda/regras/pessoa/:id` | agenda.regras |  |  |  |
| POST | `/api/agenda/regua/avaliar` | dashboard.ver |  |  |  |
| GET | `/api/agenda/relatorios` | dashboard.ver |  |  |  |
| POST | `/api/agenda/restaurar/:eventoId` | agenda.editar |  |  |  |
| PUT | `/api/agenda/ritos/:id` | agenda.regras |  |  |  |
| GET | `/api/agenda/sincronia` | dashboard.ver |  |  |  |
| POST | `/api/agenda/sincronia/agora` | agenda.editar |  |  |  |
## `agendar`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/agendar/:token` | pública | pub |  |  |
| POST | `/api/agendar/:token/confirmar` | pública | pub |  |  |
| GET | `/api/agendar/:token/ics` | pública | pub |  |  |
## `agents`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/agents` | mcp.ver |  |  | `agentes` |
| POST | `/api/agents` | ...CONFIGURAR_AGENTE |  |  |  |
| GET | `/api/agents/:slug` | mcp.ver |  |  |  |
| PATCH | `/api/agents/:slug` | ...CONFIGURAR_AGENTE |  |  |  |
| GET | `/api/agents/:slug/agendas-locais` | mcp.ver, obsidian.ver |  |  |  |
| POST | `/api/agents/:slug/agendas-locais` | automacoes.executar, admin.usuarios, mcp.ver, obsidian.ver |  |  |  |
| GET | `/api/agents/:slug/agendas-locais/:agendaId` | mcp.ver, obsidian.ver |  |  |  |
| PUT | `/api/agents/:slug/agendas-locais/:agendaId` | automacoes.executar, admin.usuarios, mcp.ver, obsidian.ver |  |  |  |
| POST | `/api/agents/:slug/agendas-locais/:agendaId/disparar` | mcp.ver, mcp.executar, admin.usuarios, obsidian.ver |  |  |  |
| POST | `/api/agents/:slug/agendas-locais/:agendaId/estado` | automacoes.executar, admin.usuarios, mcp.ver, obsidian.ver |  |  |  |
| GET | `/api/agents/:slug/agendas-locais/:agendaId/pedidos/:requestId` | mcp.ver, obsidian.ver |  |  |  |
| GET | `/api/agents/:slug/agendas-locais/configuracao` | automacoes.executar, admin.usuarios, mcp.ver, obsidian.ver |  |  |  |
| POST | `/api/agents/:slug/encerrar` | ...COMANDAR_AGENTE |  | ENCERRAR É DIFERENTE DE APAGAR, e esta rota é a prova. Não existe `DELETE /agents/:slug`, e não deve existir: `Session` aponta para `Agent` sem `onDelete: Casca |  |
| GET | `/api/agents/:slug/estado-humano` | ...COMANDAR_AGENTE |  |  |  |
| POST | `/api/agents/:slug/executar` | ...EXECUTAR_AGENTE |  |  |  |
| POST | `/api/agents/:slug/invocar` | ...EXECUTAR_AGENTE |  | INVOCAR — uma passagem manual, disparada pelo dono na tela (fatia A2). É o primeiro dos quatro gatilhos de heartbeat do plano; os outros três (atribuição, mençã |  |
| POST | `/api/agents/:slug/linha-de-base` | ...CONFIGURAR_AGENTE |  |  |  |
| GET | `/api/agents/:slug/operacoes-locais/:requestId` | pública | pub |  |  |
| POST | `/api/agents/:slug/orcamento` | ...CONFIGURAR_AGENTE |  | O ORÇAMENTO MENSAL DE IA DO AGENTE (fatia A3). PERMISSÃO: `CONFIGURAR_AGENTE`, a mesma da linha de base e do procedimento. Nenhuma chave nova entra no catálogo, |  |
| POST | `/api/agents/:slug/pausar` | ...COMANDAR_AGENTE |  |  |  |
| GET | `/api/agents/:slug/procedimento/execucoes/:id` | mcp.ver, obsidian.ver |  |  |  |
| POST | `/api/agents/:slug/procedimento/executar` | ...EXECUTAR_AGENTE, mcp.ver, obsidian.ver |  |  |  |
| PUT | `/api/agents/:slug/procedimento/ferramenta/configuracao` | ...CONFIGURAR_AGENTE |  |  |  |
| GET | `/api/agents/:slug/procedimento/ferramenta/execucoes/:sessionId` | mcp.ver, obsidian.ver |  |  |  |
| POST | `/api/agents/:slug/procedimento/ferramenta/executar` | mcp.ver, mcp.executar, admin.usuarios, obsidian.ver |  |  |  |
| GET | `/api/agents/:slug/procedimento/ferramenta/painel` | mcp.ver, obsidian.ver |  |  |  |
| GET | `/api/agents/:slug/procedimento/ferramenta/pedidos/:requestId` | mcp.ver, obsidian.ver |  |  |  |
| GET | `/api/agents/:slug/procedimento/fontes` | mcp.ver, obsidian.ver |  |  |  |
| GET | `/api/agents/:slug/procedimento/painel` | mcp.ver, obsidian.ver |  |  |  |
| GET | `/api/agents/:slug/procedimento/pedidos/:requestId` | mcp.ver, obsidian.ver |  |  |  |
| POST | `/api/agents/:slug/retomar` | ...COMANDAR_AGENTE |  |  |  |
| PUT | `/api/agents/:slug/sop` | ...CONFIGURAR_AGENTE |  | Grava o procedimento pela versão que a pessoa leu. O envelope exige expectedSopVersion e procedimento; validarProcedimento conserva as regras dos sete campos e  |  |
| POST | `/api/agents/:slug/stream` | ...EXECUTAR_AGENTE |  |  |  |
| GET | `/api/agents/cadastro` | mcp.ver |  |  |  |
| GET | `/api/agents/configuracao` | ...CONFIGURAR_AGENTE |  |  |  |
| GET | `/api/agents/pedidos/:requestId` | ...CONFIGURAR_AGENTE |  |  |  |
| GET | `/api/agents/prontidao` | mcp.ver |  |  |  |
## `approvals`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/approvals` | VER |  | Os "pedir de novo" em curso neste processo: dois cliques não fazem dois pedidos. | `aprovacoes_listar` |
| POST | `/api/approvals` | mcp.executar |  |  |  |
| GET | `/api/approvals/:id` | VER |  |  |  |
| POST | `/api/approvals/:id/confirm` | DECIDIR |  |  |  |
| POST | `/api/approvals/:id/pedir-de-novo` | VER |  | `POST /approvals/:id/pedir-de-novo` — recria o pedido vencido com o conteúdo de agora, pelo caminho do domínio, em nome de quem clicou. Ordem das recusas: a apr |  |
| POST | `/api/approvals/:id/reject` | DECIDIR |  |  |  |
| POST | `/api/approvals/canal/whatsapp/:orgId` | pública | pub | Produção 22C (W1): sem o registro (as suítes que montam à mão), nada é gravado e o webhook é o de antes. |  |
| GET | `/api/approvals/fila` | VER |  |  | `aprovacoes_fila` |
| GET | `/api/approvals/lotes/:id` | aprovacoes.ver |  |  |  |
| POST | `/api/approvals/lotes/:id/pedir-assinatura` | pauta.publicar |  |  |  |
## `assinatura`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/assinatura` | pública | pub | O contrato desta empresa e as últimas cobranças. Sem credencial nenhuma. |  |
| PUT | `/api/assinatura` | admin.usuarios |  |  |  |
| POST | `/api/assinatura/conferir` | admin.usuarios |  | "Já paguei, confere aí." ---------------------------------------------------------------------------- ELA EXIGE PERMISSÃO, E A PRIMEIRA ESCRITA NÃO EXIGIA NADA  |  |
| PUT | `/api/assinatura/credencial` | admin.usuarios |  | Guarda a chave do provedor no cofre. A RESPOSTA NÃO DEVOLVE A CHAVE, nem parte dela, nem os quatro últimos caracteres. "Só o sufixo" é o padrão que parece inofe |  |
| POST | `/api/assinatura/reativar` | admin.usuarios |  |  |  |
| POST | `/api/assinatura/suspender` | admin.usuarios |  |  |  |
## `audit`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/audit` | auditoria.ver |  |  | `auditoria` |
| DELETE | `/api/audit/retencao` | auditoria.ver, admin.permissoes |  | Volta a herdar o prazo da política. Apaga a CONFIGURAÇÃO, nunca evento. Aceita corpo por causa do `motivo`: quando a herança ENCURTA a guarda, o serviço o exige |  |
| GET | `/api/audit/retencao` | auditoria.ver |  | Quanto tempo o rastro desta empresa fica (RF-R-06). |  |
| PUT | `/api/audit/retencao` | auditoria.ver, admin.permissoes |  |  |  |
| GET | `/api/audit/verificar` | auditoria.ver |  |  |  |
## `auth`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/auth/google/callback` | pública | pub |  |  |
| GET | `/api/auth/google/disponivel` | pública | pub | A tela de login usa p/ decidir se mostra o botão do Google. |  |
| GET | `/api/auth/google/start` | pública | arquivo pub |  |  |
| POST | `/api/auth/login` | pública | pub |  |  |
| GET | `/api/auth/me` | sessão |  |  |  |
| POST | `/api/auth/reautenticar` | sessão |  | Troca a senha do próprio usuário por uma PROVA curta para aprovar uma ação de R4/R5 (RF-A-03). A tela pede a senha uma vez e apresenta a prova em `POST /approva |  |
## `bio`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/bio/analytics/detail` | bio.ver |  |  |  |
| GET | `/api/bio/analytics/summary` | bio.ver |  |  |  |
| GET | `/api/bio/avatar/:arquivo` | pública | arquivo pub | Entrega o avatar. O bucket não é público (as portas do MinIO só respondem na rede do compose), então o arquivo sai por aqui — é isto que torna a URL do avatar e |  |
| POST | `/api/bio/bridge/goals` | bio.editar |  | Recalcula GoalWeek.bioClicks a partir dos cliques registrados. Idempotente. |  |
| GET | `/api/bio/challenge` | bio.ver |  |  |  |
| POST | `/api/bio/challenge` | bio.editar |  |  |  |
| POST | `/api/bio/challenge/accounts` | bio.editar |  |  |  |
| DELETE | `/api/bio/challenge/accounts/:id` | bio.editar |  |  |  |
| POST | `/api/bio/challenge/accounts/:id/manual-count` | bio.editar |  |  |  |
| POST | `/api/bio/challenge/sync` | bio.editar |  |  |  |
| GET | `/api/bio/connections` | bio.ver |  |  |  |
| DELETE | `/api/bio/connections/:id` | bio.editar |  |  |  |
| GET | `/api/bio/connections/:plataforma/start` | bio.editar |  |  |  |
| GET | `/api/bio/credentials` | admin.usuarios |  |  |  |
| DELETE | `/api/bio/credentials/:plataforma` | admin.usuarios |  |  |  |
| POST | `/api/bio/credentials/:plataforma` | admin.usuarios |  |  |  |
| DELETE | `/api/bio/links/:id` | bio.editar |  |  |  |
| PATCH | `/api/bio/links/:id` | bio.editar |  |  |  |
| POST | `/api/bio/links/:id/move` | bio.editar |  |  |  |
| GET | `/api/bio/pages` | bio.ver |  |  |  |
| POST | `/api/bio/pages` | bio.editar |  |  |  |
| GET | `/api/bio/pages/:id` | bio.ver |  |  |  |
| POST | `/api/bio/pages/:id/avatar` | bio.editar | upload |  |  |
| POST | `/api/bio/pages/:id/links` | bio.editar |  |  |  |
| POST | `/api/bio/pages/:id/publish` | bio.editar |  |  |  |
| GET | `/api/bio/public/page/:handle` | pública | pub |  |  |
| POST | `/api/bio/public/track` | pública | pub | Pageview enviado pelo RSC da página pública (server-to-server). |  |
| GET | `/api/bio/r/:linkId` | pública | arquivo pub | Saída passa por aqui pra registrar o clique ANTES de mandar embora. O cookie `rid` chega porque o web faz proxy de /api na mesma origem. |  |
## `caixa`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/caixa` | dashboard.ver |  |  | `caixa` |
| GET | `/api/caixa/atividade` | dashboard.ver |  |  |  |
| GET | `/api/caixa/contador` | dashboard.ver |  |  |  |
| POST | `/api/caixa/limpar` | dashboard.ver |  |  |  |
| GET | `/api/caixa/pendencias` | dashboard.ver |  |  |  |
| GET | `/api/caixa/tarefas` | dashboard.ver |  |  |  |
## `campaigns`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/campaigns` | campanhas.ver |  |  |  |
| GET | `/api/campaigns/:id` | campanhas.ver |  |  |  |
| PATCH | `/api/campaigns/:id` | campanhas.editar | sens |  |  |
## `clientes`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| POST | `/api/clientes/:id/pasta` | dashboard.ver |  |  |  |
| GET | `/api/clientes/pastas` | dashboard.ver |  |  |  |
## `cofre-da-empresa`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| POST | `/api/cofre-da-empresa/destrancar` | cofre.ver |  |  |  |
| GET | `/api/cofre-da-empresa/estado` | cofre.ver |  |  | `cofre_estado` |
| GET | `/api/cofre-da-empresa/itens` | cofre.ver |  |  | `cofre_itens` |
| POST | `/api/cofre-da-empresa/itens` | cofre.editar |  |  |  |
| DELETE | `/api/cofre-da-empresa/itens/:id` | cofre.editar |  |  |  |
| PATCH | `/api/cofre-da-empresa/itens/:id` | cofre.editar |  |  |  |
| GET | `/api/cofre-da-empresa/itens/:id/arquivo` | cofre.ver | arquivo |  |  |
| POST | `/api/cofre-da-empresa/itens/:id/arquivo` | cofre.editar |  | O arquivo cru no corpo (application/octet-stream); nome no cabeçalho x-nome-arquivo (URI-encoded). |  |
| POST | `/api/cofre-da-empresa/itens/:id/revelar` | cofre.ver |  |  |  |
| GET | `/api/cofre-da-empresa/pessoas` | cofre.editar |  |  |  |
| POST | `/api/cofre-da-empresa/senha` | cofre.ver |  |  |  |
| DELETE | `/api/cofre-da-empresa/senha/:userId` | cofre.editar |  |  |  |
| POST | `/api/cofre-da-empresa/trancar` | cofre.ver |  |  |  |
## `comercial`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| POST | `/api/comercial/aceites/:leadId/propor` | leads.editar |  | Propõe (de novo) a cobrança e o contrato do aceite, quando a aprovação anterior venceu. |  |
| GET | `/api/comercial/clientes-ativos` | leads.ver |  |  |  |
| POST | `/api/comercial/clientes-ativos/:leadId/cadastro` | leads.editar |  |  |  |
| POST | `/api/comercial/clientes-fechados-fora` | leads.editar | upload |  | `comercial_cliente_fechado_fora` |
| GET | `/api/comercial/config` | leads.ver |  | Os interruptores e a régua por empresa (K08). Sem linha gravada, os padrões da regra vigente. |  |
| PUT | `/api/comercial/config` | aprovacoes.decidir |  | Os interruptores da mesa (K08) e a autonomia são decisão de mesa (A-1): pede `aprovacoes.decidir`, recusa conta de máquina e grava no RASTRO. |  |
| GET | `/api/comercial/contratos` | leads.ver |  | A lista de contratos vivos da empresa. | `comercial_contratos` |
| GET | `/api/comercial/contratos/:leadId` | leads.ver |  | Tela 11: o contrato vivo, com parcelas, régua de cobrança, entregas, saúde e marcos. |  |
| POST | `/api/comercial/contratos/:leadId/assinar-pela-root` | leads.editar |  | O signatário da Root pede o link para assinar (D-1): só o signatário cadastrado no documento, titular relido no banco, com a senha conferida agora (`{ senha }`  |  |
| POST | `/api/comercial/contratos/:leadId/encerrar` | leads.editar |  | Encerrar à mão (rodada do trabalho T8): concluir ou desativar, com motivo. Escrita interna classificada R0 pela escada; o gate é `leads.editar`. |  |
| GET | `/api/comercial/contratos/:leadId/importados/anexo` | leads.ver | arquivo | O PDF anexado (o mais novo, ou o de `sha`): quem vê o lead vê o contrato dele. |  |
| POST | `/api/comercial/contratos/:leadId/importados/anexo` | leads.editar | gente upload |  |  |
| PUT | `/api/comercial/contratos/:leadId/importados/parcelas` | leads.editar | gente |  |  |
| POST | `/api/comercial/contratos/:leadId/importados/regua` | leads.editar | gente |  |  |
| POST | `/api/comercial/contratos/lote` | leads.editar | gente |  |  |
| GET | `/api/comercial/contratos/quadro` | leads.ver |  |  |  |
| POST | `/api/comercial/contratos/registro` | leads.editar | gente |  |  |
| GET | `/api/comercial/contratos/registro/:id` | leads.ver |  |  |  |
| PATCH | `/api/comercial/contratos/registro/:id` | leads.editar | gente |  |  |
| POST | `/api/comercial/contratos/registro/:id/cancelar` | leads.editar | gente | Propõe à porta (R3). Retida, responde 200 com `status: 'aguardando_aprovacao'`: quem clicou não confirma o próprio pedido. |  |
| POST | `/api/comercial/contratos/registro/:id/conferir` | leads.editar | gente |  |  |
| POST | `/api/comercial/contratos/registro/:id/encerrar` | leads.editar | gente |  |  |
| POST | `/api/comercial/contratos/registro/:id/enviar` | leads.editar | gente | Recalcula tudo, congela o estado com o hash do PDF e propõe à porta (R4). Retida, responde 200 com `status: 'aguardando_aprovacao'`: outra pessoa titular confir |  |
| POST | `/api/comercial/contratos/registro/:id/filhos` | leads.editar | gente |  |  |
| POST | `/api/comercial/contratos/registro/:id/minuta` | leads.editar | gente | Gera a minuta pelo molde da modalidade (ou pela nota do Drive) e a vincula ao registro. Devolve a ficha. |  |
| GET | `/api/comercial/contratos/registro/:id/previa.pdf` | leads.ver | arquivo | O PDF de agora, sem guardar nada e sem cache. Lacuna é 409 com a lista em `faltando`. |  |
| POST | `/api/comercial/contratos/registro/:id/reabrir` | leads.editar | gente |  |  |
| POST | `/api/comercial/contratos/registro/:id/reenviar` | leads.editar | gente | Propõe à porta (R3), com a mesma resposta de retida. A ZapSign não reenvia e-mail: ver o efeito. |  |
| POST | `/api/comercial/contratos/registro/:id/revisar` | leads.editar | gente | Roda o revisor de novo sobre a minuta vinculada. Devolve a ficha. |  |
| PUT | `/api/comercial/contratos/registro/:id/signatarios` | leads.editar | gente |  |  |
| GET | `/api/comercial/decisoes` | leads.ver |  | A fila de decisões (abertas, tomadas, expiradas). | `comercial_decisoes` |
| POST | `/api/comercial/decisoes/:id/responder` | leads.editar, aprovacoes.decidir |  | Um toque: responde a decisão pela tela. |  |
| POST | `/api/comercial/entrada/whats` | leads.editar |  | E1: o lead entra pelo WhatsApp (simulador ou provedor). Idempotente pelo telefone e pela mensagem. |  |
| GET | `/api/comercial/fechamentos/:leadId` | leads.ver |  | Tela 10: o fechamento do lead, escrita a escrita. |  |
| GET | `/api/comercial/fechamentos/:leadId/conteudo` | aprovacoes.decidir |  | Revisão P2-1: o que a titular assina no R4 do fechamento, para o cartão de `/atendimento`. Como o conteúdo da sala e da proposta, só para quem decide (`aprovaco |  |
| POST | `/api/comercial/fechamentos/:leadId/rodar` | leads.editar |  | Propõe (de novo) o fechamento à porta. A chave impede duplicar; R4 espera a titular. |  |
| GET | `/api/comercial/fila` | leads.ver |  | Tela 03: a fila de decisões, o que rodou sozinho hoje e os contadores. | `comercial_fila` |
| GET | `/api/comercial/funil` | leads.ver |  | Tela 04: o funil vivo, com as saídas visíveis. Filtros do painel (U4): `dono` (id, `eu` ou `sem`), `produto`, `perfil`, `etapa` (ou `saidas`), `parado=1`, `deci | `comercial_funil` |
| GET | `/api/comercial/lead/:id` | leads.ver |  | Tela 05: a ficha do lead — projeção do fio, com o portão da próxima etapa. |  |
| GET | `/api/comercial/lead/:id/area` | leads.ver |  |  |  |
| POST | `/api/comercial/lead/:id/area/:item/publicar` | leads.editar | gente |  |  |
| PUT | `/api/comercial/lead/:id/area/:item/rascunho` | leads.editar | gente |  |  |
| GET | `/api/comercial/lead/:id/area/:item/versoes` | leads.ver |  |  |  |
| POST | `/api/comercial/lead/:id/ata` | leads.editar |  | E4: a ata da sessão chega. Só o hash vai para o fio; quem sobe a ata é o sócio da conta. |  |
| GET | `/api/comercial/lead/:id/contrato-anexado` | leads.ver | arquivo | O PDF anexado, para conferir antes de assinar o fechamento (quem vê o lead vê o contrato dele). |  |
| POST | `/api/comercial/lead/:id/diagnostico/aprovar` | aprovacoes.decidir |  | Aprova o diagnóstico (portão de E5). É o toque do sócio que solta a proposta. Revisão E-4/C-8: decisão de mesa (`aprovacoes.decidir`, conta de máquina recusada) |  |
| POST | `/api/comercial/lead/:id/diagnostico/gerar` | leads.editar |  | Refaz o diagnóstico a partir do texto da ata (a transcrição não fica guardada no OS). 503 se o modelo não devolve o JSON combinado. |  |
| PATCH | `/api/comercial/lead/:id/ficha` | leads.editar | gente |  |  |
| GET | `/api/comercial/lead/:id/fio` | leads.ver |  | O fio cru (as linhas) — para a tela 05 e para a suíte. |  |
| POST | `/api/comercial/lead/:id/fio/nota` | leads.editar | gente |  |  |
| GET | `/api/comercial/lead/:id/geral` | leads.ver |  |  |  |
| POST | `/api/comercial/lead/:id/identidade` | leads.editar | gente | Layout 26/10: corrigir o nome do contato e/ou a empresa do lead (fato no fio, sem automação). |  |
| GET | `/api/comercial/lead/:id/minuta` | leads.ver |  |  |  |
| POST | `/api/comercial/lead/:id/minuta` | leads.editar | gente |  |  |
| POST | `/api/comercial/lead/:id/minuta/revisar` | leads.editar | gente |  |  |
| POST | `/api/comercial/lead/:id/mover` | leads.editar | gente | U4 · MOVER, sem limitação: a pessoa com `leads.editar` leva o lead para qualquer etapa (para a frente, para trás, E8 e E9, de e para as saídas). Grava direto: s |  |
| GET | `/api/comercial/lead/:id/mover/pedido` | leads.ver |  | APOSENTADO (U4, 20/10/2026) · o estado do pedido de mover. Não há mais pedido: responde sempre vazio, para a aba antiga parar de esperar. |  |
| POST | `/api/comercial/lead/:id/mover/pedido` | leads.editar | gente | APOSENTADO (U4, 20/10/2026) · o pedido de mover. O mover não pede mais assinatura: responde 410 com o caminho novo e não cria nada na fila. |  |
| POST | `/api/comercial/lead/:id/negocio` | leads.editar | gente | Layout 26/10: valor negociado, vendedor (≠ dono) e canal de aquisição; fato no fio, sem automação. |  |
| GET | `/api/comercial/lead/:id/pendencias` | leads.ver |  |  |  |
| POST | `/api/comercial/lead/:id/proposta/gerar` | leads.editar |  | Monta (ou refaz) a proposta pela tabela, passa pelo revisor e encaminha: porta, ou fila de decisões. Corpo opcional: `{ produto }`. |  |
| POST | `/api/comercial/lead/:id/proposta/publicar` | leads.editar |  | Libera a proposta pronta, agendada ou segurada: vai à porta em nome de quem pediu (R3: OUTRA pessoa confirma). |  |
| POST | `/api/comercial/lead/:id/proposta/segurar` | leads.editar |  | "Segurar": tira a proposta da agenda e da fila de liberação. |  |
| GET | `/api/comercial/lead/:id/proposta/v/:versao/conteudo` | aprovacoes.decidir |  | Revisão E-7: o cartão de /atendimento da proposta. Quem libera o R3 lê o conteúdo que o hash prende, com o hash recalculado agora. Só para quem decide a fila (` |  |
| GET | `/api/comercial/lead/:id/reacoes` | leads.ver |  | I4: o que o cliente leu na proposta e o que anotou nela (leitura agregada por seção, "faz sentido", dúvidas e ideias com o texto já mascarado). Só lê, na empres |  |
| POST | `/api/comercial/lead/:id/saida` | leads.editar |  | Saída com motivo e dono (desqualificado, geladeira, perdido, parceiro). |  |
| POST | `/api/comercial/lead/:id/sala` | leads.editar | gente | L6: "criar a sala agora" para o lead sem sala. Devolve o estado novo (sem link em claro). |  |
| GET | `/api/comercial/lead/:id/sala/estado` | leads.ver |  |  |  |
| POST | `/api/comercial/lead/:id/sala/link` | leads.editar | gente |  |  |
| POST | `/api/comercial/lead/:id/sala/publicar` | leads.editar | gente |  |  |
| PUT | `/api/comercial/lead/:id/sala/rascunho` | leads.editar | gente |  |  |
| POST | `/api/comercial/lead/:id/sala/renovar` | leads.editar | gente | L6: "gerar link novo". O link sai só nesta resposta, como em copiar. |  |
| GET | `/api/comercial/lead/:id/sala/v/:versao/conteudo` | aprovacoes.decidir |  |  |  |
| GET | `/api/comercial/lead/:id/sala/versoes` | leads.ver |  |  |  |
| GET | `/api/comercial/lead/:id/sessao` | leads.ver |  | Tela 06: o pós-sessão — diagnóstico com minuto, rascunhos da proposta com o laudo e o estado. |  |
| POST | `/api/comercial/lead/:id/tipo` | leads.editar | gente |  |  |
| POST | `/api/comercial/lead/:id/venda-nova` | leads.editar | gente | 29/10: venda nova de quem já é cliente: lead novo ligado ao MESMO cadastro do lead `:id` (sem mover, cobrar nem mandar mensagem). |  |
| POST | `/api/comercial/leads/:leadId/onboarding-antecipado` | leads.editar, tarefas.editar | gente |  |  |
| GET | `/api/comercial/leads/parecidos` | leads.ver |  | 29/10: o "+ lead" pergunta antes de criar: já há lead com esta empresa, telefone, e-mail ou contato? Só leitura. | `comercial_leads_parecidos` |
| GET | `/api/comercial/lista-de-leads` | leads.ver |  |  | `comercial_lista_de_leads` |
| POST | `/api/comercial/mensagens/:id/enviar` | leads.editar |  |  |  |
| GET | `/api/comercial/onboarding-antecipado/elegiveis` | leads.ver |  | A busca da Implantação: só leads em andamento no funil, sem card e sem cliente ativo. |  |
| GET | `/api/comercial/onboarding-antecipado/etapas` | leads.ver |  | As etapas de entrada da lista de onboarding (a primeira e a de encerramento ficam de fora). |  |
| GET | `/api/comercial/painel` | leads.ver |  |  | `comercial_painel` |
| GET | `/api/comercial/propostas` | leads.ver |  |  | `comercial_propostas` |
| GET | `/api/comercial/propostas/:leadId` | leads.ver |  |  |  |
| POST | `/api/comercial/reacoes/:id/respondida` | leads.editar | gente |  |  |
| POST | `/api/comercial/reacoes/:id/tarefa` | leads.editar, tarefas.editar | gente |  |  |
| GET | `/api/comercial/relatorio/leitura` | leads.ver |  |  |  |
| GET | `/api/comercial/relatorio/semana` | leads.ver |  | Tela 13: o último relatório gerado com o mesmo recorte; sem ele, os números ao vivo (sem leitura). | `comercial_relatorio_semana` |
| POST | `/api/comercial/relatorio/semana/gerar` | leads.editar |  | Gera o relatório agora (o que o relógio faz na quinta 18:00). Corpo opcional: `{ dias }`. | `comercial_relatorio_semana_gerar` |
| GET | `/api/comercial/rodada-da-semana` | leads.ver |  |  |  |
| GET | `/api/comercial/simulador/celulares` | leads.ver |  | Os celulares: um por lead que tem conversa. |  |
| POST | `/api/comercial/simulador/entrada` | leads.editar |  | Um lead novo escreve (o primeiro "oi" do Instagram ou do link da bio). |  |
| GET | `/api/comercial/simulador/lead/:leadId` | leads.ver |  | A conversa de um lead como o lead a vê (mais o estado de cada mensagem, para a mesa). |  |
| POST | `/api/comercial/simulador/lead/:leadId/responder` | leads.editar |  | O lead "digita" no celular: texto livre, resposta de formulário ou toque em botão. |  |
| POST | `/api/comercial/simulador/mensagens/:id/novidade` | leads.editar |  | O M6 só sai com a novidade escrita (C08). |  |
| POST | `/api/comercial/simulador/mensagens/:id/vetar` | leads.editar |  | VETO de uma mensagem na janela de veto. |  |
| GET | `/api/comercial/simulador/mesa` | leads.ver |  | O celular da mesa (tela 09): decisões abertas e mensagens esperando o toque. |  |
| POST | `/api/comercial/simulador/mesa/responder` | leads.editar, aprovacoes.decidir |  | A mesa toca num botão de uma decisão: o mesmo caminho da tela 03, canal `simulado`. |  |
| GET | `/api/comercial/tarefas` | leads.ver |  |  | `comercial_tarefas` |
| POST | `/api/comercial/tarefas` | leads.editar, tarefas.editar |  |  | `comercial_tarefa_criar` |
| PATCH | `/api/comercial/tarefas/:id` | leads.editar, tarefas.editar |  |  |  |
| GET | `/api/comercial/torre` | leads.ver |  | Tela 12: a torre das automações (autonomia, última vez, acerto, premissa, vigia e custo do dia). | `comercial_torre` |
| POST | `/api/comercial/torre/vigia` | leads.editar |  | Roda o vigia agora (o mesmo que o relógio faz às 08:00): confere, grava os fatos e abre as exceções. |  |
| GET | `/api/comercial/vinculos-de-propostas` | leads.ver |  |  |  |
| POST | `/api/comercial/vinculos-de-propostas` | leads.editar | gente |  |  |
| POST | `/api/comercial/vinculos-de-propostas/lead` | leads.editar | gente |  |  |
| POST | `/api/comercial/webhooks/asaas` | pública | pub |  |  |
| POST | `/api/comercial/webhooks/zapsign` | pública | pub |  |  |
## `conectar`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/conectar/:plataforma/callback` | pública | pub |  |  |
## `config`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/config` | dashboard.ver |  |  |  |
| POST | `/api/config/password` | dashboard.ver |  |  |  |
## `content`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/content` | dashboard.ver |  |  |  |
| PATCH | `/api/content/:id` | tarefas.editar | sens |  |  |
| GET | `/api/content/stats` | dashboard.ver |  |  |  |
## `dashboard`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/dashboard/custo-ia` | dashboard.ver |  | O PAINEL DE CUSTO DE IA — por empresa, por agente e por dia (RF-B-03). `dashboard` já é prefixo de ESPINHA DO OS (`tenants/modulos.ts`), e é por isso que a rota | `dashboard_custo_ia` |
| GET | `/api/dashboard/summary` | dashboard.ver |  |  |  |
| GET | `/api/dashboard/tarefas` | dashboard.ver, tarefas.ver |  |  |  |
## `events`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/events/recent` | dashboard.ver |  |  |  |
| GET | `/api/events/summary` | dashboard.ver |  |  |  |
| POST | `/api/events/track` | pública | pub |  |  |
## `finance`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/finance/accounts` | financeiro.ver |  |  |  |
| POST | `/api/finance/accounts` | financeiro.editar |  |  |  |
| GET | `/api/finance/analise` | financeiro.ver |  |  | `financeiro_analise` |
| GET | `/api/finance/analise/acordos` | financeiro.ver |  |  |  |
| POST | `/api/finance/analise/acordos` | financeiro.editar |  |  |  |
| DELETE | `/api/finance/analise/acordos/:id` | financeiro.editar |  |  |  |
| PATCH | `/api/finance/analise/acordos/:id` | financeiro.editar |  |  |  |
| GET | `/api/finance/analise/acordos/:id/parcelas` | financeiro.ver |  |  |  |
| PUT | `/api/finance/analise/acordos/:id/parcelas` | financeiro.editar |  |  |  |
| POST | `/api/finance/analise/leitura` | financeiro.ver |  |  |  |
| GET | `/api/finance/analise/rotina` | financeiro.ver |  |  |  |
| POST | `/api/finance/bank/asaas/connect` | financeiro.conciliar |  |  |  |
| GET | `/api/finance/bank/connections` | financeiro.ver |  |  |  |
| POST | `/api/finance/bank/connections/:id/sync` | financeiro.conciliar |  |  |  |
| POST | `/api/finance/bank/pluggy/connect-token` | financeiro.conciliar |  |  |  |
| POST | `/api/finance/bank/pluggy/item` | financeiro.conciliar |  |  |  |
| GET | `/api/finance/cashflow` | financeiro.ver |  |  |  |
| GET | `/api/finance/categories` | financeiro.ver |  |  |  |
| POST | `/api/finance/categories` | financeiro.editar |  |  |  |
| GET | `/api/finance/chart-accounts` | financeiro.ver |  |  |  |
| POST | `/api/finance/chart-accounts` | financeiro.editar |  |  |  |
| PATCH | `/api/finance/chart-accounts/:id` | financeiro.editar |  |  |  |
| GET | `/api/finance/conciliacao` | financeiro.ver |  |  | `financeiro_conciliacao` |
| POST | `/api/finance/conciliacao/auto` | financeiro.conciliar |  |  | `financeiro_conciliar_auto` |
| POST | `/api/finance/conciliacao/match` | financeiro.conciliar |  |  | `financeiro_conciliar_match` |
| GET | `/api/finance/contracts` | financeiro.ver |  |  | `financeiro_contratos` |
| POST | `/api/finance/contracts` | financeiro.editar |  |  | `financeiro_contrato_criar` |
| POST | `/api/finance/contracts/:id/gerar` | financeiro.editar |  |  |  |
| GET | `/api/finance/departamentos` | financeiro.ver |  |  |  |
| POST | `/api/finance/departamentos` | financeiro.editar |  |  |  |
| GET | `/api/finance/dre` | financeiro.ver |  |  |  |
| GET | `/api/finance/exercicio/comercial/obrigacoes/:id` | sessão |  |  |  |
| POST | `/api/finance/exercicio/comercial/obrigacoes/:id/decisoes` | sessão |  |  |  |
| GET | `/api/finance/exercicio/comercial/obrigacoes/:id/pedidos/:requestId` | sessão |  |  |  |
| POST | `/api/finance/exercicio/contratos/gerar` | financeiro.ver, financeiro.editar |  |  |  |
| GET | `/api/finance/exercicio/contratos/pedidos/:requestId` | financeiro.ver, financeiro.editar |  |  |  |
| POST | `/api/finance/exercicio/contratos/previa` | financeiro.ver, financeiro.editar |  |  |  |
| GET | `/api/finance/exercicio/obrigacoes/:id` | financeiro.ver |  |  |  |
| POST | `/api/finance/exercicio/obrigacoes/:id/decisoes` | financeiro.ver, financeiro.editar |  |  |  |
| POST | `/api/finance/import/ofx` | financeiro.conciliar |  |  |  |
| GET | `/api/finance/kpis` | financeiro.ver |  |  |  |
| GET | `/api/finance/partners` | financeiro.ver |  |  | `financeiro_parceiros` |
| POST | `/api/finance/partners` | financeiro.editar |  |  |  |
| PATCH | `/api/finance/partners/:id` | financeiro.editar |  | Layout 26/10: renomear o cadastro (o nome que aparece no Financeiro e ao vincular o WhatsApp). |  |
| GET | `/api/finance/payables` | financeiro.ver |  |  |  |
| GET | `/api/finance/periodo` | financeiro.ver |  |  | `financeiro_periodo` |
| GET | `/api/finance/projetos` | financeiro.ver |  |  |  |
| POST | `/api/finance/projetos` | financeiro.editar |  |  |  |
| GET | `/api/finance/summary` | financeiro.ver |  |  |  |
| GET | `/api/finance/transactions` | financeiro.ver |  |  |  |
| POST | `/api/finance/transactions` | financeiro.editar |  |  | `financeiro_lancar` |
| DELETE | `/api/finance/transactions/:id` | financeiro.editar |  |  |  |
| PATCH | `/api/finance/transactions/:id` | financeiro.editar |  |  |  |
| POST | `/api/finance/transactions/:id/approve` | financeiro.editar |  |  |  |
## `frota`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| POST | `/api/frota/acessos/:id/revogar` | admin.usuarios |  |  |  |
| GET | `/api/frota/casas` | dashboard.ver |  |  | `frota_casas` |
| POST | `/api/frota/casas` | admin.usuarios |  |  |  |
| GET | `/api/frota/casas/:id` | dashboard.ver |  |  |  |
| PATCH | `/api/frota/casas/:id` | admin.usuarios |  |  |  |
| POST | `/api/frota/casas/:id/ordens` | admin.usuarios |  |  |  |
| POST | `/api/frota/casas/:id/token` | admin.usuarios |  |  |  |
| GET | `/api/frota/eventos` | dashboard.ver |  |  | `frota_eventos` |
| POST | `/api/frota/ordens/:id/cancelar` | admin.usuarios |  |  |  |
| GET | `/api/frota/politicas` | dashboard.ver |  |  |  |
| POST | `/api/frota/relator/relato` | pública | pub |  |  |
| POST | `/api/frota/relator/resultados` | pública | pub |  |  |
| GET | `/api/frota/resumo` | dashboard.ver |  |  | `frota_resumo` |
## `funnel`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/funnel/metrics` | dashboard.ver |  |  |  |
## `goals`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| POST | `/api/goals/config` | relatorios.gerar |  |  |  |
| GET | `/api/goals/month/:mes` | dashboard.ver |  |  |  |
| PUT | `/api/goals/month/:mes` | relatorios.gerar |  |  |  |
| GET | `/api/goals/panel` | dashboard.ver |  |  |  |
| POST | `/api/goals/week` | relatorios.gerar |  |  |  |
| POST | `/api/goals/week/:n/sync-meta` | relatorios.gerar |  |  |  |
| GET | `/api/goals/weeks` | dashboard.ver |  |  |  |
## `google`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/google/calendar` | dashboard.ver |  |  |  |
| POST | `/api/google/calendar/event` | agenda.editar |  |  |  |
| GET | `/api/google/calendar/periodo` | dashboard.ver |  | A agenda de um intervalo — o que a tela `/agenda` desenha. Separada de `GET /google/calendar` porque são perguntas diferentes: aquela responde "o que vem a segu | `agenda_periodo` |
| POST | `/api/google/calendar/reuniao` | agenda.editar |  | MARCAR REUNIÃO NO PADRÃO DA CASA — a rota que a tela `/agenda` usa. Repare no que ela NÃO aceita: título. Quem monta é o conector, com `montarTituloDeReuniao`,  | `agenda_marcar_reuniao` |
| GET | `/api/google/callback` | pública | pub | Para esquecer a sonda guardada assim que a autorização muda de estado. |  |
| GET | `/api/google/connect` | admin.usuarios |  |  |  |
| POST | `/api/google/disconnect` | admin.usuarios |  | DESCONECTAR — e, desde a fatia 5.4, isto REVOGA de verdade. Com o cofre lido na frente da coluna, apagar só a linha de `GoogleAccount` deixaria os tokens vivos  |  |
| POST | `/api/google/docs` | drive.editar |  |  |  |
| GET | `/api/google/docs/:id` | drive.ver |  |  |  |
| POST | `/api/google/docs/:id/append` | drive.editar |  |  |  |
| GET | `/api/google/drive` | drive.ver |  |  | `drive_listar` |
| GET | `/api/google/gmail` | gmail.ver |  |  | `gmail_listar` |
| GET | `/api/google/gmail/:id` | gmail.ver |  |  |  |
| POST | `/api/google/gmail/send` | gmail.responder |  |  | `gmail_enviar` |
| GET | `/api/google/status` | dashboard.ver |  |  | `google_status` |
## `health`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/health` | pública | pub |  |  |
## `integrations`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| POST | `/api/integrations/:chave/autorizacao` | admin.usuarios |  | AUTORIZAR. Devolve para onde mandar o navegador (OAuth) ou a instrução manual, quando o conector não tem fluxo automático. |  |
| DELETE | `/api/integrations/:chave/desligamento` | admin.usuarios |  | RELIGAR — capacidade `conector.religar`, R4 na régua. NENHUMA CREDENCIAL É TOCADA: religar apaga a linha do desligamento e o conector volta ao estado exato de a |  |
| POST | `/api/integrations/:chave/desligamento` | admin.usuarios |  | DESLIGAR um conector desta empresa — RF-G-06, capacidade `conector.desligar`. Rota SEPARADA do `PUT :key` de propósito. Aquele muda a CONFIGURAÇÃO da integração |  |
| POST | `/api/integrations/:chave/revogacao` | admin.usuarios |  | REVOGAR — QUEIMA a credencial desta empresa no cofre e apaga a conexão. NÃO É O DESLIGAMENTO, e as rotas existem separadas justamente para que ninguém confunda  |  |
| GET | `/api/integrations/:chave/saude` | dashboard.ver |  | SAÚDE, sob demanda — o "verificar agora" da tela. `dashboard.ver` e não `admin.usuarios`: sondar não muda nada e não devolve segredo nenhum; quem vê a tela prec |  |
| POST | `/api/integrations/:chave/sincronizacao` | admin.usuarios |  | SINCRONIZAR. Sai da casa, então passa pelo interruptor de conector antes. `admin.usuarios` NÃO É A ÚNICA EXIGÊNCIA: as permissões de quem pediu vão junto, e o s |  |
| PUT | `/api/integrations/:key` | admin.usuarios |  |  |  |
| DELETE | `/api/integrations/anthropic/chave` | admin.usuarios |  | Tira a chave do cofre desta empresa: volta a valer a variável de ambiente. |  |
| PUT | `/api/integrations/anthropic/chave` | admin.usuarios |  |  |  |
| GET | `/api/integrations/anthropic/estado` | dashboard.ver |  |  |  |
| POST | `/api/integrations/anthropic/testar` | admin.usuarios |  | UMA chamada mínima à Anthropic com a chave efetiva (cofre, senão variável). Sem gastar token. |  |
| GET | `/api/integrations/cartoes` | dashboard.ver |  | O CARTÃO ÚNICO de Conexões (rodada dos agentes, A6): o catálogo sondado, com quem usa cada conector e se há credencial no cofre (nunca o valor). `dashboard.ver` | `conexoes` |
| GET | `/api/integrations/catalog` | dashboard.ver |  | A tela de Conexões. `?sondar=0` devolve a lista sem sondar ninguém — ver `IntegrationsService.catalog`. |  |
| GET | `/api/integrations/catalogo-declarativo` | dashboard.ver |  |  |  |
| POST | `/api/integrations/clickup/sync` | tarefas.editar |  | Sincroniza as tarefas reais do ClickUp → módulo Tarefas. CONTINUA DE PÉ depois do contrato, e por dois motivos concretos: a permissão é outra (`tarefas.editar`, |  |
| GET | `/api/integrations/evolution/conexao` | dashboard.ver |  |  |  |
| PUT | `/api/integrations/evolution/credencial` | admin.usuarios |  |  |  |
| GET | `/api/integrations/evolution/estado` | dashboard.ver |  |  |  |
| POST | `/api/integrations/evolution/qr` | admin.usuarios |  |  |  |
| GET | `/api/integrations/evolution/segredo-do-webhook` | admin.usuarios |  | O segredo do webhook desta empresa, para colar na instância da Evolution. A casa vê o segredo do processo; as outras, o derivado delas. Sem cache, e a auditoria |  |
## `knowledge`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/knowledge` | obsidian.ver |  |  |  |
| GET | `/api/knowledge/:id` | obsidian.ver |  |  |  |
| GET | `/api/knowledge/colecao/aliases` | obsidian.ver |  |  |  |
| GET | `/api/knowledge/colecao/itens/:itemId` | obsidian.ver |  |  |  |
| GET | `/api/knowledge/colecao/movimentos/:requestId` | obsidian.ver |  |  |  |
| POST | `/api/knowledge/colecao/movimentos/:requestId/cancelamento/previa` | obsidian.ver, obsidian.editar |  |  |  |
| POST | `/api/knowledge/colecao/movimentos/:requestId/cancelar` | obsidian.ver, obsidian.editar |  |  |  |
| POST | `/api/knowledge/colecao/movimentos/:requestId/captura` | obsidian.ver, obsidian.editar |  |  |  |
| POST | `/api/knowledge/colecao/movimentos/:requestId/confirmar` | obsidian.ver, obsidian.editar |  |  |  |
| POST | `/api/knowledge/colecao/movimentos/intencoes` | obsidian.ver, obsidian.editar |  |  |  |
| POST | `/api/knowledge/colecao/movimentos/previa` | obsidian.ver, obsidian.editar |  |  |  |
| GET | `/api/knowledge/colecao/notas/:notaId/versoes/:versionId` | obsidian.ver |  |  |  |
| GET | `/api/knowledge/prontidao` | obsidian.ver |  |  |  |
| POST | `/api/knowledge/reindex` | obsidian.editar |  |  |  |
| GET | `/api/knowledge/search` | obsidian.ver |  |  | `conhecimento_buscar` |
## `leads`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/leads` | leads.ver |  |  |  |
| GET | `/api/leads/:id` | leads.ver |  |  |  |
| PATCH | `/api/leads/:id` | leads.editar | sens |  |  |
| POST | `/api/leads/:id/aceite` | leads.editar, tarefas.ver |  |  |  |
| PUT | `/api/leads/:id/dono` | leads.editar |  | Troca de dono: sem aprovação, com motivo opcional, evento e auditoria (ver `LeadsService.trocarDono`). |  |
| GET | `/api/leads/:id/exercicio` | leads.ver |  |  |  |
| POST | `/api/leads/:id/exercicio/aceites` | leads.editar, tarefas.ver |  |  |  |
| POST | `/api/leads/:id/exercicio/acompanhamento` | leads.editar |  |  |  |
| POST | `/api/leads/:id/exercicio/entrega` | leads.editar, tarefas.ver, tarefas.editar |  |  |  |
| GET | `/api/leads/:id/exercicio/ponte` | sessão |  |  |  |
| GET | `/api/leads/:id/exercicio/ponte/catalogos` | sessão |  |  |  |
| GET | `/api/leads/:id/exercicio/ponte/pedidos/:requestId` | sessão |  |  |  |
| POST | `/api/leads/:id/exercicio/projeto` | sessão |  |  |  |
| POST | `/api/leads/:id/exercicio/projetos/:projectId/obrigacao` | sessão |  |  |  |
| POST | `/api/leads/:id/exercicio/propostas` | leads.editar |  |  |  |
| GET | `/api/leads/:id/proposta` | leads.ver |  | Proposta e aceite comercial (ROOT-49, C-03). Ler o estado pede `leads.ver`; ler as condições do card e registrar proposta ou decisão pedem também `tarefas.ver`  |  |
| POST | `/api/leads/:id/proposta` | leads.editar, tarefas.ver |  |  |  |
| GET | `/api/leads/:id/proposta/condicoes` | leads.ver, tarefas.ver |  |  |  |
| POST | `/api/leads/entrada` | leads.editar |  | Entrada idempotente de lead (ROOT-48). Declarada ANTES de `:id` e fora do `SensitiveWrite`: não toca etapa nem próxima ação. Origem da Pauta soma `pauta.ver` e  | `comercial_lead_entrada` |
| POST | `/api/leads/exercicio/entrada` | leads.editar |  |  |  |
| GET | `/api/leads/exercicio/entregas/:taskId` | leads.ver, tarefas.ver |  |  |  |
## `linha-do-tempo`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/linha-do-tempo` | auditoria.ver |  |  | `linha_do_tempo` |
## `mapa-publico`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/mapa-publico` | pública | pub | O mapa da vitrine. NÃO RECEBE PARÂMETRO NENHUM, e isso é a metade da defesa: a empresa sai de uma constante do código (ver `slugDaVitrine`). Um `:slug` aqui tra |  |
## `marketing`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/marketing/estudio/apify/uso` | pauta.ver |  |  |  |
| POST | `/api/marketing/estudio/comunidade/importar` | pauta.editar |  |  |  |
| POST | `/api/marketing/estudio/fontes/detectar` | pauta.editar |  |  |  |
| GET | `/api/marketing/estudio/fontes/pesos` | pauta.ver |  |  |  |
| GET | `/api/marketing/estudio/formatos` | pauta.ver |  |  |  |
| PUT | `/api/marketing/estudio/formatos/:formato` | pauta.editar |  |  |  |
| POST | `/api/marketing/estudio/formatos/:formato/extrair` | pauta.editar |  |  |  |
| POST | `/api/marketing/estudio/formatos/:formato/referencias` | pauta.editar |  |  |  |
| DELETE | `/api/marketing/estudio/formatos/:formato/referencias/:ref` | pauta.editar |  |  |  |
| GET | `/api/marketing/estudio/memoria` | pauta.ver |  |  |  |
| POST | `/api/marketing/estudio/memoria/captura` | pauta.editar |  |  |  |
| POST | `/api/marketing/estudio/memoria/drive/sincronizar` | pauta.editar |  |  |  |
| GET | `/api/marketing/estudio/memoria/grafo` | pauta.ver |  |  |  |
| POST | `/api/marketing/estudio/memoria/notas` | pauta.editar |  |  |  |
| DELETE | `/api/marketing/estudio/memoria/notas/:id` | pauta.editar |  |  |  |
| GET | `/api/marketing/estudio/memoria/notas/:id` | pauta.ver |  |  |  |
| PUT | `/api/marketing/estudio/memoria/notas/:id` | pauta.editar |  |  |  |
| POST | `/api/marketing/estudio/memoria/notas/:id/destino` | pauta.editar |  |  |  |
| POST | `/api/marketing/estudio/memoria/notas/:id/tentar` | pauta.editar |  |  |  |
| POST | `/api/marketing/estudio/posts/:id/gerar` | pauta.editar |  |  |  |
| GET | `/api/marketing/estudio/triagem` | pauta.ver |  |  |  |
| POST | `/api/marketing/estudio/triagem/:id/decisao` | pauta.editar |  |  |  |
| POST | `/api/marketing/estudio/triagem/:id/desfazer` | pauta.editar |  |  |  |
| GET | `/api/marketing/estudio/triagem/base` | pauta.ver |  |  |  |
| POST | `/api/marketing/estudio/triagem/montar` | pauta.editar |  |  |  |
| GET | `/api/marketing/maquina` | pauta.ver |  |  |  |
| PUT | `/api/marketing/maquina/cadencia` | pauta.editar |  |  |  |
| POST | `/api/marketing/maquina/ordem` | pauta.editar |  |  |  |
| POST | `/api/marketing/maquina/posts` | pauta.editar |  |  |  |
| PUT | `/api/marketing/maquina/posts/:id` | pauta.editar |  |  |  |
| POST | `/api/marketing/maquina/posts/:id/comentarios` | pauta.editar |  |  |  |
| PATCH | `/api/marketing/maquina/posts/:id/data` | pauta.editar |  |  |  |
| PATCH | `/api/marketing/maquina/posts/:id/etapa` | pauta.editar |  |  |  |
| PUT | `/api/marketing/maquina/posts/:id/metricas` | pauta.editar |  |  |  |
| GET | `/api/marketing/preparacao` | pauta.ver |  |  |  |
| POST | `/api/marketing/preparacao` | pauta.editar, pauta.publicar, tarefas.ver, tarefas.editar |  |  |  |
| GET | `/api/marketing/preparacao/:id` | pauta.ver |  |  |  |
| GET | `/api/marketing/preparacao/configuracao` | bio.editar, admin.usuarios |  |  |  |
| POST | `/api/marketing/preparacao/contas` | bio.editar, admin.usuarios |  |  |  |
| PUT | `/api/marketing/preparacao/contas/:id/disponibilidade` | bio.editar, admin.usuarios |  |  |  |
| GET | `/api/marketing/preparacao/contas/escopo` | bio.editar, admin.usuarios |  |  |  |
| GET | `/api/marketing/preparacao/contas/pedidos/:requestId` | bio.editar, admin.usuarios |  |  |  |
| GET | `/api/marketing/preparacao/escopo` | pauta.ver, tarefas.ver |  |  |  |
| GET | `/api/marketing/preparacao/pedidos/:requestId` | pauta.ver, tarefas.ver |  |  |  |
## `memoria`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/memoria` | obsidian.ver |  |  | `memoria_listar` |
| POST | `/api/memoria` | obsidian.editar |  |  | `memoria_criar` |
| GET | `/api/memoria/:id` | obsidian.ver |  |  |  |
| PATCH | `/api/memoria/:id` | obsidian.editar |  |  |  |
| POST | `/api/memoria/:id/arquivar` | obsidian.editar |  |  |  |
| POST | `/api/memoria/:id/restaurar` | obsidian.editar |  |  |  |
| POST | `/api/memoria/:id/tarefas` | obsidian.ver, tarefas.editar |  |  |  |
| GET | `/api/memoria/:id/tarefas/pedidos/:requestId` | obsidian.ver, tarefas.ver |  |  |  |
| GET | `/api/memoria/:id/versoes` | obsidian.ver |  | O HISTÓRICO DE VERSÕES — o que RF-M-01 chama de "contexto versionado". |  |
| GET | `/api/memoria/buscar` | obsidian.ver |  | Busca TEXTUAL pela tela. Sem vetor de propósito: quem tem a chave do fornecedor de embedding é o conector, e esta rota não vai atrás dele. A busca semântica sob | `memoria_buscar` |
| GET | `/api/memoria/integridade` | auditoria.ver |  | A INTEGRIDADE DA MEMÓRIA — versão por versão, contra o RASTRO. É o argumento do ADR-011 virando código. O ADR recusou o desenho alternativo ("documento com hist |  |
| POST | `/api/memoria/promover` | obsidian.editar |  | RF-M-06: a resposta vira nota permanente com um gesto. |  |
## `meta`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/meta/callback` | pública | pub | Para esquecer a sonda guardada assim que a autorização muda de estado. |  |
| GET | `/api/meta/connect` | admin.usuarios |  |  |  |
| POST | `/api/meta/disconnect` | admin.usuarios |  | DESCONECTAR — e, desde a fatia 5.4, isto REVOGA de verdade: os tokens guardados no cofre são queimados junto com a linha. Ver `MetaService.disconnect`. |  |
| GET | `/api/meta/instagram/media` | instagram.ver |  |  |  |
| GET | `/api/meta/instagram/overview` | instagram.ver |  |  |  |
| GET | `/api/meta/status` | dashboard.ver |  |  |  |
## `midia-publica`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/midia-publica/:token` | pública | arquivo pub |  |  |
## `organograma`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/organograma` | dashboard.ver |  |  | `organograma` |
| PUT | `/api/organograma/dono/:slug` | dashboard.ver |  |  |  |
| GET | `/api/organograma/equipe` | dashboard.ver |  |  | `equipe` |
| PUT | `/api/organograma/pessoas/:id/whatsapp` | dashboard.ver |  |  |  |
## `pauta`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/pauta/agenda` | pauta.ver |  |  | `pauta_agenda` |
| GET | `/api/pauta/agenda/grade` | pauta.ver, obsidian.ver |  |  |  |
| PUT | `/api/pauta/agenda/grade` | pauta.editar, obsidian.ver |  |  |  |
| GET | `/api/pauta/automacao/:qual` | pauta.ver, obsidian.ver |  |  |  |
| PUT | `/api/pauta/automacao/:qual` | pauta.publicar, obsidian.ver |  | D-MD1: liga ou desliga a publicação ou a DM automática da empresa (a nota da memória), com motivo. |  |
| GET | `/api/pauta/canais` | pauta.ver |  |  |  |
| GET | `/api/pauta/capturas` | pauta.ver |  |  | `pauta_capturas` |
| POST | `/api/pauta/capturas` | pauta.editar |  |  | `pauta_captura_criar` |
| DELETE | `/api/pauta/capturas/:id` | pauta.editar |  |  |  |
| POST | `/api/pauta/capturas/:id/imagem` | pauta.editar | upload |  |  |
| POST | `/api/pauta/capturas/:id/processar` | pauta.editar |  |  |  |
| GET | `/api/pauta/comentarios` | pauta.ver |  |  |  |
| POST | `/api/pauta/comentarios/:id/respondido` | pauta.publicar |  |  |  |
| GET | `/api/pauta/concorrentes` | pauta.ver |  |  |  |
| GET | `/api/pauta/concorrentes/:id` | pauta.ver |  |  |  |
| POST | `/api/pauta/concorrentes/:id/dossie` | pauta.editar, automacoes.executar |  |  |  |
| POST | `/api/pauta/dm/regras/:itemId/pausar` | pauta.editar |  |  |  |
| POST | `/api/pauta/editorial/decisoes` | pauta.ver, tarefas.ver, pauta.editar, tarefas.editar |  |  |  |
| POST | `/api/pauta/editorial/decisoes/:decisionId/revogar` | pauta.ver, tarefas.ver, pauta.editar, tarefas.editar |  |  |  |
| POST | `/api/pauta/editorial/materiais` | pauta.ver, tarefas.ver, pauta.editar, tarefas.editar |  |  |  |
| POST | `/api/pauta/editorial/materiais/:materialId/versoes` | pauta.ver, tarefas.ver, pauta.editar, tarefas.editar |  |  |  |
| POST | `/api/pauta/editorial/producoes` | pauta.ver, tarefas.ver, pauta.editar, tarefas.editar |  |  |  |
| GET | `/api/pauta/editorial/tarefas/:taskId` | pauta.ver, tarefas.ver |  |  |  |
| GET | `/api/pauta/editorial/versoes/:versionId/producao` | pauta.ver, tarefas.ver, pauta.editar, tarefas.editar |  |  |  |
| GET | `/api/pauta/episodios` | pauta.ver |  |  | `pauta_episodios` |
| POST | `/api/pauta/episodios` | pauta.editar |  |  | `pauta_episodio_criar` |
| GET | `/api/pauta/episodios/:id` | pauta.ver |  |  |  |
| PATCH | `/api/pauta/episodios/:id` | pauta.editar |  |  |  |
| POST | `/api/pauta/episodios/:id/agenda/distribuir` | pauta.editar |  |  |  |
| PUT | `/api/pauta/episodios/:id/dm/:itemId` | pauta.editar |  |  |  |
| POST | `/api/pauta/episodios/:id/dm/preparar` | pauta.editar |  |  |  |
| GET | `/api/pauta/episodios/:id/encadeamento` | pauta.ver |  |  |  |
| POST | `/api/pauta/episodios/:id/midia` | pauta.editar |  |  |  |
| GET | `/api/pauta/episodios/:id/newsletter` | pauta.ver |  |  |  |
| GET | `/api/pauta/episodios/:id/newsletter.html` | pauta.ver |  |  |  |
| GET | `/api/pauta/episodios/:id/newsletter.md` | pauta.ver |  |  |  |
| POST | `/api/pauta/episodios/:id/newsletter/gerar` | pauta.editar, automacoes.executar |  |  |  |
| PUT | `/api/pauta/episodios/:id/newsletter/video` | pauta.editar |  |  |  |
| POST | `/api/pauta/episodios/:id/pacote/gerar` | pauta.editar, automacoes.executar |  |  |  |
| PUT | `/api/pauta/episodios/:id/pacote/horario` | pauta.editar |  |  |  |
| PUT | `/api/pauta/episodios/:id/pacote/thumb` | pauta.editar |  |  |  |
| PUT | `/api/pauta/episodios/:id/pacote/titulo` | pauta.editar |  |  |  |
| POST | `/api/pauta/episodios/:id/pagina-de-links` | pauta.editar |  |  |  |
| POST | `/api/pauta/episodios/:id/pagina-de-links/publicar` | pauta.publicar, bio.editar |  |  |  |
| PUT | `/api/pauta/episodios/:id/palavra-de-corte` | pauta.editar |  |  |  |
| GET | `/api/pauta/episodios/:id/roteiro` | pauta.ver |  |  |  |
| PUT | `/api/pauta/episodios/:id/roteiro` | pauta.editar |  |  |  |
| GET | `/api/pauta/episodios/:id/roteiro.md` | pauta.ver |  |  |  |
| POST | `/api/pauta/episodios/:id/roteiro/gerar` | pauta.editar, automacoes.executar |  |  |  |
| GET | `/api/pauta/episodios/:id/semana` | pauta.ver |  |  |  |
| GET | `/api/pauta/episodios/:id/semana/aprovacao` | pauta.ver |  |  |  |
| POST | `/api/pauta/episodios/:id/semana/gerar` | pauta.editar, automacoes.executar |  |  |  |
| POST | `/api/pauta/episodios/:id/semana/preparar-aprovacao` | pauta.publicar |  |  |  |
| POST | `/api/pauta/episodios/:id/status` | pauta.editar |  |  |  |
| GET | `/api/pauta/episodios/:id/thumbs` | pauta.ver |  |  |  |
| POST | `/api/pauta/episodios/:id/thumbs/:n` | pauta.editar | upload |  |  |
| GET | `/api/pauta/episodios/:id/thumbs/:n/imagem` | pauta.ver |  |  |  |
| POST | `/api/pauta/episodios/:id/transcricao` | pauta.editar |  |  |  |
| GET | `/api/pauta/episodios/:id/youtube` | pauta.ver |  |  |  |
| PUT | `/api/pauta/episodios/:id/youtube/arquivo` | pauta.editar |  |  |  |
| POST | `/api/pauta/episodios/:id/youtube/concluido` | pauta.enviar_ao_youtube |  |  |  |
| POST | `/api/pauta/episodios/:id/youtube/sessao` | pauta.enviar_ao_youtube |  |  |  |
| POST | `/api/pauta/episodios/:id/youtube/sessao/token` | pauta.enviar_ao_youtube |  |  |  |
| GET | `/api/pauta/episodios/pendentes-midia` | pauta.editar |  |  |  |
| GET | `/api/pauta/espelho` | pauta.ver |  |  |  |
| PUT | `/api/pauta/espelho` | pauta.editar |  |  |  |
| POST | `/api/pauta/espelho/sincronizar` | pauta.editar |  |  |  |
| GET | `/api/pauta/estrategia/:mes` | pauta.ver, obsidian.ver |  |  |  |
| PUT | `/api/pauta/estrategia/:mes` | pauta.editar, obsidian.ver |  |  |  |
| POST | `/api/pauta/estrategia/:mes/gerar` | pauta.editar, automacoes.executar |  |  |  |
| POST | `/api/pauta/feeds/coletar` | pauta.editar, automacoes.executar |  |  |  |
| GET | `/api/pauta/fontes` | pauta.ver |  |  |  |
| POST | `/api/pauta/fontes` | pauta.editar |  |  |  |
| DELETE | `/api/pauta/fontes/:id` | pauta.editar |  |  |  |
| PATCH | `/api/pauta/fontes/:id` | pauta.editar |  |  |  |
| POST | `/api/pauta/fontes/:id/coletar` | pauta.editar, automacoes.executar |  |  |  |
| GET | `/api/pauta/ideias` | pauta.ver |  |  | `pauta_ideias` |
| POST | `/api/pauta/ideias` | pauta.editar |  |  | `pauta_ideia_criar` |
| PUT | `/api/pauta/ideias/:id` | pauta.editar |  |  |  |
| PATCH | `/api/pauta/ideias/:id/status` | pauta.editar |  |  |  |
| POST | `/api/pauta/ideias/propor` | pauta.editar, automacoes.executar |  |  |  |
| POST | `/api/pauta/instagram/conectar` | pauta.publicar, bio.editar |  |  |  |
| GET | `/api/pauta/instagram/conexao` | pauta.ver |  |  |  |
| POST | `/api/pauta/lotes/:id/cancelar` | pauta.publicar |  |  |  |
| GET | `/api/pauta/lotes/:id/conteudo` | aprovacoes.decidir |  |  |  |
| GET | `/api/pauta/marca` | pauta.ver, obsidian.ver |  |  | `pauta_marca` |
| PUT | `/api/pauta/marca` | pauta.editar, obsidian.ver |  |  | `pauta_marca_editar` |
| GET | `/api/pauta/marca/brandbook` | pauta.ver |  |  |  |
| POST | `/api/pauta/marca/brandbook/ativar` | pauta.editar, obsidian.ver |  |  |  |
| POST | `/api/pauta/marca/brandbook/coletar-site` | pauta.editar |  |  |  |
| POST | `/api/pauta/marca/brandbook/desativar` | pauta.editar, obsidian.ver |  |  |  |
| POST | `/api/pauta/marca/brandbook/previa` | pauta.editar, obsidian.ver |  |  |  |
| PUT | `/api/pauta/marca/brandbook/rascunho` | pauta.editar, obsidian.ver |  |  |  |
| GET | `/api/pauta/marca/brandbook/referencia-root` | pauta.ver |  |  |  |
| PUT | `/api/pauta/marca/pilares` | pauta.editar, obsidian.ver |  |  |  |
| GET | `/api/pauta/marca/projecao/:destino` | pauta.ver, obsidian.ver |  |  |  |
| POST | `/api/pauta/marca/projecao/:destino` | pauta.editar, obsidian.ver |  |  |  |
| PATCH | `/api/pauta/pecas/:id` | pauta.editar |  |  |  |
| PUT | `/api/pauta/pecas/:id/agenda` | pauta.editar |  |  |  |
| GET | `/api/pauta/pecas/:id/carrossel` | pauta.ver |  |  |  |
| GET | `/api/pauta/pecas/:id/imagens/:n` | pauta.ver |  |  |  |
| POST | `/api/pauta/pecas/:id/imagens/:n` | pauta.editar |  |  |  |
| POST | `/api/pauta/pecas/:id/midia-publica` | pauta.publicar |  |  |  |
| POST | `/api/pauta/pecas/:id/postada` | pauta.publicar |  |  |  |
| GET | `/api/pauta/pecas/:id/publicacao` | pauta.ver |  |  |  |
| POST | `/api/pauta/pecas/:id/publicacao/manual` | pauta.publicar |  |  |  |
| POST | `/api/pauta/pecas/:id/publicar` | pauta.publicar, whatsapp.enviar | sens | Publicar é escrita sensível: sai do sistema e chega em gente. O ApprovalGuard exige um x-approval-token confirmado, casado com {status:'publicada'} nesta peça — |  |
| POST | `/api/pauta/pecas/:id/publicar-instagram` | pauta.publicar |  |  |  |
| PUT | `/api/pauta/pecas/:id/semana` | pauta.editar |  |  |  |
| PUT | `/api/pauta/pecas/:id/video` | pauta.editar |  |  |  |
| GET | `/api/pauta/pecas/:id/video/arquivo` | pauta.ver | arquivo |  |  |
| POST | `/api/pauta/pecas/:id/video/arquivo` | pauta.editar |  | MD4: o mp4 do corte, cru no corpo (`Content-Type: video/mp4`), com `Content-Length` e o sha256 no cabeçalho. Nenhum parser do Nest lê `video/mp4` e esta rota nã |  |
| GET | `/api/pauta/performance/:mes` | pauta.ver |  |  |  |
| POST | `/api/pauta/performance/:mes/coletar` | pauta.editar, automacoes.executar |  |  |  |
| GET | `/api/pauta/referencias` | pauta.ver |  |  |  |
| POST | `/api/pauta/referencias` | pauta.editar |  |  |  |
| DELETE | `/api/pauta/referencias/:id` | pauta.editar |  |  |  |
| GET | `/api/pauta/referencias/:id` | pauta.ver |  |  |  |
| PATCH | `/api/pauta/referencias/:id` | pauta.editar |  |  |  |
| POST | `/api/pauta/referencias/reindexar` | pauta.editar |  |  |  |
| GET | `/api/pauta/relatorio/:mes` | pauta.ver, obsidian.ver |  |  |  |
| PUT | `/api/pauta/relatorio/:mes` | pauta.editar, obsidian.ver |  |  |  |
| POST | `/api/pauta/relatorio/:mes/gerar` | pauta.editar, automacoes.executar |  |  |  |
| GET | `/api/pauta/rodadas` | pauta.ver |  |  | `pauta_rodadas` |
| POST | `/api/pauta/rodadas` | pauta.editar, automacoes.executar |  |  |  |
| DELETE | `/api/pauta/rodadas/:id` | pauta.editar |  |  |  |
| GET | `/api/pauta/rodadas/:id` | pauta.ver |  |  |  |
| PUT | `/api/pauta/rodadas/:id/curadoria` | pauta.editar |  |  |  |
| POST | `/api/pauta/rodadas/:id/curadoria/confirmar` | pauta.editar |  |  |  |
| POST | `/api/pauta/rodadas/:id/derivar` | pauta.editar, automacoes.executar |  |  |  |
| POST | `/api/pauta/rodadas/curadoria` | pauta.editar, automacoes.executar |  |  | `pauta_curadoria_iniciar` |
| GET | `/api/pauta/rotinas` | pauta.ver |  |  |  |
| POST | `/api/pauta/rotinas` | pauta.editar |  |  |  |
| DELETE | `/api/pauta/rotinas/:id` | pauta.editar |  |  |  |
| PATCH | `/api/pauta/rotinas/:id` | pauta.editar |  |  |  |
| POST | `/api/pauta/rotinas/:id/rodar` | pauta.editar, automacoes.executar |  |  |  |
| GET | `/api/pauta/voz` | pauta.ver, obsidian.ver |  |  | `pauta_voz` |
| PUT | `/api/pauta/voz` | pauta.editar, obsidian.ver |  |  |  |
| POST | `/api/pauta/voz/aprender` | pauta.editar, automacoes.executar |  |  |  |
| PUT | `/api/pauta/voz/chave` | pauta.editar, obsidian.ver |  |  |  |
| POST | `/api/pauta/youtube/conectar` | pauta.publicar |  | Conectar o canal: a página de consentimento do Google pelo contrato de conector (a mesma de /conexoes). Pede `pauta.publicar`, e não o `admin.usuarios` de /cone |  |
| GET | `/api/pauta/youtube/pendentes` | pauta.ver |  | O que o vigia do Mac envia sozinho: item de envio ativo e vídeo ainda não conferido. |  |
## `pendencias`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/pendencias` | dashboard.ver |  |  | `pendencias` |
| POST | `/api/pendencias/:id/descartar` | dashboard.ver |  |  |  |
| POST | `/api/pendencias/:id/responder` | dashboard.ver |  |  |  |
## `perfil`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/perfil` | dashboard.ver |  |  |  |
| GET | `/api/perfil/:id` | dashboard.ver |  |  |  |
| PUT | `/api/perfil/:id` | dashboard.ver |  |  |  |
| DELETE | `/api/perfil/:id/foto` | dashboard.ver |  |  |  |
| GET | `/api/perfil/:id/foto` | dashboard.ver | arquivo | A foto em uso, com o tipo CONFERIDO, `nosniff`, `inline` e CSP fechada. Só da empresa do token. |  |
| POST | `/api/perfil/:id/foto` | dashboard.ver | upload |  |  |
| GET | `/api/perfil/pessoas` | dashboard.ver |  | As pessoas com a rota da foto e o aniversário (dia e mês): o avatar do responsável em qualquer tela. | `pessoas` |
## `policy`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/policy/regua` | mcp.ver |  | Tudo o que a tela mostra: níveis, sinais, catálogo e sobrescritas. | `politica_regua` |
| POST | `/api/policy/simular` | mcp.ver |  | A ação hipotética. Responde; não faz. | `politica_simular` |
## `publico`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| POST | `/api/publico/lead` | pública | pub |  |  |
## `reports`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/reports/daily` | relatorios.ver |  |  |  |
| POST | `/api/reports/daily/generate` | relatorios.gerar |  |  |  |
| GET | `/api/reports/daily/latest` | relatorios.ver |  |  |  |
| GET | `/api/reports/tarefas` | relatorios.ver, tarefas.ver |  |  |  |
## `roles`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/roles` | admin.usuarios |  |  |  |
## `rotinas`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/rotinas` | automacoes.ver |  | O estado do AGENDADOR vai junto com a lista, e não é enfeite: sem ele a tela não tem como distinguir "nenhuma rotina disparou porque não era hora" de "nada disp | `rotinas` |
| POST | `/api/rotinas` | automacoes.executar |  | Cria rotina sem linha de origem (MC5) — a coleta de quinta, por exemplo. A permissão é a mesma que já edita rotina: criar é agir, não ler. |  |
| PATCH | `/api/rotinas/:id` | automacoes.executar |  | Muda estado, interruptor ou linha de base — um campo por vez, de propósito: são três decisões diferentes, e um PATCH que aceitasse os três juntos deixaria o RAS |  |
| GET | `/api/rotinas/:id/execucoes` | automacoes.ver |  |  |  |
| POST | `/api/rotinas/:id/rodar` | automacoes.executar |  |  |  |
## `sala`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/sala/:token` | pública | pub | O estado da sala: estágio, plano de ação, proposta, aceite, começo. Só lê (B-11). |  |
| POST | `/api/sala/:token/aceite/contrato` | pública | pub | Tela 08, passo 3: o contrato para assinar (lane D). |  |
| POST | `/api/sala/:token/aceite/dados` | pública | pub | Tela 08, passo 1: os dados do contratante. |  |
| POST | `/api/sala/:token/aceite/pagamento` | pública | pub | Tela 08, passo 2: aceitar a oferta e escolher a forma (a cobrança é da lane D). |  |
| POST | `/api/sala/:token/agenda` | pública | pub | A escolha de horário entre os oferecidos (tela 01/02). |  |
| POST | `/api/sala/:token/area/leitura` | pública | pub | A área do cliente (leva A, 30/10/2026): o cliente abriu um item publicado. Grava a leitura daquela versão (idempotente) e devolve o estado: o selo "novo" some,  |  |
| POST | `/api/sala/:token/arquivo` | pública | upload pub | O arquivo opcional (tela 02: "deixe pronto um relatório de fechamento"). |  |
| POST | `/api/sala/:token/form` | pública | pub | O formulário de qualificação (tela 01). |  |
| POST | `/api/sala/:token/kickoff/horario` | pública | pub | O começo: o horário do kickoff. |  |
| POST | `/api/sala/:token/proposta/ajuste` | pública | pub | "Pedir ajuste": grava o fato; a decisão na fila é aberta pela espinha. |  |
| POST | `/api/sala/:token/proposta/duvida` | pública | pub | "Tirar uma dúvida": grava o fato; a resposta é do assistente da proposta (lane E). |  |
| POST | `/api/sala/:token/proposta/leitura` | pública | pub | I4: uma batida de leitura (seção, segundos visíveis desde a última, versão). Só grava. |  |
| POST | `/api/sala/:token/proposta/lida` | pública | pub | Leitura rastreada por bloco (tela 07): o termômetro do follow-up. |  |
| POST | `/api/sala/:token/proposta/reacao` | pública | pub | I4: "faz sentido", "tenho uma dúvida" ou "anotar uma ideia" numa seção da proposta. Só grava. |  |
| GET | `/api/sala/:token/proposta/reacoes` | pública | pub | I4: as reações do próprio cliente na versão vigente (as anotações enviadas e o contador). Só lê. |  |
| POST | `/api/sala/:token/visita` | pública | pub | A visita de gente (B-11): a página chama uma vez ao abrir; conta o acesso e o fato do dia. |  |
## `sessions`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/sessions` | mcp.ver |  |  |  |
| GET | `/api/sessions/:id` | mcp.ver |  |  |  |
## `tasks`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/tasks` | tarefas.ver |  |  |  |
| PATCH | `/api/tasks/:id` | tarefas.editar | sens |  |  |
## `tenants`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/tenants/modulos` | pública | pub |  |  |
| POST | `/api/tenants/onboarding/cadastro` | pública | pub | Criar a conta. Sem token, sem convite, sem ninguém da ROOT no caminho. NÃO DEVOLVE O IDENTIFICADOR DA EMPRESA nem o dela no banco. Quem se cadastrou não precisa |  |
| POST | `/api/tenants/onboarding/carga/fechar` | obsidian.ver, obsidian.editar |  | Fecha a carga: o OS lê de volta o que entendeu, citando cada nota. É a PRIMEIRA RESPOSTA do produto, e ela não tem como sair sem fonte — `retrato.ts` explica po |  |
| POST | `/api/tenants/onboarding/carga/resposta` | obsidian.ver, obsidian.editar |  |  |  |
| GET | `/api/tenants/onboarding/carga/temas/:tema` | obsidian.ver |  | A resposta de um tema. É o passo do procedimento que estrutura. `obsidian.editar` é a permissão da MEMÓRIA (a mesma de `POST /api/memoria`), e é a certa: o que  |  |
| GET | `/api/tenants/onboarding/estado` | dashboard.ver |  | Onde a entrada está. Derivado do banco a cada chamada — ver `passos.ts`. `dashboard.ver` porque é leitura de estado do próprio painel: quem entrou precisa ver o |  |
| GET | `/api/tenants/onboarding/link/:token` | pública | pub |  |  |
| POST | `/api/tenants/onboarding/link/:token/concluir` | pública | pub |  |  |
| POST | `/api/tenants/onboarding/link/:token/itens/:temaId/audio` | pública | upload pub |  |  |
| POST | `/api/tenants/onboarding/link/:token/itens/:temaId/confirmar` | pública | pub |  |  |
| POST | `/api/tenants/onboarding/link/:token/itens/:temaId/corrigir` | pública | pub |  |  |
| POST | `/api/tenants/onboarding/link/:token/itens/:temaId/responder` | pública | pub |  |  |
| GET | `/api/tenants/onboarding/link/:token/retrato` | pública | pub |  |  |
| POST | `/api/tenants/onboarding/primeira-pergunta` | mcp.executar, admin.usuarios |  | A primeira pergunta livre, pelo laço de verdade. A permissão é a MESMA que `POST /api/agents/:slug/executar` exige (`mcp.executar` + `admin.usuarios`): esta rot |  |
| GET | `/api/tenants/onboarding/roteiro` | dashboard.ver |  | O roteiro do carregador, para a tela poder mostrar o caminho inteiro. Vem do PROCEDIMENTO do agente (`agents/roster/`), não de uma lista no front: é o mesmo rot |  |
| GET | `/api/tenants/onboarding/trilhos` | tarefas.ver |  | `?cardId=` devolve só o trilho pendurado naquele cartão da esteira. | `onboarding_trilhos` |
| POST | `/api/tenants/onboarding/trilhos` | tarefas.editar |  |  |  |
| GET | `/api/tenants/onboarding/trilhos/:id` | tarefas.ver |  |  |  |
| PATCH | `/api/tenants/onboarding/trilhos/:id` | tarefas.editar |  |  |  |
| POST | `/api/tenants/onboarding/trilhos/:id/ata` | tarefas.editar |  | A ata como texto colado ou link. PDF e arquivo vão por `ata/arquivo`. |  |
| POST | `/api/tenants/onboarding/trilhos/:id/ata/arquivo` | tarefas.editar | upload | A ata como arquivo: `.txt`/`.md` (lido como texto) ou `.pdf` (o modelo lê). |  |
| POST | `/api/tenants/onboarding/trilhos/:id/avancar` | tarefas.editar |  |  |  |
| POST | `/api/tenants/onboarding/trilhos/:id/boas-vindas` | tarefas.ver |  |  |  |
| POST | `/api/tenants/onboarding/trilhos/:id/convites` | tarefas.editar |  |  |  |
| POST | `/api/tenants/onboarding/trilhos/:id/convites/:conviteId/enviado` | tarefas.editar |  |  |  |
| GET | `/api/tenants/onboarding/trilhos/:id/convites/:conviteId/mensagens` | tarefas.ver |  |  |  |
| POST | `/api/tenants/onboarding/trilhos/:id/convites/:conviteId/revogar` | tarefas.editar |  |  |  |
| POST | `/api/tenants/onboarding/trilhos/:id/dossie` | tarefas.editar |  |  |  |
| POST | `/api/tenants/onboarding/trilhos/:id/empresa` | tarefas.editar, admin.usuarios |  |  |  |
| POST | `/api/tenants/onboarding/trilhos/:id/encerrar` | tarefas.editar |  |  |  |
| GET | `/api/tenants/onboarding/trilhos/:id/folha` | tarefas.ver |  |  |  |
| PUT | `/api/tenants/onboarding/trilhos/:id/itens/:temaId` | tarefas.editar |  |  |  |
| POST | `/api/tenants/onboarding/trilhos/:id/itens/:temaId/decisao` | tarefas.editar |  |  |  |
| GET | `/api/tenants/onboarding/trilhos/:id/kit` | tarefas.ver |  | IM-07 (rodada dos agentes): o kit e a pasta do cliente, para o card da Implantação. |  |
| POST | `/api/tenants/onboarding/trilhos/:id/kit` | tarefas.editar |  | IM-07: "Montar kit" no card. Gasta modelo; o segundo clique em curso ouve 409. |  |
| POST | `/api/tenants/onboarding/trilhos/:id/marcos` | tarefas.editar |  | Um marco escrito por gente: check semanal feito, dia 1 da imersão, retrospectiva… |  |
| POST | `/api/tenants/onboarding/trilhos/:id/memoria` | tarefas.editar |  |  |  |
| GET | `/api/tenants/onboarding/trilhos/:id/quem-trabalha` | tarefas.ver |  | Rodada de produção 1: quem trabalha nesta etapa (agentes do roster e o relógio), só leitura. |  |
| GET | `/api/tenants/onboarding/trilhos/:id/retrato` | tarefas.ver |  |  |  |
| GET | `/api/tenants/onboarding/trilhos/:id/roteiro` | tarefas.ver |  |  |  |
| POST | `/api/tenants/onboarding/trilhos/:id/roteiro/personalizar` | tarefas.editar |  |  |  |
| GET | `/api/tenants/onboarding/trilhos/espinha` | tarefas.ver |  | O dado versionado que a tela precisa: espinha, fases, níveis, receitas, régua. |  |
| GET | `/api/tenants/onboarding/trilhos/pendencias` | tarefas.ver |  |  | `onboarding_pendencias` |
| GET | `/api/tenants/plataforma/empresas` | dashboard.ver |  |  | `plataforma_empresas` |
| PUT | `/api/tenants/plataforma/empresas/:empresaId` | admin.permissoes |  |  |  |
| POST | `/api/tenants/plataforma/empresas/:empresaId/suporte` | admin.permissoes |  | Entrar na casa do cliente, com a autorização dele. `POST` e não `GET` de propósito: isto não é uma leitura idempotente qualquer — cada chamada gasta um uso, car |  |
| GET | `/api/tenants/plataforma/operacao/area-do-cliente` | dashboard.ver |  |  |  |
| GET | `/api/tenants/plataforma/operacao/fluxo-do-cliente` | dashboard.ver |  |  |  |
| GET | `/api/tenants/plataforma/operacao/painel` | dashboard.ver |  |  | `plataforma_operacao_painel` |
| GET | `/api/tenants/plataforma/propostas` | dashboard.ver |  |  |  |
| GET | `/api/tenants/plataforma/propostas/:cliente/:chave` | dashboard.ver |  |  |  |
| GET | `/api/tenants/plataforma/quem-sou` | dashboard.ver |  | A tela pergunta isto antes de montar: "esta sessão opera a plataforma?". |  |
| GET | `/api/tenants/plataforma/resumo` | dashboard.ver |  |  | `plataforma_resumo` |
| POST | `/api/tenants/provisionar` | admin.permissoes |  |  |  |
| GET | `/api/tenants/suporte` | dashboard.ver |  |  |  |
| POST | `/api/tenants/suporte` | admin.permissoes |  | O cliente autoriza. `admin.permissoes` é a permissão que o catálogo já dá a quem mexe em acesso (`usuario.permissao.alterar`, R4). Ela é NECESSÁRIA e não sufici |  |
| DELETE | `/api/tenants/suporte/:id` | admin.permissoes |  |  |  |
| GET | `/api/tenants/suporte/regras` | dashboard.ver |  | As regras que a tela do cliente precisa mostrar ANTES do formulário. Sai da API e não do componente pelo mesmo motivo do endereço da fila de aprovação: prazo má |  |
## `trabalho`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| DELETE | `/api/trabalho/apontamentos/:id` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/arquivadas` | tarefas.ver |  |  |  |
| GET | `/api/trabalho/arquivos/:taskId/:fileId` | tarefas.ver | arquivo |  |  |
| POST | `/api/trabalho/arvore/ordem` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/atas` | tarefas.ver |  |  | `trabalho_atas` |
| POST | `/api/trabalho/atas` | tarefas.editar, obsidian.editar | gente |  | `trabalho_ata_colar` |
| GET | `/api/trabalho/atas/:ref` | tarefas.ver |  |  |  |
| PUT | `/api/trabalho/atas/:ref/ligacao` | tarefas.editar | gente | Layout 26/10: liga a ata a um lead e/ou a um cliente (`null` desliga). Só a ligação: nenhuma reação. |  |
| POST | `/api/trabalho/atas/:ref/reprocessar` | tarefas.editar | gente | "Reprocessar sugestões": da TRANSCRIÇÃO, quando a ata veio do Granola (puxa de novo, e a ata ganha versão nova); da própria ata, quando foi colada ou está no va |  |
| POST | `/api/trabalho/atas/:ref/sugestoes` | tarefas.editar | gente |  |  |
| GET | `/api/trabalho/atas/alvos` | tarefas.ver |  | Layout 26/10: a busca de lead ou cliente para ligar a ata. |  |
| GET | `/api/trabalho/atas/drive` | tarefas.ver |  | A pasta do Google Drive das atas (P7): qual é e se quem pede pode ler o Drive. |  |
| PUT | `/api/trabalho/atas/drive` | tarefas.editar, obsidian.editar, drive.ver | gente | Escolhe a pasta (link ou id colado) ou a tira (`pasta: null`). Nota da memória, pelo `MemoriaService`. |  |
| POST | `/api/trabalho/atas/drive/:id/ata` | tarefas.editar, obsidian.editar, drive.ver | gente | Gera a ata de uma TRANSCRIÇÃO da pasta do Drive: o mesmo pedido da do Granola. |  |
| GET | `/api/trabalho/atas/granola` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/atas/granola/:id/ata` | tarefas.editar, obsidian.editar | gente |  |  |
| GET | `/api/trabalho/atas/ligadas` | tarefas.ver |  | Layout 26/10: as atas ligadas a um lead (`?lead=`) ou a um cliente (`?cliente=`). |  |
| GET | `/api/trabalho/atas/sugestoes` | tarefas.ver |  |  | `trabalho_ata_sugestoes` |
| POST | `/api/trabalho/atas/sugestoes/:id/aceitar` | tarefas.editar | gente |  |  |
| POST | `/api/trabalho/atas/sugestoes/:id/descartar` | tarefas.editar | gente |  |  |
| POST | `/api/trabalho/campos` | tarefas.editar |  |  |  |
| DELETE | `/api/trabalho/campos/:id` | tarefas.editar |  |  |  |
| PATCH | `/api/trabalho/campos/:id` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/campos/:id/opcoes` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/clientes` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/delegacoes/:id/aceitar` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/delegacoes/:id/descartar` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/espacos` | tarefas.editar |  |  |  |
| DELETE | `/api/trabalho/espacos/:id` | tarefas.editar |  |  |  |
| PATCH | `/api/trabalho/espacos/:id` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/estrutura` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/estrutura/sugerida` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/fichas/:taskId/contratos` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/fichas/:taskId/contratos` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/fichas/:taskId/contratos/garantir` | tarefas.editar |  | Chamado quando o card vira cliente: sem contrato, registra um com o valor da proposta. |  |
| GET | `/api/trabalho/fichas/:taskId/reunioes` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/fichas/:taskId/reunioes` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/fichas/:taskId/tarefas` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/fichas/:taskId/tarefas` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/fichas/:taskId/tarefas/rotina` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/fichas/contratos/:id/cancelar` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/fichas/granola/conexao` | dashboard.ver |  | O painel do Granola em Conexões: ligado ou não, senha ativa e o que chegou. |  |
| GET | `/api/trabalho/fichas/granola/sem-cliente` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/fichas/granola/senha` | admin.usuarios |  | Gera (ou troca) a senha do Zap. A mesma permissão de ligar e desligar conector, conferida de novo no banco: quem perdeu o acesso agora não gera. |  |
| GET | `/api/trabalho/fichas/quadro` | tarefas.ver |  | O quadro do CRM (`?lista=crm-root-lista`): as abas filtram pela fase da etapa. |  |
| DELETE | `/api/trabalho/fichas/reunioes/:id` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/fichas/reunioes/:id` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/fichas/reunioes/:id/vincular` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/fichas/tarefas/:id/alternar` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/granola/:orgId` | pública | pub |  |  |
| GET | `/api/trabalho/granola/callback` | pública | pub |  |  |
| GET | `/api/trabalho/granola/direto` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/granola/direto/revogacao` | admin.usuarios |  |  |  |
| GET | `/api/trabalho/implantacao/cartoes` | tarefas.ver |  | S1 e S2: por card da lista, a próxima reunião e a etapa contra a fase do trilho. | `trabalho_implantacao_cartoes` |
| GET | `/api/trabalho/implantacao/resumo` | tarefas.ver |  | S5: o cartão "Implantação" do Dia a dia, com os ids de cada pendência. | `trabalho_implantacao_resumo` |
| POST | `/api/trabalho/listas` | tarefas.editar |  |  | `trabalho_lista_criar` |
| DELETE | `/api/trabalho/listas/:id` | tarefas.editar | gente |  |  |
| PATCH | `/api/trabalho/listas/:id` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/listas/:id/arquivar-tarefas` | tarefas.editar | gente | Arquivar todas as tarefas da lista, o passo antes de excluir (P3). `{esperadas}` = quantas a tela mostrou. |  |
| POST | `/api/trabalho/listas/:id/desarquivar` | tarefas.editar | gente |  |  |
| POST | `/api/trabalho/listas/:id/mover-tarefas` | tarefas.editar | gente | Mover as tarefas ativas para outra lista, o passo antes de excluir (A3). `{destinoId, esperadas}`; mesmos ids, etapa pelo nome no destino. Só de gente. |  |
| POST | `/api/trabalho/listas/:id/statuses` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/listas/modelo` | tarefas.editar |  |  | `trabalho_lista_modelo` |
| GET | `/api/trabalho/lixeira` | tarefas.editar |  |  | `trabalho_lixeira` |
| POST | `/api/trabalho/lixeira/apagar-de-vez` | tarefas.editar, admin.usuarios |  |  |  |
| POST | `/api/trabalho/lixeira/restaurar` | tarefas.editar |  |  | `trabalho_lixeira_restaurar` |
| DELETE | `/api/trabalho/opcoes/:id` | tarefas.editar |  |  |  |
| PATCH | `/api/trabalho/opcoes/:id` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/pastas` | tarefas.editar |  |  | `trabalho_pasta_criar` |
| DELETE | `/api/trabalho/pastas/:id` | tarefas.editar | gente |  |  |
| PATCH | `/api/trabalho/pastas/:id` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/pastas/:id/desarquivar` | tarefas.editar | gente |  |  |
| POST | `/api/trabalho/pastas/:id/excluir` | tarefas.editar | gente |  |  |
| POST | `/api/trabalho/pastas/:id/mover` | tarefas.editar | gente |  |  |
| GET | `/api/trabalho/pessoas` | tarefas.ver |  |  | `trabalho_pessoas` |
| GET | `/api/trabalho/quadro/movimento` | tarefas.ver |  |  |  |
| DELETE | `/api/trabalho/statuses/:id` | tarefas.editar |  |  |  |
| PATCH | `/api/trabalho/statuses/:id` | tarefas.editar |  |  |  |
| PATCH | `/api/trabalho/statuses/:id/limite` | tarefas.editar | gente | S4: o limite de cartões da etapa pelo menu da coluna. Só gente, auditado, com a versão lida. |  |
| POST | `/api/trabalho/tags` | tarefas.editar |  |  |  |
| DELETE | `/api/trabalho/tags/:id` | tarefas.editar |  |  |  |
| PATCH | `/api/trabalho/tags/:id` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/tarefas` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/tarefas` | tarefas.editar |  |  | `trabalho_tarefa_criar` |
| DELETE | `/api/trabalho/tarefas/:id` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/tarefas/:id` | tarefas.ver |  |  |  |
| PATCH | `/api/trabalho/tarefas/:id` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/tarefas/:id/anexos` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/tarefas/:id/anexos` | tarefas.editar | upload |  |  |
| GET | `/api/trabalho/tarefas/:id/anexos/:anexoId/arquivo` | tarefas.ver | arquivo |  |  |
| POST | `/api/trabalho/tarefas/:id/apontamentos` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/tarefas/:id/assumir` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/tarefas/:id/atividade` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/tarefas/:id/comentarios` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/tarefas/:id/delegacao` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/tarefas/:id/delegacao/propor` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/tarefas/:id/duplicar` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/tarefas/:id/excluir` | tarefas.editar |  | Excluir = mandar para a Lixeira (o DELETE de sempre continua sendo arquivar). |  |
| GET | `/api/trabalho/tarefas/:id/fontes` | tarefas.ver, obsidian.ver |  |  |  |
| POST | `/api/trabalho/tarefas/:id/mesclar` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/tarefas/:id/mover` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/tarefas/:id/soltar` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/tarefas/ordem` | tarefas.editar |  | Ordem manual (versão final, F4): arrastar na lista ou na coluna grava `order`, com versão. |  |
| GET | `/api/trabalho/todas` | tarefas.ver |  |  | `trabalho_todas` |
| POST | `/api/trabalho/todas` | tarefas.editar |  |  | `trabalho_todas_criar` |
| PATCH | `/api/trabalho/todas/:id` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/todas/:id/feita` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/todas/areas` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/todas/areas` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/todas/clientes` | tarefas.editar |  |  |  |
| POST | `/api/trabalho/todas/ordem` | tarefas.editar |  |  |  |
| GET | `/api/trabalho/vistas` | tarefas.ver |  |  |  |
| POST | `/api/trabalho/vistas` | tarefas.ver |  |  |  |
| DELETE | `/api/trabalho/vistas/:id` | tarefas.ver |  |  |  |
| PATCH | `/api/trabalho/vistas/:id` | tarefas.ver |  |  |  |
## `users`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/users` | admin.usuarios |  |  | `usuarios` |
| POST | `/api/users` | admin.usuarios |  |  | `usuario_criar` |
| PATCH | `/api/users/:id` | admin.usuarios |  |  |  |
## `whatsapp`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/whatsapp/conversas` | leads.ver |  |  | `whatsapp_conversas` |
| GET | `/api/whatsapp/conversas/:id` | leads.ver |  |  |  |
| POST | `/api/whatsapp/conversas/:id/arquivar` | whatsapp.conversar | gente |  |  |
| POST | `/api/whatsapp/conversas/:id/lida` | leads.ver | gente |  |  |
| POST | `/api/whatsapp/conversas/:id/midia` | whatsapp.conversar | gente upload | Layout 27/10: um arquivo (foto, vídeo, áudio, documento) de uma pessoa pela Evolution. Multipart com o arquivo em `arquivo` e a legenda em `legenda`. Os guardas |  |
| POST | `/api/whatsapp/conversas/:id/responder` | whatsapp.conversar | gente |  |  |
| GET | `/api/whatsapp/mensagens/:id/midia` | leads.ver | arquivo |  |  |
| GET | `/api/whatsapp/resumo` | leads.ver |  |  | `whatsapp_resumo` |
| POST | `/api/whatsapp/vinculos/:conversaId` | leads.editar | gente | Vincular a lead ou a cliente: `{ tipo, id }`. |  |
| POST | `/api/whatsapp/vinculos/:conversaId/cliente-do-lead` | leads.editar | gente | Layout 27/10: o lead em Contrato ou Negócio fechado vira cliente e a conversa liga a ele: `{ leadId }`. |  |
| POST | `/api/whatsapp/vinculos/:conversaId/cliente-novo` | leads.editar | gente | Integração 26/10: cadastrar o cliente que ainda não existe e vincular a conversa: `{ nome }`. |  |
| POST | `/api/whatsapp/vinculos/:conversaId/comunidade` | leads.editar | gente | Layout 26/10: marcar ou tirar da comunidade: `{ comunidade }`. As mesmas regras da equipe. |  |
| POST | `/api/whatsapp/vinculos/:conversaId/desvincular` | leads.editar | gente |  |  |
| POST | `/api/whatsapp/vinculos/:conversaId/equipe` | leads.editar | gente | Marcar ou tirar da equipe: `{ equipe }`. |  |
| POST | `/api/whatsapp/vinculos/:conversaId/passar-para-cliente` | leads.editar | gente | Layout 27/10: o lead virou cliente; a conversa passa do lead ao cliente: `{ clienteId }` ou `{ nome }`. |  |
| POST | `/api/whatsapp/vinculos/:conversaId/sugestao` | leads.editar | gente | Aceitar a sugestão gravada (um clique). |  |
| POST | `/api/whatsapp/vinculos/:conversaId/telefone-no-lead` | leads.editar | gente | "Este número não está em nenhum lead; pôr no lead X?": `{ leadId, substituir? }`. |  |
| GET | `/api/whatsapp/vinculos/candidatos` | leads.ver |  | A busca de vínculo (`tipo` = lead ou cliente, opcional): o igual ao nome da conversa primeiro, até 20. | `whatsapp_candidatos` |
| GET | `/api/whatsapp/vinculos/cliente/:clienteId` | leads.ver |  | As conversas do cliente (bloco WhatsApp da ficha do cliente). |  |
| GET | `/api/whatsapp/vinculos/cliente/:clienteId/ficha` | leads.ver |  | A ficha (cartão) do cliente, para o link "Cliente: <nome>" da caixa: `{ taskId }` ou nulo. |  |
| PUT | `/api/whatsapp/vinculos/cliente/:clienteId/telefone` | leads.editar | gente | Editar o telefone do cliente (`Partner.phone`). |  |
| GET | `/api/whatsapp/vinculos/lead/:leadId` | leads.ver |  | As conversas do lead (aba WhatsApp do painel). |  |
| PUT | `/api/whatsapp/vinculos/lead/:leadId/telefone` | leads.editar | gente | Editar o telefone do lead (`Lead.phone`); depois as conversas 1:1 do número casam de novo. |  |
## `youtube`

| Método | Rota | Permissão | Marcas | O que faz | Curada |
|---|---|---|---|---|---|
| GET | `/api/youtube/callback` | pública | pub |  |  |
