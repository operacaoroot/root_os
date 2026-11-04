import type { ProcedimentoLocalExecucao, ProcedimentoLocalFontes, ProcedimentoLocalPainel, ProcedimentoLocalPedido } from '@mktos/shared';

export const PESSOA_LOCAL = '11111111-1111-4111-8111-111111111111';
export const OUTRA_PESSOA_LOCAL = '11111111-1111-4111-8111-222222222222';
export const ORG_LOCAL = '22222222-2222-4222-8222-111111111111';
export const OUTRA_ORG_LOCAL = '22222222-2222-4222-8222-222222222222';
export const AGENTE_LOCAL = '33333333-3333-4333-8333-111111111111';
export const NOTA_LOCAL = '44444444-4444-4444-8444-111111111111';
export const VERSAO_LOCAL_1 = '55555555-5555-4555-8555-111111111111';
export const VERSAO_LOCAL_2 = '55555555-5555-4555-8555-222222222222';
export const PEDIDO_LOCAL = '66666666-6666-4666-8666-111111111111';
export const EXECUCAO_LOCAL = '77777777-7777-4777-8777-111111111111';
export const MODELO_LOCAL = 'modelo-local-qa';
const EM = '2026-10-08T13:00:00Z';

type Item = ProcedimentoLocalFontes['items'][number];
type Versao = Item['versoes'][number];

export const escopoLocal = {
  orgId: ORG_LOCAL, userId: PESSOA_LOCAL, agentId: AGENTE_LOCAL, agentSlug: 'procedimento-qa',
};

const procedimento = {
  versao: 1, proposito: 'Preparar uma síntese', passos: ['Ler a fonte', 'Sintetizar'],
  definicaoDePronto: 'Resultado registrado',
};

export const painelLocal: ProcedimentoLocalPainel = {
  escopo: escopoLocal,
  autoridade: { ler: true, iniciar: true, editarSop: false, verificadaEm: EM },
  agente: { estado: 'ativo', ativo: true, responsavelDisponivel: true },
  procedimento,
  modelo: { configurado: MODELO_LOCAL, declaracao: { estado: 'declarado_sem_verificacao',
    provider: 'llama.cpp-local', disponivel: null, modelo: null, verificadoAgora: false } },
  executor: { modo: 'sintese_local_sem_ferramentas', ferramentasExternas: false, agendamento: false, cancelarInferencia: false },
  inicioLocal: { permitido: true, impedimentosLocais: [], verificacaoModelo: 'somente_apos_pedido' },
};

export function versaoLocal(numero: 1 | 2, title: string): Versao {
  const id = numero === 1 ? VERSAO_LOCAL_1 : VERSAO_LOCAL_2;
  const contentHash = (numero === 1 ? 'a' : 'b').repeat(64);
  return {
    id, title, versao: numero, contentHash, sourceType: 'operador', sourceRef: 'QA',
    retratoFonte: {
      itemId: NOTA_LOCAL, chave: 'qa:nota', colecao: 'manual_local',
      identidadeCanonica: { documentId: NOTA_LOCAL, origemDaIdentidade: 'item_existente' },
      versao: { versionId: id, numero, contentHash }, title, body: null, versaoAtual: 2, arquivada: false,
      registradaEm: EM, atualizadaNaMemoriaEm: null, origem: { tipo: 'operador', referencia: 'QA' },
      estado: { coleta: 'nao_verificada', indexacao: 'nao_verificada', projecao: 'nao_verificada', ultimoReciboId: null },
      acesso: { modelo: 'local_por_pessoa', verificadoEm: EM, novoUsoPermitido: true },
      citacao: { chave: 'qa:nota', itemId: NOTA_LOCAL, versao: numero, versionId: id, contentHash },
    },
  };
}

export function fontesLocais(title: string, ...versoes: Versao[]): ProcedimentoLocalFontes {
  return { escopo: escopoLocal, painel: painelLocal, items: [{ id: NOTA_LOCAL, chave: 'qa:nota', title, versao: 2, versoes }] };
}

export function execucaoLocal(versao: Versao, pedido: string, resposta: string, body: string): ProcedimentoLocalExecucao & { resposta: string } {
  const { id, contentHash, title, sourceType, sourceRef } = versao;
  const input: ProcedimentoLocalPedido = { requestId: PEDIDO_LOCAL, pedido, itemId: NOTA_LOCAL, versionId: id,
    contentHash, expectedItemVersion: 2, expectedSopVersion: procedimento.versao };
  return {
    escopo: escopoLocal, id: EXECUCAO_LOCAL, requestId: PEDIDO_LOCAL, pessoaId: PESSOA_LOCAL,
    pedido, resposta, entradaConfirmada: { contrato: 2, input }, status: 'respondida', motivo: null,
    procedimento, procedimentoAtual: procedimento, painelAtual: painelLocal,
    fonte: { itemId: NOTA_LOCAL, chave: 'qa:nota', versionId: id, contentHash, versao: versao.versao, title, sourceType, sourceRef },
    retratoFonte: { ...versao.retratoFonte, body }, modeloConfigurado: MODELO_LOCAL, modeloUsado: MODELO_LOCAL,
    provider: 'llama.cpp-local', consumo: { tokensIn: 30, tokensOut: 20, origem: 'resposta_do_servidor_local',
      custoExternoUsd: 0, custoMaquinaMedido: false },
    criadaEm: EM, encerradaEm: EM,
  };
}

export function execucaoDoPedido(registro: ProcedimentoLocalExecucao, requestId: string): ProcedimentoLocalExecucao {
  const entrada = registro.entradaConfirmada;
  const entradaConfirmada = entrada.contrato === 2
    ? { contrato: 2 as const, input: { ...entrada.input, requestId } }
    : { contrato: 1 as const, input: { ...entrada.input, requestId } };
  return { ...registro, requestId, entradaConfirmada };
}

export function recuperarExecucao(registro: ProcedimentoLocalExecucao, requestId = registro.requestId) {
  return { estado: 'confirmado', escopo: registro.escopo, requestId, execucao: execucaoDoPedido(registro, requestId) };
}

export const mensagensDaExecucaoLocal = {
  modelo: `Modelo configurado: ${MODELO_LOCAL}.`,
  erroIncerto: 'Não foi possível conferir o procedimento. Tente conferir novamente.',
  conflito: 'O pedido, a fonte ou o procedimento mudou. Confira o pedido original antes de tentar novamente.',
  pedidoPendente: 'Confira o pedido original antes de preparar outro.',
  conferirFontes: 'Conferir fontes, procedimento e acesso',
};
