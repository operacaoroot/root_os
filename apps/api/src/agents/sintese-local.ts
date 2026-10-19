import { AVISO_DA_CERCA, CERCA_ABRE, CERCA_FECHA, blocoExterno } from './context-builder.service';

export type FimSinteseLocal = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'function_call' | 'ausente' | 'desconhecido';

export interface ObservacaoLocal {
  modelo: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  finishReason?: FimSinteseLocal;
}

export type MotivoFalhaSinteseLocal = 'fim_incompleto' | 'fim_nao_confirmado' | 'eco_do_involucro'
  | 'modelo_divergente' | 'texto_ausente' | 'ferramenta_solicitada';

const MENSAGEM: Record<MotivoFalhaSinteseLocal, string> = {
  fim_incompleto: 'O modelo interrompeu a resposta antes de concluir a síntese.',
  fim_nao_confirmado: 'O modelo não confirmou o término normal da síntese.',
  eco_do_involucro: 'O modelo repetiu o invólucro da fonte em vez de entregar a síntese.',
  modelo_divergente: 'O modelo servido difere do modelo escolhido. Confira a configuração.',
  texto_ausente: 'O modelo não produziu texto.',
  ferramenta_solicitada: 'Ferramenta não permitida neste procedimento. Nenhuma ferramenta foi executada.',
};

export function tokenObservado(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0 && valor <= 2_147_483_647 ? valor : null;
}

export function fimObservado(valor: unknown): FimSinteseLocal {
  if (valor === undefined || valor === null) return 'ausente';
  return valor === 'stop' || valor === 'length' || valor === 'content_filter' || valor === 'tool_calls' || valor === 'function_call'
    ? valor : 'desconhecido';
}

/** A falha guarda somente o motivo fechado e o consumo observado; nunca o texto rejeitado. */
export class FalhaSinteseLocal extends Error {
  readonly observado: Readonly<ObservacaoLocal>;
  constructor(readonly motivo: MotivoFalhaSinteseLocal, observado: ObservacaoLocal) {
    super(MENSAGEM[motivo]);
    this.name = 'FalhaSinteseLocal';
    const fim = observado.finishReason;
    this.observado = Object.freeze({
      modelo: typeof observado.modelo === 'string' && observado.modelo.length > 0 && observado.modelo.length <= 200
        && !/[\u0000-\u001f\u007f]/.test(observado.modelo) ? observado.modelo : null,
      tokensIn: tokenObservado(observado.tokensIn), tokensOut: tokenObservado(observado.tokensOut),
      finishReason: fim === 'ausente' || fim === 'desconhecido' ? fim : fimObservado(fim),
    });
  }
}

/** Detecta o invólucro conhecido; não decide se a síntese é verdadeira ou útil. */
export function ecoDoInvolucro(texto: string): boolean {
  const semQuebras = texto.replace(/\s+/g, ' ').trim();
  if (semQuebras.startsWith(AVISO_DA_CERCA.replace(/\s+/g, ' '))) return true;
  const cabecalhoIsolado = new RegExp(`(^|\\n)\\s*${CERCA_ABRE}\\s+origem=[^\\n]*>>>\\s*(?=\\n|$)`);
  if (cabecalhoIsolado.test(texto) || texto.trim() === CERCA_FECHA) return true;
  let objeto: unknown;
  try { objeto = JSON.parse(texto.trim()); } catch { return false; }
  if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) return false;
  const fonte = objeto as Record<string, unknown>;
  const campos = ['itemId', 'versionId', 'contentHash', 'versao', 'chave', 'sourceType', 'sourceRef', 'title'];
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return Object.keys(fonte).length === campos.length && campos.every((c) => Object.prototype.hasOwnProperty.call(fonte, c))
    && typeof fonte.itemId === 'string' && uuid.test(fonte.itemId) && typeof fonte.versionId === 'string' && uuid.test(fonte.versionId)
    && typeof fonte.contentHash === 'string' && /^[a-f0-9]{64}$/.test(fonte.contentHash)
    && typeof fonte.versao === 'number' && Number.isInteger(fonte.versao) && fonte.versao > 0
    && typeof fonte.chave === 'string' && typeof fonte.sourceType === 'string' && typeof fonte.title === 'string'
    && (fonte.sourceRef === null || typeof fonte.sourceRef === 'string');
}

export function promptSinteseLocal(input: {
  pedido: string; body: string; versao: number;
  procedimento: { proposito: string; passos: string[]; definicaoDePronto: string };
}): { system: string; user: string } {
  const fonte = blocoExterno([{ origem: 'fonte-selecionada', conteudo: input.body }]).texto;
  return {
    system: `Sintetize a fonte em português, em uma ou duas frases, conforme o pedido. Termine com (v${input.versao}). Use somente o conteúdo da fonte. Não copie avisos, cercas ou metadados. Não use ferramentas nem execute ações.\nProcedimento: ${input.procedimento.proposito}\nPassos: ${input.procedimento.passos.join('; ')}\nEntrega: ${input.procedimento.definicaoDePronto}`,
    user: `${fonte}\n\nPedido: ${input.pedido}`,
  };
}
