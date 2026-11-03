// As ferramentas CURADAS: nome em português, uma rota cada, para o dia a dia do OS. Tabela, não código por ferramenta.
// Leitura pelo leitor (operador, senão serviço); escrita em nome do operador. O que a rota exige (permissão, gente,
// porta) vem do inventário e entra na descrição. Rotas fora desta tabela continuam ao alcance de `os_api`.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodRawShape } from 'zod';
import { leitor, operador } from '../client.js';
import { ROTAS } from '../rotas.gen.js';
import type { Metodo } from '../rotas.js';
import { DESTROI, ESCREVE, ESCREVE_IDEMPOTENTE, LE, fail, ok } from './base.js';

interface Curada {
  nome: string;
  titulo: string;
  descricao: string;
  metodo: Metodo;
  /** Rota sem `/api`, com `:nome_do_argumento` nos parâmetros. */
  rota: string;
  /** Argumentos além dos parâmetros da rota. */
  args?: ZodRawShape;
  /** Nomes de argumentos que viram query string. `filtros` (record) sempre vira query quando declarado em args. */
  query?: string[];
  /** 'livre' aceita `corpo` (JSON); função monta o corpo a partir dos argumentos. */
  corpo?: 'livre' | ((a: Record<string, unknown>) => unknown);
  /** Upload multipart: o argumento com o caminho do arquivo e o campo. */
  upload?: { arquivo: string; campo?: string; campos?: (a: Record<string, unknown>) => Record<string, string> };
}

const corpoLivre = (campos: string) => z.record(z.unknown()).optional().describe(`JSON do corpo: ${campos}`);
const filtros = z.record(z.string()).optional().describe('Filtros da query string (chave: valor)');

const CURADAS: Curada[] = [
  // ------------------------------------------------------------------ comercial
  { nome: 'comercial_funil', titulo: 'Comercial: funil vivo', descricao: 'O funil com os leads por etapa e as saídas visíveis.', metodo: 'GET', rota: '/comercial/funil', args: { dono: z.string().optional().describe('id, "eu" ou "sem"'), q: z.string().optional() }, query: ['dono', 'q'] },
  { nome: 'comercial_fila', titulo: 'Comercial: fila de decisões', descricao: 'A fila de decisões da mesa, o que rodou sozinho hoje e os contadores.', metodo: 'GET', rota: '/comercial/fila' },
  { nome: 'comercial_painel', titulo: 'Comercial: painel', descricao: 'O painel do comercial (números do funil, pendências, próximos passos).', metodo: 'GET', rota: '/comercial/painel' },
  { nome: 'comercial_lista_de_leads', titulo: 'Comercial: lista de leads', descricao: 'A lista de leads do comercial com etapa, dono e próxima ação.', metodo: 'GET', rota: '/comercial/lista-de-leads' },
  { nome: 'comercial_leads_parecidos', titulo: 'Comercial: leads parecidos', descricao: 'Antes de criar um lead: já existe com esta empresa, telefone, e-mail ou contato?', metodo: 'GET', rota: '/comercial/leads/parecidos', args: { empresa: z.string().optional(), telefone: z.string().optional(), email: z.string().optional(), contato: z.string().optional() }, query: ['empresa', 'telefone', 'email', 'contato'] },
  { nome: 'comercial_lead_fio', titulo: 'Comercial: fio do lead', descricao: 'O fio cru do lead (todos os fatos gravados, em ordem).', metodo: 'GET', rota: '/comercial/lead/:lead_id/fio' },
  { nome: 'comercial_lead_pendencias', titulo: 'Comercial: pendências do lead', descricao: 'O que está pendente neste lead (decisões, aprovações, próximos passos).', metodo: 'GET', rota: '/comercial/lead/:lead_id/pendencias' },
  { nome: 'comercial_lead_sessao', titulo: 'Comercial: pós-sessão do lead', descricao: 'O pós-sessão: diagnóstico, rascunhos da proposta com o laudo e o estado.', metodo: 'GET', rota: '/comercial/lead/:lead_id/sessao' },
  { nome: 'comercial_lead_reacoes', titulo: 'Comercial: leitura da proposta pelo cliente', descricao: 'O que o cliente leu na proposta e o que anotou nela.', metodo: 'GET', rota: '/comercial/lead/:lead_id/reacoes' },
  { nome: 'comercial_lead_entrada', titulo: 'Comercial: entrar um lead', descricao: 'Entrada idempotente de lead novo (ROOT-48). Confira antes com comercial_leads_parecidos.', metodo: 'POST', rota: '/leads/entrada', args: { corpo: corpoLivre('name, company, email, phone, source, origem/mensagem conforme a entrada') }, corpo: 'livre' },
  { nome: 'comercial_lead_mover', titulo: 'Comercial: mover lead de etapa', descricao: 'Move o lead para qualquer etapa do funil, sem assinatura de outra pessoa. Grava o fato e a auditoria; nada do fechamento nasce daqui.', metodo: 'POST', rota: '/comercial/lead/:lead_id/mover', args: { para: z.string().describe('Etapa de destino (slug da etapa do funil)'), motivo: z.string().max(400).optional(), tipoDeMotivo: z.string().optional(), voltaEm: z.string().optional().describe('ISO com fuso, quando é geladeira'), parceiro: z.string().max(120).optional() }, corpo: (a) => semVazios({ para: a.para, motivo: a.motivo, tipoDeMotivo: a.tipoDeMotivo, voltaEm: a.voltaEm, parceiro: a.parceiro }) },
  { nome: 'comercial_lead_nota', titulo: 'Comercial: nota no fio', descricao: 'Escreve uma nota de gente no fio do lead.', metodo: 'POST', rota: '/comercial/lead/:lead_id/fio/nota', args: { corpo: corpoLivre('texto') }, corpo: 'livre' },
  { nome: 'comercial_lead_ficha', titulo: 'Comercial: editar ficha', descricao: 'Edita campos da ficha do lead (próxima ação, datas, observações), em nome de gente.', metodo: 'PATCH', rota: '/comercial/lead/:lead_id/ficha', args: { corpo: corpoLivre('os campos da ficha a alterar') }, corpo: 'livre' },
  { nome: 'comercial_lead_identidade', titulo: 'Comercial: corrigir nome e empresa', descricao: 'Corrige o nome do contato e/ou a empresa do lead (fato no fio, sem automação).', metodo: 'POST', rota: '/comercial/lead/:lead_id/identidade', args: { corpo: corpoLivre('nome, empresa') }, corpo: 'livre' },
  { nome: 'comercial_lead_negocio', titulo: 'Comercial: valor, vendedor e canal', descricao: 'Grava valor negociado, vendedor e canal de aquisição do lead.', metodo: 'POST', rota: '/comercial/lead/:lead_id/negocio', args: { corpo: corpoLivre('valorCentavos, vendedorId, canal') }, corpo: 'livre' },
  { nome: 'comercial_lead_saida', titulo: 'Comercial: saída do funil', descricao: 'Tira o lead do funil com motivo e dono: desqualificado, geladeira (com voltaEm), perdido ou parceiro.', metodo: 'POST', rota: '/comercial/lead/:lead_id/saida', args: { corpo: corpoLivre('saida, motivo, detalhe, voltaEm, parceiro') }, corpo: 'livre' },
  { nome: 'comercial_lead_dono', titulo: 'Comercial: trocar o dono', descricao: 'Troca o dono do lead, com motivo opcional (sem aprovação; evento e auditoria).', metodo: 'PUT', rota: '/leads/:lead_id/dono', args: { corpo: corpoLivre('ownerId (ou dono), motivo') }, corpo: 'livre' },
  { nome: 'comercial_lead_venda_nova', titulo: 'Comercial: venda nova de cliente', descricao: 'Abre um lead novo ligado ao mesmo cadastro de quem já é cliente.', metodo: 'POST', rota: '/comercial/lead/:lead_id/venda-nova', args: { corpo: corpoLivre('produto, observação') }, corpo: 'livre' },
  { nome: 'comercial_lead_ata', titulo: 'Comercial: ata da sessão', descricao: 'Registra a ata da sessão estratégica do lead (só o hash vai ao fio).', metodo: 'POST', rota: '/comercial/lead/:lead_id/ata', args: { corpo: corpoLivre('texto da ata, referência') }, corpo: 'livre' },
  { nome: 'comercial_diagnostico_gerar', titulo: 'Comercial: gerar diagnóstico', descricao: 'Refaz o diagnóstico a partir do texto da ata (gasta IA).', metodo: 'POST', rota: '/comercial/lead/:lead_id/diagnostico/gerar' },
  { nome: 'comercial_diagnostico_aprovar', titulo: 'Comercial: aprovar diagnóstico', descricao: 'O toque do sócio que solta a proposta (pede aprovacoes.decidir).', metodo: 'POST', rota: '/comercial/lead/:lead_id/diagnostico/aprovar' },
  { nome: 'comercial_proposta_gerar', titulo: 'Comercial: gerar proposta', descricao: 'Monta ou refaz a proposta pela tabela, passa pelo revisor e encaminha (porta ou fila de decisão).', metodo: 'POST', rota: '/comercial/lead/:lead_id/proposta/gerar', args: { corpo: corpoLivre('opcional: ajustes') }, corpo: 'livre' },
  { nome: 'comercial_proposta_publicar', titulo: 'Comercial: liberar proposta', descricao: 'Libera a proposta pronta ou segurada: vai à porta em nome de quem pediu (R3, outra pessoa libera).', metodo: 'POST', rota: '/comercial/lead/:lead_id/proposta/publicar' },
  { nome: 'comercial_proposta_segurar', titulo: 'Comercial: segurar proposta', descricao: 'Tira a proposta da agenda e da fila de liberação.', metodo: 'POST', rota: '/comercial/lead/:lead_id/proposta/segurar' },
  { nome: 'comercial_propostas', titulo: 'Comercial: propostas', descricao: 'As propostas da empresa com estado.', metodo: 'GET', rota: '/comercial/propostas' },
  { nome: 'comercial_proposta', titulo: 'Comercial: proposta do lead', descricao: 'A proposta de um lead, com versões e estado.', metodo: 'GET', rota: '/comercial/propostas/:lead_id' },
  { nome: 'comercial_contratos', titulo: 'Comercial: contratos vivos', descricao: 'A lista de contratos vivos da empresa.', metodo: 'GET', rota: '/comercial/contratos' },
  { nome: 'comercial_contrato', titulo: 'Comercial: contrato do lead', descricao: 'O contrato vivo com parcelas, régua de cobrança, entregas, saúde e marcos.', metodo: 'GET', rota: '/comercial/contratos/:lead_id' },
  { nome: 'comercial_contrato_encerrar', titulo: 'Comercial: encerrar contrato', descricao: 'Encerra à mão: concluir ou desativar, com motivo.', metodo: 'POST', rota: '/comercial/contratos/:lead_id/encerrar', args: { corpo: corpoLivre('como (concluir|desativar), motivo') }, corpo: 'livre' },
  { nome: 'comercial_fechamento', titulo: 'Comercial: fechamento do lead', descricao: 'O fechamento, escrita a escrita (cliente, contrato, card, cobrança).', metodo: 'GET', rota: '/comercial/fechamentos/:lead_id' },
  { nome: 'comercial_fechamento_rodar', titulo: 'Comercial: rodar fechamento', descricao: 'Propõe de novo o fechamento à porta (R4 espera a titular).', metodo: 'POST', rota: '/comercial/fechamentos/:lead_id/rodar' },
  { nome: 'comercial_cliente_fechado_fora', titulo: 'Comercial: registrar cliente fechado fora', descricao: 'Registra um cliente que fechou fora do funil, com o PDF do contrato assinado: cria lead, cliente, contrato e o card da implantação. `dados` leva razaoSocial, cnpj, quemAssina, email, telefone, endereco?, produto, valorCentavos, parcelas, forma, assinadoEm, primeiroVencimento, criarCobranca (padrão false), motivoSemCobranca.', metodo: 'POST', rota: '/comercial/clientes-fechados-fora', args: { caminho_pdf: z.string().describe('Caminho local do PDF do contrato assinado'), dados: z.record(z.unknown()).describe('Os dados do cliente e do contrato') }, upload: { arquivo: 'caminho_pdf', campo: 'file', campos: (a) => ({ dados: JSON.stringify(a.dados) }) } },
  { nome: 'comercial_sala_estado', titulo: 'Sala do cliente: estado', descricao: 'A linha do tempo da sala do lead: criada, link entregue, publicada, na porta, última visita (nunca o link em claro).', metodo: 'GET', rota: '/comercial/lead/:lead_id/sala/estado' },
  { nome: 'comercial_sala_versoes', titulo: 'Sala do cliente: versões', descricao: 'As versões da sala do lead (publicada, rascunho, na porta).', metodo: 'GET', rota: '/comercial/lead/:lead_id/sala/versoes' },
  { nome: 'comercial_sala_rascunho', titulo: 'Sala do cliente: salvar rascunho', descricao: 'Salva o rascunho da sala (o que o lead vê antes de fechar). Nada chega ao cliente sem publicar.', metodo: 'PUT', rota: '/comercial/lead/:lead_id/sala/rascunho', args: { corpo: corpoLivre('o conteúdo da sala (SalaRascunhoSchema)') }, corpo: 'livre' },
  { nome: 'comercial_sala_publicar', titulo: 'Sala do cliente: pedir publicação', descricao: 'Pede a publicação da sala (R3: outra pessoa libera em Aprovações).', metodo: 'POST', rota: '/comercial/lead/:lead_id/sala/publicar' },
  { nome: 'comercial_sala_criar', titulo: 'Sala do cliente: criar', descricao: 'Cria a sala agora para o lead que ainda não tem.', metodo: 'POST', rota: '/comercial/lead/:lead_id/sala' },
  { nome: 'comercial_sala_link', titulo: 'Sala do cliente: copiar link', descricao: 'Devolve o link da sala em claro, só nesta resposta, com auditoria (quem e quando). Não grave o link em nota.', metodo: 'POST', rota: '/comercial/lead/:lead_id/sala/link' },
  { nome: 'comercial_tarefas', titulo: 'Comercial: tarefas', descricao: 'As tarefas do comercial (da lista do comercial ou ligadas a lead).', metodo: 'GET', rota: '/comercial/tarefas', args: { leadId: z.string().optional(), semLead: z.string().optional().describe('"true" para só as sem lead'), pessoa: z.string().optional() }, query: ['leadId', 'semLead', 'pessoa'] },
  { nome: 'comercial_tarefa_criar', titulo: 'Comercial: criar tarefa', descricao: 'Cria uma tarefa do comercial (com leadId quando é de um lead).', metodo: 'POST', rota: '/comercial/tarefas', args: { corpo: corpoLivre('title, leadId?, dueDate?, assigneeUserId?, description?') }, corpo: 'livre' },
  { nome: 'comercial_tarefa_editar', titulo: 'Comercial: editar tarefa', descricao: 'Edita uma tarefa do comercial (status, prazo, responsável).', metodo: 'PATCH', rota: '/comercial/tarefas/:id', args: { corpo: corpoLivre('campos a alterar, expectedUpdatedAt') }, corpo: 'livre' },
  { nome: 'comercial_decisoes', titulo: 'Comercial: decisões da mesa', descricao: 'A fila de decisões (abertas, tomadas, expiradas).', metodo: 'GET', rota: '/comercial/decisoes' },
  { nome: 'comercial_decisao_responder', titulo: 'Comercial: responder decisão', descricao: 'Responde uma decisão da mesa com um toque (pede aprovacoes.decidir).', metodo: 'POST', rota: '/comercial/decisoes/:id/responder', args: { corpo: corpoLivre('opcao/botão escolhido') }, corpo: 'livre' },
  { nome: 'comercial_relatorio_semana', titulo: 'Comercial: relatório da semana', descricao: 'O último relatório semanal gerado, ou os números ao vivo.', metodo: 'GET', rota: '/comercial/relatorio/semana' },
  { nome: 'comercial_relatorio_semana_gerar', titulo: 'Comercial: gerar relatório da semana', descricao: 'Gera o relatório agora (o que o relógio faz na quinta 18h).', metodo: 'POST', rota: '/comercial/relatorio/semana/gerar', args: { corpo: corpoLivre('dias (opcional)') }, corpo: 'livre' },
  { nome: 'comercial_torre', titulo: 'Comercial: torre das automações', descricao: 'Autonomia, última vez, acerto, premissa, vigia e custo do dia de cada automação.', metodo: 'GET', rota: '/comercial/torre' },
  { nome: 'comercial_onboarding_antecipado', titulo: 'Comercial: iniciar onboarding antes do fechamento', descricao: 'Abre o card da implantação e o trilho para um lead ainda em andamento.', metodo: 'POST', rota: '/comercial/leads/:lead_id/onboarding-antecipado', args: { corpo: corpoLivre('etapa (opcional)') }, corpo: 'livre' },
  // ------------------------------------------------------------------ trabalho
  { nome: 'trabalho_tarefa_criar', titulo: 'Trabalho: criar tarefa', descricao: 'Cria uma tarefa numa lista do Trabalho.', metodo: 'POST', rota: '/trabalho/tarefas', args: { corpo: corpoLivre('listId, title, description?, statusId?, priority?, assigneeUserId?, dueDate?, startDate?, parentId?, tagIds?, campos?') }, corpo: 'livre' },
  { nome: 'trabalho_tarefa_editar', titulo: 'Trabalho: editar tarefa', descricao: 'Edita campos da tarefa (título, descrição, etapa, prazo, responsável, campos). Mande expectedUpdatedAt quando tiver.', metodo: 'PATCH', rota: '/trabalho/tarefas/:id', args: { corpo: corpoLivre('os campos a alterar') }, corpo: 'livre' },
  { nome: 'trabalho_tarefa_mover', titulo: 'Trabalho: mover tarefa', descricao: 'Move a tarefa para outra lista (etapa pelo nome, senão pelo tipo).', metodo: 'POST', rota: '/trabalho/tarefas/:id/mover', args: { corpo: corpoLivre('destinoId (lista), statusId?') }, corpo: 'livre' },
  { nome: 'trabalho_tarefa_comentar', titulo: 'Trabalho: comentar tarefa', descricao: 'Escreve um comentário na tarefa.', metodo: 'POST', rota: '/trabalho/tarefas/:id/comentarios', args: { text: z.string().min(1).describe('O comentário') }, corpo: (a) => ({ text: a.text }) },
  { nome: 'trabalho_tarefa_atividade', titulo: 'Trabalho: atividade da tarefa', descricao: 'A atividade (auditoria) da tarefa.', metodo: 'GET', rota: '/trabalho/tarefas/:id/atividade' },
  { nome: 'trabalho_tarefa_assumir', titulo: 'Trabalho: assumir tarefa', descricao: 'Assume a tarefa (checkout).', metodo: 'POST', rota: '/trabalho/tarefas/:id/assumir' },
  { nome: 'trabalho_tarefa_soltar', titulo: 'Trabalho: soltar tarefa', descricao: 'Solta a tarefa assumida.', metodo: 'POST', rota: '/trabalho/tarefas/:id/soltar' },
  { nome: 'trabalho_tarefa_duplicar', titulo: 'Trabalho: duplicar tarefa', descricao: 'Duplica a tarefa.', metodo: 'POST', rota: '/trabalho/tarefas/:id/duplicar', args: { corpo: corpoLivre('opcional') }, corpo: 'livre' },
  { nome: 'trabalho_tarefa_excluir', titulo: 'Trabalho: excluir tarefa (Lixeira)', descricao: 'Manda a tarefa para a Lixeira (recuperável por 30 dias).', metodo: 'POST', rota: '/trabalho/tarefas/:id/excluir' },
  { nome: 'trabalho_tarefa_apontar_horas', titulo: 'Trabalho: apontar horas', descricao: 'Aponta minutos trabalhados na tarefa (dia padrão: hoje em Brasília).', metodo: 'POST', rota: '/trabalho/tarefas/:id/apontamentos', args: { corpo: corpoLivre('minutos (1 a 1440), dia?, nota?') }, corpo: 'livre' },
  { nome: 'trabalho_tarefa_anexos', titulo: 'Trabalho: anexos da tarefa', descricao: 'Os anexos da tarefa.', metodo: 'GET', rota: '/trabalho/tarefas/:id/anexos' },
  { nome: 'trabalho_tarefa_anexar', titulo: 'Trabalho: anexar arquivo', descricao: 'Anexa um arquivo local à tarefa.', metodo: 'POST', rota: '/trabalho/tarefas/:id/anexos', args: { caminho_local: z.string().describe('Caminho do arquivo neste computador') }, upload: { arquivo: 'caminho_local', campo: 'file' } },
  { nome: 'trabalho_lista_criar', titulo: 'Trabalho: criar lista', descricao: 'Cria uma lista (numa pasta ou solta).', metodo: 'POST', rota: '/trabalho/listas', args: { corpo: corpoLivre('name, folderId?, spaceId?') }, corpo: 'livre' },
  { nome: 'trabalho_lista_editar', titulo: 'Trabalho: editar lista', descricao: 'Renomeia ou move a lista de pasta.', metodo: 'PATCH', rota: '/trabalho/listas/:id', args: { corpo: corpoLivre('name?, folderId?') }, corpo: 'livre' },
  { nome: 'trabalho_lista_modelo', titulo: 'Trabalho: criar lista por modelo', descricao: 'Cria uma lista a partir de um modelo (esteira-de-clientes, onboarding-de-cliente).', metodo: 'POST', rota: '/trabalho/listas/modelo', args: { corpo: corpoLivre('modelo, name?, folderId?') }, corpo: 'livre' },
  { nome: 'trabalho_pasta_criar', titulo: 'Trabalho: criar pasta', descricao: 'Cria uma pasta (até 4 níveis).', metodo: 'POST', rota: '/trabalho/pastas', args: { corpo: corpoLivre('name, parentId?, spaceId?') }, corpo: 'livre' },
  { nome: 'trabalho_pasta_editar', titulo: 'Trabalho: editar pasta', descricao: 'Renomeia a pasta.', metodo: 'PATCH', rota: '/trabalho/pastas/:id', args: { corpo: corpoLivre('name') }, corpo: 'livre' },
  { nome: 'trabalho_todas', titulo: 'Trabalho: Todas (tarefas soltas)', descricao: 'A lista Todas: tarefas rápidas por área e cliente.', metodo: 'GET', rota: '/trabalho/todas', args: { filtros }, query: [] },
  { nome: 'trabalho_todas_criar', titulo: 'Trabalho: criar em Todas', descricao: 'Cria uma tarefa rápida em Todas.', metodo: 'POST', rota: '/trabalho/todas', args: { corpo: corpoLivre('title, area?, cliente?, dueDate?') }, corpo: 'livre' },
  { nome: 'trabalho_todas_feita', titulo: 'Trabalho: marcar feita em Todas', descricao: 'Marca a tarefa de Todas como feita.', metodo: 'POST', rota: '/trabalho/todas/:id/feita' },
  { nome: 'trabalho_atas', titulo: 'Trabalho: atas e transcrições', descricao: 'As atas do vault, coladas, do Granola e do Drive, a mais nova primeiro.', metodo: 'GET', rota: '/trabalho/atas', args: { q: z.string().optional(), de: z.string().optional(), ate: z.string().optional(), tipo: z.string().optional(), fonte: z.string().optional() }, query: ['q', 'de', 'ate', 'tipo', 'fonte'] },
  { nome: 'trabalho_ata', titulo: 'Trabalho: uma ata', descricao: 'O texto e os dados de uma ata pela referência (vault:..., granola:<id>, drive:<id>).', metodo: 'GET', rota: '/trabalho/atas/:ref' },
  { nome: 'trabalho_ata_colar', titulo: 'Trabalho: colar ata', descricao: 'Grava uma ata colada como nota da memória (chave ata:<data>-<slug>).', metodo: 'POST', rota: '/trabalho/atas', args: { corpo: corpoLivre('titulo, data, texto, leadId?, clienteId?') }, corpo: 'livre' },
  { nome: 'trabalho_ata_sugerir_tarefas', titulo: 'Trabalho: sugerir tarefas da ata', descricao: 'Lê a ata com IA e propõe tarefas (ficam em rascunho até aceitar).', metodo: 'POST', rota: '/trabalho/atas/:ref/sugestoes' },
  { nome: 'trabalho_ata_sugestoes', titulo: 'Trabalho: sugestões pendentes', descricao: 'As sugestões de tarefa vindas de atas, em rascunho.', metodo: 'GET', rota: '/trabalho/atas/sugestoes' },
  { nome: 'trabalho_ata_sugestao_aceitar', titulo: 'Trabalho: aceitar sugestão', descricao: 'Aceita a sugestão e cria a tarefa.', metodo: 'POST', rota: '/trabalho/atas/sugestoes/:id/aceitar' },
  { nome: 'trabalho_ata_sugestao_descartar', titulo: 'Trabalho: descartar sugestão', descricao: 'Descarta a sugestão (fica registrado).', metodo: 'POST', rota: '/trabalho/atas/sugestoes/:id/descartar' },
  { nome: 'trabalho_implantacao_cartoes', titulo: 'Implantação: cartões', descricao: 'Por card da implantação: próxima reunião e etapa contra a fase do trilho.', metodo: 'GET', rota: '/trabalho/implantacao/cartoes', args: { listId: z.string().optional() }, query: ['listId'] },
  { nome: 'trabalho_implantacao_resumo', titulo: 'Implantação: resumo', descricao: 'O cartão Implantação do Dia a dia, com as pendências.', metodo: 'GET', rota: '/trabalho/implantacao/resumo' },
  { nome: 'trabalho_pessoas', titulo: 'Trabalho: pessoas', descricao: 'As pessoas da empresa para atribuir tarefa.', metodo: 'GET', rota: '/trabalho/pessoas' },
  { nome: 'trabalho_lixeira', titulo: 'Trabalho: lixeira', descricao: 'As tarefas excluídas, recuperáveis.', metodo: 'GET', rota: '/trabalho/lixeira' },
  { nome: 'trabalho_lixeira_restaurar', titulo: 'Trabalho: restaurar da lixeira', descricao: 'Restaura tarefas da Lixeira para a lista e a etapa de origem.', metodo: 'POST', rota: '/trabalho/lixeira/restaurar', args: { corpo: corpoLivre('ids') }, corpo: 'livre' },
  // ------------------------------------------------------------------ aprovações, porta, pendências
  { nome: 'aprovacoes_fila', titulo: 'Aprovações: fila', descricao: 'A fila de aprovações de /atendimento (o que espera a segunda pessoa).', metodo: 'GET', rota: '/approvals/fila' },
  { nome: 'aprovacoes_listar', titulo: 'Aprovações: listar', descricao: 'As aprovações por status.', metodo: 'GET', rota: '/approvals', args: { status: z.string().optional().describe('pendente, confirmada, rejeitada, expirada') }, query: ['status'] },
  { nome: 'aprovacao', titulo: 'Aprovações: uma aprovação', descricao: 'O detalhe de uma aprovação (capacidade, argumentos resumidos, alçada, prazo).', metodo: 'GET', rota: '/approvals/:id' },
  { nome: 'aprovacao_confirmar', titulo: 'Aprovações: confirmar', descricao: 'Confirma a aprovação em nome do operador: só vale se ele NÃO for quem propôs (segunda pessoa), com alçada. R4 exige motivo e a senha (reautenticação).', metodo: 'POST', rota: '/approvals/:id/confirm', args: { motivo: z.string().max(2000).optional(), senha: z.string().optional().describe('Só em R4/R5: a senha do operador para reautenticar') }, corpo: (a) => semVazios({ motivo: a.motivo, reauth: a.senha ? { senha: a.senha } : undefined }) },
  { nome: 'aprovacao_recusar', titulo: 'Aprovações: recusar', descricao: 'Recusa a aprovação, com motivo.', metodo: 'POST', rota: '/approvals/:id/reject', args: { motivo: z.string().max(2000).optional() }, corpo: (a) => semVazios({ motivo: a.motivo }) },
  { nome: 'aprovacao_pedir_de_novo', titulo: 'Aprovações: pedir de novo', descricao: 'Recria o pedido vencido com o conteúdo de agora.', metodo: 'POST', rota: '/approvals/:id/pedir-de-novo' },
  { nome: 'pendencias', titulo: 'Pendências', descricao: 'As decisões que agentes e rotinas deixaram para uma pessoa.', metodo: 'GET', rota: '/pendencias' },
  { nome: 'pendencia_responder', titulo: 'Pendências: responder', descricao: 'Responde a pendência (só quem ela espera, com a permissão do assunto).', metodo: 'POST', rota: '/pendencias/:id/responder', args: { corpo: corpoLivre('a resposta no formato do tipo da pendência') }, corpo: 'livre' },
  { nome: 'pendencia_descartar', titulo: 'Pendências: descartar', descricao: 'Descarta a pendência.', metodo: 'POST', rota: '/pendencias/:id/descartar' },
  { nome: 'caixa', titulo: 'Caixa de entrada', descricao: 'A caixa do operador: o que espera ele (aprovações, pendências, tarefas, decisões).', metodo: 'GET', rota: '/caixa' },
  { nome: 'politica_regua', titulo: 'Política: régua R0 a R5', descricao: 'Níveis, sinais, catálogo de capacidades e sobrescritas da empresa.', metodo: 'GET', rota: '/policy/regua' },
  { nome: 'politica_simular', titulo: 'Política: simular ação', descricao: 'Pergunta à régua o que aconteceria com uma ação hipotética (responde; não faz).', metodo: 'POST', rota: '/policy/simular', args: { corpo: corpoLivre('capacidade, args, horario|momento|agora') }, corpo: 'livre' },
  { nome: 'auditoria', titulo: 'Auditoria (RASTRO)', descricao: 'Os eventos do rastro da empresa.', metodo: 'GET', rota: '/audit', args: { filtros }, query: [] },
  { nome: 'linha_do_tempo', titulo: 'Linha do tempo', descricao: 'A linha do tempo da empresa (o que aconteceu, por quem).', metodo: 'GET', rota: '/linha-do-tempo', args: { filtros }, query: [] },
  // ------------------------------------------------------------------ whatsapp
  { nome: 'whatsapp_resumo', titulo: 'WhatsApp: resumo', descricao: 'O resumo da caixa (não lidas por filtro).', metodo: 'GET', rota: '/whatsapp/resumo' },
  { nome: 'whatsapp_conversas', titulo: 'WhatsApp: conversas', descricao: 'As conversas da caixa (filtro: equipe, leads, clientes, sem-vinculo, arquivadas; q: busca).', metodo: 'GET', rota: '/whatsapp/conversas', args: { filtro: z.string().optional(), q: z.string().optional() }, query: ['filtro', 'q'] },
  { nome: 'whatsapp_conversa', titulo: 'WhatsApp: uma conversa', descricao: 'As mensagens de uma conversa.', metodo: 'GET', rota: '/whatsapp/conversas/:id' },
  { nome: 'whatsapp_responder', titulo: 'WhatsApp: responder', descricao: 'Responde na conversa como PESSOA pela Evolution (auditado, sem porta). Texto curto, fato primeiro, próximo passo com data.', metodo: 'POST', rota: '/whatsapp/conversas/:id/responder', args: { corpo: corpoLivre('texto') }, corpo: 'livre' },
  { nome: 'whatsapp_lida', titulo: 'WhatsApp: marcar lida', descricao: 'Marca a conversa como lida.', metodo: 'POST', rota: '/whatsapp/conversas/:id/lida' },
  { nome: 'whatsapp_arquivar', titulo: 'WhatsApp: arquivar', descricao: 'Arquiva (ou desarquiva) a conversa.', metodo: 'POST', rota: '/whatsapp/conversas/:id/arquivar', args: { corpo: corpoLivre('arquivar: true|false') }, corpo: 'livre' },
  { nome: 'whatsapp_vincular', titulo: 'WhatsApp: vincular conversa', descricao: 'Vincula a conversa a um lead ou cliente.', metodo: 'POST', rota: '/whatsapp/vinculos/:conversa_id', args: { tipo: z.enum(['lead', 'cliente']), id: z.string() }, corpo: (a) => ({ tipo: a.tipo, id: a.id }) },
  { nome: 'whatsapp_desvincular', titulo: 'WhatsApp: desvincular', descricao: 'Desfaz o vínculo da conversa.', metodo: 'POST', rota: '/whatsapp/vinculos/:conversa_id/desvincular' },
  { nome: 'whatsapp_candidatos', titulo: 'WhatsApp: candidatos a vínculo', descricao: 'Busca lead ou cliente para vincular (o igual ao nome da conversa primeiro).', metodo: 'GET', rota: '/whatsapp/vinculos/candidatos', args: { tipo: z.string().optional(), q: z.string().optional() }, query: ['tipo', 'q'] },
  { nome: 'whatsapp_conversas_do_lead', titulo: 'WhatsApp: conversas do lead', descricao: 'As conversas vinculadas a um lead.', metodo: 'GET', rota: '/whatsapp/vinculos/lead/:lead_id' },
  // ------------------------------------------------------------------ memória e conhecimento
  { nome: 'memoria_listar', titulo: 'Memória: notas', descricao: 'As notas de contexto da empresa (kind, tags, chave).', metodo: 'GET', rota: '/memoria', args: { filtros }, query: [] },
  { nome: 'memoria_buscar', titulo: 'Memória: buscar', descricao: 'Busca textual nas notas da memória.', metodo: 'GET', rota: '/memoria/buscar', args: { q: z.string().min(1) }, query: ['q'] },
  { nome: 'memoria_nota', titulo: 'Memória: uma nota', descricao: 'A nota com o corpo atual.', metodo: 'GET', rota: '/memoria/:id' },
  { nome: 'memoria_versoes', titulo: 'Memória: versões da nota', descricao: 'O histórico de versões da nota.', metodo: 'GET', rota: '/memoria/:id/versoes' },
  { nome: 'memoria_criar', titulo: 'Memória: criar nota', descricao: 'Cria uma nota da memória (evento no RASTRO; chave única, ex.: comercial.whatsapp.numero).', metodo: 'POST', rota: '/memoria', args: { corpo: corpoLivre('chave, kind (regra|definicao|dicionario|decisao|fato|nota), title, body, tags?, sourceType?, sourceRef?, acessoRestrito?, leitores?') }, corpo: 'livre' },
  { nome: 'memoria_alterar', titulo: 'Memória: alterar nota', descricao: 'Altera o corpo ou os dados da nota (versão nova, condicionada à versão lida).', metodo: 'PATCH', rota: '/memoria/:id', args: { corpo: corpoLivre('body?, title?, tags?, versaoEsperada?, motivo?') }, corpo: 'livre' },
  { nome: 'memoria_arquivar', titulo: 'Memória: arquivar nota', descricao: 'Arquiva a nota (o histórico fica).', metodo: 'POST', rota: '/memoria/:id/arquivar', args: { corpo: corpoLivre('motivo?') }, corpo: 'livre' },
  { nome: 'memoria_restaurar', titulo: 'Memória: restaurar nota', descricao: 'Restaura a nota arquivada.', metodo: 'POST', rota: '/memoria/:id/restaurar' },
  { nome: 'conhecimento_buscar', titulo: 'Conhecimento: buscar no vault', descricao: 'Busca semântica nas notas indexadas do vault (root-base).', metodo: 'GET', rota: '/knowledge/search', args: { q: z.string().min(1), limit: z.string().optional() }, query: ['q', 'limit'] },
  { nome: 'conhecimento_nota', titulo: 'Conhecimento: uma nota do vault', descricao: 'Uma nota indexada do vault pelo id.', metodo: 'GET', rota: '/knowledge/:id' },
  // ------------------------------------------------------------------ agentes, rotinas, frota
  { nome: 'agentes', titulo: 'Agentes: lista', descricao: 'Os agentes da empresa com estado e dono.', metodo: 'GET', rota: '/agents' },
  { nome: 'agente', titulo: 'Agentes: um agente', descricao: 'A ficha do agente pelo slug.', metodo: 'GET', rota: '/agents/:slug' },
  { nome: 'agente_invocar', titulo: 'Agentes: invocar', descricao: 'Uma passagem manual do agente, pelo dono (gasta IA).', metodo: 'POST', rota: '/agents/:slug/invocar', args: { corpo: corpoLivre('entrada/instrução, conforme o agente') }, corpo: 'livre' },
  { nome: 'agente_pausar', titulo: 'Agentes: pausar', descricao: 'Pausa o agente.', metodo: 'POST', rota: '/agents/:slug/pausar', args: { corpo: corpoLivre('motivo?') }, corpo: 'livre' },
  { nome: 'agente_retomar', titulo: 'Agentes: retomar', descricao: 'Retoma o agente pausado.', metodo: 'POST', rota: '/agents/:slug/retomar' },
  { nome: 'agente_estado_humano', titulo: 'Agentes: estado em linguagem de gente', descricao: 'O estado do agente explicado.', metodo: 'GET', rota: '/agents/:slug/estado-humano' },
  { nome: 'rotinas', titulo: 'Rotinas: lista', descricao: 'As rotinas da empresa com estado, interruptor e o agendador.', metodo: 'GET', rota: '/rotinas' },
  { nome: 'rotina_editar', titulo: 'Rotinas: ligar, desligar ou ajustar', descricao: 'Muda estado, interruptor ou linha de base (um campo por vez).', metodo: 'PATCH', rota: '/rotinas/:id', args: { corpo: corpoLivre('estado | interruptor | linhaDeBase') }, corpo: 'livre' },
  { nome: 'rotina_rodar', titulo: 'Rotinas: rodar agora', descricao: 'Dispara uma passagem da rotina agora.', metodo: 'POST', rota: '/rotinas/:id/rodar' },
  { nome: 'rotina_execucoes', titulo: 'Rotinas: histórico', descricao: 'As passagens da rotina.', metodo: 'GET', rota: '/rotinas/:id/execucoes' },
  { nome: 'frota_resumo', titulo: 'Frota: resumo', descricao: 'O resumo das casas (servidores de clientes) relatando.', metodo: 'GET', rota: '/frota/resumo' },
  { nome: 'frota_casas', titulo: 'Frota: casas', descricao: 'As casas da frota.', metodo: 'GET', rota: '/frota/casas' },
  { nome: 'frota_casa', titulo: 'Frota: uma casa', descricao: 'A casa com o último relato e as ordens.', metodo: 'GET', rota: '/frota/casas/:id' },
  { nome: 'frota_eventos', titulo: 'Frota: eventos', descricao: 'Os eventos relatados pelas casas.', metodo: 'GET', rota: '/frota/eventos', args: { filtros }, query: [] },
  // ------------------------------------------------------------------ financeiro
  { nome: 'financeiro_lancar', titulo: 'Financeiro: lançar', descricao: 'Cria um lançamento (receita ou despesa).', metodo: 'POST', rota: '/finance/transactions', args: { corpo: corpoLivre('type, amount, date, description, categoryId?, accountId?, partnerId?, projetoId?') }, corpo: 'livre' },
  { nome: 'financeiro_lancamento_editar', titulo: 'Financeiro: editar lançamento', descricao: 'Edita um lançamento.', metodo: 'PATCH', rota: '/finance/transactions/:id', args: { corpo: corpoLivre('campos a alterar') }, corpo: 'livre' },
  { nome: 'financeiro_lancamento_aprovar', titulo: 'Financeiro: aprovar lançamento', descricao: 'Aprova o lançamento.', metodo: 'POST', rota: '/finance/transactions/:id/approve' },
  { nome: 'financeiro_conciliacao', titulo: 'Financeiro: conciliação', descricao: 'O que falta conciliar entre banco e lançamentos.', metodo: 'GET', rota: '/finance/conciliacao', args: { filtros }, query: [] },
  { nome: 'financeiro_conciliar_auto', titulo: 'Financeiro: conciliar automático', descricao: 'Roda a conciliação automática.', metodo: 'POST', rota: '/finance/conciliacao/auto', args: { corpo: corpoLivre('opcional') }, corpo: 'livre' },
  { nome: 'financeiro_conciliar_match', titulo: 'Financeiro: conciliar um par', descricao: 'Concilia um movimento bancário com um lançamento.', metodo: 'POST', rota: '/finance/conciliacao/match', args: { corpo: corpoLivre('bankTransactionId, transactionId') }, corpo: 'livre' },
  { nome: 'financeiro_contratos', titulo: 'Financeiro: contratos', descricao: 'Os contratos do Financeiro (recorrências).', metodo: 'GET', rota: '/finance/contracts' },
  { nome: 'financeiro_contrato_criar', titulo: 'Financeiro: criar contrato', descricao: 'Cria um contrato do Financeiro.', metodo: 'POST', rota: '/finance/contracts', args: { corpo: corpoLivre('partnerId, amount, parcelas, firstDueDate, description') }, corpo: 'livre' },
  { nome: 'financeiro_parceiros', titulo: 'Financeiro: parceiros (clientes e fornecedores)', descricao: 'O cadastro de clientes e fornecedores.', metodo: 'GET', rota: '/finance/partners' },
  { nome: 'financeiro_analise', titulo: 'Financeiro: análise', descricao: 'A análise financeira (acordos, leituras, rotina).', metodo: 'GET', rota: '/finance/analise', args: { filtros }, query: [] },
  { nome: 'financeiro_periodo', titulo: 'Financeiro: período', descricao: 'Os números do período.', metodo: 'GET', rota: '/finance/periodo', args: { filtros }, query: [] },
  // ------------------------------------------------------------------ pauta
  { nome: 'pauta_capturas', titulo: 'Pauta: capturas', descricao: 'As capturas (links, prints, textos) da fila de referências.', metodo: 'GET', rota: '/pauta/capturas', args: { filtros }, query: [] },
  { nome: 'pauta_captura_criar', titulo: 'Pauta: capturar', descricao: 'Cria uma captura (link ou texto).', metodo: 'POST', rota: '/pauta/capturas', args: { corpo: corpoLivre('url | texto, titulo?, fonte?') }, corpo: 'livre' },
  { nome: 'pauta_rodadas', titulo: 'Pauta: rodadas', descricao: 'As rodadas de curadoria.', metodo: 'GET', rota: '/pauta/rodadas' },
  { nome: 'pauta_rodada', titulo: 'Pauta: uma rodada', descricao: 'A rodada com os candidatos e o estado.', metodo: 'GET', rota: '/pauta/rodadas/:id' },
  { nome: 'pauta_curadoria_iniciar', titulo: 'Pauta: iniciar curadoria', descricao: 'Abre uma rodada em aguardando_curadoria com as capturas da janela (gasta IA para sugerir).', metodo: 'POST', rota: '/pauta/rodadas/curadoria', args: { corpo: corpoLivre('horas?, origens?') }, corpo: 'livre' },
  { nome: 'pauta_curadoria_salvar', titulo: 'Pauta: salvar marcados', descricao: 'Salva os candidatos marcados da curadoria.', metodo: 'PUT', rota: '/pauta/rodadas/:id/curadoria', args: { corpo: corpoLivre('marcados: ids') }, corpo: 'livre' },
  { nome: 'pauta_curadoria_confirmar', titulo: 'Pauta: confirmar curadoria', descricao: 'Confirma a curadoria: a rodada passa a curada.', metodo: 'POST', rota: '/pauta/rodadas/:id/curadoria/confirmar' },
  { nome: 'pauta_episodios', titulo: 'Pauta: episódios', descricao: 'Os episódios com status.', metodo: 'GET', rota: '/pauta/episodios' },
  { nome: 'pauta_episodio', titulo: 'Pauta: um episódio', descricao: 'O episódio com roteiro, pacote, semana e YouTube.', metodo: 'GET', rota: '/pauta/episodios/:id' },
  { nome: 'pauta_episodio_criar', titulo: 'Pauta: criar episódio', descricao: 'Cria o episódio a partir de uma rodada curada.', metodo: 'POST', rota: '/pauta/episodios', args: { corpo: corpoLivre('rodadaId') }, corpo: 'livre' },
  { nome: 'pauta_episodio_status', titulo: 'Pauta: mudar status do episódio', descricao: 'Anda um passo (roteiro → gravação → edição → pacote → derivação → agendado → concluído).', metodo: 'POST', rota: '/pauta/episodios/:id/status', args: { corpo: corpoLivre('status') }, corpo: 'livre' },
  { nome: 'pauta_roteiro_gerar', titulo: 'Pauta: gerar roteiro', descricao: 'Gera o roteiro do episódio (gasta IA; substituir=true quando já há).', metodo: 'POST', rota: '/pauta/episodios/:id/roteiro/gerar', args: { corpo: corpoLivre('substituir?') }, corpo: 'livre' },
  { nome: 'pauta_pacote_gerar', titulo: 'Pauta: gerar pacote do YouTube', descricao: 'Gera títulos, descrição e thumbs (gasta IA).', metodo: 'POST', rota: '/pauta/episodios/:id/pacote/gerar', args: { corpo: corpoLivre('substituir?') }, corpo: 'livre' },
  { nome: 'pauta_semana', titulo: 'Pauta: semana do episódio', descricao: 'As peças da semana (carrossel, story, corte) com estado.', metodo: 'GET', rota: '/pauta/episodios/:id/semana' },
  { nome: 'pauta_semana_gerar', titulo: 'Pauta: gerar semana', descricao: 'Gera as peças da semana (gasta IA).', metodo: 'POST', rota: '/pauta/episodios/:id/semana/gerar', args: { corpo: corpoLivre('substituir?, itens?') }, corpo: 'livre' },
  { nome: 'pauta_agenda', titulo: 'Pauta: agenda de posts', descricao: 'O calendário da semana de posts.', metodo: 'GET', rota: '/pauta/agenda', args: { de: z.string().optional() }, query: ['de'] },
  { nome: 'pauta_ideias', titulo: 'Pauta: banco de ideias', descricao: 'As ideias de conteúdo da casa.', metodo: 'GET', rota: '/pauta/ideias' },
  { nome: 'pauta_ideia_criar', titulo: 'Pauta: nova ideia', descricao: 'Cria uma ideia no banco.', metodo: 'POST', rota: '/pauta/ideias', args: { corpo: corpoLivre('pilar, titulo, ganchoFala, ganchoTela, roteiro, legenda, cta, porque, fontes, formato, prioridade') }, corpo: 'livre' },
  { nome: 'pauta_ideia_status', titulo: 'Pauta: status da ideia', descricao: 'Muda o status da ideia (aprovar cria a peça).', metodo: 'PATCH', rota: '/pauta/ideias/:id/status', args: { corpo: corpoLivre('status') }, corpo: 'livre' },
  { nome: 'pauta_marca', titulo: 'Pauta: marca', descricao: 'A nota da marca e os pilares.', metodo: 'GET', rota: '/pauta/marca' },
  { nome: 'pauta_marca_editar', titulo: 'Pauta: editar marca', descricao: 'Edita a nota da marca.', metodo: 'PUT', rota: '/pauta/marca', args: { corpo: corpoLivre('texto, versao') }, corpo: 'livre' },
  { nome: 'pauta_voz', titulo: 'Pauta: voz do autor', descricao: 'O perfil de voz em uso.', metodo: 'GET', rota: '/pauta/voz' },
  { nome: 'pauta_estrategia', titulo: 'Pauta: estratégia do mês', descricao: 'A estratégia do mês (AAAA-MM).', metodo: 'GET', rota: '/pauta/estrategia/:mes' },
  { nome: 'pauta_relatorio', titulo: 'Pauta: relatório do mês', descricao: 'O relatório do mês (AAAA-MM).', metodo: 'GET', rota: '/pauta/relatorio/:mes' },
  { nome: 'pauta_performance', titulo: 'Pauta: performance do mês', descricao: 'A performance dos posts no mês (AAAA-MM).', metodo: 'GET', rota: '/pauta/performance/:mes' },
  { nome: 'pauta_peca_editar', titulo: 'Pauta: editar peça', descricao: 'Edita uma peça (status, texto).', metodo: 'PATCH', rota: '/pauta/pecas/:id', args: { corpo: corpoLivre('status | campos') }, corpo: 'livre' },
  { nome: 'pauta_peca_publicar_instagram', titulo: 'Pauta: publicar no Instagram', descricao: 'Pede a publicação da peça aprovada no Instagram (R3/R4: segunda pessoa confirma).', metodo: 'POST', rota: '/pauta/pecas/:id/publicar-instagram' },
  // ------------------------------------------------------------------ google, agenda, conexões, cofre
  { nome: 'google_status', titulo: 'Google: estado da conexão', descricao: 'Se o Google da empresa está conectado e com quais escopos.', metodo: 'GET', rota: '/google/status' },
  { nome: 'agenda_periodo', titulo: 'Agenda: período', descricao: 'A agenda do Google de um intervalo.', metodo: 'GET', rota: '/google/calendar/periodo', args: { de: z.string().optional().describe('AAAA-MM-DD'), ate: z.string().optional().describe('AAAA-MM-DD') }, query: ['de', 'ate'] },
  { nome: 'agenda_marcar_reuniao', titulo: 'Agenda: marcar reunião no padrão da casa', descricao: 'Marca reunião com título no padrão e Meet (R3: cai em Aprovações).', metodo: 'POST', rota: '/google/calendar/reuniao', args: { corpo: corpoLivre('cliente/assunto, inicio, fim, convidados') }, corpo: 'livre' },
  { nome: 'agenda_fora_do_padrao', titulo: 'Agenda: eventos fora do padrão', descricao: 'Os eventos cujo título não segue o padrão da casa.', metodo: 'GET', rota: '/agenda/fora-do-padrao' },
  { nome: 'gmail_listar', titulo: 'Gmail: listar', descricao: 'Mensagens do Gmail da empresa (busca do Gmail em q).', metodo: 'GET', rota: '/google/gmail', args: { filtros }, query: [] },
  { nome: 'gmail_ler', titulo: 'Gmail: ler mensagem', descricao: 'Uma mensagem do Gmail pelo id.', metodo: 'GET', rota: '/google/gmail/:id' },
  { nome: 'gmail_enviar', titulo: 'Gmail: enviar', descricao: 'Envia e-mail pela conta da empresa (R3: cai em Aprovações, outra pessoa libera).', metodo: 'POST', rota: '/google/gmail/send', args: { corpo: corpoLivre('to, subject, body, cc?') }, corpo: 'livre' },
  { nome: 'drive_listar', titulo: 'Drive: listar', descricao: 'Arquivos do Drive da empresa (q: busca por nome).', metodo: 'GET', rota: '/google/drive', args: { filtros }, query: [] },
  { nome: 'docs_ler', titulo: 'Docs: ler documento', descricao: 'O texto de um Documento Google pelo id.', metodo: 'GET', rota: '/google/docs/:id' },
  { nome: 'conexoes', titulo: 'Conexões: cartões', descricao: 'O cartão único de Conexões: cada conector, estado e saúde.', metodo: 'GET', rota: '/integrations/cartoes' },
  { nome: 'conexao_saude', titulo: 'Conexões: saúde de um conector', descricao: 'Verifica agora a saúde do conector (google, evolution, asaas, clickup, anthropic...).', metodo: 'GET', rota: '/integrations/:chave/saude' },
  { nome: 'cofre_estado', titulo: 'Cofre da empresa: estado', descricao: 'Se o cofre está trancado e quem tem senha.', metodo: 'GET', rota: '/cofre-da-empresa/estado' },
  { nome: 'cofre_itens', titulo: 'Cofre da empresa: itens', descricao: 'Os itens do cofre (sem os segredos; revelar é outra rota).', metodo: 'GET', rota: '/cofre-da-empresa/itens' },
  // ------------------------------------------------------------------ empresa, onboarding, plataforma, painel
  { nome: 'pessoas', titulo: 'Pessoas', descricao: 'As pessoas da empresa com foto e aniversário.', metodo: 'GET', rota: '/perfil/pessoas' },
  { nome: 'organograma', titulo: 'Organograma', descricao: 'Funções, donos e agentes por área.', metodo: 'GET', rota: '/organograma' },
  { nome: 'equipe', titulo: 'Equipe', descricao: 'A equipe: gente e agentes.', metodo: 'GET', rota: '/organograma/equipe' },
  { nome: 'usuarios', titulo: 'Usuários', descricao: 'Os usuários da empresa (pede admin.usuarios).', metodo: 'GET', rota: '/users' },
  { nome: 'usuario_criar', titulo: 'Usuários: criar', descricao: 'Cria um usuário (admin.usuarios).', metodo: 'POST', rota: '/users', args: { corpo: corpoLivre('name, email, roleKeys, password?') }, corpo: 'livre' },
  { nome: 'usuario_editar', titulo: 'Usuários: editar', descricao: 'Edita um usuário: papéis, ativo (admin.usuarios).', metodo: 'PATCH', rota: '/users/:id', args: { corpo: corpoLivre('campos a alterar') }, corpo: 'livre' },
  { nome: 'onboarding_trilhos', titulo: 'Onboarding: trilhos', descricao: 'Os trilhos de onboarding de cliente (5 fases).', metodo: 'GET', rota: '/tenants/onboarding/trilhos', args: { cardId: z.string().optional() }, query: ['cardId'] },
  { nome: 'onboarding_trilho', titulo: 'Onboarding: um trilho', descricao: 'O trilho com fase, itens, convites, atas e marcos.', metodo: 'GET', rota: '/tenants/onboarding/trilhos/:id' },
  { nome: 'onboarding_trilho_avancar', titulo: 'Onboarding: avançar fase', descricao: 'Avança a fase; recusa com a lista exata do que falta.', metodo: 'POST', rota: '/tenants/onboarding/trilhos/:id/avancar', args: { corpo: corpoLivre('opcional') }, corpo: 'livre' },
  { nome: 'onboarding_trilho_marco', titulo: 'Onboarding: registrar marco', descricao: 'Um marco escrito por gente (check semanal, dia 1, retomada).', metodo: 'POST', rota: '/tenants/onboarding/trilhos/:id/marcos', args: { corpo: corpoLivre('tipo, texto, data?') }, corpo: 'livre' },
  { nome: 'onboarding_trilho_kit', titulo: 'Onboarding: kit do cliente', descricao: 'O kit e a pasta do cliente.', metodo: 'GET', rota: '/tenants/onboarding/trilhos/:id/kit' },
  { nome: 'onboarding_trilho_montar_kit', titulo: 'Onboarding: montar kit', descricao: 'Monta o kit do cliente (gasta IA).', metodo: 'POST', rota: '/tenants/onboarding/trilhos/:id/kit' },
  { nome: 'onboarding_pendencias', titulo: 'Onboarding: pendências', descricao: 'As pendências dos trilhos.', metodo: 'GET', rota: '/tenants/onboarding/trilhos/pendencias' },
  { nome: 'plataforma_resumo', titulo: 'Plataforma: resumo', descricao: 'A Root como plataforma: empresas, uso, saúde.', metodo: 'GET', rota: '/tenants/plataforma/resumo' },
  { nome: 'plataforma_empresas', titulo: 'Plataforma: empresas', descricao: 'As empresas (tenants) da plataforma.', metodo: 'GET', rota: '/tenants/plataforma/empresas' },
  { nome: 'plataforma_operacao_painel', titulo: 'Plataforma: painel da operação', descricao: 'O painel da operação da Root (fluxo do cliente, área do cliente).', metodo: 'GET', rota: '/tenants/plataforma/operacao/painel' },
  { nome: 'dashboard_custo_ia', titulo: 'Painel: custo de IA', descricao: 'O custo de IA por empresa, agente e dia.', metodo: 'GET', rota: '/dashboard/custo-ia', args: { filtros }, query: [] },
];

function semVazios(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

const norm = (r: string) => r.replace(/:[^/]+/g, ':p');
function rotaDoInventario(metodo: string, rota: string) {
  const alvo = norm('/api' + rota);
  return ROTAS.find((x) => x.m === metodo && norm(x.r) === alvo) ?? null;
}

function registrar(server: McpServer, c: Curada): void {
  const params = [...c.rota.matchAll(/:([a-z_]+)/g)].map((m) => m[1]);
  const inv = rotaDoInventario(c.metodo, c.rota);
  const marcas: string[] = [];
  if (inv?.f.includes('g')) marcas.push('só gente');
  if (inv?.f.includes('s')) marcas.push('escrita sensível: vira aprovação');
  const permissao = inv?.p.join(', ') || 'sessão';
  const shape: ZodRawShape = {};
  for (const p of params) shape[p] = z.string().min(1).describe(p === 'lead_id' ? 'ID do lead' : p === 'conversa_id' ? 'ID da conversa' : p === 'mes' ? 'AAAA-MM' : `${p}`);
  Object.assign(shape, c.args ?? {});
  const escreve = c.metodo !== 'GET';
  const anot = !escreve ? LE : c.metodo === 'DELETE' || /excluir|apagar|descartar/.test(c.nome) ? DESTROI : c.metodo === 'PUT' || c.metodo === 'PATCH' ? ESCREVE_IDEMPOTENTE : ESCREVE;
  const quem = escreve ? '[operador, write]' : '[leitura]';
  const descricao = `${c.descricao} Rota ${c.metodo} /api${c.rota} · permissão ${permissao}${marcas.length ? ' · ' + marcas.join(' · ') : ''}. ${quem}`;
  server.registerTool(c.nome, { description: descricao, inputSchema: shape, annotations: { title: c.titulo, ...anot } }, async (a: Record<string, unknown>) => {
    try {
      let path = c.rota;
      for (const p of params) path = path.replace(`:${p}`, encodeURIComponent(String(a[p])));
      const q = new URLSearchParams();
      for (const k of c.query ?? []) if (a[k] !== undefined && a[k] !== '') q.set(k, String(a[k]));
      if (a.filtros && typeof a.filtros === 'object') for (const [k, v] of Object.entries(a.filtros as Record<string, string>)) if (v !== undefined && v !== '') q.set(k, String(v));
      const qs = q.toString();
      if (qs) path += `?${qs}`;
      if (c.upload) {
        const caminho = String(a[c.upload.arquivo]);
        const resultado = await operador().enviarArquivo(path, { caminho, campo: c.upload.campo, campos: c.upload.campos?.(a) });
        return ok(resultado);
      }
      const corpo = c.corpo === 'livre' ? (a.corpo as unknown) : c.corpo ? c.corpo(a) : undefined;
      const cliente = escreve ? operador() : leitor();
      return ok(await cliente.chamar(c.metodo, path, corpo));
    } catch (e) {
      return fail(e);
    }
  });
}

export function registrarCuradas(server: McpServer): void {
  const nomes = new Set<string>();
  for (const c of CURADAS) {
    if (nomes.has(c.nome)) throw new Error(`ferramenta curada repetida: ${c.nome}`);
    nomes.add(c.nome);
    registrar(server, c);
  }
}

export const TOTAL_DE_CURADAS = CURADAS.length;
export const CURADAS_PARA_O_CATALOGO = CURADAS.map((c) => ({ nome: c.nome, metodo: c.metodo, rota: c.rota, titulo: c.titulo }));
