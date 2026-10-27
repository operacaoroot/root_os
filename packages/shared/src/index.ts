export * from './permissions.js';
export * from './schemas.js';
export * from './modules.js';
export * from './nav.js';
// A conta das horas devolvidas mora aqui porque ela tem DOIS donos — `/rotinas`
// e `/agentes` —, e enquanto tinha duas casas tinha duas respostas. Ver o
// cabeçalho de `horas-devolvidas.ts`.
export * from './horas-devolvidas.js';

// O padrão de nomenclatura da agenda da Root (`Reunião Online - Cliente -
// Responsável`). Mora no shared porque a tela monta, a API escreve e a leitura
// desmonta o MESMO título — ver o cabeçalho de `agenda.ts`.
export * from './agenda.js';

// A regra do valor monetário do Trabalho mora aqui porque a tela, a API e o
// importador do ClickUp convertem e conferem o MESMO texto canônico — ver o
// cabeçalho de `valor-monetario.ts`.
export * from './valor-monetario.js';
export * from './metas-do-mes.js';

// Nome padrão; cada app pode sobrescrever via seu próprio env (APP_NAME).
export const DEFAULT_APP_NAME = 'Marketing OS';

// A entrada idempotente de lead (ROOT-48, C-01): a tela, a API e o teste leem o
// MESMO pedido — ver o cabeçalho de `lead-entrada.ts`.
export * from './lead-entrada.js';
// A proposta e o aceite comercial (ROOT-49, C-03): ver o cabeçalho de `lead-proposta.ts`.
export * from './lead-proposta.js';

// O cockpit do lead (módulo comercial, 13/10/2026): etapas, eventos, decisões,
// a sala do cliente e a tabela de preço de 04/10 — ver o cabeçalho de `comercial.ts`.
export * from './comercial.js';

// O banco de atas do Trabalho e as sugestões de tarefa (rodada do painel P3,
// 18/10/2026) — ver o cabeçalho de `atas.ts`.
export * from './atas.js';

// A sala do cliente publicada por versão (rodada da implantação I3, 18/10/2026) — ver o
// cabeçalho de `sala-versao.ts`.
export * from './sala-versao.js';

// O relatório do comercial, bloco Leitura e reação (rodada da implantação I5, 18/10/2026) — ver o
// cabeçalho de `leitura-e-reacao.ts`.
export * from './leitura-e-reacao.js';

// A implantação de clientes numa tela só (rodada do trabalho T1, 19/10/2026): a lista
// "Onboarding de cliente" da pasta "Clientes" — ver o cabeçalho de `implantacao.ts`.
export * from './implantacao.js';
// Editar a árvore do Trabalho onde a pessoa está olhando (adendo da rodada de produção 1, A3):
// ver o cabeçalho de `arvore-do-trabalho.ts`.
export * from './arvore-do-trabalho.js';
// Ícone e cor da lista e da pasta (I1) e a pasta Clientes fora do Trabalho (I3), produção 22B.
export * from './aparencia-do-trabalho.js';
export * from './pasta-do-comercial.js';
// A Lixeira do Trabalho e o menu da tarefa (rodada de produção 3, I2 e I4, 22/10/2026).
export * from './lixeira-do-trabalho.js';
export * from './menu-da-tarefa.js';
// Iniciar o onboarding antes do negócio fechado (ajustes A2): ver `onboarding-antecipado.ts`.
export * from './onboarding-antecipado.js';

// As vistas salvas de Minhas tarefas e do quadro (rodada do trabalho T3, 19/10/2026): ver o
// cabeçalho de `vistas.ts`.
export * from './vistas.js';

// O cliente que fechou fora do sistema (rodada do trabalho T1b, 19/10/2026): a porta
// "Registrar cliente já fechado" do Funil vivo. Ver o cabeçalho de `comercial-fechado-fora.ts`.
export * from './comercial-fechado-fora.js';
// O contrato importado do CRM antigo: o PDF e as parcelas à mão (produção 22, M2). Ver `comercial-contrato-importado.ts`.
export * from './comercial-contrato-importado.js';
export * from './comercial-exercicio';
export * from './fonte-autorizada.js';

export * from './comercial-ponte-exercicio.js';
export * from './catalogo-de-colecao.js';
export * from './brandbook.js';
export * from './financeiro-exercicio-inscricao.js';
export * from './marketing-recuperacao.js';
export * from './prontidao-local';
export * from './agent-sop-edicao';
export * from './conexoes-declarativas';

export {
  DemonstracaoSinteticaManifestoSchema,
  DemonstracaoSinteticaFontesSchema,
  DemonstracaoSinteticaReciboSchema,
  DemonstracaoSinteticaResultadoSchema,
  type DemonstracaoSinteticaManifesto,
  type DemonstracaoSinteticaFontes,
  type DemonstracaoSinteticaRecibo,
  type DemonstracaoSinteticaResultado,
} from './demonstracao-sintetica';

export * from './procedimento-local';

export * from './pauta-edicao-humana.js';

export * from './contexto-movimento-explicito.js';
export * from './agent-estado-humano';
export * from './agenda-local';
export * from './sessao-leitura-historica';
export * from './onboarding-indice.js';

export * from './procedimento-ferramenta-local';

// O painel da operação da Root, que só a sessão da plataforma abre — ver o
// cabeçalho de `operacao-painel.ts`.
export * from './operacao-painel.js';
// O Painel geral do comercial (layout do Lucas, dados do cockpit): ver `painel-comercial.ts`.
export * from './painel-comercial.js';
// O WhatsApp do comercial pela Evolution em Integrações (Produção 21, P8): ver `evolution.ts`.
export * from './evolution.js';
export * from './propostas-da-sala.js';
// A proposta é do lead: o vínculo da proposta do serviço (Produção 22B, I5): ver `proposta-do-lead.ts`.
export * from './proposta-do-lead.js';
// A ficha do cliente (reuniões presas ao cartão): ver `ficha-do-cliente.ts`.
export * from './ficha-do-cliente.js';

// Tarefas de todas as áreas (Dia a dia › Tarefas): o que é a MESMA tarefa, o que
// não parece tarefa e a régua do prazo — a tela e a API leem a mesma regra.
export * from './tarefas-do-dia.js';
// As tarefas do comercial (adendo de 21/10/2026, §A1): ver `comercial-tarefas.ts`.
export * from './comercial-tarefas.js';
// O cadastro único de agentes, rotinas e automações (rodada dos agentes, 21/10/2026): ver `agentes.ts`.
export * from './agentes.js';
// As pendências que agentes e rotinas deixam para uma pessoa (rodada dos agentes): ver `pendencias.ts`.
export * from './pendencias.js';
// A pasta do cliente no Drive e o nome padrão dos arquivos (rodada dos agentes): ver `pasta-do-cliente.ts`.
export * from './pasta-do-cliente.js';
// Os arquivos do cliente e o anexo na tarefa (rodada dos agentes, lane A4): ver `clientes-arquivos.ts`.
export * from './clientes-arquivos.js';
// A lane A3+TR da rodada dos agentes (kit, cobrador, triagem da caixa, delegador): ver `agentes-da-implantacao.ts`.
export * from './agentes-da-implantacao.js';
// Os agentes do comercial da rodada de 21/10/2026 (lane A2): ver `comercial-agentes.ts`.
export * from './comercial-agentes.js';
// A Equipe e o catálogo na tela (rodada dos agentes, lane A7): ver `equipe-pessoas.ts`, `equipe-whatsapp.ts` e `agentes-tela.ts`.
export * from './equipe-pessoas.js';
export * from './equipe-whatsapp.js';
export * from './agentes-tela.js';
// O cartão único de Conexões (rodada dos agentes, lane A6): ver `cartoes-de-conexao.ts`.
export * from './cartoes-de-conexao.js';
// O cartão da implantação: reunião, fase do trilho, Pedir agora e limite (produção 22, M1): ver `implantacao-do-cartao.ts`.
export * from './implantacao-do-cartao.js';
// O perfil da pessoa e as atribuições da Equipe lidas do vault (produção 22B, I6): ver `perfil.ts` e `equipe-atribuicoes.ts`.
export * from './perfil.js';
export * from './equipe-atribuicoes.js';
// O WhatsApp da empresa por dentro do OS: caixa, vínculo e cartão do Dia a dia (produção 22C): ver `whatsapp-caixa.ts`.
export * from './whatsapp-caixa.js';
export * from './maquina-de-conteudo.js';
export * from './marketing-abas.js';
export * from './marketing-estudio.js';
