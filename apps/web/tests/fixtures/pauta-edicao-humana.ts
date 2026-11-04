import type { PautaDestinoFisico, PautaEscritaHumanaResultado } from '@mktos/shared';

export const ATOR_PAUTA = '11111111-1111-4111-8111-111111111111';
export const ESCOPO_PAUTA = { orgId: '22222222-2222-4222-8222-222222222222', actorId: ATOR_PAUTA };
export const NOTA_PAUTA = '33333333-3333-4333-8333-333333333333';
const VERSAO_PAUTA = '44444444-4444-4444-8444-444444444444';
const EM = '2026-09-28T12:00:00.000Z';

export const envelopePauta = {
  contrato: 1 as const, escopo: ESCOPO_PAUTA, autoridade: { ler: true as const, editar: true, verificadaEm: EM }, observadoEm: EM,
};

export function destinoPauta(chave: string, versao: number, corpo: string, itemId = NOTA_PAUTA): Extract<PautaDestinoFisico, { estado: 'existente' }> {
  return { estado: 'existente', tipo: 'nota_memoria', chave, itemId, kind: 'nota', arquivada: false,
    origem: { tipo: 'operador', referencia: null }, versao, conteudo: { titulo: 'Nota QA', corpo } };
}

export function destinoAusentePauta(chave: string): Extract<PautaDestinoFisico, { estado: 'ausente' }> {
  return { estado: 'ausente', tipo: 'nota_memoria', chave, itemId: null, kind: null, arquivada: null, origem: null, versao: null, conteudo: null };
}

export function pedidoPauta(destino: PautaDestinoFisico) {
  const { versao, conteudo: _conteudo, ...base } = destino;
  return { escopoEsperado: ESCOPO_PAUTA, baseEsperada: base, versaoEsperada: versao, reativar: false };
}

export function reciboPauta(acao: PautaEscritaHumanaResultado['acao'], antes: PautaDestinoFisico,
  depois: Extract<PautaDestinoFisico, { estado: 'existente' }>): PautaEscritaHumanaResultado {
  const { baseEsperada, versaoEsperada } = pedidoPauta(antes);
  return { escopo: ESCOPO_PAUTA, acao, baseAplicada: { baseEsperada, versaoEsperada },
    edicao: { itemId: depois.itemId, versionId: VERSAO_PAUTA, versao: depois.versao },
    reativacao: { solicitada: false, estado: 'nao_solicitada', versao: null, versionId: null },
    resultado: 'concluido', atomicidade: 'commit_unico', destinoFinal: depois, registroMudanca: 'registrado' };
}
