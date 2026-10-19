/** Fonte e capacidades devolvidas após conferência de acesso pelo servidor. */
export interface M05EscopoDto {
  orgId: string;
  userId: string;
  agentId?: string;
  agentSlug?: string;
}

export interface M05FonteAutorizadaDto {
  itemId: string;
  chave: string;
  colecao: 'vault_canonica' | 'manual_local' | 'drive_selecionado';
  identidadeCanonica: { documentId: string; origemDaIdentidade: 'item_existente' | 'vinculo_explicito' };
  versao: { versionId: string; numero: number; contentHash: string };
  origem: { tipo: string; referencia: string | null };
  title: string;
  body: string | null;
  versaoAtual: number;
  arquivada: boolean;
  registradaEm: string;
  atualizadaNaMemoriaEm: string | null;
  citacao: { chave: string; itemId: string; versao: number; versionId: string; contentHash: string };
  estado: {
    coleta: 'nao_verificada' | 'ok' | 'parcial' | 'falhou';
    indexacao: 'nao_verificada' | 'ok' | 'parcial' | 'falhou';
    projecao: 'nao_verificada' | 'ok' | 'parcial' | 'falhou';
    ultimoReciboId: string | null;
  };
  acesso: {
    modelo: 'local_por_pessoa' | 'externo_por_arquivo';
    verificadoEm: string;
    novoUsoPermitido: boolean;
  };
}

export interface M05CapacidadesExecutorDto {
  modo: 'sintese_local_sem_ferramentas';
  capacidades: {
    lerVersao: true;
    sintetizarLocalmente: true;
    registrarResultado: true;
    ferramentasExternas: false;
    agendamento: false;
    cancelarInferencia: false;
  };
  agente: { id: string; slug: string; estado: string; ativo: boolean; procedimentoVersao: number | null };
  modelo: { disponivel: boolean; modelo: string | null; motivo: string | null; provider: 'llama.cpp-local' };
  novasExecucoesPermitidas: boolean;
  impedimento: string | null;
}
